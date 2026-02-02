/**
 * @fileoverview R2 Packfile Storage Module
 *
 * This module manages Git packfiles stored in Cloudflare R2 object storage.
 * It provides comprehensive functionality for:
 *
 * - **Uploading and downloading packfiles** with their indices using atomic operations
 * - **Multi-pack index (MIDX)** for efficient object lookup across multiple packs
 * - **Concurrent access control** with distributed locking using R2 conditional writes
 * - **Pack verification** and integrity checks via SHA-1 checksums
 * - **Atomic uploads** using a manifest-based pattern to ensure data consistency
 *
 * The module implements Git's packfile format (version 2 and 3) and provides
 * both class-based (`R2PackStorage`) and standalone function APIs for flexibility.
 *
 * @module storage/r2-pack
 *
 * @example
 * ```typescript
 * // Using the class-based API
 * const storage = new R2PackStorage({
 *   bucket: myR2Bucket,
 *   prefix: 'repos/my-repo/',
 *   cacheSize: 100,
 *   cacheTTL: 3600
 * });
 *
 * // Upload a packfile
 * const result = await storage.uploadPackfile(packData, indexData);
 * console.log(`Uploaded pack: ${result.packId}`);
 *
 * // Download with verification
 * const download = await storage.downloadPackfile(result.packId, {
 *   verify: true,
 *   includeIndex: true
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Using standalone functions
 * const result = await uploadPackfile(bucket, packData, indexData, {
 *   prefix: 'repos/my-repo/'
 * });
 *
 * const packfiles = await listPackfiles(bucket, {
 *   prefix: 'repos/my-repo/',
 *   limit: 10
 * });
 * ```
 */
/**
 * Configuration options for R2PackStorage.
 *
 * @description
 * Defines the configuration parameters for initializing an R2PackStorage instance.
 * The bucket is required, while other options have sensible defaults.
 *
 * @example
 * ```typescript
 * const options: R2PackStorageOptions = {
 *   bucket: env.MY_R2_BUCKET,
 *   prefix: 'git-objects/',
 *   cacheSize: 200,
 *   cacheTTL: 7200
 * };
 * ```
 */
export interface R2PackStorageOptions {
    /**
     * R2 bucket instance for storage operations.
     * This is typically obtained from the Cloudflare Workers environment bindings.
     */
    bucket: R2Bucket;
    /**
     * Optional prefix for all keys in the bucket.
     * Use this to namespace packfiles for different repositories.
     * @example 'repos/my-repo/' or 'org/project/'
     */
    prefix?: string;
    /**
     * Maximum number of items to cache in memory.
     * Used for caching multi-pack index and other frequently accessed data.
     * @default 100
     */
    cacheSize?: number;
    /**
     * Cache TTL (Time To Live) in seconds.
     * Cached items will be invalidated after this duration.
     * @default 3600 (1 hour)
     */
    cacheTTL?: number;
}
/**
 * Result returned after successfully uploading a packfile.
 *
 * @description
 * Contains metadata about the uploaded packfile including its unique identifier,
 * size information, checksum for verification, and timestamp.
 *
 * @example
 * ```typescript
 * const result = await storage.uploadPackfile(packData, indexData);
 * console.log(`Pack ID: ${result.packId}`);
 * console.log(`Objects: ${result.objectCount}`);
 * console.log(`Size: ${result.packSize} bytes`);
 * ```
 */
export interface PackfileUploadResult {
    /** Unique identifier for the packfile (format: 'pack-{hex}') */
    packId: string;
    /** Size of the pack file in bytes */
    packSize: number;
    /** Size of the index file in bytes */
    indexSize: number;
    /** SHA-1 checksum of the packfile for integrity verification */
    checksum: string;
    /** Number of objects contained in the packfile */
    objectCount: number;
    /** Timestamp when the packfile was uploaded */
    uploadedAt: Date;
}
/**
 * Metadata about a stored packfile.
 *
 * @description
 * Provides comprehensive metadata about a packfile stored in R2,
 * including size, object count, creation time, and checksum.
 *
 * @example
 * ```typescript
 * const metadata = await storage.getPackfileMetadata('pack-abc123');
 * if (metadata) {
 *   console.log(`Created: ${metadata.createdAt}`);
 *   console.log(`Objects: ${metadata.objectCount}`);
 * }
 * ```
 */
export interface PackfileMetadata {
    /** Unique identifier for the packfile */
    packId: string;
    /** Size of the pack file in bytes */
    packSize: number;
    /** Size of the index file in bytes */
    indexSize: number;
    /** Number of objects in the packfile */
    objectCount: number;
    /** Timestamp when the packfile was created */
    createdAt: Date;
    /** SHA-1 checksum of the packfile */
    checksum: string;
}
/**
 * Options for downloading a packfile.
 *
 * @description
 * Configures the download behavior including whether to include the index,
 * request byte ranges for partial reads, verify checksums, or throw on missing packs.
 *
 * @example
 * ```typescript
 * // Download with index and verification
 * const result = await storage.downloadPackfile(packId, {
 *   includeIndex: true,
 *   verify: true
 * });
 *
 * // Partial download (first 1MB)
 * const partial = await storage.downloadPackfile(packId, {
 *   byteRange: { start: 0, end: 1048575 }
 * });
 * ```
 */
export interface DownloadPackfileOptions {
    /** Include the index file in the download */
    includeIndex?: boolean;
    /**
     * Byte range to download for partial reads.
     * Useful for streaming large packfiles or resuming interrupted downloads.
     */
    byteRange?: {
        start: number;
        end: number;
    };
    /**
     * Verify checksum on download.
     * When true, computes SHA-1 of downloaded data and compares with stored checksum.
     */
    verify?: boolean;
    /**
     * Throw if packfile not found.
     * When true, throws R2PackError instead of returning null.
     * @default false
     */
    required?: boolean;
}
/**
 * Result of downloading a packfile.
 *
 * @description
 * Contains the downloaded packfile data and optionally the index data
 * if `includeIndex` was specified in the download options.
 *
 * @example
 * ```typescript
 * const result = await storage.downloadPackfile(packId, { includeIndex: true });
 * if (result) {
 *   console.log(`Pack size: ${result.packData.length}`);
 *   if (result.indexData) {
 *     console.log(`Index size: ${result.indexData.length}`);
 *   }
 * }
 * ```
 */
export interface DownloadPackfileResult {
    /** The packfile data as a Uint8Array */
    packData: Uint8Array;
    /** The index file data (only present if includeIndex was true) */
    indexData?: Uint8Array;
    /** Whether the checksum was verified (only present if verify was true) */
    verified?: boolean;
}
/**
 * Options for uploading a packfile.
 *
 * @description
 * Configures upload behavior including retry count and atomic upload settings.
 *
 * @example
 * ```typescript
 * const result = await storage.uploadPackfile(packData, indexData, {
 *   retries: 5,
 *   skipAtomic: false // Use atomic upload for safety
 * });
 * ```
 */
export interface UploadPackfileOptions {
    /**
     * Number of retries on failure.
     * Each retry uses exponential backoff.
     */
    retries?: number;
    /**
     * Skip atomic upload pattern.
     * Use only for testing or migration scenarios where atomicity is not required.
     * @default false
     */
    skipAtomic?: boolean;
}
/**
 * Pack manifest for atomic uploads.
 *
 * @description
 * A manifest marks a pack as "complete" only after both pack and index are uploaded.
 * This ensures atomic uploads where partial uploads are detected and can be cleaned up.
 *
 * The upload process follows these steps:
 * 1. Upload pack and index to staging paths
 * 2. Create manifest in 'staging' status
 * 3. Copy from staging to final location
 * 4. Update manifest to 'complete' status
 * 5. Clean up staging files
 *
 * @example
 * ```typescript
 * const manifest = await storage.getPackManifest(packId);
 * if (manifest?.status === 'complete') {
 *   console.log('Pack upload is complete and verified');
 * }
 * ```
 */
export interface PackManifest {
    /** Version of the manifest format */
    version: number;
    /** Pack ID this manifest belongs to */
    packId: string;
    /** SHA-1 checksum of the pack file */
    packChecksum: string;
    /** SHA-1 checksum of the index file */
    indexChecksum: string;
    /** Size of the pack file in bytes */
    packSize: number;
    /** Size of the index file in bytes */
    indexSize: number;
    /** Number of objects in the packfile */
    objectCount: number;
    /** ISO 8601 timestamp when the pack was completed */
    completedAt: string;
    /**
     * Upload status.
     * - 'staging': Upload in progress
     * - 'complete': Upload finished and verified
     */
    status: 'staging' | 'complete';
}
/**
 * Entry in the multi-pack index (MIDX).
 *
 * @description
 * Represents a single object's location within the multi-pack index.
 * Used for efficient O(log n) binary search across all objects in all packs.
 *
 * @example
 * ```typescript
 * const entry = lookupObjectInMultiPack(midx, objectId);
 * if (entry) {
 *   const packId = midx.packIds[entry.packIndex];
 *   console.log(`Object found in pack ${packId} at offset ${entry.offset}`);
 * }
 * ```
 */
export interface MultiPackIndexEntry {
    /** 40-character hex SHA-1 object ID */
    objectId: string;
    /** Index of the pack in the packIds array */
    packIndex: number;
    /** Byte offset within the pack file where the object data begins */
    offset: number;
}
/**
 * Multi-pack index (MIDX) structure.
 *
 * @description
 * Provides a single index across multiple pack files for efficient object lookup.
 * Entries are sorted by objectId to enable binary search.
 *
 * The MIDX format follows Git's multi-pack-index specification with:
 * - MIDX signature (4 bytes)
 * - Version number
 * - Pack ID list
 * - Sorted object entries
 * - Trailing checksum
 *
 * @example
 * ```typescript
 * const midx = await storage.getMultiPackIndex();
 * console.log(`Index contains ${midx.entries.length} objects across ${midx.packIds.length} packs`);
 * ```
 */
export interface MultiPackIndex {
    /** Version of the multi-pack index format */
    version: number;
    /** Array of pack IDs included in this index */
    packIds: string[];
    /** Sorted entries for all objects across all packs */
    entries: MultiPackIndexEntry[];
    /** SHA-1 checksum of the index for integrity verification */
    checksum: Uint8Array;
}
/**
 * Handle for a distributed lock.
 *
 * @description
 * Contains all information needed to release or refresh a distributed lock.
 * Locks are implemented using R2 conditional writes (ETags) for atomicity.
 *
 * @example
 * ```typescript
 * const handle = await storage.acquireDistributedLock('my-resource', 30000);
 * if (handle) {
 *   try {
 *     // Do work while holding the lock
 *     await storage.refreshDistributedLock(handle, 30000); // Extend TTL
 *   } finally {
 *     await storage.releaseDistributedLock(handle);
 *   }
 * }
 * ```
 */
export interface LockHandle {
    /** Resource identifier that is locked */
    resource: string;
    /** Unique lock ID for this holder (used for ownership verification) */
    lockId: string;
    /** ETag for conditional operations (ensures lock hasn't been modified) */
    etag: string;
    /** When the lock expires (milliseconds since epoch) */
    expiresAt: number;
}
/**
 * Content stored in a lock file.
 *
 * @description
 * The JSON content stored in the R2 lock file. Used for lock ownership
 * verification and debugging lock contention issues.
 */
export interface LockFileContent {
    /** Unique lock ID for ownership verification */
    lockId: string;
    /** Resource being locked */
    resource: string;
    /** When the lock expires (milliseconds since epoch) */
    expiresAt: number;
    /** When the lock was acquired (milliseconds since epoch) */
    acquiredAt: number;
    /** Worker/process identifier for debugging lock contention */
    holder?: string;
    /** Number of times this lock has been stolen from expired holders */
    stolenCount?: number;
    /** Previous holder's lockId (set when lock is stolen) */
    previousLockId?: string;
}
/**
 * Options for acquiring a distributed lock.
 *
 * @description
 * Configures lock acquisition behavior including TTL, holder identification,
 * and lock stealing behavior.
 */
export interface DistributedLockOptions {
    /**
     * Time-to-live in milliseconds after which the lock expires.
     * This prevents deadlocks from crashed processes.
     * @default 30000 (30 seconds)
     */
    ttlMs?: number;
    /** Worker/process identifier for debugging lock contention */
    holder?: string;
    /**
     * Whether to allow stealing expired locks.
     * When true and an existing lock has expired, the new acquirer can steal it.
     * @default true
     */
    allowStealing?: boolean;
    /**
     * Grace period in milliseconds before considering a lock stealable.
     * Even if a lock is expired, wait this additional time before stealing.
     * Useful to prevent race conditions in clock skew scenarios.
     * @default 0
     */
    stealingGracePeriodMs?: number;
}
/**
 * Lock on a packfile for write operations.
 *
 * @description
 * Provides methods to check lock status, release the lock, and optionally
 * refresh the lock's TTL. Used to prevent concurrent modifications to packfiles.
 *
 * @example
 * ```typescript
 * const lock = await storage.acquireLock(packId, { ttl: 60000 });
 * try {
 *   // Perform operations on the packfile
 *   if (!lock.isHeld()) {
 *     throw new Error('Lock expired!');
 *   }
 * } finally {
 *   await lock.release();
 * }
 * ```
 */
export interface PackLock {
    /** Pack ID that is locked */
    packId: string;
    /** Check if lock is still held (not expired and not released) */
    isHeld(): boolean;
    /** Release the lock, allowing other processes to acquire it */
    release(): Promise<void>;
    /**
     * Refresh the lock TTL.
     * @returns true if refresh succeeded, false if lock was lost
     */
    refresh?(): Promise<boolean>;
    /** Get the underlying distributed lock handle (for advanced use) */
    handle?: LockHandle;
}
/**
 * Options for acquiring a lock.
 *
 * @description
 * Configures lock acquisition behavior including timeout, TTL, and holder identification.
 *
 * @example
 * ```typescript
 * const lock = await storage.acquireLock(packId, {
 *   timeout: 10000,  // Wait up to 10 seconds
 *   ttl: 30000,      // Lock expires after 30 seconds
 *   holder: 'worker-1'
 * });
 * ```
 */
export interface AcquireLockOptions {
    /**
     * Timeout in milliseconds to wait for lock acquisition.
     * If 0, fails immediately if lock is held.
     * @default 0
     */
    timeout?: number;
    /**
     * TTL in milliseconds after which lock auto-expires.
     * Prevents deadlocks if the holder crashes.
     * @default 30000
     */
    ttl?: number;
    /** Worker/process identifier for debugging lock contention */
    holder?: string;
}
/**
 * Result of listing packfiles.
 *
 * @description
 * Contains the list of packfile metadata and an optional cursor for pagination.
 *
 * @example
 * ```typescript
 * let cursor: string | undefined;
 * do {
 *   const result = await storage.listPackfiles({ limit: 10, cursor });
 *   for (const pack of result.items) {
 *     console.log(pack.packId);
 *   }
 *   cursor = result.cursor;
 * } while (cursor);
 * ```
 */
export interface ListPackfilesResult {
    /** Array of packfile metadata */
    items: PackfileMetadata[];
    /** Cursor for fetching the next page of results */
    cursor?: string;
}
/**
 * Error thrown by R2 pack operations.
 *
 * @description
 * Custom error class for R2 packfile operations with error codes for
 * programmatic error handling.
 *
 * Error codes:
 * - `NOT_FOUND`: Packfile does not exist
 * - `LOCKED`: Packfile is locked by another process
 * - `INVALID_DATA`: Packfile format is invalid
 * - `CHECKSUM_MISMATCH`: Checksum verification failed
 * - `NETWORK_ERROR`: R2 network/connectivity issue
 *
 * @example
 * ```typescript
 * try {
 *   await storage.downloadPackfile(packId, { required: true });
 * } catch (error) {
 *   if (error instanceof R2PackError) {
 *     switch (error.code) {
 *       case 'NOT_FOUND':
 *         console.log('Pack does not exist');
 *         break;
 *       case 'CHECKSUM_MISMATCH':
 *         console.log('Pack is corrupted');
 *         break;
 *     }
 *   }
 * }
 * ```
 */
export declare class R2PackError extends Error {
    readonly code: 'NOT_FOUND' | 'LOCKED' | 'INVALID_DATA' | 'CHECKSUM_MISMATCH' | 'NETWORK_ERROR';
    readonly packId?: string | undefined;
    /**
     * Creates a new R2PackError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param packId - Optional pack ID related to the error
     */
    constructor(message: string, code: 'NOT_FOUND' | 'LOCKED' | 'INVALID_DATA' | 'CHECKSUM_MISMATCH' | 'NETWORK_ERROR', packId?: string | undefined);
}
/**
 * R2 Packfile Storage class.
 *
 * @description
 * Main class for managing Git packfiles in Cloudflare R2 object storage.
 * Provides methods for uploading, downloading, listing, and managing packfiles
 * with support for atomic uploads, distributed locking, and multi-pack indexing.
 *
 * @example
 * ```typescript
 * // Initialize storage
 * const storage = new R2PackStorage({
 *   bucket: env.GIT_BUCKET,
 *   prefix: 'repos/my-repo/',
 *   cacheSize: 100,
 *   cacheTTL: 3600
 * });
 *
 * // Upload a packfile atomically
 * const result = await storage.uploadPackfile(packData, indexData);
 *
 * // Download with verification
 * const download = await storage.downloadPackfile(result.packId, {
 *   verify: true,
 *   includeIndex: true
 * });
 *
 * // List all packfiles
 * const list = await storage.listPackfiles();
 *
 * // Acquire lock for write operations
 * const lock = await storage.acquireLock(packId, { ttl: 30000 });
 * try {
 *   // Perform operations
 * } finally {
 *   await lock.release();
 * }
 * ```
 */
export declare class R2PackStorage {
    private _bucket;
    private _prefix;
    private _cacheTTL;
    private _midxCache;
    private _indexChecksums;
    /**
     * Creates a new R2PackStorage instance.
     *
     * @param options - Configuration options for the storage instance
     *
     * @example
     * ```typescript
     * const storage = new R2PackStorage({
     *   bucket: env.MY_BUCKET,
     *   prefix: 'repos/my-repo/',
     *   cacheSize: 100,
     *   cacheTTL: 3600
     * });
     * ```
     */
    constructor(options: R2PackStorageOptions);
    private _buildKey;
    /**
     * Uploads a packfile and its index to R2 atomically.
     *
     * @description
     * Uses a manifest-based pattern to ensure atomic uploads:
     * 1. Upload pack and index to staging paths
     * 2. Create manifest in 'staging' status
     * 3. Copy from staging to final location
     * 4. Update manifest to 'complete' status
     * 5. Clean up staging files
     *
     * If the process fails at any point, the pack is not considered complete
     * until a valid manifest with status 'complete' exists.
     *
     * @param packData - Raw packfile bytes (must have valid PACK signature)
     * @param indexData - Pack index file bytes
     * @param options - Optional upload configuration
     *
     * @returns Upload result with pack ID, sizes, checksum, and object count
     *
     * @throws {R2PackError} With code 'INVALID_DATA' if packfile is invalid
     * @throws {R2PackError} With code 'NETWORK_ERROR' if bucket is unavailable
     *
     * @example
     * ```typescript
     * const result = await storage.uploadPackfile(packData, indexData);
     * console.log(`Uploaded: ${result.packId}`);
     * console.log(`Objects: ${result.objectCount}`);
     * console.log(`Checksum: ${result.checksum}`);
     * ```
     */
    uploadPackfile(packData: Uint8Array, indexData: Uint8Array, options?: UploadPackfileOptions): Promise<PackfileUploadResult>;
    /**
     * Gets the manifest for a packfile.
     *
     * @description
     * Retrieves the manifest JSON that tracks the upload status of a packfile.
     * Returns null if no manifest exists (legacy packs or invalid pack ID).
     *
     * @param packId - Pack identifier to get manifest for
     * @returns Pack manifest or null if not found
     *
     * @example
     * ```typescript
     * const manifest = await storage.getPackManifest('pack-abc123');
     * if (manifest?.status === 'complete') {
     *   console.log('Pack is ready for use');
     * } else {
     *   console.log('Pack upload is incomplete');
     * }
     * ```
     */
    getPackManifest(packId: string): Promise<PackManifest | null>;
    /**
     * Checks if a packfile upload is complete.
     *
     * @description
     * A pack is considered complete if:
     * 1. It has a manifest with status 'complete', OR
     * 2. It was uploaded before the atomic upload feature (legacy packs without manifest)
     *    AND both .pack and .idx files exist
     *
     * @param packId - Pack identifier to check
     * @returns true if pack is complete and ready for use
     *
     * @example
     * ```typescript
     * if (await storage.isPackComplete(packId)) {
     *   const data = await storage.downloadPackfile(packId);
     * }
     * ```
     */
    isPackComplete(packId: string): Promise<boolean>;
    /**
     * Downloads a packfile from R2.
     *
     * @description
     * Downloads pack data with optional index file. Verifies pack completeness
     * before downloading and optionally verifies checksum integrity.
     *
     * @param packId - Pack identifier to download
     * @param options - Download options (includeIndex, verify, byteRange, required)
     *
     * @returns Download result with pack data, or null if not found (unless required=true)
     *
     * @throws {R2PackError} With code 'NOT_FOUND' if required=true and pack not found
     * @throws {R2PackError} With code 'CHECKSUM_MISMATCH' if verify=true and verification fails
     *
     * @example
     * ```typescript
     * // Basic download
     * const result = await storage.downloadPackfile(packId);
     *
     * // Download with verification and index
     * const verified = await storage.downloadPackfile(packId, {
     *   verify: true,
     *   includeIndex: true
     * });
     *
     * // Required download (throws if not found)
     * const required = await storage.downloadPackfile(packId, { required: true });
     * ```
     */
    downloadPackfile(packId: string, options?: DownloadPackfileOptions): Promise<DownloadPackfileResult | null>;
    /**
     * Gets metadata for a packfile.
     *
     * @description
     * Retrieves metadata about a packfile including size, object count,
     * creation time, and checksum without downloading the full pack.
     *
     * @param packId - Pack identifier to get metadata for
     * @returns Packfile metadata or null if not found
     *
     * @example
     * ```typescript
     * const metadata = await storage.getPackfileMetadata(packId);
     * if (metadata) {
     *   console.log(`Size: ${metadata.packSize} bytes`);
     *   console.log(`Objects: ${metadata.objectCount}`);
     * }
     * ```
     */
    getPackfileMetadata(packId: string): Promise<PackfileMetadata | null>;
    /**
     * Lists all packfiles in storage.
     *
     * @description
     * Returns a paginated list of packfile metadata. Use the cursor for
     * fetching subsequent pages of results.
     *
     * @param options - Pagination options (limit, cursor)
     * @returns List of packfile metadata with optional cursor for pagination
     *
     * @example
     * ```typescript
     * // List first 10 packfiles
     * const first = await storage.listPackfiles({ limit: 10 });
     *
     * // Get next page
     * if (first.cursor) {
     *   const next = await storage.listPackfiles({ limit: 10, cursor: first.cursor });
     * }
     * ```
     */
    listPackfiles(options?: {
        limit?: number;
        cursor?: string;
    }): Promise<ListPackfilesResult & PackfileMetadata[]>;
    /**
     * Deletes a packfile, its index, and manifest.
     *
     * @description
     * Removes all files associated with a packfile and updates the
     * multi-pack index if needed.
     *
     * @param packId - Pack identifier to delete
     * @returns true if pack was deleted, false if it didn't exist
     *
     * @example
     * ```typescript
     * if (await storage.deletePackfile(packId)) {
     *   console.log('Pack deleted successfully');
     * } else {
     *   console.log('Pack not found');
     * }
     * ```
     */
    deletePackfile(packId: string): Promise<boolean>;
    /**
     * Downloads just the index file for a packfile.
     *
     * @description
     * Retrieves only the pack index file, useful for object lookups
     * without downloading the full packfile.
     *
     * @param packId - Pack identifier to download index for
     * @returns Index data or null if not found
     *
     * @example
     * ```typescript
     * const indexData = await storage.downloadIndex(packId);
     * if (indexData) {
     *   // Parse and use the index
     * }
     * ```
     */
    downloadIndex(packId: string): Promise<Uint8Array | null>;
    /**
     * Uploads a new index for an existing packfile.
     *
     * @description
     * Replaces the index file for an existing packfile. Useful for
     * regenerating corrupted indices or updating index format.
     *
     * @param packId - Pack identifier to upload index for
     * @param indexData - New index file data
     *
     * @throws {R2PackError} With code 'NOT_FOUND' if packfile doesn't exist
     *
     * @example
     * ```typescript
     * const newIndex = generatePackIndex(packData);
     * await storage.uploadIndex(packId, newIndex);
     * ```
     */
    uploadIndex(packId: string, indexData: Uint8Array): Promise<void>;
    /**
     * Verifies that an index matches its packfile.
     *
     * @description
     * Compares the current index checksum against the stored checksum
     * to detect corruption or tampering.
     *
     * @param packId - Pack identifier to verify index for
     * @returns true if index is valid, false if missing or corrupted
     *
     * @example
     * ```typescript
     * if (await storage.verifyIndex(packId)) {
     *   console.log('Index is valid');
     * } else {
     *   console.log('Index needs to be regenerated');
     * }
     * ```
     */
    verifyIndex(packId: string): Promise<boolean>;
    /**
     * Cleans up orphaned staging files.
     *
     * @description
     * This should be called on startup to clean up any staging files
     * left behind by failed uploads. It will:
     * 1. List all files in the staging directory
     * 2. For each pack ID found, check if it has a complete manifest
     * 3. If not complete, delete the staging files and any partial final files
     *
     * @returns Array of pack IDs that were cleaned up
     *
     * @example
     * ```typescript
     * // Call on worker startup
     * const cleaned = await storage.cleanupOrphanedStagingFiles();
     * if (cleaned.length > 0) {
     *   console.log(`Cleaned up ${cleaned.length} orphaned uploads`);
     * }
     * ```
     */
    cleanupOrphanedStagingFiles(): Promise<string[]>;
    /**
     * Rebuilds the multi-pack index from all packfiles.
     *
     * @description
     * Creates a new MIDX by scanning all packfiles and building a sorted
     * index of all objects. Call this after adding or removing packs.
     *
     * @example
     * ```typescript
     * await storage.rebuildMultiPackIndex();
     * const midx = await storage.getMultiPackIndex();
     * console.log(`Indexed ${midx.entries.length} objects`);
     * ```
     */
    rebuildMultiPackIndex(): Promise<void>;
    /**
     * Gets the current multi-pack index.
     *
     * @description
     * Returns the MIDX from cache if available and not expired,
     * otherwise fetches from R2. Returns an empty index if none exists.
     *
     * @returns Current multi-pack index
     *
     * @example
     * ```typescript
     * const midx = await storage.getMultiPackIndex();
     * const entry = lookupObjectInMultiPack(midx, objectSha);
     * if (entry) {
     *   const packId = midx.packIds[entry.packIndex];
     *   console.log(`Object is in pack ${packId}`);
     * }
     * ```
     */
    getMultiPackIndex(): Promise<MultiPackIndex>;
    /**
     * Acquires a distributed lock on a resource using R2 conditional writes.
     *
     * @description
     * Uses R2's conditional write feature (ETags) to implement distributed locking.
     * Locks automatically expire after the TTL to prevent deadlocks.
     * If an existing lock is expired (and optionally past the grace period),
     * the new acquirer can "steal" the lock atomically.
     *
     * @param resource - Resource identifier to lock
     * @param ttlMs - Time-to-live in milliseconds (default: 30000)
     * @param holder - Optional identifier for the lock holder (for debugging)
     * @param options - Additional options for lock acquisition
     *
     * @returns LockHandle if acquired, null if lock is held by another process
     *
     * @example
     * ```typescript
     * const handle = await storage.acquireDistributedLock('my-resource', 30000, 'worker-1');
     * if (handle) {
     *   try {
     *     // Do work while holding the lock
     *   } finally {
     *     await storage.releaseDistributedLock(handle);
     *   }
     * } else {
     *   console.log('Could not acquire lock - resource is busy');
     * }
     * ```
     *
     * @example
     * ```typescript
     * // With lock stealing options
     * const handle = await storage.acquireDistributedLock('my-resource', 30000, 'worker-1', {
     *   allowStealing: true,
     *   stealingGracePeriodMs: 1000 // Wait 1 second after expiry before stealing
     * });
     * ```
     */
    acquireDistributedLock(resource: string, ttlMs?: number, holder?: string, options?: {
        allowStealing?: boolean;
        stealingGracePeriodMs?: number;
    }): Promise<LockHandle | null>;
    /**
     * Checks if a lock can be stolen (is expired and past grace period).
     *
     * @description
     * Useful for checking lock status without attempting to acquire it.
     *
     * @param resource - Resource identifier to check
     * @param gracePeriodMs - Grace period after expiry before lock is stealable
     *
     * @returns Object with lock status information, or null if no lock exists
     *
     * @example
     * ```typescript
     * const status = await storage.getLockStatus('my-resource');
     * if (status?.isStealable) {
     *   console.log('Lock can be stolen');
     * }
     * ```
     */
    getLockStatus(resource: string, gracePeriodMs?: number): Promise<{
        exists: boolean;
        isExpired: boolean;
        isStealable: boolean;
        holder?: string;
        expiresAt?: number;
        stolenCount?: number;
    } | null>;
    /**
     * Force-steals an expired lock, ignoring normal acquisition rules.
     *
     * @description
     * This method will steal a lock even if allowStealing would normally be false.
     * Use with caution - this is intended for administrative recovery scenarios.
     *
     * @param resource - Resource identifier to steal lock for
     * @param ttlMs - Time-to-live for the new lock
     * @param holder - Optional identifier for the new lock holder
     *
     * @returns LockHandle if stolen successfully, null if lock doesn't exist or isn't expired
     *
     * @example
     * ```typescript
     * // Administrative recovery: force-steal a stuck lock
     * const handle = await storage.forceStealExpiredLock('stuck-resource', 30000, 'admin');
     * if (handle) {
     *   console.log('Lock stolen successfully');
     * }
     * ```
     */
    forceStealExpiredLock(resource: string, ttlMs?: number, holder?: string): Promise<LockHandle | null>;
    /**
     * Releases a distributed lock.
     *
     * @description
     * Releases the lock only if the caller still owns it (verified by lockId).
     * Safe to call even if lock has expired or been taken by another process.
     *
     * @param handle - Lock handle returned from acquireDistributedLock
     *
     * @example
     * ```typescript
     * const handle = await storage.acquireDistributedLock('resource');
     * if (handle) {
     *   try {
     *     // Do work
     *   } finally {
     *     await storage.releaseDistributedLock(handle);
     *   }
     * }
     * ```
     */
    releaseDistributedLock(handle: LockHandle): Promise<void>;
    /**
     * Refreshes a distributed lock to extend its TTL.
     *
     * @description
     * Extends the lock's expiration time. Useful for long-running operations
     * that need to hold the lock longer than the original TTL.
     *
     * @param handle - Lock handle to refresh
     * @param ttlMs - New TTL in milliseconds
     *
     * @returns true if refresh succeeded, false if lock was lost
     *
     * @example
     * ```typescript
     * const handle = await storage.acquireDistributedLock('resource', 30000);
     * if (handle) {
     *   // Do some work...
     *
     *   // Extend the lock for another 30 seconds
     *   if (await storage.refreshDistributedLock(handle, 30000)) {
     *     // Continue working
     *   } else {
     *     // Lock was lost, abort operation
     *   }
     * }
     * ```
     */
    refreshDistributedLock(handle: LockHandle, ttlMs?: number): Promise<boolean>;
    /**
     * Cleans up expired locks from R2 storage.
     *
     * @description
     * Scans all lock files and removes those that have expired.
     * This should be called periodically to remove stale lock files
     * left by crashed processes.
     *
     * @returns Number of locks cleaned up
     *
     * @example
     * ```typescript
     * // Run periodically (e.g., every 5 minutes)
     * const cleaned = await storage.cleanupExpiredLocks();
     * console.log(`Cleaned up ${cleaned} expired locks`);
     * ```
     */
    cleanupExpiredLocks(): Promise<number>;
    /**
     * Acquires a lock on a packfile (backward-compatible wrapper).
     *
     * @description
     * High-level API for acquiring a pack lock with optional timeout.
     * Uses distributed locking with R2 conditional writes internally.
     *
     * @param packId - Pack identifier to lock
     * @param options - Lock acquisition options
     *
     * @returns PackLock interface for managing the lock
     *
     * @throws {R2PackError} With code 'LOCKED' if lock cannot be acquired
     *
     * @example
     * ```typescript
     * const lock = await storage.acquireLock(packId, {
     *   timeout: 10000,
     *   ttl: 30000,
     *   holder: 'my-worker'
     * });
     *
     * try {
     *   // Perform pack operations
     *   if (lock.refresh) {
     *     await lock.refresh(); // Extend lock if needed
     *   }
     * } finally {
     *   await lock.release();
     * }
     * ```
     */
    acquireLock(packId: string, options?: AcquireLockOptions): Promise<PackLock>;
}
/**
 * Uploads a packfile to R2.
 *
 * @description
 * Standalone function for uploading a packfile. Creates a temporary
 * R2PackStorage instance internally.
 *
 * @param bucket - R2 bucket instance
 * @param packData - Raw packfile bytes
 * @param indexData - Pack index file bytes
 * @param options - Optional configuration including prefix
 *
 * @returns Upload result with pack ID, sizes, and checksum
 *
 * @throws {R2PackError} If packfile is invalid or upload fails
 *
 * @example
 * ```typescript
 * const result = await uploadPackfile(bucket, packData, indexData, {
 *   prefix: 'repos/my-repo/'
 * });
 * console.log(`Uploaded: ${result.packId}`);
 * ```
 */
export declare function uploadPackfile(bucket: R2Bucket, packData: Uint8Array, indexData: Uint8Array, options?: {
    prefix?: string;
}): Promise<PackfileUploadResult>;
/**
 * Downloads a packfile from R2.
 *
 * @description
 * Standalone function for downloading a packfile. Creates a temporary
 * R2PackStorage instance internally.
 *
 * @param bucket - R2 bucket instance
 * @param packId - Pack identifier to download
 * @param options - Download options and prefix
 *
 * @returns Download result or null if not found
 *
 * @throws {R2PackError} If required=true and pack not found, or verification fails
 *
 * @example
 * ```typescript
 * const result = await downloadPackfile(bucket, packId, {
 *   prefix: 'repos/my-repo/',
 *   verify: true
 * });
 * ```
 */
export declare function downloadPackfile(bucket: R2Bucket, packId: string, options?: DownloadPackfileOptions & {
    prefix?: string;
}): Promise<DownloadPackfileResult | null>;
/**
 * Gets packfile metadata.
 *
 * @description
 * Standalone function for retrieving packfile metadata without downloading
 * the full pack.
 *
 * @param bucket - R2 bucket instance
 * @param packId - Pack identifier
 * @param options - Optional prefix configuration
 *
 * @returns Packfile metadata or null if not found
 *
 * @example
 * ```typescript
 * const metadata = await getPackfileMetadata(bucket, packId);
 * if (metadata) {
 *   console.log(`Objects: ${metadata.objectCount}`);
 * }
 * ```
 */
export declare function getPackfileMetadata(bucket: R2Bucket, packId: string, options?: {
    prefix?: string;
}): Promise<PackfileMetadata | null>;
/**
 * Lists all packfiles.
 *
 * @description
 * Standalone function for listing packfiles with pagination support.
 *
 * @param bucket - R2 bucket instance
 * @param options - Prefix and pagination options
 *
 * @returns Array of packfile metadata
 *
 * @example
 * ```typescript
 * const packs = await listPackfiles(bucket, {
 *   prefix: 'repos/my-repo/',
 *   limit: 50
 * });
 * ```
 */
export declare function listPackfiles(bucket: R2Bucket, options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
}): Promise<PackfileMetadata[]>;
/**
 * Deletes a packfile.
 *
 * @description
 * Standalone function for deleting a packfile and its associated files.
 *
 * @param bucket - R2 bucket instance
 * @param packId - Pack identifier to delete
 * @param options - Optional prefix configuration
 *
 * @returns true if deleted, false if not found
 *
 * @example
 * ```typescript
 * if (await deletePackfile(bucket, packId)) {
 *   console.log('Deleted');
 * }
 * ```
 */
export declare function deletePackfile(bucket: R2Bucket, packId: string, options?: {
    prefix?: string;
}): Promise<boolean>;
/**
 * Creates a multi-pack index from all packfiles in the bucket.
 *
 * @description
 * Standalone function that rebuilds the MIDX and returns the result.
 *
 * @param bucket - R2 bucket instance
 * @param options - Optional prefix configuration
 *
 * @returns The newly created multi-pack index
 *
 * @example
 * ```typescript
 * const midx = await createMultiPackIndex(bucket, { prefix: 'repos/my-repo/' });
 * console.log(`Indexed ${midx.entries.length} objects`);
 * ```
 */
export declare function createMultiPackIndex(bucket: R2Bucket, options?: {
    prefix?: string;
}): Promise<MultiPackIndex>;
/**
 * Parses a multi-pack index from raw bytes.
 *
 * @description
 * Deserializes the binary MIDX format into a MultiPackIndex structure.
 * Validates the signature and format.
 *
 * @param data - Raw MIDX bytes
 * @returns Parsed multi-pack index
 *
 * @throws {R2PackError} With code 'INVALID_DATA' if format is invalid
 *
 * @example
 * ```typescript
 * const midxData = await bucket.get('packs/multi-pack-index');
 * if (midxData) {
 *   const midx = parseMultiPackIndex(new Uint8Array(await midxData.arrayBuffer()));
 *   console.log(`Contains ${midx.entries.length} objects`);
 * }
 * ```
 */
export declare function parseMultiPackIndex(data: Uint8Array): MultiPackIndex;
/**
 * Looks up an object in the multi-pack index using binary search.
 *
 * @description
 * Efficiently finds an object's location across all packs using O(log n)
 * binary search on the sorted entries.
 *
 * @param midx - Multi-pack index to search
 * @param objectId - 40-character hex SHA-1 object ID to find
 *
 * @returns Entry with pack index and offset, or null if not found
 *
 * @example
 * ```typescript
 * const midx = await storage.getMultiPackIndex();
 * const entry = lookupObjectInMultiPack(midx, 'abc123...');
 * if (entry) {
 *   const packId = midx.packIds[entry.packIndex];
 *   const offset = entry.offset;
 *   console.log(`Found in ${packId} at offset ${offset}`);
 * }
 * ```
 */
export declare function lookupObjectInMultiPack(midx: MultiPackIndex, objectId: string): MultiPackIndexEntry | null;
/**
 * Acquires a lock on a packfile.
 *
 * @description
 * Standalone function for acquiring a pack lock using distributed locking.
 *
 * @param bucket - R2 bucket instance
 * @param packId - Pack identifier to lock
 * @param options - Lock options and prefix
 *
 * @returns PackLock interface for managing the lock
 *
 * @throws {R2PackError} With code 'LOCKED' if lock cannot be acquired
 *
 * @example
 * ```typescript
 * const lock = await acquirePackLock(bucket, packId, {
 *   prefix: 'repos/my-repo/',
 *   timeout: 10000,
 *   ttl: 30000
 * });
 *
 * try {
 *   // Do work
 * } finally {
 *   await lock.release();
 * }
 * ```
 */
export declare function acquirePackLock(bucket: R2Bucket, packId: string, options?: AcquireLockOptions & {
    prefix?: string;
}): Promise<PackLock>;
/**
 * Releases a lock on a packfile.
 *
 * @description
 * Standalone function for releasing a pack lock.
 *
 * Note: This function requires a valid PackLock with a handle to properly
 * release distributed locks. For best results, use the lock.release() method
 * on the PackLock object returned from acquirePackLock.
 *
 * @param bucket - R2 bucket instance
 * @param packId - Pack identifier to unlock
 * @param options - Optional prefix configuration
 *
 * @example
 * ```typescript
 * // Preferred: use lock.release()
 * const lock = await acquirePackLock(bucket, packId);
 * await lock.release();
 *
 * // Alternative: use standalone function (less safe)
 * await releasePackLock(bucket, packId);
 * ```
 */
export declare function releasePackLock(bucket: R2Bucket, packId: string, options?: {
    prefix?: string;
}): Promise<void>;
/**
 * Gets the status of a lock on a packfile.
 *
 * @description
 * Standalone function for checking lock status without attempting acquisition.
 *
 * @param bucket - R2 bucket instance
 * @param packId - Pack identifier to check
 * @param options - Options including prefix and grace period
 *
 * @returns Lock status information, or null if no lock exists
 *
 * @example
 * ```typescript
 * const status = await getPackLockStatus(bucket, packId);
 * if (status?.isExpired) {
 *   console.log('Lock has expired');
 * }
 * if (status?.isStealable) {
 *   console.log('Lock can be stolen');
 * }
 * ```
 */
export declare function getPackLockStatus(bucket: R2Bucket, packId: string, options?: {
    prefix?: string;
    gracePeriodMs?: number;
}): Promise<{
    exists: boolean;
    isExpired: boolean;
    isStealable: boolean;
    holder?: string;
    expiresAt?: number;
    stolenCount?: number;
} | null>;
/**
 * Force-steals an expired lock on a packfile.
 *
 * @description
 * Standalone function for administrative recovery of stuck locks.
 * Only works on expired locks - will not steal active locks.
 *
 * @param bucket - R2 bucket instance
 * @param packId - Pack identifier to steal lock for
 * @param options - Options including prefix, TTL, and holder
 *
 * @returns PackLock if stolen successfully, throws if lock is active or doesn't exist
 *
 * @throws {R2PackError} With code 'LOCKED' if lock is still active
 * @throws {R2PackError} With code 'NOT_FOUND' if no lock exists
 *
 * @example
 * ```typescript
 * // Administrative recovery
 * try {
 *   const lock = await forceStealPackLock(bucket, packId, {
 *     ttl: 30000,
 *     holder: 'admin-recovery'
 *   });
 *   console.log('Lock stolen, proceeding with recovery');
 * } catch (error) {
 *   if (error.code === 'LOCKED') {
 *     console.log('Lock is still active');
 *   }
 * }
 * ```
 */
export declare function forceStealPackLock(bucket: R2Bucket, packId: string, options?: {
    prefix?: string;
    ttl?: number;
    holder?: string;
}): Promise<PackLock>;
//# sourceMappingURL=r2-pack.d.ts.map