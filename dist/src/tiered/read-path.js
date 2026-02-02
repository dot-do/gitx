/**
 * @fileoverview Tiered Read Path Module
 *
 * @description
 * Implements reading objects from a multi-tier storage system designed for
 * Git object storage. The tiered approach optimizes for both performance and
 * cost by organizing data across multiple storage layers with different
 * characteristics:
 *
 * **Storage Tiers:**
 * - **Hot tier**: Durable Object SQLite (fastest, local, highest cost)
 * - **Warm tier**: R2 object storage (medium latency, packed objects)
 * - **Cold tier**: Analytics/Parquet (highest latency, lowest cost)
 *
 * **Features:**
 * - Automatic tier fallback on cache miss
 * - Read-through caching with promotion to hotter tiers
 * - Configurable promotion policies (aggressive, conservative, none)
 * - Latency tracking for performance monitoring
 *
 * **Architecture:**
 * The TieredReader orchestrates reads across all tiers, attempting to serve
 * data from the fastest available tier while optionally promoting frequently
 * accessed objects to faster tiers.
 *
 * @example
 * ```typescript
 * // Create a tiered reader with all backends
 * const reader = new TieredReader(
 *   hotBackend,
 *   warmBackend,
 *   coldBackend,
 *   {
 *     hot: { enabled: true, maxSize: 1024 * 1024 },
 *     warm: { enabled: true },
 *     cold: { enabled: true },
 *     promotionPolicy: 'aggressive'
 *   }
 * )
 *
 * // Read an object - will try hot -> warm -> cold
 * const result = await reader.read('abc123...')
 * if (result.object) {
 *   console.log(`Found in ${result.tier} tier`)
 *   console.log(`Latency: ${result.latencyMs}ms`)
 *   if (result.promoted) {
 *     console.log('Object was promoted to hot tier')
 *   }
 * }
 * ```
 *
 * @module tiered/read-path
 * @see {@link TieredReader} - Main implementation class
 * @see {@link TieredStorageConfig} - Configuration options
 */
/**
 * Validates a SHA-1 hash string.
 *
 * @description
 * Checks that the provided string is a valid 40-character hexadecimal
 * SHA-1 hash. Used internally to validate input before querying storage.
 *
 * @param sha - The string to validate
 * @returns true if the string is a valid SHA-1 hash, false otherwise
 *
 * @example
 * ```typescript
 * isValidSha('abc123')  // false - too short
 * isValidSha('a1b2c3d4e5f678901234567890abcdef12345678')  // true
 * isValidSha('xyz123...')  // false - invalid characters
 * ```
 *
 * @internal
 */
function isValidSha(sha) {
    if (!sha || sha.length !== 40) {
        return false;
    }
    return /^[0-9a-f]{40}$/i.test(sha);
}
/**
 * TieredReader - Main implementation of the tiered read path.
 *
 * @description
 * TieredReader orchestrates reads across multiple storage tiers (hot, warm, cold),
 * implementing automatic fallback and optional promotion to hotter tiers. It provides
 * a unified interface for reading Git objects regardless of which tier they reside in.
 *
 * **Read Algorithm:**
 * 1. Validate the SHA-1 hash
 * 2. If hot tier enabled, attempt to read from hot tier
 * 3. If not found and warm tier enabled, attempt warm tier
 * 4. If not found and cold tier enabled, attempt cold tier
 * 5. If found in warm/cold, optionally promote to hot tier
 * 6. Return result with object, source tier, and metrics
 *
 * **Promotion Policies:**
 * - `aggressive`: Immediately promote any object read from warm/cold to hot
 * - `conservative`: Reserved for future implementation (repeated access tracking)
 * - `none`: Never automatically promote objects
 *
 * **Error Handling:**
 * Individual tier failures are silently caught and the next tier is tried.
 * This ensures graceful degradation when a tier is temporarily unavailable.
 *
 * @example
 * ```typescript
 * // Create backends for each tier
 * const hotBackend = new SqliteHotBackend(db)
 * const warmBackend = new R2WarmBackend(r2)
 * const coldBackend = new ParquetColdBackend(parquet)
 *
 * // Configure the tiered storage
 * const config: TieredStorageConfig = {
 *   hot: { enabled: true, maxSize: 1024 * 1024 },
 *   warm: { enabled: true },
 *   cold: { enabled: true },
 *   promotionPolicy: 'aggressive'
 * }
 *
 * // Create the reader
 * const reader = new TieredReader(hotBackend, warmBackend, coldBackend, config)
 *
 * // Read an object
 * const result = await reader.read('a1b2c3d4e5f678901234567890abcdef12345678')
 *
 * if (result.object) {
 *   console.log(`Object type: ${result.object.type}`)
 *   console.log(`Size: ${result.object.size} bytes`)
 *   console.log(`Served from: ${result.tier} tier`)
 *   console.log(`Latency: ${result.latencyMs}ms`)
 *
 *   if (result.promoted) {
 *     console.log('Object was promoted to hot tier')
 *   }
 * } else {
 *   console.log('Object not found in any tier')
 * }
 *
 * // Direct tier access
 * const hotOnly = await reader.readFromHot(sha)
 * const warmOnly = await reader.readFromWarm(sha)
 * const coldOnly = await reader.readFromCold(sha)
 *
 * // Manual promotion
 * if (warmOnly) {
 *   await reader.promoteToHot(sha, warmOnly)
 * }
 * ```
 *
 * @class TieredReader
 * @implements {TieredObjectStore}
 */
export class TieredReader {
    /**
     * Backend for the hot storage tier (Durable Object SQLite).
     * @private
     */
    hotBackend;
    /**
     * Backend for the warm storage tier (R2 object storage).
     * @private
     */
    warmBackend;
    /**
     * Backend for the cold storage tier (Analytics/Parquet).
     * @private
     */
    coldBackend;
    /**
     * Configuration for all tiers and promotion policy.
     * @private
     */
    config;
    /**
     * Creates a new TieredReader instance.
     *
     * @param hotBackend - Backend for the hot tier (Durable Object SQLite)
     * @param warmBackend - Backend for the warm tier (R2)
     * @param coldBackend - Backend for the cold tier (Parquet)
     * @param config - Configuration for all tiers and promotion policy
     *
     * @example
     * ```typescript
     * const reader = new TieredReader(
     *   hotBackend,
     *   warmBackend,
     *   coldBackend,
     *   {
     *     hot: { enabled: true, maxSize: 1024 * 1024 },
     *     warm: { enabled: true },
     *     cold: { enabled: true },
     *     promotionPolicy: 'aggressive'
     *   }
     * )
     * ```
     */
    constructor(hotBackend, warmBackend, coldBackend, config) {
        this.hotBackend = hotBackend;
        this.warmBackend = warmBackend;
        this.coldBackend = coldBackend;
        this.config = config;
    }
    /**
     * Reads an object from the tiered storage system.
     *
     * @description
     * Attempts to read the object from each enabled tier in order
     * (hot -> warm -> cold), returning as soon as the object is found.
     * Objects found in warm or cold tiers may be promoted to hot tier
     * based on the configured promotion policy.
     *
     * **Invalid SHA Handling:**
     * If the SHA is invalid (not 40 hex characters), returns immediately
     * with null object and no tier lookup is performed.
     *
     * **Error Handling:**
     * If a tier fails (throws an error), the error is caught silently
     * and the next tier is attempted. This provides graceful degradation.
     *
     * @param sha - The 40-character SHA-1 hash of the object to read
     * @returns Promise resolving to the read result with object, tier, and metrics
     *
     * @example
     * ```typescript
     * const result = await reader.read('a1b2c3d4e5f678901234567890abcdef12345678')
     *
     * if (result.object) {
     *   // Object found
     *   console.log(`Type: ${result.object.type}`)
     *   console.log(`Tier: ${result.tier}`)
     *   console.log(`Promoted: ${result.promoted}`)
     * } else {
     *   // Object not found
     *   console.log(`Search took ${result.latencyMs}ms`)
     * }
     * ```
     */
    async read(sha) {
        const startTime = performance.now();
        // Validate SHA
        if (!isValidSha(sha)) {
            return {
                object: null,
                tier: null,
                promoted: false,
                latencyMs: performance.now() - startTime
            };
        }
        // Try hot tier first
        if (this.config.hot.enabled) {
            try {
                const obj = await this.hotBackend.get(sha);
                if (obj) {
                    return {
                        object: obj,
                        tier: 'hot',
                        promoted: false,
                        latencyMs: performance.now() - startTime
                    };
                }
            }
            catch (error) {
                // Hot tier failed, continue to next tier
                console.debug(`[TieredReader] read: hot tier failed for ${sha}:`, error instanceof Error ? error.message : String(error));
            }
        }
        // Try warm tier
        if (this.config.warm.enabled) {
            try {
                const obj = await this.warmBackend.get(sha);
                if (obj) {
                    const promoted = await this.tryPromote(sha, obj, 'warm');
                    return {
                        object: obj,
                        tier: 'warm',
                        promoted,
                        latencyMs: performance.now() - startTime
                    };
                }
            }
            catch (error) {
                // Warm tier failed, continue to cold tier
                console.debug(`[TieredReader] read: warm tier failed for ${sha}:`, error instanceof Error ? error.message : String(error));
            }
        }
        // Try cold tier
        if (this.config.cold.enabled) {
            try {
                const obj = await this.coldBackend.get(sha);
                if (obj) {
                    const promoted = await this.tryPromote(sha, obj, 'cold');
                    return {
                        object: obj,
                        tier: 'cold',
                        promoted,
                        latencyMs: performance.now() - startTime
                    };
                }
            }
            catch (error) {
                // Cold tier failed
                console.debug(`[TieredReader] read: cold tier failed for ${sha}:`, error instanceof Error ? error.message : String(error));
            }
        }
        // Object not found in any tier
        return {
            object: null,
            tier: null,
            promoted: false,
            latencyMs: performance.now() - startTime
        };
    }
    /**
     * Reads an object directly from the hot tier only.
     *
     * @description
     * Bypasses the tier fallback logic to read directly from the hot tier.
     * Useful for checking if an object is already in the hot cache.
     * Errors are caught and null is returned.
     *
     * @param sha - The 40-character SHA-1 hash of the object
     * @returns Promise resolving to the object or null if not in hot tier
     *
     * @example
     * ```typescript
     * const cached = await reader.readFromHot(sha)
     * if (cached) {
     *   console.log('Object is in hot cache')
     * } else {
     *   console.log('Object not in hot cache')
     * }
     * ```
     */
    async readFromHot(sha) {
        try {
            return await this.hotBackend.get(sha);
        }
        catch (error) {
            console.debug(`[TieredReader] readFromHot failed for ${sha}:`, error instanceof Error ? error.message : String(error));
            return null;
        }
    }
    /**
     * Reads an object directly from the warm tier only.
     *
     * @description
     * Bypasses the tier fallback logic to read directly from the warm tier.
     * Does not trigger automatic promotion to hot tier.
     * Errors are caught and null is returned.
     *
     * @param sha - The 40-character SHA-1 hash of the object
     * @returns Promise resolving to the object or null if not in warm tier
     *
     * @example
     * ```typescript
     * const warm = await reader.readFromWarm(sha)
     * if (warm) {
     *   // Manually promote if desired
     *   await reader.promoteToHot(sha, warm)
     * }
     * ```
     */
    async readFromWarm(sha) {
        try {
            return await this.warmBackend.get(sha);
        }
        catch (error) {
            console.debug(`[TieredReader] readFromWarm failed for ${sha}:`, error instanceof Error ? error.message : String(error));
            return null;
        }
    }
    /**
     * Reads an object directly from the cold tier only.
     *
     * @description
     * Bypasses the tier fallback logic to read directly from the cold tier.
     * Does not trigger automatic promotion to hotter tiers.
     * Errors are caught and null is returned.
     *
     * @param sha - The 40-character SHA-1 hash of the object
     * @returns Promise resolving to the object or null if not in cold tier
     *
     * @example
     * ```typescript
     * const cold = await reader.readFromCold(sha)
     * if (cold) {
     *   console.log(`Found in cold storage, created at: ${cold.createdAt}`)
     * }
     * ```
     */
    async readFromCold(sha) {
        try {
            return await this.coldBackend.get(sha);
        }
        catch (error) {
            console.debug(`[TieredReader] readFromCold failed for ${sha}:`, error instanceof Error ? error.message : String(error));
            return null;
        }
    }
    /**
     * Manually promotes an object to the hot tier.
     *
     * @description
     * Copies the provided object to the hot tier storage. This is useful for
     * pre-warming the cache or manually controlling tier placement. No size
     * or policy checks are performed - the object is always written.
     *
     * @param sha - The 40-character SHA-1 hash of the object
     * @param object - The complete stored object to promote
     * @returns Promise that resolves when promotion is complete
     * @throws Error if the hot tier write fails
     *
     * @example
     * ```typescript
     * // Pre-warm the hot cache
     * const objects = await reader.query({ type: 'commit' })
     * for (const obj of objects) {
     *   await reader.promoteToHot(obj.sha, obj)
     * }
     * ```
     */
    async promoteToHot(sha, object) {
        await this.hotBackend.put(sha, object);
    }
    /**
     * Returns the current storage configuration.
     *
     * @description
     * Returns the configuration object passed to the constructor.
     * Useful for inspecting current settings or debugging.
     *
     * @returns The tiered storage configuration
     *
     * @example
     * ```typescript
     * const config = reader.getConfig()
     * console.log(`Promotion policy: ${config.promotionPolicy}`)
     * console.log(`Hot tier enabled: ${config.hot.enabled}`)
     * ```
     */
    getConfig() {
        return this.config;
    }
    /**
     * Attempts to promote an object to the hot tier based on policy.
     *
     * @description
     * Called internally when an object is found in warm or cold tier.
     * Decides whether to promote based on:
     * 1. Hot tier being enabled
     * 2. Promotion policy (aggressive promotes, conservative/none don't)
     * 3. Object size being within hot tier's maxSize limit
     *
     * @param sha - The object's SHA-1 hash
     * @param object - The object to potentially promote
     * @param _sourceTier - The tier the object was read from (for future use)
     * @returns true if promotion was successful, false otherwise
     *
     * @private
     */
    async tryPromote(sha, object, _sourceTier) {
        // Check if hot tier is enabled
        if (!this.config.hot.enabled) {
            return false;
        }
        // Check promotion policy
        if (this.config.promotionPolicy === 'none') {
            return false;
        }
        // Conservative policy only promotes from warm tier on repeated access
        // For now, conservative means no automatic promotion on first read
        if (this.config.promotionPolicy === 'conservative') {
            return false;
        }
        // Check size limit for hot tier
        if (this.config.hot.maxSize !== undefined && object.size > this.config.hot.maxSize) {
            return false;
        }
        // Try to promote
        try {
            await this.hotBackend.put(sha, object);
            return true;
        }
        catch (error) {
            // Promotion failed, but we still have the object from the original tier
            console.debug(`[TieredReader] tryPromote: failed to promote ${sha} to hot tier:`, error instanceof Error ? error.message : String(error));
            return false;
        }
    }
}
// Re-export as TieredObjectStoreStub for backward compatibility with tests
export { TieredReader as TieredObjectStoreStub };
//# sourceMappingURL=read-path.js.map