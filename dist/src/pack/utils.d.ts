/**
 * @fileoverview Shared Utility Functions for Git Packfile Operations
 *
 * This module provides common helper functions used across the packfile
 * implementation modules (format.ts, generation.ts, full-generation.ts,
 * delta.ts, index.ts). Centralizing these utilities eliminates duplication
 * and ensures consistent behavior.
 *
 * @module pack/utils
 */
/**
 * Default window size for delta compression.
 * Number of objects to consider as potential delta bases.
 * @constant {number}
 */
export declare const DEFAULT_WINDOW_SIZE = 10;
/**
 * Default maximum delta chain depth.
 * Prevents excessively deep chains that slow down object reconstruction.
 * @constant {number}
 */
export declare const DEFAULT_MAX_DELTA_DEPTH = 50;
/**
 * Default zlib compression level (0-9).
 * 6 is a good balance of speed and compression ratio.
 * @constant {number}
 */
export declare const DEFAULT_COMPRESSION_LEVEL = 6;
/**
 * Default minimum object size to consider for delta compression.
 * Objects smaller than this are stored as full objects.
 * @constant {number}
 */
export declare const DEFAULT_MIN_DELTA_SIZE = 50;
/**
 * Chunk size for processing large files (64KB).
 * Balances memory usage and cache efficiency.
 * @constant {number}
 */
export declare const CHUNK_SIZE: number;
/**
 * Concatenates multiple Uint8Arrays into a single array.
 *
 * @description Efficiently combines arrays by pre-calculating total length
 * and copying in a single pass. Used throughout packfile generation.
 *
 * @param {Uint8Array[]} arrays - Arrays to concatenate
 * @returns {Uint8Array} Combined array
 *
 * @example
 * const combined = concatArrays([header, body, checksum]);
 */
export declare function concatArrays(arrays: Uint8Array[]): Uint8Array;
/**
 * Converts a byte array to a lowercase hexadecimal string.
 *
 * @param {Uint8Array} bytes - The bytes to convert
 * @returns {string} Lowercase hexadecimal string representation
 *
 * @example
 * const hex = bytesToHex(sha1Hash); // '0beec7b5ea3f0fdbc95d0dd47f3c5bc275da8a33'
 */
export declare function bytesToHex(bytes: Uint8Array): string;
/**
 * Converts a hexadecimal string to a byte array.
 *
 * @param {string} hex - The hex string to convert (must be even length)
 * @returns {Uint8Array} The decoded bytes
 *
 * @example
 * const bytes = hexToBytes('0beec7b5ea3f0fdbc95d0dd47f3c5bc275da8a33');
 */
export declare function hexToBytes(hex: string): Uint8Array;
/**
 * Creates the 12-byte pack file header.
 *
 * @description Constructs a valid packfile header with:
 * - 4 bytes: "PACK" signature
 * - 4 bytes: version number (2) in big-endian
 * - 4 bytes: object count in big-endian
 *
 * @param {number} objectCount - Number of objects in the pack
 * @returns {Uint8Array} 12-byte header
 *
 * @example
 * const header = createPackHeader(100);
 */
export declare function createPackHeader(objectCount: number): Uint8Array;
/**
 * Computes the SHA-1 checksum of pack content.
 *
 * @description Calculates the 20-byte SHA-1 hash used as the pack's
 * checksum/trailer. This checksum is appended to the pack and also
 * referenced in the corresponding .idx file.
 *
 * @param {Uint8Array} data - The pack data to checksum
 * @returns {Uint8Array} 20-byte SHA-1 checksum
 *
 * @example
 * const checksum = computePackChecksum(packContent);
 */
export declare function computePackChecksum(data: Uint8Array): Uint8Array;
/**
 * Encodes an offset for OFS_DELTA using Git's variable-length format.
 *
 * @description Uses a special encoding where each byte after the first
 * must subtract 1 before shifting to avoid ambiguity. The result is
 * big-endian with MSB continuation bits.
 *
 * @param {number} offset - The byte offset to encode (must be positive)
 * @returns {Uint8Array} Encoded offset bytes
 *
 * @example
 * const encoded = encodeOffset(1234);
 */
export declare function encodeOffset(offset: number): Uint8Array;
/**
 * Calculates similarity between two byte arrays using hash-based comparison.
 *
 * @description Uses a sliding window hash approach: builds a hash set from
 * 4-byte sequences in the first array, then counts matching sequences in
 * the second. For small arrays, falls back to byte-by-byte comparison.
 *
 * This is used to determine if two objects are similar enough to benefit
 * from delta compression.
 *
 * @param {Uint8Array} a - First byte array
 * @param {Uint8Array} b - Second byte array
 * @returns {number} Similarity score between 0 and 1
 *
 * @example
 * const similarity = calculateSimilarity(oldVersion, newVersion);
 * if (similarity > 0.3) {
 *   // Good candidate for delta compression
 * }
 */
export declare function calculateSimilarity(a: Uint8Array, b: Uint8Array): number;
/**
 * Standard type ordering for Git objects in pack files.
 * Commits first, then trees, blobs, tags, and finally delta types.
 * Used for general pack file generation.
 */
export declare const TYPE_ORDER: Record<number, number>;
/**
 * Type ordering for dependency-based topological sort.
 * Blobs first, then trees, then commits (dependencies before dependents).
 * Used when ordering objects by their references.
 */
export declare const DEPENDENCY_TYPE_ORDER: Record<number, number>;
//# sourceMappingURL=utils.d.ts.map