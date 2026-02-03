/**
 * @fileoverview Repository Access Control - Permission Middleware
 *
 * This module provides middleware for checking permissions on repository
 * operations. It integrates with the permission storage and auth layer
 * to enforce access control.
 *
 * @module access/middleware
 *
 * ## Middleware Integration
 *
 * The middleware intercepts requests and verifies that the authenticated
 * user has sufficient permissions to perform the requested operation.
 *
 * @example Basic usage with handlers
 * ```typescript
 * import { AccessControl, AuthContext } from './access/middleware'
 *
 * // Create access control instance
 * const accessControl = new AccessControl(permissionStorage)
 *
 * // Check permission in a handler
 * async function handlePush(request: Request, auth: AuthContext) {
 *   const result = await accessControl.checkOperation(auth, repoId, 'push')
 *   if (!result.allowed) {
 *     return new Response(result.reason, { status: 403 })
 *   }
 *   // Proceed with push...
 * }
 * ```
 *
 * @example Using as middleware
 * ```typescript
 * import { createPermissionMiddleware } from './access/middleware'
 *
 * const middleware = createPermissionMiddleware(permissionStorage)
 *
 * // Apply to route handler
 * const handler = middleware.requirePermission('write', async (req, ctx) => {
 *   // ctx.permission is guaranteed to be at least 'write'
 *   return handlePush(req, ctx)
 * })
 * ```
 */
import { checkAccess, hasPermission, } from './permissions';
// ============================================================================
// Access Control Class
// ============================================================================
/**
 * Access control manager.
 *
 * @description
 * Centralizes permission checking logic, integrating with the permission
 * storage to determine if users can perform operations.
 *
 * @example
 * ```typescript
 * const accessControl = new AccessControl(storage, {
 *   allowPublicRead: true,
 *   defaultVisibility: 'private'
 * })
 *
 * // Check if user can push
 * const result = await accessControl.checkOperation(auth, 'org/repo', 'push')
 * ```
 */
export class AccessControl {
    storage;
    options;
    constructor(storage, options = {}) {
        this.storage = storage;
        this.options = {
            allowPublicRead: options.allowPublicRead ?? true,
            allowAnonymousPublicRead: options.allowAnonymousPublicRead ?? false,
            defaultVisibility: options.defaultVisibility ?? 'private',
            requireAuthForWrite: options.requireAuthForWrite ?? true,
        };
    }
    /**
     * Get a user's effective permission for a repository.
     *
     * @description
     * Computes the user's effective permission considering:
     * - Direct user permissions
     * - Team permissions
     * - Repository visibility settings
     * - Owner status
     *
     * @param auth - Authentication context
     * @param repoId - Repository identifier
     * @returns The user's effective permission level
     */
    async getEffectivePermission(auth, repoId) {
        // Anonymous users
        if (!auth.authenticated || !auth.userId) {
            // Check if public read is allowed
            if (this.options.allowAnonymousPublicRead) {
                const settings = await this.storage.getRepoSettings?.(repoId);
                if (settings?.visibility === 'public' && settings.allowAnonymousRead) {
                    return 'read';
                }
            }
            return 'none';
        }
        // Use storage's effective permission if available
        if (this.storage.getEffectivePermission) {
            return this.storage.getEffectivePermission(auth.userId, repoId, auth.teams);
        }
        // Fallback: check direct permission only
        const permission = await this.storage.getPermission(auth.userId, repoId);
        return permission?.permission ?? 'none';
    }
    /**
     * Check if a user can perform an operation.
     *
     * @param auth - Authentication context
     * @param repoId - Repository identifier
     * @param operation - The operation to check
     * @returns Access check result
     */
    async checkOperation(auth, repoId, operation) {
        // Get effective permission
        const permission = await this.getEffectivePermission(auth, repoId);
        // Check if permission is sufficient
        return checkAccess(permission, operation);
    }
    /**
     * Check permission for a Git service operation.
     *
     * @description
     * Maps Git services to operations and checks permission:
     * - `git-upload-pack`: requires 'read' (clone/fetch)
     * - `git-receive-pack`: requires 'write' (push)
     *
     * @param auth - Authentication context
     * @param repoId - Repository identifier
     * @param service - Git service being accessed
     * @returns Access check result
     */
    async checkGitService(auth, repoId, service) {
        const operation = service === 'git-upload-pack' ? 'fetch' : 'push';
        return this.checkOperation(auth, repoId, operation);
    }
    /**
     * Require a minimum permission level.
     *
     * @description
     * Checks if the user has at least the required permission level.
     * Useful for generic permission checks without a specific operation.
     *
     * @param auth - Authentication context
     * @param repoId - Repository identifier
     * @param requiredPermission - Minimum permission level required
     * @returns Access check result
     */
    async requirePermission(auth, repoId, requiredPermission) {
        const userPermission = await this.getEffectivePermission(auth, repoId);
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
            reason: `Insufficient permission: requires ${requiredPermission}, user has ${userPermission}`,
            requiredPermission,
            actualPermission: userPermission,
        };
    }
    /**
     * Build a full permission context for a request.
     *
     * @description
     * Combines auth context with permission information for downstream handlers.
     *
     * @param auth - Authentication context
     * @param repoId - Repository identifier
     * @returns Full permission context
     */
    async buildPermissionContext(auth, repoId) {
        const permission = await this.getEffectivePermission(auth, repoId);
        const repoSettings = await this.storage.getRepoSettings?.(repoId);
        const permissionRecord = auth.userId ? await this.storage.getPermission(auth.userId, repoId) : null;
        const ctx = {
            ...auth,
            permission,
            repoId
        };
        if (repoSettings) {
            ctx.repoSettings = repoSettings;
        }
        if (permissionRecord) {
            ctx.permissionRecord = permissionRecord;
        }
        return ctx;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Admin Operations
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Grant permission (requires admin).
     *
     * @param adminAuth - Admin user's auth context
     * @param repoId - Repository identifier
     * @param targetUserId - User to grant permission to
     * @param permission - Permission level to grant
     * @param options - Additional options
     * @returns Result of the grant operation
     */
    async grantPermission(adminAuth, repoId, targetUserId, permission, options) {
        // Check admin has permission to manage permissions
        const accessCheck = await this.checkOperation(adminAuth, repoId, 'manage_permissions');
        if (!accessCheck.allowed) {
            const result = { success: false };
            if (accessCheck.reason) {
                result.error = accessCheck.reason;
            }
            return result;
        }
        // Grant the permission
        const userPermission = {
            userId: targetUserId,
            repoId,
            permission,
            grantedAt: Date.now()
        };
        if (adminAuth.userId) {
            userPermission.grantedBy = adminAuth.userId;
        }
        if (options?.expiresAt !== undefined) {
            userPermission.expiresAt = options.expiresAt;
        }
        if (options?.metadata !== undefined) {
            userPermission.metadata = options.metadata;
        }
        await this.storage.grantPermission(userPermission);
        return { success: true };
    }
    /**
     * Revoke permission (requires admin).
     *
     * @param adminAuth - Admin user's auth context
     * @param repoId - Repository identifier
     * @param targetUserId - User to revoke permission from
     * @returns Result of the revoke operation
     */
    async revokePermission(adminAuth, repoId, targetUserId) {
        // Check admin has permission
        const accessCheck = await this.checkOperation(adminAuth, repoId, 'manage_permissions');
        if (!accessCheck.allowed) {
            const result = { success: false };
            if (accessCheck.reason) {
                result.error = accessCheck.reason;
            }
            return result;
        }
        // Prevent revoking own admin permission
        if (adminAuth.userId === targetUserId) {
            // Check if user is the owner
            const settings = await this.storage.getRepoSettings?.(repoId);
            if (settings?.ownerId === targetUserId) {
                return { success: false, error: 'Cannot revoke owner permission' };
            }
        }
        await this.storage.revokePermission(targetUserId, repoId);
        return { success: true };
    }
    /**
     * List all permissions for a repository (requires admin).
     *
     * @param adminAuth - Admin user's auth context
     * @param repoId - Repository identifier
     * @returns List of permissions or error
     */
    async listPermissions(adminAuth, repoId) {
        const accessCheck = await this.checkOperation(adminAuth, repoId, 'manage_permissions');
        if (!accessCheck.allowed) {
            const result = {};
            if (accessCheck.reason) {
                result.error = accessCheck.reason;
            }
            return result;
        }
        const permissions = await this.storage.listRepoPermissions(repoId);
        return { permissions };
    }
    /**
     * Update repository access settings (requires admin).
     *
     * @param adminAuth - Admin user's auth context
     * @param settings - New settings to apply
     * @returns Result of the update operation
     */
    async updateRepoSettings(adminAuth, settings) {
        const accessCheck = await this.checkOperation(adminAuth, settings.repoId, 'update_settings');
        if (!accessCheck.allowed) {
            const result = { success: false };
            if (accessCheck.reason) {
                result.error = accessCheck.reason;
            }
            return result;
        }
        if (this.storage.updateRepoSettings) {
            await this.storage.updateRepoSettings(settings);
            return { success: true };
        }
        return { success: false, error: 'Repository settings not supported' };
    }
}
/**
 * Create permission middleware.
 *
 * @description
 * Factory function that creates middleware helpers for enforcing
 * permissions on request handlers.
 *
 * @param storage - Permission storage backend
 * @param options - Access control options
 * @returns Middleware helpers
 *
 * @example
 * ```typescript
 * const middleware = createPermissionMiddleware(storage)
 *
 * // Handler that requires write permission
 * const pushHandler = middleware.requirePermission('write', async (req, ctx) => {
 *   // ctx.permission is guaranteed to be at least 'write'
 *   return await handlePush(req, ctx)
 * })
 *
 * // Use in route
 * app.post('/repos/:owner/:repo/git/receive-pack', async (req) => {
 *   const auth = getAuthContext(req)
 *   const repoId = `${req.params.owner}/${req.params.repo}`
 *   return pushHandler(req, auth, repoId)
 * })
 * ```
 */
export function createPermissionMiddleware(storage, options) {
    const accessControl = new AccessControl(storage, options);
    const requirePermission = (permission, handler) => {
        return async (request, auth, repoId) => {
            const result = await accessControl.requirePermission(auth, repoId, permission);
            if (!result.allowed) {
                return new Response(JSON.stringify({ error: result.reason }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            const context = await accessControl.buildPermissionContext(auth, repoId);
            return handler(request, context);
        };
    };
    const requireOperation = (operation, handler) => {
        return async (request, auth, repoId) => {
            const result = await accessControl.checkOperation(auth, repoId, operation);
            if (!result.allowed) {
                return new Response(JSON.stringify({ error: result.reason }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            const context = await accessControl.buildPermissionContext(auth, repoId);
            return handler(request, context);
        };
    };
    const requireAuth = (handler) => {
        return async (request, auth, repoId) => {
            if (!auth.authenticated || !auth.userId) {
                return new Response(JSON.stringify({ error: 'Authentication required' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            const context = await accessControl.buildPermissionContext(auth, repoId);
            return handler(request, context);
        };
    };
    const checkAccessFn = async (auth, repoId, operation) => {
        return accessControl.checkOperation(auth, repoId, operation);
    };
    return {
        requirePermission,
        requireOperation,
        requireAuth,
        checkAccess: checkAccessFn,
    };
}
// ============================================================================
// HTTP Response Helpers
// ============================================================================
/**
 * Create a 401 Unauthorized response.
 */
export function unauthorizedResponse(message = 'Authentication required') {
    return new Response(JSON.stringify({ error: message }), {
        status: 401,
        headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Basic realm="Git Repository"',
        },
    });
}
/**
 * Create a 403 Forbidden response.
 */
export function forbiddenResponse(message = 'Permission denied') {
    return new Response(JSON.stringify({ error: message }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
    });
}
/**
 * Create an appropriate error response based on access check result.
 */
export function accessDeniedResponse(result) {
    if (result.allowed) {
        throw new Error('accessDeniedResponse called with allowed result');
    }
    const status = result.actualPermission === 'none' ? 401 : 403;
    return new Response(JSON.stringify({ error: result.reason }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
//# sourceMappingURL=middleware.js.map