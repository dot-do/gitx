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
// ============================================================================
// Constants
// ============================================================================
/** Cookie names to check for auth tokens */
const encoder = new TextEncoder();
const AUTH_COOKIE_NAMES = ['auth_token', 'session_token'];
/** Default session cache TTL (5 minutes) */
const DEFAULT_CACHE_TTL = 300000;
/** JWKS cache TTL (1 hour) */
const JWKS_CACHE_TTL = 3600000;
const jwksCache = new Map();
/**
 * Fetch and cache JWKS keys from the specified URL.
 */
async function fetchJWKS(jwksUrl) {
    const cached = jwksCache.get(jwksUrl);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < JWKS_CACHE_TTL) {
        return cached.keys;
    }
    try {
        const response = await fetch(jwksUrl, {
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
            throw new Error(`JWKS fetch failed: ${response.status} ${response.statusText}`);
        }
        const data = (await response.json());
        const keys = data.keys || [];
        jwksCache.set(jwksUrl, { keys, fetchedAt: now });
        return keys;
    }
    catch (error) {
        // If we have stale cache, use it on fetch failure
        if (cached) {
            return cached.keys;
        }
        throw error;
    }
}
// ============================================================================
// Token Extraction
// ============================================================================
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
export function extractToken(headers) {
    // Check Authorization header first (preferred)
    const authHeader = headers.get('Authorization');
    if (authHeader) {
        const trimmed = authHeader.trim();
        // Case-insensitive check for Bearer prefix
        if (trimmed.toLowerCase().startsWith('bearer ')) {
            const token = trimmed.slice(7).trim();
            return token || null;
        }
    }
    // Check cookies as fallback
    const cookieHeader = headers.get('Cookie');
    if (cookieHeader) {
        const cookies = parseCookies(cookieHeader);
        for (const name of AUTH_COOKIE_NAMES) {
            const token = cookies[name];
            if (token) {
                return token;
            }
        }
    }
    return null;
}
/**
 * Parse cookie header into key-value pairs.
 */
function parseCookies(cookieHeader) {
    const cookies = {};
    for (const pair of cookieHeader.split(';')) {
        const [key, ...valueParts] = pair.split('=');
        if (key) {
            const trimmedKey = key.trim();
            const value = valueParts.join('=').trim();
            if (trimmedKey && value) {
                cookies[trimmedKey] = value;
            }
        }
    }
    return cookies;
}
// ============================================================================
// JWT Verification
// ============================================================================
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
export async function verifyJWT(token, options) {
    // Handle empty token
    if (!token || token.trim() === '') {
        return { valid: false, error: 'Token is empty' };
    }
    // Split JWT into parts
    const parts = token.split('.');
    if (parts.length !== 3) {
        return { valid: false, error: 'Token is malformed: invalid segment count' };
    }
    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) {
        return { valid: false, error: 'Token is malformed: missing segments' };
    }
    // Decode header
    let header;
    try {
        header = JSON.parse(base64UrlDecode(headerB64));
    }
    catch {
        return { valid: false, error: 'Token is malformed: invalid header encoding' };
    }
    // Decode payload
    let payload;
    try {
        payload = JSON.parse(base64UrlDecode(payloadB64));
    }
    catch {
        return { valid: false, error: 'Token is malformed: invalid payload encoding' };
    }
    const now = Math.floor(Date.now() / 1000);
    // Check expiration
    if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Token has expired' };
    }
    // Check not before
    if ('nbf' in payload && typeof payload.nbf === 'number') {
        if (payload.nbf > now + 60) {
            // Allow 60 seconds clock skew
            return { valid: false, error: 'Token is not yet valid (nbf claim)' };
        }
    }
    // Check issued at (not in the future)
    if (payload.iat && payload.iat > now + 60) {
        // Allow 60 seconds clock skew
        return { valid: false, error: 'Token was issued in the future (iat claim)' };
    }
    // Check audience
    if (options.audience) {
        const aud = payload.aud;
        const audienceValid = Array.isArray(aud)
            ? aud.includes(options.audience)
            : aud === options.audience;
        if (!audienceValid) {
            return { valid: false, error: 'Token has invalid audience claim' };
        }
    }
    // Check issuer
    if (options.issuer && payload.iss !== options.issuer) {
        return { valid: false, error: 'Token has invalid issuer claim' };
    }
    // Fetch JWKS and verify signature
    try {
        const keys = await fetchJWKS(options.jwksUrl);
        // Find matching key
        const key = findMatchingKey(keys, header);
        if (!key) {
            return { valid: false, error: 'No matching key found for signature verification' };
        }
        // Verify signature (headerB64 and payloadB64 are guaranteed to be defined at this point)
        const signatureValid = await verifySignature(`${headerB64}.${payloadB64}`, signatureB64, key, header.alg);
        if (!signatureValid) {
            return { valid: false, error: 'Token has invalid signature' };
        }
        return { valid: true, payload };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { valid: false, error: `Verification failed: ${message}` };
    }
}
/**
 * Base64URL decode a string.
 */
function base64UrlDecode(str) {
    // Replace URL-safe chars with standard base64 chars
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    const padding = base64.length % 4;
    if (padding) {
        base64 += '='.repeat(4 - padding);
    }
    return atob(base64);
}
/**
 * Find a matching JWK for the JWT header.
 */
function findMatchingKey(keys, header) {
    // If kid is specified, find exact match
    if (header.kid) {
        const keyById = keys.find((k) => k.kid === header.kid);
        if (keyById)
            return keyById;
    }
    // Find key by algorithm compatibility
    const algFamily = header.alg.slice(0, 2); // RS, ES, PS, HS
    return (keys.find((k) => {
        // Check key type matches algorithm
        if (algFamily === 'RS' || algFamily === 'PS')
            return k.kty === 'RSA';
        if (algFamily === 'ES')
            return k.kty === 'EC';
        return false;
    }) || null);
}
/**
 * Verify JWT signature using Web Crypto API.
 */
async function verifySignature(data, signatureB64, key, algorithm) {
    try {
        const dataBuffer = encoder.encode(data);
        // Decode signature from base64url
        let signatureB64Standard = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
        const padding = signatureB64Standard.length % 4;
        if (padding) {
            signatureB64Standard += '='.repeat(4 - padding);
        }
        const signatureBuffer = Uint8Array.from(atob(signatureB64Standard), (c) => c.charCodeAt(0));
        // Import the key
        const cryptoKey = await importKey(key, algorithm);
        // Get algorithm parameters
        const algParams = getAlgorithmParams(algorithm);
        // Verify
        return await crypto.subtle.verify(algParams, cryptoKey, signatureBuffer, dataBuffer);
    }
    catch {
        return false;
    }
}
/**
 * Import a JWK as a CryptoKey.
 */
async function importKey(jwk, algorithm) {
    const algParams = getAlgorithmParams(algorithm);
    const keyData = {
        kty: jwk.kty,
        alg: algorithm,
    };
    if (jwk.n !== undefined)
        keyData.n = jwk.n;
    if (jwk.e !== undefined)
        keyData.e = jwk.e;
    if (jwk.x !== undefined)
        keyData.x = jwk.x;
    if (jwk.y !== undefined)
        keyData.y = jwk.y;
    if (jwk.crv !== undefined)
        keyData.crv = jwk.crv;
    return crypto.subtle.importKey('jwk', keyData, algParams, false, ['verify']);
}
/**
 * Get Web Crypto algorithm parameters for a JWT algorithm.
 */
function getAlgorithmParams(algorithm) {
    switch (algorithm) {
        case 'RS256':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
        case 'RS384':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' };
        case 'RS512':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' };
        case 'ES256':
            return { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
        case 'ES384':
            return { name: 'ECDSA', namedCurve: 'P-384', hash: 'SHA-384' };
        case 'ES512':
            return { name: 'ECDSA', namedCurve: 'P-521', hash: 'SHA-512' };
        case 'PS256':
            return {
                name: 'RSA-PSS',
                hash: 'SHA-256',
                saltLength: 32,
            };
        case 'PS384':
            return {
                name: 'RSA-PSS',
                hash: 'SHA-384',
                saltLength: 48,
            };
        case 'PS512':
            return {
                name: 'RSA-PSS',
                hash: 'SHA-512',
                saltLength: 64,
            };
        default:
            throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
}
// ============================================================================
// Session Cache Implementation
// ============================================================================
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
export class InMemorySessionCache {
    store = new Map();
    get(token) {
        const entry = this.store.get(token);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(token);
            return null;
        }
        return entry.context;
    }
    set(token, context, ttl = DEFAULT_CACHE_TTL) {
        this.store.set(token, {
            context,
            expiresAt: Date.now() + ttl,
        });
    }
    delete(token) {
        this.store.delete(token);
    }
    clear() {
        this.store.clear();
    }
}
// ============================================================================
// Scope Utilities
// ============================================================================
/**
 * Parse scopes from JWT payload to GitScopes.
 *
 * @description
 * Extracts and normalizes git-specific scopes from the JWT payload.
 * Handles both simple scopes (git:read) and repository-specific scopes (git:read:owner/repo).
 */
export function parseGitScopes(scopes) {
    if (!scopes || !Array.isArray(scopes)) {
        return [];
    }
    const gitScopes = [];
    const validScopes = ['git:read', 'git:push', 'git:admin'];
    for (const scope of scopes) {
        // Check for exact match
        if (validScopes.includes(scope)) {
            gitScopes.push(scope);
        }
        // Check for repository-scoped permissions (e.g., git:read:owner/repo)
        else if (scope.startsWith('git:')) {
            const parts = scope.split(':');
            if (parts.length >= 2) {
                const baseScope = `git:${parts[1]}`;
                if (validScopes.includes(baseScope) && !gitScopes.includes(baseScope)) {
                    gitScopes.push(baseScope);
                }
            }
        }
    }
    return gitScopes;
}
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
export function hasScope(scopes, required) {
    // Admin has all permissions
    if (scopes.includes('git:admin')) {
        return true;
    }
    // Direct match
    if (scopes.includes(required)) {
        return true;
    }
    // git:push implies git:read
    if (required === 'git:read' && scopes.includes('git:push')) {
        return true;
    }
    return false;
}
/**
 * Check if scopes allow a git operation.
 *
 * @param scopes - User's scopes
 * @param operation - Git operation type
 * @returns true if operation is allowed
 */
export function canPerformOperation(scopes, operation) {
    switch (operation) {
        case 'fetch':
        case 'clone':
            return hasScope(scopes, 'git:read');
        case 'push':
            return hasScope(scopes, 'git:push');
        case 'manage_permissions':
        case 'update_settings':
            return hasScope(scopes, 'git:admin');
        default:
            return false;
    }
}
// ============================================================================
// Hono Middleware
// ============================================================================
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
export function createOAuthMiddleware(options) {
    const cache = options.cache ?? new InMemorySessionCache();
    return async (c, next) => {
        // Extract token
        const token = extractToken(c.req.raw.headers);
        if (!token) {
            return c.json({ error: 'Authentication required' }, {
                status: 401,
                headers: { 'WWW-Authenticate': 'Bearer realm="gitx.do"' },
            });
        }
        // Check cache first
        let context = cache.get(token);
        if (!context) {
            // Verify JWT
            const verifyOptions = {
                jwksUrl: options.jwksUrl,
            };
            if (options.audience !== undefined)
                verifyOptions.audience = options.audience;
            if (options.issuer !== undefined)
                verifyOptions.issuer = options.issuer;
            const result = await verifyJWT(token, verifyOptions);
            if (!result.valid || !result.payload) {
                return c.json({ error: result.error || 'Invalid token' }, {
                    status: 401,
                    headers: { 'WWW-Authenticate': 'Bearer realm="gitx.do"' },
                });
            }
            // Build context from payload
            context = {
                userId: result.payload.sub,
                scopes: parseGitScopes(result.payload.scopes),
                token,
                expiresAt: result.payload.exp * 1000,
            };
            if (result.payload.email !== undefined)
                context.email = result.payload.email;
            if (result.payload.name !== undefined)
                context.name = result.payload.name;
            // Cache the session
            const ttl = Math.min(result.payload.exp * 1000 - Date.now(), DEFAULT_CACHE_TTL);
            if (ttl > 0) {
                cache.set(token, context, ttl);
            }
        }
        // Check required scopes
        if (options.requiredScopes?.length && context) {
            for (const required of options.requiredScopes) {
                if (!hasScope(context.scopes, required)) {
                    return c.json({ error: `Insufficient permissions: requires ${required} scope` }, 403);
                }
            }
        }
        // Set context values for downstream handlers
        c.set('userId', context.userId);
        c.set('email', context.email);
        c.set('name', context.name);
        c.set('scopes', context.scopes);
        c.set('token', context.token);
        c.set('expiresAt', context.expiresAt);
        c.set('oauthContext', context);
        await next();
    };
}
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
export function requireScope(requiredScope) {
    return async (c, next) => {
        const scopes = c.get('scopes');
        if (!scopes) {
            return c.json({ error: 'Authentication required' }, {
                status: 401,
                headers: { 'WWW-Authenticate': 'Bearer realm="gitx.do"' },
            });
        }
        if (!hasScope(scopes, requiredScope)) {
            return c.json({ error: `Forbidden: requires ${requiredScope} scope` }, 403);
        }
        await next();
    };
}
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
export function shouldRefreshToken(expiresAt, thresholdSeconds = 600) {
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = expiresAt - now;
    return timeUntilExpiry < thresholdSeconds;
}
//# sourceMappingURL=oauth.js.map