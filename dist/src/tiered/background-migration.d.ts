/**
 * @fileoverview Background Tier Migration with DO Alarms
 *
 * This module provides background tier migration functionality using Durable Object
 * alarms to schedule and execute migrations asynchronously. Objects are migrated
 * from hot to warm to cold tiers based on access patterns.
 *
 * ## Key Features
 *
 * - **DO Alarm Integration**: Uses Cloudflare DO alarms for scheduling
 * - **Access-Pattern Based**: Migrates based on age and access frequency
 * - **Exponential Backoff**: Retries failed migrations with increasing delays
 * - **Batch Processing**: Migrates multiple objects per alarm cycle
 * - **Non-Blocking**: Migrations run in background without blocking requests
 *
 * ## Architecture
 *
 * ```
 * GitRepoDO.alarm()
 *      |
 *      v
 * TierMigrationScheduler.runMigrationCycle()
 *      |
 *      +---> Find migration candidates (hot -> warm)
 *      +---> Find cold migration candidates (warm -> cold)
 *      +---> Batch migrate objects
 *      +---> Reschedule next alarm
 * ```
 *
 * @module tiered/background-migration
 *
 * @example
 * ```typescript
 * // In GitRepoDO
 * const scheduler = new TierMigrationScheduler(
 *   storage,
 *   tieredStorage,
 *   {
 *     hotToWarmAgeMs: 24 * 60 * 60 * 1000,  // 24 hours
 *     warmToColdAgeMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
 *     minAccessCountForHot: 5,
 *     batchSize: 50,
 *     migrationIntervalMs: 60 * 60 * 1000  // 1 hour
 *   }
 * )
 *
 * // Schedule migration
 * scheduler.scheduleBackgroundMigration()
 *
 * // In alarm handler
 * await scheduler.runMigrationCycle()
 * ```
 */
import type { StorageTier } from '../storage/object-index';
/**
 * Configuration for background tier migration.
 */
export interface BackgroundMigrationConfig {
    /**
     * Age in milliseconds after which hot tier objects are migrated to warm.
     * @default 24 * 60 * 60 * 1000 (24 hours)
     */
    hotToWarmAgeMs: number;
    /**
     * Age in milliseconds after which warm tier objects are migrated to cold.
     * @default 7 * 24 * 60 * 60 * 1000 (7 days)
     */
    warmToColdAgeMs: number;
    /**
     * Minimum access count to keep an object in the hot tier.
     * Objects with fewer accesses may be demoted to warm tier.
     * @default 5
     */
    minAccessCountForHot: number;
    /**
     * Maximum total bytes in hot tier before triggering migration.
     * @default 50 * 1024 * 1024 (50MB)
     */
    maxHotTierBytes: number;
    /**
     * Number of objects to migrate per alarm cycle.
     * @default 50
     */
    batchSize: number;
    /**
     * Interval between migration cycles in milliseconds.
     * @default 60 * 60 * 1000 (1 hour)
     */
    migrationIntervalMs: number;
    /**
     * Maximum number of consecutive migration failures before pausing.
     * @default 5
     */
    maxConsecutiveFailures: number;
    /**
     * Base delay for exponential backoff on failure (milliseconds).
     * @default 60 * 1000 (1 minute)
     */
    backoffBaseDelayMs: number;
    /**
     * Multiplier for exponential backoff.
     * @default 2
     */
    backoffMultiplier: number;
    /**
     * Maximum backoff delay (milliseconds).
     * @default 60 * 60 * 1000 (1 hour)
     */
    maxBackoffDelayMs: number;
}
/**
 * SQL storage interface for migration state persistence.
 */
export interface MigrationSqlStorage {
    exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): {
        toArray(): T[];
    };
}
/**
 * DO storage interface with alarm support.
 */
export interface MigrationDOStorage {
    sql: MigrationSqlStorage;
    setAlarm?(scheduledTime: number | Date): Promise<void>;
    getAlarm?(): Promise<number | null>;
    deleteAlarm?(): Promise<void>;
}
/**
 * Tiered storage interface for object operations.
 */
export interface TieredStorageBackend {
    /** Get all objects in a tier with access metadata */
    getObjectsByTier(tier: StorageTier): Promise<MigrationCandidate[]>;
    /** Get total bytes in a tier */
    getTierBytes(tier: StorageTier): Promise<number>;
    /** Migrate an object between tiers */
    migrateObject(sha: string, fromTier: StorageTier, toTier: StorageTier): Promise<MigrationResult>;
    /** Record an access for tracking */
    recordAccess?(sha: string, type: 'read' | 'write'): Promise<void>;
}
/**
 * Object candidate for migration.
 */
export interface MigrationCandidate {
    sha: string;
    type: string;
    size: number;
    tier: StorageTier;
    accessCount: number;
    lastAccessedAt: number;
    createdAt: number;
}
/**
 * Result of a single object migration.
 */
export interface MigrationResult {
    sha: string;
    success: boolean;
    fromTier: StorageTier;
    toTier: StorageTier;
    error?: string;
}
/**
 * Result of a migration cycle.
 */
export interface MigrationCycleResult {
    /** Total objects migrated successfully */
    migrated: number;
    /** Total objects that failed to migrate */
    failed: number;
    /** Total bytes migrated */
    bytesMigrated: number;
    /** Objects migrated from hot to warm */
    hotToWarm: number;
    /** Objects migrated from warm to cold */
    warmToCold: number;
    /** Duration of the migration cycle in milliseconds */
    durationMs: number;
    /** Errors encountered during migration */
    errors: Array<{
        sha: string;
        error: string;
    }>;
    /** Whether another migration cycle is needed */
    moreToMigrate: boolean;
}
/**
 * State of the migration scheduler persisted in SQLite.
 */
export interface MigrationSchedulerState {
    /** Number of consecutive migration failures */
    consecutiveFailures: number;
    /** Last migration cycle timestamp */
    lastMigrationAt: number | null;
    /** Next scheduled migration timestamp */
    nextMigrationAt: number | null;
    /** Total objects migrated lifetime */
    totalMigrated: number;
    /** Total bytes migrated lifetime */
    totalBytesMigrated: number;
    /** Whether migration is currently paused due to errors */
    paused: boolean;
    /** Pause reason if paused */
    pauseReason?: string;
}
/** Default configuration values */
export declare const DEFAULT_MIGRATION_CONFIG: BackgroundMigrationConfig;
/**
 * Background tier migration scheduler using DO alarms.
 *
 * @description
 * Manages the lifecycle of background tier migrations, including:
 * - Scheduling migrations via DO alarms
 * - Finding migration candidates based on access patterns
 * - Executing batch migrations
 * - Handling failures with exponential backoff
 * - Persisting state across DO restarts
 *
 * ## Migration Flow
 *
 * 1. `scheduleBackgroundMigration()` sets a DO alarm
 * 2. DO calls `alarm()` which invokes `runMigrationCycle()`
 * 3. Find candidates: hot objects older than threshold with low access
 * 4. Find cold candidates: warm objects older than threshold
 * 5. Batch migrate objects (up to batchSize per cycle)
 * 6. Update statistics and reschedule next alarm
 *
 * ## Error Handling
 *
 * - Individual object failures don't stop the batch
 * - Consecutive failures trigger exponential backoff
 * - After maxConsecutiveFailures, migration pauses
 * - Manual resume available via `resumeMigration()`
 *
 * @example
 * ```typescript
 * // Create scheduler
 * const scheduler = new TierMigrationScheduler(storage, tieredStorage, {
 *   hotToWarmAgeMs: 12 * 60 * 60 * 1000,  // 12 hours
 *   batchSize: 100
 * })
 *
 * // Schedule background migration (call once on startup)
 * scheduler.scheduleBackgroundMigration()
 *
 * // In alarm handler
 * async alarm() {
 *   await scheduler.runMigrationCycle()
 * }
 *
 * // Check status
 * const status = await scheduler.getStatus()
 * console.log(`Migrated ${status.totalMigrated} objects total`)
 * ```
 */
export declare class TierMigrationScheduler {
    private storage;
    private tieredStorage;
    private config;
    private initialized;
    /**
     * Creates a new TierMigrationScheduler.
     *
     * @param storage - DO storage with SQL and alarm support
     * @param tieredStorage - Backend for tiered object operations
     * @param config - Migration configuration (partial, merged with defaults)
     */
    constructor(storage: MigrationDOStorage, tieredStorage: TieredStorageBackend, config?: Partial<BackgroundMigrationConfig>);
    /**
     * Initialize the schema for migration state tracking.
     */
    initialize(): Promise<void>;
    /**
     * Schedule a background migration cycle via DO alarm.
     *
     * @description
     * Sets a DO alarm to trigger at the configured interval. If an alarm
     * is already scheduled, this is a no-op unless `force` is true.
     *
     * @param delayMs - Optional custom delay (default: config.migrationIntervalMs)
     * @param force - Force rescheduling even if an alarm exists
     * @returns true if alarm was scheduled, false if already scheduled
     */
    scheduleBackgroundMigration(delayMs?: number, force?: boolean): Promise<boolean>;
    /**
     * Run a migration cycle. Called by DO alarm handler.
     *
     * @description
     * Executes a complete migration cycle:
     * 1. Find hot tier candidates for warm migration
     * 2. Find warm tier candidates for cold migration
     * 3. Execute migrations in batches
     * 4. Update statistics
     * 5. Reschedule next alarm
     *
     * @returns Result of the migration cycle
     */
    runMigrationCycle(): Promise<MigrationCycleResult>;
    /**
     * Find hot tier objects that should be migrated to warm tier.
     */
    findHotToWarmCandidates(): Promise<MigrationCandidate[]>;
    /**
     * Find warm tier objects that should be migrated to cold tier.
     */
    findWarmToColdCandidates(): Promise<MigrationCandidate[]>;
    /**
     * Get the current scheduler state.
     */
    getState(): Promise<MigrationSchedulerState>;
    /**
     * Resume migration after it was paused due to errors.
     */
    resumeMigration(): Promise<void>;
    /**
     * Pause migration manually.
     */
    pauseMigration(reason: string): Promise<void>;
    /**
     * Get migration history.
     *
     * @param limit - Number of records to return
     * @param offset - Offset for pagination
     */
    getHistory(limit?: number, offset?: number): Promise<Array<{
        sha: string;
        fromTier: string;
        toTier: string;
        success: boolean;
        error?: string;
        size: number;
        createdAt: number;
    }>>;
    /**
     * Get the current configuration.
     */
    getConfig(): BackgroundMigrationConfig;
    /**
     * Update configuration at runtime.
     */
    updateConfig(updates: Partial<BackgroundMigrationConfig>): void;
    /**
     * Record a migration in history.
     */
    private recordMigration;
    /**
     * Update state after a successful migration cycle.
     */
    private updateStateAfterCycle;
    /**
     * Handle a migration cycle failure.
     */
    private handleCycleFailure;
}
/**
 * Create a TierMigrationScheduler with default configuration.
 *
 * @param storage - DO storage instance
 * @param tieredStorage - Tiered storage backend
 * @param config - Optional configuration overrides
 * @returns Configured TierMigrationScheduler
 */
export declare function createMigrationScheduler(storage: MigrationDOStorage, tieredStorage: TieredStorageBackend, config?: Partial<BackgroundMigrationConfig>): TierMigrationScheduler;
//# sourceMappingURL=background-migration.d.ts.map