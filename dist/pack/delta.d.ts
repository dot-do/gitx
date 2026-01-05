/**
 * @fileoverview Git Packfile Delta Encoding/Decoding
 *
 * This module implements Git's delta compression algorithm, which is used in packfiles
 * to efficiently store objects by encoding only the differences between similar objects.
 *
 * ## Delta Format Overview
 *
 * A delta consists of:
 * 1. **Source size** - Variable-length integer specifying the base object size
 * 2. **Target size** - Variable-length integer specifying the result size
 * 3. **Instructions** - Sequence of copy or insert commands
 *
 * ## Instruction Types
 *
 * ### Copy Instruction (MSB = 1)
 * Copies a range of bytes from the source (base) object.
 *
 * | Bit    | Meaning                                   |
 * |--------|-------------------------------------------|
 * | 7      | Always 1 (copy marker)                    |
 * | 6-4    | Which size bytes follow (bit mask)        |
 * | 3-0    | Which offset bytes follow (bit mask)      |
 *
 * Following bytes encode offset (up to 4 bytes) and size (up to 3 bytes).
 * If size is 0 after decoding, it means 0x10000 (65536).
 *
 * ### Insert Instruction (MSB = 0)
 * Inserts literal bytes directly into the output.
 *
 * | Bit    | Meaning                                   |
 * |--------|-------------------------------------------|
 * | 7      | Always 0 (insert marker)                  |
 * | 6-0    | Number of bytes to insert (1-127)         |
 *
 * The instruction byte is followed by that many literal bytes.
 *
 * @module pack/delta
 * @see {@link https://git-scm.com/docs/pack-format} Git Pack Format Documentation
 *
 * @example
 * // Apply a delta to reconstruct an object
 * import { applyDelta } from './delta';
 *
 * const baseObject = getBaseObject();    // Uint8Array
 * const deltaData = getDeltaData();      // Uint8Array from packfile
 * const targetObject = applyDelta(baseObject, deltaData);
 *
 * @example
 * // Create a delta between two objects
 * import { createDelta } from './delta';
 *
 * const oldVersion = new TextEncoder().encode('Hello, World!');
 * const newVersion = new TextEncoder().encode('Hello, Universe!');
 * const delta = createDelta(oldVersion, newVersion);
 */
/**
 * Marker byte for copy instructions (MSB set).
 * When the MSB is set, the instruction copies bytes from the base object.
 *
 * @constant {number}
 */
export declare const COPY_INSTRUCTION = 128;
/**
 * Marker byte for insert instructions (MSB clear).
 * When the MSB is clear, the lower 7 bits indicate how many literal bytes follow.
 *
 * @constant {number}
 */
export declare const INSERT_INSTRUCTION = 0;
/**
 * Result of parsing a delta header (source or target size).
 *
 * @description Contains the decoded size value and the number of bytes
 * consumed during parsing. Used to track position while reading delta data.
 *
 * @interface DeltaHeaderResult
 */
export interface DeltaHeaderResult {
    /** The decoded size value */
    size: number;
    /** Number of bytes consumed from the input buffer */
    bytesRead: number;
}
/**
 * Represents a single decoded delta instruction.
 *
 * @description Used for analyzing or debugging deltas. Each instruction
 * is either a copy (from base object) or an insert (literal data).
 *
 * @interface DeltaInstruction
 *
 * @example
 * // A copy instruction
 * const copy: DeltaInstruction = {
 *   type: 'copy',
 *   offset: 100,  // Copy from base offset 100
 *   size: 50      // Copy 50 bytes
 * };
 *
 * @example
 * // An insert instruction
 * const insert: DeltaInstruction = {
 *   type: 'insert',
 *   size: 10,
 *   data: new Uint8Array([...])  // 10 literal bytes
 * };
 */
export interface DeltaInstruction {
    /** Instruction type: 'copy' from base or 'insert' literal bytes */
    type: 'copy' | 'insert';
    /** For copy: byte offset in the source/base object (undefined for insert) */
    offset?: number;
    /** Number of bytes to copy or insert */
    size: number;
    /** For insert: the literal bytes to insert (undefined for copy) */
    data?: Uint8Array;
}
/**
 * Parses a variable-length size value from the delta header.
 *
 * @description Reads the source or target size from a delta's header using
 * Git's variable-length integer encoding. Each byte's MSB indicates whether
 * more bytes follow, and the lower 7 bits contribute to the value.
 *
 * **Encoding Details:**
 * - Bytes are read sequentially
 * - Lower 7 bits of each byte contribute to the result
 * - MSB = 1 means more bytes follow
 * - MSB = 0 means this is the last byte
 * - Maximum of 10 bytes (supports values up to 2^70)
 *
 * @param {Uint8Array} data - The delta data buffer
 * @param {number} offset - Starting byte offset in the buffer
 * @returns {DeltaHeaderResult} Object with parsed size and bytes consumed
 * @throws {Error} If data ends unexpectedly before size is complete
 * @throws {Error} If size encoding exceeds maximum length (corrupted data)
 *
 * @example
 * // Parse source and target sizes from delta
 * let offset = 0;
 * const source = parseDeltaHeader(delta, offset);
 * offset += source.bytesRead;
 * const target = parseDeltaHeader(delta, offset);
 * offset += target.bytesRead;
 *
 * console.log(`Base size: ${source.size}, Target size: ${target.size}`);
 */
export declare function parseDeltaHeader(data: Uint8Array, offset: number): DeltaHeaderResult;
/**
 * Applies a delta to a base object to produce the target object.
 *
 * @description Reconstructs the target object by executing the delta's copy and
 * insert instructions against the base object. This is the core operation for
 * unpacking delta-compressed objects in packfiles.
 *
 * **Delta Application Process:**
 * 1. Parse source (base) size and verify it matches
 * 2. Parse target size to allocate result buffer
 * 3. Execute instructions sequentially:
 *    - Copy: copy bytes from base object to result
 *    - Insert: copy literal bytes from delta to result
 * 4. Verify result size matches expected target size
 *
 * **Error Conditions:**
 * - Base object size doesn't match delta's source size
 * - Copy instruction references bytes outside base object
 * - Instructions would overflow the result buffer
 * - Result size doesn't match delta's target size
 * - Invalid instruction byte (0x00)
 *
 * @param {Uint8Array} base - The source/base object to apply delta against
 * @param {Uint8Array} delta - The delta data (decompressed from packfile)
 * @returns {Uint8Array} The reconstructed target object
 * @throws {Error} If base size doesn't match delta's source size
 * @throws {Error} If delta contains invalid instructions
 * @throws {Error} If copy would read beyond base object bounds
 * @throws {Error} If result size doesn't match expected target size
 *
 * @example
 * // Reconstruct an object from base + delta
 * const base = await getObject(baseSha);
 * const delta = decompressDeltaData(packData, offset);
 * const target = applyDelta(base, delta);
 *
 * @example
 * // Error handling
 * try {
 *   const target = applyDelta(base, delta);
 * } catch (e) {
 *   console.error('Delta application failed:', e.message);
 * }
 */
export declare function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array;
/**
 * Creates a delta that transforms a base object into a target object.
 *
 * @description Generates delta instructions that can reconstruct the target
 * from the base object. Uses a hash-based algorithm to find matching sequences
 * and emits copy/insert instructions accordingly.
 *
 * **Algorithm:**
 * 1. Build a hash table of 4-byte sequences in the base object
 * 2. Scan through the target looking for matches in the hash table
 * 3. For each match found, verify and extend to maximum length
 * 4. Emit copy instructions for matches (4+ bytes)
 * 5. Emit insert instructions for non-matching data
 *
 * **Optimization Notes:**
 * - Uses 4-byte window for hash matching
 * - Minimum copy size is 4 bytes (smaller copies become inserts)
 * - Insert instructions are limited to 127 bytes each
 * - Empty base results in pure insert delta
 * - Empty target results in headers-only delta
 *
 * **Output Format:**
 * - Source size (varint)
 * - Target size (varint)
 * - Sequence of copy/insert instructions
 *
 * @param {Uint8Array} base - The source/base object
 * @param {Uint8Array} target - The target object to encode as delta
 * @returns {Uint8Array} The delta data (can be applied with {@link applyDelta})
 *
 * @example
 * // Create a delta for similar files
 * const v1 = new TextEncoder().encode('Hello, World!');
 * const v2 = new TextEncoder().encode('Hello, Universe!');
 * const delta = createDelta(v1, v2);
 *
 * // Delta should be smaller than v2 if there's good overlap
 * console.log(`Original: ${v2.length}, Delta: ${delta.length}`);
 *
 * @example
 * // Verify delta correctness
 * const reconstructed = applyDelta(v1, delta);
 * // reconstructed should equal v2
 */
export declare function createDelta(base: Uint8Array, target: Uint8Array): Uint8Array;
//# sourceMappingURL=delta.d.ts.map