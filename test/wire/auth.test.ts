import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Credential parsing/encoding
  parseAuthorizationHeader,
  encodeBasicAuth,
  encodeBearerAuth,
  // Response helpers
  createUnauthorizedResponse,
  // Type guards
  isAnonymous,
  isBasicAuth,
  isBearerAuth,
  // Utilities
  constantTimeCompare,
  // Constants
  DEFAULT_REALM,
  // Types
  type BasicCredentials,
  type BearerCredentials,
  type AnonymousCredentials,
  type Credentials,
  type AuthContext,
  type AuthResult,
  type AuthProvider,
} from '../../src/wire/auth'

import {
  // Middleware factory
  createAuthMiddleware,
  // Built-in providers
  MemoryAuthProvider,
  CallbackAuthProvider,
  // Repository wrapper
  createAuthenticatedRepositoryProvider,
  type AuthMiddleware,
  type AuthenticationResult,
} from '../../src/wire/auth-middleware'

import type { SmartHTTPRequest, GitService, RepositoryProvider } from '../../src/wire/smart-http'

// ============================================================================
// Test Helpers
// ============================================================================

const decoder = new TextDecoder()

function createTestAuthContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    repository: 'test-repo',
    service: 'git-upload-pack',
    path: '/info/refs',
    method: 'GET',
    ...overrides,
  }
}

function createTestRequest(overrides: Partial<SmartHTTPRequest> = {}): SmartHTTPRequest {
  return {
    method: 'GET',
    path: '/info/refs',
    query: { service: 'git-upload-pack' },
    headers: {},
    repository: 'test-repo',
    ...overrides,
  }
}

// ============================================================================
// Credential Parsing Tests
// ============================================================================

describe('parseAuthorizationHeader', () => {
  describe('Basic Authentication', () => {
    it('should parse valid Basic auth header with username and password', () => {
      // Basic dXNlcm5hbWU6cGFzc3dvcmQ= = base64(username:password)
      const header = 'Basic dXNlcm5hbWU6cGFzc3dvcmQ='
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('basic')
      expect((result as BasicCredentials).username).toBe('username')
      expect((result as BasicCredentials).password).toBe('password')
    })

    it('should parse Basic auth with empty password', () => {
      // Basic dXNlcm5hbWU6 = base64(username:)
      const header = 'Basic dXNlcm5hbWU6'
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('basic')
      expect((result as BasicCredentials).username).toBe('username')
      expect((result as BasicCredentials).password).toBe('')
    })

    it('should parse Basic auth with empty username (token-as-password)', () => {
      // Basic OnRva2VuMTIz = base64(:token123)
      const header = 'Basic OnRva2VuMTIz'
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('basic')
      expect((result as BasicCredentials).username).toBe('')
      expect((result as BasicCredentials).password).toBe('token123')
    })

    it('should parse Basic auth with password containing colons', () => {
      // Base64 of "user:pass:with:colons"
      const header = `Basic ${btoa('user:pass:with:colons')}`
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('basic')
      expect((result as BasicCredentials).username).toBe('user')
      expect((result as BasicCredentials).password).toBe('pass:with:colons')
    })

    it('should handle case-insensitive scheme', () => {
      const header = 'BASIC dXNlcjpwYXNz'
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('basic')
      expect((result as BasicCredentials).username).toBe('user')
    })

    it('should handle lowercase scheme', () => {
      const header = 'basic dXNlcjpwYXNz'
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('basic')
    })

    it('should handle mixed case scheme', () => {
      const header = 'BaSiC dXNlcjpwYXNz'
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('basic')
    })

    it('should handle whitespace around header', () => {
      const header = '  Basic dXNlcjpwYXNz  '
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('basic')
      expect((result as BasicCredentials).username).toBe('user')
    })

    it('should return anonymous for invalid base64', () => {
      const header = 'Basic not-valid-base64!!!'
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('anonymous')
    })

    it('should handle no colon in decoded string', () => {
      // Base64 of "usernameonly"
      const header = `Basic ${btoa('usernameonly')}`
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('basic')
      expect((result as BasicCredentials).username).toBe('usernameonly')
      expect((result as BasicCredentials).password).toBe('')
    })

    it('should handle special characters in username and password', () => {
      const header = `Basic ${btoa('user@example.com:p@$$w0rd!')}`
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('basic')
      expect((result as BasicCredentials).username).toBe('user@example.com')
      expect((result as BasicCredentials).password).toBe('p@$$w0rd!')
    })
  })

  describe('Bearer Authentication', () => {
    it('should parse valid Bearer token header', () => {
      const header = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0'
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('bearer')
      expect((result as BearerCredentials).token).toBe(
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0'
      )
    })

    it('should parse Bearer token with simple token string', () => {
      const header = 'Bearer ghp_xxxxxxxxxxxxxxxxxxxx'
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('bearer')
      expect((result as BearerCredentials).token).toBe('ghp_xxxxxxxxxxxxxxxxxxxx')
    })

    it('should handle case-insensitive Bearer scheme', () => {
      const header = 'BEARER my-token'
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('bearer')
      expect((result as BearerCredentials).token).toBe('my-token')
    })

    it('should handle lowercase Bearer scheme', () => {
      const header = 'bearer my-token'
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('bearer')
    })

    it('should return anonymous for empty Bearer token', () => {
      const header = 'Bearer '
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('anonymous')
    })

    it('should return anonymous for Bearer with only whitespace', () => {
      const header = 'Bearer    '
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('anonymous')
    })

    it('should trim whitespace from Bearer token', () => {
      const header = 'Bearer   my-token   '
      const result = parseAuthorizationHeader(header)

      expect(result.type).toBe('bearer')
      expect((result as BearerCredentials).token).toBe('my-token')
    })
  })

  describe('Anonymous / Invalid', () => {
    it('should return anonymous for undefined header', () => {
      const result = parseAuthorizationHeader(undefined)

      expect(result.type).toBe('anonymous')
    })

    it('should return anonymous for null header', () => {
      const result = parseAuthorizationHeader(null)

      expect(result.type).toBe('anonymous')
    })

    it('should return anonymous for empty string header', () => {
      const result = parseAuthorizationHeader('')

      expect(result.type).toBe('anonymous')
    })

    it('should return anonymous for whitespace-only header', () => {
      const result = parseAuthorizationHeader('   ')

      expect(result.type).toBe('anonymous')
    })

    it('should return anonymous for unknown auth scheme', () => {
      const result = parseAuthorizationHeader('Digest username="user"')

      expect(result.type).toBe('anonymous')
    })

    it('should return anonymous for malformed header', () => {
      const result = parseAuthorizationHeader('NotAValidAuthHeader')

      expect(result.type).toBe('anonymous')
    })
  })
})

// ============================================================================
// Credential Encoding Tests
// ============================================================================

describe('encodeBasicAuth', () => {
  it('should encode username and password to Basic auth header', () => {
    const result = encodeBasicAuth('user', 'pass')

    expect(result).toBe(`Basic ${btoa('user:pass')}`)
  })

  it('should handle empty password', () => {
    const result = encodeBasicAuth('user', '')

    expect(result).toBe(`Basic ${btoa('user:')}`)
  })

  it('should handle empty username', () => {
    const result = encodeBasicAuth('', 'pass')

    expect(result).toBe(`Basic ${btoa(':pass')}`)
  })

  it('should handle special characters', () => {
    const result = encodeBasicAuth('user@example.com', 'p@$$w0rd!')

    expect(result).toBe(`Basic ${btoa('user@example.com:p@$$w0rd!')}`)
  })

  it('should roundtrip with parseAuthorizationHeader', () => {
    const encoded = encodeBasicAuth('testuser', 'testpass')
    const decoded = parseAuthorizationHeader(encoded)

    expect(decoded.type).toBe('basic')
    expect((decoded as BasicCredentials).username).toBe('testuser')
    expect((decoded as BasicCredentials).password).toBe('testpass')
  })
})

describe('encodeBearerAuth', () => {
  it('should encode token to Bearer auth header', () => {
    const result = encodeBearerAuth('my-token')

    expect(result).toBe('Bearer my-token')
  })

  it('should handle JWT token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.sig'
    const result = encodeBearerAuth(jwt)

    expect(result).toBe(`Bearer ${jwt}`)
  })

  it('should roundtrip with parseAuthorizationHeader', () => {
    const token = 'ghp_xxxxxxxxxxxx'
    const encoded = encodeBearerAuth(token)
    const decoded = parseAuthorizationHeader(encoded)

    expect(decoded.type).toBe('bearer')
    expect((decoded as BearerCredentials).token).toBe(token)
  })
})

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('Type Guards', () => {
  describe('isAnonymous', () => {
    it('should return true for anonymous credentials', () => {
      const creds: Credentials = { type: 'anonymous' }
      expect(isAnonymous(creds)).toBe(true)
    })

    it('should return false for basic credentials', () => {
      const creds: Credentials = { type: 'basic', username: 'user', password: 'pass' }
      expect(isAnonymous(creds)).toBe(false)
    })

    it('should return false for bearer credentials', () => {
      const creds: Credentials = { type: 'bearer', token: 'token' }
      expect(isAnonymous(creds)).toBe(false)
    })
  })

  describe('isBasicAuth', () => {
    it('should return true for basic credentials', () => {
      const creds: Credentials = { type: 'basic', username: 'user', password: 'pass' }
      expect(isBasicAuth(creds)).toBe(true)
    })

    it('should return false for anonymous credentials', () => {
      const creds: Credentials = { type: 'anonymous' }
      expect(isBasicAuth(creds)).toBe(false)
    })

    it('should return false for bearer credentials', () => {
      const creds: Credentials = { type: 'bearer', token: 'token' }
      expect(isBasicAuth(creds)).toBe(false)
    })
  })

  describe('isBearerAuth', () => {
    it('should return true for bearer credentials', () => {
      const creds: Credentials = { type: 'bearer', token: 'token' }
      expect(isBearerAuth(creds)).toBe(true)
    })

    it('should return false for anonymous credentials', () => {
      const creds: Credentials = { type: 'anonymous' }
      expect(isBearerAuth(creds)).toBe(false)
    })

    it('should return false for basic credentials', () => {
      const creds: Credentials = { type: 'basic', username: 'user', password: 'pass' }
      expect(isBearerAuth(creds)).toBe(false)
    })
  })
})

// ============================================================================
// Response Helper Tests
// ============================================================================

describe('createUnauthorizedResponse', () => {
  it('should create 401 response with default parameters', () => {
    const response = createUnauthorizedResponse()

    expect(response.status).toBe(401)
    expect(response.statusText).toBe('Unauthorized')
    expect(response.headers['Content-Type']).toBe('text/plain')
    expect(response.headers['WWW-Authenticate']).toContain('Basic')
    expect(response.headers['WWW-Authenticate']).toContain('Bearer')
    expect(decoder.decode(response.body)).toBe('Authentication required')
  })

  it('should use custom realm', () => {
    const response = createUnauthorizedResponse('My Repository')

    expect(response.headers['WWW-Authenticate']).toContain('realm="My Repository"')
  })

  it('should use custom message', () => {
    const response = createUnauthorizedResponse(DEFAULT_REALM, 'Invalid token')

    expect(decoder.decode(response.body)).toBe('Invalid token')
  })

  it('should support Basic-only authentication', () => {
    const response = createUnauthorizedResponse(DEFAULT_REALM, 'Auth required', ['basic'])

    expect(response.headers['WWW-Authenticate']).toContain('Basic')
    expect(response.headers['WWW-Authenticate']).not.toContain('Bearer')
  })

  it('should support Bearer-only authentication', () => {
    const response = createUnauthorizedResponse(DEFAULT_REALM, 'Auth required', ['bearer'])

    expect(response.headers['WWW-Authenticate']).not.toContain('Basic')
    expect(response.headers['WWW-Authenticate']).toContain('Bearer')
  })
})

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('constantTimeCompare', () => {
  it('should return true for equal strings', () => {
    expect(constantTimeCompare('hello', 'hello')).toBe(true)
  })

  it('should return false for different strings', () => {
    expect(constantTimeCompare('hello', 'world')).toBe(false)
  })

  it('should return false for different length strings', () => {
    expect(constantTimeCompare('short', 'much longer string')).toBe(false)
  })

  it('should return true for empty strings', () => {
    expect(constantTimeCompare('', '')).toBe(true)
  })

  it('should handle special characters', () => {
    expect(constantTimeCompare('p@$$w0rd!', 'p@$$w0rd!')).toBe(true)
    expect(constantTimeCompare('p@$$w0rd!', 'p@$$w0rd?')).toBe(false)
  })

  it('should be case sensitive', () => {
    expect(constantTimeCompare('Hello', 'hello')).toBe(false)
  })
})

// ============================================================================
// MemoryAuthProvider Tests
// ============================================================================

describe('MemoryAuthProvider', () => {
  describe('Basic Authentication', () => {
    it('should validate correct username and password', async () => {
      const provider = new MemoryAuthProvider({
        users: {
          alice: { password: 'secret123', scopes: ['repo:read'] },
        },
      })

      const result = await provider.validateCredentials(
        { type: 'basic', username: 'alice', password: 'secret123' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(true)
      expect(result.user?.id).toBe('alice')
      expect(result.scopes).toContain('repo:read')
    })

    it('should reject incorrect password', async () => {
      const provider = new MemoryAuthProvider({
        users: {
          alice: { password: 'secret123', scopes: ['repo:read'] },
        },
      })

      const result = await provider.validateCredentials(
        { type: 'basic', username: 'alice', password: 'wrongpass' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(false)
      expect(result.reason).toBeDefined()
    })

    it('should reject unknown username', async () => {
      const provider = new MemoryAuthProvider({
        users: {
          alice: { password: 'secret123', scopes: ['repo:read'] },
        },
      })

      const result = await provider.validateCredentials(
        { type: 'basic', username: 'bob', password: 'secret123' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(false)
    })

    it('should accept token as password (token-as-password pattern)', async () => {
      const provider = new MemoryAuthProvider({
        tokens: {
          'ghp_xxxxxxxxxxxx': { scopes: ['repo:read', 'repo:write'], userId: 'alice' },
        },
      })

      const result = await provider.validateCredentials(
        { type: 'basic', username: 'x-token-auth', password: 'ghp_xxxxxxxxxxxx' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(true)
      expect(result.user?.id).toBe('alice')
      expect(result.scopes).toContain('repo:write')
    })
  })

  describe('Bearer Authentication', () => {
    it('should validate correct bearer token', async () => {
      const provider = new MemoryAuthProvider({
        tokens: {
          'valid-token': { scopes: ['repo:read'], userId: 'service-account' },
        },
      })

      const result = await provider.validateCredentials(
        { type: 'bearer', token: 'valid-token' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(true)
      expect(result.user?.id).toBe('service-account')
      expect(result.user?.type).toBe('service')
    })

    it('should reject invalid bearer token', async () => {
      const provider = new MemoryAuthProvider({
        tokens: {
          'valid-token': { scopes: ['repo:read'], userId: 'service-account' },
        },
      })

      const result = await provider.validateCredentials(
        { type: 'bearer', token: 'invalid-token' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(false)
    })
  })

  describe('Anonymous Authentication', () => {
    it('should reject anonymous credentials by default', async () => {
      const provider = new MemoryAuthProvider()

      const result = await provider.validateCredentials(
        { type: 'anonymous' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(false)
    })
  })

  describe('User Management', () => {
    it('should allow adding users dynamically', async () => {
      const provider = new MemoryAuthProvider()
      provider.addUser('bob', 'bobpass', ['repo:read'])

      const result = await provider.validateCredentials(
        { type: 'basic', username: 'bob', password: 'bobpass' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(true)
    })

    it('should allow removing users', async () => {
      const provider = new MemoryAuthProvider({
        users: { alice: { password: 'pass' } },
      })
      provider.removeUser('alice')

      const result = await provider.validateCredentials(
        { type: 'basic', username: 'alice', password: 'pass' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(false)
    })

    it('should allow adding tokens dynamically', async () => {
      const provider = new MemoryAuthProvider()
      provider.addToken('new-token', 'bot-user', ['repo:read'])

      const result = await provider.validateCredentials(
        { type: 'bearer', token: 'new-token' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(true)
      expect(result.user?.id).toBe('bot-user')
    })

    it('should allow removing tokens', async () => {
      const provider = new MemoryAuthProvider({
        tokens: { 'my-token': { userId: 'user1' } },
      })
      provider.removeToken('my-token')

      const result = await provider.validateCredentials(
        { type: 'bearer', token: 'my-token' },
        createTestAuthContext()
      )

      expect(result.valid).toBe(false)
    })
  })

  describe('Realm', () => {
    it('should return configured realm', () => {
      const provider = new MemoryAuthProvider({ realm: 'My Git Server' })

      const realm = provider.getRealm(createTestAuthContext())

      expect(realm).toBe('My Git Server')
    })

    it('should return default realm when not configured', () => {
      const provider = new MemoryAuthProvider()

      const realm = provider.getRealm(createTestAuthContext())

      expect(realm).toBe(DEFAULT_REALM)
    })
  })
})

// ============================================================================
// CallbackAuthProvider Tests
// ============================================================================

describe('CallbackAuthProvider', () => {
  it('should call validateBasic callback for basic auth', async () => {
    let calledWith: { username: string; password: string } | null = null

    const provider = new CallbackAuthProvider({
      validateBasic: async (username, password, _context) => {
        calledWith = { username, password }
        return { valid: true, user: { id: username } }
      },
    })

    await provider.validateCredentials(
      { type: 'basic', username: 'user', password: 'pass' },
      createTestAuthContext()
    )

    expect(calledWith).toEqual({ username: 'user', password: 'pass' })
  })

  it('should call validateBearer callback for bearer auth', async () => {
    let calledWithToken: string | null = null

    const provider = new CallbackAuthProvider({
      validateBearer: async (token, _context) => {
        calledWithToken = token
        return { valid: true, user: { id: 'token-user' } }
      },
    })

    await provider.validateCredentials(
      { type: 'bearer', token: 'my-token' },
      createTestAuthContext()
    )

    expect(calledWithToken).toBe('my-token')
  })

  it('should return error when basic auth callback not provided', async () => {
    const provider = new CallbackAuthProvider({
      validateBearer: async () => ({ valid: true, user: { id: 'user' } }),
    })

    const result = await provider.validateCredentials(
      { type: 'basic', username: 'user', password: 'pass' },
      createTestAuthContext()
    )

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('not supported')
  })

  it('should return error when bearer auth callback not provided', async () => {
    const provider = new CallbackAuthProvider({
      validateBasic: async () => ({ valid: true, user: { id: 'user' } }),
    })

    const result = await provider.validateCredentials(
      { type: 'bearer', token: 'token' },
      createTestAuthContext()
    )

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('not supported')
  })

  it('should use custom realm callback', () => {
    const provider = new CallbackAuthProvider({
      getRealm: (context) => `Repo: ${context.repository}`,
    })

    const realm = provider.getRealm(createTestAuthContext({ repository: 'my-repo' }))

    expect(realm).toBe('Repo: my-repo')
  })

  it('should pass context to validators', async () => {
    let receivedContext: AuthContext | null = null

    const provider = new CallbackAuthProvider({
      validateBasic: async (_u, _p, context) => {
        receivedContext = context
        return { valid: true, user: { id: 'user' } }
      },
    })

    const testContext = createTestAuthContext({
      repository: 'special-repo',
      service: 'git-receive-pack',
    })

    await provider.validateCredentials(
      { type: 'basic', username: 'user', password: 'pass' },
      testContext
    )

    expect(receivedContext?.repository).toBe('special-repo')
    expect(receivedContext?.service).toBe('git-receive-pack')
  })
})

// ============================================================================
// Auth Middleware Tests
// ============================================================================

describe('createAuthMiddleware', () => {
  let provider: MemoryAuthProvider
  let middleware: AuthMiddleware

  beforeEach(() => {
    provider = new MemoryAuthProvider({
      users: {
        alice: { password: 'secret', scopes: ['repo:read', 'repo:write'] },
        bob: { password: 'readonly', scopes: ['repo:read'] },
      },
      tokens: {
        'token123': { scopes: ['repo:read', 'repo:write'], userId: 'ci-bot' },
      },
    })
    middleware = createAuthMiddleware(provider)
  })

  describe('authenticate', () => {
    it('should authenticate valid Basic auth request', async () => {
      const request = createTestRequest({
        headers: { authorization: encodeBasicAuth('alice', 'secret') },
      })

      const result = await middleware.authenticate(request)

      expect(result.authenticated).toBe(true)
      expect(result.user?.id).toBe('alice')
      expect(result.scopes).toContain('repo:read')
    })

    it('should authenticate valid Bearer auth request', async () => {
      const request = createTestRequest({
        headers: { authorization: encodeBearerAuth('token123') },
      })

      const result = await middleware.authenticate(request)

      expect(result.authenticated).toBe(true)
      expect(result.user?.id).toBe('ci-bot')
    })

    it('should reject invalid credentials', async () => {
      const request = createTestRequest({
        headers: { authorization: encodeBasicAuth('alice', 'wrongpass') },
      })

      const result = await middleware.authenticate(request)

      expect(result.authenticated).toBe(false)
      expect(result.errorResponse).toBeDefined()
      expect(result.errorResponse?.status).toBe(401)
    })

    it('should reject anonymous by default', async () => {
      const request = createTestRequest({
        headers: {},
      })

      const result = await middleware.authenticate(request)

      expect(result.authenticated).toBe(false)
      expect(result.errorResponse?.status).toBe(401)
    })

    it('should handle Authorization header with different cases', async () => {
      const request = createTestRequest({
        headers: { Authorization: encodeBasicAuth('alice', 'secret') },
      })

      const result = await middleware.authenticate(request)

      expect(result.authenticated).toBe(true)
    })
  })

  describe('Anonymous Access Options', () => {
    it('should allow anonymous when allowAnonymous is true', async () => {
      const anonymousMiddleware = createAuthMiddleware(provider, { allowAnonymous: true })
      const request = createTestRequest({ headers: {} })

      const result = await anonymousMiddleware.authenticate(request)

      expect(result.authenticated).toBe(true)
      expect(result.user?.id).toBe('anonymous')
    })

    it('should allow anonymous read when allowAnonymousRead is true', async () => {
      const readOnlyMiddleware = createAuthMiddleware(provider, { allowAnonymousRead: true })

      // Read operation (upload-pack)
      const readRequest = createTestRequest({
        headers: {},
        path: '/info/refs',
        query: { service: 'git-upload-pack' },
      })

      const readResult = await readOnlyMiddleware.authenticate(readRequest)
      expect(readResult.authenticated).toBe(true)

      // Write operation (receive-pack)
      const writeRequest = createTestRequest({
        headers: {},
        path: '/git-receive-pack',
        query: { service: 'git-receive-pack' },
      })

      const writeResult = await readOnlyMiddleware.authenticate(writeRequest)
      expect(writeResult.authenticated).toBe(false)
    })
  })

  describe('Scope Requirements', () => {
    it('should enforce required scopes', async () => {
      const request = createTestRequest({
        headers: { authorization: encodeBasicAuth('bob', 'readonly') },
      })

      // Bob only has repo:read, not repo:write
      const result = await middleware.authenticate(request, {
        requiredScopes: ['repo:write'],
      })

      expect(result.authenticated).toBe(false)
      expect(result.reason).toContain('permission')
    })

    it('should allow when user has required scopes', async () => {
      const request = createTestRequest({
        headers: { authorization: encodeBasicAuth('alice', 'secret') },
      })

      const result = await middleware.authenticate(request, {
        requiredScopes: ['repo:write'],
      })

      expect(result.authenticated).toBe(true)
    })

    it('should allow when multiple required scopes are met', async () => {
      const request = createTestRequest({
        headers: { authorization: encodeBasicAuth('alice', 'secret') },
      })

      const result = await middleware.authenticate(request, {
        requiredScopes: ['repo:read', 'repo:write'],
      })

      expect(result.authenticated).toBe(true)
    })
  })

  describe('Custom Realm', () => {
    it('should use custom realm in error response', async () => {
      const customRealmMiddleware = createAuthMiddleware(provider, { realm: 'My Repository' })
      const request = createTestRequest({ headers: {} })

      const result = await customRealmMiddleware.authenticate(request)

      expect(result.errorResponse?.headers['WWW-Authenticate']).toContain('My Repository')
    })
  })

  describe('getProvider', () => {
    it('should return the auth provider', () => {
      expect(middleware.getProvider()).toBe(provider)
    })
  })
})

// ============================================================================
// Repository Provider Wrapper Tests
// ============================================================================

describe('createAuthenticatedRepositoryProvider', () => {
  // Mock repository provider
  const createMockRepository = (): RepositoryProvider => ({
    getRefs: async () => [],
    exists: async () => true,
    hasPermission: async () => true,
    uploadPack: async () => new Uint8Array(0),
    receivePack: async () => ({ success: true, refResults: [] }),
  })

  it('should wrap repository provider', () => {
    const repo = createMockRepository()
    const wrapped = createAuthenticatedRepositoryProvider(repo, { id: 'user1' }, ['repo:read'])

    expect(wrapped.getRefs).toBeDefined()
    expect(wrapped.exists).toBeDefined()
    expect(wrapped.hasPermission).toBeDefined()
  })

  it('should allow read operations with repo:read scope', async () => {
    const repo = createMockRepository()
    const wrapped = createAuthenticatedRepositoryProvider(repo, { id: 'user1' }, ['repo:read'])

    const hasPermission = await wrapped.hasPermission('git-upload-pack')

    expect(hasPermission).toBe(true)
  })

  it('should deny write operations without repo:write scope', async () => {
    const repo = createMockRepository()
    const wrapped = createAuthenticatedRepositoryProvider(repo, { id: 'user1' }, ['repo:read'])

    const hasPermission = await wrapped.hasPermission('git-receive-pack')

    expect(hasPermission).toBe(false)
  })

  it('should allow write operations with repo:write scope', async () => {
    const repo = createMockRepository()
    const wrapped = createAuthenticatedRepositoryProvider(repo, { id: 'user1' }, ['repo:write'])

    const hasPermission = await wrapped.hasPermission('git-receive-pack')

    expect(hasPermission).toBe(true)
  })

  it('should allow all operations with repo:* scope', async () => {
    const repo = createMockRepository()
    const wrapped = createAuthenticatedRepositoryProvider(repo, { id: 'admin' }, ['repo:*'])

    expect(await wrapped.hasPermission('git-upload-pack')).toBe(true)
    expect(await wrapped.hasPermission('git-receive-pack')).toBe(true)
  })

  it('should deny all operations for anonymous user', async () => {
    const repo = createMockRepository()
    const wrapped = createAuthenticatedRepositoryProvider(repo, undefined, undefined)

    expect(await wrapped.hasPermission('git-upload-pack')).toBe(false)
    expect(await wrapped.hasPermission('git-receive-pack')).toBe(false)
  })

  it('should respect base repository permission denial', async () => {
    const repo = {
      ...createMockRepository(),
      hasPermission: async () => false, // Base repo denies
    }
    const wrapped = createAuthenticatedRepositoryProvider(repo, { id: 'admin' }, ['repo:*'])

    // Even with full scopes, if base denies, should be false
    expect(await wrapped.hasPermission('git-upload-pack')).toBe(false)
  })

  it('should preserve other repository methods', async () => {
    const repo = createMockRepository()
    const wrapped = createAuthenticatedRepositoryProvider(repo, { id: 'user1' }, ['repo:read'])

    // Other methods should work normally
    const exists = await wrapped.exists()
    expect(exists).toBe(true)

    const refs = await wrapped.getRefs()
    expect(refs).toEqual([])
  })
})

// ============================================================================
// Constants Tests
// ============================================================================

describe('Constants', () => {
  it('DEFAULT_REALM should be defined', () => {
    expect(DEFAULT_REALM).toBe('Git')
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Auth Integration', () => {
  it('should handle full authentication flow with Basic auth', async () => {
    // Setup
    const provider = new MemoryAuthProvider({
      users: {
        developer: { password: 'devpass', scopes: ['repo:read', 'repo:write'] },
      },
    })
    const middleware = createAuthMiddleware(provider)

    // Create request with Basic auth
    const request = createTestRequest({
      headers: { authorization: encodeBasicAuth('developer', 'devpass') },
      path: '/git-receive-pack',
      query: { service: 'git-receive-pack' },
    })

    // Authenticate
    const authResult = await middleware.authenticate(request)
    expect(authResult.authenticated).toBe(true)

    // Create mock repository
    const repo: RepositoryProvider = {
      getRefs: async () => [],
      exists: async () => true,
      hasPermission: async () => true,
      uploadPack: async () => new Uint8Array(0),
      receivePack: async () => ({ success: true, refResults: [] }),
    }

    // Wrap with auth context
    const authedRepo = createAuthenticatedRepositoryProvider(
      repo,
      authResult.user,
      authResult.scopes
    )

    // Check permission for push
    const canPush = await authedRepo.hasPermission('git-receive-pack')
    expect(canPush).toBe(true)
  })

  it('should handle full authentication flow with Bearer token', async () => {
    // Setup with external validation
    const provider = new CallbackAuthProvider({
      validateBearer: async (token, _context) => {
        if (token === 'valid-api-key') {
          return {
            valid: true,
            user: { id: 'api-client', type: 'service' as const },
            scopes: ['repo:read'],
          }
        }
        return { valid: false, reason: 'Invalid API key' }
      },
    })
    const middleware = createAuthMiddleware(provider)

    // Create request with Bearer token
    const request = createTestRequest({
      headers: { authorization: encodeBearerAuth('valid-api-key') },
    })

    // Authenticate
    const authResult = await middleware.authenticate(request)
    expect(authResult.authenticated).toBe(true)
    expect(authResult.user?.type).toBe('service')

    // Check that it can read but not write
    const repo: RepositoryProvider = {
      getRefs: async () => [],
      exists: async () => true,
      hasPermission: async () => true,
      uploadPack: async () => new Uint8Array(0),
      receivePack: async () => ({ success: true, refResults: [] }),
    }

    const authedRepo = createAuthenticatedRepositoryProvider(
      repo,
      authResult.user,
      authResult.scopes
    )

    expect(await authedRepo.hasPermission('git-upload-pack')).toBe(true)
    expect(await authedRepo.hasPermission('git-receive-pack')).toBe(false)
  })

  it('should reject requests with invalid credentials throughout the flow', async () => {
    const provider = new MemoryAuthProvider({
      users: { user: { password: 'correct' } },
    })
    const middleware = createAuthMiddleware(provider)

    const request = createTestRequest({
      headers: { authorization: encodeBasicAuth('user', 'wrong') },
    })

    const authResult = await middleware.authenticate(request)

    expect(authResult.authenticated).toBe(false)
    expect(authResult.errorResponse).toBeDefined()
    expect(authResult.errorResponse?.status).toBe(401)
    expect(authResult.errorResponse?.headers['WWW-Authenticate']).toBeDefined()
  })
})
