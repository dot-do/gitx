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
import { isPermissionExpired, getHighestPermission } from './permissions';
import { typedQuery, validateRow } from '../utils/sql-validate';
const isUserPermRow = validateRow(['user_id', 'repo_id', 'permission']);
const isTeamPermRow = validateRow(['team_id', 'repo_id', 'permission']);
const isRepoSettingsRow = validateRow(['repo_id', 'visibility', 'owner_id']);
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
export class SqlPermissionStorage {
    sql;
    initialized = false;
    constructor(sql) {
        this.sql = sql;
    }
    /**
     * Initialize the database schema.
     */
    async initialize() {
        if (this.initialized)
            return;
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
    `);
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
    `);
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
    `);
        // Create indexes for efficient lookups
        this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_permissions_repo
      ON user_permissions (repo_id)
    `);
        this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_permissions_user
      ON user_permissions (user_id)
    `);
        this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_team_permissions_repo
      ON team_permissions (repo_id)
    `);
        this.initialized = true;
    }
    ensureInitialized() {
        if (!this.initialized) {
            // Sync initialization (for simplicity)
            this.initialize();
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
    // User Permissions
    // ─────────────────────────────────────────────────────────────────────────
    async grantPermission(permission) {
        this.ensureInitialized();
        const metadataJson = permission.metadata ? JSON.stringify(permission.metadata) : null;
        this.sql.exec(`INSERT OR REPLACE INTO user_permissions
       (user_id, repo_id, permission, granted_by, granted_at, expires_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, permission.userId, permission.repoId, permission.permission, permission.grantedBy ?? null, permission.grantedAt ?? Date.now(), permission.expiresAt ?? null, metadataJson);
    }
    async revokePermission(userId, repoId) {
        this.ensureInitialized();
        this.sql.exec(`DELETE FROM user_permissions WHERE user_id = ? AND repo_id = ?`, userId, repoId);
    }
    async getPermission(userId, repoId) {
        this.ensureInitialized();
        const rows = typedQuery(this.sql.exec(`SELECT * FROM user_permissions WHERE user_id = ? AND repo_id = ?`, userId, repoId), isUserPermRow);
        if (rows.length === 0)
            return null;
        const row = rows[0];
        const permission = this.rowToUserPermission(row);
        // Check if expired
        if (isPermissionExpired(permission)) {
            // Clean up expired permission
            await this.revokePermission(userId, repoId);
            return null;
        }
        return permission;
    }
    async listRepoPermissions(repoId) {
        this.ensureInitialized();
        const rows = typedQuery(this.sql.exec(`SELECT * FROM user_permissions WHERE repo_id = ?`, repoId), isUserPermRow);
        const now = Date.now();
        const permissions = [];
        for (const row of rows) {
            const permission = this.rowToUserPermission(row);
            if (!isPermissionExpired(permission, now)) {
                permissions.push(permission);
            }
        }
        return permissions;
    }
    async listUserRepos(userId) {
        this.ensureInitialized();
        const rows = typedQuery(this.sql.exec(`SELECT * FROM user_permissions WHERE user_id = ?`, userId), isUserPermRow);
        const now = Date.now();
        const permissions = [];
        for (const row of rows) {
            const permission = this.rowToUserPermission(row);
            if (!isPermissionExpired(permission, now)) {
                permissions.push(permission);
            }
        }
        return permissions;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Team Permissions
    // ─────────────────────────────────────────────────────────────────────────
    async grantTeamPermission(permission) {
        this.ensureInitialized();
        this.sql.exec(`INSERT OR REPLACE INTO team_permissions
       (team_id, repo_id, permission, granted_by, granted_at)
       VALUES (?, ?, ?, ?, ?)`, permission.teamId, permission.repoId, permission.permission, permission.grantedBy ?? null, permission.grantedAt ?? Date.now());
    }
    async revokeTeamPermission(teamId, repoId) {
        this.ensureInitialized();
        this.sql.exec(`DELETE FROM team_permissions WHERE team_id = ? AND repo_id = ?`, teamId, repoId);
    }
    async getTeamPermission(teamId, repoId) {
        this.ensureInitialized();
        const rows = typedQuery(this.sql.exec(`SELECT * FROM team_permissions WHERE team_id = ? AND repo_id = ?`, teamId, repoId), isTeamPermRow);
        if (rows.length === 0)
            return null;
        const row = rows[0];
        return {
            teamId: row.team_id,
            repoId: row.repo_id,
            permission: row.permission,
            grantedBy: row.granted_by ?? undefined,
            grantedAt: row.granted_at ?? undefined,
        };
    }
    async listRepoTeamPermissions(repoId) {
        this.ensureInitialized();
        const rows = typedQuery(this.sql.exec(`SELECT * FROM team_permissions WHERE repo_id = ?`, repoId), isTeamPermRow);
        return rows.map((row) => ({
            teamId: row.team_id,
            repoId: row.repo_id,
            permission: row.permission,
            grantedBy: row.granted_by ?? undefined,
            grantedAt: row.granted_at ?? undefined,
        }));
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Repository Settings
    // ─────────────────────────────────────────────────────────────────────────
    async getRepoSettings(repoId) {
        this.ensureInitialized();
        const rows = typedQuery(this.sql.exec(`SELECT * FROM repo_settings WHERE repo_id = ?`, repoId), isRepoSettingsRow);
        if (rows.length === 0)
            return null;
        const row = rows[0];
        return {
            repoId: row.repo_id,
            visibility: row.visibility,
            ownerId: row.owner_id,
            allowAnonymousRead: row.allow_anonymous_read === 1,
            defaultOrgPermission: row.default_org_permission
                ? row.default_org_permission
                : undefined,
            protectedBranches: row.protected_branches
                ? JSON.parse(row.protected_branches)
                : undefined,
            protectedTags: row.protected_tags ? JSON.parse(row.protected_tags) : undefined,
        };
    }
    async updateRepoSettings(settings) {
        this.ensureInitialized();
        this.sql.exec(`INSERT OR REPLACE INTO repo_settings
       (repo_id, visibility, owner_id, allow_anonymous_read, default_org_permission, protected_branches, protected_tags)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, settings.repoId, settings.visibility, settings.ownerId, settings.allowAnonymousRead ? 1 : 0, settings.defaultOrgPermission ?? null, settings.protectedBranches ? JSON.stringify(settings.protectedBranches) : null, settings.protectedTags ? JSON.stringify(settings.protectedTags) : null);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Effective Permission
    // ─────────────────────────────────────────────────────────────────────────
    async getEffectivePermission(userId, repoId, userTeams) {
        this.ensureInitialized();
        const permissions = [];
        // Get direct user permission
        const userPerm = await this.getPermission(userId, repoId);
        if (userPerm) {
            permissions.push(userPerm.permission);
        }
        // Get team permissions
        if (userTeams && userTeams.length > 0) {
            for (const teamId of userTeams) {
                const teamPerm = await this.getTeamPermission(teamId, repoId);
                if (teamPerm) {
                    permissions.push(teamPerm.permission);
                }
            }
        }
        // Get repo settings for visibility-based permissions
        const settings = await this.getRepoSettings(repoId);
        if (settings) {
            // Owner always has admin
            if (userId === settings.ownerId) {
                permissions.push('admin');
            }
            // Public repos grant read to everyone
            if (settings.visibility === 'public' && settings.allowAnonymousRead) {
                permissions.push('read');
            }
            // Internal repos grant default permission to org members
            // (would need org membership check, simplified here)
            if (settings.visibility === 'internal' && settings.defaultOrgPermission) {
                permissions.push(settings.defaultOrgPermission);
            }
        }
        return getHighestPermission(permissions);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Bulk Operations
    // ─────────────────────────────────────────────────────────────────────────
    async deleteAllRepoPermissions(repoId) {
        this.ensureInitialized();
        this.sql.exec(`DELETE FROM user_permissions WHERE repo_id = ?`, repoId);
        this.sql.exec(`DELETE FROM team_permissions WHERE repo_id = ?`, repoId);
        this.sql.exec(`DELETE FROM repo_settings WHERE repo_id = ?`, repoId);
    }
    async deleteAllUserPermissions(userId) {
        this.ensureInitialized();
        this.sql.exec(`DELETE FROM user_permissions WHERE user_id = ?`, userId);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────────────────────
    rowToUserPermission(row) {
        return {
            userId: row.user_id,
            repoId: row.repo_id,
            permission: row.permission,
            grantedBy: row.granted_by ?? undefined,
            grantedAt: row.granted_at ?? undefined,
            expiresAt: row.expires_at ?? undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        };
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
export class InMemoryPermissionStorage {
    userPermissions = new Map();
    teamPermissions = new Map();
    repoSettings = new Map();
    userRepoKey(userId, repoId) {
        return `${userId}:${repoId}`;
    }
    teamRepoKey(teamId, repoId) {
        return `${teamId}:${repoId}`;
    }
    async grantPermission(permission) {
        const key = this.userRepoKey(permission.userId, permission.repoId);
        const fullPermission = {
            ...permission,
            grantedAt: permission.grantedAt ?? Date.now(),
        };
        this.userPermissions.set(key, fullPermission);
    }
    async revokePermission(userId, repoId) {
        const key = this.userRepoKey(userId, repoId);
        this.userPermissions.delete(key);
    }
    async getPermission(userId, repoId) {
        const key = this.userRepoKey(userId, repoId);
        const permission = this.userPermissions.get(key);
        if (!permission)
            return null;
        if (isPermissionExpired(permission)) {
            this.userPermissions.delete(key);
            return null;
        }
        return permission;
    }
    async listRepoPermissions(repoId) {
        const now = Date.now();
        const permissions = [];
        for (const permission of this.userPermissions.values()) {
            if (permission.repoId === repoId && !isPermissionExpired(permission, now)) {
                permissions.push(permission);
            }
        }
        return permissions;
    }
    async listUserRepos(userId) {
        const now = Date.now();
        const permissions = [];
        for (const permission of this.userPermissions.values()) {
            if (permission.userId === userId && !isPermissionExpired(permission, now)) {
                permissions.push(permission);
            }
        }
        return permissions;
    }
    async grantTeamPermission(permission) {
        const key = this.teamRepoKey(permission.teamId, permission.repoId);
        const fullPermission = {
            ...permission,
            grantedAt: permission.grantedAt ?? Date.now(),
        };
        this.teamPermissions.set(key, fullPermission);
    }
    async revokeTeamPermission(teamId, repoId) {
        const key = this.teamRepoKey(teamId, repoId);
        this.teamPermissions.delete(key);
    }
    async getTeamPermission(teamId, repoId) {
        const key = this.teamRepoKey(teamId, repoId);
        return this.teamPermissions.get(key) ?? null;
    }
    async listRepoTeamPermissions(repoId) {
        const permissions = [];
        for (const permission of this.teamPermissions.values()) {
            if (permission.repoId === repoId) {
                permissions.push(permission);
            }
        }
        return permissions;
    }
    async getRepoSettings(repoId) {
        return this.repoSettings.get(repoId) ?? null;
    }
    async updateRepoSettings(settings) {
        this.repoSettings.set(settings.repoId, settings);
    }
    async getEffectivePermission(userId, repoId, userTeams) {
        const permissions = [];
        // Get direct user permission
        const userPerm = await this.getPermission(userId, repoId);
        if (userPerm) {
            permissions.push(userPerm.permission);
        }
        // Get team permissions
        if (userTeams && userTeams.length > 0) {
            for (const teamId of userTeams) {
                const teamPerm = await this.getTeamPermission(teamId, repoId);
                if (teamPerm) {
                    permissions.push(teamPerm.permission);
                }
            }
        }
        // Get repo settings
        const settings = await this.getRepoSettings(repoId);
        if (settings) {
            if (userId === settings.ownerId) {
                permissions.push('admin');
            }
            if (settings.visibility === 'public' && settings.allowAnonymousRead) {
                permissions.push('read');
            }
        }
        return getHighestPermission(permissions);
    }
    async deleteAllRepoPermissions(repoId) {
        for (const [key, permission] of this.userPermissions.entries()) {
            if (permission.repoId === repoId) {
                this.userPermissions.delete(key);
            }
        }
        for (const [key, permission] of this.teamPermissions.entries()) {
            if (permission.repoId === repoId) {
                this.teamPermissions.delete(key);
            }
        }
        this.repoSettings.delete(repoId);
    }
    async deleteAllUserPermissions(userId) {
        for (const [key, permission] of this.userPermissions.entries()) {
            if (permission.userId === userId) {
                this.userPermissions.delete(key);
            }
        }
    }
    /**
     * Clear all stored data (useful for tests).
     */
    clear() {
        this.userPermissions.clear();
        this.teamPermissions.clear();
        this.repoSettings.clear();
    }
}
//# sourceMappingURL=storage.js.map