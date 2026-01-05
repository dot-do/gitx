/**
 * Synchronous SHA-1 utilities for git pack operations
 *
 * These functions provide synchronous SHA-1 hashing needed for pack file
 * generation and verification. For async operations, use hash.ts instead.
 */
/**
 * Compute SHA-1 hash of data synchronously
 * @param data - Input data to hash
 * @returns 20-byte hash as Uint8Array
 */
export declare function sha1(data: Uint8Array): Uint8Array;
/**
 * Compute SHA-1 hash and return as hex string
 * @param data - Input data to hash
 * @returns 40-character lowercase hex string
 */
export declare function sha1Hex(data: Uint8Array): string;
/**
 * Verify data against expected SHA-1 hash
 * @param data - Data to verify
 * @param expected - Expected 20-byte hash
 * @returns true if hash matches
 */
export declare function sha1Verify(data: Uint8Array, expected: Uint8Array): boolean;
//# sourceMappingURL=sha1.d.ts.map