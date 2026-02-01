/**
 * @fileoverview Push Transaction / Unit-of-Work for Atomic Push Operations
 *
 * Provides a lightweight saga pattern that ensures push operations (writing
 * objects + updating refs) have proper transaction boundaries.
 *
 * The key insight is that orphaned R2/SQLite objects are harmless because they
 * are content-addressed and can be garbage-collected later. The critical
 * invariant is: **refs must never point to objects that don't exist**.
 *
 * Transaction phases:
 * 1. **Buffer** - Objects are buffered in memory during packfile unpacking
 * 2. **Flush** - Objects are written to storage (R2/SQLite). If this fails,
 *    no refs are updated and the push fails cleanly.
 * 3. **Update Refs** - Refs are updated in SQLite within a transaction.
 *    If this fails, orphaned objects may exist but are harmless.
 * 4. **Cleanup** - On ref update failure, orphaned object SHAs are recorded
 *    for eventual garbage collection.
 *
 * @module storage/push-transaction
 */

import type { ObjectType } from '../types/objects'
import type { DurableObjectStorage } from '../do/schema'

// ============================================================================
// Types
// ============================================================================

/** A buffered object awaiting flush during a push transaction. */
export interface BufferedPushObject {
  sha: string
  type: ObjectType
  data: Uint8Array
}

/** A ref update command within a push transaction. */
export interface RefUpdateCommand {
  refName: string
  oldSha: string
  newSha: string
}

/** Result of a single ref update. */
export interface RefUpdateResult {
  refName: string
  success: boolean
  error?: string
}

/** Overall result of a push transaction. */
export interface PushTransactionResult {
  success: boolean
  refResults: RefUpdateResult[]
  /** SHAs of objects that were written but whose ref updates failed (orphaned). */
  orphanedShas: string[]
}

/**
 * Delegate interface for object storage operations.
 *
 * This abstracts over SqliteObjectStore / ParquetStore so PushTransaction
 * doesn't need to know about the concrete storage implementation.
 */
export interface ObjectStorageDelegate {
  /** Store an object and return its SHA. */
  putObject(type: ObjectType, data: Uint8Array): Promise<string>
  /** Check if an object exists. */
  hasObject(sha: string): Promise<boolean>
}

/**
 * Optional delegate for scheduling cleanup of orphaned objects.
 * If not provided, orphaned SHAs are logged but not cleaned up.
 */
export interface OrphanCleanupDelegate {
  /** Schedule cleanup of orphaned objects (e.g., via DO alarm). */
  scheduleOrphanCleanup(shas: string[]): void
}

/** Transaction phase for tracking progress. */
export type TransactionPhase =
  | 'idle'
  | 'buffering'
  | 'flushing'
  | 'updating_refs'
  | 'completed'
  | 'failed'

// ============================================================================
// PushTransaction Class
// ============================================================================

/**
 * A unit-of-work for push operations that coordinates object writes
 * and ref updates with proper failure semantics.
 *
 * Usage:
 * ```typescript
 * const tx = new PushTransaction(storage, objectStore)
 * tx.bufferObject(sha, 'commit', data)
 * tx.bufferObject(sha2, 'tree', data2)
 * const result = await tx.execute(commands)
 * ```
 */
export class PushTransaction {
  private storage: DurableObjectStorage
  private objectStore: ObjectStorageDelegate
  private orphanCleanup?: OrphanCleanupDelegate
  private buffer: BufferedPushObject[] = []
  private flushedShas: string[] = []
  private _phase: TransactionPhase = 'idle'

  constructor(
    storage: DurableObjectStorage,
    objectStore: ObjectStorageDelegate,
    orphanCleanup?: OrphanCleanupDelegate
  ) {
    this.storage = storage
    this.objectStore = objectStore
    this.orphanCleanup = orphanCleanup
  }

  /** Current transaction phase. */
  get phase(): TransactionPhase {
    return this._phase
  }

  /** Number of buffered objects. */
  get bufferedCount(): number {
    return this.buffer.length
  }

  /** Total buffered bytes. */
  get bufferedBytes(): number {
    return this.buffer.reduce((sum, obj) => sum + obj.data.length, 0)
  }

  // ==========================================================================
  // Phase 1: Buffer
  // ==========================================================================

  /**
   * Buffer an object for writing during the flush phase.
   *
   * Objects are held in memory until `execute()` is called.
   * Duplicate SHAs are silently deduplicated.
   */
  bufferObject(sha: string, type: ObjectType, data: Uint8Array): void {
    if (this._phase !== 'idle' && this._phase !== 'buffering') {
      throw new Error(
        `Cannot buffer objects in phase '${this._phase}'. Transaction must be in 'idle' or 'buffering' phase.`
      )
    }
    this._phase = 'buffering'

    // Deduplicate by SHA (content-addressed, so same SHA = same content)
    if (!this.buffer.some((obj) => obj.sha === sha)) {
      this.buffer.push({ sha, type, data })
    }
  }

  // ==========================================================================
  // Phase 2 + 3 + 4: Execute (Flush + Update Refs + Cleanup)
  // ==========================================================================

  /**
   * Execute the push transaction: flush objects, then update refs.
   *
   * This method orchestrates the full transaction lifecycle:
   * 1. Flush all buffered objects to storage
   * 2. Update refs in SQLite with compare-and-swap semantics
   * 3. On failure, schedule cleanup of orphaned objects
   *
   * @param commands - Ref update commands to apply after objects are flushed
   * @returns Transaction result with per-ref outcomes and orphaned SHAs
   */
  async execute(commands: RefUpdateCommand[]): Promise<PushTransactionResult> {
    const ZERO_SHA = '0000000000000000000000000000000000000000'

    // Phase 2: Flush objects to storage
    this._phase = 'flushing'
    try {
      await this.flushObjects()
    } catch (error) {
      this._phase = 'failed'
      const msg = error instanceof Error ? error.message : 'flush failed'
      return {
        success: false,
        refResults: commands.map((cmd) => ({
          refName: cmd.refName,
          success: false,
          error: `object flush failed: ${msg}`,
        })),
        orphanedShas: [],
      }
    }

    // Phase 3: Update refs atomically
    this._phase = 'updating_refs'
    const refResults: RefUpdateResult[] = []
    const failedRefShas: string[] = []

    for (const cmd of commands) {
      try {
        const isDelete = cmd.newSha === ZERO_SHA
        const isCreate = cmd.oldSha === ZERO_SHA

        // For non-delete operations, verify the target object exists
        if (!isDelete) {
          const exists = await this.objectStore.hasObject(cmd.newSha)
          if (!exists) {
            refResults.push({
              refName: cmd.refName,
              success: false,
              error: `target object ${cmd.newSha} not found`,
            })
            continue
          }
        }

        // Compare-and-swap within a SQLite transaction
        this.storage.sql.exec('BEGIN TRANSACTION')
        try {
          const existing = this.storage.sql.exec(
            'SELECT target FROM refs WHERE name = ?',
            cmd.refName
          ).toArray() as { target: string }[]
          const currentSha =
            existing.length > 0 ? existing[0]!.target : ZERO_SHA

          // Verify old SHA matches
          if (currentSha !== cmd.oldSha) {
            this.storage.sql.exec('ROLLBACK')
            refResults.push({
              refName: cmd.refName,
              success: false,
              error: isCreate
                ? 'lock failed: ref already exists'
                : 'lock failed: ref has been updated',
            })
            // Track that the new SHA's objects might be orphaned
            if (!isDelete) {
              failedRefShas.push(cmd.newSha)
            }
            continue
          }

          // Apply the update
          if (isDelete) {
            this.storage.sql.exec(
              'DELETE FROM refs WHERE name = ?',
              cmd.refName
            )
          } else {
            this.storage.sql.exec(
              'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
              cmd.refName,
              cmd.newSha.toLowerCase(),
              'sha',
              Date.now()
            )
          }

          this.storage.sql.exec('COMMIT')
          refResults.push({ refName: cmd.refName, success: true })
        } catch (txError) {
          try {
            this.storage.sql.exec('ROLLBACK')
          } catch {
            // Rollback may fail if transaction was already rolled back
          }
          throw txError
        }
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : 'ref update failed'
        refResults.push({ refName: cmd.refName, success: false, error: msg })
        if (cmd.newSha !== ZERO_SHA) {
          failedRefShas.push(cmd.newSha)
        }
      }
    }

    const allSuccess = refResults.every((r) => r.success)

    // Phase 4: If any ref updates failed, identify orphaned objects
    // Objects are only truly orphaned if ALL ref updates for them failed
    // and no existing ref already points to them.
    const orphanedShas = this.identifyOrphanedShas(refResults, commands)

    if (orphanedShas.length > 0) {
      console.warn(
        `[PushTransaction] ${orphanedShas.length} potentially orphaned objects after ref update failures:`,
        orphanedShas
      )
      if (this.orphanCleanup) {
        this.orphanCleanup.scheduleOrphanCleanup(orphanedShas)
      }
    }

    this._phase = allSuccess ? 'completed' : 'failed'

    return {
      success: allSuccess,
      refResults,
      orphanedShas,
    }
  }

  // ==========================================================================
  // Internal: Flush
  // ==========================================================================

  /**
   * Flush all buffered objects to the object store.
   * Objects are content-addressed, so writing them is idempotent.
   */
  private async flushObjects(): Promise<void> {
    for (const obj of this.buffer) {
      // Skip objects that already exist (idempotent writes)
      const exists = await this.objectStore.hasObject(obj.sha)
      if (!exists) {
        await this.objectStore.putObject(obj.type, obj.data)
      }
      this.flushedShas.push(obj.sha)
    }
  }

  // ==========================================================================
  // Internal: Orphan Identification
  // ==========================================================================

  /**
   * Identify SHAs that were flushed but whose ref updates all failed.
   *
   * A SHA is considered orphaned only if it was part of a failed ref update
   * and no successful ref update also references it. This is conservative:
   * some objects may be reachable from other refs but we don't walk the
   * full object graph here. GC will handle the rest.
   */
  private identifyOrphanedShas(
    results: RefUpdateResult[],
    commands: RefUpdateCommand[]
  ): string[] {
    const ZERO_SHA = '0000000000000000000000000000000000000000'

    // Collect SHAs referenced by successful ref updates
    const successShas = new Set<string>()
    for (let i = 0; i < results.length; i++) {
      if (results[i]!.success && commands[i]!.newSha !== ZERO_SHA) {
        successShas.add(commands[i]!.newSha)
      }
    }

    // Collect SHAs referenced by failed ref updates that aren't in success set
    const orphaned = new Set<string>()
    for (let i = 0; i < results.length; i++) {
      if (!results[i]!.success && commands[i]!.newSha !== ZERO_SHA) {
        if (!successShas.has(commands[i]!.newSha)) {
          orphaned.add(commands[i]!.newSha)
        }
      }
    }

    // Only include SHAs that we actually flushed in this transaction
    return [...orphaned].filter((sha) => this.flushedShas.includes(sha))
  }
}
