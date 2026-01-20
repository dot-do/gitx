import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  // Core types
  BundleObjectType,
  BundleIndexEntry,
  createBundle,
  BundleReader,

  // Error types
  BundleFormatError,
  BundleCorruptedError
} from '../../src/storage/bundle-format'

import type { StorageBackend } from '../../src/storage/backend'

// Import the BundleReaderService - the main subject under test
// This is a higher-level abstraction that reads bundles from storage
import {
  BundleReaderService,
  BundleReaderOptions,
  BundleReaderError,
  BundleNotFoundError,
  RangeReadResult,
  BatchReadResult
} from '../../src/storage/bundle-reader'

/**
 * BundleReader Tests (Storage Integration)
 *
 * Tests for BundleReaderService - efficient reading of objects from bundles stored in R2.
 *
 * ## BundleReaderService Responsibilities
 * - Load bundle index into memory for fast lookups
 * - Read objects by OID using index offset
 * - Support range reads for partial object data
 * - Batch read multiple objects efficiently
 * - Cache frequently accessed bundles using LRU cache
 *
 * This is RED phase TDD - all tests should FAIL until implementation is done.
 */

// Test helpers
const encoder = new TextEncoder()

function createTestOid(prefix: string = 'a'): string {
  return prefix.repeat(40).slice(0, 40)
}

function createTestBundle(objects: Array<{ oid: string; type: BundleObjectType; data: Uint8Array }>): Uint8Array {
  return createBundle(objects)
}

/**
 * Creates a mock storage backend for testing
 */
function createMockStorage(bundles: Map<string, Uint8Array> = new Map()): StorageBackend {
  return {
    // File operations - used to read/write bundles
    readFile: vi.fn(async (path: string) => {
      return bundles.get(path) ?? null
    }),
    writeFile: vi.fn(async (_path: string, _content: Uint8Array) => {}),
    deleteFile: vi.fn(async (_path: string) => {}),
    exists: vi.fn(async (path: string) => bundles.has(path)),
    readdir: vi.fn(async (_path: string) => []),
    mkdir: vi.fn(async (_path: string, _options?: { recursive?: boolean }) => {}),

    // Object operations - not used by BundleReaderService directly
    putObject: vi.fn(async (_type, _content) => ''),
    getObject: vi.fn(async (_sha) => null),
    hasObject: vi.fn(async (_sha) => false),
    deleteObject: vi.fn(async (_sha) => {}),

    // Ref operations - not used by BundleReaderService
    getRef: vi.fn(async (_name) => null),
    setRef: vi.fn(async (_name, _ref) => {}),
    deleteRef: vi.fn(async (_name) => {}),
    listRefs: vi.fn(async (_prefix?: string) => [])
  }
}

describe('BundleReaderService', () => {
  describe('Creation from Storage', () => {
    it('should create BundleReaderService from storage backend', () => {
      const storage = createMockStorage()

      const reader = new BundleReaderService(storage)

      expect(reader).toBeDefined()
      expect(reader).toBeInstanceOf(BundleReaderService)
    })

    it('should accept options for cache configuration', () => {
      const storage = createMockStorage()
      const options: BundleReaderOptions = {
        maxCachedBundles: 10,
        maxCacheBytes: 50 * 1024 * 1024, // 50MB
        indexCacheTTL: 3600000 // 1 hour
      }

      const reader = new BundleReaderService(storage, options)

      expect(reader).toBeDefined()
    })

    it('should create with default options when none provided', () => {
      const storage = createMockStorage()

      const reader = new BundleReaderService(storage)

      // Should have reasonable defaults
      expect(reader.maxCachedBundles).toBeGreaterThan(0)
    })
  })

  describe('Object Lookup by OID', () => {
    it('should lookup object by OID and return correct data', async () => {
      const oid = createTestOid('a')
      const content = encoder.encode('hello world')
      const bundle = createTestBundle([
        { oid, type: BundleObjectType.BLOB, data: content }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      const result = await reader.readObject('bundles/test.bundle', oid)

      expect(result).toBeDefined()
      expect(result!.oid).toBe(oid)
      expect(result!.type).toBe(BundleObjectType.BLOB)
      expect(new TextDecoder().decode(result!.data)).toBe('hello world')
    })

    it('should return null for non-existent OID', async () => {
      const existingOid = createTestOid('a')
      const nonExistentOid = createTestOid('f')
      const bundle = createTestBundle([
        { oid: existingOid, type: BundleObjectType.BLOB, data: encoder.encode('test') }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      const result = await reader.readObject('bundles/test.bundle', nonExistentOid)

      expect(result).toBeNull()
    })

    it('should throw BundleNotFoundError for non-existent bundle', async () => {
      const storage = createMockStorage() // Empty storage
      const reader = new BundleReaderService(storage)

      await expect(
        reader.readObject('bundles/nonexistent.bundle', createTestOid('a'))
      ).rejects.toThrow(BundleNotFoundError)
    })

    it('should lookup object from bundle with multiple objects', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('one') },
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('two') },
        { oid: createTestOid('c'), type: BundleObjectType.BLOB, data: encoder.encode('three') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/multi.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Lookup middle object
      const result = await reader.readObject('bundles/multi.bundle', createTestOid('b'))

      expect(result).toBeDefined()
      expect(new TextDecoder().decode(result!.data)).toBe('two')
    })

    it('should handle objects of different types', async () => {
      const objects = [
        { oid: createTestOid('1'), type: BundleObjectType.BLOB, data: encoder.encode('blob') },
        { oid: createTestOid('2'), type: BundleObjectType.TREE, data: new Uint8Array([1, 2, 3]) },
        { oid: createTestOid('3'), type: BundleObjectType.COMMIT, data: encoder.encode('commit') },
        { oid: createTestOid('4'), type: BundleObjectType.TAG, data: encoder.encode('tag') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/types.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      const commit = await reader.readObject('bundles/types.bundle', createTestOid('3'))

      expect(commit).toBeDefined()
      expect(commit!.type).toBe(BundleObjectType.COMMIT)
    })
  })

  describe('Range Reads', () => {
    it('should return partial object data with range read', async () => {
      const oid = createTestOid('a')
      const content = encoder.encode('0123456789abcdef') // 16 bytes
      const bundle = createTestBundle([
        { oid, type: BundleObjectType.BLOB, data: content }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Read bytes 5-10 (inclusive start, exclusive end)
      const result = await reader.readObjectRange('bundles/test.bundle', oid, 5, 10)

      expect(result).toBeDefined()
      expect(result.data.length).toBe(5)
      expect(new TextDecoder().decode(result.data)).toBe('56789')
    })

    it('should return full object when range covers entire object', async () => {
      const oid = createTestOid('a')
      const content = encoder.encode('hello')
      const bundle = createTestBundle([
        { oid, type: BundleObjectType.BLOB, data: content }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Read from 0 to content length
      const result = await reader.readObjectRange('bundles/test.bundle', oid, 0, content.length)

      expect(result.data).toEqual(content)
    })

    it('should handle range read with only start offset', async () => {
      const oid = createTestOid('a')
      const content = encoder.encode('0123456789')
      const bundle = createTestBundle([
        { oid, type: BundleObjectType.BLOB, data: content }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Read from byte 7 to end
      const result = await reader.readObjectRange('bundles/test.bundle', oid, 7)

      expect(new TextDecoder().decode(result.data)).toBe('789')
    })

    it('should clamp range to object boundaries', async () => {
      const oid = createTestOid('a')
      const content = encoder.encode('short')
      const bundle = createTestBundle([
        { oid, type: BundleObjectType.BLOB, data: content }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Request more than available
      const result = await reader.readObjectRange('bundles/test.bundle', oid, 0, 1000)

      expect(result.data.length).toBe(5) // 'short'.length
      expect(result.truncated).toBe(true)
      expect(result.totalSize).toBe(5)
    })

    it('should return empty data for out-of-bounds start offset', async () => {
      const oid = createTestOid('a')
      const content = encoder.encode('hello')
      const bundle = createTestBundle([
        { oid, type: BundleObjectType.BLOB, data: content }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Start beyond content
      const result = await reader.readObjectRange('bundles/test.bundle', oid, 100, 200)

      expect(result.data.length).toBe(0)
      expect(result.totalSize).toBe(5)
    })

    it('should include metadata in range read result', async () => {
      const oid = createTestOid('a')
      const content = encoder.encode('0123456789')
      const bundle = createTestBundle([
        { oid, type: BundleObjectType.BLOB, data: content }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      const result: RangeReadResult = await reader.readObjectRange(
        'bundles/test.bundle',
        oid,
        2,
        6
      )

      expect(result.oid).toBe(oid)
      expect(result.type).toBe(BundleObjectType.BLOB)
      expect(result.totalSize).toBe(10)
      expect(result.offset).toBe(2)
      expect(result.data.length).toBe(4)
      expect(result.truncated).toBe(false)
    })

    it('should throw for non-existent OID in range read', async () => {
      const bundle = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('test') }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      await expect(
        reader.readObjectRange('bundles/test.bundle', createTestOid('z'), 0, 10)
      ).rejects.toThrow()
    })
  })

  describe('Batch Read Operations', () => {
    it('should batch read multiple objects in single call', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('alpha') },
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('beta') },
        { oid: createTestOid('c'), type: BundleObjectType.BLOB, data: encoder.encode('gamma') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      const oids = [createTestOid('a'), createTestOid('c')]
      const results = await reader.readObjectsBatch('bundles/test.bundle', oids)

      expect(results.length).toBe(2)
      expect(results.every(r => r !== null)).toBe(true)
    })

    it('should return objects in requested order', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('alpha') },
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('beta') },
        { oid: createTestOid('c'), type: BundleObjectType.BLOB, data: encoder.encode('gamma') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Request in reverse order
      const oids = [createTestOid('c'), createTestOid('a'), createTestOid('b')]
      const results = await reader.readObjectsBatch('bundles/test.bundle', oids)

      expect(results.length).toBe(3)
      expect(new TextDecoder().decode(results[0]!.data)).toBe('gamma')
      expect(new TextDecoder().decode(results[1]!.data)).toBe('alpha')
      expect(new TextDecoder().decode(results[2]!.data)).toBe('beta')
    })

    it('should handle missing objects in batch gracefully', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('exists') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Request existing and non-existing
      const oids = [createTestOid('a'), createTestOid('x'), createTestOid('y')]
      const results = await reader.readObjectsBatch('bundles/test.bundle', oids)

      expect(results.length).toBe(3)
      expect(results[0]).not.toBeNull()
      expect(results[1]).toBeNull() // Missing
      expect(results[2]).toBeNull() // Missing
    })

    it('should return empty array for empty OID list', async () => {
      const bundle = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('test') }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      const results = await reader.readObjectsBatch('bundles/test.bundle', [])

      expect(results).toEqual([])
    })

    it('should optimize batch read by reading bundle once', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('one') },
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('two') },
        { oid: createTestOid('c'), type: BundleObjectType.BLOB, data: encoder.encode('three') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      const oids = [createTestOid('a'), createTestOid('b'), createTestOid('c')]
      await reader.readObjectsBatch('bundles/test.bundle', oids)

      // Should only read the bundle file once
      expect(storage.readFile).toHaveBeenCalledTimes(1)
    })

    it('should handle duplicate OIDs in batch request', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('data') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Request same OID multiple times
      const oids = [createTestOid('a'), createTestOid('a'), createTestOid('a')]
      const results = await reader.readObjectsBatch('bundles/test.bundle', oids)

      expect(results.length).toBe(3)
      expect(results.every(r => r !== null && new TextDecoder().decode(r.data) === 'data')).toBe(true)
    })
  })

  describe('Index Caching', () => {
    it('should cache bundle index after first read', async () => {
      const bundle = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('test') }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // First read - should load bundle
      await reader.readObject('bundles/test.bundle', createTestOid('a'))

      // Second read - should use cached index
      await reader.readObject('bundles/test.bundle', createTestOid('a'))

      // Bundle should only be read once (index is cached)
      expect(storage.readFile).toHaveBeenCalledTimes(1)
    })

    it('should not re-read index on second lookup', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('one') },
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('two') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // First read
      await reader.readObject('bundles/test.bundle', createTestOid('a'))
      const readCount1 = (storage.readFile as any).mock.calls.length

      // Second read of different object in same bundle
      await reader.readObject('bundles/test.bundle', createTestOid('b'))
      const readCount2 = (storage.readFile as any).mock.calls.length

      // Index should be reused - no additional reads
      expect(readCount2).toBe(readCount1)
    })

    it('should cache multiple bundle indices', async () => {
      const bundle1 = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('bundle1') }
      ])
      const bundle2 = createTestBundle([
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('bundle2') }
      ])

      const bundles = new Map([
        ['bundles/one.bundle', bundle1],
        ['bundles/two.bundle', bundle2]
      ])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Read from both bundles
      await reader.readObject('bundles/one.bundle', createTestOid('a'))
      await reader.readObject('bundles/two.bundle', createTestOid('b'))

      // Read again from both
      await reader.readObject('bundles/one.bundle', createTestOid('a'))
      await reader.readObject('bundles/two.bundle', createTestOid('b'))

      // Each bundle should be read only once
      expect(storage.readFile).toHaveBeenCalledWith('bundles/one.bundle')
      expect(storage.readFile).toHaveBeenCalledWith('bundles/two.bundle')
      expect(storage.readFile).toHaveBeenCalledTimes(2)
    })

    it('should provide cache statistics', async () => {
      const bundle = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('test') }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Perform some reads
      await reader.readObject('bundles/test.bundle', createTestOid('a'))
      await reader.readObject('bundles/test.bundle', createTestOid('a'))
      await reader.readObject('bundles/test.bundle', createTestOid('z')) // miss

      const stats = reader.getCacheStats()

      expect(stats.hits).toBeGreaterThan(0)
      expect(stats.misses).toBeGreaterThan(0)
      expect(stats.bundleCount).toBe(1)
    })
  })

  describe('LRU Cache Eviction', () => {
    it('should evict least recently used bundle when cache is full', async () => {
      // Create multiple bundles
      const bundleA = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('A') }
      ])
      const bundleB = createTestBundle([
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('B') }
      ])
      const bundleC = createTestBundle([
        { oid: createTestOid('c'), type: BundleObjectType.BLOB, data: encoder.encode('C') }
      ])

      const bundles = new Map([
        ['bundles/a.bundle', bundleA],
        ['bundles/b.bundle', bundleB],
        ['bundles/c.bundle', bundleC]
      ])
      const storage = createMockStorage(bundles)

      // Create reader with max 2 cached bundles
      const reader = new BundleReaderService(storage, { maxCachedBundles: 2 })

      // Load A and B
      await reader.readObject('bundles/a.bundle', createTestOid('a'))
      await reader.readObject('bundles/b.bundle', createTestOid('b'))

      // Load C - should evict A (LRU)
      await reader.readObject('bundles/c.bundle', createTestOid('c'))

      // Reset mock to track new calls
      vi.mocked(storage.readFile).mockClear()

      // Access A again - should need to re-read (was evicted)
      await reader.readObject('bundles/a.bundle', createTestOid('a'))

      // B should still be cached (access C then A means B was more recent than A before C load)
      await reader.readObject('bundles/b.bundle', createTestOid('b'))

      // A was re-read (evicted), B might still be cached
      expect(storage.readFile).toHaveBeenCalledWith('bundles/a.bundle')
    })

    it('should update LRU order on access', async () => {
      const bundleA = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('A') }
      ])
      const bundleB = createTestBundle([
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('B') }
      ])
      const bundleC = createTestBundle([
        { oid: createTestOid('c'), type: BundleObjectType.BLOB, data: encoder.encode('C') }
      ])

      const bundles = new Map([
        ['bundles/a.bundle', bundleA],
        ['bundles/b.bundle', bundleB],
        ['bundles/c.bundle', bundleC]
      ])
      const storage = createMockStorage(bundles)

      const reader = new BundleReaderService(storage, { maxCachedBundles: 2 })

      // Load A, then B
      await reader.readObject('bundles/a.bundle', createTestOid('a'))
      await reader.readObject('bundles/b.bundle', createTestOid('b'))

      // Access A again - makes A most recently used
      await reader.readObject('bundles/a.bundle', createTestOid('a'))

      // Load C - should evict B (now LRU, not A)
      await reader.readObject('bundles/c.bundle', createTestOid('c'))

      vi.mocked(storage.readFile).mockClear()

      // A should still be cached
      await reader.readObject('bundles/a.bundle', createTestOid('a'))
      expect(storage.readFile).not.toHaveBeenCalledWith('bundles/a.bundle')

      // B should need to be re-read
      await reader.readObject('bundles/b.bundle', createTestOid('b'))
      expect(storage.readFile).toHaveBeenCalledWith('bundles/b.bundle')
    })

    it('should evict by byte size limit', async () => {
      // Create bundles of different sizes
      const smallBundle = createTestBundle([
        { oid: createTestOid('s'), type: BundleObjectType.BLOB, data: encoder.encode('small') }
      ])
      const largeData = new Uint8Array(10000)
      const largeBundle = createTestBundle([
        { oid: createTestOid('l'), type: BundleObjectType.BLOB, data: largeData }
      ])

      const bundles = new Map([
        ['bundles/small.bundle', smallBundle],
        ['bundles/large.bundle', largeBundle]
      ])
      const storage = createMockStorage(bundles)

      // Cache can only hold ~5000 bytes
      const reader = new BundleReaderService(storage, {
        maxCachedBundles: 100,
        maxCacheBytes: 5000
      })

      // Load small bundle
      await reader.readObject('bundles/small.bundle', createTestOid('s'))

      // Load large bundle - should evict small due to size
      await reader.readObject('bundles/large.bundle', createTestOid('l'))

      vi.mocked(storage.readFile).mockClear()

      // Small bundle should have been evicted
      await reader.readObject('bundles/small.bundle', createTestOid('s'))
      expect(storage.readFile).toHaveBeenCalledWith('bundles/small.bundle')
    })

    it('should allow manual cache clearing', async () => {
      const bundle = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('test') }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Load bundle
      await reader.readObject('bundles/test.bundle', createTestOid('a'))

      // Clear cache
      reader.clearCache()

      vi.mocked(storage.readFile).mockClear()

      // Should need to re-read
      await reader.readObject('bundles/test.bundle', createTestOid('a'))
      expect(storage.readFile).toHaveBeenCalledWith('bundles/test.bundle')
    })
  })

  describe('Concurrent Reads', () => {
    it('should handle concurrent reads from same bundle', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('alpha') },
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('beta') },
        { oid: createTestOid('c'), type: BundleObjectType.BLOB, data: encoder.encode('gamma') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Concurrent reads
      const [resultA, resultB, resultC] = await Promise.all([
        reader.readObject('bundles/test.bundle', createTestOid('a')),
        reader.readObject('bundles/test.bundle', createTestOid('b')),
        reader.readObject('bundles/test.bundle', createTestOid('c'))
      ])

      expect(resultA).toBeDefined()
      expect(resultB).toBeDefined()
      expect(resultC).toBeDefined()
      expect(new TextDecoder().decode(resultA!.data)).toBe('alpha')
      expect(new TextDecoder().decode(resultB!.data)).toBe('beta')
      expect(new TextDecoder().decode(resultC!.data)).toBe('gamma')
    })

    it('should only load bundle once for concurrent initial reads', async () => {
      const bundle = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('test') }
      ])

      // Add a small delay to storage read to simulate I/O
      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const originalReadFile = storage.readFile
      vi.mocked(storage.readFile).mockImplementation(async (path) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return originalReadFile(path)
      })

      const reader = new BundleReaderService(storage)

      // Start multiple concurrent reads before first completes
      const promises = [
        reader.readObject('bundles/test.bundle', createTestOid('a')),
        reader.readObject('bundles/test.bundle', createTestOid('a')),
        reader.readObject('bundles/test.bundle', createTestOid('a'))
      ]

      await Promise.all(promises)

      // Should coalesce into single read
      expect(storage.readFile).toHaveBeenCalledTimes(1)
    })

    it('should handle concurrent reads from different bundles', async () => {
      const bundle1 = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('one') }
      ])
      const bundle2 = createTestBundle([
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('two') }
      ])

      const bundles = new Map([
        ['bundles/one.bundle', bundle1],
        ['bundles/two.bundle', bundle2]
      ])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      const [result1, result2] = await Promise.all([
        reader.readObject('bundles/one.bundle', createTestOid('a')),
        reader.readObject('bundles/two.bundle', createTestOid('b'))
      ])

      expect(result1).toBeDefined()
      expect(result2).toBeDefined()
      expect(new TextDecoder().decode(result1!.data)).toBe('one')
      expect(new TextDecoder().decode(result2!.data)).toBe('two')
    })

    it('should not corrupt cache under concurrent access', async () => {
      const objects = []
      for (let i = 0; i < 100; i++) {
        objects.push({
          oid: i.toString(16).padStart(40, '0'),
          type: BundleObjectType.BLOB,
          data: encoder.encode(`object-${i}`)
        })
      }
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Many concurrent reads
      const promises: Promise<any>[] = []
      for (let i = 0; i < 100; i++) {
        const oid = i.toString(16).padStart(40, '0')
        promises.push(reader.readObject('bundles/test.bundle', oid))
      }

      const results = await Promise.all(promises)

      // All should succeed
      expect(results.every(r => r !== null)).toBe(true)

      // Verify data integrity
      for (let i = 0; i < 100; i++) {
        expect(new TextDecoder().decode(results[i].data)).toBe(`object-${i}`)
      }
    })
  })

  describe('Error Handling', () => {
    it('should throw BundleFormatError for corrupted bundle magic', async () => {
      const corruptedBundle = new Uint8Array(100)
      // Invalid magic bytes
      corruptedBundle[0] = 0xff

      const bundles = new Map([['bundles/corrupt.bundle', corruptedBundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      await expect(
        reader.readObject('bundles/corrupt.bundle', createTestOid('a'))
      ).rejects.toThrow(BundleFormatError)
    })

    it('should throw BundleCorruptedError for truncated bundle', async () => {
      const bundle = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('test') }
      ])
      // Truncate the bundle
      const truncated = bundle.slice(0, 50)

      const bundles = new Map([['bundles/truncated.bundle', truncated]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      await expect(
        reader.readObject('bundles/truncated.bundle', createTestOid('a'))
      ).rejects.toThrow()
    })

    it('should throw BundleReaderError for storage read failure', async () => {
      const storage = createMockStorage()
      vi.mocked(storage.readFile).mockRejectedValue(new Error('Storage error'))

      const reader = new BundleReaderService(storage)

      await expect(
        reader.readObject('bundles/test.bundle', createTestOid('a'))
      ).rejects.toThrow(BundleReaderError)
    })

    it('should handle corrupted index gracefully', async () => {
      const bundle = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('test') }
      ])
      // Corrupt the index portion (last part of bundle)
      const corrupted = new Uint8Array(bundle)
      const indexStart = bundle.length - 20
      for (let i = indexStart; i < bundle.length; i++) {
        corrupted[i] = 0xff
      }

      const bundles = new Map([['bundles/corrupt-index.bundle', corrupted]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      await expect(
        reader.readObject('bundles/corrupt-index.bundle', createTestOid('a'))
      ).rejects.toThrow()
    })

    it('should not cache bundles that fail to load', async () => {
      const storage = createMockStorage()
      let callCount = 0
      vi.mocked(storage.readFile).mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          throw new Error('Transient error')
        }
        return createTestBundle([
          { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('test') }
        ])
      })

      const reader = new BundleReaderService(storage)

      // First call fails
      await expect(
        reader.readObject('bundles/test.bundle', createTestOid('a'))
      ).rejects.toThrow()

      // Second call should retry (not use cached failure)
      const result = await reader.readObject('bundles/test.bundle', createTestOid('a'))
      expect(result).toBeDefined()
    })

    it('should handle invalid OID format', async () => {
      const bundle = createTestBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('test') }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const reader = new BundleReaderService(storage)

      // Invalid OID (too short)
      await expect(
        reader.readObject('bundles/test.bundle', 'invalid-oid')
      ).rejects.toThrow()

      // Invalid OID (non-hex)
      await expect(
        reader.readObject('bundles/test.bundle', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')
      ).rejects.toThrow()
    })
  })

  describe('Integration with BundleReader', () => {
    it('should use BundleReader internally for object access', async () => {
      const content = encoder.encode('integration test')
      const oid = createTestOid('x')
      const bundle = createTestBundle([
        { oid, type: BundleObjectType.BLOB, data: content }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const service = new BundleReaderService(storage)

      const result = await service.readObject('bundles/test.bundle', oid)

      // Result should match what BundleReader would return
      const directReader = new BundleReader(bundle)
      const directResult = directReader.readObject(oid)

      expect(result!.data).toEqual(directResult!.data)
      expect(result!.type).toEqual(directResult!.type)
    })

    it('should list all OIDs in a bundle', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('one') },
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: encoder.encode('two') },
        { oid: createTestOid('c'), type: BundleObjectType.BLOB, data: encoder.encode('three') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const service = new BundleReaderService(storage)

      const oids = await service.listOids('bundles/test.bundle')

      expect(oids.length).toBe(3)
      expect(oids).toContain(createTestOid('a'))
      expect(oids).toContain(createTestOid('b'))
      expect(oids).toContain(createTestOid('c'))
    })

    it('should check if OID exists in bundle', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: encoder.encode('exists') }
      ]
      const bundle = createTestBundle(objects)

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const service = new BundleReaderService(storage)

      expect(await service.hasObject('bundles/test.bundle', createTestOid('a'))).toBe(true)
      expect(await service.hasObject('bundles/test.bundle', createTestOid('z'))).toBe(false)
    })

    it('should get entry metadata without full data', async () => {
      const content = encoder.encode('test content here')
      const oid = createTestOid('m')
      const bundle = createTestBundle([
        { oid, type: BundleObjectType.COMMIT, data: content }
      ])

      const bundles = new Map([['bundles/test.bundle', bundle]])
      const storage = createMockStorage(bundles)
      const service = new BundleReaderService(storage)

      const entry = await service.getEntry('bundles/test.bundle', oid)

      expect(entry).toBeDefined()
      expect(entry!.oid).toBe(oid)
      expect(entry!.type).toBe(BundleObjectType.COMMIT)
      expect(entry!.size).toBe(content.length)
    })
  })
})
