/**
 * LRU Cache implementation for hot objects in gitdo
 * gitdo-165: LRU cache for hot objects
 */

/**
 * Configuration options for the LRU cache
 */
export interface CacheOptions {
  /** Maximum number of items in the cache */
  maxCount?: number
  /** Maximum size in bytes for the cache */
  maxBytes?: number
  /** Default TTL in milliseconds for cache entries */
  defaultTTL?: number
  /** Function to calculate size of a value in bytes */
  sizeCalculator?: <T>(value: T) => number
  /** Callback when an item is evicted */
  onEvict?: <K, V>(key: K, value: V, reason: EvictionReason) => void
}

/**
 * Reason why an item was evicted from the cache
 */
export type EvictionReason = 'lru' | 'ttl' | 'size' | 'manual' | 'clear'

/**
 * Statistics about cache performance
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Current number of items in the cache */
  count: number
  /** Current size in bytes */
  bytes: number
  /** Number of evictions */
  evictions: number
  /** Hit rate as a percentage (0-100) */
  hitRate: number
}

/**
 * Entry stored in the cache
 */
export interface CacheEntry<V> {
  value: V
  size: number
  createdAt: number
  expiresAt: number | null
  lastAccessed: number
}

/**
 * Options for setting a cache entry
 */
export interface SetOptions {
  /** TTL in milliseconds for this specific entry */
  ttl?: number
  /** Size in bytes (overrides sizeCalculator) */
  size?: number
}

/**
 * Node in the doubly linked list for LRU ordering
 */
interface ListNode<K, V> {
  key: K
  entry: CacheEntry<V>
  prev: ListNode<K, V> | null
  next: ListNode<K, V> | null
}

/**
 * LRU Cache class for storing hot objects with size and count limits
 */
export class LRUCache<K = string, V = unknown> {
  private cache: Map<K, ListNode<K, V>> = new Map()
  private head: ListNode<K, V> | null = null // Most recently used
  private tail: ListNode<K, V> | null = null // Least recently used
  private _bytes: number = 0
  private _hits: number = 0
  private _misses: number = 0
  private _evictions: number = 0

  private maxCount: number
  private maxBytes: number
  private defaultTTL: number | undefined
  private sizeCalculator: <T>(value: T) => number
  private onEvict?: <K2, V2>(key: K2, value: V2, reason: EvictionReason) => void

  /**
   * Create a new LRU cache
   * @param options Configuration options
   */
  constructor(options?: CacheOptions) {
    this.maxCount = options?.maxCount ?? Infinity
    this.maxBytes = options?.maxBytes ?? Infinity
    this.defaultTTL = options?.defaultTTL
    this.sizeCalculator = options?.sizeCalculator ?? defaultSizeCalculator
    this.onEvict = options?.onEvict
  }

  /**
   * Check if an entry is expired
   */
  private isExpired(entry: CacheEntry<V>): boolean {
    if (entry.expiresAt === null) return false
    return Date.now() > entry.expiresAt
  }

  /**
   * Move a node to the head (most recently used)
   */
  private moveToHead(node: ListNode<K, V>): void {
    if (node === this.head) return

    // Remove from current position
    this.removeNode(node)

    // Add to head
    node.prev = null
    node.next = this.head
    if (this.head) {
      this.head.prev = node
    }
    this.head = node
    if (!this.tail) {
      this.tail = node
    }
  }

  /**
   * Remove a node from the linked list
   */
  private removeNode(node: ListNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      this.head = node.next
    }

    if (node.next) {
      node.next.prev = node.prev
    } else {
      this.tail = node.prev
    }
  }

  /**
   * Add a node to the head of the list
   */
  private addToHead(node: ListNode<K, V>): void {
    node.prev = null
    node.next = this.head
    if (this.head) {
      this.head.prev = node
    }
    this.head = node
    if (!this.tail) {
      this.tail = node
    }
  }

  /**
   * Evict items until we're under limits
   */
  private evictToFit(requiredSize: number): void {
    // Evict until we have room for the new item
    while (this.tail && (
      (this.maxCount !== Infinity && this.cache.size >= this.maxCount) ||
      (this.maxBytes !== Infinity && this._bytes + requiredSize > this.maxBytes)
    )) {
      const lru = this.tail
      this.removeNode(lru)
      this.cache.delete(lru.key)
      this._bytes -= lru.entry.size
      this._evictions++
      if (this.onEvict) {
        this.onEvict(lru.key, lru.entry.value, 'lru')
      }
    }
  }

  /**
   * Get a value from the cache
   * @param key The cache key
   * @returns The cached value or undefined if not found/expired
   */
  get(key: K): V | undefined {
    const node = this.cache.get(key)

    if (!node) {
      this._misses++
      return undefined
    }

    if (this.isExpired(node.entry)) {
      // Remove expired entry
      this.removeNode(node)
      this.cache.delete(key)
      this._bytes -= node.entry.size
      this._misses++
      if (this.onEvict) {
        this.onEvict(key, node.entry.value, 'ttl')
      }
      return undefined
    }

    // Update access time and move to head
    node.entry.lastAccessed = Date.now()
    this.moveToHead(node)
    this._hits++

    return node.entry.value
  }

  /**
   * Set a value in the cache
   * @param key The cache key
   * @param value The value to cache
   * @param options Optional settings for this entry
   * @returns true if successfully set, false otherwise
   */
  set(key: K, value: V, options?: SetOptions): boolean {
    const size = options?.size ?? this.sizeCalculator(value)

    // Reject items larger than maxBytes
    if (this.maxBytes !== Infinity && size > this.maxBytes) {
      return false
    }

    const now = Date.now()
    const ttl = options?.ttl ?? this.defaultTTL
    const expiresAt = ttl !== undefined ? now + ttl : null

    // Check if key already exists
    const existingNode = this.cache.get(key)
    if (existingNode) {
      // Update existing entry
      this._bytes -= existingNode.entry.size
      existingNode.entry = {
        value,
        size,
        createdAt: now,
        expiresAt,
        lastAccessed: now
      }
      this._bytes += size
      this.moveToHead(existingNode)
      return true
    }

    // Evict items to make room
    this.evictToFit(size)

    // Create new entry
    const entry: CacheEntry<V> = {
      value,
      size,
      createdAt: now,
      expiresAt,
      lastAccessed: now
    }

    const node: ListNode<K, V> = {
      key,
      entry,
      prev: null,
      next: null
    }

    this.cache.set(key, node)
    this.addToHead(node)
    this._bytes += size

    return true
  }

  /**
   * Check if a key exists in the cache (without updating LRU order)
   * @param key The cache key
   * @returns true if the key exists and is not expired
   */
  has(key: K): boolean {
    const node = this.cache.get(key)
    if (!node) return false
    if (this.isExpired(node.entry)) return false
    return true
  }

  /**
   * Delete a key from the cache
   * @param key The cache key
   * @returns true if the key was deleted, false if it didn't exist
   */
  delete(key: K): boolean {
    const node = this.cache.get(key)
    if (!node) return false

    this.removeNode(node)
    this.cache.delete(key)
    this._bytes -= node.entry.size

    if (this.onEvict) {
      this.onEvict(key, node.entry.value, 'manual')
    }

    return true
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    if (this.onEvict) {
      // Call onEvict for each entry
      for (const [key, node] of this.cache) {
        this.onEvict(key, node.entry.value, 'clear')
      }
    }

    this.cache.clear()
    this.head = null
    this.tail = null
    this._bytes = 0
  }

  /**
   * Get cache statistics
   * @returns Current cache statistics
   */
  getStats(): CacheStats {
    const total = this._hits + this._misses
    const hitRate = total === 0 ? 0 : Math.round((this._hits / total) * 100)

    return {
      hits: this._hits,
      misses: this._misses,
      count: this.cache.size,
      bytes: this._bytes,
      evictions: this._evictions,
      hitRate
    }
  }

  /**
   * Reset cache statistics (keeps cached data)
   */
  resetStats(): void {
    this._hits = 0
    this._misses = 0
    this._evictions = 0
  }

  /**
   * Get the number of items currently in the cache
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Get the current byte size of the cache
   */
  get bytes(): number {
    return this._bytes
  }

  /**
   * Get all keys in the cache (in LRU order, most recent first)
   */
  keys(): K[] {
    const keys: K[] = []
    let node = this.head
    while (node) {
      keys.push(node.key)
      node = node.next
    }
    return keys
  }

  /**
   * Get all values in the cache (in LRU order, most recent first)
   */
  values(): V[] {
    const values: V[] = []
    let node = this.head
    while (node) {
      values.push(node.entry.value)
      node = node.next
    }
    return values
  }

  /**
   * Get all entries in the cache (in LRU order, most recent first)
   */
  entries(): Array<[K, V]> {
    const entries: Array<[K, V]> = []
    let node = this.head
    while (node) {
      entries.push([node.key, node.entry.value])
      node = node.next
    }
    return entries
  }

  /**
   * Peek at a value without updating LRU order
   * @param key The cache key
   * @returns The cached value or undefined if not found/expired
   */
  peek(key: K): V | undefined {
    const node = this.cache.get(key)
    if (!node) return undefined
    if (this.isExpired(node.entry)) return undefined
    return node.entry.value
  }

  /**
   * Evict expired entries from the cache
   * @returns Number of entries evicted
   */
  prune(): number {
    let pruned = 0
    const now = Date.now()

    for (const [key, node] of this.cache) {
      if (node.entry.expiresAt !== null && now > node.entry.expiresAt) {
        this.removeNode(node)
        this.cache.delete(key)
        this._bytes -= node.entry.size
        pruned++

        if (this.onEvict) {
          this.onEvict(key, node.entry.value, 'ttl')
        }
      }
    }

    return pruned
  }

  /**
   * Resize the cache to new limits
   * @param options New size limits
   */
  resize(options: Pick<CacheOptions, 'maxCount' | 'maxBytes'>): void {
    if (options.maxCount !== undefined) {
      this.maxCount = options.maxCount
    }
    if (options.maxBytes !== undefined) {
      this.maxBytes = options.maxBytes
    }

    // Evict items until we're under the new limits
    while (this.tail && (
      (this.maxCount !== Infinity && this.cache.size > this.maxCount) ||
      (this.maxBytes !== Infinity && this._bytes > this.maxBytes)
    )) {
      const lru = this.tail
      this.removeNode(lru)
      this.cache.delete(lru.key)
      this._bytes -= lru.entry.size
      this._evictions++
      if (this.onEvict) {
        this.onEvict(lru.key, lru.entry.value, 'lru')
      }
    }
  }
}

/**
 * Create a key serializer for complex key types
 */
export function createKeySerializer<K>(
  serialize: (key: K) => string,
  deserialize: (str: string) => K
): { serialize: (key: K) => string; deserialize: (str: string) => K } {
  return { serialize, deserialize }
}

/**
 * Default size calculator for common value types
 */
export function defaultSizeCalculator<T>(value: T): number {
  if (value === null || value === undefined) {
    return 0
  }

  if (typeof value === 'string') {
    // Approximate size: 2 bytes per character (UTF-16)
    return value.length * 2
  }

  if (typeof value === 'number') {
    // Numbers are 8 bytes in JavaScript
    return 8
  }

  if (typeof value === 'boolean') {
    return 4
  }

  if (value instanceof Uint8Array) {
    return value.byteLength
  }

  if (value instanceof ArrayBuffer) {
    return value.byteLength
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength
  }

  if (typeof value === 'object') {
    // For objects, serialize to JSON and count characters
    try {
      const json = JSON.stringify(value)
      return json.length * 2
    } catch {
      // If serialization fails, return a default size
      return 64
    }
  }

  // Default size for unknown types
  return 8
}
