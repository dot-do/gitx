/**
 * Git Packfile Format Implementation
 *
 * The packfile format is used by git for efficient storage and transfer of objects.
 * Format:
 * - 4 bytes: "PACK" signature
 * - 4 bytes: version number (network byte order, big-endian)
 * - 4 bytes: number of objects (network byte order)
 * - N objects: each object has header + compressed data
 * - 20 bytes: SHA-1 checksum of all preceding content
 *
 * Object header encoding:
 * - First byte: (MSB) continuation bit | 3-bit type | 4-bit size LSB
 * - Subsequent bytes: (MSB) continuation bit | 7-bit size
 *
 * Object types:
 * - 1: commit
 * - 2: tree
 * - 3: blob
 * - 4: tag
 * - 6: ofs_delta (offset delta)
 * - 7: ref_delta (reference delta)
 */
export declare const PACK_SIGNATURE = "PACK";
export declare const PACK_VERSION = 2;
export declare enum PackObjectType {
    OBJ_COMMIT = 1,
    OBJ_TREE = 2,
    OBJ_BLOB = 3,
    OBJ_TAG = 4,
    OBJ_OFS_DELTA = 6,
    OBJ_REF_DELTA = 7
}
export declare function packObjectTypeToString(type: PackObjectType): string;
export declare function stringToPackObjectType(str: string): PackObjectType;
export declare function encodeVarint(value: number): Uint8Array;
export declare function decodeVarint(data: Uint8Array, offset: number): {
    value: number;
    bytesRead: number;
};
/**
 * Encode object type and size into pack object header format
 *
 * First byte: MSB continuation bit | 3-bit type | 4-bit size LSB
 * Subsequent bytes: MSB continuation bit | 7-bit size continuation
 */
export declare function encodeTypeAndSize(type: PackObjectType, size: number): Uint8Array;
export declare function decodeTypeAndSize(data: Uint8Array, offset: number): {
    type: PackObjectType;
    size: number;
    bytesRead: number;
};
export interface PackHeader {
    signature: string;
    version: number;
    objectCount: number;
}
/**
 * Parse pack file header
 * @param data - The packfile data
 * @returns Parsed header information
 */
export declare function parsePackHeader(data: Uint8Array): PackHeader;
export interface ParsedPackObject {
    type: PackObjectType;
    size: number;
    headerSize: number;
}
/**
 * Parse individual pack object header
 * Note: This only parses the header, not the compressed data
 */
export declare function parsePackObject(data: Uint8Array, offset: number): ParsedPackObject;
export interface PackableObject {
    type: 'blob' | 'tree' | 'commit' | 'tag';
    data: Uint8Array;
}
/**
 * Create a packfile from a list of objects
 * @param objects - Array of objects to pack
 * @returns Complete packfile as Uint8Array
 */
export declare function createPackfile(objects: PackableObject[]): Uint8Array;
//# sourceMappingURL=format.d.ts.map