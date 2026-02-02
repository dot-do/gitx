/**
 * @fileoverview Health and info route handlers for GitRepoDO.
 *
 * Domain-specific handlers for health checks and DO metadata.
 *
 * @module do/health-routes
 */
import type { GitRepoDOInstance, RouteContext } from './routes';
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
export declare function handleHealthCheck(c: RouteContext, instance: GitRepoDOInstance): Response;
/**
 * Info route handler - returns DO metadata.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Info response
 */
export declare function handleInfo(c: RouteContext, instance: GitRepoDOInstance): Response;
//# sourceMappingURL=health-routes.d.ts.map