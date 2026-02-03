/**
 * @fileoverview Tiered Storage Subpath Barrel
 *
 * Targeted exports for tiered storage: migration, read path, and background
 * migration with DO alarms.
 *
 * @module tiered
 *
 * @example
 * ```typescript
 * import { TierMigrator, TieredReader, TierMigrationScheduler } from 'gitx.do/tiered'
 * ```
 */
export { TierMigrator, AccessTracker, MigrationError, MigrationRollback, ConcurrentAccessHandler, type MigrationPolicy, type MigrationState, type MigrationProgress, type MigrationJob, type MigrationResult, type BatchMigrationResult, type BatchMigrationOptions, type MigrateOptions, type MigrationHistoryEntry, type AccessPattern, type AccessStats, type ObjectIdentificationCriteria, type DecayOptions, type AccessMetrics, } from './migration';
export { TieredReader, TieredObjectStoreStub, type StoredObject, type TierConfig, type TieredStorageConfig, type ReadResult, type TieredObjectStore, type HotTierBackend, type WarmTierBackend, type ColdTierBackend, } from './read-path';
export { TierMigrationScheduler, createMigrationScheduler, DEFAULT_MIGRATION_CONFIG, type BackgroundMigrationConfig, type MigrationDOStorage, type TieredStorageBackend, type MigrationCandidate, type MigrationResult as BackgroundMigrationResult, type MigrationCycleResult, type MigrationSchedulerState, } from './background-migration';
//# sourceMappingURL=index.d.ts.map