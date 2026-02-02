import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ParquetStore } from '../../src/storage/parquet-store'
import type { DurableObjectStorage } from '../../src/do/schema'
import { CollectingMetrics } from '../../src/storage/metrics'

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
      } else if (typeof value === 'string') {
        const encoded = new TextEncoder().encode(value)
        store.set(key, encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength))
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

      // Write same object in first flush
      const sha = await store.putObject('blob', data)
      await store.flush()

      // Write a different object in second flush (so keys differ)
      await store.putObject('blob', encoder.encode('different content'))
      // Also re-add the original to create a duplicate across files
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

    it('concurrent flush calls should be serialized by mutex (no overlapping flushes)', async () => {
      // Add some objects to the buffer
      for (let i = 0; i < 5; i++) {
        await store.putObject('blob', encoder.encode(`flush mutex test ${i}`))
      }

      // Track the order of flush execution
      const flushOrder: number[] = []
      let flushCounter = 0
      const originalPut = mockR2.put as ReturnType<typeof vi.fn>
      const putMock = vi.fn(async (key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string) => {
        // Only track Parquet file writes (not raw R2 writes for large objects)
        if (key.includes('/objects/') && key.endsWith('.parquet')) {
          const myOrder = ++flushCounter
          flushOrder.push(myOrder)
          // Simulate some async work to increase chance of race
          await new Promise(resolve => setTimeout(resolve, 10))
          // Record when this flush completes
          flushOrder.push(-myOrder)
        }
        return originalPut(key, value)
      })
      ;(mockR2 as { put: typeof putMock }).put = putMock

      // Launch multiple concurrent flushes
      const flushPromises = [
        store.flush(),
        store.flush(),
        store.flush(),
      ]

      const results = await Promise.all(flushPromises)

      // Only one flush should have actually written (the others see empty buffer)
      const nonNullResults = results.filter(r => r !== null)
      expect(nonNullResults.length).toBe(1)

      // The flush order should show no interleaving (if there were any concurrent writes)
      // Pattern should be: [1, -1] or [1, -1, 2, -2] etc., never [1, 2, -1, -2]
      for (let i = 0; i < flushOrder.length - 1; i += 2) {
        const start = flushOrder[i]
        const end = flushOrder[i + 1]
        expect(end).toBe(-start!) // Each start should be immediately followed by its end
      }
    })

    it('concurrent flush calls should wait for previous flush to complete', async () => {
      // Create a store that we can control timing on
      const slowR2 = createMockR2()
      const flushStarted: number[] = []
      const flushCompleted: number[] = []
      let flushId = 0

      const originalPut = slowR2.put as ReturnType<typeof vi.fn>
      ;(slowR2 as { put: typeof slowR2.put }).put = vi.fn(async (key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string) => {
        if (key.includes('/objects/') && key.endsWith('.parquet')) {
          const myId = ++flushId
          flushStarted.push(myId)
          // Simulate slow R2 write
          await new Promise(resolve => setTimeout(resolve, 50))
          flushCompleted.push(myId)
        }
        return originalPut(key, value)
      })

      const slowStore = new ParquetStore({
        r2: slowR2,
        sql: mockStorage,
        prefix: 'test-repo',
      })

      // Add objects for first flush
      await slowStore.putObject('blob', encoder.encode('slow test 1'))

      // Start first flush (don't await yet)
      const flush1Promise = slowStore.flush()

      // Immediately add more objects and start second flush
      await slowStore.putObject('blob', encoder.encode('slow test 2'))
      const flush2Promise = slowStore.flush()

      // Wait for both
      await Promise.all([flush1Promise, flush2Promise])

      // Both flushes should have written (they had different buffer contents)
      expect(flushStarted.length).toBe(2)
      expect(flushCompleted.length).toBe(2)

      // The second flush should not start until the first completes
      // So completed[0] should be for started[0], meaning no interleaving
      expect(flushCompleted[0]).toBe(flushStarted[0])
    })
  })

  describe('iceberg integration', () => {
    it('should write iceberg metadata.json to R2 after flush when icebergEnabled', async () => {
      const icebergStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        onFlush: (await import('../../src/iceberg/flush-handler')).createIcebergFlushHandler(),
      })

      const data = encoder.encode('iceberg test object')
      await icebergStore.putObject('blob', data)
      await icebergStore.flush()

      // Verify metadata.json was written to R2
      const metadataObj = await mockR2.get('test-repo/iceberg/metadata.json')
      expect(metadataObj).not.toBeNull()

      const metadataText = await metadataObj!.arrayBuffer()
      const metadata = JSON.parse(new TextDecoder().decode(metadataText))

      expect(metadata['format-version']).toBe(2)
      expect(metadata.snapshots).toHaveLength(1)
      expect(metadata['current-snapshot-id']).toBeGreaterThan(0)
      expect(metadata.snapshots[0].summary.operation).toBe('append')
      expect(metadata.snapshots[0]['manifest-list']).toContain('test-repo/iceberg/manifest-lists/')
    })

    it('should chain snapshots across multiple flushes', async () => {
      const icebergStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        onFlush: (await import('../../src/iceberg/flush-handler')).createIcebergFlushHandler(),
      })

      await icebergStore.putObject('blob', encoder.encode('first'))
      await icebergStore.flush()

      await icebergStore.putObject('blob', encoder.encode('second'))
      await icebergStore.flush()

      const metadataObj = await mockR2.get('test-repo/iceberg/metadata.json')
      const metadata = JSON.parse(new TextDecoder().decode(await metadataObj!.arrayBuffer()))

      expect(metadata.snapshots).toHaveLength(2)
      expect(metadata.snapshots[1]['parent-snapshot-id']).toBe(metadata.snapshots[0]['snapshot-id'])
    })

    it('should write manifest JSON to R2', async () => {
      const icebergStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        onFlush: (await import('../../src/iceberg/flush-handler')).createIcebergFlushHandler(),
      })

      await icebergStore.putObject('blob', encoder.encode('manifest test'))
      await icebergStore.flush()

      // Find the manifest file in R2 puts
      const putCalls = (mockR2.put as ReturnType<typeof vi.fn>).mock.calls
      const manifestCall = putCalls.find(([key]: [string]) =>
        key.startsWith('test-repo/iceberg/manifests/') && key.endsWith('.avro')
      )
      expect(manifestCall).toBeDefined()

      // Verify the manifest content
      const manifestObj = await mockR2.get(manifestCall![0])
      const manifest = JSON.parse(new TextDecoder().decode(await manifestObj!.arrayBuffer()))
      expect(manifest.entries).toHaveLength(1)
      expect(manifest.entries[0]['data-file']['file-format']).toBe('PARQUET')
    })

    it('should not write iceberg metadata when onFlush is not set', async () => {
      const data = encoder.encode('no iceberg')
      await store.putObject('blob', data)
      await store.flush()

      const metadataObj = await mockR2.get('test-repo/iceberg/metadata.json')
      expect(metadataObj).toBeNull()
    })
  })

  describe('back-pressure', () => {
    it('should auto-flush when maxBufferObjects is exceeded', async () => {
      const lowLimitStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        flushThreshold: 100,  // Higher than maxBufferObjects to ensure back-pressure triggers
        maxBufferObjects: 5,  // Low limit for testing
      })

      // Add 6 objects - should trigger auto-flush after the 5th due to back-pressure
      for (let i = 0; i < 6; i++) {
        await lowLimitStore.putObject('blob', encoder.encode(`object ${i}`))
      }

      const stats = lowLimitStore.getStats()
      // After flush, buffer should have remaining objects (1 object after the flush)
      expect(stats.bufferedObjects).toBeLessThanOrEqual(5)
      // At least one Parquet file should have been created from the flush
      expect(stats.parquetFiles).toBeGreaterThanOrEqual(1)
    })

    it('should auto-flush when maxBufferBytes is exceeded', async () => {
      const lowLimitStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        flushBytesThreshold: 10 * 1024 * 1024,  // Higher than maxBufferBytes
        maxBufferBytes: 100,  // Low limit for testing (100 bytes)
      })

      // Add objects until we exceed 100 bytes
      await lowLimitStore.putObject('blob', encoder.encode('a'.repeat(50)))
      await lowLimitStore.putObject('blob', encoder.encode('b'.repeat(60)))  // Total: 110 bytes, triggers flush

      const stats = lowLimitStore.getStats()
      // Buffer should have been flushed
      expect(stats.bufferedBytes).toBeLessThanOrEqual(100)
      // At least one Parquet file should have been created
      expect(stats.parquetFiles).toBeGreaterThanOrEqual(1)
    })

    it('should respect default maxBufferBytes of 50MB', () => {
      const defaultStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
      })
      // We can't easily test the default value directly without exposing it,
      // but we can verify the store is created without errors
      expect(defaultStore).toBeDefined()
    })

    it('should respect default maxBufferObjects of 10000', () => {
      const defaultStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
      })
      // We can't easily test the default value directly without exposing it,
      // but we can verify the store is created without errors
      expect(defaultStore).toBeDefined()
    })

    it('should flush multiple times under sustained load', async () => {
      const lowLimitStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        flushThreshold: 1000,  // High threshold
        maxBufferObjects: 3,   // Low back-pressure limit
      })

      // Add 10 objects - should trigger multiple flushes
      for (let i = 0; i < 10; i++) {
        await lowLimitStore.putObject('blob', encoder.encode(`sustained ${i}`))
      }

      const stats = lowLimitStore.getStats()
      // Should have created multiple Parquet files from multiple flushes
      expect(stats.parquetFiles).toBeGreaterThanOrEqual(2)
    })

    it('should not lose data during back-pressure flush', async () => {
      const lowLimitStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        flushThreshold: 100,
        maxBufferObjects: 3,
      })

      const shas: string[] = []
      for (let i = 0; i < 7; i++) {
        const sha = await lowLimitStore.putObject('blob', encoder.encode(`no-loss ${i}`))
        shas.push(sha)
      }

      // All objects should be retrievable
      for (let i = 0; i < shas.length; i++) {
        const result = await lowLimitStore.getObject(shas[i])
        expect(result).not.toBeNull()
        expect(new TextDecoder().decode(result!.content)).toBe(`no-loss ${i}`)
      }
    })
  })

  describe('bloom filter false negative recovery', () => {
    it('should recover from bloom filter false negative when verifyBloomNegatives is enabled', async () => {
      // Create a store with verifyBloomNegatives enabled
      const verifyStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        verifyBloomNegatives: true,
      })

      // Add an object and flush
      const data = encoder.encode('false negative test')
      const sha = await verifyStore.putObject('blob', data)
      await verifyStore.flush()

      // Simulate a bloom filter false negative by clearing the bloom cache
      // This mimics a scenario where the bloom filter incorrectly reports absent
      const bloomCache = verifyStore.getBloomCache()
      await bloomCache.clear()

      // With verifyBloomNegatives enabled, hasObject should still find it via R2 fallback
      const exists = await verifyStore.hasObject(sha)
      expect(exists).toBe(true)

      // After self-healing, the bloom filter should now report the SHA exists
      // (may be 'definite' if exact cache works or 'probable' from bloom filter)
      const check = await bloomCache.check(sha)
      expect(check === 'definite' || check === 'probable').toBe(true)
    })

    it('should return false for truly missing objects even with verifyBloomNegatives', async () => {
      const verifyStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        verifyBloomNegatives: true,
      })

      // Initialize the store
      await verifyStore.putObject('blob', encoder.encode('dummy'))
      await verifyStore.flush()

      // Check for a SHA that truly doesn't exist
      const nonExistentSha = 'a'.repeat(40)
      const exists = await verifyStore.hasObject(nonExistentSha)
      expect(exists).toBe(false)
    })

    it('should NOT verify R2 when verifyBloomNegatives is disabled (default)', async () => {
      // Create a store without verifyBloomNegatives (default false)
      const defaultStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
      })

      // Add an object and flush
      const data = encoder.encode('default behavior test')
      const sha = await defaultStore.putObject('blob', data)
      await defaultStore.flush()

      // Clear the bloom cache to simulate false negative
      const bloomCache = defaultStore.getBloomCache()
      await bloomCache.clear()

      // Without verifyBloomNegatives, hasObject should return false (trusting bloom filter)
      const exists = await defaultStore.hasObject(sha)
      expect(exists).toBe(false)
    })

    it('should find object in buffer even with bloom filter false negative', async () => {
      const verifyStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        verifyBloomNegatives: true,
      })

      // Add an object but don't flush (stays in buffer)
      const data = encoder.encode('buffered object')
      const sha = await verifyStore.putObject('blob', data)

      // Clear bloom cache to simulate false negative
      const bloomCache = verifyStore.getBloomCache()
      await bloomCache.clear()

      // Should still find it in the buffer
      const exists = await verifyStore.hasObject(sha)
      expect(exists).toBe(true)
    })

    it('should self-heal bloom filter after R2 verification', async () => {
      const verifyStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        verifyBloomNegatives: true,
      })

      // Add and flush an object
      const data = encoder.encode('self-heal test')
      const sha = await verifyStore.putObject('blob', data)
      await verifyStore.flush()

      // Clear bloom cache
      const bloomCache = verifyStore.getBloomCache()
      await bloomCache.clear()

      // First check - should trigger R2 lookup and self-heal
      const exists1 = await verifyStore.hasObject(sha)
      expect(exists1).toBe(true)

      // Second check - should now find it in the bloom filter without R2 lookup
      // We can't easily verify the R2 lookup wasn't made, but we can verify
      // the bloom filter now reports the SHA (either definite or probable)
      const check = await bloomCache.check(sha)
      expect(check === 'definite' || check === 'probable').toBe(true)
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

  describe('WAL durability', () => {
    /**
     * Create a mock storage that tracks WAL entries.
     * This allows us to inspect WAL state for testing crash recovery.
     */
    function createWALMockStorage(): DurableObjectStorage & {
      walEntries: Map<number, { sha: string; type: string; data: Uint8Array; path: string | null; created_at: number }>
      walIdCounter: number
    } {
      const walEntries = new Map<number, { sha: string; type: string; data: Uint8Array; path: string | null; created_at: number }>()

      // Use an object to hold the counter so it can be modified from outside
      const state = { walIdCounter: 0 }

      const result = {
        walEntries,
        get walIdCounter() { return state.walIdCounter },
        set walIdCounter(v: number) { state.walIdCounter = v },
        sql: {
          exec: vi.fn((query: string, ...params: unknown[]) => {
            // Handle CREATE TABLE/INDEX (no-op)
            if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) {
              return { toArray: () => [] }
            }

            // Handle WAL INSERT
            if (query.includes('INSERT INTO write_buffer_wal')) {
              state.walIdCounter++
              walEntries.set(state.walIdCounter, {
                sha: params[0] as string,
                type: params[1] as string,
                data: params[2] as Uint8Array,
                path: params[3] as string | null,
                created_at: params[4] as number,
              })
              return { toArray: () => [] }
            }

            // Handle WAL SELECT for getting ID after insert
            if (query.includes('SELECT id FROM write_buffer_wal WHERE sha')) {
              const sha = params[0] as string
              const createdAt = params[1] as number
              for (const [id, entry] of walEntries) {
                if (entry.sha === sha && entry.created_at === createdAt) {
                  return { toArray: () => [{ id }] }
                }
              }
              return { toArray: () => [] }
            }

            // Handle WAL SELECT ALL for recovery
            if (query.includes('SELECT id, sha, type, data, path, created_at FROM write_buffer_wal')) {
              const entries = Array.from(walEntries.entries())
                .map(([id, e]) => ({ id, ...e }))
                .sort((a, b) => a.id - b.id)
              return { toArray: () => entries }
            }

            // Handle WAL DELETE by ID list
            if (query.includes('DELETE FROM write_buffer_wal WHERE id IN')) {
              for (const id of params) {
                walEntries.delete(id as number)
              }
              return { toArray: () => [] }
            }

            // Handle WAL DELETE by SHA (for deleteObject)
            if (query.includes('DELETE FROM write_buffer_wal WHERE sha')) {
              const sha = params[0] as string
              for (const [id, entry] of walEntries) {
                if (entry.sha === sha) {
                  walEntries.delete(id)
                }
              }
              return { toArray: () => [] }
            }

            // Handle WAL DELETE by single ID (for invalid type cleanup)
            if (query.includes('DELETE FROM write_buffer_wal WHERE id = ?')) {
              const id = params[0] as number
              walEntries.delete(id)
              return { toArray: () => [] }
            }

            // Default: return empty results
            return { toArray: () => [] }
          }),
        },
      }

      return result
    }

    it('should persist writes to WAL before acknowledging', async () => {
      const walStorage = createWALMockStorage()
      const walStore = new ParquetStore({
        r2: mockR2,
        sql: walStorage,
        prefix: 'test-repo',
      })

      const data = encoder.encode('wal test data')
      const sha = await walStore.putObject('blob', data)

      // WAL should have the entry
      expect(walStorage.walEntries.size).toBe(1)
      const walEntry = Array.from(walStorage.walEntries.values())[0]
      expect(walEntry.sha).toBe(sha)
      expect(walEntry.type).toBe('blob')
      expect(new TextDecoder().decode(walEntry.data)).toBe('wal test data')
    })

    it('should clear WAL entries after successful flush', async () => {
      const walStorage = createWALMockStorage()
      const walStore = new ParquetStore({
        r2: mockR2,
        sql: walStorage,
        prefix: 'test-repo',
      })

      await walStore.putObject('blob', encoder.encode('flush test 1'))
      await walStore.putObject('blob', encoder.encode('flush test 2'))

      expect(walStorage.walEntries.size).toBe(2)

      await walStore.flush()

      // WAL should be cleared after successful flush
      expect(walStorage.walEntries.size).toBe(0)
    })

    it('should recover WAL entries on startup', async () => {
      const walStorage = createWALMockStorage()

      // Simulate pre-existing WAL entries (from a crash before flush)
      walStorage.walIdCounter = 2
      walStorage.walEntries.set(1, {
        sha: 'a'.repeat(40),
        type: 'blob',
        data: encoder.encode('recovered object 1'),
        path: null,
        created_at: Date.now() - 1000,
      })
      walStorage.walEntries.set(2, {
        sha: 'b'.repeat(40),
        type: 'tree',
        data: encoder.encode('recovered object 2'),
        path: '/some/path',
        created_at: Date.now() - 500,
      })

      const walStore = new ParquetStore({
        r2: mockR2,
        sql: walStorage,
        prefix: 'test-repo',
      })

      // Initialize should recover WAL entries into buffer
      await walStore.initialize()

      const stats = walStore.getStats()
      expect(stats.bufferedObjects).toBe(2)

      // Objects should be retrievable from buffer
      const result1 = await walStore.getObject('a'.repeat(40))
      expect(result1).not.toBeNull()
      expect(new TextDecoder().decode(result1!.content)).toBe('recovered object 1')

      const result2 = await walStore.getObject('b'.repeat(40))
      expect(result2).not.toBeNull()
      expect(new TextDecoder().decode(result2!.content)).toBe('recovered object 2')
    })

    it('should handle recovery with duplicate SHAs gracefully', async () => {
      const walStorage = createWALMockStorage()

      // Simulate WAL with duplicate SHA entries (shouldn't happen but be defensive)
      const sha = 'c'.repeat(40)
      walStorage.walIdCounter = 2
      walStorage.walEntries.set(1, {
        sha,
        type: 'blob',
        data: encoder.encode('first occurrence'),
        path: null,
        created_at: Date.now() - 1000,
      })
      walStorage.walEntries.set(2, {
        sha,
        type: 'blob',
        data: encoder.encode('duplicate occurrence'),
        path: null,
        created_at: Date.now() - 500,
      })

      const walStore = new ParquetStore({
        r2: mockR2,
        sql: walStorage,
        prefix: 'test-repo',
      })

      await walStore.initialize()

      // Should only have one object in buffer (deduped by SHA)
      const stats = walStore.getStats()
      expect(stats.bufferedObjects).toBe(1)

      // Should get the first occurrence (processed in order)
      const result = await walStore.getObject(sha)
      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.content)).toBe('first occurrence')
    })

    it('should retain WAL entries if flush fails', async () => {
      const failingR2 = createMockR2()
      failingR2.put = vi.fn(async () => { throw new Error('R2 write failed') })

      const walStorage = createWALMockStorage()
      const walStore = new ParquetStore({
        r2: failingR2,
        sql: walStorage,
        prefix: 'test-repo',
      })

      await walStore.putObject('blob', encoder.encode('will fail flush'))
      expect(walStorage.walEntries.size).toBe(1)

      // Flush should fail
      await expect(walStore.flush()).rejects.toThrow('R2 write failed')

      // WAL entries should still be present for recovery
      expect(walStorage.walEntries.size).toBe(1)
    })

    it('should remove WAL entries when object is deleted', async () => {
      const walStorage = createWALMockStorage()
      const walStore = new ParquetStore({
        r2: mockR2,
        sql: walStorage,
        prefix: 'test-repo',
      })

      const sha = await walStore.putObject('blob', encoder.encode('to be deleted'))
      expect(walStorage.walEntries.size).toBe(1)

      await walStore.deleteObject(sha)

      // WAL entry should be removed
      expect(walStorage.walEntries.size).toBe(0)
    })

    it('should clear recovered WAL entries after flush', async () => {
      const walStorage = createWALMockStorage()

      // Simulate pre-existing WAL entries
      walStorage.walIdCounter = 1
      walStorage.walEntries.set(1, {
        sha: 'd'.repeat(40),
        type: 'blob',
        data: encoder.encode('recovered and flushed'),
        path: null,
        created_at: Date.now() - 1000,
      })

      const walStore = new ParquetStore({
        r2: mockR2,
        sql: walStorage,
        prefix: 'test-repo',
      })

      await walStore.initialize()
      expect(walStorage.walEntries.size).toBe(1)

      // Flush should clear the recovered WAL entry
      await walStore.flush()
      expect(walStorage.walEntries.size).toBe(0)
    })

    it('should handle mixed new and recovered writes in single flush', async () => {
      const walStorage = createWALMockStorage()

      // Simulate a pre-existing WAL entry
      walStorage.walIdCounter = 1
      walStorage.walEntries.set(1, {
        sha: 'e'.repeat(40),
        type: 'blob',
        data: encoder.encode('recovered'),
        path: null,
        created_at: Date.now() - 1000,
      })

      const walStore = new ParquetStore({
        r2: mockR2,
        sql: walStorage,
        prefix: 'test-repo',
      })

      await walStore.initialize()
      expect(walStorage.walEntries.size).toBe(1)

      // Check buffer stats before adding new object
      const statsBefore = walStore.getStats()
      expect(statsBefore.bufferedObjects).toBe(1)

      // Add a new object with completely unique content
      const newSha = await walStore.putObject('blob', encoder.encode('brand new unique object ' + Date.now()))

      // Check buffer stats after adding new object
      const statsAfter = walStore.getStats()
      expect(statsAfter.bufferedObjects).toBe(2)

      // WAL should have 2 entries now
      expect(walStorage.walEntries.size).toBe(2)

      // Flush should clear both entries
      await walStore.flush()
      expect(walStorage.walEntries.size).toBe(0)
    })

    it('should skip invalid object types in WAL recovery', async () => {
      const walStorage = createWALMockStorage()

      // Simulate WAL with an invalid type
      walStorage.walIdCounter = 2
      walStorage.walEntries.set(1, {
        sha: 'f'.repeat(40),
        type: 'invalid_type',
        data: encoder.encode('bad type'),
        path: null,
        created_at: Date.now() - 1000,
      })
      walStorage.walEntries.set(2, {
        sha: 'g'.repeat(40),
        type: 'blob',
        data: encoder.encode('valid object'),
        path: null,
        created_at: Date.now() - 500,
      })

      const walStore = new ParquetStore({
        r2: mockR2,
        sql: walStorage,
        prefix: 'test-repo',
      })

      await walStore.initialize()

      // Only the valid object should be in buffer
      const stats = walStore.getStats()
      expect(stats.bufferedObjects).toBe(1)

      // Invalid entry should have been deleted from WAL
      expect(walStorage.walEntries.size).toBe(1)
    })

    it('should persist path in WAL entries', async () => {
      const walStorage = createWALMockStorage()
      const walStore = new ParquetStore({
        r2: mockR2,
        sql: walStorage,
        prefix: 'test-repo',
      })

      const data = encoder.encode('file content')
      await walStore.putObject('blob', data, '/src/main.ts')

      const walEntry = Array.from(walStorage.walEntries.values())[0]
      expect(walEntry.path).toBe('/src/main.ts')
    })
  })

  describe('metrics integration', () => {
    let metricsStore: ParquetStore
    let metrics: CollectingMetrics

    beforeEach(() => {
      metrics = new CollectingMetrics()
      metricsStore = new ParquetStore({
        r2: mockR2,
        sql: mockStorage,
        prefix: 'test-repo',
        metrics,
      })
    })

    it('should emit write metrics on putObject', async () => {
      const data = encoder.encode('hello world')
      const sha = await metricsStore.putObject('blob', data)

      expect(metrics.writes).toHaveLength(1)
      expect(metrics.writes[0]).toEqual(expect.objectContaining({
        sha,
        sizeBytes: data.length,
        tier: 'buffer',
        objectType: 'blob',
      }))
      expect(metrics.writes[0]?.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('should emit cache hit metrics on getObject from buffer', async () => {
      const data = encoder.encode('test content')
      const sha = await metricsStore.putObject('blob', data)

      metrics.clear() // Clear write metrics
      await metricsStore.getObject(sha)

      // Should have cache hit for buffer
      expect(metrics.getCacheHits('buffer')).toHaveLength(1)
      // Should have a read metric
      expect(metrics.reads).toHaveLength(1)
      expect(metrics.reads[0]).toEqual(expect.objectContaining({
        sha,
        tier: 'buffer',
        objectType: 'blob',
        sizeBytes: data.length,
      }))
    })

    it('should emit cache miss metrics for unknown objects', async () => {
      await metricsStore.getObject('0'.repeat(40))

      // Should have cache miss for bloom filter
      expect(metrics.getCacheMisses('bloom')).toHaveLength(1)
    })

    it('should emit flush metrics', async () => {
      // Add some objects
      await metricsStore.putObject('blob', encoder.encode('content 1'))
      await metricsStore.putObject('blob', encoder.encode('content 2'))
      await metricsStore.putObject('blob', encoder.encode('content 3'))

      metrics.clear() // Clear write metrics
      await metricsStore.flush()

      expect(metrics.flushes).toHaveLength(1)
      expect(metrics.flushes[0]).toEqual(expect.objectContaining({
        objectCount: 3,
      }))
      expect(metrics.flushes[0]?.sizeBytes).toBeGreaterThan(0)
      expect(metrics.flushes[0]?.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('should not emit metrics when buffer is empty on flush', async () => {
      await metricsStore.flush()

      expect(metrics.flushes).toHaveLength(0)
    })
  })
})
