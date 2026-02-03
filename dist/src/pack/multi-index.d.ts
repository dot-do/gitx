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
import { type PackIndexEntry } from './index';
/**
 * Location of an object within a pack file.
 */
export interface PackObjectLocation {
    /** The pack file containing the object */
    packId: string;
    /** Byte offset of the object within the pack */
    offset: number;
    /** CRC32 checksum of the packed object (for verification) */
    crc32?: number;
}
/**
 * Entry in the multi-index for a single object.
 */
export interface MultiIndexEntry {
    /** 40-character hex SHA-1 object ID */
    objectId: string;
    /** Pack ID where the object is stored */
    packId: string;
    /** Byte offset within the pack file */
    offset: number;
    /** Optional CRC32 for integrity verification */
    crc32?: number;
}
/**
 * A shard of the multi-index containing entries for a range of SHA prefixes.
 */
export interface IndexShard {
    /** Shard identifier (e.g., '0', '1', ..., 'f' for 16 shards) */
    shardId: string;
    /** SHA prefix range: entries with SHAs starting with these characters */
    prefixRange: {
        start: string;
        end: string;
    };
    /** Sorted entries in this shard */
    entries: MultiIndexEntry[];
    /** Fanout table for O(1) range narrowing (256 entries for second byte) */
    fanout: Uint32Array;
    /** Total number of entries in this shard */
    entryCount: number;
    /** Pack IDs that have contributed entries to this shard */
    packIds: Set<string>;
    /** Last update timestamp */
    updatedAt: number;
}
/**
 * Registry tracking which packs are indexed and their metadata.
 */
export interface PackRegistry {
    /** Map of pack ID to pack metadata */
    packs: Map<string, PackRegistryEntry>;
    /** Total object count across all packs */
    totalObjects: number;
    /** Last registry update time */
    updatedAt: number;
}
/**
 * Metadata for a single pack in the registry.
 */
export interface PackRegistryEntry {
    /** Pack identifier */
    packId: string;
    /** Number of objects in this pack */
    objectCount: number;
    /** SHA-1 checksum of the pack file */
    checksum?: string;
    /** When this pack was added to the index */
    indexedAt: number;
    /** Size of the pack file in bytes */
    packSize?: number;
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
    shardCount?: number;
    /**
     * Maximum number of packs before triggering compaction.
     * Compaction merges small packs and optimizes index structure.
     * @default 100
     */
    maxPacksBeforeCompaction?: number;
    /**
     * Whether to use fanout tables for faster lookups.
     * Increases memory usage but provides O(1) range narrowing.
     * @default true
     */
    useFanoutTables?: boolean;
    /**
     * Cache TTL for loaded shards in milliseconds.
     * @default 300000 (5 minutes)
     */
    shardCacheTTL?: number;
}
/**
 * Result of a batch lookup operation.
 */
export interface BatchLookupResult {
    /** Map of SHA to location for found objects */
    found: Map<string, PackObjectLocation>;
    /** Array of SHAs that were not found */
    missing: string[];
}
/**
 * Statistics about the multi-index.
 */
export interface MultiIndexStats {
    /** Total number of indexed objects */
    totalObjects: number;
    /** Number of indexed packs */
    packCount: number;
    /** Number of shards */
    shardCount: number;
    /** Number of currently loaded shards */
    loadedShards: number;
    /** Memory estimate for loaded shards in bytes */
    memoryUsageBytes: number;
    /** Average objects per shard */
    avgObjectsPerShard: number;
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
export declare class MultiIndexManager {
    private _config;
    private _shards;
    private _registry;
    /**
     * Creates a new MultiIndexManager.
     *
     * @param config - Configuration options
     */
    constructor(config?: MultiIndexConfig);
    /**
     * Initializes empty shards based on shard count.
     */
    private _initializeShards;
    /**
     * Creates an empty shard with the given parameters.
     */
    private _createEmptyShard;
    /**
     * Gets the shard ID for a given SHA.
     */
    private _getShardId;
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
    addPackIndex(packId: string, entries: PackIndexEntry[]): void;
    /**
     * Merges two sorted arrays of entries.
     */
    private _mergeSortedArrays;
    /**
     * Rebuilds the fanout table for a shard.
     */
    private _rebuildFanoutTable;
    /**
     * Removes a pack from the multi-index.
     *
     * @param packId - Pack identifier to remove
     * @returns true if pack was found and removed
     */
    removePackIndex(packId: string): boolean;
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
    lookupObject(sha: string): PackObjectLocation | null;
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
    batchLookup(shas: string[]): BatchLookupResult;
    /**
     * Checks if an object exists in any pack.
     *
     * @param sha - SHA-1 hash to check
     * @returns true if object is indexed
     */
    hasObject(sha: string): boolean;
    /**
     * Gets statistics about the multi-index.
     *
     * @returns Index statistics
     */
    getStats(): MultiIndexStats;
    /**
     * Gets the pack registry.
     *
     * @returns Current pack registry
     */
    getRegistry(): PackRegistry;
    /**
     * Checks if compaction is recommended.
     *
     * @returns true if pack count exceeds threshold
     */
    needsCompaction(): boolean;
    /**
     * Gets all entries for a specific pack.
     *
     * @param packId - Pack identifier
     * @returns Array of entries from that pack
     */
    getEntriesForPack(packId: string): MultiIndexEntry[];
    /**
     * Clears all indexed data.
     */
    clear(): void;
    /**
     * Serializes the multi-index to a portable format.
     *
     * @returns Serialized index data
     */
    serialize(): Uint8Array;
    /**
     * Deserializes multi-index data.
     *
     * @param data - Serialized index data
     */
    static deserialize(data: Uint8Array, config?: MultiIndexConfig): MultiIndexManager;
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
export declare function createMultiIndexManager(config?: MultiIndexConfig): MultiIndexManager;
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
export declare function addPackIndexFromData(manager: MultiIndexManager, packId: string, indexData: Uint8Array): void;
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
export declare function batchLookupAcrossManagers(managers: MultiIndexManager[], shas: string[]): BatchLookupResult;
//# sourceMappingURL=multi-index.d.ts.map