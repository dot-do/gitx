/**
 * SHA hashing utilities for git objects
 *
 * Git uses SHA-1 for object identifiers and SHA-256 is used
 * in newer git versions (v2.29+) as an optional hash algorithm.
 */
/**
 * Compute SHA-1 hash of data
 * @returns 40-character lowercase hex string
 */
export declare function sha1(data: Uint8Array | string): Promise<string>;
/**
 * Compute SHA-256 hash of data
 * @returns 64-character lowercase hex string
 */
export declare function sha256(data: Uint8Array | string): Promise<string>;
/**
 * Hash a git object with type header
 * Format: "{type} {size}\0{content}"
 * This matches `git hash-object` output
 */
export declare function hashObject(type: string, data: Uint8Array): Promise<string>;
/**
 * Convert hex string to Uint8Array
 */
export declare function hexToBytes(hex: string): Uint8Array;
/**
 * Convert Uint8Array to hex string
 */
export declare function bytesToHex(bytes: Uint8Array): string;
//# sourceMappingURL=hash.d.ts.map