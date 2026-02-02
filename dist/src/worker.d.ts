/**
 * @fileoverview gitx-do Worker Entry Point
 *
 * Production entry point for the gitx-do Cloudflare Worker.
 * Exports the Durable Object classes and provides a default fetch handler
 * that routes requests to the appropriate DO.
 *
 * @module gitx.do/worker
 */
import { Hono } from 'hono';
import { GitRepoDO, GitRepoDOSQL } from './do/git-repo-do';
interface Env {
    GITX: DurableObjectNamespace;
    R2: R2Bucket;
    PACK_STORAGE: R2Bucket;
    ANALYTICS_BUCKET?: R2Bucket;
    FSX?: Fetcher;
    BASHX?: Fetcher;
    GITHUB_WEBHOOK_SECRET: string;
    AUTH_TOKEN?: string;
    API_KEYS?: string;
}
declare const app: Hono<{
    Bindings: Env;
}, import("hono/types").BlankSchema, "/">;
export default app;
export { GitRepoDO, GitRepoDOSQL };
//# sourceMappingURL=worker.d.ts.map