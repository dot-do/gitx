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
import type { Permission, PermissionLevel, RepositoryOperation, AccessCheckResult, UserPermission, RepositoryAccessSettings } from './permissions';
import type { PermissionStorage } from './storage';
import type { GitService } from '../wire/smart-http';
/**
 * Authentication context passed from auth layer.
 *
 * @description
 * Contains information about the authenticated user. This is typically
 * populated by an auth middleware before the permission middleware runs.
 */
export interface AuthContext {
    /** Whether the request is authenticated */
    authenticated: boolean;
    /** User ID (if authenticated) */
    userId?: string;
    /** User's email (if available) */
    email?: string;
    /** User's display name (if available) */
    name?: string;
    /** Team IDs the user belongs to (for team-based permissions) */
    teams?: string[];
    /** Organization ID (if applicable) */
    organizationId?: string;
    /** Whether this is an API token (vs session) */
    isToken?: boolean;
    /** Token scopes (for API tokens) */
    scopes?: string[];
    /** Additional auth metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Permission context after access check.
 *
 * @description
 * Extended context that includes permission information after
 * the access check has been performed.
 */
export interface PermissionContext extends AuthContext {
    /** The user's effective permission for this repository */
    permission: PermissionLevel;
    /** The repository ID being accessed */
    repoId: string;
    /** Repository settings (if available) */
    repoSettings?: RepositoryAccessSettings;
    /** The specific permission record (if from direct grant) */
    permissionRecord?: UserPermission;
}
/**
 * Operation context for detailed access checking.
 */
export interface OperationContext {
    /** Repository being accessed */
    repoId: string;
    /** Specific operation being performed */
    operation: RepositoryOperation;
    /** Git service (for HTTP protocol operations) */
    gitService?: GitService;
    /** Target ref (for ref operations) */
    refName?: string;
    /** Additional context */
    metadata?: Record<string, unknown>;
}
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
export declare class AccessControl {
    private storage;
    private options;
    constructor(storage: PermissionStorage, options?: AccessControlOptions);
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
    getEffectivePermission(auth: AuthContext, repoId: string): Promise<PermissionLevel>;
    /**
     * Check if a user can perform an operation.
     *
     * @param auth - Authentication context
     * @param repoId - Repository identifier
     * @param operation - The operation to check
     * @returns Access check result
     */
    checkOperation(auth: AuthContext, repoId: string, operation: RepositoryOperation): Promise<AccessCheckResult>;
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
    checkGitService(auth: AuthContext, repoId: string, service: GitService): Promise<AccessCheckResult>;
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
    requirePermission(auth: AuthContext, repoId: string, requiredPermission: Permission): Promise<AccessCheckResult>;
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
    buildPermissionContext(auth: AuthContext, repoId: string): Promise<PermissionContext>;
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
    grantPermission(adminAuth: AuthContext, repoId: string, targetUserId: string, permission: Permission, options?: {
        expiresAt?: number;
        metadata?: Record<string, unknown>;
    }): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Revoke permission (requires admin).
     *
     * @param adminAuth - Admin user's auth context
     * @param repoId - Repository identifier
     * @param targetUserId - User to revoke permission from
     * @returns Result of the revoke operation
     */
    revokePermission(adminAuth: AuthContext, repoId: string, targetUserId: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * List all permissions for a repository (requires admin).
     *
     * @param adminAuth - Admin user's auth context
     * @param repoId - Repository identifier
     * @returns List of permissions or error
     */
    listPermissions(adminAuth: AuthContext, repoId: string): Promise<{
        permissions?: UserPermission[];
        error?: string;
    }>;
    /**
     * Update repository access settings (requires admin).
     *
     * @param adminAuth - Admin user's auth context
     * @param settings - New settings to apply
     * @returns Result of the update operation
     */
    updateRepoSettings(adminAuth: AuthContext, settings: RepositoryAccessSettings): Promise<{
        success: boolean;
        error?: string;
    }>;
}
/**
 * Access control options.
 */
export interface AccessControlOptions {
    /** Allow public repositories to be read without authentication */
    allowPublicRead?: boolean;
    /** Allow anonymous (unauthenticated) read access to public repos */
    allowAnonymousPublicRead?: boolean;
    /** Default visibility for new repositories */
    defaultVisibility?: 'public' | 'internal' | 'private';
    /** Require authentication for all write operations */
    requireAuthForWrite?: boolean;
}
/**
 * Request handler type.
 */
export type RequestHandler<T = unknown> = (request: Request, context: PermissionContext) => Promise<T>;
/**
 * Middleware result with handler.
 */
export interface PermissionMiddleware {
    /**
     * Create a handler that requires a specific permission.
     */
    requirePermission: <T>(permission: Permission, handler: RequestHandler<T>) => (request: Request, auth: AuthContext, repoId: string) => Promise<T | Response>;
    /**
     * Create a handler that requires permission for an operation.
     */
    requireOperation: <T>(operation: RepositoryOperation, handler: RequestHandler<T>) => (request: Request, auth: AuthContext, repoId: string) => Promise<T | Response>;
    /**
     * Create a handler that requires any authenticated access.
     */
    requireAuth: <T>(handler: RequestHandler<T>) => (request: Request, auth: AuthContext, repoId: string) => Promise<T | Response>;
    /**
     * Check access without wrapping a handler.
     */
    checkAccess: (auth: AuthContext, repoId: string, operation: RepositoryOperation) => Promise<AccessCheckResult>;
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
export declare function createPermissionMiddleware(storage: PermissionStorage, options?: AccessControlOptions): PermissionMiddleware;
/**
 * Create a 401 Unauthorized response.
 */
export declare function unauthorizedResponse(message?: string): Response;
/**
 * Create a 403 Forbidden response.
 */
export declare function forbiddenResponse(message?: string): Response;
/**
 * Create an appropriate error response based on access check result.
 */
export declare function accessDeniedResponse(result: AccessCheckResult): Response;
//# sourceMappingURL=middleware.d.ts.map