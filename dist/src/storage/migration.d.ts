/**
 * @fileoverview Migration Utility for Loose Objects to Bundle Format
 *
 * This module provides tools for migrating Git objects from the old loose
 * R2 storage format (individual R2 objects per git object) to the new
 * bundle format (multiple git objects per R2 object).
 *
 * ## Features
 *
 * - **Incremental Migration**: Track progress and resume from interruption
 * - **Size-based Bundling**: Respect configurable size limits per bundle
 * - **Data Integrity**: Verify checksums before and after migration
 * - **Concurrent Access Safety**: Lock objects during migration
 * - **Dry Run Mode**: Preview changes without modifying storage
 * - **Cleanup Support**: Optionally delete old loose objects after verification
 *
 * @module storage/migration
 *
 * @example
 * ```typescript
 * import { LooseToBundleMigrator, MigrationConfig } from './migration'
 *
 * const config: MigrationConfig = {
 *   maxBundleSize: 4 * 1024 * 1024, // 4MB bundles
 *   batchSize: 100,
 *   dryRun: false,
 *   verify: true,
 *   cleanup: true
 * }
 *
 * const migrator = new LooseToBundleMigrator(storage, r2, config)
 *
 * // Run migration
 * const result = await migrator.migrate()
 * console.log(`Migrated ${result.objectsMigrated} objects to ${result.bundlesCreated} bundles`)
 * ```
 */
import type { DurableObjectStorage } from './types';
/**
 * R2 storage interface for reading loose objects and writing bundles.
 */
export interface MigrationR2Storage {
    /** Read an object from R2 */
    get(key: string): Promise<{
        arrayBuffer(): Promise<ArrayBuffer>;
    } | null>;
    /** Write an object to R2 */
    put(key: string, data: ArrayBuffer | Uint8Array): Promise<void>;
    /** Delete an object from R2 */
    delete(key: string): Promise<void>;
    /** List objects with a prefix */
    list(options?: {
        prefix?: string;
        cursor?: string;
    }): Promise<{
        objects: Array<{
            key: string;
            size: number;
        }>;
        truncated: boolean;
        cursor?: string;
    }>;
}
/**
 * Configuration options for the migration process.
 */
export interface MigrationConfig {
    /** Maximum size of a bundle in bytes (default: 4MB) */
    maxBundleSize?: number;
    /** Number of objects to process per batch (default: 100) */
    batchSize?: number;
    /** Prefix for loose objects in R2 (default: 'objects/') */
    looseObjectPrefix?: string;
    /** Prefix for bundles in R2 (default: 'bundles/') */
    bundlePrefix?: string;
    /** If true, don't actually modify storage (default: false) */
    dryRun?: boolean;
    /** If true, verify data integrity after migration (default: true) */
    verify?: boolean;
    /** If true, delete old loose objects after successful migration (default: false) */
    cleanup?: boolean;
    /** Concurrency limit for parallel operations (default: 5) */
    concurrency?: number;
    /** Callback for progress updates */
    onProgress?: (progress: MigrationProgress) => void;
    /** Callback for errors (migration continues on non-fatal errors) */
    onError?: (error: MigrationObjectError) => void;
}
/**
 * Progress information during migration.
 */
export interface MigrationProgress {
    /** Current phase of migration */
    phase: 'scanning' | 'migrating' | 'verifying' | 'cleaning';
    /** Total number of loose objects found */
    totalObjects: number;
    /** Number of objects processed so far */
    processedObjects: number;
    /** Number of objects successfully migrated */
    migratedObjects: number;
    /** Number of objects that failed to migrate */
    failedObjects: number;
    /** Number of bundles created so far */
    bundlesCreated: number;
    /** Total bytes processed */
    bytesProcessed: number;
    /** Estimated time remaining in milliseconds */
    estimatedTimeRemaining?: number;
    /** Current object being processed */
    currentObject?: string;
}
/**
 * Error information for a single object migration failure.
 */
export interface MigrationObjectError {
    /** SHA of the object that failed */
    sha: string;
    /** Error message */
    message: string;
    /** Original error if available */
    cause?: Error;
    /** Whether this error is recoverable */
    recoverable: boolean;
}
/**
 * Result of a migration operation.
 */
export interface MigrationResult {
    /** Whether the migration completed successfully */
    success: boolean;
    /** Total number of loose objects found */
    totalObjectsFound: number;
    /** Number of objects successfully migrated */
    objectsMigrated: number;
    /** Number of objects that failed to migrate */
    objectsFailed: number;
    /** Number of bundles created */
    bundlesCreated: number;
    /** Total bytes migrated */
    bytesMigrated: number;
    /** Number of loose objects deleted (if cleanup was enabled) */
    objectsCleaned: number;
    /** Duration of the migration in milliseconds */
    durationMs: number;
    /** List of errors encountered */
    errors: MigrationObjectError[];
    /** Whether this was a dry run */
    dryRun: boolean;
    /** IDs of bundles created */
    bundleIds: string[];
    /** Checkpoint for resuming interrupted migration */
    checkpoint?: MigrationCheckpoint;
}
/**
 * Checkpoint for resuming an interrupted migration.
 */
export interface MigrationCheckpoint {
    /** Unique ID for this migration run */
    migrationId: string;
    /** Timestamp when checkpoint was created */
    timestamp: number;
    /** Last successfully processed cursor/position */
    lastCursor?: string;
    /** SHAs of objects that have been processed */
    processedShas: string[];
    /** SHAs of objects that failed and should be retried */
    failedShas: string[];
    /** IDs of bundles that have been created */
    createdBundleIds: string[];
    /** Configuration used for this migration */
    config: MigrationConfig;
}
/**
 * Rollback information for undoing a migration.
 */
export interface MigrationRollbackInfo {
    /** Migration ID being rolled back */
    migrationId: string;
    /** Bundles created during migration that need to be deleted */
    bundlesToDelete: string[];
    /** Objects that need their index restored to 'hot' tier */
    objectsToRestore: Array<{
        sha: string;
        originalKey: string;
    }>;
    /** Timestamp when rollback info was created */
    timestamp: number;
}
/**
 * Result of a rollback operation.
 */
export interface RollbackResult {
    /** Whether the rollback completed successfully */
    success: boolean;
    /** Number of bundles deleted */
    bundlesDeleted: number;
    /** Number of index entries restored */
    indexEntriesRestored: number;
    /** Duration of the rollback in milliseconds */
    durationMs: number;
    /** Errors encountered during rollback */
    errors: Array<{
        message: string;
        cause?: Error;
    }>;
}
/**
 * Status of a migration job.
 */
export type MigrationStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
/**
 * Information about a loose object to migrate.
 */
export interface LooseObjectInfo {
    /** SHA of the object */
    sha: string;
    /** Size of the compressed object in bytes */
    size: number;
    /** Object type if known */
    type?: 'blob' | 'tree' | 'commit' | 'tag';
    /** R2 key for the loose object */
    r2Key: string;
}
/**
 * Error thrown during migration operations.
 */
export declare class MigrationError extends Error {
    readonly code: MigrationErrorCode;
    readonly cause?: Error | undefined;
    constructor(message: string, code: MigrationErrorCode, cause?: Error | undefined);
}
/**
 * Error codes for migration failures.
 */
export declare enum MigrationErrorCode {
    /** Object not found in source storage */
    OBJECT_NOT_FOUND = "OBJECT_NOT_FOUND",
    /** Failed to read object from source */
    READ_FAILED = "READ_FAILED",
    /** Failed to write bundle to destination */
    WRITE_FAILED = "WRITE_FAILED",
    /** Checksum verification failed */
    CHECKSUM_MISMATCH = "CHECKSUM_MISMATCH",
    /** Migration was interrupted */
    INTERRUPTED = "INTERRUPTED",
    /** Invalid migration configuration */
    INVALID_CONFIG = "INVALID_CONFIG",
    /** Failed to acquire lock for object */
    LOCK_FAILED = "LOCK_FAILED",
    /** Checkpoint not found for resume */
    CHECKPOINT_NOT_FOUND = "CHECKPOINT_NOT_FOUND",
    /** Generic migration failure */
    MIGRATION_FAILED = "MIGRATION_FAILED"
}
/** Default maximum bundle size (4MB) */
export declare const DEFAULT_MAX_BUNDLE_SIZE: number;
/** Default batch size for processing */
export declare const DEFAULT_BATCH_SIZE = 100;
/** Default concurrency limit */
export declare const DEFAULT_CONCURRENCY = 5;
/** Default loose object prefix */
export declare const DEFAULT_LOOSE_PREFIX = "objects/";
/** Default bundle prefix */
export declare const DEFAULT_BUNDLE_PREFIX = "bundles/";
/**
 * Build R2 key for a loose object from SHA.
 */
/**
 * Migrator for converting loose R2 objects to bundle format.
 *
 * @description
 * Handles the complete migration process from loose objects to bundles:
 * 1. Scans R2 for loose objects
 * 2. Groups objects into bundles respecting size limits
 * 3. Writes bundles to R2
 * 4. Updates the object index
 * 5. Optionally verifies data integrity
 * 6. Optionally cleans up old loose objects
 *
 * @example
 * ```typescript
 * const migrator = new LooseToBundleMigrator(storage, r2, {
 *   maxBundleSize: 4 * 1024 * 1024,
 *   verify: true,
 *   cleanup: true,
 *   onProgress: (p) => console.log(`${p.processedObjects}/${p.totalObjects}`)
 * })
 *
 * // Full migration
 * const result = await migrator.migrate()
 *
 * // Or dry run first
 * const preview = await migrator.migrate({ dryRun: true })
 * ```
 */
export declare class LooseToBundleMigrator {
    private readonly storage;
    private readonly r2;
    private readonly config;
    private readonly objectIndex;
    private status;
    private migrationId;
    private startTime;
    private processedObjects;
    private failedObjects;
    private createdBundleIds;
    private currentBundle;
    /**
     * Create a new migrator instance.
     *
     * @param storage - Durable Object storage for index and checkpoints
     * @param r2 - R2 storage for reading loose objects and writing bundles
     * @param config - Migration configuration options
     */
    constructor(storage: DurableObjectStorage, r2: MigrationR2Storage, config?: MigrationConfig);
    /**
     * Get current migration status.
     */
    getStatus(): MigrationStatus;
    /**
     * Run the migration process.
     *
     * @param overrides - Optional config overrides for this run
     * @returns Migration result with statistics and errors
     */
    migrate(overrides?: Partial<MigrationConfig>): Promise<MigrationResult>;
    /**
     * Resume a previously interrupted migration.
     *
     * @param checkpointId - ID of the checkpoint to resume from
     * @returns Migration result
     */
    resume(checkpointId: string): Promise<MigrationResult>;
    /**
     * Get a preview of what would be migrated without making changes.
     */
    preview(): Promise<{
        totalObjects: number;
        totalSize: number;
        estimatedBundles: number;
        objects: LooseObjectInfo[];
    }>;
    /**
     * Verify that all migrated objects can be read from bundles.
     */
    verifyAll(): Promise<{
        verified: number;
        failed: number;
        errors: MigrationObjectError[];
    }>;
    /**
     * Scan R2 for all loose objects.
     */
    private scanLooseObjects;
    /**
     * Migrate a single object to a bundle.
     */
    private migrateObject;
    /**
     * Flush the current bundle to R2 and update the index.
     *
     * Uses the canonical `createBundle` from the bundle format module to produce
     * a valid BNDL binary that is readable by `parseBundle` / `R2BundleReader`.
     */
    private flushCurrentBundle;
    /**
     * Verify that migrated objects can be read correctly.
     */
    private verifyMigration;
    /**
     * Delete old loose objects after successful migration.
     */
    private cleanupLooseObjects;
    /**
     * Save a checkpoint for resuming interrupted migration.
     */
    private saveCheckpoint;
    /**
     * Load a checkpoint for resuming migration.
     */
    private loadCheckpoint;
    /**
     * Report progress to the callback if configured.
     */
    private reportProgress;
}
/**
 * Options for the migration CLI.
 */
export interface MigrationCLIOptions {
    /** Run in dry-run mode (preview only) */
    dryRun?: boolean;
    /** Verify data integrity after migration */
    verify?: boolean;
    /** Clean up old loose objects after migration */
    cleanup?: boolean;
    /** Maximum bundle size in bytes */
    maxBundleSize?: number;
    /** Verbose output */
    verbose?: boolean;
}
/**
 * Run migration with CLI-friendly output.
 */
export declare function runMigrationCLI(storage: DurableObjectStorage, r2: MigrationR2Storage, options?: MigrationCLIOptions): Promise<MigrationResult>;
//# sourceMappingURL=migration.d.ts.map