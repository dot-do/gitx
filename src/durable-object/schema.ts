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
 *
 * @module durable-object/schema
 *
 * @example
 * ```typescript
 * import { SchemaManager, DurableObjectStorage } from './durable-object/schema'
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

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Interface representing Durable Object storage with SQL capabilities.
 *
 * @description
 * Abstraction over Cloudflare's Durable Object storage that provides
 * SQLite access. This interface allows for easy mocking in tests.
 *
 * @example
 * ```typescript
 * const storage: DurableObjectStorage = {
 *   sql: {
 *     exec(query: string, ...params: unknown[]) {
 *       // Execute SQL and return results
 *       return { toArray: () => [] }
 *     }
 *   }
 * }
 * ```
 */
export interface DurableObjectStorage {
  /**
   * SQL execution interface.
   *
   * @description
   * Provides access to SQLite query execution within the Durable Object.
   */
  sql: {
    /**
     * Execute a SQL query with optional parameters.
     *
     * @param query - SQL query string (can use ? placeholders)
     * @param params - Parameter values for placeholders
     * @returns Result object with toArray() method for reading rows
     *
     * @example
     * ```typescript
     * const result = storage.sql.exec(
     *   'SELECT * FROM objects WHERE sha = ?',
     *   'abc123...'
     * )
     * const rows = result.toArray()
     * ```
     */
    exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
  }
}

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
export const SCHEMA_VERSION = 1

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
 *
 * **Indexes**:
 * - `idx_objects_type`: Fast lookup by object type
 * - `idx_wal_flushed`: Find unflushed WAL entries
 * - `idx_hot_objects_accessed`: LRU eviction ordering
 */
export const SCHEMA_SQL = `
-- Git objects (blobs, trees, commits, tags)
CREATE TABLE IF NOT EXISTS objects (sha TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at INTEGER);

-- Object location index for tiered storage
CREATE TABLE IF NOT EXISTS object_index (sha TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'hot', location TEXT NOT NULL DEFAULT 'local', size INTEGER, type TEXT);

-- Hot objects cache
CREATE TABLE IF NOT EXISTS hot_objects (sha TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, accessed_at INTEGER, created_at INTEGER);

-- Write-ahead log
CREATE TABLE IF NOT EXISTS wal (id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, payload BLOB NOT NULL, created_at INTEGER, flushed INTEGER DEFAULT 0);

-- Refs table
CREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NOT NULL, type TEXT DEFAULT 'sha', updated_at INTEGER);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type);
CREATE INDEX IF NOT EXISTS idx_wal_flushed ON wal(flushed);
CREATE INDEX IF NOT EXISTS idx_hot_objects_accessed ON hot_objects(accessed_at);
`

/**
 * List of required tables for schema validation.
 *
 * @description
 * Used by validateSchema() to verify all required tables exist.
 * @internal
 */
const REQUIRED_TABLES = ['objects', 'object_index', 'hot_objects', 'wal', 'refs']

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
    const tables = result.toArray() as { name: string }[]
    const tableNames = tables.map(t => t.name)

    return REQUIRED_TABLES.every(table => tableNames.includes(table))
  }
}
