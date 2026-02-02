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
// ============================================================================
// Constants
// ============================================================================
/** Default configuration values */
export const DEFAULT_MIGRATION_CONFIG = {
    hotToWarmAgeMs: 24 * 60 * 60 * 1000, // 24 hours
    warmToColdAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    minAccessCountForHot: 5,
    maxHotTierBytes: 50 * 1024 * 1024, // 50MB
    batchSize: 50,
    migrationIntervalMs: 60 * 60 * 1000, // 1 hour
    maxConsecutiveFailures: 5,
    backoffBaseDelayMs: 60 * 1000, // 1 minute
    backoffMultiplier: 2,
    maxBackoffDelayMs: 60 * 60 * 1000, // 1 hour
};
/** Table name for migration state */
const MIGRATION_STATE_TABLE = 'tier_migration_state';
/** Table name for migration history */
const MIGRATION_HISTORY_TABLE = 'tier_migration_history';
// ============================================================================
// TierMigrationScheduler Class
// ============================================================================
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
export class TierMigrationScheduler {
    storage;
    tieredStorage;
    config;
    initialized = false;
    /**
     * Creates a new TierMigrationScheduler.
     *
     * @param storage - DO storage with SQL and alarm support
     * @param tieredStorage - Backend for tiered object operations
     * @param config - Migration configuration (partial, merged with defaults)
     */
    constructor(storage, tieredStorage, config = {}) {
        this.storage = storage;
        this.tieredStorage = tieredStorage;
        this.config = { ...DEFAULT_MIGRATION_CONFIG, ...config };
    }
    /**
     * Initialize the schema for migration state tracking.
     */
    async initialize() {
        if (this.initialized)
            return;
        // Create migration state table
        this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_STATE_TABLE} (
        id INTEGER PRIMARY KEY DEFAULT 1,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_migration_at INTEGER,
        next_migration_at INTEGER,
        total_migrated INTEGER NOT NULL DEFAULT 0,
        total_bytes_migrated INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0,
        pause_reason TEXT,
        updated_at INTEGER NOT NULL
      )
    `);
        // Create migration history table
        this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_HISTORY_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sha TEXT NOT NULL,
        from_tier TEXT NOT NULL,
        to_tier TEXT NOT NULL,
        success INTEGER NOT NULL,
        error TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);
        // Create index on migration history
        this.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_tier_migration_history_created
      ON ${MIGRATION_HISTORY_TABLE}(created_at)
    `);
        // Initialize state if not exists
        const existing = this.storage.sql.exec(`SELECT id FROM ${MIGRATION_STATE_TABLE} WHERE id = 1`).toArray();
        if (existing.length === 0) {
            this.storage.sql.exec(`INSERT INTO ${MIGRATION_STATE_TABLE} (id, updated_at) VALUES (1, ?)`, Date.now());
        }
        this.initialized = true;
    }
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
    async scheduleBackgroundMigration(delayMs, force = false) {
        await this.initialize();
        // Check if already scheduled
        if (!force) {
            const state = await this.getState();
            if (state.nextMigrationAt && state.nextMigrationAt > Date.now()) {
                return false; // Already scheduled
            }
        }
        // Check if paused
        const state = await this.getState();
        if (state.paused) {
            return false; // Migration paused
        }
        const delay = delayMs ?? this.config.migrationIntervalMs;
        const scheduledTime = Date.now() + delay;
        // Set the alarm
        if (typeof this.storage.setAlarm === 'function') {
            await this.storage.setAlarm(scheduledTime);
            // Update state with next migration time
            this.storage.sql.exec(`UPDATE ${MIGRATION_STATE_TABLE} SET next_migration_at = ?, updated_at = ? WHERE id = 1`, scheduledTime, Date.now());
            return true;
        }
        return false;
    }
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
    async runMigrationCycle() {
        await this.initialize();
        const startTime = Date.now();
        const result = {
            migrated: 0,
            failed: 0,
            bytesMigrated: 0,
            hotToWarm: 0,
            warmToCold: 0,
            durationMs: 0,
            errors: [],
            moreToMigrate: false,
        };
        // Check if paused
        const state = await this.getState();
        if (state.paused) {
            result.durationMs = Date.now() - startTime;
            return result;
        }
        try {
            // Phase 1: Hot to Warm migration
            const hotCandidates = await this.findHotToWarmCandidates();
            const hotBatch = hotCandidates.slice(0, this.config.batchSize);
            for (const candidate of hotBatch) {
                const migrationResult = await this.tieredStorage.migrateObject(candidate.sha, 'hot', 'r2' // warm tier
                );
                this.recordMigration(candidate.sha, 'hot', 'r2', migrationResult.success, candidate.size, migrationResult.error);
                if (migrationResult.success) {
                    result.migrated++;
                    result.hotToWarm++;
                    result.bytesMigrated += candidate.size;
                }
                else {
                    result.failed++;
                    result.errors.push({ sha: candidate.sha, error: migrationResult.error ?? 'Unknown error' });
                }
            }
            // Phase 2: Warm to Cold migration (if batch not full)
            const remainingBatch = this.config.batchSize - hotBatch.length;
            if (remainingBatch > 0) {
                const warmCandidates = await this.findWarmToColdCandidates();
                const warmBatch = warmCandidates.slice(0, remainingBatch);
                for (const candidate of warmBatch) {
                    const migrationResult = await this.tieredStorage.migrateObject(candidate.sha, 'r2', // warm tier
                    'parquet' // cold tier
                    );
                    this.recordMigration(candidate.sha, 'r2', 'parquet', migrationResult.success, candidate.size, migrationResult.error);
                    if (migrationResult.success) {
                        result.migrated++;
                        result.warmToCold++;
                        result.bytesMigrated += candidate.size;
                    }
                    else {
                        result.failed++;
                        result.errors.push({ sha: candidate.sha, error: migrationResult.error ?? 'Unknown error' });
                    }
                }
            }
            // Check if there are more to migrate
            const totalCandidates = hotCandidates.length + (await this.findWarmToColdCandidates()).length;
            result.moreToMigrate = totalCandidates > this.config.batchSize;
            // Update state
            await this.updateStateAfterCycle(result);
            // Reschedule next migration
            const nextDelay = result.moreToMigrate
                ? Math.min(this.config.migrationIntervalMs / 4, 15 * 60 * 1000) // Shorter delay if more to do
                : this.config.migrationIntervalMs;
            await this.scheduleBackgroundMigration(nextDelay, true);
        }
        catch (error) {
            // Handle cycle-level failure
            await this.handleCycleFailure(error instanceof Error ? error.message : String(error));
            result.errors.push({
                sha: 'cycle',
                error: error instanceof Error ? error.message : String(error),
            });
        }
        result.durationMs = Date.now() - startTime;
        return result;
    }
    /**
     * Find hot tier objects that should be migrated to warm tier.
     */
    async findHotToWarmCandidates() {
        const now = Date.now();
        const hotObjects = await this.tieredStorage.getObjectsByTier('hot');
        const hotBytes = await this.tieredStorage.getTierBytes('hot');
        // Filter candidates based on age and access count
        const candidates = hotObjects.filter((obj) => {
            const age = now - obj.lastAccessedAt;
            const isOld = age > this.config.hotToWarmAgeMs;
            const lowAccess = obj.accessCount < this.config.minAccessCountForHot;
            // Migrate if old AND low access, OR if tier is over capacity
            return (isOld && lowAccess) || hotBytes > this.config.maxHotTierBytes;
        });
        // Sort by last accessed (oldest first for migration priority)
        candidates.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
        return candidates;
    }
    /**
     * Find warm tier objects that should be migrated to cold tier.
     */
    async findWarmToColdCandidates() {
        const now = Date.now();
        const warmObjects = await this.tieredStorage.getObjectsByTier('r2');
        // Filter candidates based on age
        const candidates = warmObjects.filter((obj) => {
            const age = now - obj.lastAccessedAt;
            return age > this.config.warmToColdAgeMs;
        });
        // Sort by last accessed (oldest first)
        candidates.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
        return candidates;
    }
    /**
     * Get the current scheduler state.
     */
    async getState() {
        await this.initialize();
        const rows = this.storage.sql.exec(`SELECT * FROM ${MIGRATION_STATE_TABLE} WHERE id = 1`).toArray();
        if (rows.length === 0) {
            return {
                consecutiveFailures: 0,
                lastMigrationAt: null,
                nextMigrationAt: null,
                totalMigrated: 0,
                totalBytesMigrated: 0,
                paused: false,
            };
        }
        const row = rows[0];
        return {
            consecutiveFailures: row.consecutive_failures,
            lastMigrationAt: row.last_migration_at,
            nextMigrationAt: row.next_migration_at,
            totalMigrated: row.total_migrated,
            totalBytesMigrated: row.total_bytes_migrated,
            paused: row.paused === 1,
            pauseReason: row.pause_reason ?? undefined,
        };
    }
    /**
     * Resume migration after it was paused due to errors.
     */
    async resumeMigration() {
        await this.initialize();
        this.storage.sql.exec(`UPDATE ${MIGRATION_STATE_TABLE}
       SET paused = 0, pause_reason = NULL, consecutive_failures = 0, updated_at = ?
       WHERE id = 1`, Date.now());
        // Schedule next migration
        await this.scheduleBackgroundMigration(undefined, true);
    }
    /**
     * Pause migration manually.
     */
    async pauseMigration(reason) {
        await this.initialize();
        this.storage.sql.exec(`UPDATE ${MIGRATION_STATE_TABLE}
       SET paused = 1, pause_reason = ?, updated_at = ?
       WHERE id = 1`, reason, Date.now());
        // Cancel alarm if possible
        if (typeof this.storage.deleteAlarm === 'function') {
            await this.storage.deleteAlarm();
        }
    }
    /**
     * Get migration history.
     *
     * @param limit - Number of records to return
     * @param offset - Offset for pagination
     */
    async getHistory(limit = 100, offset = 0) {
        await this.initialize();
        const rows = this.storage.sql.exec(`SELECT sha, from_tier, to_tier, success, error, size, created_at
       FROM ${MIGRATION_HISTORY_TABLE}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`, limit, offset).toArray();
        return rows.map((row) => ({
            sha: row.sha,
            fromTier: row.from_tier,
            toTier: row.to_tier,
            success: row.success === 1,
            error: row.error ?? undefined,
            size: row.size,
            createdAt: row.created_at,
        }));
    }
    /**
     * Get the current configuration.
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Update configuration at runtime.
     */
    updateConfig(updates) {
        this.config = { ...this.config, ...updates };
    }
    // ===========================================================================
    // Private Methods
    // ===========================================================================
    /**
     * Record a migration in history.
     */
    recordMigration(sha, fromTier, toTier, success, size, error) {
        this.storage.sql.exec(`INSERT INTO ${MIGRATION_HISTORY_TABLE}
       (sha, from_tier, to_tier, success, error, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, sha, fromTier, toTier, success ? 1 : 0, error ?? null, size, Date.now());
    }
    /**
     * Update state after a successful migration cycle.
     */
    async updateStateAfterCycle(result) {
        const state = await this.getState();
        this.storage.sql.exec(`UPDATE ${MIGRATION_STATE_TABLE}
       SET consecutive_failures = 0,
           last_migration_at = ?,
           total_migrated = total_migrated + ?,
           total_bytes_migrated = total_bytes_migrated + ?,
           updated_at = ?
       WHERE id = 1`, Date.now(), result.migrated, result.bytesMigrated, Date.now());
    }
    /**
     * Handle a migration cycle failure.
     */
    async handleCycleFailure(error) {
        const state = await this.getState();
        const newFailureCount = state.consecutiveFailures + 1;
        // Check if we should pause
        if (newFailureCount >= this.config.maxConsecutiveFailures) {
            this.storage.sql.exec(`UPDATE ${MIGRATION_STATE_TABLE}
         SET consecutive_failures = ?,
             paused = 1,
             pause_reason = ?,
             updated_at = ?
         WHERE id = 1`, newFailureCount, `Paused after ${newFailureCount} consecutive failures: ${error}`, Date.now());
            return;
        }
        // Update failure count and reschedule with backoff
        this.storage.sql.exec(`UPDATE ${MIGRATION_STATE_TABLE}
       SET consecutive_failures = ?, updated_at = ?
       WHERE id = 1`, newFailureCount, Date.now());
        // Calculate backoff delay
        const backoffDelay = Math.min(this.config.backoffBaseDelayMs * Math.pow(this.config.backoffMultiplier, newFailureCount - 1), this.config.maxBackoffDelayMs);
        await this.scheduleBackgroundMigration(backoffDelay, true);
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a TierMigrationScheduler with default configuration.
 *
 * @param storage - DO storage instance
 * @param tieredStorage - Tiered storage backend
 * @param config - Optional configuration overrides
 * @returns Configured TierMigrationScheduler
 */
export function createMigrationScheduler(storage, tieredStorage, config) {
    return new TierMigrationScheduler(storage, tieredStorage, config);
}
//# sourceMappingURL=background-migration.js.map