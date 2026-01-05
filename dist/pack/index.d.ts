/**
 * Git Pack Index (.idx) File Format Implementation
 *
 * The pack index file provides a mechanism to efficiently locate objects
 * within a packfile without scanning the entire pack.
 *
 * Pack Index Version 2 Format:
 * - 4 bytes: magic number (0xff744f63 = "\377tOc")
 * - 4 bytes: version number (2)
 * - 256 * 4 bytes: fanout table (cumulative count of objects for each first byte)
 * - N * 20 bytes: sorted object IDs (N = total objects from fanout[255])
 * - N * 4 bytes: CRC32 checksums for each object
 * - N * 4 bytes: 4-byte pack file offsets
 * - M * 8 bytes: 8-byte pack file offsets for objects > 2GB (M = count of large offsets)
 * - 20 bytes: packfile SHA-1 checksum
 * - 20 bytes: index file SHA-1 checksum
 */
import { PackObjectType } from './format';
export declare const PACK_INDEX_SIGNATURE: Uint8Array<ArrayBuffer>;
export declare const PACK_INDEX_MAGIC = 4285812579;
export declare const PACK_INDEX_VERSION = 2;
export declare const LARGE_OFFSET_THRESHOLD = 2147483648;
/**
 * Represents a single entry in the pack index
 */
export interface PackIndexEntry {
    /** 40-character hex SHA-1 object ID (primary property name) */
    objectId?: string;
    /** 40-character hex SHA-1 object ID (alias for backward compatibility) */
    sha?: string;
    /** CRC32 checksum of the packed object data */
    crc32: number;
    /** Offset within the pack file */
    offset: number;
}
/**
 * Represents a parsed pack index file
 */
export interface PackIndex {
    /** Version number (should be 2) */
    version: number;
    /** Total number of objects in the index */
    objectCount: number;
    /** Fanout table: fanout[i] = cumulative count of objects with first byte <= i */
    fanout: Uint32Array;
    /** Array of all entries sorted by object ID */
    entries: PackIndexEntry[];
    /** SHA-1 checksum of the corresponding packfile */
    packChecksum: Uint8Array;
    /** SHA-1 checksum of the index file itself */
    indexChecksum: Uint8Array;
}
/**
 * Result of looking up an object in the pack index
 */
export interface PackIndexLookupResult {
    /** Whether the object was found */
    found: boolean;
    /** The entry if found */
    entry?: PackIndexEntry;
    /** Index position in the sorted list */
    position?: number;
}
/**
 * Options for creating a pack index
 */
export interface CreatePackIndexOptions {
    /** The packfile data to index */
    packData: Uint8Array;
}
/**
 * Parsed object from packfile for indexing
 */
export interface PackedObject {
    /** Object ID (SHA-1 hash) */
    objectId: string;
    /** Object type */
    type: PackObjectType;
    /** Uncompressed size */
    size: number;
    /** Offset in the packfile */
    offset: number;
    /** CRC32 of the compressed data */
    crc32: number;
}
/**
 * Parse a pack index file (version 2)
 *
 * @param data - Raw bytes of the .idx file
 * @returns Parsed pack index structure
 * @throws Error if the index is invalid or uses unsupported version
 */
export declare function parsePackIndex(data: Uint8Array): PackIndex;
/**
 * Create a pack index from a packfile
 *
 * Supports two calling conventions:
 * - createPackIndex(options: CreatePackIndexOptions) - new style
 * - createPackIndex(packData: Uint8Array, entries: PackIndexEntry[]) - legacy style
 *
 * @returns The raw bytes of the generated .idx file
 */
export declare function createPackIndex(optionsOrPackData: CreatePackIndexOptions | Uint8Array, legacyEntries?: PackIndexEntry[]): Uint8Array;
/**
 * Look up an object in the pack index by its SHA
 *
 * Uses binary search through the fanout table for efficient lookup.
 *
 * @param index - The parsed pack index
 * @param sha - The 40-character hex SHA to find
 * @returns The entry if found, or null if not found
 */
export declare function lookupObject(index: PackIndex, sha: string): PackIndexEntry | null;
/**
 * Verify the integrity of a pack index
 *
 * Checks:
 * - Magic number and version
 * - Fanout table consistency
 * - Object ID sorting
 * - SHA-1 checksums
 *
 * @param data - Raw bytes of the .idx file
 * @returns True if the index is valid
 * @throws Error with details if verification fails
 */
export declare function verifyPackIndex(data: Uint8Array): boolean;
/**
 * Get the range of entries in the fanout table for a given first byte
 *
 * @param fanout - The fanout table
 * @param firstByte - The first byte of the object ID (0-255)
 * @returns Start and end indices for binary search
 */
export declare function getFanoutRange(fanout: Uint32Array, firstByte: number): {
    start: number;
    end: number;
};
/**
 * Calculate CRC32 checksum for packed object data
 *
 * @param data - The compressed object data
 * @returns CRC32 checksum
 */
export declare function calculateCRC32(data: Uint8Array): number;
/**
 * Binary search for an object ID within a range of the index
 *
 * @param entries - Sorted array of pack index entries
 * @param objectId - Object ID (SHA) to search for
 * @param start - Start index (inclusive)
 * @param end - End index (exclusive)
 * @returns Index if found, or -1
 */
export declare function binarySearchObjectId(entries: PackIndexEntry[], objectId: string, start: number, end: number): number;
export declare const binarySearchSha: typeof binarySearchObjectId;
/**
 * Serialize a pack index to binary format
 *
 * @param index - The pack index to serialize
 * @returns Raw bytes of the .idx file
 */
export declare function serializePackIndex(index: PackIndex): Uint8Array;
/**
 * Parse the fanout table from pack index data
 *
 * @param data - Raw bytes starting at fanout table
 * @returns Parsed fanout table (256 entries)
 */
export declare function parseFanoutTable(data: Uint8Array): Uint32Array;
/**
 * Read a 4-byte big-endian offset from pack index
 *
 * If the MSB is set, it's an index into the large offset table.
 *
 * @param data - Raw bytes at offset position
 * @param largeOffsets - Large offset table (for >2GB offsets)
 * @returns The actual offset value
 */
export declare function readPackOffset(data: Uint8Array, largeOffsets?: Uint8Array): number;
//# sourceMappingURL=index.d.ts.map