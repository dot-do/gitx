/**
 * @fileoverview Git LFS Interop
 *
 * Handles LFS pointer detection, round-trip pointer generation,
 * LFS batch API endpoint handling, and OID-to-R2-key mapping.
 * Reuses parseLfsPointer from variant-codec.ts.
 *
 * @module storage/lfs-interop
 */
import { parseLfsPointer, type LfsPointer } from './variant-codec';
export { parseLfsPointer, type LfsPointer };
export interface LfsBatchRequestObject {
    oid: string;
    size: number;
}
export interface LfsBatchRequest {
    operation: 'download' | 'upload';
    objects: LfsBatchRequestObject[];
}
export interface LfsBatchResponseObject {
    oid: string;
    size: number;
    actions?: {
        download?: {
            href: string;
            header?: Record<string, string>;
            expires_in?: number;
        };
        upload?: {
            href: string;
            header?: Record<string, string>;
            expires_in?: number;
        };
        verify?: {
            href: string;
            header?: Record<string, string>;
            expires_in?: number;
        };
    };
    error?: {
        code: number;
        message: string;
    };
}
export interface LfsBatchResponse {
    transfer?: string;
    objects: LfsBatchResponseObject[];
}
export interface LfsInteropOptions {
    /** R2 key prefix for LFS objects (default: 'lfs') */
    prefix?: string;
    /** Base URL for generating download/upload hrefs */
    baseUrl?: string;
}
/**
 * Map an LFS OID (sha256) to a content-addressable R2 key.
 */
export declare function mapLfsOidToR2Key(oid: string, prefix?: string): string;
/**
 * Generate a Git LFS pointer file from OID and size.
 */
export declare function generateLfsPointerFile(oid: string, size: number): Uint8Array;
/**
 * LFS interop layer backed by R2.
 */
export declare class LfsInterop {
    private _bucket;
    private _prefix;
    private _baseUrl;
    constructor(bucket: R2Bucket, options?: LfsInteropOptions);
    /**
     * Upload raw LFS object data. Deduplicates by OID.
     */
    uploadLfsObject(oid: string, data: Uint8Array): Promise<void>;
    /**
     * Download LFS object data by OID. Returns null if missing.
     */
    downloadLfsObject(oid: string): Promise<Uint8Array | null>;
    /**
     * Check if an LFS object exists.
     */
    existsLfsObject(oid: string): Promise<boolean>;
    /**
     * Handle a Git LFS batch API request.
     * Supports both 'download' and 'upload' operations.
     */
    handleBatchRequest(request: LfsBatchRequest): Promise<LfsBatchResponse>;
}
//# sourceMappingURL=lfs-interop.d.ts.map