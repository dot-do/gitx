/**
 * LRU Cache implementation for hot objects in gitdo
 * gitdo-165: LRU cache for hot objects
 */
/**
 * Configuration options for the LRU cache
 */
export interface CacheOptions {
    /** Maximum number of items in the cache */
    maxCount?: number;
    /** Maximum size in bytes for the cache */
    maxBytes?: number;
    /** Default TTL in milliseconds for cache entries */
    defaultTTL?: number;
    /** Function to calculate size of a value in bytes */
    sizeCalculator?: <T>(value: T) => number;
    /** Callback when an item is evicted */
    onEvict?: <K, V>(key: K, value: V, reason: EvictionReason) => void;
}
/**
 * Reason why an item was evicted from the cache
 */
export type EvictionReason = 'lru' | 'ttl' | 'size' | 'manual' | 'clear';
/**
 * Statistics about cache performance
 */
export interface CacheStats {
    /** Number of cache hits */
    hits: number;
    /** Number of cache misses */
    misses: number;
    /** Current number of items in the cache */
    count: number;
    /** Current size in bytes */
    bytes: number;
    /** Number of evictions */
    evictions: number;
    /** Hit rate as a percentage (0-100) */
    hitRate: number;
}
/**
 * Entry stored in the cache
 */
export interface CacheEntry<V> {
    value: V;
    size: number;
    createdAt: number;
    expiresAt: number | null;
    lastAccessed: number;
}
/**
 * Options for setting a cache entry
 */
export interface SetOptions {
    /** TTL in milliseconds for this specific entry */
    ttl?: number;
    /** Size in bytes (overrides sizeCalculator) */
    size?: number;
}
/**
 * LRU Cache class for storing hot objects with size and count limits
 */
export declare class LRUCache<K = string, V = unknown> {
    private cache;
    private head;
    private tail;
    private _bytes;
    private _hits;
    private _misses;
    private _evictions;
    private maxCount;
    private maxBytes;
    private defaultTTL;
    private sizeCalculator;
    private onEvict?;
    /**
     * Create a new LRU cache
     * @param options Configuration options
     */
    constructor(options?: CacheOptions);
    /**
     * Check if an entry is expired
     */
    private isExpired;
    /**
     * Move a node to the head (most recently used)
     */
    private moveToHead;
    /**
     * Remove a node from the linked list
     */
    private removeNode;
    /**
     * Add a node to the head of the list
     */
    private addToHead;
    /**
     * Evict items until we're under limits
     */
    private evictToFit;
    /**
     * Get a value from the cache
     * @param key The cache key
     * @returns The cached value or undefined if not found/expired
     */
    get(key: K): V | undefined;
    /**
     * Set a value in the cache
     * @param key The cache key
     * @param value The value to cache
     * @param options Optional settings for this entry
     * @returns true if successfully set, false otherwise
     */
    set(key: K, value: V, options?: SetOptions): boolean;
    /**
     * Check if a key exists in the cache (without updating LRU order)
     * @param key The cache key
     * @returns true if the key exists and is not expired
     */
    has(key: K): boolean;
    /**
     * Delete a key from the cache
     * @param key The cache key
     * @returns true if the key was deleted, false if it didn't exist
     */
    delete(key: K): boolean;
    /**
     * Clear all entries from the cache
     */
    clear(): void;
    /**
     * Get cache statistics
     * @returns Current cache statistics
     */
    getStats(): CacheStats;
    /**
     * Reset cache statistics (keeps cached data)
     */
    resetStats(): void;
    /**
     * Get the number of items currently in the cache
     */
    get size(): number;
    /**
     * Get the current byte size of the cache
     */
    get bytes(): number;
    /**
     * Get all keys in the cache (in LRU order, most recent first)
     */
    keys(): K[];
    /**
     * Get all values in the cache (in LRU order, most recent first)
     */
    values(): V[];
    /**
     * Get all entries in the cache (in LRU order, most recent first)
     */
    entries(): Array<[K, V]>;
    /**
     * Peek at a value without updating LRU order
     * @param key The cache key
     * @returns The cached value or undefined if not found/expired
     */
    peek(key: K): V | undefined;
    /**
     * Evict expired entries from the cache
     * @returns Number of entries evicted
     */
    prune(): number;
    /**
     * Resize the cache to new limits
     * @param options New size limits
     */
    resize(options: Pick<CacheOptions, 'maxCount' | 'maxBytes'>): void;
}
/**
 * Create a key serializer for complex key types
 */
export declare function createKeySerializer<K>(serialize: (key: K) => string, deserialize: (str: string) => K): {
    serialize: (key: K) => string;
    deserialize: (str: string) => K;
};
/**
 * Default size calculator for common value types
 */
export declare function defaultSizeCalculator<T>(value: T): number;
//# sourceMappingURL=lru-cache.d.ts.map