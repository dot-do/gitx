/**
 * @fileoverview R2 Bundle Format - Binary format for storing multiple git objects in a single R2 object
 *
 * Bundle Layout:
 * +----------------+
 * | Header (64B)   |  - Magic 'BNDL', version, entry count, index offset, checksum
 * +----------------+
 * | Entry 1 data   |  - Raw object data (variable size)
 * +----------------+
 * | Entry 2 data   |
 * +----------------+
 * | ...            |
 * +----------------+
 * | Index          |  - Sorted array of {oid, offset, size, type} for binary search
 * +----------------+
 *
 * Design notes:
 * - Header is fixed 64 bytes with XOR checksum for integrity
 * - Index is sorted by OID to enable O(log n) binary search lookups
 * - OIDs are stored as 20-byte binary SHA-1 (not hex) in index for compactness
 * - All multi-byte integers are big-endian
 * - Offsets are absolute (from bundle start) and use uint64 for large bundles
 *
 * @module storage/bundle/format
 */
// ============================================================================
// Constants
// ============================================================================
/** Magic bytes identifying a bundle file */
export const BUNDLE_MAGIC = 'BNDL';
/** Current bundle format version */
export const BUNDLE_VERSION = 1;
/** Fixed size of the bundle header in bytes */
export const BUNDLE_HEADER_SIZE = 64;
/** Size of each index entry: 20 (OID) + 8 (offset) + 4 (size) + 1 (type) = 33 bytes */
export const BUNDLE_INDEX_ENTRY_SIZE = 33;
/** Maximum number of entries a single bundle can hold (uint32 max) */
export const MAX_BUNDLE_ENTRIES = 0xffffffff;
/** Default maximum bundle size (128MB) */
export const DEFAULT_MAX_BUNDLE_SIZE = 128 * 1024 * 1024;
/** Minimum viable bundle size (header only) */
export const MIN_BUNDLE_SIZE = BUNDLE_HEADER_SIZE;
// ============================================================================
// Enums
// ============================================================================
/** Git object type encoded as a single byte in the bundle index */
export var BundleObjectType;
(function (BundleObjectType) {
    BundleObjectType[BundleObjectType["BLOB"] = 1] = "BLOB";
    BundleObjectType[BundleObjectType["TREE"] = 2] = "TREE";
    BundleObjectType[BundleObjectType["COMMIT"] = 3] = "COMMIT";
    BundleObjectType[BundleObjectType["TAG"] = 4] = "TAG";
})(BundleObjectType || (BundleObjectType = {}));
// ============================================================================
// Error Classes
// ============================================================================
/** Thrown when bundle format is invalid (wrong magic, version, etc.) */
export class BundleFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BundleFormatError';
    }
}
/** Thrown when bundle data integrity check fails */
export class BundleCorruptedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BundleCorruptedError';
    }
}
/** Thrown when bundle index is malformed */
export class BundleIndexError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BundleIndexError';
    }
}
// ============================================================================
// OID Conversion Helpers
// ============================================================================
/** Convert 40-char hex OID to 20-byte binary */
export function oidToBytes(oid) {
    const bytes = new Uint8Array(20);
    for (let i = 0; i < 40; i += 2) {
        bytes[i / 2] = parseInt(oid.slice(i, i + 2), 16) || 0;
    }
    return bytes;
}
/** Convert 20-byte binary to 40-char hex OID */
export function bytesToOid(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
// ============================================================================
// Checksum Functions
// ============================================================================
/** Compute XOR checksum over data, spread across 16 bytes, mixed with length */
function computeChecksum(data, dataLength) {
    const checksum = new Uint8Array(16);
    for (let i = 0; i < data.length; i++) {
        const idx = i % 16;
        checksum[idx] = (checksum[idx] ?? 0) ^ (data[i] ?? 0);
    }
    checksum[0] = (checksum[0] ?? 0) ^ ((dataLength >> 24) & 0xff);
    checksum[1] = (checksum[1] ?? 0) ^ ((dataLength >> 16) & 0xff);
    checksum[2] = (checksum[2] ?? 0) ^ ((dataLength >> 8) & 0xff);
    checksum[3] = (checksum[3] ?? 0) ^ (dataLength & 0xff);
    return checksum;
}
/** Compute checksum over bundle excluding the checksum bytes (48-63) in header */
export function computeBundleChecksum(data) {
    const checksum = new Uint8Array(16);
    // Process bytes 0-47 (before checksum field)
    for (let i = 0; i < 48; i++) {
        const idx = i % 16;
        checksum[idx] = (checksum[idx] ?? 0) ^ (data[i] ?? 0);
    }
    // Process bytes 64+ (after header)
    for (let i = 64; i < data.length; i++) {
        const idx = i % 16;
        checksum[idx] = (checksum[idx] ?? 0) ^ (data[i] ?? 0);
    }
    // Mix in total length
    const len = data.length;
    checksum[0] = (checksum[0] ?? 0) ^ ((len >> 24) & 0xff);
    checksum[1] = (checksum[1] ?? 0) ^ ((len >> 16) & 0xff);
    checksum[2] = (checksum[2] ?? 0) ^ ((len >> 8) & 0xff);
    checksum[3] = (checksum[3] ?? 0) ^ (len & 0xff);
    return checksum;
}
/** Verify bundle checksum by comparing stored vs computed */
export function verifyBundleChecksum(bundleData) {
    const expected = bundleData.slice(48, 64);
    const computed = computeBundleChecksum(bundleData);
    if (computed.length !== expected.length)
        return false;
    for (let i = 0; i < computed.length; i++) {
        if ((computed[i] ?? 0) !== (expected[i] ?? 0))
            return false;
    }
    return true;
}
// ============================================================================
// Header Functions
// ============================================================================
/** Parse a 64-byte bundle header */
export function parseBundleHeader(data, options) {
    if (data.length < BUNDLE_HEADER_SIZE) {
        throw new BundleFormatError(`Header truncated: expected ${BUNDLE_HEADER_SIZE} bytes, got ${data.length}`);
    }
    const magic = String.fromCharCode(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0);
    if (magic !== BUNDLE_MAGIC) {
        throw new BundleFormatError(`Invalid magic bytes: expected 'BNDL', got '${magic}'`);
    }
    const version = ((data[4] ?? 0) << 24) | ((data[5] ?? 0) << 16) | ((data[6] ?? 0) << 8) | (data[7] ?? 0);
    if (version !== BUNDLE_VERSION) {
        throw new BundleFormatError(`Unsupported version: expected ${BUNDLE_VERSION}, got ${version}`);
    }
    const entryCount = (((data[8] ?? 0) << 24) | ((data[9] ?? 0) << 16) | ((data[10] ?? 0) << 8) | (data[11] ?? 0)) >>> 0;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const indexOffset = Number(view.getBigUint64(12, false));
    const totalSize = Number(view.getBigUint64(20, false));
    if (indexOffset > totalSize && totalSize > 0) {
        throw new BundleFormatError(`Invalid index offset: ${indexOffset} exceeds total size ${totalSize}`);
    }
    const checksum = data.slice(48, 64);
    if (options?.verifyChecksum) {
        const headerData = data.slice(0, 48);
        const computed = computeChecksum(headerData, headerData.length);
        for (let i = 0; i < computed.length; i++) {
            if ((computed[i] ?? 0) !== (checksum[i] ?? 0)) {
                throw new BundleCorruptedError('Header checksum verification failed');
            }
        }
    }
    return { magic, version, entryCount, indexOffset, totalSize, checksum };
}
/** Create a 64-byte bundle header */
export function createBundleHeader(options) {
    const header = new Uint8Array(BUNDLE_HEADER_SIZE);
    // Magic (bytes 0-3)
    header[0] = 0x42; // B
    header[1] = 0x4e; // N
    header[2] = 0x44; // D
    header[3] = 0x4c; // L
    // Version (bytes 4-7)
    header[7] = BUNDLE_VERSION;
    // Entry count (bytes 8-11)
    header[8] = (options.entryCount >> 24) & 0xff;
    header[9] = (options.entryCount >> 16) & 0xff;
    header[10] = (options.entryCount >> 8) & 0xff;
    header[11] = options.entryCount & 0xff;
    const view = new DataView(header.buffer);
    view.setBigUint64(12, BigInt(options.indexOffset), false);
    view.setBigUint64(20, BigInt(options.totalSize), false);
    // Compute header checksum (bytes 48-63)
    const checksumData = header.slice(0, 48);
    const checksum = computeChecksum(checksumData, checksumData.length);
    header.set(checksum, 48);
    return header;
}
// ============================================================================
// Index Functions
// ============================================================================
/** Parse binary index data into sorted BundleIndexEntry array */
export function parseBundleIndex(data, entryCount) {
    const expectedSize = entryCount * BUNDLE_INDEX_ENTRY_SIZE;
    if (data.length < expectedSize) {
        throw new BundleIndexError(`Index truncated: expected ${expectedSize} bytes for ${entryCount} entries, got ${data.length}`);
    }
    const entries = [];
    const seenOids = new Set();
    for (let i = 0; i < entryCount; i++) {
        const base = i * BUNDLE_INDEX_ENTRY_SIZE;
        const oidBytes = data.slice(base, base + 20);
        const oid = bytesToOid(oidBytes);
        if (seenOids.has(oid)) {
            throw new BundleIndexError(`Duplicate OID in index: ${oid}`);
        }
        seenOids.add(oid);
        const view = new DataView(data.buffer, data.byteOffset + base + 20, 8);
        const offset = Number(view.getBigUint64(0, false));
        const size = ((data[base + 28] ?? 0) << 24) |
            ((data[base + 29] ?? 0) << 16) |
            ((data[base + 30] ?? 0) << 8) |
            (data[base + 31] ?? 0);
        const type = data[base + 32] ?? 0;
        if (type < 1 || type > 4) {
            throw new BundleIndexError(`Invalid object type: ${type}`);
        }
        entries.push({ oid, offset, size, type });
    }
    entries.sort((a, b) => a.oid.localeCompare(b.oid));
    return entries;
}
/** Serialize sorted index entries to binary */
export function createBundleIndex(entries) {
    if (entries.length === 0)
        return new Uint8Array(0);
    const sorted = [...entries].sort((a, b) => a.oid.localeCompare(b.oid));
    const indexData = new Uint8Array(sorted.length * BUNDLE_INDEX_ENTRY_SIZE);
    for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        const base = i * BUNDLE_INDEX_ENTRY_SIZE;
        indexData.set(oidToBytes(entry.oid), base);
        const view = new DataView(indexData.buffer, base + 20, 8);
        view.setBigUint64(0, BigInt(entry.offset), false);
        indexData[base + 28] = (entry.size >> 24) & 0xff;
        indexData[base + 29] = (entry.size >> 16) & 0xff;
        indexData[base + 30] = (entry.size >> 8) & 0xff;
        indexData[base + 31] = entry.size & 0xff;
        indexData[base + 32] = entry.type;
    }
    return indexData;
}
/** Binary search for an entry by OID in a sorted entry array */
export function lookupEntryByOid(entries, oid) {
    if (entries.length === 0)
        return null;
    let left = 0;
    let right = entries.length - 1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const midEntry = entries[mid];
        const cmp = oid.localeCompare(midEntry.oid);
        if (cmp === 0)
            return midEntry;
        if (cmp < 0)
            right = mid - 1;
        else
            left = mid + 1;
    }
    return null;
}
// ============================================================================
// Bundle Assembly / Parsing
// ============================================================================
/** Create a complete bundle from an array of objects */
export function createBundle(objects) {
    if (objects.length === 0) {
        const header = createBundleHeader({
            entryCount: 0,
            indexOffset: BUNDLE_HEADER_SIZE,
            totalSize: BUNDLE_HEADER_SIZE,
        });
        const bundleChecksum = computeBundleChecksum(header);
        header.set(bundleChecksum, 48);
        return header;
    }
    const sorted = [...objects].sort((a, b) => a.oid.localeCompare(b.oid));
    let dataSize = 0;
    for (const obj of sorted)
        dataSize += obj.data.length;
    const indexSize = sorted.length * BUNDLE_INDEX_ENTRY_SIZE;
    const totalSize = BUNDLE_HEADER_SIZE + dataSize + indexSize;
    const indexOffset = BUNDLE_HEADER_SIZE + dataSize;
    const header = createBundleHeader({ entryCount: sorted.length, indexOffset, totalSize });
    const entries = [];
    const dataSection = new Uint8Array(dataSize);
    let offset = 0;
    for (const obj of sorted) {
        dataSection.set(obj.data, offset);
        entries.push({
            oid: obj.oid,
            offset: BUNDLE_HEADER_SIZE + offset,
            size: obj.data.length,
            type: obj.type,
        });
        offset += obj.data.length;
    }
    const index = createBundleIndex(entries);
    const bundle = new Uint8Array(totalSize);
    bundle.set(header, 0);
    bundle.set(dataSection, BUNDLE_HEADER_SIZE);
    bundle.set(index, indexOffset);
    const bundleChecksum = computeBundleChecksum(bundle);
    bundle.set(bundleChecksum, 48);
    return bundle;
}
/** Parse a complete bundle from raw bytes */
export function parseBundle(data, options) {
    if (data.length < BUNDLE_HEADER_SIZE) {
        throw new BundleCorruptedError(`Bundle truncated: expected at least ${BUNDLE_HEADER_SIZE} bytes, got ${data.length}`);
    }
    const header = parseBundleHeader(data);
    if (options?.verify && !verifyBundleChecksum(data)) {
        throw new BundleCorruptedError('Bundle checksum verification failed');
    }
    if (data.length < header.totalSize) {
        throw new BundleCorruptedError(`Bundle truncated: expected ${header.totalSize} bytes, got ${data.length}`);
    }
    const availableIndexSize = data.length - header.indexOffset;
    const requiredIndexSize = header.entryCount * BUNDLE_INDEX_ENTRY_SIZE;
    if (requiredIndexSize > availableIndexSize) {
        throw new BundleCorruptedError(`Index overflow: ${header.entryCount} entries need ${requiredIndexSize} bytes, only ${availableIndexSize} available`);
    }
    const indexData = data.slice(header.indexOffset);
    const entries = parseBundleIndex(indexData, header.entryCount);
    if (options?.verify) {
        for (const entry of entries) {
            if (entry.offset + entry.size > header.indexOffset) {
                throw new BundleCorruptedError(`Entry ${entry.oid} extends beyond data section: offset=${entry.offset}, size=${entry.size}`);
            }
            if (entry.offset < BUNDLE_HEADER_SIZE) {
                throw new BundleCorruptedError(`Entry ${entry.oid} overlaps header: offset=${entry.offset}`);
            }
        }
    }
    return { header, entries, data };
}
/** Map git object type string to BundleObjectType enum */
export function objectTypeToBundleType(type) {
    switch (type) {
        case 'blob': return BundleObjectType.BLOB;
        case 'tree': return BundleObjectType.TREE;
        case 'commit': return BundleObjectType.COMMIT;
        case 'tag': return BundleObjectType.TAG;
        default: throw new BundleFormatError(`Unknown object type: ${type}`);
    }
}
/** Map BundleObjectType enum to git object type string */
export function bundleTypeToObjectType(type) {
    switch (type) {
        case BundleObjectType.BLOB: return 'blob';
        case BundleObjectType.TREE: return 'tree';
        case BundleObjectType.COMMIT: return 'commit';
        case BundleObjectType.TAG: return 'tag';
        default: throw new BundleFormatError(`Unknown bundle type: ${type}`);
    }
}
//# sourceMappingURL=format.js.map