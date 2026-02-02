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

import { buildR2Key } from './variant-codec'

/**
 * Reference to a large object stored in R2.
 */
export interface LargeObjectRef {
  /** Full R2 key */
  r2Key: string
  /** Object size in bytes */
  size: number
}

export interface LargeObjectStorageOptions {
  /** R2 key prefix (default: 'objects') */
  prefix?: string
}

/**
 * Manages upload/download of large git objects to R2.
 */
export class LargeObjectStorage {
  private _bucket: R2Bucket
  private _prefix: string

  constructor(bucket: R2Bucket, options?: LargeObjectStorageOptions) {
    this._bucket = bucket
    this._prefix = options?.prefix ?? 'objects'
  }

  /**
   * Upload a large object to R2. Deduplicates by SHA.
   */
  async upload(sha: string, data: Uint8Array | ReadableStream): Promise<LargeObjectRef> {
    const r2Key = buildR2Key(sha, this._prefix)

    // Deduplicate: skip if already exists
    const head = await this._bucket.head(r2Key)
    if (head) {
      return { r2Key, size: head.size }
    }

    const size = data instanceof Uint8Array ? data.length : -1
    await this._bucket.put(r2Key, data)

    // If we uploaded a stream, re-check size from head
    if (size === -1) {
      const h = await this._bucket.head(r2Key)
      return { r2Key, size: h?.size ?? 0 }
    }

    return { r2Key, size }
  }

  /**
   * Download a large object as Uint8Array. Returns null if missing.
   */
  async download(r2Key: string): Promise<Uint8Array | null> {
    const obj = await this._bucket.get(r2Key)
    if (!obj) return null
    return new Uint8Array(await obj.arrayBuffer())
  }

  /**
   * Download a large object as a ReadableStream. Returns null if missing.
   */
  async downloadStream(r2Key: string): Promise<ReadableStream | null> {
    const obj = await this._bucket.get(r2Key)
    if (!obj) return null
    return (obj as unknown as { body: ReadableStream }).body
  }

  /**
   * Check whether an R2 key exists.
   */
  async exists(r2Key: string): Promise<boolean> {
    const head = await this._bucket.head(r2Key)
    return head !== null
  }

  /**
   * Delete an object from R2.
   */
  async delete(r2Key: string): Promise<void> {
    await this._bucket.delete(r2Key)
  }
}
