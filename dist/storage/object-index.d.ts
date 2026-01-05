/**
 * Object Location Index
 *
 * Tracks the storage location of Git objects across multiple tiers:
 * - Hot: SQLite (local Durable Object storage for frequently accessed objects)
 * - R2: Packed in R2 object storage (for larger objects or archives)
 * - Parquet: Columnar format for cold storage analytics
 *
 * The index enables efficient object lookup regardless of which tier
 * contains the actual data.
 */
import { DurableObjectStorage } from '../durable-object/schema';
/**
 * Storage tiers for object location
 */
export type StorageTier = 'hot' | 'r2' | 'parquet';
/**
 * Represents the location of a git object in the tiered storage system
 */
export interface ObjectLocation {
    /** The storage tier where the object is located */
    tier: StorageTier;
    /** Pack file ID (for R2 or Parquet tiers, null for hot tier) */
    packId: string | null;
    /** Byte offset within the pack file (for R2 or Parquet tiers) */
    offset: number | null;
    /** Size of the object in bytes */
    size: number;
    /** The object's SHA-1 hash */
    sha: string;
    /** Object type (blob, tree, commit, tag) */
    type?: string;
    /** Timestamp when location was last updated */
    updatedAt?: number;
}
/**
 * Statistics about objects in each storage tier
 */
export interface ObjectIndexStats {
    /** Total number of indexed objects */
    totalObjects: number;
    /** Number of objects in hot tier */
    hotCount: number;
    /** Number of objects in R2 tier */
    r2Count: number;
    /** Number of objects in Parquet tier */
    parquetCount: number;
    /** Total size of objects in hot tier (bytes) */
    hotSize: number;
    /** Total size of objects in R2 tier (bytes) */
    r2Size: number;
    /** Total size of objects in Parquet tier (bytes) */
    parquetSize: number;
}
/**
 * Result of a batch lookup operation
 */
export interface BatchLookupResult {
    /** Map of SHA to location for found objects */
    found: Map<string, ObjectLocation>;
    /** Array of SHAs that were not found */
    missing: string[];
}
/**
 * Options for recording an object location
 */
export interface RecordLocationOptions {
    /** The object's SHA-1 hash */
    sha: string;
    /** Storage tier */
    tier: StorageTier;
    /** Pack ID (required for r2/parquet tiers) */
    packId?: string;
    /** Offset in pack file */
    offset?: number;
    /** Size in bytes */
    size: number;
    /** Object type */
    type?: string;
}
/**
 * Object Index class for managing object locations across storage tiers
 */
export declare class ObjectIndex {
    private _storage;
    constructor(storage: DurableObjectStorage);
    /**
     * Record the location of an object
     */
    recordLocation(options: RecordLocationOptions): Promise<void>;
    /**
     * Look up the location of an object by SHA
     */
    lookupLocation(sha: string): Promise<ObjectLocation | null>;
    /**
     * Perform batch lookup of multiple objects
     */
    batchLookup(shas: string[]): Promise<BatchLookupResult>;
    /**
     * Update the location of an object (e.g., when moving between tiers)
     */
    updateLocation(sha: string, newTier: StorageTier, packId?: string, offset?: number): Promise<void>;
    /**
     * Get statistics about object distribution across tiers
     */
    getStats(): Promise<ObjectIndexStats>;
    /**
     * Check if an object exists in the index
     */
    exists(sha: string): Promise<boolean>;
    /**
     * Delete an object from the index
     */
    deleteLocation(sha: string): Promise<boolean>;
    /**
     * Get all objects in a specific tier
     */
    getObjectsByTier(tier: StorageTier): Promise<ObjectLocation[]>;
    /**
     * Get all objects in a specific pack
     */
    getObjectsByPack(packId: string): Promise<ObjectLocation[]>;
}
/**
 * Record the location of an object (standalone function)
 */
export declare function recordLocation(storage: DurableObjectStorage, options: RecordLocationOptions): Promise<void>;
/**
 * Look up the location of an object by SHA (standalone function)
 */
export declare function lookupLocation(storage: DurableObjectStorage, sha: string): Promise<ObjectLocation | null>;
/**
 * Perform batch lookup of multiple objects (standalone function)
 */
export declare function batchLookup(storage: DurableObjectStorage, shas: string[]): Promise<BatchLookupResult>;
/**
 * Get statistics about object distribution (standalone function)
 */
export declare function getStats(storage: DurableObjectStorage): Promise<ObjectIndexStats>;
//# sourceMappingURL=object-index.d.ts.map