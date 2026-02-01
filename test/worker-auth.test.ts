import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import {
  authMiddleware,
  getValidTokens,
  validateToken,
  extractToken,
  createUnauthorized,
  type AuthEnv,
} from '../src/worker-auth'

// ============================================================================
// Test Helpers
// ============================================================================

function createApp(env: AuthEnv = {}) {
  const app = new Hono<{ Bindings: AuthEnv }>()
  app.use('*', authMiddleware())
  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.get('/', (c) => c.json({ name: 'gitx' }))
  app.get('/myrepo/info/refs', (c) => c.text('refs'))
  app.post('/myrepo/git-upload-pack', (c) => c.text('pack'))
  app.post('/myrepo/git-receive-pack', (c) => c.text('received'))
  app.get('/api/data', (c) => c.json({ data: 'secret' }))

  return {
    fetch: (req: Request) => app.fetch(req, env),
  }
}

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers })
}

function basicAuth(user: string, pass: string): string {
  return `Basic ${btoa(`${user}:${pass}`)}`
}

// ============================================================================
// Unit Tests: getValidTokens
// ============================================================================

describe('getValidTokens', () => {
  it('returns null when no auth env vars are set (open mode)', () => {
    expect(getValidTokens({})).toBeNull()
    expect(getValidTokens({ AUTH_TOKEN: '', API_KEYS: '' })).toBeNull()
  })

  it('returns set with AUTH_TOKEN when set', () => {
    const tokens = getValidTokens({ AUTH_TOKEN: 'my-secret' })
    expect(tokens).not.toBeNull()
    expect(tokens!.has('my-secret')).toBe(true)
    expect(tokens!.size).toBe(1)
  })

  it('returns set with API_KEYS when set', () => {
    const tokens = getValidTokens({ API_KEYS: 'key1,key2,key3' })
    expect(tokens).not.toBeNull()
    expect(tokens!.size).toBe(3)
    expect(tokens!.has('key1')).toBe(true)
    expect(tokens!.has('key2')).toBe(true)
    expect(tokens!.has('key3')).toBe(true)
  })

  it('trims whitespace from API_KEYS', () => {
    const tokens = getValidTokens({ API_KEYS: ' key1 , key2 , key3 ' })
    expect(tokens).not.toBeNull()
    expect(tokens!.has('key1')).toBe(true)
    expect(tokens!.has('key2')).toBe(true)
    expect(tokens!.has('key3')).toBe(true)
  })

  it('merges AUTH_TOKEN and API_KEYS', () => {
    const tokens = getValidTokens({ AUTH_TOKEN: 'master-key', API_KEYS: 'key1,key2' })
    expect(tokens).not.toBeNull()
    expect(tokens!.size).toBe(3)
    expect(tokens!.has('master-key')).toBe(true)
    expect(tokens!.has('key1')).toBe(true)
    expect(tokens!.has('key2')).toBe(true)
  })

  it('skips empty entries in API_KEYS', () => {
    const tokens = getValidTokens({ API_KEYS: 'key1,,key2,,,key3' })
    expect(tokens).not.toBeNull()
    expect(tokens!.size).toBe(3)
  })
})

// ============================================================================
// Unit Tests: validateToken
// ============================================================================

describe('validateToken', () => {
  const tokens = new Set(['secret-123', 'api-key-456'])

  it('returns true for a valid token', () => {
    expect(validateToken('secret-123', tokens)).toBe(true)
    expect(validateToken('api-key-456', tokens)).toBe(true)
  })

  it('returns false for an invalid token', () => {
    expect(validateToken('wrong-token', tokens)).toBe(false)
    expect(validateToken('', tokens)).toBe(false)
  })
})

// ============================================================================
// Unit Tests: extractToken
// ============================================================================

describe('extractToken', () => {
  it('returns null for undefined header', () => {
    expect(extractToken(undefined)).toBeNull()
  })

  it('returns null for empty header', () => {
    expect(extractToken('')).toBeNull()
  })

  it('extracts token from Bearer header', () => {
    expect(extractToken('Bearer my-api-key')).toBe('my-api-key')
  })

  it('extracts password from Basic header (git client style)', () => {
    // git sends: Basic base64(username:token)
    const header = `Basic ${btoa('user:my-token')}`
    expect(extractToken(header)).toBe('my-token')
  })

  it('extracts username from Basic header when password is empty', () => {
    // Some clients send: Basic base64(token:)
    const header = `Basic ${btoa('my-token:')}`
    expect(extractToken(header)).toBe('my-token')
  })

  it('returns null for anonymous (no auth scheme)', () => {
    expect(extractToken('SomeUnknown xyz')).toBeNull()
  })
})

// ============================================================================
// Unit Tests: createUnauthorized
// ============================================================================

describe('createUnauthorized', () => {
  it('returns 401 with Basic realm="gitx" for git info/refs path', () => {
    const res = createUnauthorized('/myrepo/info/refs')
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="gitx"')
    expect(res.headers.get('Content-Type')).toBe('text/plain')
  })

  it('returns 401 with Basic realm="gitx" for git-upload-pack path', () => {
    const res = createUnauthorized('/myrepo/git-upload-pack')
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="gitx"')
  })

  it('returns 401 with Basic realm="gitx" for git-receive-pack path', () => {
    const res = createUnauthorized('/myrepo/git-receive-pack')
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="gitx"')
  })

  it('returns 401 with JSON body for non-git paths', () => {
    const res = createUnauthorized('/api/data')
    expect(res.status).toBe(401)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="gitx"')
  })

  it('uses custom message', async () => {
    const res = createUnauthorized('/api/data', 'Bad token')
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Bad token')
  })
})

// ============================================================================
// Integration Tests: authMiddleware with Hono
// ============================================================================

describe('authMiddleware (open mode - no AUTH_TOKEN)', () => {
  it('allows all requests when no auth is configured', async () => {
    const app = createApp({})

    const res = await app.fetch(req('/api/data'))
    expect(res.status).toBe(200)
  })

  it('allows health check', async () => {
    const app = createApp({})

    const res = await app.fetch(req('/health'))
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ok')
  })

  it('allows git protocol endpoints without auth', async () => {
    const app = createApp({})

    const res = await app.fetch(req('/myrepo/info/refs'))
    expect(res.status).toBe(200)
  })
})

describe('authMiddleware (AUTH_TOKEN set)', () => {
  const env: AuthEnv = { AUTH_TOKEN: 'test-secret-token' }

  it('allows /health without auth', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/health'))
    expect(res.status).toBe(200)
  })

  it('allows / without auth (public path)', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/'))
    expect(res.status).toBe(200)
  })

  it('rejects request with no Authorization header', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/api/data'))
    expect(res.status).toBe(401)
  })

  it('rejects request with wrong Bearer token', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/api/data', { Authorization: 'Bearer wrong-token' }))
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Invalid credentials')
  })

  it('allows request with correct Bearer token', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/api/data', { Authorization: 'Bearer test-secret-token' }))
    expect(res.status).toBe(200)
  })

  it('allows request with correct Basic auth (token as password)', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/api/data', { Authorization: basicAuth('git', 'test-secret-token') }))
    expect(res.status).toBe(200)
  })

  it('allows request with correct Basic auth (token as username)', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/api/data', { Authorization: basicAuth('test-secret-token', '') }))
    expect(res.status).toBe(200)
  })

  it('rejects Basic auth with wrong password', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/api/data', { Authorization: basicAuth('git', 'wrong-token') }))
    expect(res.status).toBe(401)
  })
})

describe('authMiddleware (API_KEYS set)', () => {
  const env: AuthEnv = { API_KEYS: 'key-alpha,key-beta,key-gamma' }

  it('allows request with any valid API key as Bearer', async () => {
    const app = createApp(env)

    for (const key of ['key-alpha', 'key-beta', 'key-gamma']) {
      const res = await app.fetch(req('/api/data', { Authorization: `Bearer ${key}` }))
      expect(res.status).toBe(200)
    }
  })

  it('rejects request with invalid API key', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/api/data', { Authorization: 'Bearer key-delta' }))
    expect(res.status).toBe(401)
  })
})

describe('authMiddleware (git protocol endpoints)', () => {
  const env: AuthEnv = { AUTH_TOKEN: 'git-token' }

  it('returns WWW-Authenticate Basic realm="gitx" for info/refs', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/myrepo/info/refs'))
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="gitx"')
    expect(res.headers.get('Content-Type')).toBe('text/plain')
  })

  it('returns WWW-Authenticate Basic realm="gitx" for git-upload-pack', async () => {
    const app = createApp(env)

    const res = await app.fetch(
      new Request('http://localhost/myrepo/git-upload-pack', { method: 'POST' })
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="gitx"')
  })

  it('returns WWW-Authenticate Basic realm="gitx" for git-receive-pack', async () => {
    const app = createApp(env)

    const res = await app.fetch(
      new Request('http://localhost/myrepo/git-receive-pack', { method: 'POST' })
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="gitx"')
  })

  it('allows authenticated git protocol requests', async () => {
    const app = createApp(env)

    const res = await app.fetch(
      req('/myrepo/info/refs', { Authorization: basicAuth('git', 'git-token') })
    )
    expect(res.status).toBe(200)
  })
})

describe('authMiddleware (AUTH_TOKEN + API_KEYS combined)', () => {
  const env: AuthEnv = { AUTH_TOKEN: 'master-key', API_KEYS: 'service-key-1,service-key-2' }

  it('accepts AUTH_TOKEN', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/api/data', { Authorization: 'Bearer master-key' }))
    expect(res.status).toBe(200)
  })

  it('accepts any API_KEYS entry', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/api/data', { Authorization: 'Bearer service-key-1' }))
    expect(res.status).toBe(200)
  })

  it('rejects unknown keys', async () => {
    const app = createApp(env)

    const res = await app.fetch(req('/api/data', { Authorization: 'Bearer unknown-key' }))
    expect(res.status).toBe(401)
  })
})
