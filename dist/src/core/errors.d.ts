/**
 * @fileoverview Git Error Classes (Platform Agnostic)
 *
 * This module defines error classes for Git operations. All errors
 * are platform-agnostic and can be used in any JavaScript runtime.
 *
 * These errors extend from GitXError for unified error handling across
 * the gitx.do library while maintaining backward compatibility.
 *
 * @module @dotdo/gitx/errors
 */
import { GitXError } from '../errors';
/**
 * Base class for all Git-related errors.
 *
 * @description
 * Extends GitXError to integrate with the unified error hierarchy
 * while maintaining backward compatibility with existing code.
 */
export declare class GitError extends GitXError {
    constructor(message: string, code?: string);
}
/**
 * Error thrown when a Git object is not found.
 */
export declare class ObjectNotFoundError extends GitError {
    readonly sha: string;
    constructor(sha: string);
}
/**
 * Error thrown when a Git object is corrupted or invalid.
 */
export declare class CorruptObjectError extends GitError {
    readonly sha: string | undefined;
    readonly objectType: string | undefined;
    constructor(message: string, sha?: string, objectType?: string);
}
/**
 * Error thrown when a reference is not found.
 */
export declare class RefNotFoundError extends GitError {
    readonly refName: string;
    constructor(refName: string);
}
/**
 * Error thrown when a reference name is invalid.
 */
export declare class InvalidRefNameError extends GitError {
    readonly refName: string;
    readonly reason: string | undefined;
    constructor(refName: string, reason?: string);
}
/**
 * Error thrown when a SHA-1 hash is invalid.
 */
export declare class InvalidShaError extends GitError {
    readonly sha: string;
    constructor(sha: string);
}
/**
 * Error thrown when a pack file is corrupted or invalid.
 */
export declare class PackFormatError extends GitError {
    readonly offset: number | undefined;
    constructor(message: string, offset?: number);
}
/**
 * Error thrown when delta application fails.
 */
export declare class DeltaError extends GitError {
    readonly baseSize: number | undefined;
    readonly expectedSize: number | undefined;
    readonly actualSize: number | undefined;
    constructor(message: string, options?: {
        baseSize?: number;
        expectedSize?: number;
        actualSize?: number;
    });
}
/**
 * Error thrown when a wire protocol message is invalid.
 */
export declare class ProtocolError extends GitError {
    readonly protocolCode: string | undefined;
    constructor(message: string, protocolCode?: string);
}
/**
 * Error thrown when an operation is not supported.
 */
export declare class NotSupportedError extends GitError {
    readonly operation: string;
    constructor(operation: string, message?: string);
}
/**
 * Error thrown when there's a conflict (e.g., merge conflict).
 */
export declare class ConflictError extends GitError {
    readonly path: string | undefined;
    readonly conflictType: 'merge' | 'rebase' | 'cherry-pick' | 'update' | undefined;
    constructor(message: string, path?: string, conflictType?: 'merge' | 'rebase' | 'cherry-pick' | 'update');
}
/**
 * Error thrown when storage operations fail.
 */
export declare class CoreStorageError extends GitError {
    readonly operation: string | undefined;
    readonly path: string | undefined;
    constructor(message: string, operation?: string, path?: string);
}
export { CoreStorageError as StorageError };
export { GitXError } from '../errors';
//# sourceMappingURL=errors.d.ts.map