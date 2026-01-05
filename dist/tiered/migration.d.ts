/**
 * Tier Migration (Hot -> Warm)
 *
 * Handles migration of git objects between storage tiers:
 * - Hot: SQLite (local Durable Object storage for frequently accessed objects)
 * - Warm/R2: Packed in R2 object storage (for larger objects or archives)
 *
 * gitdo-jcf: GREEN phase - Tier migration implementation
 */
import { StorageTier } from '../storage/object-index';
/**
 * Migration policy configuration
 */
export interface MigrationPolicy {
    /** Maximum age in hot tier before migration (milliseconds) */
    maxAgeInHot: number;
    /** Minimum access count to stay in hot tier */
    minAccessCount: number;
    /** Maximum total size of hot tier (bytes) */
    maxHotSize: number;
}
/**
 * Migration job state
 */
export type MigrationState = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'rolled_back';
/**
 * Migration job progress
 */
export interface MigrationProgress {
    bytesTransferred: number;
    totalBytes: number;
}
/**
 * Migration job tracking
 */
export interface MigrationJob {
    id: string;
    sha: string;
    sourceTier: StorageTier;
    targetTier: StorageTier;
    state: MigrationState;
    lockAcquired: boolean;
    progress: MigrationProgress;
    startedAt: number;
    completedAt?: number;
}
/**
 * Migration result
 */
export interface MigrationResult {
    success: boolean;
    skipped?: boolean;
    rolledBack?: boolean;
    checksumVerified?: boolean;
    error?: MigrationError;
    rollbackReason?: string;
}
/**
 * Batch migration result
 */
export interface BatchMigrationResult {
    successful: string[];
    failed: string[];
}
/**
 * Batch migration options
 */
export interface BatchMigrationOptions {
    concurrency?: number;
}
/**
 * Migration options
 */
export interface MigrateOptions {
    verifyChecksum?: boolean;
    lockTimeout?: number;
}
/**
 * Migration history entry
 */
export interface MigrationHistoryEntry {
    sha: string;
    sourceTier: StorageTier;
    targetTier: StorageTier;
    state: MigrationState;
    timestamp: number;
}
/**
 * Access pattern for an object
 */
export interface AccessPattern {
    sha: string;
    readCount: number;
    writeCount: number;
    lastAccessedAt: number;
    accessFrequency: number;
    totalBytesRead?: number;
    avgLatencyMs?: number;
}
/**
 * Access statistics
 */
export interface AccessStats {
    totalReads: number;
    totalWrites: number;
    uniqueObjectsAccessed: number;
}
/**
 * Hot/cold object identification criteria
 */
export interface ObjectIdentificationCriteria {
    minAccessCount?: number;
    maxAccessCount?: number;
    minAgeMs?: number;
}
/**
 * Access decay options
 */
export interface DecayOptions {
    decayFactor: number;
    minAgeForDecayMs: number;
}
/**
 * Custom access metrics
 */
export interface AccessMetrics {
    bytesRead?: number;
    latencyMs?: number;
}
/**
 * Error thrown during migration operations
 * Also implements MigrationResult-like properties for compatibility
 */
export declare class MigrationError extends Error {
    readonly code: string;
    readonly sha: string;
    readonly sourceTier: StorageTier;
    readonly targetTier: StorageTier;
    readonly cause?: Error | undefined;
    readonly success: boolean;
    readonly rolledBack: boolean;
    readonly rollbackReason?: string;
    constructor(message: string, code: string, sha: string, sourceTier: StorageTier, targetTier: StorageTier, cause?: Error | undefined);
    /**
     * Get this error as a MigrationResult
     */
    get error(): MigrationError;
}
/**
 * Rollback handler for failed migrations
 */
export declare class MigrationRollback {
    private storage;
    constructor(storage: unknown);
    rollback(job: MigrationJob): Promise<void>;
}
/**
 * Handler for concurrent access during migration
 */
export declare class ConcurrentAccessHandler {
    private storage;
    constructor(storage: unknown);
    handleRead(sha: string): Promise<Uint8Array | null>;
    handleWrite(sha: string, data: Uint8Array): Promise<void>;
}
/**
 * Tracks access patterns for objects to inform migration decisions
 */
export declare class AccessTracker {
    private storage;
    private accessPatterns;
    constructor(storage: unknown);
    recordAccess(sha: string, type: 'read' | 'write', metrics?: AccessMetrics): Promise<void>;
    private persistPattern;
    getAccessPattern(sha: string): Promise<AccessPattern>;
    identifyHotObjects(criteria: ObjectIdentificationCriteria): Promise<string[]>;
    identifyColdObjects(criteria: ObjectIdentificationCriteria): Promise<string[]>;
    applyDecay(options: DecayOptions): Promise<void>;
    getAccessStats(): Promise<AccessStats>;
    loadFromStorage(): Promise<void>;
}
/**
 * Main tier migration service
 */
export declare class TierMigrator {
    private storage;
    private activeJobs;
    private migrationHistory;
    private migratingObjects;
    private pendingWrites;
    constructor(storage: unknown);
    /**
     * Find objects that are candidates for migration based on policy
     */
    findMigrationCandidates(policy: MigrationPolicy): Promise<string[]>;
    /**
     * Migrate a single object between tiers
     */
    migrate(sha: string, sourceTier: StorageTier, targetTier: StorageTier, options?: MigrateOptions): Promise<MigrationResult>;
    private recordHistory;
    /**
     * Start a migration job (for long-running migrations)
     */
    startMigrationJob(sha: string, sourceTier: StorageTier, targetTier: StorageTier): Promise<MigrationJob>;
    /**
     * Complete a migration job
     */
    completeMigrationJob(job: MigrationJob): Promise<void>;
    /**
     * Rollback a migration job
     */
    rollbackMigrationJob(job: MigrationJob): Promise<void>;
    /**
     * Cancel a migration job
     */
    cancelMigrationJob(jobId: string): Promise<void>;
    /**
     * Get active migration jobs
     */
    getActiveMigrationJobs(): Promise<MigrationJob[]>;
    /**
     * Get migration history for an object
     */
    getMigrationHistory(sha: string): Promise<MigrationHistoryEntry[]>;
    /**
     * Migrate multiple objects in a batch
     */
    migrateBatch(shas: string[], sourceTier: StorageTier, targetTier: StorageTier, options?: BatchMigrationOptions): Promise<BatchMigrationResult>;
    /**
     * Read object data during an in-progress migration
     */
    readDuringMigration(sha: string): Promise<Uint8Array | null>;
    /**
     * Write object data during an in-progress migration
     */
    writeDuringMigration(sha: string, data: Uint8Array): Promise<void>;
    /**
     * Compute checksum for data verification
     */
    computeChecksum(data: Uint8Array): Promise<string>;
}
//# sourceMappingURL=migration.d.ts.map