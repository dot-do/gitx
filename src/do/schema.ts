/**
 * @fileoverview Database Schema for Git Object Storage
 *
 * This module defines the SQLite schema used for storing Git objects and related
 * data in Cloudflare Durable Objects. It provides schema initialization, version
 * management, and validation.
 *
 * **Tables**:
 * - `objects`: Main Git object storage (blobs, trees, commits, tags)
 * - `object_index`: Tiered storage location index
 * - `hot_objects`: Frequently accessed objects cache
 * - `wal`: Write-ahead log for durability
 * - `refs`: Git references (branches, tags, HEAD)
 * - `git`: Repository bindings for GitModule integration
 * - `git_branches`: Branch tracking information per repository
 * - `git_content`: Staged file content for commits
 * - `exec`: Execution safety settings and policies for BashModule
 *
 * @module do/schema
 *
 * @example
 * ```typescript
 * import { SchemaManager, DurableObjectStorage } from './do/schema'
 *
 * // Initialize schema on first access
 * const schemaManager = new SchemaManager(storage)
 * await schemaManager.initializeSchema()
 *
 * // Verify schema is valid
 * if (await schemaManager.validateSchema()) {
 *   console.log('Schema is ready')
 * }
 * ```
 */

import { typedQuery, validateRow } from '../utils/sql-validate'

// Re-export DurableObjectStorage from storage/types for backwards compatibility
export type { DurableObjectStorage } from '../storage/types'
import type { DurableObjectStorage } from '../storage/types'

// ============================================================================
// Schema Constants
// ============================================================================

/**
 * Current schema version number.
 *
 * @description
 * Increment this when making schema changes that require migration.
 * Used for schema validation and upgrade detection.
 *
 * @example
 * ```typescript
 * const version = await schemaManager.getSchemaVersion()
 * if (version < SCHEMA_VERSION) {
 *   // Perform migration
 * }
 * ```
 */
export const SCHEMA_VERSION = 2

/**
 * Complete SQL schema definition.
 *
 * @description
 * Contains all CREATE TABLE and CREATE INDEX statements for the
 * Git object storage database. Uses IF NOT EXISTS for idempotency.
 *
 * **Tables**:
 * - `objects`: Primary object storage with SHA as primary key
 * - `object_index`: Tracks object locations across storage tiers
 * - `hot_objects`: Cache for frequently accessed objects
 * - `wal`: Write-ahead log for crash recovery
 * - `refs`: Git references (branches, tags, symbolic refs)
 * - `git`: Repository bindings (repo, branch, commit, last_sync)
 * - `git_branches`: Branch info per repository (name, head, upstream)
 * - `git_content`: Staged file content (path, content, status)
 * - `exec`: Execution policies (blocked_commands, require_confirmation, etc.)
 *
 * **Indexes**:
 * - `idx_objects_type`: Fast lookup by object type
 * - `idx_wal_flushed`: Find unflushed WAL entries
 * - `idx_hot_objects_accessed`: LRU eviction ordering
 * - `idx_git_branches_repo`: Fast branch lookup by repository
 * - `idx_git_content_repo_path`: Fast staged file lookup
 * - `idx_exec_name`: Fast lookup by policy name
 */
export const SCHEMA_SQL = `
-- Git objects (blobs, trees, commits, tags)
CREATE TABLE IF NOT EXISTS objects (sha TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at INTEGER);

-- Object location index for tiered storage
-- Tracks object locations across storage tiers (hot/r2/parquet)
-- pack_id and offset are used for R2 and Parquet tiers where objects are stored in packfiles
-- chunked and chunk_count are used for large blobs (>=2MB) stored in 2MB chunks for DO SQLite cost optimization
CREATE TABLE IF NOT EXISTS object_index (sha TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'hot', pack_id TEXT, offset INTEGER, size INTEGER, type TEXT, updated_at INTEGER, chunked INTEGER DEFAULT 0, chunk_count INTEGER DEFAULT 0);

-- Hot objects cache
CREATE TABLE IF NOT EXISTS hot_objects (sha TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, accessed_at INTEGER, created_at INTEGER);

-- Write-ahead log
CREATE TABLE IF NOT EXISTS wal (id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, payload BLOB NOT NULL, created_at INTEGER, flushed INTEGER DEFAULT 0);

-- Refs table
CREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NOT NULL, type TEXT DEFAULT 'sha', updated_at INTEGER);

-- Git repository bindings for GitModule integration
-- Stores repository configuration and sync state
CREATE TABLE IF NOT EXISTS git (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL UNIQUE,
  path TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  "commit" TEXT,
  last_sync INTEGER,
  object_prefix TEXT DEFAULT 'git/objects',
  created_at INTEGER,
  updated_at INTEGER
);

-- Git branches table for tracking branch state per repository
-- Each repository can have multiple branches tracked
CREATE TABLE IF NOT EXISTS git_branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES git(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  head TEXT,
  upstream TEXT,
  tracking INTEGER DEFAULT 0,
  ahead INTEGER DEFAULT 0,
  behind INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(repo_id, name)
);

-- Git content table for staged files awaiting commit
-- Stores file references using integer rowid foreign key for efficient lookups
-- file_id references the shared files table for unified filesystem integration
CREATE TABLE IF NOT EXISTS git_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES git(id) ON DELETE CASCADE,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  content BLOB,
  mode TEXT DEFAULT '100644',
  status TEXT NOT NULL DEFAULT 'staged',
  sha TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(repo_id, path)
);

-- Exec table for BashModule execution safety settings and policies
-- Stores blocked commands, confirmation requirements, and execution policies
CREATE TABLE IF NOT EXISTS exec (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  blocked_commands TEXT,
  require_confirmation INTEGER DEFAULT 1,
  default_timeout INTEGER DEFAULT 30000,
  default_cwd TEXT DEFAULT '/',
  allowed_patterns TEXT,
  denied_patterns TEXT,
  max_concurrent INTEGER DEFAULT 5,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);

-- Branch protection rules
CREATE TABLE IF NOT EXISTS branch_protection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  required_reviews INTEGER NOT NULL DEFAULT 0,
  prevent_force_push INTEGER NOT NULL DEFAULT 1,
  prevent_deletion INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type);
CREATE INDEX IF NOT EXISTS idx_wal_flushed ON wal(flushed);
CREATE INDEX IF NOT EXISTS idx_hot_objects_accessed ON hot_objects(accessed_at);
CREATE INDEX IF NOT EXISTS idx_object_index_tier ON object_index(tier);
CREATE INDEX IF NOT EXISTS idx_object_index_pack_id ON object_index(pack_id);
CREATE INDEX IF NOT EXISTS idx_git_branches_repo ON git_branches(repo_id);
CREATE INDEX IF NOT EXISTS idx_git_content_repo_path ON git_content(repo_id, path);
CREATE INDEX IF NOT EXISTS idx_git_content_status ON git_content(status);
CREATE INDEX IF NOT EXISTS idx_git_content_file_id ON git_content(file_id);
CREATE INDEX IF NOT EXISTS idx_exec_name ON exec(name);
CREATE INDEX IF NOT EXISTS idx_exec_enabled ON exec(enabled);
CREATE INDEX IF NOT EXISTS idx_branch_protection_pattern ON branch_protection(pattern);
CREATE INDEX IF NOT EXISTS idx_branch_protection_enabled ON branch_protection(enabled);
`

/**
 * List of required tables for schema validation.
 *
 * @description
 * Used by validateSchema() to verify all required tables exist.
 * @internal
 */
const REQUIRED_TABLES = ['objects', 'object_index', 'hot_objects', 'wal', 'refs', 'git', 'git_branches', 'git_content', 'exec']

// ============================================================================
// Thin Coordinator Schema (v2)
// ============================================================================

/**
 * Minimal schema for the thin DO coordinator pattern.
 *
 * Only includes:
 * - `refs`: Git references (name -> sha) for ref locking
 * - `bloom_filter`: Persisted bloom filter for SHA existence checks
 * - `sha_cache`: Exact SHA cache for recently-seen objects
 *
 * Objects are stored externally in R2 Parquet files via ParquetStore.
 * The legacy tables (objects, object_index, hot_objects, wal) are
 * retained via SCHEMA_SQL for migration but not required by the thin coordinator.
 */
export const THIN_SCHEMA_SQL = `
-- Refs table (authoritative ref storage)
CREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NOT NULL, type TEXT DEFAULT 'sha', updated_at INTEGER);

-- Bloom filter persistence for SHA existence checks
CREATE TABLE IF NOT EXISTS bloom_filter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  filter_data BLOB NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- SHA existence cache (exact lookups alongside bloom filter)
CREATE TABLE IF NOT EXISTS sha_cache (
  sha TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sha_cache_added ON sha_cache(added_at);

-- Compaction journal for crash recovery during R2 Parquet compaction
-- If the DO restarts mid-compaction, this table tells us what to clean up
CREATE TABLE IF NOT EXISTS compaction_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_keys TEXT NOT NULL,
  target_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  created_at INTEGER NOT NULL
);

-- Compaction alarm retry state for exponential backoff
CREATE TABLE IF NOT EXISTS compaction_retries (
  id INTEGER PRIMARY KEY DEFAULT 1,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);

-- Write-ahead log for ParquetStore write buffer durability
-- Buffered objects are persisted here before being acknowledged
-- On crash recovery, un-flushed WAL entries are replayed into the buffer
CREATE TABLE IF NOT EXISTS write_buffer_wal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha TEXT NOT NULL,
  type TEXT NOT NULL,
  data BLOB NOT NULL,
  path TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_write_buffer_wal_sha ON write_buffer_wal(sha);

-- Branch protection rules
CREATE TABLE IF NOT EXISTS branch_protection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  required_reviews INTEGER NOT NULL DEFAULT 0,
  prevent_force_push INTEGER NOT NULL DEFAULT 1,
  prevent_deletion INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branch_protection_pattern ON branch_protection(pattern);
CREATE INDEX IF NOT EXISTS idx_branch_protection_enabled ON branch_protection(enabled);
`

/**
 * Required tables for the thin coordinator schema.
 */
const THIN_REQUIRED_TABLES = ['refs', 'bloom_filter', 'sha_cache', 'compaction_journal', 'compaction_retries', 'write_buffer_wal']

/**
 * Optional legacy tables that may exist during migration.
 */
export const LEGACY_TABLES = ['objects', 'object_index', 'hot_objects', 'wal', 'git', 'git_branches', 'git_content', 'exec']

// ============================================================================
// SchemaManager Class
// ============================================================================

/**
 * Manager for database schema initialization and validation.
 *
 * @description
 * Handles schema lifecycle including initialization, version checking,
 * and validation. Should be used when first accessing a Durable Object
 * to ensure the schema is properly set up.
 *
 * @example
 * ```typescript
 * class GitDurableObject implements DurableObject {
 *   private schemaManager: SchemaManager
 *   private initialized = false
 *
 *   constructor(state: DurableObjectState) {
 *     this.schemaManager = new SchemaManager(state.storage)
 *   }
 *
 *   private async ensureInitialized() {
 *     if (!this.initialized) {
 *       await this.schemaManager.initializeSchema()
 *       this.initialized = true
 *     }
 *   }
 *
 *   async fetch(request: Request) {
 *     await this.ensureInitialized()
 *     // ... handle request
 *   }
 * }
 * ```
 */
export class SchemaManager {
  /**
   * Create a new SchemaManager.
   *
   * @param storage - Durable Object storage interface
   */
  constructor(private storage: DurableObjectStorage) {}

  /**
   * Initialize the database schema.
   *
   * @description
   * Creates all required tables and indexes if they don't exist.
   * This operation is idempotent - safe to call multiple times.
   *
   * @example
   * ```typescript
   * await schemaManager.initializeSchema()
   * ```
   */
  async initializeSchema(): Promise<void> {
    this.storage.sql.exec(SCHEMA_SQL)
  }

  /**
   * Get the current schema version.
   *
   * @description
   * Returns the schema version if valid, or 0 if schema is missing/invalid.
   * Use this to detect when schema migration is needed.
   *
   * @returns Schema version number (0 if invalid/missing)
   *
   * @example
   * ```typescript
   * const version = await schemaManager.getSchemaVersion()
   * console.log(`Schema version: ${version}`)
   * ```
   */
  async getSchemaVersion(): Promise<number> {
    const isValid = await this.validateSchema()
    return isValid ? SCHEMA_VERSION : 0
  }

  /**
   * Validate that all required tables exist.
   *
   * @description
   * Checks the sqlite_master table to verify all required tables
   * are present. Returns false if any tables are missing.
   *
   * @returns True if schema is valid and complete
   *
   * @example
   * ```typescript
   * if (await schemaManager.validateSchema()) {
   *   console.log('Schema is valid')
   * } else {
   *   console.log('Schema needs initialization')
   *   await schemaManager.initializeSchema()
   * }
   * ```
   */
  async validateSchema(): Promise<boolean> {
    const result = this.storage.sql.exec(
      "SELECT name FROM sqlite_master WHERE type='table'"
    )
    const tables = typedQuery<{ name: string }>(result, validateRow(['name']))
    const tableNames = tables.map(t => t.name)

    return REQUIRED_TABLES.every(table => tableNames.includes(table))
  }
}

// ============================================================================
// ThinSchemaManager Class
// ============================================================================

/**
 * Schema manager for the thin DO coordinator pattern.
 *
 * Only initializes the minimal refs + bloom filter + sha_cache tables.
 * Legacy tables are NOT created unless explicitly requested via
 * initializeLegacySchema().
 */
export class ThinSchemaManager {
  constructor(private storage: DurableObjectStorage) {}

  /**
   * Initialize the thin coordinator schema.
   */
  async initializeSchema(): Promise<void> {
    this.storage.sql.exec(THIN_SCHEMA_SQL)
  }

  /**
   * Initialize the full legacy schema (for migration period).
   */
  async initializeLegacySchema(): Promise<void> {
    this.storage.sql.exec(SCHEMA_SQL)
  }

  /**
   * Get the schema version. Returns 2 for thin, 1 for legacy, 0 for missing.
   */
  async getSchemaVersion(): Promise<number> {
    const isThin = await this.validateSchema()
    if (isThin) return SCHEMA_VERSION

    // Check if legacy schema is present
    const result = this.storage.sql.exec(
      "SELECT name FROM sqlite_master WHERE type='table'"
    )
    const tables = typedQuery<{ name: string }>(result, validateRow(['name']))
    const tableNames = tables.map(t => t.name)
    const hasLegacy = REQUIRED_TABLES.every(table => tableNames.includes(table))
    return hasLegacy ? 1 : 0
  }

  /**
   * Validate that all required thin coordinator tables exist.
   */
  async validateSchema(): Promise<boolean> {
    const result = this.storage.sql.exec(
      "SELECT name FROM sqlite_master WHERE type='table'"
    )
    const tables = typedQuery<{ name: string }>(result, validateRow(['name']))
    const tableNames = tables.map(t => t.name)

    return THIN_REQUIRED_TABLES.every(table => tableNames.includes(table))
  }

  /**
   * Check if legacy tables exist (for migration detection).
   */
  async hasLegacyTables(): Promise<boolean> {
    const result = this.storage.sql.exec(
      "SELECT name FROM sqlite_master WHERE type='table'"
    )
    const tables = typedQuery<{ name: string }>(result, validateRow(['name']))
    const tableNames = tables.map(t => t.name)

    return LEGACY_TABLES.some(table => tableNames.includes(table))
  }
}
