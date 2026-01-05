/**
 * R2 Packfile Storage
 *
 * Manages Git packfiles stored in Cloudflare R2 object storage.
 * Provides functionality for:
 * - Uploading and downloading packfiles with their indices
 * - Multi-pack index (MIDX) for efficient object lookup across packs
 * - Concurrent access control with locking
 * - Pack verification and integrity checks
 */
/**
 * Configuration options for R2PackStorage
 */
export interface R2PackStorageOptions {
    /** R2 bucket instance */
    bucket: R2Bucket;
    /** Optional prefix for all keys (e.g., 'repos/my-repo/') */
    prefix?: string;
    /** Maximum number of items to cache (default: 100) */
    cacheSize?: number;
    /** Cache TTL in seconds (default: 3600) */
    cacheTTL?: number;
}
/**
 * Result of uploading a packfile
 */
export interface PackfileUploadResult {
    /** Unique identifier for the packfile */
    packId: string;
    /** Size of the pack file in bytes */
    packSize: number;
    /** Size of the index file in bytes */
    indexSize: number;
    /** SHA-1 checksum of the packfile */
    checksum: string;
    /** Number of objects in the packfile */
    objectCount: number;
    /** Timestamp when the packfile was uploaded */
    uploadedAt: Date;
}
/**
 * Metadata about a stored packfile
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
 * Options for downloading a packfile
 */
export interface DownloadPackfileOptions {
    /** Include the index file in the download */
    includeIndex?: boolean;
    /** Byte range to download (for partial reads) */
    byteRange?: {
        start: number;
        end: number;
    };
    /** Verify checksum on download */
    verify?: boolean;
    /** Throw if packfile not found (default: false, returns null) */
    required?: boolean;
}
/**
 * Result of downloading a packfile
 */
export interface DownloadPackfileResult {
    /** The packfile data */
    packData: Uint8Array;
    /** The index file data (if includeIndex was true) */
    indexData?: Uint8Array;
    /** Whether the checksum was verified */
    verified?: boolean;
}
/**
 * Options for uploading a packfile
 */
export interface UploadPackfileOptions {
    /** Number of retries on failure */
    retries?: number;
    /** Skip atomic upload (for testing/migration) */
    skipAtomic?: boolean;
}
/**
 * Pack manifest for atomic uploads
 * A manifest marks a pack as "complete" only after both pack and index are uploaded
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
    /** Timestamp when the pack was completed */
    completedAt: string;
    /** Status: 'staging' during upload, 'complete' when done */
    status: 'staging' | 'complete';
}
/**
 * Entry in the multi-pack index
 */
export interface MultiPackIndexEntry {
    /** 40-character hex SHA-1 object ID */
    objectId: string;
    /** Index of the pack in the packIds array */
    packIndex: number;
    /** Offset within the pack file */
    offset: number;
}
/**
 * Multi-pack index structure
 */
export interface MultiPackIndex {
    /** Version of the multi-pack index format */
    version: number;
    /** Array of pack IDs in this index */
    packIds: string[];
    /** Sorted entries for all objects across all packs */
    entries: MultiPackIndexEntry[];
    /** SHA-1 checksum of the index */
    checksum: Uint8Array;
}
/**
 * Handle for a distributed lock
 * Contains all information needed to release or refresh a lock
 */
export interface LockHandle {
    /** Resource that is locked */
    resource: string;
    /** Unique lock ID for this holder */
    lockId: string;
    /** ETag for conditional operations */
    etag: string;
    /** When the lock expires (ms since epoch) */
    expiresAt: number;
}
/**
 * Content stored in a lock file
 */
export interface LockFileContent {
    /** Unique lock ID */
    lockId: string;
    /** Resource being locked */
    resource: string;
    /** When the lock expires (ms since epoch) */
    expiresAt: number;
    /** When the lock was acquired (ms since epoch) */
    acquiredAt: number;
    /** Worker/process identifier (for debugging) */
    holder?: string;
}
/**
 * Lock on a packfile for write operations
 */
export interface PackLock {
    /** Pack ID that is locked */
    packId: string;
    /** Check if lock is still held */
    isHeld(): boolean;
    /** Release the lock */
    release(): Promise<void>;
    /** Refresh the lock TTL (returns true if successful) */
    refresh?(): Promise<boolean>;
    /** Get the underlying distributed lock handle */
    handle?: LockHandle;
}
/**
 * Options for acquiring a lock
 */
export interface AcquireLockOptions {
    /** Timeout in milliseconds to wait for lock */
    timeout?: number;
    /** TTL in milliseconds after which lock auto-expires */
    ttl?: number;
    /** Worker/process identifier for debugging */
    holder?: string;
}
/**
 * Result of listing packfiles
 */
export interface ListPackfilesResult {
    /** Array of packfile metadata */
    items: PackfileMetadata[];
    /** Cursor for pagination */
    cursor?: string;
}
/**
 * Error thrown by R2 pack operations
 */
export declare class R2PackError extends Error {
    readonly code: 'NOT_FOUND' | 'LOCKED' | 'INVALID_DATA' | 'CHECKSUM_MISMATCH' | 'NETWORK_ERROR';
    readonly packId?: string | undefined;
    constructor(message: string, code: 'NOT_FOUND' | 'LOCKED' | 'INVALID_DATA' | 'CHECKSUM_MISMATCH' | 'NETWORK_ERROR', packId?: string | undefined);
}
/**
 * R2 Packfile Storage class
 */
export declare class R2PackStorage {
    private _bucket;
    private _prefix;
    private _cacheTTL;
    private _midxCache;
    private _indexChecksums;
    constructor(options: R2PackStorageOptions);
    private _buildKey;
    /**
     * Upload a packfile and its index to R2 atomically
     *
     * Uses a manifest-based pattern to ensure atomic uploads:
     * 1. Upload pack and index to staging paths
     * 2. Create manifest in 'staging' status
     * 3. Copy from staging to final location
     * 4. Update manifest to 'complete' status
     * 5. Clean up staging files
     *
     * If the process fails at any point, the pack is not considered complete
     * until a valid manifest with status 'complete' exists.
     */
    uploadPackfile(packData: Uint8Array, indexData: Uint8Array, options?: UploadPackfileOptions): Promise<PackfileUploadResult>;
    /**
     * Get the manifest for a packfile
     */
    getPackManifest(packId: string): Promise<PackManifest | null>;
    /**
     * Check if a packfile upload is complete
     *
     * A pack is considered complete if:
     * 1. It has a manifest with status 'complete', OR
     * 2. It was uploaded before the atomic upload feature (legacy packs without manifest)
     *    AND both .pack and .idx files exist
     */
    isPackComplete(packId: string): Promise<boolean>;
    /**
     * Download a packfile from R2
     */
    downloadPackfile(packId: string, options?: DownloadPackfileOptions): Promise<DownloadPackfileResult | null>;
    /**
     * Get metadata for a packfile
     */
    getPackfileMetadata(packId: string): Promise<PackfileMetadata | null>;
    /**
     * List all packfiles
     */
    listPackfiles(options?: {
        limit?: number;
        cursor?: string;
    }): Promise<ListPackfilesResult & PackfileMetadata[]>;
    /**
     * Delete a packfile, its index, and manifest
     */
    deletePackfile(packId: string): Promise<boolean>;
    /**
     * Download just the index file for a packfile
     */
    downloadIndex(packId: string): Promise<Uint8Array | null>;
    /**
     * Upload a new index for an existing packfile
     */
    uploadIndex(packId: string, indexData: Uint8Array): Promise<void>;
    /**
     * Verify that an index matches its packfile
     */
    verifyIndex(packId: string): Promise<boolean>;
    /**
     * Clean up orphaned staging files
     *
     * This should be called on startup to clean up any staging files
     * left behind by failed uploads. It will:
     * 1. List all files in the staging directory
     * 2. For each pack ID found, check if it has a complete manifest
     * 3. If not complete, delete the staging files and any partial final files
     *
     * @returns Array of pack IDs that were cleaned up
     */
    cleanupOrphanedStagingFiles(): Promise<string[]>;
    /**
     * Rebuild the multi-pack index from all packfiles
     */
    rebuildMultiPackIndex(): Promise<void>;
    /**
     * Get the current multi-pack index
     */
    getMultiPackIndex(): Promise<MultiPackIndex>;
    /**
     * Acquire a distributed lock on a resource using R2 conditional writes
     * @param resource - Resource identifier to lock
     * @param ttlMs - Time-to-live in milliseconds (default: 30000)
     * @param holder - Optional identifier for the lock holder (for debugging)
     * @returns LockHandle if acquired, null if lock is held by another process
     */
    acquireDistributedLock(resource: string, ttlMs?: number, holder?: string): Promise<LockHandle | null>;
    /**
     * Release a distributed lock
     * @param handle - Lock handle returned from acquireDistributedLock
     */
    releaseDistributedLock(handle: LockHandle): Promise<void>;
    /**
     * Refresh a distributed lock to extend its TTL
     * @param handle - Lock handle to refresh
     * @param ttlMs - New TTL in milliseconds (default: 30000)
     * @returns true if refresh succeeded, false if lock was lost
     */
    refreshDistributedLock(handle: LockHandle, ttlMs?: number): Promise<boolean>;
    /**
     * Clean up expired locks from R2 storage
     * This should be called periodically to remove stale lock files
     * @returns Number of locks cleaned up
     */
    cleanupExpiredLocks(): Promise<number>;
    /**
     * Acquire a lock on a packfile (backward-compatible wrapper)
     * Uses distributed locking with R2 conditional writes
     */
    acquireLock(packId: string, options?: AcquireLockOptions): Promise<PackLock>;
}
/**
 * Upload a packfile to R2
 */
export declare function uploadPackfile(bucket: R2Bucket, packData: Uint8Array, indexData: Uint8Array, options?: {
    prefix?: string;
}): Promise<PackfileUploadResult>;
/**
 * Download a packfile from R2
 */
export declare function downloadPackfile(bucket: R2Bucket, packId: string, options?: DownloadPackfileOptions & {
    prefix?: string;
}): Promise<DownloadPackfileResult | null>;
/**
 * Get packfile metadata
 */
export declare function getPackfileMetadata(bucket: R2Bucket, packId: string, options?: {
    prefix?: string;
}): Promise<PackfileMetadata | null>;
/**
 * List all packfiles
 */
export declare function listPackfiles(bucket: R2Bucket, options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
}): Promise<PackfileMetadata[]>;
/**
 * Delete a packfile
 */
export declare function deletePackfile(bucket: R2Bucket, packId: string, options?: {
    prefix?: string;
}): Promise<boolean>;
/**
 * Create a multi-pack index from all packfiles in the bucket
 */
export declare function createMultiPackIndex(bucket: R2Bucket, options?: {
    prefix?: string;
}): Promise<MultiPackIndex>;
/**
 * Parse a multi-pack index from raw bytes
 */
export declare function parseMultiPackIndex(data: Uint8Array): MultiPackIndex;
/**
 * Look up an object in the multi-pack index using binary search
 */
export declare function lookupObjectInMultiPack(midx: MultiPackIndex, objectId: string): MultiPackIndexEntry | null;
/**
 * Acquire a lock on a packfile
 */
export declare function acquirePackLock(bucket: R2Bucket, packId: string, options?: AcquireLockOptions & {
    prefix?: string;
}): Promise<PackLock>;
/**
 * Release a lock on a packfile
 * Note: This function requires a valid PackLock with a handle to properly release distributed locks
 */
export declare function releasePackLock(bucket: R2Bucket, packId: string, options?: {
    prefix?: string;
}): Promise<void>;
//# sourceMappingURL=r2-pack.d.ts.map