/**
 * @fileoverview VARIANT Codec for Git Objects
 *
 * Encodes and decodes Git objects to/from Parquet VARIANT format.
 * VARIANT allows storing semi-structured data (like git objects) in Parquet
 * while shredding commonly-queried fields into separate columns.
 *
 * Three storage modes:
 * - `inline`: Object data stored directly in VARIANT (< 1MB)
 * - `r2`: Reference to raw R2 object (> 1MB, non-LFS)
 * - `lfs`: LFS metadata in VARIANT, data in R2
 *
 * @module storage/variant-codec
 */
import type { ObjectType } from '../types/objects';
/** Maximum size for inline storage in VARIANT (1MB) */
export declare const INLINE_THRESHOLD: number;
/** Storage mode for a git object */
export type StorageMode = 'inline' | 'r2' | 'lfs';
/**
 * Encoded git object ready for Parquet storage.
 * Contains shredded fields + VARIANT-encoded data.
 */
export interface EncodedGitObject {
    /** SHA-1 hash */
    sha: string;
    /** Object type (commit, tree, blob, tag) */
    type: ObjectType;
    /** Object size in bytes */
    size: number;
    /** File path (for tree-walked objects, nullable) */
    path: string | null;
    /** Storage mode */
    storage: StorageMode;
    /** VARIANT-encoded data (metadata + value buffers) */
    data: {
        metadata: Uint8Array;
        value: Uint8Array;
    };
}
/**
 * Decoded git object from Parquet storage.
 */
export interface DecodedGitObject {
    sha: string;
    type: ObjectType;
    size: number;
    path: string | null;
    storage: StorageMode;
    /** Raw object content (for inline), or R2 key (for r2/lfs) */
    content: Uint8Array | string;
}
/**
 * Shredded commit fields (optional, for enriched storage).
 */
export interface ShreddedCommitFields {
    author_name?: string;
    author_date?: number;
    message?: string;
    tree_sha?: string;
    parent_shas?: string[];
}
/**
 * LFS pointer metadata parsed from a pointer file.
 */
export interface LfsPointer {
    oid: string;
    size: number;
}
/**
 * Detect storage mode for a git object.
 */
export declare function detectStorageMode(type: ObjectType, data: Uint8Array): StorageMode;
/**
 * Parse a Git LFS pointer file.
 *
 * @param data - Raw pointer file content
 * @returns Parsed LFS pointer or null if not a valid pointer
 */
export declare function parseLfsPointer(data: Uint8Array): LfsPointer | null;
/**
 * Build an R2 key for a large object.
 */
export declare function buildR2Key(sha: string, prefix?: string): string;
/**
 * Encode a git object for Parquet VARIANT storage.
 *
 * For inline objects, the VARIANT contains the raw binary data.
 * For R2 objects, the VARIANT contains a reference { r2_key, size }.
 * For LFS objects, the VARIANT contains LFS metadata { oid, size, r2_key }.
 */
export declare function encodeGitObject(sha: string, type: ObjectType, data: Uint8Array, options?: {
    path?: string;
    r2Prefix?: string;
}): EncodedGitObject;
/**
 * Extract shredded commit fields from raw commit data.
 *
 * These fields are stored as separate Parquet columns for efficient querying.
 */
export declare function extractCommitFields(data: Uint8Array): ShreddedCommitFields | null;
/**
 * Decode VARIANT metadata + value buffers back into a JavaScript value.
 *
 * This is the inverse of hyparquet-writer's encodeVariant().
 */
export declare function decodeVariant(metadata: Uint8Array, value: Uint8Array): unknown;
/**
 * Decode a git object from Parquet VARIANT storage.
 *
 * Reconstructs the original git object from the VARIANT-encoded data
 * plus the shredded column values (type, storage, etc.).
 *
 * For inline storage, returns the raw object bytes in content.
 * For r2/lfs storage, returns the R2 key as a string in content,
 * plus LFS metadata (oid, lfsSize) for lfs objects.
 */
export declare function decodeGitObject(sha: string, type: ObjectType, size: number, path: string | null, storage: StorageMode, variantMetadata: Uint8Array, variantValue: Uint8Array): DecodedGitObject;
/**
 * Encode multiple git objects into column-oriented arrays for Parquet writing.
 *
 * Returns parallel arrays suitable for hyparquet-writer's columnData format.
 */
export declare function encodeObjectBatch(objects: Array<{
    sha: string;
    type: ObjectType;
    data: Uint8Array;
    path?: string;
}>, options?: {
    r2Prefix?: string;
}): {
    shas: string[];
    types: string[];
    sizes: bigint[];
    paths: (string | null)[];
    storages: string[];
    variantData: Array<{
        metadata: Uint8Array;
        value: Uint8Array;
    }>;
    commitFields: Array<ShreddedCommitFields | null>;
};
//# sourceMappingURL=variant-codec.d.ts.map