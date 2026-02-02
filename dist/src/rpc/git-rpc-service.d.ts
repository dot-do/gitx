/**
 * @fileoverview Git RPC Service Mode for Heavy Operations
 *
 * This module provides an RPC service mode for handling heavy git operations
 * (clone, fetch, push) as async operations with:
 * - Operation tracking with unique IDs
 * - Progress reporting
 * - Cancellation support
 * - Result streaming/retrieval
 *
 * @module rpc/git-rpc-service
 *
 * @example
 * ```typescript
 * import { GitRPCService } from 'gitx.do/rpc'
 *
 * const service = new GitRPCService({ storage, r2 })
 *
 * // Start a clone operation
 * const { operationId } = await service.startClone({
 *   remote: 'https://github.com/example/repo.git',
 *   branch: 'main',
 * })
 *
 * // Poll for progress
 * const status = await service.getStatus(operationId)
 * console.log(`Progress: ${status.progress?.percentage}%`)
 *
 * // Get final result
 * const result = await service.getResult(operationId)
 * ```
 */
/**
 * Operation types supported by the RPC service.
 */
export declare enum OperationType {
    CLONE = "clone",
    FETCH = "fetch",
    PUSH = "push"
}
/**
 * Operation state machine states.
 */
export declare enum OperationState {
    PENDING = "pending",
    RUNNING = "running",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled"
}
/**
 * Clone operation parameters.
 */
export interface CloneParams {
    /** Remote repository URL */
    remote: string;
    /** Branch to clone */
    branch: string;
    /** Optional depth for shallow clone */
    depth?: number;
    /** Optional path prefix to clone into */
    path?: string;
}
/**
 * Fetch operation parameters.
 */
export interface FetchParams {
    /** Remote repository URL */
    remote: string;
    /** Refs to fetch */
    refs: string[];
    /** Optional depth for shallow fetch */
    depth?: number;
    /** Prune remote-tracking refs */
    prune?: boolean;
}
/**
 * Push operation parameters.
 */
export interface PushParams {
    /** Remote repository URL */
    remote: string;
    /** Refs to push (source:destination format) */
    refs: string[];
    /** Force push */
    force?: boolean;
    /** Delete remote refs */
    delete?: boolean;
}
/**
 * Progress update during operation execution.
 */
export interface RPCProgressUpdate {
    /** Current phase of the operation */
    phase: string;
    /** Human-readable progress message */
    message: string;
    /** Current progress count */
    current: number;
    /** Total expected count (if known) */
    total?: number;
    /** Calculated percentage (0-100) */
    percentage?: number;
    /** Timestamp of this update */
    timestamp: number;
}
/**
 * Operation status information.
 */
export interface RPCOperationStatus {
    /** Unique operation identifier */
    operationId: string;
    /** Type of operation */
    type: OperationType;
    /** Current state */
    state: OperationState;
    /** Operation parameters */
    params: CloneParams | FetchParams | PushParams;
    /** Current progress (if running) */
    progress?: RPCProgressUpdate;
    /** Timestamp when operation was created */
    createdAt: number;
    /** Timestamp when operation started running */
    startedAt?: number;
    /** Timestamp when operation completed/failed/cancelled */
    completedAt?: number;
    /** Cancellation reason (if cancelled) */
    cancellationReason?: string;
}
/**
 * Operation result after completion.
 */
export interface RPCOperationResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** Error message (if failed) */
    error?: string;
    /** Number of objects transferred */
    objectsTransferred?: number;
    /** Bytes transferred */
    bytesTransferred?: number;
    /** Refs that were updated */
    refs?: string[];
    /** HEAD commit after operation */
    headCommit?: string;
    /** Duration in milliseconds */
    durationMs?: number;
}
/**
 * Full operation record including status and result.
 */
export interface RPCOperation extends RPCOperationStatus {
    /** Operation result (available after completion) */
    result?: RPCOperationResult;
    /** Progress history */
    progressHistory?: RPCProgressUpdate[];
    /** Cancellation requested flag */
    cancellationRequested?: boolean;
}
/**
 * Storage interface for persisting operations.
 */
export interface RPCStorage {
    get(key: string): Promise<unknown>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    list(options?: {
        prefix?: string;
    }): Promise<Map<string, unknown>>;
}
/**
 * R2 bucket interface for object storage.
 */
export interface RPCR2Bucket {
    get(key: string): Promise<{
        key: string;
        size: number;
        arrayBuffer(): Promise<ArrayBuffer>;
        text(): Promise<string>;
    } | null>;
    put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<{
        key: string;
        size: number;
    }>;
    delete(keys: string | string[]): Promise<void>;
    list(options?: {
        prefix?: string;
    }): Promise<{
        objects: Array<{
            key: string;
            size: number;
        }>;
        truncated: boolean;
    }>;
}
/**
 * Configuration options for GitRPCService.
 */
export interface GitRPCServiceOptions {
    /** Storage for persisting operation state */
    storage: RPCStorage;
    /** R2 bucket for git objects */
    r2: RPCR2Bucket;
    /** Optional object prefix in R2 */
    objectPrefix?: string;
}
/**
 * Options for listing operations.
 */
export interface ListOperationsOptions {
    /** Filter by state */
    state?: OperationState;
    /** Filter by type */
    type?: OperationType;
    /** Maximum number to return */
    limit?: number;
}
/**
 * Options for getting result.
 */
export interface GetResultOptions {
    /** Whether to clean up operation after retrieval */
    cleanup?: boolean;
}
/**
 * Options for cleaning up old operations.
 */
export interface CleanupOptions {
    /** Maximum age in milliseconds for completed operations */
    maxAge: number;
}
/**
 * Checks if a value is a valid CloneParams object.
 */
export declare function isCloneParams(value: unknown): value is CloneParams;
/**
 * Checks if a value is a valid FetchParams object.
 */
export declare function isFetchParams(value: unknown): value is FetchParams;
/**
 * Checks if a value is a valid PushParams object.
 */
export declare function isPushParams(value: unknown): value is PushParams;
/**
 * Checks if a value is a valid RPCOperation object.
 *
 * Validates all required fields and their types to avoid unsafe casts
 * from storage reads.
 */
export declare function isRPCOperation(value: unknown): value is RPCOperation;
/**
 * Validates operation params match the declared operation type.
 * Returns the params cast to the correct type, or null if invalid.
 */
export declare function validateOperationParams(type: OperationType, params: unknown): CloneParams | FetchParams | PushParams | null;
/**
 * Git RPC Service for handling heavy git operations asynchronously.
 *
 * @description
 * Provides an async operation model for resource-intensive git operations
 * like clone, fetch, and push. Operations are tracked with unique IDs,
 * support progress reporting, and can be cancelled.
 *
 * @example
 * ```typescript
 * const service = new GitRPCService({ storage, r2 })
 *
 * // Start a clone
 * const { operationId } = await service.startClone({
 *   remote: 'https://github.com/example/repo.git',
 *   branch: 'main',
 * })
 *
 * // Check progress
 * const status = await service.getStatus(operationId)
 * console.log(status.progress?.message)
 *
 * // Cancel if needed
 * await service.cancel(operationId)
 *
 * // Or wait for result
 * const result = await service.getResult(operationId)
 * ```
 */
export declare class GitRPCService {
    private readonly storage;
    private readonly r2;
    private readonly objectPrefix;
    /**
     * Create a new GitRPCService instance.
     *
     * @param options - Service configuration options
     */
    constructor(options: GitRPCServiceOptions);
    /**
     * Start a clone operation.
     *
     * @param params - Clone parameters
     * @returns Operation status with the new operation ID
     *
     * @throws {Error} If remote URL is invalid
     *
     * @example
     * ```typescript
     * const { operationId } = await service.startClone({
     *   remote: 'https://github.com/example/repo.git',
     *   branch: 'main',
     * })
     * ```
     */
    startClone(params: CloneParams): Promise<RPCOperationStatus>;
    /**
     * Start a fetch operation.
     *
     * @param params - Fetch parameters
     * @returns Operation status with the new operation ID
     *
     * @throws {Error} If remote URL is invalid
     */
    startFetch(params: FetchParams): Promise<RPCOperationStatus>;
    /**
     * Start a push operation.
     *
     * @param params - Push parameters
     * @returns Operation status with the new operation ID
     *
     * @throws {Error} If remote URL is invalid
     */
    startPush(params: PushParams): Promise<RPCOperationStatus>;
    /**
     * Get the current status of an operation.
     *
     * @param operationId - The operation ID
     * @returns Operation status or null if not found
     */
    getStatus(operationId: string): Promise<RPCOperationStatus | null>;
    /**
     * Get the progress history for an operation.
     *
     * @param operationId - The operation ID
     * @returns Array of progress updates
     */
    getProgressHistory(operationId: string): Promise<RPCProgressUpdate[]>;
    /**
     * Get the result of a completed operation.
     *
     * @param operationId - The operation ID
     * @param options - Optional settings for result retrieval
     * @returns Operation result or null if not yet completed
     */
    getResult(operationId: string, options?: GetResultOptions): Promise<RPCOperationResult | null>;
    /**
     * Cancel an in-progress or pending operation.
     *
     * @param operationId - The operation ID
     * @param reason - Optional cancellation reason
     * @returns True if operation was cancelled, false if it couldn't be
     */
    cancel(operationId: string, reason?: string): Promise<boolean>;
    /**
     * Check if cancellation has been requested for an operation.
     *
     * @param operationId - The operation ID
     * @returns True if cancellation was requested
     */
    isCancellationRequested(operationId: string): Promise<boolean>;
    /**
     * List operations with optional filtering.
     *
     * @param options - Filter options
     * @returns Array of operation statuses
     */
    listOperations(options?: ListOperationsOptions): Promise<RPCOperationStatus[]>;
    /**
     * Clean up old completed operations.
     *
     * @param options - Cleanup options with max age
     */
    cleanupOldOperations(options: CleanupOptions): Promise<void>;
    /**
     * Execute an operation (intended for background execution).
     *
     * @param operationId - The operation ID to execute
     */
    executeOperation(operationId: string): Promise<void>;
    /**
     * Update progress for an operation.
     * @internal Exposed for testing
     */
    _updateProgress(operationId: string, progress: Omit<RPCProgressUpdate, 'timestamp' | 'percentage'>): Promise<void>;
    /**
     * Set operation state.
     * @internal Exposed for testing
     */
    _setState(operationId: string, state: OperationState): Promise<void>;
    /**
     * Complete an operation with a result.
     * @internal Exposed for testing
     */
    _completeOperation(operationId: string, result: Omit<RPCOperationResult, 'durationMs'>): Promise<void>;
    /**
     * Fail an operation with an error.
     * @internal Exposed for testing
     */
    _failOperation(operationId: string, error: string): Promise<void>;
    /**
     * Create a new operation.
     */
    private _createOperation;
    /**
     * Get an operation by ID.
     */
    private _getOperation;
    /**
     * Save an operation.
     */
    private _saveOperation;
    /**
     * Delete an operation.
     */
    private _deleteOperation;
    /**
     * Execute a clone operation.
     */
    private _executeClone;
    /**
     * Execute a fetch operation.
     */
    private _executeFetch;
    /**
     * Execute a push operation.
     */
    private _executePush;
}
//# sourceMappingURL=git-rpc-service.d.ts.map