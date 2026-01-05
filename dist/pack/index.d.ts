/**
 * @fileoverview Git Pack Index (.idx) File Format Implementation
 *
 * This module implements the Git pack index (version 2) format, which provides
 * efficient random access to objects within a packfile. Without an index, finding
 * an object in a packfile would require scanning the entire file.
 *
 * ## Pack Index Version 2 Structure
 *
 * | Section                | Size                    | Description                                |
 * |------------------------|-------------------------|--------------------------------------------|
 * | Magic number           | 4 bytes                 | 0xff744f63 ("\377tOc")                     |
 * | Version                | 4 bytes                 | Version number (2)                         |
 * | Fanout table           | 256 * 4 bytes           | Cumulative object counts by first SHA byte |
 * | Object IDs             | N * 20 bytes            | Sorted SHA-1 hashes                        |
 * | CRC32 checksums        | N * 4 bytes             | CRC32 of each packed object                |
 * | 4-byte offsets         | N * 4 bytes             | Pack file offsets (or large offset index)  |
 * | 8-byte large offsets   | M * 8 bytes             | For objects beyond 2GB                     |
 * | Packfile checksum      | 20 bytes                | SHA-1 of the corresponding packfile        |
 * | Index checksum         | 20 bytes                | SHA-1 of this index file                   |
 *
 * ## Fanout Table
 *
 * The fanout table enables O(1) lookup of the range of objects starting with a given
 * byte value. `fanout[i]` contains the cumulative count of objects whose SHA-1 hash
 * starts with a byte <= i. This enables binary search within a narrow range.
 *
 * ## Large Offset Handling
 *
 * For packfiles larger than 2GB, offsets that don't fit in 4 bytes are stored in
 * a separate 8-byte table. The 4-byte offset slot contains an index into this table
 * with the MSB set to indicate it's an indirect reference.
 *
 * @module pack/index
 * @see {@link https://git-scm.com/docs/pack-format} Git Pack Format Documentation
 *
 * @example
 * // Parse an existing pack index
 * import { parsePackIndex, lookupObject } from './index';
 *
 * const indexData = await readFile('objects/pack/pack-abc123.idx');
 * const index = parsePackIndex(indexData);
 *
 * const entry = lookupObject(index, 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3');
 * if (entry) {
 *   console.log(`Object at offset ${entry.offset}`);
 * }
 */
import { PackObjectType } from './format';
/**
 * The 4-byte signature that identifies a version 2 pack index file.
 * The bytes are: 0xff 0x74 0x4f 0x63 (representing "\377tOc").
 *
 * Version 1 index files don't have this signature and start directly
 * with the fanout table.
 *
 * @constant {Uint8Array}
 */
export declare const PACK_INDEX_SIGNATURE: Uint8Array<ArrayBuffer>;
/**
 * The magic number as a 32-bit integer for easy comparison.
 * Equivalent to reading the first 4 bytes as big-endian uint32.
 *
 * @constant {number}
 */
export declare const PACK_INDEX_MAGIC = 4285812579;
/**
 * The pack index version number supported by this implementation.
 * Version 2 is the current standard and supports large packfiles (>2GB).
 *
 * @constant {number}
 */
export declare const PACK_INDEX_VERSION = 2;
/**
 * The byte threshold for using large offset encoding.
 * Offsets >= 2GB (0x80000000) require 8-byte storage.
 * In the 4-byte offset table, values with MSB set are indices
 * into the large offset table instead of direct offsets.
 *
 * @constant {number}
 */
export declare const LARGE_OFFSET_THRESHOLD = 2147483648;
/**
 * Represents a single entry in the pack index.
 *
 * @description Each entry contains the information needed to locate and verify
 * an object within the packfile. The pack index stores one entry per object,
 * sorted by object ID for efficient binary search.
 *
 * @interface PackIndexEntry
 *
 * @example
 * const entry: PackIndexEntry = {
 *   objectId: 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3',
 *   crc32: 0x12345678,
 *   offset: 1024
 * };
 */
export interface PackIndexEntry {
    /**
     * The 40-character hexadecimal SHA-1 object ID.
     * This is the primary identifier for the object.
     */
    objectId?: string;
    /**
     * Alias for objectId, provided for backward compatibility.
     * @deprecated Use objectId instead
     */
    sha?: string;
    /**
     * CRC32 checksum of the packed (compressed) object data.
     * Used to verify integrity without full decompression.
     */
    crc32: number;
    /**
     * Byte offset of the object within the packfile.
     * For large packfiles (>2GB), this may exceed 32-bit range.
     */
    offset: number;
}
/**
 * Represents a fully parsed pack index file.
 *
 * @description Contains all the information extracted from a .idx file,
 * including the fanout table for efficient lookups and all object entries.
 * This structure enables O(log n) object lookups using binary search.
 *
 * @interface PackIndex
 *
 * @example
 * // Parse and use a pack index
 * const index: PackIndex = parsePackIndex(indexData);
 * console.log(`Index contains ${index.objectCount} objects`);
 *
 * // Look up an object
 * const entry = lookupObject(index, objectSha);
 */
export interface PackIndex {
    /** Version number of the index format (should always be 2) */
    version: number;
    /** Total number of objects indexed (equals fanout[255]) */
    objectCount: number;
    /**
     * The 256-entry fanout table for O(1) range lookup.
     * fanout[i] = cumulative count of objects whose first SHA byte is <= i.
     * Used to narrow binary search to objects starting with a specific byte.
     */
    fanout: Uint32Array;
    /** Array of all index entries, sorted lexicographically by object ID */
    entries: PackIndexEntry[];
    /** SHA-1 checksum of the corresponding packfile (from pack trailer) */
    packChecksum: Uint8Array;
    /** SHA-1 checksum of this index file (for integrity verification) */
    indexChecksum: Uint8Array;
}
/**
 * Result of looking up an object in the pack index.
 *
 * @description Returned by lookup operations to indicate whether an object
 * was found and provide its entry information if so.
 *
 * @interface PackIndexLookupResult
 */
export interface PackIndexLookupResult {
    /** Whether the object was found in the index */
    found: boolean;
    /** The full entry if found, undefined otherwise */
    entry?: PackIndexEntry;
    /** Zero-based position in the sorted entry list (useful for iteration) */
    position?: number;
}
/**
 * Options for creating a pack index from a packfile.
 *
 * @description Configuration options passed to {@link createPackIndex}
 * when generating an index file from packfile data.
 *
 * @interface CreatePackIndexOptions
 */
export interface CreatePackIndexOptions {
    /** The complete packfile binary data to create an index for */
    packData: Uint8Array;
}
/**
 * Represents a parsed object from a packfile, used during indexing.
 *
 * @description Contains all the metadata needed to create an index entry
 * for an object. This is typically populated when parsing through a packfile
 * to build an index.
 *
 * @interface PackedObject
 */
export interface PackedObject {
    /** The 40-character hexadecimal SHA-1 hash identifying this object */
    objectId: string;
    /** The object type (commit, tree, blob, tag, or delta) */
    type: PackObjectType;
    /** Uncompressed size of the object data in bytes */
    size: number;
    /** Byte offset where this object starts in the packfile */
    offset: number;
    /** CRC32 checksum of the compressed object data (header + zlib stream) */
    crc32: number;
}
/**
 * Parses a pack index file (version 2 format).
 *
 * @description Parses the binary .idx file format and returns a structured
 * representation of the pack index. The function validates:
 * - Magic number and version
 * - Fanout table monotonicity
 * - Index checksum integrity
 *
 * **Performance:** This function parses the entire index into memory,
 * which is suitable for most use cases. For very large indexes,
 * consider streaming approaches.
 *
 * @param {Uint8Array} data - Raw bytes of the .idx file
 * @returns {PackIndex} Fully parsed pack index structure
 * @throws {Error} If the index data is too short
 * @throws {Error} If the magic signature is invalid
 * @throws {Error} If the version is not 2
 * @throws {Error} If the fanout table is not monotonically non-decreasing
 * @throws {Error} If the checksum verification fails
 *
 * @example
 * // Parse an index file
 * const indexData = await fs.readFile('pack-abc123.idx');
 * const index = parsePackIndex(indexData);
 *
 * console.log(`Version: ${index.version}`);
 * console.log(`Objects: ${index.objectCount}`);
 *
 * // Access entries
 * for (const entry of index.entries) {
 *   console.log(`${entry.objectId} at offset ${entry.offset}`);
 * }
 */
export declare function parsePackIndex(data: Uint8Array): PackIndex;
/**
 * Creates a pack index file from packfile data or pre-computed entries.
 *
 * @description Generates a valid .idx file that can be used to efficiently
 * locate objects within the corresponding packfile. Supports two calling conventions
 * for backward compatibility.
 *
 * **Generated Index Structure:**
 * - Version 2 header with magic number
 * - Fanout table computed from entry SHA prefixes
 * - Sorted object IDs (binary SHA-1)
 * - CRC32 checksums from entries
 * - Pack file offsets (4-byte or 8-byte for large files)
 * - Pack checksum (from pack trailer)
 * - Self-checksum (SHA-1 of entire index)
 *
 * @param {CreatePackIndexOptions | Uint8Array} optionsOrPackData - Either options object or packfile data (legacy)
 * @param {PackIndexEntry[]} [legacyEntries] - Pre-computed entries when using legacy calling convention
 * @returns {Uint8Array} Complete .idx file as binary data
 *
 * @example
 * // New style: from options
 * const indexData = createPackIndex({ packData: myPackfile });
 *
 * @example
 * // Legacy style: with pre-computed entries
 * const entries = [
 *   { objectId: 'abc123...', crc32: 0x12345678, offset: 100 }
 * ];
 * const indexData = createPackIndex(packData, entries);
 *
 * @example
 * // Write index to disk alongside packfile
 * const packName = 'pack-abc123';
 * await fs.writeFile(`${packName}.pack`, packData);
 * await fs.writeFile(`${packName}.idx`, createPackIndex({ packData }));
 */
export declare function createPackIndex(optionsOrPackData: CreatePackIndexOptions | Uint8Array, legacyEntries?: PackIndexEntry[]): Uint8Array;
/**
 * Looks up an object in the pack index by its SHA-1 hash.
 *
 * @description Performs an efficient O(log n) lookup using the fanout table
 * to narrow the search range, followed by binary search within that range.
 *
 * **Algorithm:**
 * 1. Use the first byte of the SHA to find the range via fanout table - O(1)
 * 2. Binary search within the range for exact match - O(log n)
 *
 * **Validation:**
 * - SHA must be exactly 40 characters
 * - SHA must contain valid hexadecimal characters
 * - Comparison is case-insensitive
 *
 * @param {PackIndex} index - The parsed pack index to search
 * @param {string} sha - The 40-character hexadecimal SHA-1 to find
 * @returns {PackIndexEntry | null} The entry if found, or null if not present
 * @throws {Error} If SHA is not exactly 40 characters
 * @throws {Error} If SHA contains no valid hex characters
 *
 * @example
 * // Look up an object
 * const entry = lookupObject(index, 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3');
 * if (entry) {
 *   console.log(`Found at offset ${entry.offset}`);
 * } else {
 *   console.log('Object not in this pack');
 * }
 *
 * @example
 * // With error handling
 * try {
 *   const entry = lookupObject(index, userInputSha);
 * } catch (e) {
 *   console.error('Invalid SHA format:', e.message);
 * }
 */
export declare function lookupObject(index: PackIndex, sha: string): PackIndexEntry | null;
/**
 * Verifies the integrity of a pack index file.
 *
 * @description Performs comprehensive validation of a .idx file including:
 * - Magic number verification (0xff744f63)
 * - Version validation (must be 2)
 * - Fanout table monotonicity check
 * - Object ID sort order verification
 * - SHA-1 checksum validation
 *
 * **Validation Order:**
 * The function validates structural integrity before checking the checksum,
 * allowing it to report more specific errors for corrupted data.
 *
 * @param {Uint8Array} data - Raw bytes of the .idx file
 * @returns {boolean} True if all validation checks pass
 * @throws {Error} If the index is too short
 * @throws {Error} If the magic signature is invalid
 * @throws {Error} If the version is not 2
 * @throws {Error} If the fanout table is not monotonically non-decreasing
 * @throws {Error} If object IDs are not in sorted order
 * @throws {Error} If the checksum doesn't match
 *
 * @example
 * // Verify before using an index
 * try {
 *   if (verifyPackIndex(indexData)) {
 *     const index = parsePackIndex(indexData);
 *     // Safe to use index
 *   }
 * } catch (e) {
 *   console.error('Corrupted index:', e.message);
 * }
 *
 * @example
 * // Quick validation check
 * const isValid = (() => {
 *   try { return verifyPackIndex(data); }
 *   catch { return false; }
 * })();
 */
export declare function verifyPackIndex(data: Uint8Array): boolean;
/**
 * Gets the range of entries that could match a given first byte.
 *
 * @description Uses the fanout table to find the start and end indices
 * for objects whose SHA-1 begins with the specified byte value. This
 * is used to narrow the search space before binary searching.
 *
 * The fanout table stores cumulative counts, so:
 * - `fanout[i]` = count of all objects with first byte <= i
 * - Range for byte `b` is [fanout[b-1], fanout[b])
 * - For byte 0, range is [0, fanout[0])
 *
 * @param {Uint32Array} fanout - The 256-entry fanout table
 * @param {number} firstByte - The first byte of the object ID (0-255)
 * @returns {{ start: number; end: number }} Start (inclusive) and end (exclusive) indices
 *
 * @example
 * // Find range for objects starting with 0xab
 * const { start, end } = getFanoutRange(index.fanout, 0xab);
 * // Now binary search entries[start..end)
 */
export declare function getFanoutRange(fanout: Uint32Array, firstByte: number): {
    start: number;
    end: number;
};
/**
 * Calculates the CRC32 checksum of data.
 *
 * @description Computes a CRC32 checksum using the IEEE 802.3 polynomial,
 * which is the same algorithm used by Git for pack index verification.
 * This checksum is stored in the pack index to verify object integrity
 * without full decompression.
 *
 * @param {Uint8Array} data - The data to checksum (typically compressed object data)
 * @returns {number} 32-bit unsigned CRC32 checksum
 *
 * @example
 * // Calculate CRC32 of compressed data
 * const compressed = pako.deflate(objectData);
 * const crc = calculateCRC32(compressed);
 * // Store crc in pack index entry
 */
export declare function calculateCRC32(data: Uint8Array): number;
/**
 * Performs binary search for an object ID within a range of entries.
 *
 * @description Searches for an exact match of the object ID within the
 * specified range of the sorted entries array. Uses string comparison
 * which works correctly for hexadecimal SHA-1 hashes.
 *
 * **Time Complexity:** O(log n) where n = end - start
 *
 * @param {PackIndexEntry[]} entries - Sorted array of pack index entries
 * @param {string} objectId - 40-character hex object ID (SHA) to search for
 * @param {number} start - Start index (inclusive)
 * @param {number} end - End index (exclusive)
 * @returns {number} Index of the entry if found, or -1 if not found
 *
 * @example
 * // Search within a specific range (from fanout lookup)
 * const { start, end } = getFanoutRange(index.fanout, 0xab);
 * const position = binarySearchObjectId(index.entries, targetSha, start, end);
 * if (position !== -1) {
 *   const entry = index.entries[position];
 * }
 */
export declare function binarySearchObjectId(entries: PackIndexEntry[], objectId: string, start: number, end: number): number;
/**
 * Alias for {@link binarySearchObjectId} for backward compatibility.
 * @deprecated Use binarySearchObjectId instead
 */
export declare const binarySearchSha: typeof binarySearchObjectId;
/**
 * Serializes a PackIndex structure to binary .idx format.
 *
 * @description Converts a structured PackIndex object into the binary format
 * used by Git for .idx files. This is the inverse of {@link parsePackIndex}.
 *
 * **Output Structure:**
 * 1. Magic number (4 bytes)
 * 2. Version (4 bytes)
 * 3. Fanout table (1024 bytes)
 * 4. Object IDs sorted (N * 20 bytes)
 * 5. CRC32 values (N * 4 bytes)
 * 6. 4-byte offsets (N * 4 bytes)
 * 7. 8-byte large offsets if needed
 * 8. Pack checksum (20 bytes)
 * 9. Index checksum (20 bytes) - computed during serialization
 *
 * @param {PackIndex} index - The pack index to serialize
 * @returns {Uint8Array} Complete .idx file as binary data
 *
 * @example
 * // Serialize an index after modifications
 * const index = parsePackIndex(originalData);
 * // ... modify index ...
 * const newData = serializePackIndex(index);
 */
export declare function serializePackIndex(index: PackIndex): Uint8Array;
/**
 * Parses the 256-entry fanout table from pack index data.
 *
 * @description The fanout table is a core data structure that enables O(1)
 * range lookup for binary search. Each entry stores the cumulative count
 * of objects whose first SHA byte is <= the entry index.
 *
 * **Table Properties:**
 * - 256 entries (one per possible first byte value)
 * - Each entry is 4 bytes, big-endian
 * - Values must be monotonically non-decreasing
 * - fanout[255] = total object count
 *
 * @param {Uint8Array} data - Raw bytes starting at the fanout table (1024 bytes minimum)
 * @returns {Uint32Array} 256-entry fanout table
 *
 * @example
 * // Parse fanout from index data
 * const fanoutData = indexData.subarray(8, 8 + 256 * 4);
 * const fanout = parseFanoutTable(fanoutData);
 * const totalObjects = fanout[255];
 */
export declare function parseFanoutTable(data: Uint8Array): Uint32Array;
/**
 * Reads a pack file offset from the index, handling both small and large offsets.
 *
 * @description Pack index offsets use a special encoding to support files > 2GB:
 * - If MSB is clear: the 4-byte value is the direct offset
 * - If MSB is set: the lower 31 bits are an index into the large offset table
 *
 * The large offset table stores 8-byte offsets for objects beyond the 2GB boundary.
 *
 * @param {Uint8Array} data - 4 bytes containing the offset or large offset index
 * @param {Uint8Array} [largeOffsets] - The 8-byte large offset table (required for offsets > 2GB)
 * @returns {number} The actual byte offset in the packfile
 * @throws {Error} If a large offset is indicated but largeOffsets is not provided
 * @throws {Error} If the large offset index is out of bounds
 *
 * @example
 * // Read offset for an entry
 * const offsetData = indexData.subarray(offsetsStart + i * 4, offsetsStart + (i + 1) * 4);
 * const offset = readPackOffset(offsetData, largeOffsetsTable);
 */
export declare function readPackOffset(data: Uint8Array, largeOffsets?: Uint8Array): number;
//# sourceMappingURL=index.d.ts.map