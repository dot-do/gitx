/**
 * @fileoverview RED Phase Tests for 2MB BLOB Chunking
 *
 * These tests define the expected behavior for 2MB BLOB chunking in gitx
 * for cost-optimized DO SQLite storage.
 *
 * Key insight: DO SQLite pricing is per-row read/write, NOT by size.
 * By storing large blobs in 2MB chunks, we minimize row operations:
 * - A 10MB git blob stored in 2MB chunks = 5 row operations
 * - Without chunking (1KB rows) = ~10,000 row operations
 * - Cost reduction: ~2000x fewer billable operations
 *
 * Tests cover:
 * 1. Large blob splits into 2MB chunks
 * 2. Chunk keys follow pattern: `{oid}:chunk:{n}`
 * 3. Read reassembles chunks in order
 * 4. Partial/range reads work across chunk boundaries
 * 5. Delete removes all chunks
 * 6. Chunk metadata tracked (count, total size)
 * 7. Small blobs (< 2MB) stored as single chunk
 * 8. Exactly 2MB blob edge case
 *
 * All tests should FAIL initially (RED phase TDD).
 *
 * Issue: gitx-rb09 - [RED] 2MB BLOB chunking for hot tier tests
 *
 * @module test/storage/chunked-blob
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { ObjectType } from '../../src/types/objects'
import { createChunkedBlobStorage, CHUNK_SIZE as IMPL_CHUNK_SIZE, CHUNKED_BLOB_PREFIX as IMPL_CHUNKED_BLOB_PREFIX } from '../../src/storage/chunked-blob'

// ============================================================================
// Constants
// ============================================================================

/**
 * Chunk size for blob storage (2MB).
 * DO SQLite charges per row read/write, not per-byte.
 */
const CHUNK_SIZE = 2 * 1024 * 1024 // 2MB

/**
 * Prefix for chunked blob storage keys.
 */
const CHUNKED_BLOB_PREFIX = '__chunked_blob__'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Helper function to compute expected SHA-1 hash for a blob.
 * Git format: "blob {size}\0{content}"
 */
async function computeBlobSha(content: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${content.length}\0`)
  const data = new Uint8Array(header.length + content.length)
  data.set(header)
  data.set(content, header.length)
  const hashBuffer = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Helper to create test content of a specific size with verifiable pattern.
 * @param size - Size in bytes
 * @param seed - Pattern seed for verification
 */
function createTestContent(size: number, seed: number = 0): Uint8Array {
  const content = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    content[i] = (i + seed) % 256
  }
  return content
}

// ============================================================================
// ChunkedBlobStorage Interface
// ============================================================================

/**
 * Interface for chunked blob storage operations.
 * This is the interface that needs to be implemented.
 */
interface ChunkedBlobStorage {
  /**
   * Write a blob, automatically chunking if >= CHUNK_SIZE.
   * @param data - Blob data to store
   * @returns Write result with SHA and chunk metadata
   */
  writeBlob(data: Uint8Array): Promise<ChunkedWriteResult>

  /**
   * Read a complete blob, reassembling from chunks if needed.
   * @param sha - The blob's SHA-1 hash
   * @returns Blob data or null if not found
   */
  readBlob(sha: string): Promise<Uint8Array | null>

  /**
   * Read a range of bytes from a blob.
   * Efficiently reads only the chunks needed to satisfy the range.
   * @param sha - The blob's SHA-1 hash
   * @param offset - Start byte offset
   * @param length - Number of bytes to read
   * @returns Range data or null if blob not found
   */
  readRange(sha: string, offset: number, length: number): Promise<Uint8Array | null>

  /**
   * Delete a blob and all its chunks.
   * @param sha - The blob's SHA-1 hash
   * @returns true if deleted, false if not found
   */
  deleteBlob(sha: string): Promise<boolean>

  /**
   * Check if a blob exists.
   * @param sha - The blob's SHA-1 hash
   */
  hasBlob(sha: string): Promise<boolean>

  /**
   * Get metadata for a blob.
   * @param sha - The blob's SHA-1 hash
   */
  getMetadata(sha: string): Promise<ChunkMetadata | null>

  /**
   * Get all chunk keys for a blob (for testing/debugging).
   * @param sha - The blob's SHA-1 hash
   */
  getChunkKeys(sha: string): Promise<string[]>
}

/**
 * Result of a chunked write operation.
 */
interface ChunkedWriteResult {
  /** 40-character SHA-1 hash */
  sha: string
  /** Total size in bytes */
  size: number
  /** Number of chunks created */
  chunkCount: number
  /** Array of chunk keys */
  chunkKeys: string[]
  /** Whether the blob was chunked */
  isChunked: boolean
}

/**
 * Metadata for a chunked blob.
 */
interface ChunkMetadata {
  /** 40-character SHA-1 hash */
  sha: string
  /** Total size in bytes */
  totalSize: number
  /** Number of chunks */
  chunkCount: number
  /** Whether the blob is chunked (size >= CHUNK_SIZE) */
  isChunked: boolean
  /** Chunk keys for the blob */
  chunkKeys: string[]
}

// ============================================================================
// Mock Implementation (Minimal - Tests Should Fail)
// ============================================================================

/**
 * Mock implementation that returns NOT_IMPLEMENTED errors.
 * This ensures all tests fail in the RED phase.
 */
class MockChunkedBlobStorage implements ChunkedBlobStorage {
  async writeBlob(_data: Uint8Array): Promise<ChunkedWriteResult> {
    throw new Error('NOT_IMPLEMENTED: writeBlob')
  }

  async readBlob(_sha: string): Promise<Uint8Array | null> {
    throw new Error('NOT_IMPLEMENTED: readBlob')
  }

  async readRange(_sha: string, _offset: number, _length: number): Promise<Uint8Array | null> {
    throw new Error('NOT_IMPLEMENTED: readRange')
  }

  async deleteBlob(_sha: string): Promise<boolean> {
    throw new Error('NOT_IMPLEMENTED: deleteBlob')
  }

  async hasBlob(_sha: string): Promise<boolean> {
    throw new Error('NOT_IMPLEMENTED: hasBlob')
  }

  async getMetadata(_sha: string): Promise<ChunkMetadata | null> {
    throw new Error('NOT_IMPLEMENTED: getMetadata')
  }

  async getChunkKeys(_sha: string): Promise<string[]> {
    throw new Error('NOT_IMPLEMENTED: getChunkKeys')
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ChunkedBlobStorage', () => {
  let storage: ChunkedBlobStorage

  beforeEach(() => {
    storage = createChunkedBlobStorage()
  })

  describe('constants', () => {
    it('should define CHUNK_SIZE as 2MB', () => {
      expect(CHUNK_SIZE).toBe(2 * 1024 * 1024)
      expect(IMPL_CHUNK_SIZE).toBe(2 * 1024 * 1024)
    })

    it('should define CHUNKED_BLOB_PREFIX', () => {
      expect(CHUNKED_BLOB_PREFIX).toBe('__chunked_blob__')
      expect(IMPL_CHUNKED_BLOB_PREFIX).toBe('__chunked_blob__')
    })
  })

  describe('small blobs (< 2MB)', () => {
    it('should store small blob as single chunk', async () => {
      const data = createTestContent(1024) // 1KB
      const result = await storage.writeBlob(data)

      expect(result.chunkCount).toBe(1)
      expect(result.isChunked).toBe(false)
      expect(result.size).toBe(1024)
    })

    it('should store 1MB blob as single chunk', async () => {
      const data = createTestContent(1024 * 1024) // 1MB
      const result = await storage.writeBlob(data)

      expect(result.chunkCount).toBe(1)
      expect(result.isChunked).toBe(false)
    })

    it('should read back small blob correctly', async () => {
      const data = createTestContent(1024)
      const result = await storage.writeBlob(data)
      const readData = await storage.readBlob(result.sha)

      expect(readData).not.toBeNull()
      expect(readData).toEqual(data)
    })

    it('should have correct SHA for small blob', async () => {
      const data = createTestContent(1024)
      const expectedSha = await computeBlobSha(data)
      const result = await storage.writeBlob(data)

      expect(result.sha).toBe(expectedSha)
    })
  })

  describe('exactly 2MB blob (edge case)', () => {
    it('should store exactly 2MB blob as single chunk', async () => {
      const data = createTestContent(CHUNK_SIZE) // Exactly 2MB
      const result = await storage.writeBlob(data)

      // Exactly 2MB should be stored as a single chunk (not chunked)
      expect(result.chunkCount).toBe(1)
      expect(result.isChunked).toBe(false)
      expect(result.size).toBe(CHUNK_SIZE)
    })

    it('should read back exactly 2MB blob correctly', async () => {
      const data = createTestContent(CHUNK_SIZE)
      const result = await storage.writeBlob(data)
      const readData = await storage.readBlob(result.sha)

      expect(readData).not.toBeNull()
      expect(readData!.length).toBe(CHUNK_SIZE)
      expect(readData).toEqual(data)
    })
  })

  describe('large blob chunking (> 2MB)', () => {
    it('should chunk 2MB + 1 byte blob into 2 chunks', async () => {
      const data = createTestContent(CHUNK_SIZE + 1) // 2MB + 1 byte
      const result = await storage.writeBlob(data)

      expect(result.chunkCount).toBe(2)
      expect(result.isChunked).toBe(true)
      expect(result.size).toBe(CHUNK_SIZE + 1)
    })

    it('should chunk 4MB blob into exactly 2 chunks', async () => {
      const data = createTestContent(4 * 1024 * 1024) // 4MB
      const result = await storage.writeBlob(data)

      expect(result.chunkCount).toBe(2)
      expect(result.isChunked).toBe(true)
    })

    it('should chunk 5MB blob into 3 chunks', async () => {
      const data = createTestContent(5 * 1024 * 1024) // 5MB
      const result = await storage.writeBlob(data)

      // 5MB / 2MB = 2.5, rounds up to 3 chunks
      expect(result.chunkCount).toBe(3)
      expect(result.isChunked).toBe(true)
    })

    it('should chunk 10MB blob into 5 chunks', async () => {
      const data = createTestContent(10 * 1024 * 1024) // 10MB
      const result = await storage.writeBlob(data)

      expect(result.chunkCount).toBe(5)
      expect(result.isChunked).toBe(true)
    })

    it('should read back large blob correctly by reassembling chunks', async () => {
      const data = createTestContent(5 * 1024 * 1024) // 5MB
      const result = await storage.writeBlob(data)
      const readData = await storage.readBlob(result.sha)

      expect(readData).not.toBeNull()
      expect(readData!.length).toBe(5 * 1024 * 1024)
      expect(readData).toEqual(data)
    })

    it('should preserve data integrity across chunks', async () => {
      // Create data with a specific pattern that spans chunk boundaries
      const data = createTestContent(5 * 1024 * 1024, 42) // 5MB with seed 42
      const result = await storage.writeBlob(data)
      const readData = await storage.readBlob(result.sha)

      // Verify data at key positions across chunk boundaries
      expect(readData).not.toBeNull()

      // Start of first chunk
      expect(readData![0]).toBe((0 + 42) % 256)

      // End of first chunk
      expect(readData![CHUNK_SIZE - 1]).toBe((CHUNK_SIZE - 1 + 42) % 256)

      // Start of second chunk (exactly at 2MB boundary)
      expect(readData![CHUNK_SIZE]).toBe((CHUNK_SIZE + 42) % 256)

      // Middle of second chunk
      expect(readData![CHUNK_SIZE + 1000]).toBe((CHUNK_SIZE + 1000 + 42) % 256)

      // End of data
      expect(readData![5 * 1024 * 1024 - 1]).toBe((5 * 1024 * 1024 - 1 + 42) % 256)
    })
  })

  describe('chunk key pattern', () => {
    it('should generate chunk keys following pattern: {oid}:chunk:{n}', async () => {
      const data = createTestContent(5 * 1024 * 1024) // 5MB = 3 chunks
      const result = await storage.writeBlob(data)

      expect(result.chunkKeys).toHaveLength(3)
      expect(result.chunkKeys[0]).toBe(`${result.sha}:chunk:0`)
      expect(result.chunkKeys[1]).toBe(`${result.sha}:chunk:1`)
      expect(result.chunkKeys[2]).toBe(`${result.sha}:chunk:2`)
    })

    it('should return chunk keys via getChunkKeys', async () => {
      const data = createTestContent(5 * 1024 * 1024)
      const result = await storage.writeBlob(data)
      const chunkKeys = await storage.getChunkKeys(result.sha)

      expect(chunkKeys).toEqual(result.chunkKeys)
    })

    it('should return empty array for non-chunked blobs', async () => {
      const data = createTestContent(1024) // 1KB, not chunked
      const result = await storage.writeBlob(data)
      const chunkKeys = await storage.getChunkKeys(result.sha)

      // Non-chunked blobs have no chunk keys (stored directly)
      expect(chunkKeys).toEqual([])
    })

    it('should return empty array for non-existent blob', async () => {
      const chunkKeys = await storage.getChunkKeys('nonexistent-sha')
      expect(chunkKeys).toEqual([])
    })
  })

  describe('range reads across chunk boundaries', () => {
    it('should read range within first chunk', async () => {
      const data = createTestContent(5 * 1024 * 1024, 10) // 5MB
      const result = await storage.writeBlob(data)

      // Read first 100 bytes
      const rangeData = await storage.readRange(result.sha, 0, 100)

      expect(rangeData).not.toBeNull()
      expect(rangeData!.length).toBe(100)
      expect(rangeData).toEqual(data.slice(0, 100))
    })

    it('should read range within second chunk', async () => {
      const data = createTestContent(5 * 1024 * 1024, 20)
      const result = await storage.writeBlob(data)

      // Read 100 bytes starting at 3MB (in second chunk)
      const offset = 3 * 1024 * 1024
      const rangeData = await storage.readRange(result.sha, offset, 100)

      expect(rangeData).not.toBeNull()
      expect(rangeData!.length).toBe(100)
      expect(rangeData).toEqual(data.slice(offset, offset + 100))
    })

    it('should read range spanning chunk boundary', async () => {
      const data = createTestContent(5 * 1024 * 1024, 30)
      const result = await storage.writeBlob(data)

      // Read 1MB starting 512KB before chunk boundary (at 1.5MB to 2.5MB)
      const offset = CHUNK_SIZE - 512 * 1024 // 512KB before 2MB boundary
      const length = 1024 * 1024 // 1MB (spans into second chunk)
      const rangeData = await storage.readRange(result.sha, offset, length)

      expect(rangeData).not.toBeNull()
      expect(rangeData!.length).toBe(length)
      expect(rangeData).toEqual(data.slice(offset, offset + length))
    })

    it('should read range spanning multiple chunk boundaries', async () => {
      const data = createTestContent(10 * 1024 * 1024, 40) // 10MB = 5 chunks
      const result = await storage.writeBlob(data)

      // Read 5MB starting at 1MB (spans chunks 0, 1, 2, 3)
      const offset = 1 * 1024 * 1024
      const length = 5 * 1024 * 1024
      const rangeData = await storage.readRange(result.sha, offset, length)

      expect(rangeData).not.toBeNull()
      expect(rangeData!.length).toBe(length)
      expect(rangeData).toEqual(data.slice(offset, offset + length))
    })

    it('should read range at exact chunk boundary', async () => {
      const data = createTestContent(5 * 1024 * 1024, 50)
      const result = await storage.writeBlob(data)

      // Read exactly at 2MB boundary
      const offset = CHUNK_SIZE
      const length = 100
      const rangeData = await storage.readRange(result.sha, offset, length)

      expect(rangeData).not.toBeNull()
      expect(rangeData!.length).toBe(length)
      expect(rangeData).toEqual(data.slice(offset, offset + length))
    })

    it('should throw for out of bounds range read', async () => {
      const data = createTestContent(1024) // 1KB
      const result = await storage.writeBlob(data)

      await expect(
        storage.readRange(result.sha, 2000, 100) // Beyond end of blob
      ).rejects.toThrow()
    })

    it('should return null for range read on non-existent blob', async () => {
      const rangeData = await storage.readRange('nonexistent-sha', 0, 100)
      expect(rangeData).toBeNull()
    })
  })

  describe('delete removes all chunks', () => {
    it('should delete all chunks for a large blob', async () => {
      const data = createTestContent(5 * 1024 * 1024) // 5MB = 3 chunks
      const result = await storage.writeBlob(data)

      // Verify blob exists
      expect(await storage.hasBlob(result.sha)).toBe(true)

      // Delete the blob
      const deleted = await storage.deleteBlob(result.sha)
      expect(deleted).toBe(true)

      // Verify blob is gone
      expect(await storage.hasBlob(result.sha)).toBe(false)

      // Verify read returns null
      const readData = await storage.readBlob(result.sha)
      expect(readData).toBeNull()
    })

    it('should delete small blob correctly', async () => {
      const data = createTestContent(1024) // 1KB
      const result = await storage.writeBlob(data)

      const deleted = await storage.deleteBlob(result.sha)
      expect(deleted).toBe(true)

      expect(await storage.hasBlob(result.sha)).toBe(false)
    })

    it('should return false when deleting non-existent blob', async () => {
      const deleted = await storage.deleteBlob('nonexistent-sha')
      expect(deleted).toBe(false)
    })

    it('should return empty chunk keys after delete', async () => {
      const data = createTestContent(5 * 1024 * 1024)
      const result = await storage.writeBlob(data)

      await storage.deleteBlob(result.sha)

      const chunkKeys = await storage.getChunkKeys(result.sha)
      expect(chunkKeys).toEqual([])
    })
  })

  describe('chunk metadata tracking', () => {
    it('should track metadata for chunked blob', async () => {
      const data = createTestContent(5 * 1024 * 1024) // 5MB = 3 chunks
      const result = await storage.writeBlob(data)
      const metadata = await storage.getMetadata(result.sha)

      expect(metadata).not.toBeNull()
      expect(metadata!.sha).toBe(result.sha)
      expect(metadata!.totalSize).toBe(5 * 1024 * 1024)
      expect(metadata!.chunkCount).toBe(3)
      expect(metadata!.isChunked).toBe(true)
      expect(metadata!.chunkKeys).toHaveLength(3)
    })

    it('should track metadata for non-chunked blob', async () => {
      const data = createTestContent(1024) // 1KB
      const result = await storage.writeBlob(data)
      const metadata = await storage.getMetadata(result.sha)

      expect(metadata).not.toBeNull()
      expect(metadata!.sha).toBe(result.sha)
      expect(metadata!.totalSize).toBe(1024)
      expect(metadata!.chunkCount).toBe(1)
      expect(metadata!.isChunked).toBe(false)
      expect(metadata!.chunkKeys).toEqual([])
    })

    it('should return null metadata for non-existent blob', async () => {
      const metadata = await storage.getMetadata('nonexistent-sha')
      expect(metadata).toBeNull()
    })
  })

  describe('hasBlob', () => {
    it('should return true for existing chunked blob', async () => {
      const data = createTestContent(5 * 1024 * 1024)
      const result = await storage.writeBlob(data)

      expect(await storage.hasBlob(result.sha)).toBe(true)
    })

    it('should return true for existing non-chunked blob', async () => {
      const data = createTestContent(1024)
      const result = await storage.writeBlob(data)

      expect(await storage.hasBlob(result.sha)).toBe(true)
    })

    it('should return false for non-existent blob', async () => {
      expect(await storage.hasBlob('nonexistent-sha')).toBe(false)
    })
  })

  describe('empty blob', () => {
    it('should handle empty blob correctly', async () => {
      const data = new Uint8Array(0)
      const result = await storage.writeBlob(data)

      expect(result.size).toBe(0)
      expect(result.chunkCount).toBe(0)
      expect(result.isChunked).toBe(false)

      const readData = await storage.readBlob(result.sha)
      expect(readData).not.toBeNull()
      expect(readData!.length).toBe(0)
    })
  })

  describe('deduplication', () => {
    it('should return same SHA for identical content', async () => {
      const data = createTestContent(5 * 1024 * 1024, 100)

      const result1 = await storage.writeBlob(data)
      const result2 = await storage.writeBlob(data)

      expect(result1.sha).toBe(result2.sha)
    })

    it('should compute correct SHA regardless of chunking', async () => {
      const data = createTestContent(5 * 1024 * 1024)
      const expectedSha = await computeBlobSha(data)
      const result = await storage.writeBlob(data)

      // SHA should be computed from the full content, not per-chunk
      expect(result.sha).toBe(expectedSha)
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent writes to different blobs', async () => {
      const data1 = createTestContent(3 * 1024 * 1024, 1) // 3MB
      const data2 = createTestContent(3 * 1024 * 1024, 2) // 3MB

      // Write concurrently
      const [result1, result2] = await Promise.all([
        storage.writeBlob(data1),
        storage.writeBlob(data2),
      ])

      // Verify both were stored correctly
      const readData1 = await storage.readBlob(result1.sha)
      const readData2 = await storage.readBlob(result2.sha)

      expect(readData1).toEqual(data1)
      expect(readData2).toEqual(data2)
    })

    it('should handle concurrent reads of same blob', async () => {
      const data = createTestContent(5 * 1024 * 1024)
      const result = await storage.writeBlob(data)

      // Read concurrently
      const [read1, read2, read3] = await Promise.all([
        storage.readBlob(result.sha),
        storage.readBlob(result.sha),
        storage.readBlob(result.sha),
      ])

      expect(read1).toEqual(data)
      expect(read2).toEqual(data)
      expect(read3).toEqual(data)
    })
  })

  describe('binary data handling', () => {
    it('should handle binary data with all byte values', async () => {
      // Create data with all possible byte values repeated
      const data = new Uint8Array(256 * 10000) // 2.56MB (will be chunked)
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256
      }

      const result = await storage.writeBlob(data)
      const readData = await storage.readBlob(result.sha)

      expect(readData).toEqual(data)
    })

    it('should handle binary data with null bytes', async () => {
      const data = new Uint8Array(CHUNK_SIZE + 1000)
      // Fill with null bytes
      data.fill(0)
      // Add some non-null bytes at boundaries
      data[0] = 0xFF
      data[CHUNK_SIZE - 1] = 0xAA
      data[CHUNK_SIZE] = 0xBB
      data[data.length - 1] = 0xCC

      const result = await storage.writeBlob(data)
      const readData = await storage.readBlob(result.sha)

      expect(readData).toEqual(data)
      expect(readData![0]).toBe(0xFF)
      expect(readData![CHUNK_SIZE - 1]).toBe(0xAA)
      expect(readData![CHUNK_SIZE]).toBe(0xBB)
      expect(readData![data.length - 1]).toBe(0xCC)
    })
  })
})
