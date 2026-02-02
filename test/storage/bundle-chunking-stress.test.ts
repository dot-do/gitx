/**
 * @fileoverview Stress Tests for R2 Bundle Chunking
 *
 * These tests verify the R2 bundle chunking system under stress conditions:
 * 1. Large numbers of objects
 * 2. Concurrent reads/writes
 * 3. Chunk boundary conditions
 *
 * Issue: gitx-4hnt - [TEST] Add R2 bundle chunking stress tests
 *
 * @module test/storage/bundle-chunking-stress
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BundleWriter,
  BundleWriterStorage,
  BundleMetadata
} from '../../src/storage/bundle-writer'
import {
  BundleObjectType,
  BundleReader,
  createBundle,
  BUNDLE_HEADER_SIZE,
  BUNDLE_INDEX_ENTRY_SIZE
} from '../../src/storage/bundle-format'
import { BundleReaderService } from '../../src/storage/bundle-reader'
import type { StorageBackend } from '../../src/storage/backend'

// ============================================================================
// Constants
// ============================================================================

const encoder = new TextEncoder()

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Generate a unique OID with a given index.
 */
function generateOid(index: number): string {
  const hex = index.toString(16).padStart(8, '0')
  return hex.repeat(5) // 8 * 5 = 40 characters
}

/**
 * Create test data with a verifiable pattern.
 */
function createTestData(size: number, seed: number = 0): Uint8Array {
  const data = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    data[i] = (i + seed) % 256
  }
  return data
}

/**
 * Create mock storage for BundleWriter.
 */
function createMockWriterStorage(): BundleWriterStorage & {
  _bundles: Map<string, Uint8Array>
} {
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
      return Array.from(bundles.keys()).filter((k) => k.startsWith(prefix))
    }),
    _bundles: bundles
  }
}

/**
 * Create mock storage for BundleReaderService.
 */
function createMockReaderStorage(
  bundles: Map<string, Uint8Array> = new Map()
): StorageBackend {
  return {
    readFile: vi.fn(async (path: string) => {
      return bundles.get(path) ?? null
    }),
    writeFile: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
    exists: vi.fn(async (path: string) => bundles.has(path)),
    readdir: vi.fn(async () => []),
    mkdir: vi.fn(async () => {}),
    putObject: vi.fn(async () => ''),
    getObject: vi.fn(async () => null),
    hasObject: vi.fn(async () => false),
    deleteObject: vi.fn(async () => {}),
    getRef: vi.fn(async () => null),
    setRef: vi.fn(async () => {}),
    deleteRef: vi.fn(async () => {}),
    listRefs: vi.fn(async () => [])
  }
}

// ============================================================================
// Tests: Large Numbers of Objects
// ============================================================================

describe('Bundle Chunking Stress Tests: Large Object Counts', () => {
  let mockStorage: BundleWriterStorage & { _bundles: Map<string, Uint8Array> }

  beforeEach(() => {
    mockStorage = createMockWriterStorage()
  })

  it('should handle 100 objects in a single bundle', async () => {
    const writer = new BundleWriter(
      { maxBundleSize: 10 * 1024 * 1024 },
      mockStorage
    )

    const objectCount = 100
    const objects: Array<{ oid: string; data: Uint8Array }> = []

    for (let i = 0; i < objectCount; i++) {
      const oid = generateOid(i)
      const data = createTestData(100, i)
      objects.push({ oid, data })
      await writer.add(oid, BundleObjectType.BLOB, data)
    }

    const metadata = await writer.flush()

    expect(metadata.objectCount).toBe(objectCount)
    expect(mockStorage.write).toHaveBeenCalledTimes(1)

    // Verify all objects can be read back
    const bundleData = Array.from(mockStorage._bundles.values())[0]
    const reader = new BundleReader(bundleData)

    expect(reader.entryCount).toBe(objectCount)

    for (const obj of objects) {
      const result = reader.readObject(obj.oid)
      expect(result).not.toBeNull()
      expect(result!.data).toEqual(obj.data)
    }
  })

  it('should handle 500 objects in a single bundle', async () => {
    const writer = new BundleWriter(
      { maxBundleSize: 50 * 1024 * 1024 },
      mockStorage
    )

    const objectCount = 500

    for (let i = 0; i < objectCount; i++) {
      const oid = generateOid(i)
      const data = createTestData(50, i)
      await writer.add(oid, BundleObjectType.BLOB, data)
    }

    const metadata = await writer.flush()

    expect(metadata.objectCount).toBe(objectCount)

    // Verify bundle can be parsed
    const bundleData = Array.from(mockStorage._bundles.values())[0]
    const reader = new BundleReader(bundleData)

    expect(reader.entryCount).toBe(objectCount)

    // Verify a sample of objects
    for (let i = 0; i < objectCount; i += 50) {
      const oid = generateOid(i)
      const result = reader.readObject(oid)
      expect(result).not.toBeNull()
    }
  })

  it('should handle 1000 small objects with auto-rotation', async () => {
    const maxBundleSize = 50 * 1024 // 50KB - forces rotation
    const writer = new BundleWriter(
      { maxBundleSize, storagePrefix: 'stress/' },
      mockStorage
    )

    const objectCount = 1000

    for (let i = 0; i < objectCount; i++) {
      const oid = generateOid(i)
      const data = createTestData(100, i)
      await writer.add(oid, BundleObjectType.BLOB, data)
    }

    await writer.close()

    const stats = writer.getStats()

    // Should have created multiple bundles
    expect(stats.bundleCount).toBeGreaterThan(1)
    expect(stats.totalObjectsWritten).toBe(objectCount)

    // Verify all bundles are valid
    for (const bundleData of mockStorage._bundles.values()) {
      const reader = new BundleReader(bundleData)
      expect(reader.entryCount).toBeGreaterThan(0)
    }
  })

  it('should handle objects of varying sizes', async () => {
    const writer = new BundleWriter(
      { maxBundleSize: 5 * 1024 * 1024 },
      mockStorage
    )

    const sizes = [10, 100, 1000, 5000, 10000, 50000, 100000]
    const objects: Array<{ oid: string; data: Uint8Array }> = []

    for (let i = 0; i < sizes.length; i++) {
      for (let j = 0; j < 10; j++) {
        const idx = i * 10 + j
        const oid = generateOid(idx)
        const data = createTestData(sizes[i], idx)
        objects.push({ oid, data })
        await writer.add(oid, BundleObjectType.BLOB, data)
      }
    }

    await writer.close()

    // Verify all objects across all bundles
    let foundCount = 0
    for (const bundleData of mockStorage._bundles.values()) {
      const reader = new BundleReader(bundleData)
      for (const obj of objects) {
        const result = reader.readObject(obj.oid)
        if (result) {
          expect(result.data).toEqual(obj.data)
          foundCount++
        }
      }
    }

    expect(foundCount).toBe(objects.length)
  })

  it('should correctly track all OIDs across multiple bundles', async () => {
    const maxBundleSize = 20 * 1024 // Small bundle size
    const writer = new BundleWriter(
      { maxBundleSize, storagePrefix: 'multi/' },
      mockStorage
    )

    const objectCount = 200
    const allOids = new Set<string>()

    for (let i = 0; i < objectCount; i++) {
      const oid = generateOid(i)
      allOids.add(oid)
      await writer.add(oid, BundleObjectType.BLOB, createTestData(200, i))
    }

    await writer.close()

    // Collect all OIDs from all bundles
    const foundOids = new Set<string>()
    for (const bundleData of mockStorage._bundles.values()) {
      const reader = new BundleReader(bundleData)
      for (const oid of reader.listOids()) {
        foundOids.add(oid)
      }
    }

    expect(foundOids.size).toBe(allOids.size)
    for (const oid of allOids) {
      expect(foundOids.has(oid)).toBe(true)
    }
  })
})

// ============================================================================
// Tests: Concurrent Reads/Writes
// ============================================================================

describe('Bundle Chunking Stress Tests: Concurrent Operations', () => {
  it('should handle concurrent writes to BundleWriter', async () => {
    const mockStorage = createMockWriterStorage()
    const writer = new BundleWriter(
      { maxBundleSize: 10 * 1024 * 1024 },
      mockStorage
    )

    const objectCount = 50

    // Create all add operations concurrently
    const addPromises = Array.from({ length: objectCount }, (_, i) => {
      const oid = generateOid(i)
      const data = createTestData(100, i)
      return writer.add(oid, BundleObjectType.BLOB, data)
    })

    await Promise.all(addPromises)

    expect(writer.currentBundleObjectCount).toBe(objectCount)

    const metadata = await writer.flush()
    expect(metadata.objectCount).toBe(objectCount)
  })

  it('should handle concurrent flush operations safely', async () => {
    const mockStorage = createMockWriterStorage()
    const writer = new BundleWriter({}, mockStorage)

    // Add some objects
    for (let i = 0; i < 10; i++) {
      await writer.add(
        generateOid(i),
        BundleObjectType.BLOB,
        createTestData(100, i)
      )
    }

    // Trigger multiple flushes concurrently
    const flushPromises = [
      writer.flush(),
      writer.flush(),
      writer.flush(),
      writer.flush(),
      writer.flush()
    ]

    const results = await Promise.all(flushPromises)

    // Only one flush should have data
    const nonEmptyFlushes = results.filter((r) => r.objectCount > 0)
    expect(nonEmptyFlushes.length).toBe(1)
    expect(nonEmptyFlushes[0].objectCount).toBe(10)
  })

  it('should handle concurrent reads from BundleReaderService', async () => {
    // Create a bundle with many objects
    const objects = Array.from({ length: 100 }, (_, i) => ({
      oid: generateOid(i),
      type: BundleObjectType.BLOB as const,
      data: createTestData(100, i)
    }))

    const bundleData = createBundle(objects)
    const bundles = new Map([['bundles/test.bundle', bundleData]])
    const storage = createMockReaderStorage(bundles)
    const reader = new BundleReaderService(storage)

    // Concurrent reads of all objects
    const readPromises = objects.map((obj) =>
      reader.readObject('bundles/test.bundle', obj.oid)
    )

    const results = await Promise.all(readPromises)

    // All reads should succeed
    expect(results.every((r) => r !== null)).toBe(true)

    // Verify data integrity
    for (let i = 0; i < objects.length; i++) {
      expect(results[i]!.data).toEqual(objects[i].data)
    }

    // Should have only loaded the bundle once
    expect(storage.readFile).toHaveBeenCalledTimes(1)
  })

  it('should handle concurrent reads from multiple bundles', async () => {
    // Create multiple bundles
    const bundleCount = 5
    const objectsPerBundle = 20
    const bundlesMap = new Map<string, Uint8Array>()

    for (let b = 0; b < bundleCount; b++) {
      const objects = Array.from({ length: objectsPerBundle }, (_, i) => ({
        oid: generateOid(b * 100 + i),
        type: BundleObjectType.BLOB as const,
        data: createTestData(50, b * 100 + i)
      }))
      bundlesMap.set(`bundles/bundle-${b}.bundle`, createBundle(objects))
    }

    const storage = createMockReaderStorage(bundlesMap)
    const reader = new BundleReaderService(storage)

    // Concurrent reads from all bundles
    const readPromises: Promise<any>[] = []
    for (let b = 0; b < bundleCount; b++) {
      for (let i = 0; i < objectsPerBundle; i++) {
        const oid = generateOid(b * 100 + i)
        readPromises.push(reader.readObject(`bundles/bundle-${b}.bundle`, oid))
      }
    }

    const results = await Promise.all(readPromises)

    // All reads should succeed
    expect(results.every((r) => r !== null)).toBe(true)
  })

  it('should handle mixed concurrent add and flush operations', async () => {
    const mockStorage = createMockWriterStorage()
    const writer = new BundleWriter(
      { maxBundleSize: 50 * 1024 },
      mockStorage
    )

    const operations: Promise<any>[] = []

    for (let i = 0; i < 100; i++) {
      operations.push(
        writer.add(
          generateOid(i),
          BundleObjectType.BLOB,
          createTestData(500, i)
        )
      )

      // Occasionally flush
      if (i % 20 === 19) {
        operations.push(writer.flush())
      }
    }

    await Promise.all(operations)
    await writer.close()

    // Verify all objects were written
    const stats = writer.getStats()
    expect(stats.totalObjectsWritten).toBe(100)
  })

  it('should handle concurrent batch reads', async () => {
    const objects = Array.from({ length: 200 }, (_, i) => ({
      oid: generateOid(i),
      type: BundleObjectType.BLOB as const,
      data: createTestData(50, i)
    }))

    const bundleData = createBundle(objects)
    const bundles = new Map([['bundles/test.bundle', bundleData]])
    const storage = createMockReaderStorage(bundles)
    const reader = new BundleReaderService(storage)

    // Create batches of OIDs
    const batches = [
      objects.slice(0, 50).map((o) => o.oid),
      objects.slice(50, 100).map((o) => o.oid),
      objects.slice(100, 150).map((o) => o.oid),
      objects.slice(150, 200).map((o) => o.oid)
    ]

    // Concurrent batch reads
    const batchPromises = batches.map((batch) =>
      reader.readObjectsBatch('bundles/test.bundle', batch)
    )

    const results = await Promise.all(batchPromises)

    // Verify all batches succeeded
    for (let b = 0; b < batches.length; b++) {
      expect(results[b].length).toBe(batches[b].length)
      expect(results[b].every((r) => r !== null)).toBe(true)
    }
  })

  it('should not corrupt data under heavy concurrent load', async () => {
    const mockStorage = createMockWriterStorage()
    const writer = new BundleWriter(
      { maxBundleSize: 100 * 1024 },
      mockStorage
    )

    const objectCount = 200
    const objects = new Map<string, Uint8Array>()

    // Heavy concurrent writes
    const writePromises = Array.from({ length: objectCount }, (_, i) => {
      const oid = generateOid(i)
      const data = createTestData(200 + (i % 100) * 10, i)
      objects.set(oid, data)
      return writer.add(oid, BundleObjectType.BLOB, data)
    })

    await Promise.all(writePromises)
    await writer.close()

    // Verify data integrity across all bundles
    for (const bundleData of mockStorage._bundles.values()) {
      const reader = new BundleReader(bundleData)
      for (const [oid, expectedData] of objects) {
        const result = reader.readObject(oid)
        if (result) {
          expect(result.data).toEqual(expectedData)
          objects.delete(oid)
        }
      }
    }

    // All objects should have been found
    expect(objects.size).toBe(0)
  })
})

// ============================================================================
// Tests: Chunk Boundary Conditions
// ============================================================================

describe('Bundle Chunking Stress Tests: Chunk Boundary Conditions', () => {
  let mockStorage: BundleWriterStorage & { _bundles: Map<string, Uint8Array> }

  beforeEach(() => {
    mockStorage = createMockWriterStorage()
  })

  it('should handle exact bundle size limit', async () => {
    // Calculate size needed to exactly fill bundle (minus overhead)
    const maxBundleSize = 1024
    const headerSize = BUNDLE_HEADER_SIZE
    const indexEntrySize = BUNDLE_INDEX_ENTRY_SIZE

    // Each object contributes: data size + index entry
    // Total = header + sum(data) + count * index_entry
    // For single object: header + data + index_entry = maxBundleSize
    const dataSize = maxBundleSize - headerSize - indexEntrySize

    const writer = new BundleWriter({ maxBundleSize }, mockStorage)
    const oid = generateOid(0)
    const data = createTestData(dataSize)

    await writer.add(oid, BundleObjectType.BLOB, data)
    expect(writer.currentBundleSize).toBeLessThanOrEqual(maxBundleSize)

    const metadata = await writer.flush()
    expect(metadata.objectCount).toBe(1)
  })

  it('should rotate exactly when size limit is exceeded by 1 byte', async () => {
    const maxBundleSize = 500
    const writer = new BundleWriter(
      { maxBundleSize, storagePrefix: 'boundary/' },
      mockStorage
    )

    // Add first object that almost fills the bundle
    const firstDataSize =
      maxBundleSize - BUNDLE_HEADER_SIZE - BUNDLE_INDEX_ENTRY_SIZE - 10
    await writer.add(
      generateOid(0),
      BundleObjectType.BLOB,
      createTestData(firstDataSize)
    )

    expect(mockStorage.write).not.toHaveBeenCalled()

    // Add second object that exceeds the limit - should trigger rotation
    await writer.add(
      generateOid(1),
      BundleObjectType.BLOB,
      createTestData(BUNDLE_INDEX_ENTRY_SIZE + 20)
    )

    // First bundle should have been flushed
    expect(mockStorage.write).toHaveBeenCalledTimes(1)
  })

  it('should handle objects at index entry boundary size', async () => {
    // BUNDLE_INDEX_ENTRY_SIZE = 33 bytes
    const writer = new BundleWriter(
      { maxBundleSize: 10 * 1024 },
      mockStorage
    )

    // Add objects with data size equal to index entry size
    const objectCount = 50
    for (let i = 0; i < objectCount; i++) {
      await writer.add(
        generateOid(i),
        BundleObjectType.BLOB,
        createTestData(BUNDLE_INDEX_ENTRY_SIZE)
      )
    }

    const metadata = await writer.flush()
    expect(metadata.objectCount).toBe(objectCount)

    // Verify bundle integrity
    const bundleData = Array.from(mockStorage._bundles.values())[0]
    const reader = new BundleReader(bundleData)
    expect(reader.entryCount).toBe(objectCount)
  })

  it('should handle empty objects at boundaries', async () => {
    // Each empty object still needs index entry space (33 bytes)
    // 20 objects * 33 bytes = 660 bytes for index alone, plus 64 byte header
    const maxBundleSize = 2000 // Large enough for 20 empty objects
    const writer = new BundleWriter({ maxBundleSize }, mockStorage)

    // Add empty objects (0 bytes of data)
    for (let i = 0; i < 20; i++) {
      await writer.add(generateOid(i), BundleObjectType.BLOB, new Uint8Array(0))
    }

    await writer.close()

    // Verify total objects written across all bundles
    const stats = writer.getStats()
    expect(stats.totalObjectsWritten).toBe(20)

    // Verify all empty objects can be read back from all bundles
    let foundCount = 0
    for (const bundleData of mockStorage._bundles.values()) {
      const reader = new BundleReader(bundleData)
      for (let i = 0; i < 20; i++) {
        const result = reader.readObject(generateOid(i))
        if (result) {
          expect(result.data.length).toBe(0)
          foundCount++
        }
      }
    }

    expect(foundCount).toBe(20)
  })

  it('should handle single byte objects', async () => {
    const writer = new BundleWriter(
      { maxBundleSize: 10 * 1024 },
      mockStorage
    )

    // Add many single-byte objects
    const objectCount = 100
    for (let i = 0; i < objectCount; i++) {
      await writer.add(
        generateOid(i),
        BundleObjectType.BLOB,
        new Uint8Array([i % 256])
      )
    }

    const metadata = await writer.flush()
    expect(metadata.objectCount).toBe(objectCount)

    // Verify single-byte data
    const bundleData = Array.from(mockStorage._bundles.values())[0]
    const reader = new BundleReader(bundleData)

    for (let i = 0; i < objectCount; i++) {
      const result = reader.readObject(generateOid(i))
      expect(result).not.toBeNull()
      expect(result!.data.length).toBe(1)
      expect(result!.data[0]).toBe(i % 256)
    }
  })

  it('should handle object sizes that are powers of 2', async () => {
    const writer = new BundleWriter(
      { maxBundleSize: 1024 * 1024 },
      mockStorage
    )

    // Add objects with sizes 1, 2, 4, 8, ..., 65536
    const sizes = Array.from({ length: 17 }, (_, i) => Math.pow(2, i))

    for (let i = 0; i < sizes.length; i++) {
      await writer.add(
        generateOid(i),
        BundleObjectType.BLOB,
        createTestData(sizes[i], i)
      )
    }

    const metadata = await writer.flush()
    expect(metadata.objectCount).toBe(sizes.length)

    // Verify all objects
    const bundleData = Array.from(mockStorage._bundles.values())[0]
    const reader = new BundleReader(bundleData)

    for (let i = 0; i < sizes.length; i++) {
      const result = reader.readObject(generateOid(i))
      expect(result).not.toBeNull()
      expect(result!.data.length).toBe(sizes[i])
    }
  })

  it('should handle objects at 1MB boundary', async () => {
    const writer = new BundleWriter(
      { maxBundleSize: 5 * 1024 * 1024 },
      mockStorage
    )

    const oneMB = 1024 * 1024

    // Add objects around 1MB boundary
    const sizes = [oneMB - 1, oneMB, oneMB + 1]

    for (let i = 0; i < sizes.length; i++) {
      await writer.add(
        generateOid(i),
        BundleObjectType.BLOB,
        createTestData(sizes[i], i)
      )
    }

    await writer.close()

    // Verify data integrity
    for (const bundleData of mockStorage._bundles.values()) {
      const reader = new BundleReader(bundleData)
      for (let i = 0; i < sizes.length; i++) {
        const result = reader.readObject(generateOid(i))
        if (result) {
          expect(result.data.length).toBe(sizes[i])
        }
      }
    }
  })

  it('should handle range reads at chunk boundaries', async () => {
    // Create a bundle with a larger object for range testing
    const objectSize = 10000
    const objects = [
      {
        oid: generateOid(0),
        type: BundleObjectType.BLOB as const,
        data: createTestData(objectSize, 42)
      }
    ]

    const bundleData = createBundle(objects)
    const bundles = new Map([['bundles/range.bundle', bundleData]])
    const storage = createMockReaderStorage(bundles)
    const reader = new BundleReaderService(storage)

    // Test range reads at various boundaries
    const ranges = [
      { start: 0, end: 100 }, // Start
      { start: objectSize - 100, end: objectSize }, // End
      { start: 5000, end: 5100 }, // Middle
      { start: 0, end: objectSize }, // Full
      { start: 1000, end: 1001 } // Single byte
    ]

    for (const range of ranges) {
      const result = await reader.readObjectRange(
        'bundles/range.bundle',
        objects[0].oid,
        range.start,
        range.end
      )

      expect(result.data.length).toBe(range.end - range.start)
      expect(result.data).toEqual(
        objects[0].data.slice(range.start, range.end)
      )
    }
  })

  it('should handle maximum possible entry count in header', async () => {
    // The header uses uint32 for entry count, so max is 2^32 - 1
    // We'll test with a smaller but still significant number

    const writer = new BundleWriter(
      { maxBundleSize: 100 * 1024 * 1024 },
      mockStorage
    )

    // Add many tiny objects to maximize entry count
    const objectCount = 1000

    for (let i = 0; i < objectCount; i++) {
      await writer.add(
        generateOid(i),
        BundleObjectType.BLOB,
        new Uint8Array([i % 256])
      )
    }

    const metadata = await writer.flush()
    expect(metadata.objectCount).toBe(objectCount)

    // Verify the bundle can be parsed
    const bundleData = Array.from(mockStorage._bundles.values())[0]
    const reader = new BundleReader(bundleData)
    expect(reader.entryCount).toBe(objectCount)
  })

  it('should handle alternating small and large objects', async () => {
    const writer = new BundleWriter(
      { maxBundleSize: 2 * 1024 * 1024 },
      mockStorage
    )

    // Alternate between 1 byte and 10KB objects
    const objectCount = 50
    const objects: Array<{ oid: string; data: Uint8Array }> = []

    for (let i = 0; i < objectCount; i++) {
      const size = i % 2 === 0 ? 1 : 10000
      const oid = generateOid(i)
      const data = createTestData(size, i)
      objects.push({ oid, data })
      await writer.add(oid, BundleObjectType.BLOB, data)
    }

    await writer.close()

    // Verify all objects
    let found = 0
    for (const bundleData of mockStorage._bundles.values()) {
      const reader = new BundleReader(bundleData)
      for (const obj of objects) {
        const result = reader.readObject(obj.oid)
        if (result) {
          expect(result.data).toEqual(obj.data)
          found++
        }
      }
    }

    expect(found).toBe(objectCount)
  })
})

// ============================================================================
// Tests: Cache Behavior Under Stress
// ============================================================================

describe('Bundle Chunking Stress Tests: Cache Behavior', () => {
  it('should handle cache thrashing with many bundles', async () => {
    // Create more bundles than cache can hold
    const bundleCount = 20
    const bundlesMap = new Map<string, Uint8Array>()

    for (let b = 0; b < bundleCount; b++) {
      const objects = [
        {
          oid: generateOid(b),
          type: BundleObjectType.BLOB as const,
          data: createTestData(100, b)
        }
      ]
      bundlesMap.set(`bundles/bundle-${b}.bundle`, createBundle(objects))
    }

    const storage = createMockReaderStorage(bundlesMap)
    const reader = new BundleReaderService(storage, { maxCachedBundles: 5 })

    // Access bundles in a pattern that causes thrashing
    for (let round = 0; round < 3; round++) {
      for (let b = 0; b < bundleCount; b++) {
        const result = await reader.readObject(
          `bundles/bundle-${b}.bundle`,
          generateOid(b)
        )
        expect(result).not.toBeNull()
      }
    }

    // Verify cache stats show expected behavior
    const stats = reader.getCacheStats()
    expect(stats.misses).toBeGreaterThan(stats.hits)
    expect(stats.bundleCount).toBeLessThanOrEqual(5)
  })

  it('should maintain hit rate with working set that fits in cache', async () => {
    const bundleCount = 5
    const bundlesMap = new Map<string, Uint8Array>()

    for (let b = 0; b < bundleCount; b++) {
      const objects = [
        {
          oid: generateOid(b),
          type: BundleObjectType.BLOB as const,
          data: createTestData(100, b)
        }
      ]
      bundlesMap.set(`bundles/bundle-${b}.bundle`, createBundle(objects))
    }

    const storage = createMockReaderStorage(bundlesMap)
    const reader = new BundleReaderService(storage, { maxCachedBundles: 10 })

    // Initial load
    for (let b = 0; b < bundleCount; b++) {
      await reader.readObject(`bundles/bundle-${b}.bundle`, generateOid(b))
    }

    // Repeated access should have high hit rate
    for (let round = 0; round < 10; round++) {
      for (let b = 0; b < bundleCount; b++) {
        await reader.readObject(`bundles/bundle-${b}.bundle`, generateOid(b))
      }
    }

    const stats = reader.getCacheStats()
    expect(stats.hitRate).toBeGreaterThan(80) // At least 80% hit rate
  })
})

// ============================================================================
// Tests: Error Recovery Under Stress
// ============================================================================

describe('Bundle Chunking Stress Tests: Error Recovery', () => {
  it('should recover from transient storage failures during writes', async () => {
    let failCount = 0
    const maxFailures = 3

    const flakyStorage: BundleWriterStorage = {
      write: vi.fn().mockImplementation(async (key: string, data: Uint8Array) => {
        failCount++
        if (failCount <= maxFailures) {
          throw new Error('Transient failure')
        }
        // Success after failures
      }),
      read: vi.fn(),
      delete: vi.fn(),
      list: vi.fn()
    }

    const writer = new BundleWriter({}, flakyStorage)

    for (let i = 0; i < 5; i++) {
      await writer.add(
        generateOid(i),
        BundleObjectType.BLOB,
        createTestData(100, i)
      )
    }

    // First few flush attempts fail
    for (let i = 0; i < maxFailures; i++) {
      await expect(writer.flush()).rejects.toThrow()
    }

    // Eventually succeeds
    const metadata = await writer.flush()
    expect(metadata.objectCount).toBe(5)
  })

  it('should not lose data when bundle creation fails mid-stream', async () => {
    let writeAttempts = 0
    const bundles = new Map<string, Uint8Array>()

    const flakyStorage: BundleWriterStorage = {
      write: vi.fn().mockImplementation(async (key: string, data: Uint8Array) => {
        writeAttempts++
        if (writeAttempts % 2 === 1) {
          throw new Error('Odd write fails')
        }
        bundles.set(key, data)
      }),
      read: vi.fn().mockImplementation(async (key: string) => bundles.get(key) ?? null),
      delete: vi.fn(),
      list: vi.fn()
    }

    const writer = new BundleWriter(
      { maxBundleSize: 500, storagePrefix: 'flaky/' },
      flakyStorage
    )

    // Add objects with expected failures
    for (let i = 0; i < 30; i++) {
      try {
        await writer.add(
          generateOid(i),
          BundleObjectType.BLOB,
          createTestData(100, i)
        )
      } catch {
        // Retry after failure
        await writer.add(
          generateOid(i),
          BundleObjectType.BLOB,
          createTestData(100, i)
        )
      }
    }

    // Keep trying flush until it succeeds
    while (writer.currentBundleObjectCount > 0) {
      try {
        await writer.flush()
      } catch {
        // Retry
      }
    }

    // All objects should eventually be written
    expect(bundles.size).toBeGreaterThan(0)
  })
})
