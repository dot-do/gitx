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
 * @module do/object-store
 *
 * @example
 * ```typescript
 * import { SqliteObjectStore } from './do/object-store'
 *
 * const store = new SqliteObjectStore(durableObjectStorage, {
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
import { DurableObjectStorage } from './schema';
import { CacheStats } from '../storage/lru-cache';
import { ObjectType, BlobObject, TreeObject, CommitObject, TagObject, TreeEntry, Author } from '../types/objects';
import { HashCache } from '../utils/hash';
import type { CASBackend } from '../storage/backend';
export type { CASBackend } from '../storage/backend';
import type { BasicObjectStore } from '../types/storage';
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
    sha: string;
    /** Object type: 'blob', 'tree', 'commit', or 'tag' */
    type: ObjectType;
    /** Size of the data in bytes */
    size: number;
    /** Raw object content (without Git header) */
    data: Uint8Array;
    /** Unix timestamp (milliseconds) when object was created */
    createdAt: number;
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
    cacheMaxCount?: number;
    /**
     * Maximum cache size in bytes.
     * @default 25MB
     */
    cacheMaxBytes?: number;
    /**
     * Time-to-live for cached objects in milliseconds.
     * @default undefined (no expiration)
     */
    cacheTTL?: number;
    /**
     * Enable metrics collection.
     * @default false
     */
    enableMetrics?: boolean;
    /**
     * Logger interface for operation logging.
     * @default undefined (no logging)
     */
    logger?: ObjectStoreLogger;
    /**
     * Optional storage backend abstraction.
     * If provided, delegates CAS operations to this backend instead of SQLite.
     * This enables gradual migration to different storage implementations.
     * @default undefined (uses SQLite directly)
     */
    backend?: CASBackend;
}
/**
 * Log argument types for structured logging.
 */
export type LogArg = string | number | boolean | null | undefined | Record<string, unknown> | Error;
/**
 * Logger interface for ObjectStore operations.
 */
export interface ObjectStoreLogger {
    debug?(message: string, ...args: LogArg[]): void;
    info?(message: string, ...args: LogArg[]): void;
    warn?(message: string, ...args: LogArg[]): void;
    error?(message: string, ...args: LogArg[]): void;
}
/**
 * Metrics collected by ObjectStore operations.
 */
export interface ObjectStoreMetrics {
    /** Total number of read operations */
    reads: number;
    /** Total number of write operations */
    writes: number;
    /** Total number of delete operations */
    deletes: number;
    /** Cache statistics */
    cache: CacheStats;
    /** Cache hit rate percentage */
    cacheHitRate: number;
    /** Total bytes written */
    bytesWritten: number;
    /** Total bytes read */
    bytesRead: number;
    /** Average write latency in ms */
    avgWriteLatencyMs: number;
    /** Average read latency in ms */
    avgReadLatencyMs: number;
    /** Number of batch operations */
    batchOperations: number;
    /** Total objects in batch operations */
    batchObjectsTotal: number;
    /** Hash cache statistics */
    hashCache: {
        hits: number;
        misses: number;
        size: number;
        hitRate: number;
    };
    /** Large blob operations (> 1MB) */
    largeBlobOperations: number;
    /** Total large blob bytes processed */
    largeBlobBytes: number;
    /** Number of streaming operations */
    streamingOperations: number;
    /** Object type breakdown */
    objectsByType: {
        blob: number;
        tree: number;
        commit: number;
        tag: number;
    };
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
    data: Uint8Array;
    /** Offset in the original blob */
    offset: number;
    /** Total size of the blob */
    totalSize: number;
    /** Whether this is the last chunk */
    isLast: boolean;
}
/**
 * Result of a streaming blob read operation.
 */
export interface StreamingBlobResult {
    /** 40-character SHA-1 hash */
    sha: string;
    /** Total size of the blob */
    size: number;
    /** Async iterator over blob chunks */
    chunks: AsyncIterable<BlobChunk>;
}
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
 * const store = new SqliteObjectStore(durableObjectStorage)
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
export declare class SqliteObjectStore implements BasicObjectStore {
    private storage;
    private cache;
    private hashCache;
    private options;
    private logger;
    private backend;
    private _reads;
    private _writes;
    private _deletes;
    private _bytesWritten;
    private _bytesRead;
    private _totalWriteLatency;
    private _totalReadLatency;
    private _batchOperations;
    private _batchObjectsTotal;
    private _largeBlobOperations;
    private _largeBlobBytes;
    private _streamingOperations;
    private _objectsByType;
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
    constructor(storage: DurableObjectStorage, options?: ObjectStoreOptions);
    /**
     * Log a message if logger is configured.
     * @internal
     */
    private log;
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
    putObject(type: ObjectType, data: Uint8Array): Promise<string>;
    /**
     * Store a Git object and return its SHA-1 hash.
     *
     * @description
     * Alias for {@link putObject} that satisfies the canonical
     * {@link BasicObjectStore} interface from types/storage.ts.
     *
     * @param type - Object type ('blob', 'tree', 'commit', 'tag')
     * @param data - Raw object content (without Git header)
     * @returns 40-character SHA-1 hash of the stored object
     */
    storeObject(type: ObjectType, data: Uint8Array): Promise<string>;
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
    putBlobStreaming(chunks: AsyncIterable<Uint8Array>): Promise<string>;
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
    getBlobStreaming(sha: string): Promise<StreamingBlobResult | null>;
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
    putTreeObject(entries: TreeEntry[]): Promise<string>;
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
    putCommitObject(commit: {
        tree: string;
        parents: string[];
        author: Author;
        committer: Author;
        message: string;
    }): Promise<string>;
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
    putTagObject(tag: {
        object: string;
        objectType: ObjectType;
        tagger?: Author;
        message: string;
        name: string;
    }): Promise<string>;
    /**
     * Resolve a short SHA prefix to a full 40-char SHA.
     *
     * @description
     * Looks up a short SHA prefix (4-39 hex chars) in the objects table
     * using a range query. Returns the full SHA if exactly one match is
     * found, throws on ambiguous prefix, returns null if not found.
     *
     * @param prefix - Short SHA prefix (4-39 hex chars)
     * @returns Full 40-char SHA or null if not found
     * @throws Error if prefix is ambiguous (matches multiple objects)
     * @internal
     */
    private resolveShaPrefix;
    /**
     * Retrieve an object by SHA.
     *
     * @description
     * Fetches an object from the LRU cache first, falling back to the database
     * if not cached. Returns null if the object doesn't exist or if the SHA is invalid.
     * Supports short SHA prefixes (4-39 hex chars) which are resolved to full SHAs.
     *
     * @param sha - 40-character SHA-1 hash or short SHA prefix
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
    getObject(sha: string): Promise<StoredObject | null>;
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
    deleteObject(sha: string): Promise<boolean>;
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
    hasObject(sha: string): Promise<boolean>;
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
    verifyObject(sha: string): Promise<boolean>;
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
    getObjectType(sha: string): Promise<ObjectType | null>;
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
    getObjectSize(sha: string): Promise<number | null>;
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
    putObjects(objects: {
        type: ObjectType;
        data: Uint8Array;
    }[]): Promise<string[]>;
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
    getObjects(shas: string[]): Promise<(StoredObject | null)[]>;
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
    getBlobObject(sha: string): Promise<BlobObject | null>;
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
    getTreeObject(sha: string): Promise<TreeObject | null>;
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
    getCommitObject(sha: string): Promise<CommitObject | null>;
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
    getTagObject(sha: string): Promise<TagObject | null>;
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
    getRawObject(sha: string): Promise<Uint8Array | null>;
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
    getMetrics(): ObjectStoreMetrics;
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
    resetMetrics(): void;
    /**
     * List objects by type with optional limit.
     *
     * @description
     * Queries the objects table for all objects of the given type,
     * returning their SHA and raw data ordered by creation time (newest first).
     * This is useful for export operations that need to iterate over all
     * objects of a specific type (e.g., all commits for Parquet export).
     *
     * @param type - Object type to filter by ('blob', 'tree', 'commit', 'tag')
     * @param limit - Maximum number of objects to return (default 10000)
     * @returns Array of objects with sha and data fields
     *
     * @example
     * ```typescript
     * const commits = await store.listObjectsByType('commit')
     * for (const { sha, data } of commits) {
     *   console.log(`Commit ${sha}: ${data.length} bytes`)
     * }
     * ```
     */
    listObjectsByType(type: ObjectType, limit?: number): Promise<{
        sha: string;
        data: Uint8Array;
    }[]>;
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
    getHashCache(): HashCache;
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
    private logToWAL;
    /**
     * Truncate WAL by deleting flushed entries.
     *
     * @description
     * Removes all entries from the write-ahead log that have been marked as flushed.
     * This is a maintenance operation to free up disk space without losing durability
     * for unflushed entries.
     *
     * @returns Number of WAL entries deleted
     *
     * @example
     * ```typescript
     * const deletedCount = await store.truncateWAL()
     * console.log(`Deleted ${deletedCount} flushed WAL entries`)
     * ```
     */
    truncateWAL(): Promise<number>;
}
/**
 * @deprecated Use {@link SqliteObjectStore} instead. This alias exists for backward compatibility.
 */
export declare const ObjectStore: typeof SqliteObjectStore;
/**
 * @deprecated Use {@link SqliteObjectStore} instead. This type alias exists for backward compatibility.
 */
export type ObjectStore = SqliteObjectStore;
//# sourceMappingURL=object-store.d.ts.map