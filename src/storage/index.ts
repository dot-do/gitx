/**
 * @fileoverview Storage Subpath Barrel
 *
 * Targeted exports for storage-related modules: R2 pack storage, object
 * indexing, and tiered storage (migration + read-path).
 *
 * @module storage
 *
 * @example
 * ```typescript
 * import { R2PackStorage, ObjectIndex, TieredReader } from 'gitx.do/storage'
 * ```
 */

// R2 Pack Storage
export {
  R2PackStorage,
  R2PackError,
  uploadPackfile,
  downloadPackfile,
  getPackfileMetadata,
  listPackfiles,
  deletePackfile,
  createMultiPackIndex,
  parseMultiPackIndex,
  lookupObjectInMultiPack,
  acquirePackLock,
  releasePackLock,
  type R2PackStorageOptions,
  type PackfileUploadResult,
  type PackfileMetadata,
  type DownloadPackfileOptions,
  type DownloadPackfileResult,
  type UploadPackfileOptions,
  type MultiPackIndexEntry,
  type MultiPackIndex,
  type PackLock,
  type AcquireLockOptions,
  type ListPackfilesResult,
} from './r2-pack'

// Object Index
export {
  ObjectIndex,
  recordLocation,
  lookupLocation,
  batchLookup,
  getStats,
  type StorageTier,
  type ObjectLocation,
  type ObjectIndexStats,
  type BatchLookupResult,
  type RecordLocationOptions,
} from './object-index'

// Tiered Storage - Migration
export {
  TierMigrator,
  AccessTracker,
  MigrationError,
  MigrationRollback,
  ConcurrentAccessHandler,
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
} from '../tiered/migration'

// Tiered Storage - Read Path
export {
  TieredReader,
  TieredObjectStoreStub,
  type StoredObject,
  type TierConfig,
  type TieredStorageConfig,
  type ReadResult,
  type TieredObjectStore,
  type HotTierBackend,
  type WarmTierBackend,
  type ColdTierBackend,
} from '../tiered/read-path'
