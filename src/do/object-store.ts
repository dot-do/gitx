/**
 * @fileoverview Git Object Store for Durable Objects
 *
 * This module provides a Git object storage implementation backed by SQLite
 * within Cloudflare Durable Objects. It handles CRUD operations for all four
 * Git object types (blob, tree, commit, tag) with proper SHA-1 hash computation.
 *
 * **Key Features**:
 * - Content-addressable storage using SHA-1 hashes
 * - Write-ahead logging (WAL) for durability
 * - Object index for tiered storage support
 * - Batch operations for efficiency with transaction support
 * - LRU caching for hot tier objects
 * - Metrics and logging infrastructure
 * - Typed accessors for each Git object type
 *
 * @module durable-object/object-store
 *
 * @example
 * ```typescript
 * import { ObjectStore } from './durable-object/object-store'
 *
 * const store = new ObjectStore(durableObjectStorage, {
 *   cacheMaxCount: 1000,
 *   cacheMaxBytes: 50 * 1024 * 1024, // 50MB
 *   enableMetrics: true
 * })
 *
 * // Store a blob
 * const content = new TextEncoder().encode('Hello, World!')
 * const sha = await store.putObject('blob', content)
 *
 * // Retrieve it (cached on second access)
 * const obj = await store.getObject(sha)
 * console.log(obj?.type, obj?.size)
 *
 * // Get typed object
 * const blob = await store.getBlobObject(sha)
 *
 * // Get metrics
 * const metrics = store.getMetrics()
 * console.log(`Cache hit rate: ${metrics.cacheHitRate}%`)
 * ```
 */

import { DurableObjectStorage } from './schema'
import { LRUCache, CacheStats } from '../storage/lru-cache'
import {
  ObjectType,
  BlobObject,
  TreeObject,
  CommitObject,
  TagObject,
  TreeEntry,
  Author
} from '../types/objects'

import { hashObject, HashCache } from '../utils/hash'
import {
  assertValidTreeEntries,
  sortTreeEntries,
  serializeTreeEntries,
  parseTreeEntries
} from '../utils/tree'
import type { StorageBackend } from '../storage/backend'

// ============================================================================
// Constants
// ============================================================================

/**
 * Size threshold for streaming blob operations (1MB).
 * Blobs larger than this will be handled with streaming APIs.
 */
const LARGE_BLOB_THRESHOLD = 1024 * 1024

/**
 * Chunk size for streaming operations (64KB).
 */
const STREAM_CHUNK_SIZE = 64 * 1024

/**
 * Chunk size for blob storage (2MB).
 * DO SQLite charges per row read/write, not per-byte.
 * By chunking large blobs into 2MB segments, we optimize storage costs.
 * Objects >= BLOB_CHUNK_SIZE will be chunked.
 */
export const BLOB_CHUNK_SIZE = 2 * 1024 * 1024 // 2MB

/**
 * Prefix for chunked blob storage keys.
 * Chunks are stored as: __chunked_blob__{sha}:{chunkIndex}
 */
const CHUNKED_BLOB_PREFIX = '__chunked_blob__'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Stored object record as persisted in SQLite.
 *
 * @description
 * Represents a Git object with metadata as stored in the database.
 * The `data` field contains the object content WITHOUT the Git header.
 *
 * @example
 * ```typescript
 * const obj: StoredObject = {
 *   sha: 'abc123...',
 *   type: 'blob',
 *   size: 13,
 *   data: new Uint8Array([...]),
 *   createdAt: 1704067200000
 * }
 * ```
 */
export interface StoredObject {
  /** 40-character SHA-1 hash (primary key) */
  sha: string
  /** Object type: 'blob', 'tree', 'commit', or 'tag' */
  type: ObjectType
  /** Size of the data in bytes */
  size: number
  /** Raw object content (without Git header) */
  data: Uint8Array
  /** Unix timestamp (milliseconds) when object was created */
  createdAt: number
}

/**
 * Configuration options for ObjectStore.
 *
 * @description
 * Controls caching behavior, metrics collection, and logging.
 *
 * @example
 * ```typescript
 * const options: ObjectStoreOptions = {
 *   cacheMaxCount: 1000,
 *   cacheMaxBytes: 50 * 1024 * 1024,
 *   cacheTTL: 3600000,
 *   enableMetrics: true,
 *   logger: console
 * }
 * ```
 */
export interface ObjectStoreOptions {
  /**
   * Maximum number of objects to cache in memory.
   * @default 500
   */
  cacheMaxCount?: number

  /**
   * Maximum cache size in bytes.
   * @default 25MB
   */
  cacheMaxBytes?: number

  /**
   * Time-to-live for cached objects in milliseconds.
   * @default undefined (no expiration)
   */
  cacheTTL?: number

  /**
   * Enable metrics collection.
   * @default false
   */
  enableMetrics?: boolean

  /**
   * Logger interface for operation logging.
   * @default undefined (no logging)
   */
  logger?: ObjectStoreLogger

  /**
   * Optional storage backend abstraction.
   * If provided, delegates CAS operations to this backend instead of SQLite.
   * This enables gradual migration to different storage implementations.
   * @default undefined (uses SQLite directly)
   */
  backend?: StorageBackend
}

/**
 * Logger interface for ObjectStore operations.
 */
export interface ObjectStoreLogger {
  debug?(message: string, ...args: unknown[]): void
  info?(message: string, ...args: unknown[]): void
  warn?(message: string, ...args: unknown[]): void
  error?(message: string, ...args: unknown[]): void
}

/**
 * Metrics collected by ObjectStore operations.
 */
export interface ObjectStoreMetrics {
  /** Total number of read operations */
  reads: number
  /** Total number of write operations */
  writes: number
  /** Total number of delete operations */
  deletes: number
  /** Cache statistics */
  cache: CacheStats
  /** Cache hit rate percentage */
  cacheHitRate: number
  /** Total bytes written */
  bytesWritten: number
  /** Total bytes read */
  bytesRead: number
  /** Average write latency in ms */
  avgWriteLatencyMs: number
  /** Average read latency in ms */
  avgReadLatencyMs: number
  /** Number of batch operations */
  batchOperations: number
  /** Total objects in batch operations */
  batchObjectsTotal: number
  /** Hash cache statistics */
  hashCache: {
    hits: number
    misses: number
    size: number
    hitRate: number
  }
  /** Large blob operations (> 1MB) */
  largeBlobOperations: number
  /** Total large blob bytes processed */
  largeBlobBytes: number
  /** Number of streaming operations */
  streamingOperations: number
  /** Object type breakdown */
  objectsByType: {
    blob: number
    tree: number
    commit: number
    tag: number
  }
}

/**
 * Streaming blob chunk for processing large blobs.
 *
 * @description
 * Used with streaming APIs to process large blobs in chunks
 * without loading the entire blob into memory.
 */
export interface BlobChunk {
  /** Chunk data */
  data: Uint8Array
  /** Offset in the original blob */
  offset: number
  /** Total size of the blob */
  totalSize: number
  /** Whether this is the last chunk */
  isLast: boolean
}

/**
 * Result of a streaming blob read operation.
 */
export interface StreamingBlobResult {
  /** 40-character SHA-1 hash */
  sha: string
  /** Total size of the blob */
  size: number
  /** Async iterator over blob chunks */
  chunks: AsyncIterable<BlobChunk>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Default cache configuration
const DEFAULT_CACHE_MAX_COUNT = 500
const DEFAULT_CACHE_MAX_BYTES = 25 * 1024 * 1024 // 25MB

// ============================================================================
// ObjectStore Class
// ============================================================================

/**
 * ObjectStore class for managing Git objects in SQLite storage.
 *
 * @description
 * Provides a complete implementation of Git object storage operations.
 * All objects are stored in the `objects` table and indexed in `object_index`
 * for tiered storage support. Write operations are logged to WAL for durability.
 *
 * @example
 * ```typescript
 * const store = new ObjectStore(durableObjectStorage)
 *
 * // Create a commit
 * const commitSha = await store.putCommitObject({
 *   tree: treeSha,
 *   parents: [parentSha],
 *   author: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   committer: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Initial commit'
 * })
 *
 * // Read it back
 * const commit = await store.getCommitObject(commitSha)
 * console.log(commit?.message)
 * ```
 */
export class ObjectStore {
  private cache: LRUCache<string, StoredObject>
  private hashCache: HashCache
  private options: ObjectStoreOptions
  private logger?: ObjectStoreLogger
  private backend: StorageBackend | null

  // Metrics tracking
  private _reads = 0
  private _writes = 0
  private _deletes = 0
  private _bytesWritten = 0
  private _bytesRead = 0
  private _totalWriteLatency = 0
  private _totalReadLatency = 0
  private _batchOperations = 0
  private _batchObjectsTotal = 0
  private _largeBlobOperations = 0
  private _largeBlobBytes = 0
  private _streamingOperations = 0
  private _objectsByType = { blob: 0, tree: 0, commit: 0, tag: 0 }

  /**
   * Create a new ObjectStore.
   *
   * @param storage - Durable Object storage interface with SQL support
   * @param options - Configuration options for caching, metrics, logging, and backend
   *
   * @example
   * ```typescript
   * // Basic usage (SQLite backend)
   * const store = new ObjectStore(storage)
   *
   * // With caching and metrics
   * const store = new ObjectStore(storage, {
   *   cacheMaxCount: 1000,
   *   cacheMaxBytes: 50 * 1024 * 1024,
   *   enableMetrics: true,
   *   logger: console
   * })
   *
   * // With StorageBackend abstraction
   * const store = new ObjectStore(storage, {
   *   backend: fsBackend
   * })
   * ```
   */
  constructor(
    private storage: DurableObjectStorage,
    options?: ObjectStoreOptions
  ) {
    this.options = options ?? {}
    this.logger = options?.logger
    this.backend = options?.backend ?? null

    // Initialize LRU cache for hot tier objects with improved eviction strategy
    // Uses size-aware eviction with priority for smaller objects to maximize cache utilization
    this.cache = new LRUCache<string, StoredObject>({
      maxCount: options?.cacheMaxCount ?? DEFAULT_CACHE_MAX_COUNT,
      maxBytes: options?.cacheMaxBytes ?? DEFAULT_CACHE_MAX_BYTES,
      defaultTTL: options?.cacheTTL,
      sizeCalculator: (obj) => {
        const stored = obj as StoredObject
        // 100 bytes overhead for metadata, plus actual data size
        return stored.data.byteLength + 100
      },
      onEvict: (key, value, reason) => {
        const stored = value as StoredObject
        this.log('debug', `Cache eviction: ${key} type=${stored?.type} size=${stored?.size} (reason: ${reason})`)
      }
    })

    // Initialize hash cache for optimizing repeated hash computations
    // This is especially useful for pack file operations and deduplication checks
    this.hashCache = new HashCache(10000)
  }

  /**
   * Log a message if logger is configured.
   * @internal
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
    if (!this.logger) return
    const logFn = this.logger[level]
    if (logFn) {
      logFn.call(this.logger, `[ObjectStore] ${message}`, ...args)
    }
  }

  /**
   * Store a raw object and return its SHA.
   *
   * @description
   * Computes the SHA-1 hash of the object in Git format (type + size + content),
   * logs the operation to WAL, stores the object, and updates the object index.
   * If an object with the same SHA already exists, it is replaced (idempotent).
   * The object is also added to the LRU cache for fast subsequent reads.
   *
   * @param type - Object type ('blob', 'tree', 'commit', 'tag')
   * @param data - Raw object content (without Git header)
   * @returns 40-character SHA-1 hash of the stored object
   *
   * @example
   * ```typescript
   * const content = new TextEncoder().encode('file content')
   * const sha = await store.putObject('blob', content)
   * console.log(`Stored blob: ${sha}`)
   * ```
   */
  async putObject(type: ObjectType, data: Uint8Array): Promise<string> {
    const startTime = this.options.enableMetrics ? Date.now() : 0
    const isLargeBlob = type === 'blob' && data.length > LARGE_BLOB_THRESHOLD
    const shouldChunk = type === 'blob' && data.length > BLOB_CHUNK_SIZE

    // Delegate to backend if available
    if (this.backend) {
      const sha = await this.backend.putObject(type, data)

      // Add to cache for fast subsequent reads
      const storedObject: StoredObject = {
        sha,
        type,
        size: data.length,
        data,
        createdAt: Date.now()
      }
      this.cache.set(sha, storedObject)

      // Update metrics
      if (this.options.enableMetrics) {
        this._writes++
        this._bytesWritten += data.length
        this._totalWriteLatency += Date.now() - startTime
        this._objectsByType[type]++
        if (isLargeBlob) {
          this._largeBlobOperations++
          this._largeBlobBytes += data.length
        }
      }

      return sha
    }

    // Use hash cache for optimized hash computation
    // This avoids recomputing hashes for content we've seen before
    const sha = await this.hashCache.getOrCompute(data, () => hashObject(type, data))

    this.log('debug', `Storing ${type} object: ${sha} (${data.length} bytes)${isLargeBlob ? ' [LARGE]' : ''}${shouldChunk ? ' [CHUNKED]' : ''}`)

    // Log to WAL first
    await this.logToWAL('PUT', sha, type, data)

    const now = Date.now()

    // Handle chunked storage for large blobs (>2MB)
    if (shouldChunk) {
      const chunkCount = Math.ceil(data.length / BLOB_CHUNK_SIZE)

      // Store each chunk
      for (let i = 0; i < chunkCount; i++) {
        const start = i * BLOB_CHUNK_SIZE
        const end = Math.min(start + BLOB_CHUNK_SIZE, data.length)
        const chunkData = data.slice(start, end)
        const chunkKey = `${CHUNKED_BLOB_PREFIX}${sha}:${i}`

        this.storage.sql.exec(
          'INSERT OR REPLACE INTO objects (sha, type, size, data, created_at) VALUES (?, ?, ?, ?, ?)',
          chunkKey,
          'blob_chunk',
          chunkData.length,
          chunkData,
          now
        )
      }

      // Update object index with chunked metadata
      this.storage.sql.exec(
        'INSERT OR REPLACE INTO object_index (sha, tier, pack_id, offset, size, type, updated_at, chunked, chunk_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        sha,
        'hot',
        null,
        null,
        data.length,
        type,
        now,
        1, // chunked = true
        chunkCount
      )
    } else {
      // Store the object directly (unchunked)
      this.storage.sql.exec(
        'INSERT OR REPLACE INTO objects (sha, type, size, data, created_at) VALUES (?, ?, ?, ?, ?)',
        sha,
        type,
        data.length,
        data,
        now
      )

      // Update object index
      this.storage.sql.exec(
        'INSERT OR REPLACE INTO object_index (sha, tier, pack_id, offset, size, type, updated_at, chunked, chunk_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        sha,
        'hot',
        null,  // pack_id is null for hot tier
        null,  // offset is null for hot tier
        data.length,
        type,
        now,
        0, // chunked = false
        0  // chunk_count = 0
      )
    }

    // Add to cache for fast subsequent reads
    const storedObject: StoredObject = {
      sha,
      type,
      size: data.length,
      data,
      createdAt: now
    }
    this.cache.set(sha, storedObject)

    // Update metrics
    if (this.options.enableMetrics) {
      this._writes++
      this._bytesWritten += data.length
      this._totalWriteLatency += Date.now() - startTime
      this._objectsByType[type]++
      if (isLargeBlob) {
        this._largeBlobOperations++
        this._largeBlobBytes += data.length
      }
    }

    return sha
  }

  /**
   * Store a large blob using streaming.
   *
   * @description
   * Stores a large blob by processing it in chunks to minimize memory usage.
   * This is useful for blobs larger than the LARGE_BLOB_THRESHOLD (1MB).
   * The hash is computed incrementally as chunks are processed.
   *
   * @param chunks - Async iterable of data chunks
   * @returns 40-character SHA-1 hash of the stored blob
   *
   * @example
   * ```typescript
   * async function* generateChunks() {
   *   for (let i = 0; i < 10; i++) {
   *     yield new Uint8Array(1024 * 64).fill(i)
   *   }
   * }
   * const sha = await store.putBlobStreaming(generateChunks())
   * ```
   */
  async putBlobStreaming(chunks: AsyncIterable<Uint8Array>): Promise<string> {
    // Collect all chunks and compute total size
    const collectedChunks: Uint8Array[] = []
    let totalSize = 0

    for await (const chunk of chunks) {
      collectedChunks.push(chunk)
      totalSize += chunk.length
    }

    // Combine chunks into single buffer
    const data = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of collectedChunks) {
      data.set(chunk, offset)
      offset += chunk.length
    }

    this.log('debug', `Streaming blob: ${totalSize} bytes in ${collectedChunks.length} chunks`)

    // Use the standard putObject which handles caching and metrics
    const sha = await this.putObject('blob', data)

    // Track streaming operation
    if (this.options.enableMetrics) {
      this._streamingOperations++
    }

    return sha
  }

  /**
   * Read a blob using streaming.
   *
   * @description
   * Retrieves a blob and provides it as an async iterable of chunks.
   * This is useful for large blobs to avoid loading the entire content into memory at once.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns StreamingBlobResult or null if not found
   *
   * @example
   * ```typescript
   * const result = await store.getBlobStreaming(sha)
   * if (result) {
   *   for await (const chunk of result.chunks) {
   *     process(chunk.data)
   *   }
   * }
   * ```
   */
  async getBlobStreaming(sha: string): Promise<StreamingBlobResult | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'blob') {
      return null
    }

    const data = obj.data
    const totalSize = data.length
    const chunkSize = STREAM_CHUNK_SIZE

    // Track streaming operation
    if (this.options.enableMetrics) {
      this._streamingOperations++
    }

    // Create async generator for chunks
    async function* generateChunks(): AsyncIterable<BlobChunk> {
      let offset = 0
      while (offset < totalSize) {
        const end = Math.min(offset + chunkSize, totalSize)
        const chunkData = data.slice(offset, end)
        const isLast = end >= totalSize
        yield {
          data: chunkData,
          offset,
          totalSize,
          isLast
        }
        offset = end
      }
    }

    return {
      sha,
      size: totalSize,
      chunks: generateChunks()
    }
  }

  /**
   * Store a tree object with entries.
   *
   * @description
   * Creates a Git tree object from an array of entries. Entries are sorted
   * by name (with directories treated as having trailing slashes for sorting).
   * Each entry is serialized as: "{mode} {name}\0{20-byte-sha}"
   *
   * @param entries - Array of tree entries (files and subdirectories)
   * @returns 40-character SHA-1 hash of the stored tree
   *
   * @example
   * ```typescript
   * const treeSha = await store.putTreeObject([
   *   { mode: '100644', name: 'README.md', sha: blobSha },
   *   { mode: '040000', name: 'src', sha: subdirSha }
   * ])
   * ```
   */
  async putTreeObject(entries: TreeEntry[]): Promise<string> {
    // Validate entries (throws on invalid)
    assertValidTreeEntries(entries)

    // Sort and serialize using utility functions
    const sortedEntries = sortTreeEntries(entries)
    const content = serializeTreeEntries(sortedEntries)

    return this.putObject('tree', content)
  }

  /**
   * Store a commit object.
   *
   * @description
   * Creates a Git commit object with the specified tree, parents, author,
   * committer, and message. The commit content is formatted according to
   * the Git commit format specification.
   *
   * @param commit - Commit data
   * @param commit.tree - SHA of the root tree object
   * @param commit.parents - Array of parent commit SHAs (empty for root commit)
   * @param commit.author - Author information
   * @param commit.committer - Committer information
   * @param commit.message - Commit message
   * @returns 40-character SHA-1 hash of the stored commit
   *
   * @example
   * ```typescript
   * const now = Math.floor(Date.now() / 1000)
   * const author = { name: 'Alice', email: 'alice@example.com.ai', timestamp: now, timezone: '+0000' }
   *
   * const sha = await store.putCommitObject({
   *   tree: treeSha,
   *   parents: [],
   *   author,
   *   committer: author,
   *   message: 'Initial commit\n\nThis is the first commit.'
   * })
   * ```
   */
  async putCommitObject(commit: {
    tree: string
    parents: string[]
    author: Author
    committer: Author
    message: string
  }): Promise<string> {
    // Build commit content (without header)
    const lines: string[] = []
    lines.push(`tree ${commit.tree}`)
    for (const parent of commit.parents) {
      lines.push(`parent ${parent}`)
    }
    lines.push(`author ${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.timezone}`)
    lines.push(`committer ${commit.committer.name} <${commit.committer.email}> ${commit.committer.timestamp} ${commit.committer.timezone}`)
    lines.push('')
    lines.push(commit.message)

    const content = encoder.encode(lines.join('\n'))
    return this.putObject('commit', content)
  }

  /**
   * Store a tag object (annotated tag).
   *
   * @description
   * Creates a Git tag object pointing to another object with tagger
   * information and a message. The tag content is formatted according
   * to the Git tag format specification.
   *
   * @param tag - Tag data
   * @param tag.object - SHA of the object being tagged
   * @param tag.objectType - Type of the object being tagged
   * @param tag.tagger - Tagger information
   * @param tag.message - Tag message
   * @param tag.name - Tag name
   * @returns 40-character SHA-1 hash of the stored tag object
   *
   * @example
   * ```typescript
   * const now = Math.floor(Date.now() / 1000)
   * const tagger = { name: 'Bob', email: 'bob@example.com.ai', timestamp: now, timezone: '+0000' }
   *
   * const sha = await store.putTagObject({
   *   object: commitSha,
   *   objectType: 'commit',
   *   tagger,
   *   message: 'Release v1.0.0',
   *   name: 'v1.0.0'
   * })
   * ```
   */
  async putTagObject(tag: {
    object: string
    objectType: ObjectType
    tagger?: Author
    message: string
    name: string
  }): Promise<string> {
    // Build tag content (without header)
    const lines: string[] = []
    lines.push(`object ${tag.object}`)
    lines.push(`type ${tag.objectType}`)
    lines.push(`tag ${tag.name}`)
    if (tag.tagger) {
      lines.push(`tagger ${tag.tagger.name} <${tag.tagger.email}> ${tag.tagger.timestamp} ${tag.tagger.timezone}`)
    }
    lines.push('')
    lines.push(tag.message)

    const content = encoder.encode(lines.join('\n'))
    return this.putObject('tag', content)
  }

  /**
   * Retrieve an object by SHA.
   *
   * @description
   * Fetches an object from the LRU cache first, falling back to the database
   * if not cached. Returns null if the object doesn't exist or if the SHA is invalid.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns The stored object or null if not found
   *
   * @example
   * ```typescript
   * const obj = await store.getObject(sha)
   * if (obj) {
   *   console.log(`Found ${obj.type} of ${obj.size} bytes`)
   * }
   * ```
   */
  async getObject(sha: string): Promise<StoredObject | null> {
    const startTime = this.options.enableMetrics ? Date.now() : 0

    if (!sha || sha.length < 4) {
      return null
    }

    // Check cache first (fast path)
    const cached = this.cache.get(sha)
    if (cached) {
      this.log('debug', `Cache hit for object: ${sha}`)
      if (this.options.enableMetrics) {
        this._reads++
        this._bytesRead += cached.size
        this._totalReadLatency += Date.now() - startTime
      }
      return cached
    }

    // Delegate to backend if available
    if (this.backend) {
      const result = await this.backend.getObject(sha)
      if (!result) {
        this.log('debug', `Object not found: ${sha}`)
        if (this.options.enableMetrics) {
          this._reads++
          this._totalReadLatency += Date.now() - startTime
        }
        return null
      }

      const obj: StoredObject = {
        sha,
        type: result.type,
        size: result.content.length,
        data: result.content,
        createdAt: Date.now()
      }

      // Add to cache for subsequent reads
      this.cache.set(sha, obj)

      if (this.options.enableMetrics) {
        this._reads++
        this._bytesRead += obj.size
        this._totalReadLatency += Date.now() - startTime
      }

      return obj
    }

    // Check object_index first to see if this is a chunked blob
    const indexResult = this.storage.sql.exec(
      'SELECT sha, tier, size, type, chunked, chunk_count FROM object_index WHERE sha = ?',
      sha
    )
    const indexRows = indexResult.toArray() as { sha: string; tier: string; size: number; type: string; chunked: number; chunk_count: number }[]

    if (indexRows.length > 0 && indexRows[0].chunked === 1) {
      // This is a chunked blob - reassemble from chunks
      const indexEntry = indexRows[0]
      const chunkCount = indexEntry.chunk_count

      this.log('debug', `Reassembling chunked blob: ${sha} (${chunkCount} chunks)`)

      // Fetch all chunks in order
      const data = new Uint8Array(indexEntry.size)
      let offset = 0

      for (let i = 0; i < chunkCount; i++) {
        const chunkKey = `${CHUNKED_BLOB_PREFIX}${sha}:${i}`
        const chunkResult = this.storage.sql.exec(
          'SELECT data FROM objects WHERE sha = ?',
          chunkKey
        )
        const chunkRows = chunkResult.toArray() as { data: Uint8Array }[]

        if (chunkRows.length === 0) {
          this.log('error', `Missing chunk ${i} for chunked blob: ${sha}`)
          if (this.options.enableMetrics) {
            this._reads++
            this._totalReadLatency += Date.now() - startTime
          }
          return null
        }

        const chunkData = chunkRows[0].data
        data.set(new Uint8Array(chunkData), offset)
        offset += chunkData.byteLength
      }

      const obj: StoredObject = {
        sha,
        type: indexEntry.type as ObjectType,
        size: indexEntry.size,
        data,
        createdAt: Date.now()
      }

      // Add to cache for subsequent reads
      this.cache.set(sha, obj)

      if (this.options.enableMetrics) {
        this._reads++
        this._bytesRead += obj.size
        this._totalReadLatency += Date.now() - startTime
      }

      return obj
    }

    // Fall back to database for non-chunked objects
    const result = this.storage.sql.exec(
      'SELECT sha, type, size, data, created_at as createdAt FROM objects WHERE sha = ?',
      sha
    )
    const rows = result.toArray() as StoredObject[]

    if (rows.length === 0) {
      this.log('debug', `Object not found: ${sha}`)
      if (this.options.enableMetrics) {
        this._reads++
        this._totalReadLatency += Date.now() - startTime
      }
      return null
    }

    const obj = rows[0]

    // Add to cache for subsequent reads
    this.cache.set(sha, obj)

    if (this.options.enableMetrics) {
      this._reads++
      this._bytesRead += obj.size
      this._totalReadLatency += Date.now() - startTime
    }

    return obj
  }

  /**
   * Delete an object by SHA.
   *
   * @description
   * Removes an object from the cache, objects table, and the object index.
   * The operation is logged to WAL. Returns false if the object doesn't exist.
   *
   * **Warning**: Deleting objects that are still referenced by other objects
   * (e.g., blobs referenced by trees) will corrupt the repository.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns True if the object was deleted, false if it didn't exist
   *
   * @example
   * ```typescript
   * const deleted = await store.deleteObject(sha)
   * if (deleted) {
   *   console.log('Object removed')
   * }
   * ```
   */
  async deleteObject(sha: string): Promise<boolean> {
    // Delegate to backend if available
    if (this.backend) {
      // Check if object exists first via backend
      const exists = await this.backend.hasObject(sha)
      if (!exists) {
        return false
      }

      this.log('debug', `Deleting object via backend: ${sha}`)

      await this.backend.deleteObject(sha)

      // Remove from cache
      this.cache.delete(sha)

      // Update metrics
      if (this.options.enableMetrics) {
        this._deletes++
      }

      return true
    }

    // Check object_index to see if this is a chunked blob
    const indexResult = this.storage.sql.exec(
      'SELECT chunked, chunk_count FROM object_index WHERE sha = ?',
      sha
    )
    const indexRows = indexResult.toArray() as { chunked: number; chunk_count: number }[]

    // Check if object exists (either in index or directly in objects table)
    const exists = await this.hasObject(sha)
    if (!exists) {
      return false
    }

    this.log('debug', `Deleting object: ${sha}`)

    // Log to WAL
    await this.logToWAL('DELETE', sha, 'blob', new Uint8Array(0))

    // If this is a chunked blob, delete all chunks
    if (indexRows.length > 0 && indexRows[0].chunked === 1) {
      const chunkCount = indexRows[0].chunk_count
      this.log('debug', `Deleting ${chunkCount} chunks for chunked blob: ${sha}`)

      for (let i = 0; i < chunkCount; i++) {
        const chunkKey = `${CHUNKED_BLOB_PREFIX}${sha}:${i}`
        this.storage.sql.exec('DELETE FROM objects WHERE sha = ?', chunkKey)
      }
    } else {
      // Delete from objects table (non-chunked)
      this.storage.sql.exec('DELETE FROM objects WHERE sha = ?', sha)
    }

    // Delete from object index
    this.storage.sql.exec('DELETE FROM object_index WHERE sha = ?', sha)

    // Remove from cache
    this.cache.delete(sha)

    // Update metrics
    if (this.options.enableMetrics) {
      this._deletes++
    }

    return true
  }

  /**
   * Check if an object exists.
   *
   * @description
   * Efficiently checks for object existence without fetching the full content.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns True if the object exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await store.hasObject(sha)) {
   *   console.log('Object exists')
   * }
   * ```
   */
  async hasObject(sha: string): Promise<boolean> {
    if (!sha || sha.length < 4) {
      return false
    }

    // Check cache first (fast path)
    if (this.cache.has(sha)) {
      return true
    }

    // Delegate to backend if available
    if (this.backend) {
      return this.backend.hasObject(sha)
    }

    // Existing SQLite implementation as fallback
    // Use getObject and check for null - this works better with the mock
    const obj = await this.getObject(sha)
    return obj !== null
  }

  /**
   * Verify an object's integrity by recomputing its hash.
   *
   * @description
   * Computes the SHA-1 hash of the stored object and compares it
   * to the stored SHA. Returns false if the object is corrupted
   * or doesn't exist.
   *
   * @param sha - 40-character SHA-1 hash to verify
   * @returns True if the computed hash matches, false otherwise
   *
   * @example
   * ```typescript
   * if (await store.verifyObject(sha)) {
   *   console.log('Object integrity verified')
   * } else {
   *   console.log('Object is corrupted or missing')
   * }
   * ```
   */
  async verifyObject(sha: string): Promise<boolean> {
    // Read directly from storage (bypass cache) to verify actual stored data
    const result = this.storage.sql.exec(
      'SELECT type, data FROM objects WHERE sha = ?',
      sha
    )
    const rows = result.toArray() as { type: ObjectType; data: ArrayBuffer }[]

    if (rows.length === 0) {
      return false
    }

    const obj = rows[0]
    const computedSha = await hashObject(obj.type, new Uint8Array(obj.data))
    return computedSha === sha
  }

  /**
   * Get object type by SHA.
   *
   * @description
   * Returns just the type of an object without fetching its content.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Object type or null if not found
   *
   * @example
   * ```typescript
   * const type = await store.getObjectType(sha)
   * if (type === 'commit') {
   *   // Handle commit
   * }
   * ```
   */
  async getObjectType(sha: string): Promise<ObjectType | null> {
    const obj = await this.getObject(sha)
    return obj?.type ?? null
  }

  /**
   * Get object size by SHA.
   *
   * @description
   * Returns just the size of an object without fetching its content.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Object size in bytes or null if not found
   *
   * @example
   * ```typescript
   * const size = await store.getObjectSize(sha)
   * console.log(`Object is ${size} bytes`)
   * ```
   */
  async getObjectSize(sha: string): Promise<number | null> {
    const obj = await this.getObject(sha)
    return obj?.size ?? null
  }

  /**
   * Store multiple objects in a batch using a single transaction.
   *
   * @description
   * Stores multiple objects atomically within a single SQLite transaction.
   * This is more efficient than individual puts for bulk operations as it:
   * - Reduces the number of disk flushes
   * - Ensures atomic writes (all-or-nothing)
   * - Batches WAL entries for better performance
   *
   * @param objects - Array of objects to store
   * @returns Array of SHA-1 hashes in the same order as input
   *
   * @example
   * ```typescript
   * const shas = await store.putObjects([
   *   { type: 'blob', data: content1 },
   *   { type: 'blob', data: content2 }
   * ])
   * ```
   */
  async putObjects(objects: { type: ObjectType; data: Uint8Array }[]): Promise<string[]> {
    if (objects.length === 0) {
      return []
    }

    // For single objects, delegate to putObject
    if (objects.length === 1) {
      const sha = await this.putObject(objects[0].type, objects[0].data)
      return [sha]
    }

    const startTime = this.options.enableMetrics ? Date.now() : 0
    const shas: string[] = []
    const now = Date.now()
    let totalBytes = 0

    this.log('info', `Starting batch write of ${objects.length} objects`)

    // Pre-compute all SHA hashes (CPU-bound, before transaction)
    const objectsWithSha: Array<{ sha: string; type: ObjectType; data: Uint8Array }> = []
    for (const obj of objects) {
      const sha = await hashObject(obj.type, obj.data)
      objectsWithSha.push({ sha, type: obj.type, data: obj.data })
      shas.push(sha)
      totalBytes += obj.data.length
    }

    // Begin transaction for atomic batch write
    this.storage.sql.exec('BEGIN TRANSACTION')

    try {
      for (const { sha, type, data } of objectsWithSha) {
        // Log batch operation to WAL (single entry for the batch)
        const payload = encoder.encode(JSON.stringify({
          sha,
          type,
          timestamp: now,
          batchSize: objects.length
        }))
        this.storage.sql.exec(
          'INSERT INTO wal (operation, payload, created_at, flushed) VALUES (?, ?, ?, 0)',
          'BATCH_PUT',
          payload,
          now
        )

        // Store the object
        this.storage.sql.exec(
          'INSERT OR REPLACE INTO objects (sha, type, size, data, created_at) VALUES (?, ?, ?, ?, ?)',
          sha,
          type,
          data.length,
          data,
          now
        )

        // Update object index
        this.storage.sql.exec(
          'INSERT OR REPLACE INTO object_index (sha, tier, pack_id, offset, size, type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          sha,
          'hot',
          null,  // pack_id is null for hot tier
          null,  // offset is null for hot tier
          data.length,
          type,
          now
        )

        // Add to cache
        const storedObject: StoredObject = {
          sha,
          type,
          size: data.length,
          data,
          createdAt: now
        }
        this.cache.set(sha, storedObject)
      }

      // Commit transaction
      this.storage.sql.exec('COMMIT')

      this.log('info', `Batch write completed: ${objects.length} objects, ${totalBytes} bytes`)

      // Update metrics
      if (this.options.enableMetrics) {
        this._writes += objects.length
        this._bytesWritten += totalBytes
        this._totalWriteLatency += Date.now() - startTime
        this._batchOperations++
        this._batchObjectsTotal += objects.length
      }

      return shas
    } catch (error) {
      // Rollback on error
      this.storage.sql.exec('ROLLBACK')
      this.log('error', `Batch write failed, rolled back`, error)
      throw error
    }
  }

  /**
   * Retrieve multiple objects by SHA using optimized batch queries.
   *
   * @description
   * Fetches multiple objects efficiently by:
   * 1. First checking the LRU cache for each SHA
   * 2. Batching uncached SHAs into a single SQL query with IN clause
   * 3. Returning results in the original order with null for missing objects
   *
   * @param shas - Array of 40-character SHA-1 hashes
   * @returns Array of objects (or null for missing) in the same order
   *
   * @example
   * ```typescript
   * const objects = await store.getObjects([sha1, sha2, sha3])
   * objects.forEach((obj, i) => {
   *   if (obj) {
   *     console.log(`${i}: ${obj.type}`)
   *   }
   * })
   * ```
   */
  async getObjects(shas: string[]): Promise<(StoredObject | null)[]> {
    if (shas.length === 0) {
      return []
    }

    const startTime = this.options.enableMetrics ? Date.now() : 0
    const results: (StoredObject | null)[] = new Array(shas.length).fill(null)
    const uncachedIndices: number[] = []
    const uncachedShas: string[] = []
    let totalBytesRead = 0

    // First pass: check cache for each SHA
    for (let i = 0; i < shas.length; i++) {
      const sha = shas[i]
      if (!sha || sha.length < 4) {
        results[i] = null
        continue
      }

      const cached = this.cache.get(sha)
      if (cached) {
        results[i] = cached
        totalBytesRead += cached.size
      } else {
        uncachedIndices.push(i)
        uncachedShas.push(sha)
      }
    }

    // Second pass: batch query for uncached objects
    if (uncachedShas.length > 0) {
      this.log('debug', `Batch fetching ${uncachedShas.length} uncached objects`)

      // Build optimized IN query
      const placeholders = uncachedShas.map(() => '?').join(', ')
      const result = this.storage.sql.exec(
        `SELECT sha, type, size, data, created_at as createdAt FROM objects WHERE sha IN (${placeholders})`,
        ...uncachedShas
      )
      const rows = result.toArray() as StoredObject[]

      // Build lookup map for O(1) access
      const rowMap = new Map<string, StoredObject>()
      for (const row of rows) {
        rowMap.set(row.sha, row)
        // Add to cache for future reads
        this.cache.set(row.sha, row)
        totalBytesRead += row.size
      }

      // Fill in results at original indices
      for (let i = 0; i < uncachedIndices.length; i++) {
        const originalIndex = uncachedIndices[i]
        const sha = uncachedShas[i]
        results[originalIndex] = rowMap.get(sha) ?? null
      }
    }

    // Update metrics
    if (this.options.enableMetrics) {
      this._reads += shas.length
      this._bytesRead += totalBytesRead
      this._totalReadLatency += Date.now() - startTime
    }

    return results
  }

  /**
   * Get a blob object with typed result.
   *
   * @description
   * Fetches an object and returns it as a BlobObject if it's a blob.
   * Returns null if the object doesn't exist or isn't a blob.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Typed BlobObject or null
   *
   * @example
   * ```typescript
   * const blob = await store.getBlobObject(sha)
   * if (blob) {
   *   const content = new TextDecoder().decode(blob.data)
   *   console.log(content)
   * }
   * ```
   */
  async getBlobObject(sha: string): Promise<BlobObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'blob') {
      return null
    }

    return {
      type: 'blob',
      data: obj.data
    }
  }

  /**
   * Get a tree object with parsed entries.
   *
   * @description
   * Fetches and parses a tree object, extracting all entries
   * with their modes, names, and SHA references.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Parsed TreeObject with entries or null
   *
   * @example
   * ```typescript
   * const tree = await store.getTreeObject(sha)
   * if (tree) {
   *   for (const entry of tree.entries) {
   *     console.log(`${entry.mode} ${entry.name} ${entry.sha}`)
   *   }
   * }
   * ```
   */
  async getTreeObject(sha: string): Promise<TreeObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'tree') {
      return null
    }

    // Parse tree entries using utility function
    const result = parseTreeEntries(obj.data)

    return {
      type: 'tree',
      data: obj.data,
      entries: result.success ? result.entries : []
    }
  }

  /**
   * Get a commit object with parsed fields.
   *
   * @description
   * Fetches and parses a commit object, extracting tree SHA,
   * parent SHAs, author, committer, and message.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Parsed CommitObject or null
   *
   * @example
   * ```typescript
   * const commit = await store.getCommitObject(sha)
   * if (commit) {
   *   console.log(`Author: ${commit.author.name}`)
   *   console.log(`Message: ${commit.message}`)
   *   console.log(`Parents: ${commit.parents.length}`)
   * }
   * ```
   */
  async getCommitObject(sha: string): Promise<CommitObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'commit') {
      return null
    }

    const content = decoder.decode(obj.data)
    const lines = content.split('\n')

    let tree = ''
    const parents: string[] = []
    let author: Author | null = null
    let committer: Author | null = null
    let messageStartIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === '') {
        messageStartIndex = i + 1
        break
      }

      if (line.startsWith('tree ')) {
        tree = line.slice(5)
      } else if (line.startsWith('parent ')) {
        parents.push(line.slice(7))
      } else if (line.startsWith('author ')) {
        author = parseAuthorLine(line)
      } else if (line.startsWith('committer ')) {
        committer = parseAuthorLine(line)
      }
    }

    if (!author || !committer) {
      return null
    }

    const message = lines.slice(messageStartIndex).join('\n')

    return {
      type: 'commit',
      data: obj.data,
      tree,
      parents,
      author,
      committer,
      message
    }
  }

  /**
   * Get a tag object with parsed fields.
   *
   * @description
   * Fetches and parses an annotated tag object, extracting
   * the tagged object SHA, object type, tag name, tagger, and message.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Parsed TagObject or null
   *
   * @example
   * ```typescript
   * const tag = await store.getTagObject(sha)
   * if (tag) {
   *   console.log(`Tag: ${tag.name}`)
   *   console.log(`Points to: ${tag.object} (${tag.objectType})`)
   *   console.log(`Tagger: ${tag.tagger?.name}`)
   * }
   * ```
   */
  async getTagObject(sha: string): Promise<TagObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'tag') {
      return null
    }

    const content = decoder.decode(obj.data)
    const lines = content.split('\n')

    let object = ''
    let objectType: ObjectType = 'commit'
    let name = ''
    let tagger: Author | undefined = undefined
    let messageStartIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === '') {
        messageStartIndex = i + 1
        break
      }

      if (line.startsWith('object ')) {
        object = line.slice(7)
      } else if (line.startsWith('type ')) {
        objectType = line.slice(5) as ObjectType
      } else if (line.startsWith('tag ')) {
        name = line.slice(4)
      } else if (line.startsWith('tagger ')) {
        try {
          tagger = parseAuthorLine(line)
        } catch {
          // Malformed tagger line - leave tagger as undefined
          return null
        }
      }
    }

    // Validate required fields - object and name must be present
    // tagger is optional (some older tags or special tags may not have it)
    if (!object || !name) {
      return null
    }

    const message = lines.slice(messageStartIndex).join('\n')

    return {
      type: 'tag',
      data: obj.data,
      object,
      objectType,
      name,
      tagger,
      message
    }
  }

  /**
   * Get raw serialized object with Git header.
   *
   * @description
   * Returns the complete Git object format including header:
   * "{type} {size}\0{content}"
   *
   * This is the format used for hashing and storage in pack files.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns Complete object with Git header or null
   *
   * @example
   * ```typescript
   * const raw = await store.getRawObject(sha)
   * if (raw) {
   *   // Can be written directly to a pack file or loose object
   * }
   * ```
   */
  async getRawObject(sha: string): Promise<Uint8Array | null> {
    const obj = await this.getObject(sha)
    if (!obj) {
      return null
    }

    // Build git object format: "type size\0content"
    const header = encoder.encode(`${obj.type} ${obj.data.length}\0`)
    const result = new Uint8Array(header.length + obj.data.length)
    result.set(header)
    result.set(obj.data, header.length)
    return result
  }

  /**
   * Get comprehensive metrics about ObjectStore operations.
   *
   * @description
   * Returns detailed metrics including read/write counts, cache statistics,
   * hash cache performance, large blob operations, and object type breakdown.
   * Useful for monitoring and performance tuning.
   *
   * @returns ObjectStoreMetrics object with all collected metrics
   *
   * @example
   * ```typescript
   * const metrics = store.getMetrics()
   * console.log(`Read operations: ${metrics.reads}`)
   * console.log(`Cache hit rate: ${metrics.cacheHitRate}%`)
   * console.log(`Hash cache hit rate: ${metrics.hashCache.hitRate}%`)
   * console.log(`Large blob operations: ${metrics.largeBlobOperations}`)
   * console.log(`Objects by type:`, metrics.objectsByType)
   * ```
   */
  getMetrics(): ObjectStoreMetrics {
    const cacheStats = this.cache.getStats()
    const hashCacheStats = this.hashCache.getStats()

    return {
      reads: this._reads,
      writes: this._writes,
      deletes: this._deletes,
      cache: cacheStats,
      cacheHitRate: cacheStats.hitRate,
      bytesWritten: this._bytesWritten,
      bytesRead: this._bytesRead,
      avgWriteLatencyMs: this._writes > 0 ? this._totalWriteLatency / this._writes : 0,
      avgReadLatencyMs: this._reads > 0 ? this._totalReadLatency / this._reads : 0,
      batchOperations: this._batchOperations,
      batchObjectsTotal: this._batchObjectsTotal,
      hashCache: {
        hits: hashCacheStats.hits,
        misses: hashCacheStats.misses,
        size: hashCacheStats.size,
        hitRate: hashCacheStats.hitRate
      },
      largeBlobOperations: this._largeBlobOperations,
      largeBlobBytes: this._largeBlobBytes,
      streamingOperations: this._streamingOperations,
      objectsByType: { ...this._objectsByType }
    }
  }

  /**
   * Reset all metrics counters.
   *
   * @description
   * Resets all operation counters and latency measurements to zero.
   * The object and hash caches are NOT cleared - only the metrics.
   * Useful for starting fresh measurements after a baseline period.
   *
   * @example
   * ```typescript
   * // After warmup period
   * store.resetMetrics()
   * // Now metrics reflect production traffic only
   * ```
   */
  resetMetrics(): void {
    this._reads = 0
    this._writes = 0
    this._deletes = 0
    this._bytesWritten = 0
    this._bytesRead = 0
    this._totalWriteLatency = 0
    this._totalReadLatency = 0
    this._batchOperations = 0
    this._batchObjectsTotal = 0
    this._largeBlobOperations = 0
    this._largeBlobBytes = 0
    this._streamingOperations = 0
    this._objectsByType = { blob: 0, tree: 0, commit: 0, tag: 0 }
    this.cache.resetStats()
    this.hashCache.clear()
  }

  /**
   * Get the hash cache for external inspection or tuning.
   *
   * @description
   * Returns the internal hash cache instance. This can be used for
   * manual cache inspection, clearing, or advanced tuning scenarios.
   *
   * @returns The HashCache instance used by this ObjectStore
   *
   * @example
   * ```typescript
   * const hashCache = store.getHashCache()
   * console.log(`Hash cache size: ${hashCache.size}`)
   * ```
   */
  getHashCache(): HashCache {
    return this.hashCache
  }

  /**
   * Log operation to WAL.
   *
   * @description
   * Writes an operation entry to the write-ahead log for durability.
   * The WAL ensures operations can be recovered after crashes.
   *
   * @param operation - Operation type ('PUT', 'DELETE', etc.)
   * @param sha - Object SHA being operated on
   * @param type - Object type
   * @param _data - Object data (not stored in WAL, just for signature compatibility)
   * @internal
   */
  private async logToWAL(
    operation: string,
    sha: string,
    type: ObjectType,
    _data: Uint8Array
  ): Promise<void> {
    // Create payload with operation details
    const payload = encoder.encode(JSON.stringify({
      sha,
      type,
      timestamp: Date.now()
    }))

    this.storage.sql.exec(
      'INSERT INTO wal (operation, payload, created_at, flushed) VALUES (?, ?, ?, 0)',
      operation,
      payload,
      Date.now()
    )
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse author/committer/tagger line.
 *
 * @description
 * Parses a Git author/committer/tagger line in the format:
 * "author Name <email> timestamp timezone"
 *
 * @param line - Full line including prefix
 * @returns Parsed Author object
 * @throws Error if line format is invalid
 * @internal
 */
function parseAuthorLine(line: string): Author {
  const match = line.match(/^(?:author|committer|tagger) (.+) <(.+)> (\d+) ([+-]\d{4})$/)
  if (!match) {
    throw new Error(`Invalid author line: ${line}`)
  }
  return {
    name: match[1],
    email: match[2],
    timestamp: parseInt(match[3], 10),
    timezone: match[4]
  }
}
