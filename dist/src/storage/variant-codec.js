/**
 * @fileoverview VARIANT Codec for Git Objects
 *
 * Encodes and decodes Git objects to/from Parquet VARIANT format.
 * VARIANT allows storing semi-structured data (like git objects) in Parquet
 * while shredding commonly-queried fields into separate columns.
 *
 * Three storage modes:
 * - `inline`: Object data stored directly in VARIANT (< 1MB)
 * - `r2`: Reference to raw R2 object (> 1MB, non-LFS)
 * - `lfs`: LFS metadata in VARIANT, data in R2
 *
 * @module storage/variant-codec
 */
import { encodeVariant } from 'hyparquet-writer';
// ============================================================================
// Constants
// ============================================================================
/** Maximum size for inline storage in VARIANT (1MB) */
export const INLINE_THRESHOLD = 1024 * 1024;
/** Git LFS pointer file signature */
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';
// ============================================================================
// Encoding
// ============================================================================
const encoder = new TextEncoder();
const decoder = new TextDecoder();
/**
 * Detect storage mode for a git object.
 */
export function detectStorageMode(type, data) {
    // Check for LFS pointer (blob type, starts with LFS signature)
    if (type === 'blob' && data.length < 512) {
        const text = decoder.decode(data);
        if (text.startsWith(LFS_POINTER_PREFIX)) {
            return 'lfs';
        }
    }
    // Large objects go to R2
    if (data.length > INLINE_THRESHOLD) {
        return 'r2';
    }
    return 'inline';
}
/**
 * Parse a Git LFS pointer file.
 *
 * @param data - Raw pointer file content
 * @returns Parsed LFS pointer or null if not a valid pointer
 */
export function parseLfsPointer(data) {
    const text = decoder.decode(data);
    if (!text.startsWith(LFS_POINTER_PREFIX)) {
        return null;
    }
    const oidMatch = text.match(/oid sha256:([0-9a-f]{64})/);
    const sizeMatch = text.match(/size (\d+)/);
    const oid = oidMatch?.[1];
    const sizeStr = sizeMatch?.[1];
    if (!oid || !sizeStr) {
        return null;
    }
    return {
        oid,
        size: parseInt(sizeStr, 10),
    };
}
/**
 * Build an R2 key for a large object.
 */
export function buildR2Key(sha, prefix) {
    const p = prefix ?? 'objects';
    return `${p}/${sha.slice(0, 2)}/${sha.slice(2)}`;
}
/**
 * Encode a git object for Parquet VARIANT storage.
 *
 * For inline objects, the VARIANT contains the raw binary data.
 * For R2 objects, the VARIANT contains a reference { r2_key, size }.
 * For LFS objects, the VARIANT contains LFS metadata { oid, size, r2_key }.
 */
export function encodeGitObject(sha, type, data, options) {
    const storage = detectStorageMode(type, data);
    const path = options?.path ?? null;
    let variantPayload;
    switch (storage) {
        case 'inline':
            // Store raw bytes directly in VARIANT
            variantPayload = data;
            break;
        case 'r2': {
            // Store reference to R2 object
            const r2Key = buildR2Key(sha, options?.r2Prefix);
            variantPayload = { r2_key: r2Key, size: data.length };
            break;
        }
        case 'lfs': {
            // Store LFS metadata
            const pointer = parseLfsPointer(data);
            const r2Key = pointer
                ? `lfs/${pointer.oid.slice(0, 2)}/${pointer.oid.slice(2)}`
                : buildR2Key(sha, 'lfs');
            variantPayload = {
                r2_key: r2Key,
                oid: pointer?.oid ?? sha,
                size: pointer?.size ?? data.length,
                pointer: true,
            };
            break;
        }
    }
    const encoded = encodeVariant(variantPayload);
    return {
        sha,
        type,
        size: data.length,
        path,
        storage,
        data: { metadata: encoded.metadata, value: encoded.value },
    };
}
/**
 * Extract shredded commit fields from raw commit data.
 *
 * These fields are stored as separate Parquet columns for efficient querying.
 */
export function extractCommitFields(data) {
    const text = decoder.decode(data);
    const lines = text.split('\n');
    const fields = {};
    let messageStart = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined || line === '') {
            messageStart = i + 1;
            break;
        }
        if (line.startsWith('tree ')) {
            fields.tree_sha = line.slice(5);
        }
        else if (line.startsWith('parent ')) {
            if (!fields.parent_shas)
                fields.parent_shas = [];
            fields.parent_shas.push(line.slice(7));
        }
        else if (line.startsWith('author ')) {
            const match = line.match(/^author (.+) <.+> (\d+) [+-]\d{4}$/);
            const authorName = match?.[1];
            const authorDateStr = match?.[2];
            if (authorName && authorDateStr) {
                fields.author_name = authorName;
                fields.author_date = parseInt(authorDateStr, 10) * 1000; // to millis
            }
        }
    }
    if (messageStart >= 0) {
        fields.message = lines.slice(messageStart).join('\n');
    }
    // Must have at least tree_sha to be a valid commit
    return fields.tree_sha ? fields : null;
}
// ============================================================================
// Decoding
// ============================================================================
/**
 * Read an unsigned little-endian integer from a buffer.
 */
function readUnsigned(buf, pos, byteWidth) {
    let value = 0;
    for (let i = 0; i < byteWidth; i++) {
        const byte = buf[pos + i];
        if (byte !== undefined) {
            value |= byte << (i * 8);
        }
    }
    return value >>> 0; // unsigned
}
/**
 * Decode a VARIANT metadata buffer into a string dictionary.
 */
function decodeMetadata(metadata) {
    if (metadata.length < 2)
        return [];
    const header = metadata[0];
    if (header === undefined)
        return [];
    // header: version (4 bits), sorted (1 bit), offset_size_minus_one (2 bits)
    const offsetSize = ((header >> 6) & 0x03) + 1;
    const dictSize = readUnsigned(metadata, 1, offsetSize);
    if (dictSize === 0)
        return [];
    const offsetsStart = 1 + offsetSize;
    const stringsStart = offsetsStart + (dictSize + 1) * offsetSize;
    const dictionary = [];
    for (let i = 0; i < dictSize; i++) {
        const start = readUnsigned(metadata, offsetsStart + i * offsetSize, offsetSize);
        const end = readUnsigned(metadata, offsetsStart + (i + 1) * offsetSize, offsetSize);
        dictionary.push(decoder.decode(metadata.subarray(stringsStart + start, stringsStart + end)));
    }
    return dictionary;
}
/**
 * Decode a VARIANT value buffer into a JavaScript value.
 * Returns the decoded value and the number of bytes consumed.
 */
function decodeValue(value, pos, dictionary) {
    const header = value[pos];
    if (header === undefined) {
        throw new Error(`Invalid VARIANT: no header byte at position ${pos}`);
    }
    const basicType = header & 0x03;
    switch (basicType) {
        case 0: {
            // Primitive
            const typeId = (header >> 2) & 0x3F;
            return decodePrimitive(value, pos, typeId);
        }
        case 1: {
            // Short string
            const length = (header >> 2) & 0x3F;
            const str = decoder.decode(value.subarray(pos + 1, pos + 1 + length));
            return { result: str, bytesRead: 1 + length };
        }
        case 2: {
            // Object
            return decodeObject(value, pos, dictionary);
        }
        case 3: {
            // Array
            return decodeArray(value, pos, dictionary);
        }
        default:
            throw new Error(`Unknown VARIANT basic type: ${basicType}`);
    }
}
/**
 * Decode a VARIANT primitive value.
 */
function decodePrimitive(buf, pos, typeId) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    switch (typeId) {
        case 0: // null
            return { result: null, bytesRead: 1 };
        case 1: // true
            return { result: true, bytesRead: 1 };
        case 2: // false
            return { result: false, bytesRead: 1 };
        case 3: // INT8
            return { result: view.getInt8(pos + 1), bytesRead: 2 };
        case 4: // INT16
            return { result: view.getInt16(pos + 1, true), bytesRead: 3 };
        case 5: // INT32
            return { result: view.getInt32(pos + 1, true), bytesRead: 5 };
        case 6: // INT64
            return { result: Number(view.getBigInt64(pos + 1, true)), bytesRead: 9 };
        case 7: // DOUBLE
            return { result: view.getFloat64(pos + 1, true), bytesRead: 9 };
        case 12: // TIMESTAMP_MICROS
            return { result: Number(view.getBigInt64(pos + 1, true)) / 1000, bytesRead: 9 };
        case 16: {
            // Long string
            const length = view.getUint32(pos + 1, true);
            const str = decoder.decode(buf.subarray(pos + 5, pos + 5 + length));
            return { result: str, bytesRead: 5 + length };
        }
        default:
            throw new Error(`Unknown VARIANT primitive type_id: ${typeId}`);
    }
}
/**
 * Decode a VARIANT object value.
 */
function decodeObject(buf, pos, dictionary) {
    const header = buf[pos];
    if (header === undefined) {
        throw new Error(`Invalid VARIANT object: no header byte at position ${pos}`);
    }
    const offsetSize = ((header >> 2) & 0x03) + 1;
    const idSize = ((header >> 4) & 0x03) + 1;
    const isLarge = (header & 0x40) !== 0;
    let cursor = pos + 1;
    let numElements;
    if (isLarge) {
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        numElements = view.getUint32(cursor, true);
        cursor += 4;
    }
    else {
        const elem = buf[cursor];
        numElements = elem ?? 0;
        cursor += 1;
    }
    // Read field IDs
    const fieldIds = [];
    for (let i = 0; i < numElements; i++) {
        fieldIds.push(readUnsigned(buf, cursor, idSize));
        cursor += idSize;
    }
    // Read offsets
    const offsets = [];
    for (let i = 0; i <= numElements; i++) {
        offsets.push(readUnsigned(buf, cursor, offsetSize));
        cursor += offsetSize;
    }
    // Read values
    const valuesStart = cursor;
    const result = {};
    for (let i = 0; i < numElements; i++) {
        const fieldId = fieldIds[i];
        const offset = offsets[i];
        if (fieldId === undefined || offset === undefined)
            continue;
        const key = dictionary[fieldId] ?? String(fieldId);
        const decoded = decodeValue(buf, valuesStart + offset, dictionary);
        result[key] = decoded.result;
    }
    const lastOffset = offsets[numElements] ?? 0;
    const totalBytes = cursor - pos + lastOffset;
    return { result, bytesRead: totalBytes };
}
/**
 * Decode a VARIANT array value.
 */
function decodeArray(buf, pos, dictionary) {
    const header = buf[pos];
    if (header === undefined) {
        throw new Error(`Invalid VARIANT array: no header byte at position ${pos}`);
    }
    const offsetSize = ((header >> 2) & 0x03) + 1;
    const isLarge = (header & 0x10) !== 0;
    let cursor = pos + 1;
    let numElements;
    if (isLarge) {
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        numElements = view.getUint32(cursor, true);
        cursor += 4;
    }
    else {
        const elem = buf[cursor];
        numElements = elem ?? 0;
        cursor += 1;
    }
    // Read offsets
    const offsets = [];
    for (let i = 0; i <= numElements; i++) {
        offsets.push(readUnsigned(buf, cursor, offsetSize));
        cursor += offsetSize;
    }
    // Read values
    const valuesStart = cursor;
    const result = [];
    for (let i = 0; i < numElements; i++) {
        const offset = offsets[i];
        if (offset === undefined)
            continue;
        const decoded = decodeValue(buf, valuesStart + offset, dictionary);
        result.push(decoded.result);
    }
    const lastOffset = offsets[numElements] ?? 0;
    const totalBytes = cursor - pos + lastOffset;
    return { result, bytesRead: totalBytes };
}
/**
 * Decode VARIANT metadata + value buffers back into a JavaScript value.
 *
 * This is the inverse of hyparquet-writer's encodeVariant().
 *
 * @throws {Error} If VARIANT header is missing or malformed
 * @throws {Error} If VARIANT basic type is unknown
 * @throws {Error} If VARIANT primitive type_id is unknown
 */
export function decodeVariant(metadata, value) {
    const dictionary = decodeMetadata(metadata);
    const { result } = decodeValue(value, 0, dictionary);
    return result;
}
/**
 * Decode a git object from Parquet VARIANT storage.
 *
 * Reconstructs the original git object from the VARIANT-encoded data
 * plus the shredded column values (type, storage, etc.).
 *
 * For inline storage, returns the raw object bytes in content.
 * For r2/lfs storage, returns the R2 key as a string in content,
 * plus LFS metadata (oid, lfsSize) for lfs objects.
 *
 * @throws {Error} If VARIANT data is malformed (see decodeVariant)
 */
export function decodeGitObject(sha, type, size, path, storage, variantMetadata, variantValue) {
    const decoded = decodeVariant(variantMetadata, variantValue);
    switch (storage) {
        case 'inline': {
            // Inline: VARIANT contains the raw data encoded as an object with numeric keys
            // (because Uint8Array keys are "0","1","2",... when passed to encodeVariant)
            if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
                const obj = decoded;
                const keys = Object.keys(obj);
                // Check if this is a numeric-keyed object (serialized Uint8Array)
                if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
                    const bytes = new Uint8Array(keys.length);
                    for (const k of keys) {
                        bytes[Number(k)] = Number(obj[k]);
                    }
                    return { sha, type, size, path, storage, content: bytes };
                }
            }
            // Fallback: if it was somehow stored differently
            return { sha, type, size, path, storage, content: encoder.encode(String(decoded)) };
        }
        case 'r2': {
            // R2: VARIANT contains { r2_key, size }
            const obj = decoded;
            return { sha, type, size, path, storage, content: String(obj['r2_key']) };
        }
        case 'lfs': {
            // LFS: VARIANT contains { r2_key, oid, size, pointer }
            const obj = decoded;
            return { sha, type, size, path, storage, content: String(obj['r2_key']) };
        }
    }
}
/**
 * Encode multiple git objects into column-oriented arrays for Parquet writing.
 *
 * Returns parallel arrays suitable for hyparquet-writer's columnData format.
 */
export function encodeObjectBatch(objects, options) {
    const shas = [];
    const types = [];
    const sizes = [];
    const paths = [];
    const storages = [];
    const variantData = [];
    const commitFields = [];
    for (const obj of objects) {
        const encodeOptions = {};
        if (obj.path !== undefined)
            encodeOptions.path = obj.path;
        if (options?.r2Prefix !== undefined)
            encodeOptions.r2Prefix = options.r2Prefix;
        const encoded = encodeGitObject(obj.sha, obj.type, obj.data, encodeOptions);
        shas.push(encoded.sha);
        types.push(encoded.type);
        sizes.push(BigInt(encoded.size));
        paths.push(encoded.path);
        storages.push(encoded.storage);
        variantData.push(encoded.data);
        commitFields.push(obj.type === 'commit' ? extractCommitFields(obj.data) : null);
    }
    return { shas, types, sizes, paths, storages, variantData, commitFields };
}
//# sourceMappingURL=variant-codec.js.map