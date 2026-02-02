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
import { typedQuery, validateRow } from '../utils/sql-validate'

// ============================================================================
// Constants
// ============================================================================

/** Default bloom filter size in bits (8MB) */
const DEFAULT_FILTER_BITS = 8 * 1024 * 1024

/** Default number of hash functions for bloom filter */
const DEFAULT_HASH_COUNT = 7

/** Default maximum number of exact SHAs to cache in SHA cache table */
const DEFAULT_EXACT_CACHE_LIMIT = 100_000

/** Default item threshold per segment before creating a new segment */
const DEFAULT_SEGMENT_THRESHOLD = 10_000

/** Maximum number of segments before triggering compaction */
const DEFAULT_MAX_SEGMENTS = 10

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
// Segmented Bloom Filter
// ============================================================================

/**
 * Serialized representation of a single bloom filter segment.
 */
export interface BloomSegmentData {
  data: Uint8Array
  count: number
}

/**
 * Options for the segmented bloom filter.
 */
export interface SegmentedBloomFilterOptions {
  /** Filter size in bits per segment */
  filterBits?: number
  /** Number of hash functions */
  hashCount?: number
  /** Maximum items per segment before creating a new one */
  segmentThreshold?: number
  /** Maximum number of segments before compaction */
  maxSegments?: number
}

/**
 * A segmented bloom filter that automatically creates new segments when the
 * current segment exceeds an item threshold.
 *
 * This prevents false positive rate degradation as items grow. Lookups check
 * all segments (a match in any segment returns true). When the number of
 * segments exceeds maxSegments, older segments are compacted into a single
 * larger segment.
 */
export class SegmentedBloomFilter {
  private segments: BloomFilter[] = []
  private readonly filterBits: number
  private readonly hashCount: number
  private readonly segmentThreshold: number
  private readonly maxSegments: number

  constructor(options?: SegmentedBloomFilterOptions) {
    this.filterBits = options?.filterBits ?? DEFAULT_FILTER_BITS
    this.hashCount = options?.hashCount ?? DEFAULT_HASH_COUNT
    this.segmentThreshold = options?.segmentThreshold ?? DEFAULT_SEGMENT_THRESHOLD
    this.maxSegments = options?.maxSegments ?? DEFAULT_MAX_SEGMENTS
    // Start with one empty segment
    this.segments.push(new BloomFilter(this.filterBits, this.hashCount))
  }

  /** Total number of items across all segments */
  get count(): number {
    let total = 0
    for (const seg of this.segments) {
      total += seg.count
    }
    return total
  }

  /** Number of active segments */
  get segmentCount(): number {
    return this.segments.length
  }

  /**
   * Estimated false positive rate across all segments.
   *
   * For independent segments, the probability of a false positive is:
   * 1 - product(1 - fp_i) for each segment i.
   * However, since a true negative requires ALL segments to return false,
   * the combined FP rate is bounded by the sum of per-segment rates.
   */
  get falsePositiveRate(): number {
    if (this.count === 0) return 0
    let probNoFP = 1
    for (const seg of this.segments) {
      probNoFP *= (1 - seg.falsePositiveRate)
    }
    return 1 - probNoFP
  }

  /**
   * Add a SHA to the bloom filter. Creates a new segment if the current
   * one has exceeded the item threshold.
   */
  add(sha: string): void {
    let current = this.segments[this.segments.length - 1]
    if (current.count >= this.segmentThreshold) {
      current = new BloomFilter(this.filterBits, this.hashCount)
      this.segments.push(current)
      this.maybeCompact()
    }
    current.add(sha)
  }

  /**
   * Check if a SHA might exist. Checks all segments.
   * Returns false ONLY if no segment reports a possible match.
   */
  mightContain(sha: string): boolean {
    for (const seg of this.segments) {
      if (seg.mightContain(sha)) return true
    }
    return false
  }

  /** Clear all segments, reset to a single empty segment */
  clear(): void {
    this.segments = [new BloomFilter(this.filterBits, this.hashCount)]
  }

  /**
   * Serialize all segments for persistence.
   */
  serializeSegments(): BloomSegmentData[] {
    return this.segments.map(seg => ({
      data: seg.serialize(),
      count: seg.count,
    }))
  }

  /**
   * Load segments from serialized data.
   */
  loadSegments(segments: BloomSegmentData[]): void {
    if (segments.length === 0) return
    this.segments = segments.map(s => {
      const f = new BloomFilter(this.filterBits, this.hashCount)
      f.load(s.data, s.count)
      return f
    })
  }

  /**
   * Load from a single legacy (non-segmented) serialized filter.
   * Supports backward compatibility with the old single-filter persistence.
   */
  loadLegacy(data: Uint8Array, count: number): void {
    const f = new BloomFilter(this.filterBits, this.hashCount)
    f.load(data, count)
    this.segments = [f]
  }

  /**
   * Compact older segments by merging them into one segment.
   * This is triggered when segment count exceeds maxSegments.
   *
   * The compacted segment uses a larger bit array (sum of old segment sizes)
   * but re-hashing isn't possible so we OR the bit arrays together.
   * Since all segments have the same bit size, we simply OR them.
   *
   * Note: the count on the compacted segment is the sum of original counts,
   * making the false positive rate estimate conservative. The actual FP rate
   * of the merged segment may be slightly better than estimated.
   */
  compact(): void {
    if (this.segments.length <= 1) return
    const newest = this.segments[this.segments.length - 1]
    const oldSegments = this.segments.slice(0, -1)

    // OR all old segments together
    const merged = new BloomFilter(this.filterBits, this.hashCount)
    const mergedBits = new Uint8Array(Math.ceil(this.filterBits / 8))
    let mergedCount = 0
    for (const seg of oldSegments) {
      const bits = seg.serialize()
      for (let i = 0; i < mergedBits.length; i++) {
        mergedBits[i] |= bits[i]
      }
      mergedCount += seg.count
    }
    merged.load(mergedBits, mergedCount)

    this.segments = [merged, newest]
  }

  /**
   * Trigger compaction if we have exceeded maxSegments.
   */
  private maybeCompact(): void {
    if (this.segments.length > this.maxSegments) {
      this.compact()
    }
  }
}

// ============================================================================
// SQLite-backed Bloom Cache
// ============================================================================

/**
 * Configuration for BloomCache.
 */
export interface BloomCacheOptions {
  /** Filter size in bits per segment */
  filterBits?: number
  /** Number of hash functions */
  hashCount?: number
  /** Enable exact SHA cache alongside bloom filter */
  enableExactCache?: boolean
  /** Maximum number of exact SHAs to cache */
  exactCacheLimit?: number
  /** Maximum items per bloom segment before creating a new segment */
  segmentThreshold?: number
  /** Maximum number of bloom segments before compaction */
  maxSegments?: number
}

/**
 * SQLite-backed bloom filter cache for SHA existence checks.
 *
 * Two-tier approach:
 * 1. Bloom filter for fast probabilistic checks (persisted as blob)
 * 2. Optional exact SHA cache in SQLite for recently-seen objects
 */
export class BloomCache {
  private filter: SegmentedBloomFilter
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
      segmentThreshold: options?.segmentThreshold ?? DEFAULT_SEGMENT_THRESHOLD,
      maxSegments: options?.maxSegments ?? DEFAULT_MAX_SEGMENTS,
    }
    this.filter = new SegmentedBloomFilter({
      filterBits: this.options.filterBits,
      hashCount: this.options.hashCount,
      segmentThreshold: this.options.segmentThreshold,
      maxSegments: this.options.maxSegments,
    })
  }

  /**
   * Initialize the bloom cache schema and load persisted filter.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create tables - add segment_id column to support multiple segments
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${BLOOM_TABLE} (
        id INTEGER PRIMARY KEY,
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

    // Load persisted segments (or legacy single filter at id=1)
    const result = this.storage.sql.exec(
      `SELECT id, filter_data, item_count FROM ${BLOOM_TABLE} ORDER BY id ASC`
    )
    const rows = typedQuery<{ id: number; filter_data: Uint8Array; item_count: number }>(result, validateRow(['id', 'filter_data', 'item_count']))
    if (rows.length === 1 && rows[0].id === 1) {
      // Legacy single-filter format or single segment - load as legacy
      this.filter.loadLegacy(new Uint8Array(rows[0].filter_data), rows[0].item_count)
    } else if (rows.length > 0) {
      // Multi-segment format
      const segments: BloomSegmentData[] = rows.map(r => ({
        data: new Uint8Array(r.filter_data),
        count: r.item_count,
      }))
      this.filter.loadSegments(segments)
    }

    this.initialized = true
  }

  /**
   * Record that a SHA exists in the store.
   */
  async add(sha: string, type: string, size: number): Promise<void> {
    await this.initialize()

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
      const countRows = typedQuery<{ cnt: number }>(countResult, validateRow(['cnt']))
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

    // Update in-memory bloom filter AFTER SQL succeeds to ensure consistency on rollback
    this.filter.add(sha)
  }

  /**
   * Batch add multiple SHAs.
   */
  async addBatch(items: Array<{ sha: string; type: string; size: number }>): Promise<void> {
    await this.initialize()

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

    // Update in-memory bloom filter AFTER SQL transaction succeeds
    // to ensure bloom state is not polluted on transaction rollback
    for (const item of items) {
      this.filter.add(item.sha)
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
    const rows = typedQuery<{ type: string; size: number }>(result, validateRow(['type', 'size']))
    return rows.length > 0 ? rows[0] : null
  }

  /**
   * Persist the bloom filter to SQLite.
   * Call this periodically or before DO hibernation.
   */
  async persist(): Promise<void> {
    await this.initialize()

    const segments = this.filter.serializeSegments()
    const now = Date.now()

    // Replace all existing rows with current segments
    this.storage.sql.exec(`DELETE FROM ${BLOOM_TABLE}`)
    for (let i = 0; i < segments.length; i++) {
      this.storage.sql.exec(
        `INSERT INTO ${BLOOM_TABLE} (id, filter_data, item_count, updated_at) VALUES (?, ?, ?, ?)`,
        i + 1, segments[i].data, segments[i].count, now
      )
    }
  }

  /**
   * Get cache statistics.
   */
  getStats(): {
    bloomItems: number
    bloomFalsePositiveRate: number
    bloomSegments: number
    exactCacheSize: number
  } {
    let exactCacheSize = 0
    if (this.options.enableExactCache && this.initialized) {
      const result = this.storage.sql.exec(
        `SELECT COUNT(*) as cnt FROM ${SHA_CACHE_TABLE}`
      )
      const rows = typedQuery<{ cnt: number }>(result, validateRow(['cnt']))
      exactCacheSize = rows.length > 0 ? rows[0].cnt : 0
    }

    return {
      bloomItems: this.filter.count,
      bloomFalsePositiveRate: this.filter.falsePositiveRate,
      bloomSegments: this.filter.segmentCount,
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
