/**
 * @fileoverview Git Pack Format Types and Utilities (Platform Agnostic)
 *
 * Re-exports from the core pack module with backward compatibility layer.
 *
 * @module @dotdo/gitx/pack
 */
// Re-export everything from the core pack module
export { 
// Constants
PACK_MAGIC, PACK_VERSION, PACK_INDEX_MAGIC, PACK_INDEX_VERSION_2, LARGE_OFFSET_THRESHOLD, 
// Pack object types
PackObjectType, OBJ_COMMIT, OBJ_TREE, OBJ_BLOB, OBJ_TAG, OBJ_OFS_DELTA, OBJ_REF_DELTA, 
// Pack header operations
parsePackHeader, createPackHeader, validatePackHeader, 
// Object header encoding/decoding
encodeVariableLengthSize, decodeVariableLengthSize, encodeObjectHeader, decodeObjectHeader, 
// Pack checksum
computePackChecksum, verifyPackChecksum, 
// Fanout table operations
parseFanoutTable, createFanoutTable, getFanoutRange, 
// Pack index operations
parsePackIndex, createPackIndex, serializePackIndex, lookupObjectInIndex, 
// CRC32 calculation
calculateCRC32, 
// Large offset handling
isLargeOffset, readLargeOffset, writeLargeOffset, 
// Delta offset encoding
parseDeltaOffset, encodeDeltaOffset, 
// Pack parser and writer
PackParser, PackObjectIterator, PackWriter, 
// Delta operations (from delta.ts)
applyDelta, createDelta, parseDeltaHeader, encodeDeltaHeader, encodeCopyInstruction, decodeCopyInstruction, encodeInsertInstruction, decodeInsertInstruction, applyDeltaChain, encodeOfsDelta, decodeOfsDelta, encodeRefDelta, decodeRefDelta, } from '../../core/pack';
// ============================================================================
// Legacy Constants
// ============================================================================
/**
 * Pack file signature bytes.
 */
export const PACK_SIGNATURE = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // 'PACK'
/**
 * Pack index signature bytes (v2).
 */
export const PACK_IDX_SIGNATURE = new Uint8Array([0xff, 0x74, 0x4f, 0x63]); // '\377tOc'
/**
 * Pack entry type numbers (3-bit encoding).
 */
export const PACK_TYPE_NUMBERS = {
    commit: 1,
    tree: 2,
    blob: 3,
    tag: 4,
    ofs_delta: 6,
    ref_delta: 7,
};
/**
 * Reverse mapping from type number to type name.
 */
export const PACK_NUMBER_TO_TYPE = {
    1: 'commit',
    2: 'tree',
    3: 'blob',
    4: 'tag',
    6: 'ofs_delta',
    7: 'ref_delta',
};
// ============================================================================
// Legacy Utility Functions
// ============================================================================
/**
 * Check if a pack entry type is a delta type.
 */
export function isDeltaType(type) {
    return type === 'ofs_delta' || type === 'ref_delta';
}
/**
 * Check if a pack entry type is a base object type.
 */
export function isBaseType(type) {
    return type === 'commit' || type === 'tree' || type === 'blob' || type === 'tag';
}
/**
 * Get the pack type number for an object type.
 */
export function getPackTypeNumber(type) {
    return PACK_TYPE_NUMBERS[type];
}
/**
 * Get the pack entry type from a type number.
 */
export function getPackEntryType(num) {
    return PACK_NUMBER_TO_TYPE[num] ?? null;
}
/**
 * Read a variable-length size from pack format.
 */
export function readPackSize(data, offset) {
    let byte = data[offset];
    if (byte === undefined) {
        return { type: 0, size: 0, newOffset: offset };
    }
    offset++;
    const type = (byte >> 4) & 0x07;
    let size = byte & 0x0f;
    let shift = 4;
    while (byte & 0x80) {
        byte = data[offset];
        if (byte === undefined)
            break;
        offset++;
        size |= (byte & 0x7f) << shift;
        shift += 7;
    }
    return { type, size, newOffset: offset };
}
/**
 * Read a variable-length offset for OFS_DELTA.
 */
export function readDeltaOffset(data, offset) {
    let byte = data[offset];
    if (byte === undefined) {
        return { deltaOffset: 0, newOffset: offset };
    }
    offset++;
    let deltaOffset = byte & 0x7f;
    while (byte & 0x80) {
        deltaOffset += 1;
        byte = data[offset];
        if (byte === undefined)
            break;
        offset++;
        deltaOffset = (deltaOffset << 7) | (byte & 0x7f);
    }
    return { deltaOffset, newOffset: offset };
}
/**
 * Read a variable-length integer from delta data.
 */
export function readDeltaSize(data, offset) {
    let size = 0;
    let shift = 0;
    let byte;
    do {
        byte = data[offset];
        if (byte === undefined)
            break;
        offset++;
        size |= (byte & 0x7f) << shift;
        shift += 7;
    } while (byte & 0x80);
    return { size, newOffset: offset };
}
/**
 * Parse delta instructions from delta data.
 */
export function parseDeltaInstructions(data) {
    let offset = 0;
    const { size: baseSize, newOffset: offset1 } = readDeltaSize(data, offset);
    offset = offset1;
    const { size: resultSize, newOffset: offset2 } = readDeltaSize(data, offset);
    offset = offset2;
    const instructions = [];
    while (offset < data.length) {
        const cmd = data[offset];
        if (cmd === undefined)
            break;
        offset++;
        if (cmd & 0x80) {
            let copyOffset = 0;
            let copySize = 0;
            if (cmd & 0x01) {
                copyOffset = data[offset++] ?? 0;
            }
            if (cmd & 0x02) {
                copyOffset |= (data[offset++] ?? 0) << 8;
            }
            if (cmd & 0x04) {
                copyOffset |= (data[offset++] ?? 0) << 16;
            }
            if (cmd & 0x08) {
                copyOffset |= (data[offset++] ?? 0) << 24;
            }
            if (cmd & 0x10) {
                copySize = data[offset++] ?? 0;
            }
            if (cmd & 0x20) {
                copySize |= (data[offset++] ?? 0) << 8;
            }
            if (cmd & 0x40) {
                copySize |= (data[offset++] ?? 0) << 16;
            }
            if (copySize === 0)
                copySize = 0x10000;
            instructions.push({
                type: 'copy',
                offset: copyOffset,
                length: copySize,
            });
        }
        else if (cmd > 0) {
            const insertData = data.slice(offset, offset + cmd);
            offset += cmd;
            instructions.push({
                type: 'insert',
                data: insertData,
                length: cmd,
            });
        }
        else {
            throw new Error('Invalid delta instruction: cmd byte is 0');
        }
    }
    return { baseSize, resultSize, instructions };
}
/**
 * Apply delta instructions to a base object (legacy API).
 * @deprecated Use applyDelta from core/pack/delta instead
 */
export function applyDeltaLegacy(base, delta) {
    if (base.length !== delta.baseSize) {
        throw new Error(`Base size mismatch: expected ${delta.baseSize}, got ${base.length}`);
    }
    const result = new Uint8Array(delta.resultSize);
    let resultOffset = 0;
    for (const instruction of delta.instructions) {
        if (instruction.type === 'copy') {
            const src = base.subarray(instruction.offset, instruction.offset + instruction.length);
            result.set(src, resultOffset);
            resultOffset += instruction.length;
        }
        else {
            result.set(instruction.data, resultOffset);
            resultOffset += instruction.data.length;
        }
    }
    if (resultOffset !== delta.resultSize) {
        throw new Error(`Result size mismatch: expected ${delta.resultSize}, got ${resultOffset}`);
    }
    return result;
}
//# sourceMappingURL=pack.js.map