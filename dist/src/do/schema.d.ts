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
 * - `bundle_index`: Maps SHAs to bundle files + offsets for BundleStorage
 * - `bundle_metadata`: Tracks sealed bundles and their compaction state
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
export type { DurableObjectStorage } from '../storage/types';
import type { DurableObjectStorage } from '../storage/types';
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
export declare const SCHEMA_VERSION = 3;
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
export declare const SCHEMA_SQL = "\n-- Git objects (blobs, trees, commits, tags)\nCREATE TABLE IF NOT EXISTS objects (sha TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at INTEGER);\n\n-- Object location index for tiered storage\n-- Tracks object locations across storage tiers (hot/r2/parquet)\n-- pack_id and offset are used for R2 and Parquet tiers where objects are stored in packfiles\n-- chunked and chunk_count are used for large blobs (>=2MB) stored in 2MB chunks for DO SQLite cost optimization\nCREATE TABLE IF NOT EXISTS object_index (sha TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'hot', pack_id TEXT, offset INTEGER, size INTEGER, type TEXT, updated_at INTEGER, chunked INTEGER DEFAULT 0, chunk_count INTEGER DEFAULT 0);\n\n-- Hot objects cache\nCREATE TABLE IF NOT EXISTS hot_objects (sha TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, accessed_at INTEGER, created_at INTEGER);\n\n-- Write-ahead log\nCREATE TABLE IF NOT EXISTS wal (id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, payload BLOB NOT NULL, created_at INTEGER, flushed INTEGER DEFAULT 0);\n\n-- Refs table\nCREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NOT NULL, type TEXT DEFAULT 'sha', updated_at INTEGER);\n\n-- Git repository bindings for GitModule integration\n-- Stores repository configuration and sync state\nCREATE TABLE IF NOT EXISTS git (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  repo TEXT NOT NULL UNIQUE,\n  path TEXT,\n  branch TEXT NOT NULL DEFAULT 'main',\n  \"commit\" TEXT,\n  last_sync INTEGER,\n  object_prefix TEXT DEFAULT 'git/objects',\n  created_at INTEGER,\n  updated_at INTEGER\n);\n\n-- Git branches table for tracking branch state per repository\n-- Each repository can have multiple branches tracked\nCREATE TABLE IF NOT EXISTS git_branches (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  repo_id INTEGER NOT NULL REFERENCES git(id) ON DELETE CASCADE,\n  name TEXT NOT NULL,\n  head TEXT,\n  upstream TEXT,\n  tracking INTEGER DEFAULT 0,\n  ahead INTEGER DEFAULT 0,\n  behind INTEGER DEFAULT 0,\n  created_at INTEGER,\n  updated_at INTEGER,\n  UNIQUE(repo_id, name)\n);\n\n-- Git content table for staged files awaiting commit\n-- Stores file references using integer rowid foreign key for efficient lookups\n-- file_id references the shared files table for unified filesystem integration\nCREATE TABLE IF NOT EXISTS git_content (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  repo_id INTEGER NOT NULL REFERENCES git(id) ON DELETE CASCADE,\n  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,\n  path TEXT NOT NULL,\n  content BLOB,\n  mode TEXT DEFAULT '100644',\n  status TEXT NOT NULL DEFAULT 'staged',\n  sha TEXT,\n  created_at INTEGER,\n  updated_at INTEGER,\n  UNIQUE(repo_id, path)\n);\n\n-- Exec table for BashModule execution safety settings and policies\n-- Stores blocked commands, confirmation requirements, and execution policies\nCREATE TABLE IF NOT EXISTS exec (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL UNIQUE,\n  blocked_commands TEXT,\n  require_confirmation INTEGER DEFAULT 1,\n  default_timeout INTEGER DEFAULT 30000,\n  default_cwd TEXT DEFAULT '/',\n  allowed_patterns TEXT,\n  denied_patterns TEXT,\n  max_concurrent INTEGER DEFAULT 5,\n  enabled INTEGER DEFAULT 1,\n  created_at INTEGER,\n  updated_at INTEGER\n);\n\n-- Branch protection rules\nCREATE TABLE IF NOT EXISTS branch_protection (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  pattern TEXT NOT NULL UNIQUE,\n  required_reviews INTEGER NOT NULL DEFAULT 0,\n  prevent_force_push INTEGER NOT NULL DEFAULT 1,\n  prevent_deletion INTEGER NOT NULL DEFAULT 1,\n  enabled INTEGER NOT NULL DEFAULT 1,\n  created_at INTEGER NOT NULL DEFAULT 0,\n  updated_at INTEGER NOT NULL DEFAULT 0\n);\n\n-- Indexes\nCREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type);\nCREATE INDEX IF NOT EXISTS idx_wal_flushed ON wal(flushed);\nCREATE INDEX IF NOT EXISTS idx_hot_objects_accessed ON hot_objects(accessed_at);\nCREATE INDEX IF NOT EXISTS idx_object_index_tier ON object_index(tier);\nCREATE INDEX IF NOT EXISTS idx_object_index_pack_id ON object_index(pack_id);\nCREATE INDEX IF NOT EXISTS idx_git_branches_repo ON git_branches(repo_id);\nCREATE INDEX IF NOT EXISTS idx_git_content_repo_path ON git_content(repo_id, path);\nCREATE INDEX IF NOT EXISTS idx_git_content_status ON git_content(status);\nCREATE INDEX IF NOT EXISTS idx_git_content_file_id ON git_content(file_id);\nCREATE INDEX IF NOT EXISTS idx_exec_name ON exec(name);\nCREATE INDEX IF NOT EXISTS idx_exec_enabled ON exec(enabled);\nCREATE INDEX IF NOT EXISTS idx_branch_protection_pattern ON branch_protection(pattern);\nCREATE INDEX IF NOT EXISTS idx_branch_protection_enabled ON branch_protection(enabled);\n\n-- Bundle index: maps SHAs to bundle files + offsets for BundleStorage\nCREATE TABLE IF NOT EXISTS bundle_index (\n  sha TEXT PRIMARY KEY,\n  bundle_id TEXT NOT NULL,\n  bundle_key TEXT NOT NULL,\n  offset INTEGER NOT NULL,\n  size INTEGER NOT NULL,\n  type TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS idx_bundle_index_bundle_id ON bundle_index(bundle_id);\nCREATE INDEX IF NOT EXISTS idx_bundle_index_type ON bundle_index(type);\n\n-- Bundle metadata: tracks sealed bundles and their state\nCREATE TABLE IF NOT EXISTS bundle_metadata (\n  bundle_id TEXT PRIMARY KEY,\n  bundle_key TEXT NOT NULL,\n  object_count INTEGER NOT NULL,\n  total_size INTEGER NOT NULL,\n  sealed_at INTEGER NOT NULL,\n  compacted INTEGER NOT NULL DEFAULT 0,\n  superseded_by TEXT\n);\nCREATE INDEX IF NOT EXISTS idx_bundle_metadata_sealed_at ON bundle_metadata(sealed_at);\nCREATE INDEX IF NOT EXISTS idx_bundle_metadata_compacted ON bundle_metadata(compacted);\n";
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
export declare const THIN_SCHEMA_SQL = "\n-- Refs table (authoritative ref storage)\nCREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NOT NULL, type TEXT DEFAULT 'sha', updated_at INTEGER);\n\n-- Bloom filter persistence for SHA existence checks\nCREATE TABLE IF NOT EXISTS bloom_filter (\n  id INTEGER PRIMARY KEY DEFAULT 1,\n  filter_data BLOB NOT NULL,\n  item_count INTEGER NOT NULL DEFAULT 0,\n  updated_at INTEGER NOT NULL\n);\n\n-- SHA existence cache (exact lookups alongside bloom filter)\nCREATE TABLE IF NOT EXISTS sha_cache (\n  sha TEXT PRIMARY KEY,\n  type TEXT NOT NULL,\n  size INTEGER NOT NULL,\n  added_at INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS idx_sha_cache_added ON sha_cache(added_at);\n\n-- Compaction journal for crash recovery during R2 Parquet compaction\n-- If the DO restarts mid-compaction, this table tells us what to clean up\nCREATE TABLE IF NOT EXISTS compaction_journal (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  source_keys TEXT NOT NULL,\n  target_key TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'in_progress',\n  created_at INTEGER NOT NULL\n);\n\n-- Compaction alarm retry state for exponential backoff\nCREATE TABLE IF NOT EXISTS compaction_retries (\n  id INTEGER PRIMARY KEY DEFAULT 1,\n  attempt_count INTEGER NOT NULL DEFAULT 0,\n  last_error TEXT,\n  updated_at INTEGER NOT NULL\n);\n\n-- Write-ahead log for ParquetStore write buffer durability\n-- Buffered objects are persisted here before being acknowledged\n-- On crash recovery, un-flushed WAL entries are replayed into the buffer\nCREATE TABLE IF NOT EXISTS write_buffer_wal (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  sha TEXT NOT NULL,\n  type TEXT NOT NULL,\n  data BLOB NOT NULL,\n  path TEXT,\n  created_at INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS idx_write_buffer_wal_sha ON write_buffer_wal(sha);\n\n-- Branch protection rules\nCREATE TABLE IF NOT EXISTS branch_protection (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  pattern TEXT NOT NULL UNIQUE,\n  required_reviews INTEGER NOT NULL DEFAULT 0,\n  prevent_force_push INTEGER NOT NULL DEFAULT 1,\n  prevent_deletion INTEGER NOT NULL DEFAULT 1,\n  enabled INTEGER NOT NULL DEFAULT 1,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS idx_branch_protection_pattern ON branch_protection(pattern);\nCREATE INDEX IF NOT EXISTS idx_branch_protection_enabled ON branch_protection(enabled);\n\n-- Bundle index: maps SHAs to bundle files + offsets for BundleStorage\nCREATE TABLE IF NOT EXISTS bundle_index (\n  sha TEXT PRIMARY KEY,\n  bundle_id TEXT NOT NULL,\n  bundle_key TEXT NOT NULL,\n  offset INTEGER NOT NULL,\n  size INTEGER NOT NULL,\n  type TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS idx_bundle_index_bundle_id ON bundle_index(bundle_id);\nCREATE INDEX IF NOT EXISTS idx_bundle_index_type ON bundle_index(type);\n\n-- Bundle metadata: tracks sealed bundles and their state\nCREATE TABLE IF NOT EXISTS bundle_metadata (\n  bundle_id TEXT PRIMARY KEY,\n  bundle_key TEXT NOT NULL,\n  object_count INTEGER NOT NULL,\n  total_size INTEGER NOT NULL,\n  sealed_at INTEGER NOT NULL,\n  compacted INTEGER NOT NULL DEFAULT 0,\n  superseded_by TEXT\n);\nCREATE INDEX IF NOT EXISTS idx_bundle_metadata_sealed_at ON bundle_metadata(sealed_at);\nCREATE INDEX IF NOT EXISTS idx_bundle_metadata_compacted ON bundle_metadata(compacted);\n";
/**
 * Optional legacy tables that may exist during migration.
 */
export declare const LEGACY_TABLES: string[];
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
export declare class SchemaManager {
    private storage;
    /**
     * Create a new SchemaManager.
     *
     * @param storage - Durable Object storage interface
     */
    constructor(storage: DurableObjectStorage);
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
    initializeSchema(): Promise<void>;
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
    getSchemaVersion(): Promise<number>;
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
    validateSchema(): Promise<boolean>;
}
/**
 * Schema manager for the thin DO coordinator pattern.
 *
 * Only initializes the minimal refs + bloom filter + sha_cache tables.
 * Legacy tables are NOT created unless explicitly requested via
 * initializeLegacySchema().
 */
export declare class ThinSchemaManager {
    private storage;
    constructor(storage: DurableObjectStorage);
    /**
     * Initialize the thin coordinator schema.
     */
    initializeSchema(): Promise<void>;
    /**
     * Initialize the full legacy schema (for migration period).
     */
    initializeLegacySchema(): Promise<void>;
    /**
     * Get the schema version. Returns 2 for thin, 1 for legacy, 0 for missing.
     */
    getSchemaVersion(): Promise<number>;
    /**
     * Validate that all required thin coordinator tables exist.
     */
    validateSchema(): Promise<boolean>;
    /**
     * Check if legacy tables exist (for migration detection).
     */
    hasLegacyTables(): Promise<boolean>;
}
//# sourceMappingURL=schema.d.ts.map