import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ParquetStore } from '../../src/storage/parquet-store'
import { RefLog } from '../../src/delta/ref-log'
import { parquetReadObjects } from 'hyparquet'
import type { DurableObjectStorage } from '../../src/do/schema'

// ============================================================================
// Mock Factories (same patterns as parquet-store.test.ts)
// ============================================================================

function createMockR2(): R2Bucket {
  const store = new Map<string, ArrayBuffer>()

  return {
    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string) => {
      if (value instanceof Uint8Array) {
        store.set(key, value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
      } else if (value instanceof ArrayBuffer) {
        store.set(key, value)
      }
      return {} as R2Object
    }),
    get: vi.fn(async (key: string) => {
      const data = store.get(key)
      if (!data) return null
      return {
        arrayBuffer: async () => data,
        body: new ReadableStream(),
        bodyUsed: false,
        key,
        version: '1',
        size: data.byteLength,
        etag: 'test',
        httpEtag: '"test"',
        checksums: {},
        uploaded: new Date(),
        httpMetadata: {},
        customMetadata: {},
        writeHttpMetadata: vi.fn(),
        storageClass: 'Standard' as const,
        range: undefined,
        blob: vi.fn(),
        text: vi.fn(),
        json: vi.fn(),
      } as unknown as R2ObjectBody
    }),
    list: vi.fn(async () => ({
      objects: [] as R2Object[],
      truncated: false,
      cursor: undefined,
      delimitedPrefixes: [],
    })),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    head: vi.fn(async () => null),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket
}

function createMockStorage(): DurableObjectStorage {
  return {
    sql: {
      exec: vi.fn((_query: string, ..._params: unknown[]) => {
        return { toArray: () => [] }
      }),
    },
  }
}

// ============================================================================
// Helper: read Parquet file from mock R2
// ============================================================================

async function readParquetFromR2(
  mockR2: R2Bucket,
  key: string,
  columns: string[],
): Promise<Record<string, unknown>[]> {
  const r2Obj = await mockR2.get(key)
  if (!r2Obj) throw new Error(`No R2 object at key: ${key}`)
  const buf = await r2Obj.arrayBuffer()
  const file = {
    byteLength: buf.byteLength,
    slice: (s: number, e?: number) => buf.slice(s, e),
  }
  return parquetReadObjects({ file, columns, rowFormat: 'object' })
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ============================================================================
// Integration Tests: Full Parquet Flow
// ============================================================================

describe('Integration: Parquet Flow', () => {
  let store: ParquetStore
  let mockR2: R2Bucket
  let mockStorage: DurableObjectStorage

  beforeEach(() => {
    mockR2 = createMockR2()
    mockStorage = createMockStorage()
    store = new ParquetStore({
      r2: mockR2,
      sql: mockStorage,
      prefix: 'integration-test',
    })
  })

  // --------------------------------------------------------------------------
  // Full write-read cycle
  // --------------------------------------------------------------------------

  describe('Full write-read cycle', () => {
    it('should write blob, commit, tree objects, flush to Parquet, and read back from Parquet', async () => {
      const blobData = encoder.encode('hello world')
      const treeData = encoder.encode('tree content placeholder')
      const commitData = encoder.encode(
        'tree ' + 'a'.repeat(40) + '\n' +
        'author Bob <bob@test.com> 1700000000 +0000\n' +
        'committer Bob <bob@test.com> 1700000000 +0000\n' +
        '\n' +
        'Test commit message',
      )

      // Put all three object types
      const blobSha = await store.putObject('blob', blobData)
      const treeSha = await store.putObject('tree', treeData)
      const commitSha = await store.putObject('commit', commitData)

      // Verify objects are in the buffer
      expect(store.getStats().bufferedObjects).toBe(3)

      // Flush to Parquet on R2
      const key = await store.flush()
      expect(key).not.toBeNull()

      // Buffer should be empty after flush
      expect(store.getStats().bufferedObjects).toBe(0)
      expect(store.getStats().parquetFiles).toBe(1)

      // Read back from Parquet (no longer in buffer)
      const blobResult = await store.getObject(blobSha)
      expect(blobResult).not.toBeNull()
      expect(blobResult!.type).toBe('blob')
      expect(decoder.decode(blobResult!.content)).toBe('hello world')

      const treeResult = await store.getObject(treeSha)
      expect(treeResult).not.toBeNull()
      expect(treeResult!.type).toBe('tree')
      expect(decoder.decode(treeResult!.content)).toBe('tree content placeholder')

      const commitResult = await store.getObject(commitSha)
      expect(commitResult).not.toBeNull()
      expect(commitResult!.type).toBe('commit')
      expect(decoder.decode(commitResult!.content)).toContain('Test commit message')
    })

    it('should confirm hasObject returns true for flushed objects', async () => {
      const data = encoder.encode('existence check')
      const sha = await store.putObject('blob', data)
      await store.flush()

      const exists = await store.hasObject(sha)
      expect(exists).toBe(true)
    })

    it('should return null for objects that were never stored', async () => {
      const data = encoder.encode('some content')
      await store.putObject('blob', data)
      await store.flush()

      const result = await store.getObject('0'.repeat(40))
      expect(result).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // Multi-flush compaction
  // --------------------------------------------------------------------------

  describe('Multi-flush compaction', () => {
    it('should putObject, flush, putObject, flush, compact, and verify all objects readable', async () => {
      // First batch
      const data1 = encoder.encode('first batch object')
      const sha1 = await store.putObject('blob', data1)
      await store.flush()

      // Second batch
      const data2 = encoder.encode('second batch object')
      const sha2 = await store.putObject('tree', data2)
      await store.flush()

      // Third batch
      const data3 = encoder.encode('third batch object')
      const sha3 = await store.putObject('commit', encoder.encode(
        'tree ' + 'b'.repeat(40) + '\n' +
        'author Alice <alice@test.com> 1700000000 +0000\n' +
        'committer Alice <alice@test.com> 1700000000 +0000\n' +
        '\n' +
        'third batch object',
      ))
      await store.flush()

      expect(store.getStats().parquetFiles).toBe(3)

      // Compact all files into one
      const compactedKey = await store.compact()
      expect(compactedKey).not.toBeNull()
      expect(store.getStats().parquetFiles).toBe(1)

      // Verify all objects are still readable after compaction
      const result1 = await store.getObject(sha1)
      expect(result1).not.toBeNull()
      expect(result1!.type).toBe('blob')
      expect(decoder.decode(result1!.content)).toBe('first batch object')

      const result2 = await store.getObject(sha2)
      expect(result2).not.toBeNull()
      expect(result2!.type).toBe('tree')
    })

    it('should deduplicate objects across files during compaction', async () => {
      const data = encoder.encode('duplicate content across flushes')

      // Write same object in two different flushes
      const sha = await store.putObject('blob', data)
      await store.flush()

      await store.putObject('blob', data)
      await store.flush()

      expect(store.getStats().parquetFiles).toBe(2)

      const compactedKey = await store.compact()
      expect(compactedKey).not.toBeNull()

      // Verify only one row for this SHA in the compacted file
      const rows = await readParquetFromR2(mockR2, compactedKey!, ['sha'])
      const matching = rows.filter(r => r.sha === sha)
      expect(matching.length).toBe(1)

      // Verify object is still readable
      const result = await store.getObject(sha)
      expect(result).not.toBeNull()
      expect(decoder.decode(result!.content)).toBe('duplicate content across flushes')
    })
  })

  // --------------------------------------------------------------------------
  // Storage mode routing
  // --------------------------------------------------------------------------

  describe('Storage mode routing', () => {
    it('should handle small blob (inline) and large blob (r2) and retrieve both after flush', async () => {
      // Small blob -> inline storage
      const smallData = encoder.encode('small inline blob')
      const smallSha = await store.putObject('blob', smallData)

      // Large blob -> r2 storage (> 1MB INLINE_THRESHOLD)
      const largeData = new Uint8Array(1.5 * 1024 * 1024)
      largeData.fill(0x42)
      const largeSha = await store.putObject('blob', largeData)

      await store.flush()

      // Verify both retrievable
      const smallResult = await store.getObject(smallSha)
      expect(smallResult).not.toBeNull()
      expect(smallResult!.type).toBe('blob')
      expect(decoder.decode(smallResult!.content)).toBe('small inline blob')

      const largeResult = await store.getObject(largeSha)
      expect(largeResult).not.toBeNull()
      expect(largeResult!.type).toBe('blob')
      expect(largeResult!.content.length).toBe(largeData.length)
      // Verify content integrity
      expect(largeResult!.content[0]).toBe(0x42)
      expect(largeResult!.content[largeData.length - 1]).toBe(0x42)
    })

    it('should store inline vs r2 with correct storage column in Parquet', async () => {
      const smallData = encoder.encode('tiny')
      await store.putObject('blob', smallData)

      const largeData = new Uint8Array(2 * 1024 * 1024)
      await store.putObject('blob', largeData)

      const key = await store.flush()
      expect(key).not.toBeNull()

      const rows = await readParquetFromR2(mockR2, key!, ['sha', 'storage', 'size'])
      expect(rows.length).toBe(2)

      const storages = rows.map(r => r.storage).sort()
      expect(storages).toContain('inline')
      expect(storages).toContain('r2')
    })
  })

  // --------------------------------------------------------------------------
  // RefLog round-trip
  // --------------------------------------------------------------------------

  describe('RefLog round-trip', () => {
    it('should append entries, flush to Parquet, create new RefLog, load, and verify state', async () => {
      // Create a RefLog and append entries
      const refLog = new RefLog(mockR2 as unknown as import('../../src/delta/ref-log').RefLogBucket, 'integration-test')

      const entry1 = refLog.append('refs/heads/main', '', 'abc123', 1700000000000)
      const entry2 = refLog.append('refs/heads/feature', '', 'def456', 1700000001000)
      const entry3 = refLog.append('refs/heads/main', 'abc123', 'ghi789', 1700000002000)

      expect(refLog.version).toBe(3)

      // Flush to Parquet on R2
      const key = await refLog.flush()
      expect(key).not.toBeNull()

      // Verify state before round-trip
      const stateBefore = refLog.replayState()
      expect(stateBefore.get('refs/heads/main')?.sha).toBe('ghi789')
      expect(stateBefore.get('refs/heads/feature')?.sha).toBe('def456')

      // Create a new RefLog and load entries from the flushed file
      const newRefLog = new RefLog(mockR2 as unknown as import('../../src/delta/ref-log').RefLogBucket, 'integration-test')

      // Read entries from the Parquet file
      const r2Obj = await mockR2.get(key!)
      expect(r2Obj).not.toBeNull()
      const buf = await r2Obj!.arrayBuffer()
      const file = {
        byteLength: buf.byteLength,
        slice: (s: number, e?: number) => buf.slice(s, e),
      }
      const rows = await parquetReadObjects({
        file,
        columns: ['version', 'ref_name', 'old_sha', 'new_sha', 'timestamp'],
        rowFormat: 'object',
      })

      // Load entries into the new RefLog
      const entries = rows.map(r => ({
        version: Number(r.version),
        ref_name: r.ref_name as string,
        old_sha: r.old_sha as string,
        new_sha: r.new_sha as string,
        timestamp: Number(r.timestamp),
      }))
      newRefLog.loadEntries(entries)

      // Verify state matches
      const stateAfter = newRefLog.replayState()
      expect(stateAfter.get('refs/heads/main')?.sha).toBe('ghi789')
      expect(stateAfter.get('refs/heads/main')?.version).toBe(3)
      expect(stateAfter.get('refs/heads/feature')?.sha).toBe('def456')
      expect(stateAfter.get('refs/heads/feature')?.version).toBe(2)
      expect(newRefLog.version).toBe(3)
    })

    it('should handle ref deletions in round-trip', async () => {
      const refLog = new RefLog(mockR2 as unknown as import('../../src/delta/ref-log').RefLogBucket, 'integration-test')

      refLog.append('refs/heads/main', '', 'aaa111', 1700000000000)
      refLog.append('refs/heads/temp', '', 'bbb222', 1700000001000)
      // Delete the temp branch
      refLog.append('refs/heads/temp', 'bbb222', '', 1700000002000)

      const key = await refLog.flush()
      expect(key).not.toBeNull()

      // Replay state - temp should be gone
      const state = refLog.replayState()
      expect(state.has('refs/heads/main')).toBe(true)
      expect(state.has('refs/heads/temp')).toBe(false)

      // Read back and verify
      const r2Obj = await mockR2.get(key!)
      const buf = await r2Obj!.arrayBuffer()
      const file = {
        byteLength: buf.byteLength,
        slice: (s: number, e?: number) => buf.slice(s, e),
      }
      const rows = await parquetReadObjects({
        file,
        columns: ['version', 'ref_name', 'old_sha', 'new_sha', 'timestamp'],
        rowFormat: 'object',
      })

      // All 3 entries should be in the Parquet file (log is append-only)
      expect(rows.length).toBe(3)

      // Reconstruct in a new RefLog
      const newRefLog = new RefLog(null, 'integration-test')
      newRefLog.loadEntries(rows.map(r => ({
        version: Number(r.version),
        ref_name: r.ref_name as string,
        old_sha: r.old_sha as string,
        new_sha: r.new_sha as string,
        timestamp: Number(r.timestamp),
      })))

      const newState = newRefLog.replayState()
      expect(newState.has('refs/heads/main')).toBe(true)
      expect(newState.get('refs/heads/main')?.sha).toBe('aaa111')
      expect(newState.has('refs/heads/temp')).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Delete with tombstone
  // --------------------------------------------------------------------------

  describe('Delete with tombstone', () => {
    it('should putObject, deleteObject, compact, and verify object is gone', async () => {
      // Store two objects across two flushes
      const keepData = encoder.encode('keep this object')
      const keepSha = await store.putObject('blob', keepData)
      await store.flush()

      const deleteData = encoder.encode('delete this object')
      const deleteSha = await store.putObject('blob', deleteData)
      await store.flush()

      expect(store.getStats().parquetFiles).toBe(2)

      // Delete the second object (tombstone)
      await store.deleteObject(deleteSha)

      // Before compaction, the deleted object should not be returned
      const beforeCompact = await store.getObject(deleteSha)
      expect(beforeCompact).toBeNull()

      // Compact - tombstoned objects should be excluded
      const compactedKey = await store.compact()
      expect(compactedKey).not.toBeNull()
      expect(store.getStats().parquetFiles).toBe(1)

      // Verify kept object is still accessible
      const keepResult = await store.getObject(keepSha)
      expect(keepResult).not.toBeNull()
      expect(decoder.decode(keepResult!.content)).toBe('keep this object')

      // Verify deleted object is gone from the compacted file
      const deleteResult = await store.getObject(deleteSha)
      expect(deleteResult).toBeNull()

      // Verify at the Parquet file level - only 1 row
      const rows = await readParquetFromR2(mockR2, compactedKey!, ['sha'])
      expect(rows.length).toBe(1)
      expect(rows[0].sha).toBe(keepSha)
    })

    it('should remove buffered objects immediately on delete', async () => {
      const data = encoder.encode('buffer delete test')
      const sha = await store.putObject('blob', data)

      expect(store.getStats().bufferedObjects).toBe(1)

      // Delete while still in buffer
      await store.deleteObject(sha)

      // Object should be removed from buffer
      const result = await store.getObject(sha)
      expect(result).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // Shredded commit fields
  // --------------------------------------------------------------------------

  describe('Shredded commit fields', () => {
    it('should putObject with commit data, flush, read back, and verify author/date/message', async () => {
      const commitData = encoder.encode(
        'tree ' + 'c'.repeat(40) + '\n' +
        'parent ' + 'd'.repeat(40) + '\n' +
        'author Alice Smith <alice@example.com> 1704067200 +0000\n' +
        'committer Bob Jones <bob@example.com> 1704067200 +0000\n' +
        '\n' +
        'Initial commit\n\nWith a multi-line message body.',
      )

      const sha = await store.putObject('commit', commitData)
      const key = await store.flush()
      expect(key).not.toBeNull()

      // Read the raw Parquet columns to verify shredded fields
      const rows = await readParquetFromR2(mockR2, key!, [
        'sha', 'type', 'author_name', 'author_date', 'message',
      ])

      expect(rows.length).toBe(1)
      const row = rows[0]
      expect(row.sha).toBe(sha)
      expect(row.type).toBe('commit')
      expect(row.author_name).toBe('Alice Smith')
      expect(Number(row.author_date)).toBe(1704067200000) // seconds * 1000 = millis
      expect(row.message).toBe('Initial commit\n\nWith a multi-line message body.')
    })

    it('should write null shredded columns for non-commit objects', async () => {
      const blobData = encoder.encode('just a blob')
      await store.putObject('blob', blobData)

      const treeData = encoder.encode('tree entries')
      await store.putObject('tree', treeData)

      const key = await store.flush()
      expect(key).not.toBeNull()

      const rows = await readParquetFromR2(mockR2, key!, [
        'type', 'author_name', 'author_date', 'message',
      ])

      expect(rows.length).toBe(2)
      for (const row of rows) {
        expect(row.author_name).toBeNull()
        expect(row.author_date).toBeNull()
        expect(row.message).toBeNull()
      }
    })

    it('should preserve shredded commit fields through compaction', async () => {
      const commitData = encoder.encode(
        'tree ' + 'e'.repeat(40) + '\n' +
        'author CompactUser <compact@test.com> 1700000000 +0000\n' +
        'committer CompactUser <compact@test.com> 1700000000 +0000\n' +
        '\n' +
        'Compaction test commit',
      )

      const sha = await store.putObject('commit', commitData)
      await store.flush()

      // Add a second flush to enable compaction
      await store.putObject('blob', encoder.encode('filler'))
      await store.flush()

      const compactedKey = await store.compact()
      expect(compactedKey).not.toBeNull()

      // Verify shredded fields survive compaction
      const rows = await readParquetFromR2(mockR2, compactedKey!, [
        'sha', 'type', 'author_name', 'author_date', 'message',
      ])

      const commitRow = rows.find(r => r.sha === sha)
      expect(commitRow).toBeDefined()
      expect(commitRow!.type).toBe('commit')
      expect(commitRow!.author_name).toBe('CompactUser')
      expect(Number(commitRow!.author_date)).toBe(1700000000000)
      expect(commitRow!.message).toBe('Compaction test commit')
    })
  })
})
