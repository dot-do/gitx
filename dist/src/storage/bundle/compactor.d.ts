/**
 * @fileoverview BundleCompactor - Merge and defragment R2 bundles
 *
 * Over time, bundle storage accumulates many small bundles and bundles with
 * deleted (garbage collected) objects. The compactor merges multiple source
 * bundles into fewer, larger, defragmented target bundles.
 *
 * Compaction strategy:
 * 1. Identify candidate bundles (small, high dead-object ratio, or old)
 * 2. Read all live objects from candidate bundles
 * 3. Write them into new, tightly-packed bundles
 * 4. Delete the old bundles after successful write
 *
 * This runs as a background maintenance task, not in the critical path.
 *
 * @module storage/bundle/compactor
 */
/** R2-compatible storage for compaction (needs read + write + delete + list) */
export interface CompactorStorage {
    /** Read a bundle from storage */
    get(key: string): Promise<Uint8Array | null>;
    /** Write a bundle to storage */
    put(key: string, data: Uint8Array | ArrayBuffer): Promise<void>;
    /** Delete a bundle from storage */
    delete(key: string): Promise<void>;
    /** List bundle keys with a given prefix */
    list(prefix: string): Promise<string[]>;
}
/** Configuration for the compactor */
export interface BundleCompactorConfig {
    /** Maximum size of compacted bundles (default: 128MB) */
    maxBundleSize?: number;
    /** Minimum number of source bundles to trigger compaction (default: 4) */
    minBundlesForCompaction?: number;
    /** Maximum ratio of dead/total objects before a bundle is a compaction candidate (default: 0.3) */
    deadObjectThreshold?: number;
    /** Maximum size of a bundle to be considered "small" for compaction (default: 1MB) */
    smallBundleThreshold?: number;
    /** R2 key prefix for bundles (default: 'bundles/') */
    keyPrefix?: string;
}
/** Information about a bundle being considered for compaction */
export interface CompactionCandidate {
    /** R2 key of the bundle */
    key: string;
    /** Total size in bytes */
    size: number;
    /** Total number of entries */
    entryCount: number;
    /** Number of live (non-deleted) objects */
    liveObjects: number;
    /** Reason this bundle was selected for compaction */
    reason: 'small' | 'fragmented' | 'explicit';
}
/** Result of a compaction run */
export interface CompactionResult {
    /** Whether compaction was performed */
    compacted: boolean;
    /** Number of source bundles merged */
    sourceBundles: number;
    /** Number of target bundles created */
    targetBundles: number;
    /** Total live objects moved */
    objectsMoved: number;
    /** Total bytes in source bundles */
    sourceTotalBytes: number;
    /** Total bytes in target bundles */
    targetTotalBytes: number;
    /** Space saved in bytes */
    bytesSaved: number;
    /** R2 keys of newly created bundles */
    newBundleKeys: string[];
    /** R2 keys of deleted source bundles */
    deletedBundleKeys: string[];
    /** Duration in milliseconds */
    durationMs: number;
}
/** Predicate to determine if an object is still live (not garbage collected) */
export type LiveObjectPredicate = (oid: string) => boolean | Promise<boolean>;
export declare class CompactionError extends Error {
    readonly cause?: Error | undefined;
    constructor(message: string, cause?: Error | undefined);
}
/**
 * BundleCompactor merges and defragments R2 bundles.
 *
 * @example
 * ```typescript
 * const compactor = new BundleCompactor(r2Storage, {
 *   minBundlesForCompaction: 4,
 *   smallBundleThreshold: 1024 * 1024,
 * })
 *
 * // Compact all small bundles
 * const result = await compactor.compact()
 * console.log(`Saved ${result.bytesSaved} bytes by merging ${result.sourceBundles} bundles`)
 *
 * // Compact specific bundles
 * const result2 = await compactor.compactBundles(['bundles/a.bundle', 'bundles/b.bundle'])
 * ```
 */
export declare class BundleCompactor {
    private readonly storage;
    private readonly config;
    constructor(storage: CompactorStorage, config?: BundleCompactorConfig);
    /**
     * Run automatic compaction.
     *
     * Scans for candidate bundles (small or fragmented), reads their live
     * objects, and writes them into new, larger bundles. Old bundles are
     * deleted after successful write.
     *
     * @param isLive - Optional predicate to filter out dead objects during compaction.
     *                 If not provided, all objects in source bundles are considered live.
     */
    compact(isLive?: LiveObjectPredicate): Promise<CompactionResult>;
    /**
     * Compact specific bundles by their R2 keys.
     *
     * Unlike compact(), this does not apply candidate selection heuristics.
     * All specified bundles are merged.
     */
    compactBundles(bundleKeys: string[], isLive?: LiveObjectPredicate): Promise<CompactionResult>;
    /**
     * Identify bundles that are good candidates for compaction.
     */
    identifyCandidates(bundleKeys: string[]): Promise<CompactionCandidate[]>;
    private compactCandidates;
}
//# sourceMappingURL=compactor.d.ts.map