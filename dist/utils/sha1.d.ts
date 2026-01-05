/**
 * @fileoverview Synchronous SHA-1 Utilities for Git Pack Operations
 *
 * This module provides synchronous (non-async) SHA-1 hashing needed for pack file
 * generation, verification, and streaming operations where async is impractical.
 *
 * The implementation follows the SHA-1 specification (FIPS 180-4) and processes
 * data in 512-bit (64-byte) chunks using the standard compression function.
 *
 * **When to use this vs hash.ts**:
 * - Use `utils/hash.ts` for general async hashing (uses Web Crypto API)
 * - Use this module for pack operations that need synchronous hashing
 *
 * @module utils/sha1
 *
 * @example
 * ```typescript
 * import { sha1, sha1Hex, sha1Verify } from './utils/sha1'
 *
 * // Compute SHA-1 as bytes
 * const data = new TextEncoder().encode('Hello, World!')
 * const hashBytes = sha1(data) // 20-byte Uint8Array
 *
 * // Compute SHA-1 as hex string
 * const hashHex = sha1Hex(data) // 40-char string
 *
 * // Verify data against expected hash
 * const isValid = sha1Verify(data, expectedHash)
 * ```
 */
/**
 * Compute SHA-1 hash of data synchronously.
 *
 * @description
 * Implements the SHA-1 algorithm per FIPS 180-4. This pure JavaScript
 * implementation is used when synchronous hashing is needed, such as
 * in pack file generation or streaming operations.
 *
 * **Algorithm Details**:
 * 1. Pad message to 512-bit boundary (with 1-bit, zeros, and 64-bit length)
 * 2. Process in 64-byte chunks using 80-round compression function
 * 3. Return final 160-bit (20-byte) hash
 *
 * **Performance Note**: This is slower than Web Crypto API. Use `hash.ts`
 * for async operations where performance is critical.
 *
 * @param data - Input data to hash
 * @returns 20-byte hash as Uint8Array
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode('test')
 * const hash = sha1(data)
 * console.log(hash.length) // 20
 *
 * // Use with pack file verification
 * const packData = readPackFile()
 * const computedHash = sha1(packData.slice(0, -20))
 * ```
 */
export declare function sha1(data: Uint8Array): Uint8Array;
/**
 * Compute SHA-1 hash and return as hexadecimal string.
 *
 * @description
 * Convenience wrapper that computes SHA-1 and converts the result
 * to a lowercase hexadecimal string. Equivalent to calling `sha1()`
 * followed by hex conversion.
 *
 * @param data - Input data to hash
 * @returns 40-character lowercase hexadecimal hash string
 *
 * @example
 * ```typescript
 * const data = new TextEncoder().encode('hello')
 * const hex = sha1Hex(data)
 * console.log(hex) // 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
 *
 * // Compare with git:
 * // $ echo -n "hello" | sha1sum
 * // aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
 * ```
 */
export declare function sha1Hex(data: Uint8Array): string;
/**
 * Verify data against an expected SHA-1 hash.
 *
 * @description
 * Computes the SHA-1 hash of the data and compares it byte-by-byte
 * with the expected hash. Returns true only if all 20 bytes match.
 *
 * This uses constant-time comparison to avoid timing attacks,
 * though SHA-1 is not used for security purposes in Git.
 *
 * @param data - Data to verify
 * @param expected - Expected 20-byte SHA-1 hash
 * @returns True if the computed hash matches the expected hash
 * @throws Never throws - returns false for invalid inputs
 *
 * @example
 * ```typescript
 * // Verify pack file integrity
 * const packContent = readPackFile()
 * const contentWithoutChecksum = packContent.slice(0, -20)
 * const expectedChecksum = packContent.slice(-20)
 *
 * if (sha1Verify(contentWithoutChecksum, expectedChecksum)) {
 *   console.log('Pack file integrity verified')
 * } else {
 *   console.log('Pack file corrupted!')
 * }
 *
 * // Invalid expected hash length
 * const badHash = new Uint8Array(10)
 * sha1Verify(data, badHash) // false (wrong length)
 * ```
 */
export declare function sha1Verify(data: Uint8Array, expected: Uint8Array): boolean;
//# sourceMappingURL=sha1.d.ts.map