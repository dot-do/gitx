/**
 * Tiered Read Path
 *
 * Implements reading objects from the multi-tier storage system:
 * - Hot tier: Durable Object SQLite (fastest, local)
 * - Warm tier: R2 object storage (medium latency, packed objects)
 * - Cold tier: Analytics/Parquet (highest latency, cold storage)
 *
 * Features:
 * - Tier fallback on miss
 * - Cache promotion (read-through caching)
 * - Configurable promotion policies
 *
 * gitdo-aaw: Tiered read path implementation
 */
import { ObjectType } from '../types/objects';
/**
 * Stored object representation
 */
export interface StoredObject {
    sha: string;
    type: ObjectType;
    size: number;
    data: Uint8Array;
    createdAt: number;
}
/**
 * Configuration for a single tier
 */
export interface TierConfig {
    enabled: boolean;
    maxSize?: number;
    ttl?: number;
}
/**
 * Configuration for the tiered storage system
 */
export interface TieredStorageConfig {
    hot: TierConfig;
    warm: TierConfig;
    cold: TierConfig;
    promotionPolicy: 'aggressive' | 'conservative' | 'none';
}
/**
 * Result of a read operation
 */
export interface ReadResult {
    object: StoredObject | null;
    tier: 'hot' | 'warm' | 'cold' | null;
    promoted: boolean;
    latencyMs: number;
}
/**
 * Interface for the tiered object store
 */
export interface TieredObjectStore {
    read(sha: string): Promise<ReadResult>;
    readFromHot(sha: string): Promise<StoredObject | null>;
    readFromWarm(sha: string): Promise<StoredObject | null>;
    readFromCold(sha: string): Promise<StoredObject | null>;
    promoteToHot(sha: string, object: StoredObject): Promise<void>;
    getConfig(): TieredStorageConfig;
}
/**
 * Hot tier backend interface (Durable Object SQLite)
 */
export interface HotTierBackend {
    get(sha: string): Promise<StoredObject | null>;
    put(sha: string, object: StoredObject): Promise<void>;
    delete(sha: string): Promise<boolean>;
    has(sha: string): Promise<boolean>;
}
/**
 * Warm tier backend interface (R2 object storage)
 */
export interface WarmTierBackend {
    get(sha: string): Promise<StoredObject | null>;
    getFromPack(packId: string, offset: number): Promise<StoredObject | null>;
}
/**
 * Cold tier backend interface (Analytics/Parquet)
 */
export interface ColdTierBackend {
    get(sha: string): Promise<StoredObject | null>;
    query(filter: {
        type?: ObjectType;
        minSize?: number;
        maxSize?: number;
    }): Promise<StoredObject[]>;
}
/**
 * TieredReader - Main implementation of the tiered read path
 *
 * Reads objects from multiple storage tiers with fallback logic
 * and optional promotion to hotter tiers.
 */
export declare class TieredReader implements TieredObjectStore {
    private hotBackend;
    private warmBackend;
    private coldBackend;
    private config;
    constructor(hotBackend: HotTierBackend, warmBackend: WarmTierBackend, coldBackend: ColdTierBackend, config: TieredStorageConfig);
    /**
     * Read an object from the tiered storage system
     *
     * Tries each enabled tier in order: hot -> warm -> cold
     * Promotes objects to hot tier based on promotion policy
     */
    read(sha: string): Promise<ReadResult>;
    /**
     * Read an object directly from the hot tier
     */
    readFromHot(sha: string): Promise<StoredObject | null>;
    /**
     * Read an object directly from the warm tier
     */
    readFromWarm(sha: string): Promise<StoredObject | null>;
    /**
     * Read an object directly from the cold tier
     */
    readFromCold(sha: string): Promise<StoredObject | null>;
    /**
     * Manually promote an object to the hot tier
     */
    promoteToHot(sha: string, object: StoredObject): Promise<void>;
    /**
     * Get the current configuration
     */
    getConfig(): TieredStorageConfig;
    /**
     * Try to promote an object to the hot tier based on policy
     *
     * @param sha - The object's SHA
     * @param object - The object to promote
     * @param sourceTier - The tier the object was read from
     * @returns true if promotion was successful
     */
    private tryPromote;
}
export { TieredReader as TieredObjectStoreStub };
//# sourceMappingURL=read-path.d.ts.map