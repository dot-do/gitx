import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryPermissionStorage, SqlPermissionStorage } from '../../src/access/storage'
import type { SqlStorageInterface } from '../../src/access/storage'
import type { UserPermission, TeamPermission, RepositoryAccessSettings } from '../../src/access/permissions'

// ============================================================================
// Mock SQL backend (mimics Durable Object SQLite storage)
// ============================================================================

class MockSqlStorage implements SqlStorageInterface {
  private tables: Map<string, Array<Record<string, unknown>>> = new Map()

  exec(query: string, ...params: unknown[]): { toArray(): unknown[] } {
    const trimmed = query.trim().toUpperCase()

    if (trimmed.startsWith('CREATE TABLE') || trimmed.startsWith('CREATE INDEX')) {
      // Extract table name for CREATE TABLE
      const tableMatch = query.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)
      if (tableMatch && !this.tables.has(tableMatch[1])) {
        this.tables.set(tableMatch[1], [])
      }
      return { toArray: () => [] }
    }

    if (trimmed.startsWith('INSERT OR REPLACE')) {
      return this.handleInsertOrReplace(query, params)
    }

    if (trimmed.startsWith('DELETE')) {
      return this.handleDelete(query, params)
    }

    if (trimmed.startsWith('SELECT')) {
      return this.handleSelect(query, params)
    }

    return { toArray: () => [] }
  }

  private handleInsertOrReplace(query: string, params: unknown[]): { toArray(): unknown[] } {
    const tableMatch = query.match(/INSERT OR REPLACE INTO (\w+)/i)
    if (!tableMatch) return { toArray: () => [] }
    const tableName = tableMatch[1]

    const colsMatch = query.match(/\(([^)]+)\)\s*VALUES/i)
    if (!colsMatch) return { toArray: () => [] }
    const columns = colsMatch[1].split(',').map(c => c.trim())

    const row: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = params[i] ?? null
    }

    const table = this.tables.get(tableName) ?? []
    if (!this.tables.has(tableName)) {
      this.tables.set(tableName, table)
    }

    // Determine primary key columns based on table
    let pkCols: string[]
    if (tableName === 'user_permissions') pkCols = ['user_id', 'repo_id']
    else if (tableName === 'team_permissions') pkCols = ['team_id', 'repo_id']
    else if (tableName === 'repo_settings') pkCols = ['repo_id']
    else pkCols = []

    // Replace existing row with same primary key
    const existingIdx = table.findIndex(existing =>
      pkCols.every(pk => existing[pk] === row[pk])
    )
    if (existingIdx >= 0) {
      table[existingIdx] = row
    } else {
      table.push(row)
    }

    return { toArray: () => [] }
  }

  private handleDelete(query: string, params: unknown[]): { toArray(): unknown[] } {
    const tableMatch = query.match(/DELETE FROM (\w+)/i)
    if (!tableMatch) return { toArray: () => [] }
    const tableName = tableMatch[1]
    const table = this.tables.get(tableName)
    if (!table) return { toArray: () => [] }

    const whereMatch = query.match(/WHERE (.+)/i)
    if (!whereMatch) {
      // DELETE all
      this.tables.set(tableName, [])
      return { toArray: () => [] }
    }

    const conditions = whereMatch[1].split(/\s+AND\s+/i)
    const filters: Array<{ col: string; paramIdx: number }> = []
    conditions.forEach((cond, idx) => {
      const colMatch = cond.match(/(\w+)\s*=\s*\?/i)
      if (colMatch) {
        filters.push({ col: colMatch[1], paramIdx: idx })
      }
    })

    this.tables.set(
      tableName,
      table.filter(row => !filters.every(f => row[f.col] === params[f.paramIdx]))
    )

    return { toArray: () => [] }
  }

  private handleSelect(query: string, params: unknown[]): { toArray(): unknown[] } {
    const tableMatch = query.match(/FROM (\w+)/i)
    if (!tableMatch) return { toArray: () => [] }
    const tableName = tableMatch[1]
    const table = this.tables.get(tableName) ?? []

    const whereMatch = query.match(/WHERE (.+)/i)
    if (!whereMatch) return { toArray: () => [...table] }

    const conditions = whereMatch[1].split(/\s+AND\s+/i)
    const filters: Array<{ col: string; paramIdx: number }> = []
    conditions.forEach((cond, idx) => {
      const colMatch = cond.match(/(\w+)\s*=\s*\?/i)
      if (colMatch) {
        filters.push({ col: colMatch[1], paramIdx: idx })
      }
    })

    const filtered = table.filter(row =>
      filters.every(f => row[f.col] === params[f.paramIdx])
    )

    return { toArray: () => filtered }
  }
}

const REPO_ID = 'org/test-repo'
const REPO_ID_2 = 'org/other-repo'

// ============================================================================
// InMemoryPermissionStorage
// ============================================================================

describe('InMemoryPermissionStorage', () => {
  let storage: InMemoryPermissionStorage

  beforeEach(() => {
    storage = new InMemoryPermissionStorage()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // User Permission CRUD
  // ──────────────────────────────────────────────────────────────────────────

  describe('grantPermission / getPermission', () => {
    it('should store and retrieve a permission', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const perm = await storage.getPermission('user-1', REPO_ID)
      expect(perm).not.toBeNull()
      expect(perm!.userId).toBe('user-1')
      expect(perm!.repoId).toBe(REPO_ID)
      expect(perm!.permission).toBe('write')
    })

    it('should return null for non-existent permission', async () => {
      const perm = await storage.getPermission('user-999', REPO_ID)
      expect(perm).toBeNull()
    })

    it('should overwrite permission on re-grant', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'admin' })
      const perm = await storage.getPermission('user-1', REPO_ID)
      expect(perm!.permission).toBe('admin')
    })

    it('should set grantedAt automatically if not provided', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      const perm = await storage.getPermission('user-1', REPO_ID)
      expect(perm!.grantedAt).toBeDefined()
      expect(typeof perm!.grantedAt).toBe('number')
    })

    it('should return null for expired permission', async () => {
      await storage.grantPermission({
        userId: 'user-1',
        repoId: REPO_ID,
        permission: 'write',
        expiresAt: Date.now() - 1000,
      })
      const perm = await storage.getPermission('user-1', REPO_ID)
      expect(perm).toBeNull()
    })

    it('should keep separate permissions per user and repo', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID_2, permission: 'admin' })
      await storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'write' })

      expect((await storage.getPermission('user-1', REPO_ID))!.permission).toBe('read')
      expect((await storage.getPermission('user-1', REPO_ID_2))!.permission).toBe('admin')
      expect((await storage.getPermission('user-2', REPO_ID))!.permission).toBe('write')
    })
  })

  describe('revokePermission', () => {
    it('should remove a granted permission', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      await storage.revokePermission('user-1', REPO_ID)
      const perm = await storage.getPermission('user-1', REPO_ID)
      expect(perm).toBeNull()
    })

    it('should not throw when revoking non-existent permission', async () => {
      await expect(storage.revokePermission('user-999', REPO_ID)).resolves.toBeUndefined()
    })
  })

  describe('listRepoPermissions', () => {
    it('should list all permissions for a repository', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      await storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'write' })
      await storage.grantPermission({ userId: 'user-3', repoId: REPO_ID_2, permission: 'admin' })

      const perms = await storage.listRepoPermissions(REPO_ID)
      expect(perms).toHaveLength(2)
      expect(perms.map(p => p.userId).sort()).toEqual(['user-1', 'user-2'])
    })

    it('should exclude expired permissions', async () => {
      await storage.grantPermission({
        userId: 'user-1',
        repoId: REPO_ID,
        permission: 'read',
        expiresAt: Date.now() - 1000,
      })
      await storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'write' })

      const perms = await storage.listRepoPermissions(REPO_ID)
      expect(perms).toHaveLength(1)
      expect(perms[0].userId).toBe('user-2')
    })

    it('should return empty array for repo with no permissions', async () => {
      const perms = await storage.listRepoPermissions('nonexistent/repo')
      expect(perms).toEqual([])
    })
  })

  describe('listUserRepos', () => {
    it('should list all repos a user has access to', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID_2, permission: 'write' })
      await storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'admin' })

      const repos = await storage.listUserRepos('user-1')
      expect(repos).toHaveLength(2)
      expect(repos.map(p => p.repoId).sort()).toEqual([REPO_ID_2, REPO_ID].sort())
    })

    it('should exclude expired permissions', async () => {
      await storage.grantPermission({
        userId: 'user-1',
        repoId: REPO_ID,
        permission: 'read',
        expiresAt: Date.now() - 1000,
      })
      const repos = await storage.listUserRepos('user-1')
      expect(repos).toHaveLength(0)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Team Permissions
  // ──────────────────────────────────────────────────────────────────────────

  describe('team permissions', () => {
    it('should grant and retrieve team permission', async () => {
      await storage.grantTeamPermission!({ teamId: 'team-1', repoId: REPO_ID, permission: 'write' })
      const perm = await storage.getTeamPermission!('team-1', REPO_ID)
      expect(perm).not.toBeNull()
      expect(perm!.permission).toBe('write')
    })

    it('should return null for non-existent team permission', async () => {
      const perm = await storage.getTeamPermission!('team-999', REPO_ID)
      expect(perm).toBeNull()
    })

    it('should revoke team permission', async () => {
      await storage.grantTeamPermission!({ teamId: 'team-1', repoId: REPO_ID, permission: 'read' })
      await storage.revokeTeamPermission!('team-1', REPO_ID)
      const perm = await storage.getTeamPermission!('team-1', REPO_ID)
      expect(perm).toBeNull()
    })

    it('should list repo team permissions', async () => {
      await storage.grantTeamPermission!({ teamId: 'team-1', repoId: REPO_ID, permission: 'write' })
      await storage.grantTeamPermission!({ teamId: 'team-2', repoId: REPO_ID, permission: 'read' })
      await storage.grantTeamPermission!({ teamId: 'team-3', repoId: REPO_ID_2, permission: 'admin' })

      const perms = await storage.listRepoTeamPermissions!(REPO_ID)
      expect(perms).toHaveLength(2)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Repository Settings
  // ──────────────────────────────────────────────────────────────────────────

  describe('repo settings', () => {
    it('should store and retrieve repo settings', async () => {
      const settings: RepositoryAccessSettings = {
        repoId: REPO_ID,
        visibility: 'public',
        ownerId: 'owner-1',
        allowAnonymousRead: true,
      }
      await storage.updateRepoSettings(settings)
      const result = await storage.getRepoSettings(REPO_ID)
      expect(result).toEqual(settings)
    })

    it('should return null for non-existent repo settings', async () => {
      const result = await storage.getRepoSettings('nonexistent/repo')
      expect(result).toBeNull()
    })

    it('should overwrite settings on update', async () => {
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'private',
        ownerId: 'owner-1',
      })
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'public',
        ownerId: 'owner-1',
      })
      const result = await storage.getRepoSettings(REPO_ID)
      expect(result!.visibility).toBe('public')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Effective Permission
  // ──────────────────────────────────────────────────────────────────────────

  describe('getEffectivePermission', () => {
    it('should return none when no permissions exist', async () => {
      const perm = await storage.getEffectivePermission('user-1', REPO_ID)
      expect(perm).toBe('none')
    })

    it('should return direct permission', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      const perm = await storage.getEffectivePermission('user-1', REPO_ID)
      expect(perm).toBe('write')
    })

    it('should return highest of direct and team permissions', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      await storage.grantTeamPermission!({ teamId: 'team-dev', repoId: REPO_ID, permission: 'write' })

      const perm = await storage.getEffectivePermission('user-1', REPO_ID, ['team-dev'])
      expect(perm).toBe('write')
    })

    it('should grant admin to repo owner', async () => {
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'private',
        ownerId: 'user-1',
      })
      const perm = await storage.getEffectivePermission('user-1', REPO_ID)
      expect(perm).toBe('admin')
    })

    it('should grant read for public repo with allowAnonymousRead', async () => {
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'public',
        ownerId: 'owner-1',
        allowAnonymousRead: true,
      })
      const perm = await storage.getEffectivePermission('random-user', REPO_ID)
      expect(perm).toBe('read')
    })

    it('should return none for public repo without allowAnonymousRead', async () => {
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'public',
        ownerId: 'owner-1',
        allowAnonymousRead: false,
      })
      const perm = await storage.getEffectivePermission('random-user', REPO_ID)
      expect(perm).toBe('none')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Bulk Operations
  // ──────────────────────────────────────────────────────────────────────────

  describe('deleteAllRepoPermissions', () => {
    it('should delete all user, team permissions and settings for a repo', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      await storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'read' })
      await storage.grantTeamPermission!({ teamId: 'team-1', repoId: REPO_ID, permission: 'admin' })
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'private',
        ownerId: 'owner-1',
      })
      // Also add a permission for a different repo to ensure it's untouched
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID_2, permission: 'admin' })

      await storage.deleteAllRepoPermissions!(REPO_ID)

      expect(await storage.getPermission('user-1', REPO_ID)).toBeNull()
      expect(await storage.getPermission('user-2', REPO_ID)).toBeNull()
      expect(await storage.getTeamPermission!('team-1', REPO_ID)).toBeNull()
      expect(await storage.getRepoSettings(REPO_ID)).toBeNull()
      // Other repo unaffected
      expect(await storage.getPermission('user-1', REPO_ID_2)).not.toBeNull()
    })
  })

  describe('deleteAllUserPermissions', () => {
    it('should delete all permissions for a user across all repos', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID_2, permission: 'read' })
      await storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'admin' })

      await storage.deleteAllUserPermissions!('user-1')

      expect(await storage.getPermission('user-1', REPO_ID)).toBeNull()
      expect(await storage.getPermission('user-1', REPO_ID_2)).toBeNull()
      // Other user unaffected
      expect(await storage.getPermission('user-2', REPO_ID)).not.toBeNull()
    })
  })

  describe('clear', () => {
    it('should remove all data', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      await storage.grantTeamPermission!({ teamId: 'team-1', repoId: REPO_ID, permission: 'read' })
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'private',
        ownerId: 'owner-1',
      })

      storage.clear()

      expect(await storage.getPermission('user-1', REPO_ID)).toBeNull()
      expect(await storage.getTeamPermission!('team-1', REPO_ID)).toBeNull()
      expect(await storage.getRepoSettings(REPO_ID)).toBeNull()
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Concurrent access patterns
  // ──────────────────────────────────────────────────────────────────────────

  describe('concurrent access patterns', () => {
    it('should handle concurrent grants to different users', async () => {
      const grants = Array.from({ length: 20 }, (_, i) =>
        storage.grantPermission({
          userId: `user-${i}`,
          repoId: REPO_ID,
          permission: i % 3 === 0 ? 'admin' : i % 2 === 0 ? 'write' : 'read',
        })
      )
      await Promise.all(grants)

      const perms = await storage.listRepoPermissions(REPO_ID)
      expect(perms).toHaveLength(20)
    })

    it('should handle concurrent reads while writing', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })

      const operations = [
        storage.getPermission('user-1', REPO_ID),
        storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'read' }),
        storage.getPermission('user-1', REPO_ID),
        storage.listRepoPermissions(REPO_ID),
        storage.grantPermission({ userId: 'user-3', repoId: REPO_ID, permission: 'admin' }),
      ]

      const results = await Promise.all(operations)
      // First read should return the permission
      expect((results[0] as UserPermission | null)).not.toBeNull()
      // Third read should also return the permission
      expect((results[2] as UserPermission | null)).not.toBeNull()
    })

    it('should handle grant + revoke race condition gracefully', async () => {
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })

      // Simulate concurrent grant (upgrade) and revoke
      await Promise.all([
        storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'admin' }),
        storage.revokePermission('user-1', REPO_ID),
      ])

      // Result is deterministic (last write wins based on JS event loop order)
      // Just verify storage is in a consistent state
      const perm = await storage.getPermission('user-1', REPO_ID)
      // Either null or a valid permission, not corrupted
      if (perm !== null) {
        expect(['read', 'write', 'admin']).toContain(perm.permission)
      }
    })
  })
})

// ============================================================================
// SqlPermissionStorage
// ============================================================================

describe('SqlPermissionStorage', () => {
  let mockSql: MockSqlStorage
  let storage: SqlPermissionStorage

  beforeEach(() => {
    mockSql = new MockSqlStorage()
    storage = new SqlPermissionStorage(mockSql)
  })

  describe('initialization', () => {
    it('should initialize schema on first operation', async () => {
      await storage.initialize()
      // Should not throw on second init
      await storage.initialize()
    })
  })

  describe('user permission CRUD', () => {
    it('should store and retrieve a user permission', async () => {
      await storage.initialize()
      await storage.grantPermission({
        userId: 'user-1',
        repoId: REPO_ID,
        permission: 'write',
        grantedBy: 'admin-1',
      })

      const perm = await storage.getPermission('user-1', REPO_ID)
      expect(perm).not.toBeNull()
      expect(perm!.userId).toBe('user-1')
      expect(perm!.permission).toBe('write')
      expect(perm!.grantedBy).toBe('admin-1')
    })

    it('should return null for non-existent permission', async () => {
      await storage.initialize()
      const perm = await storage.getPermission('user-999', REPO_ID)
      expect(perm).toBeNull()
    })

    it('should overwrite on re-grant (INSERT OR REPLACE)', async () => {
      await storage.initialize()
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'admin' })

      const perm = await storage.getPermission('user-1', REPO_ID)
      expect(perm!.permission).toBe('admin')
    })

    it('should revoke permission', async () => {
      await storage.initialize()
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      await storage.revokePermission('user-1', REPO_ID)

      const perm = await storage.getPermission('user-1', REPO_ID)
      expect(perm).toBeNull()
    })

    it('should return null for expired permission and clean it up', async () => {
      await storage.initialize()
      await storage.grantPermission({
        userId: 'user-1',
        repoId: REPO_ID,
        permission: 'write',
        expiresAt: Date.now() - 5000,
      })

      const perm = await storage.getPermission('user-1', REPO_ID)
      expect(perm).toBeNull()
    })

    it('should store and retrieve metadata', async () => {
      await storage.initialize()
      await storage.grantPermission({
        userId: 'user-1',
        repoId: REPO_ID,
        permission: 'write',
        metadata: { source: 'github-sync', role: 'contributor' },
      })

      const perm = await storage.getPermission('user-1', REPO_ID)
      expect(perm!.metadata).toEqual({ source: 'github-sync', role: 'contributor' })
    })
  })

  describe('listRepoPermissions', () => {
    it('should list all non-expired permissions for a repo', async () => {
      await storage.initialize()
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      await storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'write' })
      await storage.grantPermission({
        userId: 'user-3',
        repoId: REPO_ID,
        permission: 'admin',
        expiresAt: Date.now() - 1000, // expired
      })

      const perms = await storage.listRepoPermissions(REPO_ID)
      expect(perms).toHaveLength(2)
    })
  })

  describe('listUserRepos', () => {
    it('should list all repos a user has access to', async () => {
      await storage.initialize()
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID_2, permission: 'write' })

      const repos = await storage.listUserRepos('user-1')
      expect(repos).toHaveLength(2)
    })
  })

  describe('team permissions', () => {
    it('should grant and retrieve team permission', async () => {
      await storage.initialize()
      await storage.grantTeamPermission({
        teamId: 'team-1',
        repoId: REPO_ID,
        permission: 'write',
        grantedBy: 'admin-1',
      })

      const perm = await storage.getTeamPermission('team-1', REPO_ID)
      expect(perm).not.toBeNull()
      expect(perm!.permission).toBe('write')
    })

    it('should revoke team permission', async () => {
      await storage.initialize()
      await storage.grantTeamPermission({ teamId: 'team-1', repoId: REPO_ID, permission: 'read' })
      await storage.revokeTeamPermission('team-1', REPO_ID)

      const perm = await storage.getTeamPermission('team-1', REPO_ID)
      expect(perm).toBeNull()
    })

    it('should list repo team permissions', async () => {
      await storage.initialize()
      await storage.grantTeamPermission({ teamId: 'team-1', repoId: REPO_ID, permission: 'write' })
      await storage.grantTeamPermission({ teamId: 'team-2', repoId: REPO_ID, permission: 'read' })

      const perms = await storage.listRepoTeamPermissions(REPO_ID)
      expect(perms).toHaveLength(2)
    })
  })

  describe('repo settings', () => {
    it('should store and retrieve repo settings', async () => {
      await storage.initialize()
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'public',
        ownerId: 'owner-1',
        allowAnonymousRead: true,
        protectedBranches: ['main', 'release/*'],
      })

      const settings = await storage.getRepoSettings(REPO_ID)
      expect(settings).not.toBeNull()
      expect(settings!.visibility).toBe('public')
      expect(settings!.allowAnonymousRead).toBe(true)
      expect(settings!.protectedBranches).toEqual(['main', 'release/*'])
    })

    it('should return null for non-existent repo settings', async () => {
      await storage.initialize()
      const settings = await storage.getRepoSettings('nonexistent/repo')
      expect(settings).toBeNull()
    })
  })

  describe('getEffectivePermission', () => {
    it('should consider direct, team, and owner permissions', async () => {
      await storage.initialize()
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'private',
        ownerId: 'owner-1',
      })

      // Owner should get admin
      const ownerPerm = await storage.getEffectivePermission('owner-1', REPO_ID)
      expect(ownerPerm).toBe('admin')

      // User with direct read + team write should get write
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'read' })
      await storage.grantTeamPermission({ teamId: 'team-dev', repoId: REPO_ID, permission: 'write' })

      const userPerm = await storage.getEffectivePermission('user-1', REPO_ID, ['team-dev'])
      expect(userPerm).toBe('write')

      // Unknown user should get none for private repo
      const unknownPerm = await storage.getEffectivePermission('stranger', REPO_ID)
      expect(unknownPerm).toBe('none')
    })
  })

  describe('bulk operations', () => {
    it('should delete all repo permissions', async () => {
      await storage.initialize()
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      await storage.grantTeamPermission({ teamId: 'team-1', repoId: REPO_ID, permission: 'read' })
      await storage.updateRepoSettings({
        repoId: REPO_ID,
        visibility: 'private',
        ownerId: 'owner-1',
      })

      await storage.deleteAllRepoPermissions(REPO_ID)

      expect(await storage.getPermission('user-1', REPO_ID)).toBeNull()
      expect(await storage.getTeamPermission('team-1', REPO_ID)).toBeNull()
      expect(await storage.getRepoSettings(REPO_ID)).toBeNull()
    })

    it('should delete all user permissions', async () => {
      await storage.initialize()
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID, permission: 'write' })
      await storage.grantPermission({ userId: 'user-1', repoId: REPO_ID_2, permission: 'read' })
      await storage.grantPermission({ userId: 'user-2', repoId: REPO_ID, permission: 'admin' })

      await storage.deleteAllUserPermissions('user-1')

      expect(await storage.getPermission('user-1', REPO_ID)).toBeNull()
      expect(await storage.getPermission('user-1', REPO_ID_2)).toBeNull()
      // Other user unaffected
      expect(await storage.getPermission('user-2', REPO_ID)).not.toBeNull()
    })
  })
})
