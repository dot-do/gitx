/**
 * @fileoverview Git HTTP Authentication Layer
 *
 * This module implements authentication for Git HTTP protocol operations (push/pull).
 * It supports:
 * - Basic authentication (username/password or token)
 * - Bearer token authentication
 *
 * @module wire/auth
 *
 * ## Authentication Flow
 *
 * 1. Client sends request with Authorization header
 * 2. Server extracts and parses credentials
 * 3. Server validates credentials via AuthProvider
 * 4. If valid, request proceeds; if invalid, 401 Unauthorized is returned
 *
 * ## Security Considerations
 *
 * - Always use HTTPS in production to protect credentials in transit
 * - Credentials should be validated against a secure credential store
 * - Consider rate limiting to prevent brute force attacks
 * - Use constant-time comparison for credential validation
 *
 * @see {@link https://git-scm.com/docs/http-protocol} Git HTTP Protocol
 * @see {@link https://datatracker.ietf.org/doc/html/rfc7617} HTTP Basic Authentication
 * @see {@link https://datatracker.ietf.org/doc/html/rfc6750} OAuth Bearer Token
 *
 * @example Basic usage with middleware
 * ```typescript
 * import { createAuthMiddleware, BasicCredentials, BearerCredentials } from './wire/auth'
 *
 * const authProvider: AuthProvider = {
 *   async validateCredentials(credentials, context) {
 *     if (credentials.type === 'basic') {
 *       return validateBasicAuth(credentials.username, credentials.password)
 *     }
 *     if (credentials.type === 'bearer') {
 *       return validateToken(credentials.token)
 *     }
 *     return { valid: false, reason: 'Unknown auth type' }
 *   }
 * }
 *
 * const middleware = createAuthMiddleware(authProvider)
 * const result = await middleware(request, context)
 * ```
 */
const encoder = new TextEncoder();
// ============================================================================
// Constants
// ============================================================================
/** Default realm for WWW-Authenticate header */
export const DEFAULT_REALM = 'Git';
/** WWW-Authenticate header for Basic auth challenge */
export const WWW_AUTHENTICATE_BASIC = (realm) => `Basic realm="${realm}"`;
/** WWW-Authenticate header for Bearer auth challenge */
export const WWW_AUTHENTICATE_BEARER = (realm) => `Bearer realm="${realm}"`;
// ============================================================================
// Credential Parsing
// ============================================================================
/**
 * Parse credentials from Authorization header.
 *
 * @description
 * Extracts and parses credentials from the HTTP Authorization header.
 * Supports Basic and Bearer authentication schemes.
 *
 * @param authorizationHeader - The Authorization header value
 * @returns Parsed credentials or AnonymousCredentials if no/invalid header
 *
 * @example
 * ```typescript
 * // Basic auth
 * const basic = parseAuthorizationHeader('Basic dXNlcjpwYXNz')
 * // { type: 'basic', username: 'user', password: 'pass' }
 *
 * // Bearer token
 * const bearer = parseAuthorizationHeader('Bearer eyJhbGc...')
 * // { type: 'bearer', token: 'eyJhbGc...' }
 *
 * // No auth
 * const anon = parseAuthorizationHeader(undefined)
 * // { type: 'anonymous' }
 * ```
 */
export function parseAuthorizationHeader(authorizationHeader) {
    if (!authorizationHeader || authorizationHeader.trim() === '') {
        return { type: 'anonymous' };
    }
    const trimmed = authorizationHeader.trim();
    // Check for Basic auth
    if (trimmed.toLowerCase().startsWith('basic ')) {
        return parseBasicAuth(trimmed.slice(6));
    }
    // Check for Bearer auth
    if (trimmed.toLowerCase().startsWith('bearer ')) {
        return parseBearerAuth(trimmed.slice(7));
    }
    // Unknown auth scheme - treat as anonymous
    return { type: 'anonymous' };
}
/**
 * Parse Basic authentication credentials.
 *
 * @param encoded - Base64 encoded credentials (without 'Basic ' prefix)
 * @returns Parsed BasicCredentials or AnonymousCredentials on parse error
 *
 * @internal
 */
function parseBasicAuth(encoded) {
    try {
        const decoded = atob(encoded.trim());
        const colonIndex = decoded.indexOf(':');
        if (colonIndex === -1) {
            // No colon found - treat entire string as username with empty password
            // This is a valid but unusual case
            return {
                type: 'basic',
                username: decoded,
                password: '',
            };
        }
        return {
            type: 'basic',
            username: decoded.slice(0, colonIndex),
            password: decoded.slice(colonIndex + 1),
        };
    }
    catch {
        // Invalid base64 - return anonymous
        return { type: 'anonymous' };
    }
}
/**
 * Parse Bearer authentication token.
 *
 * @param token - Bearer token (without 'Bearer ' prefix)
 * @returns Parsed BearerCredentials or AnonymousCredentials if empty
 *
 * @internal
 */
function parseBearerAuth(token) {
    const trimmedToken = token.trim();
    if (trimmedToken === '') {
        return { type: 'anonymous' };
    }
    return {
        type: 'bearer',
        token: trimmedToken,
    };
}
// ============================================================================
// Credential Encoding (for clients)
// ============================================================================
/**
 * Encode Basic authentication credentials.
 *
 * @description
 * Creates a properly formatted Authorization header value for Basic auth.
 *
 * @param username - Username
 * @param password - Password or token
 * @returns Authorization header value (e.g., 'Basic dXNlcjpwYXNz')
 *
 * @example
 * ```typescript
 * const header = encodeBasicAuth('user', 'pass')
 * // 'Basic dXNlcjpwYXNz'
 * ```
 */
export function encodeBasicAuth(username, password) {
    const credentials = `${username}:${password}`;
    return `Basic ${btoa(credentials)}`;
}
/**
 * Encode Bearer token for Authorization header.
 *
 * @param token - Bearer token
 * @returns Authorization header value (e.g., 'Bearer eyJhbGc...')
 *
 * @example
 * ```typescript
 * const header = encodeBearerAuth('my-token')
 * // 'Bearer my-token'
 * ```
 */
export function encodeBearerAuth(token) {
    return `Bearer ${token}`;
}
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Check if credentials are anonymous.
 *
 * @param credentials - Credentials to check
 * @returns true if credentials are anonymous
 */
export function isAnonymous(credentials) {
    return credentials.type === 'anonymous';
}
/**
 * Check if credentials are Basic auth.
 *
 * @param credentials - Credentials to check
 * @returns true if credentials are Basic auth
 */
export function isBasicAuth(credentials) {
    return credentials.type === 'basic';
}
/**
 * Check if credentials are Bearer token.
 *
 * @param credentials - Credentials to check
 * @returns true if credentials are Bearer token
 */
export function isBearerAuth(credentials) {
    return credentials.type === 'bearer';
}
/**
 * Create a 401 Unauthorized response.
 *
 * @description
 * Creates an HTTP 401 response with appropriate WWW-Authenticate header.
 *
 * @param realm - Authentication realm
 * @param message - Error message for response body
 * @param supportedSchemes - Authentication schemes to advertise
 * @returns Response object ready to send to client
 *
 * @example
 * ```typescript
 * const response = createUnauthorizedResponse(
 *   'Git Repository',
 *   'Authentication required',
 *   ['basic', 'bearer']
 * )
 * ```
 */
export function createUnauthorizedResponse(realm = DEFAULT_REALM, message = 'Authentication required', supportedSchemes = ['basic', 'bearer']) {
    // Build WWW-Authenticate header with all supported schemes
    const wwwAuthenticate = supportedSchemes
        .map((scheme) => {
        if (scheme === 'basic') {
            return WWW_AUTHENTICATE_BASIC(realm);
        }
        return WWW_AUTHENTICATE_BEARER(realm);
    })
        .join(', ');
    return {
        status: 401,
        statusText: 'Unauthorized',
        headers: {
            'Content-Type': 'text/plain',
            'WWW-Authenticate': wwwAuthenticate,
        },
        body: encoder.encode(message),
    };
}
/**
 * Constant-time string comparison.
 *
 * @description
 * Compares two strings in constant time to prevent timing attacks.
 * Should be used when comparing sensitive values like passwords or tokens.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal
 *
 * @example
 * ```typescript
 * if (constantTimeCompare(providedPassword, storedHash)) {
 *   // Valid password
 * }
 * ```
 */
export function constantTimeCompare(a, b) {
    const maxLen = Math.max(a.length, b.length);
    let result = a.length ^ b.length;
    for (let i = 0; i < maxLen; i++) {
        result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return result === 0;
}
//# sourceMappingURL=auth.js.map