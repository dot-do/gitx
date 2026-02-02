/**
 * BundleReaderService - Efficient reading of objects from bundles stored in R2
 *
 * This service provides high-level access to bundled Git objects with:
 * - Index caching for fast lookups
 * - Range reads for partial object data
 * - Batch read operations
 * - LRU cache eviction for bundle indices
 */
import { BundleReader, BundleFormatError } from './bundle-format';
// Error classes
export class BundleReaderError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BundleReaderError';
    }
}
export class BundleNotFoundError extends BundleReaderError {
    constructor(bundlePath) {
        super(`Bundle not found: ${bundlePath}`);
        this.name = 'BundleNotFoundError';
    }
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
    storage;
    options;
    cache = new Map();
    pendingLoads = new Map();
    cacheBytes = 0;
    cacheHits = 0;
    cacheMisses = 0;
    constructor(storage, options) {
        this.storage = storage;
        this.options = {
            maxCachedBundles: options?.maxCachedBundles ?? 100,
            maxCacheBytes: options?.maxCacheBytes ?? 100 * 1024 * 1024, // 100MB default
            indexCacheTTL: options?.indexCacheTTL ?? 3600000 // 1 hour default
        };
    }
    /**
     * Maximum number of bundles that can be cached
     */
    get maxCachedBundles() {
        return this.options.maxCachedBundles;
    }
    /**
     * Load a bundle from storage and cache it
     */
    async loadBundle(bundlePath) {
        // Check if already loading
        const pending = this.pendingLoads.get(bundlePath);
        if (pending) {
            return pending;
        }
        // Check cache first
        const cached = this.cache.get(bundlePath);
        if (cached) {
            this.cacheHits++;
            cached.lastAccess = Date.now();
            // Move to end of Map for LRU
            this.cache.delete(bundlePath);
            this.cache.set(bundlePath, cached);
            return cached;
        }
        this.cacheMisses++;
        // Load from storage
        const loadPromise = this.loadBundleFromStorage(bundlePath);
        this.pendingLoads.set(bundlePath, loadPromise);
        try {
            const result = await loadPromise;
            return result;
        }
        finally {
            this.pendingLoads.delete(bundlePath);
        }
    }
    async loadBundleFromStorage(bundlePath) {
        let data;
        try {
            data = await this.storage.readFile(bundlePath);
        }
        catch (error) {
            throw new BundleReaderError(`Storage read failed for ${bundlePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!data) {
            throw new BundleNotFoundError(bundlePath);
        }
        // Parse the bundle
        let reader;
        try {
            reader = new BundleReader(data);
        }
        catch (error) {
            if (error instanceof BundleFormatError) {
                throw error;
            }
            throw error;
        }
        const cachedBundle = {
            reader,
            data,
            size: data.length,
            lastAccess: Date.now()
        };
        // Evict if needed before adding
        this.evictIfNeeded(data.length);
        // Add to cache
        this.cache.set(bundlePath, cachedBundle);
        this.cacheBytes += data.length;
        return cachedBundle;
    }
    evictIfNeeded(additionalBytes) {
        // Evict by count
        while (this.cache.size >= this.options.maxCachedBundles ||
            this.cacheBytes + additionalBytes > this.options.maxCacheBytes) {
            if (this.cache.size === 0)
                break;
            // Evict oldest (first in Map)
            const oldest = this.cache.keys().next();
            if (oldest.done)
                break;
            const evicted = this.cache.get(oldest.value);
            if (evicted) {
                this.cacheBytes -= evicted.size;
            }
            this.cache.delete(oldest.value);
        }
    }
    validateOidLength(oid) {
        if (oid.length !== 40) {
            throw new BundleReaderError(`Invalid OID length: expected 40, got ${oid.length}`);
        }
    }
    /**
     * Read a single object from a bundle by OID
     */
    async readObject(bundlePath, oid) {
        this.validateOidLength(oid);
        const cached = await this.loadBundle(bundlePath);
        return cached.reader.readObject(oid);
    }
    /**
     * Read a range of bytes from an object
     */
    async readObjectRange(bundlePath, oid, start, end) {
        const cached = await this.loadBundle(bundlePath);
        const entry = cached.reader.getEntry(oid);
        if (!entry) {
            throw new BundleReaderError(`Object not found: ${oid}`);
        }
        const totalSize = entry.size;
        // Clamp start to valid range
        const actualStart = Math.min(Math.max(0, start), totalSize);
        // Determine end position
        let actualEnd;
        if (end === undefined) {
            actualEnd = totalSize;
        }
        else {
            actualEnd = Math.min(Math.max(actualStart, end), totalSize);
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
            };
        }
        // Read the full object and slice
        const fullObject = cached.reader.readObject(oid);
        if (!fullObject) {
            throw new BundleReaderError(`Object not found: ${oid}`);
        }
        const data = fullObject.data.slice(actualStart, actualEnd);
        const truncated = end !== undefined && end > totalSize;
        return {
            oid,
            type: entry.type,
            totalSize,
            offset: actualStart,
            data,
            truncated
        };
    }
    /**
     * Batch read multiple objects from a bundle
     */
    async readObjectsBatch(bundlePath, oids) {
        if (oids.length === 0) {
            return [];
        }
        const cached = await this.loadBundle(bundlePath);
        const results = [];
        for (const oid of oids) {
            const obj = cached.reader.readObject(oid);
            results.push(obj);
        }
        return results;
    }
    /**
     * List all OIDs in a bundle
     */
    async listOids(bundlePath) {
        const cached = await this.loadBundle(bundlePath);
        return cached.reader.listOids();
    }
    /**
     * Check if an object exists in a bundle
     */
    async hasObject(bundlePath, oid) {
        const cached = await this.loadBundle(bundlePath);
        return cached.reader.hasObject(oid);
    }
    /**
     * Get entry metadata without reading the full object data
     */
    async getEntry(bundlePath, oid) {
        const cached = await this.loadBundle(bundlePath);
        return cached.reader.getEntry(oid);
    }
    /**
     * Get cache statistics
     */
    getCacheStats() {
        const total = this.cacheHits + this.cacheMisses;
        return {
            hits: this.cacheHits,
            misses: this.cacheMisses,
            bundleCount: this.cache.size,
            bytes: this.cacheBytes,
            hitRate: total > 0 ? (this.cacheHits / total) * 100 : 0
        };
    }
    /**
     * Clear all cached bundle data
     */
    clearCache() {
        this.cache.clear();
        this.cacheBytes = 0;
    }
}
//# sourceMappingURL=bundle-reader.js.map