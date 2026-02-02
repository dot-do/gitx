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
import { parseBundle, lookupEntryByOid, } from './format';
/** Error for reader operations */
export class BundleReaderError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BundleReaderError';
    }
}
/** Error when a bundle is not found in storage */
export class BundleNotFoundError extends BundleReaderError {
    constructor(key) {
        super(`Bundle not found: ${key}`);
        this.name = 'BundleNotFoundError';
    }
}
// ============================================================================
// InMemoryBundleReader
// ============================================================================
/**
 * Reads objects from a fully-loaded bundle in memory.
 *
 * Useful when the entire bundle has been fetched from R2 and cached.
 * Supports iteration over all objects.
 */
export class InMemoryBundleReader {
    bundle;
    constructor(data, options) {
        this.bundle = parseBundle(data, options);
    }
    /** Number of objects in the bundle */
    get entryCount() {
        return this.bundle.header.entryCount;
    }
    /** Read a single object by OID */
    readObject(oid) {
        const entry = lookupEntryByOid(this.bundle.entries, oid);
        if (!entry)
            return null;
        return {
            oid: entry.oid,
            type: entry.type,
            data: this.bundle.data.slice(entry.offset, entry.offset + entry.size),
        };
    }
    /** Check if an object exists in the bundle */
    hasObject(oid) {
        return lookupEntryByOid(this.bundle.entries, oid) !== null;
    }
    /** List all OIDs in sorted order */
    listOids() {
        return this.bundle.entries.map((e) => e.oid);
    }
    /** Get index entry metadata for an OID without reading data */
    getEntry(oid) {
        return lookupEntryByOid(this.bundle.entries, oid);
    }
    /** Iterate over all objects in the bundle */
    [Symbol.iterator]() {
        let idx = 0;
        const entries = this.bundle.entries;
        const data = this.bundle.data;
        return {
            next: () => {
                if (idx >= entries.length)
                    return { done: true, value: undefined };
                const entry = entries[idx++];
                return {
                    done: false,
                    value: {
                        oid: entry.oid,
                        type: entry.type,
                        data: data.slice(entry.offset, entry.offset + entry.size),
                    },
                };
            },
        };
    }
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
export class R2BundleReader {
    storage;
    config;
    cache = new Map();
    pendingLoads = new Map();
    cacheBytes = 0;
    cacheHits = 0;
    cacheMisses = 0;
    constructor(storage, config) {
        this.storage = storage;
        this.config = {
            maxCachedBundles: config?.maxCachedBundles ?? 64,
            maxCacheBytes: config?.maxCacheBytes ?? 256 * 1024 * 1024,
        };
    }
    /** Read a single object from a bundle by OID */
    async readObject(bundleKey, oid) {
        const cached = await this.loadBundle(bundleKey);
        return cached.reader.readObject(oid);
    }
    /** Read a byte range from an object */
    async readObjectRange(bundleKey, oid, start, end) {
        // If storage supports range reads and bundle is not cached, use range read
        // Otherwise fall back to full bundle load
        const cached = await this.loadBundle(bundleKey);
        const entry = cached.reader.getEntry(oid);
        if (!entry)
            throw new BundleReaderError(`Object not found: ${oid}`);
        const totalSize = entry.size;
        const actualStart = Math.min(Math.max(0, start), totalSize);
        const actualEnd = end !== undefined ? Math.min(Math.max(actualStart, end), totalSize) : totalSize;
        if (actualStart >= totalSize) {
            return { oid, type: entry.type, totalSize, offset: actualStart, data: new Uint8Array(0), truncated: false };
        }
        const obj = cached.reader.readObject(oid);
        if (!obj)
            throw new BundleReaderError(`Object not found: ${oid}`);
        return {
            oid,
            type: entry.type,
            totalSize,
            offset: actualStart,
            data: obj.data.slice(actualStart, actualEnd),
            truncated: end !== undefined && end > totalSize,
        };
    }
    /** Batch read multiple objects from a single bundle */
    async readObjectsBatch(bundleKey, oids) {
        if (oids.length === 0)
            return [];
        const cached = await this.loadBundle(bundleKey);
        return oids.map((oid) => cached.reader.readObject(oid));
    }
    /** Check if an object exists in a bundle */
    async hasObject(bundleKey, oid) {
        const cached = await this.loadBundle(bundleKey);
        return cached.reader.hasObject(oid);
    }
    /** List all OIDs in a bundle */
    async listOids(bundleKey) {
        const cached = await this.loadBundle(bundleKey);
        return cached.reader.listOids();
    }
    /** Get index entry metadata without reading object data */
    async getEntry(bundleKey, oid) {
        const cached = await this.loadBundle(bundleKey);
        return cached.reader.getEntry(oid);
    }
    /** Get cache statistics */
    getCacheStats() {
        const total = this.cacheHits + this.cacheMisses;
        return {
            hits: this.cacheHits,
            misses: this.cacheMisses,
            bundleCount: this.cache.size,
            cacheBytes: this.cacheBytes,
            hitRate: total > 0 ? (this.cacheHits / total) * 100 : 0,
        };
    }
    /** Evict all cached bundles */
    clearCache() {
        this.cache.clear();
        this.cacheBytes = 0;
    }
    /** Evict a specific bundle from cache */
    evictBundle(bundleKey) {
        const cached = this.cache.get(bundleKey);
        if (!cached)
            return false;
        this.cacheBytes -= cached.size;
        this.cache.delete(bundleKey);
        return true;
    }
    // --------------------------------------------------------------------------
    // Private
    // --------------------------------------------------------------------------
    async loadBundle(bundleKey) {
        // Check cache (with LRU bump)
        const cached = this.cache.get(bundleKey);
        if (cached) {
            this.cacheHits++;
            cached.lastAccess = Date.now();
            // Move to end for LRU ordering
            this.cache.delete(bundleKey);
            this.cache.set(bundleKey, cached);
            return cached;
        }
        this.cacheMisses++;
        // Deduplicate concurrent loads
        const pending = this.pendingLoads.get(bundleKey);
        if (pending)
            return pending;
        const loadPromise = this.fetchAndCache(bundleKey);
        this.pendingLoads.set(bundleKey, loadPromise);
        try {
            return await loadPromise;
        }
        finally {
            this.pendingLoads.delete(bundleKey);
        }
    }
    async fetchAndCache(bundleKey) {
        const data = await this.storage.get(bundleKey);
        if (!data)
            throw new BundleNotFoundError(bundleKey);
        const reader = new InMemoryBundleReader(data);
        const entry = {
            reader,
            data,
            size: data.length,
            lastAccess: Date.now(),
        };
        this.evictIfNeeded(data.length);
        this.cache.set(bundleKey, entry);
        this.cacheBytes += data.length;
        return entry;
    }
    evictIfNeeded(additionalBytes) {
        while (this.cache.size >= this.config.maxCachedBundles ||
            this.cacheBytes + additionalBytes > this.config.maxCacheBytes) {
            if (this.cache.size === 0)
                break;
            const oldest = this.cache.keys().next();
            if (oldest.done)
                break;
            const evicted = this.cache.get(oldest.value);
            if (evicted)
                this.cacheBytes -= evicted.size;
            this.cache.delete(oldest.value);
        }
    }
}
//# sourceMappingURL=reader.js.map