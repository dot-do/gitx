/**
 * @fileoverview Git Garbage Collection
 *
 * Implements garbage collection for unreferenced Git objects. GC removes objects
 * that are not reachable from any ref (branch, tag, HEAD) and are older than a
 * configurable grace period.
 *
 * Key features:
 * - Walks all objects reachable from refs (commits, trees, blobs, tags)
 * - Identifies unreferenced objects
 * - Respects a grace period to avoid deleting objects being written
 * - Concurrent-safe: marks objects before deletion to handle races
 *
 * R2 Lifecycle Integration:
 * - GC works in conjunction with R2 lifecycle policies defined in r2-lifecycle-policies.json
 * - Objects deleted by GC are removed from bloom cache and marked as tombstones
 * - R2 lifecycle policies provide a secondary safety net with 90-day retention
 * - Recommended: Run GC weekly with the default 14-day grace period
 *
 * @module storage/gc
 *
 * @example
 * ```typescript
 * import { GarbageCollector, createGCForParquetStore } from './storage/gc'
 *
 * const gc = createGCForParquetStore(parquetStore, refStore)
 * const result = await gc.collect()
 * console.log(`Deleted ${result.deletedCount} objects, freed ${result.freedBytes} bytes`)
 * ```
 */
import type { ObjectType } from '../types/objects';
import type { Ref } from '../refs/storage';
/**
 * Interface for object storage operations needed by GC.
 *
 * @description
 * This is a minimal interface that ParquetStore and other backends can implement.
 * GC only needs to read objects, check existence, delete objects, and list all objects.
 */
export interface GCObjectStore {
    /**
     * Get an object by SHA, returning its type and data.
     */
    getObject(sha: string): Promise<{
        type: ObjectType;
        content: Uint8Array;
    } | null>;
    /**
     * Check if an object exists.
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Delete an object by SHA.
     */
    deleteObject(sha: string): Promise<void>;
    /**
     * List all object SHAs with their metadata.
     * Used to identify candidates for GC.
     */
    listAllObjects(): Promise<Array<{
        sha: string;
        type: ObjectType;
        size: number;
        createdAt?: number;
    }>>;
}
/**
 * Interface for ref storage operations needed by GC.
 *
 * @description
 * GC needs to list all refs to find reachable objects.
 */
export interface GCRefStore {
    /**
     * List all refs (branches, tags, HEAD).
     */
    listRefs(prefix?: string): Ref[] | Promise<Ref[]>;
}
/**
 * Configuration options for garbage collection.
 */
export interface GCOptions {
    /**
     * Grace period in milliseconds. Objects younger than this are not deleted
     * even if unreferenced, to handle objects being written concurrently.
     * @default 1209600000 (14 days = 2 weeks)
     */
    gracePeriodMs?: number;
    /**
     * Maximum number of objects to delete in a single GC run.
     * Useful for limiting the impact of GC on performance.
     * @default Infinity (no limit)
     */
    maxDeleteCount?: number;
    /**
     * Dry run mode - identify unreferenced objects without deleting.
     * @default false
     */
    dryRun?: boolean;
    /**
     * Logger for GC operations.
     */
    logger?: GCLogger;
}
/**
 * Logger interface for GC operations.
 */
export interface GCLogger {
    debug?(message: string, ...args: unknown[]): void;
    info?(message: string, ...args: unknown[]): void;
    warn?(message: string, ...args: unknown[]): void;
    error?(message: string, ...args: unknown[]): void;
}
/**
 * Result of a garbage collection run.
 */
export interface GCResult {
    /** Number of objects deleted */
    deletedCount: number;
    /** Total bytes freed by deletion */
    freedBytes: number;
    /** Number of unreferenced objects found */
    unreferencedCount: number;
    /** Number of objects skipped due to grace period */
    skippedGracePeriod: number;
    /** Number of objects skipped due to maxDeleteCount limit */
    skippedMaxLimit: number;
    /** Total objects scanned */
    totalScanned: number;
    /** Total reachable objects */
    reachableCount: number;
    /** Duration of GC in milliseconds */
    durationMs: number;
    /** Whether this was a dry run */
    dryRun: boolean;
}
/**
 * Git garbage collector for unreferenced objects.
 *
 * @description
 * The garbage collector identifies objects that are not reachable from any ref
 * and removes them from storage. It performs a mark-and-sweep algorithm:
 *
 * 1. **Mark phase**: Walk all refs and mark objects reachable from each ref.
 *    This includes walking commits (to trees and parents), trees (to blobs and
 *    subtrees), and tags (to tagged objects).
 *
 * 2. **Sweep phase**: Iterate over all objects in storage. For each object not
 *    marked as reachable, check if it's older than the grace period. If so,
 *    delete it.
 *
 * The grace period (default: 2 weeks) ensures objects that are being written
 * concurrently are not accidentally deleted. This handles scenarios like:
 * - Push in progress: Objects written but ref not yet updated
 * - Concurrent operations: Multiple writers operating simultaneously
 *
 * @example
 * ```typescript
 * const gc = new GarbageCollector(objectStore, refStore, {
 *   gracePeriodMs: 7 * 24 * 60 * 60 * 1000, // 1 week
 *   logger: console
 * })
 *
 * // Dry run first
 * const preview = await gc.collect({ dryRun: true })
 * console.log(`Would delete ${preview.unreferencedCount} objects`)
 *
 * // Actually delete
 * const result = await gc.collect()
 * console.log(`Deleted ${result.deletedCount} objects`)
 * ```
 */
export declare class GarbageCollector {
    private objectStore;
    private refStore;
    private options;
    private logger;
    /**
     * Create a new GarbageCollector.
     *
     * @param objectStore - Object storage backend
     * @param refStore - Reference storage backend
     * @param options - GC configuration options
     */
    constructor(objectStore: GCObjectStore, refStore: GCRefStore, options?: GCOptions);
    /**
     * Log a message if logger is configured.
     */
    private log;
    /**
     * Run garbage collection.
     *
     * @description
     * Performs a complete mark-and-sweep garbage collection pass.
     * Returns detailed statistics about the GC run.
     *
     * @param options - Runtime options that override constructor options
     * @returns GC result statistics
     */
    collect(options?: Partial<GCOptions>): Promise<GCResult>;
    /**
     * Mark all objects reachable from refs.
     *
     * @description
     * Walks from each ref's target object and recursively marks all reachable objects.
     * Handles commits (walking tree and parents), trees (walking entries), and tags
     * (walking tagged object).
     *
     * @returns Set of reachable SHA hashes
     */
    private markReachable;
    /**
     * Walk an object and all objects it references.
     *
     * @description
     * Recursively walks the object graph starting from the given SHA.
     * Marks all visited objects as reachable.
     *
     * @param sha - SHA of the object to walk from
     * @param reachable - Set to add reachable SHAs to
     * @param visited - Set of already-visited SHAs (to prevent cycles)
     */
    private walkObject;
    /**
     * Walk a commit object and its references.
     *
     * @description
     * Commits reference:
     * - A tree (the snapshot)
     * - Parent commits (0 or more)
     *
     * @param sha - SHA of the commit
     * @param content - Raw commit content
     * @param reachable - Set to add reachable SHAs to
     * @param visited - Set of already-visited SHAs
     */
    private walkCommit;
    /**
     * Walk a tree object and its references.
     *
     * @description
     * Trees reference blobs (files) and other trees (subdirectories).
     * Tree entry format: "{mode} {name}\0{20-byte-sha}"
     *
     * @param sha - SHA of the tree
     * @param content - Raw tree content
     * @param reachable - Set to add reachable SHAs to
     * @param visited - Set of already-visited SHAs
     */
    private walkTree;
    /**
     * Walk a tag object and its references.
     *
     * @description
     * Tags reference a single object (usually a commit, but can be any type).
     *
     * @param sha - SHA of the tag
     * @param content - Raw tag content
     * @param reachable - Set to add reachable SHAs to
     * @param visited - Set of already-visited SHAs
     */
    private walkTag;
    /**
     * Get a preview of what would be collected without actually deleting.
     *
     * @description
     * Convenience method that runs GC in dry-run mode.
     *
     * @param options - Runtime options (gracePeriodMs, maxDeleteCount)
     * @returns GC result preview
     */
    preview(options?: Omit<GCOptions, 'dryRun'>): Promise<GCResult>;
}
/**
 * Adapter to make ParquetStore compatible with GCObjectStore interface.
 *
 * @description
 * ParquetStore doesn't have a listAllObjects method, so this adapter
 * reads all Parquet files and extracts object metadata.
 */
export declare class ParquetStoreGCAdapter implements GCObjectStore {
    private store;
    private r2;
    private prefix;
    private sql;
    constructor(store: {
        getObject(sha: string): Promise<{
            type: ObjectType;
            content: Uint8Array;
        } | null>;
        hasObject(sha: string): Promise<boolean>;
        deleteObject(sha: string): Promise<void>;
    }, r2: R2Bucket, sql: {
        sql: {
            exec: (...args: unknown[]) => {
                toArray(): unknown[];
            };
        };
    }, prefix: string);
    getObject(sha: string): Promise<{
        type: ObjectType;
        content: Uint8Array;
    } | null>;
    hasObject(sha: string): Promise<boolean>;
    deleteObject(sha: string): Promise<void>;
    /**
     * List all objects by querying the bloom filter cache.
     *
     * @description
     * The bloom cache SQLite table stores SHA, type, and size for all objects.
     * We use this as the source of truth for listing objects.
     */
    listAllObjects(): Promise<Array<{
        sha: string;
        type: ObjectType;
        size: number;
        createdAt?: number;
    }>>;
    /**
     * Fallback method to list objects by scanning Parquet files.
     */
    private listObjectsFromParquet;
}
/**
 * Create a GarbageCollector for a ParquetStore.
 *
 * @description
 * Factory function that creates a properly configured GarbageCollector
 * for use with ParquetStore and ParquetRefStore.
 *
 * @param store - ParquetStore instance
 * @param refStore - ParquetRefStore instance
 * @param r2 - R2 bucket reference
 * @param sql - SQLite storage reference
 * @param prefix - Repository prefix in R2
 * @param options - GC configuration options
 * @returns Configured GarbageCollector
 *
 * @example
 * ```typescript
 * const gc = createGCForParquetStore(
 *   parquetStore,
 *   refStore,
 *   r2Bucket,
 *   sqlStorage,
 *   'owner/repo',
 *   { gracePeriodMs: 7 * 24 * 60 * 60 * 1000 }
 * )
 * const result = await gc.collect()
 * ```
 */
export declare function createGCForParquetStore(store: {
    getObject(sha: string): Promise<{
        type: ObjectType;
        content: Uint8Array;
    } | null>;
    hasObject(sha: string): Promise<boolean>;
    deleteObject(sha: string): Promise<void>;
}, refStore: GCRefStore, r2: R2Bucket, sql: {
    sql: {
        exec: (...args: unknown[]) => {
            toArray(): unknown[];
        };
    };
}, prefix: string, options?: GCOptions): GarbageCollector;
//# sourceMappingURL=gc.d.ts.map