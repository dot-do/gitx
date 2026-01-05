import { DurableObjectStorage } from './schema';
/**
 * WAL Operation Types
 */
export type WALOperationType = 'PUT' | 'DELETE' | 'UPDATE' | 'BATCH' | 'TX_BEGIN' | 'TX_COMMIT' | 'TX_ROLLBACK';
/**
 * Transaction States
 */
export type TransactionState = 'ACTIVE' | 'COMMITTED' | 'ROLLED_BACK';
/**
 * WAL Entry representing a single logged operation
 */
export interface WALEntry {
    id: number;
    operation: WALOperationType;
    payload: Uint8Array;
    transactionId: string | null;
    createdAt: number;
    flushed: boolean;
}
/**
 * Transaction metadata
 */
export interface Transaction {
    id: string;
    state: TransactionState;
    startedAt: number;
    operations: number[];
}
/**
 * Checkpoint representing a consistent point in the WAL
 */
export interface Checkpoint {
    id: number;
    walPosition: number;
    createdAt: number;
    metadata: string | null;
}
/**
 * WALManager - Write-Ahead Log Manager for transaction durability
 *
 * Provides durability guarantees by logging all operations before they are applied.
 * Supports transactions with begin/commit/rollback semantics and checkpoint management.
 */
export declare class WALManager {
    private storage;
    private transactions;
    private currentWalPosition;
    constructor(storage: DurableObjectStorage);
    /**
     * Append an operation to the WAL
     * @param operation The type of operation
     * @param payload The operation payload as binary data
     * @param transactionId Optional transaction ID to associate with this operation
     * @returns The ID of the appended WAL entry
     */
    append(operation: WALOperationType, payload: Uint8Array, transactionId?: string): Promise<number>;
    /**
     * Flush all unflushed WAL entries
     * @returns The number of entries flushed
     */
    flush(): Promise<number>;
    /**
     * Recover unflushed WAL entries for replay
     * @returns Array of unflushed WAL entries in order
     */
    recover(): Promise<WALEntry[]>;
    /**
     * Begin a new transaction
     * @returns The transaction ID
     */
    beginTransaction(): Promise<string>;
    /**
     * Commit a transaction
     * @param transactionId The transaction ID to commit
     */
    commitTransaction(transactionId: string): Promise<void>;
    /**
     * Rollback a transaction
     * @param transactionId The transaction ID to rollback
     */
    rollbackTransaction(transactionId: string): Promise<void>;
    /**
     * Get the state of a transaction
     * @param transactionId The transaction ID
     * @returns The transaction state or null if not found
     */
    getTransactionState(transactionId: string): Promise<TransactionState | null>;
    /**
     * Create a checkpoint at the current WAL position
     * @param metadata Optional metadata to associate with the checkpoint
     * @returns The created checkpoint
     */
    createCheckpoint(metadata?: string): Promise<Checkpoint>;
    /**
     * Get the most recent checkpoint
     * @returns The last checkpoint or null if none exist
     */
    getLastCheckpoint(): Promise<Checkpoint | null>;
    /**
     * Truncate WAL entries before a checkpoint
     * @param checkpoint The checkpoint to truncate before
     */
    truncateBeforeCheckpoint(checkpoint: Checkpoint): Promise<void>;
    /**
     * Get the count of unflushed WAL entries
     * @returns The number of unflushed entries
     */
    getUnflushedCount(): Promise<number>;
}
//# sourceMappingURL=wal.d.ts.map