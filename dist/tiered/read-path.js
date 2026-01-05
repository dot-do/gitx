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
/**
 * Validates a SHA-1 hash
 */
function isValidSha(sha) {
    if (!sha || sha.length !== 40) {
        return false;
    }
    return /^[0-9a-f]{40}$/i.test(sha);
}
/**
 * TieredReader - Main implementation of the tiered read path
 *
 * Reads objects from multiple storage tiers with fallback logic
 * and optional promotion to hotter tiers.
 */
export class TieredReader {
    hotBackend;
    warmBackend;
    coldBackend;
    config;
    constructor(hotBackend, warmBackend, coldBackend, config) {
        this.hotBackend = hotBackend;
        this.warmBackend = warmBackend;
        this.coldBackend = coldBackend;
        this.config = config;
    }
    /**
     * Read an object from the tiered storage system
     *
     * Tries each enabled tier in order: hot -> warm -> cold
     * Promotes objects to hot tier based on promotion policy
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
            catch {
                // Hot tier failed, continue to next tier
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
            catch {
                // Warm tier failed, continue to cold tier
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
            catch {
                // Cold tier failed
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
     * Read an object directly from the hot tier
     */
    async readFromHot(sha) {
        try {
            return await this.hotBackend.get(sha);
        }
        catch {
            return null;
        }
    }
    /**
     * Read an object directly from the warm tier
     */
    async readFromWarm(sha) {
        try {
            return await this.warmBackend.get(sha);
        }
        catch {
            return null;
        }
    }
    /**
     * Read an object directly from the cold tier
     */
    async readFromCold(sha) {
        try {
            return await this.coldBackend.get(sha);
        }
        catch {
            return null;
        }
    }
    /**
     * Manually promote an object to the hot tier
     */
    async promoteToHot(sha, object) {
        await this.hotBackend.put(sha, object);
    }
    /**
     * Get the current configuration
     */
    getConfig() {
        return this.config;
    }
    /**
     * Try to promote an object to the hot tier based on policy
     *
     * @param sha - The object's SHA
     * @param object - The object to promote
     * @param sourceTier - The tier the object was read from
     * @returns true if promotion was successful
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
        catch {
            // Promotion failed, but we still have the object
            return false;
        }
    }
}
// Re-export as TieredObjectStoreStub for backward compatibility with tests
export { TieredReader as TieredObjectStoreStub };
//# sourceMappingURL=read-path.js.map