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

import type {
  Permission,
  PermissionLevel,
  RepositoryOperation,
  AccessCheckResult,
  UserPermission,
  RepositoryAccessSettings,
} from './permissions'
import {
  checkAccess,
  hasPermission,
} from './permissions'
import type { PermissionStorage } from './storage'
import type { GitService } from '../wire/smart-http'

// ============================================================================
// Auth Context Types
// ============================================================================

/**
 * Authentication context passed from auth layer.
 *
 * @description
 * Contains information about the authenticated user. This is typically
 * populated by an auth middleware before the permission middleware runs.
 */
export interface AuthContext {
  /** Whether the request is authenticated */
  authenticated: boolean
  /** User ID (if authenticated) */
  userId?: string
  /** User's email (if available) */
  email?: string
  /** User's display name (if available) */
  name?: string
  /** Team IDs the user belongs to (for team-based permissions) */
  teams?: string[]
  /** Organization ID (if applicable) */
  organizationId?: string
  /** Whether this is an API token (vs session) */
  isToken?: boolean
  /** Token scopes (for API tokens) */
  scopes?: string[]
  /** Additional auth metadata */
  metadata?: Record<string, unknown>
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
  permission: PermissionLevel
  /** The repository ID being accessed */
  repoId: string
  /** Repository settings (if available) */
  repoSettings?: RepositoryAccessSettings
  /** The specific permission record (if from direct grant) */
  permissionRecord?: UserPermission
}

/**
 * Operation context for detailed access checking.
 */
export interface OperationContext {
  /** Repository being accessed */
  repoId: string
  /** Specific operation being performed */
  operation: RepositoryOperation
  /** Git service (for HTTP protocol operations) */
  gitService?: GitService
  /** Target ref (for ref operations) */
  refName?: string
  /** Additional context */
  metadata?: Record<string, unknown>
}

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
  private storage: PermissionStorage
  private options: AccessControlOptions

  constructor(storage: PermissionStorage, options: AccessControlOptions = {}) {
    this.storage = storage
    this.options = {
      allowPublicRead: options.allowPublicRead ?? true,
      allowAnonymousPublicRead: options.allowAnonymousPublicRead ?? false,
      defaultVisibility: options.defaultVisibility ?? 'private',
      requireAuthForWrite: options.requireAuthForWrite ?? true,
    }
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
  async getEffectivePermission(auth: AuthContext, repoId: string): Promise<PermissionLevel> {
    // Anonymous users
    if (!auth.authenticated || !auth.userId) {
      // Check if public read is allowed
      if (this.options.allowAnonymousPublicRead) {
        const settings = await this.storage.getRepoSettings?.(repoId)
        if (settings?.visibility === 'public' && settings.allowAnonymousRead) {
          return 'read'
        }
      }
      return 'none'
    }

    // Use storage's effective permission if available
    if (this.storage.getEffectivePermission) {
      return this.storage.getEffectivePermission(auth.userId, repoId, auth.teams)
    }

    // Fallback: check direct permission only
    const permission = await this.storage.getPermission(auth.userId, repoId)
    return permission?.permission ?? 'none'
  }

  /**
   * Check if a user can perform an operation.
   *
   * @param auth - Authentication context
   * @param repoId - Repository identifier
   * @param operation - The operation to check
   * @returns Access check result
   */
  async checkOperation(
    auth: AuthContext,
    repoId: string,
    operation: RepositoryOperation
  ): Promise<AccessCheckResult> {
    // Get effective permission
    const permission = await this.getEffectivePermission(auth, repoId)

    // Check if permission is sufficient
    return checkAccess(permission, operation)
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
  async checkGitService(
    auth: AuthContext,
    repoId: string,
    service: GitService
  ): Promise<AccessCheckResult> {
    const operation: RepositoryOperation = service === 'git-upload-pack' ? 'fetch' : 'push'
    return this.checkOperation(auth, repoId, operation)
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
  async requirePermission(
    auth: AuthContext,
    repoId: string,
    requiredPermission: Permission
  ): Promise<AccessCheckResult> {
    const userPermission = await this.getEffectivePermission(auth, repoId)
    const allowed = hasPermission(userPermission, requiredPermission)

    if (allowed) {
      return {
        allowed: true,
        requiredPermission,
        actualPermission: userPermission,
      }
    }

    return {
      allowed: false,
      reason: `Insufficient permission: requires ${requiredPermission}, user has ${userPermission}`,
      requiredPermission,
      actualPermission: userPermission,
    }
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
  async buildPermissionContext(auth: AuthContext, repoId: string): Promise<PermissionContext> {
    const permission = await this.getEffectivePermission(auth, repoId)
    const repoSettings = await this.storage.getRepoSettings?.(repoId)
    const permissionRecord =
      auth.userId ? await this.storage.getPermission(auth.userId, repoId) : null

    return {
      ...auth,
      permission,
      repoId,
      repoSettings: repoSettings ?? undefined,
      permissionRecord: permissionRecord ?? undefined,
    }
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
  async grantPermission(
    adminAuth: AuthContext,
    repoId: string,
    targetUserId: string,
    permission: Permission,
    options?: { expiresAt?: number; metadata?: Record<string, unknown> }
  ): Promise<{ success: boolean; error?: string }> {
    // Check admin has permission to manage permissions
    const accessCheck = await this.checkOperation(adminAuth, repoId, 'manage_permissions')
    if (!accessCheck.allowed) {
      return { success: false, error: accessCheck.reason }
    }

    // Grant the permission
    await this.storage.grantPermission({
      userId: targetUserId,
      repoId,
      permission,
      grantedBy: adminAuth.userId,
      grantedAt: Date.now(),
      expiresAt: options?.expiresAt,
      metadata: options?.metadata,
    })

    return { success: true }
  }

  /**
   * Revoke permission (requires admin).
   *
   * @param adminAuth - Admin user's auth context
   * @param repoId - Repository identifier
   * @param targetUserId - User to revoke permission from
   * @returns Result of the revoke operation
   */
  async revokePermission(
    adminAuth: AuthContext,
    repoId: string,
    targetUserId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Check admin has permission
    const accessCheck = await this.checkOperation(adminAuth, repoId, 'manage_permissions')
    if (!accessCheck.allowed) {
      return { success: false, error: accessCheck.reason }
    }

    // Prevent revoking own admin permission
    if (adminAuth.userId === targetUserId) {
      // Check if user is the owner
      const settings = await this.storage.getRepoSettings?.(repoId)
      if (settings?.ownerId === targetUserId) {
        return { success: false, error: 'Cannot revoke owner permission' }
      }
    }

    await this.storage.revokePermission(targetUserId, repoId)
    return { success: true }
  }

  /**
   * List all permissions for a repository (requires admin).
   *
   * @param adminAuth - Admin user's auth context
   * @param repoId - Repository identifier
   * @returns List of permissions or error
   */
  async listPermissions(
    adminAuth: AuthContext,
    repoId: string
  ): Promise<{ permissions?: UserPermission[]; error?: string }> {
    const accessCheck = await this.checkOperation(adminAuth, repoId, 'manage_permissions')
    if (!accessCheck.allowed) {
      return { error: accessCheck.reason }
    }

    const permissions = await this.storage.listRepoPermissions(repoId)
    return { permissions }
  }

  /**
   * Update repository access settings (requires admin).
   *
   * @param adminAuth - Admin user's auth context
   * @param settings - New settings to apply
   * @returns Result of the update operation
   */
  async updateRepoSettings(
    adminAuth: AuthContext,
    settings: RepositoryAccessSettings
  ): Promise<{ success: boolean; error?: string }> {
    const accessCheck = await this.checkOperation(adminAuth, settings.repoId, 'update_settings')
    if (!accessCheck.allowed) {
      return { success: false, error: accessCheck.reason }
    }

    if (this.storage.updateRepoSettings) {
      await this.storage.updateRepoSettings(settings)
      return { success: true }
    }

    return { success: false, error: 'Repository settings not supported' }
  }
}

/**
 * Access control options.
 */
export interface AccessControlOptions {
  /** Allow public repositories to be read without authentication */
  allowPublicRead?: boolean
  /** Allow anonymous (unauthenticated) read access to public repos */
  allowAnonymousPublicRead?: boolean
  /** Default visibility for new repositories */
  defaultVisibility?: 'public' | 'internal' | 'private'
  /** Require authentication for all write operations */
  requireAuthForWrite?: boolean
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Request handler type.
 */
export type RequestHandler<T = unknown> = (
  request: Request,
  context: PermissionContext
) => Promise<T>

/**
 * Middleware result with handler.
 */
export interface PermissionMiddleware {
  /**
   * Create a handler that requires a specific permission.
   */
  requirePermission: <T>(
    permission: Permission,
    handler: RequestHandler<T>
  ) => (request: Request, auth: AuthContext, repoId: string) => Promise<T | Response>

  /**
   * Create a handler that requires permission for an operation.
   */
  requireOperation: <T>(
    operation: RepositoryOperation,
    handler: RequestHandler<T>
  ) => (request: Request, auth: AuthContext, repoId: string) => Promise<T | Response>

  /**
   * Create a handler that requires any authenticated access.
   */
  requireAuth: <T>(
    handler: RequestHandler<T>
  ) => (request: Request, auth: AuthContext, repoId: string) => Promise<T | Response>

  /**
   * Check access without wrapping a handler.
   */
  checkAccess: (
    auth: AuthContext,
    repoId: string,
    operation: RepositoryOperation
  ) => Promise<AccessCheckResult>
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
export function createPermissionMiddleware(
  storage: PermissionStorage,
  options?: AccessControlOptions
): PermissionMiddleware {
  const accessControl = new AccessControl(storage, options)

  const requirePermission = <T>(
    permission: Permission,
    handler: RequestHandler<T>
  ) => {
    return async (
      request: Request,
      auth: AuthContext,
      repoId: string
    ): Promise<T | Response> => {
      const result = await accessControl.requirePermission(auth, repoId, permission)

      if (!result.allowed) {
        return new Response(JSON.stringify({ error: result.reason }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const context = await accessControl.buildPermissionContext(auth, repoId)
      return handler(request, context)
    }
  }

  const requireOperation = <T>(
    operation: RepositoryOperation,
    handler: RequestHandler<T>
  ) => {
    return async (
      request: Request,
      auth: AuthContext,
      repoId: string
    ): Promise<T | Response> => {
      const result = await accessControl.checkOperation(auth, repoId, operation)

      if (!result.allowed) {
        return new Response(JSON.stringify({ error: result.reason }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const context = await accessControl.buildPermissionContext(auth, repoId)
      return handler(request, context)
    }
  }

  const requireAuth = <T>(handler: RequestHandler<T>) => {
    return async (
      request: Request,
      auth: AuthContext,
      repoId: string
    ): Promise<T | Response> => {
      if (!auth.authenticated || !auth.userId) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const context = await accessControl.buildPermissionContext(auth, repoId)
      return handler(request, context)
    }
  }

  const checkAccessFn = async (
    auth: AuthContext,
    repoId: string,
    operation: RepositoryOperation
  ): Promise<AccessCheckResult> => {
    return accessControl.checkOperation(auth, repoId, operation)
  }

  return {
    requirePermission,
    requireOperation,
    requireAuth,
    checkAccess: checkAccessFn,
  }
}

// ============================================================================
// HTTP Response Helpers
// ============================================================================

/**
 * Create a 401 Unauthorized response.
 */
export function unauthorizedResponse(message = 'Authentication required'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Basic realm="Git Repository"',
    },
  })
}

/**
 * Create a 403 Forbidden response.
 */
export function forbiddenResponse(message = 'Permission denied'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create an appropriate error response based on access check result.
 */
export function accessDeniedResponse(result: AccessCheckResult): Response {
  if (result.allowed) {
    throw new Error('accessDeniedResponse called with allowed result')
  }

  const status = result.actualPermission === 'none' ? 401 : 403
  return new Response(JSON.stringify({ error: result.reason }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
