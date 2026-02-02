/**
 * @fileoverview Repository Access Control Module
 *
 * This module provides repository-level access control for Git repositories.
 * It includes:
 * - Permission model (read, write, admin)
 * - Permission storage (SQL, in-memory)
 * - Middleware for checking permissions on operations
 *
 * @module access
 *
 * @example Basic usage
 * ```typescript
 * import {
 *   AccessControl,
 *   InMemoryPermissionStorage,
 *   AuthContext,
 *   Permission,
 *   hasPermission,
 *   checkAccess,
 * } from './access'
 *
 * // Create storage and access control
 * const storage = new InMemoryPermissionStorage()
 * const accessControl = new AccessControl(storage)
 *
 * // Grant permission
 * await storage.grantPermission({
 *   userId: 'user-123',
 *   repoId: 'org/repo',
 *   permission: 'write',
 *   grantedBy: 'admin-456'
 * })
 *
 * // Check permission
 * const auth: AuthContext = { authenticated: true, userId: 'user-123' }
 * const result = await accessControl.checkOperation(auth, 'org/repo', 'push')
 * if (result.allowed) {
 *   // Proceed with operation
 * }
 * ```
 */
export { hasPermission, getRequiredPermission, checkAccess, comparePermissions, getHighestPermission, isPermissionExpired, isReadOperation, isWriteOperation, isAdminOperation, isValidPermission, isValidPermissionLevel, isValidOperation, isValidVisibility, getAllowedOperations, getPermissionDescription, } from './permissions';
export { SqlPermissionStorage, InMemoryPermissionStorage } from './storage';
export { AccessControl, createPermissionMiddleware, unauthorizedResponse, forbiddenResponse, accessDeniedResponse, } from './middleware';
//# sourceMappingURL=index.js.map