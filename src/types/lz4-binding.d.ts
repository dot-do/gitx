/**
 * Type declarations for lz4 pure JS binding module.
 *
 * This imports the pure JavaScript LZ4 block compression from node-lz4,
 * bypassing native bindings for Cloudflare Workers compatibility.
 *
 * @module types/lz4-binding
 */

declare module 'lz4/lib/binding' {
  /**
   * Returns the maximum compressed size for a given input size.
   *
   * @param inputSize - Size of uncompressed data
   * @returns Maximum possible compressed size
   */
  export function compressBound(inputSize: number): number

  /**
   * Compresses data using LZ4 raw block format (no framing).
   *
   * @param src - Source buffer to compress
   * @param dst - Destination buffer for compressed data
   * @param sIdx - Start index in destination buffer (default: 0)
   * @param eIdx - End index in destination buffer (default: dst.length)
   * @returns Number of bytes written, or 0 if incompressible
   */
  export function compress(
    src: Buffer | Uint8Array,
    dst: Buffer | Uint8Array,
    sIdx?: number,
    eIdx?: number
  ): number

  /**
   * Decompresses LZ4 raw block format data.
   *
   * @param input - Compressed data
   * @param output - Output buffer for decompressed data
   * @param sIdx - Start index (default: 0)
   * @param eIdx - End index (default: input.length)
   * @returns Number of bytes written, or negative value on error
   */
  export function uncompress(
    input: Buffer | Uint8Array,
    output: Buffer | Uint8Array,
    sIdx?: number,
    eIdx?: number
  ): number
}
