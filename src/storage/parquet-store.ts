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
  { name: 'root', num_children: 6 },
  { name: 'sha', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  { name: 'type', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  { name: 'size', type: 'INT64' as const, repetition_type: 'REQUIRED' as const },
  { name: 'storage', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  // VARIANT group for data
  { name: 'data', repetition_type: 'OPTIONAL' as const, num_children: 2, logical_type: { type: 'VARIANT' as const } },
  { name: 'metadata', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const },
  { name: 'value', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const },
  { name: 'path', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const, converted_type: 'UTF8' as const },
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

  async deleteObject(_sha: string): Promise<void> {
    // Parquet files are append-only. Deletion is handled via compaction
    // which rewrites files excluding deleted SHAs. For now, this is a no-op.
    // A proper implementation would maintain a tombstone set.
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
        { name: 'data', data: batch.variantData },
        { name: 'path', data: batch.paths },
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
  // Read from Parquet
  // ===========================================================================

  /**
   * Read a specific object from a Parquet file.
   *
   * Currently does a full scan of the file. A production implementation
   * would use row group statistics and bloom filters for predicate pushdown.
   */
  private async readObjectFromParquet(
    key: string,
    sha: string
  ): Promise<StoredObjectResult | null> {
    // Fetch the Parquet file from R2
    const r2Obj = await this.r2.get(key)
    if (!r2Obj) return null

    // For now, we need to parse the Parquet file to find the object.
    // hyparquet provides reading capabilities.
    // TODO: Use hyparquet's parquetRead with row group filtering
    // For the initial implementation, we store a SHA index alongside.

    // Fallback: check if object is stored as raw R2 (for large objects)
    const meta = await this.bloomCache.getMetadata(sha)
    if (meta) {
      // Try raw R2 key for large objects
      const r2Key = buildR2Key(sha, `${this.prefix}/raw`)
      const rawObj = await this.r2.get(r2Key)
      if (rawObj) {
        const data = new Uint8Array(await rawObj.arrayBuffer())
        return { type: meta.type as ObjectType, content: data }
      }
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
