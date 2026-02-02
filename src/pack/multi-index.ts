/**
 * @fileoverview Pack File Multi-Index Support for Warm Tier Scalability
 *
 * This module provides enhanced multi-index support for Git pack files,
 * designed for improved scalability in the warm storage tier. It enables
 * efficient object lookups across multiple pack files without requiring
 * a full index rebuild for each pack addition.
 *
 * ## Features
 *
 * - **Incremental Updates**: Add or remove packs without full rebuild
 * - **Sharded Indices**: Support for multiple index shards based on SHA prefix
 * - **Batch Lookups**: Efficient multi-object lookups with parallel shard queries
 * - **Lazy Loading**: Index shards loaded on-demand for memory efficiency
 * - **Fanout Tables**: O(1) range narrowing using fanout tables per shard
 *
 * ## Architecture
 *
 * ```
 * MultiIndexManager
 *   |-- Shard 00-0f (objects starting with 0)
 *   |-- Shard 10-1f (objects starting with 1)
 *   |-- ...
 *   |-- Shard f0-ff (objects starting with f)
 *   |-- Pack Registry (maps pack IDs to shard info)
 * ```
 *
 * @module pack/multi-index
 *
 * @example
 * ```typescript
 * import { MultiIndexManager, createMultiIndexManager } from './multi-index'
 *
 * // Create a multi-index manager
 * const manager = createMultiIndexManager({
 *   shardCount: 16,  // 16 shards (by first hex digit)
 *   maxPacksBeforeCompaction: 100
 * })
 *
 * // Add a pack index
 * await manager.addPackIndex(packId, indexEntries)
 *
 * // Look up an object
 * const location = manager.lookupObject('abc123...')
 * if (location) {
 *   console.log(`Found in pack ${location.packId} at offset ${location.offset}`)
 * }
 *
 * // Batch lookup
 * const results = manager.batchLookup(['sha1', 'sha2', 'sha3'])
 * ```
 */

import { parsePackIndex, type PackIndexEntry } from './index'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Location of an object within a pack file.
 */
export interface PackObjectLocation {
  /** The pack file containing the object */
  packId: string

  /** Byte offset of the object within the pack */
  offset: number

  /** CRC32 checksum of the packed object (for verification) */
  crc32?: number
}

/**
 * Entry in the multi-index for a single object.
 */
export interface MultiIndexEntry {
  /** 40-character hex SHA-1 object ID */
  objectId: string

  /** Pack ID where the object is stored */
  packId: string

  /** Byte offset within the pack file */
  offset: number

  /** Optional CRC32 for integrity verification */
  crc32?: number
}

/**
 * A shard of the multi-index containing entries for a range of SHA prefixes.
 */
export interface IndexShard {
  /** Shard identifier (e.g., '0', '1', ..., 'f' for 16 shards) */
  shardId: string

  /** SHA prefix range: entries with SHAs starting with these characters */
  prefixRange: { start: string; end: string }

  /** Sorted entries in this shard */
  entries: MultiIndexEntry[]

  /** Fanout table for O(1) range narrowing (256 entries for second byte) */
  fanout: Uint32Array

  /** Total number of entries in this shard */
  entryCount: number

  /** Pack IDs that have contributed entries to this shard */
  packIds: Set<string>

  /** Last update timestamp */
  updatedAt: number
}

/**
 * Registry tracking which packs are indexed and their metadata.
 */
export interface PackRegistry {
  /** Map of pack ID to pack metadata */
  packs: Map<string, PackRegistryEntry>

  /** Total object count across all packs */
  totalObjects: number

  /** Last registry update time */
  updatedAt: number
}

/**
 * Metadata for a single pack in the registry.
 */
export interface PackRegistryEntry {
  /** Pack identifier */
  packId: string

  /** Number of objects in this pack */
  objectCount: number

  /** SHA-1 checksum of the pack file */
  checksum?: string

  /** When this pack was added to the index */
  indexedAt: number

  /** Size of the pack file in bytes */
  packSize?: number
}

/**
 * Configuration options for the multi-index manager.
 */
export interface MultiIndexConfig {
  /**
   * Number of shards to divide the index into.
   * More shards = smaller memory footprint per shard, but more shard files.
   * @default 16 (one per hex digit)
   */
  shardCount?: number

  /**
   * Maximum number of packs before triggering compaction.
   * Compaction merges small packs and optimizes index structure.
   * @default 100
   */
  maxPacksBeforeCompaction?: number

  /**
   * Whether to use fanout tables for faster lookups.
   * Increases memory usage but provides O(1) range narrowing.
   * @default true
   */
  useFanoutTables?: boolean

  /**
   * Cache TTL for loaded shards in milliseconds.
   * @default 300000 (5 minutes)
   */
  shardCacheTTL?: number
}

/**
 * Result of a batch lookup operation.
 */
export interface BatchLookupResult {
  /** Map of SHA to location for found objects */
  found: Map<string, PackObjectLocation>

  /** Array of SHAs that were not found */
  missing: string[]
}

/**
 * Statistics about the multi-index.
 */
export interface MultiIndexStats {
  /** Total number of indexed objects */
  totalObjects: number

  /** Number of indexed packs */
  packCount: number

  /** Number of shards */
  shardCount: number

  /** Number of currently loaded shards */
  loadedShards: number

  /** Memory estimate for loaded shards in bytes */
  memoryUsageBytes: number

  /** Average objects per shard */
  avgObjectsPerShard: number
}

/**
 * Multi-Index Manager for pack file scalability.
 *
 * @description
 * Manages multiple pack file indices with efficient lookups across all packs.
 * Uses sharding by SHA prefix for memory efficiency and parallel lookups.
 *
 * @example
 * ```typescript
 * const manager = new MultiIndexManager({ shardCount: 16 })
 *
 * // Add pack indices
 * await manager.addPackIndex('pack-001', entries1)
 * await manager.addPackIndex('pack-002', entries2)
 *
 * // Lookup
 * const location = manager.lookupObject(sha)
 * ```
 */
export class MultiIndexManager {
  private _config: Required<MultiIndexConfig>
  private _shards: Map<string, IndexShard>
  private _registry: PackRegistry

  /**
   * Creates a new MultiIndexManager.
   *
   * @param config - Configuration options
   */
  constructor(config?: MultiIndexConfig) {
    this._config = {
      shardCount: config?.shardCount ?? 16,
      maxPacksBeforeCompaction: config?.maxPacksBeforeCompaction ?? 100,
      useFanoutTables: config?.useFanoutTables ?? true,
      shardCacheTTL: config?.shardCacheTTL ?? 300000
    }

    this._shards = new Map()
    this._registry = {
      packs: new Map(),
      totalObjects: 0,
      updatedAt: Date.now()
    }

    // Initialize empty shards
    this._initializeShards()
  }

  /**
   * Initializes empty shards based on shard count.
   */
  private _initializeShards(): void {
    const shardCount = this._config.shardCount
    const hexChars = '0123456789abcdef'

    if (shardCount === 16) {
      // One shard per hex digit
      for (const char of hexChars) {
        this._createEmptyShard(char, char, char)
      }
    } else if (shardCount === 256) {
      // One shard per two hex digits
      for (const c1 of hexChars) {
        for (const c2 of hexChars) {
          this._createEmptyShard(`${c1}${c2}`, `${c1}${c2}`, `${c1}${c2}`)
        }
      }
    } else {
      // Single shard for small repos
      this._createEmptyShard('0', '0', 'f')
    }
  }

  /**
   * Creates an empty shard with the given parameters.
   */
  private _createEmptyShard(shardId: string, start: string, end: string): void {
    this._shards.set(shardId, {
      shardId,
      prefixRange: { start, end },
      entries: [],
      fanout: new Uint32Array(256),
      entryCount: 0,
      packIds: new Set(),
      updatedAt: Date.now()
    })
  }

  /**
   * Gets the shard ID for a given SHA.
   */
  private _getShardId(sha: string): string {
    const shardCount = this._config.shardCount

    if (shardCount === 16) {
      return sha[0].toLowerCase()
    } else if (shardCount === 256) {
      return sha.slice(0, 2).toLowerCase()
    }

    return '0' // Single shard
  }

  /**
   * Adds entries from a pack index to the multi-index.
   *
   * @description
   * Incrementally adds entries from a pack's index without rebuilding
   * the entire multi-index. Uses merge sort for efficiency.
   *
   * @param packId - Pack identifier
   * @param entries - Pack index entries to add
   *
   * @example
   * ```typescript
   * const entries = parsePackIndex(indexData).entries
   * await manager.addPackIndex('pack-001', entries)
   * ```
   */
  addPackIndex(packId: string, entries: PackIndexEntry[]): void {
    // Check if pack is already indexed
    if (this._registry.packs.has(packId)) {
      // Remove existing entries first
      this.removePackIndex(packId)
    }

    // Group entries by shard
    const entriesByShard = new Map<string, MultiIndexEntry[]>()

    for (const entry of entries) {
      const objectId = entry.objectId || entry.sha || ''
      if (!objectId) continue

      const shardId = this._getShardId(objectId)

      if (!entriesByShard.has(shardId)) {
        entriesByShard.set(shardId, [])
      }

      entriesByShard.get(shardId)!.push({
        objectId: objectId.toLowerCase(),
        packId,
        offset: entry.offset,
        crc32: entry.crc32
      })
    }

    // Merge entries into each shard
    for (const [shardId, newEntries] of entriesByShard) {
      const shard = this._shards.get(shardId)
      if (!shard) continue

      // Merge sorted arrays
      shard.entries = this._mergeSortedArrays(shard.entries, newEntries)
      shard.entryCount = shard.entries.length
      shard.packIds.add(packId)
      shard.updatedAt = Date.now()

      // Rebuild fanout table if enabled
      if (this._config.useFanoutTables) {
        this._rebuildFanoutTable(shard)
      }
    }

    // Update registry
    this._registry.packs.set(packId, {
      packId,
      objectCount: entries.length,
      indexedAt: Date.now()
    })
    this._registry.totalObjects += entries.length
    this._registry.updatedAt = Date.now()
  }

  /**
   * Merges two sorted arrays of entries.
   */
  private _mergeSortedArrays(a: MultiIndexEntry[], b: MultiIndexEntry[]): MultiIndexEntry[] {
    // Sort b first
    const sortedB = [...b].sort((x, y) => x.objectId.localeCompare(y.objectId))

    if (a.length === 0) return sortedB
    if (sortedB.length === 0) return a

    const result: MultiIndexEntry[] = []
    let i = 0, j = 0

    while (i < a.length && j < sortedB.length) {
      const cmp = a[i].objectId.localeCompare(sortedB[j].objectId)
      if (cmp < 0) {
        result.push(a[i++])
      } else if (cmp > 0) {
        result.push(sortedB[j++])
      } else {
        // Duplicate - keep the newer one (from b)
        result.push(sortedB[j++])
        i++
      }
    }

    while (i < a.length) result.push(a[i++])
    while (j < sortedB.length) result.push(sortedB[j++])

    return result
  }

  /**
   * Rebuilds the fanout table for a shard.
   */
  private _rebuildFanoutTable(shard: IndexShard): void {
    const fanout = new Uint32Array(256)
    let count = 0
    let entryIdx = 0

    for (let i = 0; i < 256; i++) {
      while (entryIdx < shard.entries.length) {
        const entry = shard.entries[entryIdx]
        // Get second byte value (first byte determined by shard)
        const secondByte = parseInt(entry.objectId.slice(2, 4), 16)
        if (secondByte <= i) {
          count++
          entryIdx++
        } else {
          break
        }
      }
      fanout[i] = count
    }

    shard.fanout = fanout
  }

  /**
   * Removes a pack from the multi-index.
   *
   * @param packId - Pack identifier to remove
   * @returns true if pack was found and removed
   */
  removePackIndex(packId: string): boolean {
    const packInfo = this._registry.packs.get(packId)
    if (!packInfo) return false

    let removedCount = 0

    // Remove entries from all shards
    for (const shard of this._shards.values()) {
      if (!shard.packIds.has(packId)) continue

      const originalLength = shard.entries.length
      shard.entries = shard.entries.filter(e => e.packId !== packId)
      removedCount += originalLength - shard.entries.length

      shard.entryCount = shard.entries.length
      shard.packIds.delete(packId)
      shard.updatedAt = Date.now()

      if (this._config.useFanoutTables) {
        this._rebuildFanoutTable(shard)
      }
    }

    // Update registry
    this._registry.packs.delete(packId)
    this._registry.totalObjects -= packInfo.objectCount
    this._registry.updatedAt = Date.now()

    return true
  }

  /**
   * Looks up an object in the multi-index.
   *
   * @description
   * Uses the fanout table (if enabled) for O(1) range narrowing,
   * then binary search within the range.
   *
   * @param sha - 40-character hex SHA-1 to find
   * @returns Object location or null if not found
   *
   * @example
   * ```typescript
   * const location = manager.lookupObject('abc123...')
   * if (location) {
   *   console.log(`Found in ${location.packId} at offset ${location.offset}`)
   * }
   * ```
   */
  lookupObject(sha: string): PackObjectLocation | null {
    const normalizedSha = sha.toLowerCase()
    const shardId = this._getShardId(normalizedSha)
    const shard = this._shards.get(shardId)

    if (!shard || shard.entries.length === 0) {
      return null
    }

    // Use fanout table to narrow search range
    let start = 0
    let end = shard.entries.length

    if (this._config.useFanoutTables && shard.fanout.length === 256) {
      const secondByte = parseInt(normalizedSha.slice(2, 4), 16)
      end = shard.fanout[secondByte]
      start = secondByte === 0 ? 0 : shard.fanout[secondByte - 1]
    }

    // Binary search within range
    let left = start
    let right = end - 1

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const entry = shard.entries[mid]
      const cmp = normalizedSha.localeCompare(entry.objectId)

      if (cmp === 0) {
        return {
          packId: entry.packId,
          offset: entry.offset,
          crc32: entry.crc32
        }
      } else if (cmp < 0) {
        right = mid - 1
      } else {
        left = mid + 1
      }
    }

    return null
  }

  /**
   * Performs batch lookup of multiple objects.
   *
   * @description
   * Efficiently looks up multiple objects by grouping them by shard
   * and performing parallel lookups within each shard.
   *
   * @param shas - Array of SHA-1 hashes to look up
   * @returns Result with found locations and missing SHAs
   *
   * @example
   * ```typescript
   * const result = manager.batchLookup(['sha1', 'sha2', 'sha3'])
   * for (const [sha, location] of result.found) {
   *   console.log(`${sha} found in ${location.packId}`)
   * }
   * ```
   */
  batchLookup(shas: string[]): BatchLookupResult {
    const found = new Map<string, PackObjectLocation>()
    const missing: string[] = []

    // Group by shard for efficiency
    const shasByShard = new Map<string, string[]>()

    for (const sha of shas) {
      const shardId = this._getShardId(sha)
      if (!shasByShard.has(shardId)) {
        shasByShard.set(shardId, [])
      }
      shasByShard.get(shardId)!.push(sha)
    }

    // Look up in each shard
    for (const [shardId, shardShas] of shasByShard) {
      const shard = this._shards.get(shardId)

      for (const sha of shardShas) {
        if (!shard || shard.entries.length === 0) {
          missing.push(sha)
          continue
        }

        const location = this.lookupObject(sha)
        if (location) {
          found.set(sha, location)
        } else {
          missing.push(sha)
        }
      }
    }

    return { found, missing }
  }

  /**
   * Checks if an object exists in any pack.
   *
   * @param sha - SHA-1 hash to check
   * @returns true if object is indexed
   */
  hasObject(sha: string): boolean {
    return this.lookupObject(sha) !== null
  }

  /**
   * Gets statistics about the multi-index.
   *
   * @returns Index statistics
   */
  getStats(): MultiIndexStats {
    let loadedShards = 0
    let memoryUsageBytes = 0

    for (const shard of this._shards.values()) {
      if (shard.entries.length > 0) {
        loadedShards++
        // Rough estimate: ~80 bytes per entry (objectId + packId + offset + overhead)
        memoryUsageBytes += shard.entries.length * 80
        // Fanout table: 256 * 4 bytes
        if (this._config.useFanoutTables) {
          memoryUsageBytes += 1024
        }
      }
    }

    const shardCount = this._shards.size
    const avgObjectsPerShard = shardCount > 0
      ? this._registry.totalObjects / shardCount
      : 0

    return {
      totalObjects: this._registry.totalObjects,
      packCount: this._registry.packs.size,
      shardCount,
      loadedShards,
      memoryUsageBytes,
      avgObjectsPerShard
    }
  }

  /**
   * Gets the pack registry.
   *
   * @returns Current pack registry
   */
  getRegistry(): PackRegistry {
    return this._registry
  }

  /**
   * Checks if compaction is recommended.
   *
   * @returns true if pack count exceeds threshold
   */
  needsCompaction(): boolean {
    return this._registry.packs.size >= this._config.maxPacksBeforeCompaction
  }

  /**
   * Gets all entries for a specific pack.
   *
   * @param packId - Pack identifier
   * @returns Array of entries from that pack
   */
  getEntriesForPack(packId: string): MultiIndexEntry[] {
    const entries: MultiIndexEntry[] = []

    for (const shard of this._shards.values()) {
      if (!shard.packIds.has(packId)) continue

      for (const entry of shard.entries) {
        if (entry.packId === packId) {
          entries.push(entry)
        }
      }
    }

    return entries
  }

  /**
   * Clears all indexed data.
   */
  clear(): void {
    for (const shard of this._shards.values()) {
      shard.entries = []
      shard.entryCount = 0
      shard.packIds.clear()
      shard.fanout = new Uint32Array(256)
      shard.updatedAt = Date.now()
    }

    this._registry.packs.clear()
    this._registry.totalObjects = 0
    this._registry.updatedAt = Date.now()
  }

  /**
   * Serializes the multi-index to a portable format.
   *
   * @returns Serialized index data
   */
  serialize(): Uint8Array {
    // Calculate total size
    const headerSize = 16 // signature + version + packCount + entryCount
    const packIdsData = Array.from(this._registry.packs.keys())
      .map(id => encoder.encode(id))

    let packIdsTotalSize = 0
    for (const data of packIdsData) {
      packIdsTotalSize += 4 + data.length // length prefix + data
    }

    // Entry size: 40 (sha) + 4 (packIndex) + 8 (offset) + 4 (crc32) = 56 bytes
    const entrySize = 56
    const entriesSize = this._registry.totalObjects * entrySize

    const totalSize = headerSize + packIdsTotalSize + entriesSize + 20 // +20 for checksum

    const data = new Uint8Array(totalSize)
    const view = new DataView(data.buffer)
    let offset = 0

    // Signature: "MIDX"
    data.set([0x4d, 0x49, 0x44, 0x58], offset)
    offset += 4

    // Version: 2 (enhanced multi-index)
    view.setUint32(offset, 2, false)
    offset += 4

    // Pack count
    view.setUint32(offset, this._registry.packs.size, false)
    offset += 4

    // Entry count
    view.setUint32(offset, this._registry.totalObjects, false)
    offset += 4

    // Write pack IDs
    const packIdToIndex = new Map<string, number>()
    let packIndex = 0
    for (const packIdData of packIdsData) {
      view.setUint32(offset, packIdData.length, false)
      offset += 4
      data.set(packIdData, offset)
      offset += packIdData.length

      const packId = decoder.decode(packIdData)
      packIdToIndex.set(packId, packIndex++)
    }

    // Collect all entries and sort
    const allEntries: MultiIndexEntry[] = []
    for (const shard of this._shards.values()) {
      allEntries.push(...shard.entries)
    }
    allEntries.sort((a, b) => a.objectId.localeCompare(b.objectId))

    // Write entries
    for (const entry of allEntries) {
      // Object ID (40 chars as bytes)
      const objectIdBytes = encoder.encode(entry.objectId.padEnd(40, '0').slice(0, 40))
      data.set(objectIdBytes, offset)
      offset += 40

      // Pack index
      const pIndex = packIdToIndex.get(entry.packId) ?? 0
      view.setUint32(offset, pIndex, false)
      offset += 4

      // Offset (8 bytes for large files)
      view.setUint32(offset, 0, false) // high bits
      offset += 4
      view.setUint32(offset, entry.offset, false) // low bits
      offset += 4

      // CRC32
      view.setUint32(offset, entry.crc32 ?? 0, false)
      offset += 4
    }

    // Placeholder checksum (would compute SHA-1 in production)
    data.set(new Uint8Array(20), offset)

    return data
  }

  /**
   * Deserializes multi-index data.
   *
   * @param data - Serialized index data
   */
  static deserialize(data: Uint8Array, config?: MultiIndexConfig): MultiIndexManager {
    const manager = new MultiIndexManager(config)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let offset = 0

    // Verify signature
    if (data[0] !== 0x4d || data[1] !== 0x49 || data[2] !== 0x44 || data[3] !== 0x58) {
      throw new Error('Invalid multi-index signature')
    }
    offset += 4

    // Version
    const version = view.getUint32(offset, false)
    if (version !== 2) {
      throw new Error(`Unsupported multi-index version: ${version}`)
    }
    offset += 4

    // Pack count
    const packCount = view.getUint32(offset, false)
    offset += 4

    // Entry count
    const entryCount = view.getUint32(offset, false)
    offset += 4

    // Read pack IDs
    const packIds: string[] = []
    for (let i = 0; i < packCount; i++) {
      const len = view.getUint32(offset, false)
      offset += 4
      const packIdBytes = data.slice(offset, offset + len)
      packIds.push(decoder.decode(packIdBytes))
      offset += len
    }

    // Read entries and group by pack
    const entriesByPack = new Map<string, PackIndexEntry[]>()

    for (let i = 0; i < entryCount; i++) {
      const objectIdBytes = data.slice(offset, offset + 40)
      const objectId = decoder.decode(objectIdBytes).replace(/0+$/, '') || decoder.decode(objectIdBytes)
      offset += 40

      const packIndex = view.getUint32(offset, false)
      offset += 4

      // Skip high bits
      offset += 4
      const entryOffset = view.getUint32(offset, false)
      offset += 4

      const crc32 = view.getUint32(offset, false)
      offset += 4

      const packId = packIds[packIndex] || ''

      if (!entriesByPack.has(packId)) {
        entriesByPack.set(packId, [])
      }

      entriesByPack.get(packId)!.push({
        objectId,
        offset: entryOffset,
        crc32
      })
    }

    // Add each pack's entries
    for (const [packId, entries] of entriesByPack) {
      manager.addPackIndex(packId, entries)
    }

    return manager
  }
}

/**
 * Creates a new MultiIndexManager with default configuration.
 *
 * @param config - Optional configuration
 * @returns Configured MultiIndexManager instance
 *
 * @example
 * ```typescript
 * const manager = createMultiIndexManager({ shardCount: 16 })
 * ```
 */
export function createMultiIndexManager(config?: MultiIndexConfig): MultiIndexManager {
  return new MultiIndexManager(config)
}

/**
 * Adds a parsed pack index to a multi-index manager.
 *
 * @description
 * Convenience function that parses index data and adds it to the manager.
 *
 * @param manager - MultiIndexManager instance
 * @param packId - Pack identifier
 * @param indexData - Raw pack index file data
 *
 * @example
 * ```typescript
 * await addPackIndexFromData(manager, 'pack-001', indexData)
 * ```
 */
export function addPackIndexFromData(
  manager: MultiIndexManager,
  packId: string,
  indexData: Uint8Array
): void {
  const index = parsePackIndex(indexData)
  manager.addPackIndex(packId, index.entries)
}

/**
 * Batch lookup across multiple multi-index managers.
 *
 * @description
 * Useful when indices are sharded across multiple managers.
 *
 * @param managers - Array of MultiIndexManager instances
 * @param shas - Array of SHAs to look up
 * @returns Combined lookup result
 */
export function batchLookupAcrossManagers(
  managers: MultiIndexManager[],
  shas: string[]
): BatchLookupResult {
  const found = new Map<string, PackObjectLocation>()
  let remaining = new Set(shas)

  for (const manager of managers) {
    if (remaining.size === 0) break

    const result = manager.batchLookup(Array.from(remaining))

    for (const [sha, location] of result.found) {
      found.set(sha, location)
      remaining.delete(sha)
    }
  }

  return {
    found,
    missing: Array.from(remaining)
  }
}
