/**
 * @fileoverview Git HTTP Authentication Middleware
 *
 * This module provides middleware for authenticating Git HTTP protocol requests.
 * It integrates with the existing wire protocol handlers to add authentication
 * before processing push/pull operations.
 *
 * @module wire/auth-middleware
 *
 * ## Integration Points
 *
 * The middleware integrates at two levels:
 *
 * 1. **Request Level**: Authenticate the incoming HTTP request before
 *    routing to the appropriate handler (info/refs, upload-pack, receive-pack)
 *
 * 2. **Repository Level**: Integrate with RepositoryProvider.hasPermission()
 *    to combine authentication with authorization
 *
 * @see {@link ./auth} Core authentication types and utilities
 * @see {@link ./smart-http} Smart HTTP protocol handlers
 *
 * @example Middleware with Hono
 * ```typescript
 * import { Hono } from 'hono'
 * import { createAuthMiddleware, MemoryAuthProvider } from './wire/auth-middleware'
 *
 * const app = new Hono()
 *
 * // Create auth provider with users
 * const authProvider = new MemoryAuthProvider({
 *   users: {
 *     'alice': { password: 'secret', scopes: ['repo:read', 'repo:write'] },
 *     'bob': { password: 'token123', scopes: ['repo:read'] }
 *   }
 * })
 *
 * // Apply middleware
 * const auth = createAuthMiddleware(authProvider)
 *
 * app.use('/:repo/*', async (c, next) => {
 *   const result = await auth.authenticate(c.req.raw)
 *   if (!result.authenticated) {
 *     return new Response(result.error, {
 *       status: 401,
 *       headers: { 'WWW-Authenticate': 'Basic realm="Git"' }
 *     })
 *   }
 *   c.set('user', result.user)
 *   return next()
 * })
 * ```
 */
import type { AuthProvider, AuthContext, AuthResult, AuthOptions, Credentials, AuthenticatedUser } from './auth';
import type { SmartHTTPRequest, SmartHTTPResponse, GitService } from './smart-http';
/**
 * Result of middleware authentication check.
 */
export interface AuthenticationResult {
    /** Whether the request is authenticated */
    authenticated: boolean;
    /** Authenticated user information (if authenticated) */
    user?: AuthenticatedUser;
    /** Scopes/permissions granted (if authenticated) */
    scopes?: string[];
    /** Error response to return (if not authenticated) */
    errorResponse?: SmartHTTPResponse;
    /** Reason for authentication failure */
    reason?: string;
}
/**
 * Authentication middleware interface.
 *
 * @description
 * Provides methods for authenticating requests at different points
 * in the request lifecycle.
 */
export interface AuthMiddleware {
    /**
     * Authenticate a SmartHTTPRequest.
     *
     * @param request - The Smart HTTP request to authenticate
     * @param options - Authentication options
     * @returns Authentication result
     */
    authenticate(request: SmartHTTPRequest, options?: AuthOptions): Promise<AuthenticationResult>;
    /**
     * Authenticate using raw headers.
     *
     * @param authorizationHeader - Authorization header value
     * @param context - Authentication context
     * @param options - Authentication options
     * @returns Authentication result
     */
    authenticateWithHeader(authorizationHeader: string | undefined, context: AuthContext, options?: AuthOptions): Promise<AuthenticationResult>;
    /**
     * Get the authentication provider.
     *
     * @returns The underlying auth provider
     */
    getProvider(): AuthProvider;
}
/**
 * Create an authentication middleware instance.
 *
 * @description
 * Creates a middleware that authenticates requests using the provided
 * AuthProvider. The middleware can be configured to allow anonymous
 * access, restrict operations by scope, etc.
 *
 * @param provider - The authentication provider
 * @param defaultOptions - Default options for all requests
 * @returns AuthMiddleware instance
 *
 * @example
 * ```typescript
 * const provider = new MemoryAuthProvider({ users: { ... } })
 * const middleware = createAuthMiddleware(provider, {
 *   allowAnonymousRead: true,  // Allow anonymous git fetch
 *   realm: 'My Git Server'
 * })
 *
 * // Authenticate a request
 * const result = await middleware.authenticate(request)
 * if (!result.authenticated) {
 *   return new Response(null, { status: 401 })
 * }
 * ```
 */
export declare function createAuthMiddleware(provider: AuthProvider, defaultOptions?: AuthOptions): AuthMiddleware;
/**
 * Memory-based authentication provider configuration.
 */
export interface MemoryAuthProviderConfig {
    /** Map of username to user configuration */
    users?: Record<string, {
        password: string;
        scopes?: string[];
        metadata?: Record<string, unknown>;
    }>;
    /** Map of token to token configuration */
    tokens?: Record<string, {
        scopes?: string[];
        userId?: string;
        metadata?: Record<string, unknown>;
    }>;
    /** Default realm for WWW-Authenticate header */
    realm?: string;
}
/**
 * In-memory authentication provider.
 *
 * @description
 * A simple authentication provider that stores credentials in memory.
 * Useful for development, testing, and simple deployments.
 *
 * **WARNING**: Not suitable for production use with many users.
 * Credentials are stored in memory and lost on restart.
 *
 * @example
 * ```typescript
 * const provider = new MemoryAuthProvider({
 *   users: {
 *     'alice': { password: 'secret123', scopes: ['repo:read', 'repo:write'] },
 *     'bob': { password: 'readonly', scopes: ['repo:read'] }
 *   },
 *   tokens: {
 *     'ghp_xxxxxxxxxxxx': { scopes: ['repo:read', 'repo:write'], userId: 'alice' }
 *   }
 * })
 * ```
 */
export declare class MemoryAuthProvider implements AuthProvider {
    private readonly config;
    constructor(config?: MemoryAuthProviderConfig);
    validateCredentials(credentials: Credentials, _context: AuthContext): Promise<AuthResult>;
    private validateBasicCredentials;
    private validateBearerToken;
    getRealm(_context: AuthContext): string;
    /**
     * Add a user to the provider.
     *
     * @param username - Username
     * @param password - Password
     * @param scopes - Optional scopes
     */
    addUser(username: string, password: string, scopes?: string[]): void;
    /**
     * Add a token to the provider.
     *
     * @param token - Token string
     * @param userId - Associated user ID
     * @param scopes - Optional scopes
     */
    addToken(token: string, userId: string, scopes?: string[]): void;
    /**
     * Remove a user from the provider.
     *
     * @param username - Username to remove
     */
    removeUser(username: string): void;
    /**
     * Remove a token from the provider.
     *
     * @param token - Token to remove
     */
    removeToken(token: string): void;
}
/**
 * Callback-based authentication provider.
 *
 * @description
 * An authentication provider that delegates validation to callback functions.
 * Useful for integrating with external authentication systems.
 *
 * @example
 * ```typescript
 * const provider = new CallbackAuthProvider({
 *   validateBasic: async (username, password, context) => {
 *     const user = await externalAuthService.validate(username, password)
 *     if (user) {
 *       return { valid: true, user: { id: user.id, name: user.name } }
 *     }
 *     return { valid: false, reason: 'Invalid credentials' }
 *   },
 *   validateBearer: async (token, context) => {
 *     const decoded = await jwtService.verify(token)
 *     if (decoded) {
 *       return { valid: true, user: { id: decoded.sub }, scopes: decoded.scopes }
 *     }
 *     return { valid: false, reason: 'Invalid token' }
 *   }
 * })
 * ```
 */
export declare class CallbackAuthProvider implements AuthProvider {
    private readonly callbacks;
    constructor(callbacks: {
        validateBasic?: (username: string, password: string, context: AuthContext) => Promise<AuthResult>;
        validateBearer?: (token: string, context: AuthContext) => Promise<AuthResult>;
        getRealm?: (context: AuthContext) => string;
    });
    validateCredentials(credentials: Credentials, context: AuthContext): Promise<AuthResult>;
    getRealm(context: AuthContext): string;
}
/**
 * Create an authenticated repository provider wrapper.
 *
 * @description
 * Wraps a RepositoryProvider to integrate authentication into the
 * hasPermission method. This allows the repository provider to make
 * authorization decisions based on the authenticated user.
 *
 * @param provider - Original repository provider
 * @param user - Authenticated user (or undefined for anonymous)
 * @param scopes - User's scopes/permissions
 * @returns Wrapped repository provider
 *
 * @example
 * ```typescript
 * // After authentication
 * const authResult = await middleware.authenticate(request)
 * if (!authResult.authenticated) {
 *   return authResult.errorResponse
 * }
 *
 * // Wrap repository with auth context
 * const authedRepo = createAuthenticatedRepositoryProvider(
 *   repository,
 *   authResult.user,
 *   authResult.scopes
 * )
 *
 * // Use wrapped repo - hasPermission will check auth
 * const response = await handleInfoRefs(request, authedRepo)
 * ```
 */
export declare function createAuthenticatedRepositoryProvider<T extends {
    hasPermission(service: GitService): Promise<boolean>;
}>(provider: T, user: AuthenticatedUser | undefined, scopes: string[] | undefined): T;
export type { AuthProvider, AuthContext, AuthResult, AuthOptions, Credentials, AuthenticatedUser, BasicCredentials, BearerCredentials, AnonymousCredentials, AuthType, } from './auth';
export { parseAuthorizationHeader, encodeBasicAuth, encodeBearerAuth, createUnauthorizedResponse, constantTimeCompare, isAnonymous, isBasicAuth, isBearerAuth, DEFAULT_REALM, } from './auth';
//# sourceMappingURL=auth-middleware.d.ts.map