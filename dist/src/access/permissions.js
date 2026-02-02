/**
 * @fileoverview Repository Access Control - Permission Model
 *
 * This module defines the permission model for repository-level access control.
 * It provides types and utilities for managing read, write, and admin permissions
 * on Git repositories.
 *
 * @module access/permissions
 *
 * ## Permission Levels
 *
 * - **read**: Can clone, fetch, view refs and objects
 * - **write**: Can push, create branches, create tags
 * - **admin**: Full access including settings, permissions, and deletion
 *
 * ## Permission Hierarchy
 *
 * Permissions are hierarchical: admin implies write, write implies read.
 *
 * ```
 * admin > write > read > none
 * ```
 *
 * @example Basic usage
 * ```typescript
 * import {
 *   Permission,
 *   hasPermission,
 *   checkAccess,
 *   UserPermission
 * } from './access/permissions'
 *
 * // Check if user has required permission
 * const userPerm: UserPermission = {
 *   userId: 'user-123',
 *   repoId: 'org/repo',
 *   permission: 'write'
 * }
 *
 * if (hasPermission(userPerm.permission, 'read')) {
 *   // User can read the repository
 * }
 *
 * // Check access for an operation
 * const result = checkAccess(userPerm.permission, 'push')
 * if (!result.allowed) {
 *   console.error(result.reason)
 * }
 * ```
 */
// ============================================================================
// Permission Constants
// ============================================================================
/**
 * Permission hierarchy levels (higher number = more access).
 * @internal
 */
const PERMISSION_LEVELS = {
    none: 0,
    read: 1,
    write: 2,
    admin: 3,
};
/**
 * Mapping of operations to minimum required permission.
 * @internal
 */
const OPERATION_PERMISSIONS = {
    // Read operations
    clone: 'read',
    fetch: 'read',
    read_refs: 'read',
    read_objects: 'read',
    list_branches: 'read',
    list_tags: 'read',
    // Write operations
    push: 'write',
    create_branch: 'write',
    delete_branch: 'write',
    create_tag: 'write',
    delete_tag: 'write',
    force_push: 'write',
    // Admin operations
    manage_permissions: 'admin',
    delete_repo: 'admin',
    update_settings: 'admin',
    manage_hooks: 'admin',
    manage_protected_branches: 'admin',
};
// ============================================================================
// Permission Checking Functions
// ============================================================================
/**
 * Check if a permission level is sufficient for another.
 *
 * @description
 * Checks if the user's permission level meets or exceeds the required level.
 * Permissions are hierarchical: admin > write > read > none.
 *
 * @param userPermission - The user's current permission level
 * @param requiredPermission - The minimum required permission level
 * @returns true if user has sufficient permission
 *
 * @example
 * ```typescript
 * hasPermission('admin', 'write')  // true - admin can write
 * hasPermission('write', 'read')   // true - write implies read
 * hasPermission('read', 'write')   // false - read cannot write
 * hasPermission('none', 'read')    // false - no permission
 * ```
 */
export function hasPermission(userPermission, requiredPermission) {
    const userLevel = PERMISSION_LEVELS[userPermission];
    const requiredLevel = PERMISSION_LEVELS[requiredPermission];
    return userLevel >= requiredLevel;
}
/**
 * Get the required permission for an operation.
 *
 * @param operation - The repository operation
 * @returns The minimum permission required for the operation
 *
 * @example
 * ```typescript
 * getRequiredPermission('clone')           // 'read'
 * getRequiredPermission('push')            // 'write'
 * getRequiredPermission('manage_permissions')  // 'admin'
 * ```
 */
export function getRequiredPermission(operation) {
    return OPERATION_PERMISSIONS[operation];
}
/**
 * Check if a user can perform an operation.
 *
 * @description
 * Checks if the user's permission level allows them to perform
 * the specified operation on the repository.
 *
 * @param userPermission - The user's current permission level
 * @param operation - The operation to check
 * @returns Access check result with allowed status and reason
 *
 * @example
 * ```typescript
 * const result = checkAccess('write', 'push')
 * if (result.allowed) {
 *   // Proceed with push
 * } else {
 *   console.error(`Access denied: ${result.reason}`)
 * }
 * ```
 */
export function checkAccess(userPermission, operation) {
    const requiredPermission = getRequiredPermission(operation);
    const allowed = hasPermission(userPermission, requiredPermission);
    if (allowed) {
        return {
            allowed: true,
            requiredPermission,
            actualPermission: userPermission,
        };
    }
    return {
        allowed: false,
        reason: `Insufficient permission: ${operation} requires ${requiredPermission}, user has ${userPermission}`,
        requiredPermission,
        actualPermission: userPermission,
    };
}
/**
 * Compare two permission levels.
 *
 * @param a - First permission level
 * @param b - Second permission level
 * @returns Negative if a < b, zero if equal, positive if a > b
 *
 * @example
 * ```typescript
 * comparePermissions('admin', 'write')  // 1 (admin > write)
 * comparePermissions('read', 'write')   // -1 (read < write)
 * comparePermissions('write', 'write')  // 0 (equal)
 * ```
 */
export function comparePermissions(a, b) {
    return PERMISSION_LEVELS[a] - PERMISSION_LEVELS[b];
}
/**
 * Get the highest permission from an array of permissions.
 *
 * @description
 * Useful when a user has multiple permission sources (direct, team, org)
 * and you need to determine their effective permission.
 *
 * @param permissions - Array of permission levels
 * @returns The highest permission level, or 'none' if empty
 *
 * @example
 * ```typescript
 * getHighestPermission(['read', 'write', 'read'])  // 'write'
 * getHighestPermission(['admin', 'write'])         // 'admin'
 * getHighestPermission([])                          // 'none'
 * ```
 */
export function getHighestPermission(permissions) {
    if (permissions.length === 0)
        return 'none';
    return permissions.reduce((highest, current) => {
        return comparePermissions(current, highest) > 0 ? current : highest;
    }, 'none');
}
/**
 * Check if a permission has expired.
 *
 * @param permission - The user permission to check
 * @param now - Current timestamp (defaults to Date.now())
 * @returns true if the permission has expired
 */
export function isPermissionExpired(permission, now) {
    if (!permission.expiresAt)
        return false;
    return (now ?? Date.now()) >= permission.expiresAt;
}
/**
 * Check if an operation is a read operation.
 *
 * @param operation - The operation to check
 * @returns true if the operation only requires read access
 */
export function isReadOperation(operation) {
    return getRequiredPermission(operation) === 'read';
}
/**
 * Check if an operation is a write operation.
 *
 * @param operation - The operation to check
 * @returns true if the operation requires write access (but not admin)
 */
export function isWriteOperation(operation) {
    return getRequiredPermission(operation) === 'write';
}
/**
 * Check if an operation is an admin operation.
 *
 * @param operation - The operation to check
 * @returns true if the operation requires admin access
 */
export function isAdminOperation(operation) {
    return getRequiredPermission(operation) === 'admin';
}
// ============================================================================
// Permission Validation
// ============================================================================
/**
 * Validate a permission string.
 *
 * @param value - Value to validate
 * @returns true if the value is a valid Permission
 */
export function isValidPermission(value) {
    return value === 'read' || value === 'write' || value === 'admin';
}
/**
 * Validate a permission level string (including 'none').
 *
 * @param value - Value to validate
 * @returns true if the value is a valid PermissionLevel
 */
export function isValidPermissionLevel(value) {
    return value === 'none' || isValidPermission(value);
}
/**
 * Validate a repository operation string.
 *
 * @param value - Value to validate
 * @returns true if the value is a valid RepositoryOperation
 */
export function isValidOperation(value) {
    return typeof value === 'string' && value in OPERATION_PERMISSIONS;
}
/**
 * Validate a repository visibility string.
 *
 * @param value - Value to validate
 * @returns true if the value is a valid RepositoryVisibility
 */
export function isValidVisibility(value) {
    return value === 'public' || value === 'internal' || value === 'private';
}
// ============================================================================
// Permission String Helpers
// ============================================================================
/**
 * Get all operations for a permission level.
 *
 * @description
 * Returns all operations that a user with the given permission level can perform.
 *
 * @param permission - The permission level
 * @returns Array of allowed operations
 *
 * @example
 * ```typescript
 * getAllowedOperations('read')   // ['clone', 'fetch', 'read_refs', ...]
 * getAllowedOperations('write')  // [...read ops, 'push', 'create_branch', ...]
 * getAllowedOperations('admin')  // all operations
 * ```
 */
export function getAllowedOperations(permission) {
    if (permission === 'none')
        return [];
    return Object.entries(OPERATION_PERMISSIONS)
        .filter(([, required]) => hasPermission(permission, required))
        .map(([op]) => op);
}
/**
 * Human-readable permission description.
 *
 * @param permission - The permission level
 * @returns Description of what the permission allows
 */
export function getPermissionDescription(permission) {
    switch (permission) {
        case 'none':
            return 'No access to the repository';
        case 'read':
            return 'Can clone, fetch, and view repository contents';
        case 'write':
            return 'Can push commits, create branches and tags';
        case 'admin':
            return 'Full access including settings and permissions management';
    }
}
//# sourceMappingURL=permissions.js.map