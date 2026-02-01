import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AccessControl,
  createPermissionMiddleware,
  unauthorizedResponse,
  forbiddenResponse,
  accessDeniedResponse,
} from '../../src/access/middleware'
import type { AuthContext, PermissionContext } from '../../src/access/middleware'
import { InMemoryPermissionStorage } from '../../src/access/storage'

// ============================================================================
// Helpers
// ============================================================================

function authenticatedAuth(userId = 'user-1', overrides: Partial<AuthContext> = {}): AuthContext {
  return { authenticated: true, userId, ...overrides }
}

function anonymousAuth(): AuthContext {
  return { authenticated: false }
}

const REPO_ID = 'org/my-repo'

// ============================================================================
// AccessControl
// ============================================================================

describe('AccessControl', () => {
  let storage: InMemoryPermissionStorage
  let ac: AccessControl

  beforeEach(() => {
    storage = new InMemoryPermissionStorage()
    ac = new AccessControl(storage)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // getEffectivePermission
  // ──────────────────────────────────────────────────────────────────────────

  describe('getEffectivePermission', () => {
    it('should return none for anonymous user by default', async () => {
      const perm = await ac.getEffectivePermission(anonymousAuth(), REPO_ID)
      expect(perm).toBe('none')
    })

    it('should return none for authenticated user with no grants', async () => {
      const perm = await ac.getEffectivePermission(authenticatedAuth(), REPO_ID)
      expect(perm).toBe('none')
    })

    it('should return the granted permission', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const perm = await ac.getEffectivePermission(authenticatedAuth('user-1'), REPO_ID)
      expect(perm).toBe('write')
    })

    it('should return read for anonymous user when allowAnonymousPublicRead is true and repo is public', async () => {
      const publicAc = new AccessControl(storage, { allowAnonymousPublicRead: true })
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'public',
        ownerId: 'owner-1',
        allowAnonymousRead: true,
      })
      const perm = await publicAc.getEffectivePermission(anonymousAuth(), REPO_ID)
      expect(perm).toBe('read')
    })

    it('should return none for anonymous user when repo is private even with allowAnonymousPublicRead', async () => {
      const publicAc = new AccessControl(storage, { allowAnonymousPublicRead: true })
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'private',
        ownerId: 'owner-1',
      })
      const perm = await publicAc.getEffectivePermission(anonymousAuth(), REPO_ID)
      expect(perm).toBe('none')
    })

    it('should return none for unauthenticated user (userId missing)', async () => {
      const auth: AuthContext = { authenticated: true } // no userId
      const perm = await ac.getEffectivePermission(auth, REPO_ID)
      expect(perm).toBe('none')
    })

    it('should use getEffectivePermission from storage when available (team-based)', async () => {
      await storage.grantTeamPermission!({
        teamId: 'team-dev',
        repoId: REPO_ID,
        permission: 'write',
      })
      const auth = authenticatedAuth('user-1', { teams: ['team-dev'] })
      const perm = await ac.getEffectivePermission(auth, REPO_ID)
      expect(perm).toBe('write')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // checkOperation
  // ──────────────────────────────────────────────────────────────────────────

  describe('checkOperation', () => {
    it('should allow operation when user has sufficient permission', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const result = await ac.checkOperation(authenticatedAuth('user-1'), REPO_ID, 'push')
      expect(result.allowed).toBe(true)
    })

    it('should deny operation when user lacks permission', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      const result = await ac.checkOperation(authenticatedAuth('user-1'), REPO_ID, 'push')
      expect(result.allowed).toBe(false)
      expect(result.reason).toBeDefined()
    })

    it('should deny anonymous user from any operation by default', async () => {
      const result = await ac.checkOperation(anonymousAuth(), REPO_ID, 'clone')
      expect(result.allowed).toBe(false)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // checkGitService
  // ──────────────────────────────────────────────────────────────────────────

  describe('checkGitService', () => {
    it('should map git-upload-pack to fetch (read)', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      const result = await ac.checkGitService(authenticatedAuth('user-1'), REPO_ID, 'git-upload-pack')
      expect(result.allowed).toBe(true)
    })

    it('should map git-receive-pack to push (write)', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      const result = await ac.checkGitService(authenticatedAuth('user-1'), REPO_ID, 'git-receive-pack')
      expect(result.allowed).toBe(false)
    })

    it('should allow git-receive-pack for write users', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const result = await ac.checkGitService(authenticatedAuth('user-1'), REPO_ID, 'git-receive-pack')
      expect(result.allowed).toBe(true)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // requirePermission
  // ──────────────────────────────────────────────────────────────────────────

  describe('requirePermission', () => {
    it('should allow when user meets required level', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'admin' })
      const result = await ac.requirePermission(authenticatedAuth('user-1'), REPO_ID, 'write')
      expect(result.allowed).toBe(true)
      expect(result.actualPermission).toBe('admin')
    })

    it('should deny when user does not meet required level', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      const result = await ac.requirePermission(authenticatedAuth('user-1'), REPO_ID, 'admin')
      expect(result.allowed).toBe(false)
      expect(result.requiredPermission).toBe('admin')
      expect(result.actualPermission).toBe('read')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // buildPermissionContext
  // ──────────────────────────────────────────────────────────────────────────

  describe('buildPermissionContext', () => {
    it('should merge auth context with permission data', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const auth = authenticatedAuth('user-1', { email: 'u@test.com' })
      const ctx = await ac.buildPermissionContext(auth, REPO_ID)

      expect(ctx.authenticated).toBe(true)
      expect(ctx.userId).toBe('user-1')
      expect(ctx.email).toBe('u@test.com')
      expect(ctx.permission).toBe('write')
      expect(ctx.repoId).toBe(REPO_ID)
      expect(ctx.permissionRecord).toBeDefined()
      expect(ctx.permissionRecord!.permission).toBe('write')
    })

    it('should include repo settings when available', async () => {
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'public',
        ownerId: 'owner-1',
      })
      const ctx = await ac.buildPermissionContext(authenticatedAuth(), REPO_ID)
      expect(ctx.repoSettings).toBeDefined()
      expect(ctx.repoSettings!.visibility).toBe('public')
    })

    it('should handle anonymous user without error', async () => {
      const ctx = await ac.buildPermissionContext(anonymousAuth(), REPO_ID)
      expect(ctx.permission).toBe('none')
      expect(ctx.permissionRecord).toBeUndefined()
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // grantPermission (admin operation)
  // ──────────────────────────────────────────────────────────────────────────

  describe('grantPermission', () => {
    it('should succeed when admin grants permission to another user', async () => {
      await storage.grantPermission({ userId: 'admin-1', repoId: REPO_ID, permission: 'admin' })
      const result = await ac.grantPermission(
        authenticatedAuth('admin-1'),
        REPO_ID,
        'user-2',
        'write',
      )
      expect(result.success).toBe(true)

      // Verify the grant took effect
      const perm = await storage.getPermission('user-2', REPO_ID)
      expect(perm).not.toBeNull()
      expect(perm!.permission).toBe('write')
      expect(perm!.grantedBy).toBe('admin-1')
    })

    it('should fail when non-admin tries to grant', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const result = await ac.grantPermission(
        authenticatedAuth('user-1'),
        REPO_ID,
        'user-2',
        'read',
      )
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should support expiresAt option', async () => {
      await storage.grantPermission({ userId: 'admin-1', repoId: REPO_ID, permission: 'admin' })
      const expires = Date.now() + 86400000
      await ac.grantPermission(
        authenticatedAuth('admin-1'),
        REPO_ID,
        'user-2',
        'read',
        { expiresAt: expires },
      )
      const perm = await storage.getPermission('user-2', REPO_ID)
      expect(perm!.expiresAt).toBe(expires)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // revokePermission (admin operation)
  // ──────────────────────────────────────────────────────────────────────────

  describe('revokePermission', () => {
    it('should succeed when admin revokes another user', async () => {
      await storage.grantPermission({ userId: 'admin-1', repoId: REPO_ID, permission: 'admin' })
      await storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'write' })

      const result = await ac.revokePermission(authenticatedAuth('admin-1'), REPO_ID, 'user-2')
      expect(result.success).toBe(true)

      const perm = await storage.getPermission('user-2', REPO_ID)
      expect(perm).toBeNull()
    })

    it('should fail when non-admin tries to revoke', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const result = await ac.revokePermission(authenticatedAuth('user-1'), REPO_ID, 'user-2')
      expect(result.success).toBe(false)
    })

    it('should prevent owner from revoking their own permission', async () => {
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'private',
        ownerId: 'admin-1',
      })
      await storage.grantPermission({ userId: 'admin-1', repoId: REPO_ID, permission: 'admin' })

      const result = await ac.revokePermission(authenticatedAuth('admin-1'), REPO_ID, 'admin-1')
      expect(result.success).toBe(false)
      expect(result.error).toContain('owner')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // listPermissions
  // ──────────────────────────────────────────────────────────────────────────

  describe('listPermissions', () => {
    it('should list all permissions when admin', async () => {
      await storage.grantPermission({ userId: 'admin-1', repoId: REPO_ID, permission: 'admin' })
      await storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'write' })
      await storage.grantPermission({ userId: 'user-3', repoId: REPO_ID, permission: 'read' })

      const result = await ac.listPermissions(authenticatedAuth('admin-1'), REPO_ID)
      expect(result.error).toBeUndefined()
      expect(result.permissions).toHaveLength(3)
    })

    it('should deny listing when non-admin', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      const result = await ac.listPermissions(authenticatedAuth('user-1'), REPO_ID)
      expect(result.error).toBeDefined()
      expect(result.permissions).toBeUndefined()
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // updateRepoSettings
  // ──────────────────────────────────────────────────────────────────────────

  describe('updateRepoSettings', () => {
    it('should update settings when admin', async () => {
      await storage.grantPermission({ userId: 'admin-1', repoId: REPO_ID, permission: 'admin' })
      const result = await ac.updateRepoSettings(authenticatedAuth('admin-1'), {
        repoId: REPO_ID,
        visibility: 'public',
        ownerId: 'admin-1',
      })
      expect(result.success).toBe(true)
    })

    it('should deny settings update when non-admin', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const result = await ac.updateRepoSettings(authenticatedAuth('user-1'), {
        repoId: REPO_ID,
        visibility: 'public',
        ownerId: 'user-1',
      })
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// createPermissionMiddleware
// ============================================================================

describe('createPermissionMiddleware', () => {
  let storage: InMemoryPermissionStorage

  beforeEach(() => {
    storage = new InMemoryPermissionStorage()
  })

  describe('requirePermission', () => {
    it('should call handler when user has sufficient permission', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const middleware = createPermissionMiddleware(storage)
      const handler = vi.fn(async (_req: Request, ctx: PermissionContext) => {
        return new Response(`ok:${ctx.permission}`)
      })

      const wrappedHandler = middleware.requirePermission('write', handler)
      const result = await wrappedHandler(new Request('http://test'), authenticatedAuth('user-1'), REPO_ID)

      expect(handler).toHaveBeenCalledOnce()
      expect(result).toBeInstanceOf(Response)
    })

    it('should return 403 when user lacks permission', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      const middleware = createPermissionMiddleware(storage)
      const handler = vi.fn()

      const wrappedHandler = middleware.requirePermission('admin', handler)
      const result = await wrappedHandler(new Request('http://test'), authenticatedAuth('user-1'), REPO_ID)

      expect(handler).not.toHaveBeenCalled()
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(403)
    })

    it('should return 403 with JSON body for denied request', async () => {
      const middleware = createPermissionMiddleware(storage)
      const handler = vi.fn()

      const wrappedHandler = middleware.requirePermission('write', handler)
      const result = await wrappedHandler(new Request('http://test'), authenticatedAuth('user-1'), REPO_ID) as Response

      const body = await result.json() as { error: string }
      expect(body.error).toBeDefined()
      expect(result.headers.get('Content-Type')).toBe('application/json')
    })
  })

  describe('requireOperation', () => {
    it('should call handler when operation is allowed', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const middleware = createPermissionMiddleware(storage)
      const handler = vi.fn(async () => new Response('ok'))

      const wrappedHandler = middleware.requireOperation('push', handler)
      await wrappedHandler(new Request('http://test'), authenticatedAuth('user-1'), REPO_ID)

      expect(handler).toHaveBeenCalledOnce()
    })

    it('should return 403 when operation is denied', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      const middleware = createPermissionMiddleware(storage)
      const handler = vi.fn()

      const wrappedHandler = middleware.requireOperation('push', handler)
      const result = await wrappedHandler(new Request('http://test'), authenticatedAuth('user-1'), REPO_ID)

      expect(handler).not.toHaveBeenCalled()
      expect((result as Response).status).toBe(403)
    })
  })

  describe('requireAuth', () => {
    it('should call handler for authenticated users', async () => {
      const middleware = createPermissionMiddleware(storage)
      const handler = vi.fn(async () => new Response('ok'))

      const wrappedHandler = middleware.requireAuth(handler)
      await wrappedHandler(new Request('http://test'), authenticatedAuth('user-1'), REPO_ID)

      expect(handler).toHaveBeenCalledOnce()
    })

    it('should return 401 for unauthenticated users', async () => {
      const middleware = createPermissionMiddleware(storage)
      const handler = vi.fn()

      const wrappedHandler = middleware.requireAuth(handler)
      const result = await wrappedHandler(new Request('http://test'), anonymousAuth(), REPO_ID)

      expect(handler).not.toHaveBeenCalled()
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(401)
    })

    it('should return 401 when authenticated but no userId', async () => {
      const middleware = createPermissionMiddleware(storage)
      const handler = vi.fn()

      const wrappedHandler = middleware.requireAuth(handler)
      const result = await wrappedHandler(
        new Request('http://test'),
        { authenticated: true },
        REPO_ID,
      )

      expect(handler).not.toHaveBeenCalled()
      expect((result as Response).status).toBe(401)
    })

    it('should return 401 JSON body with error message', async () => {
      const middleware = createPermissionMiddleware(storage)
      const handler = vi.fn()

      const wrappedHandler = middleware.requireAuth(handler)
      const result = await wrappedHandler(new Request('http://test'), anonymousAuth(), REPO_ID) as Response

      const body = await result.json() as { error: string }
      expect(body.error).toBe('Authentication required')
    })
  })

  describe('checkAccess', () => {
    it('should return access check result without wrapping handler', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const middleware = createPermissionMiddleware(storage)

      const result = await middleware.checkAccess(authenticatedAuth('user-1'), REPO_ID, 'push')
      expect(result.allowed).toBe(true)
    })

    it('should return denied result for insufficient permission', async () => {
      const middleware = createPermissionMiddleware(storage)

      const result = await middleware.checkAccess(authenticatedAuth('user-1'), REPO_ID, 'push')
      expect(result.allowed).toBe(false)
    })
  })
})

// ============================================================================
// HTTP Response Helpers
// ============================================================================

describe('unauthorizedResponse', () => {
  it('should return 401 status', () => {
    const res = unauthorizedResponse()
    expect(res.status).toBe(401)
  })

  it('should include WWW-Authenticate header', () => {
    const res = unauthorizedResponse()
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="Git Repository"')
  })

  it('should use default message', async () => {
    const res = unauthorizedResponse()
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Authentication required')
  })

  it('should use custom message', async () => {
    const res = unauthorizedResponse('Token expired')
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Token expired')
  })
})

describe('forbiddenResponse', () => {
  it('should return 403 status', () => {
    const res = forbiddenResponse()
    expect(res.status).toBe(403)
  })

  it('should use default message', async () => {
    const res = forbiddenResponse()
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Permission denied')
  })

  it('should use custom message', async () => {
    const res = forbiddenResponse('No write access')
    const body = await res.json() as { error: string }
    expect(body.error).toBe('No write access')
  })
})

describe('accessDeniedResponse', () => {
  it('should return 401 when user has no permission (none)', () => {
    const res = accessDeniedResponse({
      allowed: false,
      reason: 'No access',
      actualPermission: 'none',
    })
    expect(res.status).toBe(401)
  })

  it('should return 403 when user has some permission but not enough', () => {
    const res = accessDeniedResponse({
      allowed: false,
      reason: 'Insufficient',
      actualPermission: 'read',
    })
    expect(res.status).toBe(403)
  })

  it('should throw if called with an allowed result', () => {
    expect(() =>
      accessDeniedResponse({ allowed: true })
    ).toThrow()
  })

  it('should include the reason in the body', async () => {
    const res = accessDeniedResponse({
      allowed: false,
      reason: 'Needs admin',
      actualPermission: 'write',
    })
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Needs admin')
  })
})
