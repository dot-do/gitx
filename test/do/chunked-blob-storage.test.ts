import { describe, it, expect, beforeEach } from 'vitest'
import {
  ObjectStore,
  StoredObject
} from '../../src/do/object-store'
import { DurableObjectStorage } from '../../src/do/schema'
import { ObjectType } from '../../src/types/objects'

// Constants
const CHUNK_SIZE = 2 * 1024 * 1024 // 2MB - same as page-store.ts

// Helper to create test data
const encoder = new TextEncoder()

/**
 * Mock DurableObjectStorage for testing chunked blob storage
 * Extended to track chunked blob entries
 */
class MockChunkedStorage implements DurableObjectStorage {
  private objects: Map<string, StoredObject> = new Map()
  private objectIndex: Map<string, {
    tier: string
    packId: string | null
    offset: number | null
    size: number
    type: string
    updatedAt: number
    chunked?: boolean
    chunkCount?: number
  }> = new Map()
  private walEntries: { id: number; operation: string; payload: Uint8Array; flushed: boolean }[] = []
  private nextWalId = 1
  private executedQueries: string[] = []

  sql = {
    exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
      this.executedQueries.push(query)

      // Handle WAL inserts
      if (query.includes('INSERT INTO wal')) {
        const id = this.nextWalId++
        this.walEntries.push({
          id,
          operation: params[0] as string,
          payload: params[1] as Uint8Array,
          flushed: false
        })
        return { toArray: () => [{ id }] }
      }

      // Handle object inserts (including chunk pattern)
      if (query.includes('INSERT INTO objects') || query.includes('INSERT OR REPLACE INTO objects')) {
        const sha = params[0] as string
        const type = params[1] as ObjectType
        const size = params[2] as number
        const data = params[3] as Uint8Array
        const createdAt = params[4] as number

        this.objects.set(sha, { sha, type, size, data, createdAt })
        return { toArray: () => [] }
      }

      // Handle object_index inserts
      if (query.includes('INSERT INTO object_index') || query.includes('INSERT OR REPLACE INTO object_index')) {
        const sha = params[0] as string
        const tier = params[1] as string
        const packId = params[2] as string | null
        const offset = params[3] as number | null
        const size = params[4] as number
        const type = params[5] as string
        const updatedAt = params[6] as number
        // Extended fields for chunked storage (stored as integers in SQL)
        const chunked = params[7] as number | undefined
        const chunkCount = params[8] as number | undefined

        this.objectIndex.set(sha, {
          tier,
          packId,
          offset,
          size,
          type,
          updatedAt,
          chunked: chunked === 1,
          chunkCount: chunkCount || 0
        })
        return { toArray: () => [] }
      }

      // Handle object SELECT by sha
      if (query.includes('SELECT') && query.includes('FROM objects') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        const obj = this.objects.get(sha)
        return { toArray: () => obj ? [obj] : [] }
      }

      // Handle object_index SELECT by sha
      if (query.includes('SELECT') && query.includes('FROM object_index') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        const idx = this.objectIndex.get(sha)
        return {
          toArray: () => idx ? [{
            sha,
            tier: idx.tier,
            pack_id: idx.packId,
            offset: idx.offset,
            size: idx.size,
            type: idx.type,
            updated_at: idx.updatedAt,
            chunked: idx.chunked ? 1 : 0,  // Return as integer like real SQL
            chunk_count: idx.chunkCount || 0
          }] : []
        }
      }

      // Handle SELECT for chunked blob parts with LIKE pattern
      if (query.includes('SELECT') && query.includes('FROM objects') && query.includes('LIKE ?')) {
        const pattern = params[0] as string
        // Pattern is like '__chunked_blob__abc123%'
        const prefix = pattern.replace(/%$/, '') // Remove trailing %
        const matching: StoredObject[] = []
        for (const [key, obj] of this.objects.entries()) {
          if (key.startsWith(prefix)) {
            matching.push(obj)
          }
        }
        // Sort by sha to ensure chunk order
        matching.sort((a, b) => a.sha.localeCompare(b.sha))
        return { toArray: () => matching }
      }

      // Handle object DELETE
      if (query.includes('DELETE FROM objects') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        this.objects.delete(sha)
        return { toArray: () => [] }
      }

      // Handle DELETE for chunked blobs with LIKE pattern
      if (query.includes('DELETE FROM objects') && query.includes('LIKE ?')) {
        const pattern = params[0] as string
        const prefix = pattern.replace(/%$/, '')
        for (const key of this.objects.keys()) {
          if (key.startsWith(prefix)) {
            this.objects.delete(key)
          }
        }
        return { toArray: () => [] }
      }

      // Handle object_index DELETE
      if (query.includes('DELETE FROM object_index') && query.includes('WHERE sha = ?')) {
        const sha = params[0] as string
        this.objectIndex.delete(sha)
        return { toArray: () => [] }
      }

      // Handle BEGIN/COMMIT TRANSACTION
      if (query.includes('BEGIN TRANSACTION') || query.includes('COMMIT') || query.includes('ROLLBACK')) {
        return { toArray: () => [] }
      }

      return { toArray: () => [] }
    }
  }

  // Test helpers
  getObjects(): Map<string, StoredObject> {
    return this.objects
  }

  getObjectIndex(): Map<string, {
    tier: string
    packId: string | null
    offset: number | null
    size: number
    type: string
    updatedAt: number
    chunked?: boolean
    chunkCount?: number
  }> {
    return this.objectIndex
  }

  getWALEntries() {
    return [...this.walEntries]
  }

  getExecutedQueries(): string[] {
    return [...this.executedQueries]
  }

  clearAll(): void {
    this.objects.clear()
    this.objectIndex.clear()
    this.walEntries = []
    this.nextWalId = 1
    this.executedQueries = []
  }

  // Get count of chunk entries
  getChunkCount(sha: string): number {
    let count = 0
    const prefix = `__chunked_blob__${sha}:`
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        count++
      }
    }
    return count
  }
}

describe('ChunkedBlobStorage', () => {
  let storage: MockChunkedStorage
  let objectStore: ObjectStore

  beforeEach(() => {
    storage = new MockChunkedStorage()
    objectStore = new ObjectStore(storage)
  })

  describe('2MB chunking threshold', () => {
    it('should NOT chunk blobs smaller than 2MB', async () => {
      // Create a 1MB blob (well under threshold)
      const smallBlob = new Uint8Array(1 * 1024 * 1024)
      for (let i = 0; i < smallBlob.length; i++) {
        smallBlob[i] = i % 256
      }

      const sha = await objectStore.putObject('blob', smallBlob)

      // Should store as single object (not chunked)
      const objects = storage.getObjects()
      expect(objects.has(sha)).toBe(true)

      // No chunk entries should exist
      const chunkCount = storage.getChunkCount(sha)
      expect(chunkCount).toBe(0)

      // Object index should NOT have chunked flag
      const index = storage.getObjectIndex().get(sha)
      expect(index?.chunked).toBeFalsy()
    })

    it('should NOT chunk blobs exactly at 2MB', async () => {
      // Create exactly 2MB blob (at threshold, not over)
      const exactBlob = new Uint8Array(CHUNK_SIZE)
      for (let i = 0; i < exactBlob.length; i++) {
        exactBlob[i] = i % 256
      }

      const sha = await objectStore.putObject('blob', exactBlob)

      // Should store as single object
      const objects = storage.getObjects()
      expect(objects.has(sha)).toBe(true)

      // No chunk entries
      const chunkCount = storage.getChunkCount(sha)
      expect(chunkCount).toBe(0)
    })

    it('should chunk blobs larger than 2MB', async () => {
      // Create a 5MB blob (should be 3 chunks: 2MB + 2MB + 1MB)
      const largeBlob = new Uint8Array(5 * 1024 * 1024)
      for (let i = 0; i < largeBlob.length; i++) {
        largeBlob[i] = i % 256
      }

      const sha = await objectStore.putObject('blob', largeBlob)

      // Should NOT store full blob under main sha
      const objects = storage.getObjects()
      const mainEntry = objects.get(sha)
      if (mainEntry) {
        // If main entry exists, it should be metadata, not full data
        expect(mainEntry.size).toBeLessThan(largeBlob.length)
      }

      // Should have 3 chunk entries
      const chunkCount = storage.getChunkCount(sha)
      expect(chunkCount).toBe(3)

      // Object index should have chunked flag
      const index = storage.getObjectIndex().get(sha)
      expect(index?.chunked).toBe(true)
      expect(index?.chunkCount).toBe(3)
    })
  })

  describe('storing 5MB blob as 3 chunks', () => {
    it('should split 5MB blob into correct chunk sizes', async () => {
      const size5MB = 5 * 1024 * 1024
      const largeBlob = new Uint8Array(size5MB)
      // Fill with pattern to verify data integrity
      for (let i = 0; i < largeBlob.length; i++) {
        largeBlob[i] = (i * 17) % 256 // Simple pattern
      }

      const sha = await objectStore.putObject('blob', largeBlob)

      // Verify chunk storage pattern
      const objects = storage.getObjects()

      // Chunk 0: 2MB
      const chunk0Key = `__chunked_blob__${sha}:0`
      const chunk0 = objects.get(chunk0Key)
      expect(chunk0).toBeDefined()
      expect(chunk0!.size).toBe(CHUNK_SIZE)

      // Chunk 1: 2MB
      const chunk1Key = `__chunked_blob__${sha}:1`
      const chunk1 = objects.get(chunk1Key)
      expect(chunk1).toBeDefined()
      expect(chunk1!.size).toBe(CHUNK_SIZE)

      // Chunk 2: 1MB (remainder)
      const chunk2Key = `__chunked_blob__${sha}:2`
      const chunk2 = objects.get(chunk2Key)
      expect(chunk2).toBeDefined()
      expect(chunk2!.size).toBe(1 * 1024 * 1024)

      // Total should equal original size
      const totalChunkedSize = chunk0!.size + chunk1!.size + chunk2!.size
      expect(totalChunkedSize).toBe(size5MB)
    })

    it('should preserve data integrity across chunks', async () => {
      const size5MB = 5 * 1024 * 1024
      const largeBlob = new Uint8Array(size5MB)
      // Fill with deterministic pattern
      for (let i = 0; i < largeBlob.length; i++) {
        largeBlob[i] = (i * 17 + 42) % 256
      }

      const sha = await objectStore.putObject('blob', largeBlob)

      // Get chunks
      const objects = storage.getObjects()
      const chunk0 = objects.get(`__chunked_blob__${sha}:0`)!.data
      const chunk1 = objects.get(`__chunked_blob__${sha}:1`)!.data
      const chunk2 = objects.get(`__chunked_blob__${sha}:2`)!.data

      // Spot-check data integrity at boundaries and middle (avoid iterating millions of elements)
      // Chunk 0 first byte
      expect(chunk0[0]).toBe(largeBlob[0])
      // Chunk 0 last byte
      expect(chunk0[CHUNK_SIZE - 1]).toBe(largeBlob[CHUNK_SIZE - 1])
      // Chunk 0 middle
      expect(chunk0[CHUNK_SIZE / 2]).toBe(largeBlob[CHUNK_SIZE / 2])

      // Chunk 1 first byte (should be byte at index 2MB)
      expect(chunk1[0]).toBe(largeBlob[CHUNK_SIZE])
      // Chunk 1 last byte
      expect(chunk1[CHUNK_SIZE - 1]).toBe(largeBlob[2 * CHUNK_SIZE - 1])

      // Chunk 2 first byte (should be byte at index 4MB)
      expect(chunk2[0]).toBe(largeBlob[2 * CHUNK_SIZE])
      // Chunk 2 last byte
      const chunk2Size = 1 * 1024 * 1024
      expect(chunk2[chunk2Size - 1]).toBe(largeBlob[size5MB - 1])
    })
  })

  describe('reading back and reassembling', () => {
    it('should reassemble chunked blob correctly', async () => {
      const size5MB = 5 * 1024 * 1024
      const largeBlob = new Uint8Array(size5MB)
      for (let i = 0; i < largeBlob.length; i++) {
        largeBlob[i] = (i * 13 + 7) % 256
      }

      const sha = await objectStore.putObject('blob', largeBlob)

      // Read back the blob
      const retrieved = await objectStore.getObject(sha)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.type).toBe('blob')
      expect(retrieved!.size).toBe(size5MB)
      expect(retrieved!.data.length).toBe(size5MB)

      // Spot-check data integrity (avoid iterating 5 million elements)
      // First byte
      expect(retrieved!.data[0]).toBe(largeBlob[0])
      // Last byte
      expect(retrieved!.data[size5MB - 1]).toBe(largeBlob[size5MB - 1])
      // Chunk boundaries
      expect(retrieved!.data[CHUNK_SIZE - 1]).toBe(largeBlob[CHUNK_SIZE - 1])
      expect(retrieved!.data[CHUNK_SIZE]).toBe(largeBlob[CHUNK_SIZE])
      expect(retrieved!.data[2 * CHUNK_SIZE - 1]).toBe(largeBlob[2 * CHUNK_SIZE - 1])
      expect(retrieved!.data[2 * CHUNK_SIZE]).toBe(largeBlob[2 * CHUNK_SIZE])
      // Random spots
      expect(retrieved!.data[1234567]).toBe(largeBlob[1234567])
      expect(retrieved!.data[3456789]).toBe(largeBlob[3456789])
    })

    it('should handle getBlobObject for chunked blobs', async () => {
      const size3MB = 3 * 1024 * 1024
      const blob = new Uint8Array(size3MB)
      for (let i = 0; i < blob.length; i++) {
        blob[i] = i % 256
      }

      const sha = await objectStore.putObject('blob', blob)
      const blobObject = await objectStore.getBlobObject(sha)

      expect(blobObject).not.toBeNull()
      expect(blobObject!.type).toBe('blob')
      expect(blobObject!.data.length).toBe(size3MB)
    })

    it('should return correct SHA for reassembled blob', async () => {
      const largeBlob = new Uint8Array(5 * 1024 * 1024)
      for (let i = 0; i < largeBlob.length; i++) {
        largeBlob[i] = i % 256
      }

      const sha = await objectStore.putObject('blob', largeBlob)
      const retrieved = await objectStore.getObject(sha)

      expect(retrieved!.sha).toBe(sha)
    })
  })

  describe('streaming read of chunked blob', () => {
    it('should stream chunked blob in chunks', async () => {
      const size5MB = 5 * 1024 * 1024
      const largeBlob = new Uint8Array(size5MB)
      for (let i = 0; i < largeBlob.length; i++) {
        largeBlob[i] = (i * 11) % 256
      }

      const sha = await objectStore.putObject('blob', largeBlob)

      // Use streaming API
      const result = await objectStore.getBlobStreaming(sha)

      expect(result).not.toBeNull()
      expect(result!.size).toBe(size5MB)

      // Collect all chunks
      const chunks: Uint8Array[] = []
      let totalBytes = 0
      for await (const chunk of result!.chunks) {
        chunks.push(chunk.data)
        totalBytes += chunk.data.length
      }

      expect(totalBytes).toBe(size5MB)

      // Reassemble and spot-check (avoid full iteration)
      const reassembled = new Uint8Array(size5MB)
      let offset = 0
      for (const chunk of chunks) {
        reassembled.set(chunk, offset)
        offset += chunk.length
      }

      // Spot-check boundaries
      expect(reassembled[0]).toBe(largeBlob[0])
      expect(reassembled[size5MB - 1]).toBe(largeBlob[size5MB - 1])
      expect(reassembled[CHUNK_SIZE]).toBe(largeBlob[CHUNK_SIZE])
      expect(reassembled[2 * CHUNK_SIZE]).toBe(largeBlob[2 * CHUNK_SIZE])
    })

    it('should provide correct chunk metadata during streaming', async () => {
      const size5MB = 5 * 1024 * 1024
      const largeBlob = new Uint8Array(size5MB)

      const sha = await objectStore.putObject('blob', largeBlob)
      const result = await objectStore.getBlobStreaming(sha)

      let chunkIndex = 0
      let lastOffset = -1

      for await (const chunk of result!.chunks) {
        expect(chunk.totalSize).toBe(size5MB)
        expect(chunk.offset).toBeGreaterThan(lastOffset)
        lastOffset = chunk.offset

        // Last chunk should have isLast = true
        if (chunk.offset + chunk.data.length >= size5MB) {
          expect(chunk.isLast).toBe(true)
        }
        chunkIndex++
      }

      expect(chunkIndex).toBeGreaterThan(0)
    })
  })

  describe('objects under 2MB remain unchunked', () => {
    it('should store 1.5MB blob as single object', async () => {
      const blob = new Uint8Array(1.5 * 1024 * 1024)
      for (let i = 0; i < blob.length; i++) {
        blob[i] = i % 256
      }

      const sha = await objectStore.putObject('blob', blob)

      // Should be stored directly
      const objects = storage.getObjects()
      expect(objects.has(sha)).toBe(true)
      expect(objects.get(sha)!.size).toBe(blob.length)

      // No chunks
      expect(storage.getChunkCount(sha)).toBe(0)

      // Index should not have chunked flag
      const index = storage.getObjectIndex().get(sha)
      expect(index?.chunked).toBeFalsy()
    })

    it('should store and retrieve 1.9MB blob unchanged', async () => {
      const blobSize = Math.floor(1.9 * 1024 * 1024)
      const blob = new Uint8Array(blobSize)
      for (let i = 0; i < blob.length; i++) {
        blob[i] = (i * 7) % 256
      }

      const sha = await objectStore.putObject('blob', blob)
      const retrieved = await objectStore.getObject(sha)

      expect(retrieved!.data.length).toBe(blob.length)

      // Spot-check instead of full iteration
      expect(retrieved!.data[0]).toBe(blob[0])
      expect(retrieved!.data[blobSize - 1]).toBe(blob[blobSize - 1])
      expect(retrieved!.data[blobSize / 2]).toBe(blob[Math.floor(blobSize / 2)])
      expect(retrieved!.data[100000]).toBe(blob[100000])
    })

    it('should not affect non-blob objects', async () => {
      // Tree objects should never be chunked regardless of size
      // (though trees shouldn't be >2MB in practice)
      const treeContent = encoder.encode('100644 file.txt\0' + 'a'.repeat(40))

      const sha = await objectStore.putObject('tree', treeContent)

      expect(storage.getChunkCount(sha)).toBe(0)
      const index = storage.getObjectIndex().get(sha)
      expect(index?.chunked).toBeFalsy()
    })
  })

  describe('deleting chunked blobs', () => {
    it('should delete all chunks when deleting chunked blob', async () => {
      const largeBlob = new Uint8Array(5 * 1024 * 1024)
      const sha = await objectStore.putObject('blob', largeBlob)

      // Verify chunks exist
      expect(storage.getChunkCount(sha)).toBe(3)

      // Delete the blob
      const deleted = await objectStore.deleteObject(sha)

      expect(deleted).toBe(true)

      // All chunks should be deleted
      expect(storage.getChunkCount(sha)).toBe(0)

      // Object should not be retrievable
      const retrieved = await objectStore.getObject(sha)
      expect(retrieved).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('should handle blob exactly at 2MB + 1 byte', async () => {
      const blob = new Uint8Array(CHUNK_SIZE + 1)
      for (let i = 0; i < blob.length; i++) {
        blob[i] = i % 256
      }

      const sha = await objectStore.putObject('blob', blob)

      // Should be chunked: 2MB + 1 byte
      expect(storage.getChunkCount(sha)).toBe(2)

      const index = storage.getObjectIndex().get(sha)
      expect(index?.chunked).toBe(true)
      expect(index?.chunkCount).toBe(2)

      // Verify retrieval
      const retrieved = await objectStore.getObject(sha)
      expect(retrieved!.data.length).toBe(blob.length)
    })

    it('should handle blob exactly at 4MB (2 full chunks)', async () => {
      const blob = new Uint8Array(4 * 1024 * 1024)
      for (let i = 0; i < blob.length; i++) {
        blob[i] = i % 256
      }

      const sha = await objectStore.putObject('blob', blob)

      expect(storage.getChunkCount(sha)).toBe(2)

      const objects = storage.getObjects()
      const chunk0 = objects.get(`__chunked_blob__${sha}:0`)
      const chunk1 = objects.get(`__chunked_blob__${sha}:1`)

      expect(chunk0!.size).toBe(CHUNK_SIZE)
      expect(chunk1!.size).toBe(CHUNK_SIZE)
    })

    it('should handle empty blob', async () => {
      const emptyBlob = new Uint8Array(0)

      const sha = await objectStore.putObject('blob', emptyBlob)

      // Empty blob should not be chunked
      expect(storage.getChunkCount(sha)).toBe(0)

      const retrieved = await objectStore.getObject(sha)
      expect(retrieved!.data.length).toBe(0)
    })

    it('should produce consistent SHA regardless of chunking', async () => {
      // The SHA should be computed on the full content, not the chunks
      const blob = new Uint8Array(5 * 1024 * 1024)
      for (let i = 0; i < blob.length; i++) {
        blob[i] = 42 // Constant value for reproducibility
      }

      const sha1 = await objectStore.putObject('blob', blob)

      // Clear and store again
      storage.clearAll()
      objectStore = new ObjectStore(storage)

      const sha2 = await objectStore.putObject('blob', blob)

      expect(sha1).toBe(sha2)
    })
  })

  describe('metrics tracking', () => {
    it('should track large blob operations for chunked blobs', async () => {
      const metricStore = new ObjectStore(storage, { enableMetrics: true })
      const largeBlob = new Uint8Array(5 * 1024 * 1024)

      await metricStore.putObject('blob', largeBlob)

      const metrics = metricStore.getMetrics()
      expect(metrics.largeBlobOperations).toBeGreaterThanOrEqual(1)
      expect(metrics.largeBlobBytes).toBeGreaterThanOrEqual(5 * 1024 * 1024)
    })
  })
})
