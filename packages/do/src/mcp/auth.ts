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

import type { MiddlewareHandler, Context, Next } from 'hono'
import type { GitAuthContext, GitAuthConfig } from './types'

// Re-export types for convenience
export type { GitAuthContext, GitAuthConfig } from './types'

/**
 * Extend Hono's ContextVariableMap with gitAuth
 */
declare module 'hono' {
  interface ContextVariableMap {
    gitAuth: GitAuthContext
  }
}

/**
 * OAuth 2.0 Token Introspection Response (RFC 7662)
 */
interface IntrospectionResponse {
  active: boolean
  sub?: string
  client_id?: string
  scope?: string
  exp?: number
  iat?: number
  iss?: string
  aud?: string | string[]
  [key: string]: unknown
}

/**
 * Anonymous context for unauthenticated access
 */
const ANONYMOUS_CONTEXT: GitAuthContext = {
  type: 'anon',
  id: 'anonymous',
  readonly: true,
}

/**
 * Parse scope string to check for specific scopes
 */
function parseScopes(scope?: string): Set<string> {
  if (!scope) return new Set()
  return new Set(scope.split(' ').filter(Boolean))
}

/**
 * Determine if context should be readonly based on scopes
 */
function isReadonlyScope(scopes: Set<string>): boolean {
  // Has explicit write scope
  if (scopes.has('write') || scopes.has('git:write')) {
    return false
  }
  // Has admin scope (implies write)
  if (scopes.has('admin') || scopes.has('git:admin')) {
    return false
  }
  // Check for any scope ending in :write or :admin
  for (const scope of scopes) {
    if (scope.endsWith(':write') || scope.endsWith(':admin')) {
      return false
    }
  }
  // Default to readonly
  return true
}

/**
 * Check if scopes include admin access
 */
function hasAdminScope(scopes: Set<string>): boolean {
  if (scopes.has('admin') || scopes.has('git:admin')) return true
  for (const scope of scopes) {
    if (scope.endsWith(':admin')) {
      return true
    }
  }
  return false
}

/**
 * Perform OAuth 2.0 token introspection
 */
async function introspectToken(
  token: string,
  config: GitAuthConfig
): Promise<IntrospectionResponse | null> {
  if (!config.introspectionUrl) {
    return null
  }

  const body = new URLSearchParams()
  body.set('token', token)

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }

  // Add client authentication if provided
  if (config.clientId && config.clientSecret) {
    const credentials = btoa(`${config.clientId}:${config.clientSecret}`)
    headers['Authorization'] = `Basic ${credentials}`
  }

  try {
    const response = await fetch(config.introspectionUrl, {
      method: 'POST',
      headers,
      body,
    })

    if (!response.ok) {
      return null
    }

    return await response.json() as IntrospectionResponse
  } catch {
    return null
  }
}

/**
 * Create GitAuthContext from introspection response
 */
function createAuthContext(response: IntrospectionResponse): GitAuthContext {
  const scopes = parseScopes(response.scope)
  const readonly = isReadonlyScope(scopes)
  const isAdmin = hasAdminScope(scopes)

  const id = response.sub ?? response.client_id ?? 'unknown'

  const metadata: Record<string, unknown> = {}
  if (response.scope) metadata.scope = response.scope
  if (response.exp) metadata.exp = response.exp
  if (response.iat) metadata.iat = response.iat
  if (response.client_id) metadata.client_id = response.client_id
  if (response.iss) metadata.iss = response.iss

  return {
    type: 'oauth',
    id,
    readonly,
    isAdmin: isAdmin || undefined,
    scopes,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  }
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null
  }

  return parts[1]
}

/**
 * Create authentication middleware for Hono
 */
export function gitAuthMiddleware(config: GitAuthConfig): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const token = extractBearerToken(c.req.raw)

    // No token provided
    if (!token) {
      if (config.allowAnonymous) {
        const anonContext: GitAuthContext = {
          ...ANONYMOUS_CONTEXT,
          readonly: config.anonymousReadonly !== false,
        }
        c.set('gitAuth', anonContext)
        await next()
        return
      }

      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
      )
    }

    // Try API key verification if configured
    if (config.verifyApiKey) {
      const apiKeyContext = await config.verifyApiKey(token)
      if (apiKeyContext) {
        c.set('gitAuth', apiKeyContext)
        await next()
        return
      }
    }

    // Try OAuth token introspection
    if (config.introspectionUrl) {
      const introspection = await introspectToken(token, config)

      if (introspection?.active) {
        const authContext = createAuthContext(introspection)
        c.set('gitAuth', authContext)
        await next()
        return
      }
    }

    // Token invalid or expired
    return c.json(
      { error: { code: 'INVALID_TOKEN', message: 'Token is invalid or expired' } },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } }
    )
  }
}

/**
 * Middleware that requires authentication
 */
export function requireGitAuth(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('gitAuth')

    if (!auth || auth.type === 'anon') {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
      )
    }

    await next()
  }
}

/**
 * Middleware that requires write access
 */
export function requireGitWrite(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('gitAuth')

    if (!auth || auth.readonly) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Write access required' } },
        { status: 403 }
      )
    }

    await next()
  }
}

/**
 * Middleware that requires admin access
 */
export function requireGitAdmin(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('gitAuth')

    if (!auth || auth.type === 'anon') {
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
      )
    }

    if (!auth.isAdmin) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
        { status: 403 }
      )
    }

    await next()
  }
}

/**
 * Authenticate a standalone request (for non-Hono use)
 */
export async function authenticateRequest(
  request: Request,
  config: GitAuthConfig
): Promise<{ success: true; context: GitAuthContext } | { success: false; error: string }> {
  const token = extractBearerToken(request)

  if (!token) {
    if (config.allowAnonymous) {
      return {
        success: true,
        context: {
          ...ANONYMOUS_CONTEXT,
          readonly: config.anonymousReadonly !== false,
        },
      }
    }
    return { success: false, error: 'Authentication required' }
  }

  // Try API key
  if (config.verifyApiKey) {
    const context = await config.verifyApiKey(token)
    if (context) {
      return { success: true, context }
    }
  }

  // Try OAuth
  if (config.introspectionUrl) {
    const introspection = await introspectToken(token, config)
    if (introspection?.active) {
      return { success: true, context: createAuthContext(introspection) }
    }
  }

  return { success: false, error: 'Invalid or expired token' }
}
