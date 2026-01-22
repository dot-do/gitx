/**
 * @fileoverview Tier Migration Module (Hot -> Warm)
 *
 * This module handles the migration of Git objects between storage tiers in the
 * gitdo tiered storage architecture. It provides comprehensive functionality for:
 *
 * ## Storage Tiers
 *
 * - **Hot**: SQLite in Durable Object storage - fastest access, limited capacity
 * - **Warm/R2**: Packed objects in R2 object storage - medium latency, larger capacity
 *
 * ## Key Features
 *
 * - **Policy-based Migration**: Configurable policies based on age, access frequency, and size
 * - **Access Tracking**: Monitors object access patterns to inform migration decisions
 * - **Atomic Operations**: Ensures data integrity during migration with rollback support
 * - **Concurrent Access Handling**: Safe reads/writes during in-progress migrations
 * - **Checksum Verification**: Optional integrity verification after migration
 * - **Batch Migration**: Efficient bulk migration with configurable concurrency
 *
 * ## Migration Process
 *
 * 1. Acquire distributed lock on the object
 * 2. Copy data from hot tier to warm tier
 * 3. Verify data integrity (optional checksum verification)
 * 4. Update object location index
 * 5. Delete from hot tier
 * 6. Release lock
 *
 * If any step fails, the migration is rolled back automatically.
 *
 * @module tiered/migration
 *
 * @example
 * ```typescript
 * // Create a migrator
 * const migrator = new TierMigrator(storage);
 *
 * // Define migration policy
 * const policy: MigrationPolicy = {
 *   maxAgeInHot: 24 * 60 * 60 * 1000, // 24 hours
 *   minAccessCount: 5,
 *   maxHotSize: 100 * 1024 * 1024 // 100MB
 * };
 *
 * // Find candidates and migrate
 * const candidates = await migrator.findMigrationCandidates(policy);
 * for (const sha of candidates) {
 *   await migrator.migrate(sha, 'hot', 'r2', { verifyChecksum: true });
 * }
 * ```
 */
import { StorageTier } from '../storage/object-index';
/**
 * Migration policy configuration.
 *
 * @description
 * Defines the criteria for determining when objects should be migrated
 * from the hot tier to the warm tier. Objects meeting ANY of these criteria
 * may be migrated.
 *
 * @example
 * ```typescript
 * const policy: MigrationPolicy = {
 *   maxAgeInHot: 7 * 24 * 60 * 60 * 1000, // 7 days
 *   minAccessCount: 10, // Stay hot if accessed 10+ times
 *   maxHotSize: 500 * 1024 * 1024 // Trigger migration if hot > 500MB
 * };
 * ```
 */
export interface MigrationPolicy {
    /**
     * Maximum age in hot tier before migration (milliseconds).
     * Objects older than this may be migrated to warm tier.
     * Use Infinity to disable age-based migration.
     */
    maxAgeInHot: number;
    /**
     * Minimum access count to stay in hot tier.
     * Objects with fewer accesses may be migrated.
     * Use 0 to disable access-count-based migration.
     */
    minAccessCount: number;
    /**
     * Maximum total size of hot tier (bytes).
     * When exceeded, oldest/coldest objects are migrated.
     */
    maxHotSize: number;
}
/**
 * Migration job state enumeration.
 *
 * @description
 * Represents the lifecycle states of a migration job:
 * - `pending`: Job created but not started
 * - `in_progress`: Migration actively running
 * - `completed`: Migration finished successfully
 * - `failed`: Migration failed (may be retried)
 * - `cancelled`: Job was cancelled by user
 * - `rolled_back`: Migration failed and changes were reverted
 */
export type MigrationState = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';
/**
 * Migration job progress tracking.
 *
 * @description
 * Tracks the progress of data transfer during a migration job.
 * Useful for long-running migrations of large objects.
 *
 * @example
 * ```typescript
 * const job = await migrator.startMigrationJob(sha, 'hot', 'r2');
 * console.log(`Progress: ${job.progress.bytesTransferred}/${job.progress.totalBytes}`);
 * ```
 */
export interface MigrationProgress {
    /** Number of bytes transferred so far */
    bytesTransferred: number;
    /** Total number of bytes to transfer */
    totalBytes: number;
}
/**
 * Migration job tracking information.
 *
 * @description
 * Contains all information about an active or completed migration job,
 * including progress tracking, timing, and state.
 *
 * @example
 * ```typescript
 * const job = await migrator.startMigrationJob(sha, 'hot', 'r2');
 * console.log(`Job ${job.id} started at ${new Date(job.startedAt)}`);
 * console.log(`State: ${job.state}`);
 * ```
 */
export interface MigrationJob {
    /** Unique identifier for the migration job */
    id: string;
    /** SHA of the object being migrated */
    sha: string;
    /** Source storage tier */
    sourceTier: StorageTier;
    /** Target storage tier */
    targetTier: StorageTier;
    /** Current state of the migration */
    state: MigrationState;
    /** Whether a lock was successfully acquired */
    lockAcquired: boolean;
    /** Progress tracking for the migration */
    progress: MigrationProgress;
    /** Timestamp when the job started (ms since epoch) */
    startedAt: number;
    /** Timestamp when the job completed (ms since epoch), if completed */
    completedAt?: number;
}
/**
 * Result of a migration operation.
 *
 * @description
 * Contains the outcome of a single object migration, including success/failure
 * status, verification results, and error information if applicable.
 *
 * @example
 * ```typescript
 * const result = await migrator.migrate(sha, 'hot', 'r2', { verifyChecksum: true });
 * if (result.success) {
 *   console.log('Migration successful');
 *   if (result.checksumVerified) {
 *     console.log('Data integrity verified');
 *   }
 * } else if (result.skipped) {
 *   console.log('Object was already migrated');
 * } else if (result.rolledBack) {
 *   console.log(`Migration rolled back: ${result.rollbackReason}`);
 * }
 * ```
 */
export interface MigrationResult {
    /** Whether the migration completed successfully */
    success: boolean;
    /** Whether the migration was skipped (e.g., already in target tier) */
    skipped?: boolean;
    /** Whether the migration was rolled back due to an error */
    rolledBack?: boolean;
    /** Whether checksum verification passed (if requested) */
    checksumVerified?: boolean;
    /** Error details if migration failed */
    error?: MigrationError;
    /** Reason for rollback if rolledBack is true */
    rollbackReason?: string;
}
/**
 * Result of a batch migration operation.
 *
 * @description
 * Contains arrays of successful and failed SHA hashes after a batch migration.
 *
 * @example
 * ```typescript
 * const result = await migrator.migrateBatch(shas, 'hot', 'r2');
 * console.log(`Migrated: ${result.successful.length}`);
 * console.log(`Failed: ${result.failed.length}`);
 * ```
 */
export interface BatchMigrationResult {
    /** SHAs of objects that were successfully migrated */
    successful: string[];
    /** SHAs of objects that failed to migrate */
    failed: string[];
}
/**
 * Options for batch migration operations.
 *
 * @description
 * Configures batch migration behavior, particularly concurrency.
 *
 * @example
 * ```typescript
 * // Migrate with limited concurrency to avoid overwhelming storage
 * const result = await migrator.migrateBatch(shas, 'hot', 'r2', {
 *   concurrency: 5
 * });
 * ```
 */
export interface BatchMigrationOptions {
    /**
     * Number of concurrent migrations.
     * @default shas.length (all at once)
     */
    concurrency?: number;
}
/**
 * Options for individual migration operations.
 *
 * @description
 * Configures behavior of a single migration operation.
 *
 * @example
 * ```typescript
 * const result = await migrator.migrate(sha, 'hot', 'r2', {
 *   verifyChecksum: true,
 *   lockTimeout: 10000
 * });
 * ```
 */
export interface MigrateOptions {
    /**
     * Whether to verify checksums after migration.
     * Adds overhead but ensures data integrity.
     * @default false
     */
    verifyChecksum?: boolean;
    /**
     * Timeout in milliseconds for acquiring the lock.
     * @default 5000
     */
    lockTimeout?: number;
}
/**
 * Migration history entry.
 *
 * @description
 * Records a single migration event for an object, useful for
 * auditing and debugging migration issues.
 *
 * @example
 * ```typescript
 * const history = await migrator.getMigrationHistory(sha);
 * for (const entry of history) {
 *   console.log(`${entry.timestamp}: ${entry.sourceTier} -> ${entry.targetTier}: ${entry.state}`);
 * }
 * ```
 */
export interface MigrationHistoryEntry {
    /** SHA of the migrated object */
    sha: string;
    /** Source storage tier */
    sourceTier: StorageTier;
    /** Target storage tier */
    targetTier: StorageTier;
    /** Final state of the migration */
    state: MigrationState;
    /** Timestamp of the migration event */
    timestamp: number;
}
/**
 * Access pattern information for an object.
 *
 * @description
 * Contains detailed access statistics for an object, used to make
 * informed migration decisions.
 *
 * @example
 * ```typescript
 * const pattern = await tracker.getAccessPattern(sha);
 * console.log(`Reads: ${pattern.readCount}, Writes: ${pattern.writeCount}`);
 * console.log(`Access frequency: ${pattern.accessFrequency.toFixed(2)}/sec`);
 * ```
 */
export interface AccessPattern {
    /** SHA of the object */
    sha: string;
    /** Number of read operations */
    readCount: number;
    /** Number of write operations */
    writeCount: number;
    /** Timestamp of last access (ms since epoch) */
    lastAccessedAt: number;
    /** Access frequency (accesses per second) */
    accessFrequency: number;
    /** Total bytes read from this object */
    totalBytesRead?: number;
    /** Average latency in milliseconds for accessing this object */
    avgLatencyMs?: number;
}
/**
 * Aggregate access statistics.
 *
 * @description
 * Provides summary statistics about access patterns across all tracked objects.
 *
 * @example
 * ```typescript
 * const stats = await tracker.getAccessStats();
 * console.log(`Total reads: ${stats.totalReads}`);
 * console.log(`Unique objects: ${stats.uniqueObjectsAccessed}`);
 * ```
 */
export interface AccessStats {
    /** Total number of read operations across all objects */
    totalReads: number;
    /** Total number of write operations across all objects */
    totalWrites: number;
    /** Number of unique objects that have been accessed */
    uniqueObjectsAccessed: number;
}
/**
 * Criteria for identifying hot or cold objects.
 *
 * @description
 * Specifies filters for querying objects based on access patterns.
 *
 * @example
 * ```typescript
 * // Find frequently accessed objects
 * const hotObjects = await tracker.identifyHotObjects({
 *   minAccessCount: 100
 * });
 *
 * // Find rarely accessed objects
 * const coldObjects = await tracker.identifyColdObjects({
 *   maxAccessCount: 2,
 *   minAgeMs: 7 * 24 * 60 * 60 * 1000 // 7 days old
 * });
 * ```
 */
export interface ObjectIdentificationCriteria {
    /** Minimum total access count (reads + writes) */
    minAccessCount?: number;
    /** Maximum total access count (reads + writes) */
    maxAccessCount?: number;
    /** Minimum age in milliseconds since last access */
    minAgeMs?: number;
}
/**
 * Options for applying access count decay.
 *
 * @description
 * Configures how access counts are decayed over time to gradually
 * "forget" old access patterns and respond to changing usage.
 *
 * @example
 * ```typescript
 * // Apply 50% decay to all access counts
 * await tracker.applyDecay({
 *   decayFactor: 0.5,
 *   minAgeForDecayMs: 24 * 60 * 60 * 1000 // Only decay after 24 hours
 * });
 * ```
 */
export interface DecayOptions {
    /**
     * Multiplier applied to access counts (0-1).
     * 0.5 means counts are halved.
     */
    decayFactor: number;
    /**
     * Minimum age in milliseconds before decay is applied.
     * Prevents decay of recently accessed objects.
     */
    minAgeForDecayMs: number;
}
/**
 * Custom metrics for access recording.
 *
 * @description
 * Additional metrics that can be recorded with each access operation.
 *
 * @example
 * ```typescript
 * await tracker.recordAccess(sha, 'read', {
 *   bytesRead: 1024,
 *   latencyMs: 15
 * });
 * ```
 */
export interface AccessMetrics {
    /** Number of bytes read in this operation */
    bytesRead?: number;
    /** Latency of this operation in milliseconds */
    latencyMs?: number;
}
/**
 * Error thrown during migration operations.
 *
 * @description
 * Custom error class for migration failures with detailed information
 * about the failure context. Also implements MigrationResult-like properties
 * for compatibility with result handling code.
 *
 * Error codes:
 * - `NOT_FOUND`: Object does not exist in source tier
 * - `ALREADY_IN_TARGET`: Object is already in the target tier
 * - `LOCK_TIMEOUT`: Could not acquire lock within timeout
 * - `WRITE_FAILED`: Failed to write to target tier
 * - `CHECKSUM_MISMATCH`: Data verification failed after migration
 * - `UPDATE_FAILED`: Failed to update object index
 *
 * @example
 * ```typescript
 * try {
 *   await migrator.migrate(sha, 'hot', 'r2');
 * } catch (error) {
 *   if (error instanceof MigrationError) {
 *     console.log(`Migration failed: ${error.code}`);
 *     console.log(`Object: ${error.sha}`);
 *     console.log(`${error.sourceTier} -> ${error.targetTier}`);
 *   }
 * }
 * ```
 */
export declare class MigrationError extends Error {
    readonly code: string;
    readonly sha: string;
    readonly sourceTier: StorageTier;
    readonly targetTier: StorageTier;
    readonly cause?: Error | undefined;
    /** Always false for error objects */
    readonly success: boolean;
    /** Whether rollback was performed */
    readonly rolledBack: boolean;
    /** Reason for rollback (from cause error) */
    readonly rollbackReason?: string;
    /**
     * Creates a new MigrationError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param sha - SHA of the object being migrated
     * @param sourceTier - Source storage tier
     * @param targetTier - Target storage tier
     * @param cause - Underlying error that caused this failure
     */
    constructor(message: string, code: string, sha: string, sourceTier: StorageTier, targetTier: StorageTier, cause?: Error | undefined);
    /**
     * Returns this error as a MigrationError reference.
     *
     * @description
     * Provides compatibility with MigrationResult.error property access.
     *
     * @returns This MigrationError instance
     */
    get error(): MigrationError;
}
/**
 * Rollback handler for failed migrations.
 *
 * @description
 * Handles cleanup operations when a migration fails, ensuring
 * that partial migrations don't leave the system in an inconsistent state.
 *
 * @example
 * ```typescript
 * const rollback = new MigrationRollback(storage);
 * if (migrationFailed) {
 *   await rollback.rollback(job);
 * }
 * ```
 */
export declare class MigrationRollback {
    private storage;
    /**
     * Creates a new MigrationRollback handler.
     *
     * @param storage - The tier storage implementation
     */
    constructor(storage: unknown);
    /**
     * Rolls back a failed migration job.
     *
     * @description
     * Cleans up any partial data in the warm tier and releases the lock.
     * Updates the job state to 'rolled_back'.
     *
     * @param job - The migration job to roll back
     *
     * @example
     * ```typescript
     * await rollback.rollback(failedJob);
     * console.log(failedJob.state); // 'rolled_back'
     * ```
     */
    rollback(job: MigrationJob): Promise<void>;
}
/**
 * Handler for concurrent access during migration.
 *
 * @description
 * Manages read and write operations that occur while an object
 * is being migrated, ensuring data consistency.
 *
 * During migration:
 * - Reads check hot tier first (data still there), then warm tier
 * - Writes go to hot tier and may be queued for replay
 *
 * @example
 * ```typescript
 * const handler = new ConcurrentAccessHandler(storage);
 *
 * // Safe read during migration
 * const data = await handler.handleRead(sha);
 *
 * // Safe write during migration
 * await handler.handleWrite(sha, newData);
 * ```
 */
export declare class ConcurrentAccessHandler {
    private storage;
    /**
     * Creates a new ConcurrentAccessHandler.
     *
     * @param storage - The tier storage implementation
     */
    constructor(storage: unknown);
    /**
     * Handles a read operation during migration.
     *
     * @description
     * Reads from hot tier first (data is still there during migration),
     * then falls back to warm tier if not found.
     *
     * @param sha - The object SHA to read
     *
     * @returns Object data or null if not found
     *
     * @example
     * ```typescript
     * const data = await handler.handleRead(sha);
     * if (data) {
     *   // Process the data
     * }
     * ```
     */
    handleRead(sha: string): Promise<Uint8Array | null>;
    /**
     * Handles a write operation during migration.
     *
     * @description
     * Writes to the hot tier. The TierMigrator will handle replaying
     * pending writes after migration completes.
     *
     * @param sha - The object SHA to write
     * @param data - The data to write
     *
     * @example
     * ```typescript
     * await handler.handleWrite(sha, newData);
     * ```
     */
    handleWrite(sha: string, data: Uint8Array): Promise<void>;
}
/**
 * Tracks access patterns for objects to inform migration decisions.
 *
 * @description
 * Records and analyzes access patterns for objects in the storage system.
 * This information is used to make intelligent decisions about which
 * objects should be migrated between tiers.
 *
 * ## Features
 *
 * - Records read/write operations with optional metrics
 * - Calculates access frequency over time
 * - Identifies hot objects (frequently accessed)
 * - Identifies cold objects (rarely accessed)
 * - Supports access count decay for temporal relevance
 * - Persists patterns to storage for durability
 *
 * @example
 * ```typescript
 * const tracker = new AccessTracker(storage);
 *
 * // Record accesses
 * await tracker.recordAccess(sha, 'read', { bytesRead: 1024 });
 * await tracker.recordAccess(sha, 'write');
 *
 * // Get access pattern for an object
 * const pattern = await tracker.getAccessPattern(sha);
 * console.log(`Frequency: ${pattern.accessFrequency}/sec`);
 *
 * // Find hot and cold objects
 * const hotObjects = await tracker.identifyHotObjects({ minAccessCount: 50 });
 * const coldObjects = await tracker.identifyColdObjects({ maxAccessCount: 2 });
 *
 * // Apply decay to gradually forget old patterns
 * await tracker.applyDecay({ decayFactor: 0.5, minAgeForDecayMs: 86400000 });
 * ```
 */
export declare class AccessTracker {
    private storage;
    private accessPatterns;
    /**
     * Creates a new AccessTracker.
     *
     * @param storage - The tier storage implementation
     *
     * @example
     * ```typescript
     * const tracker = new AccessTracker(storage);
     * ```
     */
    constructor(storage: unknown);
    /**
     * Records an access operation for an object.
     *
     * @description
     * Tracks a read or write operation, updating the access pattern
     * for the object. Can include optional metrics like bytes read
     * and latency.
     *
     * @param sha - The object SHA being accessed
     * @param type - Type of access ('read' or 'write')
     * @param metrics - Optional additional metrics
     *
     * @example
     * ```typescript
     * // Basic access recording
     * await tracker.recordAccess(sha, 'read');
     *
     * // With metrics
     * await tracker.recordAccess(sha, 'read', {
     *   bytesRead: 2048,
     *   latencyMs: 5
     * });
     * ```
     */
    recordAccess(sha: string, type: 'read' | 'write', metrics?: AccessMetrics): Promise<void>;
    private persistPattern;
    /**
     * Gets the access pattern for a specific object.
     *
     * @description
     * Returns detailed access statistics for an object including
     * read/write counts, access frequency, and average latency.
     *
     * @param sha - The object SHA to query
     *
     * @returns Access pattern for the object
     *
     * @example
     * ```typescript
     * const pattern = await tracker.getAccessPattern(sha);
     * console.log(`Reads: ${pattern.readCount}`);
     * console.log(`Writes: ${pattern.writeCount}`);
     * console.log(`Frequency: ${pattern.accessFrequency.toFixed(2)}/sec`);
     * ```
     */
    getAccessPattern(sha: string): Promise<AccessPattern>;
    /**
     * Identifies frequently accessed (hot) objects.
     *
     * @description
     * Returns SHAs of objects that meet the hot object criteria,
     * typically objects with high access counts.
     *
     * @param criteria - Criteria for identifying hot objects
     *
     * @returns Array of SHAs for hot objects
     *
     * @example
     * ```typescript
     * const hotObjects = await tracker.identifyHotObjects({
     *   minAccessCount: 100
     * });
     * console.log(`Found ${hotObjects.length} hot objects`);
     * ```
     */
    identifyHotObjects(criteria: ObjectIdentificationCriteria): Promise<string[]>;
    /**
     * Identifies rarely accessed (cold) objects.
     *
     * @description
     * Returns SHAs of objects that meet the cold object criteria,
     * typically objects with low access counts.
     *
     * @param criteria - Criteria for identifying cold objects
     *
     * @returns Array of SHAs for cold objects
     *
     * @example
     * ```typescript
     * const coldObjects = await tracker.identifyColdObjects({
     *   maxAccessCount: 2,
     *   minAgeMs: 7 * 24 * 60 * 60 * 1000 // 7 days
     * });
     * console.log(`Found ${coldObjects.length} cold objects for migration`);
     * ```
     */
    identifyColdObjects(criteria: ObjectIdentificationCriteria): Promise<string[]>;
    /**
     * Applies decay to access counts.
     *
     * @description
     * Reduces access counts by a factor to gradually "forget" old access
     * patterns. This helps the system respond to changing usage patterns
     * over time.
     *
     * @param options - Decay configuration options
     *
     * @example
     * ```typescript
     * // Run daily to decay access counts by 50%
     * await tracker.applyDecay({
     *   decayFactor: 0.5,
     *   minAgeForDecayMs: 0 // Apply to all
     * });
     * ```
     */
    applyDecay(options: DecayOptions): Promise<void>;
    /**
     * Gets aggregate access statistics.
     *
     * @description
     * Returns summary statistics about access patterns across all
     * tracked objects.
     *
     * @returns Aggregate access statistics
     *
     * @example
     * ```typescript
     * const stats = await tracker.getAccessStats();
     * console.log(`Total reads: ${stats.totalReads}`);
     * console.log(`Total writes: ${stats.totalWrites}`);
     * console.log(`Unique objects: ${stats.uniqueObjectsAccessed}`);
     * ```
     */
    getAccessStats(): Promise<AccessStats>;
    /**
     * Loads persisted access patterns from storage.
     *
     * @description
     * Restores access patterns that were previously persisted,
     * useful for recovering state after a restart.
     *
     * @example
     * ```typescript
     * // On startup, restore access patterns
     * await tracker.loadFromStorage();
     * ```
     */
    loadFromStorage(): Promise<void>;
}
/**
 * Main tier migration service.
 *
 * @description
 * Orchestrates the migration of Git objects between storage tiers.
 * Provides both synchronous single-object migration and asynchronous
 * job-based migration for long-running operations.
 *
 * ## Migration Process
 *
 * 1. Validate object exists and is not already in target tier
 * 2. Acquire distributed lock with configurable timeout
 * 3. Read data from source tier
 * 4. Optionally compute source checksum
 * 5. Write data to target tier
 * 6. Optionally verify checksum matches
 * 7. Update object index to point to new location
 * 8. Delete from source tier
 * 9. Release lock
 *
 * If any step fails, the migration is automatically rolled back.
 *
 * @example
 * ```typescript
 * const migrator = new TierMigrator(storage);
 *
 * // Simple migration
 * const result = await migrator.migrate(sha, 'hot', 'r2');
 * if (result.success) {
 *   console.log('Migration successful');
 * }
 *
 * // Migration with verification
 * const verifiedResult = await migrator.migrate(sha, 'hot', 'r2', {
 *   verifyChecksum: true,
 *   lockTimeout: 10000
 * });
 *
 * // Batch migration
 * const batchResult = await migrator.migrateBatch(shas, 'hot', 'r2', {
 *   concurrency: 5
 * });
 * console.log(`Migrated: ${batchResult.successful.length}`);
 *
 * // Long-running migration job
 * const job = await migrator.startMigrationJob(largeSha, 'hot', 'r2');
 * // ... later
 * await migrator.completeMigrationJob(job);
 * ```
 */
export declare class TierMigrator {
    private storage;
    private activeJobs;
    private migrationHistory;
    private migratingObjects;
    private pendingWrites;
    /**
     * Creates a new TierMigrator.
     *
     * @param storage - The tier storage implementation
     *
     * @example
     * ```typescript
     * const migrator = new TierMigrator(storage);
     * ```
     */
    constructor(storage: unknown);
    /**
     * Finds objects that are candidates for migration based on policy.
     *
     * @description
     * Analyzes objects in the hot tier and returns those that meet
     * the migration criteria defined in the policy. Results are sorted
     * by last access time (oldest first).
     *
     * @param policy - Migration policy defining criteria
     *
     * @returns Array of SHAs that are candidates for migration
     *
     * @example
     * ```typescript
     * const candidates = await migrator.findMigrationCandidates({
     *   maxAgeInHot: 7 * 24 * 60 * 60 * 1000, // 7 days
     *   minAccessCount: 5,
     *   maxHotSize: 100 * 1024 * 1024
     * });
     *
     * console.log(`Found ${candidates.length} candidates for migration`);
     * ```
     */
    findMigrationCandidates(policy: MigrationPolicy): Promise<string[]>;
    /**
     * Migrates a single object between tiers.
     *
     * @description
     * Performs a complete migration of an object from the source tier
     * to the target tier. Handles locking, data transfer, verification,
     * and cleanup.
     *
     * @param sha - The object SHA to migrate
     * @param sourceTier - The source storage tier
     * @param targetTier - The target storage tier
     * @param options - Optional migration settings
     *
     * @returns Migration result with success/failure status
     *
     * @throws {MigrationError} If object not found or already in target tier
     *
     * @example
     * ```typescript
     * // Basic migration
     * const result = await migrator.migrate(sha, 'hot', 'r2');
     *
     * // With checksum verification
     * const verified = await migrator.migrate(sha, 'hot', 'r2', {
     *   verifyChecksum: true,
     *   lockTimeout: 10000
     * });
     *
     * if (verified.success) {
     *   console.log('Migration successful');
     *   if (verified.checksumVerified) {
     *     console.log('Integrity verified');
     *   }
     * } else if (verified.rolledBack) {
     *   console.log(`Rolled back: ${verified.rollbackReason}`);
     * }
     * ```
     */
    migrate(sha: string, sourceTier: StorageTier, targetTier: StorageTier, options?: MigrateOptions): Promise<MigrationResult>;
    private recordHistory;
    /**
     * Starts a long-running migration job.
     *
     * @description
     * Initiates a migration job that can be monitored and completed
     * asynchronously. Useful for large objects where progress tracking
     * is important.
     *
     * @param sha - The object SHA to migrate
     * @param sourceTier - The source storage tier
     * @param targetTier - The target storage tier
     *
     * @returns The migration job with tracking information
     *
     * @example
     * ```typescript
     * const job = await migrator.startMigrationJob(largeSha, 'hot', 'r2');
     * console.log(`Job ${job.id} started`);
     * console.log(`Progress: ${job.progress.bytesTransferred}/${job.progress.totalBytes}`);
     *
     * // Complete the job when ready
     * await migrator.completeMigrationJob(job);
     * ```
     */
    startMigrationJob(sha: string, sourceTier: StorageTier, targetTier: StorageTier): Promise<MigrationJob>;
    /**
     * Completes a migration job.
     *
     * @description
     * Finalizes a migration job by updating the index and cleaning up
     * the source tier. Also processes any pending writes that occurred
     * during the migration.
     *
     * @param job - The migration job to complete
     *
     * @example
     * ```typescript
     * const job = await migrator.startMigrationJob(sha, 'hot', 'r2');
     * // ... wait for progress or do other work
     * await migrator.completeMigrationJob(job);
     * console.log(`Job completed at ${new Date(job.completedAt!)}`);
     * ```
     */
    completeMigrationJob(job: MigrationJob): Promise<void>;
    /**
     * Rolls back a migration job.
     *
     * @description
     * Cancels a migration job and cleans up any partial data in the
     * target tier.
     *
     * @param job - The migration job to roll back
     *
     * @example
     * ```typescript
     * const job = await migrator.startMigrationJob(sha, 'hot', 'r2');
     * if (someCondition) {
     *   await migrator.rollbackMigrationJob(job);
     *   console.log('Migration rolled back');
     * }
     * ```
     */
    rollbackMigrationJob(job: MigrationJob): Promise<void>;
    /**
     * Cancels a migration job by ID.
     *
     * @description
     * Stops a migration job and cleans up resources.
     *
     * @param jobId - The job ID to cancel
     *
     * @example
     * ```typescript
     * const job = await migrator.startMigrationJob(sha, 'hot', 'r2');
     * // Later...
     * await migrator.cancelMigrationJob(job.id);
     * ```
     */
    cancelMigrationJob(jobId: string): Promise<void>;
    /**
     * Gets all active migration jobs.
     *
     * @description
     * Returns jobs that are currently in progress.
     *
     * @returns Array of active migration jobs
     *
     * @example
     * ```typescript
     * const activeJobs = await migrator.getActiveMigrationJobs();
     * for (const job of activeJobs) {
     *   console.log(`${job.id}: ${job.sha} - ${job.progress.bytesTransferred}/${job.progress.totalBytes}`);
     * }
     * ```
     */
    getActiveMigrationJobs(): Promise<MigrationJob[]>;
    /**
     * Gets migration history for an object.
     *
     * @description
     * Returns the history of migration events for a specific object.
     *
     * @param sha - The object SHA to query
     *
     * @returns Array of migration history entries
     *
     * @example
     * ```typescript
     * const history = await migrator.getMigrationHistory(sha);
     * for (const entry of history) {
     *   console.log(`${new Date(entry.timestamp)}: ${entry.state}`);
     * }
     * ```
     */
    getMigrationHistory(sha: string): Promise<MigrationHistoryEntry[]>;
    /**
     * Migrates multiple objects in a batch.
     *
     * @description
     * Efficiently migrates multiple objects with configurable concurrency.
     * Failed migrations don't affect other objects in the batch.
     *
     * @param shas - Array of object SHAs to migrate
     * @param sourceTier - The source storage tier
     * @param targetTier - The target storage tier
     * @param options - Optional batch migration settings
     *
     * @returns Result with successful and failed SHAs
     *
     * @example
     * ```typescript
     * const result = await migrator.migrateBatch(
     *   candidates,
     *   'hot',
     *   'r2',
     *   { concurrency: 5 }
     * );
     *
     * console.log(`Migrated: ${result.successful.length}`);
     * console.log(`Failed: ${result.failed.length}`);
     * ```
     */
    migrateBatch(shas: string[], sourceTier: StorageTier, targetTier: StorageTier, options?: BatchMigrationOptions): Promise<BatchMigrationResult>;
    /**
     * Reads object data during an in-progress migration.
     *
     * @description
     * Safely reads data for an object that may be in the process of
     * being migrated. Checks hot tier first, then warm tier.
     *
     * @param sha - The object SHA to read
     *
     * @returns Object data or null if not found
     *
     * @example
     * ```typescript
     * const data = await migrator.readDuringMigration(sha);
     * if (data) {
     *   // Process the data regardless of which tier it's in
     * }
     * ```
     */
    readDuringMigration(sha: string): Promise<Uint8Array | null>;
    /**
     * Writes object data during an in-progress migration.
     *
     * @description
     * Safely handles writes for an object that may be in the process
     * of being migrated. If the object is being migrated, the write
     * is queued and replayed after migration completes.
     *
     * @param sha - The object SHA to write
     * @param data - The data to write
     *
     * @example
     * ```typescript
     * // This is safe to call even during migration
     * await migrator.writeDuringMigration(sha, newData);
     * ```
     */
    writeDuringMigration(sha: string, data: Uint8Array): Promise<void>;
    /**
     * Computes SHA-256 checksum for data verification.
     *
     * @description
     * Calculates a SHA-256 hash of the data for integrity verification
     * during migration.
     *
     * @param data - The data to hash
     *
     * @returns Hex-encoded SHA-256 hash
     *
     * @example
     * ```typescript
     * const checksum = await migrator.computeChecksum(data);
     * console.log(`Checksum: ${checksum}`);
     * ```
     */
    computeChecksum(data: Uint8Array): Promise<string>;
}
//# sourceMappingURL=migration.d.ts.map