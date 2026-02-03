/**
 * BundleReaderService - Efficient reading of objects from bundles stored in R2
 *
 * This service provides high-level access to bundled Git objects with:
 * - Index caching for fast lookups
 * - Range reads for partial object data
 * - Batch read operations
 * - LRU cache eviction for bundle indices
 */

import type { StorageBackend } from './backend'
import {
  BundleReader,
  BundleFormatError,
  type BundleObjectType,
  type BundleIndexEntry,
  type BundleObject
} from './bundle-format'

// Re-export types from bundle-format for convenience
export type { BundleObjectType, BundleIndexEntry, BundleObject }

/**
 * Options for configuring the BundleReaderService
 */
export interface BundleReaderOptions {
  /** Maximum number of bundle indices to keep in cache */
  maxCachedBundles?: number

  /** Maximum total bytes for cached bundle data */
  maxCacheBytes?: number

  /** TTL in milliseconds for cached indices */
  indexCacheTTL?: number
}

/**
 * Result of a range read operation
 */
export interface RangeReadResult {
  /** Object ID */
  oid: string

  /** Object type */
  type: BundleObjectType

  /** Total size of the object in bytes */
  totalSize: number

  /** Starting offset of the returned data */
  offset: number

  /** The partial data read */
  data: Uint8Array

  /** True if the data was truncated due to object boundaries */
  truncated: boolean
}

/**
 * Result of a batch read operation
 */
export type BatchReadResult = Array<BundleObject | null>

/**
 * Cache statistics for the BundleReaderService
 */
export interface BundleReaderCacheStats {
  /** Number of cache hits */
  hits: number

  /** Number of cache misses */
  misses: number

  /** Number of bundles currently cached */
  bundleCount: number

  /** Total bytes used by cached bundles */
  bytes: number

  /** Hit rate as a percentage (0-100) */
  hitRate: number
}

// Error classes
export class BundleReaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BundleReaderError'
  }
}

export class BundleNotFoundError extends BundleReaderError {
  constructor(bundlePath: string) {
    super(`Bundle not found: ${bundlePath}`)
    this.name = 'BundleNotFoundError'
  }
}

interface CachedBundle {
  reader: BundleReader
  data: Uint8Array
  size: number
  lastAccess: number
}

/**
 * BundleReaderService - High-level service for reading objects from bundles
 *
 * Provides efficient access to Git objects stored in bundles with:
 * - LRU caching of bundle indices
 * - Range read support for partial object data
 * - Batch read operations for multiple objects
 * - Concurrent read handling
 */
export class BundleReaderService {
  private storage: StorageBackend
  private options: Required<BundleReaderOptions>
  private cache: Map<string, CachedBundle> = new Map()
  private pendingLoads: Map<string, Promise<CachedBundle>> = new Map()
  private cacheBytes: number = 0
  private cacheHits: number = 0
  private cacheMisses: number = 0

  constructor(storage: StorageBackend, options?: BundleReaderOptions) {
    this.storage = storage
    this.options = {
      maxCachedBundles: options?.maxCachedBundles ?? 100,
      maxCacheBytes: options?.maxCacheBytes ?? 100 * 1024 * 1024, // 100MB default
      indexCacheTTL: options?.indexCacheTTL ?? 3600000 // 1 hour default
    }
  }

  /**
   * Maximum number of bundles that can be cached
   */
  get maxCachedBundles(): number {
    return this.options.maxCachedBundles
  }

  /**
   * Load a bundle from storage and cache it
   */
  private async loadBundle(bundlePath: string): Promise<CachedBundle> {
    // Check if already loading
    const pending = this.pendingLoads.get(bundlePath)
    if (pending) {
      return pending
    }

    // Check cache first
    const cached = this.cache.get(bundlePath)
    if (cached) {
      this.cacheHits++
      cached.lastAccess = Date.now()
      // Move to end of Map for LRU
      this.cache.delete(bundlePath)
      this.cache.set(bundlePath, cached)
      return cached
    }

    this.cacheMisses++

    // Load from storage
    const loadPromise = this.loadBundleFromStorage(bundlePath)
    this.pendingLoads.set(bundlePath, loadPromise)

    try {
      const result = await loadPromise
      return result
    } finally {
      this.pendingLoads.delete(bundlePath)
    }
  }

  private async loadBundleFromStorage(bundlePath: string): Promise<CachedBundle> {
    let data: Uint8Array | null
    try {
      data = await this.storage.readFile(bundlePath)
    } catch (error) {
      throw new BundleReaderError(
        `Storage read failed for ${bundlePath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    if (!data) {
      throw new BundleNotFoundError(bundlePath)
    }

    // Parse the bundle
    let reader: BundleReader
    try {
      reader = new BundleReader(data)
    } catch (error) {
      if (error instanceof BundleFormatError) {
        throw error
      }
      throw error
    }

    const cachedBundle: CachedBundle = {
      reader,
      data,
      size: data.length,
      lastAccess: Date.now()
    }

    // Evict if needed before adding
    this.evictIfNeeded(data.length)

    // Add to cache
    this.cache.set(bundlePath, cachedBundle)
    this.cacheBytes += data.length

    return cachedBundle
  }

  private evictIfNeeded(additionalBytes: number): void {
    // Evict by count
    while (
      this.cache.size >= this.options.maxCachedBundles ||
      this.cacheBytes + additionalBytes > this.options.maxCacheBytes
    ) {
      if (this.cache.size === 0) break

      // Evict oldest (first in Map)
      const oldest = this.cache.keys().next()
      if (oldest.done) break

      const evicted = this.cache.get(oldest.value)
      if (evicted) {
        this.cacheBytes -= evicted.size
      }
      this.cache.delete(oldest.value)
    }
  }

  private validateOidLength(oid: string): void {
    if (oid.length !== 40) {
      throw new BundleReaderError(`Invalid OID length: expected 40, got ${oid.length}`)
    }
  }

  /**
   * Read a single object from a bundle by OID
   *
   * @throws {BundleReaderError} If OID length is invalid
   * @throws {BundleReaderError} If storage read fails
   * @throws {BundleNotFoundError} If bundle does not exist
   * @throws {BundleFormatError} If bundle format is invalid
   */
  async readObject(bundlePath: string, oid: string): Promise<BundleObject | null> {
    this.validateOidLength(oid)
    const cached = await this.loadBundle(bundlePath)
    return cached.reader.readObject(oid)
  }

  /**
   * Read a range of bytes from an object
   *
   * @throws {BundleReaderError} If object is not found in bundle
   * @throws {BundleNotFoundError} If bundle does not exist
   * @throws {BundleFormatError} If bundle format is invalid
   */
  async readObjectRange(
    bundlePath: string,
    oid: string,
    start: number,
    end?: number
  ): Promise<RangeReadResult> {
    const cached = await this.loadBundle(bundlePath)
    const entry = cached.reader.getEntry(oid)

    if (!entry) {
      throw new BundleReaderError(`Object not found: ${oid}`)
    }

    const totalSize = entry.size

    // Clamp start to valid range
    const actualStart = Math.min(Math.max(0, start), totalSize)

    // Determine end position
    let actualEnd: number
    if (end === undefined) {
      actualEnd = totalSize
    } else {
      actualEnd = Math.min(Math.max(actualStart, end), totalSize)
    }

    // Handle out-of-bounds start
    if (actualStart >= totalSize) {
      return {
        oid,
        type: entry.type,
        totalSize,
        offset: actualStart,
        data: new Uint8Array(0),
        truncated: false
      }
    }

    // Read the full object and slice
    const fullObject = cached.reader.readObject(oid)
    if (!fullObject) {
      throw new BundleReaderError(`Object not found: ${oid}`)
    }

    const data = fullObject.data.slice(actualStart, actualEnd)
    const truncated = end !== undefined && end > totalSize

    return {
      oid,
      type: entry.type,
      totalSize,
      offset: actualStart,
      data,
      truncated
    }
  }

  /**
   * Batch read multiple objects from a bundle
   */
  async readObjectsBatch(bundlePath: string, oids: string[]): Promise<BatchReadResult> {
    if (oids.length === 0) {
      return []
    }

    const cached = await this.loadBundle(bundlePath)
    const results: BatchReadResult = []

    for (const oid of oids) {
      const obj = cached.reader.readObject(oid)
      results.push(obj)
    }

    return results
  }

  /**
   * List all OIDs in a bundle
   */
  async listOids(bundlePath: string): Promise<string[]> {
    const cached = await this.loadBundle(bundlePath)
    return cached.reader.listOids()
  }

  /**
   * Check if an object exists in a bundle
   */
  async hasObject(bundlePath: string, oid: string): Promise<boolean> {
    const cached = await this.loadBundle(bundlePath)
    return cached.reader.hasObject(oid)
  }

  /**
   * Get entry metadata without reading the full object data
   */
  async getEntry(bundlePath: string, oid: string): Promise<BundleIndexEntry | null> {
    const cached = await this.loadBundle(bundlePath)
    return cached.reader.getEntry(oid)
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): BundleReaderCacheStats {
    const total = this.cacheHits + this.cacheMisses
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      bundleCount: this.cache.size,
      bytes: this.cacheBytes,
      hitRate: total > 0 ? (this.cacheHits / total) * 100 : 0
    }
  }

  /**
   * Clear all cached bundle data
   */
  clearCache(): void {
    this.cache.clear()
    this.cacheBytes = 0
  }
}
