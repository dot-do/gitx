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
import { buildR2Key } from './variant-codec';
/**
 * Manages upload/download of large git objects to R2.
 */
export class LargeObjectStorage {
    _bucket;
    _prefix;
    constructor(bucket, options) {
        this._bucket = bucket;
        this._prefix = options?.prefix ?? 'objects';
    }
    /**
     * Upload a large object to R2. Deduplicates by SHA.
     */
    async upload(sha, data) {
        const r2Key = buildR2Key(sha, this._prefix);
        // Deduplicate: skip if already exists
        const head = await this._bucket.head(r2Key);
        if (head) {
            return { r2Key, size: head.size };
        }
        const size = data instanceof Uint8Array ? data.length : -1;
        await this._bucket.put(r2Key, data);
        // If we uploaded a stream, re-check size from head
        if (size === -1) {
            const h = await this._bucket.head(r2Key);
            return { r2Key, size: h?.size ?? 0 };
        }
        return { r2Key, size };
    }
    /**
     * Download a large object as Uint8Array. Returns null if missing.
     */
    async download(r2Key) {
        const obj = await this._bucket.get(r2Key);
        if (!obj)
            return null;
        return new Uint8Array(await obj.arrayBuffer());
    }
    /**
     * Download a large object as a ReadableStream. Returns null if missing.
     */
    async downloadStream(r2Key) {
        const obj = await this._bucket.get(r2Key);
        if (!obj)
            return null;
        return obj.body;
    }
    /**
     * Check whether an R2 key exists.
     */
    async exists(r2Key) {
        const head = await this._bucket.head(r2Key);
        return head !== null;
    }
    /**
     * Delete an object from R2.
     */
    async delete(r2Key) {
        await this._bucket.delete(r2Key);
    }
}
//# sourceMappingURL=large-object.js.map