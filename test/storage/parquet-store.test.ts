import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ParquetStore } from '../../src/storage/parquet-store'
import type { DurableObjectStorage } from '../../src/do/schema'

/**
 * Mock R2Bucket for testing.
 */
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
    delete: vi.fn(async () => {}),
    head: vi.fn(async () => null),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket
}

/**
 * Mock DurableObjectStorage for testing.
 */
function createMockStorage(): DurableObjectStorage {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()

  return {
    sql: {
      exec: vi.fn((query: string, ...params: unknown[]) => {
        // Simple mock - just return empty results
        return { toArray: () => [] }
      }),
    },
  }
}

describe('ParquetStore', () => {
  let store: ParquetStore
  let mockR2: R2Bucket
  let mockStorage: DurableObjectStorage
  const encoder = new TextEncoder()

  beforeEach(() => {
    mockR2 = createMockR2()
    mockStorage = createMockStorage()
    store = new ParquetStore({
      r2: mockR2,
      sql: mockStorage,
      prefix: 'test-repo',
    })
  })

  describe('putObject', () => {
    it('should return a SHA for a blob', async () => {
      const data = encoder.encode('hello world')
      const sha = await store.putObject('blob', data)

      expect(sha).toBeDefined()
      expect(sha).toHaveLength(40)
      expect(/^[0-9a-f]{40}$/.test(sha)).toBe(true)
    })

    it('should buffer small objects', async () => {
      const data = encoder.encode('test content')
      await store.putObject('blob', data)

      const stats = store.getStats()
      expect(stats.bufferedObjects).toBe(1)
    })

    it('should upload large objects to R2 directly', async () => {
      const data = new Uint8Array(2 * 1024 * 1024) // 2MB
      await store.putObject('blob', data)

      // Should have been uploaded to R2 raw storage
      expect(mockR2.put).toHaveBeenCalled()
    })
  })

  describe('hasObject', () => {
    it('should find buffered objects', async () => {
      const data = encoder.encode('hello')
      const sha = await store.putObject('blob', data)

      const exists = await store.hasObject(sha)
      expect(exists).toBe(true)
    })

    it('should return false for unknown SHA', async () => {
      const exists = await store.hasObject('0'.repeat(40))
      expect(exists).toBe(false)
    })
  })

  describe('getObject', () => {
    it('should retrieve buffered objects', async () => {
      const data = encoder.encode('hello world')
      const sha = await store.putObject('blob', data)

      const result = await store.getObject(sha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
      expect(new TextDecoder().decode(result!.content)).toBe('hello world')
    })

    it('should return null for unknown SHA', async () => {
      const result = await store.getObject('0'.repeat(40))
      expect(result).toBeNull()
    })
  })

  describe('flush', () => {
    it('should write buffered objects to Parquet on R2', async () => {
      const data = encoder.encode('test')
      await store.putObject('blob', data)

      const key = await store.flush()
      expect(key).not.toBeNull()
      expect(key).toContain('test-repo/objects/')
      expect(key).toContain('.parquet')

      const stats = store.getStats()
      expect(stats.bufferedObjects).toBe(0)
      expect(stats.parquetFiles).toBe(1)
    })

    it('should return null when buffer is empty', async () => {
      const key = await store.flush()
      expect(key).toBeNull()
    })
  })

  describe('Parquet read path', () => {
    it('should read an inline object back from a flushed Parquet file', async () => {
      const data = encoder.encode('hello from parquet')
      const sha = await store.putObject('blob', data)

      // Flush to Parquet on R2
      const key = await store.flush()
      expect(key).not.toBeNull()

      // Now getObject should find it by scanning the Parquet file
      const result = await store.getObject(sha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
      expect(new TextDecoder().decode(result!.content)).toBe('hello from parquet')
    })

    it('should read multiple objects from a flushed Parquet file', async () => {
      const data1 = encoder.encode('object one')
      const data2 = encoder.encode('object two')
      const data3 = encoder.encode('object three')

      const sha1 = await store.putObject('blob', data1)
      const sha2 = await store.putObject('tree', data2)
      const sha3 = await store.putObject('commit', data3)

      await store.flush()

      const result1 = await store.getObject(sha1)
      expect(result1).not.toBeNull()
      expect(result1!.type).toBe('blob')
      expect(new TextDecoder().decode(result1!.content)).toBe('object one')

      const result2 = await store.getObject(sha2)
      expect(result2).not.toBeNull()
      expect(result2!.type).toBe('tree')

      const result3 = await store.getObject(sha3)
      expect(result3).not.toBeNull()
      expect(result3!.type).toBe('commit')
    })

    it('should return null for SHA not in any Parquet file', async () => {
      const data = encoder.encode('something')
      await store.putObject('blob', data)
      await store.flush()

      const result = await store.getObject('f'.repeat(40))
      expect(result).toBeNull()
    })

    it('should read large (R2-backed) objects via raw R2 key', async () => {
      // Create a large object that exceeds INLINE_THRESHOLD (1MB)
      const data = new Uint8Array(1.5 * 1024 * 1024)
      data.fill(42)
      const sha = await store.putObject('blob', data)

      await store.flush()

      const result = await store.getObject(sha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
      expect(result!.content.length).toBe(data.length)
    })
  })

  describe('shredded commit columns', () => {
    it('should write commit fields as separate Parquet columns', async () => {
      const { parquetReadObjects } = await import('hyparquet')
      const commitData = encoder.encode(
        'tree ' + 'a'.repeat(40) + '\n' +
        'author Alice <alice@test.com> 1704067200 +0000\n' +
        'committer Alice <alice@test.com> 1704067200 +0000\n' +
        '\n' +
        'Initial commit'
      )
      await store.putObject('commit', commitData)
      const key = await store.flush()
      expect(key).not.toBeNull()

      // Read the Parquet file directly to verify shredded columns
      const r2Obj = await mockR2.get(key!)
      const buf = await r2Obj!.arrayBuffer()
      const file = { byteLength: buf.byteLength, slice: (s: number, e?: number) => buf.slice(s, e) }
      const rows = await parquetReadObjects({
        file,
        columns: ['sha', 'type', 'author_name', 'author_date', 'message'],
        rowFormat: 'object',
      })

      expect(rows.length).toBe(1)
      expect(rows[0].type).toBe('commit')
      expect(rows[0].author_name).toBe('Alice')
      expect(Number(rows[0].author_date)).toBe(1704067200000) // millis
      expect(rows[0].message).toBe('Initial commit')
    })

    it('should write null for non-commit shredded columns', async () => {
      const { parquetReadObjects } = await import('hyparquet')
      const blobData = encoder.encode('just a blob')
      await store.putObject('blob', blobData)
      const key = await store.flush()

      const r2Obj = await mockR2.get(key!)
      const buf = await r2Obj!.arrayBuffer()
      const file = { byteLength: buf.byteLength, slice: (s: number, e?: number) => buf.slice(s, e) }
      const rows = await parquetReadObjects({
        file,
        columns: ['sha', 'type', 'author_name', 'author_date', 'message'],
        rowFormat: 'object',
      })

      expect(rows.length).toBe(1)
      expect(rows[0].type).toBe('blob')
      expect(rows[0].author_name).toBeNull()
      expect(rows[0].author_date).toBeNull()
      expect(rows[0].message).toBeNull()
    })
  })

  describe('compaction', () => {
    it('should merge multiple Parquet files into one', async () => {
      // Create and flush two batches
      await store.putObject('blob', encoder.encode('batch one'))
      await store.flush()

      await store.putObject('blob', encoder.encode('batch two'))
      await store.flush()

      expect(store.getStats().parquetFiles).toBe(2)

      // Compact
      const compactedKey = await store.compact()
      expect(compactedKey).not.toBeNull()
      expect(store.getStats().parquetFiles).toBe(1)
    })

    it('should exclude tombstoned objects during compaction', async () => {
      const data1 = encoder.encode('keep me')
      const data2 = encoder.encode('delete me')

      const sha1 = await store.putObject('blob', data1)
      await store.flush()

      const sha2 = await store.putObject('blob', data2)
      await store.flush()

      // Tombstone sha2
      await store.deleteObject(sha2)

      // Compact
      await store.compact()

      // sha1 should still be readable
      const result1 = await store.getObject(sha1)
      expect(result1).not.toBeNull()
      expect(new TextDecoder().decode(result1!.content)).toBe('keep me')

      // sha2 should not be found (not in tombstones after compact, and excluded from file)
      const result2 = await store.getObject(sha2)
      expect(result2).toBeNull()
    })

    it('should return null when fewer than 2 files exist', async () => {
      await store.putObject('blob', encoder.encode('one file'))
      await store.flush()

      const result = await store.compact()
      expect(result).toBeNull()
    })

    it('should deduplicate objects across files', async () => {
      const { parquetReadObjects } = await import('hyparquet')
      const data = encoder.encode('duplicate content')

      // Write same object twice in different flushes
      const sha = await store.putObject('blob', data)
      await store.flush()

      // Manually add same sha again by re-putting
      await store.putObject('blob', data)
      await store.flush()

      expect(store.getStats().parquetFiles).toBe(2)

      const compactedKey = await store.compact()
      expect(compactedKey).not.toBeNull()

      // Read compacted file - should have only one row for this SHA
      const r2Obj = await mockR2.get(compactedKey!)
      const buf = await r2Obj!.arrayBuffer()
      const file = { byteLength: buf.byteLength, slice: (s: number, e?: number) => buf.slice(s, e) }
      const rows = await parquetReadObjects({
        file,
        columns: ['sha'],
        rowFormat: 'object',
      })

      const shaRows = rows.filter(r => r.sha === sha)
      expect(shaRows.length).toBe(1)
    })
  })

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stats = store.getStats()
      expect(stats.bufferedObjects).toBe(0)
      expect(stats.bufferedBytes).toBe(0)
      expect(stats.parquetFiles).toBe(0)
    })
  })

  describe('concurrent operations', () => {
    it('multiple concurrent initialize() calls should only initialize once (promise dedup)', async () => {
      // Track how many times R2.list is called (called during _doInitialize -> discoverObjectFiles)
      const listSpy = mockR2.list as ReturnType<typeof vi.fn>
      listSpy.mockClear()

      // Create a fresh store to test initialization
      const freshStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
      })

      // Call initialize() concurrently multiple times
      const results = await Promise.all([
        freshStore.initialize(),
        freshStore.initialize(),
        freshStore.initialize(),
        freshStore.initialize(),
        freshStore.initialize(),
      ])

      // All should resolve successfully
      expect(results).toHaveLength(5)

      // R2.list should have been called exactly once (deduplication via initPromise)
      expect(listSpy).toHaveBeenCalledTimes(1)
    })

    it('putObject during flush should not lose data (objects go to new buffer)', async () => {
      // Put an initial object and start flushing
      const data1 = encoder.encode('object before flush')
      const sha1 = await store.putObject('blob', data1)

      // Start the flush (this moves buffer to local variable and resets this.buffer)
      const flushPromise = store.flush()

      // While flush is in progress, put another object
      const data2 = encoder.encode('object during flush')
      const sha2 = await store.putObject('blob', data2)

      // Wait for flush to complete
      const key = await flushPromise
      expect(key).not.toBeNull()

      // The second object should be in the new buffer (not lost)
      const stats = store.getStats()
      expect(stats.bufferedObjects).toBe(1)

      // First object should be findable (flushed to Parquet)
      const result1 = await store.getObject(sha1)
      expect(result1).not.toBeNull()
      expect(new TextDecoder().decode(result1!.content)).toBe('object before flush')

      // Second object should also be findable (still in buffer)
      const result2 = await store.getObject(sha2)
      expect(result2).not.toBeNull()
      expect(new TextDecoder().decode(result2!.content)).toBe('object during flush')
    })

    it('concurrent putObject calls should not corrupt buffer state', async () => {
      // Issue multiple putObject calls concurrently
      const objects = Array.from({ length: 10 }, (_, i) =>
        encoder.encode(`concurrent object ${i}`)
      )

      const shas = await Promise.all(
        objects.map(data => store.putObject('blob', data))
      )

      // All SHAs should be unique and valid
      expect(new Set(shas).size).toBe(10)
      for (const sha of shas) {
        expect(sha).toHaveLength(40)
        expect(/^[0-9a-f]{40}$/.test(sha)).toBe(true)
      }

      // All objects should be retrievable
      const stats = store.getStats()
      expect(stats.bufferedObjects).toBe(10)

      for (let i = 0; i < shas.length; i++) {
        const result = await store.getObject(shas[i])
        expect(result).not.toBeNull()
        expect(result!.type).toBe('blob')
      }
    })
  })

  describe('error handling', () => {
    it('R2 put failure during flush should throw', async () => {
      const failingR2 = createMockR2()
      failingR2.put = vi.fn(async () => { throw new Error('R2 write failed') })
      const failStore = new ParquetStore({
        r2: failingR2,
        sql: mockStorage,
        prefix: 'test-repo',
      })

      await failStore.putObject('blob', encoder.encode('will fail'))
      await expect(failStore.flush()).rejects.toThrow('R2 write failed')
    })

    it('R2 get failure during readObjectFromParquet should propagate', async () => {
      // First, flush an object with a working R2
      const data = encoder.encode('test object')
      const sha = await store.putObject('blob', data)
      await store.flush()

      // Now make R2 get fail
      ;(mockR2.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('R2 read failed'))

      // getObject scans Parquet files via R2 get — error propagates
      await expect(store.getObject(sha)).rejects.toThrow('R2 read failed')
    })

    it('R2 list failure during discoverObjectFiles should handle gracefully', async () => {
      const failingR2 = createMockR2()
      ;(failingR2.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('R2 list failed'))
      const failStore = new ParquetStore({
        r2: failingR2,
        sql: mockStorage,
        prefix: 'test-repo',
      })

      // Any operation that triggers initialize() will call discoverObjectFiles
      await expect(failStore.putObject('blob', encoder.encode('test'))).rejects.toThrow('R2 list failed')
    })
  })
})
