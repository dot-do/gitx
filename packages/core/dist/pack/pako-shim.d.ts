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
export interface InflateStream {
    push(data: Uint8Array, final: boolean): void;
    result: Uint8Array;
    err: number;
}
export declare const pako: CompressionApi;
//# sourceMappingURL=pako-shim.d.ts.map