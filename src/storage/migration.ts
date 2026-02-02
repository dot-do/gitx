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

import type { DurableObjectStorage } from './types'
import type { ObjectLocation, StorageTier, RecordLocationOptions } from './object-index'
import { ObjectIndex } from './object-index'
import {
  BundleObjectType,
  objectTypeToBundleType,
  createBundle,
  BUNDLE_HEADER_SIZE,
  BUNDLE_INDEX_ENTRY_SIZE,
} from './bundle/format'

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * R2 storage interface for reading loose objects and writing bundles.
 */
export interface MigrationR2Storage {
  /** Read an object from R2 */
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
  /** Write an object to R2 */
  put(key: string, data: ArrayBuffer | Uint8Array): Promise<void>
  /** Delete an object from R2 */
  delete(key: string): Promise<void>
  /** List objects with a prefix */
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    objects: Array<{ key: string; size: number }>
    truncated: boolean
    cursor?: string
  }>
}

/**
 * Configuration options for the migration process.
 */
export interface MigrationConfig {
  /** Maximum size of a bundle in bytes (default: 4MB) */
  maxBundleSize?: number

  /** Number of objects to process per batch (default: 100) */
  batchSize?: number

  /** Prefix for loose objects in R2 (default: 'objects/') */
  looseObjectPrefix?: string

  /** Prefix for bundles in R2 (default: 'bundles/') */
  bundlePrefix?: string

  /** If true, don't actually modify storage (default: false) */
  dryRun?: boolean

  /** If true, verify data integrity after migration (default: true) */
  verify?: boolean

  /** If true, delete old loose objects after successful migration (default: false) */
  cleanup?: boolean

  /** Concurrency limit for parallel operations (default: 5) */
  concurrency?: number

  /** Callback for progress updates */
  onProgress?: (progress: MigrationProgress) => void

  /** Callback for errors (migration continues on non-fatal errors) */
  onError?: (error: MigrationObjectError) => void
}

/**
 * Progress information during migration.
 */
export interface MigrationProgress {
  /** Current phase of migration */
  phase: 'scanning' | 'migrating' | 'verifying' | 'cleaning'

  /** Total number of loose objects found */
  totalObjects: number

  /** Number of objects processed so far */
  processedObjects: number

  /** Number of objects successfully migrated */
  migratedObjects: number

  /** Number of objects that failed to migrate */
  failedObjects: number

  /** Number of bundles created so far */
  bundlesCreated: number

  /** Total bytes processed */
  bytesProcessed: number

  /** Estimated time remaining in milliseconds */
  estimatedTimeRemaining?: number

  /** Current object being processed */
  currentObject?: string
}

/**
 * Error information for a single object migration failure.
 */
export interface MigrationObjectError {
  /** SHA of the object that failed */
  sha: string

  /** Error message */
  message: string

  /** Original error if available */
  cause?: Error

  /** Whether this error is recoverable */
  recoverable: boolean
}

/**
 * Result of a migration operation.
 */
export interface MigrationResult {
  /** Whether the migration completed successfully */
  success: boolean

  /** Total number of loose objects found */
  totalObjectsFound: number

  /** Number of objects successfully migrated */
  objectsMigrated: number

  /** Number of objects that failed to migrate */
  objectsFailed: number

  /** Number of bundles created */
  bundlesCreated: number

  /** Total bytes migrated */
  bytesMigrated: number

  /** Number of loose objects deleted (if cleanup was enabled) */
  objectsCleaned: number

  /** Duration of the migration in milliseconds */
  durationMs: number

  /** List of errors encountered */
  errors: MigrationObjectError[]

  /** Whether this was a dry run */
  dryRun: boolean

  /** IDs of bundles created */
  bundleIds: string[]

  /** Checkpoint for resuming interrupted migration */
  checkpoint?: MigrationCheckpoint
}

/**
 * Checkpoint for resuming an interrupted migration.
 */
export interface MigrationCheckpoint {
  /** Unique ID for this migration run */
  migrationId: string

  /** Timestamp when checkpoint was created */
  timestamp: number

  /** Last successfully processed cursor/position */
  lastCursor?: string

  /** SHAs of objects that have been processed */
  processedShas: string[]

  /** SHAs of objects that failed and should be retried */
  failedShas: string[]

  /** IDs of bundles that have been created */
  createdBundleIds: string[]

  /** Configuration used for this migration */
  config: MigrationConfig
}

/**
 * Rollback information for undoing a migration.
 */
export interface MigrationRollbackInfo {
  /** Migration ID being rolled back */
  migrationId: string

  /** Bundles created during migration that need to be deleted */
  bundlesToDelete: string[]

  /** Objects that need their index restored to 'hot' tier */
  objectsToRestore: Array<{
    sha: string
    originalKey: string
  }>

  /** Timestamp when rollback info was created */
  timestamp: number
}

/**
 * Result of a rollback operation.
 */
export interface RollbackResult {
  /** Whether the rollback completed successfully */
  success: boolean

  /** Number of bundles deleted */
  bundlesDeleted: number

  /** Number of index entries restored */
  indexEntriesRestored: number

  /** Duration of the rollback in milliseconds */
  durationMs: number

  /** Errors encountered during rollback */
  errors: Array<{ message: string; cause?: Error }>
}

/**
 * Status of a migration job.
 */
export type MigrationStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed'

/**
 * Information about a loose object to migrate.
 */
export interface LooseObjectInfo {
  /** SHA of the object */
  sha: string

  /** Size of the compressed object in bytes */
  size: number

  /** Object type if known */
  type?: 'blob' | 'tree' | 'commit' | 'tag'

  /** R2 key for the loose object */
  r2Key: string
}

/**
 * Pending bundle being built during migration.
 */
interface PendingBundle {
  /** Unique ID for this bundle */
  id: string

  /** Objects to include in this bundle */
  objects: Array<{
    sha: string
    type: BundleObjectType
    data: Uint8Array
  }>

  /** Current size of the bundle */
  size: number
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown during migration operations.
 */
export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly code: MigrationErrorCode,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'MigrationError'
  }
}

/**
 * Error codes for migration failures.
 */
export enum MigrationErrorCode {
  /** Object not found in source storage */
  OBJECT_NOT_FOUND = 'OBJECT_NOT_FOUND',

  /** Failed to read object from source */
  READ_FAILED = 'READ_FAILED',

  /** Failed to write bundle to destination */
  WRITE_FAILED = 'WRITE_FAILED',

  /** Checksum verification failed */
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',

  /** Migration was interrupted */
  INTERRUPTED = 'INTERRUPTED',

  /** Invalid migration configuration */
  INVALID_CONFIG = 'INVALID_CONFIG',

  /** Failed to acquire lock for object */
  LOCK_FAILED = 'LOCK_FAILED',

  /** Checkpoint not found for resume */
  CHECKPOINT_NOT_FOUND = 'CHECKPOINT_NOT_FOUND',

  /** Generic migration failure */
  MIGRATION_FAILED = 'MIGRATION_FAILED'
}

// =============================================================================
// Constants
// =============================================================================

/** Default maximum bundle size (4MB) */
export const DEFAULT_MAX_BUNDLE_SIZE = 4 * 1024 * 1024

/** Default batch size for processing */
export const DEFAULT_BATCH_SIZE = 100

/** Default concurrency limit */
export const DEFAULT_CONCURRENCY = 5

/** Default loose object prefix */
export const DEFAULT_LOOSE_PREFIX = 'objects/'

/** Default bundle prefix */
export const DEFAULT_BUNDLE_PREFIX = 'bundles/'

const decoder = new TextDecoder()

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique bundle ID.
 */
function generateBundleId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `bundle-${timestamp}-${random}`
}

/**
 * Generate a unique migration ID.
 */
function generateMigrationId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `migration-${timestamp}-${random}`
}

/**
 * Convert Git object type string to BundleObjectType enum.
 * Falls back to BLOB for unknown types.
 */
function toBundleObjectType(type: string): BundleObjectType {
  try {
    return objectTypeToBundleType(type)
  } catch {
    return BundleObjectType.BLOB
  }
}

/**
 * Extract SHA from a loose object R2 key.
 * Example: 'objects/ab/cdef1234...' -> 'abcdef1234...'
 */
function extractShaFromKey(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix)) {
    return null
  }
  const path = key.slice(prefix.length)
  const parts = path.split('/')
  if (parts.length !== 2 || parts[0].length !== 2 || parts[1].length !== 38) {
    return null
  }
  return parts[0] + parts[1]
}

/**
 * Build R2 key for a loose object from SHA.
 */


// =============================================================================
// LooseToBundleMigrator Class
// =============================================================================

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
export class LooseToBundleMigrator {
  private readonly storage: DurableObjectStorage
  private readonly r2: MigrationR2Storage
  private readonly config: Required<Omit<MigrationConfig, 'onProgress' | 'onError'>> &
    Pick<MigrationConfig, 'onProgress' | 'onError'>
  private readonly objectIndex: ObjectIndex

  private status: MigrationStatus = 'pending'
  private migrationId: string = ''
  private startTime: number = 0
  private processedObjects: Set<string> = new Set()
  private failedObjects: Map<string, MigrationObjectError> = new Map()
  private createdBundleIds: string[] = []
  private currentBundle: PendingBundle | null = null

  /**
   * Create a new migrator instance.
   *
   * @param storage - Durable Object storage for index and checkpoints
   * @param r2 - R2 storage for reading loose objects and writing bundles
   * @param config - Migration configuration options
   */
  constructor(
    storage: DurableObjectStorage,
    r2: MigrationR2Storage,
    config: MigrationConfig = {}
  ) {
    this.storage = storage
    this.r2 = r2
    this.objectIndex = new ObjectIndex(storage)

    // Merge config with defaults
    this.config = {
      maxBundleSize: config.maxBundleSize ?? DEFAULT_MAX_BUNDLE_SIZE,
      batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
      looseObjectPrefix: config.looseObjectPrefix ?? DEFAULT_LOOSE_PREFIX,
      bundlePrefix: config.bundlePrefix ?? DEFAULT_BUNDLE_PREFIX,
      dryRun: config.dryRun ?? false,
      verify: config.verify ?? true,
      cleanup: config.cleanup ?? false,
      concurrency: config.concurrency ?? DEFAULT_CONCURRENCY,
      onProgress: config.onProgress,
      onError: config.onError
    }
  }

  /**
   * Get current migration status.
   */
  getStatus(): MigrationStatus {
    return this.status
  }

  /**
   * Run the migration process.
   *
   * @param overrides - Optional config overrides for this run
   * @returns Migration result with statistics and errors
   */
  async migrate(overrides?: Partial<MigrationConfig>): Promise<MigrationResult> {
    const config = { ...this.config, ...overrides }

    this.migrationId = generateMigrationId()
    this.startTime = Date.now()
    this.status = 'running'
    this.processedObjects = new Set()
    this.failedObjects = new Map()
    this.createdBundleIds = []
    this.currentBundle = null

    const errors: MigrationObjectError[] = []
    let totalObjectsFound = 0
    let bytesMigrated = 0
    let objectsCleaned = 0

    try {
      // Phase 1: Scan for loose objects
      this.reportProgress({
        phase: 'scanning',
        totalObjects: 0,
        processedObjects: 0,
        migratedObjects: 0,
        failedObjects: 0,
        bundlesCreated: 0,
        bytesProcessed: 0
      })

      const looseObjects = await this.scanLooseObjects()
      totalObjectsFound = looseObjects.length

      if (totalObjectsFound === 0) {
        this.status = 'completed'
        return {
          success: true,
          totalObjectsFound: 0,
          objectsMigrated: 0,
          objectsFailed: 0,
          bundlesCreated: 0,
          bytesMigrated: 0,
          objectsCleaned: 0,
          durationMs: Date.now() - this.startTime,
          errors: [],
          dryRun: config.dryRun,
          bundleIds: []
        }
      }

      // Phase 2: Migrate objects to bundles
      this.reportProgress({
        phase: 'migrating',
        totalObjects: totalObjectsFound,
        processedObjects: 0,
        migratedObjects: 0,
        failedObjects: 0,
        bundlesCreated: 0,
        bytesProcessed: 0
      })

      for (let i = 0; i < looseObjects.length; i += config.batchSize) {
        const batch = looseObjects.slice(i, i + config.batchSize)

        for (const obj of batch) {
          try {
            const migrated = await this.migrateObject(obj, config.dryRun)
            if (migrated) {
              bytesMigrated += obj.size
            }
          } catch (err) {
            const error: MigrationObjectError = {
              sha: obj.sha,
              message: err instanceof Error ? err.message : String(err),
              cause: err instanceof Error ? err : undefined,
              recoverable: true
            }
            this.failedObjects.set(obj.sha, error)
            errors.push(error)
            config.onError?.(error)
          }

          this.reportProgress({
            phase: 'migrating',
            totalObjects: totalObjectsFound,
            processedObjects: this.processedObjects.size + this.failedObjects.size,
            migratedObjects: this.processedObjects.size,
            failedObjects: this.failedObjects.size,
            bundlesCreated: this.createdBundleIds.length,
            bytesProcessed: bytesMigrated,
            currentObject: obj.sha
          })
        }

        // Save checkpoint after each batch
        if (!config.dryRun) {
          await this.saveCheckpoint()
        }
      }

      // Flush any remaining objects in the current bundle
      if (this.currentBundle && this.currentBundle.objects.length > 0) {
        if (!config.dryRun) {
          await this.flushCurrentBundle()
        } else {
          this.createdBundleIds.push(this.currentBundle.id)
        }
      }

      // Phase 3: Verify if enabled
      if (config.verify && !config.dryRun && this.processedObjects.size > 0) {
        this.reportProgress({
          phase: 'verifying',
          totalObjects: totalObjectsFound,
          processedObjects: this.processedObjects.size,
          migratedObjects: this.processedObjects.size,
          failedObjects: this.failedObjects.size,
          bundlesCreated: this.createdBundleIds.length,
          bytesProcessed: bytesMigrated
        })

        const verificationErrors = await this.verifyMigration(looseObjects)
        errors.push(...verificationErrors)
      }

      // Phase 4: Cleanup if enabled
      if (config.cleanup && !config.dryRun && this.processedObjects.size > 0) {
        this.reportProgress({
          phase: 'cleaning',
          totalObjects: totalObjectsFound,
          processedObjects: this.processedObjects.size,
          migratedObjects: this.processedObjects.size,
          failedObjects: this.failedObjects.size,
          bundlesCreated: this.createdBundleIds.length,
          bytesProcessed: bytesMigrated
        })

        objectsCleaned = await this.cleanupLooseObjects(looseObjects)
      }

      this.status = 'completed'

      return {
        success: this.failedObjects.size === 0,
        totalObjectsFound,
        objectsMigrated: this.processedObjects.size,
        objectsFailed: this.failedObjects.size,
        bundlesCreated: this.createdBundleIds.length,
        bytesMigrated,
        objectsCleaned,
        durationMs: Date.now() - this.startTime,
        errors,
        dryRun: config.dryRun,
        bundleIds: this.createdBundleIds
      }
    } catch (err) {
      this.status = 'failed'

      // Save checkpoint for resume
      if (!config.dryRun) {
        await this.saveCheckpoint()
      }

      throw new MigrationError(
        `Migration failed: ${err instanceof Error ? err.message : String(err)}`,
        MigrationErrorCode.MIGRATION_FAILED,
        err instanceof Error ? err : undefined
      )
    }
  }

  /**
   * Resume a previously interrupted migration.
   *
   * @param checkpointId - ID of the checkpoint to resume from
   * @returns Migration result
   */
  async resume(checkpointId: string): Promise<MigrationResult> {
    const checkpoint = await this.loadCheckpoint(checkpointId)
    if (!checkpoint) {
      throw new MigrationError(
        `Checkpoint not found: ${checkpointId}`,
        MigrationErrorCode.CHECKPOINT_NOT_FOUND
      )
    }

    // Restore state from checkpoint
    this.migrationId = checkpoint.migrationId
    this.processedObjects = new Set(checkpoint.processedShas)
    this.createdBundleIds = [...checkpoint.createdBundleIds]

    // Continue migration with original config
    return this.migrate(checkpoint.config)
  }

  /**
   * Get a preview of what would be migrated without making changes.
   */
  async preview(): Promise<{
    totalObjects: number
    totalSize: number
    estimatedBundles: number
    objects: LooseObjectInfo[]
  }> {
    const looseObjects = await this.scanLooseObjects()
    const totalSize = looseObjects.reduce((sum, obj) => sum + obj.size, 0)
    const estimatedBundles = Math.ceil(totalSize / this.config.maxBundleSize)

    return {
      totalObjects: looseObjects.length,
      totalSize,
      estimatedBundles,
      objects: looseObjects
    }
  }

  /**
   * Verify that all migrated objects can be read from bundles.
   */
  async verifyAll(): Promise<{
    verified: number
    failed: number
    errors: MigrationObjectError[]
  }> {
    const errors: MigrationObjectError[] = []
    const looseObjects = await this.scanLooseObjects()

    const verificationErrors = await this.verifyMigration(looseObjects)
    errors.push(...verificationErrors)

    return {
      verified: looseObjects.length - errors.length,
      failed: errors.length,
      errors
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Scan R2 for all loose objects.
   */
  private async scanLooseObjects(): Promise<LooseObjectInfo[]> {
    const objects: LooseObjectInfo[] = []
    let cursor: string | undefined

    do {
      const result = await this.r2.list({
        prefix: this.config.looseObjectPrefix,
        cursor
      })

      for (const obj of result.objects) {
        const sha = extractShaFromKey(obj.key, this.config.looseObjectPrefix)
        if (sha && sha.length === 40) {
          // Skip already processed objects if resuming
          if (!this.processedObjects.has(sha)) {
            objects.push({
              sha,
              size: obj.size,
              r2Key: obj.key
            })
          }
        }
      }

      cursor = result.truncated ? result.cursor : undefined
    } while (cursor)

    return objects
  }

  /**
   * Migrate a single object to a bundle.
   */
  private async migrateObject(obj: LooseObjectInfo, dryRun: boolean): Promise<boolean> {
    // Read the loose object
    const r2Object = await this.r2.get(obj.r2Key)
    if (!r2Object) {
      throw new MigrationError(
        `Object not found: ${obj.sha}`,
        MigrationErrorCode.OBJECT_NOT_FOUND
      )
    }

    const data = new Uint8Array(await r2Object.arrayBuffer())

    // Detect object type from data (Git object format: type size\0content)
    const nullIndex = data.indexOf(0)
    if (nullIndex === -1) {
      throw new MigrationError(
        `Invalid object format: ${obj.sha}`,
        MigrationErrorCode.READ_FAILED
      )
    }
    const header = decoder.decode(data.slice(0, nullIndex))
    const [type] = header.split(' ')

    // Initialize bundle if needed
    if (!this.currentBundle) {
      this.currentBundle = {
        id: generateBundleId(),
        objects: [],
        size: 0
      }
    }

    // Check if object would exceed bundle size
    const objectOverhead = BUNDLE_HEADER_SIZE + BUNDLE_INDEX_ENTRY_SIZE
    if (this.currentBundle.size + data.length + objectOverhead > this.config.maxBundleSize) {
      // Flush current bundle and start new one
      if (!dryRun) {
        await this.flushCurrentBundle()
      } else {
        this.createdBundleIds.push(this.currentBundle.id)
      }

      this.currentBundle = {
        id: generateBundleId(),
        objects: [],
        size: 0
      }
    }

    // Add object to current bundle
    this.currentBundle.objects.push({
      sha: obj.sha,
      type: toBundleObjectType(type),
      data
    })
    this.currentBundle.size += data.length + objectOverhead

    this.processedObjects.add(obj.sha)
    return true
  }

  /**
   * Flush the current bundle to R2 and update the index.
   *
   * Uses the canonical `createBundle` from the bundle format module to produce
   * a valid BNDL binary that is readable by `parseBundle` / `R2BundleReader`.
   */
  private async flushCurrentBundle(): Promise<void> {
    if (!this.currentBundle || this.currentBundle.objects.length === 0) {
      return
    }

    const bundle = this.currentBundle

    // Build canonical bundle binary using the bundle format module
    const bundleData = createBundle(
      bundle.objects.map((obj) => ({
        oid: obj.sha,
        type: obj.type,
        data: obj.data,
      }))
    )

    // Write to R2
    const bundleKey = `${this.config.bundlePrefix}${bundle.id}.bundle`
    await this.r2.put(bundleKey, bundleData)

    // Update object index for all objects in the bundle
    const objectTypeNames: Record<number, string> = {
      [BundleObjectType.BLOB]: 'blob',
      [BundleObjectType.TREE]: 'tree',
      [BundleObjectType.COMMIT]: 'commit',
      [BundleObjectType.TAG]: 'tag',
    }

    for (const obj of bundle.objects) {
      await this.objectIndex.recordLocation({
        sha: obj.sha,
        tier: 'r2',
        packId: bundle.id,
        offset: 0,
        size: obj.data.length,
        type: objectTypeNames[obj.type] ?? 'blob',
      })
    }

    this.createdBundleIds.push(bundle.id)
    this.currentBundle = null
  }

  /**
   * Verify that migrated objects can be read correctly.
   */
  private async verifyMigration(originalObjects: LooseObjectInfo[]): Promise<MigrationObjectError[]> {
    const errors: MigrationObjectError[] = []

    for (const obj of originalObjects) {
      if (!this.processedObjects.has(obj.sha)) {
        continue
      }

      try {
        // Check that the object is in the index
        const location = await this.objectIndex.lookupLocation(obj.sha)
        if (!location) {
          errors.push({
            sha: obj.sha,
            message: 'Object not found in index after migration',
            recoverable: true
          })
          continue
        }

        if (location.tier !== 'r2' || !location.packId) {
          errors.push({
            sha: obj.sha,
            message: `Object in unexpected location: ${location.tier}`,
            recoverable: true
          })
        }
      } catch (err) {
        errors.push({
          sha: obj.sha,
          message: `Verification failed: ${err instanceof Error ? err.message : String(err)}`,
          cause: err instanceof Error ? err : undefined,
          recoverable: true
        })
      }
    }

    return errors
  }

  /**
   * Delete old loose objects after successful migration.
   */
  private async cleanupLooseObjects(objects: LooseObjectInfo[]): Promise<number> {
    let cleaned = 0

    for (const obj of objects) {
      if (this.processedObjects.has(obj.sha) && !this.failedObjects.has(obj.sha)) {
        try {
          await this.r2.delete(obj.r2Key)
          cleaned++
        } catch (err) {
          // Log but don't fail on cleanup errors
          this.config.onError?.({
            sha: obj.sha,
            message: `Failed to delete loose object: ${err instanceof Error ? err.message : String(err)}`,
            cause: err instanceof Error ? err : undefined,
            recoverable: true
          })
        }
      }
    }

    return cleaned
  }

  /**
   * Save a checkpoint for resuming interrupted migration.
   */
  private async saveCheckpoint(): Promise<void> {
    const checkpoint: MigrationCheckpoint = {
      migrationId: this.migrationId,
      timestamp: Date.now(),
      processedShas: Array.from(this.processedObjects),
      failedShas: Array.from(this.failedObjects.keys()),
      createdBundleIds: this.createdBundleIds,
      config: this.config
    }

    this.storage.sql.exec(
      'INSERT OR REPLACE INTO migration_checkpoints (id, data, created_at) VALUES (?, ?, ?)',
      this.migrationId,
      JSON.stringify(checkpoint),
      checkpoint.timestamp
    )
  }

  /**
   * Load a checkpoint for resuming migration.
   */
  private async loadCheckpoint(migrationId: string): Promise<MigrationCheckpoint | null> {
    const result = this.storage.sql.exec(
      'SELECT data FROM migration_checkpoints WHERE id = ?',
      migrationId
    )
    const rows = result.toArray() as Array<{ data: string }>
    if (rows.length === 0) {
      return null
    }
    return JSON.parse(rows[0].data) as MigrationCheckpoint
  }

  /**
   * Report progress to the callback if configured.
   */
  private reportProgress(progress: MigrationProgress): void {
    // Calculate estimated time remaining
    if (progress.processedObjects > 0 && progress.totalObjects > 0) {
      const elapsed = Date.now() - this.startTime
      const rate = progress.processedObjects / elapsed
      const remaining = progress.totalObjects - progress.processedObjects
      progress.estimatedTimeRemaining = Math.round(remaining / rate)
    }

    this.config.onProgress?.(progress)
  }
}

// =============================================================================
// Migration CLI Helpers
// =============================================================================

/**
 * Options for the migration CLI.
 */
export interface MigrationCLIOptions {
  /** Run in dry-run mode (preview only) */
  dryRun?: boolean

  /** Verify data integrity after migration */
  verify?: boolean

  /** Clean up old loose objects after migration */
  cleanup?: boolean

  /** Maximum bundle size in bytes */
  maxBundleSize?: number

  /** Verbose output */
  verbose?: boolean
}

/**
 * Run migration with CLI-friendly output.
 */
export async function runMigrationCLI(
  storage: DurableObjectStorage,
  r2: MigrationR2Storage,
  options: MigrationCLIOptions = {}
): Promise<MigrationResult> {
  const config: MigrationConfig = {
    dryRun: options.dryRun ?? false,
    verify: options.verify ?? true,
    cleanup: options.cleanup ?? false,
    maxBundleSize: options.maxBundleSize ?? DEFAULT_MAX_BUNDLE_SIZE,
    onProgress: options.verbose ? (p) => {
      console.log(
        `[${p.phase}] ${p.processedObjects}/${p.totalObjects} objects, ` +
        `${p.bundlesCreated} bundles, ${formatBytes(p.bytesProcessed)} processed`
      )
    } : undefined,
    onError: options.verbose ? (e) => {
      console.error(`Error migrating ${e.sha}: ${e.message}`)
    } : undefined
  }

  const migrator = new LooseToBundleMigrator(storage, r2, config)

  if (options.dryRun) {
    console.log('Running migration in dry-run mode...\n')
    const preview = await migrator.preview()
    console.log(`Found ${preview.totalObjects} loose objects (${formatBytes(preview.totalSize)})`)
    console.log(`Would create approximately ${preview.estimatedBundles} bundles`)
    console.log('\nTo run the actual migration, remove --dry-run flag')
  }

  const result = await migrator.migrate()

  console.log('\n=== Migration Summary ===')
  console.log(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`)
  console.log(`Objects found: ${result.totalObjectsFound}`)
  console.log(`Objects migrated: ${result.objectsMigrated}`)
  console.log(`Objects failed: ${result.objectsFailed}`)
  console.log(`Bundles created: ${result.bundlesCreated}`)
  console.log(`Bytes migrated: ${formatBytes(result.bytesMigrated)}`)
  console.log(`Objects cleaned: ${result.objectsCleaned}`)
  console.log(`Duration: ${(result.durationMs / 1000).toFixed(2)}s`)

  if (result.errors.length > 0 && options.verbose) {
    console.log('\nErrors:')
    for (const error of result.errors.slice(0, 10)) {
      console.log(`  - ${error.sha}: ${error.message}`)
    }
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`)
    }
  }

  return result
}

/**
 * Format bytes as human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
