/**
 * @fileoverview R2 Large Object Storage Manager
 *
 * Manages storage of git objects > 1MB in Cloudflare R2 as raw blobs.
 * Uses content-addressable keys: `{prefix}/{sha[0:2]}/{sha[2:]}`.
 * Deduplicates by checking existence before upload.
 *
 * R2 Bucket: gitx-objects (R2 binding)
 * Key format: {prefix}/raw/{sha[0:2]}/{sha[2:]}
 *
 * Lifecycle Management:
 * - Objects are content-addressable (deduplication via SHA)
 * - Referenced objects: Permanent retention
 * - Orphaned objects: Cleaned by GarbageCollector with 14-day grace period
 * - R2 lifecycle: 90-day retention safety net (see r2-lifecycle-policies.json)
 *
 * @module storage/large-object
 */
/**
 * Reference to a large object stored in R2.
 */
export interface LargeObjectRef {
    /** Full R2 key */
    r2Key: string;
    /** Object size in bytes */
    size: number;
}
export interface LargeObjectStorageOptions {
    /** R2 key prefix (default: 'objects') */
    prefix?: string;
}
/**
 * Manages upload/download of large git objects to R2.
 */
export declare class LargeObjectStorage {
    private _bucket;
    private _prefix;
    constructor(bucket: R2Bucket, options?: LargeObjectStorageOptions);
    /**
     * Upload a large object to R2. Deduplicates by SHA.
     */
    upload(sha: string, data: Uint8Array | ReadableStream): Promise<LargeObjectRef>;
    /**
     * Download a large object as Uint8Array. Returns null if missing.
     */
    download(r2Key: string): Promise<Uint8Array | null>;
    /**
     * Download a large object as a ReadableStream. Returns null if missing.
     */
    downloadStream(r2Key: string): Promise<ReadableStream | null>;
    /**
     * Check whether an R2 key exists.
     */
    exists(r2Key: string): Promise<boolean>;
    /**
     * Delete an object from R2.
     */
    delete(r2Key: string): Promise<void>;
}
//# sourceMappingURL=large-object.d.ts.map