/**
 * Git MCP Authentication Middleware
 *
 * Provides OAuth 2.1 authentication via oauth.do for MCP git operations.
 * Implements token introspection (RFC 7662) for access control.
 *
 * ## Authentication Flow
 *
 * 1. MCP client sends request with Bearer token
 * 2. Middleware introspects token via oauth.do
 * 3. Scopes determine access level:
 *    - `read` or `git:read` - read-only access
 *    - `write` or `git:write` - full access
 *    - `admin` or `git:admin` - admin access
 *
 * ## Usage with Hono
 *
 * ```typescript
 * import { Hono } from 'hono'
 * import { gitAuthMiddleware, requireGitWrite } from 'gitx.do/mcp'
 *
 * const app = new Hono()
 *
 * // Apply auth middleware to all routes
 * app.use('/*', gitAuthMiddleware({
 *   introspectionUrl: 'https://oauth.do/introspect',
 *   clientId: env.OAUTH_CLIENT_ID,
 *   clientSecret: env.OAUTH_CLIENT_SECRET,
 * }))
 *
 * // Protect write operations
 * app.post('/git/commit', requireGitWrite(), async (c) => {
 *   const auth = c.get('gitAuth')
 *   // ...
 * })
 * ```
 *
 * @module mcp/auth
 */
import type { MiddlewareHandler } from 'hono';
import type { GitAuthContext, GitAuthConfig } from './types';
export type { GitAuthContext, GitAuthConfig } from './types';
/**
 * Extend Hono's ContextVariableMap with gitAuth
 */
declare module 'hono' {
    interface ContextVariableMap {
        gitAuth: GitAuthContext;
    }
}
/**
 * Create authentication middleware for Hono
 */
export declare function gitAuthMiddleware(config: GitAuthConfig): MiddlewareHandler;
/**
 * Middleware that requires authentication
 */
export declare function requireGitAuth(): MiddlewareHandler;
/**
 * Middleware that requires write access
 */
export declare function requireGitWrite(): MiddlewareHandler;
/**
 * Middleware that requires admin access
 */
export declare function requireGitAdmin(): MiddlewareHandler;
/**
 * Authenticate a standalone request (for non-Hono use)
 */
export declare function authenticateRequest(request: Request, config: GitAuthConfig): Promise<{
    success: true;
    context: GitAuthContext;
} | {
    success: false;
    error: string;
}>;
//# sourceMappingURL=auth.d.ts.map