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
export function sha1(data) {
    function rotl(n, s) {
        return ((n << s) | (n >>> (32 - s))) >>> 0;
    }
    // Initialize hash values
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
        // Main loop
        for (let i = 0; i < 80; i++) {
            let f, k;
            if (i < 20) {
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            }
            else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            }
            else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            }
            else {
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
 * Compute SHA-1 hash and return as hex string
 * @param data - Input data to hash
 * @returns 40-character lowercase hex string
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
 * Verify data against expected SHA-1 hash
 * @param data - Data to verify
 * @param expected - Expected 20-byte hash
 * @returns true if hash matches
 */
export function sha1Verify(data, expected) {
    if (expected.length !== 20) {
        return false;
    }
    const computed = sha1(data);
    for (let i = 0; i < 20; i++) {
        if (computed[i] !== expected[i]) {
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=sha1.js.map