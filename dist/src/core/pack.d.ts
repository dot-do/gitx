/**
 * @fileoverview Git Pack Format Types and Utilities (Platform Agnostic)
 *
 * Re-exports from the core pack module with backward compatibility layer.
 *
 * @module @dotdo/gitx/pack
 */
export { PACK_MAGIC, PACK_VERSION, PACK_INDEX_MAGIC, PACK_INDEX_VERSION_2, LARGE_OFFSET_THRESHOLD, PackObjectType, OBJ_COMMIT, OBJ_TREE, OBJ_BLOB, OBJ_TAG, OBJ_OFS_DELTA, OBJ_REF_DELTA, type PackHeader, type PackIndexEntry, type FanoutTable, type PackIndex, type ParsedPackObject, parsePackHeader, createPackHeader, validatePackHeader, encodeVariableLengthSize, decodeVariableLengthSize, encodeObjectHeader, decodeObjectHeader, computePackChecksum, verifyPackChecksum, parseFanoutTable, createFanoutTable, getFanoutRange, parsePackIndex, createPackIndex, serializePackIndex, lookupObjectInIndex, calculateCRC32, isLargeOffset, readLargeOffset, writeLargeOffset, parseDeltaOffset, encodeDeltaOffset, PackParser, PackObjectIterator, PackWriter, applyDelta, createDelta, parseDeltaHeader, encodeDeltaHeader, type DeltaInstruction, type DeltaHeader, encodeCopyInstruction, decodeCopyInstruction, encodeInsertInstruction, decodeInsertInstruction, applyDeltaChain, encodeOfsDelta, decodeOfsDelta, encodeRefDelta, decodeRefDelta, } from '../../core/pack';
import type { ObjectType } from './objects';
/**
 * Type of entry in a pack file.
 * @deprecated Use PackObjectType enum from core/pack
 */
export type PackEntryType = 'commit' | 'tree' | 'blob' | 'tag' | 'ofs_delta' | 'ref_delta';
/**
 * A single entry in a pack file.
 * @deprecated Use ParsedPackObject from core/pack
 */
export interface PackEntry {
    type: PackEntryType;
    size: number;
    offset: number;
    baseOffset?: number;
    baseSha?: string;
    data?: Uint8Array;
}
/**
 * Delta instruction types.
 */
export type DeltaInstructionType = 'copy' | 'insert';
/**
 * Parsed delta data.
 */
export interface ParsedDelta {
    baseSize: number;
    resultSize: number;
    instructions: LegacyDeltaInstruction[];
}
/**
 * A delta instruction (legacy format).
 */
export interface LegacyDeltaInstruction {
    type: DeltaInstructionType;
    offset?: number;
    length?: number;
    data?: Uint8Array;
}
/**
 * Pack file signature bytes.
 */
export declare const PACK_SIGNATURE: Uint8Array<ArrayBuffer>;
/**
 * Pack index signature bytes (v2).
 */
export declare const PACK_IDX_SIGNATURE: Uint8Array<ArrayBuffer>;
/**
 * Pack entry type numbers (3-bit encoding).
 */
export declare const PACK_TYPE_NUMBERS: {
    readonly commit: 1;
    readonly tree: 2;
    readonly blob: 3;
    readonly tag: 4;
    readonly ofs_delta: 6;
    readonly ref_delta: 7;
};
/**
 * Reverse mapping from type number to type name.
 */
export declare const PACK_NUMBER_TO_TYPE: Record<number, PackEntryType>;
/**
 * Check if a pack entry type is a delta type.
 */
export declare function isDeltaType(type: PackEntryType): type is 'ofs_delta' | 'ref_delta';
/**
 * Check if a pack entry type is a base object type.
 */
export declare function isBaseType(type: PackEntryType): type is ObjectType;
/**
 * Get the pack type number for an object type.
 */
export declare function getPackTypeNumber(type: PackEntryType): number;
/**
 * Get the pack entry type from a type number.
 */
export declare function getPackEntryType(num: number): PackEntryType | null;
/**
 * Read a variable-length size from pack format.
 */
export declare function readPackSize(data: Uint8Array, offset: number): {
    type: number;
    size: number;
    newOffset: number;
};
/**
 * Read a variable-length offset for OFS_DELTA.
 */
export declare function readDeltaOffset(data: Uint8Array, offset: number): {
    deltaOffset: number;
    newOffset: number;
};
/**
 * Read a variable-length integer from delta data.
 */
export declare function readDeltaSize(data: Uint8Array, offset: number): {
    size: number;
    newOffset: number;
};
/**
 * Parse delta instructions from delta data.
 */
export declare function parseDeltaInstructions(data: Uint8Array): ParsedDelta;
/**
 * Apply delta instructions to a base object (legacy API).
 * @deprecated Use applyDelta from core/pack/delta instead
 */
export declare function applyDeltaLegacy(base: Uint8Array, delta: ParsedDelta): Uint8Array;
//# sourceMappingURL=pack.d.ts.map