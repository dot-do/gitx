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

import { ObjectType } from '../types/objects'

/**
 * Stored object representation
 */
export interface StoredObject {
  sha: string
  type: ObjectType
  size: number
  data: Uint8Array
  createdAt: number
}

/**
 * Configuration for a single tier
 */
export interface TierConfig {
  enabled: boolean
  maxSize?: number
  ttl?: number
}

/**
 * Configuration for the tiered storage system
 */
export interface TieredStorageConfig {
  hot: TierConfig
  warm: TierConfig
  cold: TierConfig
  promotionPolicy: 'aggressive' | 'conservative' | 'none'
}

/**
 * Result of a read operation
 */
export interface ReadResult {
  object: StoredObject | null
  tier: 'hot' | 'warm' | 'cold' | null
  promoted: boolean
  latencyMs: number
}

/**
 * Interface for the tiered object store
 */
export interface TieredObjectStore {
  read(sha: string): Promise<ReadResult>
  readFromHot(sha: string): Promise<StoredObject | null>
  readFromWarm(sha: string): Promise<StoredObject | null>
  readFromCold(sha: string): Promise<StoredObject | null>
  promoteToHot(sha: string, object: StoredObject): Promise<void>
  getConfig(): TieredStorageConfig
}

/**
 * Hot tier backend interface (Durable Object SQLite)
 */
export interface HotTierBackend {
  get(sha: string): Promise<StoredObject | null>
  put(sha: string, object: StoredObject): Promise<void>
  delete(sha: string): Promise<boolean>
  has(sha: string): Promise<boolean>
}

/**
 * Warm tier backend interface (R2 object storage)
 */
export interface WarmTierBackend {
  get(sha: string): Promise<StoredObject | null>
  getFromPack(packId: string, offset: number): Promise<StoredObject | null>
}

/**
 * Cold tier backend interface (Analytics/Parquet)
 */
export interface ColdTierBackend {
  get(sha: string): Promise<StoredObject | null>
  query(filter: { type?: ObjectType; minSize?: number; maxSize?: number }): Promise<StoredObject[]>
}

/**
 * Validates a SHA-1 hash
 */
function isValidSha(sha: string): boolean {
  if (!sha || sha.length !== 40) {
    return false
  }
  return /^[0-9a-f]{40}$/i.test(sha)
}

/**
 * TieredReader - Main implementation of the tiered read path
 *
 * Reads objects from multiple storage tiers with fallback logic
 * and optional promotion to hotter tiers.
 */
export class TieredReader implements TieredObjectStore {
  private hotBackend: HotTierBackend
  private warmBackend: WarmTierBackend
  private coldBackend: ColdTierBackend
  private config: TieredStorageConfig

  constructor(
    hotBackend: HotTierBackend,
    warmBackend: WarmTierBackend,
    coldBackend: ColdTierBackend,
    config: TieredStorageConfig
  ) {
    this.hotBackend = hotBackend
    this.warmBackend = warmBackend
    this.coldBackend = coldBackend
    this.config = config
  }

  /**
   * Read an object from the tiered storage system
   *
   * Tries each enabled tier in order: hot -> warm -> cold
   * Promotes objects to hot tier based on promotion policy
   */
  async read(sha: string): Promise<ReadResult> {
    const startTime = performance.now()

    // Validate SHA
    if (!isValidSha(sha)) {
      return {
        object: null,
        tier: null,
        promoted: false,
        latencyMs: performance.now() - startTime
      }
    }

    // Try hot tier first
    if (this.config.hot.enabled) {
      try {
        const obj = await this.hotBackend.get(sha)
        if (obj) {
          return {
            object: obj,
            tier: 'hot',
            promoted: false,
            latencyMs: performance.now() - startTime
          }
        }
      } catch {
        // Hot tier failed, continue to next tier
      }
    }

    // Try warm tier
    if (this.config.warm.enabled) {
      try {
        const obj = await this.warmBackend.get(sha)
        if (obj) {
          const promoted = await this.tryPromote(sha, obj, 'warm')
          return {
            object: obj,
            tier: 'warm',
            promoted,
            latencyMs: performance.now() - startTime
          }
        }
      } catch {
        // Warm tier failed, continue to cold tier
      }
    }

    // Try cold tier
    if (this.config.cold.enabled) {
      try {
        const obj = await this.coldBackend.get(sha)
        if (obj) {
          const promoted = await this.tryPromote(sha, obj, 'cold')
          return {
            object: obj,
            tier: 'cold',
            promoted,
            latencyMs: performance.now() - startTime
          }
        }
      } catch {
        // Cold tier failed
      }
    }

    // Object not found in any tier
    return {
      object: null,
      tier: null,
      promoted: false,
      latencyMs: performance.now() - startTime
    }
  }

  /**
   * Read an object directly from the hot tier
   */
  async readFromHot(sha: string): Promise<StoredObject | null> {
    try {
      return await this.hotBackend.get(sha)
    } catch {
      return null
    }
  }

  /**
   * Read an object directly from the warm tier
   */
  async readFromWarm(sha: string): Promise<StoredObject | null> {
    try {
      return await this.warmBackend.get(sha)
    } catch {
      return null
    }
  }

  /**
   * Read an object directly from the cold tier
   */
  async readFromCold(sha: string): Promise<StoredObject | null> {
    try {
      return await this.coldBackend.get(sha)
    } catch {
      return null
    }
  }

  /**
   * Manually promote an object to the hot tier
   */
  async promoteToHot(sha: string, object: StoredObject): Promise<void> {
    await this.hotBackend.put(sha, object)
  }

  /**
   * Get the current configuration
   */
  getConfig(): TieredStorageConfig {
    return this.config
  }

  /**
   * Try to promote an object to the hot tier based on policy
   *
   * @param sha - The object's SHA
   * @param object - The object to promote
   * @param sourceTier - The tier the object was read from
   * @returns true if promotion was successful
   */
  private async tryPromote(
    sha: string,
    object: StoredObject,
    _sourceTier: 'warm' | 'cold'
  ): Promise<boolean> {
    // Check if hot tier is enabled
    if (!this.config.hot.enabled) {
      return false
    }

    // Check promotion policy
    if (this.config.promotionPolicy === 'none') {
      return false
    }

    // Conservative policy only promotes from warm tier on repeated access
    // For now, conservative means no automatic promotion on first read
    if (this.config.promotionPolicy === 'conservative') {
      return false
    }

    // Check size limit for hot tier
    if (this.config.hot.maxSize !== undefined && object.size > this.config.hot.maxSize) {
      return false
    }

    // Try to promote
    try {
      await this.hotBackend.put(sha, object)
      return true
    } catch {
      // Promotion failed, but we still have the object
      return false
    }
  }
}

// Re-export as TieredObjectStoreStub for backward compatibility with tests
export { TieredReader as TieredObjectStoreStub }
