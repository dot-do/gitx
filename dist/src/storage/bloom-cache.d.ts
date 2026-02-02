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
import type { SQLStorage } from './types';
/**
 * Simple bloom filter using FNV-1a hash variants.
 */
export declare class BloomFilter {
    private bits;
    private readonly numBits;
    private readonly hashCount;
    private _count;
    constructor(numBits?: number, hashCount?: number);
    /** Number of items added */
    get count(): number;
    /** Estimated false positive rate */
    get falsePositiveRate(): number;
    /**
     * Add a SHA to the bloom filter.
     */
    add(sha: string): void;
    /**
     * Check if a SHA might exist (probabilistic).
     * Returns false ONLY if the SHA definitely does not exist.
     */
    mightContain(sha: string): boolean;
    /** Clear the filter */
    clear(): void;
    /** Serialize filter to bytes for persistence */
    serialize(): Uint8Array;
    /** Load filter from serialized bytes */
    load(data: Uint8Array, count: number): void;
    /**
     * Compute hash positions using double-hashing scheme.
     * Uses FNV-1a with two different seeds for h1 and h2.
     */
    private getHashes;
}
/**
 * Serialized representation of a single bloom filter segment.
 */
export interface BloomSegmentData {
    data: Uint8Array;
    count: number;
}
/**
 * Options for the segmented bloom filter.
 */
export interface SegmentedBloomFilterOptions {
    /** Filter size in bits per segment */
    filterBits?: number;
    /** Number of hash functions */
    hashCount?: number;
    /** Maximum items per segment before creating a new one */
    segmentThreshold?: number;
    /** Maximum number of segments before compaction */
    maxSegments?: number;
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
export declare class SegmentedBloomFilter {
    private segments;
    private readonly filterBits;
    private readonly hashCount;
    private readonly segmentThreshold;
    private readonly maxSegments;
    constructor(options?: SegmentedBloomFilterOptions);
    /** Total number of items across all segments */
    get count(): number;
    /** Number of active segments */
    get segmentCount(): number;
    /**
     * Estimated false positive rate across all segments.
     *
     * For independent segments, the probability of a false positive is:
     * 1 - product(1 - fp_i) for each segment i.
     * However, since a true negative requires ALL segments to return false,
     * the combined FP rate is bounded by the sum of per-segment rates.
     */
    get falsePositiveRate(): number;
    /**
     * Add a SHA to the bloom filter. Creates a new segment if the current
     * one has exceeded the item threshold.
     */
    add(sha: string): void;
    /**
     * Check if a SHA might exist. Checks all segments.
     * Returns false ONLY if no segment reports a possible match.
     */
    mightContain(sha: string): boolean;
    /** Clear all segments, reset to a single empty segment */
    clear(): void;
    /**
     * Serialize all segments for persistence.
     */
    serializeSegments(): BloomSegmentData[];
    /**
     * Load segments from serialized data.
     */
    loadSegments(segments: BloomSegmentData[]): void;
    /**
     * Load from a single legacy (non-segmented) serialized filter.
     * Supports backward compatibility with the old single-filter persistence.
     */
    loadLegacy(data: Uint8Array, count: number): void;
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
    compact(): void;
    /**
     * Trigger compaction if we have exceeded maxSegments.
     */
    private maybeCompact;
}
/**
 * Configuration for BloomCache.
 */
export interface BloomCacheOptions {
    /** Filter size in bits per segment */
    filterBits?: number;
    /** Number of hash functions */
    hashCount?: number;
    /** Enable exact SHA cache alongside bloom filter */
    enableExactCache?: boolean;
    /** Maximum number of exact SHAs to cache */
    exactCacheLimit?: number;
    /** Maximum items per bloom segment before creating a new segment */
    segmentThreshold?: number;
    /** Maximum number of bloom segments before compaction */
    maxSegments?: number;
}
/**
 * SQLite-backed bloom filter cache for SHA existence checks.
 *
 * Two-tier approach:
 * 1. Bloom filter for fast probabilistic checks (persisted as blob)
 * 2. Optional exact SHA cache in SQLite for recently-seen objects
 */
export declare class BloomCache {
    private filter;
    private storage;
    private options;
    private initialized;
    constructor(storage: SQLStorage, options?: BloomCacheOptions);
    /**
     * Initialize the bloom cache schema and load persisted filter.
     */
    initialize(): Promise<void>;
    /**
     * Record that a SHA exists in the store.
     */
    add(sha: string, type: string, size: number): Promise<void>;
    /**
     * Batch add multiple SHAs.
     */
    addBatch(items: Array<{
        sha: string;
        type: string;
        size: number;
    }>): Promise<void>;
    /**
     * Check if a SHA might exist.
     *
     * Returns:
     * - 'definite' if found in exact cache
     * - 'probable' if bloom filter says yes (may be false positive)
     * - 'absent' if bloom filter says no (definitely absent)
     */
    check(sha: string): Promise<'definite' | 'probable' | 'absent'>;
    /**
     * Resolve a short SHA prefix to a full SHA from the exact cache.
     * Returns the full SHA if exactly one match is found, null otherwise.
     * Throws if multiple matches are found (ambiguous prefix).
     */
    resolvePrefix(prefix: string): Promise<string | null>;
    /**
     * Get object metadata from exact cache.
     */
    getMetadata(sha: string): Promise<{
        type: string;
        size: number;
    } | null>;
    /**
     * Persist the bloom filter to SQLite.
     * Call this periodically or before DO hibernation.
     */
    persist(): Promise<void>;
    /**
     * Get cache statistics.
     */
    getStats(): {
        bloomItems: number;
        bloomFalsePositiveRate: number;
        bloomSegments: number;
        exactCacheSize: number;
    };
    /** Clear all cached data */
    clear(): Promise<void>;
}
//# sourceMappingURL=bloom-cache.d.ts.map