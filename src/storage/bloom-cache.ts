/**
 * @fileoverview Bloom Filter Cache for SHA Lookups
 *
 * Provides a fast probabilistic cache for checking whether a SHA exists
 * in the R2 Parquet store. Uses a bloom filter backed by SQLite for
 * persistence across DO restarts.
 *
 * The bloom filter avoids expensive R2 reads for objects that don't exist.
 * False positives are acceptable (results in an R2 read), but false negatives
 * are not (would cause missing objects).
 *
 * @module storage/bloom-cache
 */

import type { SQLStorage } from './types'

// ============================================================================
// Constants
// ============================================================================

/** Default bloom filter size in bits (8MB) */
const DEFAULT_FILTER_BITS = 8 * 1024 * 1024

/** Default number of hash functions for bloom filter */
const DEFAULT_HASH_COUNT = 7

/** Default maximum number of exact SHAs to cache in SHA cache table */
const DEFAULT_EXACT_CACHE_LIMIT = 100_000

/** SQLite table name for bloom filter persistence */
const BLOOM_TABLE = 'bloom_filter'

/** SQLite table name for SHA existence cache */
const SHA_CACHE_TABLE = 'sha_cache'

// ============================================================================
// Bloom Filter Implementation
// ============================================================================

/**
 * Simple bloom filter using FNV-1a hash variants.
 */
export class BloomFilter {
  private bits: Uint8Array
  private readonly numBits: number
  private readonly hashCount: number
  private _count = 0

  constructor(numBits: number = DEFAULT_FILTER_BITS, hashCount: number = DEFAULT_HASH_COUNT) {
    this.numBits = numBits
    this.hashCount = hashCount
    this.bits = new Uint8Array(Math.ceil(numBits / 8))
  }

  /** Number of items added */
  get count(): number {
    return this._count
  }

  /** Estimated false positive rate */
  get falsePositiveRate(): number {
    if (this._count === 0) return 0
    const p = Math.pow(
      1 - Math.exp(-this.hashCount * this._count / this.numBits),
      this.hashCount
    )
    return p
  }

  /**
   * Add a SHA to the bloom filter.
   */
  add(sha: string): void {
    const hashes = this.getHashes(sha)
    for (const h of hashes) {
      const bit = h % this.numBits
      this.bits[bit >>> 3] |= 1 << (bit & 7)
    }
    this._count++
  }

  /**
   * Check if a SHA might exist (probabilistic).
   * Returns false ONLY if the SHA definitely does not exist.
   */
  mightContain(sha: string): boolean {
    const hashes = this.getHashes(sha)
    for (const h of hashes) {
      const bit = h % this.numBits
      if ((this.bits[bit >>> 3] & (1 << (bit & 7))) === 0) {
        return false
      }
    }
    return true
  }

  /** Clear the filter */
  clear(): void {
    this.bits.fill(0)
    this._count = 0
  }

  /** Serialize filter to bytes for persistence */
  serialize(): Uint8Array {
    return this.bits
  }

  /** Load filter from serialized bytes */
  load(data: Uint8Array, count: number): void {
    this.bits = new Uint8Array(data)
    this._count = count
  }

  /**
   * Compute hash positions using double-hashing scheme.
   * Uses FNV-1a with two different seeds for h1 and h2.
   */
  private getHashes(sha: string): number[] {
    const h1 = fnv1a(sha, 0x811c9dc5)
    const h2 = fnv1a(sha, 0xc4ceb9fe)
    const hashes: number[] = []
    for (let i = 0; i < this.hashCount; i++) {
      hashes.push((h1 + i * h2) >>> 0)
    }
    return hashes
  }
}

/**
 * FNV-1a hash function for strings.
 */
function fnv1a(str: string, seed: number): number {
  let hash = seed
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// ============================================================================
// SQLite-backed Bloom Cache
// ============================================================================

/**
 * Configuration for BloomCache.
 */
export interface BloomCacheOptions {
  /** Filter size in bits */
  filterBits?: number
  /** Number of hash functions */
  hashCount?: number
  /** Enable exact SHA cache alongside bloom filter */
  enableExactCache?: boolean
  /** Maximum number of exact SHAs to cache */
  exactCacheLimit?: number
}

/**
 * SQLite-backed bloom filter cache for SHA existence checks.
 *
 * Two-tier approach:
 * 1. Bloom filter for fast probabilistic checks (persisted as blob)
 * 2. Optional exact SHA cache in SQLite for recently-seen objects
 */
export class BloomCache {
  private filter: BloomFilter
  private storage: SQLStorage
  private options: Required<BloomCacheOptions>
  private initialized = false

  constructor(storage: SQLStorage, options?: BloomCacheOptions) {
    this.storage = storage
    this.options = {
      filterBits: options?.filterBits ?? DEFAULT_FILTER_BITS,
      hashCount: options?.hashCount ?? DEFAULT_HASH_COUNT,
      enableExactCache: options?.enableExactCache ?? true,
      exactCacheLimit: options?.exactCacheLimit ?? DEFAULT_EXACT_CACHE_LIMIT,
    }
    this.filter = new BloomFilter(this.options.filterBits, this.options.hashCount)
  }

  /**
   * Initialize the bloom cache schema and load persisted filter.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create tables
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${BLOOM_TABLE} (
        id INTEGER PRIMARY KEY DEFAULT 1,
        filter_data BLOB NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `)

    if (this.options.enableExactCache) {
      this.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS ${SHA_CACHE_TABLE} (
          sha TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          size INTEGER NOT NULL,
          added_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sha_cache_added ON ${SHA_CACHE_TABLE}(added_at);
      `)
    }

    // Load persisted filter
    const result = this.storage.sql.exec(
      `SELECT filter_data, item_count FROM ${BLOOM_TABLE} WHERE id = 1`
    )
    const rows = result.toArray() as { filter_data: Uint8Array; item_count: number }[]
    if (rows.length > 0) {
      this.filter.load(new Uint8Array(rows[0].filter_data), rows[0].item_count)
    }

    this.initialized = true
  }

  /**
   * Record that a SHA exists in the store.
   */
  async add(sha: string, type: string, size: number): Promise<void> {
    await this.initialize()

    this.filter.add(sha)

    if (this.options.enableExactCache) {
      const now = Date.now()
      this.storage.sql.exec(
        `INSERT OR REPLACE INTO ${SHA_CACHE_TABLE} (sha, type, size, added_at) VALUES (?, ?, ?, ?)`,
        sha, type, size, now
      )

      // Evict old entries if over limit
      const countResult = this.storage.sql.exec(
        `SELECT COUNT(*) as cnt FROM ${SHA_CACHE_TABLE}`
      )
      const countRows = countResult.toArray() as { cnt: number }[]
      if (countRows.length > 0 && countRows[0].cnt > this.options.exactCacheLimit) {
        const excess = countRows[0].cnt - this.options.exactCacheLimit
        this.storage.sql.exec(
          `DELETE FROM ${SHA_CACHE_TABLE} WHERE sha IN (
            SELECT sha FROM ${SHA_CACHE_TABLE} ORDER BY added_at ASC LIMIT ?
          )`,
          excess
        )
      }
    }
  }

  /**
   * Batch add multiple SHAs.
   */
  async addBatch(items: Array<{ sha: string; type: string; size: number }>): Promise<void> {
    await this.initialize()

    for (const item of items) {
      this.filter.add(item.sha)
    }

    if (this.options.enableExactCache) {
      const now = Date.now()
      this.storage.sql.exec('BEGIN TRANSACTION')
      try {
        for (const item of items) {
          this.storage.sql.exec(
            `INSERT OR REPLACE INTO ${SHA_CACHE_TABLE} (sha, type, size, added_at) VALUES (?, ?, ?, ?)`,
            item.sha, item.type, item.size, now
          )
        }
        this.storage.sql.exec('COMMIT')
      } catch (e) {
        this.storage.sql.exec('ROLLBACK')
        throw e
      }
    }
  }

  /**
   * Check if a SHA might exist.
   *
   * Returns:
   * - 'definite' if found in exact cache
   * - 'probable' if bloom filter says yes (may be false positive)
   * - 'absent' if bloom filter says no (definitely absent)
   */
  async check(sha: string): Promise<'definite' | 'probable' | 'absent'> {
    await this.initialize()

    // Check exact cache first
    if (this.options.enableExactCache) {
      const result = this.storage.sql.exec(
        `SELECT 1 FROM ${SHA_CACHE_TABLE} WHERE sha = ?`,
        sha
      )
      if (result.toArray().length > 0) {
        return 'definite'
      }
    }

    // Fall back to bloom filter
    return this.filter.mightContain(sha) ? 'probable' : 'absent'
  }

  /**
   * Get object metadata from exact cache.
   */
  async getMetadata(sha: string): Promise<{ type: string; size: number } | null> {
    await this.initialize()

    if (!this.options.enableExactCache) return null

    const result = this.storage.sql.exec(
      `SELECT type, size FROM ${SHA_CACHE_TABLE} WHERE sha = ?`,
      sha
    )
    const rows = result.toArray() as { type: string; size: number }[]
    return rows.length > 0 ? rows[0] : null
  }

  /**
   * Persist the bloom filter to SQLite.
   * Call this periodically or before DO hibernation.
   */
  async persist(): Promise<void> {
    await this.initialize()

    const data = this.filter.serialize()
    const now = Date.now()

    this.storage.sql.exec(
      `INSERT OR REPLACE INTO ${BLOOM_TABLE} (id, filter_data, item_count, updated_at) VALUES (1, ?, ?, ?)`,
      data, this.filter.count, now
    )
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    bloomItems: number
    bloomFalsePositiveRate: number
    exactCacheSize: number
  } {
    let exactCacheSize = 0
    if (this.options.enableExactCache && this.initialized) {
      const result = this.storage.sql.exec(
        `SELECT COUNT(*) as cnt FROM ${SHA_CACHE_TABLE}`
      )
      const rows = result.toArray() as { cnt: number }[]
      exactCacheSize = rows.length > 0 ? rows[0].cnt : 0
    }

    return {
      bloomItems: this.filter.count,
      bloomFalsePositiveRate: this.filter.falsePositiveRate,
      exactCacheSize,
    }
  }

  /** Clear all cached data */
  async clear(): Promise<void> {
    this.filter.clear()
    if (this.initialized) {
      this.storage.sql.exec(`DELETE FROM ${BLOOM_TABLE}`)
      if (this.options.enableExactCache) {
        this.storage.sql.exec(`DELETE FROM ${SHA_CACHE_TABLE}`)
      }
    }
  }
}
