/**
 * @fileoverview R2 Parquet Object Store
 *
 * Implements the CASBackend interface using R2 Parquet files as the
 * primary storage backend for git objects. All objects are stored as
 * VARIANT-encoded rows in append-only Parquet files on R2.
 *
 * Architecture:
 * - Write path: Objects buffered in memory -> WAL -> flushed as Parquet row groups to R2
 * - Read path: Bloom filter check -> exact SHA cache -> Parquet file scan
 * - Refs: Stored in a separate refs.parquet file, rewritten on update
 *
 * R2 Bucket: gitx-analytics (ANALYTICS_BUCKET binding)
 * Key format: {owner}/{repo}/objects/{uuid}.parquet
 *
 * Lifecycle Management:
 * - Compaction: ParquetStore.compact() merges small files, deletes old ones atomically
 * - Large objects (>1MB): Stored in gitx-objects bucket with storage mode 'r2'
 * - R2 lifecycle policies: See r2-lifecycle-policies.json for cleanup rules
 * - Orphan cleanup: 90-day retention via R2 lifecycle + GarbageCollector
 *
 * @module storage/parquet-store
 */

import { parquetWriteBuffer } from 'hyparquet-writer'
import { parquetReadObjects } from 'hyparquet'
import type { ObjectType } from '../types/objects'
import { isValidSha, isValidObjectType } from '../types/objects'
import type { CASBackend, StoredObjectResult } from './backend'
import {
  encodeObjectBatch,
  detectStorageMode,
  buildR2Key,
  type StorageMode,
} from './variant-codec'

/** Minimal async buffer interface for hyparquet */
interface AsyncBuffer {
  byteLength: number
  slice(start: number, end?: number): ArrayBuffer
}
import { GIT_OBJECTS_SCHEMA } from './parquet-schemas'
import { BloomCache } from './bloom-cache'
import type { SQLStorage } from './types'
import { hashObject } from '../utils/hash'
import { AsyncMutex, ReadWriteLock } from '../utils/async-mutex'
import { type StorageMetrics, NOOP_METRICS } from './metrics'

// ============================================================================
// Write-Ahead Log (WAL)
// ============================================================================

/** SQLite table name for write buffer WAL */
const WRITE_BUFFER_WAL_TABLE = 'write_buffer_wal'

/** WAL entry structure */
interface WALEntry {
  id: number
  sha: string
  type: string
  data: Uint8Array
  path: string | null
  created_at: number
}

// ============================================================================
// Compaction Journal
// ============================================================================

/** SQLite table name for compaction journal */
const COMPACTION_JOURNAL_TABLE = 'compaction_journal'

/** Status values for compaction journal entries */
type CompactionJournalStatus = 'in_progress' | 'written'

interface CompactionJournalEntry {
  id: number
  source_keys: string
  target_key: string
  status: string
  created_at: number
}

// ============================================================================
// Type Guards
// ============================================================================

function isValidStorageMode(s: unknown): s is StorageMode {
  return s === 'inline' || s === 'r2' || s === 'lfs'
}

// ============================================================================
// Constants
// ============================================================================

const encoder = new TextEncoder()

/** Default maximum objects to buffer before flushing to Parquet */
const DEFAULT_FLUSH_THRESHOLD = 1000

/** Default maximum buffer size in bytes before flushing */
const DEFAULT_FLUSH_BYTES_THRESHOLD = 10 * 1024 * 1024 // 10MB

/** Default maximum buffer bytes before back-pressure triggers auto-flush (50MB) */
const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024

/** Default maximum buffer objects before back-pressure triggers auto-flush */
const DEFAULT_MAX_BUFFER_OBJECTS = 10000

// ============================================================================
// Types
// ============================================================================

/**
 * Event emitted after a successful flush of buffered objects to Parquet.
 * Consumers (e.g., Iceberg metadata generators) can react to this event
 * without ParquetStore needing to know about their existence.
 */
export interface FlushEvent {
  /** R2 key of the newly written Parquet file */
  parquetKey: string
  /** Size of the Parquet file in bytes */
  fileSizeBytes: number
  /** Number of records in the Parquet file */
  recordCount: number
  /** R2 bucket reference for writing derived artifacts */
  r2: R2Bucket
  /** Repository prefix in R2 */
  prefix: string
}

/**
 * Callback invoked after each successful flush.
 * Errors thrown by the handler are logged but do not fail the flush.
 */
export type OnFlushHandler = (event: FlushEvent) => Promise<void>

export interface ParquetStoreOptions {
  /** R2 bucket for Parquet files and large objects */
  r2: R2Bucket
  /** SQLite storage for bloom filter and refs */
  sql: SQLStorage
  /** Repository prefix in R2 (e.g., "owner/repo") */
  prefix: string
  /** Flush threshold (number of objects) */
  flushThreshold?: number
  /** Flush threshold (bytes) */
  flushBytesThreshold?: number
  /** Compression codec */
  codec?: 'SNAPPY' | 'LZ4_RAW' | 'UNCOMPRESSED'
  /**
   * Optional callback invoked after each successful flush.
   * Use this to hook in Iceberg metadata generation or other post-flush logic.
   */
  onFlush?: OnFlushHandler
  /**
   * Maximum buffer size in bytes before back-pressure triggers auto-flush.
   * This is a hard limit to prevent unbounded memory growth and OOM.
   * Default: 50MB
   */
  maxBufferBytes?: number
  /**
   * Maximum number of objects in buffer before back-pressure triggers auto-flush.
   * This is a hard limit to prevent unbounded memory growth and OOM.
   * Default: 10000
   */
  maxBufferObjects?: number
  /**
   * When true, verify bloom filter negative results by checking R2 directly.
   * This protects against bloom filter false negatives (which should be rare
   * but could cause missing object errors). If an object is found in R2 that
   * the bloom filter reported as absent, it will be added to the bloom filter
   * for self-healing.
   * @default false
   */
  verifyBloomNegatives?: boolean
  /**
   * Optional metrics interface for observability.
   * If not provided, a no-op implementation is used (zero overhead).
   *
   * @example
   * ```typescript
   * import { ConsoleMetrics } from './metrics'
   * const store = new ParquetStore({
   *   r2, sql, prefix,
   *   metrics: new ConsoleMetrics()
   * })
   * ```
   */
  metrics?: StorageMetrics
}

/** Buffered object awaiting flush to Parquet */
interface BufferedObject {
  sha: string
  type: ObjectType
  data: Uint8Array
  path?: string
}

// ============================================================================
// ParquetStore Class
// ============================================================================

/**
 * R2 Parquet-backed CASBackend for git objects.
 *
 * Objects are written to append-only Parquet files on R2.
 * Reads use a bloom filter for fast existence checks, falling back
 * to R2 Parquet file scanning.
 */
export class ParquetStore implements CASBackend {
  private r2: R2Bucket
  private sql: SQLStorage
  private prefix: string
  private bloomCache: BloomCache
  private buffer: BufferedObject[] = []
  private bufferIndex: Map<string, BufferedObject> = new Map()
  private bufferBytes = 0
  private flushThreshold: number
  private flushBytesThreshold: number
  private maxBufferBytes: number
  private maxBufferObjects: number
  private codec: 'SNAPPY' | 'LZ4_RAW' | 'UNCOMPRESSED'
  private objectFileKeys: string[] = []
  private tombstones: Set<string> = new Set()
  private initPromise?: Promise<void>
  private onFlush: OnFlushHandler | undefined
  private _compactionNeeded = false
  private verifyBloomNegatives: boolean
  /** Track WAL entry IDs for current buffer to clear after flush */
  private walEntryIds: number[] = []
  /**
   * Read-write lock for coordinating compaction with concurrent writes/reads.
   *
   * - putObject, getObject, hasObject, flush: Use read lock (multiple can run concurrently)
   * - compact: Uses write lock (exclusive access)
   *
   * This prevents the race condition where compact() could read stale buffer state
   * or delete Parquet files while other operations are reading from them.
   */
  private rwLock: ReadWriteLock = new ReadWriteLock()
  /**
   * Mutex for serializing flush operations.
   *
   * While the rwLock allows multiple read operations (including flush) to run
   * concurrently, we need to ensure only one flush operation runs at a time.
   * Without this, concurrent flushes could:
   * - Both read the same buffer contents
   * - Both write overlapping Parquet files
   * - Race on clearing WAL entries
   */
  private flushMutex: AsyncMutex = new AsyncMutex()
  /** Metrics interface for observability */
  private metrics: StorageMetrics

  constructor(options: ParquetStoreOptions) {
    this.r2 = options.r2
    this.sql = options.sql
    this.prefix = options.prefix
    this.bloomCache = new BloomCache(options.sql)
    this.flushThreshold = options.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD
    this.flushBytesThreshold = options.flushBytesThreshold ?? DEFAULT_FLUSH_BYTES_THRESHOLD
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
    this.maxBufferObjects = options.maxBufferObjects ?? DEFAULT_MAX_BUFFER_OBJECTS
    this.codec = options.codec ?? 'SNAPPY'
    this.onFlush = options.onFlush
    this.verifyBloomNegatives = options.verifyBloomNegatives ?? false
    this.metrics = options.metrics ?? NOOP_METRICS
  }

  /**
   * Initialize the store (bloom cache, discover existing Parquet files).
   */
  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this._doInitialize()
    }
    return this.initPromise
  }

  private async _doInitialize(): Promise<void> {
    // Create compaction journal table
    this.sql.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${COMPACTION_JOURNAL_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_keys TEXT NOT NULL,
        target_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_progress',
        created_at INTEGER NOT NULL
      );
    `)

    // Create write buffer WAL table for durability
    this.sql.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${WRITE_BUFFER_WAL_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sha TEXT NOT NULL,
        type TEXT NOT NULL,
        data BLOB NOT NULL,
        path TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_write_buffer_wal_sha ON ${WRITE_BUFFER_WAL_TABLE}(sha);
    `)

    await this.bloomCache.initialize()
    // Discover existing object files
    await this.discoverObjectFiles()

    // Recover from any interrupted compaction
    await this.recoverCompaction()

    // Recover any un-flushed WAL entries into the buffer
    await this.recoverWAL()

    // initialization complete
  }

  /**
   * Recover from interrupted compaction by checking the journal.
   *
   * If a journal entry exists with status 'written', the new compacted file
   * was successfully written to R2 but old files were not yet cleaned up.
   * We complete the cleanup (delete old source files).
   *
   * If a journal entry exists with status 'in_progress', the compaction was
   * interrupted before the new file was written. We roll back by deleting
   * the (possibly partial) target file and clearing the journal.
   */
  private async recoverCompaction(): Promise<void> {
    const result = this.sql.sql.exec(
      `SELECT id, source_keys, target_key, status, created_at FROM ${COMPACTION_JOURNAL_TABLE} ORDER BY id ASC`
    )
    const rows = result.toArray() as CompactionJournalEntry[]

    for (const row of rows) {
      const sourceKeys = JSON.parse(row.source_keys) as string[]

      if (row.status === 'written') {
        // Target file was written successfully - complete the cleanup
        // Delete old source files that are no longer needed
        for (const key of sourceKeys) {
          try {
            await this.r2.delete(key)
          } catch (error) {
            // Best-effort cleanup; the key may already be gone
            console.warn(`[ParquetStore] compaction cleanup: failed to delete source key ${key}:`, error instanceof Error ? error.message : String(error))
          }
        }

        // Update in-memory state: keep only the compacted target file
        this.objectFileKeys = this.objectFileKeys.filter(
          k => !sourceKeys.includes(k)
        )
        if (!this.objectFileKeys.includes(row.target_key)) {
          this.objectFileKeys.push(row.target_key)
        }

        // Remove journal entry
        this.sql.sql.exec(
          `DELETE FROM ${COMPACTION_JOURNAL_TABLE} WHERE id = ?`,
          row.id
        )
      } else {
        // status === 'in_progress': compaction was interrupted before write completed
        // Roll back by deleting the (possibly partial) target file
        try {
          await this.r2.delete(row.target_key)
        } catch (error) {
          // Target may not exist if compaction failed before the R2 put
          console.warn(`[ParquetStore] compaction recovery: failed to delete partial target ${row.target_key}:`, error instanceof Error ? error.message : String(error))
        }

        // Remove journal entry - source files are still valid
        this.sql.sql.exec(
          `DELETE FROM ${COMPACTION_JOURNAL_TABLE} WHERE id = ?`,
          row.id
        )
      }
    }
  }

  /**
   * Recover un-flushed WAL entries into the in-memory buffer.
   *
   * Called during initialization to replay any buffered writes that were
   * persisted to WAL but not yet flushed to Parquet. This ensures durability
   * across DO restarts/crashes.
   *
   * Deduplicates by SHA to handle partial recovery scenarios where some
   * objects may have been successfully flushed but WAL wasn't cleared.
   */
  private async recoverWAL(): Promise<void> {
    const result = this.sql.sql.exec(
      `SELECT id, sha, type, data, path, created_at FROM ${WRITE_BUFFER_WAL_TABLE} ORDER BY id ASC`
    )
    const rows = result.toArray() as WALEntry[]

    if (rows.length === 0) return

    // Track SHAs already in buffer to avoid duplicates
    const existingShas = new Set(this.buffer.map(o => o.sha))

    for (const row of rows) {
      // Skip if already in buffer (shouldn't happen normally but handle gracefully)
      if (existingShas.has(row.sha)) {
        this.walEntryIds.push(row.id)
        continue
      }

      // Validate object type
      if (!isValidObjectType(row.type as string)) {
        console.warn(`[ParquetStore] WAL recovery: skipping invalid type ${row.type} for SHA ${row.sha}`)
        // Delete invalid WAL entry
        this.sql.sql.exec(`DELETE FROM ${WRITE_BUFFER_WAL_TABLE} WHERE id = ?`, row.id)
        continue
      }

      // Convert data to Uint8Array if needed
      const data = row.data instanceof Uint8Array
        ? row.data
        : new Uint8Array(row.data as ArrayBufferLike)

      // Add to buffer
      const buffObj = {
        sha: row.sha,
        type: row.type,
        data,
        path: row.path ?? undefined,
      }
      this.buffer.push(buffObj)
      this.bufferIndex.set(row.sha, buffObj)
      this.bufferBytes += data.length
      this.walEntryIds.push(row.id)
      existingShas.add(row.sha)
    }

    if (rows.length > 0) {
      console.log(`[ParquetStore] WAL recovery: replayed ${rows.length} entries into buffer`)
    }
  }

  /**
   * List existing Parquet object files in R2.
   */
  private async discoverObjectFiles(): Promise<void> {
    const listed = await this.r2.list({ prefix: `${this.prefix}/objects/` })
    this.objectFileKeys = listed.objects.map(o => o.key)
  }

  // ===========================================================================
  // StorageBackend: CAS Operations
  // ===========================================================================

  async putObject(type: ObjectType, data: Uint8Array, path?: string): Promise<string> {
    const startTime = performance.now()
    await this.initialize()

    // Use read lock - multiple writes can happen concurrently, but not during compaction
    return this.rwLock.withReadLock(async () => {
      const sha = await hashObject(type, data)
      const storage = detectStorageMode(type, data)

      // If R2 or LFS, upload raw data to R2
      if (storage === 'r2' || storage === 'lfs') {
        const r2Key = buildR2Key(sha, `${this.prefix}/raw`)
        await this.r2.put(r2Key, data)
      }

      // Persist to WAL BEFORE accepting the write for durability
      // This ensures the write survives crashes before being flushed to Parquet
      const now = Date.now()
      this.sql.sql.exec(
        `INSERT INTO ${WRITE_BUFFER_WAL_TABLE} (sha, type, data, path, created_at) VALUES (?, ?, ?, ?, ?)`,
        sha, type, data, path ?? null, now
      )

      // Get the WAL entry ID for later cleanup after flush
      const walIdResult = this.sql.sql.exec(
        `SELECT id FROM ${WRITE_BUFFER_WAL_TABLE} WHERE sha = ? AND created_at = ? ORDER BY id DESC LIMIT 1`,
        sha, now
      )
      const walIdRows = walIdResult.toArray() as Array<{ id: number }>
      if (walIdRows[0]) {
        this.walEntryIds.push(walIdRows[0].id)
      }

      // Buffer the object for Parquet write
      const buffObj2 = { sha, type, data, path }
      this.buffer.push(buffObj2)
      this.bufferIndex.set(sha, buffObj2)
      this.bufferBytes += data.length

      // Register in bloom cache
      await this.bloomCache.add(sha, type, data.length)

      // Record write metric
      const latencyMs = performance.now() - startTime
      this.metrics.recordObjectWrite(sha, data.length, 'buffer', latencyMs, type)

      // Check if flush is needed - we'll do it outside the lock to avoid deadlock
      const needsFlush = this.buffer.length >= this.flushThreshold || this.bufferBytes >= this.flushBytesThreshold
      const needsBackPressure = this.bufferBytes >= this.maxBufferBytes || this.buffer.length >= this.maxBufferObjects

      return { sha, needsFlush: needsFlush || needsBackPressure }
    }).then(async (result) => {
      // Perform flush outside the read lock to avoid deadlock with compaction
      // The data is already safely persisted in WAL
      if (result.needsFlush) {
        await this.flush()
      }
      return result.sha
    })
  }

  // ===========================================================================
  // Back-pressure
  // ===========================================================================

  async getObject(sha: string): Promise<StoredObjectResult | null> {
    // Validate SHA format - return null for invalid SHAs (graceful handling)
    if (!isValidSha(sha)) {
      return null
    }

    const startTime = performance.now()
    await this.initialize()

    // Use read lock - multiple reads can happen concurrently, but not during compaction
    return this.rwLock.withReadLock(async () => {
      // Check tombstones first
      if (this.tombstones.has(sha)) return null

      // Check in-memory buffer FIRST (before bloom filter)
      // This is critical for WAL recovery - recovered objects may not be in bloom cache yet
      const buffered = this.bufferIndex.get(sha)
      if (buffered) {
        this.metrics.recordCacheHit(sha, 'buffer')
        const latencyMs = performance.now() - startTime
        this.metrics.recordObjectRead(sha, 'buffer', latencyMs, buffered.type, buffered.data.length)
        return { type: buffered.type, content: buffered.data }
      }

      // Check bloom filter for persisted objects
      const check = await this.bloomCache.check(sha)
      if (check === 'absent') {
        this.metrics.recordCacheMiss(sha, 'bloom')
        return null
      }

      // Record bloom/exact cache result
      if (check === 'definite') {
        this.metrics.recordCacheHit(sha, 'exact')
      } else {
        this.metrics.recordCacheHit(sha, 'bloom')
      }

      // Scan Parquet files in reverse order (newest first)
      for (let i = this.objectFileKeys.length - 1; i >= 0; i--) {
        const key = this.objectFileKeys[i]
        if (!key) continue
        const result = await this.readObjectFromParquet(key, sha)
        if (result) {
          // Promote bloom-probable SHAs to exact cache after confirmed R2 read
          if (check === 'probable') {
            await this.bloomCache.add(sha, result.type, result.content.byteLength)
          }
          const latencyMs = performance.now() - startTime
          this.metrics.recordObjectRead(sha, 'parquet', latencyMs, result.type, result.content.byteLength)
          return result
        }
      }

      return null
    })
  }

  async hasObject(sha: string): Promise<boolean> {
    // Validate SHA format - return false for invalid SHAs (graceful handling)
    if (!isValidSha(sha)) {
      return false
    }

    await this.initialize()

    // Use read lock - multiple checks can happen concurrently, but not during compaction
    return this.rwLock.withReadLock(async () => {
      // Check tombstones first
      if (this.tombstones.has(sha)) return false

      // Check bloom filter
      const check = await this.bloomCache.check(sha)
      if (check === 'definite') return true

      // Check buffer
      if (this.buffer.some(o => o.sha === sha)) return true

      // Bloom filter says absent - optionally verify with R2 to catch false negatives
      if (check === 'absent') {
        if (this.verifyBloomNegatives) {
          const result = await this.checkR2ExistsInternal(sha)
          if (result) {
            // Self-heal: add to bloom filter so future lookups are faster
            await this.bloomCache.add(sha, result.type, result.content.byteLength)
            return true
          }
        }
        return false
      }

      // Bloom says probable - full check requires scanning Parquet files
      // Note: We call getObjectInternal to avoid nested lock acquisition
      const obj = await this.getObjectInternal(sha, check)
      return obj !== null
    })
  }

  /**
   * Internal getObject implementation that doesn't acquire the lock.
   * Used by hasObject to avoid nested lock acquisition.
   */
  private async getObjectInternal(sha: string, bloomCheck: 'definite' | 'probable' | 'absent'): Promise<StoredObjectResult | null> {
    // Check tombstones first
    if (this.tombstones.has(sha)) return null

    // Check in-memory buffer FIRST
    const buffered = this.buffer.find(o => o.sha === sha)
    if (buffered) {
      return { type: buffered.type, content: buffered.data }
    }

    if (bloomCheck === 'absent') {
      return null
    }

    // Scan Parquet files in reverse order (newest first)
    for (let i = this.objectFileKeys.length - 1; i >= 0; i--) {
      const key = this.objectFileKeys[i]
      if (!key) continue
      const result = await this.readObjectFromParquet(key, sha)
      if (result) {
        // Promote bloom-probable SHAs to exact cache after confirmed R2 read
        if (bloomCheck === 'probable') {
          await this.bloomCache.add(sha, result.type, result.content.byteLength)
        }
        return result
      }
    }

    return null
  }

  /**
   * Check if an object exists in R2 by scanning Parquet files.
   * Used as a fallback when bloom filter says absent but we want to verify.
   * Returns the object result if found, null otherwise.
   * Internal version that doesn't acquire the lock - must be called within a lock.
   */
  private async checkR2ExistsInternal(sha: string): Promise<StoredObjectResult | null> {
    // Check in-memory buffer first
    const buffered = this.buffer.find(o => o.sha === sha)
    if (buffered) {
      return { type: buffered.type, content: buffered.data }
    }

    // Scan Parquet files in reverse order (newest first)
    for (let i = this.objectFileKeys.length - 1; i >= 0; i--) {
      const key = this.objectFileKeys[i]
      if (!key) continue
      const result = await this.readObjectFromParquet(key, sha)
      if (result) {
        return result
      }
    }

    return null
  }

  async deleteObject(sha: string): Promise<void> {
    // Parquet files are append-only. Mark SHA as tombstoned.
    // Tombstoned SHAs are excluded during compaction.
    this.tombstones.add(sha)
    // Remove from buffer if present
    this.buffer = this.buffer.filter(o => o.sha !== sha)
    // Also remove from WAL to prevent recovery of deleted objects
    this.sql.sql.exec(
      `DELETE FROM ${WRITE_BUFFER_WAL_TABLE} WHERE sha = ?`,
      sha
    )
  }

  // ===========================================================================
  // Flush & Write
  // ===========================================================================

  /**
   * Flush buffered objects to a new Parquet file on R2.
   *
   * WAL entries are cleared ONLY after the Parquet file is successfully
   * written to R2. If the flush fails, WAL entries remain for recovery.
   *
   * Uses a mutex to prevent concurrent flush operations which could cause
   * race conditions (multiple flushes reading the same buffer, writing
   * overlapping files, or racing on WAL entry cleanup).
   */
  async flush(): Promise<string | null> {
    if (this.buffer.length === 0) return null

    const startTime = performance.now()
    await this.initialize()

    // Use flush mutex to serialize flush operations
    // This prevents concurrent flushes from reading the same buffer contents
    return this.flushMutex.withLock(async () => {
      // Use read lock - flush can run concurrently with other operations, but not during compaction
      return this.rwLock.withReadLock(async () => {
        // Re-check after acquiring locks (buffer may have been drained by another flush)
        if (this.buffer.length === 0) return null

        const objects = this.buffer
        const walIds = [...this.walEntryIds]
        this.buffer = []
        this.bufferIndex.clear()
        this.bufferBytes = 0
        this.walEntryIds = []

        const batch = encodeObjectBatch(objects, { r2Prefix: `${this.prefix}/raw` })

        const buffer = parquetWriteBuffer({
          codec: this.codec,
          schema: GIT_OBJECTS_SCHEMA,
          columnData: [
            { name: 'sha', data: batch.shas },
            { name: 'type', data: batch.types },
            { name: 'size', data: batch.sizes },
            { name: 'storage', data: batch.storages },
            { name: 'variant_metadata', data: batch.variantData.map(v => v.metadata) },
            { name: 'variant_value', data: batch.variantData.map(v => v.value) },
            { name: 'raw_data', data: objects.map(o => detectStorageMode(o.type, o.data) === 'inline' ? o.data : null) },
            { name: 'path', data: batch.paths },
            // Shredded commit fields
            { name: 'author_name', data: batch.commitFields.map(f => f?.author_name ?? null) },
            { name: 'author_date', data: batch.commitFields.map(f => f?.author_date != null ? BigInt(f.author_date) : null) },
            { name: 'message', data: batch.commitFields.map(f => f?.message ?? null) },
          ],
        })

        // Generate a deterministic key from the sorted SHAs so re-flushing the
        // same buffer produces the same R2 key (idempotent).
        const sortedShas = objects.map(o => o.sha).sort()
        const shaDigest = await crypto.subtle.digest(
          'SHA-256',
          encoder.encode(sortedShas.join(''))
        )
        const fileId = Array.from(new Uint8Array(shaDigest.slice(0, 16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
        const key = `${this.prefix}/objects/${fileId}.parquet`
        await this.r2.put(key, buffer)
        if (!this.objectFileKeys.includes(key)) {
          this.objectFileKeys.push(key)
        }

        // Clear WAL entries AFTER successful R2 write
        // This ensures durability - if R2 write fails, WAL entries remain for retry
        if (walIds.length > 0) {
          // Use batch delete for efficiency
          const placeholders = walIds.map(() => '?').join(',')
          this.sql.sql.exec(
            `DELETE FROM ${WRITE_BUFFER_WAL_TABLE} WHERE id IN (${placeholders})`,
            ...walIds
          )
        }

        // Persist bloom filter
        await this.bloomCache.persist()

        // Record flush metric
        const latencyMs = performance.now() - startTime
        this.metrics.recordFlush(objects.length, buffer.byteLength, latencyMs)

        // Invoke post-flush handler (e.g., Iceberg metadata generation)
        if (this.onFlush) {
          try {
            await this.onFlush({
              parquetKey: key,
              fileSizeBytes: buffer.byteLength,
              recordCount: objects.length,
              r2: this.r2,
              prefix: this.prefix,
            })
          } catch (err) {
            console.error('[ParquetStore] onFlush handler failed:', err)
          }
        }

        return key
      })
    })
  }

  // ===========================================================================
  // Compaction
  // ===========================================================================

  /**
   * Compact multiple Parquet files into a single file.
   *
   * Reads all objects from existing Parquet files, excludes tombstoned SHAs,
   * deduplicates by SHA, and writes a single merged Parquet file.
   * Old files are deleted from R2 after the new file is written.
   *
   * Uses write lock for exclusive access - no other operations can run during compaction.
   * This prevents race conditions where:
   * - putObject could add objects to buffer while compaction reads it
   * - getObject could read from Parquet files being deleted
   * - flush could create new Parquet files during compaction
   *
   * @returns The key of the new compacted file, or null if no compaction needed
   */
  async compact(): Promise<string | null> {
    const startTime = performance.now()
    await this.initialize()

    // Use write lock - compaction needs exclusive access to prevent races
    return this.rwLock.withWriteLock(async () => {
      if (this.objectFileKeys.length < 2) return null
      const sourceFileCount = this.objectFileKeys.length

      // Generate target key upfront so we can journal it
      const fileId = crypto.randomUUID()
      const newKey = `${this.prefix}/objects/${fileId}.parquet`
      const sourceKeys = [...this.objectFileKeys]

      // Write journal entry BEFORE starting compaction
      const now = Date.now()
      this.sql.sql.exec(
        `INSERT INTO ${COMPACTION_JOURNAL_TABLE} (source_keys, target_key, status, created_at) VALUES (?, ?, ?, ?)`,
        JSON.stringify(sourceKeys),
        newKey,
        'in_progress' satisfies CompactionJournalStatus,
        now,
      )
      // Get the journal entry ID for later updates
      const journalResult = this.sql.sql.exec(
        `SELECT id FROM ${COMPACTION_JOURNAL_TABLE} WHERE target_key = ? AND created_at = ?`,
        newKey, now,
      )
      const journalRows = journalResult.toArray() as Array<{ id: number }>
      const journalId = journalRows[0]?.id

      // Read all rows from all Parquet files
      const allObjects: BufferedObject[] = []
      const seenShas = new Set<string>()

      for (const key of this.objectFileKeys) {
        const r2Obj = await this.r2.get(key)
        if (!r2Obj) continue

        const arrayBuffer = await r2Obj.arrayBuffer()
        const file: AsyncBuffer = {
          byteLength: arrayBuffer.byteLength,
          slice(start: number, end?: number) {
            return arrayBuffer.slice(start, end)
          },
        }

        try {
          const rows = await parquetReadObjects({
            file,
            columns: ['sha', 'type', 'storage', 'raw_data'],
            rowFormat: 'object',
          })

          for (const row of rows) {
            const sha = row['sha'] as string
            // Skip tombstoned and duplicate SHAs
            if (this.tombstones.has(sha) || seenShas.has(sha)) continue
            seenShas.add(sha)

            const rawType = row['type'] as string
            const rawStorage = row['storage']
            if (!isValidObjectType(rawType) || !isValidStorageMode(rawStorage)) continue
            const type = rawType
            const storage = rawStorage
            const rawData = row['raw_data']

            if (storage === 'inline' && rawData != null) {
              const data = rawData instanceof Uint8Array
                ? rawData
                : typeof rawData === 'string'
                  ? encoder.encode(rawData)
                  : new Uint8Array(rawData as ArrayBuffer)
              allObjects.push({ sha, type, data })
            } else {
              // For R2/LFS objects, fetch from raw storage
              const r2Key = buildR2Key(sha, `${this.prefix}/raw`)
              const rawObj = await this.r2.get(r2Key)
              if (rawObj) {
                const data = new Uint8Array(await rawObj.arrayBuffer())
                allObjects.push({ sha, type, data })
              }
            }
          }
        } catch (error) {
          // Skip unreadable files but log for debugging
          console.warn(`[ParquetStore] compaction: failed to read parquet file ${key}:`, error instanceof Error ? error.message : String(error))
        }
      }

      if (allObjects.length === 0) {
        // Nothing to compact - clean up journal
        if (journalId != null) {
          this.sql.sql.exec(
            `DELETE FROM ${COMPACTION_JOURNAL_TABLE} WHERE id = ?`,
            journalId,
          )
        }
        return null
      }

      // Also include any buffered objects
      for (const obj of this.buffer) {
        if (!this.tombstones.has(obj.sha) && !seenShas.has(obj.sha)) {
          allObjects.push(obj)
          seenShas.add(obj.sha)
        }
      }

      // Write the compacted file
      const batch = encodeObjectBatch(allObjects, { r2Prefix: `${this.prefix}/raw` })

      const buffer = parquetWriteBuffer({
        codec: this.codec,
        schema: GIT_OBJECTS_SCHEMA,
        columnData: [
          { name: 'sha', data: batch.shas },
          { name: 'type', data: batch.types },
          { name: 'size', data: batch.sizes },
          { name: 'storage', data: batch.storages },
          { name: 'variant_metadata', data: batch.variantData.map(v => v.metadata) },
          { name: 'variant_value', data: batch.variantData.map(v => v.value) },
          { name: 'raw_data', data: allObjects.map(o => detectStorageMode(o.type, o.data) === 'inline' ? o.data : null) },
          { name: 'path', data: batch.paths },
          { name: 'author_name', data: batch.commitFields.map(f => f?.author_name ?? null) },
          { name: 'author_date', data: batch.commitFields.map(f => f?.author_date != null ? BigInt(f.author_date) : null) },
          { name: 'message', data: batch.commitFields.map(f => f?.message ?? null) },
        ],
      })

      await this.r2.put(newKey, buffer)

      // Mark journal as 'written' - target file is safe on R2
      if (journalId != null) {
        this.sql.sql.exec(
          `UPDATE ${COMPACTION_JOURNAL_TABLE} SET status = ? WHERE id = ?`,
          'written' satisfies CompactionJournalStatus,
          journalId,
        )
      }

      // Delete old files from R2
      for (const key of sourceKeys) {
        await this.r2.delete(key)
      }

      // Update state
      this.objectFileKeys = [newKey]
      this.buffer = []
      this.bufferBytes = 0
      this.tombstones.clear()

      // Persist bloom filter
      await this.bloomCache.persist()

      // Record compaction metric
      const latencyMs = performance.now() - startTime
      this.metrics.recordCompaction(sourceFileCount, allObjects.length, buffer.byteLength, latencyMs)

      // Compaction fully complete - delete journal entry
      if (journalId != null) {
        this.sql.sql.exec(
          `DELETE FROM ${COMPACTION_JOURNAL_TABLE} WHERE id = ?`,
          journalId,
        )
      }

      return newKey
    })
  }

  // ===========================================================================
  // Read from Parquet
  // ===========================================================================

  /**
   * Read a specific object from a Parquet file.
   *
   * Uses hyparquet's parquetQuery with predicate pushdown on the SHA column
   * to efficiently locate the matching row without scanning the entire file.
   */
  private async readObjectFromParquet(
    key: string,
    sha: string
  ): Promise<StoredObjectResult | null> {
    // Fetch the Parquet file from R2
    const r2Obj = await this.r2.get(key)
    if (!r2Obj) return null

    const arrayBuffer = await r2Obj.arrayBuffer()
    const file: AsyncBuffer = {
      byteLength: arrayBuffer.byteLength,
      slice(start: number, end?: number) {
        return arrayBuffer.slice(start, end)
      },
    }

    // Read all rows from Parquet file and filter by SHA
    // parquetReadObjects is simpler and more reliable than parquetQuery across environments
    let allRows: Record<string, unknown>[]
    try {
      allRows = await parquetReadObjects({
        file,
        columns: ['sha', 'type', 'storage', 'raw_data'],
        rowFormat: 'object',
      })
    } catch (_err) {
      // If parquetRead fails, fall back to raw R2 lookup
      allRows = []
    }

    const row = allRows.find(r => r['sha'] === sha)
    if (!row) return null

    const rawType = row['type'] as string
    const rawStorage = row['storage']
    if (!isValidObjectType(rawType) || !isValidStorageMode(rawStorage)) return null
    const type = rawType
    const storage = rawStorage
    const rawData = row['raw_data']

    // Handle inline storage mode - raw_data contains the object bytes
    if (storage === 'inline' && rawData != null) {
      const content = rawData instanceof Uint8Array
        ? rawData
        : typeof rawData === 'string'
          ? encoder.encode(rawData)
          : new Uint8Array(rawData as ArrayBufferLike)
      return { type, content }
    }

    // For r2/lfs storage, fetch from raw R2
    const r2Key = buildR2Key(sha, `${this.prefix}/raw`)
    const rawObj = await this.r2.get(r2Key)
    if (rawObj) {
      const data = new Uint8Array(await rawObj.arrayBuffer())
      return { type, content: data }
    }

    return null
  }

  // ===========================================================================
  // Alarm-Based Compaction Scheduling
  // ===========================================================================

  /**
   * Check whether compaction has been scheduled but not yet executed.
   */
  get compactionNeeded(): boolean {
    return this._compactionNeeded
  }

  /**
   * Mark that compaction should be performed in the next alarm cycle.
   *
   * This does NOT run compaction inline. The caller (typically the DO)
   * is responsible for setting an alarm via `state.storage.setAlarm()`
   * after calling this method.
   *
   * Compaction is only meaningful when there are multiple Parquet files
   * to merge, so this is a no-op if fewer than 2 files exist.
   *
   * @returns true if compaction was scheduled, false if not needed
   */
  scheduleCompaction(): boolean {
    if (this.objectFileKeys.length < 2 && this.buffer.length === 0) {
      return false
    }
    this._compactionNeeded = true
    return true
  }

  /**
   * Run compaction if it has been scheduled via `scheduleCompaction()`.
   *
   * Called by the DO alarm handler. Resets the compaction flag regardless
   * of outcome so alarms don't loop indefinitely.
   *
   * @returns The key of the new compacted file, or null if no compaction was performed
   */
  async runCompactionIfNeeded(): Promise<string | null> {
    if (!this._compactionNeeded) return null
    this._compactionNeeded = false
    return this.compact()
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get store statistics.
   */
  getStats(): {
    bufferedObjects: number
    bufferedBytes: number
    parquetFiles: number
    bloom: ReturnType<BloomCache['getStats']>
  } {
    return {
      bufferedObjects: this.buffer.length,
      bufferedBytes: this.bufferBytes,
      parquetFiles: this.objectFileKeys.length,
      bloom: this.bloomCache.getStats(),
    }
  }

  /** Access bloom cache for external use */
  getBloomCache(): BloomCache {
    return this.bloomCache
  }
}
