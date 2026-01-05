/**
 * @fileoverview SHA Hashing Utilities for Git Objects
 *
 * This module provides cryptographic hashing functions used for Git object
 * identification and verification. Git uses SHA-1 as its primary hash algorithm,
 * with SHA-256 available as an optional newer algorithm (Git v2.29+).
 *
 * The hash functions work with the Web Crypto API for broad compatibility
 * with browsers and edge runtimes like Cloudflare Workers.
 *
 * @module utils/hash
 *
 * @example
 * ```typescript
 * import { sha1, hashObject, hexToBytes, bytesToHex } from './utils/hash'
 *
 * // Hash raw data
 * const hash = await sha1('Hello, World!')
 *
 * // Hash as a Git object (includes type header)
 * const content = new TextEncoder().encode('file content')
 * const blobSha = await hashObject('blob', content)
 * console.log(`blob ${blobSha}`)
 * ```
 */
/**
 * Compute the SHA-1 hash of data.
 *
 * @description
 * Computes a SHA-1 digest of the input data using the Web Crypto API.
 * This is the standard hash algorithm used by Git for object identification.
 *
 * **Note**: SHA-1 is considered cryptographically weak. Git uses it for
 * content addressing, not security. For new security-sensitive applications,
 * use SHA-256.
 *
 * @param data - Input data as Uint8Array or string (UTF-8 encoded)
 * @returns 40-character lowercase hexadecimal hash string
 *
 * @example
 * ```typescript
 * // Hash a string
 * const hash1 = await sha1('Hello, World!')
 * console.log(hash1) // '0a0a9f2a6772942557ab5355d76af442f8f65e01'
 *
 * // Hash binary data
 * const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])
 * const hash2 = await sha1(data)
 * ```
 */
export async function sha1(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hashBuffer = await crypto.subtle.digest('SHA-1', bytes);
    return bytesToHex(new Uint8Array(hashBuffer));
}
/**
 * Compute the SHA-256 hash of data.
 *
 * @description
 * Computes a SHA-256 digest of the input data using the Web Crypto API.
 * SHA-256 is the newer, more secure hash algorithm supported by Git v2.29+
 * as an alternative to SHA-1.
 *
 * @param data - Input data as Uint8Array or string (UTF-8 encoded)
 * @returns 64-character lowercase hexadecimal hash string
 *
 * @example
 * ```typescript
 * // Hash a string
 * const hash = await sha256('Hello, World!')
 * console.log(hash) // 'dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f'
 *
 * // Hash binary data
 * const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])
 * const hash2 = await sha256(data)
 * ```
 */
export async function sha256(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return bytesToHex(new Uint8Array(hashBuffer));
}
/**
 * Hash a Git object with its type header.
 *
 * @description
 * Computes the SHA-1 hash of a Git object including its header.
 * The header format is: "{type} {size}\0" followed by the content.
 *
 * This matches the output of `git hash-object` command and is the
 * standard way Git computes object identifiers.
 *
 * @param type - Object type ('blob', 'tree', 'commit', 'tag')
 * @param data - Object content as binary data (without header)
 * @returns 40-character lowercase hexadecimal SHA-1 hash
 *
 * @example
 * ```typescript
 * // Hash a blob (equivalent to `echo -n "hello" | git hash-object --stdin`)
 * const content = new TextEncoder().encode('hello')
 * const sha = await hashObject('blob', content)
 * console.log(sha) // 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0'
 *
 * // Verify with git:
 * // $ echo -n "hello" | git hash-object --stdin
 * // b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
 * ```
 */
export async function hashObject(type, data) {
    const header = `${type} ${data.length}\0`;
    const headerBytes = new TextEncoder().encode(header);
    const combined = new Uint8Array(headerBytes.length + data.length);
    combined.set(headerBytes, 0);
    combined.set(data, headerBytes.length);
    return sha1(combined);
}
/**
 * Convert a hexadecimal string to a Uint8Array.
 *
 * @description
 * Parses a hexadecimal string and returns the corresponding bytes.
 * Each pair of hex characters becomes one byte.
 *
 * **Edge Cases**:
 * - Empty string returns empty Uint8Array
 * - Hex string should have even length (odd length may produce unexpected results)
 *
 * @param hex - Hexadecimal string (case-insensitive)
 * @returns Binary data as Uint8Array
 *
 * @example
 * ```typescript
 * const bytes = hexToBytes('48656c6c6f')
 * console.log(new TextDecoder().decode(bytes)) // 'Hello'
 *
 * // Convert SHA back to bytes (useful for tree entries)
 * const sha = 'abc123def456...'
 * const sha20 = hexToBytes(sha) // 20 bytes for SHA-1
 * ```
 */
export function hexToBytes(hex) {
    if (hex.length === 0)
        return new Uint8Array(0);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}
/**
 * Convert a Uint8Array to a hexadecimal string.
 *
 * @description
 * Converts binary data to a lowercase hexadecimal string representation.
 * Each byte becomes two hex characters (zero-padded).
 *
 * **Edge Cases**:
 * - Empty Uint8Array returns empty string
 *
 * @param bytes - Binary data to convert
 * @returns Lowercase hexadecimal string
 *
 * @example
 * ```typescript
 * const hello = new TextEncoder().encode('Hello')
 * const hex = bytesToHex(hello)
 * console.log(hex) // '48656c6c6f'
 *
 * // Convert SHA-1 bytes to string
 * const hashBytes = new Uint8Array(20) // ... from crypto
 * const sha = bytesToHex(hashBytes) // 40-char hex string
 * ```
 */
export function bytesToHex(bytes) {
    if (bytes.length === 0)
        return '';
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
//# sourceMappingURL=hash.js.map