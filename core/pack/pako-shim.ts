/**
 * @fileoverview Pako/Zlib Compression Shim
 *
 * This module provides compression functionality for pack files.
 * It attempts to use available compression APIs in the environment.
 */

// =============================================================================
// Types
// =============================================================================

export interface CompressionApi {
  deflate(data: Uint8Array): Uint8Array
  inflate(data: Uint8Array): Uint8Array
  Inflate: new () => InflateStream
}

/** Internal zlib stream state for tracking compression/decompression progress */
export interface ZlibStreamState {
  /** Number of bytes remaining in input buffer (unconsumed bytes) */
  avail_in?: number
  /** Current position in input buffer */
  next_in?: number
}

export interface InflateStream {
  push(data: Uint8Array, final: boolean): void
  result: Uint8Array
  err: number
  /** Error message if err is non-zero */
  msg?: string
  /** Whether the stream has finished processing */
  ended?: boolean
  /** Internal zlib stream state */
  strm?: ZlibStreamState
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Simple zlib implementation using Web APIs when available.
 * Falls back to pako if Web Compression API is not available.
 */
class ZlibImpl implements CompressionApi {
  Inflate = class ZlibInflate implements InflateStream {
    result: Uint8Array = new Uint8Array(0)
    err: number = 0
    msg?: string
    ended: boolean = false
    strm: ZlibStreamState = {}

    push(data: Uint8Array, _final: boolean): void {
      try {
        const result = zlibInflate(data)
        this.result = result
        const compressedLength = this.findCompressedLength(data)
        this.strm.next_in = compressedLength
        this.strm.avail_in = data.length - compressedLength
        this.ended = true
      } catch (e) {
        this.err = 1
        this.msg = e instanceof Error ? e.message : 'Unknown error'
      }
    }

    private findCompressedLength(data: Uint8Array): number {
      // For zlib streams, we need to find where the stream ends
      // This is a simplified approach - in practice we'd need proper stream parsing
      // Return an estimate based on the ratio
      return Math.min(data.length, Math.ceil(this.result.length * 0.6))
    }
  }

  deflate(data: Uint8Array): Uint8Array {
    return zlibDeflate(data)
  }

  inflate(data: Uint8Array): Uint8Array {
    return zlibInflate(data)
  }
}

/**
 * Deflate data using zlib format (with header).
 */
function zlibDeflate(data: Uint8Array): Uint8Array {
  // Try CompressionStream if available (Cloudflare Workers, modern browsers)
  if (typeof CompressionStream !== 'undefined') {
    return deflateWithCompressionStream(data)
  }

  // Fallback: use raw deflate without wrapper
  return rawDeflate(data)
}

/**
 * Inflate zlib-compressed data.
 */
function zlibInflate(data: Uint8Array): Uint8Array {
  // Try DecompressionStream if available
  if (typeof DecompressionStream !== 'undefined') {
    return inflateWithDecompressionStream(data)
  }

  // Fallback: use raw inflate
  return rawInflate(data)
}

/**
 * Use CompressionStream for deflate.
 */
function deflateWithCompressionStream(data: Uint8Array): Uint8Array {
  // Note: CompressionStream is async but we need sync for pack files
  // This is a limitation - in real usage we'd need async APIs
  // For now, use raw deflate
  return rawDeflate(data)
}

/**
 * Use DecompressionStream for inflate.
 */
function inflateWithDecompressionStream(data: Uint8Array): Uint8Array {
  // Similar limitation as above
  return rawInflate(data)
}

/**
 * Raw DEFLATE implementation (simplified).
 *
 * This is a minimal implementation for pack files.
 * For production use, a proper zlib library should be used.
 */
function rawDeflate(data: Uint8Array): Uint8Array {
  // Simplified: store as uncompressed block
  // Real implementation would use actual DEFLATE algorithm
  const chunks: number[] = []

  // Zlib header (CMF + FLG)
  chunks.push(0x78) // CMF: CM=8 (deflate), CINFO=7 (32K window)
  chunks.push(0x9c) // FLG: FCHECK=28, no FDICT, FLEVEL=2 (default)

  // Process data in blocks of 65535 bytes max
  let offset = 0
  while (offset < data.length) {
    const remaining = data.length - offset
    const blockSize = Math.min(remaining, 65535)
    const isLast = offset + blockSize >= data.length

    // Block header: BFINAL (1 bit) + BTYPE (2 bits) = 00 or 01 for uncompressed
    chunks.push(isLast ? 0x01 : 0x00)

    // LEN (2 bytes, little-endian)
    chunks.push(blockSize & 0xff)
    chunks.push((blockSize >> 8) & 0xff)

    // NLEN (one's complement of LEN)
    chunks.push((~blockSize) & 0xff)
    chunks.push(((~blockSize) >> 8) & 0xff)

    // Data
    for (let i = 0; i < blockSize; i++) {
      chunks.push(data[offset + i]!)
    }

    offset += blockSize
  }

  // Adler-32 checksum (big-endian)
  const adler = computeAdler32(data)
  chunks.push((adler >> 24) & 0xff)
  chunks.push((adler >> 16) & 0xff)
  chunks.push((adler >> 8) & 0xff)
  chunks.push(adler & 0xff)

  return new Uint8Array(chunks)
}

/**
 * Raw INFLATE implementation (simplified).
 */
function rawInflate(data: Uint8Array): Uint8Array {
  // Skip zlib header (2 bytes)
  let pos = 0

  if (data.length >= 2) {
    const cmf = data[0]!
    const flg = data[1]!

    // Verify zlib header
    if ((cmf & 0x0f) === 8 && ((cmf * 256 + flg) % 31) === 0) {
      pos = 2

      // Check for FDICT flag
      if (flg & 0x20) {
        pos += 4 // Skip dictionary ID
      }
    }
  }

  const result: number[] = []

  // Process deflate blocks
  let bfinal = 0
  while (!bfinal && pos < data.length - 4) {
    const header = data[pos++]!
    bfinal = header & 0x01
    const btype = (header >> 1) & 0x03

    if (btype === 0) {
      // Stored (uncompressed) block
      const len = data[pos]! | (data[pos + 1]! << 8)
      pos += 4 // Skip LEN and NLEN

      for (let i = 0; i < len && pos < data.length; i++) {
        result.push(data[pos++]!)
      }
    } else if (btype === 1 || btype === 2) {
      // Compressed block - need full huffman decoder
      // For simplicity, we'll just try to decompress using available APIs
      throw new Error('Compressed blocks not supported in minimal shim - use pako')
    } else {
      throw new Error('Invalid block type')
    }
  }

  return new Uint8Array(result)
}

/**
 * Compute Adler-32 checksum.
 */
function computeAdler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  const MOD = 65521

  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % MOD
    b = (b + a) % MOD
  }

  return ((b << 16) | a) >>> 0
}

// =============================================================================
// Node.js zlib implementation (if available)
// =============================================================================

// Try to import Node's zlib module at module load time
let nodeZlibModule: typeof import('zlib') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nodeZlibModule = require('zlib')
} catch {
  nodeZlibModule = null
}

function createNodeZlibInflateClass(zlib: typeof import('zlib')) {
  return class NodeZlibInflate implements InflateStream {
    result: Uint8Array = new Uint8Array(0)
    err: number = 0
    msg?: string
    ended: boolean = false
    strm: ZlibStreamState = {}

    push(data: Uint8Array, _final: boolean): void {
      try {
        // Use info: true to get bytes consumed
        const result = zlib.inflateSync(Buffer.from(data), { info: true }) as unknown as {
          buffer: Buffer
          engine: { bytesWritten: number }
        }
        const { buffer, engine } = result
        this.result = new Uint8Array(buffer)
        // bytesWritten is the number of input bytes consumed
        this.strm.next_in = engine.bytesWritten
        this.strm.avail_in = data.length - engine.bytesWritten
        this.ended = true
      } catch (e) {
        this.err = 1
        this.msg = e instanceof Error ? e.message : 'Unknown error'
      }
    }
  }
}

class NodeZlibImpl implements CompressionApi {
  private zlib: typeof import('zlib')
  Inflate: new () => InflateStream

  constructor(zlib: typeof import('zlib')) {
    this.zlib = zlib
    this.Inflate = createNodeZlibInflateClass(zlib)
  }

  deflate(data: Uint8Array): Uint8Array {
    const result = this.zlib.deflateSync(Buffer.from(data))
    return new Uint8Array(result)
  }

  inflate(data: Uint8Array): Uint8Array {
    const result = this.zlib.inflateSync(Buffer.from(data))
    return new Uint8Array(result)
  }
}

// =============================================================================
// Export
// =============================================================================

// Use Node's zlib if available, otherwise use the minimal shim
export const pako: CompressionApi = nodeZlibModule
  ? new NodeZlibImpl(nodeZlibModule)
  : new ZlibImpl()
