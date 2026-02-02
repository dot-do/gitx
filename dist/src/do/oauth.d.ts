/**
 * @fileoverview OAuth.do Integration for gitx.do
 *
 * This module provides JWT-based authentication integration with oauth.do
 * for gitx.do. It includes:
 * - Token extraction from Authorization header (Bearer) and Cookies
 * - JWT verification using JWKS
 * - Session caching for performance
 * - Git-specific scopes: git:read, git:push, git:admin
 * - Hono middleware for protected routes
 *
 * @module do/oauth
 *
 * @example Basic usage
 * ```typescript
 * import { extractToken, verifyJWT, createOAuthMiddleware } from 'gitx.do/do/oauth'
 *
 * // Extract token from request
 * const token = extractToken(request.headers)
 *
 * // Verify JWT
 * const result = await verifyJWT(token, {
 *   jwksUrl: 'https://oauth.do/.well-known/jwks.json',
 *   audience: 'gitx.do',
 *   issuer: 'oauth.do'
 * })
 *
 * // Use middleware
 * app.use('/repos/*', createOAuthMiddleware({
 *   jwksUrl: 'https://oauth.do/.well-known/jwks.json'
 * }))
 * ```
 */
import type { MiddlewareHandler } from 'hono';
/**
 * Git OAuth scopes for permission checking.
 *
 * @description
 * - `git:read`: Allows clone and fetch operations
 * - `git:push`: Allows push operations (implies git:read)
 * - `git:admin`: Full administrative access (implies all other scopes)
 *
 * Scopes can also be repository-specific:
 * - `git:read:owner/repo`: Read access to specific repository
 * - `git:push:owner/repo`: Push access to specific repository
 */
export type GitScope = 'git:read' | 'git:push' | 'git:admin';
/**
 * JWT verification options.
 */
export interface JWTVerifyOptions {
    /** URL to fetch JWKS keys from */
    jwksUrl: string;
    /** Expected audience claim */
    audience?: string;
    /** Expected issuer claim */
    issuer?: string;
}
/**
 * JWT payload structure.
 */
export interface JWTPayload {
    /** Subject (user ID) */
    sub: string;
    /** Email address */
    email?: string;
    /** Display name */
    name?: string;
    /** Issued at timestamp */
    iat: number;
    /** Expiration timestamp */
    exp: number;
    /** Permission scopes */
    scopes?: string[];
    /** Audience */
    aud?: string | string[];
    /** Issuer */
    iss?: string;
}
/**
 * JWT verification result.
 */
export interface JWTVerifyResult {
    /** Whether the JWT is valid */
    valid: boolean;
    /** Decoded payload (if valid) */
    payload?: JWTPayload;
    /** Error message (if invalid) */
    error?: string;
}
/**
 * OAuth context stored in Hono context.
 */
export interface OAuthContext {
    /** User ID from JWT subject */
    userId: string;
    /** User email */
    email?: string;
    /** User display name */
    name?: string;
    /** Git permission scopes */
    scopes: GitScope[];
    /** Raw JWT token */
    token: string;
    /** Token expiration timestamp */
    expiresAt: number;
}
/**
 * Session cache interface for caching verified sessions.
 */
export interface SessionCache {
    /** Get cached session by token */
    get(token: string): OAuthContext | null;
    /** Cache a session with optional TTL in milliseconds */
    set(token: string, context: OAuthContext, ttl?: number): void;
    /** Remove a cached session */
    delete(token: string): void;
    /** Clear all cached sessions */
    clear(): void;
}
/**
 * OAuth middleware options.
 */
export interface OAuthMiddlewareOptions {
    /** JWKS URL for key verification */
    jwksUrl: string;
    /** Expected audience */
    audience?: string;
    /** Expected issuer */
    issuer?: string;
    /** Optional session cache */
    cache?: SessionCache;
    /** Required scopes for all routes */
    requiredScopes?: GitScope[];
}
/**
 * Extract JWT token from request headers.
 *
 * @description
 * Extracts token from:
 * 1. Authorization header (Bearer token) - preferred
 * 2. Cookies (auth_token or session_token)
 *
 * @param headers - Request headers
 * @returns Extracted token or null if not found
 *
 * @example
 * ```typescript
 * const headers = new Headers({
 *   Authorization: 'Bearer eyJhbGci...'
 * })
 * const token = extractToken(headers)
 * // 'eyJhbGci...'
 * ```
 */
export declare function extractToken(headers: Headers): string | null;
/**
 * Verify a JWT token.
 *
 * @description
 * Verifies the JWT signature using JWKS and validates claims:
 * - Expiration (exp)
 * - Not before (nbf, if present)
 * - Issued at (iat) - must not be in the future
 * - Audience (aud, if specified in options)
 * - Issuer (iss, if specified in options)
 *
 * @param token - JWT token to verify
 * @param options - Verification options
 * @returns Verification result with payload or error
 *
 * @example
 * ```typescript
 * const result = await verifyJWT('eyJhbGci...', {
 *   jwksUrl: 'https://oauth.do/.well-known/jwks.json',
 *   audience: 'gitx.do'
 * })
 *
 * if (result.valid) {
 *   console.log('User:', result.payload.sub)
 * } else {
 *   console.error('Invalid:', result.error)
 * }
 * ```
 */
export declare function verifyJWT(token: string, options: JWTVerifyOptions): Promise<JWTVerifyResult>;
/**
 * In-memory session cache implementation.
 *
 * @description
 * A simple in-memory cache for storing verified sessions.
 * Sessions are automatically expired based on TTL.
 *
 * @example
 * ```typescript
 * const cache = new InMemorySessionCache()
 *
 * cache.set('token', context, 300000) // 5 minute TTL
 * const cached = cache.get('token')
 * ```
 */
export declare class InMemorySessionCache implements SessionCache {
    private store;
    get(token: string): OAuthContext | null;
    set(token: string, context: OAuthContext, ttl?: number): void;
    delete(token: string): void;
    clear(): void;
}
/**
 * Parse scopes from JWT payload to GitScopes.
 *
 * @description
 * Extracts and normalizes git-specific scopes from the JWT payload.
 * Handles both simple scopes (git:read) and repository-specific scopes (git:read:owner/repo).
 */
export declare function parseGitScopes(scopes: string[] | undefined): GitScope[];
/**
 * Check if scopes include a required permission.
 *
 * @description
 * Checks scope hierarchy:
 * - git:admin implies all permissions
 * - git:push implies git:read
 *
 * @param scopes - User's scopes
 * @param required - Required scope
 * @returns true if user has sufficient permission
 */
export declare function hasScope(scopes: GitScope[], required: GitScope): boolean;
/**
 * Check if scopes allow a git operation.
 *
 * @param scopes - User's scopes
 * @param operation - Git operation type
 * @returns true if operation is allowed
 */
export declare function canPerformOperation(scopes: GitScope[], operation: 'fetch' | 'clone' | 'push' | 'manage_permissions' | 'update_settings'): boolean;
/**
 * Create OAuth middleware for Hono.
 *
 * @description
 * Creates a middleware that:
 * 1. Extracts JWT from Authorization header or cookies
 * 2. Verifies the JWT using JWKS
 * 3. Caches valid sessions for performance
 * 4. Sets user context on the Hono context object
 *
 * @param options - Middleware options
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * const app = new Hono()
 *
 * // Apply to all protected routes
 * app.use('/repos/*', createOAuthMiddleware({
 *   jwksUrl: 'https://oauth.do/.well-known/jwks.json',
 *   audience: 'gitx.do',
 *   issuer: 'oauth.do'
 * }))
 *
 * // Access user info in handlers
 * app.get('/repos/:owner/:repo', (c) => {
 *   const userId = c.get('userId')
 *   const scopes = c.get('scopes')
 *   return c.json({ userId, scopes })
 * })
 * ```
 */
export declare function createOAuthMiddleware(options: OAuthMiddlewareOptions): MiddlewareHandler;
/**
 * Create a scope-checking middleware.
 *
 * @description
 * Returns a middleware that verifies the user has the required scope.
 * Must be used after createOAuthMiddleware.
 *
 * @param requiredScope - Required git scope
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.post('/repos/:owner/:repo/git-receive-pack',
 *   requireScope('git:push'),
 *   (c) => handlePush(c)
 * )
 * ```
 */
export declare function requireScope(requiredScope: GitScope): MiddlewareHandler;
/**
 * Check if a token refresh is recommended.
 *
 * @description
 * Returns true if the token expires within the specified threshold.
 * Default threshold is 10 minutes (600 seconds).
 *
 * @param expiresAt - Token expiration timestamp (in seconds)
 * @param thresholdSeconds - Time threshold in seconds (default: 600)
 * @returns true if refresh is recommended
 */
export declare function shouldRefreshToken(expiresAt: number, thresholdSeconds?: number): boolean;
//# sourceMappingURL=oauth.d.ts.map