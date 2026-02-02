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
export class LRUCache {
    cache = new Map();
    head = null; // Most recently used
    tail = null; // Least recently used
    _bytes = 0;
    _hits = 0;
    _misses = 0;
    _evictions = 0;
    maxCount;
    maxBytes;
    defaultTTL;
    sizeCalculator;
    onEvict;
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
    constructor(options) {
        this.maxCount = options?.maxCount ?? Infinity;
        this.maxBytes = options?.maxBytes ?? Infinity;
        this.defaultTTL = options?.defaultTTL;
        this.sizeCalculator = options?.sizeCalculator ?? defaultSizeCalculator;
        this.onEvict = options?.onEvict;
    }
    /**
     * Checks if an entry is expired.
     *
     * @param entry - The cache entry to check
     * @returns true if the entry has expired
     *
     * @internal
     */
    isExpired(entry) {
        if (entry.expiresAt === null)
            return false;
        return Date.now() > entry.expiresAt;
    }
    /**
     * Moves a node to the head (most recently used position).
     *
     * @param node - The node to move
     *
     * @internal
     */
    moveToHead(node) {
        if (node === this.head)
            return;
        // Remove from current position
        this.removeNode(node);
        // Add to head
        node.prev = null;
        node.next = this.head;
        if (this.head) {
            this.head.prev = node;
        }
        this.head = node;
        if (!this.tail) {
            this.tail = node;
        }
    }
    /**
     * Removes a node from the linked list.
     *
     * @param node - The node to remove
     *
     * @internal
     */
    removeNode(node) {
        if (node.prev) {
            node.prev.next = node.next;
        }
        else {
            this.head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        }
        else {
            this.tail = node.prev;
        }
    }
    /**
     * Adds a node to the head of the list.
     *
     * @param node - The node to add
     *
     * @internal
     */
    addToHead(node) {
        node.prev = null;
        node.next = this.head;
        if (this.head) {
            this.head.prev = node;
        }
        this.head = node;
        if (!this.tail) {
            this.tail = node;
        }
    }
    /**
     * Evicts items until the cache can accommodate a new item.
     *
     * @param requiredSize - Size in bytes needed for the new item
     *
     * @internal
     */
    evictToFit(requiredSize) {
        // Evict until we have room for the new item
        while (this.tail && ((this.maxCount !== Infinity && this.cache.size >= this.maxCount) ||
            (this.maxBytes !== Infinity && this._bytes + requiredSize > this.maxBytes))) {
            const lru = this.tail;
            this.removeNode(lru);
            this.cache.delete(lru.key);
            this._bytes -= lru.entry.size;
            this._evictions++;
            if (this.onEvict) {
                this.onEvict(lru.key, lru.entry.value, 'lru');
            }
        }
    }
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
    get(key) {
        const node = this.cache.get(key);
        if (!node) {
            this._misses++;
            return undefined;
        }
        if (this.isExpired(node.entry)) {
            // Remove expired entry
            this.removeNode(node);
            this.cache.delete(key);
            this._bytes -= node.entry.size;
            this._misses++;
            if (this.onEvict) {
                this.onEvict(key, node.entry.value, 'ttl');
            }
            return undefined;
        }
        // Update access time and move to head
        node.entry.lastAccessed = Date.now();
        this.moveToHead(node);
        this._hits++;
        return node.entry.value;
    }
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
    set(key, value, options) {
        const size = options?.size ?? this.sizeCalculator(value);
        // Reject items larger than maxBytes
        if (this.maxBytes !== Infinity && size > this.maxBytes) {
            return false;
        }
        const now = Date.now();
        const ttl = options?.ttl ?? this.defaultTTL;
        const expiresAt = ttl !== undefined ? now + ttl : null;
        // Check if key already exists
        const existingNode = this.cache.get(key);
        if (existingNode) {
            // Update existing entry
            this._bytes -= existingNode.entry.size;
            existingNode.entry = {
                value,
                size,
                createdAt: now,
                expiresAt,
                lastAccessed: now
            };
            this._bytes += size;
            this.moveToHead(existingNode);
            return true;
        }
        // Evict items to make room
        this.evictToFit(size);
        // Create new entry
        const entry = {
            value,
            size,
            createdAt: now,
            expiresAt,
            lastAccessed: now
        };
        const node = {
            key,
            entry,
            prev: null,
            next: null
        };
        this.cache.set(key, node);
        this.addToHead(node);
        this._bytes += size;
        return true;
    }
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
    has(key) {
        const node = this.cache.get(key);
        if (!node)
            return false;
        if (this.isExpired(node.entry))
            return false;
        return true;
    }
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
    delete(key) {
        const node = this.cache.get(key);
        if (!node)
            return false;
        this.removeNode(node);
        this.cache.delete(key);
        this._bytes -= node.entry.size;
        if (this.onEvict) {
            this.onEvict(key, node.entry.value, 'manual');
        }
        return true;
    }
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
    clear() {
        if (this.onEvict) {
            // Call onEvict for each entry
            for (const [key, node] of this.cache) {
                this.onEvict(key, node.entry.value, 'clear');
            }
        }
        this.cache.clear();
        this.head = null;
        this.tail = null;
        this._bytes = 0;
    }
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
    getStats() {
        const total = this._hits + this._misses;
        const hitRate = total === 0 ? 0 : Math.round((this._hits / total) * 100);
        return {
            hits: this._hits,
            misses: this._misses,
            count: this.cache.size,
            bytes: this._bytes,
            evictions: this._evictions,
            hitRate
        };
    }
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
    resetStats() {
        this._hits = 0;
        this._misses = 0;
        this._evictions = 0;
    }
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
    get size() {
        return this.cache.size;
    }
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
    get bytes() {
        return this._bytes;
    }
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
    keys() {
        const keys = [];
        let node = this.head;
        while (node) {
            keys.push(node.key);
            node = node.next;
        }
        return keys;
    }
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
    values() {
        const values = [];
        let node = this.head;
        while (node) {
            values.push(node.entry.value);
            node = node.next;
        }
        return values;
    }
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
    entries() {
        const entries = [];
        let node = this.head;
        while (node) {
            entries.push([node.key, node.entry.value]);
            node = node.next;
        }
        return entries;
    }
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
    peek(key) {
        const node = this.cache.get(key);
        if (!node)
            return undefined;
        if (this.isExpired(node.entry))
            return undefined;
        return node.entry.value;
    }
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
    prune() {
        let pruned = 0;
        const now = Date.now();
        for (const [key, node] of this.cache) {
            if (node.entry.expiresAt !== null && now > node.entry.expiresAt) {
                this.removeNode(node);
                this.cache.delete(key);
                this._bytes -= node.entry.size;
                pruned++;
                if (this.onEvict) {
                    this.onEvict(key, node.entry.value, 'ttl');
                }
            }
        }
        return pruned;
    }
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
    resize(options) {
        if (options.maxCount !== undefined) {
            this.maxCount = options.maxCount;
        }
        if (options.maxBytes !== undefined) {
            this.maxBytes = options.maxBytes;
        }
        // Evict items until we're under the new limits
        while (this.tail && ((this.maxCount !== Infinity && this.cache.size > this.maxCount) ||
            (this.maxBytes !== Infinity && this._bytes > this.maxBytes))) {
            const lru = this.tail;
            this.removeNode(lru);
            this.cache.delete(lru.key);
            this._bytes -= lru.entry.size;
            this._evictions++;
            if (this.onEvict) {
                this.onEvict(lru.key, lru.entry.value, 'lru');
            }
        }
    }
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
export function createKeySerializer(serialize, deserialize) {
    return { serialize, deserialize };
}
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
export function defaultSizeCalculator(value) {
    if (value === null || value === undefined) {
        return 0;
    }
    if (typeof value === 'string') {
        // Approximate size: 2 bytes per character (UTF-16)
        return value.length * 2;
    }
    if (typeof value === 'number') {
        // Numbers are 8 bytes in JavaScript
        return 8;
    }
    if (typeof value === 'boolean') {
        return 4;
    }
    if (value instanceof Uint8Array) {
        return value.byteLength;
    }
    if (value instanceof ArrayBuffer) {
        return value.byteLength;
    }
    if (ArrayBuffer.isView(value)) {
        return value.byteLength;
    }
    if (typeof value === 'object') {
        // For objects, serialize to JSON and count characters
        try {
            const json = JSON.stringify(value);
            return json.length * 2;
        }
        catch (error) {
            // If serialization fails (circular refs, etc), return a default size
            console.debug('[LRUCache] estimateSizeInBytes: JSON serialization failed, using default size:', error instanceof Error ? error.message : String(error));
            return 64;
        }
    }
    // Default size for unknown types
    return 8;
}
//# sourceMappingURL=lru-cache.js.map