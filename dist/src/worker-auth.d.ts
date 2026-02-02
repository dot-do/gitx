/**
 * @fileoverview Worker Authentication Middleware
 *
 * Provides Hono middleware for authenticating requests at the worker entry point.
 * Supports Bearer token (API key) and Basic auth (git clients), with an optional
 * open mode for development when no AUTH_TOKEN is configured.
 *
 * @module worker-auth
 *
 * ## Authentication Modes
 *
 * 1. **Open mode**: If neither `AUTH_TOKEN` nor `API_KEYS` env vars are set,
 *    all requests pass through without authentication (for local development).
 *
 * 2. **Bearer token**: `Authorization: Bearer <token>` — token is validated
 *    against `AUTH_TOKEN` (single key) or `API_KEYS` (comma-separated list).
 *
 * 3. **Basic auth**: `Authorization: Basic <base64(user:token)>` — the password
 *    portion is extracted and validated the same way as a Bearer token.
 *    This is the standard mechanism git clients use for HTTP auth.
 *
 * ## Health Check Bypass
 *
 * Requests to `/health` are always allowed without authentication.
 *
 * ## 401 Response
 *
 * For git protocol endpoints (paths containing `info/refs`, `git-upload-pack`,
 * or `git-receive-pack`), auth failures return:
 *   `WWW-Authenticate: Basic realm="gitx"`
 *
 * For other endpoints, auth failures return a JSON error body.
 *
 * @see {@link ./wire/auth} Core authentication types and credential parsing
 */
import type { Context, Next } from 'hono';
/**
 * Environment variables used by the auth middleware.
 */
export interface AuthEnv {
    /** Single API key / auth token. If set, authentication is required. */
    AUTH_TOKEN?: string;
    /** Comma-separated list of valid API keys. If set, authentication is required. */
    API_KEYS?: string;
}
/**
 * Collect the set of valid tokens from the environment.
 *
 * Returns `null` if no auth is configured (open mode).
 */
export declare function getValidTokens(env: AuthEnv): Set<string> | null;
/**
 * Validate a token against the set of valid tokens using constant-time comparison.
 */
export declare function validateToken(token: string, validTokens: Set<string>): boolean;
/**
 * Extract the token to validate from parsed credentials.
 *
 * - Bearer: the token itself
 * - Basic: the password field (git clients send the token as the password)
 * - Anonymous: null
 */
export declare function extractToken(authHeader: string | undefined): string | null;
/**
 * Create a 401 Unauthorized response appropriate for the request path.
 *
 * Git protocol endpoints get a `WWW-Authenticate: Basic realm="gitx"` header
 * so that git clients prompt the user for credentials.
 */
export declare function createUnauthorized(path: string, message?: string): Response;
/**
 * Hono middleware that enforces authentication on the worker entry point.
 *
 * Usage with Hono:
 * ```typescript
 * import { authMiddleware } from './worker-auth'
 *
 * const app = new Hono<{ Bindings: Env }>()
 * app.use('*', authMiddleware())
 * ```
 */
export declare function authMiddleware(): (c: Context<{
    Bindings: AuthEnv;
}>, next: Next) => Promise<void | Response>;
//# sourceMappingURL=worker-auth.d.ts.map