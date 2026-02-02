/**
 * @fileoverview Chunk Compactor for DO Storage Efficiency
 *
 * Implements blob chunking compaction to optimize Durable Object storage costs.
 * The key insight is that DO SQLite charges per-row read/write, not by size,
 * so merging small blobs into larger chunks reduces billable operations.
 *
 * Compaction Strategy:
 * - Small blobs (< compaction threshold) are candidates for merging
 * - Multiple small blobs are packed into 2MB super-chunks
 * - An index tracks which blobs are stored in which super-chunk
 * - During compaction, small blobs are read, merged, and rewritten
 *
 * Storage Layout:
 * - Original: Each small blob = 1 row (many rows for many small files)
 * - Compacted: Multiple small blobs packed into 2MB chunks (fewer rows)
 *
 * Example cost savings:
 * - 1000 small files averaging 10KB each = 1000 row operations
 * - After compaction into 2MB chunks: ~5 row operations
 * - Cost reduction: ~200x fewer billable operations
 *
 * Issue: gitx-512e - [ARCH] Add blob chunking compaction for DO storage efficiency
 *
 * @module storage/chunk-compactor
 */

import {
  CHUNK_SIZE,
} from './chunk-utils'

// ============================================================================
// Constants
// ============================================================================

/**
 * Default threshold for considering a blob "small" and eligible for compaction.
 * Blobs smaller than this will be packed together into super-chunks.
 * Default: 64KB (blobs under 64KB can be efficiently packed)
 */
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const DEFAULT_COMPACTION_THRESHOLD = 64 * 1024 // 64KB

/**
 * Minimum number of small blobs needed to trigger compaction.
 * Compaction has overhead, so only run when there are enough candidates.
 */
export const DEFAULT_MIN_BLOBS_FOR_COMPACTION = 10

/**
 * Prefix for compacted super-chunk storage keys.
 */
export const SUPER_CHUNK_PREFIX = '__super_chunk__'

/**
 * Prefix for compaction index storage keys.
 */
export const COMPACTION_INDEX_PREFIX = '__compaction_idx__'

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for chunk compaction.
 */
export interface ChunkCompactorConfig {
  /** Size threshold for considering a blob "small" (default: 64KB) */
  compactionThreshold?: number
  /** Minimum blobs needed to trigger compaction (default: 10) */
  minBlobsForCompaction?: number
  /** Target size for super-chunks (default: CHUNK_SIZE = 2MB) */
  targetChunkSize?: number
  /** Maximum size for a single super-chunk (default: CHUNK_SIZE = 2MB) */
  maxChunkSize?: number
}

/**
 * Entry in the compaction index tracking where a blob is stored.
 */
export interface CompactionIndexEntry {
  /** SHA of the original blob */
  sha: string
  /** ID of the super-chunk containing this blob */
  superChunkId: string
  /** Byte offset within the super-chunk */
  offset: number
  /** Size of the blob in bytes */
  size: number
  /** Object type (blob, tree, commit, tag) */
  type: string
}

/**
 * Metadata for a super-chunk.
 */
export interface SuperChunkMetadata {
  /** Unique ID for this super-chunk */
  id: string
  /** Total size of the super-chunk in bytes */
  totalSize: number
  /** Number of blobs packed in this super-chunk */
  blobCount: number
  /** List of blob SHAs in this super-chunk (in order) */
  blobShas: string[]
  /** Timestamp when this super-chunk was created */
  createdAt: number
}

/**
 * A blob candidate for compaction.
 */
export interface CompactionCandidate {
  /** SHA of the blob */
  sha: string
  /** Object type */
  type: string
  /** Blob data */
  data: Uint8Array
}

/**
 * Result of a compaction operation.
 */
export interface CompactionResult {
  /** Number of small blobs that were compacted */
  blobsCompacted: number
  /** Number of super-chunks created */
  superChunksCreated: number
  /** Total bytes before compaction */
  inputBytes: number
  /** Total bytes after compaction (super-chunk overhead) */
  outputBytes: number
  /** Space saved in bytes (can be negative due to overhead for very few blobs) */
  spaceSaved: number
  /** Row operations saved (estimated) */
  rowOperationsSaved: number
  /** Duration of compaction in milliseconds */
  durationMs: number
  /** IDs of the created super-chunks */
  superChunkIds: string[]
}

/**
 * Compaction statistics.
 */
export interface CompactionStats {
  /** Number of blobs currently in super-chunks */
  compactedBlobCount: number
  /** Number of super-chunks */
  superChunkCount: number
  /** Total size of all compacted blobs */
  compactedBytes: number
  /** Number of small blobs pending compaction */
  pendingCompactionCount: number
  /** Total size of blobs pending compaction */
  pendingCompactionBytes: number
}

/**
 * Storage interface for the chunk compactor.
 */
export interface CompactorStorage {
  /** Read a blob by key */
  get(key: string): Promise<Uint8Array | null>
  /** Write a blob */
  put(key: string, data: Uint8Array): Promise<void>
  /** Delete a blob */
  delete(key: string): Promise<boolean>
  /** Check if a key exists */
  has(key: string): Promise<boolean>
  /** List keys with a prefix */
  list(prefix: string): Promise<string[]>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique super-chunk ID.
 */
function generateSuperChunkId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}

/**
 * Get the storage key for a super-chunk.
 */
export function getSuperChunkKey(superChunkId: string): string {
  return `${SUPER_CHUNK_PREFIX}${superChunkId}`
}

/**
 * Get the storage key for super-chunk metadata.
 */
export function getSuperChunkMetadataKey(superChunkId: string): string {
  return `${SUPER_CHUNK_PREFIX}${superChunkId}:meta`
}

/**
 * Get the storage key for a compaction index entry.
 */
export function getCompactionIndexKey(sha: string): string {
  return `${COMPACTION_INDEX_PREFIX}${sha}`
}

/**
 * Encode super-chunk metadata to bytes.
 */
export function encodeSuperChunkMetadata(metadata: SuperChunkMetadata): Uint8Array {
  const json = JSON.stringify(metadata)
  return encoder.encode(json)
}

/**
 * Decode super-chunk metadata from bytes.
 */
export function decodeSuperChunkMetadata(data: Uint8Array): SuperChunkMetadata {
  const json = decoder.decode(data)
  return JSON.parse(json) as SuperChunkMetadata
}

/**
 * Encode a compaction index entry to bytes.
 */
export function encodeIndexEntry(entry: CompactionIndexEntry): Uint8Array {
  const json = JSON.stringify(entry)
  return encoder.encode(json)
}

/**
 * Decode a compaction index entry from bytes.
 */
export function decodeIndexEntry(data: Uint8Array): CompactionIndexEntry {
  const json = decoder.decode(data)
  return JSON.parse(json) as CompactionIndexEntry
}

/**
 * Pack multiple blobs into a single super-chunk with header.
 *
 * Super-chunk format:
 * - Header (variable): JSON metadata followed by null byte
 * - Blob data: Concatenated blob data
 *
 * @param blobs - Blobs to pack
 * @returns Packed super-chunk data and metadata
 */
export function packSuperChunk(
  blobs: CompactionCandidate[]
): { data: Uint8Array; metadata: SuperChunkMetadata; entries: CompactionIndexEntry[] } {
  const superChunkId = generateSuperChunkId()
  const entries: CompactionIndexEntry[] = []

  // Calculate total data size
  let totalDataSize = 0
  for (const blob of blobs) {
    totalDataSize += blob.data.length
  }

  // Create metadata
  const metadata: SuperChunkMetadata = {
    id: superChunkId,
    totalSize: totalDataSize,
    blobCount: blobs.length,
    blobShas: blobs.map(b => b.sha),
    createdAt: Date.now(),
  }

  // Create header (JSON + null byte)
  const headerJson = JSON.stringify({
    version: 1,
    blobCount: blobs.length,
    totalSize: totalDataSize,
  })
  const headerBytes = encoder.encode(headerJson + '\0')

  // Allocate super-chunk buffer
  const superChunkData = new Uint8Array(headerBytes.length + totalDataSize)
  superChunkData.set(headerBytes, 0)

  // Pack blobs and create index entries
  let offset = headerBytes.length
  for (const blob of blobs) {
    superChunkData.set(blob.data, offset)

    entries.push({
      sha: blob.sha,
      superChunkId,
      offset: offset - headerBytes.length, // Offset relative to data section
      size: blob.data.length,
      type: blob.type,
    })

    offset += blob.data.length
  }

  return { data: superChunkData, metadata, entries }
}

/**
 * Unpack a blob from a super-chunk.
 *
 * @param superChunkData - The full super-chunk data
 * @param entry - The index entry for the blob to extract
 * @returns The blob data
 */
export function unpackBlob(superChunkData: Uint8Array, entry: CompactionIndexEntry): Uint8Array {
  // Find the end of the header (null byte)
  let headerEnd = 0
  for (let i = 0; i < superChunkData.length; i++) {
    if (superChunkData[i] === 0) {
      headerEnd = i + 1
      break
    }
  }

  // Extract the blob data
  const dataStart = headerEnd + entry.offset
  const dataEnd = dataStart + entry.size
  return superChunkData.slice(dataStart, dataEnd)
}

// ============================================================================
// ChunkCompactor Class
// ============================================================================

/**
 * Manages blob chunking compaction for DO storage efficiency.
 *
 * Usage:
 * 1. Register small blobs as compaction candidates
 * 2. When enough candidates accumulate, trigger compaction
 * 3. Compaction packs small blobs into 2MB super-chunks
 * 4. Reading a compacted blob uses the index to locate it in a super-chunk
 *
 * @example
 * ```typescript
 * const compactor = new ChunkCompactor(storage, {
 *   compactionThreshold: 64 * 1024, // 64KB
 *   minBlobsForCompaction: 10,
 * })
 *
 * // Register small blobs for compaction
 * compactor.registerCandidate({ sha, type: 'blob', data })
 *
 * // Check if compaction should run
 * if (compactor.shouldCompact()) {
 *   const result = await compactor.compact()
 *   console.log(`Compacted ${result.blobsCompacted} blobs, saved ${result.rowOperationsSaved} operations`)
 * }
 *
 * // Read a potentially compacted blob
 * const data = await compactor.readBlob(sha)
 * ```
 */
export class ChunkCompactor {
  private storage: CompactorStorage
  private config: Required<ChunkCompactorConfig>
  private candidates: Map<string, CompactionCandidate> = new Map()
  private indexCache: Map<string, CompactionIndexEntry> = new Map()
  private superChunkCache: Map<string, SuperChunkMetadata> = new Map()
  private _isCompacting = false

  constructor(storage: CompactorStorage, config: ChunkCompactorConfig = {}) {
    this.storage = storage
    this.config = {
      compactionThreshold: config.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD,
      minBlobsForCompaction: config.minBlobsForCompaction ?? DEFAULT_MIN_BLOBS_FOR_COMPACTION,
      targetChunkSize: config.targetChunkSize ?? CHUNK_SIZE,
      maxChunkSize: config.maxChunkSize ?? CHUNK_SIZE,
    }
  }

  /**
   * Check if a blob is small enough to be a compaction candidate.
   */
  isCompactionCandidate(size: number): boolean {
    return size > 0 && size < this.config.compactionThreshold
  }

  /**
   * Register a small blob as a compaction candidate.
   * Returns true if the blob was registered, false if it's too large.
   */
  registerCandidate(candidate: CompactionCandidate): boolean {
    if (!this.isCompactionCandidate(candidate.data.length)) {
      return false
    }
    this.candidates.set(candidate.sha, candidate)
    return true
  }

  /**
   * Remove a candidate from the pending compaction list.
   */
  removeCandidate(sha: string): boolean {
    return this.candidates.delete(sha)
  }

  /**
   * Get the number of pending compaction candidates.
   */
  get pendingCandidateCount(): number {
    return this.candidates.size
  }

  /**
   * Get the total size of pending compaction candidates.
   */
  get pendingCandidateBytes(): number {
    let total = 0
    for (const candidate of this.candidates.values()) {
      total += candidate.data.length
    }
    return total
  }

  /**
   * Check if compaction should be triggered based on current candidates.
   */
  shouldCompact(): boolean {
    return this.candidates.size >= this.config.minBlobsForCompaction
  }

  /**
   * Check if the compactor is currently running a compaction.
   */
  get isCompacting(): boolean {
    return this._isCompacting
  }

  /**
   * Run compaction on all pending candidates.
   *
   * Groups candidates into super-chunks that approach the target size,
   * writes them to storage, and updates the compaction index.
   */
  async compact(): Promise<CompactionResult> {
    if (this._isCompacting) {
      throw new Error('Compaction already in progress')
    }

    this._isCompacting = true
    const startTime = performance.now()

    try {
      const candidates = Array.from(this.candidates.values())
      if (candidates.length === 0) {
        return {
          blobsCompacted: 0,
          superChunksCreated: 0,
          inputBytes: 0,
          outputBytes: 0,
          spaceSaved: 0,
          rowOperationsSaved: 0,
          durationMs: 0,
          superChunkIds: [],
        }
      }

      // Calculate input size
      let inputBytes = 0
      for (const candidate of candidates) {
        inputBytes += candidate.data.length
      }

      // Group candidates into super-chunks
      const superChunkGroups = this.groupCandidatesIntoChunks(candidates)

      // Write super-chunks and index entries
      const superChunkIds: string[] = []
      let outputBytes = 0

      for (const group of superChunkGroups) {
        const { data, metadata, entries } = packSuperChunk(group)

        // Write super-chunk data
        await this.storage.put(getSuperChunkKey(metadata.id), data)

        // Write super-chunk metadata
        await this.storage.put(
          getSuperChunkMetadataKey(metadata.id),
          encodeSuperChunkMetadata(metadata)
        )

        // Write index entries for each blob
        for (const entry of entries) {
          await this.storage.put(getCompactionIndexKey(entry.sha), encodeIndexEntry(entry))
          this.indexCache.set(entry.sha, entry)
        }

        this.superChunkCache.set(metadata.id, metadata)
        superChunkIds.push(metadata.id)
        outputBytes += data.length
      }

      // Clear compacted candidates
      for (const candidate of candidates) {
        this.candidates.delete(candidate.sha)
      }

      const durationMs = performance.now() - startTime

      // Calculate row operations saved
      // Before: 1 row per small blob
      // After: 1 row per super-chunk + 1 row per index entry
      // Net savings = candidates - (superChunks + metadata + indexEntries)
      // But for reads, it's now 1 super-chunk read + 1 index read vs 1 blob read
      // The main savings comes from fewer total rows being managed
      const rowOperationsSaved = Math.max(0, candidates.length - superChunkIds.length * 2)

      return {
        blobsCompacted: candidates.length,
        superChunksCreated: superChunkIds.length,
        inputBytes,
        outputBytes,
        spaceSaved: inputBytes - outputBytes,
        rowOperationsSaved,
        durationMs,
        superChunkIds,
      }
    } finally {
      this._isCompacting = false
    }
  }

  /**
   * Group candidates into chunks that approach the target size.
   */
  private groupCandidatesIntoChunks(
    candidates: CompactionCandidate[]
  ): CompactionCandidate[][] {
    const groups: CompactionCandidate[][] = []
    let currentGroup: CompactionCandidate[] = []
    let currentSize = 0

    // Sort by size descending (bin packing heuristic: largest first)
    const sorted = [...candidates].sort((a, b) => b.data.length - a.data.length)

    for (const candidate of sorted) {
      // Header overhead estimate
      const headerOverhead = 100 // Approximate header size

      if (
        currentSize + candidate.data.length + headerOverhead > this.config.maxChunkSize &&
        currentGroup.length > 0
      ) {
        // Start a new group
        groups.push(currentGroup)
        currentGroup = []
        currentSize = 0
      }

      currentGroup.push(candidate)
      currentSize += candidate.data.length
    }

    // Add the last group if non-empty
    if (currentGroup.length > 0) {
      groups.push(currentGroup)
    }

    return groups
  }

  /**
   * Check if a blob is stored in a super-chunk.
   */
  async isCompacted(sha: string): Promise<boolean> {
    // Check cache first
    if (this.indexCache.has(sha)) {
      return true
    }

    // Check storage
    const indexKey = getCompactionIndexKey(sha)
    return this.storage.has(indexKey)
  }

  /**
   * Read a blob that may be stored in a super-chunk.
   *
   * @param sha - The blob SHA
   * @returns The blob data, or null if not found in super-chunks
   */
  async readCompactedBlob(sha: string): Promise<Uint8Array | null> {
    // Get the index entry
    let entry = this.indexCache.get(sha)
    if (!entry) {
      const indexData = await this.storage.get(getCompactionIndexKey(sha))
      if (!indexData) {
        return null
      }
      entry = decodeIndexEntry(indexData)
      this.indexCache.set(sha, entry)
    }

    // Read the super-chunk
    const superChunkData = await this.storage.get(getSuperChunkKey(entry.superChunkId))
    if (!superChunkData) {
      // Super-chunk is missing - index is stale
      this.indexCache.delete(sha)
      return null
    }

    // Extract the blob from the super-chunk
    return unpackBlob(superChunkData, entry)
  }

  /**
   * Delete a blob from its super-chunk.
   *
   * Note: This doesn't actually remove the data from the super-chunk immediately.
   * Instead, it removes the index entry so the blob becomes inaccessible.
   * The space will be reclaimed during the next full compaction.
   *
   * @param sha - The blob SHA to delete
   * @returns true if the blob was found and marked for deletion
   */
  async deleteCompactedBlob(sha: string): Promise<boolean> {
    // Remove from cache
    this.indexCache.delete(sha)

    // Remove index entry from storage
    return this.storage.delete(getCompactionIndexKey(sha))
  }

  /**
   * Get compaction statistics.
   */
  async getStats(): Promise<CompactionStats> {
    // Count super-chunks
    const superChunkKeys = await this.storage.list(SUPER_CHUNK_PREFIX)
    const superChunkCount = superChunkKeys.filter(k => !k.endsWith(':meta')).length

    // Count index entries
    const indexKeys = await this.storage.list(COMPACTION_INDEX_PREFIX)
    const compactedBlobCount = indexKeys.length

    // Calculate compacted bytes (would need to read all metadata)
    let compactedBytes = 0
    for (const key of superChunkKeys) {
      if (key.endsWith(':meta')) {
        const metaData = await this.storage.get(key)
        if (metaData) {
          const meta = decodeSuperChunkMetadata(metaData)
          compactedBytes += meta.totalSize
        }
      }
    }

    return {
      compactedBlobCount,
      superChunkCount,
      compactedBytes,
      pendingCompactionCount: this.candidates.size,
      pendingCompactionBytes: this.pendingCandidateBytes,
    }
  }

  /**
   * Perform a full compaction that rewrites all super-chunks.
   *
   * This is useful for:
   * - Reclaiming space from deleted blobs
   * - Optimizing super-chunk sizes after many deletions
   * - Defragmenting storage
   *
   * @returns Compaction result
   */
  async fullCompaction(): Promise<CompactionResult> {
    if (this._isCompacting) {
      throw new Error('Compaction already in progress')
    }

    this._isCompacting = true
    const startTime = performance.now()

    try {
      // Collect all valid blobs from existing super-chunks
      const allBlobs: CompactionCandidate[] = []
      const superChunkKeys = await this.storage.list(SUPER_CHUNK_PREFIX)
      const indexKeys = await this.storage.list(COMPACTION_INDEX_PREFIX)

      // Build a set of valid blob SHAs from the index
      const validShas = new Set<string>()
      for (const indexKey of indexKeys) {
        const sha = indexKey.replace(COMPACTION_INDEX_PREFIX, '')
        validShas.add(sha)
      }

      // Track old super-chunk IDs for deletion
      const oldSuperChunkIds: string[] = []

      // Read all valid blobs from super-chunks
      let inputBytes = 0
      for (const key of superChunkKeys) {
        if (key.endsWith(':meta')) continue

        const superChunkId = key.replace(SUPER_CHUNK_PREFIX, '')
        oldSuperChunkIds.push(superChunkId)

        const superChunkData = await this.storage.get(key)
        if (!superChunkData) continue

        // Get metadata to know which blobs are in this chunk
        const metaData = await this.storage.get(getSuperChunkMetadataKey(superChunkId))
        if (!metaData) continue

        const metadata = decodeSuperChunkMetadata(metaData)

        for (const sha of metadata.blobShas) {
          // Only include blobs that still have valid index entries
          if (!validShas.has(sha)) continue

          const entry = this.indexCache.get(sha) || await this.loadIndexEntry(sha)
          if (!entry) continue

          const blobData = unpackBlob(superChunkData, entry)
          allBlobs.push({
            sha,
            type: entry.type,
            data: blobData,
          })
          inputBytes += blobData.length
        }
      }

      // Add pending candidates
      for (const candidate of this.candidates.values()) {
        allBlobs.push(candidate)
        inputBytes += candidate.data.length
      }

      if (allBlobs.length === 0) {
        return {
          blobsCompacted: 0,
          superChunksCreated: 0,
          inputBytes: 0,
          outputBytes: 0,
          spaceSaved: 0,
          rowOperationsSaved: 0,
          durationMs: performance.now() - startTime,
          superChunkIds: [],
        }
      }

      // Group into new super-chunks
      const superChunkGroups = this.groupCandidatesIntoChunks(allBlobs)

      // Write new super-chunks
      const newSuperChunkIds: string[] = []
      let outputBytes = 0

      for (const group of superChunkGroups) {
        const { data, metadata, entries } = packSuperChunk(group)

        await this.storage.put(getSuperChunkKey(metadata.id), data)
        await this.storage.put(
          getSuperChunkMetadataKey(metadata.id),
          encodeSuperChunkMetadata(metadata)
        )

        for (const entry of entries) {
          await this.storage.put(getCompactionIndexKey(entry.sha), encodeIndexEntry(entry))
          this.indexCache.set(entry.sha, entry)
        }

        this.superChunkCache.set(metadata.id, metadata)
        newSuperChunkIds.push(metadata.id)
        outputBytes += data.length
      }

      // Delete old super-chunks
      for (const superChunkId of oldSuperChunkIds) {
        await this.storage.delete(getSuperChunkKey(superChunkId))
        await this.storage.delete(getSuperChunkMetadataKey(superChunkId))
        this.superChunkCache.delete(superChunkId)
      }

      // Clear candidates
      this.candidates.clear()

      const durationMs = performance.now() - startTime

      return {
        blobsCompacted: allBlobs.length,
        superChunksCreated: newSuperChunkIds.length,
        inputBytes,
        outputBytes,
        spaceSaved: inputBytes - outputBytes,
        rowOperationsSaved: Math.max(0, allBlobs.length - newSuperChunkIds.length * 2),
        durationMs,
        superChunkIds: newSuperChunkIds,
      }
    } finally {
      this._isCompacting = false
    }
  }

  /**
   * Load an index entry from storage into the cache.
   */
  private async loadIndexEntry(sha: string): Promise<CompactionIndexEntry | null> {
    const data = await this.storage.get(getCompactionIndexKey(sha))
    if (!data) return null

    const entry = decodeIndexEntry(data)
    this.indexCache.set(sha, entry)
    return entry
  }

  /**
   * Clear all caches (useful for testing or memory management).
   */
  clearCaches(): void {
    this.indexCache.clear()
    this.superChunkCache.clear()
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Required<ChunkCompactorConfig> {
    return { ...this.config }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a chunk compactor with the given storage backend.
 *
 * @param storage - Storage backend for reading/writing chunks
 * @param config - Optional configuration
 * @returns ChunkCompactor instance
 *
 * @example
 * ```typescript
 * import { createChunkCompactor } from 'gitx.do/storage'
 *
 * const compactor = createChunkCompactor(storage, {
 *   compactionThreshold: 64 * 1024,
 *   minBlobsForCompaction: 20,
 * })
 * ```
 */
export function createChunkCompactor(
  storage: CompactorStorage,
  config?: ChunkCompactorConfig
): ChunkCompactor {
  return new ChunkCompactor(storage, config)
}
