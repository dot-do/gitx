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
import type { Context, Hono } from 'hono';
import type { InitializeOptions } from './types';
import type { DurableObjectStorage } from './schema';
import type { ParquetStore } from '../storage/parquet-store';
import type { SchemaManager } from './schema';
import type { SqliteObjectStore } from './object-store';
import type { DORepositoryProvider } from './wire-routes';
export { handleHealthCheck, handleInfo } from './health-routes';
export { handleFork, handleSync } from './sync-routes';
export type { SyncRequest } from './sync-routes';
export { handleExport, handleExportStatus } from './export-routes';
export type { ExportRequest, ExportJobStatus } from './export-routes';
export { setupLfsRoutes, handleLfsBatch, handleLfsUpload, handleLfsDownload, handleLfsVerify } from './lfs-routes';
/**
 * GitRepoDO instance interface for route handlers.
 * Provides access to DO properties needed by routes.
 */
export interface GitRepoDOInstance {
    readonly $type: string;
    readonly ns: string | undefined;
    initialize(options: InitializeOptions): Promise<void>;
    /** Capabilities set - accessed via getter in implementation */
    getCapabilities(): Set<string>;
    /** Start time for uptime tracking */
    readonly _startTime: number;
    /** Access to DO SQLite storage for sync operations */
    getStorage(): DurableObjectStorage;
    /** Access to R2 analytics bucket for Parquet export */
    getAnalyticsBucket(): R2Bucket | undefined;
    /** Access to ParquetStore for buffered Parquet writes to R2 */
    getParquetStore(): ParquetStore | undefined;
    /** Schedule background work that doesn't block the response */
    waitUntil(promise: Promise<unknown>): void;
    /** Schedule Parquet compaction to run in a future DO alarm */
    scheduleCompaction(delayMs?: number): boolean;
    /** Get cached SchemaManager (singleton per DO instance) */
    getSchemaManager(): SchemaManager;
    /** Get cached SqliteObjectStore (singleton per DO instance) */
    getObjectStore(): SqliteObjectStore;
    /** Get cached DORepositoryProvider (singleton per DO instance, used by wire protocol) */
    getRepositoryProvider(): DORepositoryProvider;
    /** Get cached GitBackendAdapter (singleton per DO instance) */
    getGitBackendAdapter(): import('./git-backend-adapter').GitBackendAdapter;
    /** Invalidate all cached instances (call on reset/alarm) */
    invalidateCaches(): void;
}
/**
 * Route context with typed bindings.
 * Uses Record<string, unknown> for bindings to maintain flexibility.
 */
export type RouteContext = Context<{
    Bindings: Record<string, unknown>;
}>;
/**
 * Route setup options.
 */
export interface RouteSetupOptions {
    /**
     * Enable rate limiting middleware.
     * When true, applies default rate limits.
     * Can also provide custom RateLimitOptions.
     */
    rateLimit?: boolean | RateLimitOptions;
    /**
     * Custom rate limit store (required if rateLimit is enabled without full options).
     */
    rateLimitStore?: RateLimitStore;
}
import { type RateLimitOptions, type RateLimitStore } from '../middleware/rate-limit';
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
export declare function setupRoutes(router: Hono<{
    Bindings: Record<string, unknown>;
}>, instance: GitRepoDOInstance, options?: RouteSetupOptions): void;
//# sourceMappingURL=routes.d.ts.map