/**
 * @fileoverview Push Transaction / Unit-of-Work for Atomic Push Operations
 *
 * Provides a lightweight saga pattern that ensures push operations (writing
 * objects + updating refs) have proper transaction boundaries.
 *
 * The key insight is that orphaned R2/SQLite objects are harmless because they
 * are content-addressed and can be garbage-collected later. The critical
 * invariant is: **refs must never point to objects that don't exist**.
 *
 * Transaction phases:
 * 1. **Buffer** - Objects are buffered in memory during packfile unpacking
 * 2. **Flush** - Objects are written to storage (R2/SQLite). If this fails,
 *    no refs are updated and the push fails cleanly.
 * 3. **Update Refs** - Refs are updated in SQLite within a transaction.
 *    If this fails, orphaned objects may exist but are harmless.
 * 4. **Cleanup** - On ref update failure, orphaned object SHAs are recorded
 *    for eventual garbage collection.
 *
 * @module storage/push-transaction
 */
import type { ObjectType } from '../types/objects';
import type { DurableObjectStorage } from './types';
import type { RefLog, RefLogEntry } from '../delta/ref-log';
import type { BranchProtectionRule } from '../do/branch-protection';
/** A buffered object awaiting flush during a push transaction. */
export interface BufferedPushObject {
    sha: string;
    type: ObjectType;
    data: Uint8Array;
}
/** A ref update command within a push transaction. */
export interface RefUpdateCommand {
    refName: string;
    oldSha: string;
    newSha: string;
}
/** Result of a single ref update. */
export interface RefUpdateResult {
    refName: string;
    success: boolean;
    error?: string;
}
/** Overall result of a push transaction. */
export interface PushTransactionResult {
    success: boolean;
    refResults: RefUpdateResult[];
    /** SHAs of objects that were written but whose ref updates failed (orphaned). */
    orphanedShas: string[];
}
/**
 * Delegate interface for object storage operations.
 *
 * This abstracts over SqliteObjectStore / ParquetStore so PushTransaction
 * doesn't need to know about the concrete storage implementation.
 */
export interface ObjectStorageDelegate {
    /** Store an object and return its SHA. */
    putObject(type: ObjectType, data: Uint8Array): Promise<string>;
    /** Check if an object exists. */
    hasObject(sha: string): Promise<boolean>;
}
/**
 * Optional delegate for scheduling cleanup of orphaned objects.
 * If not provided, orphaned SHAs are logged but not cleaned up.
 */
export interface OrphanCleanupDelegate {
    /** Schedule cleanup of orphaned objects (e.g., via DO alarm). */
    scheduleOrphanCleanup(shas: string[]): void;
}
/**
 * Options for configuring PushTransaction behavior.
 */
export interface PushTransactionOptions {
    /** Optional delegate for scheduling cleanup of orphaned objects. */
    orphanCleanup?: OrphanCleanupDelegate;
    /** Optional RefLog for atomic logging of ref changes. */
    refLog?: RefLog;
    /** Optional branch protection rules to enforce during ref updates. */
    branchProtectionRules?: BranchProtectionRule[];
    /**
     * Maximum buffer size in bytes. When the buffer exceeds this limit,
     * bufferObject() will throw a BufferOverflowError.
     *
     * Default: Infinity (no limit)
     */
    maxBufferBytes?: number;
}
/**
 * Error thrown when the buffer size limit is exceeded.
 */
export declare class BufferOverflowError extends Error {
    /** Current buffer size in bytes */
    readonly currentBytes: number;
    /** Maximum allowed buffer size in bytes */
    readonly maxBytes: number;
    /** Size of the object that triggered the overflow */
    readonly objectBytes: number;
    constructor(currentBytes: number, maxBytes: number, objectBytes: number);
}
/** Transaction phase for tracking progress. */
export type TransactionPhase = 'idle' | 'buffering' | 'flushing' | 'updating_refs' | 'completed' | 'failed';
/**
 * A unit-of-work for push operations that coordinates object writes
 * and ref updates with proper failure semantics.
 *
 * Usage:
 * ```typescript
 * const tx = new PushTransaction(storage, objectStore)
 * tx.bufferObject(sha, 'commit', data)
 * tx.bufferObject(sha2, 'tree', data2)
 * const result = await tx.execute(commands)
 * ```
 */
export declare class PushTransaction {
    private storage;
    private objectStore;
    private orphanCleanup?;
    private refLog?;
    private branchProtectionRules;
    private maxBufferBytes;
    private buffer;
    private flushedShas;
    private _phase;
    /** RefLog entries staged during transaction, rolled back on failure */
    private pendingRefLogEntries;
    /**
     * Create a new PushTransaction.
     *
     * @param storage - Durable Object storage for SQLite operations
     * @param objectStore - Delegate for object storage operations
     * @param optionsOrCleanup - Either PushTransactionOptions or legacy OrphanCleanupDelegate
     */
    constructor(storage: DurableObjectStorage, objectStore: ObjectStorageDelegate, optionsOrCleanup?: PushTransactionOptions | OrphanCleanupDelegate);
    /** Current transaction phase. */
    get phase(): TransactionPhase;
    /** Number of buffered objects. */
    get bufferedCount(): number;
    /** Total buffered bytes. */
    get bufferedBytes(): number;
    /**
     * Buffer an object for writing during the flush phase.
     *
     * Objects are held in memory until `execute()` is called.
     * Duplicate SHAs are silently deduplicated.
     *
     * @throws {BufferOverflowError} If adding the object would exceed maxBufferBytes
     */
    bufferObject(sha: string, type: ObjectType, data: Uint8Array): void;
    /**
     * Execute the push transaction: flush objects, then update refs.
     *
     * This method orchestrates the full transaction lifecycle:
     * 1. Flush all buffered objects to storage
     * 2. Update refs in SQLite within a SINGLE transaction (atomic)
     * 3. On failure, the entire transaction is rolled back
     * 4. On success, schedule cleanup of any orphaned objects
     *
     * The key invariant is: **all ref updates succeed or none do**.
     * This ensures push operations are truly atomic.
     *
     * @param commands - Ref update commands to apply after objects are flushed
     * @returns Transaction result with per-ref outcomes and orphaned SHAs
     */
    execute(commands: RefUpdateCommand[]): Promise<PushTransactionResult>;
    /**
     * Flush all buffered objects to the object store.
     * Objects are content-addressed, so writing them is idempotent.
     */
    private flushObjects;
    /**
     * Identify SHAs that were flushed but whose ref updates all failed.
     *
     * A SHA is considered orphaned only if it was part of a failed ref update
     * and no successful ref update also references it. This is conservative:
     * some objects may be reachable from other refs but we don't walk the
     * full object graph here. GC will handle the rest.
     */
    private identifyOrphanedShas;
    /**
     * Roll back RefLog entries that were staged during this transaction.
     * Called when the SQLite transaction fails to ensure RefLog stays consistent.
     */
    private rollbackRefLogEntries;
    /**
     * Get the RefLog entries that were committed as part of this transaction.
     * Only populated after a successful execute() call.
     */
    get refLogEntries(): ReadonlyArray<RefLogEntry>;
}
//# sourceMappingURL=push-transaction.d.ts.map