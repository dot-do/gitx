/**
 * @fileoverview Git Delta Compression Implementation
 *
 * This module implements Git's delta compression format used in pack files.
 * Delta encoding allows storing objects as differences from a base object,
 * significantly reducing storage and transfer sizes.
 *
 * Delta format:
 * - Header: source size (varint), target size (varint)
 * - Instructions: sequence of copy/insert operations
 *
 * Copy instruction (MSB set):
 *   First byte: 1OOOOSSS where O = offset bytes present, S = size bytes present
 *   Following bytes: offset (little-endian), size (little-endian)
 *
 * Insert instruction (MSB clear):
 *   First byte: 0SSSSSSS where S = size (1-127)
 *   Following bytes: literal data to insert
 */
/** Delta instruction types */
export interface CopyInstruction {
    type: 'copy';
    offset: number;
    size: number;
}
export interface InsertInstruction {
    type: 'insert';
    data: Uint8Array;
}
export type DeltaInstruction = CopyInstruction | InsertInstruction;
/** Delta header containing source and target sizes */
export interface DeltaHeader {
    sourceSize: number;
    targetSize: number;
    bytesRead: number;
}
/** OFS_DELTA header (negative offset to base in same pack) */
export interface OfsDeltaHeader {
    offset: number;
    bytesRead: number;
}
/** REF_DELTA header (SHA reference to base object) */
export interface RefDeltaHeader {
    sha: Uint8Array;
    shaHex?: string;
    bytesRead: number;
}
/** Copy instruction marker (MSB set) */
export declare const COPY_INSTRUCTION = 128;
/** Insert instruction marker (MSB clear) */
export declare const INSERT_INSTRUCTION = 0;
/** OFS_DELTA object type in pack file */
export declare const OFS_DELTA = 6;
/** REF_DELTA object type in pack file */
export declare const REF_DELTA = 7;
/**
 * Parse a delta header size (varint format).
 * Each byte has 7 data bits and 1 continuation bit (MSB).
 * Uses multiplication instead of bit shifts to support large numbers.
 */
export declare function parseDeltaHeader(data: Uint8Array, offset: number): {
    size: number;
    bytesRead: number;
};
/**
 * Encode a size value as a varint for delta header.
 */
export declare function encodeDeltaHeader(size: number): Uint8Array;
/**
 * Encode a copy instruction.
 *
 * Format:
 * - First byte: 1OOOO SSS
 *   - Bit 7: always 1 (copy marker)
 *   - Bits 0-3: which offset bytes are present
 *   - Bits 4-6: which size bytes are present
 * - Following bytes: offset bytes (little-endian, only non-zero)
 * - Then: size bytes (little-endian, only non-zero)
 *
 * Special case: if size is 0x10000, no size bytes are written.
 */
export declare function encodeCopyInstruction(offset: number, size: number): Uint8Array;
/**
 * Decode a copy instruction from delta data.
 */
export declare function decodeCopyInstruction(data: Uint8Array, pos: number): {
    offset: number;
    size: number;
    bytesRead: number;
};
/**
 * Encode an insert instruction.
 * Inserts larger than 127 bytes are split into multiple instructions.
 */
export declare function encodeInsertInstruction(data: Uint8Array): Uint8Array;
/**
 * Decode an insert instruction from delta data.
 */
export declare function decodeInsertInstruction(data: Uint8Array, pos: number): {
    size: number;
    data: Uint8Array;
    bytesRead: number;
};
/**
 * Apply a delta to a base object to produce the target object.
 */
export declare function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array;
/**
 * Apply a chain of deltas to a base object.
 */
export declare function applyDeltaChain(base: Uint8Array, deltas: Uint8Array[]): Uint8Array;
/**
 * Create a delta that transforms base into target.
 *
 * This uses a simple sliding window algorithm to find matching sequences.
 * More sophisticated implementations would use hash-based matching.
 */
export declare function createDelta(base: Uint8Array, target: Uint8Array): Uint8Array;
/**
 * Encode an OFS_DELTA offset (negative offset encoding).
 *
 * The encoding uses a variable-length format where:
 * - First byte: 7 data bits, MSB indicates continuation
 * - Each subsequent byte contributes 7 bits to the value
 * - Value is accumulated as: (prev + 1) << 7 | next
 */
export declare function encodeOfsDelta(offset: number): Uint8Array;
/**
 * Decode an OFS_DELTA offset.
 */
export declare function decodeOfsDelta(data: Uint8Array, pos: number): {
    offset: number;
    bytesRead: number;
};
/**
 * Encode a REF_DELTA reference.
 */
export declare function encodeRefDelta(sha: Uint8Array, algorithm?: 'sha1' | 'sha256'): Uint8Array;
/**
 * Decode a REF_DELTA reference.
 */
export declare function decodeRefDelta(data: Uint8Array, pos: number, options?: {
    asHex?: boolean;
    algorithm?: 'sha1' | 'sha256';
}): RefDeltaHeader;
//# sourceMappingURL=delta.d.ts.map