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
/**
 * Streaming SHA-1 hasher for processing large data incrementally.
 *
 * @description
 * This class allows hashing data in chunks, which is essential for:
 * - Processing large files without loading everything into memory
 * - Computing hashes of data streams
 * - Pack file generation and verification
 *
 * The hasher maintains internal state and can accept data through the
 * `update()` method before finalizing with `digest()` or `digestHex()`.
 *
 * **Performance Note**: For small data (< 64 bytes), the non-streaming
 * `sha1()` function may be slightly faster due to lower overhead.
 *
 * @class StreamingSHA1
 *
 * @example
 * ```typescript
 * // Hash a large file in chunks
 * const hasher = new StreamingSHA1()
 *
 * for await (const chunk of fileStream) {
 *   hasher.update(chunk)
 * }
 *
 * const hash = hasher.digestHex()
 * console.log(`File hash: ${hash}`)
 * ```
 *
 * @example
 * ```typescript
 * // Hash Git object with header
 * const hasher = new StreamingSHA1()
 * hasher.update(new TextEncoder().encode(`blob ${size}\0`))
 * hasher.update(content)
 * const objectId = hasher.digestHex()
 * ```
 */
export declare class StreamingSHA1 {
    /** Hash state */
    private h;
    /** Working array for chunk processing */
    private w;
    /** Buffer for incomplete chunks */
    private buffer;
    /** Current position in buffer */
    private bufferLength;
    /** Total bytes processed */
    private totalLength;
    /** Whether digest has been called */
    private finalized;
    /**
     * Creates a new StreamingSHA1 hasher instance.
     */
    constructor();
    /**
     * Resets the hasher to its initial state.
     *
     * @description Allows reusing the same hasher instance for a new hash
     * computation without creating a new object.
     *
     * @example
     * ```typescript
     * const hasher = new StreamingSHA1()
     * hasher.update(data1)
     * const hash1 = hasher.digestHex()
     *
     * hasher.reset()
     * hasher.update(data2)
     * const hash2 = hasher.digestHex()
     * ```
     */
    reset(): void;
    /**
     * Updates the hash with additional data.
     *
     * @description Processes the input data, updating the internal hash state.
     * Data is buffered internally until a complete 64-byte chunk is available,
     * then processed immediately.
     *
     * This method can be called multiple times before finalizing with `digest()`.
     *
     * @param {Uint8Array} data - Data to add to the hash computation
     * @returns {this} The hasher instance for method chaining
     * @throws {Error} If called after digest() without reset()
     *
     * @example
     * ```typescript
     * const hasher = new StreamingSHA1()
     *   .update(header)
     *   .update(content)
     *   .update(footer)
     * const hash = hasher.digestHex()
     * ```
     */
    update(data: Uint8Array): this;
    /**
     * Finalizes the hash computation and returns the 20-byte digest.
     *
     * @description Applies SHA-1 padding to the remaining data and computes
     * the final hash. After calling this method, the hasher cannot be updated
     * unless `reset()` is called.
     *
     * @returns {Uint8Array} 20-byte SHA-1 hash
     *
     * @example
     * ```typescript
     * const hasher = new StreamingSHA1()
     * hasher.update(data)
     * const hashBytes = hasher.digest()
     * console.log(hashBytes.length) // 20
     * ```
     */
    digest(): Uint8Array;
    /**
     * Finalizes the hash computation and returns the hex string digest.
     *
     * @description Convenience method that calls `digest()` and converts
     * the result to a 40-character lowercase hexadecimal string.
     *
     * @returns {string} 40-character lowercase hexadecimal hash string
     *
     * @example
     * ```typescript
     * const hasher = new StreamingSHA1()
     * hasher.update(data)
     * const hash = hasher.digestHex()
     * console.log(hash) // 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
     * ```
     */
    digestHex(): string;
}
/**
 * Hash a Git object with streaming support for large objects.
 *
 * @description
 * Uses the streaming hasher to compute the SHA-1 of a Git object with its header.
 * This is more memory-efficient than `hashObject` in `hash.ts` for large objects
 * as it doesn't require concatenating header and data.
 *
 * @param type - Object type ('blob', 'tree', 'commit', 'tag')
 * @param data - Object content as binary data
 * @returns 20-byte SHA-1 hash as Uint8Array
 *
 * @example
 * ```typescript
 * const content = new TextEncoder().encode('hello')
 * const hashBytes = hashObjectStreaming('blob', content)
 * ```
 */
export declare function hashObjectStreaming(type: string, data: Uint8Array): Uint8Array;
/**
 * Hash a Git object with streaming support, returning hex string.
 *
 * @description
 * Convenience wrapper that returns the hash as a 40-character hex string
 * instead of raw bytes.
 *
 * @param type - Object type ('blob', 'tree', 'commit', 'tag')
 * @param data - Object content as binary data
 * @returns 40-character lowercase hexadecimal SHA-1 hash
 *
 * @example
 * ```typescript
 * const content = new TextEncoder().encode('hello')
 * const sha = hashObjectStreamingHex('blob', content)
 * console.log(sha) // 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0'
 * ```
 */
export declare function hashObjectStreamingHex(type: string, data: Uint8Array): string;
//# sourceMappingURL=sha1.d.ts.map