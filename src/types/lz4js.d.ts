/**
 * Type declarations for lz4js module.
 *
 * lz4js provides LZ4 compression for browser environments.
 * Uses compressBlock/decompressBlock for raw block format (Parquet LZ4_RAW).
 *
 * @module types/lz4js
 */

declare module 'lz4js' {
  /**
   * Creates a hash table for use with compressBlock.
   * @returns A Uint32Array hash table
   */
  export function makeHashTable(): Uint32Array

  /**
   * Compress data using LZ4 raw block format.
   * This is the format required by Parquet LZ4_RAW codec.
   *
   * @param src - Source buffer to compress
   * @param dst - Destination buffer for compressed data
   * @param sIndex - Start index in source buffer
   * @param sLength - Length of data to compress
   * @param hashTable - Hash table from makeHashTable()
   * @returns Number of bytes written to dst, or 0 if incompressible
   */
  export function compressBlock(
    src: Uint8Array,
    dst: Uint8Array,
    sIndex: number,
    sLength: number,
    hashTable: Uint32Array
  ): number

  /**
   * Decompress LZ4 raw block format data.
   *
   * @param src - Compressed data
   * @param dst - Destination buffer for decompressed data
   * @param sIndex - Start index in source buffer (default 0)
   * @param sLength - Length of compressed data
   * @param dIndex - Start index in destination buffer (default 0)
   * @returns Number of bytes written to dst
   */
  export function decompressBlock(
    src: Uint8Array,
    dst: Uint8Array,
    sIndex?: number,
    sLength?: number,
    dIndex?: number
  ): number

  /**
   * Compress data using LZ4 frame format (NOT for Parquet).
   * Use compressBlock instead for Parquet LZ4_RAW.
   */
  export function compress(input: Uint8Array, maxSize?: number): Uint8Array

  /**
   * Decompress LZ4 frame format data (NOT for Parquet).
   * Use decompressBlock instead for Parquet LZ4_RAW.
   */
  export function decompress(input: Uint8Array, maxSize?: number): Uint8Array
}
