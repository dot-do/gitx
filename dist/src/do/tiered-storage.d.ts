/**
 * @fileoverview R2 Tiered Storage for GitModule
 *
 * This module provides tiered storage support for Git objects in the GitModule,
 * implementing a three-tier architecture:
 *
 * - **Hot tier**: SQLite in Durable Object (fastest access, limited capacity)
 * - **Warm tier**: R2 loose objects (medium latency, larger capacity)
 * - **Cold tier**: R2 packfiles (highest latency, most efficient storage)
 *
 * The module automatically:
 * - Promotes frequently accessed objects to the hot tier
 * - Demotes old/rarely accessed objects to warm/cold tiers
 * - Supports packfile storage in R2 for efficiency
 *
 * @module do/tiered-storage
 *
 * @example
 * ```typescript
 * import { TieredStorage } from 'gitx.do/do'
 *
 * const storage = new TieredStorage({
 *   r2: env.R2_BUCKET,
 *   sql: ctx.storage.sql,
 *   prefix: 'git/objects',
 *   hotTierMaxBytes: 50 * 1024 * 1024, // 50MB in SQLite
 *   promotionThreshold: 3, // Promote after 3 accesses
 *   demotionAgeDays: 7 // Demote after 7 days without access
 * })
 *
 * // Get an object (checks hot -> warm -> cold)
 * const obj = await storage.getObject(sha)
 *
 * // Store an object (goes to appropriate tier based on size/frequency)
 * await storage.putObject(sha, type, data)
 * ```
 */
import type { ObjectType } from '../types/objects';
/**
 * R2 Bucket interface for object storage operations.
 */
export interface R2BucketLike {
    get(key: string): Promise<R2ObjectLike | null>;
    put(key: string, value: ArrayBuffer | Uint8Array | string, options?: R2PutOptions): Promise<R2ObjectLike>;
    delete(key: string | string[]): Promise<void>;
    list(options?: {
        prefix?: string;
        limit?: number;
        cursor?: string;
    }): Promise<R2ObjectsLike>;
    head(key: string): Promise<R2ObjectLike | null>;
}
/**
 * R2 Put options interface.
 */
export interface R2PutOptions {
    customMetadata?: Record<string, string>;
}
/**
 * R2 Object interface.
 */
export interface R2ObjectLike {
    key: string;
    size: number;
    customMetadata?: Record<string, string>;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
}
/**
 * R2 Objects list result interface.
 */
export interface R2ObjectsLike {
    objects: R2ObjectLike[];
    truncated: boolean;
    cursor?: string;
}
/**
 * SQL parameter types that can be passed to exec().
 */
export type SqlParam = string | number | boolean | null | Uint8Array;
/**
 * SQL interface for Durable Object storage.
 */
export interface SqlStorage {
    exec<T = Record<string, unknown>>(query: string, ...params: SqlParam[]): {
        toArray(): T[];
    };
}
/**
 * Storage tier enumeration.
 */
export type StorageTier = 'hot' | 'warm' | 'cold';
/**
 * Object metadata stored in SQLite for tracking.
 */
export interface ObjectMetadata {
    sha: string;
    type: ObjectType;
    size: number;
    tier: StorageTier;
    accessCount: number;
    lastAccessed: number;
    createdAt: number;
    packId?: string;
    packOffset?: number;
}
/**
 * Configuration options for TieredStorage.
 */
export interface TieredStorageOptions {
    /**
     * R2 bucket for warm and cold storage.
     */
    r2: R2BucketLike;
    /**
     * SQL storage interface for hot tier and metadata.
     */
    sql: SqlStorage;
    /**
     * Key prefix for R2 objects.
     * @default 'git/objects'
     */
    prefix?: string;
    /**
     * Maximum bytes to store in the hot tier (SQLite).
     * @default 50 * 1024 * 1024 (50MB)
     */
    hotTierMaxBytes?: number;
    /**
     * Number of accesses before promoting to hot tier.
     * @default 3
     */
    promotionThreshold?: number;
    /**
     * Days without access before demoting to colder tier.
     * @default 7
     */
    demotionAgeDays?: number;
    /**
     * Maximum object size to store in hot tier.
     * @default 1 * 1024 * 1024 (1MB)
     */
    hotTierMaxObjectSize?: number;
    /**
     * Enable automatic promotion on access.
     * @default true
     */
    autoPromote?: boolean;
    /**
     * Enable automatic demotion of old objects.
     * @default true
     */
    autoDemote?: boolean;
}
/**
 * Result of a get operation.
 */
export interface GetObjectResult {
    type: ObjectType;
    data: Uint8Array;
    tier: StorageTier;
    promoted: boolean;
}
/**
 * Statistics about the tiered storage.
 */
export interface TieredStorageStats {
    hotTierCount: number;
    hotTierBytes: number;
    warmTierCount: number;
    coldTierCount: number;
    totalObjects: number;
    cacheHitRate: number;
    promotions: number;
    demotions: number;
}
/**
 * TieredStorage - R2 Tiered Storage for GitModule
 *
 * @description
 * Provides a three-tier storage system for Git objects optimized for
 * Cloudflare Workers with Durable Objects:
 *
 * - **Hot tier**: SQLite blob storage in Durable Object
 *   - Fastest access (local to DO)
 *   - Limited capacity (50MB default)
 *   - For frequently accessed objects
 *
 * - **Warm tier**: R2 loose objects
 *   - Medium latency (~50-100ms)
 *   - Unlimited capacity
 *   - For recently accessed objects
 *
 * - **Cold tier**: R2 packfiles
 *   - Highest latency (requires packfile parsing)
 *   - Most storage efficient
 *   - For archived/rarely accessed objects
 *
 * @example
 * ```typescript
 * const storage = new TieredStorage({
 *   r2: env.GIT_OBJECTS,
 *   sql: ctx.storage.sql,
 *   prefix: 'repos/my-repo/objects'
 * })
 *
 * // Store a new object
 * await storage.putObject('abc123...', 'blob', blobData)
 *
 * // Retrieve an object (auto-promotes on frequent access)
 * const result = await storage.getObject('abc123...')
 * console.log(`Found in ${result.tier} tier, promoted: ${result.promoted}`)
 *
 * // Run maintenance (demotes old objects)
 * await storage.runMaintenance()
 * ```
 */
export declare class TieredStorage {
    private readonly r2;
    private readonly sql;
    private readonly prefix;
    private readonly hotTierMaxBytes;
    private readonly promotionThreshold;
    private readonly demotionAgeDays;
    private readonly hotTierMaxObjectSize;
    private readonly autoPromote;
    private readonly autoDemote;
    private hotHits;
    private warmHits;
    private coldHits;
    private misses;
    private promotions;
    private demotions;
    private initialized;
    /**
     * Creates a new TieredStorage instance.
     *
     * @param options - Configuration options
     */
    constructor(options: TieredStorageOptions);
    /**
     * Initialize the SQLite schema for tiered storage.
     */
    initialize(): Promise<void>;
    /**
     * Get an object from the tiered storage.
     *
     * @description
     * Attempts to retrieve the object from each tier in order:
     * 1. Hot tier (SQLite)
     * 2. Warm tier (R2 loose objects)
     * 3. Cold tier (R2 packfiles)
     *
     * Automatically promotes frequently accessed objects to hotter tiers.
     *
     * @param sha - 40-character SHA-1 hash of the object
     * @returns Object data with tier information, or null if not found
     */
    getObject(sha: string): Promise<GetObjectResult | null>;
    /**
     * Store an object in the tiered storage.
     *
     * @description
     * Stores the object in the appropriate tier based on size and configuration:
     * - Small, new objects go to hot tier if capacity allows
     * - Large objects go directly to warm tier
     *
     * @param sha - 40-character SHA-1 hash
     * @param type - Git object type
     * @param data - Raw object data
     * @returns The tier where the object was stored
     */
    putObject(sha: string, type: ObjectType, data: Uint8Array): Promise<StorageTier>;
    /**
     * Check if an object exists in any tier.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns True if object exists
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Delete an object from all tiers.
     *
     * @param sha - 40-character SHA-1 hash
     */
    deleteObject(sha: string): Promise<void>;
    /**
     * Manually promote an object to the hot tier.
     *
     * @param sha - Object SHA to promote
     * @param type - Object type
     * @param data - Object data
     * @returns True if promotion succeeded
     */
    promoteToHot(sha: string, type: ObjectType, data: Uint8Array): Promise<boolean>;
    /**
     * Demote an object from hot to warm tier.
     *
     * @param sha - Object SHA to demote
     */
    demoteToWarm(sha: string): Promise<void>;
    /**
     * Demote an object from warm to cold tier (packfile).
     *
     * @description
     * This is typically done during packfile creation, where multiple
     * warm objects are combined into a packfile for efficiency.
     *
     * @param sha - Object SHA to demote
     * @param packId - Packfile ID where object will be stored
     * @param packOffset - Byte offset within the packfile
     */
    demoteToCold(sha: string, packId: string, packOffset: number): Promise<void>;
    /**
     * Run maintenance tasks (demotion of old objects).
     *
     * @description
     * This should be called periodically to:
     * 1. Demote old hot tier objects to warm
     * 2. Optionally pack warm objects into cold tier
     *
     * @param options - Maintenance options
     * @returns Number of objects demoted
     */
    runMaintenance(options?: {
        dryRun?: boolean;
    }): Promise<number>;
    /**
     * Get storage statistics.
     */
    getStats(): Promise<TieredStorageStats>;
    /**
     * Create a packfile from warm tier objects.
     *
     * @description
     * Combines multiple warm tier objects into a packfile stored in R2.
     * This is more storage-efficient and can reduce costs.
     *
     * @param shas - Array of SHA hashes to pack
     * @returns Pack ID and size
     */
    createPackfile(shas: string[]): Promise<{
        packId: string;
        size: number;
        objectCount: number;
    }>;
    /**
     * Get object from hot tier (SQLite).
     */
    private getFromHotTier;
    /**
     * Get object from warm tier (R2 loose objects).
     */
    private getFromWarmTier;
    /**
     * Get object from cold tier (R2 packfile).
     */
    private getFromColdTier;
    /**
     * Store object in hot tier.
     */
    private storeInHotTier;
    /**
     * Store object in warm tier.
     */
    private storeInWarmTier;
    /**
     * Promote object to warm tier.
     */
    private promoteToWarm;
    /**
     * Get metadata for an object.
     */
    private getMetadata;
    /**
     * Record an access to an object.
     */
    private recordAccess;
    /**
     * Get total bytes in hot tier.
     */
    private getHotTierBytes;
    /**
     * Evict objects from hot tier to make room.
     */
    private evictFromHotTier;
    /**
     * Build R2 key for a loose object.
     */
    private buildR2Key;
    /**
     * Build a simple packfile from objects.
     */
    private buildPackfile;
    /**
     * Parse an object from packfile data at offset.
     */
    private parsePackObject;
}
/**
 * Create a TieredStorage instance.
 *
 * @param options - Configuration options
 * @returns Configured TieredStorage instance
 */
export declare function createTieredStorage(options: TieredStorageOptions): TieredStorage;
//# sourceMappingURL=tiered-storage.d.ts.map