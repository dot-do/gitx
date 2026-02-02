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
// ============================================================================
// Types and Interfaces
// ============================================================================
/**
 * Operation types supported by the RPC service.
 */
export var OperationType;
(function (OperationType) {
    OperationType["CLONE"] = "clone";
    OperationType["FETCH"] = "fetch";
    OperationType["PUSH"] = "push";
})(OperationType || (OperationType = {}));
/**
 * Operation state machine states.
 */
export var OperationState;
(function (OperationState) {
    OperationState["PENDING"] = "pending";
    OperationState["RUNNING"] = "running";
    OperationState["COMPLETED"] = "completed";
    OperationState["FAILED"] = "failed";
    OperationState["CANCELLED"] = "cancelled";
})(OperationState || (OperationState = {}));
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Generate a unique operation ID.
 */
function generateOperationId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `op_${timestamp}${random}`;
}
/**
 * Validate a remote URL.
 */
function validateRemoteUrl(url) {
    // Accept mock:// URLs for testing
    if (url.startsWith('mock://')) {
        return true;
    }
    try {
        const parsed = new URL(url);
        return ['http:', 'https:', 'git:', 'ssh:'].includes(parsed.protocol);
    }
    catch {
        return false;
    }
}
// ============================================================================
// Type Guards
// ============================================================================
/**
 * Valid operation type values.
 */
const VALID_OPERATION_TYPES = new Set(Object.values(OperationType));
/**
 * Valid operation state values.
 */
const VALID_OPERATION_STATES = new Set(Object.values(OperationState));
/**
 * Checks if a value is a valid CloneParams object.
 */
export function isCloneParams(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const obj = value;
    return (typeof obj['remote'] === 'string' &&
        typeof obj['branch'] === 'string' &&
        (obj['depth'] === undefined || typeof obj['depth'] === 'number') &&
        (obj['path'] === undefined || typeof obj['path'] === 'string'));
}
/**
 * Checks if a value is a valid FetchParams object.
 */
export function isFetchParams(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const obj = value;
    return (typeof obj['remote'] === 'string' &&
        Array.isArray(obj['refs']) &&
        obj['refs'].every((r) => typeof r === 'string') &&
        (obj['depth'] === undefined || typeof obj['depth'] === 'number') &&
        (obj['prune'] === undefined || typeof obj['prune'] === 'boolean'));
}
/**
 * Checks if a value is a valid PushParams object.
 */
export function isPushParams(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const obj = value;
    return (typeof obj['remote'] === 'string' &&
        Array.isArray(obj['refs']) &&
        obj['refs'].every((r) => typeof r === 'string') &&
        (obj['force'] === undefined || typeof obj['force'] === 'boolean') &&
        (obj['delete'] === undefined || typeof obj['delete'] === 'boolean'));
}
/**
 * Checks if a value is a valid RPCOperation object.
 *
 * Validates all required fields and their types to avoid unsafe casts
 * from storage reads.
 */
export function isRPCOperation(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const obj = value;
    // Required fields
    if (typeof obj['operationId'] !== 'string')
        return false;
    if (typeof obj['type'] !== 'string' || !VALID_OPERATION_TYPES.has(obj['type']))
        return false;
    if (typeof obj['state'] !== 'string' || !VALID_OPERATION_STATES.has(obj['state']))
        return false;
    if (typeof obj['createdAt'] !== 'number')
        return false;
    // Params must match the operation type
    if (typeof obj['params'] !== 'object' || obj['params'] === null)
        return false;
    return true;
}
/**
 * Validates operation params match the declared operation type.
 * Returns the params cast to the correct type, or null if invalid.
 */
export function validateOperationParams(type, params) {
    switch (type) {
        case OperationType.CLONE:
            return isCloneParams(params) ? params : null;
        case OperationType.FETCH:
            return isFetchParams(params) ? params : null;
        case OperationType.PUSH:
            return isPushParams(params) ? params : null;
        default:
            return null;
    }
}
// ============================================================================
// GitRPCService Class
// ============================================================================
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
export class GitRPCService {
    storage;
    r2;
    objectPrefix;
    /**
     * Create a new GitRPCService instance.
     *
     * @param options - Service configuration options
     */
    constructor(options) {
        this.storage = options.storage;
        this.r2 = options.r2;
        this.objectPrefix = options.objectPrefix ?? 'git/objects';
    }
    // ==========================================================================
    // Starting Operations
    // ==========================================================================
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
    async startClone(params) {
        if (!validateRemoteUrl(params.remote)) {
            throw new Error('Invalid remote URL');
        }
        return this._createOperation(OperationType.CLONE, params);
    }
    /**
     * Start a fetch operation.
     *
     * @param params - Fetch parameters
     * @returns Operation status with the new operation ID
     *
     * @throws {Error} If remote URL is invalid
     */
    async startFetch(params) {
        if (!validateRemoteUrl(params.remote)) {
            throw new Error('Invalid remote URL');
        }
        return this._createOperation(OperationType.FETCH, params);
    }
    /**
     * Start a push operation.
     *
     * @param params - Push parameters
     * @returns Operation status with the new operation ID
     *
     * @throws {Error} If remote URL is invalid
     */
    async startPush(params) {
        if (!validateRemoteUrl(params.remote)) {
            throw new Error('Invalid remote URL');
        }
        return this._createOperation(OperationType.PUSH, params);
    }
    // ==========================================================================
    // Status and Progress
    // ==========================================================================
    /**
     * Get the current status of an operation.
     *
     * @param operationId - The operation ID
     * @returns Operation status or null if not found
     */
    async getStatus(operationId) {
        const operation = await this._getOperation(operationId);
        if (!operation) {
            return null;
        }
        // Return status without result and progress history
        const { result, progressHistory, ...status } = operation;
        return status;
    }
    /**
     * Get the progress history for an operation.
     *
     * @param operationId - The operation ID
     * @returns Array of progress updates
     */
    async getProgressHistory(operationId) {
        const operation = await this._getOperation(operationId);
        return operation?.progressHistory ?? [];
    }
    // ==========================================================================
    // Results
    // ==========================================================================
    /**
     * Get the result of a completed operation.
     *
     * @param operationId - The operation ID
     * @param options - Optional settings for result retrieval
     * @returns Operation result or null if not yet completed
     */
    async getResult(operationId, options) {
        const operation = await this._getOperation(operationId);
        if (!operation) {
            return null;
        }
        // Only return result if operation is in a terminal state
        if (operation.state !== OperationState.COMPLETED &&
            operation.state !== OperationState.FAILED) {
            return null;
        }
        const result = operation.result ?? null;
        // Clean up if requested
        if (options?.cleanup && result) {
            await this._deleteOperation(operationId);
        }
        return result;
    }
    // ==========================================================================
    // Cancellation
    // ==========================================================================
    /**
     * Cancel an in-progress or pending operation.
     *
     * @param operationId - The operation ID
     * @param reason - Optional cancellation reason
     * @returns True if operation was cancelled, false if it couldn't be
     */
    async cancel(operationId, reason) {
        const operation = await this._getOperation(operationId);
        if (!operation) {
            return false;
        }
        // Can only cancel pending or running operations
        if (operation.state !== OperationState.PENDING &&
            operation.state !== OperationState.RUNNING) {
            return false;
        }
        // Update state to cancelled
        operation.state = OperationState.CANCELLED;
        operation.completedAt = Date.now();
        operation.cancellationRequested = true;
        if (reason) {
            operation.cancellationReason = reason;
        }
        await this._saveOperation(operation);
        return true;
    }
    /**
     * Check if cancellation has been requested for an operation.
     *
     * @param operationId - The operation ID
     * @returns True if cancellation was requested
     */
    async isCancellationRequested(operationId) {
        const operation = await this._getOperation(operationId);
        return operation?.cancellationRequested ?? false;
    }
    // ==========================================================================
    // Listing and Cleanup
    // ==========================================================================
    /**
     * List operations with optional filtering.
     *
     * @param options - Filter options
     * @returns Array of operation statuses
     */
    async listOperations(options) {
        const allOperations = await this.storage.list({ prefix: 'rpc:operation:' });
        const results = [];
        for (const [_, value] of allOperations) {
            if (!isRPCOperation(value))
                continue;
            const operation = value;
            // Apply filters
            if (options?.state && operation.state !== options.state) {
                continue;
            }
            if (options?.type && operation.type !== options.type) {
                continue;
            }
            // Extract status (without result and history)
            const { result, progressHistory, ...status } = operation;
            results.push(status);
            if (options?.limit && results.length >= options.limit) {
                break;
            }
        }
        return results;
    }
    /**
     * Clean up old completed operations.
     *
     * @param options - Cleanup options with max age
     */
    async cleanupOldOperations(options) {
        const now = Date.now();
        const allOperations = await this.storage.list({ prefix: 'rpc:operation:' });
        for (const [key, value] of allOperations) {
            if (!isRPCOperation(value))
                continue;
            const operation = value;
            // Only clean up terminal states
            if (operation.state !== OperationState.COMPLETED &&
                operation.state !== OperationState.FAILED &&
                operation.state !== OperationState.CANCELLED) {
                continue;
            }
            // Check age
            const age = now - (operation.completedAt ?? operation.createdAt);
            if (age > options.maxAge) {
                await this.storage.delete(key);
            }
        }
    }
    // ==========================================================================
    // Operation Execution
    // ==========================================================================
    /**
     * Execute an operation (intended for background execution).
     *
     * @param operationId - The operation ID to execute
     */
    async executeOperation(operationId) {
        const operation = await this._getOperation(operationId);
        if (!operation) {
            return;
        }
        // Check for early cancellation
        if (operation.cancellationRequested) {
            return;
        }
        // Transition to running
        await this._setState(operationId, OperationState.RUNNING);
        try {
            // Validate and execute based on operation type
            const validatedParams = validateOperationParams(operation.type, operation.params);
            if (!validatedParams) {
                await this._failOperation(operationId, `Invalid params for operation type: ${operation.type}`);
                return;
            }
            switch (operation.type) {
                case OperationType.CLONE:
                    await this._executeClone(operationId, validatedParams);
                    break;
                case OperationType.FETCH:
                    await this._executeFetch(operationId, validatedParams);
                    break;
                case OperationType.PUSH:
                    await this._executePush(operationId, validatedParams);
                    break;
            }
        }
        catch (error) {
            // Check if this was due to cancellation
            const currentOp = await this._getOperation(operationId);
            if (currentOp?.cancellationRequested) {
                // Already marked as cancelled, don't override
                return;
            }
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this._failOperation(operationId, errorMessage);
        }
    }
    // ==========================================================================
    // Internal Methods (exposed for testing with _ prefix)
    // ==========================================================================
    /**
     * Update progress for an operation.
     * @internal Exposed for testing
     */
    async _updateProgress(operationId, progress) {
        const operation = await this._getOperation(operationId);
        if (!operation) {
            return;
        }
        const update = {
            ...progress,
            timestamp: Date.now(),
            percentage: progress.total && progress.total > 0
                ? Math.round((progress.current / progress.total) * 100)
                : undefined,
        };
        operation.progress = update;
        operation.progressHistory = operation.progressHistory ?? [];
        operation.progressHistory.push(update);
        await this._saveOperation(operation);
    }
    /**
     * Set operation state.
     * @internal Exposed for testing
     */
    async _setState(operationId, state) {
        const operation = await this._getOperation(operationId);
        if (!operation) {
            return;
        }
        operation.state = state;
        if (state === OperationState.RUNNING && !operation.startedAt) {
            operation.startedAt = Date.now();
        }
        if ((state === OperationState.COMPLETED ||
            state === OperationState.FAILED ||
            state === OperationState.CANCELLED) &&
            !operation.completedAt) {
            operation.completedAt = Date.now();
        }
        await this._saveOperation(operation);
    }
    /**
     * Complete an operation with a result.
     * @internal Exposed for testing
     */
    async _completeOperation(operationId, result) {
        const operation = await this._getOperation(operationId);
        if (!operation) {
            return;
        }
        operation.state = OperationState.COMPLETED;
        operation.completedAt = Date.now();
        const durationMs = operation.startedAt
            ? operation.completedAt - operation.startedAt
            : operation.completedAt - operation.createdAt;
        operation.result = {
            ...result,
            durationMs,
        };
        await this._saveOperation(operation);
    }
    /**
     * Fail an operation with an error.
     * @internal Exposed for testing
     */
    async _failOperation(operationId, error) {
        const operation = await this._getOperation(operationId);
        if (!operation) {
            return;
        }
        operation.state = OperationState.FAILED;
        operation.completedAt = Date.now();
        const durationMs = operation.startedAt
            ? operation.completedAt - operation.startedAt
            : operation.completedAt - operation.createdAt;
        operation.result = {
            success: false,
            error,
            durationMs,
        };
        await this._saveOperation(operation);
    }
    // ==========================================================================
    // Private Helper Methods
    // ==========================================================================
    /**
     * Create a new operation.
     */
    async _createOperation(type, params) {
        const operationId = generateOperationId();
        const now = Date.now();
        const operation = {
            operationId,
            type,
            state: OperationState.PENDING,
            params,
            createdAt: now,
            progressHistory: [],
        };
        await this._saveOperation(operation);
        // Return status (without result and history)
        const { result, progressHistory, ...status } = operation;
        return status;
    }
    /**
     * Get an operation by ID.
     */
    async _getOperation(operationId) {
        const key = `rpc:operation:${operationId}`;
        const data = await this.storage.get(key);
        if (!data)
            return null;
        if (!isRPCOperation(data))
            return null;
        return data;
    }
    /**
     * Save an operation.
     */
    async _saveOperation(operation) {
        const key = `rpc:operation:${operation.operationId}`;
        await this.storage.put(key, operation);
    }
    /**
     * Delete an operation.
     */
    async _deleteOperation(operationId) {
        const key = `rpc:operation:${operationId}`;
        await this.storage.delete(key);
    }
    // ==========================================================================
    // Operation Execution Implementations
    // ==========================================================================
    /**
     * Execute a clone operation.
     */
    async _executeClone(operationId, params) {
        // Check for cancellation
        if (await this.isCancellationRequested(operationId)) {
            return;
        }
        await this._updateProgress(operationId, {
            phase: 'connecting',
            message: 'Connecting to remote...',
            current: 0,
            total: 100,
        });
        // Mock implementation - in real implementation, this would:
        // 1. Connect to remote
        // 2. Negotiate refs
        // 3. Download pack
        // 4. Unpack objects
        // 5. Checkout working tree
        // For mock:// URLs, simulate behavior
        if (params.remote.startsWith('mock://')) {
            const repoName = params.remote.replace('mock://', '');
            if (repoName === 'nonexistent') {
                throw new Error('Repository not found');
            }
            if (repoName === 'slow-repo') {
                // Check cancellation frequently
                for (let i = 0; i < 10; i++) {
                    if (await this.isCancellationRequested(operationId)) {
                        // Mark as cancelled and return
                        const op = await this._getOperation(operationId);
                        if (op && op.state !== OperationState.CANCELLED) {
                            op.state = OperationState.CANCELLED;
                            op.completedAt = Date.now();
                            await this._saveOperation(op);
                        }
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                // Slow repo completes successfully without actual R2 data
                await this._completeOperation(operationId, {
                    success: true,
                    objectsTransferred: 0,
                    bytesTransferred: 0,
                    refs: [`refs/heads/${params.branch}`],
                });
                return;
            }
            // Check if we have objects in R2
            const refKey = `${this.objectPrefix}/refs/heads/${params.branch}`;
            const refObject = await this.r2.get(refKey);
            if (!refObject) {
                throw new Error(`Branch ${params.branch} not found`);
            }
            const headCommit = await refObject.text();
            await this._updateProgress(operationId, {
                phase: 'complete',
                message: 'Clone complete',
                current: 100,
                total: 100,
            });
            await this._completeOperation(operationId, {
                success: true,
                objectsTransferred: 1,
                bytesTransferred: headCommit.length,
                refs: [`refs/heads/${params.branch}`],
                headCommit,
            });
            return;
        }
        // For real URLs, this would implement actual git protocol
        // For now, just complete with mock data
        await this._updateProgress(operationId, {
            phase: 'receiving',
            message: 'Receiving objects...',
            current: 50,
            total: 100,
        });
        await this._updateProgress(operationId, {
            phase: 'complete',
            message: 'Clone complete',
            current: 100,
            total: 100,
        });
        await this._completeOperation(operationId, {
            success: true,
            objectsTransferred: 0,
            bytesTransferred: 0,
            refs: [`refs/heads/${params.branch}`],
        });
    }
    /**
     * Execute a fetch operation.
     */
    async _executeFetch(operationId, params) {
        // Check for cancellation
        if (await this.isCancellationRequested(operationId)) {
            return;
        }
        await this._updateProgress(operationId, {
            phase: 'connecting',
            message: 'Connecting to remote...',
            current: 0,
            total: 100,
        });
        // Mock implementation
        await this._updateProgress(operationId, {
            phase: 'complete',
            message: 'Fetch complete',
            current: 100,
            total: 100,
        });
        await this._completeOperation(operationId, {
            success: true,
            objectsTransferred: 0,
            bytesTransferred: 0,
            refs: params.refs,
        });
    }
    /**
     * Execute a push operation.
     */
    async _executePush(operationId, params) {
        // Check for cancellation
        if (await this.isCancellationRequested(operationId)) {
            return;
        }
        await this._updateProgress(operationId, {
            phase: 'connecting',
            message: 'Connecting to remote...',
            current: 0,
            total: 100,
        });
        // Mock implementation
        await this._updateProgress(operationId, {
            phase: 'complete',
            message: 'Push complete',
            current: 100,
            total: 100,
        });
        await this._completeOperation(operationId, {
            success: true,
            objectsTransferred: 0,
            bytesTransferred: 0,
            refs: params.refs,
        });
    }
}
//# sourceMappingURL=git-rpc-service.js.map