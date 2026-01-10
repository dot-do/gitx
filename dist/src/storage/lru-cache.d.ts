/**
 * @fileoverview LRU Cache Implementation for Hot Objects
 *
 * This module provides a high-performance Least Recently Used (LRU) cache
 * implementation optimized for storing frequently accessed Git objects.
 *
 * ## Features
 *
 * - **Dual Limits**: Supports both count-based and byte-size-based limits
 * - **TTL Support**: Optional time-to-live for automatic entry expiration
 * - **Eviction Callbacks**: Hook into eviction events for cleanup or analytics
 * - **Statistics Tracking**: Built-in hit/miss tracking and hit rate calculation
 * - **O(1) Operations**: All get/set/delete operations are O(1) using a doubly linked list
 *
 * ## Implementation Details
 *
 * The cache uses a combination of:
 * - A Map for O(1) key lookup
 * - A doubly linked list for O(1) LRU ordering
 *
 * When the cache exceeds its limits, the least recently used items are evicted.
 * Items can also be evicted due to TTL expiration.
 *
 * @module storage/lru-cache
 *
 * @example
 * ```typescript
 * // Create a cache with 100 items max and 10MB size limit
 * const cache = new LRUCache<string, Uint8Array>({
 *   maxCount: 100,
 *   maxBytes: 10 * 1024 * 1024,
 *   defaultTTL: 3600000, // 1 hour
 *   onEvict: (key, value, reason) => {
 *     console.log(`Evicted ${key}: ${reason}`);
 *   }
 * });
 *
 * // Store and retrieve values
 * cache.set('object-sha', objectData);
 * const data = cache.get('object-sha');
 *
 * // Check statistics
 * const stats = cache.getStats();
 * console.log(`Hit rate: ${stats.hitRate}%`);
 * ```
 */
/**
 * Configuration options for the LRU cache.
 *
 * @description
 * Defines the behavior and limits of the cache. All options are optional
 * and have sensible defaults (unlimited count/size, no TTL).
 *
 * @example
 * ```typescript
 * const options: CacheOptions = {
 *   maxCount: 1000,
 *   maxBytes: 50 * 1024 * 1024, // 50MB
 *   defaultTTL: 3600000, // 1 hour
 *   sizeCalculator: (value) => value.byteLength,
 *   onEvict: (key, value, reason) => {
 *     console.log(`Evicted: ${key} (${reason})`);
 *   }
 * };
 * ```
 */
export interface CacheOptions {
    /**
     * Maximum number of items in the cache.
     * When exceeded, least recently used items are evicted.
     * @default Infinity
     */
    maxCount?: number;
    /**
     * Maximum size in bytes for the cache.
     * When exceeded, least recently used items are evicted.
     * @default Infinity
     */
    maxBytes?: number;
    /**
     * Default TTL in milliseconds for cache entries.
     * Entries expire after this duration unless overridden per-entry.
     * @default undefined (no expiration)
     */
    defaultTTL?: number;
    /**
     * Function to calculate size of a value in bytes.
     * Used when no explicit size is provided in set().
     * @default defaultSizeCalculator
     */
    sizeCalculator?: <T>(value: T) => number;
    /**
     * Callback when an item is evicted from the cache.
     * Useful for cleanup, logging, or analytics.
     */
    onEvict?: <K, V>(key: K, value: V, reason: EvictionReason) => void;
}
/**
 * Reason why an item was evicted from the cache.
 *
 * @description
 * Indicates the cause of eviction, useful for understanding cache behavior:
 * - `lru`: Evicted to make room for new items (least recently used)
 * - `ttl`: Expired based on time-to-live
 * - `size`: Evicted because cache exceeded byte limit
 * - `manual`: Explicitly deleted via delete() method
 * - `clear`: Removed during clear() operation
 */
export type EvictionReason = 'lru' | 'ttl' | 'size' | 'manual' | 'clear';
/**
 * Statistics about cache performance.
 *
 * @description
 * Provides metrics for monitoring cache effectiveness and capacity.
 * Use these stats to tune cache size and identify performance issues.
 *
 * @example
 * ```typescript
 * const stats = cache.getStats();
 * console.log(`Hit rate: ${stats.hitRate}%`);
 * console.log(`Cache utilization: ${stats.count}/${maxCount} items`);
 * console.log(`Memory usage: ${(stats.bytes / 1024 / 1024).toFixed(2)} MB`);
 * ```
 */
export interface CacheStats {
    /** Number of cache hits (successful gets) */
    hits: number;
    /** Number of cache misses (get returned undefined) */
    misses: number;
    /** Current number of items in the cache */
    count: number;
    /** Current size in bytes of all cached items */
    bytes: number;
    /** Total number of evictions since creation/last reset */
    evictions: number;
    /**
     * Hit rate as a percentage (0-100).
     * Calculated as hits / (hits + misses) * 100.
     */
    hitRate: number;
}
/**
 * Entry stored in the cache.
 *
 * @description
 * Internal representation of a cached item with metadata for
 * LRU tracking, TTL expiration, and size accounting.
 *
 * @example
 * ```typescript
 * const entry: CacheEntry<Buffer> = {
 *   value: Buffer.from('data'),
 *   size: 4,
 *   createdAt: Date.now(),
 *   expiresAt: Date.now() + 3600000,
 *   lastAccessed: Date.now()
 * };
 * ```
 */
export interface CacheEntry<V> {
    /** The cached value */
    value: V;
    /** Size of this entry in bytes */
    size: number;
    /** Timestamp when the entry was created */
    createdAt: number;
    /**
     * Timestamp when the entry expires, or null if no expiration.
     * Entry will return undefined from get() after this time.
     */
    expiresAt: number | null;
    /** Timestamp when the entry was last accessed (for LRU ordering) */
    lastAccessed: number;
}
/**
 * Options for setting a cache entry.
 *
 * @description
 * Allows per-entry configuration of TTL and explicit size specification.
 *
 * @example
 * ```typescript
 * // Set with custom TTL
 * cache.set('key', value, { ttl: 60000 }); // 1 minute TTL
 *
 * // Set with explicit size (useful when sizeCalculator is expensive)
 * cache.set('key', largeObject, { size: knownSize });
 * ```
 */
export interface SetOptions {
    /**
     * TTL in milliseconds for this specific entry.
     * Overrides the cache's defaultTTL.
     */
    ttl?: number;
    /**
     * Size in bytes for this entry.
     * Overrides the sizeCalculator result.
     */
    size?: number;
}
/**
 * LRU Cache class for storing hot objects with size and count limits.
 *
 * @description
 * A high-performance Least Recently Used cache with the following features:
 *
 * - **O(1) Operations**: Get, set, and delete are all constant time
 * - **Dual Limits**: Supports both count and byte-size limits
 * - **TTL Support**: Optional per-entry or default time-to-live
 * - **Eviction Events**: Callbacks when items are removed
 * - **Statistics**: Track hits, misses, and evictions
 *
 * The cache maintains items in order of recent use. When the cache is full,
 * the least recently used items are evicted first.
 *
 * ## Type Parameters
 *
 * - `K`: The type of cache keys (default: string)
 * - `V`: The type of cached values (default: unknown)
 *
 * @example
 * ```typescript
 * // Basic usage with string keys and Uint8Array values
 * const objectCache = new LRUCache<string, Uint8Array>({
 *   maxCount: 1000,
 *   maxBytes: 100 * 1024 * 1024 // 100MB
 * });
 *
 * // Store a value
 * objectCache.set(sha, objectData);
 *
 * // Retrieve a value (returns undefined if not found or expired)
 * const data = objectCache.get(sha);
 *
 * // Check without affecting LRU order
 * if (objectCache.has(sha)) {
 *   const peeked = objectCache.peek(sha);
 * }
 *
 * // Remove expired entries
 * const pruned = objectCache.prune();
 * console.log(`Removed ${pruned} expired entries`);
 * ```
 *
 * @example
 * ```typescript
 * // With eviction callback for cleanup
 * const cache = new LRUCache<string, Resource>({
 *   maxCount: 100,
 *   onEvict: (key, value, reason) => {
 *     if (reason !== 'clear') {
 *       value.dispose(); // Clean up resources
 *     }
 *     console.log(`Evicted ${key}: ${reason}`);
 *   }
 * });
 * ```
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
     * Creates a new LRU cache instance.
     *
     * @description
     * Initializes the cache with the specified options. All options have
     * sensible defaults for unlimited caching.
     *
     * @param options - Configuration options for the cache
     *
     * @example
     * ```typescript
     * // Simple cache with count limit
     * const cache = new LRUCache({ maxCount: 100 });
     *
     * // Cache with size limit and TTL
     * const cache = new LRUCache({
     *   maxBytes: 50 * 1024 * 1024, // 50MB
     *   defaultTTL: 3600000 // 1 hour
     * });
     *
     * // Cache with custom size calculator for Uint8Array
     * const binaryCache = new LRUCache<string, Uint8Array>({
     *   maxBytes: 100 * 1024 * 1024,
     *   sizeCalculator: (arr) => arr.byteLength
     * });
     * ```
     */
    constructor(options?: CacheOptions);
    /**
     * Checks if an entry is expired.
     *
     * @param entry - The cache entry to check
     * @returns true if the entry has expired
     *
     * @internal
     */
    private isExpired;
    /**
     * Moves a node to the head (most recently used position).
     *
     * @param node - The node to move
     *
     * @internal
     */
    private moveToHead;
    /**
     * Removes a node from the linked list.
     *
     * @param node - The node to remove
     *
     * @internal
     */
    private removeNode;
    /**
     * Adds a node to the head of the list.
     *
     * @param node - The node to add
     *
     * @internal
     */
    private addToHead;
    /**
     * Evicts items until the cache can accommodate a new item.
     *
     * @param requiredSize - Size in bytes needed for the new item
     *
     * @internal
     */
    private evictToFit;
    /**
     * Gets a value from the cache.
     *
     * @description
     * Retrieves a value by key. If the key exists and hasn't expired,
     * returns the value and moves the entry to the most recently used position.
     * If the key doesn't exist or has expired, returns undefined.
     *
     * @param key - The cache key to look up
     *
     * @returns The cached value or undefined if not found/expired
     *
     * @example
     * ```typescript
     * const cache = new LRUCache<string, string>();
     * cache.set('greeting', 'hello');
     *
     * const value = cache.get('greeting'); // 'hello'
     * const missing = cache.get('nonexistent'); // undefined
     * ```
     */
    get(key: K): V | undefined;
    /**
     * Sets a value in the cache.
     *
     * @description
     * Stores a value with the given key. If the key already exists,
     * updates the value. If storing the value would exceed limits,
     * evicts least recently used items first.
     *
     * Returns false if the value is larger than maxBytes (cannot fit).
     *
     * @param key - The cache key
     * @param value - The value to cache
     * @param options - Optional per-entry settings (TTL, size)
     *
     * @returns true if successfully stored, false if value too large
     *
     * @example
     * ```typescript
     * const cache = new LRUCache<string, Uint8Array>({
     *   maxBytes: 1024
     * });
     *
     * // Basic set
     * cache.set('key1', new Uint8Array([1, 2, 3]));
     *
     * // Set with custom TTL
     * cache.set('key2', data, { ttl: 60000 }); // 1 minute
     *
     * // Set with explicit size
     * cache.set('key3', complexObject, { size: 1000 });
     *
     * // Returns false if value too large
     * const hugeData = new Uint8Array(10000);
     * cache.set('huge', hugeData); // returns false
     * ```
     */
    set(key: K, value: V, options?: SetOptions): boolean;
    /**
     * Checks if a key exists in the cache.
     *
     * @description
     * Returns true if the key exists and hasn't expired.
     * Does NOT update LRU order (use peek() for that too).
     *
     * @param key - The cache key to check
     *
     * @returns true if the key exists and is not expired
     *
     * @example
     * ```typescript
     * if (cache.has('important-key')) {
     *   // Key exists and is valid
     *   const value = cache.get('important-key');
     * }
     * ```
     */
    has(key: K): boolean;
    /**
     * Deletes a key from the cache.
     *
     * @description
     * Removes an entry from the cache. Triggers the onEvict callback
     * with reason 'manual'.
     *
     * @param key - The cache key to delete
     *
     * @returns true if the key was deleted, false if it didn't exist
     *
     * @example
     * ```typescript
     * cache.set('key', 'value');
     * cache.delete('key'); // returns true
     * cache.delete('key'); // returns false (already deleted)
     * ```
     */
    delete(key: K): boolean;
    /**
     * Clears all entries from the cache.
     *
     * @description
     * Removes all entries and resets the byte counter. If an onEvict
     * callback is configured, it's called for each entry with reason 'clear'.
     *
     * Does NOT reset statistics (use resetStats() for that).
     *
     * @example
     * ```typescript
     * cache.set('a', 1);
     * cache.set('b', 2);
     * cache.clear();
     * console.log(cache.size); // 0
     * ```
     */
    clear(): void;
    /**
     * Gets cache statistics.
     *
     * @description
     * Returns current statistics about cache performance including
     * hits, misses, item count, byte usage, evictions, and hit rate.
     *
     * @returns Current cache statistics
     *
     * @example
     * ```typescript
     * const stats = cache.getStats();
     * console.log(`Hit rate: ${stats.hitRate}%`);
     * console.log(`Cache size: ${stats.count} items, ${stats.bytes} bytes`);
     * console.log(`Evictions: ${stats.evictions}`);
     * ```
     */
    getStats(): CacheStats;
    /**
     * Resets cache statistics.
     *
     * @description
     * Resets hit, miss, and eviction counters to zero.
     * Does NOT clear cached data.
     *
     * @example
     * ```typescript
     * // After warmup period, reset stats
     * cache.resetStats();
     * // Now stats reflect production traffic
     * ```
     */
    resetStats(): void;
    /**
     * Gets the number of items currently in the cache.
     *
     * @returns Current item count
     *
     * @example
     * ```typescript
     * console.log(`Cache has ${cache.size} items`);
     * ```
     */
    get size(): number;
    /**
     * Gets the current byte size of the cache.
     *
     * @returns Current size in bytes
     *
     * @example
     * ```typescript
     * console.log(`Cache using ${cache.bytes} bytes`);
     * ```
     */
    get bytes(): number;
    /**
     * Gets all keys in the cache in LRU order.
     *
     * @description
     * Returns keys from most recently used to least recently used.
     * Does NOT affect LRU ordering.
     *
     * @returns Array of keys in LRU order (most recent first)
     *
     * @example
     * ```typescript
     * cache.set('a', 1);
     * cache.set('b', 2);
     * cache.get('a');
     * console.log(cache.keys()); // ['a', 'b']
     * ```
     */
    keys(): K[];
    /**
     * Gets all values in the cache in LRU order.
     *
     * @description
     * Returns values from most recently used to least recently used.
     * Does NOT affect LRU ordering.
     *
     * @returns Array of values in LRU order (most recent first)
     *
     * @example
     * ```typescript
     * const recentValues = cache.values();
     * ```
     */
    values(): V[];
    /**
     * Gets all entries in the cache in LRU order.
     *
     * @description
     * Returns [key, value] pairs from most recently used to least recently used.
     * Does NOT affect LRU ordering.
     *
     * @returns Array of [key, value] pairs in LRU order
     *
     * @example
     * ```typescript
     * for (const [key, value] of cache.entries()) {
     *   console.log(`${key}: ${value}`);
     * }
     * ```
     */
    entries(): Array<[K, V]>;
    /**
     * Peeks at a value without updating LRU order.
     *
     * @description
     * Retrieves a value without marking it as recently used.
     * Useful for inspection or when you don't want to affect eviction order.
     *
     * @param key - The cache key to peek at
     *
     * @returns The cached value or undefined if not found/expired
     *
     * @example
     * ```typescript
     * // Check value without affecting LRU order
     * const value = cache.peek('key');
     * // This won't prevent 'key' from being evicted next
     * ```
     */
    peek(key: K): V | undefined;
    /**
     * Evicts expired entries from the cache.
     *
     * @description
     * Scans all entries and removes those that have expired.
     * Triggers onEvict callback with reason 'ttl' for each removed entry.
     *
     * Call this periodically if you need proactive cleanup of expired entries.
     * Note: Expired entries are also cleaned up lazily on get().
     *
     * @returns Number of entries evicted
     *
     * @example
     * ```typescript
     * // Run periodic cleanup
     * setInterval(() => {
     *   const pruned = cache.prune();
     *   if (pruned > 0) {
     *     console.log(`Pruned ${pruned} expired entries`);
     *   }
     * }, 60000); // Every minute
     * ```
     */
    prune(): number;
    /**
     * Resizes the cache to new limits.
     *
     * @description
     * Updates the maxCount and/or maxBytes limits. If the current cache
     * exceeds the new limits, evicts LRU items until within limits.
     *
     * @param options - New size limits (maxCount and/or maxBytes)
     *
     * @example
     * ```typescript
     * // Reduce cache size under memory pressure
     * cache.resize({ maxBytes: 10 * 1024 * 1024 }); // Reduce to 10MB
     *
     * // Increase limit when more memory is available
     * cache.resize({ maxCount: 1000, maxBytes: 100 * 1024 * 1024 });
     * ```
     */
    resize(options: Pick<CacheOptions, 'maxCount' | 'maxBytes'>): void;
}
/**
 * Creates a key serializer for complex key types.
 *
 * @description
 * Helper function for creating serializers when using complex key types
 * that need to be converted to/from strings.
 *
 * @param serialize - Function to convert key to string
 * @param deserialize - Function to convert string back to key
 *
 * @returns Object with serialize and deserialize functions
 *
 * @example
 * ```typescript
 * interface ObjectKey {
 *   repo: string;
 *   sha: string;
 * }
 *
 * const keySerializer = createKeySerializer<ObjectKey>(
 *   (key) => `${key.repo}:${key.sha}`,
 *   (str) => {
 *     const [repo, sha] = str.split(':');
 *     return { repo, sha };
 *   }
 * );
 *
 * // Use with cache
 * const serializedKey = keySerializer.serialize({ repo: 'foo', sha: 'abc' });
 * cache.set(serializedKey, value);
 * ```
 */
export declare function createKeySerializer<K>(serialize: (key: K) => string, deserialize: (str: string) => K): {
    serialize: (key: K) => string;
    deserialize: (str: string) => K;
};
/**
 * Default size calculator for common value types.
 *
 * @description
 * Estimates the byte size of common JavaScript value types:
 * - `null/undefined`: 0 bytes
 * - `string`: 2 bytes per character (UTF-16)
 * - `number`: 8 bytes
 * - `boolean`: 4 bytes
 * - `Uint8Array/ArrayBuffer`: actual byteLength
 * - `object`: JSON-serialized length * 2
 * - `unknown`: 8 bytes (default)
 *
 * For more accurate size calculation with specific types,
 * provide a custom sizeCalculator in CacheOptions.
 *
 * @param value - The value to calculate size for
 *
 * @returns Estimated size in bytes
 *
 * @example
 * ```typescript
 * defaultSizeCalculator('hello'); // 10 (5 chars * 2)
 * defaultSizeCalculator(42); // 8
 * defaultSizeCalculator(new Uint8Array(100)); // 100
 * defaultSizeCalculator({ key: 'value' }); // ~30
 * ```
 */
export declare function defaultSizeCalculator<T>(value: T): number;
//# sourceMappingURL=lru-cache.d.ts.map