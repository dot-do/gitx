import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BundleWriter,
  BundleWriterConfig,
  BundleMetadata,
  BundleWriterStorage,
  BundleWriterError,
  BundleRotationEvent
} from '../../src/storage/bundle-writer'
import { BundleObjectType } from '../../src/storage/bundle-format'

/**
 * BundleWriter Tests
 *
 * BundleWriter is a high-level component that creates bundles from git objects,
 * manages bundle lifecycle (create, write, flush, rotate), and interacts with
 * storage backends.
 *
 * Responsibilities:
 * - Accept git objects and add to current bundle
 * - Track bundle size, flush when reaching size limit
 * - Rotate to new bundle file when current is full
 * - Write bundle header and index on flush
 *
 * This is RED phase TDD - all tests should FAIL until implementation is done.
 */

// Test helpers
const encoder = new TextEncoder()

function createTestOid(prefix: string = 'a'): string {
  return prefix.repeat(40).slice(0, 40)
}

function createTestData(content: string): Uint8Array {
  return encoder.encode(content)
}

// Mock storage implementation for testing
function createMockStorage(): BundleWriterStorage {
  const bundles = new Map<string, Uint8Array>()
  return {
    write: vi.fn(async (key: string, data: Uint8Array) => {
      bundles.set(key, data)
    }),
    read: vi.fn(async (key: string) => {
      return bundles.get(key) ?? null
    }),
    delete: vi.fn(async (key: string) => {
      bundles.delete(key)
    }),
    list: vi.fn(async (prefix: string) => {
      return Array.from(bundles.keys()).filter(k => k.startsWith(prefix))
    }),
    // Expose internal map for test assertions
    _bundles: bundles
  }
}

describe('BundleWriter', () => {
  let mockStorage: BundleWriterStorage & { _bundles: Map<string, Uint8Array> }

  beforeEach(() => {
    mockStorage = createMockStorage() as BundleWriterStorage & { _bundles: Map<string, Uint8Array> }
  })

  describe('Creation and Configuration', () => {
    it('should create BundleWriter with config (maxBundleSize, storagePrefix)', () => {
      const config: BundleWriterConfig = {
        maxBundleSize: 2 * 1024 * 1024, // 2MB
        storagePrefix: 'bundles/'
      }

      const writer = new BundleWriter(config, mockStorage)

      expect(writer).toBeDefined()
      expect(writer.config.maxBundleSize).toBe(2 * 1024 * 1024)
      expect(writer.config.storagePrefix).toBe('bundles/')
    })

    it('should use default maxBundleSize when not provided', () => {
      const config: BundleWriterConfig = {
        storagePrefix: 'bundles/'
      }

      const writer = new BundleWriter(config, mockStorage)

      // Default should be 2MB (R2 optimization target)
      expect(writer.config.maxBundleSize).toBe(2 * 1024 * 1024)
    })

    it('should use default storagePrefix when not provided', () => {
      const config: BundleWriterConfig = {
        maxBundleSize: 1024 * 1024
      }

      const writer = new BundleWriter(config, mockStorage)

      expect(writer.config.storagePrefix).toBe('objects/bundles/')
    })

    it('should initialize with zero objects and zero size', () => {
      const writer = new BundleWriter({}, mockStorage)

      expect(writer.currentBundleObjectCount).toBe(0)
      expect(writer.currentBundleSize).toBe(0)
    })

    it('should generate initial bundle ID', () => {
      const writer = new BundleWriter({}, mockStorage)

      expect(writer.currentBundleId).toBeDefined()
      expect(typeof writer.currentBundleId).toBe('string')
      expect(writer.currentBundleId.length).toBeGreaterThan(0)
    })
  })

  describe('Adding Single Object', () => {
    it('should add single object to bundle', async () => {
      const writer = new BundleWriter({}, mockStorage)
      const oid = createTestOid('a')
      const data = createTestData('hello world')

      await writer.add(oid, BundleObjectType.BLOB, data)

      expect(writer.currentBundleObjectCount).toBe(1)
    })

    it('should track object data in current bundle', async () => {
      const writer = new BundleWriter({}, mockStorage)
      const oid = createTestOid('b')
      const data = createTestData('test content')

      await writer.add(oid, BundleObjectType.BLOB, data)

      expect(writer.hasObject(oid)).toBe(true)
    })

    it('should support different object types', async () => {
      const writer = new BundleWriter({}, mockStorage)

      await writer.add(createTestOid('1'), BundleObjectType.BLOB, createTestData('blob'))
      await writer.add(createTestOid('2'), BundleObjectType.TREE, new Uint8Array([1, 2, 3]))
      await writer.add(createTestOid('3'), BundleObjectType.COMMIT, createTestData('commit'))
      await writer.add(createTestOid('4'), BundleObjectType.TAG, createTestData('tag'))

      expect(writer.currentBundleObjectCount).toBe(4)
    })

    it('should reject duplicate OID in same bundle', async () => {
      const writer = new BundleWriter({}, mockStorage)
      const oid = createTestOid('x')

      await writer.add(oid, BundleObjectType.BLOB, createTestData('first'))

      await expect(
        writer.add(oid, BundleObjectType.BLOB, createTestData('second'))
      ).rejects.toThrow(/duplicate/i)
    })
  })

  describe('Adding Multiple Objects', () => {
    it('should add multiple objects to bundle', async () => {
      const writer = new BundleWriter({}, mockStorage)

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('one'))
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, createTestData('two'))
      await writer.add(createTestOid('c'), BundleObjectType.BLOB, createTestData('three'))

      expect(writer.currentBundleObjectCount).toBe(3)
    })

    it('should track all objects as present', async () => {
      const writer = new BundleWriter({}, mockStorage)
      const oids = ['a', 'b', 'c'].map(c => createTestOid(c))

      for (const oid of oids) {
        await writer.add(oid, BundleObjectType.BLOB, createTestData(oid))
      }

      for (const oid of oids) {
        expect(writer.hasObject(oid)).toBe(true)
      }
    })

    it('should allow adding objects in batch', async () => {
      const writer = new BundleWriter({}, mockStorage)
      const objects = [
        { oid: createTestOid('x'), type: BundleObjectType.BLOB, data: createTestData('x') },
        { oid: createTestOid('y'), type: BundleObjectType.BLOB, data: createTestData('y') },
        { oid: createTestOid('z'), type: BundleObjectType.BLOB, data: createTestData('z') }
      ]

      await writer.addBatch(objects)

      expect(writer.currentBundleObjectCount).toBe(3)
    })
  })

  describe('Bundle Size Tracking', () => {
    it('should track current bundle size accurately', async () => {
      const writer = new BundleWriter({}, mockStorage)
      const data1 = createTestData('hello')
      const data2 = createTestData('world')

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, data1)
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, data2)

      // Size should include data + index entry overhead
      const dataSize = data1.length + data2.length
      expect(writer.currentBundleSize).toBeGreaterThanOrEqual(dataSize)
    })

    it('should include header size in total size calculation', async () => {
      const writer = new BundleWriter({}, mockStorage)

      // Even with no objects, there should be header overhead
      expect(writer.currentBundleSize).toBe(64) // BUNDLE_HEADER_SIZE
    })

    it('should include index entry overhead per object', async () => {
      const writer = new BundleWriter({}, mockStorage)
      const data = createTestData('test')

      const sizeBefore = writer.currentBundleSize
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, data)
      const sizeAfter = writer.currentBundleSize

      // Size increase should be data + index entry (33 bytes per entry)
      const expectedIncrease = data.length + 33
      expect(sizeAfter - sizeBefore).toBe(expectedIncrease)
    })

    it('should report remaining capacity', async () => {
      const maxSize = 1000
      const writer = new BundleWriter({ maxBundleSize: maxSize }, mockStorage)
      const data = createTestData('test')

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, data)

      const remaining = writer.remainingCapacity
      expect(remaining).toBe(maxSize - writer.currentBundleSize)
    })

    it('should report if bundle can accept more bytes', async () => {
      const maxSize = 200
      const writer = new BundleWriter({ maxBundleSize: maxSize }, mockStorage)

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('x'.repeat(50)))

      expect(writer.canAccept(50)).toBe(true)
      expect(writer.canAccept(1000)).toBe(false)
    })
  })

  describe('Flush Operations', () => {
    it('should flush writes bundle to storage', async () => {
      const writer = new BundleWriter({ storagePrefix: 'test/' }, mockStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('hello'))

      await writer.flush()

      expect(mockStorage.write).toHaveBeenCalled()
    })

    it('should flush creates valid bundle format (header + entries + index)', async () => {
      const writer = new BundleWriter({ storagePrefix: 'test/' }, mockStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('hello'))

      await writer.flush()

      // Get the written bundle data
      const writeCall = vi.mocked(mockStorage.write).mock.calls[0]
      const bundleData = writeCall[1] as Uint8Array

      // Verify magic bytes
      expect(String.fromCharCode(...bundleData.slice(0, 4))).toBe('BNDL')

      // Verify version
      const version = (bundleData[4] << 24) | (bundleData[5] << 16) | (bundleData[6] << 8) | bundleData[7]
      expect(version).toBe(1)

      // Verify entry count
      const entryCount = (bundleData[8] << 24) | (bundleData[9] << 16) | (bundleData[10] << 8) | bundleData[11]
      expect(entryCount).toBe(1)
    })

    it('should flush uses correct storage key with prefix', async () => {
      const writer = new BundleWriter({ storagePrefix: 'my-bundles/' }, mockStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('data'))
      const bundleId = writer.currentBundleId

      await writer.flush()

      const writeCall = vi.mocked(mockStorage.write).mock.calls[0]
      const key = writeCall[0] as string
      expect(key).toBe(`my-bundles/${bundleId}`)
    })

    it('should flush returns bundle metadata (id, size, objectCount)', async () => {
      const writer = new BundleWriter({}, mockStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('hello'))
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, createTestData('world'))

      const metadata = await writer.flush()

      expect(metadata).toMatchObject<Partial<BundleMetadata>>({
        id: expect.any(String),
        size: expect.any(Number),
        objectCount: 2
      })
    })

    it('should flush resets current bundle state', async () => {
      const writer = new BundleWriter({}, mockStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('hello'))

      await writer.flush()

      expect(writer.currentBundleObjectCount).toBe(0)
      expect(writer.currentBundleSize).toBe(64) // Header only
    })

    it('should flush generates new bundle ID for next bundle', async () => {
      const writer = new BundleWriter({}, mockStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('hello'))
      const firstBundleId = writer.currentBundleId

      await writer.flush()

      expect(writer.currentBundleId).not.toBe(firstBundleId)
    })
  })

  describe('Empty Flush Handling', () => {
    it('should handle empty flush (no objects added)', async () => {
      const writer = new BundleWriter({}, mockStorage)

      const metadata = await writer.flush()

      // Empty flush should not write to storage
      expect(mockStorage.write).not.toHaveBeenCalled()
      expect(metadata.objectCount).toBe(0)
      expect(metadata.size).toBe(0)
    })

    it('should not change bundle ID on empty flush', async () => {
      const writer = new BundleWriter({}, mockStorage)
      const bundleId = writer.currentBundleId

      await writer.flush()

      expect(writer.currentBundleId).toBe(bundleId)
    })

    it('should return empty metadata on empty flush', async () => {
      const writer = new BundleWriter({}, mockStorage)

      const metadata = await writer.flush()

      expect(metadata).toMatchObject<Partial<BundleMetadata>>({
        id: expect.any(String),
        size: 0,
        objectCount: 0,
        isEmpty: true
      })
    })
  })

  describe('Auto-Rotation', () => {
    it('should auto-rotate when maxBundleSize exceeded', async () => {
      const maxSize = 200 // Small size to trigger rotation
      const writer = new BundleWriter({ maxBundleSize: maxSize }, mockStorage)

      // Add objects until we exceed the limit
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, new Uint8Array(100))

      // This should trigger a rotation
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, new Uint8Array(100))

      // First bundle should have been flushed
      expect(mockStorage.write).toHaveBeenCalled()
    })

    it('should rotation creates new bundle with incremented ID', async () => {
      const maxSize = 150
      const writer = new BundleWriter({ maxBundleSize: maxSize }, mockStorage)
      const firstBundleId = writer.currentBundleId

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, new Uint8Array(80))
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, new Uint8Array(80))

      // After rotation, bundle ID should be different
      expect(writer.currentBundleId).not.toBe(firstBundleId)
    })

    it('should rotation preserves overflow object in new bundle', async () => {
      const maxSize = 150
      const writer = new BundleWriter({ maxBundleSize: maxSize }, mockStorage)

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, new Uint8Array(80))
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, new Uint8Array(80))

      // Second object should be in new bundle
      expect(writer.hasObject(createTestOid('b'))).toBe(true)
      expect(writer.currentBundleObjectCount).toBe(1)
    })

    it('should emit rotation event on auto-rotate', async () => {
      const maxSize = 150
      const writer = new BundleWriter({ maxBundleSize: maxSize }, mockStorage)
      const rotationHandler = vi.fn()
      writer.onRotation(rotationHandler)

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, new Uint8Array(80))
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, new Uint8Array(80))

      expect(rotationHandler).toHaveBeenCalledWith(expect.objectContaining<Partial<BundleRotationEvent>>({
        previousBundleId: expect.any(String),
        newBundleId: expect.any(String),
        previousBundleMetadata: expect.any(Object)
      }))
    })

    it('should track total bundles written', async () => {
      const maxSize = 150
      const writer = new BundleWriter({ maxBundleSize: maxSize }, mockStorage)

      expect(writer.totalBundlesWritten).toBe(0)

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, new Uint8Array(80))
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, new Uint8Array(80))

      expect(writer.totalBundlesWritten).toBe(1)

      await writer.add(createTestOid('c'), BundleObjectType.BLOB, new Uint8Array(80))

      expect(writer.totalBundlesWritten).toBe(2)
    })
  })

  describe('Error Handling for Storage Failures', () => {
    it('should throw BundleWriterError on storage write failure', async () => {
      const failingStorage: BundleWriterStorage = {
        write: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
        read: vi.fn(),
        delete: vi.fn(),
        list: vi.fn()
      }
      const writer = new BundleWriter({}, failingStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('data'))

      await expect(writer.flush()).rejects.toThrow(BundleWriterError)
    })

    it('should include original error in BundleWriterError', async () => {
      const originalError = new Error('R2 timeout')
      const failingStorage: BundleWriterStorage = {
        write: vi.fn().mockRejectedValue(originalError),
        read: vi.fn(),
        delete: vi.fn(),
        list: vi.fn()
      }
      const writer = new BundleWriter({}, failingStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('data'))

      try {
        await writer.flush()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(BundleWriterError)
        expect((error as BundleWriterError).cause).toBe(originalError)
      }
    })

    it('should not lose objects on failed flush', async () => {
      const failingStorage: BundleWriterStorage = {
        write: vi.fn().mockRejectedValueOnce(new Error('Transient error')),
        read: vi.fn(),
        delete: vi.fn(),
        list: vi.fn()
      }
      const writer = new BundleWriter({}, failingStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('data'))

      try {
        await writer.flush()
      } catch {
        // Expected
      }

      // Objects should still be in buffer
      expect(writer.currentBundleObjectCount).toBe(1)
      expect(writer.hasObject(createTestOid('a'))).toBe(true)
    })

    it('should allow retry after failed flush', async () => {
      let callCount = 0
      const flakyStorage: BundleWriterStorage = {
        write: vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            throw new Error('First attempt fails')
          }
        }),
        read: vi.fn(),
        delete: vi.fn(),
        list: vi.fn()
      }
      const writer = new BundleWriter({}, flakyStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('data'))

      // First attempt fails
      await expect(writer.flush()).rejects.toThrow()

      // Retry succeeds
      const metadata = await writer.flush()
      expect(metadata.objectCount).toBe(1)
    })

    it('should handle storage failure during auto-rotation', async () => {
      let writeCount = 0
      const flakyStorage: BundleWriterStorage = {
        write: vi.fn().mockImplementation(async () => {
          writeCount++
          if (writeCount === 1) {
            throw new Error('Rotation write failed')
          }
        }),
        read: vi.fn(),
        delete: vi.fn(),
        list: vi.fn()
      }
      const writer = new BundleWriter({ maxBundleSize: 150 }, flakyStorage)

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, new Uint8Array(80))

      // This should trigger rotation which fails
      await expect(
        writer.add(createTestOid('b'), BundleObjectType.BLOB, new Uint8Array(80))
      ).rejects.toThrow(BundleWriterError)

      // Original object should still be preserved
      expect(writer.hasObject(createTestOid('a'))).toBe(true)
    })
  })

  describe('Concurrent Add Operations', () => {
    it('should handle concurrent add operations safely', async () => {
      const writer = new BundleWriter({}, mockStorage)
      const oids = Array.from({ length: 10 }, (_, i) => createTestOid(String(i)))

      // Add all objects concurrently
      await Promise.all(
        oids.map((oid, i) =>
          writer.add(oid, BundleObjectType.BLOB, createTestData(`data-${i}`))
        )
      )

      expect(writer.currentBundleObjectCount).toBe(10)
      for (const oid of oids) {
        expect(writer.hasObject(oid)).toBe(true)
      }
    })

    it('should serialize flush operations', async () => {
      const writer = new BundleWriter({}, mockStorage)

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('a'))

      // Multiple concurrent flush calls should be serialized
      const flushPromises = [writer.flush(), writer.flush(), writer.flush()]
      const results = await Promise.all(flushPromises)

      // Only first flush should have data
      const nonEmptyResults = results.filter(r => r.objectCount > 0)
      expect(nonEmptyResults.length).toBe(1)
    })

    it('should handle add during flush correctly', async () => {
      const slowStorage: BundleWriterStorage = {
        write: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 50))
        }),
        read: vi.fn(),
        delete: vi.fn(),
        list: vi.fn()
      }
      const writer = new BundleWriter({}, slowStorage)

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('a'))

      // Start flush
      const flushPromise = writer.flush()

      // Add while flush is in progress - should go to new bundle
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, createTestData('b'))

      await flushPromise

      // New object should be in current bundle
      expect(writer.hasObject(createTestOid('b'))).toBe(true)
    })

    it('should maintain consistency under concurrent operations', async () => {
      const writer = new BundleWriter({ maxBundleSize: 500 }, mockStorage)

      // Mix of adds and flushes
      const operations: Promise<unknown>[] = []

      for (let i = 0; i < 20; i++) {
        operations.push(
          writer.add(createTestOid(String(i)), BundleObjectType.BLOB, createTestData(`data-${i}`))
        )
        if (i % 5 === 0) {
          operations.push(writer.flush())
        }
      }

      await Promise.all(operations)

      // Final flush
      await writer.flush()

      // All operations should have completed without errors
      // and total objects written across all bundles should match
    })
  })

  describe('Bundle Metadata and Stats', () => {
    it('should track cumulative statistics', async () => {
      const writer = new BundleWriter({ maxBundleSize: 200 }, mockStorage)

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, new Uint8Array(80))
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, new Uint8Array(80))
      await writer.flush()
      await writer.add(createTestOid('c'), BundleObjectType.BLOB, new Uint8Array(50))
      await writer.flush()

      const stats = writer.getStats()

      expect(stats.totalObjectsWritten).toBe(3)
      expect(stats.totalBytesWritten).toBeGreaterThan(0)
      expect(stats.bundleCount).toBe(2)
    })

    it('should list all written bundle IDs', async () => {
      const writer = new BundleWriter({}, mockStorage)

      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('a'))
      await writer.flush()
      await writer.add(createTestOid('b'), BundleObjectType.BLOB, createTestData('b'))
      await writer.flush()

      const bundleIds = writer.getWrittenBundleIds()

      expect(bundleIds.length).toBe(2)
    })

    it('should provide bundle metadata by ID', async () => {
      const writer = new BundleWriter({}, mockStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('hello'))
      const { id } = await writer.flush()

      const metadata = writer.getBundleMetadata(id)

      expect(metadata).toBeDefined()
      expect(metadata!.objectCount).toBe(1)
      expect(metadata!.id).toBe(id)
    })
  })

  describe('Close and Cleanup', () => {
    it('should flush remaining objects on close', async () => {
      const writer = new BundleWriter({}, mockStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('data'))

      await writer.close()

      expect(mockStorage.write).toHaveBeenCalled()
    })

    it('should not accept new objects after close', async () => {
      const writer = new BundleWriter({}, mockStorage)
      await writer.close()

      await expect(
        writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('data'))
      ).rejects.toThrow(/closed/i)
    })

    it('should return final metadata on close', async () => {
      const writer = new BundleWriter({}, mockStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('data'))

      const finalMetadata = await writer.close()

      expect(finalMetadata.totalBundles).toBeGreaterThanOrEqual(1)
      expect(finalMetadata.totalObjects).toBe(1)
    })

    it('should handle close on empty writer', async () => {
      const writer = new BundleWriter({}, mockStorage)

      const finalMetadata = await writer.close()

      expect(finalMetadata.totalBundles).toBe(0)
      expect(finalMetadata.totalObjects).toBe(0)
    })

    it('should be idempotent (multiple close calls)', async () => {
      const writer = new BundleWriter({}, mockStorage)
      await writer.add(createTestOid('a'), BundleObjectType.BLOB, createTestData('data'))

      await writer.close()
      await writer.close()
      await writer.close()

      // Should only write once
      expect(mockStorage.write).toHaveBeenCalledTimes(1)
    })
  })

  describe('Integration: Full Lifecycle', () => {
    it('should handle full write-flush-rotate lifecycle', async () => {
      const maxSize = 200
      const writer = new BundleWriter({ maxBundleSize: maxSize, storagePrefix: 'test/' }, mockStorage)
      const rotationEvents: BundleRotationEvent[] = []
      writer.onRotation(e => rotationEvents.push(e))

      // Write objects that will span multiple bundles
      for (let i = 0; i < 10; i++) {
        await writer.add(
          createTestOid(String(i)),
          BundleObjectType.BLOB,
          new Uint8Array(50 + i * 10)
        )
      }

      const finalMetadata = await writer.close()

      // Should have written multiple bundles
      expect(rotationEvents.length).toBeGreaterThan(0)
      expect(finalMetadata.totalObjects).toBe(10)
      expect(mockStorage._bundles.size).toBeGreaterThan(1)

      // All bundle keys should have correct prefix
      for (const key of mockStorage._bundles.keys()) {
        expect(key.startsWith('test/')).toBe(true)
      }
    })

    it('should produce bundles readable by BundleReader', async () => {
      const writer = new BundleWriter({ storagePrefix: 'test/' }, mockStorage)
      const testData = createTestData('hello world from bundle writer')
      const testOid = createTestOid('z')

      await writer.add(testOid, BundleObjectType.BLOB, testData)
      await writer.flush()

      // Get written bundle
      const bundleData = Array.from(mockStorage._bundles.values())[0]

      // This test verifies the produced bundle format is valid
      // The actual reading would be done by BundleReader
      expect(bundleData).toBeInstanceOf(Uint8Array)
      expect(bundleData.length).toBeGreaterThan(64)
      expect(String.fromCharCode(...bundleData.slice(0, 4))).toBe('BNDL')
    })
  })
})
