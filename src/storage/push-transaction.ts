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
import type { DurableObjectStorage } from './types'
import type { RefLog, RefLogEntry } from '../delta/ref-log'
import type { BranchProtectionRule, RefUpdateForProtection } from '../do/branch-protection'
import { checkBranchProtection } from '../do/branch-protection'

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

/**
 * Options for configuring PushTransaction behavior.
 */
export interface PushTransactionOptions {
  /** Optional delegate for scheduling cleanup of orphaned objects. */
  orphanCleanup?: OrphanCleanupDelegate
  /** Optional RefLog for atomic logging of ref changes. */
  refLog?: RefLog
  /** Optional branch protection rules to enforce during ref updates. */
  branchProtectionRules?: BranchProtectionRule[]
  /**
   * Maximum buffer size in bytes. When the buffer exceeds this limit,
   * bufferObject() will throw a BufferOverflowError.
   *
   * Default: Infinity (no limit)
   */
  maxBufferBytes?: number
}

/**
 * Error thrown when the buffer size limit is exceeded.
 */
export class BufferOverflowError extends Error {
  /** Current buffer size in bytes */
  readonly currentBytes: number
  /** Maximum allowed buffer size in bytes */
  readonly maxBytes: number
  /** Size of the object that triggered the overflow */
  readonly objectBytes: number

  constructor(currentBytes: number, maxBytes: number, objectBytes: number) {
    super(
      `Buffer overflow: adding ${objectBytes} bytes would exceed limit ` +
        `(current: ${currentBytes}, max: ${maxBytes})`
    )
    this.name = 'BufferOverflowError'
    this.currentBytes = currentBytes
    this.maxBytes = maxBytes
    this.objectBytes = objectBytes
  }
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
  private refLog?: RefLog
  private branchProtectionRules: BranchProtectionRule[]
  private maxBufferBytes: number
  private buffer: BufferedPushObject[] = []
  private flushedShas: string[] = []
  private _phase: TransactionPhase = 'idle'
  /** RefLog entries staged during transaction, rolled back on failure */
  private pendingRefLogEntries: RefLogEntry[] = []

  /**
   * Create a new PushTransaction.
   *
   * @param storage - Durable Object storage for SQLite operations
   * @param objectStore - Delegate for object storage operations
   * @param optionsOrCleanup - Either PushTransactionOptions or legacy OrphanCleanupDelegate
   */
  constructor(
    storage: DurableObjectStorage,
    objectStore: ObjectStorageDelegate,
    optionsOrCleanup?: PushTransactionOptions | OrphanCleanupDelegate
  ) {
    this.storage = storage
    this.objectStore = objectStore
    this.branchProtectionRules = []
    this.maxBufferBytes = Infinity

    // Support both new options interface and legacy single-argument cleanup delegate
    if (optionsOrCleanup) {
      if ('scheduleOrphanCleanup' in optionsOrCleanup) {
        // Legacy: direct OrphanCleanupDelegate
        this.orphanCleanup = optionsOrCleanup
      } else {
        // New: PushTransactionOptions
        this.orphanCleanup = optionsOrCleanup.orphanCleanup
        this.refLog = optionsOrCleanup.refLog
        this.branchProtectionRules = optionsOrCleanup.branchProtectionRules ?? []
        if (optionsOrCleanup.maxBufferBytes !== undefined) {
          this.maxBufferBytes = optionsOrCleanup.maxBufferBytes
        }
      }
    }
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
   *
   * @throws {BufferOverflowError} If adding the object would exceed maxBufferBytes
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
      // Check buffer size limit before adding
      const currentBytes = this.bufferedBytes
      if (currentBytes + data.length > this.maxBufferBytes) {
        throw new BufferOverflowError(currentBytes, this.maxBufferBytes, data.length)
      }
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
   * 2. Update refs in SQLite within a SINGLE transaction (atomic)
   * 3. On failure, the entire transaction is rolled back
   * 4. On success, schedule cleanup of any orphaned objects
   *
   * The key invariant is: **all ref updates succeed or none do**.
   * This ensures push operations are truly atomic.
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

    // Handle empty commands case - no transaction needed
    if (commands.length === 0) {
      this._phase = 'completed'
      return {
        success: true,
        refResults: [],
        orphanedShas: [],
      }
    }

    // Phase 3: Update refs atomically in a SINGLE transaction
    // All refs are validated and updated together - if any fail, all are rolled back
    this._phase = 'updating_refs'
    const refResults: RefUpdateResult[] = []
    const failedRefShas: string[] = []

    // Pre-validation: Check branch protection rules before any writes
    if (this.branchProtectionRules.length > 0) {
      for (const cmd of commands) {
        const update: RefUpdateForProtection = {
          refName: cmd.refName,
          oldSha: cmd.oldSha,
          newSha: cmd.newSha,
          // Force push detection: non-create, non-delete updates where old != new
          // The caller can provide more accurate force-push info via options in the future
          isForcePush: false,
        }
        const check = checkBranchProtection(update, this.branchProtectionRules)
        if (!check.allowed) {
          this._phase = 'failed'
          return {
            success: false,
            refResults: commands.map((c) => ({
              refName: c.refName,
              success: false,
              error: c.refName === cmd.refName
                ? check.reason ?? 'branch protection check failed'
                : 'atomic push failed: branch protection violation on another ref',
            })),
            orphanedShas: [],
          }
        }
      }
    }

    // Pre-validation: Check that all target objects exist before starting transaction
    for (const cmd of commands) {
      const isDelete = cmd.newSha === ZERO_SHA
      if (!isDelete) {
        const exists = await this.objectStore.hasObject(cmd.newSha)
        if (!exists) {
          // Object validation failed - fail the entire push
          this._phase = 'failed'
          return {
            success: false,
            refResults: commands.map((c) => ({
              refName: c.refName,
              success: false,
              error: c.refName === cmd.refName
                ? `target object ${cmd.newSha} not found`
                : 'atomic push failed: validation error on another ref',
            })),
            orphanedShas: [],
          }
        }
      }
    }

    // Begin the atomic transaction for ALL ref updates
    this.storage.sql.exec('BEGIN TRANSACTION')
    try {
      // Validate all refs first (within the transaction for consistency)
      const validationErrors: Map<string, string> = new Map()

      for (const cmd of commands) {
        const isDelete = cmd.newSha === ZERO_SHA
        const isCreate = cmd.oldSha === ZERO_SHA

        const existing = this.storage.sql.exec(
          'SELECT target FROM refs WHERE name = ?',
          cmd.refName
        ).toArray() as { target: string }[]
        const currentSha =
          existing.length > 0 ? existing[0]!.target : ZERO_SHA

        // Verify old SHA matches
        if (currentSha !== cmd.oldSha) {
          validationErrors.set(
            cmd.refName,
            isCreate
              ? 'lock failed: ref already exists'
              : 'lock failed: ref has been updated'
          )
          if (!isDelete) {
            failedRefShas.push(cmd.newSha)
          }
        }
      }

      // If any validation failed, rollback and report all as failed
      if (validationErrors.size > 0) {
        this.storage.sql.exec('ROLLBACK')
        this._phase = 'failed'

        // Mark all refs as failed (atomic semantics)
        for (const cmd of commands) {
          const specificError = validationErrors.get(cmd.refName)
          refResults.push({
            refName: cmd.refName,
            success: false,
            error: specificError || 'atomic push failed: validation error on another ref',
          })
        }

        const orphanedShas = this.identifyOrphanedShas(refResults, commands)
        if (orphanedShas.length > 0 && this.orphanCleanup) {
          console.warn(
            `[PushTransaction] ${orphanedShas.length} potentially orphaned objects after atomic push failure:`,
            orphanedShas
          )
          this.orphanCleanup.scheduleOrphanCleanup(orphanedShas)
        }

        return {
          success: false,
          refResults,
          orphanedShas,
        }
      }

      // All validations passed - apply all updates
      const txTimestamp = Date.now()
      for (const cmd of commands) {
        const isDelete = cmd.newSha === ZERO_SHA

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
            txTimestamp
          )
        }
        refResults.push({ refName: cmd.refName, success: true })

        // Stage RefLog entry (committed after SQLite transaction succeeds)
        if (this.refLog) {
          // For RefLog, empty string means deletion; for git protocol, ZERO_SHA means deletion
          const logOldSha = cmd.oldSha === ZERO_SHA ? '' : cmd.oldSha
          const logNewSha = cmd.newSha === ZERO_SHA ? '' : cmd.newSha
          const entry = this.refLog.append(cmd.refName, logOldSha, logNewSha, txTimestamp)
          this.pendingRefLogEntries.push(entry)
        }
      }

      // Commit the entire transaction
      this.storage.sql.exec('COMMIT')
    } catch (txError) {
      // Transaction error - rollback everything
      try {
        this.storage.sql.exec('ROLLBACK')
      } catch (rollbackError) {
        // Rollback may fail if transaction was already rolled back
        console.debug('[PushTransaction] rollback failed (may already be rolled back):', rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
      }

      // Rollback any RefLog entries that were staged
      this.rollbackRefLogEntries()

      this._phase = 'failed'
      const msg = txError instanceof Error ? txError.message : 'transaction failed'

      // Mark all refs as failed
      const failedResults = commands.map((cmd) => ({
        refName: cmd.refName,
        success: false,
        error: `atomic push failed: ${msg}`,
      }))
      const orphanedShas = this.identifyOrphanedShas(failedResults, commands)

      if (orphanedShas.length > 0 && this.orphanCleanup) {
        console.warn(
          `[PushTransaction] ${orphanedShas.length} potentially orphaned objects after transaction error:`,
          orphanedShas
        )
        this.orphanCleanup.scheduleOrphanCleanup(orphanedShas)
      }

      return {
        success: false,
        refResults: failedResults,
        orphanedShas,
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

  // ==========================================================================
  // Internal: RefLog Rollback
  // ==========================================================================

  /**
   * Roll back RefLog entries that were staged during this transaction.
   * Called when the SQLite transaction fails to ensure RefLog stays consistent.
   */
  private rollbackRefLogEntries(): void {
    if (!this.refLog || this.pendingRefLogEntries.length === 0) {
      return
    }

    // Find the minimum version among pending entries and roll back from there
    const minVersion = Math.min(...this.pendingRefLogEntries.map(e => e.version))
    const removed = this.refLog.rollback(minVersion)

    if (removed > 0) {
      console.debug(
        `[PushTransaction] Rolled back ${removed} RefLog entries from version ${minVersion}`
      )
    }

    // Clear pending entries
    this.pendingRefLogEntries = []
  }

  // ==========================================================================
  // Public: RefLog Entries (for testing/inspection)
  // ==========================================================================

  /**
   * Get the RefLog entries that were committed as part of this transaction.
   * Only populated after a successful execute() call.
   */
  get refLogEntries(): ReadonlyArray<RefLogEntry> {
    return this.pendingRefLogEntries
  }
}
