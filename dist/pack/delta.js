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
export const COPY_INSTRUCTION = 0x80;
/** Insert instruction type marker (MSB clear) */
export const INSERT_INSTRUCTION = 0x00;
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
export function parseDeltaHeader(data, offset) {
    let size = 0;
    let shift = 0;
    let bytesRead = 0;
    // Maximum bytes for a varint to prevent infinite loops
    const MAX_VARINT_BYTES = 10;
    while (true) {
        if (offset + bytesRead >= data.length) {
            throw new Error(`Delta header parsing failed: unexpected end of data at offset ${offset + bytesRead}`);
        }
        if (bytesRead >= MAX_VARINT_BYTES) {
            throw new Error(`Delta header parsing failed: exceeded maximum length of ${MAX_VARINT_BYTES} bytes (possible infinite loop or corrupted data)`);
        }
        const byte = data[offset + bytesRead];
        bytesRead++;
        // Add the lower 7 bits to the result
        size |= (byte & 0x7f) << shift;
        shift += 7;
        // If MSB is not set, we're done
        if ((byte & 0x80) === 0) {
            break;
        }
    }
    return { size, bytesRead };
}
/**
 * Encode a size as a variable-length integer
 *
 * @param size The size to encode
 * @returns The encoded bytes
 */
function encodeDeltaSize(size) {
    const bytes = [];
    do {
        let byte = size & 0x7f;
        size >>>= 7;
        if (size > 0) {
            byte |= 0x80; // Set continuation bit
        }
        bytes.push(byte);
    } while (size > 0);
    return new Uint8Array(bytes);
}
/**
 * Apply a delta to a base object to produce the target object
 *
 * @param base The source/base object
 * @param delta The delta data
 * @returns The reconstructed target object
 * @throws Error if delta is invalid or sizes don't match
 */
export function applyDelta(base, delta) {
    let offset = 0;
    // Parse source size
    const sourceHeader = parseDeltaHeader(delta, offset);
    offset += sourceHeader.bytesRead;
    if (sourceHeader.size !== base.length) {
        throw new Error(`Delta source size mismatch: expected ${sourceHeader.size}, got ${base.length}`);
    }
    // Parse target size
    const targetHeader = parseDeltaHeader(delta, offset);
    offset += targetHeader.bytesRead;
    // Allocate result buffer
    const result = new Uint8Array(targetHeader.size);
    let resultOffset = 0;
    // Process instructions
    while (offset < delta.length) {
        const cmd = delta[offset++];
        if (cmd & COPY_INSTRUCTION) {
            // Copy instruction
            let copyOffset = 0;
            let copySize = 0;
            // Read offset bytes (bits 0-3 indicate which bytes are present)
            if (cmd & 0x01)
                copyOffset |= delta[offset++];
            if (cmd & 0x02)
                copyOffset |= delta[offset++] << 8;
            if (cmd & 0x04)
                copyOffset |= delta[offset++] << 16;
            if (cmd & 0x08)
                copyOffset |= delta[offset++] << 24;
            // Read size bytes (bits 4-6 indicate which bytes are present)
            if (cmd & 0x10)
                copySize |= delta[offset++];
            if (cmd & 0x20)
                copySize |= delta[offset++] << 8;
            if (cmd & 0x40)
                copySize |= delta[offset++] << 16;
            // Size of 0 means 0x10000 (65536)
            if (copySize === 0) {
                copySize = 0x10000;
            }
            // Bounds checking to prevent buffer overflows
            if (copyOffset < 0 || copySize < 0) {
                throw new Error(`Invalid copy instruction: offset=${copyOffset}, size=${copySize}`);
            }
            if (copyOffset + copySize > base.length) {
                throw new Error(`Copy instruction out of bounds: offset=${copyOffset}, size=${copySize}, base length=${base.length}`);
            }
            if (resultOffset + copySize > result.length) {
                throw new Error(`Copy would overflow result buffer: resultOffset=${resultOffset}, size=${copySize}, result length=${result.length}`);
            }
            // Copy from base to result
            result.set(base.subarray(copyOffset, copyOffset + copySize), resultOffset);
            resultOffset += copySize;
        }
        else if (cmd !== 0) {
            // Insert instruction: cmd is the number of bytes to insert
            const insertSize = cmd;
            result.set(delta.subarray(offset, offset + insertSize), resultOffset);
            offset += insertSize;
            resultOffset += insertSize;
        }
        else {
            // cmd === 0 is reserved/invalid
            throw new Error('Invalid delta instruction: 0x00');
        }
    }
    // Verify we produced the expected size
    if (resultOffset !== targetHeader.size) {
        throw new Error(`Delta result size mismatch: expected ${targetHeader.size}, got ${resultOffset}`);
    }
    return result;
}
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
export function createDelta(base, target) {
    const instructions = [];
    // Add source and target size headers
    instructions.push(encodeDeltaSize(base.length));
    instructions.push(encodeDeltaSize(target.length));
    if (target.length === 0) {
        // Empty target, just return headers
        return concatArrays(instructions);
    }
    if (base.length === 0) {
        // No base to copy from, insert everything
        emitInserts(instructions, target, 0, target.length);
        return concatArrays(instructions);
    }
    // Build hash table for base object
    // Key: 4-byte hash, Value: array of offsets
    const WINDOW_SIZE = 4;
    const hashTable = new Map();
    if (base.length >= WINDOW_SIZE) {
        for (let i = 0; i <= base.length - WINDOW_SIZE; i++) {
            const hash = hashBytes(base, i, WINDOW_SIZE);
            const offsets = hashTable.get(hash);
            if (offsets) {
                offsets.push(i);
            }
            else {
                hashTable.set(hash, [i]);
            }
        }
    }
    // Scan target and find matches
    let targetOffset = 0;
    let insertStart = 0;
    while (targetOffset < target.length) {
        let bestMatchOffset = -1;
        let bestMatchLength = 0;
        // Look for a match if we have enough bytes
        if (targetOffset <= target.length - WINDOW_SIZE) {
            const hash = hashBytes(target, targetOffset, WINDOW_SIZE);
            const candidates = hashTable.get(hash);
            if (candidates) {
                for (const baseOffset of candidates) {
                    // Verify the match and extend it
                    const matchLength = getMatchLength(base, baseOffset, target, targetOffset, Math.min(base.length - baseOffset, target.length - targetOffset));
                    if (matchLength >= WINDOW_SIZE && matchLength > bestMatchLength) {
                        bestMatchOffset = baseOffset;
                        bestMatchLength = matchLength;
                    }
                }
            }
        }
        // Minimum match length to be worth a copy instruction
        const MIN_COPY_SIZE = 4;
        if (bestMatchLength >= MIN_COPY_SIZE) {
            // Emit pending inserts
            if (targetOffset > insertStart) {
                emitInserts(instructions, target, insertStart, targetOffset);
            }
            // Emit copy instruction
            emitCopy(instructions, bestMatchOffset, bestMatchLength);
            targetOffset += bestMatchLength;
            insertStart = targetOffset;
        }
        else {
            targetOffset++;
        }
    }
    // Emit any remaining inserts
    if (target.length > insertStart) {
        emitInserts(instructions, target, insertStart, target.length);
    }
    return concatArrays(instructions);
}
/**
 * Simple hash function for a sequence of bytes
 */
function hashBytes(data, offset, length) {
    let hash = 0;
    for (let i = 0; i < length; i++) {
        hash = ((hash << 5) - hash + data[offset + i]) | 0;
    }
    return hash;
}
/**
 * Get the length of matching bytes between two arrays
 */
function getMatchLength(a, aOffset, b, bOffset, maxLength) {
    let length = 0;
    while (length < maxLength && a[aOffset + length] === b[bOffset + length]) {
        length++;
    }
    return length;
}
/**
 * Emit insert instructions for a range of bytes
 * Insert commands can only handle 1-127 bytes, so we may need multiple
 */
function emitInserts(instructions, data, start, end) {
    const MAX_INSERT = 127;
    let offset = start;
    while (offset < end) {
        const size = Math.min(MAX_INSERT, end - offset);
        const instruction = new Uint8Array(1 + size);
        instruction[0] = size; // Insert command: size in lower 7 bits
        instruction.set(data.subarray(offset, offset + size), 1);
        instructions.push(instruction);
        offset += size;
    }
}
/**
 * Emit a copy instruction
 */
function emitCopy(instructions, offset, size) {
    const bytes = [];
    let cmd = COPY_INSTRUCTION;
    // Encode offset bytes (little-endian)
    if (offset & 0xff) {
        cmd |= 0x01;
        bytes.push(offset & 0xff);
    }
    if (offset & 0xff00) {
        cmd |= 0x02;
        bytes.push((offset >> 8) & 0xff);
    }
    if (offset & 0xff0000) {
        cmd |= 0x04;
        bytes.push((offset >> 16) & 0xff);
    }
    if (offset & 0xff000000) {
        cmd |= 0x08;
        bytes.push((offset >> 24) & 0xff);
    }
    // Special case: if offset is 0, we don't emit any offset bytes
    // The cmd byte already indicates no offset bytes are present
    // Encode size bytes (little-endian)
    // Note: size of 0x10000 is encoded as no size bytes (all zero)
    if (size !== 0x10000) {
        if (size & 0xff) {
            cmd |= 0x10;
            bytes.push(size & 0xff);
        }
        if (size & 0xff00) {
            cmd |= 0x20;
            bytes.push((size >> 8) & 0xff);
        }
        if (size & 0xff0000) {
            cmd |= 0x40;
            bytes.push((size >> 16) & 0xff);
        }
    }
    // If size is 0x10000, we don't set any size bits, which encodes as size=0x10000
    const instruction = new Uint8Array(1 + bytes.length);
    instruction[0] = cmd;
    for (let i = 0; i < bytes.length; i++) {
        instruction[1 + i] = bytes[i];
    }
    instructions.push(instruction);
}
/**
 * Concatenate multiple Uint8Arrays into one
 */
function concatArrays(arrays) {
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
//# sourceMappingURL=delta.js.map