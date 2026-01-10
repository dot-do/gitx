/**
 * @fileoverview Write-Ahead Log (WAL) Manager for Transaction Durability
 *
 * This module provides a Write-Ahead Log implementation for ensuring durability
 * and crash recovery in the Git object storage. All operations are logged before
 * being applied, allowing recovery after failures.
 *
 * **Key Features**:
 * - Transaction support with begin/commit/rollback semantics
 * - Checkpoint creation for efficient recovery
 * - WAL truncation after successful checkpoints
 * - Unflushed entry recovery for crash recovery
 *
 * @module durable-object/wal
 *
 * @example
 * ```typescript
 * import { WALManager } from './durable-object/wal'
 *
 * const wal = new WALManager(storage)
 *
 * // Simple operation logging
 * const entryId = await wal.append('PUT', payload)
 *
 * // Transaction support
 * const txId = await wal.beginTransaction()
 * await wal.append('PUT', payload1, txId)
 * await wal.append('PUT', payload2, txId)
 * await wal.commitTransaction(txId)
 *
 * // Create checkpoint for recovery point
 * const checkpoint = await wal.createCheckpoint()
 * ```
 */
import { DurableObjectStorage } from './schema';
/**
 * Types of operations that can be logged to the WAL.
 *
 * @description
 * - `PUT`: Object creation or update
 * - `DELETE`: Object deletion
 * - `UPDATE`: Object modification
 * - `BATCH`: Multiple operations grouped together
 * - `TX_BEGIN`: Transaction start marker
 * - `TX_COMMIT`: Transaction commit marker
 * - `TX_ROLLBACK`: Transaction rollback marker
 */
export type WALOperationType = 'PUT' | 'DELETE' | 'UPDATE' | 'BATCH' | 'TX_BEGIN' | 'TX_COMMIT' | 'TX_ROLLBACK';
/**
 * Possible states for a transaction.
 *
 * @description
 * - `ACTIVE`: Transaction is in progress
 * - `COMMITTED`: Transaction has been committed successfully
 * - `ROLLED_BACK`: Transaction has been rolled back
 */
export type TransactionState = 'ACTIVE' | 'COMMITTED' | 'ROLLED_BACK';
/**
 * A single entry in the Write-Ahead Log.
 *
 * @description
 * Represents one logged operation with its metadata.
 * Entries are ordered by ID for replay during recovery.
 *
 * @example
 * ```typescript
 * const entry: WALEntry = {
 *   id: 42,
 *   operation: 'PUT',
 *   payload: new Uint8Array([...]),
 *   transactionId: 'tx-abc123',
 *   createdAt: 1704067200000,
 *   flushed: false
 * }
 * ```
 */
export interface WALEntry {
    /** Unique sequential ID for ordering */
    id: number;
    /** Type of operation logged */
    operation: WALOperationType;
    /** Binary payload containing operation details */
    payload: Uint8Array;
    /** Transaction ID if part of a transaction, null otherwise */
    transactionId: string | null;
    /** Unix timestamp (milliseconds) when entry was created */
    createdAt: number;
    /** Whether this entry has been flushed (persisted durably) */
    flushed: boolean;
}
/**
 * Transaction metadata tracking state and operations.
 *
 * @description
 * Tracks the state of a transaction and all operations performed within it.
 * Used for commit/rollback logic and recovery.
 *
 * @example
 * ```typescript
 * const tx: Transaction = {
 *   id: 'tx-abc123',
 *   state: 'ACTIVE',
 *   startedAt: 1704067200000,
 *   operations: [42, 43, 44]  // WAL entry IDs
 * }
 * ```
 */
export interface Transaction {
    /** Unique transaction identifier */
    id: string;
    /** Current state of the transaction */
    state: TransactionState;
    /** Unix timestamp (milliseconds) when transaction started */
    startedAt: number;
    /** Array of WAL entry IDs belonging to this transaction */
    operations: number[];
}
/**
 * A checkpoint representing a consistent point in the WAL.
 *
 * @description
 * Checkpoints mark points where all prior operations have been
 * successfully applied. They enable efficient recovery by allowing
 * truncation of old WAL entries.
 *
 * @example
 * ```typescript
 * const checkpoint: Checkpoint = {
 *   id: 5,
 *   walPosition: 150,  // All entries up to 150 are committed
 *   createdAt: 1704067200000,
 *   metadata: 'Daily checkpoint'
 * }
 * ```
 */
export interface Checkpoint {
    /** Unique checkpoint ID */
    id: number;
    /** WAL position (entry ID) at checkpoint creation */
    walPosition: number;
    /** Unix timestamp (milliseconds) when checkpoint was created */
    createdAt: number;
    /** Optional descriptive metadata */
    metadata: string | null;
}
/**
 * Write-Ahead Log Manager for transaction durability.
 *
 * @description
 * Provides durability guarantees by logging all operations before they are applied.
 * Supports transactions with begin/commit/rollback semantics and checkpoint management.
 *
 * **Usage Pattern**:
 * 1. Log operations using `append()` before applying them
 * 2. Use transactions for atomic multi-operation changes
 * 3. Create checkpoints periodically for efficient recovery
 * 4. Truncate WAL after successful checkpoints
 *
 * @example
 * ```typescript
 * const wal = new WALManager(storage)
 *
 * // Single operation
 * const payload = new TextEncoder().encode(JSON.stringify({ sha: 'abc123' }))
 * const id = await wal.append('PUT', payload)
 *
 * // Transaction
 * const txId = await wal.beginTransaction()
 * try {
 *   await wal.append('PUT', payload1, txId)
 *   await wal.append('PUT', payload2, txId)
 *   await wal.commitTransaction(txId)
 * } catch (e) {
 *   await wal.rollbackTransaction(txId)
 *   throw e
 * }
 *
 * // Checkpoint and cleanup
 * const checkpoint = await wal.createCheckpoint()
 * await wal.truncateBeforeCheckpoint(checkpoint)
 * ```
 */
export declare class WALManager {
    /** Durable Object storage interface */
    private storage;
    /** In-memory transaction tracking */
    private transactions;
    /** Current WAL position for entry ID assignment */
    private currentWalPosition;
    /**
     * Create a new WALManager.
     *
     * @param storage - Durable Object storage interface with SQL support
     */
    constructor(storage: DurableObjectStorage);
    /**
     * Append an operation to the WAL.
     *
     * @description
     * Logs an operation to the WAL before it is applied. Operations can
     * optionally be associated with a transaction for atomic commit/rollback.
     *
     * @param operation - The type of operation being logged
     * @param payload - Binary data describing the operation (usually JSON-encoded)
     * @param transactionId - Optional transaction ID to associate with this operation
     * @returns The ID of the appended WAL entry
     *
     * @example
     * ```typescript
     * // Simple append
     * const payload = new TextEncoder().encode(JSON.stringify({
     *   sha: 'abc123',
     *   type: 'blob',
     *   timestamp: Date.now()
     * }))
     * const entryId = await wal.append('PUT', payload)
     *
     * // Append within transaction
     * const txId = await wal.beginTransaction()
     * await wal.append('PUT', payload, txId)
     * ```
     */
    append(operation: WALOperationType, payload: Uint8Array, transactionId?: string): Promise<number>;
    /**
     * Flush all unflushed WAL entries.
     *
     * @description
     * Marks all unflushed entries as flushed, indicating they have been
     * durably persisted. This is typically called before creating a checkpoint.
     *
     * @returns The number of entries that were flushed
     *
     * @example
     * ```typescript
     * const count = await wal.flush()
     * console.log(`Flushed ${count} entries`)
     * ```
     */
    flush(): Promise<number>;
    /**
     * Recover unflushed WAL entries for replay.
     *
     * @description
     * Returns all unflushed WAL entries in order for replay during
     * crash recovery. Entries should be replayed in order by ID.
     *
     * @returns Array of unflushed WAL entries sorted by ID
     *
     * @example
     * ```typescript
     * const entries = await wal.recover()
     * for (const entry of entries) {
     *   console.log(`Replaying ${entry.operation} ${entry.id}`)
     *   // Apply the operation...
     * }
     * ```
     */
    recover(): Promise<WALEntry[]>;
    /**
     * Begin a new transaction.
     *
     * @description
     * Starts a new transaction and returns its ID. Operations appended
     * with this transaction ID will be atomically committed or rolled back.
     *
     * @returns The unique transaction ID
     *
     * @example
     * ```typescript
     * const txId = await wal.beginTransaction()
     * try {
     *   await wal.append('PUT', payload1, txId)
     *   await wal.append('DELETE', payload2, txId)
     *   await wal.commitTransaction(txId)
     * } catch (e) {
     *   await wal.rollbackTransaction(txId)
     * }
     * ```
     */
    beginTransaction(): Promise<string>;
    /**
     * Commit a transaction.
     *
     * @description
     * Commits all operations in the transaction, making them permanent.
     * After commit, the transaction cannot be rolled back.
     *
     * @param transactionId - The transaction ID to commit
     * @throws Error if transaction not found or not active
     *
     * @example
     * ```typescript
     * const txId = await wal.beginTransaction()
     * await wal.append('PUT', payload, txId)
     * await wal.commitTransaction(txId)
     * // Transaction is now committed
     * ```
     */
    commitTransaction(transactionId: string): Promise<void>;
    /**
     * Rollback a transaction.
     *
     * @description
     * Rolls back all operations in the transaction, undoing their effects.
     * After rollback, the transaction is marked as rolled back.
     *
     * @param transactionId - The transaction ID to rollback
     * @throws Error if transaction not found or not active
     *
     * @example
     * ```typescript
     * const txId = await wal.beginTransaction()
     * try {
     *   await wal.append('PUT', payload, txId)
     *   throw new Error('Something went wrong')
     * } catch (e) {
     *   await wal.rollbackTransaction(txId)
     *   // All operations in transaction are undone
     * }
     * ```
     */
    rollbackTransaction(transactionId: string): Promise<void>;
    /**
     * Get the state of a transaction.
     *
     * @description
     * Returns the current state of a transaction, checking both in-memory
     * cache and persistent storage.
     *
     * @param transactionId - The transaction ID to check
     * @returns Transaction state or null if not found
     *
     * @example
     * ```typescript
     * const state = await wal.getTransactionState(txId)
     * if (state === 'COMMITTED') {
     *   console.log('Transaction was committed')
     * }
     * ```
     */
    getTransactionState(transactionId: string): Promise<TransactionState | null>;
    /**
     * Create a checkpoint at the current WAL position.
     *
     * @description
     * Creates a checkpoint marking a consistent point where all prior
     * operations have been successfully applied. Flushes pending entries first.
     *
     * @param metadata - Optional descriptive metadata for the checkpoint
     * @returns The created checkpoint
     *
     * @example
     * ```typescript
     * // Create checkpoint after batch of operations
     * const checkpoint = await wal.createCheckpoint('Post-push checkpoint')
     * console.log(`Checkpoint at position ${checkpoint.walPosition}`)
     * ```
     */
    createCheckpoint(metadata?: string): Promise<Checkpoint>;
    /**
     * Get the most recent checkpoint.
     *
     * @description
     * Returns the last checkpoint created, or null if none exist.
     * Useful for determining where to start recovery.
     *
     * @returns The last checkpoint or null
     *
     * @example
     * ```typescript
     * const lastCheckpoint = await wal.getLastCheckpoint()
     * if (lastCheckpoint) {
     *   console.log(`Last checkpoint at position ${lastCheckpoint.walPosition}`)
     * }
     * ```
     */
    getLastCheckpoint(): Promise<Checkpoint | null>;
    /**
     * Truncate WAL entries before a checkpoint.
     *
     * @description
     * Removes all WAL entries before (and including) the checkpoint position
     * that have been flushed. This reclaims space after a successful checkpoint.
     *
     * **Note**: Only truncates flushed entries to avoid data loss.
     *
     * @param checkpoint - The checkpoint to truncate before
     *
     * @example
     * ```typescript
     * const checkpoint = await wal.createCheckpoint()
     * // After verifying all operations are applied...
     * await wal.truncateBeforeCheckpoint(checkpoint)
     * ```
     */
    truncateBeforeCheckpoint(checkpoint: Checkpoint): Promise<void>;
    /**
     * Get the count of unflushed WAL entries.
     *
     * @description
     * Returns the number of WAL entries that have not yet been flushed.
     * Useful for monitoring WAL growth and deciding when to flush.
     *
     * @returns Number of unflushed entries
     *
     * @example
     * ```typescript
     * const count = await wal.getUnflushedCount()
     * if (count > 1000) {
     *   await wal.flush()
     * }
     * ```
     */
    getUnflushedCount(): Promise<number>;
}
//# sourceMappingURL=wal.d.ts.map