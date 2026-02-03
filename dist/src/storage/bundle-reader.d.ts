/**
 * BundleReaderService - Efficient reading of objects from bundles stored in R2
 *
 * This service provides high-level access to bundled Git objects with:
 * - Index caching for fast lookups
 * - Range reads for partial object data
 * - Batch read operations
 * - LRU cache eviction for bundle indices
 */
import type { StorageBackend } from './backend';
import { type BundleObjectType, type BundleIndexEntry, type BundleObject } from './bundle-format';
export type { BundleObjectType, BundleIndexEntry, BundleObject };
/**
 * Options for configuring the BundleReaderService
 */
export interface BundleReaderOptions {
    /** Maximum number of bundle indices to keep in cache */
    maxCachedBundles?: number;
    /** Maximum total bytes for cached bundle data */
    maxCacheBytes?: number;
    /** TTL in milliseconds for cached indices */
    indexCacheTTL?: number;
}
/**
 * Result of a range read operation
 */
export interface RangeReadResult {
    /** Object ID */
    oid: string;
    /** Object type */
    type: BundleObjectType;
    /** Total size of the object in bytes */
    totalSize: number;
    /** Starting offset of the returned data */
    offset: number;
    /** The partial data read */
    data: Uint8Array;
    /** True if the data was truncated due to object boundaries */
    truncated: boolean;
}
/**
 * Result of a batch read operation
 */
export type BatchReadResult = Array<BundleObject | null>;
/**
 * Cache statistics for the BundleReaderService
 */
export interface BundleReaderCacheStats {
    /** Number of cache hits */
    hits: number;
    /** Number of cache misses */
    misses: number;
    /** Number of bundles currently cached */
    bundleCount: number;
    /** Total bytes used by cached bundles */
    bytes: number;
    /** Hit rate as a percentage (0-100) */
    hitRate: number;
}
export declare class BundleReaderError extends Error {
    constructor(message: string);
}
export declare class BundleNotFoundError extends BundleReaderError {
    constructor(bundlePath: string);
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
export declare class BundleReaderService {
    private storage;
    private options;
    private cache;
    private pendingLoads;
    private cacheBytes;
    private cacheHits;
    private cacheMisses;
    constructor(storage: StorageBackend, options?: BundleReaderOptions);
    /**
     * Maximum number of bundles that can be cached
     */
    get maxCachedBundles(): number;
    /**
     * Load a bundle from storage and cache it
     */
    private loadBundle;
    private loadBundleFromStorage;
    private evictIfNeeded;
    private validateOidLength;
    /**
     * Read a single object from a bundle by OID
     *
     * @throws {BundleReaderError} If OID length is invalid
     * @throws {BundleReaderError} If storage read fails
     * @throws {BundleNotFoundError} If bundle does not exist
     * @throws {BundleFormatError} If bundle format is invalid
     */
    readObject(bundlePath: string, oid: string): Promise<BundleObject | null>;
    /**
     * Read a range of bytes from an object
     *
     * @throws {BundleReaderError} If object is not found in bundle
     * @throws {BundleNotFoundError} If bundle does not exist
     * @throws {BundleFormatError} If bundle format is invalid
     */
    readObjectRange(bundlePath: string, oid: string, start: number, end?: number): Promise<RangeReadResult>;
    /**
     * Batch read multiple objects from a bundle
     */
    readObjectsBatch(bundlePath: string, oids: string[]): Promise<BatchReadResult>;
    /**
     * List all OIDs in a bundle
     */
    listOids(bundlePath: string): Promise<string[]>;
    /**
     * Check if an object exists in a bundle
     */
    hasObject(bundlePath: string, oid: string): Promise<boolean>;
    /**
     * Get entry metadata without reading the full object data
     */
    getEntry(bundlePath: string, oid: string): Promise<BundleIndexEntry | null>;
    /**
     * Get cache statistics
     */
    getCacheStats(): BundleReaderCacheStats;
    /**
     * Clear all cached bundle data
     */
    clearCache(): void;
}
//# sourceMappingURL=bundle-reader.d.ts.map