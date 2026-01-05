/**
 * Git packfile delta encoding/decoding
 *
 * Git uses delta compression in packfiles to store objects efficiently.
 * A delta is a set of instructions to transform a base object into a target object.
 *
 * Delta format:
 * - Source (base) size: variable-length integer
 * - Target size: variable-length integer
 * - Instructions: sequence of copy or insert commands
 *
 * Instruction types:
 * - Copy (MSB=1): Copy bytes from source object
 *   Bits 0-3: which offset bytes are present
 *   Bits 4-6: which size bytes are present
 * - Insert (MSB=0): Insert literal bytes
 *   Bits 0-6: number of bytes to insert (1-127)
 */
/** Copy instruction type marker (MSB set) */
export declare const COPY_INSTRUCTION = 128;
/** Insert instruction type marker (MSB clear) */
export declare const INSERT_INSTRUCTION = 0;
/** Result of parsing a delta header */
export interface DeltaHeaderResult {
    size: number;
    bytesRead: number;
}
/** Delta instruction representation */
export interface DeltaInstruction {
    type: 'copy' | 'insert';
    offset?: number;
    size: number;
    data?: Uint8Array;
}
/**
 * Parse a variable-length size from delta header
 *
 * Git uses a variable-length encoding where each byte's MSB indicates
 * if more bytes follow. The lower 7 bits of each byte contribute to the value.
 *
 * @param data The delta data buffer
 * @param offset Starting offset in the buffer
 * @returns The parsed size and number of bytes consumed
 */
export declare function parseDeltaHeader(data: Uint8Array, offset: number): DeltaHeaderResult;
/**
 * Apply a delta to a base object to produce the target object
 *
 * @param base The source/base object
 * @param delta The delta data
 * @returns The reconstructed target object
 * @throws Error if delta is invalid or sizes don't match
 */
export declare function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array;
/**
 * Create a delta between two objects
 *
 * This uses a simple but effective algorithm:
 * 1. Build a hash table of 4-byte sequences in the base
 * 2. Scan the target looking for matches
 * 3. Emit copy instructions for matches, insert for non-matches
 *
 * @param base The source/base object
 * @param target The target object to encode
 * @returns The delta data
 */
export declare function createDelta(base: Uint8Array, target: Uint8Array): Uint8Array;
//# sourceMappingURL=delta.d.ts.map