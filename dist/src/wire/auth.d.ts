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
/**
 * Authentication type supported by the Git HTTP protocol.
 *
 * @description
 * - `basic`: HTTP Basic Authentication (RFC 7617)
 * - `bearer`: OAuth 2.0 Bearer Token (RFC 6750)
 * - `anonymous`: No authentication provided
 */
export type AuthType = 'basic' | 'bearer' | 'anonymous';
/**
 * Basic authentication credentials.
 *
 * @description
 * HTTP Basic Authentication uses a username and password (or token).
 * The credentials are base64 encoded in the Authorization header:
 * `Authorization: Basic <base64(username:password)>`
 *
 * For token-based basic auth, the token can be used as either:
 * - Username with empty password (GitHub style)
 * - Password with 'x-token-auth' or empty username (GitLab style)
 *
 * @example
 * ```typescript
 * const credentials: BasicCredentials = {
 *   type: 'basic',
 *   username: 'user@example.com',
 *   password: 'ghp_xxxxxxxxxxxx'
 * }
 * ```
 */
export interface BasicCredentials {
    /** Authentication type identifier */
    type: 'basic';
    /** Username (may be empty for token-only auth) */
    username: string;
    /** Password or access token */
    password: string;
}
/**
 * Bearer token credentials.
 *
 * @description
 * OAuth 2.0 Bearer Token authentication uses a token in the Authorization header:
 * `Authorization: Bearer <token>`
 *
 * @example
 * ```typescript
 * const credentials: BearerCredentials = {
 *   type: 'bearer',
 *   token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
 * }
 * ```
 */
export interface BearerCredentials {
    /** Authentication type identifier */
    type: 'bearer';
    /** Bearer token (JWT, OAuth token, API key, etc.) */
    token: string;
}
/**
 * Anonymous (no authentication) credentials.
 *
 * @description
 * Represents a request with no Authorization header.
 * May be allowed for public repositories or read-only access.
 */
export interface AnonymousCredentials {
    /** Authentication type identifier */
    type: 'anonymous';
}
/**
 * Union type for all credential types.
 */
export type Credentials = BasicCredentials | BearerCredentials | AnonymousCredentials;
/**
 * Authentication context with request metadata.
 *
 * @description
 * Contains information about the request context that may be needed
 * for authentication decisions (e.g., repository name, operation type).
 */
export interface AuthContext {
    /** Repository identifier/name being accessed */
    repository: string;
    /** Git service being accessed */
    service: 'git-upload-pack' | 'git-receive-pack';
    /** Client IP address (if available) */
    clientIp?: string;
    /** User agent string (if available) */
    userAgent?: string;
    /** Request path */
    path: string;
    /** HTTP method */
    method: string;
}
/**
 * Result of credential validation.
 *
 * @description
 * Contains the validation result and optional user information
 * that can be used for authorization decisions.
 */
export interface AuthResult {
    /** Whether the credentials are valid */
    valid: boolean;
    /** Reason for authentication failure (if not valid) */
    reason?: string;
    /** Authenticated user/identity information (if valid) */
    user?: AuthenticatedUser;
    /** Scopes/permissions granted to this authentication (if valid) */
    scopes?: string[];
}
/**
 * Authenticated user information.
 *
 * @description
 * Information about the authenticated user/identity.
 * This can be used for logging, authorization, and auditing.
 */
export interface AuthenticatedUser {
    /** User identifier (unique within the auth system) */
    id: string;
    /** Display name (may be username, email, or service account name) */
    name?: string;
    /** Email address (if available) */
    email?: string;
    /** Type of identity (user, bot, service account, etc.) */
    type?: 'user' | 'bot' | 'service' | 'deploy-key';
    /** Additional metadata about the user */
    metadata?: Record<string, unknown>;
}
/**
 * Authentication provider interface.
 *
 * @description
 * Implementations of this interface handle the actual credential validation.
 * This could validate against a database, external auth service, JWT tokens, etc.
 *
 * @example
 * ```typescript
 * class DatabaseAuthProvider implements AuthProvider {
 *   async validateCredentials(credentials, context) {
 *     if (credentials.type === 'basic') {
 *       const user = await db.users.findByUsername(credentials.username)
 *       if (user && await verifyPassword(credentials.password, user.hash)) {
 *         return { valid: true, user: { id: user.id, name: user.name } }
 *       }
 *     }
 *     return { valid: false, reason: 'Invalid credentials' }
 *   }
 * }
 * ```
 */
export interface AuthProvider {
    /**
     * Validate credentials and return authentication result.
     *
     * @param credentials - The credentials to validate
     * @param context - Request context information
     * @returns Promise resolving to authentication result
     */
    validateCredentials(credentials: Credentials, context: AuthContext): Promise<AuthResult>;
    /**
     * Optional: Get authentication realm for WWW-Authenticate header.
     *
     * @param context - Request context information
     * @returns Realm string for the WWW-Authenticate header
     */
    getRealm?(context: AuthContext): string;
}
/**
 * Authentication options.
 *
 * @description
 * Configuration options for the authentication middleware.
 */
export interface AuthOptions {
    /** Allow anonymous access (no auth required) */
    allowAnonymous?: boolean;
    /** Allow anonymous for read operations only (git-upload-pack) */
    allowAnonymousRead?: boolean;
    /** Custom realm for WWW-Authenticate header */
    realm?: string;
    /** Required scopes for this operation */
    requiredScopes?: string[];
}
/** Default realm for WWW-Authenticate header */
export declare const DEFAULT_REALM = "Git";
/** WWW-Authenticate header for Basic auth challenge */
export declare const WWW_AUTHENTICATE_BASIC: (realm: string) => string;
/** WWW-Authenticate header for Bearer auth challenge */
export declare const WWW_AUTHENTICATE_BEARER: (realm: string) => string;
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
export declare function parseAuthorizationHeader(authorizationHeader: string | undefined | null): Credentials;
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
export declare function encodeBasicAuth(username: string, password: string): string;
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
export declare function encodeBearerAuth(token: string): string;
/**
 * Check if credentials are anonymous.
 *
 * @param credentials - Credentials to check
 * @returns true if credentials are anonymous
 */
export declare function isAnonymous(credentials: Credentials): credentials is AnonymousCredentials;
/**
 * Check if credentials are Basic auth.
 *
 * @param credentials - Credentials to check
 * @returns true if credentials are Basic auth
 */
export declare function isBasicAuth(credentials: Credentials): credentials is BasicCredentials;
/**
 * Check if credentials are Bearer token.
 *
 * @param credentials - Credentials to check
 * @returns true if credentials are Bearer token
 */
export declare function isBearerAuth(credentials: Credentials): credentials is BearerCredentials;
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
export declare function createUnauthorizedResponse(realm?: string, message?: string, supportedSchemes?: ('basic' | 'bearer')[]): {
    status: 401;
    statusText: 'Unauthorized';
    headers: Record<string, string>;
    body: Uint8Array;
};
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
export declare function constantTimeCompare(a: string, b: string): boolean;
//# sourceMappingURL=auth.d.ts.map