/**
 * @fileoverview Git Packfile Format Implementation
 *
 * This module implements the Git packfile format specification, providing utilities
 * for creating, parsing, and manipulating Git packfiles. Packfiles are Git's primary
 * mechanism for efficient storage and network transfer of repository objects.
 *
 * ## Packfile Structure
 *
 * A packfile consists of:
 * - **Header (12 bytes)**:
 *   - 4 bytes: "PACK" signature
 *   - 4 bytes: version number (network byte order, big-endian) - currently version 2
 *   - 4 bytes: number of objects (network byte order)
 * - **Object entries (variable length)**:
 *   - Each object has a variable-length header followed by zlib-compressed data
 * - **Trailer (20 bytes)**:
 *   - SHA-1 checksum of all preceding content
 *
 * ## Object Header Encoding
 *
 * The object header uses a variable-length encoding:
 * - First byte: (MSB) continuation bit | 3-bit type | 4-bit size LSB
 * - Subsequent bytes: (MSB) continuation bit | 7-bit size continuation
 *
 * ## Supported Object Types
 *
 * | Type Code | Name      | Description                                    |
 * |-----------|-----------|------------------------------------------------|
 * | 1         | commit    | A commit object                                |
 * | 2         | tree      | A tree object (directory listing)              |
 * | 3         | blob      | A blob object (file content)                   |
 * | 4         | tag       | An annotated tag object                        |
 * | 6         | ofs_delta | Delta referencing base by offset               |
 * | 7         | ref_delta | Delta referencing base by SHA-1                |
 *
 * @module pack/format
 * @see {@link https://git-scm.com/docs/pack-format} Git Pack Format Documentation
 *
 * @example
 * // Creating a simple packfile
 * import { createPackfile, PackableObject } from './format';
 *
 * const objects: PackableObject[] = [
 *   { type: 'blob', data: new TextEncoder().encode('Hello, World!') }
 * ];
 *
 * const packfile = createPackfile(objects);
 * // packfile is now a Uint8Array containing the complete packfile
 */
/**
 * The 4-byte ASCII signature that identifies a valid packfile.
 * Every packfile must begin with these bytes: 0x50 0x41 0x43 0x4b ("PACK").
 *
 * @constant {string}
 * @example
 * // Validate packfile signature
 * const signature = String.fromCharCode(...packData.slice(0, 4));
 * if (signature !== PACK_SIGNATURE) {
 *   throw new Error('Invalid packfile');
 * }
 */
export declare const PACK_SIGNATURE = "PACK";
/**
 * The packfile version number supported by this implementation.
 * Currently, only version 2 is widely used and supported.
 *
 * @constant {number}
 */
export declare const PACK_VERSION = 2;
/**
 * Enumeration of Git pack object types.
 *
 * These values are used in the packfile header to identify the type of each object.
 * Note that types 0 and 5 are reserved/unused in the Git pack format.
 *
 * @description Represents the different types of objects that can be stored in a Git packfile.
 * Delta types (OFS_DELTA and REF_DELTA) are used for efficient storage by referencing
 * a base object and storing only the differences.
 *
 * @enum {number}
 *
 * @example
 * // Check if an object is a delta type
 * function isDelta(type: PackObjectType): boolean {
 *   return type === PackObjectType.OBJ_OFS_DELTA || type === PackObjectType.OBJ_REF_DELTA;
 * }
 */
export declare enum PackObjectType {
    /** A commit object containing tree reference, parent commits, author, and message */
    OBJ_COMMIT = 1,
    /** A tree object representing a directory structure */
    OBJ_TREE = 2,
    /** A blob object containing file content */
    OBJ_BLOB = 3,
    /** An annotated tag object */
    OBJ_TAG = 4,
    /** An offset delta - references base object by byte offset within the packfile */
    OBJ_OFS_DELTA = 6,
    /** A reference delta - references base object by its SHA-1 hash */
    OBJ_REF_DELTA = 7
}
/**
 * Converts a PackObjectType enum value to its string representation.
 *
 * @description Converts numeric pack object types to their human-readable string names.
 * This is useful for logging, debugging, and when interfacing with Git's loose object format.
 *
 * @param {PackObjectType} type - The numeric pack object type to convert
 * @returns {string} The string name of the object type ('commit', 'tree', 'blob', 'tag', 'ofs_delta', or 'ref_delta')
 * @throws {Error} If the type is not a valid PackObjectType value
 *
 * @example
 * // Convert type for display
 * const type = PackObjectType.OBJ_BLOB;
 * console.log(`Object type: ${packObjectTypeToString(type)}`); // "Object type: blob"
 *
 * @example
 * // Use in error messages
 * function validateObject(type: PackObjectType, data: Uint8Array) {
 *   if (data.length === 0) {
 *     throw new Error(`Empty ${packObjectTypeToString(type)} object`);
 *   }
 * }
 */
export declare function packObjectTypeToString(type: PackObjectType): string;
/**
 * Converts a string object type name to its PackObjectType enum value.
 *
 * @description Parses a string object type name and returns the corresponding enum value.
 * This is useful when reading Git loose objects or configuration files that use string type names.
 * Note: Delta types ('ofs_delta', 'ref_delta') are not supported as they are not valid
 * standalone object types.
 *
 * @param {string} str - The string type name ('commit', 'tree', 'blob', or 'tag')
 * @returns {PackObjectType} The corresponding PackObjectType enum value
 * @throws {Error} If the string does not match a valid base object type
 *
 * @example
 * // Parse type from Git object
 * const typeStr = 'blob';
 * const type = stringToPackObjectType(typeStr);
 * // type === PackObjectType.OBJ_BLOB
 *
 * @example
 * // Error handling for invalid types
 * try {
 *   const type = stringToPackObjectType('invalid');
 * } catch (e) {
 *   console.error('Unknown object type');
 * }
 */
export declare function stringToPackObjectType(str: string): PackObjectType;
/**
 * Encodes a non-negative integer using variable-length integer encoding.
 *
 * @description Uses Git's varint encoding scheme where each byte encodes 7 bits of the value,
 * with the MSB (most significant bit) serving as a continuation flag. If the MSB is set (1),
 * more bytes follow; if clear (0), this is the last byte.
 *
 * The encoding is little-endian: least significant bits come first. This allows efficient
 * encoding of small values (1 byte for values 0-127) while supporting arbitrarily large values.
 *
 * @param {number} value - A non-negative integer to encode (must be >= 0)
 * @returns {Uint8Array} The variable-length encoded bytes
 *
 * @example
 * // Encode small value (fits in 1 byte)
 * const encoded = encodeVarint(100);
 * // encoded = Uint8Array [100] (0x64, no continuation bit)
 *
 * @example
 * // Encode larger value (requires multiple bytes)
 * const encoded = encodeVarint(300);
 * // encoded = Uint8Array [172, 2] (0xAC with continuation, 0x02)
 * // 300 = 0b100101100 = (0101100 | continuation) + (10)
 */
export declare function encodeVarint(value: number): Uint8Array;
/**
 * Decodes a variable-length integer from a byte buffer.
 *
 * @description Reads and decodes a varint starting at the specified offset. The encoding uses
 * 7 bits per byte for the value, with the MSB as a continuation flag. This is the inverse
 * operation of {@link encodeVarint}.
 *
 * **Important Notes:**
 * - Maximum supported varint length is 10 bytes (enough for 64-bit values)
 * - Throws if data ends unexpectedly before varint is complete
 * - Throws if varint exceeds maximum length (likely corrupted data)
 *
 * @param {Uint8Array} data - The byte buffer containing the encoded varint
 * @param {number} offset - The starting position in the buffer
 * @returns {{ value: number; bytesRead: number }} Object containing the decoded value and number of bytes consumed
 * @throws {Error} If unexpected end of data or varint exceeds maximum length
 *
 * @example
 * // Decode a varint from a buffer
 * const buffer = new Uint8Array([172, 2, 0, 0]); // 300 encoded + extra bytes
 * const { value, bytesRead } = decodeVarint(buffer, 0);
 * // value === 300, bytesRead === 2
 *
 * @example
 * // Decode multiple varints
 * const buffer = new Uint8Array([100, 172, 2]);
 * let offset = 0;
 * const first = decodeVarint(buffer, offset);  // value: 100, bytesRead: 1
 * offset += first.bytesRead;
 * const second = decodeVarint(buffer, offset); // value: 300, bytesRead: 2
 */
export declare function decodeVarint(data: Uint8Array, offset: number): {
    value: number;
    bytesRead: number;
};
/**
 * Encodes object type and uncompressed size into a pack object header.
 *
 * @description Creates the variable-length header that precedes each object in a packfile.
 * The header encodes both the object type (3 bits) and the uncompressed data size.
 *
 * **Header Format:**
 * - First byte: `[continuation][type:3][size:4]` - MSB is continuation flag, then 3-bit type, then 4 LSBs of size
 * - Subsequent bytes: `[continuation][size:7]` - MSB is continuation flag, then 7 bits of size
 *
 * This encoding allows:
 * - Sizes 0-15: 1 byte
 * - Sizes 16-2047: 2 bytes
 * - Larger sizes: additional bytes as needed
 *
 * @param {PackObjectType} type - The object type (1-4 for base types, 6-7 for deltas)
 * @param {number} size - The uncompressed object size in bytes
 * @returns {Uint8Array} The encoded header bytes
 *
 * @example
 * // Encode a small blob object
 * const header = encodeTypeAndSize(PackObjectType.OBJ_BLOB, 10);
 * // header[0] = (3 << 4) | 10 = 0x3A (type=blob, size=10, no continuation)
 *
 * @example
 * // Encode a larger object (size requires continuation)
 * const header = encodeTypeAndSize(PackObjectType.OBJ_COMMIT, 256);
 * // First byte has type and low 4 bits of size, with continuation
 * // Second byte has remaining size bits
 */
export declare function encodeTypeAndSize(type: PackObjectType, size: number): Uint8Array;
/**
 * Decodes object type and size from a pack object header.
 *
 * @description Parses the variable-length header at the beginning of each packed object.
 * This is the inverse operation of {@link encodeTypeAndSize}.
 *
 * **Decoding Process:**
 * 1. Read first byte to get type (bits 4-6) and initial size (bits 0-3)
 * 2. If MSB is set, read continuation bytes (7 bits each) for remaining size
 * 3. Return the decoded type, size, and total bytes consumed
 *
 * **Important Notes:**
 * - Maximum header length is 10 bytes (prevents infinite loops on corrupted data)
 * - Throws if offset is beyond data bounds
 * - Throws if data ends before header is complete
 *
 * @param {Uint8Array} data - The packfile data buffer
 * @param {number} offset - Starting offset of the object header
 * @returns {{ type: PackObjectType; size: number; bytesRead: number }} Decoded type, uncompressed size, and bytes consumed
 * @throws {Error} If offset is out of bounds or header data is truncated/corrupted
 *
 * @example
 * // Decode an object header
 * const packData = getPackfileData();
 * let offset = 12; // Skip 12-byte pack header
 *
 * const { type, size, bytesRead } = decodeTypeAndSize(packData, offset);
 * console.log(`Object type: ${packObjectTypeToString(type)}, size: ${size}`);
 * offset += bytesRead; // Move to start of compressed data
 */
export declare function decodeTypeAndSize(data: Uint8Array, offset: number): {
    type: PackObjectType;
    size: number;
    bytesRead: number;
};
/**
 * Represents the parsed 12-byte header of a Git packfile.
 *
 * @description The pack header contains essential metadata about the packfile:
 * - The signature validates this is a genuine packfile
 * - The version indicates the format version (currently always 2)
 * - The object count tells how many objects follow
 *
 * @interface PackHeader
 *
 * @example
 * const header: PackHeader = parsePackHeader(packData);
 * console.log(`Pack contains ${header.objectCount} objects`);
 */
export interface PackHeader {
    /** The 4-byte signature string, should always be "PACK" */
    signature: string;
    /** The format version number (currently always 2) */
    version: number;
    /** Total number of objects in the packfile */
    objectCount: number;
}
/**
 * Parses and validates the 12-byte header of a Git packfile.
 *
 * @description Reads the first 12 bytes of a packfile and validates:
 * 1. The signature is "PACK"
 * 2. The version is 2 (only supported version)
 * 3. Extracts the object count
 *
 * This should be called first when processing a packfile to understand
 * its structure and validate basic integrity.
 *
 * @param {Uint8Array} data - The packfile data (at least 12 bytes)
 * @returns {PackHeader} Parsed header with signature, version, and object count
 * @throws {Error} If data is too short (< 12 bytes)
 * @throws {Error} If signature is not "PACK"
 * @throws {Error} If version is not 2
 *
 * @example
 * // Parse a packfile header
 * const packData = await readPackfile('objects/pack/pack-abc123.pack');
 * const header = parsePackHeader(packData);
 *
 * console.log(`Packfile version: ${header.version}`);
 * console.log(`Contains ${header.objectCount} objects`);
 *
 * @example
 * // Error handling for invalid packfile
 * try {
 *   const header = parsePackHeader(suspectData);
 * } catch (e) {
 *   console.error('Not a valid packfile:', e.message);
 * }
 */
export declare function parsePackHeader(data: Uint8Array): PackHeader;
/**
 * Represents a parsed pack object header (without the actual data).
 *
 * @description Contains the metadata extracted from a pack object's header.
 * This is useful when scanning through a packfile to index its contents
 * without fully decompressing each object.
 *
 * @interface ParsedPackObject
 */
export interface ParsedPackObject {
    /** The object type (commit, tree, blob, tag, or delta types) */
    type: PackObjectType;
    /** The uncompressed size of the object data in bytes */
    size: number;
    /** Number of bytes consumed by the header (for offset calculations) */
    headerSize: number;
}
/**
 * Parses an individual pack object header at the specified offset.
 *
 * @description Extracts the object type and uncompressed size from the header
 * at the given offset. This is useful for scanning/indexing packfiles.
 *
 * **Important Notes:**
 * - This only parses the header, not the compressed data following it
 * - For delta objects, you'll need additional parsing (base offset/SHA)
 * - Use `headerSize` to calculate where the compressed data begins
 *
 * @param {Uint8Array} data - The packfile data buffer
 * @param {number} offset - Byte offset where the object header starts
 * @returns {ParsedPackObject} Object containing type, size, and header size
 * @throws {Error} If offset is out of bounds or header is malformed
 *
 * @example
 * // Scan through all objects in a packfile
 * const header = parsePackHeader(packData);
 * let offset = 12; // After pack header
 *
 * for (let i = 0; i < header.objectCount; i++) {
 *   const obj = parsePackObject(packData, offset);
 *   console.log(`Object ${i}: type=${obj.type}, size=${obj.size}`);
 *   // Skip header + compressed data (need to decompress to find boundary)
 *   offset += obj.headerSize;
 *   // ... decompress and skip compressed data ...
 * }
 */
export declare function parsePackObject(data: Uint8Array, offset: number): ParsedPackObject;
/**
 * Represents an object to be packed into a packfile.
 *
 * @description This is the input format for {@link createPackfile}. Each object
 * consists of a type string and the raw (uncompressed) object data. The data
 * should be the full object content without the Git object header prefix.
 *
 * @interface PackableObject
 *
 * @example
 * // Create a blob object for a file
 * const blobObject: PackableObject = {
 *   type: 'blob',
 *   data: new TextEncoder().encode('file contents here')
 * };
 */
export interface PackableObject {
    /** Object type as a string ('blob', 'tree', 'commit', or 'tag') */
    type: 'blob' | 'tree' | 'commit' | 'tag';
    /** The raw object data (will be compressed during packing) */
    data: Uint8Array;
}
/**
 * Creates a complete packfile from an array of objects.
 *
 * @description Generates a valid Git packfile containing the specified objects.
 * The resulting packfile includes:
 * - 12-byte header (signature, version, object count)
 * - Each object (header + zlib-compressed data)
 * - 20-byte SHA-1 checksum trailer
 *
 * **Process:**
 * 1. Creates the pack header with signature "PACK", version 2, and object count
 * 2. For each object, encodes type/size header and compresses data with zlib
 * 3. Appends SHA-1 checksum of the entire pack content
 *
 * **Important Notes:**
 * - Objects are packed in the order provided (no reordering for delta compression)
 * - This function creates full objects only (no delta compression)
 * - For delta compression, use the generation module functions
 *
 * @param {PackableObject[]} objects - Array of objects to include in the packfile
 * @returns {Uint8Array} Complete packfile as binary data
 *
 * @example
 * // Create a packfile with a single blob
 * const objects: PackableObject[] = [
 *   { type: 'blob', data: new TextEncoder().encode('Hello, World!') }
 * ];
 * const packfile = createPackfile(objects);
 * // Write packfile to disk or send over network
 *
 * @example
 * // Create a packfile with multiple objects
 * const objects: PackableObject[] = [
 *   { type: 'blob', data: fileContent1 },
 *   { type: 'blob', data: fileContent2 },
 *   { type: 'tree', data: treeData },
 *   { type: 'commit', data: commitData }
 * ];
 * const packfile = createPackfile(objects);
 */
export declare function createPackfile(objects: PackableObject[]): Uint8Array;
//# sourceMappingURL=format.d.ts.map