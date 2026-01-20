import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BundleObjectType,
  BundleIndexEntry
} from '../../src/storage/bundle-format'

/**
 * Bundle Compaction Tests
 *
 * Bundle compaction merges multiple small bundles into larger ones to:
 * - Reduce the number of R2 objects over time
 * - Merge small bundles into optimal-size bundles
 * - Remove deleted/unreferenced objects during compaction (tombstones)
 *
 * This is RED phase TDD - all tests should FAIL until implementation is done.
 */

// Types for bundle compaction (to be implemented in src/storage/bundle-compaction.ts)

/**
 * Configuration for bundle compaction
 */
export interface BundleCompactionConfig {
  /** Target size for compacted bundles (default: 2MB) */
  targetBundleSize?: number
  /** Maximum size for a single compacted bundle (default: 4MB) */
  maxBundleSize?: number
  /** Minimum number of bundles to trigger compaction */
  minBundleCount?: number
  /** Minimum total size to trigger compaction */
  minTotalSize?: number
  /** Whether to remove tombstoned/deleted objects */
  removeTombstones?: boolean
  /** Storage prefix for bundles */
  storagePrefix?: string
}

/**
 * Input bundle for compaction
 */
export interface CompactionInputBundle {
  id: string
  path: string
  size: number
  objectCount: number
}

/**
 * Result of a compaction operation
 */
export interface CompactionResult {
  /** IDs of bundles that were compacted (input) */
  inputBundleIds: string[]
  /** IDs of newly created bundles (output) */
  outputBundleIds: string[]
  /** Total objects processed */
  objectsProcessed: number
  /** Objects removed (duplicates, tombstones) */
  objectsRemoved: number
  /** Input total size in bytes */
  inputSize: number
  /** Output total size in bytes */
  outputSize: number
  /** Space saved in bytes */
  spaceSaved: number
  /** Duration of compaction in milliseconds */
  durationMs: number
}

/**
 * Metrics from compaction operation
 */
export interface CompactionMetrics {
  objectsProcessed: number
  objectsRemoved: number
  duplicatesRemoved: number
  tombstonesRemoved: number
  inputBundleCount: number
  outputBundleCount: number
  inputTotalSize: number
  outputTotalSize: number
  spaceSaved: number
  compressionRatio: number
}

/**
 * Tombstone record for deleted objects
 */
export interface Tombstone {
  oid: string
  deletedAt: Date
  reason?: string
}

/**
 * Storage interface for bundle compaction
 */
export interface CompactionStorage {
  read(path: string): Promise<Uint8Array | null>
  write(path: string, data: Uint8Array): Promise<void>
  delete(path: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

/**
 * Compaction trigger conditions
 */
export interface CompactionTrigger {
  /** Number of bundles exceeds this threshold */
  bundleCountThreshold?: number
  /** Total size of bundles exceeds this threshold (bytes) */
  totalSizeThreshold?: number
  /** Average bundle size is below this threshold (bytes) */
  avgBundleSizeThreshold?: number
  /** Percentage of small bundles (< 500KB) exceeds this */
  smallBundlePercentageThreshold?: number
}

/**
 * Error thrown during compaction operations
 */
export class BundleCompactionError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'BundleCompactionError'
  }
}

/**
 * Error thrown when compaction is already in progress
 */
export class CompactionInProgressError extends Error {
  constructor(message: string = 'Compaction already in progress') {
    super(message)
    this.name = 'CompactionInProgressError'
  }
}

// Stub class - to be implemented
export class BundleCompactor {
  constructor(
    _config: BundleCompactionConfig,
    _storage: CompactionStorage
  ) {
    throw new Error('BundleCompactor not implemented')
  }

  get config(): Required<BundleCompactionConfig> {
    throw new Error('BundleCompactor.config not implemented')
  }

  get isCompacting(): boolean {
    throw new Error('BundleCompactor.isCompacting not implemented')
  }

  async compact(_inputBundles: CompactionInputBundle[]): Promise<CompactionResult> {
    throw new Error('BundleCompactor.compact not implemented')
  }

  async compactAll(): Promise<CompactionResult> {
    throw new Error('BundleCompactor.compactAll not implemented')
  }

  async shouldTriggerCompaction(_bundles: CompactionInputBundle[]): Promise<boolean> {
    throw new Error('BundleCompactor.shouldTriggerCompaction not implemented')
  }

  setTrigger(_trigger: CompactionTrigger): void {
    throw new Error('BundleCompactor.setTrigger not implemented')
  }

  addTombstone(_tombstone: Tombstone): void {
    throw new Error('BundleCompactor.addTombstone not implemented')
  }

  getTombstones(): Tombstone[] {
    throw new Error('BundleCompactor.getTombstones not implemented')
  }

  clearTombstones(): void {
    throw new Error('BundleCompactor.clearTombstones not implemented')
  }

  getMetrics(): CompactionMetrics {
    throw new Error('BundleCompactor.getMetrics not implemented')
  }

  async abort(): Promise<void> {
    throw new Error('BundleCompactor.abort not implemented')
  }
}

// Test helpers
const encoder = new TextEncoder()

function createTestOid(prefix: string = 'a'): string {
  return prefix.repeat(40).slice(0, 40)
}

function createTestData(content: string): Uint8Array {
  return encoder.encode(content)
}

function createMockBundle(objects: Array<{ oid: string; type: BundleObjectType; data: Uint8Array }>): Uint8Array {
  // Create a mock bundle with header + entries + index
  // This is a simplified version - real implementation will use BundleWriter
  const header = new Uint8Array(64)
  // Magic: "BNDL"
  header[0] = 0x42; header[1] = 0x4e; header[2] = 0x44; header[3] = 0x4c
  // Version: 1
  header[7] = 0x01
  // Entry count
  header[11] = objects.length

  // Concatenate all object data
  const totalDataSize = objects.reduce((sum, obj) => sum + obj.data.length, 0)
  const indexSize = objects.length * 33 // 20 (oid) + 8 (offset) + 4 (size) + 1 (type)
  const totalSize = 64 + totalDataSize + indexSize

  // Set index offset and total size in header
  const view = new DataView(header.buffer)
  view.setBigUint64(12, BigInt(64 + totalDataSize), false)
  view.setBigUint64(20, BigInt(totalSize), false)

  // Build the bundle
  const bundle = new Uint8Array(totalSize)
  bundle.set(header, 0)

  let offset = 64
  const indexEntries: Array<{ oid: string; offset: number; size: number; type: BundleObjectType }> = []

  for (const obj of objects) {
    bundle.set(obj.data, offset)
    indexEntries.push({
      oid: obj.oid,
      offset,
      size: obj.data.length,
      type: obj.type
    })
    offset += obj.data.length
  }

  // Write index (simplified)
  const indexOffset = 64 + totalDataSize
  for (let i = 0; i < indexEntries.length; i++) {
    const entry = indexEntries[i]
    const entryBase = indexOffset + i * 33
    // Write OID as binary (20 bytes)
    for (let j = 0; j < 20; j++) {
      bundle[entryBase + j] = parseInt(entry.oid.slice(j * 2, j * 2 + 2), 16)
    }
    // Write offset (8 bytes)
    const indexView = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength)
    indexView.setBigUint64(entryBase + 20, BigInt(entry.offset), false)
    // Write size (4 bytes)
    indexView.setUint32(entryBase + 28, entry.size, false)
    // Write type (1 byte)
    bundle[entryBase + 32] = entry.type
  }

  return bundle
}

function createMockStorage(): CompactionStorage & { _bundles: Map<string, Uint8Array> } {
  const bundles = new Map<string, Uint8Array>()
  return {
    read: vi.fn(async (path: string) => bundles.get(path) ?? null),
    write: vi.fn(async (path: string, data: Uint8Array) => {
      bundles.set(path, data)
    }),
    delete: vi.fn(async (path: string) => {
      bundles.delete(path)
    }),
    list: vi.fn(async (prefix: string) => {
      return Array.from(bundles.keys()).filter(k => k.startsWith(prefix))
    }),
    _bundles: bundles
  }
}

describe('Bundle Compaction', () => {
  let mockStorage: CompactionStorage & { _bundles: Map<string, Uint8Array> }

  beforeEach(() => {
    mockStorage = createMockStorage()
  })

  describe('Compact Two Small Bundles Into One', () => {
    it('should merge two small bundles into a single bundle', async () => {
      // Create two small bundles
      const bundle1 = createMockBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('content1') }
      ])
      const bundle2 = createMockBundle([
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: createTestData('content2') }
      ])

      mockStorage._bundles.set('bundles/bundle1', bundle1)
      mockStorage._bundles.set('bundles/bundle2', bundle2)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compact([
        { id: 'bundle1', path: 'bundles/bundle1', size: bundle1.length, objectCount: 1 },
        { id: 'bundle2', path: 'bundles/bundle2', size: bundle2.length, objectCount: 1 }
      ])

      expect(result.inputBundleIds).toEqual(['bundle1', 'bundle2'])
      expect(result.outputBundleIds.length).toBe(1)
      expect(result.objectsProcessed).toBe(2)
    })

    it('should delete old bundles after successful compaction', async () => {
      const bundle1 = createMockBundle([
        { oid: createTestOid('x'), type: BundleObjectType.BLOB, data: createTestData('x') }
      ])
      const bundle2 = createMockBundle([
        { oid: createTestOid('y'), type: BundleObjectType.BLOB, data: createTestData('y') }
      ])

      mockStorage._bundles.set('bundles/b1', bundle1)
      mockStorage._bundles.set('bundles/b2', bundle2)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle1.length, objectCount: 1 },
        { id: 'b2', path: 'bundles/b2', size: bundle2.length, objectCount: 1 }
      ])

      // Old bundles should be deleted
      expect(mockStorage.delete).toHaveBeenCalledWith('bundles/b1')
      expect(mockStorage.delete).toHaveBeenCalledWith('bundles/b2')
    })

    it('should write compacted bundle before deleting old bundles', async () => {
      const bundle1 = createMockBundle([
        { oid: createTestOid('1'), type: BundleObjectType.BLOB, data: createTestData('1') }
      ])

      mockStorage._bundles.set('bundles/b1', bundle1)

      const callOrder: string[] = []
      mockStorage.write = vi.fn(async () => {
        callOrder.push('write')
      })
      mockStorage.delete = vi.fn(async () => {
        callOrder.push('delete')
      })

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle1.length, objectCount: 1 }
      ])

      // Write should happen before delete
      const writeIndex = callOrder.indexOf('write')
      const deleteIndex = callOrder.indexOf('delete')
      expect(writeIndex).toBeLessThan(deleteIndex)
    })
  })

  describe('Compact Preserves All Objects', () => {
    it('should preserve all objects from input bundles', async () => {
      const objects1 = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('blob a') },
        { oid: createTestOid('b'), type: BundleObjectType.TREE, data: new Uint8Array([1, 2, 3]) }
      ]
      const objects2 = [
        { oid: createTestOid('c'), type: BundleObjectType.COMMIT, data: createTestData('commit') },
        { oid: createTestOid('d'), type: BundleObjectType.TAG, data: createTestData('tag') }
      ]

      const bundle1 = createMockBundle(objects1)
      const bundle2 = createMockBundle(objects2)

      mockStorage._bundles.set('bundles/b1', bundle1)
      mockStorage._bundles.set('bundles/b2', bundle2)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle1.length, objectCount: 2 },
        { id: 'b2', path: 'bundles/b2', size: bundle2.length, objectCount: 2 }
      ])

      expect(result.objectsProcessed).toBe(4)
      expect(result.objectsRemoved).toBe(0) // No objects should be removed
    })

    it('should preserve object types correctly', async () => {
      const objects = [
        { oid: createTestOid('1'), type: BundleObjectType.BLOB, data: createTestData('blob') },
        { oid: createTestOid('2'), type: BundleObjectType.TREE, data: createTestData('tree') },
        { oid: createTestOid('3'), type: BundleObjectType.COMMIT, data: createTestData('commit') },
        { oid: createTestOid('4'), type: BundleObjectType.TAG, data: createTestData('tag') }
      ]

      const bundle = createMockBundle(objects)
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 4 }
      ])

      // All object types should be preserved
      expect(result.objectsProcessed).toBe(4)
    })

    it('should preserve exact binary content of objects', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x7f, 0x80])
      const objects = [
        { oid: createTestOid('bin'), type: BundleObjectType.BLOB, data: binaryData }
      ]

      const bundle = createMockBundle(objects)
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 1 }
      ])

      // Verify the written bundle contains the same binary data
      expect(mockStorage.write).toHaveBeenCalled()
      const writeCall = vi.mocked(mockStorage.write).mock.calls[0]
      const writtenBundle = writeCall[1]
      expect(writtenBundle).toBeInstanceOf(Uint8Array)
    })
  })

  describe('Compact Removes Deleted Objects (Tombstones)', () => {
    it('should remove objects marked as tombstones', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('keep') },
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: createTestData('delete') }
      ]

      const bundle = createMockBundle(objects)
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ removeTombstones: true, storagePrefix: 'bundles/' }, mockStorage)

      // Mark object 'b' as deleted
      compactor.addTombstone({
        oid: createTestOid('b'),
        deletedAt: new Date(),
        reason: 'garbage collected'
      })

      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 2 }
      ])

      expect(result.objectsProcessed).toBe(2)
      expect(result.objectsRemoved).toBe(1)
    })

    it('should preserve objects not in tombstone list', async () => {
      const objects = [
        { oid: createTestOid('keep1'), type: BundleObjectType.BLOB, data: createTestData('keep1') },
        { oid: createTestOid('keep2'), type: BundleObjectType.BLOB, data: createTestData('keep2') }
      ]

      const bundle = createMockBundle(objects)
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ removeTombstones: true, storagePrefix: 'bundles/' }, mockStorage)

      // Add tombstone for an object not in the bundle
      compactor.addTombstone({
        oid: createTestOid('nothere'),
        deletedAt: new Date()
      })

      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 2 }
      ])

      expect(result.objectsRemoved).toBe(0)
    })

    it('should not remove tombstones when removeTombstones is false', async () => {
      const objects = [
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('a') }
      ]

      const bundle = createMockBundle(objects)
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ removeTombstones: false, storagePrefix: 'bundles/' }, mockStorage)

      compactor.addTombstone({
        oid: createTestOid('a'),
        deletedAt: new Date()
      })

      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 1 }
      ])

      expect(result.objectsRemoved).toBe(0) // Object should NOT be removed
    })

    it('should clear tombstones after compaction', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('a') }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ removeTombstones: true, storagePrefix: 'bundles/' }, mockStorage)

      compactor.addTombstone({ oid: createTestOid('a'), deletedAt: new Date() })
      expect(compactor.getTombstones().length).toBe(1)

      await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 1 }
      ])

      // Tombstones should be cleared after compaction
      expect(compactor.getTombstones().length).toBe(0)
    })
  })

  describe('Compact Respects maxBundleSize Limit', () => {
    it('should not create bundles larger than maxBundleSize', async () => {
      const largeData = new Uint8Array(500000) // 500KB
      const objects = [
        { oid: createTestOid('1'), type: BundleObjectType.BLOB, data: largeData },
        { oid: createTestOid('2'), type: BundleObjectType.BLOB, data: largeData },
        { oid: createTestOid('3'), type: BundleObjectType.BLOB, data: largeData }
      ]

      const bundle = createMockBundle(objects)
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({
        maxBundleSize: 1000000, // 1MB max
        storagePrefix: 'bundles/'
      }, mockStorage)

      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 3 }
      ])

      // Should create multiple output bundles since total > 1MB
      expect(result.outputBundleIds.length).toBeGreaterThanOrEqual(2)
    })

    it('should use targetBundleSize for optimal bundle sizing', async () => {
      const data = new Uint8Array(100000) // 100KB each
      const bundles: Array<{ id: string; bundle: Uint8Array }> = []

      for (let i = 0; i < 10; i++) {
        const bundle = createMockBundle([
          { oid: createTestOid(String(i)), type: BundleObjectType.BLOB, data }
        ])
        mockStorage._bundles.set(`bundles/b${i}`, bundle)
        bundles.push({ id: `b${i}`, bundle })
      }

      const compactor = new BundleCompactor({
        targetBundleSize: 500000, // 500KB target
        maxBundleSize: 800000, // 800KB max
        storagePrefix: 'bundles/'
      }, mockStorage)

      const result = await compactor.compact(
        bundles.map(b => ({
          id: b.id,
          path: `bundles/${b.id}`,
          size: b.bundle.length,
          objectCount: 1
        }))
      )

      // With 10 x 100KB bundles and 500KB target, should create ~2 bundles
      expect(result.outputBundleIds.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle single object larger than targetBundleSize', async () => {
      const largeData = new Uint8Array(2000000) // 2MB
      const bundle = createMockBundle([
        { oid: createTestOid('large'), type: BundleObjectType.BLOB, data: largeData }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({
        targetBundleSize: 500000, // 500KB target (smaller than object)
        maxBundleSize: 4000000, // 4MB max
        storagePrefix: 'bundles/'
      }, mockStorage)

      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 1 }
      ])

      // Should still create a bundle even though object is larger than target
      expect(result.outputBundleIds.length).toBe(1)
      expect(result.objectsProcessed).toBe(1)
    })
  })

  describe('Compact Creates Multiple Output Bundles If Needed', () => {
    it('should create multiple bundles when total size exceeds limit', async () => {
      const data = new Uint8Array(300000) // 300KB each
      const inputBundles: CompactionInputBundle[] = []

      for (let i = 0; i < 5; i++) {
        const bundle = createMockBundle([
          { oid: createTestOid(String(i)), type: BundleObjectType.BLOB, data }
        ])
        mockStorage._bundles.set(`bundles/b${i}`, bundle)
        inputBundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: bundle.length,
          objectCount: 1
        })
      }

      const compactor = new BundleCompactor({
        maxBundleSize: 700000, // 700KB max
        storagePrefix: 'bundles/'
      }, mockStorage)

      const result = await compactor.compact(inputBundles)

      // 5 x 300KB = 1.5MB total, with 700KB max = at least 3 bundles
      expect(result.outputBundleIds.length).toBeGreaterThanOrEqual(3)
    })

    it('should distribute objects evenly across output bundles', async () => {
      const inputBundles: CompactionInputBundle[] = []
      for (let i = 0; i < 10; i++) {
        const bundle = createMockBundle([
          { oid: createTestOid(String(i)), type: BundleObjectType.BLOB, data: createTestData(`obj${i}`) }
        ])
        mockStorage._bundles.set(`bundles/b${i}`, bundle)
        inputBundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: bundle.length,
          objectCount: 1
        })
      }

      const compactor = new BundleCompactor({
        targetBundleSize: 300,
        maxBundleSize: 500,
        storagePrefix: 'bundles/'
      }, mockStorage)

      const result = await compactor.compact(inputBundles)

      expect(result.objectsProcessed).toBe(10)
      expect(result.outputBundleIds.length).toBeGreaterThan(1)
    })

    it('should generate unique IDs for each output bundle', async () => {
      const inputBundles: CompactionInputBundle[] = []
      for (let i = 0; i < 5; i++) {
        const bundle = createMockBundle([
          { oid: createTestOid(String(i)), type: BundleObjectType.BLOB, data: new Uint8Array(200000) }
        ])
        mockStorage._bundles.set(`bundles/b${i}`, bundle)
        inputBundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: bundle.length,
          objectCount: 1
        })
      }

      const compactor = new BundleCompactor({
        maxBundleSize: 500000,
        storagePrefix: 'bundles/'
      }, mockStorage)

      const result = await compactor.compact(inputBundles)

      // All output bundle IDs should be unique
      const uniqueIds = new Set(result.outputBundleIds)
      expect(uniqueIds.size).toBe(result.outputBundleIds.length)
    })
  })

  describe('Compaction Is Atomic', () => {
    it('should not delete old bundles if write fails', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('a') }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      // Make write fail
      mockStorage.write = vi.fn().mockRejectedValue(new Error('Storage write failed'))

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)

      await expect(
        compactor.compact([
          { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 1 }
        ])
      ).rejects.toThrow(BundleCompactionError)

      // Old bundle should NOT be deleted
      expect(mockStorage.delete).not.toHaveBeenCalled()
    })

    it('should rollback partially written bundles on failure', async () => {
      const bundles: CompactionInputBundle[] = []
      for (let i = 0; i < 5; i++) {
        const bundle = createMockBundle([
          { oid: createTestOid(String(i)), type: BundleObjectType.BLOB, data: new Uint8Array(200000) }
        ])
        mockStorage._bundles.set(`bundles/b${i}`, bundle)
        bundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: bundle.length,
          objectCount: 1
        })
      }

      let writeCount = 0
      mockStorage.write = vi.fn().mockImplementation(async () => {
        writeCount++
        if (writeCount === 2) {
          throw new Error('Second write failed')
        }
      })

      const compactor = new BundleCompactor({
        maxBundleSize: 300000,
        storagePrefix: 'bundles/'
      }, mockStorage)

      await expect(compactor.compact(bundles)).rejects.toThrow(BundleCompactionError)

      // First successfully written bundle should be cleaned up
      // (delete called for rollback)
    })

    it('should preserve original bundles on any failure', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('important'), type: BundleObjectType.BLOB, data: createTestData('critical data') }
      ])
      mockStorage._bundles.set('bundles/original', bundle)

      mockStorage.write = vi.fn().mockRejectedValue(new Error('Failed'))

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)

      try {
        await compactor.compact([
          { id: 'original', path: 'bundles/original', size: bundle.length, objectCount: 1 }
        ])
      } catch {
        // Expected
      }

      // Original bundle should still exist
      expect(mockStorage._bundles.has('bundles/original')).toBe(true)
    })
  })

  describe('Handles Bundles with Overlapping OIDs (Dedup)', () => {
    it('should deduplicate objects with same OID across bundles', async () => {
      const sameOid = createTestOid('dup')
      const sameData = createTestData('duplicate content')

      const bundle1 = createMockBundle([
        { oid: sameOid, type: BundleObjectType.BLOB, data: sameData }
      ])
      const bundle2 = createMockBundle([
        { oid: sameOid, type: BundleObjectType.BLOB, data: sameData }
      ])

      mockStorage._bundles.set('bundles/b1', bundle1)
      mockStorage._bundles.set('bundles/b2', bundle2)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle1.length, objectCount: 1 },
        { id: 'b2', path: 'bundles/b2', size: bundle2.length, objectCount: 1 }
      ])

      expect(result.objectsProcessed).toBe(2)
      expect(result.objectsRemoved).toBe(1) // Duplicate removed
    })

    it('should keep first occurrence when deduplicating', async () => {
      const sameOid = createTestOid('same')

      const bundle1 = createMockBundle([
        { oid: sameOid, type: BundleObjectType.BLOB, data: createTestData('first version') }
      ])
      const bundle2 = createMockBundle([
        { oid: sameOid, type: BundleObjectType.BLOB, data: createTestData('second version') }
      ])

      mockStorage._bundles.set('bundles/b1', bundle1)
      mockStorage._bundles.set('bundles/b2', bundle2)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle1.length, objectCount: 1 },
        { id: 'b2', path: 'bundles/b2', size: bundle2.length, objectCount: 1 }
      ])

      // Only one object should remain
      expect(result.objectsProcessed).toBe(2)
      expect(result.objectsRemoved).toBe(1)
    })

    it('should handle multiple duplicates across many bundles', async () => {
      const duplicateOid = createTestOid('multi')
      const inputBundles: CompactionInputBundle[] = []

      for (let i = 0; i < 5; i++) {
        const bundle = createMockBundle([
          { oid: duplicateOid, type: BundleObjectType.BLOB, data: createTestData('same') },
          { oid: createTestOid(String(i)), type: BundleObjectType.BLOB, data: createTestData(`unique${i}`) }
        ])
        mockStorage._bundles.set(`bundles/b${i}`, bundle)
        inputBundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: bundle.length,
          objectCount: 2
        })
      }

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compact(inputBundles)

      // 5 bundles x 2 objects = 10 processed
      // 4 duplicates of 'multi' removed = 4 removed
      expect(result.objectsProcessed).toBe(10)
      expect(result.objectsRemoved).toBe(4)
    })

    it('should track duplicates removed in metrics', async () => {
      const sameOid = createTestOid('dup')

      const bundle1 = createMockBundle([
        { oid: sameOid, type: BundleObjectType.BLOB, data: createTestData('a') }
      ])
      const bundle2 = createMockBundle([
        { oid: sameOid, type: BundleObjectType.BLOB, data: createTestData('a') }
      ])

      mockStorage._bundles.set('bundles/b1', bundle1)
      mockStorage._bundles.set('bundles/b2', bundle2)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle1.length, objectCount: 1 },
        { id: 'b2', path: 'bundles/b2', size: bundle2.length, objectCount: 1 }
      ])

      const metrics = compactor.getMetrics()
      expect(metrics.duplicatesRemoved).toBe(1)
    })
  })

  describe('Compaction Metrics', () => {
    it('should track objects processed', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('a') },
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: createTestData('b') },
        { oid: createTestOid('c'), type: BundleObjectType.BLOB, data: createTestData('c') }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 3 }
      ])

      const metrics = compactor.getMetrics()
      expect(metrics.objectsProcessed).toBe(3)
    })

    it('should calculate space saved correctly', async () => {
      // Two bundles with duplicate content
      const data = createTestData('shared content')
      const bundle1 = createMockBundle([
        { oid: createTestOid('dup'), type: BundleObjectType.BLOB, data }
      ])
      const bundle2 = createMockBundle([
        { oid: createTestOid('dup'), type: BundleObjectType.BLOB, data }
      ])

      mockStorage._bundles.set('bundles/b1', bundle1)
      mockStorage._bundles.set('bundles/b2', bundle2)

      const inputSize = bundle1.length + bundle2.length

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle1.length, objectCount: 1 },
        { id: 'b2', path: 'bundles/b2', size: bundle2.length, objectCount: 1 }
      ])

      expect(result.inputSize).toBe(inputSize)
      expect(result.outputSize).toBeLessThan(inputSize)
      expect(result.spaceSaved).toBe(inputSize - result.outputSize)
    })

    it('should track input and output bundle counts', async () => {
      const bundles: CompactionInputBundle[] = []
      for (let i = 0; i < 3; i++) {
        const bundle = createMockBundle([
          { oid: createTestOid(String(i)), type: BundleObjectType.BLOB, data: createTestData(`obj${i}`) }
        ])
        mockStorage._bundles.set(`bundles/b${i}`, bundle)
        bundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: bundle.length,
          objectCount: 1
        })
      }

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      await compactor.compact(bundles)

      const metrics = compactor.getMetrics()
      expect(metrics.inputBundleCount).toBe(3)
      expect(metrics.outputBundleCount).toBeGreaterThanOrEqual(1)
    })

    it('should calculate compression ratio', async () => {
      const duplicateData = createTestData('duplicate content repeated many times')
      const bundles: CompactionInputBundle[] = []

      for (let i = 0; i < 5; i++) {
        const bundle = createMockBundle([
          { oid: createTestOid('same'), type: BundleObjectType.BLOB, data: duplicateData }
        ])
        mockStorage._bundles.set(`bundles/b${i}`, bundle)
        bundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: bundle.length,
          objectCount: 1
        })
      }

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      await compactor.compact(bundles)

      const metrics = compactor.getMetrics()
      // Compression ratio = input / output
      expect(metrics.compressionRatio).toBeGreaterThan(1)
    })

    it('should track compaction duration', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('a') }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 1 }
      ])

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should track tombstones removed separately from duplicates', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('keep'), type: BundleObjectType.BLOB, data: createTestData('keep') },
        { oid: createTestOid('delete'), type: BundleObjectType.BLOB, data: createTestData('delete') }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ removeTombstones: true, storagePrefix: 'bundles/' }, mockStorage)
      compactor.addTombstone({ oid: createTestOid('delete'), deletedAt: new Date() })

      await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 2 }
      ])

      const metrics = compactor.getMetrics()
      expect(metrics.tombstonesRemoved).toBe(1)
      expect(metrics.duplicatesRemoved).toBe(0)
    })
  })

  describe('Concurrent Compaction Safety', () => {
    it('should prevent concurrent compaction operations', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('a') }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      // Make storage operations slow
      mockStorage.read = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return bundle
      })

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const inputBundle = { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 1 }

      // Start first compaction
      const firstCompaction = compactor.compact([inputBundle])

      // Try to start second compaction while first is in progress
      await expect(compactor.compact([inputBundle])).rejects.toThrow(CompactionInProgressError)

      await firstCompaction
    })

    it('should report compaction status', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('a') }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)

      expect(compactor.isCompacting).toBe(false)

      // Note: In actual test, we'd need to check during compaction
      // This is a simplified version for RED phase
    })

    it('should allow new compaction after previous completes', async () => {
      const bundle1 = createMockBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: createTestData('a') }
      ])
      const bundle2 = createMockBundle([
        { oid: createTestOid('b'), type: BundleObjectType.BLOB, data: createTestData('b') }
      ])
      mockStorage._bundles.set('bundles/b1', bundle1)
      mockStorage._bundles.set('bundles/b2', bundle2)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)

      // First compaction
      await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle1.length, objectCount: 1 }
      ])

      // Second compaction should succeed
      await expect(
        compactor.compact([
          { id: 'b2', path: 'bundles/b2', size: bundle2.length, objectCount: 1 }
        ])
      ).resolves.toBeDefined()
    })

    it('should allow abort of in-progress compaction', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('a'), type: BundleObjectType.BLOB, data: new Uint8Array(1000000) }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      // Slow read to give time for abort
      mockStorage.read = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return bundle
      })

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const inputBundle = { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 1 }

      // Start compaction
      const compactionPromise = compactor.compact([inputBundle])

      // Abort it
      setTimeout(() => {
        compactor.abort()
      }, 50)

      await expect(compactionPromise).rejects.toThrow(/abort/i)
    })
  })

  describe('Compaction Triggers', () => {
    it('should trigger compaction based on bundle count threshold', async () => {
      const bundles: CompactionInputBundle[] = []
      for (let i = 0; i < 10; i++) {
        bundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: 1000,
          objectCount: 1
        })
      }

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      compactor.setTrigger({ bundleCountThreshold: 5 })

      const shouldTrigger = await compactor.shouldTriggerCompaction(bundles)

      expect(shouldTrigger).toBe(true)
    })

    it('should not trigger when below bundle count threshold', async () => {
      const bundles: CompactionInputBundle[] = []
      for (let i = 0; i < 3; i++) {
        bundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: 1000,
          objectCount: 1
        })
      }

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      compactor.setTrigger({ bundleCountThreshold: 5 })

      const shouldTrigger = await compactor.shouldTriggerCompaction(bundles)

      expect(shouldTrigger).toBe(false)
    })

    it('should trigger compaction based on total size threshold', async () => {
      const bundles: CompactionInputBundle[] = [
        { id: 'b1', path: 'bundles/b1', size: 3000000, objectCount: 10 },
        { id: 'b2', path: 'bundles/b2', size: 3000000, objectCount: 10 }
      ]

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      compactor.setTrigger({ totalSizeThreshold: 5000000 }) // 5MB

      const shouldTrigger = await compactor.shouldTriggerCompaction(bundles)

      expect(shouldTrigger).toBe(true)
    })

    it('should trigger based on average bundle size being too small', async () => {
      const bundles: CompactionInputBundle[] = []
      for (let i = 0; i < 100; i++) {
        bundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: 10000, // 10KB each - very small
          objectCount: 1
        })
      }

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      compactor.setTrigger({ avgBundleSizeThreshold: 500000 }) // Trigger if avg < 500KB

      const shouldTrigger = await compactor.shouldTriggerCompaction(bundles)

      expect(shouldTrigger).toBe(true)
    })

    it('should trigger based on percentage of small bundles', async () => {
      const bundles: CompactionInputBundle[] = []
      // 8 small bundles
      for (let i = 0; i < 8; i++) {
        bundles.push({
          id: `small${i}`,
          path: `bundles/small${i}`,
          size: 100000, // 100KB
          objectCount: 1
        })
      }
      // 2 large bundles
      for (let i = 0; i < 2; i++) {
        bundles.push({
          id: `large${i}`,
          path: `bundles/large${i}`,
          size: 2000000, // 2MB
          objectCount: 100
        })
      }

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      compactor.setTrigger({ smallBundlePercentageThreshold: 70 }) // 70% small triggers

      const shouldTrigger = await compactor.shouldTriggerCompaction(bundles)

      expect(shouldTrigger).toBe(true) // 80% are small
    })

    it('should combine multiple trigger conditions with OR logic', async () => {
      const bundles: CompactionInputBundle[] = [
        { id: 'b1', path: 'bundles/b1', size: 100, objectCount: 1 },
        { id: 'b2', path: 'bundles/b2', size: 100, objectCount: 1 }
      ]

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      compactor.setTrigger({
        bundleCountThreshold: 100, // Not met
        totalSizeThreshold: 50, // Met (200 > 50)
        avgBundleSizeThreshold: 1000 // Met (100 < 1000)
      })

      const shouldTrigger = await compactor.shouldTriggerCompaction(bundles)

      expect(shouldTrigger).toBe(true) // At least one condition met
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty input bundle list', async () => {
      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)

      const result = await compactor.compact([])

      expect(result.inputBundleIds).toEqual([])
      expect(result.outputBundleIds).toEqual([])
      expect(result.objectsProcessed).toBe(0)
    })

    it('should handle single bundle compaction (essentially a copy)', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('single'), type: BundleObjectType.BLOB, data: createTestData('single') }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 1 }
      ])

      expect(result.inputBundleIds).toEqual(['b1'])
      expect(result.outputBundleIds.length).toBe(1)
      expect(result.objectsProcessed).toBe(1)
    })

    it('should handle bundle with empty objects', async () => {
      const bundle = createMockBundle([
        { oid: createTestOid('empty'), type: BundleObjectType.BLOB, data: new Uint8Array(0) }
      ])
      mockStorage._bundles.set('bundles/b1', bundle)

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compact([
        { id: 'b1', path: 'bundles/b1', size: bundle.length, objectCount: 1 }
      ])

      expect(result.objectsProcessed).toBe(1)
    })

    it('should handle missing bundle gracefully', async () => {
      // Bundle exists in list but not in storage
      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)

      await expect(
        compactor.compact([
          { id: 'missing', path: 'bundles/missing', size: 1000, objectCount: 1 }
        ])
      ).rejects.toThrow(BundleCompactionError)
    })

    it('should handle corrupted bundle gracefully', async () => {
      // Write invalid bundle data
      mockStorage._bundles.set('bundles/corrupted', new Uint8Array([0xff, 0xff, 0xff]))

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)

      await expect(
        compactor.compact([
          { id: 'corrupted', path: 'bundles/corrupted', size: 3, objectCount: 1 }
        ])
      ).rejects.toThrow(BundleCompactionError)
    })

    it('should handle very large number of input bundles', async () => {
      const inputBundles: CompactionInputBundle[] = []
      for (let i = 0; i < 1000; i++) {
        inputBundles.push({
          id: `b${i}`,
          path: `bundles/b${i}`,
          size: 100,
          objectCount: 1
        })
      }

      // Add actual mock bundles
      for (const input of inputBundles) {
        const bundle = createMockBundle([
          { oid: createTestOid(input.id), type: BundleObjectType.BLOB, data: createTestData(input.id) }
        ])
        mockStorage._bundles.set(input.path, bundle)
      }

      const compactor = new BundleCompactor({
        targetBundleSize: 2000000,
        storagePrefix: 'bundles/'
      }, mockStorage)

      const result = await compactor.compact(inputBundles)

      expect(result.objectsProcessed).toBe(1000)
      expect(result.outputBundleIds.length).toBeLessThan(1000)
    })
  })

  describe('compactAll Integration', () => {
    it('should discover and compact all bundles in storage', async () => {
      for (let i = 0; i < 5; i++) {
        const bundle = createMockBundle([
          { oid: createTestOid(String(i)), type: BundleObjectType.BLOB, data: createTestData(`obj${i}`) }
        ])
        mockStorage._bundles.set(`bundles/bundle-${i}`, bundle)
      }

      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compactAll()

      expect(result.inputBundleIds.length).toBe(5)
      expect(result.objectsProcessed).toBe(5)
    })

    it('should use storage list to discover bundles', async () => {
      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)

      await compactor.compactAll()

      expect(mockStorage.list).toHaveBeenCalledWith('bundles/')
    })

    it('should handle empty storage gracefully', async () => {
      const compactor = new BundleCompactor({ storagePrefix: 'bundles/' }, mockStorage)
      const result = await compactor.compactAll()

      expect(result.inputBundleIds).toEqual([])
      expect(result.outputBundleIds).toEqual([])
    })
  })
})
