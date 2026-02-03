/**
 * @fileoverview Git Pack File Format Implementation
 *
 * This module implements parsing and creation of Git pack files.
 * Pack files are the primary format for storing and transferring Git objects.
 *
 * Pack file format:
 * - Header: "PACK" magic (4 bytes), version (4 bytes), object count (4 bytes)
 * - Objects: sequence of compressed objects with type/size headers
 * - Trailer: SHA-1 checksum of all preceding content (20 bytes)
 *
 * Pack index format (v2):
 * - Header: magic "\377tOc" (4 bytes), version (4 bytes)
 * - Fanout table: 256 x 4-byte cumulative counts
 * - SHA list: sorted SHA-1 hashes
 * - CRC32 list: CRC32 for each object
 * - Offset list: 4-byte offsets (or index into large offset table if MSB set)
 * - Large offset table: 8-byte offsets for files > 2GB
 * - Pack checksum: SHA-1 of pack file (20 bytes)
 * - Index checksum: SHA-1 of index content (20 bytes)
 */
export * from './delta';
/** Pack file magic signature */
export declare const PACK_MAGIC = "PACK";
/** Current pack file version */
export declare const PACK_VERSION = 2;
/** Pack index magic number (0xff744f63 = "\377tOc") */
export declare const PACK_INDEX_MAGIC = 4285812579;
/** Pack index version 2 */
export declare const PACK_INDEX_VERSION_2 = 2;
/** Threshold for large offsets (2GB) */
export declare const LARGE_OFFSET_THRESHOLD = 2147483648;
/** Git object types as encoded in pack files */
export declare enum PackObjectType {
    COMMIT = 1,
    TREE = 2,
    BLOB = 3,
    TAG = 4,
    OFS_DELTA = 6,
    REF_DELTA = 7
}
export declare const OBJ_COMMIT = PackObjectType.COMMIT;
export declare const OBJ_TREE = PackObjectType.TREE;
export declare const OBJ_BLOB = PackObjectType.BLOB;
export declare const OBJ_TAG = PackObjectType.TAG;
export declare const OBJ_OFS_DELTA = PackObjectType.OFS_DELTA;
export declare const OBJ_REF_DELTA = PackObjectType.REF_DELTA;
/** Pack file header */
export interface PackHeader {
    magic: string;
    version: number;
    objectCount: number;
}
/** Pack index entry */
export interface PackIndexEntry {
    sha?: string;
    offset: number;
    crc32: number;
}
/** Fanout table type */
export type FanoutTable = Uint32Array;
/** Complete pack index */
export interface PackIndex {
    version: number;
    objectCount: number;
    fanout: FanoutTable;
    entries: PackIndexEntry[];
    packChecksum: Uint8Array;
    indexChecksum: Uint8Array;
}
/** Parsed pack object */
export interface ParsedPackObject {
    type: number;
    size: number;
    data: Uint8Array;
    offset: number;
    sha?: string;
    crc32?: number;
}
/**
 * Parse a pack file header.
 */
export declare function parsePackHeader(data: Uint8Array, offset?: number): PackHeader;
/**
 * Create a pack file header.
 */
export declare function createPackHeader(objectCount: number): Uint8Array;
/**
 * Validate a pack file header.
 */
export declare function validatePackHeader(data: Uint8Array): boolean;
/**
 * Encode a variable-length size value.
 */
export declare function encodeVariableLengthSize(size: number): Uint8Array;
/**
 * Decode a variable-length size value.
 */
export declare function decodeVariableLengthSize(data: Uint8Array, offset: number): {
    value: number;
    bytesRead: number;
};
/**
 * Encode a pack object header (type + size).
 *
 * Format:
 * - First byte: CTTT SSSS (C=continuation, T=type, S=size bits 0-3)
 * - Subsequent bytes: CSSS SSSS (C=continuation, S=size bits)
 */
export declare function encodeObjectHeader(type: number, size: number): Uint8Array;
/**
 * Decode a pack object header.
 */
export declare function decodeObjectHeader(data: Uint8Array, offset: number): {
    type: number;
    size: number;
    bytesRead: number;
};
/**
 * Compute SHA-1 checksum of pack content.
 * Uses a pure JS implementation for synchronous operation.
 */
export declare function computePackChecksum(data: Uint8Array): Uint8Array;
/**
 * Verify pack file checksum.
 */
export declare function verifyPackChecksum(pack: Uint8Array): boolean;
/**
 * Parse a fanout table from raw bytes.
 */
export declare function parseFanoutTable(data: Uint8Array): FanoutTable;
/**
 * Create a fanout table from sorted entries.
 */
export declare function createFanoutTable(entries: PackIndexEntry[]): FanoutTable;
/**
 * Get the search range for a SHA from the fanout table.
 */
export declare function getFanoutRange(fanout: FanoutTable, firstByte: number): {
    start: number;
    end: number;
};
/**
 * Parse a pack index file (v2).
 */
export declare function parsePackIndex(data: Uint8Array): PackIndex;
/**
 * Create a pack index from entries.
 */
export declare function createPackIndex(entries: PackIndexEntry[], packChecksum: Uint8Array): Uint8Array;
/**
 * Serialize a pack index to bytes.
 */
export declare function serializePackIndex(index: PackIndex): Uint8Array;
/**
 * Look up an object in a pack index.
 */
export declare function lookupObjectInIndex(index: PackIndex, sha: string): PackIndexEntry | null;
/**
 * Calculate CRC32 checksum (IEEE 802.3 polynomial).
 */
export declare function calculateCRC32(data: Uint8Array): number;
/**
 * Check if an offset requires 8-byte encoding.
 */
export declare function isLargeOffset(offset: number): boolean;
/**
 * Read an 8-byte offset from buffer.
 */
export declare function readLargeOffset(data: Uint8Array, offset: number): number;
/**
 * Write an 8-byte offset to buffer.
 */
export declare function writeLargeOffset(data: Uint8Array, offset: number, value: number): void;
/**
 * Parse an OFS_DELTA offset encoding.
 */
export declare function parseDeltaOffset(data: Uint8Array, pos: number): {
    offset: number;
    bytesRead: number;
};
/**
 * Encode an OFS_DELTA offset.
 */
export declare function encodeDeltaOffset(offset: number): Uint8Array;
/**
 * Pack file parser.
 */
export declare class PackParser {
    private _data;
    private header;
    constructor(data: Uint8Array);
    getData(): Uint8Array;
    getHeader(): PackHeader;
    getObjectCount(): number;
}
/**
 * Iterator for pack objects.
 */
export declare class PackObjectIterator implements Iterable<ParsedPackObject> {
    private data;
    private header;
    constructor(data: Uint8Array);
    [Symbol.iterator](): Iterator<ParsedPackObject>;
}
/**
 * Pack file writer.
 */
export declare class PackWriter {
    private objects;
    addObject(type: number, data: Uint8Array): void;
    getObjectCount(): number;
    finalize(): Uint8Array;
}
//# sourceMappingURL=index.d.ts.map