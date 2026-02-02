/**
 * @fileoverview SQLite Schema for Bundle Storage
 *
 * This module defines the SQLite schema for tracking bundles and their contents.
 * Bundles are collections of Git objects stored together in R2 for efficient
 * storage and retrieval.
 *
 * ## Tables
 *
 * - `bundles`: Metadata about each bundle file in R2
 * - `bundle_objects`: Index linking objects to their containing bundle
 * - `active_bundle`: Tracks the current bundle being written to
 * - `schema_migrations`: Tracks applied schema migrations
 *
 * ## Migration System
 *
 * The schema includes a versioned migration system that supports:
 * - Forward migrations for schema updates
 * - Version tracking to prevent duplicate migrations
 * - Safe upgrade from non-bundle storage
 *
 * @module storage/bundle-schema
 *
 * @example
 * ```typescript
 * import { BundleSchemaManager } from './bundle-schema'
 *
 * const schemaManager = new BundleSchemaManager(storage)
 *
 * // Initialize or migrate schema
 * await schemaManager.ensureSchema()
 *
 * // Check current version
 * const version = await schemaManager.getVersion()
 * console.log(`Schema version: ${version}`)
 * ```
 */
// =============================================================================
// Schema Version Constants
// =============================================================================
/**
 * Current bundle schema version.
 *
 * @description
 * Increment this when making schema changes that require migration.
 * Each version should have a corresponding migration in MIGRATIONS array.
 */
export const BUNDLE_SCHEMA_VERSION = 1;
// =============================================================================
// Schema SQL
// =============================================================================
/**
 * SQL to create the schema_migrations tracking table.
 */
export const SCHEMA_MIGRATIONS_TABLE_SQL = `
-- Schema migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
`;
/**
 * SQL to create the bundles table.
 *
 * @description
 * Stores metadata about each bundle file in R2. Each bundle contains
 * multiple Git objects packed together.
 *
 * Fields:
 * - id: Unique bundle identifier (e.g., 'bundle-xyz123')
 * - r2_key: The R2 object key where the bundle is stored
 * - entry_count: Number of objects in this bundle
 * - size: Total size of the bundle file in bytes
 * - data_offset: Byte offset where object data starts (after header)
 * - created_at: Unix timestamp when bundle was created
 * - sealed: 1 if bundle is complete and no more writes allowed
 * - checksum: Optional checksum for integrity verification
 */
export const BUNDLES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS bundles (
  id TEXT PRIMARY KEY,
  r2_key TEXT UNIQUE NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  data_offset INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sealed INTEGER NOT NULL DEFAULT 0,
  checksum TEXT
);
`;
/**
 * SQL to create the bundle_objects table.
 *
 * @description
 * Index table linking objects to their containing bundles. Enables
 * fast lookup of which bundle contains a specific object.
 *
 * Fields:
 * - key_hash: SHA-1 hash of the object key (for efficient indexing)
 * - key: Original object key/SHA
 * - bundle_id: Foreign key to bundles table
 * - offset: Byte offset within the bundle's data section
 * - size: Compressed size in bytes
 * - uncompressed_size: Original uncompressed size
 * - type: Object type (blob, tree, commit, tag)
 * - crc32: CRC32 checksum for data integrity
 * - deleted: Soft delete flag (1 = deleted)
 * - created_at: Unix timestamp when object was added
 */
export const BUNDLE_OBJECTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS bundle_objects (
  key_hash TEXT NOT NULL,
  key TEXT NOT NULL,
  bundle_id TEXT NOT NULL REFERENCES bundles(id),
  offset INTEGER NOT NULL,
  size INTEGER NOT NULL,
  uncompressed_size INTEGER NOT NULL,
  type TEXT NOT NULL,
  crc32 INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (key_hash, bundle_id)
);
`;
/**
 * SQL to create indexes on bundle_objects table.
 */
export const BUNDLE_OBJECTS_INDEXES_SQL = `
-- Index for looking up objects by key
CREATE INDEX IF NOT EXISTS idx_bundle_objects_key ON bundle_objects(key);

-- Index for finding all objects in a bundle
CREATE INDEX IF NOT EXISTS idx_bundle_objects_bundle ON bundle_objects(bundle_id);

-- Index for finding non-deleted objects
CREATE INDEX IF NOT EXISTS idx_bundle_objects_deleted ON bundle_objects(deleted) WHERE deleted = 0;

-- Index for type-based queries
CREATE INDEX IF NOT EXISTS idx_bundle_objects_type ON bundle_objects(type);
`;
/**
 * SQL to create the active_bundle table.
 *
 * @description
 * Singleton table tracking the current bundle being written to.
 * Only one row should exist (id = 1). When a bundle is sealed,
 * this row is deleted until a new bundle is started.
 *
 * Fields:
 * - id: Always 1 (singleton pattern)
 * - bundle_id: ID of the currently active bundle
 * - current_offset: Next write position in the bundle
 * - object_count: Number of objects written to this bundle
 * - bytes_written: Total bytes written to this bundle
 * - started_at: When this bundle was started
 * - updated_at: Last write timestamp
 */
export const ACTIVE_BUNDLE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS active_bundle (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bundle_id TEXT NOT NULL REFERENCES bundles(id),
  current_offset INTEGER NOT NULL,
  object_count INTEGER NOT NULL DEFAULT 0,
  bytes_written INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;
/**
 * SQL to create additional bundle-related indexes.
 */
export const BUNDLES_INDEXES_SQL = `
-- Index for finding unsealed bundles
CREATE INDEX IF NOT EXISTS idx_bundles_sealed ON bundles(sealed);

-- Index for finding bundles by creation time
CREATE INDEX IF NOT EXISTS idx_bundles_created_at ON bundles(created_at);
`;
/**
 * Complete bundle schema SQL (all tables and indexes).
 */
export const BUNDLE_SCHEMA_SQL = `
${SCHEMA_MIGRATIONS_TABLE_SQL}
${BUNDLES_TABLE_SQL}
${BUNDLE_OBJECTS_TABLE_SQL}
${BUNDLE_OBJECTS_INDEXES_SQL}
${ACTIVE_BUNDLE_TABLE_SQL}
${BUNDLES_INDEXES_SQL}
`;
// =============================================================================
// Migrations
// =============================================================================
/**
 * Array of schema migrations in order.
 *
 * @description
 * Each migration upgrades the schema to the next version.
 * Migrations are applied in order and tracked in schema_migrations table.
 */
export const MIGRATIONS = [
    {
        version: 1,
        description: 'Initial bundle schema with bundles, bundle_objects, and active_bundle tables',
        up: `
      ${BUNDLES_TABLE_SQL}
      ${BUNDLE_OBJECTS_TABLE_SQL}
      ${BUNDLE_OBJECTS_INDEXES_SQL}
      ${ACTIVE_BUNDLE_TABLE_SQL}
      ${BUNDLES_INDEXES_SQL}
    `,
        down: `
      DROP TABLE IF EXISTS active_bundle;
      DROP TABLE IF EXISTS bundle_objects;
      DROP TABLE IF EXISTS bundles;
    `
    }
];
// =============================================================================
// BundleSchemaManager Class
// =============================================================================
/**
 * Manager for bundle schema initialization and migrations.
 *
 * @description
 * Handles schema lifecycle including:
 * - Initial schema creation
 * - Version tracking
 * - Migrations for schema updates
 * - Validation of existing schema
 *
 * @example
 * ```typescript
 * const manager = new BundleSchemaManager(storage)
 *
 * // Ensure schema is up to date
 * await manager.ensureSchema()
 *
 * // Check version
 * const version = await manager.getVersion()
 *
 * // Validate schema
 * const isValid = await manager.validateSchema()
 * ```
 */
export class BundleSchemaManager {
    storage;
    /**
     * Create a new BundleSchemaManager.
     *
     * @param storage - Durable Object storage with SQL support
     */
    constructor(storage) {
        this.storage = storage;
    }
    /**
     * Ensure the schema is initialized and up to date.
     *
     * @description
     * Creates the schema_migrations table if needed, then applies
     * any pending migrations to bring the schema to the current version.
     *
     * @returns The current schema version after migrations
     */
    async ensureSchema() {
        // Create migrations tracking table
        this.storage.sql.exec(SCHEMA_MIGRATIONS_TABLE_SQL);
        // Get current version
        const currentVersion = await this.getVersion();
        // Apply pending migrations
        for (const migration of MIGRATIONS) {
            if (migration.version > currentVersion) {
                await this.applyMigration(migration);
            }
        }
        return await this.getVersion();
    }
    /**
     * Get the current schema version.
     *
     * @description
     * Returns the highest version number from the schema_migrations table,
     * or 0 if no migrations have been applied.
     *
     * @returns Current schema version (0 if not initialized)
     */
    async getVersion() {
        try {
            const result = this.storage.sql.exec('SELECT MAX(version) as version FROM schema_migrations');
            const rows = result.toArray();
            return rows[0]?.version ?? 0;
        }
        catch (error) {
            // Table might not exist yet - this is expected on first run
            console.debug('[BundleSchemaManager] schema_migrations table not found, returning version 0:', error instanceof Error ? error.message : String(error));
            return 0;
        }
    }
    /**
     * Apply a single migration.
     *
     * @param migration - The migration to apply
     */
    async applyMigration(migration) {
        // Execute migration SQL
        this.storage.sql.exec(migration.up);
        // Record migration
        this.storage.sql.exec('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)', migration.version, migration.description, Date.now());
    }
    /**
     * Validate that all required tables exist.
     *
     * @returns True if schema is valid and complete
     */
    async validateSchema() {
        const requiredTables = ['bundles', 'bundle_objects', 'active_bundle', 'schema_migrations'];
        try {
            const result = this.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'");
            const tables = result.toArray();
            const tableNames = tables.map(t => t.name);
            return requiredTables.every(table => tableNames.includes(table));
        }
        catch (error) {
            console.warn('[BundleSchemaManager] validateSchema failed:', error instanceof Error ? error.message : String(error));
            return false;
        }
    }
    /**
     * Get list of applied migrations.
     *
     * @returns Array of applied migration versions and descriptions
     */
    async getAppliedMigrations() {
        try {
            const result = this.storage.sql.exec('SELECT version, description, applied_at FROM schema_migrations ORDER BY version');
            return result.toArray();
        }
        catch (error) {
            console.debug('[BundleSchemaManager] getAppliedMigrations failed (table may not exist):', error instanceof Error ? error.message : String(error));
            return [];
        }
    }
    /**
     * Check if a specific version has been applied.
     *
     * @param version - Version number to check
     * @returns True if the version has been applied
     */
    async hasVersion(version) {
        try {
            const result = this.storage.sql.exec('SELECT 1 FROM schema_migrations WHERE version = ?', version);
            return result.toArray().length > 0;
        }
        catch (error) {
            console.debug('[BundleSchemaManager] hasVersion check failed (table may not exist):', error instanceof Error ? error.message : String(error));
            return false;
        }
    }
    /**
     * Reset the schema (for testing purposes).
     *
     * @description
     * Drops all bundle-related tables. Use with caution!
     * This is primarily for testing and development.
     */
    async resetSchema() {
        this.storage.sql.exec('DROP TABLE IF EXISTS active_bundle');
        this.storage.sql.exec('DROP TABLE IF EXISTS bundle_objects');
        this.storage.sql.exec('DROP TABLE IF EXISTS bundles');
        this.storage.sql.exec('DROP TABLE IF EXISTS schema_migrations');
    }
}
// =============================================================================
// Bundle Index Functions
// =============================================================================
/**
 * Record a bundle in the database.
 *
 * @param storage - Durable Object storage
 * @param bundle - Bundle metadata to record
 */
export function recordBundle(storage, bundle) {
    const createdAt = bundle.created_at ?? Date.now();
    storage.sql.exec(`INSERT OR REPLACE INTO bundles (id, r2_key, entry_count, size, data_offset, created_at, sealed, checksum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, bundle.id, bundle.r2_key, bundle.entry_count, bundle.size, bundle.data_offset, createdAt, bundle.sealed, bundle.checksum);
}
/**
 * Look up a bundle by ID.
 *
 * @param storage - Durable Object storage
 * @param bundleId - Bundle ID to look up
 * @returns Bundle record or null if not found
 */
export function lookupBundle(storage, bundleId) {
    const result = storage.sql.exec('SELECT * FROM bundles WHERE id = ?', bundleId);
    const rows = result.toArray();
    return rows[0] ?? null;
}
/**
 * Record an object's location within a bundle.
 *
 * @param storage - Durable Object storage
 * @param obj - Object metadata to record
 */
export function recordBundleObject(storage, obj) {
    const createdAt = obj.created_at ?? Date.now();
    storage.sql.exec(`INSERT OR REPLACE INTO bundle_objects
     (key_hash, key, bundle_id, offset, size, uncompressed_size, type, crc32, deleted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, obj.key_hash, obj.key, obj.bundle_id, obj.offset, obj.size, obj.uncompressed_size, obj.type, obj.crc32, obj.deleted, createdAt);
}
/**
 * Look up an object's location by key.
 *
 * @param storage - Durable Object storage
 * @param key - Object key (SHA) to look up
 * @returns Object record or null if not found
 */
export function lookupBundleObject(storage, key) {
    // Look up by key, preferring non-deleted entries
    const result = storage.sql.exec(`SELECT * FROM bundle_objects WHERE key = ? AND deleted = 0 ORDER BY created_at DESC LIMIT 1`, key);
    const rows = result.toArray();
    return rows[0] ?? null;
}
/**
 * Get all objects in a bundle.
 *
 * @param storage - Durable Object storage
 * @param bundleId - Bundle ID
 * @returns Array of object records in the bundle
 */
export function getBundleObjects(storage, bundleId) {
    const result = storage.sql.exec('SELECT * FROM bundle_objects WHERE bundle_id = ? AND deleted = 0 ORDER BY offset', bundleId);
    return result.toArray();
}
/**
 * Mark an object as deleted (soft delete).
 *
 * @param storage - Durable Object storage
 * @param key - Object key to mark as deleted
 * @returns Number of rows affected
 */
export function markObjectDeleted(storage, key) {
    const result = storage.sql.exec('UPDATE bundle_objects SET deleted = 1 WHERE key = ?', key);
    const rows = result.toArray();
    return rows[0]?.changes ?? 0;
}
/**
 * Seal a bundle (mark as complete, no more writes).
 *
 * @param storage - Durable Object storage
 * @param bundleId - Bundle ID to seal
 * @param checksum - Optional checksum to store
 */
export function sealBundle(storage, bundleId, checksum) {
    storage.sql.exec('UPDATE bundles SET sealed = 1, checksum = ? WHERE id = ?', checksum ?? null, bundleId);
}
/**
 * Get or create the active bundle record.
 *
 * @param storage - Durable Object storage
 * @returns Active bundle record or null if none active
 */
export function getActiveBundle(storage) {
    const result = storage.sql.exec('SELECT * FROM active_bundle WHERE id = 1');
    const rows = result.toArray();
    return rows[0] ?? null;
}
/**
 * Set the active bundle.
 *
 * @param storage - Durable Object storage
 * @param bundleId - Bundle ID to make active
 * @param dataOffset - Starting data offset
 */
export function setActiveBundle(storage, bundleId, dataOffset) {
    const now = Date.now();
    storage.sql.exec(`INSERT OR REPLACE INTO active_bundle
     (id, bundle_id, current_offset, object_count, bytes_written, started_at, updated_at)
     VALUES (1, ?, ?, 0, 0, ?, ?)`, bundleId, dataOffset, now, now);
}
/**
 * Update the active bundle's progress.
 *
 * @param storage - Durable Object storage
 * @param currentOffset - New current offset
 * @param bytesWritten - Total bytes written
 * @param objectCount - Total object count
 */
export function updateActiveBundle(storage, currentOffset, bytesWritten, objectCount) {
    storage.sql.exec(`UPDATE active_bundle
     SET current_offset = ?, bytes_written = ?, object_count = ?, updated_at = ?
     WHERE id = 1`, currentOffset, bytesWritten, objectCount, Date.now());
}
/**
 * Clear the active bundle (when sealed or on error).
 *
 * @param storage - Durable Object storage
 */
export function clearActiveBundle(storage) {
    storage.sql.exec('DELETE FROM active_bundle WHERE id = 1');
}
/**
 * Get statistics about bundles.
 *
 * @param storage - Durable Object storage
 * @returns Bundle statistics
 */
export function getBundleStats(storage) {
    const bundleResult = storage.sql.exec(`SELECT
       COUNT(*) as total_bundles,
       SUM(CASE WHEN sealed = 1 THEN 1 ELSE 0 END) as sealed_bundles,
       SUM(size) as total_size
     FROM bundles`);
    const bundleStats = bundleResult.toArray();
    const objectResult = storage.sql.exec(`SELECT
       COUNT(*) as total_objects,
       SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) as deleted_objects
     FROM bundle_objects`);
    const objectStats = objectResult.toArray();
    return {
        totalBundles: bundleStats[0]?.total_bundles ?? 0,
        sealedBundles: bundleStats[0]?.sealed_bundles ?? 0,
        totalSize: bundleStats[0]?.total_size ?? 0,
        totalObjects: objectStats[0]?.total_objects ?? 0,
        deletedObjects: objectStats[0]?.deleted_objects ?? 0
    };
}
/**
 * List all bundles.
 *
 * @param storage - Durable Object storage
 * @param options - Query options
 * @returns Array of bundle records
 */
export function listBundles(storage, options) {
    let query = 'SELECT * FROM bundles';
    const params = [];
    if (options?.sealedOnly) {
        query += ' WHERE sealed = 1';
    }
    query += ' ORDER BY created_at DESC';
    if (options?.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
    }
    if (options?.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
    }
    const result = storage.sql.exec(query, ...params);
    return result.toArray();
}
//# sourceMappingURL=bundle-schema.js.map