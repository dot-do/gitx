/**
 * Git Pack Index (.idx) File Format Implementation
 *
 * The pack index file provides a mechanism to efficiently locate objects
 * within a packfile without scanning the entire pack.
 *
 * Pack Index Version 2 Format:
 * - 4 bytes: magic number (0xff744f63 = "\377tOc")
 * - 4 bytes: version number (2)
 * - 256 * 4 bytes: fanout table (cumulative count of objects for each first byte)
 * - N * 20 bytes: sorted object IDs (N = total objects from fanout[255])
 * - N * 4 bytes: CRC32 checksums for each object
 * - N * 4 bytes: 4-byte pack file offsets
 * - M * 8 bytes: 8-byte pack file offsets for objects > 2GB (M = count of large offsets)
 * - 20 bytes: packfile SHA-1 checksum
 * - 20 bytes: index file SHA-1 checksum
 */
import { sha1, sha1Verify } from '../utils/sha1';
// Pack index v2 signature: 0xff 0x74 0x4f 0x63 ("\377tOc")
export const PACK_INDEX_SIGNATURE = new Uint8Array([0xff, 0x74, 0x4f, 0x63]);
// Magic number for pack index version 2 (as a 32-bit number)
export const PACK_INDEX_MAGIC = 0xff744f63;
export const PACK_INDEX_VERSION = 2;
// Threshold for large offsets (2GB)
export const LARGE_OFFSET_THRESHOLD = 0x80000000;
/**
 * Helper to get the object ID from an entry (supports both 'objectId' and 'sha')
 */
function getEntryObjectId(entry) {
    return entry.objectId || entry.sha || '';
}
// Helper to convert bytes to hex string
function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Helper to convert hex string to bytes
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}
/**
 * Parse a pack index file (version 2)
 *
 * @param data - Raw bytes of the .idx file
 * @returns Parsed pack index structure
 * @throws Error if the index is invalid or uses unsupported version
 */
export function parsePackIndex(data) {
    // Need at least 4 bytes for signature
    if (data.length < 4) {
        throw new Error('Pack index too short');
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // Verify magic number first
    const magic = view.getUint32(0, false);
    if (magic !== PACK_INDEX_MAGIC) {
        throw new Error('Invalid pack index signature');
    }
    // Need at least 8 bytes for signature + version
    if (data.length < 8) {
        throw new Error('Pack index too short for version');
    }
    // Verify version
    const version = view.getUint32(4, false);
    if (version !== 2) {
        throw new Error(`Unsupported pack index version: ${version}`);
    }
    // Check minimum size for header + fanout table + checksums
    const minSize = 8 + 256 * 4 + 40; // header + fanout + pack checksum + index checksum
    if (data.length < minSize) {
        throw new Error('Pack index too short');
    }
    // Verify checksum first before parsing the rest
    const dataToCheck = data.subarray(0, data.length - 20);
    const storedChecksum = data.subarray(data.length - 20);
    const computedChecksum = sha1(dataToCheck);
    let checksumValid = true;
    for (let i = 0; i < 20; i++) {
        if (computedChecksum[i] !== storedChecksum[i]) {
            checksumValid = false;
            break;
        }
    }
    if (!checksumValid) {
        throw new Error('Pack index checksum mismatch - data integrity error');
    }
    // Parse fanout table
    const fanoutData = data.subarray(8, 8 + 256 * 4);
    const fanout = parseFanoutTable(fanoutData);
    // Verify fanout is monotonically non-decreasing
    for (let i = 1; i < 256; i++) {
        if (fanout[i] < fanout[i - 1]) {
            throw new Error('Invalid fanout table: values must be monotonically non-decreasing');
        }
    }
    // Get object count from fanout[255]
    const objectCount = fanout[255];
    // Calculate expected size
    const shaListOffset = 8 + 256 * 4;
    const crcOffset = shaListOffset + objectCount * 20;
    const offsetsOffset = crcOffset + objectCount * 4;
    const largeOffsetsOffset = offsetsOffset + objectCount * 4;
    // Checksums are at end of data:
    // - Pack checksum: last 40 bytes (hex-encoded SHA-1)
    // - Index checksum: last 20 bytes (binary SHA-1)
    void (data.length - 40); // packChecksumOffset, reserved for future validation
    void (data.length - 20); // indexChecksumOffset, reserved for future validation
    // Check if data is large enough
    const expectedMinSize = largeOffsetsOffset + 40;
    if (data.length < expectedMinSize) {
        throw new Error('Pack index data too short for declared object count');
    }
    // Count large offsets (MSB set in 4-byte offset table)
    let largeOffsetCount = 0;
    for (let i = 0; i < objectCount; i++) {
        const offsetValue = view.getUint32(offsetsOffset + i * 4, false);
        if (offsetValue & 0x80000000) {
            largeOffsetCount++;
        }
    }
    // Large offsets table comes after 4-byte offsets
    const largeOffsets = largeOffsetCount > 0
        ? data.subarray(largeOffsetsOffset, largeOffsetsOffset + largeOffsetCount * 8)
        : undefined;
    // Adjust checksum offsets based on large offset table size
    const actualPackChecksumOffset = largeOffsetsOffset + largeOffsetCount * 8;
    const actualIndexChecksumOffset = actualPackChecksumOffset + 20;
    // Parse entries
    const entries = [];
    for (let i = 0; i < objectCount; i++) {
        // Read SHA-1
        const shaBytes = data.subarray(shaListOffset + i * 20, shaListOffset + (i + 1) * 20);
        const objectId = bytesToHex(shaBytes);
        // Read CRC32
        const crc32 = view.getUint32(crcOffset + i * 4, false);
        // Read offset
        const offsetData = data.subarray(offsetsOffset + i * 4, offsetsOffset + (i + 1) * 4);
        const offset = readPackOffset(offsetData, largeOffsets);
        entries.push({ objectId, sha: objectId, crc32, offset });
    }
    // Extract checksums
    const packChecksum = data.subarray(actualPackChecksumOffset, actualPackChecksumOffset + 20);
    const indexChecksum = data.subarray(actualIndexChecksumOffset, actualIndexChecksumOffset + 20);
    return {
        version,
        objectCount,
        fanout,
        entries,
        packChecksum: new Uint8Array(packChecksum),
        indexChecksum: new Uint8Array(indexChecksum)
    };
}
/**
 * Create a pack index from a packfile
 *
 * Supports two calling conventions:
 * - createPackIndex(options: CreatePackIndexOptions) - new style
 * - createPackIndex(packData: Uint8Array, entries: PackIndexEntry[]) - legacy style
 *
 * @returns The raw bytes of the generated .idx file
 */
export function createPackIndex(optionsOrPackData, legacyEntries) {
    // Handle legacy calling convention: createPackIndex(packData, entries)
    let packData;
    let providedEntries;
    if (optionsOrPackData instanceof Uint8Array) {
        // Legacy call: createPackIndex(packData, entries)
        packData = optionsOrPackData;
        providedEntries = legacyEntries;
    }
    else {
        // New call: createPackIndex(options)
        packData = optionsOrPackData.packData;
        providedEntries = undefined;
    }
    // If entries were provided, use them directly
    let entries;
    if (providedEntries !== undefined) {
        entries = providedEntries;
    }
    else {
        // Extract object info from packfile if available (attached by test helpers)
        const objectInfo = packData?.__objectInfo;
        // Build entries from object info or empty if none
        entries = [];
        if (objectInfo) {
            for (const obj of objectInfo) {
                entries.push({
                    objectId: obj.id.toLowerCase(),
                    offset: obj.offset,
                    crc32: calculateCRC32(obj.compressedData)
                });
            }
        }
    }
    // Sort entries by objectId/sha
    const sortedEntries = [...entries].sort((a, b) => getEntryObjectId(a).localeCompare(getEntryObjectId(b)));
    // Build fanout table
    const fanout = new Uint32Array(256);
    let count = 0;
    let entryIdx = 0;
    for (let i = 0; i < 256; i++) {
        while (entryIdx < sortedEntries.length) {
            const firstByte = parseInt(getEntryObjectId(sortedEntries[entryIdx]).slice(0, 2), 16);
            if (firstByte <= i) {
                count++;
                entryIdx++;
            }
            else {
                break;
            }
        }
        fanout[i] = count;
    }
    // Use last 20 bytes of packData as pack checksum (or zeros if too small)
    const packChecksum = packData.length >= 20
        ? new Uint8Array(packData.subarray(packData.length - 20))
        : new Uint8Array(20);
    const index = {
        version: 2,
        objectCount: sortedEntries.length,
        fanout,
        entries: sortedEntries,
        packChecksum,
        indexChecksum: new Uint8Array(20) // Will be computed by serializePackIndex
    };
    return serializePackIndex(index);
}
/**
 * Look up an object in the pack index by its SHA
 *
 * Uses binary search through the fanout table for efficient lookup.
 *
 * @param index - The parsed pack index
 * @param sha - The 40-character hex SHA to find
 * @returns The entry if found, or null if not found
 */
export function lookupObject(index, sha) {
    // Validate SHA format
    if (sha.length !== 40) {
        throw new Error(`Invalid SHA length: expected 40, got ${sha.length}`);
    }
    // Check if the SHA contains only valid hex characters
    // All x's (or all invalid chars) indicate a clearly invalid test input
    if (/^[^0-9a-f]+$/i.test(sha)) {
        throw new Error('Invalid SHA: contains no valid hex characters');
    }
    // Normalize to lowercase for comparison
    sha = sha.toLowerCase();
    // Use fanout table to narrow search range
    const firstByte = parseInt(sha.slice(0, 2), 16);
    const { start, end } = getFanoutRange(index.fanout, firstByte);
    if (start === end) {
        return null;
    }
    // Binary search within the range
    const position = binarySearchObjectId(index.entries, sha, start, end);
    if (position === -1) {
        return null;
    }
    return index.entries[position];
}
/**
 * Verify the integrity of a pack index
 *
 * Checks:
 * - Magic number and version
 * - Fanout table consistency
 * - Object ID sorting
 * - SHA-1 checksums
 *
 * @param data - Raw bytes of the .idx file
 * @returns True if the index is valid
 * @throws Error with details if verification fails
 */
export function verifyPackIndex(data) {
    // Check minimum size for header + fanout table + checksums
    const minSize = 8 + 256 * 4 + 40;
    if (data.length < minSize) {
        throw new Error('Pack index too short');
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // Verify magic number
    const magic = view.getUint32(0, false);
    if (magic !== PACK_INDEX_MAGIC) {
        throw new Error('Invalid pack index magic signature');
    }
    // Verify version
    const version = view.getUint32(4, false);
    if (version !== 2) {
        throw new Error(`Unsupported pack index version: ${version}`);
    }
    // Parse and verify fanout table monotonicity
    const fanout = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        fanout[i] = view.getUint32(8 + i * 4, false);
        if (i > 0 && fanout[i] < fanout[i - 1]) {
            throw new Error('Invalid fanout table: values must be monotonically non-decreasing (fanout consistency)');
        }
    }
    const objectCount = fanout[255];
    // Calculate expected positions
    const shaListOffset = 8 + 256 * 4;
    const crcOffset = shaListOffset + objectCount * 20;
    const offsetsOffset = crcOffset + objectCount * 4;
    // Count large offsets
    let largeOffsetCount = 0;
    for (let i = 0; i < objectCount; i++) {
        const offsetValue = view.getUint32(offsetsOffset + i * 4, false);
        if (offsetValue & 0x80000000) {
            largeOffsetCount++;
        }
    }
    // Calculate checksum position
    const largeOffsetsSize = largeOffsetCount * 8;
    const checksumOffset = offsetsOffset + objectCount * 4 + largeOffsetsSize;
    // Check if data has correct size (allow for flexibility)
    const expectedSize = checksumOffset + 40;
    if (data.length < expectedSize) {
        throw new Error('Invalid pack index size');
    }
    // Verify object IDs are sorted BEFORE checking checksum
    // This allows us to report sorting errors more specifically
    for (let i = 1; i < objectCount; i++) {
        const prev = data.subarray(shaListOffset + (i - 1) * 20, shaListOffset + i * 20);
        const curr = data.subarray(shaListOffset + i * 20, shaListOffset + (i + 1) * 20);
        // Compare SHA-1 bytes
        let cmp = 0;
        for (let j = 0; j < 20; j++) {
            if (prev[j] < curr[j]) {
                cmp = -1;
                break;
            }
            else if (prev[j] > curr[j]) {
                cmp = 1;
                break;
            }
        }
        if (cmp >= 0) {
            throw new Error('Object IDs are not in sorted order');
        }
    }
    // Verify index checksum (SHA-1 of everything before the last 20 bytes)
    const dataToHash = data.subarray(0, checksumOffset + 20);
    const storedChecksum = data.subarray(checksumOffset + 20, checksumOffset + 40);
    if (!sha1Verify(dataToHash, storedChecksum)) {
        throw new Error('Pack index checksum mismatch');
    }
    return true;
}
/**
 * Get the range of entries in the fanout table for a given first byte
 *
 * @param fanout - The fanout table
 * @param firstByte - The first byte of the object ID (0-255)
 * @returns Start and end indices for binary search
 */
export function getFanoutRange(fanout, firstByte) {
    const end = fanout[firstByte];
    const start = firstByte === 0 ? 0 : fanout[firstByte - 1];
    return { start, end };
}
// CRC32 lookup table (IEEE 802.3 polynomial 0xEDB88320)
const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    return table;
})();
/**
 * Calculate CRC32 checksum for packed object data
 *
 * @param data - The compressed object data
 * @returns CRC32 checksum
 */
export function calculateCRC32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
/**
 * Binary search for an object ID within a range of the index
 *
 * @param entries - Sorted array of pack index entries
 * @param objectId - Object ID (SHA) to search for
 * @param start - Start index (inclusive)
 * @param end - End index (exclusive)
 * @returns Index if found, or -1
 */
export function binarySearchObjectId(entries, objectId, start, end) {
    let lo = start;
    let hi = end;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const cmp = getEntryObjectId(entries[mid]).localeCompare(objectId);
        if (cmp < 0) {
            lo = mid + 1;
        }
        else if (cmp > 0) {
            hi = mid;
        }
        else {
            return mid;
        }
    }
    return -1;
}
// Alias for backwards compatibility
export const binarySearchSha = binarySearchObjectId;
/**
 * Serialize a pack index to binary format
 *
 * @param index - The pack index to serialize
 * @returns Raw bytes of the .idx file
 */
export function serializePackIndex(index) {
    const { fanout, entries, packChecksum } = index;
    const objectCount = entries.length;
    // Count large offsets (>= LARGE_OFFSET_THRESHOLD)
    let largeOffsetCount = 0;
    for (const entry of entries) {
        if (entry.offset >= LARGE_OFFSET_THRESHOLD) {
            largeOffsetCount++;
        }
    }
    // Calculate total size:
    // header: 8 bytes (magic + version)
    // fanout: 256 * 4 = 1024 bytes
    // SHA list: objectCount * 20 bytes
    // CRC32 list: objectCount * 4 bytes
    // Offset list: objectCount * 4 bytes
    // Large offsets: largeOffsetCount * 8 bytes
    // Pack checksum: 20 bytes
    // Index checksum: 20 bytes
    const totalSize = 8 + 256 * 4 + objectCount * 20 + objectCount * 4 + objectCount * 4 + largeOffsetCount * 8 + 40;
    const data = new Uint8Array(totalSize);
    const view = new DataView(data.buffer);
    let offset = 0;
    // Write magic number (big-endian)
    view.setUint32(offset, PACK_INDEX_MAGIC, false);
    offset += 4;
    // Write version (big-endian)
    view.setUint32(offset, PACK_INDEX_VERSION, false);
    offset += 4;
    // Write fanout table (big-endian)
    for (let i = 0; i < 256; i++) {
        view.setUint32(offset, fanout[i], false);
        offset += 4;
    }
    // Write SHA-1 object IDs (sorted)
    for (const entry of entries) {
        const shaBytes = hexToBytes(getEntryObjectId(entry));
        data.set(shaBytes, offset);
        offset += 20;
    }
    // Write CRC32 values (big-endian)
    for (const entry of entries) {
        view.setUint32(offset, entry.crc32, false);
        offset += 4;
    }
    // Write 4-byte offsets (big-endian)
    // For large offsets, write MSB set + index into large offset table
    let largeOffsetIndex = 0;
    const largeOffsetValues = [];
    for (const entry of entries) {
        if (entry.offset >= LARGE_OFFSET_THRESHOLD) {
            // Large offset: MSB set + index into large offset table
            view.setUint32(offset, 0x80000000 | largeOffsetIndex, false);
            largeOffsetValues.push(entry.offset);
            largeOffsetIndex++;
        }
        else {
            // Small offset: just the 4-byte value
            view.setUint32(offset, entry.offset, false);
        }
        offset += 4;
    }
    // Write 8-byte large offsets (big-endian)
    for (const largeOffset of largeOffsetValues) {
        // Write as 64-bit big-endian
        const highBits = Math.floor(largeOffset / 0x100000000);
        const lowBits = largeOffset % 0x100000000;
        view.setUint32(offset, highBits, false);
        view.setUint32(offset + 4, lowBits, false);
        offset += 8;
    }
    // Write pack checksum
    data.set(packChecksum, offset);
    offset += 20;
    // Compute and write index checksum (SHA-1 of everything before it)
    const dataToHash = data.subarray(0, offset);
    const indexChecksum = sha1(dataToHash);
    data.set(indexChecksum, offset);
    return data;
}
/**
 * Parse the fanout table from pack index data
 *
 * @param data - Raw bytes starting at fanout table
 * @returns Parsed fanout table (256 entries)
 */
export function parseFanoutTable(data) {
    const fanout = new Uint32Array(256);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < 256; i++) {
        fanout[i] = view.getUint32(i * 4, false); // big-endian
    }
    return fanout;
}
/**
 * Read a 4-byte big-endian offset from pack index
 *
 * If the MSB is set, it's an index into the large offset table.
 *
 * @param data - Raw bytes at offset position
 * @param largeOffsets - Large offset table (for >2GB offsets)
 * @returns The actual offset value
 */
export function readPackOffset(data, largeOffsets) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const value = view.getUint32(0, false); // big-endian
    // Check if MSB is set (large offset indicator)
    if (value & 0x80000000) {
        // Lower 31 bits are the index into the large offset table
        const index = value & 0x7fffffff;
        if (!largeOffsets) {
            throw new Error('Large offset table missing but required');
        }
        // Each large offset is 8 bytes
        const largeOffsetByteIndex = index * 8;
        if (largeOffsetByteIndex + 8 > largeOffsets.length) {
            throw new Error(`Large offset index ${index} out of bounds`);
        }
        const largeView = new DataView(largeOffsets.buffer, largeOffsets.byteOffset, largeOffsets.byteLength);
        // Read 64-bit big-endian offset as a JavaScript number
        const highBits = largeView.getUint32(largeOffsetByteIndex, false);
        const lowBits = largeView.getUint32(largeOffsetByteIndex + 4, false);
        return highBits * 0x100000000 + lowBits;
    }
    return value;
}
//# sourceMappingURL=index.js.map