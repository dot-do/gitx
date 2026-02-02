/**
 * @fileoverview Route composition for GitRepoDO.
 *
 * This module composes domain-specific route handlers into a unified router.
 * The actual handlers are split into separate files by domain:
 * - health-routes.ts: Health check and info endpoints
 * - sync-routes.ts: Repository sync and fork operations
 * - export-routes.ts: Parquet/Iceberg export operations
 * - lfs-routes.ts: Git LFS batch API, upload, download, verify
 * - wire-routes.ts: Git Smart HTTP wire protocol
 *
 * @module do/routes
 */
// Import domain-specific handlers
import { handleHealthCheck, handleInfo } from './health-routes';
import { handleFork, handleSync } from './sync-routes';
import { handleExport, handleExportStatus } from './export-routes';
import { setupLfsRoutes } from './lfs-routes';
import { setupWireRoutes } from './wire-routes';
import { setupAnalyticsRoutes } from '../web/analytics';
import { setupWebRoutes } from '../web/index';
// Re-export handlers for backward compatibility
export { handleHealthCheck, handleInfo } from './health-routes';
export { handleFork, handleSync } from './sync-routes';
export { handleExport, handleExportStatus } from './export-routes';
export { setupLfsRoutes, handleLfsBatch, handleLfsUpload, handleLfsDownload, handleLfsVerify } from './lfs-routes';
// Rate limiting imports
import { createRateLimitMiddleware, MemoryRateLimitStore, DEFAULT_LIMITS, } from '../middleware/rate-limit';
/**
 * Setup all routes on a Hono router.
 *
 * Composes domain-specific route handlers:
 * - /health, /info: Health and metadata (health-routes.ts)
 * - /fork, /sync: Repository operations (sync-routes.ts)
 * - /export, /export/status/:jobId: Parquet/Iceberg export (export-routes.ts)
 * - /objects/batch, /lfs/objects/:oid, /lfs/verify: Git LFS (lfs-routes.ts)
 * - /:namespace/info/refs, /:namespace/git-*: Wire protocol (wire-routes.ts)
 *
 * @param router - Hono router instance
 * @param instance - GitRepoDO instance
 * @param options - Optional configuration for routes
 */
export function setupRoutes(router, instance, options = {}) {
    // Apply rate limiting middleware if enabled
    if (options.rateLimit) {
        const rateLimitOptions = typeof options.rateLimit === 'object'
            ? options.rateLimit
            : {
                store: options.rateLimitStore ?? new MemoryRateLimitStore(),
                limits: DEFAULT_LIMITS,
            };
        router.use('*', createRateLimitMiddleware(rateLimitOptions));
    }
    // Health and info endpoints (health-routes.ts)
    router.get('/health', (c) => handleHealthCheck(c, instance));
    router.get('/info', (c) => handleInfo(c, instance));
    // Repository operations (sync-routes.ts)
    router.post('/fork', (c) => handleFork(c, instance));
    router.post('/sync', (c) => handleSync(c, instance));
    // Export endpoints (export-routes.ts)
    router.post('/export', (c) => handleExport(c, instance));
    router.get('/export/status/:jobId', (c) => handleExportStatus(c, instance));
    // LFS routes (lfs-routes.ts)
    // - POST /objects/batch - Batch API for checking object availability
    // - PUT /lfs/objects/:oid - Upload LFS object
    // - GET /lfs/objects/:oid - Download LFS object
    // - POST /lfs/verify - Verify uploaded object
    setupLfsRoutes(router, instance);
    // Analytics dashboard (web/analytics.ts)
    setupAnalyticsRoutes(router, () => ({
        getObjectStore: () => instance.getObjectStore(),
    }));
    // Web UI for repository browsing (web/index.ts)
    // - GET /web          - Repository overview (branches, tags)
    // - GET /web/log      - Commit log
    // - GET /web/commit/:sha - Commit detail with diff
    // - GET /web/tree/:ref/* - File tree and file viewer
    // - GET /web/blob/:sha   - Raw blob viewer
    setupWebRoutes(router, instance);
    // Git Smart HTTP wire protocol routes (wire-routes.ts)
    // These serve git clone/fetch/push over HTTP:
    //   GET  /:namespace/info/refs         - ref advertisement
    //   POST /:namespace/git-upload-pack   - fetch/clone serving
    //   POST /:namespace/git-receive-pack  - push receiving
    setupWireRoutes(router, instance);
    // Catch-all for 404
    router.all('*', (c) => {
        return c.json({
            error: 'Not Found',
            path: new URL(c.req.url).pathname,
        }, 404);
    });
}
//# sourceMappingURL=routes.js.map