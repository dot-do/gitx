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

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum chunk size for optimal DO SQLite pricing (2MB).
 * DO SQLite charges per row read/write regardless of size up to 2MB.
 * Objects larger than this will be chunked.
 */
export const CHUNK_SIZE = 2 * 1024 * 1024 // 2MB

/**
 * Storage key prefix for chunked blob metadata.
 * Used to identify chunked blob entries in the objects table.
 */
export const CHUNKED_BLOB_PREFIX = '__chunked_blob__'

// ============================================================================
// Chunk Calculation Utilities
// ============================================================================

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
export function calculateChunkCount(size: number, chunkSize: number = CHUNK_SIZE): number {
  if (size === 0) return 0
  return Math.ceil(size / chunkSize)
}

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
export function shouldChunk(size: number, chunkSize: number = CHUNK_SIZE): boolean {
  return size > chunkSize
}

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
export function getChunkRange(
  offset: number,
  length: number,
  chunkSize: number = CHUNK_SIZE
): { startChunk: number; endChunk: number } {
  const startChunk = Math.floor(offset / chunkSize)
  const endChunk = Math.floor((offset + length - 1) / chunkSize)
  return { startChunk, endChunk }
}

// ============================================================================
// Chunk Key Generation
// ============================================================================

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
export function getChunkKey(
  sha: string,
  chunkIndex: number,
  prefix: string = CHUNKED_BLOB_PREFIX
): string {
  return `${prefix}${sha}:${chunkIndex}`
}

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
export function getMetadataKey(sha: string, prefix: string = CHUNKED_BLOB_PREFIX): string {
  return `${prefix}${sha}`
}

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
export function getAllChunkKeys(
  sha: string,
  chunkCount: number,
  prefix: string = CHUNKED_BLOB_PREFIX
): string[] {
  const keys: string[] = []
  for (let i = 0; i < chunkCount; i++) {
    keys.push(getChunkKey(sha, i, prefix))
  }
  return keys
}

// ============================================================================
// Chunking and Reassembly Operations
// ============================================================================

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
export function splitIntoChunks(data: Uint8Array, chunkSize: number = CHUNK_SIZE): Uint8Array[] {
  if (data.length === 0) {
    return []
  }

  if (data.length <= chunkSize) {
    return [data.slice()]
  }

  const chunks: Uint8Array[] = []
  const chunkCount = calculateChunkCount(data.length, chunkSize)

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, data.length)
    chunks.push(data.slice(start, end))
  }

  return chunks
}

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
export function reassembleChunks(chunks: Uint8Array[], totalSize?: number): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array(0)
  }

  // Calculate actual total size
  let actualSize = 0
  for (const chunk of chunks) {
    actualSize += chunk.length
  }

  // Validate if totalSize provided
  if (totalSize !== undefined && actualSize !== totalSize) {
    throw new Error(
      `Chunk reassembly size mismatch: expected ${totalSize}, got ${actualSize}`
    )
  }

  // Reassemble
  const result = new Uint8Array(actualSize)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

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
export function extractRange(
  chunks: Uint8Array[],
  offset: number,
  length: number,
  chunkSize: number = CHUNK_SIZE
): Uint8Array {
  if (length === 0) {
    return new Uint8Array(0)
  }

  // Calculate total size
  let totalSize = 0
  for (const chunk of chunks) {
    totalSize += chunk.length
  }

  // Validate range
  if (offset < 0) {
    throw new Error(`Invalid offset: ${offset} must be non-negative`)
  }
  if (length < 0) {
    throw new Error(`Invalid length: ${length} must be non-negative`)
  }
  if (offset >= totalSize) {
    throw new Error(`Range out of bounds: offset=${offset} exceeds size=${totalSize}`)
  }
  if (offset + length > totalSize) {
    throw new Error(
      `Range out of bounds: offset=${offset} + length=${length} exceeds size=${totalSize}`
    )
  }

  // Find which chunks we need
  const { startChunk, endChunk } = getChunkRange(offset, length, chunkSize)

  // Get only the needed chunks
  const neededChunks = chunks.slice(startChunk, endChunk + 1)

  // If only one chunk needed and it's the exact range
  if (neededChunks.length === 1) {
    const startOffset = offset - startChunk * chunkSize
    return neededChunks[0].slice(startOffset, startOffset + length)
  }

  // Calculate total size of fetched chunks
  let neededSize = 0
  for (const chunk of neededChunks) {
    neededSize += chunk.length
  }

  // Assemble the needed chunks
  const assembled = new Uint8Array(neededSize)
  let pos = 0
  for (const chunk of neededChunks) {
    assembled.set(chunk, pos)
    pos += chunk.length
  }

  // Calculate offset within assembled data
  const startOffset = offset - startChunk * chunkSize

  // Extract the requested range
  return assembled.slice(startOffset, startOffset + length)
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Result of a chunked write operation.
 */
export interface ChunkedWriteResult {
  /** 40-character SHA-1 hash */
  sha: string
  /** Total size in bytes */
  size: number
  /** Number of chunks created */
  chunkCount: number
  /** Array of chunk keys */
  chunkKeys: string[]
  /** Whether the blob was chunked (size > CHUNK_SIZE) */
  isChunked: boolean
}

/**
 * Metadata for a chunked blob.
 */
export interface ChunkMetadata {
  /** 40-character SHA-1 hash */
  sha: string
  /** Total size in bytes */
  totalSize: number
  /** Number of chunks */
  chunkCount: number
  /** Whether the blob is chunked (size > CHUNK_SIZE) */
  isChunked: boolean
  /** Chunk keys for the blob */
  chunkKeys: string[]
}
