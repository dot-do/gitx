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
 *   AccessAuthContext,
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
 * const auth: AccessAuthContext = { authenticated: true, userId: 'user-123' }
 * const result = await accessControl.checkOperation(auth, 'org/repo', 'push')
 * if (result.allowed) {
 *   // Proceed with operation
 * }
 * ```
 */
export type { Permission, NoPermission, PermissionLevel, RepositoryOperation, UserPermission, TeamPermission, AccessCheckResult, RepositoryVisibility, RepositoryAccessSettings, } from './permissions';
export { hasPermission, getRequiredPermission, checkAccess, comparePermissions, getHighestPermission, isPermissionExpired, isReadOperation, isWriteOperation, isAdminOperation, isValidPermission, isValidPermissionLevel, isValidOperation, isValidVisibility, getAllowedOperations, getPermissionDescription, } from './permissions';
export type { SqlStorageInterface, PermissionStorage } from './storage';
export { SqlPermissionStorage, InMemoryPermissionStorage } from './storage';
export type { AuthContext as AccessAuthContext, PermissionContext, OperationContext, AccessControlOptions, RequestHandler, PermissionMiddleware, } from './middleware';
export { AccessControl, createPermissionMiddleware, unauthorizedResponse, forbiddenResponse, accessDeniedResponse, } from './middleware';
//# sourceMappingURL=index.d.ts.map