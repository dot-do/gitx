/**
 * @fileoverview Sync and fork route handlers for GitRepoDO.
 *
 * Domain-specific handlers for repository synchronization operations.
 *
 * @module do/sync-routes
 */
import type { GitRepoDOInstance, RouteContext } from './routes';
/**
 * Sync request payload from webhook or manual trigger.
 */
export interface SyncRequest {
    source: 'webhook' | 'manual';
    ref?: string;
    before?: string;
    after?: string;
    commits?: number;
    action?: 'create' | 'delete';
    ref_type?: 'branch' | 'tag';
    repository?: {
        full_name: string;
        clone_url?: string;
        default_branch?: string;
    };
}
/**
 * Fork route handler (internal).
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Fork response
 */
export declare function handleFork(c: RouteContext, instance: GitRepoDOInstance): Promise<Response>;
/**
 * Sync route handler - triggers repository sync.
 *
 * @description
 * Clones or fetches from a remote Git repository using the Smart HTTP protocol.
 * On success, stores all objects in the DO's SQLite storage and returns
 * information about the sync operation.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance with storage access
 * @returns Sync response with clone results
 */
export declare function handleSync(c: RouteContext, instance: GitRepoDOInstance): Promise<Response>;
//# sourceMappingURL=sync-routes.d.ts.map