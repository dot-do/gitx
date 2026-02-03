/**
 * R2 Bundle Format - Storage for multiple git objects in a single R2 object
 *
 * Bundle Format:
 * +----------------+
 * | Header (64B)   |  - Magic, version, entry count, index offset
 * +----------------+
 * | Entry 1        |  - Object data (variable size)
 * +----------------+
 * | Entry 2        |
 * +----------------+
 * | ...            |
 * +----------------+
 * | Index          |  - Array of {oid, offset, size, type}
 * +----------------+
 */
// Constants
export const BUNDLE_MAGIC = 'BNDL';
export const BUNDLE_VERSION = 1;
export const BUNDLE_HEADER_SIZE = 64;
export const BUNDLE_INDEX_ENTRY_SIZE = 33; // 20 (OID binary SHA-1) + 8 (offset) + 4 (size) + 1 (type)
// Object types
export var BundleObjectType;
(function (BundleObjectType) {
    BundleObjectType[BundleObjectType["BLOB"] = 1] = "BLOB";
    BundleObjectType[BundleObjectType["TREE"] = 2] = "TREE";
    BundleObjectType[BundleObjectType["COMMIT"] = 3] = "COMMIT";
    BundleObjectType[BundleObjectType["TAG"] = 4] = "TAG";
})(BundleObjectType || (BundleObjectType = {}));
// Error classes
export class BundleFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BundleFormatError';
    }
}
export class BundleCorruptedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BundleCorruptedError';
    }
}
export class BundleIndexError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BundleIndexError';
    }
}
// Helper functions
/**
 * Convert hex OID string (40 chars) to binary bytes (20 bytes)
 */
function oidToBytes(oid) {
    const bytes = new Uint8Array(20);
    for (let i = 0; i < 40; i += 2) {
        bytes[i / 2] = parseInt(oid.slice(i, i + 2), 16) || 0;
    }
    return bytes;
}
/**
 * Convert binary bytes (20 bytes) to hex OID string (40 chars)
 */
function bytesToOid(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
function computeHeaderChecksum(data) {
    // Simple checksum for header - XOR hash spread across 16 bytes
    const checksum = new Uint8Array(16);
    for (let i = 0; i < data.length; i++) {
        checksum[i % 16] ^= data[i];
    }
    // Also mix in the data length
    const len = data.length;
    checksum[0] ^= (len >> 24) & 0xff;
    checksum[1] ^= (len >> 16) & 0xff;
    checksum[2] ^= (len >> 8) & 0xff;
    checksum[3] ^= len & 0xff;
    return checksum;
}
function computeBundleChecksum(data) {
    // Compute checksum over entire bundle (excluding the checksum bytes 48-63 in header)
    const checksum = new Uint8Array(16);
    // First process bytes 0-47 (before checksum)
    for (let i = 0; i < 48; i++) {
        checksum[i % 16] ^= data[i];
    }
    // Then process bytes 64+ (after header)
    for (let i = 64; i < data.length; i++) {
        checksum[i % 16] ^= data[i];
    }
    // Mix in the data length
    const len = data.length;
    checksum[0] ^= (len >> 24) & 0xff;
    checksum[1] ^= (len >> 16) & 0xff;
    checksum[2] ^= (len >> 8) & 0xff;
    checksum[3] ^= len & 0xff;
    return checksum;
}
function verifyHeaderChecksum(data, expectedChecksum) {
    // Compute checksum over header fields (excluding checksum bytes 48-63)
    const headerWithoutChecksum = data.slice(0, 48);
    const computed = computeHeaderChecksum(headerWithoutChecksum);
    if (computed.length !== expectedChecksum.length)
        return false;
    for (let i = 0; i < computed.length; i++) {
        if (computed[i] !== expectedChecksum[i])
            return false;
    }
    return true;
}
function verifyBundleChecksum(bundleData) {
    // Extract expected checksum from header (bytes 48-63)
    const expectedChecksum = bundleData.slice(48, 64);
    const computed = computeBundleChecksum(bundleData);
    if (computed.length !== expectedChecksum.length)
        return false;
    for (let i = 0; i < computed.length; i++) {
        if (computed[i] !== expectedChecksum[i])
            return false;
    }
    return true;
}
/**
 * Parses and validates a bundle header from raw bytes, optionally verifying the checksum.
 *
 * @param data - Raw bundle bytes (at least BUNDLE_HEADER_SIZE bytes)
 * @param options - Parsing options
 * @param options.verifyChecksum - Whether to verify the header checksum
 * @returns Parsed bundle header
 *
 * @throws {BundleFormatError} If header is truncated (less than 64 bytes)
 * @throws {BundleFormatError} If magic bytes are invalid (not 'BNDL')
 * @throws {BundleFormatError} If bundle version is unsupported
 * @throws {BundleFormatError} If index offset exceeds total size
 * @throws {BundleCorruptedError} If checksum verification fails (when verifyChecksum is true)
 */
export function parseBundleHeader(data, options) {
    if (data.length < BUNDLE_HEADER_SIZE) {
        throw new BundleFormatError(`Header truncated: expected ${BUNDLE_HEADER_SIZE} bytes, got ${data.length}`);
    }
    // Parse magic (bytes 0-3)
    const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
    if (magic !== BUNDLE_MAGIC) {
        throw new BundleFormatError(`Invalid magic bytes: expected 'BNDL', got '${magic}'`);
    }
    // Parse version (bytes 4-7, uint32 BE)
    const version = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
    if (version !== BUNDLE_VERSION) {
        throw new BundleFormatError(`Unsupported version: expected ${BUNDLE_VERSION}, got ${version}`);
    }
    // Parse entry count (bytes 8-11, uint32 BE) - use >>> 0 to get unsigned
    const entryCount = ((data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11]) >>> 0;
    // Parse index offset (bytes 12-19, uint64 BE)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const indexOffset = Number(view.getBigUint64(12, false));
    // Parse total size (bytes 20-27, uint64 BE)
    const totalSize = Number(view.getBigUint64(20, false));
    // Validate index offset against total size
    if (indexOffset > totalSize && totalSize > 0) {
        throw new BundleFormatError(`Invalid index offset: ${indexOffset} exceeds total size ${totalSize}`);
    }
    // Extract checksum (bytes 48-63)
    const checksum = data.slice(48, 64);
    // Verify checksum if requested
    if (options?.verifyChecksum) {
        if (!verifyHeaderChecksum(data, checksum)) {
            throw new BundleCorruptedError('Header checksum verification failed');
        }
    }
    return {
        magic,
        version,
        entryCount,
        indexOffset,
        totalSize,
        checksum
    };
}
/** Serializes a bundle header with magic bytes, version, entry count, and checksum. */
export function createBundleHeader(options) {
    const header = new Uint8Array(BUNDLE_HEADER_SIZE);
    // Magic (bytes 0-3)
    header[0] = 0x42; // B
    header[1] = 0x4e; // N
    header[2] = 0x44; // D
    header[3] = 0x4c; // L
    // Version (bytes 4-7, uint32 BE)
    header[4] = 0;
    header[5] = 0;
    header[6] = 0;
    header[7] = BUNDLE_VERSION;
    // Entry count (bytes 8-11, uint32 BE)
    header[8] = (options.entryCount >> 24) & 0xff;
    header[9] = (options.entryCount >> 16) & 0xff;
    header[10] = (options.entryCount >> 8) & 0xff;
    header[11] = options.entryCount & 0xff;
    // Index offset (bytes 12-19, uint64 BE)
    const view = new DataView(header.buffer);
    view.setBigUint64(12, BigInt(options.indexOffset), false);
    // Total size (bytes 20-27, uint64 BE)
    view.setBigUint64(20, BigInt(options.totalSize), false);
    // Reserved bytes 28-47 are already zeros
    // Compute and set checksum (bytes 48-63)
    const checksumData = header.slice(0, 48);
    const checksum = computeHeaderChecksum(checksumData);
    header.set(checksum, 48);
    return header;
}
/**
 * Deserializes the bundle index section into an array of index entries.
 *
 * @param data - Raw index bytes
 * @param entryCount - Expected number of entries
 * @returns Array of parsed index entries sorted by OID
 *
 * @throws {BundleIndexError} If index data is smaller than expected based on entry count
 * @throws {BundleIndexError} If duplicate OIDs are found in the index
 * @throws {BundleIndexError} If an object type value is invalid (not 1-4)
 */
export function parseBundleIndex(data, entryCount) {
    const expectedSize = entryCount * BUNDLE_INDEX_ENTRY_SIZE;
    if (data.length < expectedSize) {
        throw new BundleIndexError(`Entry count mismatch: expected ${entryCount} entries (${expectedSize} bytes), but index data is only ${data.length} bytes`);
    }
    const entries = [];
    const seenOids = new Set();
    for (let i = 0; i < entryCount; i++) {
        const base = i * BUNDLE_INDEX_ENTRY_SIZE;
        // Parse OID (20 bytes binary SHA-1)
        const oidBytes = data.slice(base, base + 20);
        const oid = bytesToOid(oidBytes);
        // Check for duplicate OIDs
        if (seenOids.has(oid)) {
            throw new BundleIndexError(`Duplicate OID found in index: ${oid}`);
        }
        seenOids.add(oid);
        // Parse offset (8 bytes, uint64 BE) - starts at byte 20
        const view = new DataView(data.buffer, data.byteOffset + base + 20, 8);
        const offset = Number(view.getBigUint64(0, false));
        // Parse size (4 bytes, uint32 BE) - starts at byte 28
        const size = (data[base + 28] << 24) |
            (data[base + 29] << 16) |
            (data[base + 30] << 8) |
            data[base + 31];
        // Parse type (1 byte) - at byte 32
        const type = data[base + 32];
        if (type < 1 || type > 4) {
            throw new BundleIndexError(`Invalid object type: ${type}`);
        }
        entries.push({ oid, offset, size, type: type });
    }
    // Sort entries by OID for binary search
    entries.sort((a, b) => a.oid.localeCompare(b.oid));
    return entries;
}
/** Serializes an array of bundle index entries into raw bytes. */
export function createBundleIndex(entries) {
    if (entries.length === 0) {
        return new Uint8Array(0);
    }
    // Sort entries by OID
    const sortedEntries = [...entries].sort((a, b) => a.oid.localeCompare(b.oid));
    const indexData = new Uint8Array(sortedEntries.length * BUNDLE_INDEX_ENTRY_SIZE);
    for (let i = 0; i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        const base = i * BUNDLE_INDEX_ENTRY_SIZE;
        // OID (20 bytes binary SHA-1)
        const oidBytes = oidToBytes(entry.oid);
        indexData.set(oidBytes, base);
        // Offset (8 bytes, uint64 BE) - starts at byte 20
        const view = new DataView(indexData.buffer, base + 20, 8);
        view.setBigUint64(0, BigInt(entry.offset), false);
        // Size (4 bytes, uint32 BE) - starts at byte 28
        indexData[base + 28] = (entry.size >> 24) & 0xff;
        indexData[base + 29] = (entry.size >> 16) & 0xff;
        indexData[base + 30] = (entry.size >> 8) & 0xff;
        indexData[base + 31] = entry.size & 0xff;
        // Type (1 byte) - at byte 32
        indexData[base + 32] = entry.type;
    }
    return indexData;
}
/** Performs a binary search for an entry by OID in a sorted index. */
export function lookupEntryByOid(entries, oid) {
    if (entries.length === 0)
        return null;
    // Binary search
    let left = 0;
    let right = entries.length - 1;
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const midEntry = entries[mid];
        const cmp = oid.localeCompare(midEntry.oid);
        if (cmp === 0) {
            return midEntry;
        }
        else if (cmp < 0) {
            right = mid - 1;
        }
        else {
            left = mid + 1;
        }
    }
    return null;
}
/** Creates a complete bundle from an array of git objects, sorted by OID. */
export function createBundle(objects) {
    if (objects.length === 0) {
        // Empty bundle: just header (64 bytes)
        const header = createBundleHeader({
            entryCount: 0,
            indexOffset: BUNDLE_HEADER_SIZE,
            totalSize: BUNDLE_HEADER_SIZE
        });
        // Update checksum for empty bundle
        const bundleChecksum = computeBundleChecksum(header);
        header.set(bundleChecksum, 48);
        return header;
    }
    // Sort objects by OID for consistent ordering
    const sortedObjects = [...objects].sort((a, b) => a.oid.localeCompare(b.oid));
    // Calculate data section size
    let dataSize = 0;
    for (const obj of sortedObjects) {
        dataSize += obj.data.length;
    }
    // Calculate index size
    const indexSize = sortedObjects.length * BUNDLE_INDEX_ENTRY_SIZE;
    // Total size = header + data + index
    const totalSize = BUNDLE_HEADER_SIZE + dataSize + indexSize;
    const indexOffset = BUNDLE_HEADER_SIZE + dataSize;
    // Create header
    const header = createBundleHeader({
        entryCount: sortedObjects.length,
        indexOffset,
        totalSize
    });
    // Build entries array and data section
    const entries = [];
    const dataSection = new Uint8Array(dataSize);
    let offset = 0;
    for (const obj of sortedObjects) {
        // Copy object data to data section
        dataSection.set(obj.data, offset);
        // Create index entry with offset relative to header end (data section start)
        entries.push({
            oid: obj.oid,
            offset: BUNDLE_HEADER_SIZE + offset, // Absolute offset from bundle start
            size: obj.data.length,
            type: obj.type
        });
        offset += obj.data.length;
    }
    // Create index
    const index = createBundleIndex(entries);
    // Combine all sections
    const bundle = new Uint8Array(totalSize);
    bundle.set(header, 0);
    bundle.set(dataSection, BUNDLE_HEADER_SIZE);
    bundle.set(index, indexOffset);
    // Recompute checksum over entire bundle and update header
    const bundleChecksum = computeBundleChecksum(bundle);
    bundle.set(bundleChecksum, 48);
    return bundle;
}
/** Parses a complete bundle from raw bytes, returning the header, index, and object data. */
export function parseBundle(data, options) {
    // First check minimum size for header
    if (data.length < BUNDLE_HEADER_SIZE) {
        throw new BundleCorruptedError(`Bundle truncated: expected at least ${BUNDLE_HEADER_SIZE} bytes for header, got ${data.length}`);
    }
    // Parse header (don't verify header checksum separately, we'll verify entire bundle)
    const header = parseBundleHeader(data);
    // Verify entire bundle checksum if requested
    if (options?.verify) {
        if (!verifyBundleChecksum(data)) {
            throw new BundleCorruptedError('Bundle checksum verification failed');
        }
    }
    // Validate bundle size
    if (data.length < header.totalSize) {
        throw new BundleCorruptedError(`Bundle truncated: expected ${header.totalSize} bytes, got ${data.length}`);
    }
    // Validate that entry count is reasonable given index offset
    const availableIndexSize = data.length - header.indexOffset;
    const requiredIndexSize = header.entryCount * BUNDLE_INDEX_ENTRY_SIZE;
    if (requiredIndexSize > availableIndexSize) {
        throw new BundleCorruptedError(`Corrupted entry count: ${header.entryCount} entries require ${requiredIndexSize} bytes but only ${availableIndexSize} available`);
    }
    // Parse index
    const indexData = data.slice(header.indexOffset);
    let entries;
    try {
        entries = parseBundleIndex(indexData, header.entryCount);
    }
    catch (error) {
        if (error instanceof BundleIndexError) {
            throw error;
        }
        throw new BundleCorruptedError(`Failed to parse index: ${error}`);
    }
    // Verify data integrity if requested
    if (options?.verify) {
        for (const entry of entries) {
            // Check that entry offset and size are within bounds
            if (entry.offset + entry.size > header.indexOffset) {
                throw new BundleCorruptedError(`Entry ${entry.oid} extends beyond data section: offset=${entry.offset}, size=${entry.size}, indexOffset=${header.indexOffset}`);
            }
        }
        // Verify the bundle data integrity by checking if re-creating index entries matches
        // This catches corruption in the data section
        for (const entry of entries) {
            // Entries should be contiguous starting from header end
            if (entry.offset < BUNDLE_HEADER_SIZE || entry.offset >= header.indexOffset) {
                throw new BundleCorruptedError(`Entry ${entry.oid} has invalid offset ${entry.offset}`);
            }
        }
        // Verify data integrity by re-computing the bundle structure
        // Sort entries by offset to verify they are contiguous and don't overlap
        const sortedByOffset = [...entries].sort((a, b) => a.offset - b.offset);
        let expectedOffset = BUNDLE_HEADER_SIZE;
        for (const entry of sortedByOffset) {
            if (entry.offset !== expectedOffset) {
                throw new BundleCorruptedError(`Data section integrity error: expected entry at offset ${expectedOffset}, but found entry ${entry.oid} at offset ${entry.offset}`);
            }
            expectedOffset += entry.size;
        }
        // After all entries, expectedOffset should equal indexOffset
        if (expectedOffset !== header.indexOffset) {
            throw new BundleCorruptedError(`Data section size mismatch: entries end at ${expectedOffset}, but index starts at ${header.indexOffset}`);
        }
    }
    return {
        header,
        entries,
        data
    };
}
// BundleReader class
export class BundleReader {
    bundle;
    constructor(data) {
        this.bundle = parseBundle(data);
    }
    get entryCount() {
        return this.bundle.header.entryCount;
    }
    readObject(oid) {
        const entry = lookupEntryByOid(this.bundle.entries, oid);
        if (!entry)
            return null;
        const objectData = this.bundle.data.slice(entry.offset, entry.offset + entry.size);
        return {
            oid: entry.oid,
            type: entry.type,
            data: objectData
        };
    }
    hasObject(oid) {
        return lookupEntryByOid(this.bundle.entries, oid) !== null;
    }
    listOids() {
        return this.bundle.entries.map((e) => e.oid);
    }
    getEntry(oid) {
        return lookupEntryByOid(this.bundle.entries, oid);
    }
    [Symbol.iterator]() {
        let index = 0;
        const entries = this.bundle.entries;
        const data = this.bundle.data;
        return {
            next: () => {
                if (index >= entries.length) {
                    return { done: true, value: undefined };
                }
                const entry = entries[index++];
                const objectData = data.slice(entry.offset, entry.offset + entry.size);
                return {
                    done: false,
                    value: {
                        oid: entry.oid,
                        type: entry.type,
                        data: objectData
                    }
                };
            }
        };
    }
}
// BundleWriter class (lightweight in-memory builder)
export class BundleWriter {
    objects = new Map();
    maxSize;
    currentSize = BUNDLE_HEADER_SIZE; // Start with header size
    constructor(options) {
        this.maxSize = options?.maxSize ?? Infinity;
    }
    get objectCount() {
        return this.objects.size;
    }
    get estimatedSize() {
        return this.currentSize + this.objects.size * BUNDLE_INDEX_ENTRY_SIZE;
    }
    addObject(oid, type, data) {
        if (this.objects.has(oid)) {
            throw new Error(`Duplicate OID: ${oid}`);
        }
        const newEntrySize = data.length + BUNDLE_INDEX_ENTRY_SIZE;
        const newTotalSize = this.currentSize + newEntrySize;
        if (newTotalSize > this.maxSize) {
            throw new Error(`Bundle size limit exceeded: ${newTotalSize} > ${this.maxSize}`);
        }
        this.objects.set(oid, { type, data });
        this.currentSize += data.length;
    }
    isFull(additionalBytes) {
        const projectedSize = this.currentSize +
            additionalBytes +
            BUNDLE_INDEX_ENTRY_SIZE +
            this.objects.size * BUNDLE_INDEX_ENTRY_SIZE;
        return projectedSize > this.maxSize;
    }
    build() {
        const objectsArray = Array.from(this.objects.entries()).map(([oid, obj]) => ({
            oid,
            type: obj.type,
            data: obj.data
        }));
        return createBundle(objectsArray);
    }
}
//# sourceMappingURL=bundle-format.js.map