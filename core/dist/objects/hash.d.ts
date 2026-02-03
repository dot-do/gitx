/**
 * SHA-1 Hash Utilities
 *
 * Provides hash calculation functions compatible with Git's object hashing.
 * Uses the Web Crypto API for SHA-1 calculation.
 */
import type { ObjectType } from './types';
/**
 * Calculates SHA-1 hash of raw data
 * @param data - The raw bytes to hash
 * @returns Promise resolving to 40-character lowercase hex string
 */
export declare function calculateSha1(data: Uint8Array): Promise<string>;
/**
 * Calculates Git object hash (includes header: "type size\0content")
 * @param type - The object type (blob, tree, commit, tag)
 * @param content - The object content (without header)
 * @returns Promise resolving to 40-character lowercase hex string
 */
export declare function calculateObjectHash(type: ObjectType, content: Uint8Array): Promise<string>;
/**
 * Creates a Git object header: "type size\0"
 * @param type - The object type
 * @param size - The content size in bytes
 * @returns Uint8Array containing the header bytes
 */
export declare function createObjectHeader(type: ObjectType, size: number): Uint8Array;
/**
 * Parses a Git object header from serialized data
 * @param data - The serialized object data
 * @returns Object with type, size, and headerLength
 * @throws Error if header is invalid
 */
export declare function parseObjectHeader(data: Uint8Array): {
    type: ObjectType;
    size: number;
    headerLength: number;
};
/**
 * Converts a Uint8Array to lowercase hex string
 */
export declare function bytesToHex(bytes: Uint8Array): string;
/**
 * Converts a hex string to Uint8Array
 */
export declare function hexToBytes(hex: string): Uint8Array;
//# sourceMappingURL=hash.d.ts.map