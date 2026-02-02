/**
 * @fileoverview Repository analytics and metrics dashboard.
 *
 * Provides Hono routes that serve HTML dashboards showing:
 * - Commit frequency over time
 * - Contributor statistics
 * - Language breakdown
 * - File change frequency
 * - Code churn (additions/deletions)
 *
 * Uses the existing ObjectStore and enrichment modules to gather data
 * from the Git object graph stored in the Durable Object.
 *
 * @module web/analytics
 */
import type { Hono } from 'hono';
import type { ObjectStore, CommitProvider } from '../types/storage';
/**
 * Context for analytics route dependencies.
 */
export interface AnalyticsContext {
    getObjectStore(): ObjectStore & CommitProvider;
}
/**
 * Setup analytics routes on a Hono router.
 *
 * Registers:
 * - GET /analytics - HTML dashboard
 * - GET /analytics/data - JSON API for raw analytics data
 *
 * @param router - Hono router instance
 * @param getContext - Function returning the analytics context (ObjectStore + CommitProvider)
 */
export declare function setupAnalyticsRoutes(router: Hono<{
    Bindings: Record<string, unknown>;
}>, getContext: () => AnalyticsContext): void;
//# sourceMappingURL=analytics.d.ts.map