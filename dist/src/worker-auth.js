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
import { parseAuthorizationHeader, constantTimeCompare } from './wire/auth';
// ============================================================================
// Helpers
// ============================================================================
/**
 * Paths that bypass authentication entirely.
 */
const PUBLIC_PATHS = new Set(['/', '/health']);
/**
 * Check whether a request path is a git protocol endpoint.
 *
 * Git smart HTTP protocol endpoints follow patterns like:
 * - /repo/info/refs?service=git-upload-pack
 * - /repo/git-upload-pack
 * - /repo/git-receive-pack
 */
function isGitProtocolPath(path) {
    return (path.includes('/info/refs') ||
        path.includes('/git-upload-pack') ||
        path.includes('/git-receive-pack'));
}
/**
 * Collect the set of valid tokens from the environment.
 *
 * Returns `null` if no auth is configured (open mode).
 */
export function getValidTokens(env) {
    const tokens = new Set();
    if (env.AUTH_TOKEN) {
        tokens.add(env.AUTH_TOKEN);
    }
    if (env.API_KEYS) {
        for (const key of env.API_KEYS.split(',')) {
            const trimmed = key.trim();
            if (trimmed) {
                tokens.add(trimmed);
            }
        }
    }
    // No auth configured — open mode
    if (tokens.size === 0) {
        return null;
    }
    return tokens;
}
/**
 * Validate a token against the set of valid tokens using constant-time comparison.
 */
export function validateToken(token, validTokens) {
    for (const valid of validTokens) {
        if (constantTimeCompare(token, valid)) {
            return true;
        }
    }
    return false;
}
/**
 * Extract the token to validate from parsed credentials.
 *
 * - Bearer: the token itself
 * - Basic: the password field (git clients send the token as the password)
 * - Anonymous: null
 */
export function extractToken(authHeader) {
    const credentials = parseAuthorizationHeader(authHeader);
    switch (credentials.type) {
        case 'bearer':
            return credentials.token;
        case 'basic':
            // Git clients typically send the token as the password.
            // If password is empty, try the username (some clients send token as username).
            return credentials.password || credentials.username || null;
        case 'anonymous':
            return null;
    }
}
// ============================================================================
// Middleware
// ============================================================================
/**
 * Create a 401 Unauthorized response appropriate for the request path.
 *
 * Git protocol endpoints get a `WWW-Authenticate: Basic realm="gitx"` header
 * so that git clients prompt the user for credentials.
 */
export function createUnauthorized(path, message = 'Authentication required') {
    if (isGitProtocolPath(path)) {
        return new Response(message + '\n', {
            status: 401,
            headers: {
                'Content-Type': 'text/plain',
                'WWW-Authenticate': 'Basic realm="gitx"',
            },
        });
    }
    return new Response(JSON.stringify({ error: message }), {
        status: 401,
        headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Basic realm="gitx"',
        },
    });
}
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
export function authMiddleware() {
    return async (c, next) => {
        const path = new URL(c.req.url).pathname;
        // Public paths bypass authentication
        if (PUBLIC_PATHS.has(path)) {
            return next();
        }
        // Collect valid tokens from environment
        const validTokens = getValidTokens(c.env);
        // Open mode — no auth configured, allow all requests
        if (validTokens === null) {
            return next();
        }
        // Extract token from Authorization header
        const authHeader = c.req.header('Authorization');
        const token = extractToken(authHeader);
        if (!token) {
            return createUnauthorized(path);
        }
        if (!validateToken(token, validTokens)) {
            return createUnauthorized(path, 'Invalid credentials');
        }
        // Authenticated — proceed
        return next();
    };
}
//# sourceMappingURL=worker-auth.js.map