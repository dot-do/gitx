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
import type { DurableObjectStorage } from './types';
/**
 * Current bundle schema version.
 *
 * @description
 * Increment this when making schema changes that require migration.
 * Each version should have a corresponding migration in MIGRATIONS array.
 */
export declare const BUNDLE_SCHEMA_VERSION = 1;
/**
 * Represents a bundle record in the database.
 */
export interface BundleRecord {
    /** Unique bundle identifier */
    id: string;
    /** R2 object key for the bundle */
    r2_key: string;
    /** Number of objects in the bundle */
    entry_count: number;
    /** Total size of the bundle in bytes */
    size: number;
    /** Byte offset where object data starts (after header) */
    data_offset: number;
    /** Unix timestamp when bundle was created */
    created_at: number;
    /** Whether the bundle is sealed (no more writes) */
    sealed: number;
    /** Optional checksum for integrity verification */
    checksum: string | null;
}
/**
 * Represents an object entry in the bundle_objects table.
 */
export interface BundleObjectRecord {
    /** SHA-1 hash of the object key (for indexing) */
    key_hash: string;
    /** Original object key */
    key: string;
    /** ID of the containing bundle */
    bundle_id: string;
    /** Byte offset within the bundle's data section */
    offset: number;
    /** Compressed size in bytes */
    size: number;
    /** Uncompressed size in bytes */
    uncompressed_size: number;
    /** Object type: 'blob', 'tree', 'commit', 'tag' */
    type: string;
    /** CRC32 checksum for integrity */
    crc32: number;
    /** Whether the object has been logically deleted */
    deleted: number;
    /** Unix timestamp when object was added */
    created_at: number;
}
/**
 * Represents the active bundle being written to.
 */
export interface ActiveBundleRecord {
    /** Fixed ID (always 1 for singleton) */
    id: number;
    /** ID of the active bundle */
    bundle_id: string;
    /** Current byte offset for next write */
    current_offset: number;
    /** Number of objects written so far */
    object_count: number;
    /** Total bytes written so far */
    bytes_written: number;
    /** Timestamp when this bundle started */
    started_at: number;
    /** Last write timestamp */
    updated_at: number;
}
/**
 * Schema migration definition.
 */
export interface SchemaMigration {
    /** Version number this migration upgrades to */
    version: number;
    /** Description of the migration */
    description: string;
    /** SQL statements to execute for the migration */
    up: string;
    /** SQL statements to rollback the migration (optional) */
    down?: string;
}
/**
 * SQL to create the schema_migrations tracking table.
 */
export declare const SCHEMA_MIGRATIONS_TABLE_SQL = "\n-- Schema migrations tracking table\nCREATE TABLE IF NOT EXISTS schema_migrations (\n  version INTEGER PRIMARY KEY,\n  description TEXT NOT NULL,\n  applied_at INTEGER NOT NULL\n);\n";
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
export declare const BUNDLES_TABLE_SQL = "\nCREATE TABLE IF NOT EXISTS bundles (\n  id TEXT PRIMARY KEY,\n  r2_key TEXT UNIQUE NOT NULL,\n  entry_count INTEGER NOT NULL DEFAULT 0,\n  size INTEGER NOT NULL DEFAULT 0,\n  data_offset INTEGER NOT NULL,\n  created_at INTEGER NOT NULL,\n  sealed INTEGER NOT NULL DEFAULT 0,\n  checksum TEXT\n);\n";
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
export declare const BUNDLE_OBJECTS_TABLE_SQL = "\nCREATE TABLE IF NOT EXISTS bundle_objects (\n  key_hash TEXT NOT NULL,\n  key TEXT NOT NULL,\n  bundle_id TEXT NOT NULL REFERENCES bundles(id),\n  offset INTEGER NOT NULL,\n  size INTEGER NOT NULL,\n  uncompressed_size INTEGER NOT NULL,\n  type TEXT NOT NULL,\n  crc32 INTEGER NOT NULL,\n  deleted INTEGER NOT NULL DEFAULT 0,\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY (key_hash, bundle_id)\n);\n";
/**
 * SQL to create indexes on bundle_objects table.
 */
export declare const BUNDLE_OBJECTS_INDEXES_SQL = "\n-- Index for looking up objects by key\nCREATE INDEX IF NOT EXISTS idx_bundle_objects_key ON bundle_objects(key);\n\n-- Index for finding all objects in a bundle\nCREATE INDEX IF NOT EXISTS idx_bundle_objects_bundle ON bundle_objects(bundle_id);\n\n-- Index for finding non-deleted objects\nCREATE INDEX IF NOT EXISTS idx_bundle_objects_deleted ON bundle_objects(deleted) WHERE deleted = 0;\n\n-- Index for type-based queries\nCREATE INDEX IF NOT EXISTS idx_bundle_objects_type ON bundle_objects(type);\n";
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
export declare const ACTIVE_BUNDLE_TABLE_SQL = "\nCREATE TABLE IF NOT EXISTS active_bundle (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  bundle_id TEXT NOT NULL REFERENCES bundles(id),\n  current_offset INTEGER NOT NULL,\n  object_count INTEGER NOT NULL DEFAULT 0,\n  bytes_written INTEGER NOT NULL DEFAULT 0,\n  started_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\n";
/**
 * SQL to create additional bundle-related indexes.
 */
export declare const BUNDLES_INDEXES_SQL = "\n-- Index for finding unsealed bundles\nCREATE INDEX IF NOT EXISTS idx_bundles_sealed ON bundles(sealed);\n\n-- Index for finding bundles by creation time\nCREATE INDEX IF NOT EXISTS idx_bundles_created_at ON bundles(created_at);\n";
/**
 * Complete bundle schema SQL (all tables and indexes).
 */
export declare const BUNDLE_SCHEMA_SQL = "\n\n-- Schema migrations tracking table\nCREATE TABLE IF NOT EXISTS schema_migrations (\n  version INTEGER PRIMARY KEY,\n  description TEXT NOT NULL,\n  applied_at INTEGER NOT NULL\n);\n\n\nCREATE TABLE IF NOT EXISTS bundles (\n  id TEXT PRIMARY KEY,\n  r2_key TEXT UNIQUE NOT NULL,\n  entry_count INTEGER NOT NULL DEFAULT 0,\n  size INTEGER NOT NULL DEFAULT 0,\n  data_offset INTEGER NOT NULL,\n  created_at INTEGER NOT NULL,\n  sealed INTEGER NOT NULL DEFAULT 0,\n  checksum TEXT\n);\n\n\nCREATE TABLE IF NOT EXISTS bundle_objects (\n  key_hash TEXT NOT NULL,\n  key TEXT NOT NULL,\n  bundle_id TEXT NOT NULL REFERENCES bundles(id),\n  offset INTEGER NOT NULL,\n  size INTEGER NOT NULL,\n  uncompressed_size INTEGER NOT NULL,\n  type TEXT NOT NULL,\n  crc32 INTEGER NOT NULL,\n  deleted INTEGER NOT NULL DEFAULT 0,\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY (key_hash, bundle_id)\n);\n\n\n-- Index for looking up objects by key\nCREATE INDEX IF NOT EXISTS idx_bundle_objects_key ON bundle_objects(key);\n\n-- Index for finding all objects in a bundle\nCREATE INDEX IF NOT EXISTS idx_bundle_objects_bundle ON bundle_objects(bundle_id);\n\n-- Index for finding non-deleted objects\nCREATE INDEX IF NOT EXISTS idx_bundle_objects_deleted ON bundle_objects(deleted) WHERE deleted = 0;\n\n-- Index for type-based queries\nCREATE INDEX IF NOT EXISTS idx_bundle_objects_type ON bundle_objects(type);\n\n\nCREATE TABLE IF NOT EXISTS active_bundle (\n  id INTEGER PRIMARY KEY CHECK (id = 1),\n  bundle_id TEXT NOT NULL REFERENCES bundles(id),\n  current_offset INTEGER NOT NULL,\n  object_count INTEGER NOT NULL DEFAULT 0,\n  bytes_written INTEGER NOT NULL DEFAULT 0,\n  started_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\n\n\n-- Index for finding unsealed bundles\nCREATE INDEX IF NOT EXISTS idx_bundles_sealed ON bundles(sealed);\n\n-- Index for finding bundles by creation time\nCREATE INDEX IF NOT EXISTS idx_bundles_created_at ON bundles(created_at);\n\n";
/**
 * Array of schema migrations in order.
 *
 * @description
 * Each migration upgrades the schema to the next version.
 * Migrations are applied in order and tracked in schema_migrations table.
 */
export declare const MIGRATIONS: SchemaMigration[];
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
export declare class BundleSchemaManager {
    private storage;
    /**
     * Create a new BundleSchemaManager.
     *
     * @param storage - Durable Object storage with SQL support
     */
    constructor(storage: DurableObjectStorage);
    /**
     * Ensure the schema is initialized and up to date.
     *
     * @description
     * Creates the schema_migrations table if needed, then applies
     * any pending migrations to bring the schema to the current version.
     *
     * @returns The current schema version after migrations
     */
    ensureSchema(): Promise<number>;
    /**
     * Get the current schema version.
     *
     * @description
     * Returns the highest version number from the schema_migrations table,
     * or 0 if no migrations have been applied.
     *
     * @returns Current schema version (0 if not initialized)
     */
    getVersion(): Promise<number>;
    /**
     * Apply a single migration.
     *
     * @param migration - The migration to apply
     */
    private applyMigration;
    /**
     * Validate that all required tables exist.
     *
     * @returns True if schema is valid and complete
     */
    validateSchema(): Promise<boolean>;
    /**
     * Get list of applied migrations.
     *
     * @returns Array of applied migration versions and descriptions
     */
    getAppliedMigrations(): Promise<Array<{
        version: number;
        description: string;
        applied_at: number;
    }>>;
    /**
     * Check if a specific version has been applied.
     *
     * @param version - Version number to check
     * @returns True if the version has been applied
     */
    hasVersion(version: number): Promise<boolean>;
    /**
     * Reset the schema (for testing purposes).
     *
     * @description
     * Drops all bundle-related tables. Use with caution!
     * This is primarily for testing and development.
     */
    resetSchema(): Promise<void>;
}
/**
 * Record a bundle in the database.
 *
 * @param storage - Durable Object storage
 * @param bundle - Bundle metadata to record
 */
export declare function recordBundle(storage: DurableObjectStorage, bundle: Omit<BundleRecord, 'created_at'> & {
    created_at?: number;
}): void;
/**
 * Look up a bundle by ID.
 *
 * @param storage - Durable Object storage
 * @param bundleId - Bundle ID to look up
 * @returns Bundle record or null if not found
 */
export declare function lookupBundle(storage: DurableObjectStorage, bundleId: string): BundleRecord | null;
/**
 * Record an object's location within a bundle.
 *
 * @param storage - Durable Object storage
 * @param obj - Object metadata to record
 */
export declare function recordBundleObject(storage: DurableObjectStorage, obj: Omit<BundleObjectRecord, 'created_at'> & {
    created_at?: number;
}): void;
/**
 * Look up an object's location by key.
 *
 * @param storage - Durable Object storage
 * @param key - Object key (SHA) to look up
 * @returns Object record or null if not found
 */
export declare function lookupBundleObject(storage: DurableObjectStorage, key: string): BundleObjectRecord | null;
/**
 * Get all objects in a bundle.
 *
 * @param storage - Durable Object storage
 * @param bundleId - Bundle ID
 * @returns Array of object records in the bundle
 */
export declare function getBundleObjects(storage: DurableObjectStorage, bundleId: string): BundleObjectRecord[];
/**
 * Mark an object as deleted (soft delete).
 *
 * @param storage - Durable Object storage
 * @param key - Object key to mark as deleted
 * @returns Number of rows affected
 */
export declare function markObjectDeleted(storage: DurableObjectStorage, key: string): number;
/**
 * Seal a bundle (mark as complete, no more writes).
 *
 * @param storage - Durable Object storage
 * @param bundleId - Bundle ID to seal
 * @param checksum - Optional checksum to store
 */
export declare function sealBundle(storage: DurableObjectStorage, bundleId: string, checksum?: string): void;
/**
 * Get or create the active bundle record.
 *
 * @param storage - Durable Object storage
 * @returns Active bundle record or null if none active
 */
export declare function getActiveBundle(storage: DurableObjectStorage): ActiveBundleRecord | null;
/**
 * Set the active bundle.
 *
 * @param storage - Durable Object storage
 * @param bundleId - Bundle ID to make active
 * @param dataOffset - Starting data offset
 */
export declare function setActiveBundle(storage: DurableObjectStorage, bundleId: string, dataOffset: number): void;
/**
 * Update the active bundle's progress.
 *
 * @param storage - Durable Object storage
 * @param currentOffset - New current offset
 * @param bytesWritten - Total bytes written
 * @param objectCount - Total object count
 */
export declare function updateActiveBundle(storage: DurableObjectStorage, currentOffset: number, bytesWritten: number, objectCount: number): void;
/**
 * Clear the active bundle (when sealed or on error).
 *
 * @param storage - Durable Object storage
 */
export declare function clearActiveBundle(storage: DurableObjectStorage): void;
/**
 * Get statistics about bundles.
 *
 * @param storage - Durable Object storage
 * @returns Bundle statistics
 */
export declare function getBundleStats(storage: DurableObjectStorage): {
    totalBundles: number;
    sealedBundles: number;
    totalObjects: number;
    totalSize: number;
    deletedObjects: number;
};
/**
 * List all bundles.
 *
 * @param storage - Durable Object storage
 * @param options - Query options
 * @returns Array of bundle records
 */
export declare function listBundles(storage: DurableObjectStorage, options?: {
    sealedOnly?: boolean;
    limit?: number;
    offset?: number;
}): BundleRecord[];
//# sourceMappingURL=bundle-schema.d.ts.map