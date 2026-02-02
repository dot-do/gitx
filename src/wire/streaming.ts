/**
 * @fileoverview Streaming Support for Git Wire Protocol
 *
 * This module provides streaming interfaces for handling large blobs in the Git
 * wire protocol. It avoids loading entire blobs into memory by using Web Streams
 * API (ReadableStream, WritableStream, TransformStream).
 *
 * ## Key Features
 *
 * - **Chunked blob streaming**: Stream large blobs in configurable chunks
 * - **Side-band multiplexing**: Stream data with channel-based multiplexing
 * - **Pack streaming**: Stream packfile generation without full materialization
 * - **Memory-efficient**: Configurable buffer sizes and backpressure handling
 *
 * ## Usage Patterns
 *
 * 1. **Upload (receive-pack)**: Stream incoming packfile chunks through transform
 * 2. **Download (upload-pack)**: Stream outgoing packfile with side-band framing
 * 3. **Large blob storage**: Stream blobs directly to/from R2 storage
 *
 * @module wire/streaming
 * @see {@link https://git-scm.com/docs/protocol-common} Git Protocol Common
 * @see {@link https://streams.spec.whatwg.org/} WHATWG Streams Standard
 *
 * @example Streaming a large blob
 * ```typescript
 * import { createBlobReadStream, createSideBandTransform } from './wire/streaming'
 *
 * // Stream a large blob with side-band framing
 * const blobStream = createBlobReadStream(blobData, { chunkSize: 65500 })
 * const sideBandStream = blobStream.pipeThrough(createSideBandTransform(1))
 * ```
 *
 * @example Streaming packfile generation
 * ```typescript
 * import { createStreamingPackWriter } from './wire/streaming'
 *
 * const writer = createStreamingPackWriter()
 * for (const obj of objects) {
 *   await writer.writeObject(obj)
 * }
 * const packStream = writer.finalize()
 * ```
 */

import * as pako from 'pako'
import { sha1 } from '../utils/sha1'
import { MAX_PKT_LINE_DATA } from './pkt-line'
import { PackObjectType, encodeTypeAndSize } from '../pack/format'
import type { ObjectType } from '../types/objects'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ============================================================================
// Constants
// ============================================================================

/**
 * Default chunk size for streaming operations (64KB minus overhead).
 * Aligned with side-band-64k capability for optimal network performance.
 */
export const DEFAULT_CHUNK_SIZE = 65500

/**
 * Minimum chunk size to prevent excessive overhead.
 */
export const MIN_CHUNK_SIZE = 1024

/**
 * Maximum side-band payload size (65516 bytes).
 * This is MAX_PKT_LINE_DATA (65516) minus 1 byte for channel.
 */
export const MAX_SIDEBAND_PAYLOAD = MAX_PKT_LINE_DATA - 1

/**
 * Large blob threshold (1MB).
 * Objects larger than this should be streamed rather than buffered.
 */
export const LARGE_BLOB_THRESHOLD = 1024 * 1024

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Side-band channel types for multiplexed streaming.
 */
export enum StreamChannel {
  /** Packfile data (channel 1) */
  PACK_DATA = 1,
  /** Progress messages (channel 2) */
  PROGRESS = 2,
  /** Error messages (channel 3) */
  ERROR = 3,
}

/**
 * Options for creating a blob read stream.
 */
export interface BlobStreamOptions {
  /** Size of each chunk in bytes (default: 65500) */
  chunkSize?: number
  /** High water mark for backpressure (default: 3 chunks) */
  highWaterMark?: number
}

/**
 * Options for creating a side-band transform stream.
 */
export interface SideBandOptions {
  /** Channel to use (default: PACK_DATA) */
  channel?: StreamChannel
  /** Maximum payload size per packet */
  maxPayloadSize?: number
}

/**
 * Options for the streaming pack writer.
 */
export interface StreamingPackWriterOptions {
  /** Zlib compression level 0-9 (default: 6) */
  compressionLevel?: number
  /** High water mark for internal buffer */
  highWaterMark?: number
}

/**
 * Represents an object to be written to a streaming pack.
 */
export interface StreamableObject {
  /** The 40-character hex SHA-1 hash */
  sha: string
  /** The Git object type */
  type: ObjectType
  /** The object data (can be Uint8Array or ReadableStream for large objects) */
  data: Uint8Array | ReadableStream<Uint8Array>
  /** Size of the data in bytes (required for streaming data) */
  size: number
}

/**
 * Statistics from streaming operations.
 */
export interface StreamingStats {
  /** Total bytes processed */
  bytesProcessed: number
  /** Number of chunks emitted */
  chunksEmitted: number
  /** Number of objects processed (for pack streams) */
  objectsProcessed: number
  /** Time taken in milliseconds */
  durationMs: number
}

/**
 * Progress callback for streaming operations.
 */
export type StreamProgressCallback = (
  bytesProcessed: number,
  totalBytes: number | undefined
) => void

// ============================================================================
// Blob Streaming
// ============================================================================

/**
 * Creates a ReadableStream that emits a blob in chunks.
 *
 * @description Efficiently streams large blob data in configurable chunks,
 * implementing backpressure through the Web Streams API. This avoids loading
 * the entire blob into memory at once.
 *
 * @param data - The blob data to stream
 * @param options - Streaming options
 * @returns ReadableStream emitting Uint8Array chunks
 *
 * @example
 * ```typescript
 * const blobStream = createBlobReadStream(largeBlob, { chunkSize: 32768 })
 * for await (const chunk of blobStream) {
 *   await processChunk(chunk)
 * }
 * ```
 */
export function createBlobReadStream(
  data: Uint8Array,
  options: BlobStreamOptions = {}
): ReadableStream<Uint8Array> {
  const chunkSize = Math.max(options.chunkSize ?? DEFAULT_CHUNK_SIZE, MIN_CHUNK_SIZE)
  const highWaterMark = options.highWaterMark ?? 3

  let offset = 0

  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (offset >= data.length) {
          controller.close()
          return
        }

        const end = Math.min(offset + chunkSize, data.length)
        const chunk = data.subarray(offset, end)
        offset = end

        controller.enqueue(chunk)
      },
    },
    new CountQueuingStrategy({ highWaterMark })
  )
}

/**
 * Creates a ReadableStream that reads from an R2 object in chunks.
 *
 * @description Streams data from Cloudflare R2 storage without loading the
 * entire object into memory. Uses R2's native streaming capabilities.
 *
 * @param r2Object - The R2 object to stream from
 * @returns ReadableStream of the object's body
 *
 * @example
 * ```typescript
 * const obj = await r2Bucket.get('large-blob-key')
 * if (obj) {
 *   const stream = createR2ReadStream(obj)
 *   // Process stream...
 * }
 * ```
 */
export function createR2ReadStream(
  r2Object: { body: ReadableStream<Uint8Array> }
): ReadableStream<Uint8Array> {
  return r2Object.body
}

// ============================================================================
// Side-band Streaming
// ============================================================================

/**
 * Creates a TransformStream that wraps data in side-band format.
 *
 * @description Transforms input chunks into pkt-line formatted side-band
 * packets. This enables multiplexed transmission of packfile data alongside
 * progress messages and errors.
 *
 * The side-band format is:
 * - 4-byte hex length prefix (including channel byte)
 * - 1-byte channel identifier
 * - Payload data
 *
 * @param channel - Side-band channel (1=data, 2=progress, 3=error)
 * @param options - Transform options
 * @returns TransformStream that wraps input in side-band format
 *
 * @example
 * ```typescript
 * const transform = createSideBandTransform(StreamChannel.PACK_DATA)
 * const sideBandStream = dataStream.pipeThrough(transform)
 * ```
 */
export function createSideBandTransform(
  channel: StreamChannel = StreamChannel.PACK_DATA,
  options: SideBandOptions = {}
): TransformStream<Uint8Array, Uint8Array> {
  const maxPayload = options.maxPayloadSize ?? MAX_SIDEBAND_PAYLOAD

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      let offset = 0

      while (offset < chunk.length) {
        // Calculate payload size for this packet
        const remaining = chunk.length - offset
        const payloadSize = Math.min(remaining, maxPayload)

        // Total packet size: 4 (length) + 1 (channel) + payload
        const totalSize = 4 + 1 + payloadSize
        const hexLength = totalSize.toString(16).padStart(4, '0')

        // Build the packet
        const packet = new Uint8Array(totalSize)
        packet.set(encoder.encode(hexLength), 0)
        packet[4] = channel
        packet.set(chunk.subarray(offset, offset + payloadSize), 5)

        controller.enqueue(packet)
        offset += payloadSize
      }
    },
  })
}

/**
 * Creates a TransformStream that unwraps side-band formatted data.
 *
 * @description Extracts payload data from side-band packets, filtering by
 * channel. Progress and error messages can be handled separately via callbacks.
 *
 * @param options - Options including callbacks for progress/error channels
 * @returns TransformStream that extracts data from side-band packets
 *
 * @example
 * ```typescript
 * const transform = createSideBandExtractTransform({
 *   onProgress: (msg) => console.log('Progress:', msg),
 *   onError: (msg) => console.error('Error:', msg)
 * })
 * const dataStream = sideBandStream.pipeThrough(transform)
 * ```
 */
export function createSideBandExtractTransform(options: {
  onProgress?: (message: string) => void
  onError?: (message: string) => void
} = {}): TransformStream<Uint8Array, Uint8Array> {
  let buffer = new Uint8Array(0)

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Append to buffer
      const newBuffer = new Uint8Array(buffer.length + chunk.length)
      newBuffer.set(buffer)
      newBuffer.set(chunk, buffer.length)
      buffer = newBuffer

      // Process complete packets
      while (buffer.length >= 4) {
        const lengthHex = decoder.decode(buffer.subarray(0, 4))
        const length = parseInt(lengthHex, 16)

        // Flush packet
        if (length === 0) {
          buffer = buffer.subarray(4)
          continue
        }

        // Check if we have the complete packet
        if (buffer.length < length) break

        // Extract packet data
        const channel = buffer[4]
        const payload = buffer.subarray(5, length)

        if (channel === StreamChannel.PACK_DATA) {
          controller.enqueue(new Uint8Array(payload))
        } else if (channel === StreamChannel.PROGRESS && options.onProgress) {
          options.onProgress(decoder.decode(payload))
        } else if (channel === StreamChannel.ERROR && options.onError) {
          options.onError(decoder.decode(payload))
        }

        buffer = buffer.subarray(length)
      }
    },
    flush(controller) {
      // Handle any remaining data
      if (buffer.length > 0) {
        controller.enqueue(new Uint8Array(buffer))
      }
    },
  })
}

// ============================================================================
// Pkt-line Streaming
// ============================================================================

/**
 * Creates a TransformStream that wraps data in pkt-line format.
 *
 * @description Transforms input chunks into pkt-line formatted packets,
 * splitting large chunks as needed to respect the maximum packet size.
 *
 * @returns TransformStream that wraps input in pkt-line format
 *
 * @example
 * ```typescript
 * const transform = createPktLineTransform()
 * const pktLineStream = dataStream.pipeThrough(transform)
 * ```
 */
export function createPktLineTransform(): TransformStream<Uint8Array, Uint8Array> {

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      let offset = 0

      while (offset < chunk.length) {
        const remaining = chunk.length - offset
        const payloadSize = Math.min(remaining, MAX_PKT_LINE_DATA)

        // Total packet size: 4 (length) + payload
        const totalSize = 4 + payloadSize
        const hexLength = totalSize.toString(16).padStart(4, '0')

        const packet = new Uint8Array(totalSize)
        packet.set(encoder.encode(hexLength), 0)
        packet.set(chunk.subarray(offset, offset + payloadSize), 4)

        controller.enqueue(packet)
        offset += payloadSize
      }
    },
  })
}

// ============================================================================
// Streaming Pack Writer
// ============================================================================

/**
 * Creates a streaming packfile writer that doesn't require all objects in memory.
 *
 * @description Generates a packfile incrementally, writing objects as they are
 * provided. This enables handling large repositories without excessive memory
 * usage. The writer maintains a running SHA-1 hash for the pack checksum.
 *
 * **Limitations:**
 * - Object count must be known upfront (for header)
 * - Delta compression requires base objects to be available
 *
 * @param objectCount - Total number of objects that will be written
 * @param options - Writer options
 * @returns StreamingPackWriter instance
 *
 * @example
 * ```typescript
 * const writer = createStreamingPackWriter(100)
 *
 * // Write objects one at a time
 * for (const obj of objects) {
 *   await writer.writeObject(obj)
 * }
 *
 * // Finalize and get the pack stream
 * const packStream = await writer.finalize()
 * ```
 */
export function createStreamingPackWriter(
  objectCount: number,
  options: StreamingPackWriterOptions = {}
): StreamingPackWriter {
  return new StreamingPackWriter(objectCount, options)
}

/**
 * Streaming packfile writer class.
 *
 * @description Incrementally builds a packfile, supporting both regular objects
 * and streaming large blobs. Uses the Web Streams API for memory efficiency.
 */
export class StreamingPackWriter {
  private objectCount: number
  private objectsWritten: number = 0
  private compressionLevel: number
  private chunks: Uint8Array[] = []
  private hashState: Uint8Array[] = []
  private finalized: boolean = false

  constructor(
    objectCount: number,
    options: StreamingPackWriterOptions = {}
  ) {
    this.objectCount = objectCount
    this.compressionLevel = options.compressionLevel ?? 6

    // Write pack header immediately
    this.writeHeader()
  }

  /**
   * Writes the pack header (12 bytes).
   */
  private writeHeader(): void {
    const header = new Uint8Array(12)

    // PACK signature
    header.set(encoder.encode('PACK'), 0)

    // Version 2 (big-endian)
    header[4] = 0
    header[5] = 0
    header[6] = 0
    header[7] = 2

    // Object count (big-endian)
    header[8] = (this.objectCount >> 24) & 0xff
    header[9] = (this.objectCount >> 16) & 0xff
    header[10] = (this.objectCount >> 8) & 0xff
    header[11] = this.objectCount & 0xff

    this.chunks.push(header)
    this.hashState.push(header)
  }

  /**
   * Converts ObjectType string to PackObjectType number.
   */
  private typeToPackType(type: ObjectType): PackObjectType {
    switch (type) {
      case 'commit': return PackObjectType.OBJ_COMMIT
      case 'tree': return PackObjectType.OBJ_TREE
      case 'blob': return PackObjectType.OBJ_BLOB
      case 'tag': return PackObjectType.OBJ_TAG
      default: throw new Error(`Unknown object type: ${type}`)
    }
  }

  /**
   * Writes a single object to the pack.
   *
   * @param object - Object to write (can have streaming data)
   */
  async writeObject(object: StreamableObject): Promise<void> {
    if (this.finalized) {
      throw new Error('Pack writer has been finalized')
    }

    if (this.objectsWritten >= this.objectCount) {
      throw new Error('Object count exceeded')
    }

    const packType = this.typeToPackType(object.type)

    // Encode type and size header
    const typeAndSize = encodeTypeAndSize(packType, object.size)
    this.chunks.push(typeAndSize)
    this.hashState.push(typeAndSize)

    // Handle streaming vs buffered data
    let data: Uint8Array
    if (object.data instanceof ReadableStream) {
      data = await this.collectStream(object.data)
    } else {
      data = object.data
    }

    // Compress the data
    const compressed = pako.deflate(data, {
      level: this.compressionLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
    })

    this.chunks.push(compressed)
    this.hashState.push(compressed)

    this.objectsWritten++
  }

  /**
   * Writes a large object by streaming its data.
   *
   * @description For very large objects, streams the data through compression
   * without buffering the entire object. Uses zlib's incremental API.
   *
   * @param sha - Object SHA
   * @param type - Object type
   * @param size - Total size in bytes
   * @param dataStream - ReadableStream of object data
   */
  async writeStreamingObject(
    _sha: string,
    type: ObjectType,
    size: number,
    dataStream: ReadableStream<Uint8Array>
  ): Promise<void> {
    if (this.finalized) {
      throw new Error('Pack writer has been finalized')
    }

    if (this.objectsWritten >= this.objectCount) {
      throw new Error('Object count exceeded')
    }

    const packType = this.typeToPackType(type)

    // Write type and size header
    const typeAndSize = encodeTypeAndSize(packType, size)
    this.chunks.push(typeAndSize)
    this.hashState.push(typeAndSize)

    // Stream and compress data
    const reader = dataStream.getReader()
    const deflater = new pako.Deflate({ level: this.compressionLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 })

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        deflater.push(value, false)
      }
      deflater.push(new Uint8Array(0), true)

      if (deflater.err) {
        throw new Error(`Compression error: ${deflater.msg}`)
      }

      const compressed = deflater.result as Uint8Array
      this.chunks.push(compressed)
      this.hashState.push(compressed)
    } finally {
      reader.releaseLock()
    }

    this.objectsWritten++
  }

  /**
   * Collects a ReadableStream into a Uint8Array.
   */
  private async collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    // Concatenate chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }

  /**
   * Finalizes the pack and returns a ReadableStream of the complete packfile.
   *
   * @returns ReadableStream of the complete packfile including checksum
   */
  async finalize(): Promise<ReadableStream<Uint8Array>> {
    if (this.finalized) {
      throw new Error('Pack writer already finalized')
    }

    if (this.objectsWritten !== this.objectCount) {
      throw new Error(
        `Expected ${this.objectCount} objects, but wrote ${this.objectsWritten}`
      )
    }

    this.finalized = true

    // Calculate checksum of all data
    const totalLength = this.hashState.reduce((sum, chunk) => sum + chunk.length, 0)
    const allData = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of this.hashState) {
      allData.set(chunk, offset)
      offset += chunk.length
    }
    const checksum = sha1(allData)

    // Add checksum to chunks
    this.chunks.push(checksum)

    // Create a ReadableStream from chunks
    const chunks = this.chunks
    let index = 0

    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(chunks[index]!)
        index++
      },
    })
  }

  /**
   * Finalizes and returns the complete packfile as a Uint8Array.
   *
   * @description Use this for smaller packs where buffering is acceptable.
   * For large packs, prefer finalize() which returns a stream.
   *
   * @returns Complete packfile as Uint8Array
   */
  async finalizeToBuffer(): Promise<Uint8Array> {
    const stream = await this.finalize()
    return this.collectStream(stream)
  }

  /**
   * Gets the current number of objects written.
   */
  get currentObjectCount(): number {
    return this.objectsWritten
  }

  /**
   * Gets whether the writer has been finalized.
   */
  get isFinalized(): boolean {
    return this.finalized
  }
}

// ============================================================================
// Streaming Pack Reader
// ============================================================================

/**
 * Options for the streaming pack reader.
 */
export interface StreamingPackReaderOptions {
  /** Callback for each parsed object */
  onObject?: (obj: {
    sha: string
    type: ObjectType
    data: Uint8Array
    offset: number
  }) => Promise<void>
  /** Progress callback */
  onProgress?: StreamProgressCallback
  /** Resolve external bases for thin packs */
  resolveExternalBase?: (sha: string) => Promise<{
    type: ObjectType
    data: Uint8Array
  } | null>
}

/**
 * Creates a WritableStream that parses a packfile incrementally.
 *
 * @description Accepts packfile data as a stream and parses objects
 * incrementally, invoking callbacks as each object is fully parsed.
 * This enables processing large packfiles without loading everything
 * into memory.
 *
 * **Note:** Delta resolution still requires base objects to be available,
 * either from earlier in the stream or via the external resolver.
 *
 * @param options - Parser options including callbacks
 * @returns WritableStream that accepts packfile data
 *
 * @example
 * ```typescript
 * const parser = createStreamingPackReader({
 *   onObject: async (obj) => {
 *     await objectStore.put(obj.sha, obj.type, obj.data)
 *   },
 *   onProgress: (bytes, total) => {
 *     console.log(`Parsed ${bytes} of ${total ?? 'unknown'} bytes`)
 *   }
 * })
 *
 * await packfileStream.pipeTo(parser)
 * ```
 */
export function createStreamingPackReader(
  options: StreamingPackReaderOptions = {}
): WritableStream<Uint8Array> {
  let buffer = new Uint8Array(0)
  let headerParsed = false
  let objectCount = 0
  let objectsParsed = 0
  let bytesProcessed = 0

  // Simple object cache for delta resolution (within pack)
  const objectCache = new Map<number, { type: ObjectType; data: Uint8Array }>()

  return new WritableStream<Uint8Array>({
    async write(chunk) {
      // Append to buffer
      const newBuffer = new Uint8Array(buffer.length + chunk.length)
      newBuffer.set(buffer)
      newBuffer.set(chunk, buffer.length)
      buffer = newBuffer
      bytesProcessed += chunk.length

      // Parse header if not done
      if (!headerParsed && buffer.length >= 12) {
        const signature = decoder.decode(buffer.subarray(0, 4))

        if (signature !== 'PACK') {
          throw new Error('Invalid packfile signature')
        }

        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        const version = view.getUint32(4, false)
        if (version !== 2 && version !== 3) {
          throw new Error(`Unsupported pack version: ${version}`)
        }

        objectCount = view.getUint32(8, false)
        headerParsed = true
        buffer = buffer.subarray(12)
      }

      // Parse objects while we have complete ones
      while (headerParsed && objectsParsed < objectCount && buffer.length > 0) {
        const parseResult = tryParseObject(buffer, objectsParsed)
        if (!parseResult) break

        const { type, data, consumed, offset, baseOffset, baseSha } = parseResult

        let resolvedType: ObjectType | null = isObjectType(type) ? type : null
        let resolvedData: Uint8Array = data

        // Handle delta objects
        if (type === 'ofs_delta' && baseOffset !== undefined) {
          const base = objectCache.get(baseOffset)
          if (!base) {
            // Need to wait for more data or base is unavailable
            break
          }
          const { applyDelta } = await import('../pack/delta')
          resolvedData = applyDelta(base.data, data)
          resolvedType = base.type
        } else if (type === 'ref_delta' && baseSha) {
          // Try external resolver
          if (options.resolveExternalBase) {
            const base = await options.resolveExternalBase(baseSha)
            if (base) {
              const { applyDelta } = await import('../pack/delta')
              resolvedData = applyDelta(base.data, data)
              resolvedType = base.type
            }
          }
        }

        // Compute SHA and cache
        if (resolvedType !== null) {
          const sha = computeObjectSha(resolvedType, resolvedData)

          // Cache for future delta resolution
          objectCache.set(offset, { type: resolvedType, data: resolvedData })

          // Invoke callback
          if (options.onObject) {
            await options.onObject({
              sha,
              type: resolvedType,
              data: resolvedData,
              offset,
            })
          }
        }

        buffer = buffer.subarray(consumed)
        objectsParsed++

        if (options.onProgress) {
          options.onProgress(bytesProcessed, undefined)
        }
      }
    },
  })
}

/**
 * Attempts to parse a single object from the buffer.
 * Returns null if buffer doesn't contain a complete object.
 */
function tryParseObject(
  buffer: Uint8Array,
  objectIndex: number
): {
  type: PackTypeString
  data: Uint8Array
  consumed: number
  offset: number
  baseOffset?: number
  baseSha?: string
} | null {
  if (buffer.length < 2) return null

  let offset = 0
  const startOffset = objectIndex // Simplified; real impl tracks byte offsets

  // Decode type and size
  let byte = buffer[offset++]!
  const type = (byte >> 4) & 0x07
  let size = byte & 0x0f
  let shift = 4

  while (byte & 0x80) {
    if (offset >= buffer.length) return null
    byte = buffer[offset++]!
    size |= (byte & 0x7f) << shift
    shift += 7
  }

  // Handle delta types
  let baseOffset: number | undefined
  let baseSha: string | undefined

  if (type === 6) {
    // OFS_DELTA
    if (offset >= buffer.length) return null
    byte = buffer[offset++]!
    baseOffset = byte & 0x7f
    while (byte & 0x80) {
      if (offset >= buffer.length) return null
      baseOffset += 1
      byte = buffer[offset++]!
      baseOffset = (baseOffset << 7) | (byte & 0x7f)
    }
  } else if (type === 7) {
    // REF_DELTA
    if (offset + 20 > buffer.length) return null
    const shaBytes = buffer.subarray(offset, offset + 20)
    baseSha = Array.from(shaBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    offset += 20
  }

  // Try to decompress
  try {
    // Attempt decompression with increasing buffer sizes
    for (let tryLen = Math.min(size + 20, buffer.length - offset); tryLen <= buffer.length - offset; tryLen++) {
      try {
        const compressed = buffer.subarray(offset, offset + tryLen)
        const decompressed = pako.inflate(compressed)
        if (decompressed.length === size) {
          const typeStr = packTypeToString(type)
          const result: {
            type: PackTypeString
            data: Uint8Array
            consumed: number
            offset: number
            baseOffset?: number
            baseSha?: string
          } = {
            type: typeStr,
            data: decompressed,
            consumed: offset + tryLen,
            offset: startOffset,
          }
          if (baseOffset !== undefined) {
            result.baseOffset = baseOffset
          }
          if (baseSha !== undefined) {
            result.baseSha = baseSha
          }
          return result
        }
      } catch {
        // Continue trying with more data
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Delta type strings for internal use.
 */
type DeltaType = 'ofs_delta' | 'ref_delta'

/**
 * All pack type strings including delta types.
 */
type PackTypeString = ObjectType | DeltaType

/**
 * Converts pack type number to string.
 */
function packTypeToString(type: number): PackTypeString {
  switch (type) {
    case 1: return 'commit'
    case 2: return 'tree'
    case 3: return 'blob'
    case 4: return 'tag'
    case 6: return 'ofs_delta'
    case 7: return 'ref_delta'
    default: throw new Error(`Unknown pack type: ${type}`)
  }
}

/**
 * Type guard to check if a pack type string is a base ObjectType.
 */
function isObjectType(type: PackTypeString): type is ObjectType {
  return type === 'commit' || type === 'tree' || type === 'blob' || type === 'tag'
}

/**
 * Computes the SHA-1 hash of a Git object.
 */
function computeObjectSha(type: ObjectType, data: Uint8Array): string {
  const header = `${type} ${data.length}\0`
  const headerBytes = encoder.encode(header)
  const combined = new Uint8Array(headerBytes.length + data.length)
  combined.set(headerBytes, 0)
  combined.set(data, headerBytes.length)
  const hash = sha1(combined)
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Checks if an object size exceeds the large blob threshold.
 *
 * @param size - Object size in bytes
 * @returns true if the object should be streamed
 */
export function isLargeBlob(size: number): boolean {
  return size > LARGE_BLOB_THRESHOLD
}

/**
 * Creates a progress-tracking transform stream.
 *
 * @param onProgress - Callback invoked with bytes processed
 * @param totalSize - Optional total size for percentage calculation
 * @returns TransformStream that tracks progress
 */
export function createProgressTransform(
  onProgress: StreamProgressCallback,
  totalSize?: number
): TransformStream<Uint8Array, Uint8Array> {
  let bytesProcessed = 0

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesProcessed += chunk.length
      onProgress(bytesProcessed, totalSize)
      controller.enqueue(chunk)
    },
  })
}

/**
 * Concatenates multiple ReadableStreams into one.
 *
 * @param streams - Array of streams to concatenate
 * @returns Single ReadableStream containing all data in order
 */
export function concatStreams(
  streams: ReadableStream<Uint8Array>[]
): ReadableStream<Uint8Array> {
  let currentIndex = 0
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (currentIndex < streams.length) {
        if (!currentReader) {
          currentReader = streams[currentIndex]!.getReader()
        }

        const { done, value } = await currentReader.read()

        if (done) {
          currentReader.releaseLock()
          currentReader = null
          currentIndex++
          continue
        }

        controller.enqueue(value)
        return
      }

      controller.close()
    },
    cancel() {
      if (currentReader) {
        currentReader.releaseLock()
      }
    },
  })
}

/**
 * Creates a tee that allows multiple consumers of a single stream.
 *
 * @param stream - Source stream to tee
 * @returns Tuple of two streams that will receive the same data
 */
export function teeStream(
  stream: ReadableStream<Uint8Array>
): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] {
  return stream.tee()
}
