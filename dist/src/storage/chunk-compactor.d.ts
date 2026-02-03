/**
 * @fileoverview Chunk Compactor for DO Storage Efficiency
 *
 * Implements blob chunking compaction to optimize Durable Object storage costs.
 * The key insight is that DO SQLite charges per-row read/write, not by size,
 * so merging small blobs into larger chunks reduces billable operations.
 *
 * Compaction Strategy:
 * - Small blobs (< compaction threshold) are candidates for merging
 * - Multiple small blobs are packed into 2MB super-chunks
 * - An index tracks which blobs are stored in which super-chunk
 * - During compaction, small blobs are read, merged, and rewritten
 *
 * Storage Layout:
 * - Original: Each small blob = 1 row (many rows for many small files)
 * - Compacted: Multiple small blobs packed into 2MB chunks (fewer rows)
 *
 * Example cost savings:
 * - 1000 small files averaging 10KB each = 1000 row operations
 * - After compaction into 2MB chunks: ~5 row operations
 * - Cost reduction: ~200x fewer billable operations
 *
 * Issue: gitx-512e - [ARCH] Add blob chunking compaction for DO storage efficiency
 *
 * @module storage/chunk-compactor
 */
export declare const DEFAULT_COMPACTION_THRESHOLD: number;
/**
 * Minimum number of small blobs needed to trigger compaction.
 * Compaction has overhead, so only run when there are enough candidates.
 */
export declare const DEFAULT_MIN_BLOBS_FOR_COMPACTION = 10;
/**
 * Prefix for compacted super-chunk storage keys.
 */
export declare const SUPER_CHUNK_PREFIX = "__super_chunk__";
/**
 * Prefix for compaction index storage keys.
 */
export declare const COMPACTION_INDEX_PREFIX = "__compaction_idx__";
/**
 * Configuration for chunk compaction.
 */
export interface ChunkCompactorConfig {
    /** Size threshold for considering a blob "small" (default: 64KB) */
    compactionThreshold?: number;
    /** Minimum blobs needed to trigger compaction (default: 10) */
    minBlobsForCompaction?: number;
    /** Target size for super-chunks (default: CHUNK_SIZE = 2MB) */
    targetChunkSize?: number;
    /** Maximum size for a single super-chunk (default: CHUNK_SIZE = 2MB) */
    maxChunkSize?: number;
}
/**
 * Entry in the compaction index tracking where a blob is stored.
 */
export interface CompactionIndexEntry {
    /** SHA of the original blob */
    sha: string;
    /** ID of the super-chunk containing this blob */
    superChunkId: string;
    /** Byte offset within the super-chunk */
    offset: number;
    /** Size of the blob in bytes */
    size: number;
    /** Object type (blob, tree, commit, tag) */
    type: string;
}
/**
 * Metadata for a super-chunk.
 */
export interface SuperChunkMetadata {
    /** Unique ID for this super-chunk */
    id: string;
    /** Total size of the super-chunk in bytes */
    totalSize: number;
    /** Number of blobs packed in this super-chunk */
    blobCount: number;
    /** List of blob SHAs in this super-chunk (in order) */
    blobShas: string[];
    /** Timestamp when this super-chunk was created */
    createdAt: number;
}
/**
 * A blob candidate for compaction.
 */
export interface CompactionCandidate {
    /** SHA of the blob */
    sha: string;
    /** Object type */
    type: string;
    /** Blob data */
    data: Uint8Array;
}
/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
    /** Number of small blobs that were compacted */
    blobsCompacted: number;
    /** Number of super-chunks created */
    superChunksCreated: number;
    /** Total bytes before compaction */
    inputBytes: number;
    /** Total bytes after compaction (super-chunk overhead) */
    outputBytes: number;
    /** Space saved in bytes (can be negative due to overhead for very few blobs) */
    spaceSaved: number;
    /** Row operations saved (estimated) */
    rowOperationsSaved: number;
    /** Duration of compaction in milliseconds */
    durationMs: number;
    /** IDs of the created super-chunks */
    superChunkIds: string[];
}
/**
 * Compaction statistics.
 */
export interface CompactionStats {
    /** Number of blobs currently in super-chunks */
    compactedBlobCount: number;
    /** Number of super-chunks */
    superChunkCount: number;
    /** Total size of all compacted blobs */
    compactedBytes: number;
    /** Number of small blobs pending compaction */
    pendingCompactionCount: number;
    /** Total size of blobs pending compaction */
    pendingCompactionBytes: number;
}
/**
 * Storage interface for the chunk compactor.
 */
export interface CompactorStorage {
    /** Read a blob by key */
    get(key: string): Promise<Uint8Array | null>;
    /** Write a blob */
    put(key: string, data: Uint8Array): Promise<void>;
    /** Delete a blob */
    delete(key: string): Promise<boolean>;
    /** Check if a key exists */
    has(key: string): Promise<boolean>;
    /** List keys with a prefix */
    list(prefix: string): Promise<string[]>;
}
/**
 * Get the storage key for a super-chunk.
 */
export declare function getSuperChunkKey(superChunkId: string): string;
/**
 * Get the storage key for super-chunk metadata.
 */
export declare function getSuperChunkMetadataKey(superChunkId: string): string;
/**
 * Get the storage key for a compaction index entry.
 */
export declare function getCompactionIndexKey(sha: string): string;
/**
 * Encode super-chunk metadata to bytes.
 */
export declare function encodeSuperChunkMetadata(metadata: SuperChunkMetadata): Uint8Array;
/**
 * Decode super-chunk metadata from bytes.
 */
export declare function decodeSuperChunkMetadata(data: Uint8Array): SuperChunkMetadata;
/**
 * Encode a compaction index entry to bytes.
 */
export declare function encodeIndexEntry(entry: CompactionIndexEntry): Uint8Array;
/**
 * Decode a compaction index entry from bytes.
 */
export declare function decodeIndexEntry(data: Uint8Array): CompactionIndexEntry;
/**
 * Pack multiple blobs into a single super-chunk with header.
 *
 * Super-chunk format:
 * - Header (variable): JSON metadata followed by null byte
 * - Blob data: Concatenated blob data
 *
 * @param blobs - Blobs to pack
 * @returns Packed super-chunk data and metadata
 */
export declare function packSuperChunk(blobs: CompactionCandidate[]): {
    data: Uint8Array;
    metadata: SuperChunkMetadata;
    entries: CompactionIndexEntry[];
};
/**
 * Unpack a blob from a super-chunk.
 *
 * @param superChunkData - The full super-chunk data
 * @param entry - The index entry for the blob to extract
 * @returns The blob data
 */
export declare function unpackBlob(superChunkData: Uint8Array, entry: CompactionIndexEntry): Uint8Array;
/**
 * Manages blob chunking compaction for DO storage efficiency.
 *
 * Usage:
 * 1. Register small blobs as compaction candidates
 * 2. When enough candidates accumulate, trigger compaction
 * 3. Compaction packs small blobs into 2MB super-chunks
 * 4. Reading a compacted blob uses the index to locate it in a super-chunk
 *
 * @example
 * ```typescript
 * const compactor = new ChunkCompactor(storage, {
 *   compactionThreshold: 64 * 1024, // 64KB
 *   minBlobsForCompaction: 10,
 * })
 *
 * // Register small blobs for compaction
 * compactor.registerCandidate({ sha, type: 'blob', data })
 *
 * // Check if compaction should run
 * if (compactor.shouldCompact()) {
 *   const result = await compactor.compact()
 *   console.log(`Compacted ${result.blobsCompacted} blobs, saved ${result.rowOperationsSaved} operations`)
 * }
 *
 * // Read a potentially compacted blob
 * const data = await compactor.readBlob(sha)
 * ```
 */
export declare class ChunkCompactor {
    private storage;
    private config;
    private candidates;
    private indexCache;
    private superChunkCache;
    private _isCompacting;
    constructor(storage: CompactorStorage, config?: ChunkCompactorConfig);
    /**
     * Check if a blob is small enough to be a compaction candidate.
     */
    isCompactionCandidate(size: number): boolean;
    /**
     * Register a small blob as a compaction candidate.
     * Returns true if the blob was registered, false if it's too large.
     */
    registerCandidate(candidate: CompactionCandidate): boolean;
    /**
     * Remove a candidate from the pending compaction list.
     */
    removeCandidate(sha: string): boolean;
    /**
     * Get the number of pending compaction candidates.
     */
    get pendingCandidateCount(): number;
    /**
     * Get the total size of pending compaction candidates.
     */
    get pendingCandidateBytes(): number;
    /**
     * Check if compaction should be triggered based on current candidates.
     */
    shouldCompact(): boolean;
    /**
     * Check if the compactor is currently running a compaction.
     */
    get isCompacting(): boolean;
    /**
     * Run compaction on all pending candidates.
     *
     * Groups candidates into super-chunks that approach the target size,
     * writes them to storage, and updates the compaction index.
     *
     * @throws {Error} If compaction is already in progress
     */
    compact(): Promise<CompactionResult>;
    /**
     * Group candidates into chunks that approach the target size.
     */
    private groupCandidatesIntoChunks;
    /**
     * Check if a blob is stored in a super-chunk.
     */
    isCompacted(sha: string): Promise<boolean>;
    /**
     * Read a blob that may be stored in a super-chunk.
     *
     * @param sha - The blob SHA
     * @returns The blob data, or null if not found in super-chunks
     */
    readCompactedBlob(sha: string): Promise<Uint8Array | null>;
    /**
     * Delete a blob from its super-chunk.
     *
     * Note: This doesn't actually remove the data from the super-chunk immediately.
     * Instead, it removes the index entry so the blob becomes inaccessible.
     * The space will be reclaimed during the next full compaction.
     *
     * @param sha - The blob SHA to delete
     * @returns true if the blob was found and marked for deletion
     */
    deleteCompactedBlob(sha: string): Promise<boolean>;
    /**
     * Get compaction statistics.
     */
    getStats(): Promise<CompactionStats>;
    /**
     * Perform a full compaction that rewrites all super-chunks.
     *
     * This is useful for:
     * - Reclaiming space from deleted blobs
     * - Optimizing super-chunk sizes after many deletions
     * - Defragmenting storage
     *
     * @returns Compaction result
     * @throws {Error} If compaction is already in progress
     */
    fullCompaction(): Promise<CompactionResult>;
    /**
     * Load an index entry from storage into the cache.
     */
    private loadIndexEntry;
    /**
     * Clear all caches (useful for testing or memory management).
     */
    clearCaches(): void;
    /**
     * Get the current configuration.
     */
    getConfig(): Required<ChunkCompactorConfig>;
}
/**
 * Create a chunk compactor with the given storage backend.
 *
 * @param storage - Storage backend for reading/writing chunks
 * @param config - Optional configuration
 * @returns ChunkCompactor instance
 *
 * @example
 * ```typescript
 * import { createChunkCompactor } from 'gitx.do/storage'
 *
 * const compactor = createChunkCompactor(storage, {
 *   compactionThreshold: 64 * 1024,
 *   minBlobsForCompaction: 20,
 * })
 * ```
 */
export declare function createChunkCompactor(storage: CompactorStorage, config?: ChunkCompactorConfig): ChunkCompactor;
//# sourceMappingURL=chunk-compactor.d.ts.map