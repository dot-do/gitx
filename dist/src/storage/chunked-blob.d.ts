/**
 * @fileoverview Chunked BLOB Storage for 2MB Pages
 *
 * This module implements cost-optimized large blob storage by chunking data
 * into 2MB BLOB rows to minimize Durable Object storage costs.
 *
 * Key insight: DO SQLite pricing is per-row read/write, NOT by size.
 * By storing large blobs in 2MB chunks, we minimize the number of row operations.
 *
 * Example cost comparison for a 10MB git blob:
 * - Without chunking (1KB rows): ~10,000 row operations
 * - With 2MB chunking: 5 row operations
 * - Cost reduction: ~2000x fewer billable operations
 *
 * Issue: gitx-rb10 - [GREEN] Implement ChunkedHotTier for 2MB BLOB pages
 *
 * @module storage/chunked-blob
 */
import { CHUNK_SIZE, CHUNKED_BLOB_PREFIX, type ChunkedWriteResult, type ChunkMetadata } from './chunk-utils';
export { CHUNK_SIZE, CHUNKED_BLOB_PREFIX };
export type { ChunkedWriteResult, ChunkMetadata };
/**
 * Interface for chunked blob storage operations.
 */
export interface ChunkedBlobStorage {
    /**
     * Write a blob, automatically chunking if > CHUNK_SIZE.
     * @param data - Blob data to store
     * @returns Write result with SHA and chunk metadata
     */
    writeBlob(data: Uint8Array): Promise<ChunkedWriteResult>;
    /**
     * Read a complete blob, reassembling from chunks if needed.
     * @param sha - The blob's SHA-1 hash
     * @returns Blob data or null if not found
     */
    readBlob(sha: string): Promise<Uint8Array | null>;
    /**
     * Read a range of bytes from a blob.
     * Efficiently reads only the chunks needed to satisfy the range.
     * @param sha - The blob's SHA-1 hash
     * @param offset - Start byte offset
     * @param length - Number of bytes to read
     * @returns Range data or null if blob not found
     */
    readRange(sha: string, offset: number, length: number): Promise<Uint8Array | null>;
    /**
     * Delete a blob and all its chunks.
     * @param sha - The blob's SHA-1 hash
     * @returns true if deleted, false if not found
     */
    deleteBlob(sha: string): Promise<boolean>;
    /**
     * Check if a blob exists.
     * @param sha - The blob's SHA-1 hash
     */
    hasBlob(sha: string): Promise<boolean>;
    /**
     * Get metadata for a blob.
     * @param sha - The blob's SHA-1 hash
     */
    getMetadata(sha: string): Promise<ChunkMetadata | null>;
    /**
     * Get all chunk keys for a blob (for testing/debugging).
     * @param sha - The blob's SHA-1 hash
     */
    getChunkKeys(sha: string): Promise<string[]>;
}
/**
 * Internal storage interface for the chunked blob storage.
 * This allows the storage to work with different backends (Map, DO storage, etc.)
 */
export interface ChunkedBlobStorageBackend {
    get(key: string): Promise<Uint8Array | undefined>;
    put(key: string, value: Uint8Array): Promise<void>;
    delete(key: string): Promise<boolean>;
    has(key: string): Promise<boolean>;
}
/**
 * Create a ChunkedBlobStorage instance backed by a Map (for testing).
 *
 * @returns ChunkedBlobStorage implementation
 *
 * @example
 * ```typescript
 * const storage = createChunkedBlobStorage()
 *
 * // Write large file
 * const result = await storage.writeBlob(largeData)
 * console.log(`Stored ${result.size} bytes in ${result.chunkCount} chunks`)
 *
 * // Read it back
 * const data = await storage.readBlob(result.sha)
 *
 * // Read a range
 * const range = await storage.readRange(result.sha, 0, 1024)
 * ```
 */
export declare function createChunkedBlobStorage(): ChunkedBlobStorage;
//# sourceMappingURL=chunked-blob.d.ts.map