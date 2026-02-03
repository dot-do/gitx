/**
 * @fileoverview Git LFS Interop
 *
 * Handles LFS pointer detection, round-trip pointer generation,
 * LFS batch API endpoint handling, and OID-to-R2-key mapping.
 * Reuses parseLfsPointer from variant-codec.ts.
 *
 * @module storage/lfs-interop
 */
import { parseLfsPointer } from './variant-codec';
// Re-export for convenience
export { parseLfsPointer };
const encoder = new TextEncoder();
// ============================================================================
// Standalone helpers
// ============================================================================
/**
 * Map an LFS OID (sha256) to a content-addressable R2 key.
 */
export function mapLfsOidToR2Key(oid, prefix = 'lfs') {
    return `${prefix}/${oid.slice(0, 2)}/${oid.slice(2)}`;
}
/**
 * Generate a Git LFS pointer file from OID and size.
 */
export function generateLfsPointerFile(oid, size) {
    const text = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;
    return encoder.encode(text);
}
// ============================================================================
// LfsInterop class
// ============================================================================
/**
 * LFS interop layer backed by R2.
 */
export class LfsInterop {
    _bucket;
    _prefix;
    _baseUrl;
    constructor(bucket, options) {
        this._bucket = bucket;
        this._prefix = options?.prefix ?? 'lfs';
        this._baseUrl = options?.baseUrl ?? '/lfs/objects';
    }
    /**
     * Upload raw LFS object data. Deduplicates by OID.
     */
    async uploadLfsObject(oid, data) {
        const key = mapLfsOidToR2Key(oid, this._prefix);
        const head = await this._bucket.head(key);
        if (head)
            return; // already exists
        await this._bucket.put(key, data);
    }
    /**
     * Download LFS object data by OID. Returns null if missing.
     */
    async downloadLfsObject(oid) {
        const key = mapLfsOidToR2Key(oid, this._prefix);
        const obj = await this._bucket.get(key);
        if (!obj)
            return null;
        return new Uint8Array(await obj.arrayBuffer());
    }
    /**
     * Check if an LFS object exists.
     */
    async existsLfsObject(oid) {
        const key = mapLfsOidToR2Key(oid, this._prefix);
        const head = await this._bucket.head(key);
        return head !== null;
    }
    /**
     * Handle a Git LFS batch API request.
     * Supports both 'download' and 'upload' operations.
     */
    async handleBatchRequest(request) {
        const responseObjects = [];
        for (const obj of request.objects) {
            const exists = await this.existsLfsObject(obj.oid);
            if (request.operation === 'download') {
                if (exists) {
                    responseObjects.push({
                        oid: obj.oid,
                        size: obj.size,
                        actions: {
                            download: {
                                href: `${this._baseUrl}/${obj.oid}`,
                                expires_in: 3600,
                            },
                        },
                    });
                }
                else {
                    responseObjects.push({
                        oid: obj.oid,
                        size: obj.size,
                        error: { code: 404, message: 'Object not found' },
                    });
                }
            }
            else {
                // upload
                if (exists) {
                    // Already stored, no upload action needed
                    responseObjects.push({
                        oid: obj.oid,
                        size: obj.size,
                    });
                }
                else {
                    responseObjects.push({
                        oid: obj.oid,
                        size: obj.size,
                        actions: {
                            upload: {
                                href: `${this._baseUrl}/${obj.oid}`,
                                expires_in: 3600,
                            },
                        },
                    });
                }
            }
        }
        return { transfer: 'basic', objects: responseObjects };
    }
}
//# sourceMappingURL=lfs-interop.js.map