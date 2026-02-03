/**
 * @fileoverview Storage Interface Types
 *
 * This module defines the canonical interfaces for object storage and commit providers.
 * All storage-related interfaces are defined here as the single source of truth.
 *
 * The interfaces follow a layered design:
 * - {@link BasicObjectStore} - Core object CRUD operations
 * - {@link RefObjectStore} - Adds ref management capabilities
 * - {@link TreeDiffObjectStore} - Specialized for tree diff operations
 * - {@link ObjectStore} - Full-featured store combining all capabilities
 *
 * Similarly for commit providers:
 * - {@link BasicCommitProvider} - Core commit retrieval
 * - {@link CommitProvider} - Extended with path filtering and tree access
 *
 * @module types/storage
 *
 * @example
 * ```typescript
 * import type { ObjectStore, CommitProvider } from './types/storage'
 *
 * // Implement a storage backend
 * class MyObjectStore implements ObjectStore {
 *   async getObject(sha: string) { ... }
 *   async storeObject(type: ObjectType, data: Uint8Array) { ... }
 *   // ... other methods
 * }
 * ```
 */
import { isValidSha, isValidObjectType } from './objects';
/**
 * Validate a ref name.
 *
 * @description
 * Checks if a ref name follows Git ref naming conventions:
 * - Cannot start with '.' or end with '/'
 * - Cannot contain '..' or '//'
 * - Cannot contain control characters, spaces, or special chars
 * - Cannot end with '.lock'
 *
 * @param refName - The ref name to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * validateRefName('refs/heads/main') // { isValid: true }
 * validateRefName('refs/heads/../foo') // { isValid: false, error: '...' }
 * ```
 */
export function validateRefName(refName) {
    if (!refName || typeof refName !== 'string') {
        return { isValid: false, error: 'Ref name is required and must be a string' };
    }
    if (refName.startsWith('.') || refName.startsWith('/')) {
        return { isValid: false, error: 'Ref name cannot start with "." or "/"' };
    }
    if (refName.endsWith('/') || refName.endsWith('.')) {
        return { isValid: false, error: 'Ref name cannot end with "/" or "."' };
    }
    if (refName.includes('..')) {
        return { isValid: false, error: 'Ref name cannot contain ".."' };
    }
    if (refName.includes('//')) {
        return { isValid: false, error: 'Ref name cannot contain "//"' };
    }
    if (refName.endsWith('.lock')) {
        return { isValid: false, error: 'Ref name cannot end with ".lock"' };
    }
    // Check for control characters and special chars
    if (/[\x00-\x1f\x7f ~^:?*\[\\]/.test(refName)) {
        return { isValid: false, error: 'Ref name contains invalid characters (control chars, space, ~, ^, :, ?, *, [, or \\)' };
    }
    return { isValid: true };
}
/**
 * Validate a ref update operation.
 *
 * @description
 * Validates a reference update operation including:
 * - Ref name format
 * - Old and new SHA validity (or zero SHA for create/delete)
 *
 * @param refName - The ref name to update
 * @param oldSha - The expected current SHA (or zero SHA if creating)
 * @param newSha - The new SHA to set (or zero SHA if deleting)
 * @returns Validation result
 *
 * @example
 * ```typescript
 * // Creating a new ref
 * validateRefUpdate('refs/heads/feature', ZERO_SHA, 'abc123...')
 *
 * // Updating a ref
 * validateRefUpdate('refs/heads/main', 'old123...', 'new456...')
 *
 * // Deleting a ref
 * validateRefUpdate('refs/heads/old', 'abc123...', ZERO_SHA)
 * ```
 */
export function validateRefUpdate(refName, oldSha, newSha) {
    const refResult = validateRefName(refName);
    if (!refResult.isValid) {
        return refResult;
    }
    const ZERO_SHA = '0000000000000000000000000000000000000000';
    if (oldSha !== ZERO_SHA && !isValidSha(oldSha)) {
        return { isValid: false, error: `Invalid old SHA: ${oldSha}. Must be 40 hex chars or zero SHA` };
    }
    if (newSha !== ZERO_SHA && !isValidSha(newSha)) {
        return { isValid: false, error: `Invalid new SHA: ${newSha}. Must be 40 hex chars or zero SHA` };
    }
    if (oldSha === ZERO_SHA && newSha === ZERO_SHA) {
        return { isValid: false, error: 'Cannot have both old and new SHA as zero (no-op)' };
    }
    return { isValid: true };
}
/**
 * Validate object storage parameters.
 *
 * @description
 * Validates parameters for storeObject operations:
 * - Object type must be valid
 * - Data must be a Uint8Array
 *
 * @param type - The object type
 * @param data - The object data
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateStoreParams('blob', new Uint8Array([1, 2, 3]))
 * if (!result.isValid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export function validateStoreParams(type, data) {
    if (!isValidObjectType(type)) {
        return { isValid: false, error: `Invalid object type: ${type}. Must be blob, tree, commit, or tag` };
    }
    if (!(data instanceof Uint8Array)) {
        return { isValid: false, error: 'Data must be a Uint8Array' };
    }
    return { isValid: true };
}
// Note: assertValidSha is exported from ./objects and re-exported via types/index.ts
// We use assertValidShaFromObjects internally here to avoid circular dependencies
/**
 * Assert that a ref name is valid, throwing if not.
 *
 * @description
 * Throws a descriptive error if the ref name is invalid.
 * Use this for input validation in API boundaries.
 *
 * @param refName - The ref name to validate
 *
 * @throws {Error} If ref name is empty or not a string
 * @throws {Error} If ref name starts with '.' or '/'
 * @throws {Error} If ref name ends with '/', '.', or '.lock'
 * @throws {Error} If ref name contains '..', '//', or invalid characters (control chars, space, ~, ^, :, ?, *, [, \)
 *
 * @example
 * ```typescript
 * assertValidRefName('refs/heads/main') // OK
 * assertValidRefName('refs/../bad') // Throws
 * ```
 */
export function assertValidRefName(refName) {
    const result = validateRefName(refName);
    if (!result.isValid) {
        throw new Error(result.error);
    }
}
//# sourceMappingURL=storage.js.map