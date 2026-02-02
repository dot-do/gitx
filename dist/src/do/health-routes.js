/**
 * @fileoverview Health and info route handlers for GitRepoDO.
 *
 * Domain-specific handlers for health checks and DO metadata.
 *
 * @module do/health-routes
 */
// ============================================================================
// Route Handlers
// ============================================================================
/**
 * Health check route handler.
 *
 * Verifies SQLite connectivity, bloom filter status, and ParquetStore status.
 * Reports overall status as "ok", "degraded", or "unhealthy".
 *
 * - "ok": all components are healthy
 * - "degraded": at least one optional component (bloom, parquet) is unhealthy
 * - "unhealthy": SQLite is not working
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Health check response
 */
export function handleHealthCheck(c, instance) {
    const components = {};
    // -- SQLite connectivity check --
    try {
        const storage = instance.getStorage();
        const result = storage.sql.exec('SELECT 1 AS ok');
        const rows = result.toArray();
        if (rows.length === 1 && rows[0]?.ok === 1) {
            components.sqlite = { status: 'ok' };
        }
        else {
            components.sqlite = { status: 'unhealthy', message: 'Unexpected SELECT 1 result' };
        }
    }
    catch (err) {
        components.sqlite = {
            status: 'unhealthy',
            message: err instanceof Error ? err.message : 'SQLite query failed',
        };
    }
    // -- Bloom filter status --
    const parquetStore = instance.getParquetStore();
    if (parquetStore) {
        try {
            const stats = parquetStore.getStats();
            const bloomStats = stats.bloom;
            components.bloom = {
                status: 'ok',
                segments: bloomStats.bloomSegments,
                items: bloomStats.bloomItems,
                falsePositiveRate: bloomStats.bloomFalsePositiveRate,
                exactCacheSize: bloomStats.exactCacheSize,
            };
        }
        catch (err) {
            components.bloom = {
                status: 'degraded',
                message: err instanceof Error ? err.message : 'Bloom filter check failed',
            };
        }
    }
    // -- ParquetStore status --
    if (parquetStore) {
        try {
            const stats = parquetStore.getStats();
            components.parquet = {
                status: 'ok',
                parquetFiles: stats.parquetFiles,
                bufferedObjects: stats.bufferedObjects,
                bufferedBytes: stats.bufferedBytes,
            };
        }
        catch (err) {
            components.parquet = {
                status: 'degraded',
                message: err instanceof Error ? err.message : 'ParquetStore check failed',
            };
        }
    }
    // -- Derive overall status --
    let overall = 'ok';
    if (components.sqlite?.status === 'unhealthy') {
        overall = 'unhealthy';
    }
    else if (components.bloom?.status === 'degraded' ||
        components.bloom?.status === 'unhealthy' ||
        components.parquet?.status === 'degraded' ||
        components.parquet?.status === 'unhealthy') {
        overall = 'degraded';
    }
    const response = {
        status: overall,
        ...(instance.ns !== undefined && { ns: instance.ns }),
        $type: instance.$type,
        uptime: Date.now() - instance._startTime,
        capabilities: Array.from(instance.getCapabilities()),
        components,
    };
    const statusCode = overall === 'unhealthy' ? 503 : 200;
    return c.json(response, statusCode);
}
/**
 * Info route handler - returns DO metadata.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Info response
 */
export function handleInfo(c, instance) {
    return c.json({
        $type: instance.$type,
        ns: instance.ns,
        capabilities: Array.from(instance.getCapabilities()),
    });
}
//# sourceMappingURL=health-routes.js.map