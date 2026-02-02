/**
 * @fileoverview Shared Chunked Blob Utilities
 *
 * This module provides shared utilities for chunked blob storage operations.
 * Both the ObjectStore (DO-backed) and ChunkedBlobStorage (in-memory/abstract)
 * use these utilities to ensure consistent chunking behavior.
 *
 * Key insight: DO SQLite pricing is per-row read/write, NOT by size.
 * By storing large blobs in 2MB chunks, we minimize the number of row operations.
 *
 * Example cost comparison for a 10MB git blob:
 * - Without chunking (1KB rows): ~10,000 row operations
 * - With 2MB chunking: 5 row operations
 * - Cost reduction: ~2000x fewer billable operations
 *
 * @module storage/chunk-utils
 */
/**
 * Maximum chunk size for optimal DO SQLite pricing (2MB).
 * DO SQLite charges per row read/write regardless of size up to 2MB.
 * Objects larger than this will be chunked.
 */
export declare const CHUNK_SIZE: number;
/**
 * Storage key prefix for chunked blob metadata.
 * Used to identify chunked blob entries in the objects table.
 */
export declare const CHUNKED_BLOB_PREFIX = "__chunked_blob__";
/**
 * Calculate the number of chunks needed for a given data size.
 *
 * @param size - Total size of the data in bytes
 * @param chunkSize - Size of each chunk (default: CHUNK_SIZE)
 * @returns Number of chunks needed
 *
 * @example
 * ```typescript
 * calculateChunkCount(5 * 1024 * 1024) // 3 (for 5MB data)
 * calculateChunkCount(2 * 1024 * 1024) // 1 (exactly 2MB, not chunked)
 * calculateChunkCount(1024) // 1 (small data, single chunk)
 * ```
 */
export declare function calculateChunkCount(size: number, chunkSize?: number): number;
/**
 * Determine if data should be chunked based on size.
 *
 * @param size - Size of the data in bytes
 * @param chunkSize - Threshold for chunking (default: CHUNK_SIZE)
 * @returns true if data should be chunked (size > chunkSize)
 *
 * @example
 * ```typescript
 * shouldChunk(5 * 1024 * 1024) // true (5MB > 2MB)
 * shouldChunk(2 * 1024 * 1024) // false (exactly 2MB, store as single chunk)
 * shouldChunk(1024) // false (1KB, way under threshold)
 * ```
 */
export declare function shouldChunk(size: number, chunkSize?: number): boolean;
/**
 * Calculate which chunk(s) a byte range spans.
 *
 * @param offset - Start byte offset
 * @param length - Number of bytes to read
 * @param chunkSize - Size of each chunk (default: CHUNK_SIZE)
 * @returns Object with startChunk and endChunk indices
 *
 * @example
 * ```typescript
 * // For a 5MB blob stored in 2MB chunks:
 * getChunkRange(0, 100) // { startChunk: 0, endChunk: 0 }
 * getChunkRange(3 * 1024 * 1024, 100) // { startChunk: 1, endChunk: 1 }
 * getChunkRange(1.5 * 1024 * 1024, 1024 * 1024) // { startChunk: 0, endChunk: 1 }
 * ```
 */
export declare function getChunkRange(offset: number, length: number, chunkSize?: number): {
    startChunk: number;
    endChunk: number;
};
/**
 * Generate a chunk storage key for a given SHA and chunk index.
 * Pattern: {prefix}{sha}:{chunkIndex}
 *
 * @param sha - 40-character SHA-1 hash
 * @param chunkIndex - Zero-based chunk index
 * @param prefix - Key prefix (default: CHUNKED_BLOB_PREFIX)
 * @returns Storage key for the chunk
 *
 * @example
 * ```typescript
 * getChunkKey('abc123', 0) // '__chunked_blob__abc123:0'
 * getChunkKey('abc123', 2) // '__chunked_blob__abc123:2'
 * ```
 */
export declare function getChunkKey(sha: string, chunkIndex: number, prefix?: string): string;
/**
 * Generate a metadata key for a given SHA.
 * Used to store/retrieve blob metadata.
 *
 * @param sha - 40-character SHA-1 hash
 * @param prefix - Key prefix (default: CHUNKED_BLOB_PREFIX)
 * @returns Metadata key for the blob
 *
 * @example
 * ```typescript
 * getMetadataKey('abc123') // '__chunked_blob__abc123'
 * ```
 */
export declare function getMetadataKey(sha: string, prefix?: string): string;
/**
 * Generate all chunk keys for a blob given its SHA and chunk count.
 *
 * @param sha - 40-character SHA-1 hash
 * @param chunkCount - Number of chunks
 * @param prefix - Key prefix (default: CHUNKED_BLOB_PREFIX)
 * @returns Array of chunk keys
 *
 * @example
 * ```typescript
 * getAllChunkKeys('abc123', 3)
 * // ['__chunked_blob__abc123:0', '__chunked_blob__abc123:1', '__chunked_blob__abc123:2']
 * ```
 */
export declare function getAllChunkKeys(sha: string, chunkCount: number, prefix?: string): string[];
/**
 * Split data into chunks of the specified size.
 *
 * @param data - Data to split
 * @param chunkSize - Maximum size of each chunk (default: CHUNK_SIZE)
 * @returns Array of chunks (Uint8Array slices)
 *
 * @example
 * ```typescript
 * const data = new Uint8Array(5 * 1024 * 1024) // 5MB
 * const chunks = splitIntoChunks(data)
 * // chunks.length === 3 (2MB + 2MB + 1MB)
 * ```
 */
export declare function splitIntoChunks(data: Uint8Array, chunkSize?: number): Uint8Array[];
/**
 * Reassemble chunks back into a single Uint8Array.
 *
 * @param chunks - Array of chunks to reassemble
 * @param totalSize - Expected total size (optional, for validation)
 * @returns Reassembled data
 * @throws Error if totalSize is provided and doesn't match
 *
 * @example
 * ```typescript
 * const chunk0 = new Uint8Array([1, 2, 3])
 * const chunk1 = new Uint8Array([4, 5, 6])
 * const data = reassembleChunks([chunk0, chunk1])
 * // data === [1, 2, 3, 4, 5, 6]
 * ```
 */
export declare function reassembleChunks(chunks: Uint8Array[], totalSize?: number): Uint8Array;
/**
 * Extract a range of bytes from data, potentially spanning multiple chunks.
 *
 * @param chunks - Array of chunks (in order)
 * @param offset - Start byte offset in the original data
 * @param length - Number of bytes to extract
 * @param chunkSize - Size of each chunk (default: CHUNK_SIZE)
 * @returns Extracted data
 * @throws Error if range is out of bounds
 *
 * @example
 * ```typescript
 * // Extract 100 bytes starting at offset 3MB from 5MB data stored in 2MB chunks
 * const chunk0 = new Uint8Array(2 * 1024 * 1024)
 * const chunk1 = new Uint8Array(2 * 1024 * 1024)
 * const chunk2 = new Uint8Array(1 * 1024 * 1024)
 * const data = extractRange([chunk0, chunk1, chunk2], 3 * 1024 * 1024, 100)
 * ```
 */
export declare function extractRange(chunks: Uint8Array[], offset: number, length: number, chunkSize?: number): Uint8Array;
/**
 * Result of a chunked write operation.
 */
export interface ChunkedWriteResult {
    /** 40-character SHA-1 hash */
    sha: string;
    /** Total size in bytes */
    size: number;
    /** Number of chunks created */
    chunkCount: number;
    /** Array of chunk keys */
    chunkKeys: string[];
    /** Whether the blob was chunked (size > CHUNK_SIZE) */
    isChunked: boolean;
}
/**
 * Metadata for a chunked blob.
 */
export interface ChunkMetadata {
    /** 40-character SHA-1 hash */
    sha: string;
    /** Total size in bytes */
    totalSize: number;
    /** Number of chunks */
    chunkCount: number;
    /** Whether the blob is chunked (size > CHUNK_SIZE) */
    isChunked: boolean;
    /** Chunk keys for the blob */
    chunkKeys: string[];
}
//# sourceMappingURL=chunk-utils.d.ts.map