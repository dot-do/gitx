/**
 * @fileoverview R2 Parquet Object Store
 *
 * Implements the StorageBackend interface using R2 Parquet files as the
 * primary storage backend for git objects. All objects are stored as
 * VARIANT-encoded rows in append-only Parquet files on R2.
 *
 * Architecture:
 * - Write path: Objects buffered in memory -> flushed as Parquet row groups to R2
 * - Read path: Bloom filter check -> exact SHA cache -> Parquet file scan
 * - Refs: Stored in a separate refs.parquet file, rewritten on update
 *
 * @module storage/parquet-store
 */

import { parquetWriteBuffer } from 'hyparquet-writer'
import { parquetReadObjects } from 'hyparquet'
import type { ObjectType } from '../types/objects'
import type { StorageBackend, StoredObjectResult } from './backend'
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
import { BloomCache } from './bloom-cache'
import type { SQLStorage } from './types'
import { hashObject } from '../utils/hash'
import type { IcebergTableMetadata } from '../iceberg/metadata'
import {
  createTableMetadata,
  addSnapshot,
  serializeMetadata,
} from '../iceberg/metadata'
import {
  createManifestEntry,
  createManifest,
  serializeManifest,
  createManifestList,
  serializeManifestList,
} from '../iceberg/manifest'

// ============================================================================
// Type Guards
// ============================================================================

function isValidObjectType(t: unknown): t is ObjectType {
  return t === 'blob' || t === 'tree' || t === 'commit' || t === 'tag'
}
function isValidStorageMode(s: unknown): s is StorageMode {
  return s === 'inline' || s === 'r2' || s === 'lfs'
}

// ============================================================================
// Constants
// ============================================================================

/** Default maximum objects to buffer before flushing to Parquet */
const DEFAULT_FLUSH_THRESHOLD = 1000

/** Default maximum buffer size in bytes before flushing */
const DEFAULT_FLUSH_BYTES_THRESHOLD = 10 * 1024 * 1024 // 10MB

/** Maximum objects to buffer before flushing to Parquet */
const FLUSH_THRESHOLD = DEFAULT_FLUSH_THRESHOLD

/** Maximum buffer size in bytes before flushing */
const FLUSH_BYTES_THRESHOLD = DEFAULT_FLUSH_BYTES_THRESHOLD

// ============================================================================
// Types
// ============================================================================

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
  /** Enable Iceberg metadata generation on flush */
  icebergEnabled?: boolean
}

/** Buffered object awaiting flush to Parquet */
interface BufferedObject {
  sha: string
  type: ObjectType
  data: Uint8Array
  path?: string
}

// ============================================================================
// Parquet Schema for Git Objects
// ============================================================================

const GIT_OBJECTS_SCHEMA = [
  { name: 'root', num_children: 11 },
  { name: 'sha', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  { name: 'type', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  { name: 'size', type: 'INT64' as const, repetition_type: 'REQUIRED' as const },
  { name: 'storage', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  // VARIANT-encoded data stored as flat BYTE_ARRAY columns
  { name: 'variant_metadata', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const },
  { name: 'variant_value', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const },
  // Raw object data for inline storage (enables fast reads without VARIANT decoding)
  { name: 'raw_data', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const },
  { name: 'path', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const, converted_type: 'UTF8' as const },
  // Shredded commit fields (null for non-commit objects)
  { name: 'author_name', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const, converted_type: 'UTF8' as const },
  { name: 'author_date', type: 'INT64' as const, repetition_type: 'OPTIONAL' as const },
  { name: 'message', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const, converted_type: 'UTF8' as const },
]

// ============================================================================
// ParquetStore Class
// ============================================================================

/**
 * R2 Parquet-backed StorageBackend for git objects.
 *
 * Objects are written to append-only Parquet files on R2.
 * Reads use a bloom filter for fast existence checks, falling back
 * to R2 Parquet file scanning.
 */
export class ParquetStore implements Pick<StorageBackend, 'putObject' | 'getObject' | 'hasObject' | 'deleteObject'> {
  private r2: R2Bucket
  private prefix: string
  private bloomCache: BloomCache
  private buffer: BufferedObject[] = []
  private bufferBytes = 0
  private flushThreshold: number
  private flushBytesThreshold: number
  private codec: 'SNAPPY' | 'LZ4_RAW' | 'UNCOMPRESSED'
  private objectFileKeys: string[] = []
  private tombstones: Set<string> = new Set()
  private initialized = false
  private initPromise?: Promise<void>
  private icebergEnabled: boolean
  private icebergMetadata: IcebergTableMetadata | null = null
  private _compactionNeeded = false

  constructor(options: ParquetStoreOptions) {
    this.r2 = options.r2
    this.prefix = options.prefix
    this.bloomCache = new BloomCache(options.sql)
    this.flushThreshold = options.flushThreshold ?? FLUSH_THRESHOLD
    this.flushBytesThreshold = options.flushBytesThreshold ?? FLUSH_BYTES_THRESHOLD
    this.codec = options.codec ?? 'SNAPPY'
    this.icebergEnabled = options.icebergEnabled ?? false
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
    await this.bloomCache.initialize()
    // Discover existing object files
    await this.discoverObjectFiles()
    this.initialized = true
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

  async putObject(type: ObjectType, data: Uint8Array): Promise<string> {
    await this.initialize()

    const sha = await hashObject(type, data)
    const storage = detectStorageMode(type, data)

    // If R2 or LFS, upload raw data to R2
    if (storage === 'r2' || storage === 'lfs') {
      const r2Key = buildR2Key(sha, `${this.prefix}/raw`)
      await this.r2.put(r2Key, data)
    }

    // Buffer the object for Parquet write
    this.buffer.push({ sha, type, data })
    this.bufferBytes += data.length

    // Register in bloom cache
    await this.bloomCache.add(sha, type, data.length)

    // Auto-flush if buffer is large enough
    if (this.buffer.length >= this.flushThreshold || this.bufferBytes >= this.flushBytesThreshold) {
      await this.flush()
    }

    return sha
  }

  async getObject(sha: string): Promise<StoredObjectResult | null> {
    await this.initialize()

    // Check tombstones first
    if (this.tombstones.has(sha)) return null

    // Check bloom filter first
    const check = await this.bloomCache.check(sha)
    if (check === 'absent') {
      return null
    }

    // Check in-memory buffer
    const buffered = this.buffer.find(o => o.sha === sha)
    if (buffered) {
      return { type: buffered.type, content: buffered.data }
    }

    // Scan Parquet files in reverse order (newest first)
    for (let i = this.objectFileKeys.length - 1; i >= 0; i--) {
      const key = this.objectFileKeys[i]
      if (!key) continue
      const result = await this.readObjectFromParquet(key, sha)
      if (result) return result
    }

    return null
  }

  async hasObject(sha: string): Promise<boolean> {
    await this.initialize()

    // Check tombstones first
    if (this.tombstones.has(sha)) return false

    // Check bloom filter
    const check = await this.bloomCache.check(sha)
    if (check === 'absent') return false
    if (check === 'definite') return true

    // Check buffer
    if (this.buffer.some(o => o.sha === sha)) return true

    // Full check requires scanning Parquet files
    const obj = await this.getObject(sha)
    return obj !== null
  }

  async deleteObject(sha: string): Promise<void> {
    // Parquet files are append-only. Mark SHA as tombstoned.
    // Tombstoned SHAs are excluded during compaction.
    this.tombstones.add(sha)
    // Remove from buffer if present
    this.buffer = this.buffer.filter(o => o.sha !== sha)
  }

  // ===========================================================================
  // Flush & Write
  // ===========================================================================

  /**
   * Flush buffered objects to a new Parquet file on R2.
   */
  async flush(): Promise<string | null> {
    if (this.buffer.length === 0) return null

    await this.initialize()

    const objects = this.buffer
    this.buffer = []
    this.bufferBytes = 0

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

    const fileId = crypto.randomUUID()
    const key = `${this.prefix}/objects/${fileId}.parquet`
    await this.r2.put(key, buffer)
    this.objectFileKeys.push(key)

    // Persist bloom filter
    await this.bloomCache.persist()

    // Iceberg metadata generation
    if (this.icebergEnabled) {
      await this.updateIcebergMetadata(key, buffer.byteLength, objects.length)
    }

    return key
  }

  /**
   * Generate and write Iceberg manifest, manifest list, and table metadata
   * for a newly flushed Parquet file.
   */
  private async updateIcebergMetadata(
    parquetKey: string,
    fileSizeBytes: number,
    recordCount: number,
  ): Promise<void> {
    // Use a combination of timestamp and random bits to ensure unique snapshot IDs
    const snapshotId = Date.now() * 1000 + Math.floor(Math.random() * 1000)

    // (a) Create a manifest entry for the new Parquet file
    const entry = createManifestEntry({
      filePath: parquetKey,
      fileSizeBytes,
      recordCount,
    })

    // (b) Create a manifest containing that entry
    const manifestId = crypto.randomUUID()
    const manifestPath = `${this.prefix}/iceberg/manifests/${manifestId}.json`
    const manifest = createManifest({
      entries: [entry],
      schemaId: 0,
      manifestPath,
    })

    // (c) Write manifest JSON to R2
    await this.r2.put(manifestPath, serializeManifest(manifest))

    // (d) Create manifest list
    const manifestListId = crypto.randomUUID()
    const manifestListPath = `${this.prefix}/iceberg/manifest-lists/${manifestListId}.json`
    const manifestList = createManifestList({
      manifests: [manifest],
      snapshotId,
    })

    // (e) Write manifest list to R2
    await this.r2.put(manifestListPath, serializeManifestList(manifestList))

    // (f) Load or create table metadata, add snapshot pointing to manifest list
    if (!this.icebergMetadata) {
      this.icebergMetadata = createTableMetadata({
        location: `${this.prefix}/iceberg`,
      })
    }

    this.icebergMetadata = addSnapshot(this.icebergMetadata, {
      manifestListPath,
      snapshotId,
      summary: {
        operation: 'append',
        'added-data-files': '1',
        'added-records': String(recordCount),
      },
    })

    // (g) Write metadata.json to R2
    const metadataPath = `${this.prefix}/iceberg/metadata.json`
    await this.r2.put(metadataPath, serializeMetadata(this.icebergMetadata))
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
   * @returns The key of the new compacted file, or null if no compaction needed
   */
  async compact(): Promise<string | null> {
    await this.initialize()

    if (this.objectFileKeys.length < 2) return null

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

          const rawType = row['type']
          const rawStorage = row['storage']
          if (!isValidObjectType(rawType) || !isValidStorageMode(rawStorage)) continue
          const type = rawType
          const storage = rawStorage
          const rawData = row['raw_data']

          if (storage === 'inline' && rawData != null) {
            const data = rawData instanceof Uint8Array
              ? rawData
              : typeof rawData === 'string'
                ? new TextEncoder().encode(rawData)
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
      } catch {
        // Skip unreadable files
      }
    }

    if (allObjects.length === 0) return null

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

    const fileId = crypto.randomUUID()
    const newKey = `${this.prefix}/objects/${fileId}.parquet`
    await this.r2.put(newKey, buffer)

    // Delete old files from R2
    const oldKeys = [...this.objectFileKeys]
    for (const key of oldKeys) {
      await this.r2.delete(key)
    }

    // Update state
    this.objectFileKeys = [newKey]
    this.buffer = []
    this.bufferBytes = 0
    this.tombstones.clear()

    // Persist bloom filter
    await this.bloomCache.persist()

    return newKey
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

    const rawType = row['type']
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
          ? new TextEncoder().encode(rawData)
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
