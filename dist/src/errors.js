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
export class GitXError extends Error {
    /**
     * Error code for programmatic handling.
     */
    code;
    /**
     * The underlying cause of this error, if any.
     */
    cause;
    /**
     * Creates a new GitXError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including cause
     */
    constructor(message, code = 'UNKNOWN', options) {
        super(message, options?.cause ? { cause: options.cause } : undefined);
        this.name = 'GitXError';
        this.code = code;
        this.cause = options?.cause;
        // Maintains proper stack trace for where the error was thrown (V8 only)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
    /**
     * Serializes the error to a plain object.
     *
     * @returns Plain object representation of the error
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            cause: this.cause instanceof Error ? this.cause.message : this.cause,
            stack: this.stack,
        };
    }
    /**
     * Creates a new error with the same code but a different message.
     *
     * @param message - New error message
     * @returns New error instance
     */
    withMessage(message) {
        const Constructor = this.constructor;
        return new Constructor(message, this.code, { cause: this.cause });
    }
    /**
     * Wraps another error as the cause of this error.
     *
     * @param cause - The underlying error
     * @returns New error instance with cause
     */
    static wrap(cause, message) {
        const msg = message || (cause instanceof Error ? cause.message : String(cause));
        return new GitXError(msg, 'INTERNAL', { cause });
    }
}
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
export class StorageError extends GitXError {
    /**
     * The SHA of the object that caused the error, if applicable.
     */
    sha;
    /**
     * The storage path that caused the error, if applicable.
     */
    path;
    /**
     * The storage operation that failed.
     */
    operation;
    /**
     * Creates a new StorageError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including sha, path, operation, and cause
     */
    constructor(message, code = 'INTERNAL', options) {
        super(message, code, options);
        this.name = 'StorageError';
        this.sha = options?.sha;
        this.path = options?.path;
        this.operation = options?.operation;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            sha: this.sha,
            path: this.path,
            operation: this.operation,
        };
    }
    /**
     * Creates a NOT_FOUND error for an object.
     */
    static notFound(sha) {
        return new StorageError(`Object not found: ${sha}`, 'NOT_FOUND', { sha });
    }
    /**
     * Creates a CORRUPTED error for an object.
     */
    static corrupted(sha, reason) {
        const msg = reason ? `Object ${sha} is corrupted: ${reason}` : `Object ${sha} is corrupted`;
        return new StorageError(msg, 'CORRUPTED', { sha });
    }
}
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
export class WireError extends GitXError {
    /**
     * The raw packet data that caused the error, if applicable.
     */
    packet;
    /**
     * Creates a new WireError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including packet and cause
     */
    constructor(message, code = 'PROTOCOL_ERROR', options) {
        super(message, code, options);
        this.name = 'WireError';
        this.packet = options?.packet;
    }
    /**
     * Creates a MALFORMED_PACKET error.
     */
    static malformedPacket(message, packet) {
        return new WireError(message, 'MALFORMED_PACKET', { packet });
    }
    /**
     * Creates a NEGOTIATION_TIMEOUT error.
     */
    static timeout(elapsed, limit) {
        return new WireError(`Negotiation timeout: ${elapsed}ms exceeded ${limit}ms limit`, 'NEGOTIATION_TIMEOUT');
    }
}
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
export class IcebergError extends GitXError {
    /**
     * Additional details about the error.
     */
    details;
    /**
     * Creates a new IcebergError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including details and cause
     */
    constructor(message, code = 'INTERNAL', options) {
        super(message, code, options);
        this.name = 'IcebergError';
        this.details = options?.details;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            details: this.details,
        };
    }
}
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
export class RefError extends GitXError {
    /**
     * The reference name that caused the error.
     */
    refName;
    /**
     * The SHA that was expected or invalid.
     */
    sha;
    /**
     * Creates a new RefError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including refName, sha, and cause
     */
    constructor(message, code = 'INTERNAL', options) {
        super(message, code, options);
        this.name = 'RefError';
        this.refName = options?.refName;
        this.sha = options?.sha;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            refName: this.refName,
            sha: this.sha,
        };
    }
    /**
     * Creates a NOT_FOUND error for a reference.
     */
    static notFound(refName) {
        return new RefError(`Reference not found: ${refName}`, 'NOT_FOUND', { refName });
    }
    /**
     * Creates an ALREADY_EXISTS error for a reference.
     */
    static alreadyExists(refName) {
        return new RefError(`Reference already exists: ${refName}`, 'ALREADY_EXISTS', { refName });
    }
    /**
     * Creates an INVALID_NAME error for a reference.
     */
    static invalidName(refName, reason) {
        const msg = reason ? `Invalid reference name "${refName}": ${reason}` : `Invalid reference name: ${refName}`;
        return new RefError(msg, 'INVALID_NAME', { refName });
    }
}
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
export class ObjectError extends GitXError {
    /**
     * The SHA of the object that caused the error.
     */
    sha;
    /**
     * The expected object type.
     */
    expectedType;
    /**
     * The actual object type.
     */
    actualType;
    /**
     * Creates a new ObjectError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options
     */
    constructor(message, code = 'INTERNAL', options) {
        super(message, code, options);
        this.name = 'ObjectError';
        this.sha = options?.sha;
        this.expectedType = options?.expectedType;
        this.actualType = options?.actualType;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            sha: this.sha,
            expectedType: this.expectedType,
            actualType: this.actualType,
        };
    }
    /**
     * Creates a NOT_FOUND error for an object.
     */
    static notFound(sha) {
        return new ObjectError(`Object not found: ${sha}`, 'NOT_FOUND', { sha });
    }
    /**
     * Creates a CORRUPTED error for an object.
     */
    static corrupted(sha, reason) {
        const msg = reason ? `Object ${sha} is corrupted: ${reason}` : `Object ${sha} is corrupted`;
        return new ObjectError(msg, 'CORRUPTED', { sha });
    }
    /**
     * Creates an INVALID_TYPE error for an object.
     */
    static invalidType(sha, expected, actual) {
        return new ObjectError(`Object ${sha} has invalid type: expected ${expected}, got ${actual}`, 'INVALID_TYPE', {
            sha,
            expectedType: expected,
            actualType: actual,
        });
    }
}
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
export class RPCError extends GitXError {
    /**
     * Additional error data.
     */
    data;
    /**
     * Creates a new RPCError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options including data and cause
     */
    constructor(message, code = 'INTERNAL_ERROR', options) {
        super(message, code, options);
        this.name = 'RPCError';
        this.data = options?.data;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            data: this.data,
        };
    }
    /**
     * Converts to JSON-RPC error format.
     */
    toJSONRPC() {
        const codeMap = {
            PARSE_ERROR: -32700,
            INVALID_REQUEST: -32600,
            METHOD_NOT_FOUND: -32601,
            INVALID_PARAMS: -32602,
            INTERNAL_ERROR: -32603,
            TIMEOUT: -32000,
            CANCELLED: -32001,
        };
        return {
            code: codeMap[this.code] ?? -32603,
            message: this.message,
            data: this.data,
        };
    }
}
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
export class MigrationError extends GitXError {
    /**
     * The source version/tier.
     */
    sourceTier;
    /**
     * The target version/tier.
     */
    targetTier;
    /**
     * Whether rollback was performed.
     */
    rolledBack;
    /**
     * Creates a new MigrationError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param options - Additional options
     */
    constructor(message, code = 'INTERNAL', options) {
        super(message, code, options);
        this.name = 'MigrationError';
        this.sourceTier = options?.sourceTier;
        this.targetTier = options?.targetTier;
        this.rolledBack = options?.rolledBack;
    }
    toJSON() {
        return {
            ...super.toJSON(),
            sourceTier: this.sourceTier,
            targetTier: this.targetTier,
            rolledBack: this.rolledBack,
        };
    }
}
// =============================================================================
// Type Guards
// =============================================================================
/**
 * Checks if an error is a GitXError.
 */
export function isGitXError(error) {
    return error instanceof GitXError;
}
/**
 * Checks if an error is a StorageError.
 */
export function isStorageError(error) {
    return error instanceof StorageError;
}
/**
 * Checks if an error is a WireError.
 */
export function isWireError(error) {
    return error instanceof WireError;
}
/**
 * Checks if an error is an IcebergError.
 */
export function isIcebergError(error) {
    return error instanceof IcebergError;
}
/**
 * Checks if an error is a RefError.
 */
export function isRefError(error) {
    return error instanceof RefError;
}
/**
 * Checks if an error is an ObjectError.
 */
export function isObjectError(error) {
    return error instanceof ObjectError;
}
/**
 * Checks if an error is an RPCError.
 */
export function isRPCError(error) {
    return error instanceof RPCError;
}
/**
 * Checks if an error is a MigrationError.
 */
export function isMigrationError(error) {
    return error instanceof MigrationError;
}
/**
 * Checks if an error has a specific code.
 */
export function hasErrorCode(error, code) {
    return error instanceof GitXError && error.code === code;
}
//# sourceMappingURL=errors.js.map