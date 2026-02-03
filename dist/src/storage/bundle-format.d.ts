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
export declare const BUNDLE_MAGIC = "BNDL";
export declare const BUNDLE_VERSION = 1;
export declare const BUNDLE_HEADER_SIZE = 64;
export declare const BUNDLE_INDEX_ENTRY_SIZE = 33;
export declare enum BundleObjectType {
    BLOB = 1,
    TREE = 2,
    COMMIT = 3,
    TAG = 4
}
export interface BundleHeader {
    magic: string;
    version: number;
    entryCount: number;
    indexOffset: number;
    totalSize: number;
    checksum: Uint8Array;
}
export interface BundleIndexEntry {
    oid: string;
    offset: number;
    size: number;
    type: BundleObjectType;
}
export interface Bundle {
    header: BundleHeader;
    entries: BundleIndexEntry[];
    data: Uint8Array;
}
export interface BundleObject {
    oid: string;
    type: BundleObjectType;
    data: Uint8Array;
}
export declare class BundleFormatError extends Error {
    constructor(message: string);
}
export declare class BundleCorruptedError extends Error {
    constructor(message: string);
}
export declare class BundleIndexError extends Error {
    constructor(message: string);
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
export declare function parseBundleHeader(data: Uint8Array, options?: {
    verifyChecksum?: boolean;
}): BundleHeader;
/** Serializes a bundle header with magic bytes, version, entry count, and checksum. */
export declare function createBundleHeader(options: {
    entryCount: number;
    indexOffset: number;
    totalSize: number;
}): Uint8Array;
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
export declare function parseBundleIndex(data: Uint8Array, entryCount: number): BundleIndexEntry[];
/** Serializes an array of bundle index entries into raw bytes. */
export declare function createBundleIndex(entries: BundleIndexEntry[]): Uint8Array;
/** Performs a binary search for an entry by OID in a sorted index. */
export declare function lookupEntryByOid(entries: BundleIndexEntry[], oid: string): BundleIndexEntry | null;
/** Creates a complete bundle from an array of git objects, sorted by OID. */
export declare function createBundle(objects: Array<{
    oid: string;
    type: BundleObjectType;
    data: Uint8Array;
}>): Uint8Array;
/** Parses a complete bundle from raw bytes, returning the header, index, and object data. */
export declare function parseBundle(data: Uint8Array, options?: {
    verify?: boolean;
}): Bundle;
export declare class BundleReader implements Iterable<BundleObject> {
    private bundle;
    constructor(data: Uint8Array);
    get entryCount(): number;
    readObject(oid: string): BundleObject | null;
    hasObject(oid: string): boolean;
    listOids(): string[];
    getEntry(oid: string): BundleIndexEntry | null;
    [Symbol.iterator](): Iterator<BundleObject>;
}
export declare class BundleWriter {
    private objects;
    private maxSize;
    private currentSize;
    constructor(options?: {
        maxSize?: number;
    });
    get objectCount(): number;
    get estimatedSize(): number;
    addObject(oid: string, type: BundleObjectType, data: Uint8Array): void;
    isFull(additionalBytes: number): boolean;
    build(): Uint8Array;
}
//# sourceMappingURL=bundle-format.d.ts.map