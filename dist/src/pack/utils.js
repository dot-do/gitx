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
import { sha1 } from '../utils/sha1';
// =============================================================================
// Constants
// =============================================================================
/**
 * Default window size for delta compression.
 * Number of objects to consider as potential delta bases.
 * @constant {number}
 */
export const DEFAULT_WINDOW_SIZE = 10;
/**
 * Default maximum delta chain depth.
 * Prevents excessively deep chains that slow down object reconstruction.
 * @constant {number}
 */
export const DEFAULT_MAX_DELTA_DEPTH = 50;
/**
 * Default zlib compression level (0-9).
 * 6 is a good balance of speed and compression ratio.
 * @constant {number}
 */
export const DEFAULT_COMPRESSION_LEVEL = 6;
/**
 * Default minimum object size to consider for delta compression.
 * Objects smaller than this are stored as full objects.
 * @constant {number}
 */
export const DEFAULT_MIN_DELTA_SIZE = 50;
/**
 * Chunk size for processing large files (64KB).
 * Balances memory usage and cache efficiency.
 * @constant {number}
 */
export const CHUNK_SIZE = 64 * 1024;
// =============================================================================
// Array Utilities
// =============================================================================
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
export function concatArrays(arrays) {
    let totalLength = 0;
    for (const arr of arrays) {
        totalLength += arr.length;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
// =============================================================================
// Hex/Byte Conversion
// =============================================================================
/**
 * Converts a byte array to a lowercase hexadecimal string.
 *
 * @param {Uint8Array} bytes - The bytes to convert
 * @returns {string} Lowercase hexadecimal string representation
 *
 * @example
 * const hex = bytesToHex(sha1Hash); // '0beec7b5ea3f0fdbc95d0dd47f3c5bc275da8a33'
 */
export function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
/**
 * Converts a hexadecimal string to a byte array.
 *
 * @param {string} hex - The hex string to convert (must be even length)
 * @returns {Uint8Array} The decoded bytes
 *
 * @example
 * const bytes = hexToBytes('0beec7b5ea3f0fdbc95d0dd47f3c5bc275da8a33');
 */
export function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}
// =============================================================================
// Pack Header Utilities
// =============================================================================
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
export function createPackHeader(objectCount) {
    const header = new Uint8Array(12);
    // Signature: "PACK"
    header[0] = 0x50; // P
    header[1] = 0x41; // A
    header[2] = 0x43; // C
    header[3] = 0x4b; // K
    // Version: 2 (big-endian)
    header[4] = 0;
    header[5] = 0;
    header[6] = 0;
    header[7] = 2;
    // Object count (big-endian)
    header[8] = (objectCount >> 24) & 0xff;
    header[9] = (objectCount >> 16) & 0xff;
    header[10] = (objectCount >> 8) & 0xff;
    header[11] = objectCount & 0xff;
    return header;
}
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
export function computePackChecksum(data) {
    return sha1(data);
}
// =============================================================================
// Offset Encoding
// =============================================================================
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
export function encodeOffset(offset) {
    const bytes = [];
    // First byte: 7 bits of offset (no continuation)
    bytes.push(offset & 0x7f);
    offset >>>= 7;
    // Subsequent bytes: continuation bit + 7 bits
    // Subtract 1 to avoid ambiguity in encoding
    while (offset > 0) {
        offset -= 1;
        bytes.unshift((offset & 0x7f) | 0x80);
        offset >>>= 7;
    }
    return new Uint8Array(bytes);
}
// =============================================================================
// Similarity Calculation
// =============================================================================
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
export function calculateSimilarity(a, b) {
    if (a.length === 0 || b.length === 0)
        return 0;
    const windowSize = 4;
    if (a.length < windowSize || b.length < windowSize) {
        // For small objects, compare byte by byte
        let matches = 0;
        const minLen = Math.min(a.length, b.length);
        for (let i = 0; i < minLen; i++) {
            if (a[i] === b[i])
                matches++;
        }
        return matches / Math.max(a.length, b.length);
    }
    // Build hash set from 'a'
    const hashes = new Set();
    for (let i = 0; i <= a.length - windowSize; i++) {
        let hash = 0;
        for (let j = 0; j < windowSize; j++) {
            hash = ((hash << 5) - hash + (a[i + j] ?? 0)) | 0;
        }
        hashes.add(hash);
    }
    // Count matches in 'b'
    let matches = 0;
    for (let i = 0; i <= b.length - windowSize; i++) {
        let hash = 0;
        for (let j = 0; j < windowSize; j++) {
            hash = ((hash << 5) - hash + (b[i + j] ?? 0)) | 0;
        }
        if (hashes.has(hash))
            matches++;
    }
    return matches / Math.max(a.length - windowSize + 1, b.length - windowSize + 1);
}
// =============================================================================
// Type Ordering
// =============================================================================
/**
 * Standard type ordering for Git objects in pack files.
 * Commits first, then trees, blobs, tags, and finally delta types.
 * Used for general pack file generation.
 */
export const TYPE_ORDER = {
    1: 0, // OBJ_COMMIT
    2: 1, // OBJ_TREE
    3: 2, // OBJ_BLOB
    4: 3, // OBJ_TAG
    6: 4, // OBJ_OFS_DELTA
    7: 5 // OBJ_REF_DELTA
};
/**
 * Type ordering for dependency-based topological sort.
 * Blobs first, then trees, then commits (dependencies before dependents).
 * Used when ordering objects by their references.
 */
export const DEPENDENCY_TYPE_ORDER = {
    3: 0, // OBJ_BLOB
    2: 1, // OBJ_TREE
    4: 2, // OBJ_TAG
    1: 3, // OBJ_COMMIT
    6: 4, // OBJ_OFS_DELTA
    7: 5 // OBJ_REF_DELTA
};
//# sourceMappingURL=utils.js.map