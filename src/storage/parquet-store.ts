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

import { parquetWriteBuffer, encodeVariant } from 'hyparquet-writer'
import { parquetReadObjects } from 'hyparquet'
import type { AsyncBuffer } from 'hyparquet'
import type { ObjectType } from '../types/objects'
import type { StorageBackend, StoredObjectResult } from './backend'
import type { Ref } from '../refs/storage'
import {
  encodeGitObject,
  encodeObjectBatch,
  detectStorageMode,
  buildR2Key,
  INLINE_THRESHOLD,
  type StorageMode,
  type EncodedGitObject,
} from './variant-codec'
import { BloomCache } from './bloom-cache'
import type { DurableObjectStorage } from '../do/schema'
import { hashObject } from '../utils/hash'

// ============================================================================
// Constants
// ============================================================================

/** Maximum objects to buffer before flushing to Parquet */
const FLUSH_THRESHOLD = 1000

/** Maximum buffer size in bytes before flushing */
const FLUSH_BYTES_THRESHOLD = 10 * 1024 * 1024 // 10MB

// ============================================================================
// Types
// ============================================================================

export interface ParquetStoreOptions {
  /** R2 bucket for Parquet files and large objects */
  r2: R2Bucket
  /** SQLite storage for bloom filter and refs */
  sql: DurableObjectStorage
  /** Repository prefix in R2 (e.g., "owner/repo") */
  prefix: string
  /** Flush threshold (number of objects) */
  flushThreshold?: number
  /** Flush threshold (bytes) */
  flushBytesThreshold?: number
  /** Compression codec */
  codec?: 'SNAPPY' | 'LZ4_RAW' | 'UNCOMPRESSED'
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

  constructor(options: ParquetStoreOptions) {
    this.r2 = options.r2
    this.prefix = options.prefix
    this.bloomCache = new BloomCache(options.sql)
    this.flushThreshold = options.flushThreshold ?? FLUSH_THRESHOLD
    this.flushBytesThreshold = options.flushBytesThreshold ?? FLUSH_BYTES_THRESHOLD
    this.codec = options.codec ?? 'SNAPPY'
  }

  /**
   * Initialize the store (bloom cache, discover existing Parquet files).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
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

    // Check metadata cache for type info
    const meta = await this.bloomCache.getMetadata(sha)

    // Scan Parquet files in reverse order (newest first)
    for (let i = this.objectFileKeys.length - 1; i >= 0; i--) {
      const result = await this.readObjectFromParquet(this.objectFileKeys[i], sha)
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

    return key
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
          const sha = row.sha as string
          // Skip tombstoned and duplicate SHAs
          if (this.tombstones.has(sha) || seenShas.has(sha)) continue
          seenShas.add(sha)

          const type = row.type as ObjectType
          const storage = row.storage as string

          if (storage === 'inline' && row.raw_data != null) {
            const data = row.raw_data instanceof Uint8Array
              ? row.raw_data
              : typeof row.raw_data === 'string'
                ? new TextEncoder().encode(row.raw_data)
                : new Uint8Array(row.raw_data)
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
    let allRows: Record<string, any>[]
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

    const row = allRows.find(r => r.sha === sha)
    if (!row) return null

    const type = row.type as ObjectType
    const storage = row.storage as StorageMode

    // Handle inline storage mode - raw_data contains the object bytes
    if (storage === 'inline' && row.raw_data != null) {
      const content = row.raw_data instanceof Uint8Array
        ? row.raw_data
        : typeof row.raw_data === 'string'
          ? new TextEncoder().encode(row.raw_data)
          : new Uint8Array(row.raw_data)
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
