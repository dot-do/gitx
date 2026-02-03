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
import { CHUNK_SIZE, CHUNKED_BLOB_PREFIX, calculateChunkCount, shouldChunk, getChunkRange, getMetadataKey } from './chunk-utils';
// Re-export constants and types for backward compatibility
export { CHUNK_SIZE, CHUNKED_BLOB_PREFIX };
const encoder = new TextEncoder();
// ============================================================================
// Implementation
// ============================================================================
/**
 * Compute SHA-1 hash for a blob using Git's blob format.
 * Git format: "blob {size}\0{content}"
 */
async function computeBlobSha(content) {
    const header = encoder.encode(`blob ${content.length}\0`);
    const data = new Uint8Array(header.length + content.length);
    data.set(header);
    data.set(content, header.length);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Generate chunk key for a given SHA and chunk index.
 * Pattern: {sha}:chunk:{n}
 * Note: This uses a different pattern than the ObjectStore for backward compatibility
 * with the in-memory ChunkedBlobStorage implementation.
 */
function getLocalChunkKey(sha, chunkIndex) {
    return `${sha}:chunk:${chunkIndex}`;
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
export function createChunkedBlobStorage() {
    // In-memory storage for testing
    const chunks = new Map();
    const metadata = new Map();
    /**
     * Write a blob, automatically chunking if > CHUNK_SIZE.
     */
    async function writeBlob(data) {
        const sha = await computeBlobSha(data);
        // Handle empty blob
        if (data.length === 0) {
            const record = {
                sha,
                totalSize: 0,
                chunkCount: 0,
                isChunked: false,
                chunkKeys: [],
                data: new Uint8Array(0),
            };
            metadata.set(getMetadataKey(sha), record);
            return {
                sha,
                size: 0,
                chunkCount: 0,
                chunkKeys: [],
                isChunked: false,
            };
        }
        // Determine if we need to chunk using shared utility
        const needsChunking = shouldChunk(data.length);
        if (!needsChunking) {
            // Store as single chunk (not chunked)
            const record = {
                sha,
                totalSize: data.length,
                chunkCount: 1,
                isChunked: false,
                chunkKeys: [],
                data: data.slice(), // Copy the data
            };
            metadata.set(getMetadataKey(sha), record);
            return {
                sha,
                size: data.length,
                chunkCount: 1,
                chunkKeys: [],
                isChunked: false,
            };
        }
        // Chunk the data using shared utility
        const numChunks = calculateChunkCount(data.length);
        const chunkKeys = [];
        for (let i = 0; i < numChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, data.length);
            const chunk = data.slice(start, end);
            const key = getLocalChunkKey(sha, i);
            chunks.set(key, chunk);
            chunkKeys.push(key);
        }
        // Store metadata
        const record = {
            sha,
            totalSize: data.length,
            chunkCount: numChunks,
            isChunked: true,
            chunkKeys,
        };
        metadata.set(getMetadataKey(sha), record);
        return {
            sha,
            size: data.length,
            chunkCount: numChunks,
            chunkKeys,
            isChunked: true,
        };
    }
    /**
     * Read a complete blob, reassembling from chunks if needed.
     *
     * @throws {Error} If a chunk is missing for a chunked blob
     */
    async function readBlob(sha) {
        const record = metadata.get(getMetadataKey(sha));
        if (!record) {
            return null;
        }
        // Handle empty blob
        if (record.totalSize === 0) {
            return new Uint8Array(0);
        }
        // Handle non-chunked blob
        if (!record.isChunked) {
            return record.data ? record.data.slice() : null;
        }
        // Reassemble chunked blob
        const result = new Uint8Array(record.totalSize);
        let offset = 0;
        for (const key of record.chunkKeys) {
            const chunk = chunks.get(key);
            if (!chunk) {
                throw new Error(`Missing chunk: ${key}`);
            }
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }
    /**
     * Read a range of bytes from a blob.
     *
     * @throws {Error} If offset is negative
     * @throws {Error} If length is negative
     * @throws {Error} If range exceeds blob size
     * @throws {Error} If data is missing for non-chunked blob
     * @throws {Error} If a chunk is missing for a chunked blob
     */
    async function readRange(sha, offset, length) {
        const record = metadata.get(getMetadataKey(sha));
        if (!record) {
            return null;
        }
        // Validate range
        if (offset < 0) {
            throw new Error(`Invalid offset: ${offset} must be non-negative`);
        }
        if (length < 0) {
            throw new Error(`Invalid length: ${length} must be non-negative`);
        }
        if (offset >= record.totalSize) {
            throw new Error(`Range out of bounds: offset=${offset} exceeds size=${record.totalSize}`);
        }
        if (offset + length > record.totalSize) {
            throw new Error(`Range out of bounds: offset=${offset} + length=${length} exceeds size=${record.totalSize}`);
        }
        // Handle empty read
        if (length === 0) {
            return new Uint8Array(0);
        }
        // Handle non-chunked blob
        if (!record.isChunked) {
            if (!record.data) {
                throw new Error(`Missing data for non-chunked blob: ${sha}`);
            }
            return record.data.slice(offset, offset + length);
        }
        // Determine which chunks we need
        const { startChunk, endChunk } = getChunkRange(offset, length, CHUNK_SIZE);
        // Read only the necessary chunks
        const neededKeys = record.chunkKeys.slice(startChunk, endChunk + 1);
        const chunkData = [];
        for (const key of neededKeys) {
            const chunk = chunks.get(key);
            if (!chunk) {
                throw new Error(`Missing chunk: ${key}`);
            }
            chunkData.push(chunk);
        }
        // Calculate total size of fetched chunks
        let totalChunkSize = 0;
        for (const chunk of chunkData) {
            totalChunkSize += chunk.length;
        }
        // Assemble the chunks
        const assembled = new Uint8Array(totalChunkSize);
        let pos = 0;
        for (const chunk of chunkData) {
            assembled.set(chunk, pos);
            pos += chunk.length;
        }
        // Calculate offset within the assembled data
        const startOffset = offset - startChunk * CHUNK_SIZE;
        // Extract the requested range
        return assembled.slice(startOffset, startOffset + length);
    }
    /**
     * Delete a blob and all its chunks.
     */
    async function deleteBlob(sha) {
        const record = metadata.get(getMetadataKey(sha));
        if (!record) {
            return false;
        }
        // Delete all chunks
        for (const key of record.chunkKeys) {
            chunks.delete(key);
        }
        // Delete metadata
        metadata.delete(getMetadataKey(sha));
        return true;
    }
    /**
     * Check if a blob exists.
     */
    async function hasBlob(sha) {
        return metadata.has(getMetadataKey(sha));
    }
    /**
     * Get metadata for a blob.
     */
    async function getMetadata(sha) {
        const record = metadata.get(getMetadataKey(sha));
        if (!record) {
            return null;
        }
        return {
            sha: record.sha,
            totalSize: record.totalSize,
            chunkCount: record.chunkCount,
            isChunked: record.isChunked,
            chunkKeys: record.isChunked ? record.chunkKeys.slice() : [],
        };
    }
    /**
     * Get all chunk keys for a blob.
     */
    async function getChunkKeys(sha) {
        const record = metadata.get(getMetadataKey(sha));
        if (!record) {
            return [];
        }
        // Non-chunked blobs return empty array
        if (!record.isChunked) {
            return [];
        }
        return record.chunkKeys.slice();
    }
    return {
        writeBlob,
        readBlob,
        readRange,
        deleteBlob,
        hasBlob,
        getMetadata,
        getChunkKeys,
    };
}
//# sourceMappingURL=chunked-blob.js.map