/**
 * @fileoverview Web UI for repository browsing
 *
 * Server-rendered HTML pages for browsing Git repositories via the browser.
 * Provides file tree, file viewer with syntax highlighting, commit log,
 * and diff viewer. Uses the existing object store APIs to read data.
 *
 * @module web
 */
import type { Hono } from 'hono';
import type { GitRepoDOInstance } from '../do/routes';
export declare function setupWebRoutes(router: Hono<{
    Bindings: Record<string, unknown>;
}>, instance: GitRepoDOInstance): void;
//# sourceMappingURL=index.d.ts.map