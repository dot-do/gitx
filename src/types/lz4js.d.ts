/**
 * Type declarations for lz4js module.
 *
 * @module types/lz4js
 */

declare module 'lz4js' {
  /**
   * Compresses data using LZ4 block format.
   *
   * @param input - Data to compress
   * @returns Compressed data
   */
  export function compress(input: Uint8Array): Uint8Array

  /**
   * Decompresses LZ4 block format data.
   *
   * @param input - Compressed data
   * @param maxOutputLength - Maximum output buffer size (optional)
   * @returns Decompressed data
   */
  export function decompress(input: Uint8Array, maxOutputLength?: number): Uint8Array
}
