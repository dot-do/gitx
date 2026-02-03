/**
 * @fileoverview Path Security Validation for Wire Protocol
 *
 * This module provides security validation for paths and refs received from
 * clients via the wire protocol. It prevents path traversal attacks and ensures
 * paths are properly normalized and scoped.
 *
 * @module wire/path-security
 *
 * ## Security Considerations
 *
 * - Prevents path traversal via `../` sequences
 * - Rejects absolute paths starting with `/` or drive letters
 * - Normalizes paths to remove redundant separators
 * - Validates ref names are within allowed namespace
 * - Blocks null bytes and other control characters
 *
 * @example
 * ```typescript
 * import { validateRefPath, validateRepositoryId, PathSecurityError } from './path-security'
 *
 * try {
 *   validateRefPath('refs/heads/main')  // OK
 *   validateRefPath('refs/../../../etc/passwd')  // Throws PathSecurityError
 * } catch (e) {
 *   if (e instanceof PathSecurityError) {
 *     console.error('Security violation:', e.message)
 *   }
 * }
 * ```
 */
import { WireError } from '../errors';
/**
 * Error thrown when a path security violation is detected.
 */
export declare class PathSecurityError extends WireError {
    constructor(message: string, code?: string);
}
/**
 * Result of path validation.
 */
export interface PathValidationResult {
    /** Whether the path is valid */
    valid: boolean;
    /** Error message if invalid */
    error?: string;
    /** Error code if invalid */
    code?: string;
    /** Normalized path (if valid) */
    normalizedPath?: string;
}
/**
 * Check if a path contains path traversal sequences.
 *
 * @param path - Path to check
 * @returns true if path traversal is detected
 */
export declare function containsPathTraversal(path: string): boolean;
/**
 * Check if a path is absolute.
 *
 * @param path - Path to check
 * @returns true if the path is absolute
 */
export declare function isAbsolutePath(path: string): boolean;
/**
 * Check if a path contains dangerous characters.
 *
 * @param path - Path to check
 * @returns Object with valid status and optional error
 */
export declare function containsDangerousCharacters(path: string): {
    dangerous: boolean;
    reason?: string;
};
/**
 * Normalize a path by removing redundant separators and resolving . components.
 * Does NOT resolve .. components - those should be rejected.
 *
 * @param path - Path to normalize
 * @returns Normalized path
 */
export declare function normalizePath(path: string): string;
/**
 * Validate a ref path for security issues.
 *
 * @description
 * Validates a Git ref path to ensure it:
 * - Does not contain path traversal sequences
 * - Is not an absolute path
 * - Does not contain dangerous characters
 * - Starts with a valid ref prefix (refs/, HEAD)
 *
 * @param refPath - Ref path to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateRefPath('refs/heads/main')
 * // result.valid === true
 *
 * const badResult = validateRefPath('refs/heads/../../../etc/passwd')
 * // badResult.valid === false
 * // badResult.error === 'path traversal detected'
 * ```
 */
export declare function validateRefPath(refPath: string): PathValidationResult;
/**
 * Validate a repository identifier for security issues.
 *
 * @description
 * Validates a repository identifier to ensure it:
 * - Does not contain path traversal sequences
 * - Is not an absolute path
 * - Does not contain dangerous characters
 * - Contains only allowed characters (alphanumeric, dash, underscore, dot, slash)
 *
 * @param repoId - Repository identifier to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateRepositoryId('my-org/my-repo')
 * // result.valid === true
 *
 * const badResult = validateRepositoryId('../../../etc/passwd')
 * // badResult.valid === false
 * ```
 */
export declare function validateRepositoryId(repoId: string): PathValidationResult;
/**
 * Validate and sanitize a ref name for security.
 *
 * @description
 * Combines Git ref name validation with security checks.
 * This should be used in addition to the standard validateRefName function.
 *
 * @param refName - Ref name to validate
 * @throws {PathSecurityError} If security violation detected
 * @returns Normalized ref name
 *
 * @example
 * ```typescript
 * const safe = validateSecureRefName('refs/heads/main')  // 'refs/heads/main'
 * validateSecureRefName('refs/../etc/passwd')  // throws PathSecurityError
 * ```
 */
export declare function validateSecureRefName(refName: string): string;
/**
 * Validate and sanitize a repository identifier for security.
 *
 * @param repoId - Repository identifier to validate
 * @throws {PathSecurityError} If security violation detected
 * @returns Normalized repository identifier
 */
export declare function validateSecureRepositoryId(repoId: string): string;
//# sourceMappingURL=path-security.d.ts.map