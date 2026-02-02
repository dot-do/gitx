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
import type { PermissionLevel, UserPermission, TeamPermission, RepositoryAccessSettings } from './permissions';
/**
 * SQL storage interface (matches Durable Object SQL storage).
 */
export interface SqlStorageInterface {
    exec(query: string, ...params: unknown[]): {
        toArray(): unknown[];
    };
}
/**
 * Permission storage interface.
 *
 * @description
 * Defines the contract for storing and managing permission records.
 * Implementations can use different storage backends.
 */
export interface PermissionStorage {
    /**
     * Grant permission to a user for a repository.
     */
    grantPermission(permission: UserPermission): Promise<void>;
    /**
     * Revoke a user's permission for a repository.
     */
    revokePermission(userId: string, repoId: string): Promise<void>;
    /**
     * Get a user's permission for a repository.
     */
    getPermission(userId: string, repoId: string): Promise<UserPermission | null>;
    /**
     * List all permissions for a repository.
     */
    listRepoPermissions(repoId: string): Promise<UserPermission[]>;
    /**
     * List all repositories a user has access to.
     */
    listUserRepos(userId: string): Promise<UserPermission[]>;
    /**
     * Grant permission to a team for a repository.
     */
    grantTeamPermission?(permission: TeamPermission): Promise<void>;
    /**
     * Revoke a team's permission for a repository.
     */
    revokeTeamPermission?(teamId: string, repoId: string): Promise<void>;
    /**
     * Get a team's permission for a repository.
     */
    getTeamPermission?(teamId: string, repoId: string): Promise<TeamPermission | null>;
    /**
     * List all team permissions for a repository.
     */
    listRepoTeamPermissions?(repoId: string): Promise<TeamPermission[]>;
    /**
     * Get repository access settings.
     */
    getRepoSettings?(repoId: string): Promise<RepositoryAccessSettings | null>;
    /**
     * Update repository access settings.
     */
    updateRepoSettings?(settings: RepositoryAccessSettings): Promise<void>;
    /**
     * Get a user's effective permission considering all sources.
     */
    getEffectivePermission?(userId: string, repoId: string, userTeams?: string[]): Promise<PermissionLevel>;
    /**
     * Delete all permissions for a repository (e.g., when deleting repo).
     */
    deleteAllRepoPermissions?(repoId: string): Promise<void>;
    /**
     * Delete all permissions for a user (e.g., when deleting user).
     */
    deleteAllUserPermissions?(userId: string): Promise<void>;
}
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
export declare class SqlPermissionStorage implements PermissionStorage {
    private sql;
    private initialized;
    constructor(sql: SqlStorageInterface);
    /**
     * Initialize the database schema.
     */
    initialize(): Promise<void>;
    private ensureInitialized;
    grantPermission(permission: UserPermission): Promise<void>;
    revokePermission(userId: string, repoId: string): Promise<void>;
    getPermission(userId: string, repoId: string): Promise<UserPermission | null>;
    listRepoPermissions(repoId: string): Promise<UserPermission[]>;
    listUserRepos(userId: string): Promise<UserPermission[]>;
    grantTeamPermission(permission: TeamPermission): Promise<void>;
    revokeTeamPermission(teamId: string, repoId: string): Promise<void>;
    getTeamPermission(teamId: string, repoId: string): Promise<TeamPermission | null>;
    listRepoTeamPermissions(repoId: string): Promise<TeamPermission[]>;
    getRepoSettings(repoId: string): Promise<RepositoryAccessSettings | null>;
    updateRepoSettings(settings: RepositoryAccessSettings): Promise<void>;
    getEffectivePermission(userId: string, repoId: string, userTeams?: string[]): Promise<PermissionLevel>;
    deleteAllRepoPermissions(repoId: string): Promise<void>;
    deleteAllUserPermissions(userId: string): Promise<void>;
    private rowToUserPermission;
}
/**
 * In-memory permission storage for testing.
 *
 * @description
 * A simple in-memory implementation of PermissionStorage for use
 * in tests. Data is not persisted across restarts.
 */
export declare class InMemoryPermissionStorage implements PermissionStorage {
    private userPermissions;
    private teamPermissions;
    private repoSettings;
    private userRepoKey;
    private teamRepoKey;
    grantPermission(permission: UserPermission): Promise<void>;
    revokePermission(userId: string, repoId: string): Promise<void>;
    getPermission(userId: string, repoId: string): Promise<UserPermission | null>;
    listRepoPermissions(repoId: string): Promise<UserPermission[]>;
    listUserRepos(userId: string): Promise<UserPermission[]>;
    grantTeamPermission(permission: TeamPermission): Promise<void>;
    revokeTeamPermission(teamId: string, repoId: string): Promise<void>;
    getTeamPermission(teamId: string, repoId: string): Promise<TeamPermission | null>;
    listRepoTeamPermissions(repoId: string): Promise<TeamPermission[]>;
    getRepoSettings(repoId: string): Promise<RepositoryAccessSettings | null>;
    updateRepoSettings(settings: RepositoryAccessSettings): Promise<void>;
    getEffectivePermission(userId: string, repoId: string, userTeams?: string[]): Promise<PermissionLevel>;
    deleteAllRepoPermissions(repoId: string): Promise<void>;
    deleteAllUserPermissions(userId: string): Promise<void>;
    /**
     * Clear all stored data (useful for tests).
     */
    clear(): void;
}
//# sourceMappingURL=storage.d.ts.map