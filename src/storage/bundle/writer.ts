/**
 * @fileoverview BundleWriter - Buffered writes with rotation and sealing for R2 bundle storage
 *
 * The BundleWriter accumulates git objects in memory until a size threshold is reached,
 * then flushes (seals) the current bundle to R2 and rotates to a new one. This batching
 * strategy minimizes R2 PUT operations while keeping memory usage bounded.
 *
 * Lifecycle:
 * 1. Create writer with R2 bucket and config
 * 2. Add objects via add() - auto-rotates when bundle is full
 * 3. Call flush() to seal the current bundle to R2
 * 4. Call close() to flush remaining objects and finalize
 *
 * @module storage/bundle/writer
 */

import {
  type BundleObjectType,
  BUNDLE_HEADER_SIZE,
  BUNDLE_INDEX_ENTRY_SIZE,
  DEFAULT_MAX_BUNDLE_SIZE,
  createBundle,
} from './format'

// ============================================================================
// Types
// ============================================================================

/** Configuration for the BundleWriter */
export interface BundleWriterConfig {
  /** Maximum size of a single bundle before rotation (default: 128MB) */
  maxBundleSize?: number
  /** R2 key prefix for bundle files (default: 'bundles/') */
  keyPrefix?: string
  /** Whether to include checksums in written bundles (default: true) */
  checksums?: boolean
}

/** R2-compatible storage interface for writing bundles */
export interface BundleWriteStorage {
  /** Write a bundle to storage at the given key */
  put(key: string, data: Uint8Array | ArrayBuffer): Promise<void>
  /** Delete a bundle from storage */
  delete(key: string): Promise<void>
}

/** Metadata about a sealed bundle */
export interface SealedBundleMetadata {
  /** Unique bundle ID */
  id: string
  /** R2 key where the bundle is stored */
  key: string
  /** Total size in bytes */
  size: number
  /** Number of objects in the bundle */
  objectCount: number
  /** Timestamp when the bundle was sealed */
  sealedAt: number
}

/** Event emitted when a bundle is rotated */
export interface BundleRotationEvent {
  /** ID of the bundle that was just sealed */
  sealedBundleId: string
  /** Metadata of the sealed bundle */
  sealedMetadata: SealedBundleMetadata
  /** ID of the new active bundle */
  newBundleId: string
}

/** Cumulative writer statistics */
export interface BundleWriterStats {
  /** Total objects written across all bundles */
  totalObjectsWritten: number
  /** Total bytes written across all bundles */
  totalBytesWritten: number
  /** Number of bundles sealed */
  bundlesSealed: number
  /** Number of auto-rotations triggered */
  rotations: number
}

/** Final metadata returned when writer is closed */
export interface BundleWriterFinalResult {
  /** Total bundles written (including final flush) */
  totalBundles: number
  /** Total objects written */
  totalObjects: number
  /** All sealed bundle IDs in order */
  bundleIds: string[]
  /** All sealed bundle metadata */
  bundles: SealedBundleMetadata[]
}

export class BundleWriterError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message)
    this.name = 'BundleWriterError'
  }
}

export type RotationCallback = (event: BundleRotationEvent) => void

// ============================================================================
// BundleWriter
// ============================================================================

function generateBundleId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `${timestamp}-${random}`
}

/**
 * BundleWriter accumulates git objects and writes them as bundles to R2.
 *
 * Objects are buffered in memory. When the buffer exceeds `maxBundleSize`,
 * the current bundle is sealed (written to R2) and a new bundle is started.
 *
 * @example
 * ```typescript
 * const writer = new BundleWriter(r2Storage, { maxBundleSize: 64 * 1024 * 1024 })
 * await writer.add(oid, BundleObjectType.BLOB, data)
 * await writer.add(oid2, BundleObjectType.TREE, treeData)
 * const result = await writer.close()
 * console.log(`Wrote ${result.totalObjects} objects in ${result.totalBundles} bundles`)
 * ```
 */
export class BundleWriter {
  private readonly config: Required<BundleWriterConfig>
  private readonly storage: BundleWriteStorage
  private currentBundleId: string
  private objects: Map<string, { type: BundleObjectType; data: Uint8Array }> = new Map()
  private sealedBundles: SealedBundleMetadata[] = []
  private rotationCallbacks: RotationCallback[] = []
  private closed = false
  private flushLock: Promise<SealedBundleMetadata | null> | null = null
  private stats: BundleWriterStats = {
    totalObjectsWritten: 0,
    totalBytesWritten: 0,
    bundlesSealed: 0,
    rotations: 0,
  }

  constructor(storage: BundleWriteStorage, config?: BundleWriterConfig) {
    this.config = {
      maxBundleSize: config?.maxBundleSize ?? DEFAULT_MAX_BUNDLE_SIZE,
      keyPrefix: config?.keyPrefix ?? 'bundles/',
      checksums: config?.checksums ?? true,
    }
    this.storage = storage
    this.currentBundleId = generateBundleId()
  }

  /** Current active bundle ID */
  get activeBundleId(): string {
    return this.currentBundleId
  }

  /** Number of objects in the current (unflushed) bundle */
  get pendingObjectCount(): number {
    return this.objects.size
  }

  /** Estimated size of the current bundle if it were sealed now */
  get pendingSize(): number {
    let dataSize = 0
    for (const obj of this.objects.values()) {
      dataSize += obj.data.length
    }
    return BUNDLE_HEADER_SIZE + dataSize + this.objects.size * BUNDLE_INDEX_ENTRY_SIZE
  }

  /** Remaining capacity in the current bundle before rotation */
  get remainingCapacity(): number {
    return Math.max(0, this.config.maxBundleSize - this.pendingSize)
  }

  /** Whether the writer has been closed */
  get isClosed(): boolean {
    return this.closed
  }

  /** Check if a specific OID is in the current pending buffer */
  hasPendingObject(oid: string): boolean {
    return this.objects.has(oid)
  }

  /** Check if the writer can accept an object of the given size without rotating */
  canAccept(dataSize: number): boolean {
    const projected = this.pendingSize + dataSize + BUNDLE_INDEX_ENTRY_SIZE
    return projected <= this.config.maxBundleSize
  }

  /**
   * Add a git object to the current bundle.
   *
   * If adding the object would exceed the max bundle size and there are
   * already objects in the buffer, the current bundle is sealed and rotated
   * before the new object is added.
   */
  async add(oid: string, type: BundleObjectType, data: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new BundleWriterError('Cannot add to closed writer')
    }
    if (this.objects.has(oid)) {
      throw new BundleWriterError(`Duplicate OID: ${oid}`)
    }

    const entrySize = data.length + BUNDLE_INDEX_ENTRY_SIZE
    const projected = this.pendingSize + entrySize

    if (projected > this.config.maxBundleSize && this.objects.size > 0) {
      await this.rotate()
    }

    this.objects.set(oid, { type, data })
  }

  /**
   * Add multiple objects in a batch. Each object may trigger rotation independently.
   */
  async addBatch(
    objects: Array<{ oid: string; type: BundleObjectType; data: Uint8Array }>
  ): Promise<void> {
    for (const obj of objects) {
      await this.add(obj.oid, obj.type, obj.data)
    }
  }

  /** Register a callback to be notified when a bundle is rotated */
  onRotation(callback: RotationCallback): void {
    this.rotationCallbacks.push(callback)
  }

  /**
   * Flush the current bundle to R2 storage.
   *
   * Returns null if there are no pending objects. Concurrent flush calls
   * are serialized (subsequent calls wait for the first to complete).
   */
  async flush(): Promise<SealedBundleMetadata | null> {
    if (this.flushLock) {
      await this.flushLock
      return null
    }

    const promise = this.flushInternal()
    this.flushLock = promise
    try {
      return await promise
    } finally {
      this.flushLock = null
    }
  }

  /**
   * Close the writer, flushing any remaining objects.
   *
   * After close, no more objects can be added. Calling close multiple
   * times is safe (idempotent).
   */
  async close(): Promise<BundleWriterFinalResult> {
    if (this.closed) {
      return this.buildFinalResult()
    }

    if (this.objects.size > 0) {
      await this.flush()
    }

    this.closed = true
    return this.buildFinalResult()
  }

  /** Get cumulative statistics */
  getStats(): BundleWriterStats {
    return { ...this.stats }
  }

  /** Get metadata for all sealed bundles */
  getSealedBundles(): SealedBundleMetadata[] {
    return [...this.sealedBundles]
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async rotate(): Promise<void> {
    const sealedId = this.currentBundleId
    const metadata = await this.flushInternal()

    this.currentBundleId = generateBundleId()
    this.stats.rotations++

    if (metadata) {
      const event: BundleRotationEvent = {
        sealedBundleId: sealedId,
        sealedMetadata: metadata,
        newBundleId: this.currentBundleId,
      }
      for (const cb of this.rotationCallbacks) {
        cb(event)
      }
    }
  }

  private async flushInternal(): Promise<SealedBundleMetadata | null> {
    if (this.objects.size === 0) {
      return null
    }

    const objectsArray = Array.from(this.objects.entries()).map(([oid, obj]) => ({
      oid,
      type: obj.type,
      data: obj.data,
    }))

    const bundleData = createBundle(objectsArray)
    const key = `${this.config.keyPrefix}${this.currentBundleId}.bundle`

    try {
      await this.storage.put(key, bundleData)
    } catch (error) {
      throw new BundleWriterError(
        'Failed to write bundle to R2',
        error instanceof Error ? error : new Error(String(error))
      )
    }

    const metadata: SealedBundleMetadata = {
      id: this.currentBundleId,
      key,
      size: bundleData.length,
      objectCount: this.objects.size,
      sealedAt: Date.now(),
    }

    this.stats.totalObjectsWritten += this.objects.size
    this.stats.totalBytesWritten += bundleData.length
    this.stats.bundlesSealed++
    this.sealedBundles.push(metadata)

    this.objects.clear()
    this.currentBundleId = generateBundleId()

    return metadata
  }

  private buildFinalResult(): BundleWriterFinalResult {
    return {
      totalBundles: this.sealedBundles.length,
      totalObjects: this.stats.totalObjectsWritten,
      bundleIds: this.sealedBundles.map((b) => b.id),
      bundles: [...this.sealedBundles],
    }
  }
}
