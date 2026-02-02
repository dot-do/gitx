/**
 * @fileoverview Unified Error Hierarchy for GitX
 *
 * This module provides a comprehensive error hierarchy for the gitx.do library.
 * All errors extend from GitXError, which provides common properties for:
 * - Error codes for programmatic handling
 * - Cause chaining for error context
 * - Consistent serialization
 *
 * @module @dotdo/gitx/errors
 *
 * @example
 * ```typescript
 * import { GitXError, StorageError, WireError } from 'gitx.do'
 *
 * try {
 *   await storage.getObject(sha)
 * } catch (error) {
 *   if (error instanceof StorageError) {
 *     console.log(`Storage error: ${error.code}`)
 *   }
 *   if (error instanceof GitXError) {
 *     console.log(`GitX error: ${error.message}`)
 *     if (error.cause) {
 *       console.log(`Caused by: ${error.cause}`)
 *     }
 *   }
 * }
 * ```
 */
/**
 * Error codes for GitXError base class.
 */
export type GitXErrorCode = 'UNKNOWN' | 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'PERMISSION_DENIED' | 'INTERNAL' | 'TIMEOUT' | 'CANCELLED' | 'UNAVAILABLE';
/**
 * Base error class for all GitX errors.
 *
 * @description
 * All GitX errors extend from this class, providing:
 * - A standardized `code` property for programmatic error handling
 * - Support for error cause chaining via the `cause` property
 * - Proper prototype chain for instanceof checks
 * - Serialization support via `toJSON()`
 *
 * @example
 * ```typescript
 * // Create a basic error
 * throw new GitXError('Operation failed', 'INTERNAL')
 *
 * // Create an error with cause
 * try {
 *   await riskyOperation()
 * } catch (cause) {
 *   throw new GitXError('Wrapper error', 'INTERNAL', { cause })
 * }
 *
 * // Check error type
 * if (error instanceof GitXError) {
 *   switch (error.code) {
 *     case 'NOT_FOUND':
 *       // Handle not found
 *       break
 *     case 'PERMISSION_DENIED':
 *       // Handle permission error
 *       break
 *   }
 * }
 * ```
 */
export declare class GitXError extends Error {
    /**
     * Error code for programmatic handling.
     */
    readonly code: string;
    /**
     * The underlying cause of this error, if any.
     */
    readonly cause?: Error | unknown;
    /**
     * Creates a new GitXError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including cause
     */
    constructor(message: string, code?: GitXErrorCode | string, options?: {
        cause?: Error | unknown;
        [key: string]: unknown;
    });
    /**
     * Serializes the error to a plain object.
     *
     * @returns Plain object representation of the error
     */
    toJSON(): Record<string, unknown>;
    /**
     * Creates a new error with the same code but a different message.
     *
     * @param message - New error message
     * @returns New error instance
     */
    withMessage(message: string): this;
    /**
     * Wraps another error as the cause of this error.
     *
     * @param cause - The underlying error
     * @returns New error instance with cause
     */
    static wrap(cause: Error | unknown, message?: string): GitXError;
}
/**
 * Error codes for storage operations.
 */
export type StorageErrorCode = 'NOT_FOUND' | 'ALREADY_EXISTS' | 'CORRUPTED' | 'CHECKSUM_MISMATCH' | 'INVALID_DATA' | 'LOCKED' | 'NETWORK_ERROR' | 'QUOTA_EXCEEDED' | 'READ_ERROR' | 'WRITE_ERROR';
/**
 * Error thrown by storage operations.
 *
 * @description
 * Covers errors from all storage backends including:
 * - R2 object storage
 * - SQLite operations
 * - Parquet file operations
 * - Bundle/pack operations
 *
 * @example
 * ```typescript
 * try {
 *   await storage.getObject(sha)
 * } catch (error) {
 *   if (error instanceof StorageError) {
 *     switch (error.code) {
 *       case 'NOT_FOUND':
 *         console.log(`Object ${error.sha} not found`)
 *         break
 *       case 'CORRUPTED':
 *         console.log(`Object ${error.sha} is corrupted`)
 *         break
 *     }
 *   }
 * }
 * ```
 */
export declare class StorageError extends GitXError {
    /**
     * The SHA of the object that caused the error, if applicable.
     */
    readonly sha?: string | undefined;
    /**
     * The storage path that caused the error, if applicable.
     */
    readonly path?: string | undefined;
    /**
     * The storage operation that failed.
     */
    readonly operation?: string | undefined;
    /**
     * Creates a new StorageError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including sha, path, operation, and cause
     */
    constructor(message: string, code?: StorageErrorCode, options?: {
        sha?: string;
        path?: string;
        operation?: string;
        cause?: Error | unknown;
    });
    toJSON(): Record<string, unknown>;
    /**
     * Creates a NOT_FOUND error for an object.
     */
    static notFound(sha: string): StorageError;
    /**
     * Creates a CORRUPTED error for an object.
     */
    static corrupted(sha: string, reason?: string): StorageError;
}
/**
 * Error codes for wire protocol operations.
 */
export type WireErrorCode = 'MALFORMED_PACKET' | 'INVALID_COMMAND' | 'NEGOTIATION_TIMEOUT' | 'NEGOTIATION_LIMIT' | 'PATH_SECURITY_VIOLATION' | 'PROTOCOL_ERROR' | 'AUTH_REQUIRED' | 'AUTH_FAILED';
/**
 * Error thrown by wire protocol operations.
 *
 * @description
 * Covers errors from Git protocol operations including:
 * - Pkt-line encoding/decoding
 * - Smart HTTP protocol
 * - Capability negotiation
 * - Authentication
 *
 * @example
 * ```typescript
 * try {
 *   await handleUploadPack(request, storage)
 * } catch (error) {
 *   if (error instanceof WireError) {
 *     switch (error.code) {
 *       case 'MALFORMED_PACKET':
 *         return new Response('Bad Request', { status: 400 })
 *       case 'AUTH_REQUIRED':
 *         return new Response('Unauthorized', { status: 401 })
 *     }
 *   }
 * }
 * ```
 */
export declare class WireError extends GitXError {
    /**
     * The raw packet data that caused the error, if applicable.
     */
    readonly packet?: Uint8Array | undefined;
    /**
     * Creates a new WireError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including packet and cause
     */
    constructor(message: string, code?: WireErrorCode, options?: {
        packet?: Uint8Array | undefined;
        cause?: Error | unknown;
    });
    /**
     * Creates a MALFORMED_PACKET error.
     */
    static malformedPacket(message: string, packet?: Uint8Array): WireError;
    /**
     * Creates a NEGOTIATION_TIMEOUT error.
     */
    static timeout(elapsed: number, limit: number): WireError;
}
/**
 * Error codes for Iceberg operations.
 */
export type IcebergErrorCode = 'NOT_FOUND' | 'ALREADY_EXISTS' | 'CONFLICT' | 'INTERNAL' | 'INVALID_REF_NAME' | 'INVALID_METADATA' | 'SNAPSHOT_NOT_FOUND';
/**
 * Error thrown by Iceberg catalog and metadata operations.
 *
 * @description
 * Covers errors from Iceberg integration including:
 * - Catalog operations (namespace, table management)
 * - Metadata generation
 * - Snapshot operations
 *
 * @example
 * ```typescript
 * try {
 *   await catalog.loadTable(namespace, table)
 * } catch (error) {
 *   if (error instanceof IcebergError) {
 *     switch (error.code) {
 *       case 'NOT_FOUND':
 *         console.log('Table does not exist')
 *         break
 *       case 'CONFLICT':
 *         console.log('Concurrent modification detected')
 *         break
 *     }
 *   }
 * }
 * ```
 */
export declare class IcebergError extends GitXError {
    /**
     * Additional details about the error.
     */
    readonly details?: Record<string, unknown> | undefined;
    /**
     * Creates a new IcebergError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including details and cause
     */
    constructor(message: string, code?: IcebergErrorCode, options?: {
        details?: Record<string, unknown>;
        cause?: Error | unknown;
    });
    toJSON(): Record<string, unknown>;
}
/**
 * Error codes for reference operations.
 */
export type RefErrorCode = 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INVALID_NAME' | 'INVALID_SHA' | 'LOCKED' | 'CONFLICT' | 'NOT_FULLY_MERGED' | 'CANNOT_DELETE_CURRENT' | 'CHECKOUT_CONFLICT' | 'INVALID_START_POINT' | 'NO_UPSTREAM' | 'DETACHED_HEAD';
/**
 * Error thrown by reference operations.
 *
 * @description
 * Covers errors from reference operations including:
 * - Branch operations
 * - Tag operations
 * - Ref storage operations
 *
 * @example
 * ```typescript
 * try {
 *   await createBranch(storage, 'feature/new')
 * } catch (error) {
 *   if (error instanceof RefError) {
 *     switch (error.code) {
 *       case 'ALREADY_EXISTS':
 *         console.log(`Branch ${error.refName} already exists`)
 *         break
 *       case 'INVALID_NAME':
 *         console.log('Invalid branch name')
 *         break
 *     }
 *   }
 * }
 * ```
 */
export declare class RefError extends GitXError {
    /**
     * The reference name that caused the error.
     */
    readonly refName?: string | undefined;
    /**
     * The SHA that was expected or invalid.
     */
    readonly sha?: string | undefined;
    /**
     * Creates a new RefError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including refName, sha, and cause
     */
    constructor(message: string, code?: RefErrorCode, options?: {
        refName?: string;
        sha?: string;
        cause?: Error | unknown;
    });
    toJSON(): Record<string, unknown>;
    /**
     * Creates a NOT_FOUND error for a reference.
     */
    static notFound(refName: string): RefError;
    /**
     * Creates an ALREADY_EXISTS error for a reference.
     */
    static alreadyExists(refName: string): RefError;
    /**
     * Creates an INVALID_NAME error for a reference.
     */
    static invalidName(refName: string, reason?: string): RefError;
}
/**
 * Error codes for Git object operations.
 */
export type ObjectErrorCode = 'NOT_FOUND' | 'CORRUPTED' | 'INVALID_TYPE' | 'INVALID_FORMAT' | 'CHECKSUM_MISMATCH' | 'DELTA_ERROR' | 'PACK_ERROR';
/**
 * Error thrown by Git object operations.
 *
 * @description
 * Covers errors from Git object operations including:
 * - Object parsing and serialization
 * - Delta application
 * - Pack file operations
 *
 * @example
 * ```typescript
 * try {
 *   const commit = parseCommit(data)
 * } catch (error) {
 *   if (error instanceof ObjectError) {
 *     switch (error.code) {
 *       case 'CORRUPTED':
 *         console.log(`Object ${error.sha} is corrupted`)
 *         break
 *       case 'INVALID_TYPE':
 *         console.log(`Expected ${error.expectedType}, got ${error.actualType}`)
 *         break
 *     }
 *   }
 * }
 * ```
 */
export declare class ObjectError extends GitXError {
    /**
     * The SHA of the object that caused the error.
     */
    readonly sha?: string | undefined;
    /**
     * The expected object type.
     */
    readonly expectedType?: string | undefined;
    /**
     * The actual object type.
     */
    readonly actualType?: string | undefined;
    /**
     * Creates a new ObjectError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options
     */
    constructor(message: string, code?: ObjectErrorCode, options?: {
        sha?: string;
        expectedType?: string;
        actualType?: string;
        cause?: Error | unknown;
    });
    toJSON(): Record<string, unknown>;
    /**
     * Creates a NOT_FOUND error for an object.
     */
    static notFound(sha: string): ObjectError;
    /**
     * Creates a CORRUPTED error for an object.
     */
    static corrupted(sha: string, reason?: string): ObjectError;
    /**
     * Creates an INVALID_TYPE error for an object.
     */
    static invalidType(sha: string, expected: string, actual: string): ObjectError;
}
/**
 * Error codes for RPC operations.
 */
export type RPCErrorCode = 'INVALID_REQUEST' | 'METHOD_NOT_FOUND' | 'INVALID_PARAMS' | 'INTERNAL_ERROR' | 'PARSE_ERROR' | 'TIMEOUT' | 'CANCELLED';
/**
 * Error thrown by RPC operations.
 *
 * @description
 * Covers errors from RPC/MCP operations including:
 * - Request parsing
 * - Method invocation
 * - Response formatting
 *
 * @example
 * ```typescript
 * try {
 *   const result = await rpc.invoke('git.status', params)
 * } catch (error) {
 *   if (error instanceof RPCError) {
 *     switch (error.code) {
 *       case 'METHOD_NOT_FOUND':
 *         console.log('Unknown method')
 *         break
 *       case 'INVALID_PARAMS':
 *         console.log('Invalid parameters')
 *         break
 *     }
 *   }
 * }
 * ```
 */
export declare class RPCError extends GitXError {
    /**
     * Additional error data.
     */
    readonly data?: unknown | undefined;
    /**
     * Creates a new RPCError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including data and cause
     */
    constructor(message: string, code?: RPCErrorCode, options?: {
        data?: unknown;
        cause?: Error | unknown;
    });
    toJSON(): Record<string, unknown>;
    /**
     * Converts to JSON-RPC error format.
     */
    toJSONRPC(): {
        code: number;
        message: string;
        data?: unknown;
    };
}
/**
 * Error codes for migration operations.
 */
export type MigrationErrorCode = 'ALREADY_RUNNING' | 'NOT_FOUND' | 'INVALID_STATE' | 'ROLLBACK_FAILED' | 'VERSION_MISMATCH' | 'SCHEMA_ERROR' | 'DATA_ERROR';
/**
 * Error thrown by migration operations.
 *
 * @description
 * Covers errors from migration operations including:
 * - Schema migrations
 * - Data migrations
 * - Tiered storage migrations
 *
 * @example
 * ```typescript
 * try {
 *   await migrator.migrate('v2')
 * } catch (error) {
 *   if (error instanceof MigrationError) {
 *     switch (error.code) {
 *       case 'ALREADY_RUNNING':
 *         console.log('Migration already in progress')
 *         break
 *       case 'ROLLBACK_FAILED':
 *         console.log('Rollback failed, manual intervention required')
 *         break
 *     }
 *   }
 * }
 * ```
 */
export declare class MigrationError extends GitXError {
    /**
     * The source version/tier.
     */
    readonly sourceTier?: string | undefined;
    /**
     * The target version/tier.
     */
    readonly targetTier?: string | undefined;
    /**
     * Whether rollback was performed.
     */
    readonly rolledBack?: boolean | undefined;
    /**
     * Creates a new MigrationError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options
     */
    constructor(message: string, code?: MigrationErrorCode, options?: {
        sourceTier?: string;
        targetTier?: string;
        rolledBack?: boolean;
        cause?: Error | unknown;
    });
    toJSON(): Record<string, unknown>;
}
/**
 * Checks if an error is a GitXError.
 */
export declare function isGitXError(error: unknown): error is GitXError;
/**
 * Checks if an error is a StorageError.
 */
export declare function isStorageError(error: unknown): error is StorageError;
/**
 * Checks if an error is a WireError.
 */
export declare function isWireError(error: unknown): error is WireError;
/**
 * Checks if an error is an IcebergError.
 */
export declare function isIcebergError(error: unknown): error is IcebergError;
/**
 * Checks if an error is a RefError.
 */
export declare function isRefError(error: unknown): error is RefError;
/**
 * Checks if an error is an ObjectError.
 */
export declare function isObjectError(error: unknown): error is ObjectError;
/**
 * Checks if an error is an RPCError.
 */
export declare function isRPCError(error: unknown): error is RPCError;
/**
 * Checks if an error is a MigrationError.
 */
export declare function isMigrationError(error: unknown): error is MigrationError;
/**
 * Checks if an error has a specific code.
 */
export declare function hasErrorCode<T extends string>(error: unknown, code: T): error is GitXError & {
    code: T;
};
//# sourceMappingURL=errors.d.ts.map