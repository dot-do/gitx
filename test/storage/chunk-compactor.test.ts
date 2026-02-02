/**
 * @fileoverview Tests for Chunk Compactor
 *
 * Tests the blob chunking compaction functionality for DO storage efficiency.
 *
 * Issue: gitx-512e - [ARCH] Add blob chunking compaction for DO storage efficiency
 *
 * @module test/storage/chunk-compactor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ChunkCompactor,
  createChunkCompactor,
  DEFAULT_COMPACTION_THRESHOLD,
  DEFAULT_MIN_BLOBS_FOR_COMPACTION,
  SUPER_CHUNK_PREFIX,
  COMPACTION_INDEX_PREFIX,
  getSuperChunkKey,
  getSuperChunkMetadataKey,
  getCompactionIndexKey,
  packSuperChunk,
  unpackBlob,
  encodeSuperChunkMetadata,
  decodeSuperChunkMetadata,
  encodeIndexEntry,
  decodeIndexEntry,
  type CompactorStorage,
  type CompactionCandidate,
  type SuperChunkMetadata,
  type CompactionIndexEntry,
} from '../../src/storage/chunk-compactor'
import { CHUNK_SIZE } from '../../src/storage/chunk-utils'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock storage backend for testing.
 */
function createMockStorage(): CompactorStorage & { _data: Map<string, Uint8Array> } {
  const data = new Map<string, Uint8Array>()

  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    put: vi.fn(async (key: string, value: Uint8Array) => {
      data.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      return data.delete(key)
    }),
    has: vi.fn(async (key: string) => data.has(key)),
    list: vi.fn(async (prefix: string) => {
      return Array.from(data.keys()).filter(k => k.startsWith(prefix))
    }),
    _data: data,
  }
}

/**
 * Create test content of a specific size with a verifiable pattern.
 */
function createTestContent(size: number, seed: number = 0): Uint8Array {
  const content = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    content[i] = (i + seed) % 256
  }
  return content
}

/**
 * Compute a simple test SHA for a blob.
 */
async function computeTestSha(content: Uint8Array): Promise<string> {
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
 * Create a test blob candidate.
 */
async function createTestCandidate(
  size: number,
  seed: number = 0,
  type: string = 'blob'
): Promise<CompactionCandidate> {
  const data = createTestContent(size, seed)
  const sha = await computeTestSha(data)
  return { sha, type, data }
}

// ============================================================================
// Tests
// ============================================================================

describe('ChunkCompactor', () => {
  let storage: CompactorStorage & { _data: Map<string, Uint8Array> }
  let compactor: ChunkCompactor

  beforeEach(() => {
    storage = createMockStorage()
    compactor = new ChunkCompactor(storage)
  })

  describe('Constants', () => {
    it('should define DEFAULT_COMPACTION_THRESHOLD as 64KB', () => {
      expect(DEFAULT_COMPACTION_THRESHOLD).toBe(64 * 1024)
    })

    it('should define DEFAULT_MIN_BLOBS_FOR_COMPACTION as 10', () => {
      expect(DEFAULT_MIN_BLOBS_FOR_COMPACTION).toBe(10)
    })

    it('should define SUPER_CHUNK_PREFIX', () => {
      expect(SUPER_CHUNK_PREFIX).toBe('__super_chunk__')
    })

    it('should define COMPACTION_INDEX_PREFIX', () => {
      expect(COMPACTION_INDEX_PREFIX).toBe('__compaction_idx__')
    })
  })

  describe('Key Generation', () => {
    it('should generate super chunk key correctly', () => {
      expect(getSuperChunkKey('abc123')).toBe('__super_chunk__abc123')
    })

    it('should generate super chunk metadata key correctly', () => {
      expect(getSuperChunkMetadataKey('abc123')).toBe('__super_chunk__abc123:meta')
    })

    it('should generate compaction index key correctly', () => {
      expect(getCompactionIndexKey('sha123')).toBe('__compaction_idx__sha123')
    })
  })

  describe('isCompactionCandidate', () => {
    it('should return true for small blobs under threshold', () => {
      expect(compactor.isCompactionCandidate(1024)).toBe(true) // 1KB
      expect(compactor.isCompactionCandidate(32 * 1024)).toBe(true) // 32KB
      expect(compactor.isCompactionCandidate(63 * 1024)).toBe(true) // Just under 64KB
    })

    it('should return false for blobs at or above threshold', () => {
      expect(compactor.isCompactionCandidate(64 * 1024)).toBe(false) // Exactly 64KB
      expect(compactor.isCompactionCandidate(100 * 1024)).toBe(false) // 100KB
      expect(compactor.isCompactionCandidate(1024 * 1024)).toBe(false) // 1MB
    })

    it('should return false for empty blobs', () => {
      expect(compactor.isCompactionCandidate(0)).toBe(false)
    })

    it('should use custom threshold from config', () => {
      const customCompactor = new ChunkCompactor(storage, {
        compactionThreshold: 32 * 1024, // 32KB
      })

      expect(customCompactor.isCompactionCandidate(16 * 1024)).toBe(true)
      expect(customCompactor.isCompactionCandidate(32 * 1024)).toBe(false)
    })
  })

  describe('registerCandidate', () => {
    it('should register small blobs as candidates', async () => {
      const candidate = await createTestCandidate(1024)
      const result = compactor.registerCandidate(candidate)

      expect(result).toBe(true)
      expect(compactor.pendingCandidateCount).toBe(1)
    })

    it('should reject large blobs', async () => {
      const candidate = await createTestCandidate(100 * 1024) // 100KB, above threshold
      const result = compactor.registerCandidate(candidate)

      expect(result).toBe(false)
      expect(compactor.pendingCandidateCount).toBe(0)
    })

    it('should track multiple candidates', async () => {
      for (let i = 0; i < 5; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      expect(compactor.pendingCandidateCount).toBe(5)
    })

    it('should track pending bytes correctly', async () => {
      const candidate1 = await createTestCandidate(1024, 1)
      const candidate2 = await createTestCandidate(2048, 2)

      compactor.registerCandidate(candidate1)
      compactor.registerCandidate(candidate2)

      expect(compactor.pendingCandidateBytes).toBe(1024 + 2048)
    })
  })

  describe('removeCandidate', () => {
    it('should remove a registered candidate', async () => {
      const candidate = await createTestCandidate(1024)
      compactor.registerCandidate(candidate)

      expect(compactor.pendingCandidateCount).toBe(1)

      const removed = compactor.removeCandidate(candidate.sha)

      expect(removed).toBe(true)
      expect(compactor.pendingCandidateCount).toBe(0)
    })

    it('should return false for non-existent candidate', () => {
      const removed = compactor.removeCandidate('nonexistent-sha')
      expect(removed).toBe(false)
    })
  })

  describe('shouldCompact', () => {
    it('should return false when below minimum candidates', async () => {
      for (let i = 0; i < 5; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      expect(compactor.shouldCompact()).toBe(false) // Need 10 by default
    })

    it('should return true when at minimum candidates', async () => {
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      expect(compactor.shouldCompact()).toBe(true)
    })

    it('should use custom minimum from config', async () => {
      const customCompactor = new ChunkCompactor(storage, {
        minBlobsForCompaction: 3,
      })

      for (let i = 0; i < 3; i++) {
        const candidate = await createTestCandidate(1024, i)
        customCompactor.registerCandidate(candidate)
      }

      expect(customCompactor.shouldCompact()).toBe(true)
    })
  })

  describe('compact', () => {
    it('should compact candidates into super-chunks', async () => {
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      const result = await compactor.compact()

      expect(result.blobsCompacted).toBe(10)
      expect(result.superChunksCreated).toBeGreaterThanOrEqual(1)
      expect(result.superChunkIds.length).toBe(result.superChunksCreated)
      expect(compactor.pendingCandidateCount).toBe(0)
    })

    it('should return empty result when no candidates', async () => {
      const result = await compactor.compact()

      expect(result.blobsCompacted).toBe(0)
      expect(result.superChunksCreated).toBe(0)
    })

    it('should track input and output bytes', async () => {
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      const result = await compactor.compact()

      expect(result.inputBytes).toBe(10 * 1024)
      expect(result.outputBytes).toBeGreaterThan(0)
    })

    it('should track duration', async () => {
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      const result = await compactor.compact()

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should throw if compaction already in progress', async () => {
      // Register candidates
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      // Start compaction
      const firstCompaction = compactor.compact()

      // Try to start another
      await expect(compactor.compact()).rejects.toThrow('Compaction already in progress')

      await firstCompaction
    })

    it('should write super-chunk data to storage', async () => {
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      const result = await compactor.compact()

      // Check that super-chunk was written
      expect(result.superChunkIds.length).toBeGreaterThanOrEqual(1)
      for (const id of result.superChunkIds) {
        const key = getSuperChunkKey(id)
        expect(storage._data.has(key)).toBe(true)
      }
    })

    it('should write super-chunk metadata to storage', async () => {
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      const result = await compactor.compact()

      for (const id of result.superChunkIds) {
        const metaKey = getSuperChunkMetadataKey(id)
        expect(storage._data.has(metaKey)).toBe(true)
      }
    })

    it('should write index entries for each blob', async () => {
      const candidates: CompactionCandidate[] = []
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
        candidates.push(candidate)
      }

      await compactor.compact()

      for (const candidate of candidates) {
        const indexKey = getCompactionIndexKey(candidate.sha)
        expect(storage._data.has(indexKey)).toBe(true)
      }
    })

    it('should create multiple super-chunks when data exceeds max size', async () => {
      const customCompactor = new ChunkCompactor(storage, {
        compactionThreshold: 64 * 1024,
        minBlobsForCompaction: 5,
        maxChunkSize: 10 * 1024, // 10KB max per super-chunk
      })

      // Create 5 x 4KB blobs = 20KB total, should need 2+ super-chunks
      for (let i = 0; i < 5; i++) {
        const candidate = await createTestCandidate(4 * 1024, i)
        customCompactor.registerCandidate(candidate)
      }

      const result = await customCompactor.compact()

      expect(result.superChunksCreated).toBeGreaterThanOrEqual(2)
    })
  })

  describe('isCompacted', () => {
    it('should return true for compacted blobs', async () => {
      const candidates: CompactionCandidate[] = []
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
        candidates.push(candidate)
      }

      await compactor.compact()

      for (const candidate of candidates) {
        expect(await compactor.isCompacted(candidate.sha)).toBe(true)
      }
    })

    it('should return false for non-compacted blobs', async () => {
      expect(await compactor.isCompacted('nonexistent-sha')).toBe(false)
    })
  })

  describe('readCompactedBlob', () => {
    it('should read back compacted blob data correctly', async () => {
      const candidates: CompactionCandidate[] = []
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
        candidates.push(candidate)
      }

      await compactor.compact()

      for (const candidate of candidates) {
        const readData = await compactor.readCompactedBlob(candidate.sha)
        expect(readData).not.toBeNull()
        expect(readData).toEqual(candidate.data)
      }
    })

    it('should return null for non-compacted blobs', async () => {
      const result = await compactor.readCompactedBlob('nonexistent-sha')
      expect(result).toBeNull()
    })

    it('should preserve binary data integrity', async () => {
      // Create a blob with all byte values
      const data = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        data[i] = i
      }
      const sha = await computeTestSha(data)
      const candidate: CompactionCandidate = { sha, type: 'blob', data }

      // Need 10 candidates to trigger compaction
      const otherCandidates: CompactionCandidate[] = []
      for (let i = 0; i < 9; i++) {
        const other = await createTestCandidate(1024, i)
        otherCandidates.push(other)
      }

      compactor.registerCandidate(candidate)
      for (const other of otherCandidates) {
        compactor.registerCandidate(other)
      }

      await compactor.compact()

      const readData = await compactor.readCompactedBlob(sha)
      expect(readData).toEqual(data)
    })
  })

  describe('deleteCompactedBlob', () => {
    it('should mark blob as deleted', async () => {
      const candidates: CompactionCandidate[] = []
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
        candidates.push(candidate)
      }

      await compactor.compact()

      const targetSha = candidates[0].sha
      const result = await compactor.deleteCompactedBlob(targetSha)

      expect(result).toBe(true)
      expect(await compactor.isCompacted(targetSha)).toBe(false)
    })

    it('should return false for non-existent blobs', async () => {
      const result = await compactor.deleteCompactedBlob('nonexistent-sha')
      expect(result).toBe(false)
    })

    it('should not affect other blobs in same super-chunk', async () => {
      const candidates: CompactionCandidate[] = []
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
        candidates.push(candidate)
      }

      await compactor.compact()

      // Delete first blob
      await compactor.deleteCompactedBlob(candidates[0].sha)

      // Other blobs should still be accessible
      for (let i = 1; i < candidates.length; i++) {
        const data = await compactor.readCompactedBlob(candidates[i].sha)
        expect(data).toEqual(candidates[i].data)
      }
    })
  })

  describe('getStats', () => {
    it('should return correct stats after compaction', async () => {
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      await compactor.compact()

      const stats = await compactor.getStats()

      expect(stats.compactedBlobCount).toBe(10)
      expect(stats.superChunkCount).toBeGreaterThanOrEqual(1)
      expect(stats.compactedBytes).toBe(10 * 1024)
      expect(stats.pendingCompactionCount).toBe(0)
      expect(stats.pendingCompactionBytes).toBe(0)
    })

    it('should track pending candidates', async () => {
      for (let i = 0; i < 5; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      const stats = await compactor.getStats()

      expect(stats.pendingCompactionCount).toBe(5)
      expect(stats.pendingCompactionBytes).toBe(5 * 1024)
    })
  })

  describe('fullCompaction', () => {
    it('should rewrite all super-chunks', async () => {
      // First compaction
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }
      const firstResult = await compactor.compact()

      // Delete some blobs
      const stats1 = await compactor.getStats()
      const keysToDelete = Array.from(storage._data.keys())
        .filter(k => k.startsWith(COMPACTION_INDEX_PREFIX))
        .slice(0, 3)

      for (const key of keysToDelete) {
        const sha = key.replace(COMPACTION_INDEX_PREFIX, '')
        await compactor.deleteCompactedBlob(sha)
      }

      // Full compaction should reclaim space from deleted blobs
      const fullResult = await compactor.fullCompaction()

      expect(fullResult.blobsCompacted).toBe(7) // 10 - 3 deleted
    })

    it('should include pending candidates', async () => {
      // Initial compaction
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }
      await compactor.compact()

      // Add more candidates
      for (let i = 10; i < 15; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }

      // Full compaction should include new candidates
      const result = await compactor.fullCompaction()

      expect(result.blobsCompacted).toBe(15) // 10 original + 5 new
      expect(compactor.pendingCandidateCount).toBe(0)
    })

    it('should handle empty compaction gracefully', async () => {
      const result = await compactor.fullCompaction()

      expect(result.blobsCompacted).toBe(0)
      expect(result.superChunksCreated).toBe(0)
    })
  })

  describe('createChunkCompactor factory', () => {
    it('should create a ChunkCompactor instance', () => {
      const instance = createChunkCompactor(storage)
      expect(instance).toBeInstanceOf(ChunkCompactor)
    })

    it('should pass config to instance', () => {
      const instance = createChunkCompactor(storage, {
        compactionThreshold: 32 * 1024,
        minBlobsForCompaction: 5,
      })

      const config = instance.getConfig()
      expect(config.compactionThreshold).toBe(32 * 1024)
      expect(config.minBlobsForCompaction).toBe(5)
    })
  })

  describe('Encoding/Decoding', () => {
    describe('SuperChunkMetadata', () => {
      it('should encode and decode metadata correctly', () => {
        const metadata: SuperChunkMetadata = {
          id: 'test-id-123',
          totalSize: 10240,
          blobCount: 5,
          blobShas: ['sha1', 'sha2', 'sha3', 'sha4', 'sha5'],
          createdAt: 1234567890,
        }

        const encoded = encodeSuperChunkMetadata(metadata)
        const decoded = decodeSuperChunkMetadata(encoded)

        expect(decoded).toEqual(metadata)
      })
    })

    describe('IndexEntry', () => {
      it('should encode and decode index entry correctly', () => {
        const entry: CompactionIndexEntry = {
          sha: 'abc123def456',
          superChunkId: 'chunk-001',
          offset: 1024,
          size: 512,
          type: 'blob',
        }

        const encoded = encodeIndexEntry(entry)
        const decoded = decodeIndexEntry(encoded)

        expect(decoded).toEqual(entry)
      })
    })
  })

  describe('packSuperChunk and unpackBlob', () => {
    it('should pack and unpack blobs correctly', async () => {
      const candidates: CompactionCandidate[] = []
      for (let i = 0; i < 5; i++) {
        candidates.push(await createTestCandidate(1024, i))
      }

      const { data, metadata, entries } = packSuperChunk(candidates)

      expect(metadata.blobCount).toBe(5)
      expect(entries.length).toBe(5)

      // Unpack each blob and verify
      for (let i = 0; i < candidates.length; i++) {
        const unpacked = unpackBlob(data, entries[i])
        expect(unpacked).toEqual(candidates[i].data)
      }
    })

    it('should preserve blob order in metadata', async () => {
      const candidates: CompactionCandidate[] = []
      for (let i = 0; i < 3; i++) {
        candidates.push(await createTestCandidate(1024, i))
      }

      const { metadata } = packSuperChunk(candidates)

      expect(metadata.blobShas).toEqual(candidates.map(c => c.sha))
    })
  })

  describe('Edge Cases', () => {
    it('should handle very small blobs', async () => {
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(10, i) // 10 bytes each
        compactor.registerCandidate(candidate)
      }

      const result = await compactor.compact()

      expect(result.blobsCompacted).toBe(10)

      // Verify each blob can be read back
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(10, i)
        const data = await compactor.readCompactedBlob(candidate.sha)
        expect(data).toEqual(candidate.data)
      }
    })

    it('should handle blobs near threshold boundary', async () => {
      // Just under threshold
      const smallCandidate = await createTestCandidate(
        DEFAULT_COMPACTION_THRESHOLD - 1,
        1
      )
      expect(compactor.registerCandidate(smallCandidate)).toBe(true)

      // At threshold (should be rejected)
      const atThreshold = await createTestCandidate(DEFAULT_COMPACTION_THRESHOLD, 2)
      expect(compactor.registerCandidate(atThreshold)).toBe(false)
    })

    it('should handle concurrent reads of same compacted blob', async () => {
      for (let i = 0; i < 10; i++) {
        const candidate = await createTestCandidate(1024, i)
        compactor.registerCandidate(candidate)
      }
      await compactor.compact()

      const candidate = await createTestCandidate(1024, 0)

      // Read same blob concurrently
      const reads = await Promise.all([
        compactor.readCompactedBlob(candidate.sha),
        compactor.readCompactedBlob(candidate.sha),
        compactor.readCompactedBlob(candidate.sha),
      ])

      for (const data of reads) {
        expect(data).toEqual(candidate.data)
      }
    })
  })
})
