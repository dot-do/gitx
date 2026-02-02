/**
 * @fileoverview R2 Parquet Object Store
 *
 * Implements the CASBackend interface using R2 Parquet files as the
 * primary storage backend for git objects. All objects are stored as
 * VARIANT-encoded rows in append-only Parquet files on R2.
 *
 * Architecture:
 * - Write path: Objects buffered in memory -> WAL -> flushed as Parquet row groups to R2
 * - Read path: Bloom filter check -> exact SHA cache -> Parquet file scan
 * - Refs: Stored in a separate refs.parquet file, rewritten on update
 *
 * R2 Bucket: gitx-analytics (ANALYTICS_BUCKET binding)
 * Key format: {owner}/{repo}/objects/{uuid}.parquet
 *
 * Lifecycle Management:
 * - Compaction: ParquetStore.compact() merges small files, deletes old ones atomically
 * - Large objects (>1MB): Stored in gitx-objects bucket with storage mode 'r2'
 * - R2 lifecycle policies: See r2-lifecycle-policies.json for cleanup rules
 * - Orphan cleanup: 90-day retention via R2 lifecycle + GarbageCollector
 *
 * @module storage/parquet-store
 */
import type { ObjectType } from '../types/objects';
import type { CASBackend, StoredObjectResult } from './backend';
import { BloomCache } from './bloom-cache';
import type { SQLStorage } from './types';
import { type StorageMetrics } from './metrics';
/**
 * Event emitted after a successful flush of buffered objects to Parquet.
 * Consumers (e.g., Iceberg metadata generators) can react to this event
 * without ParquetStore needing to know about their existence.
 */
export interface FlushEvent {
    /** R2 key of the newly written Parquet file */
    parquetKey: string;
    /** Size of the Parquet file in bytes */
    fileSizeBytes: number;
    /** Number of records in the Parquet file */
    recordCount: number;
    /** R2 bucket reference for writing derived artifacts */
    r2: R2Bucket;
    /** Repository prefix in R2 */
    prefix: string;
}
/**
 * Callback invoked after each successful flush.
 * Errors thrown by the handler are logged but do not fail the flush.
 */
export type OnFlushHandler = (event: FlushEvent) => Promise<void>;
export interface ParquetStoreOptions {
    /** R2 bucket for Parquet files and large objects */
    r2: R2Bucket;
    /** SQLite storage for bloom filter and refs */
    sql: SQLStorage;
    /** Repository prefix in R2 (e.g., "owner/repo") */
    prefix: string;
    /** Flush threshold (number of objects) */
    flushThreshold?: number;
    /** Flush threshold (bytes) */
    flushBytesThreshold?: number;
    /** Compression codec */
    codec?: 'SNAPPY' | 'LZ4_RAW' | 'UNCOMPRESSED';
    /**
     * Optional callback invoked after each successful flush.
     * Use this to hook in Iceberg metadata generation or other post-flush logic.
     */
    onFlush?: OnFlushHandler;
    /**
     * Maximum buffer size in bytes before back-pressure triggers auto-flush.
     * This is a hard limit to prevent unbounded memory growth and OOM.
     * Default: 50MB
     */
    maxBufferBytes?: number;
    /**
     * Maximum number of objects in buffer before back-pressure triggers auto-flush.
     * This is a hard limit to prevent unbounded memory growth and OOM.
     * Default: 10000
     */
    maxBufferObjects?: number;
    /**
     * When true, verify bloom filter negative results by checking R2 directly.
     * This protects against bloom filter false negatives (which should be rare
     * but could cause missing object errors). If an object is found in R2 that
     * the bloom filter reported as absent, it will be added to the bloom filter
     * for self-healing.
     * @default false
     */
    verifyBloomNegatives?: boolean;
    /**
     * Optional metrics interface for observability.
     * If not provided, a no-op implementation is used (zero overhead).
     *
     * @example
     * ```typescript
     * import { ConsoleMetrics } from './metrics'
     * const store = new ParquetStore({
     *   r2, sql, prefix,
     *   metrics: new ConsoleMetrics()
     * })
     * ```
     */
    metrics?: StorageMetrics;
}
/**
 * R2 Parquet-backed CASBackend for git objects.
 *
 * Objects are written to append-only Parquet files on R2.
 * Reads use a bloom filter for fast existence checks, falling back
 * to R2 Parquet file scanning.
 */
export declare class ParquetStore implements CASBackend {
    private r2;
    private sql;
    private prefix;
    private bloomCache;
    private buffer;
    private bufferIndex;
    private bufferBytes;
    private flushThreshold;
    private flushBytesThreshold;
    private maxBufferBytes;
    private maxBufferObjects;
    private codec;
    private objectFileKeys;
    private tombstones;
    private initialized;
    private initPromise?;
    private onFlush;
    private _compactionNeeded;
    private verifyBloomNegatives;
    /** Track WAL entry IDs for current buffer to clear after flush */
    private walEntryIds;
    /**
     * Read-write lock for coordinating compaction with concurrent writes/reads.
     *
     * - putObject, getObject, hasObject, flush: Use read lock (multiple can run concurrently)
     * - compact: Uses write lock (exclusive access)
     *
     * This prevents the race condition where compact() could read stale buffer state
     * or delete Parquet files while other operations are reading from them.
     */
    private rwLock;
    /**
     * Mutex for serializing flush operations.
     *
     * While the rwLock allows multiple read operations (including flush) to run
     * concurrently, we need to ensure only one flush operation runs at a time.
     * Without this, concurrent flushes could:
     * - Both read the same buffer contents
     * - Both write overlapping Parquet files
     * - Race on clearing WAL entries
     */
    private flushMutex;
    /** Metrics interface for observability */
    private metrics;
    constructor(options: ParquetStoreOptions);
    /**
     * Initialize the store (bloom cache, discover existing Parquet files).
     */
    initialize(): Promise<void>;
    private _doInitialize;
    /**
     * Recover from interrupted compaction by checking the journal.
     *
     * If a journal entry exists with status 'written', the new compacted file
     * was successfully written to R2 but old files were not yet cleaned up.
     * We complete the cleanup (delete old source files).
     *
     * If a journal entry exists with status 'in_progress', the compaction was
     * interrupted before the new file was written. We roll back by deleting
     * the (possibly partial) target file and clearing the journal.
     */
    private recoverCompaction;
    /**
     * Recover un-flushed WAL entries into the in-memory buffer.
     *
     * Called during initialization to replay any buffered writes that were
     * persisted to WAL but not yet flushed to Parquet. This ensures durability
     * across DO restarts/crashes.
     *
     * Deduplicates by SHA to handle partial recovery scenarios where some
     * objects may have been successfully flushed but WAL wasn't cleared.
     */
    private recoverWAL;
    /**
     * List existing Parquet object files in R2.
     */
    private discoverObjectFiles;
    putObject(type: ObjectType, data: Uint8Array, path?: string): Promise<string>;
    getObject(sha: string): Promise<StoredObjectResult | null>;
    hasObject(sha: string): Promise<boolean>;
    /**
     * Internal getObject implementation that doesn't acquire the lock.
     * Used by hasObject to avoid nested lock acquisition.
     */
    private getObjectInternal;
    /**
     * Check if an object exists in R2 by scanning Parquet files.
     * Used as a fallback when bloom filter says absent but we want to verify.
     * Returns the object result if found, null otherwise.
     * Internal version that doesn't acquire the lock - must be called within a lock.
     */
    private checkR2ExistsInternal;
    deleteObject(sha: string): Promise<void>;
    /**
     * Flush buffered objects to a new Parquet file on R2.
     *
     * WAL entries are cleared ONLY after the Parquet file is successfully
     * written to R2. If the flush fails, WAL entries remain for recovery.
     *
     * Uses a mutex to prevent concurrent flush operations which could cause
     * race conditions (multiple flushes reading the same buffer, writing
     * overlapping files, or racing on WAL entry cleanup).
     */
    flush(): Promise<string | null>;
    /**
     * Compact multiple Parquet files into a single file.
     *
     * Reads all objects from existing Parquet files, excludes tombstoned SHAs,
     * deduplicates by SHA, and writes a single merged Parquet file.
     * Old files are deleted from R2 after the new file is written.
     *
     * Uses write lock for exclusive access - no other operations can run during compaction.
     * This prevents race conditions where:
     * - putObject could add objects to buffer while compaction reads it
     * - getObject could read from Parquet files being deleted
     * - flush could create new Parquet files during compaction
     *
     * @returns The key of the new compacted file, or null if no compaction needed
     */
    compact(): Promise<string | null>;
    /**
     * Read a specific object from a Parquet file.
     *
     * Uses hyparquet's parquetQuery with predicate pushdown on the SHA column
     * to efficiently locate the matching row without scanning the entire file.
     */
    private readObjectFromParquet;
    /**
     * Check whether compaction has been scheduled but not yet executed.
     */
    get compactionNeeded(): boolean;
    /**
     * Mark that compaction should be performed in the next alarm cycle.
     *
     * This does NOT run compaction inline. The caller (typically the DO)
     * is responsible for setting an alarm via `state.storage.setAlarm()`
     * after calling this method.
     *
     * Compaction is only meaningful when there are multiple Parquet files
     * to merge, so this is a no-op if fewer than 2 files exist.
     *
     * @returns true if compaction was scheduled, false if not needed
     */
    scheduleCompaction(): boolean;
    /**
     * Run compaction if it has been scheduled via `scheduleCompaction()`.
     *
     * Called by the DO alarm handler. Resets the compaction flag regardless
     * of outcome so alarms don't loop indefinitely.
     *
     * @returns The key of the new compacted file, or null if no compaction was performed
     */
    runCompactionIfNeeded(): Promise<string | null>;
    /**
     * Get store statistics.
     */
    getStats(): {
        bufferedObjects: number;
        bufferedBytes: number;
        parquetFiles: number;
        bloom: ReturnType<BloomCache['getStats']>;
    };
    /** Access bloom cache for external use */
    getBloomCache(): BloomCache;
}
//# sourceMappingURL=parquet-store.d.ts.map