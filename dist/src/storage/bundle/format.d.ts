/**
 * @fileoverview R2 Bundle Format - Binary format for storing multiple git objects in a single R2 object
 *
 * Bundle Layout:
 * +----------------+
 * | Header (64B)   |  - Magic 'BNDL', version, entry count, index offset, checksum
 * +----------------+
 * | Entry 1 data   |  - Raw object data (variable size)
 * +----------------+
 * | Entry 2 data   |
 * +----------------+
 * | ...            |
 * +----------------+
 * | Index          |  - Sorted array of {oid, offset, size, type} for binary search
 * +----------------+
 *
 * Design notes:
 * - Header is fixed 64 bytes with XOR checksum for integrity
 * - Index is sorted by OID to enable O(log n) binary search lookups
 * - OIDs are stored as 20-byte binary SHA-1 (not hex) in index for compactness
 * - All multi-byte integers are big-endian
 * - Offsets are absolute (from bundle start) and use uint64 for large bundles
 *
 * @module storage/bundle/format
 */
/** Magic bytes identifying a bundle file */
export declare const BUNDLE_MAGIC = "BNDL";
/** Current bundle format version */
export declare const BUNDLE_VERSION = 1;
/** Fixed size of the bundle header in bytes */
export declare const BUNDLE_HEADER_SIZE = 64;
/** Size of each index entry: 20 (OID) + 8 (offset) + 4 (size) + 1 (type) = 33 bytes */
export declare const BUNDLE_INDEX_ENTRY_SIZE = 33;
/** Maximum number of entries a single bundle can hold (uint32 max) */
export declare const MAX_BUNDLE_ENTRIES = 4294967295;
/** Default maximum bundle size (128MB) */
export declare const DEFAULT_MAX_BUNDLE_SIZE: number;
/** Minimum viable bundle size (header only) */
export declare const MIN_BUNDLE_SIZE = 64;
/** Git object type encoded as a single byte in the bundle index */
export declare enum BundleObjectType {
    BLOB = 1,
    TREE = 2,
    COMMIT = 3,
    TAG = 4
}
/** Parsed bundle header */
export interface BundleHeader {
    /** Magic identifier ('BNDL') */
    magic: string;
    /** Format version */
    version: number;
    /** Number of entries in the bundle */
    entryCount: number;
    /** Byte offset where the index section starts */
    indexOffset: number;
    /** Total size of the bundle in bytes */
    totalSize: number;
    /** 16-byte XOR checksum */
    checksum: Uint8Array;
}
/** A single entry in the bundle index */
export interface BundleIndexEntry {
    /** 40-character hex SHA-1 OID */
    oid: string;
    /** Absolute byte offset of the object data from bundle start */
    offset: number;
    /** Size of the object data in bytes */
    size: number;
    /** Object type */
    type: BundleObjectType;
}
/** Complete parsed bundle (header + index + data reference) */
export interface Bundle {
    header: BundleHeader;
    entries: BundleIndexEntry[];
    data: Uint8Array;
}
/** A single git object extracted from a bundle */
export interface BundleObject {
    oid: string;
    type: BundleObjectType;
    data: Uint8Array;
}
/** Thrown when bundle format is invalid (wrong magic, version, etc.) */
export declare class BundleFormatError extends Error {
    constructor(message: string);
}
/** Thrown when bundle data integrity check fails */
export declare class BundleCorruptedError extends Error {
    constructor(message: string);
}
/** Thrown when bundle index is malformed */
export declare class BundleIndexError extends Error {
    constructor(message: string);
}
/** Convert 40-char hex OID to 20-byte binary */
export declare function oidToBytes(oid: string): Uint8Array;
/** Convert 20-byte binary to 40-char hex OID */
export declare function bytesToOid(bytes: Uint8Array): string;
/** Compute checksum over bundle excluding the checksum bytes (48-63) in header */
export declare function computeBundleChecksum(data: Uint8Array): Uint8Array;
/** Verify bundle checksum by comparing stored vs computed */
export declare function verifyBundleChecksum(bundleData: Uint8Array): boolean;
/** Parse a 64-byte bundle header */
export declare function parseBundleHeader(data: Uint8Array, options?: {
    verifyChecksum?: boolean;
}): BundleHeader;
/** Create a 64-byte bundle header */
export declare function createBundleHeader(options: {
    entryCount: number;
    indexOffset: number;
    totalSize: number;
}): Uint8Array;
/** Parse binary index data into sorted BundleIndexEntry array */
export declare function parseBundleIndex(data: Uint8Array, entryCount: number): BundleIndexEntry[];
/** Serialize sorted index entries to binary */
export declare function createBundleIndex(entries: BundleIndexEntry[]): Uint8Array;
/** Binary search for an entry by OID in a sorted entry array */
export declare function lookupEntryByOid(entries: BundleIndexEntry[], oid: string): BundleIndexEntry | null;
/** Create a complete bundle from an array of objects */
export declare function createBundle(objects: Array<{
    oid: string;
    type: BundleObjectType;
    data: Uint8Array;
}>): Uint8Array;
/** Parse a complete bundle from raw bytes */
export declare function parseBundle(data: Uint8Array, options?: {
    verify?: boolean;
}): Bundle;
/** Map git object type string to BundleObjectType enum */
export declare function objectTypeToBundleType(type: string): BundleObjectType;
/** Map BundleObjectType enum to git object type string */
export declare function bundleTypeToObjectType(type: BundleObjectType): string;
//# sourceMappingURL=format.d.ts.map