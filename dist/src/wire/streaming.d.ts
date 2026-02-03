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
import type { ObjectType } from '../types/objects';
/**
 * Default chunk size for streaming operations (64KB minus overhead).
 * Aligned with side-band-64k capability for optimal network performance.
 */
export declare const DEFAULT_CHUNK_SIZE = 65500;
/**
 * Minimum chunk size to prevent excessive overhead.
 */
export declare const MIN_CHUNK_SIZE = 1024;
/**
 * Maximum side-band payload size (65516 bytes).
 * This is MAX_PKT_LINE_DATA (65516) minus 1 byte for channel.
 */
export declare const MAX_SIDEBAND_PAYLOAD: number;
/**
 * Large blob threshold (1MB).
 * Objects larger than this should be streamed rather than buffered.
 */
export declare const LARGE_BLOB_THRESHOLD: number;
/**
 * Side-band channel types for multiplexed streaming.
 */
export declare enum StreamChannel {
    /** Packfile data (channel 1) */
    PACK_DATA = 1,
    /** Progress messages (channel 2) */
    PROGRESS = 2,
    /** Error messages (channel 3) */
    ERROR = 3
}
/**
 * Options for creating a blob read stream.
 */
export interface BlobStreamOptions {
    /** Size of each chunk in bytes (default: 65500) */
    chunkSize?: number;
    /** High water mark for backpressure (default: 3 chunks) */
    highWaterMark?: number;
}
/**
 * Options for creating a side-band transform stream.
 */
export interface SideBandOptions {
    /** Channel to use (default: PACK_DATA) */
    channel?: StreamChannel;
    /** Maximum payload size per packet */
    maxPayloadSize?: number;
}
/**
 * Options for the streaming pack writer.
 */
export interface StreamingPackWriterOptions {
    /** Zlib compression level 0-9 (default: 6) */
    compressionLevel?: number;
    /** High water mark for internal buffer */
    highWaterMark?: number;
}
/**
 * Represents an object to be written to a streaming pack.
 */
export interface StreamableObject {
    /** The 40-character hex SHA-1 hash */
    sha: string;
    /** The Git object type */
    type: ObjectType;
    /** The object data (can be Uint8Array or ReadableStream for large objects) */
    data: Uint8Array | ReadableStream<Uint8Array>;
    /** Size of the data in bytes (required for streaming data) */
    size: number;
}
/**
 * Statistics from streaming operations.
 */
export interface StreamingStats {
    /** Total bytes processed */
    bytesProcessed: number;
    /** Number of chunks emitted */
    chunksEmitted: number;
    /** Number of objects processed (for pack streams) */
    objectsProcessed: number;
    /** Time taken in milliseconds */
    durationMs: number;
}
/**
 * Progress callback for streaming operations.
 */
export type StreamProgressCallback = (bytesProcessed: number, totalBytes: number | undefined) => void;
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
export declare function createBlobReadStream(data: Uint8Array, options?: BlobStreamOptions): ReadableStream<Uint8Array>;
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
export declare function createR2ReadStream(r2Object: {
    body: ReadableStream<Uint8Array>;
}): ReadableStream<Uint8Array>;
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
export declare function createSideBandTransform(channel?: StreamChannel, options?: SideBandOptions): TransformStream<Uint8Array, Uint8Array>;
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
export declare function createSideBandExtractTransform(options?: {
    onProgress?: (message: string) => void;
    onError?: (message: string) => void;
}): TransformStream<Uint8Array, Uint8Array>;
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
export declare function createPktLineTransform(): TransformStream<Uint8Array, Uint8Array>;
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
export declare function createStreamingPackWriter(objectCount: number, options?: StreamingPackWriterOptions): StreamingPackWriter;
/**
 * Streaming packfile writer class.
 *
 * @description Incrementally builds a packfile, supporting both regular objects
 * and streaming large blobs. Uses the Web Streams API for memory efficiency.
 */
export declare class StreamingPackWriter {
    private objectCount;
    private objectsWritten;
    private compressionLevel;
    private chunks;
    private hashState;
    private finalized;
    constructor(objectCount: number, options?: StreamingPackWriterOptions);
    /**
     * Writes the pack header (12 bytes).
     */
    private writeHeader;
    /**
     * Converts ObjectType string to PackObjectType number.
     */
    private typeToPackType;
    /**
     * Writes a single object to the pack.
     *
     * @param object - Object to write (can have streaming data)
     *
     * @throws {Error} If the pack writer has already been finalized
     * @throws {Error} If more objects are written than the specified object count
     */
    writeObject(object: StreamableObject): Promise<void>;
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
     *
     * @throws {Error} If the pack writer has already been finalized
     * @throws {Error} If more objects are written than the specified object count
     * @throws {Error} If compression fails
     */
    writeStreamingObject(_sha: string, type: ObjectType, size: number, dataStream: ReadableStream<Uint8Array>): Promise<void>;
    /**
     * Collects a ReadableStream into a Uint8Array.
     */
    private collectStream;
    /**
     * Finalizes the pack and returns a ReadableStream of the complete packfile.
     *
     * @returns ReadableStream of the complete packfile including checksum
     *
     * @throws {Error} If the pack writer has already been finalized
     * @throws {Error} If the number of objects written doesn't match the expected count
     */
    finalize(): Promise<ReadableStream<Uint8Array>>;
    /**
     * Finalizes and returns the complete packfile as a Uint8Array.
     *
     * @description Use this for smaller packs where buffering is acceptable.
     * For large packs, prefer finalize() which returns a stream.
     *
     * @returns Complete packfile as Uint8Array
     */
    finalizeToBuffer(): Promise<Uint8Array>;
    /**
     * Gets the current number of objects written.
     */
    get currentObjectCount(): number;
    /**
     * Gets whether the writer has been finalized.
     */
    get isFinalized(): boolean;
}
/**
 * Options for the streaming pack reader.
 */
export interface StreamingPackReaderOptions {
    /** Callback for each parsed object */
    onObject?: (obj: {
        sha: string;
        type: ObjectType;
        data: Uint8Array;
        offset: number;
    }) => Promise<void>;
    /** Progress callback */
    onProgress?: StreamProgressCallback;
    /** Resolve external bases for thin packs */
    resolveExternalBase?: (sha: string) => Promise<{
        type: ObjectType;
        data: Uint8Array;
    } | null>;
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
 * @throws {Error} If packfile signature is invalid (not 'PACK')
 * @throws {Error} If pack version is unsupported (not 2 or 3)
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
export declare function createStreamingPackReader(options?: StreamingPackReaderOptions): WritableStream<Uint8Array>;
/**
 * Checks if an object size exceeds the large blob threshold.
 *
 * @param size - Object size in bytes
 * @returns true if the object should be streamed
 */
export declare function isLargeBlob(size: number): boolean;
/**
 * Creates a progress-tracking transform stream.
 *
 * @param onProgress - Callback invoked with bytes processed
 * @param totalSize - Optional total size for percentage calculation
 * @returns TransformStream that tracks progress
 */
export declare function createProgressTransform(onProgress: StreamProgressCallback, totalSize?: number): TransformStream<Uint8Array, Uint8Array>;
/**
 * Concatenates multiple ReadableStreams into one.
 *
 * @param streams - Array of streams to concatenate
 * @returns Single ReadableStream containing all data in order
 */
export declare function concatStreams(streams: ReadableStream<Uint8Array>[]): ReadableStream<Uint8Array>;
/**
 * Creates a tee that allows multiple consumers of a single stream.
 *
 * @param stream - Source stream to tee
 * @returns Tuple of two streams that will receive the same data
 */
export declare function teeStream(stream: ReadableStream<Uint8Array>): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>];
//# sourceMappingURL=streaming.d.ts.map