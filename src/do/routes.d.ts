/**
 * @fileoverview Route handlers for GitRepoDO.
 *
 * Extracted HTTP route handlers for cleaner code organization.
 *
 * @module do/routes
 */
import type { Context, Hono } from 'hono';
import type { InitializeOptions } from './types';
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
}
/**
 * Route context with typed bindings.
 */
export type RouteContext = Context<{
    Bindings: Record<string, unknown>;
}>;
/**
 * Health check route handler.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Health check response
 */
export declare function handleHealthCheck(c: RouteContext, instance: GitRepoDOInstance): Response;
/**
 * Fork route handler (internal).
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Fork response
 */
export declare function handleFork(c: RouteContext, instance: GitRepoDOInstance): Promise<Response>;
/**
 * Info route handler - returns DO metadata.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Info response
 */
export declare function handleInfo(c: RouteContext, instance: GitRepoDOInstance): Response;
/**
 * Setup all routes on a Hono router.
 *
 * @param router - Hono router instance
 * @param instance - GitRepoDO instance
 */
export declare function setupRoutes(router: Hono<{
    Bindings: Record<string, unknown>;
}>, instance: GitRepoDOInstance): void;
//# sourceMappingURL=routes.d.ts.map