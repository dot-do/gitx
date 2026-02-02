/**
 * @fileoverview Pako/Zlib Compression Shim
 *
 * This module provides compression functionality for pack files.
 * It attempts to use available compression APIs in the environment.
 */
export interface CompressionApi {
    deflate(data: Uint8Array): Uint8Array;
    inflate(data: Uint8Array): Uint8Array;
    Inflate: new () => InflateStream;
}
/** Internal zlib stream state for tracking compression/decompression progress */
export interface ZlibStreamState {
    /** Number of bytes remaining in input buffer (unconsumed bytes) */
    avail_in?: number;
    /** Current position in input buffer */
    next_in?: number;
}
export interface InflateStream {
    push(data: Uint8Array, final: boolean): void;
    result: Uint8Array;
    err: number;
    /** Error message if err is non-zero */
    msg?: string;
    /** Whether the stream has finished processing */
    ended?: boolean;
    /** Internal zlib stream state */
    strm?: ZlibStreamState;
}
export declare const pako: CompressionApi;
//# sourceMappingURL=pako-shim.d.ts.map