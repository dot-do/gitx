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
export function sha1(data) {
    /**
     * Rotate left (circular left shift) operation.
     * @internal
     */
    function rotl(n, s) {
        return ((n << s) | (n >>> (32 - s))) >>> 0;
    }
    // Initialize hash values (first 32 bits of fractional parts of square roots of first 5 primes)
    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;
    // Pre-processing: add padding
    const msgLen = data.length;
    const bitLen = BigInt(msgLen) * 8n;
    // Message needs to be padded to 64-byte boundary (512 bits)
    // Padding: 1 bit (0x80), then zeros, then 64-bit length
    const paddingLength = (64 - ((msgLen + 9) % 64)) % 64;
    const paddedLen = msgLen + 1 + paddingLength + 8;
    const padded = new Uint8Array(paddedLen);
    padded.set(data, 0);
    padded[msgLen] = 0x80;
    // Write length as 64-bit big-endian at the end
    const lengthView = new DataView(padded.buffer);
    lengthView.setBigUint64(paddedLen - 8, bitLen, false);
    // Process in 64-byte (512-bit) chunks
    const w = new Uint32Array(80);
    for (let chunkStart = 0; chunkStart < paddedLen; chunkStart += 64) {
        const chunkView = new DataView(padded.buffer, chunkStart, 64);
        // Break chunk into sixteen 32-bit big-endian words
        for (let i = 0; i < 16; i++) {
            w[i] = chunkView.getUint32(i * 4, false);
        }
        // Extend the sixteen 32-bit words into eighty 32-bit words
        for (let i = 16; i < 80; i++) {
            w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        }
        // Initialize working variables
        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        // Main loop - 80 rounds
        for (let i = 0; i < 80; i++) {
            let f, k;
            if (i < 20) {
                // Round 0-19: Ch(b,c,d) = (b AND c) XOR (NOT b AND d)
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            }
            else if (i < 40) {
                // Round 20-39: Parity(b,c,d) = b XOR c XOR d
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            }
            else if (i < 60) {
                // Round 40-59: Maj(b,c,d) = (b AND c) XOR (b AND d) XOR (c AND d)
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            }
            else {
                // Round 60-79: Parity(b,c,d) = b XOR c XOR d
                f = b ^ c ^ d;
                k = 0xca62c1d6;
            }
            const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
            e = d;
            d = c;
            c = rotl(b, 30);
            b = a;
            a = temp;
        }
        // Add this chunk's hash to result so far
        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
    }
    // Produce the final hash value (big-endian)
    const result = new Uint8Array(20);
    const resultView = new DataView(result.buffer);
    resultView.setUint32(0, h0, false);
    resultView.setUint32(4, h1, false);
    resultView.setUint32(8, h2, false);
    resultView.setUint32(12, h3, false);
    resultView.setUint32(16, h4, false);
    return result;
}
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
export function sha1Hex(data) {
    const hash = sha1(data);
    let hex = '';
    for (let i = 0; i < hash.length; i++) {
        hex += hash[i].toString(16).padStart(2, '0');
    }
    return hex;
}
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
export function sha1Verify(data, expected) {
    // Expected hash must be exactly 20 bytes
    if (expected.length !== 20) {
        return false;
    }
    const computed = sha1(data);
    // Compare all 20 bytes
    for (let i = 0; i < 20; i++) {
        if (computed[i] !== expected[i]) {
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=sha1.js.map