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
export async function sha1(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hashBuffer = await crypto.subtle.digest('SHA-1', bytes);
    return bytesToHex(new Uint8Array(hashBuffer));
}
/**
 * Compute SHA-256 hash of data
 * @returns 64-character lowercase hex string
 */
export async function sha256(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return bytesToHex(new Uint8Array(hashBuffer));
}
/**
 * Hash a git object with type header
 * Format: "{type} {size}\0{content}"
 * This matches `git hash-object` output
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
 * Convert hex string to Uint8Array
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
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes) {
    if (bytes.length === 0)
        return '';
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
//# sourceMappingURL=hash.js.map