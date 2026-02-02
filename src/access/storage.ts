/**
 * @fileoverview Repository Access Control - Permission Storage
 *
 * This module provides storage interfaces and implementations for
 * persisting user and team permissions on repositories.
 *
 * @module access/storage
 *
 * ## Storage Interface
 *
 * The `PermissionStorage` interface defines the contract for storing
 * and retrieving permission records. Implementations can use different
 * backends:
 * - SQL storage (via Durable Objects)
 * - KV storage (Cloudflare KV)
 * - In-memory (for testing)
 *
 * @example Basic usage
 * ```typescript
 * import { SqlPermissionStorage } from './access/storage'
 *
 * // Create storage with SQL backend
 * const storage = new SqlPermissionStorage(sqlStorage)
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
 * const permission = await storage.getPermission('user-123', 'org/repo')
 * console.log(permission?.permission) // 'write'
 * ```
 */

import type {
  Permission,
  PermissionLevel,
  UserPermission,
  TeamPermission,
  RepositoryAccessSettings,
  RepositoryVisibility,
} from './permissions'
import { isPermissionExpired, getHighestPermission } from './permissions'
import { typedQuery, validateRow } from '../utils/sql-validate'

// ============================================================================
// SQL Row Types
// ============================================================================

type UserPermissionRow = {
  user_id: string
  repo_id: string
  permission: string
  granted_by: string | null
  granted_at: number | null
  expires_at: number | null
  metadata: string | null
}

type TeamPermissionRow = {
  team_id: string
  repo_id: string
  permission: string
  granted_by: string | null
  granted_at: number | null
}

type RepoSettingsRow = {
  repo_id: string
  visibility: string
  owner_id: string
  allow_anonymous_read: number
  default_org_permission: string | null
  protected_branches: string | null
  protected_tags: string | null
}

const isUserPermRow = validateRow<UserPermissionRow>(['user_id', 'repo_id', 'permission'])
const isTeamPermRow = validateRow<TeamPermissionRow>(['team_id', 'repo_id', 'permission'])
const isRepoSettingsRow = validateRow<RepoSettingsRow>(['repo_id', 'visibility', 'owner_id'])

// ============================================================================
// Storage Interfaces
// ============================================================================

/**
 * SQL storage interface (matches Durable Object SQL storage).
 */
export interface SqlStorageInterface {
  exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
}

/**
 * Permission storage interface.
 *
 * @description
 * Defines the contract for storing and managing permission records.
 * Implementations can use different storage backends.
 */
export interface PermissionStorage {
  // User permissions
  /**
   * Grant permission to a user for a repository.
   */
  grantPermission(permission: UserPermission): Promise<void>

  /**
   * Revoke a user's permission for a repository.
   */
  revokePermission(userId: string, repoId: string): Promise<void>

  /**
   * Get a user's permission for a repository.
   */
  getPermission(userId: string, repoId: string): Promise<UserPermission | null>

  /**
   * List all permissions for a repository.
   */
  listRepoPermissions(repoId: string): Promise<UserPermission[]>

  /**
   * List all repositories a user has access to.
   */
  listUserRepos(userId: string): Promise<UserPermission[]>

  // Team permissions (optional)
  /**
   * Grant permission to a team for a repository.
   */
  grantTeamPermission?(permission: TeamPermission): Promise<void>

  /**
   * Revoke a team's permission for a repository.
   */
  revokeTeamPermission?(teamId: string, repoId: string): Promise<void>

  /**
   * Get a team's permission for a repository.
   */
  getTeamPermission?(teamId: string, repoId: string): Promise<TeamPermission | null>

  /**
   * List all team permissions for a repository.
   */
  listRepoTeamPermissions?(repoId: string): Promise<TeamPermission[]>

  // Repository settings
  /**
   * Get repository access settings.
   */
  getRepoSettings?(repoId: string): Promise<RepositoryAccessSettings | null>

  /**
   * Update repository access settings.
   */
  updateRepoSettings?(settings: RepositoryAccessSettings): Promise<void>

  // Effective permission (considering teams, org, etc.)
  /**
   * Get a user's effective permission considering all sources.
   */
  getEffectivePermission?(
    userId: string,
    repoId: string,
    userTeams?: string[]
  ): Promise<PermissionLevel>

  // Bulk operations
  /**
   * Delete all permissions for a repository (e.g., when deleting repo).
   */
  deleteAllRepoPermissions?(repoId: string): Promise<void>

  /**
   * Delete all permissions for a user (e.g., when deleting user).
   */
  deleteAllUserPermissions?(userId: string): Promise<void>
}

// ============================================================================
// SQL Permission Storage Implementation
// ============================================================================

/**
 * SQL-based permission storage.
 *
 * @description
 * Implements permission storage using SQL (compatible with Durable Object
 * SQLite storage). Stores permissions in normalized tables.
 *
 * ## Table Schema
 *
 * ```sql
 * -- User permissions
 * CREATE TABLE IF NOT EXISTS user_permissions (
 *   user_id TEXT NOT NULL,
 *   repo_id TEXT NOT NULL,
 *   permission TEXT NOT NULL,
 *   granted_by TEXT,
 *   granted_at INTEGER,
 *   expires_at INTEGER,
 *   metadata TEXT,
 *   PRIMARY KEY (user_id, repo_id)
 * );
 *
 * -- Team permissions
 * CREATE TABLE IF NOT EXISTS team_permissions (
 *   team_id TEXT NOT NULL,
 *   repo_id TEXT NOT NULL,
 *   permission TEXT NOT NULL,
 *   granted_by TEXT,
 *   granted_at INTEGER,
 *   PRIMARY KEY (team_id, repo_id)
 * );
 *
 * -- Repository settings
 * CREATE TABLE IF NOT EXISTS repo_settings (
 *   repo_id TEXT PRIMARY KEY,
 *   visibility TEXT NOT NULL DEFAULT 'private',
 *   owner_id TEXT NOT NULL,
 *   allow_anonymous_read INTEGER DEFAULT 0,
 *   default_org_permission TEXT,
 *   protected_branches TEXT,
 *   protected_tags TEXT
 * );
 * ```
 */
export class SqlPermissionStorage implements PermissionStorage {
  private sql: SqlStorageInterface
  private initialized = false

  constructor(sql: SqlStorageInterface) {
    this.sql = sql
  }

  /**
   * Initialize the database schema.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create user_permissions table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        user_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted_by TEXT,
        granted_at INTEGER,
        expires_at INTEGER,
        metadata TEXT,
        PRIMARY KEY (user_id, repo_id)
      )
    `)

    // Create team_permissions table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS team_permissions (
        team_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted_by TEXT,
        granted_at INTEGER,
        PRIMARY KEY (team_id, repo_id)
      )
    `)

    // Create repo_settings table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS repo_settings (
        repo_id TEXT PRIMARY KEY,
        visibility TEXT NOT NULL DEFAULT 'private',
        owner_id TEXT NOT NULL,
        allow_anonymous_read INTEGER DEFAULT 0,
        default_org_permission TEXT,
        protected_branches TEXT,
        protected_tags TEXT
      )
    `)

    // Create indexes for efficient lookups
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_permissions_repo
      ON user_permissions (repo_id)
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_permissions_user
      ON user_permissions (user_id)
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_team_permissions_repo
      ON team_permissions (repo_id)
    `)

    this.initialized = true
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      // Sync initialization (for simplicity)
      this.initialize()
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // User Permissions
  // ─────────────────────────────────────────────────────────────────────────

  async grantPermission(permission: UserPermission): Promise<void> {
    this.ensureInitialized()

    const metadataJson = permission.metadata ? JSON.stringify(permission.metadata) : null

    this.sql.exec(
      `INSERT OR REPLACE INTO user_permissions
       (user_id, repo_id, permission, granted_by, granted_at, expires_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      permission.userId,
      permission.repoId,
      permission.permission,
      permission.grantedBy ?? null,
      permission.grantedAt ?? Date.now(),
      permission.expiresAt ?? null,
      metadataJson
    )
  }

  async revokePermission(userId: string, repoId: string): Promise<void> {
    this.ensureInitialized()

    this.sql.exec(
      `DELETE FROM user_permissions WHERE user_id = ? AND repo_id = ?`,
      userId,
      repoId
    )
  }

  async getPermission(userId: string, repoId: string): Promise<UserPermission | null> {
    this.ensureInitialized()

    const rows = typedQuery<UserPermissionRow>(
      this.sql.exec(
        `SELECT * FROM user_permissions WHERE user_id = ? AND repo_id = ?`,
        userId,
        repoId
      ),
      isUserPermRow
    )

    if (rows.length === 0) return null

    const row = rows[0]
    const permission = this.rowToUserPermission(row)

    // Check if expired
    if (isPermissionExpired(permission)) {
      // Clean up expired permission
      await this.revokePermission(userId, repoId)
      return null
    }

    return permission
  }

  async listRepoPermissions(repoId: string): Promise<UserPermission[]> {
    this.ensureInitialized()

    const rows = typedQuery<UserPermissionRow>(
      this.sql.exec(`SELECT * FROM user_permissions WHERE repo_id = ?`, repoId),
      isUserPermRow
    )

    const now = Date.now()
    const permissions: UserPermission[] = []

    for (const row of rows) {
      const permission = this.rowToUserPermission(row)
      if (!isPermissionExpired(permission, now)) {
        permissions.push(permission)
      }
    }

    return permissions
  }

  async listUserRepos(userId: string): Promise<UserPermission[]> {
    this.ensureInitialized()

    const rows = typedQuery<UserPermissionRow>(
      this.sql.exec(`SELECT * FROM user_permissions WHERE user_id = ?`, userId),
      isUserPermRow
    )

    const now = Date.now()
    const permissions: UserPermission[] = []

    for (const row of rows) {
      const permission = this.rowToUserPermission(row)
      if (!isPermissionExpired(permission, now)) {
        permissions.push(permission)
      }
    }

    return permissions
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Team Permissions
  // ─────────────────────────────────────────────────────────────────────────

  async grantTeamPermission(permission: TeamPermission): Promise<void> {
    this.ensureInitialized()

    this.sql.exec(
      `INSERT OR REPLACE INTO team_permissions
       (team_id, repo_id, permission, granted_by, granted_at)
       VALUES (?, ?, ?, ?, ?)`,
      permission.teamId,
      permission.repoId,
      permission.permission,
      permission.grantedBy ?? null,
      permission.grantedAt ?? Date.now()
    )
  }

  async revokeTeamPermission(teamId: string, repoId: string): Promise<void> {
    this.ensureInitialized()

    this.sql.exec(
      `DELETE FROM team_permissions WHERE team_id = ? AND repo_id = ?`,
      teamId,
      repoId
    )
  }

  async getTeamPermission(teamId: string, repoId: string): Promise<TeamPermission | null> {
    this.ensureInitialized()

    const rows = typedQuery<TeamPermissionRow>(
      this.sql.exec(
        `SELECT * FROM team_permissions WHERE team_id = ? AND repo_id = ?`,
        teamId,
        repoId
      ),
      isTeamPermRow
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      teamId: row.team_id,
      repoId: row.repo_id,
      permission: row.permission as Permission,
      grantedBy: row.granted_by ?? undefined,
      grantedAt: row.granted_at ?? undefined,
    }
  }

  async listRepoTeamPermissions(repoId: string): Promise<TeamPermission[]> {
    this.ensureInitialized()

    const rows = typedQuery<TeamPermissionRow>(
      this.sql.exec(`SELECT * FROM team_permissions WHERE repo_id = ?`, repoId),
      isTeamPermRow
    )

    return rows.map((row) => ({
      teamId: row.team_id,
      repoId: row.repo_id,
      permission: row.permission as Permission,
      grantedBy: row.granted_by ?? undefined,
      grantedAt: row.granted_at ?? undefined,
    }))
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Repository Settings
  // ─────────────────────────────────────────────────────────────────────────

  async getRepoSettings(repoId: string): Promise<RepositoryAccessSettings | null> {
    this.ensureInitialized()

    const rows = typedQuery<RepoSettingsRow>(
      this.sql.exec(`SELECT * FROM repo_settings WHERE repo_id = ?`, repoId),
      isRepoSettingsRow
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      repoId: row.repo_id,
      visibility: row.visibility as RepositoryVisibility,
      ownerId: row.owner_id,
      allowAnonymousRead: row.allow_anonymous_read === 1,
      defaultOrgPermission: row.default_org_permission
        ? (row.default_org_permission as Permission)
        : undefined,
      protectedBranches: row.protected_branches
        ? JSON.parse(row.protected_branches)
        : undefined,
      protectedTags: row.protected_tags ? JSON.parse(row.protected_tags) : undefined,
    }
  }

  async updateRepoSettings(settings: RepositoryAccessSettings): Promise<void> {
    this.ensureInitialized()

    this.sql.exec(
      `INSERT OR REPLACE INTO repo_settings
       (repo_id, visibility, owner_id, allow_anonymous_read, default_org_permission, protected_branches, protected_tags)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      settings.repoId,
      settings.visibility,
      settings.ownerId,
      settings.allowAnonymousRead ? 1 : 0,
      settings.defaultOrgPermission ?? null,
      settings.protectedBranches ? JSON.stringify(settings.protectedBranches) : null,
      settings.protectedTags ? JSON.stringify(settings.protectedTags) : null
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Effective Permission
  // ─────────────────────────────────────────────────────────────────────────

  async getEffectivePermission(
    userId: string,
    repoId: string,
    userTeams?: string[]
  ): Promise<PermissionLevel> {
    this.ensureInitialized()

    const permissions: PermissionLevel[] = []

    // Get direct user permission
    const userPerm = await this.getPermission(userId, repoId)
    if (userPerm) {
      permissions.push(userPerm.permission)
    }

    // Get team permissions
    if (userTeams && userTeams.length > 0) {
      for (const teamId of userTeams) {
        const teamPerm = await this.getTeamPermission(teamId, repoId)
        if (teamPerm) {
          permissions.push(teamPerm.permission)
        }
      }
    }

    // Get repo settings for visibility-based permissions
    const settings = await this.getRepoSettings(repoId)
    if (settings) {
      // Owner always has admin
      if (userId === settings.ownerId) {
        permissions.push('admin')
      }

      // Public repos grant read to everyone
      if (settings.visibility === 'public' && settings.allowAnonymousRead) {
        permissions.push('read')
      }

      // Internal repos grant default permission to org members
      // (would need org membership check, simplified here)
      if (settings.visibility === 'internal' && settings.defaultOrgPermission) {
        permissions.push(settings.defaultOrgPermission)
      }
    }

    return getHighestPermission(permissions)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bulk Operations
  // ─────────────────────────────────────────────────────────────────────────

  async deleteAllRepoPermissions(repoId: string): Promise<void> {
    this.ensureInitialized()

    this.sql.exec(`DELETE FROM user_permissions WHERE repo_id = ?`, repoId)
    this.sql.exec(`DELETE FROM team_permissions WHERE repo_id = ?`, repoId)
    this.sql.exec(`DELETE FROM repo_settings WHERE repo_id = ?`, repoId)
  }

  async deleteAllUserPermissions(userId: string): Promise<void> {
    this.ensureInitialized()

    this.sql.exec(`DELETE FROM user_permissions WHERE user_id = ?`, userId)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private rowToUserPermission(row: {
    user_id: string
    repo_id: string
    permission: string
    granted_by: string | null
    granted_at: number | null
    expires_at: number | null
    metadata: string | null
  }): UserPermission {
    return {
      userId: row.user_id,
      repoId: row.repo_id,
      permission: row.permission as Permission,
      grantedBy: row.granted_by ?? undefined,
      grantedAt: row.granted_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }
  }
}

// ============================================================================
// In-Memory Permission Storage (for testing)
// ============================================================================

/**
 * In-memory permission storage for testing.
 *
 * @description
 * A simple in-memory implementation of PermissionStorage for use
 * in tests. Data is not persisted across restarts.
 */
export class InMemoryPermissionStorage implements PermissionStorage {
  private userPermissions: Map<string, UserPermission> = new Map()
  private teamPermissions: Map<string, TeamPermission> = new Map()
  private repoSettings: Map<string, RepositoryAccessSettings> = new Map()

  private userRepoKey(userId: string, repoId: string): string {
    return `${userId}:${repoId}`
  }

  private teamRepoKey(teamId: string, repoId: string): string {
    return `${teamId}:${repoId}`
  }

  async grantPermission(permission: UserPermission): Promise<void> {
    const key = this.userRepoKey(permission.userId, permission.repoId)
    const fullPermission: UserPermission = {
      ...permission,
      grantedAt: permission.grantedAt ?? Date.now(),
    }
    this.userPermissions.set(key, fullPermission)
  }

  async revokePermission(userId: string, repoId: string): Promise<void> {
    const key = this.userRepoKey(userId, repoId)
    this.userPermissions.delete(key)
  }

  async getPermission(userId: string, repoId: string): Promise<UserPermission | null> {
    const key = this.userRepoKey(userId, repoId)
    const permission = this.userPermissions.get(key)

    if (!permission) return null
    if (isPermissionExpired(permission)) {
      this.userPermissions.delete(key)
      return null
    }

    return permission
  }

  async listRepoPermissions(repoId: string): Promise<UserPermission[]> {
    const now = Date.now()
    const permissions: UserPermission[] = []

    for (const permission of this.userPermissions.values()) {
      if (permission.repoId === repoId && !isPermissionExpired(permission, now)) {
        permissions.push(permission)
      }
    }

    return permissions
  }

  async listUserRepos(userId: string): Promise<UserPermission[]> {
    const now = Date.now()
    const permissions: UserPermission[] = []

    for (const permission of this.userPermissions.values()) {
      if (permission.userId === userId && !isPermissionExpired(permission, now)) {
        permissions.push(permission)
      }
    }

    return permissions
  }

  async grantTeamPermission(permission: TeamPermission): Promise<void> {
    const key = this.teamRepoKey(permission.teamId, permission.repoId)
    const fullPermission: TeamPermission = {
      ...permission,
      grantedAt: permission.grantedAt ?? Date.now(),
    }
    this.teamPermissions.set(key, fullPermission)
  }

  async revokeTeamPermission(teamId: string, repoId: string): Promise<void> {
    const key = this.teamRepoKey(teamId, repoId)
    this.teamPermissions.delete(key)
  }

  async getTeamPermission(teamId: string, repoId: string): Promise<TeamPermission | null> {
    const key = this.teamRepoKey(teamId, repoId)
    return this.teamPermissions.get(key) ?? null
  }

  async listRepoTeamPermissions(repoId: string): Promise<TeamPermission[]> {
    const permissions: TeamPermission[] = []

    for (const permission of this.teamPermissions.values()) {
      if (permission.repoId === repoId) {
        permissions.push(permission)
      }
    }

    return permissions
  }

  async getRepoSettings(repoId: string): Promise<RepositoryAccessSettings | null> {
    return this.repoSettings.get(repoId) ?? null
  }

  async updateRepoSettings(settings: RepositoryAccessSettings): Promise<void> {
    this.repoSettings.set(settings.repoId, settings)
  }

  async getEffectivePermission(
    userId: string,
    repoId: string,
    userTeams?: string[]
  ): Promise<PermissionLevel> {
    const permissions: PermissionLevel[] = []

    // Get direct user permission
    const userPerm = await this.getPermission(userId, repoId)
    if (userPerm) {
      permissions.push(userPerm.permission)
    }

    // Get team permissions
    if (userTeams && userTeams.length > 0) {
      for (const teamId of userTeams) {
        const teamPerm = await this.getTeamPermission(teamId, repoId)
        if (teamPerm) {
          permissions.push(teamPerm.permission)
        }
      }
    }

    // Get repo settings
    const settings = await this.getRepoSettings(repoId)
    if (settings) {
      if (userId === settings.ownerId) {
        permissions.push('admin')
      }
      if (settings.visibility === 'public' && settings.allowAnonymousRead) {
        permissions.push('read')
      }
    }

    return getHighestPermission(permissions)
  }

  async deleteAllRepoPermissions(repoId: string): Promise<void> {
    for (const [key, permission] of this.userPermissions.entries()) {
      if (permission.repoId === repoId) {
        this.userPermissions.delete(key)
      }
    }
    for (const [key, permission] of this.teamPermissions.entries()) {
      if (permission.repoId === repoId) {
        this.teamPermissions.delete(key)
      }
    }
    this.repoSettings.delete(repoId)
  }

  async deleteAllUserPermissions(userId: string): Promise<void> {
    for (const [key, permission] of this.userPermissions.entries()) {
      if (permission.userId === userId) {
        this.userPermissions.delete(key)
      }
    }
  }

  /**
   * Clear all stored data (useful for tests).
   */
  clear(): void {
    this.userPermissions.clear()
    this.teamPermissions.clear()
    this.repoSettings.clear()
  }
}
