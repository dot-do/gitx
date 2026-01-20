/**
 * BundleWriter - High-level component for creating bundles from git objects
 *
 * Responsibilities:
 * - Accept git objects and add to current bundle
 * - Track bundle size, flush when reaching size limit
 * - Rotate to new bundle file when current is full
 * - Write bundle header and index on flush
 */

import {
  BundleObjectType,
  BUNDLE_HEADER_SIZE,
  BUNDLE_INDEX_ENTRY_SIZE,
  createBundle
} from './bundle-format'

// Configuration types
export interface BundleWriterConfig {
  maxBundleSize?: number
  storagePrefix?: string
}

// Storage interface for bundle persistence
export interface BundleWriterStorage {
  write(key: string, data: Uint8Array): Promise<void>
  read(key: string): Promise<Uint8Array | null>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

// Bundle metadata returned after flush
export interface BundleMetadata {
  id: string
  size: number
  objectCount: number
  isEmpty?: boolean
  createdAt?: Date
}

// Event emitted on bundle rotation
export interface BundleRotationEvent {
  previousBundleId: string
  newBundleId: string
  previousBundleMetadata: BundleMetadata
}

// Statistics for cumulative tracking
export interface BundleWriterStats {
  totalObjectsWritten: number
  totalBytesWritten: number
  bundleCount: number
}

// Final metadata returned on close
export interface BundleWriterFinalMetadata {
  totalBundles: number
  totalObjects: number
  bundleIds: string[]
}

// Error class for BundleWriter operations
export class BundleWriterError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'BundleWriterError'
  }
}

// Type for rotation callback
export type RotationCallback = (event: BundleRotationEvent) => void

function generateBundleId(): string {
  // Generate a sortable, unique ID using timestamp + random
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `${timestamp}-${random}`
}

/**
 * BundleWriter class - creates bundles from git objects
 */
export class BundleWriter {
  private _config: { maxBundleSize: number; storagePrefix: string }
  private storage: BundleWriterStorage
  private _currentBundleId: string
  private objects: Map<string, { type: BundleObjectType; data: Uint8Array }> = new Map()
  private _totalBundlesWritten: number = 0
  private rotationCallbacks: RotationCallback[] = []
  private writtenBundles: Map<string, BundleMetadata> = new Map()
  private _closed: boolean = false
  private flushLock: Promise<BundleMetadata> | null = null
  private totalObjectsWritten: number = 0
  private totalBytesWritten: number = 0

  constructor(config: BundleWriterConfig, storage: BundleWriterStorage) {
    this._config = {
      maxBundleSize: config.maxBundleSize ?? 2 * 1024 * 1024, // 2MB default
      storagePrefix: config.storagePrefix ?? 'objects/bundles/'
    }
    this.storage = storage
    this._currentBundleId = generateBundleId()
  }

  get config(): BundleWriterConfig & { maxBundleSize: number; storagePrefix: string } {
    return { ...this._config }
  }

  get currentBundleId(): string {
    return this._currentBundleId
  }

  get currentBundleObjectCount(): number {
    return this.objects.size
  }

  get currentBundleSize(): number {
    // Header + data + index entries
    // Always include header for accurate size tracking of the final bundle
    let dataSize = 0
    for (const obj of this.objects.values()) {
      dataSize += obj.data.length
    }
    return BUNDLE_HEADER_SIZE + dataSize + this.objects.size * BUNDLE_INDEX_ENTRY_SIZE
  }

  get remainingCapacity(): number {
    return this._config.maxBundleSize - this.currentBundleSize
  }

  get totalBundlesWritten(): number {
    return this._totalBundlesWritten
  }

  hasObject(oid: string): boolean {
    return this.objects.has(oid)
  }

  canAccept(bytes: number): boolean {
    const projectedSize = this.currentBundleSize + bytes + BUNDLE_INDEX_ENTRY_SIZE
    return projectedSize <= this._config.maxBundleSize
  }

  async add(oid: string, type: BundleObjectType, data: Uint8Array): Promise<void> {
    if (this._closed) {
      throw new BundleWriterError('Cannot add to closed writer')
    }

    if (this.objects.has(oid)) {
      throw new BundleWriterError(`Duplicate OID: ${oid}`)
    }

    const entrySize = data.length + BUNDLE_INDEX_ENTRY_SIZE
    const projectedSize = this.currentBundleSize + entrySize

    // Check if we need to rotate (flush current bundle first)
    if (projectedSize > this._config.maxBundleSize && this.objects.size > 0) {
      // Rotate bundle
      try {
        await this.rotate()
      } catch (error) {
        throw new BundleWriterError(
          `Failed to rotate bundle during add`,
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }

    // Add object to current bundle
    this.objects.set(oid, { type, data })
  }

  async addBatch(
    objects: Array<{ oid: string; type: BundleObjectType; data: Uint8Array }>
  ): Promise<void> {
    for (const obj of objects) {
      await this.add(obj.oid, obj.type, obj.data)
    }
  }

  private async rotate(): Promise<void> {
    const previousBundleId = this._currentBundleId
    const metadata = await this.flushInternal()

    // Generate new bundle ID
    this._currentBundleId = generateBundleId()

    // Emit rotation event if we actually wrote something
    if (!metadata.isEmpty) {
      const event: BundleRotationEvent = {
        previousBundleId,
        newBundleId: this._currentBundleId,
        previousBundleMetadata: metadata
      }

      for (const callback of this.rotationCallbacks) {
        callback(event)
      }
    }
  }

  async flush(): Promise<BundleMetadata> {
    // Serialize flush operations
    if (this.flushLock) {
      await this.flushLock
      // Return empty metadata for concurrent flush
      return {
        id: this._currentBundleId,
        size: 0,
        objectCount: 0,
        isEmpty: true
      }
    }

    const flushPromise = this.flushInternal()
    this.flushLock = flushPromise

    try {
      const result = await flushPromise
      return result
    } finally {
      this.flushLock = null
    }
  }

  private async flushInternal(): Promise<BundleMetadata> {
    // Handle empty flush
    if (this.objects.size === 0) {
      return {
        id: this._currentBundleId,
        size: 0,
        objectCount: 0,
        isEmpty: true
      }
    }

    // Build bundle
    const objectsArray = Array.from(this.objects.entries()).map(([oid, obj]) => ({
      oid,
      type: obj.type,
      data: obj.data
    }))

    const bundleData = createBundle(objectsArray)
    const key = `${this._config.storagePrefix}${this._currentBundleId}`

    // Write to storage
    try {
      await this.storage.write(key, bundleData)
    } catch (error) {
      throw new BundleWriterError(
        `Failed to write bundle to storage`,
        error instanceof Error ? error : new Error(String(error))
      )
    }

    const metadata: BundleMetadata = {
      id: this._currentBundleId,
      size: bundleData.length,
      objectCount: this.objects.size,
      createdAt: new Date()
    }

    // Update stats
    this._totalBundlesWritten++
    this.totalObjectsWritten += this.objects.size
    this.totalBytesWritten += bundleData.length
    this.writtenBundles.set(this._currentBundleId, metadata)

    // Clear current bundle
    this.objects.clear()

    // Generate new bundle ID for next bundle
    this._currentBundleId = generateBundleId()

    return metadata
  }

  onRotation(callback: RotationCallback): void {
    this.rotationCallbacks.push(callback)
  }

  getStats(): BundleWriterStats {
    return {
      totalObjectsWritten: this.totalObjectsWritten,
      totalBytesWritten: this.totalBytesWritten,
      bundleCount: this._totalBundlesWritten
    }
  }

  getWrittenBundleIds(): string[] {
    return Array.from(this.writtenBundles.keys())
  }

  getBundleMetadata(id: string): BundleMetadata | undefined {
    return this.writtenBundles.get(id)
  }

  async close(): Promise<BundleWriterFinalMetadata> {
    if (this._closed) {
      // Idempotent close
      return {
        totalBundles: this._totalBundlesWritten,
        totalObjects: this.totalObjectsWritten,
        bundleIds: this.getWrittenBundleIds()
      }
    }

    // Flush any remaining objects
    if (this.objects.size > 0) {
      await this.flush()
    }

    this._closed = true

    return {
      totalBundles: this._totalBundlesWritten,
      totalObjects: this.totalObjectsWritten,
      bundleIds: this.getWrittenBundleIds()
    }
  }
}
