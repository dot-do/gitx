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
import { parseAuthorizationHeader, createUnauthorizedResponse, isAnonymous, DEFAULT_REALM, constantTimeCompare, } from './auth';
/**
 * Create context for service operations.
 *
 * @internal
 */
function createAuthContext(request) {
    // Determine service from path or query
    let service = 'git-upload-pack';
    if (request.path.includes('git-receive-pack') || request.query.service === 'git-receive-pack') {
        service = 'git-receive-pack';
    }
    return {
        repository: request.repository,
        service,
        path: request.path,
        method: request.method,
        userAgent: request.headers['user-agent'] || request.headers['User-Agent'],
        clientIp: request.headers['x-forwarded-for'] || request.headers['cf-connecting-ip'],
    };
}
// ============================================================================
// Middleware Factory
// ============================================================================
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
export function createAuthMiddleware(provider, defaultOptions) {
    return {
        async authenticate(request, options) {
            const context = createAuthContext(request);
            const authHeader = request.headers['authorization'] || request.headers['Authorization'];
            const mergedOptions = { ...defaultOptions, ...options };
            return this.authenticateWithHeader(authHeader, context, mergedOptions);
        },
        async authenticateWithHeader(authorizationHeader, context, options) {
            const mergedOptions = { ...defaultOptions, ...options };
            // Parse credentials from header
            const credentials = parseAuthorizationHeader(authorizationHeader);
            // Check if anonymous access is allowed
            if (isAnonymous(credentials)) {
                // Allow anonymous for read operations if configured
                if (mergedOptions.allowAnonymousRead && context.service === 'git-upload-pack') {
                    return {
                        authenticated: true,
                        user: { id: 'anonymous', type: 'user' },
                        scopes: ['repo:read'],
                    };
                }
                // Allow fully anonymous if configured
                if (mergedOptions.allowAnonymous) {
                    return {
                        authenticated: true,
                        user: { id: 'anonymous', type: 'user' },
                        scopes: [],
                    };
                }
                // Authentication required
                const realm = mergedOptions.realm || provider.getRealm?.(context) || DEFAULT_REALM;
                return {
                    authenticated: false,
                    reason: 'Authentication required',
                    errorResponse: createUnauthorizedResponse(realm, 'Authentication required'),
                };
            }
            // Validate credentials
            const authResult = await provider.validateCredentials(credentials, context);
            if (!authResult.valid) {
                const realm = mergedOptions.realm || provider.getRealm?.(context) || DEFAULT_REALM;
                return {
                    authenticated: false,
                    reason: authResult.reason || 'Invalid credentials',
                    errorResponse: createUnauthorizedResponse(realm, authResult.reason || 'Invalid credentials'),
                };
            }
            // Check required scopes
            if (mergedOptions.requiredScopes && mergedOptions.requiredScopes.length > 0) {
                const hasRequiredScopes = mergedOptions.requiredScopes.every((scope) => authResult.scopes?.includes(scope));
                if (!hasRequiredScopes) {
                    const realm = mergedOptions.realm || provider.getRealm?.(context) || DEFAULT_REALM;
                    return {
                        authenticated: false,
                        reason: 'Insufficient permissions',
                        errorResponse: createUnauthorizedResponse(realm, 'Insufficient permissions'),
                    };
                }
            }
            return {
                authenticated: true,
                user: authResult.user,
                scopes: authResult.scopes,
            };
        },
        getProvider() {
            return provider;
        },
    };
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
export class MemoryAuthProvider {
    config;
    constructor(config = {}) {
        this.config = config;
    }
    async validateCredentials(credentials, _context) {
        if (credentials.type === 'anonymous') {
            return { valid: false, reason: 'Authentication required' };
        }
        if (credentials.type === 'basic') {
            return this.validateBasicCredentials(credentials.username, credentials.password);
        }
        if (credentials.type === 'bearer') {
            return this.validateBearerToken(credentials.token);
        }
        return { valid: false, reason: 'Unknown authentication type' };
    }
    validateBasicCredentials(username, password) {
        // Check if password is a token (token-as-password pattern)
        if (this.config.tokens && this.config.tokens[password]) {
            const tokenConfig = this.config.tokens[password];
            return {
                valid: true,
                user: {
                    id: tokenConfig.userId || username || 'token-user',
                    name: username || undefined,
                    metadata: tokenConfig.metadata,
                },
                scopes: tokenConfig.scopes || [],
            };
        }
        // Check username/password
        if (this.config.users && this.config.users[username]) {
            const userConfig = this.config.users[username];
            // Use constant-time comparison for password
            if (constantTimeCompare(password, userConfig.password)) {
                return {
                    valid: true,
                    user: {
                        id: username,
                        name: username,
                        metadata: userConfig.metadata,
                    },
                    scopes: userConfig.scopes || [],
                };
            }
        }
        return { valid: false, reason: 'Invalid username or password' };
    }
    validateBearerToken(token) {
        if (this.config.tokens && this.config.tokens[token]) {
            const tokenConfig = this.config.tokens[token];
            return {
                valid: true,
                user: {
                    id: tokenConfig.userId || 'token-user',
                    type: 'service',
                    metadata: tokenConfig.metadata,
                },
                scopes: tokenConfig.scopes || [],
            };
        }
        return { valid: false, reason: 'Invalid token' };
    }
    getRealm(_context) {
        return this.config.realm || DEFAULT_REALM;
    }
    /**
     * Add a user to the provider.
     *
     * @param username - Username
     * @param password - Password
     * @param scopes - Optional scopes
     */
    addUser(username, password, scopes) {
        if (!this.config.users) {
            this.config.users = {};
        }
        this.config.users[username] = { password, scopes };
    }
    /**
     * Add a token to the provider.
     *
     * @param token - Token string
     * @param userId - Associated user ID
     * @param scopes - Optional scopes
     */
    addToken(token, userId, scopes) {
        if (!this.config.tokens) {
            this.config.tokens = {};
        }
        this.config.tokens[token] = { userId, scopes };
    }
    /**
     * Remove a user from the provider.
     *
     * @param username - Username to remove
     */
    removeUser(username) {
        if (this.config.users) {
            delete this.config.users[username];
        }
    }
    /**
     * Remove a token from the provider.
     *
     * @param token - Token to remove
     */
    removeToken(token) {
        if (this.config.tokens) {
            delete this.config.tokens[token];
        }
    }
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
export class CallbackAuthProvider {
    callbacks;
    constructor(callbacks) {
        this.callbacks = callbacks;
    }
    async validateCredentials(credentials, context) {
        if (credentials.type === 'anonymous') {
            return { valid: false, reason: 'Authentication required' };
        }
        if (credentials.type === 'basic') {
            if (this.callbacks.validateBasic) {
                return this.callbacks.validateBasic(credentials.username, credentials.password, context);
            }
            return { valid: false, reason: 'Basic authentication not supported' };
        }
        if (credentials.type === 'bearer') {
            if (this.callbacks.validateBearer) {
                return this.callbacks.validateBearer(credentials.token, context);
            }
            return { valid: false, reason: 'Bearer authentication not supported' };
        }
        return { valid: false, reason: 'Unknown authentication type' };
    }
    getRealm(context) {
        if (this.callbacks.getRealm) {
            return this.callbacks.getRealm(context);
        }
        return DEFAULT_REALM;
    }
}
// ============================================================================
// Wrapper for RepositoryProvider
// ============================================================================
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
export function createAuthenticatedRepositoryProvider(provider, user, scopes) {
    return new Proxy(provider, {
        get(target, prop) {
            if (prop === 'hasPermission') {
                return async (service) => {
                    // Check base permission first
                    const basePermission = await target.hasPermission(service);
                    if (!basePermission) {
                        return false;
                    }
                    // If no user (anonymous), only allow if explicitly permitted
                    if (!user) {
                        return false;
                    }
                    // Check scopes for the service
                    if (scopes) {
                        if (service === 'git-upload-pack') {
                            return scopes.includes('repo:read') || scopes.includes('repo:*');
                        }
                        if (service === 'git-receive-pack') {
                            return scopes.includes('repo:write') || scopes.includes('repo:*');
                        }
                    }
                    // No scope restrictions or unknown service - allow
                    return true;
                };
            }
            return Reflect.get(target, prop);
        },
    });
}
export { parseAuthorizationHeader, encodeBasicAuth, encodeBearerAuth, createUnauthorizedResponse, constantTimeCompare, isAnonymous, isBasicAuth, isBearerAuth, DEFAULT_REALM, } from './auth';
//# sourceMappingURL=auth-middleware.js.map