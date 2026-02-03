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

// Tier Migration
export {
  // Classes
  TierMigrator,
  AccessTracker,
  MigrationError,
  MigrationRollback,
  ConcurrentAccessHandler,
  // Types
  type MigrationPolicy,
  type MigrationState,
  type MigrationProgress,
  type MigrationJob,
  type MigrationResult,
  type BatchMigrationResult,
  type BatchMigrationOptions,
  type MigrateOptions,
  type MigrationHistoryEntry,
  type AccessPattern,
  type AccessStats,
  type ObjectIdentificationCriteria,
  type DecayOptions,
  type AccessMetrics,
} from './migration'

// Tiered Read Path
export {
  // Class
  TieredReader,
  TieredObjectStoreStub,
  // Types
  type StoredObject,
  type TierConfig,
  type TieredStorageConfig,
  type ReadResult,
  type TieredObjectStore,
  type HotTierBackend,
  type WarmTierBackend,
  type ColdTierBackend,
} from './read-path'

// Background Migration with DO Alarms
export {
  // Class
  TierMigrationScheduler,
  // Factory
  createMigrationScheduler,
  // Constants
  DEFAULT_MIGRATION_CONFIG,
  // Types
  type BackgroundMigrationConfig,
  type MigrationDOStorage,
  type TieredStorageBackend,
  type MigrationCandidate,
  type MigrationResult as BackgroundMigrationResult,
  type MigrationCycleResult,
  type MigrationSchedulerState,
} from './background-migration'
