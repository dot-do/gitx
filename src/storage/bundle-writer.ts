/**
 * BundleWriter - High-level component for creating bundles from git objects
 *
 * Responsibilities:
 * - Accept git objects and add to current bundle
 * - Track bundle size, flush when reaching size limit
 * - Rotate to new bundle file when current is full
 * - Write bundle header and index on flush
 *
 * This is a stub file for RED phase TDD.
 * All exports throw "not implemented" errors.
 */

import { BundleObjectType } from './bundle-format'

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

/**
 * BundleWriter class - creates bundles from git objects
 */
export class BundleWriter {
  constructor(
    _config: BundleWriterConfig,
    _storage: BundleWriterStorage
  ) {
    throw new Error('BundleWriter not implemented')
  }

  get config(): BundleWriterConfig & { maxBundleSize: number; storagePrefix: string } {
    throw new Error('BundleWriter.config not implemented')
  }

  get currentBundleId(): string {
    throw new Error('BundleWriter.currentBundleId not implemented')
  }

  get currentBundleObjectCount(): number {
    throw new Error('BundleWriter.currentBundleObjectCount not implemented')
  }

  get currentBundleSize(): number {
    throw new Error('BundleWriter.currentBundleSize not implemented')
  }

  get remainingCapacity(): number {
    throw new Error('BundleWriter.remainingCapacity not implemented')
  }

  get totalBundlesWritten(): number {
    throw new Error('BundleWriter.totalBundlesWritten not implemented')
  }

  hasObject(_oid: string): boolean {
    throw new Error('BundleWriter.hasObject not implemented')
  }

  canAccept(_bytes: number): boolean {
    throw new Error('BundleWriter.canAccept not implemented')
  }

  async add(
    _oid: string,
    _type: BundleObjectType,
    _data: Uint8Array
  ): Promise<void> {
    throw new Error('BundleWriter.add not implemented')
  }

  async addBatch(
    _objects: Array<{ oid: string; type: BundleObjectType; data: Uint8Array }>
  ): Promise<void> {
    throw new Error('BundleWriter.addBatch not implemented')
  }

  async flush(): Promise<BundleMetadata> {
    throw new Error('BundleWriter.flush not implemented')
  }

  onRotation(_callback: RotationCallback): void {
    throw new Error('BundleWriter.onRotation not implemented')
  }

  getStats(): BundleWriterStats {
    throw new Error('BundleWriter.getStats not implemented')
  }

  getWrittenBundleIds(): string[] {
    throw new Error('BundleWriter.getWrittenBundleIds not implemented')
  }

  getBundleMetadata(_id: string): BundleMetadata | undefined {
    throw new Error('BundleWriter.getBundleMetadata not implemented')
  }

  async close(): Promise<BundleWriterFinalMetadata> {
    throw new Error('BundleWriter.close not implemented')
  }
}
