/**
 * @fileoverview BundleReader - Efficient reading of git objects from R2 bundles
 *
 * Provides two reader implementations:
 * 1. InMemoryBundleReader - Parses a complete bundle from a Uint8Array (for cached bundles)
 * 2. R2BundleReader - Service layer with LRU cache and R2 range read support
 *
 * The R2BundleReader caches parsed bundle indices in an LRU cache to avoid
 * re-downloading and re-parsing bundles on every lookup. For large objects,
 * R2 range reads can fetch only the needed bytes.
 *
 * @module storage/bundle/reader
 */
import { type BundleObject, type BundleIndexEntry, type BundleObjectType } from './format';
/** R2-compatible storage interface for reading bundles */
export interface BundleReadStorage {
    /** Read a complete object from storage */
    get(key: string): Promise<Uint8Array | null>;
    /** Read a byte range from storage (for partial object reads) */
    getRange?(key: string, offset: number, length: number): Promise<Uint8Array | null>;
}
/** Configuration for R2BundleReader */
export interface BundleReaderConfig {
    /** Maximum number of bundle indices to cache (default: 64) */
    maxCachedBundles?: number;
    /** Maximum total bytes for cached bundle data (default: 256MB) */
    maxCacheBytes?: number;
}
/** Result of a range read */
export interface RangeReadResult {
    oid: string;
    type: BundleObjectType;
    totalSize: number;
    offset: number;
    data: Uint8Array;
    truncated: boolean;
}
/** Cache statistics */
export interface BundleReaderCacheStats {
    hits: number;
    misses: number;
    bundleCount: number;
    cacheBytes: number;
    hitRate: number;
}
/** Error for reader operations */
export declare class BundleReaderError extends Error {
    constructor(message: string);
}
/** Error when a bundle is not found in storage */
export declare class BundleNotFoundError extends BundleReaderError {
    constructor(key: string);
}
/**
 * Reads objects from a fully-loaded bundle in memory.
 *
 * Useful when the entire bundle has been fetched from R2 and cached.
 * Supports iteration over all objects.
 */
export declare class InMemoryBundleReader implements Iterable<BundleObject> {
    private readonly bundle;
    constructor(data: Uint8Array, options?: {
        verify?: boolean;
    });
    /** Number of objects in the bundle */
    get entryCount(): number;
    /** Read a single object by OID */
    readObject(oid: string): BundleObject | null;
    /** Check if an object exists in the bundle */
    hasObject(oid: string): boolean;
    /** List all OIDs in sorted order */
    listOids(): string[];
    /** Get index entry metadata for an OID without reading data */
    getEntry(oid: string): BundleIndexEntry | null;
    /** Iterate over all objects in the bundle */
    [Symbol.iterator](): Iterator<BundleObject>;
}
/**
 * Service layer for reading objects from bundles stored in R2.
 *
 * Features:
 * - LRU cache for bundle indices (avoids repeated R2 GETs)
 * - Range read support for partial object fetches
 * - Batch read for fetching multiple objects from one bundle
 * - Deduplicates concurrent loads for the same bundle
 *
 * @example
 * ```typescript
 * const reader = new R2BundleReader(r2Storage, { maxCachedBundles: 32 })
 * const obj = await reader.readObject('bundles/abc.bundle', sha)
 * if (obj) {
 *   console.log(`Got ${obj.type} object, ${obj.data.length} bytes`)
 * }
 * ```
 */
export declare class R2BundleReader {
    private readonly storage;
    private readonly config;
    private readonly cache;
    private readonly pendingLoads;
    private cacheBytes;
    private cacheHits;
    private cacheMisses;
    constructor(storage: BundleReadStorage, config?: BundleReaderConfig);
    /** Read a single object from a bundle by OID */
    readObject(bundleKey: string, oid: string): Promise<BundleObject | null>;
    /** Read a byte range from an object */
    readObjectRange(bundleKey: string, oid: string, start: number, end?: number): Promise<RangeReadResult>;
    /** Batch read multiple objects from a single bundle */
    readObjectsBatch(bundleKey: string, oids: string[]): Promise<Array<BundleObject | null>>;
    /** Check if an object exists in a bundle */
    hasObject(bundleKey: string, oid: string): Promise<boolean>;
    /** List all OIDs in a bundle */
    listOids(bundleKey: string): Promise<string[]>;
    /** Get index entry metadata without reading object data */
    getEntry(bundleKey: string, oid: string): Promise<BundleIndexEntry | null>;
    /** Get cache statistics */
    getCacheStats(): BundleReaderCacheStats;
    /** Evict all cached bundles */
    clearCache(): void;
    /** Evict a specific bundle from cache */
    evictBundle(bundleKey: string): boolean;
    private loadBundle;
    private fetchAndCache;
    private evictIfNeeded;
}
//# sourceMappingURL=reader.d.ts.map