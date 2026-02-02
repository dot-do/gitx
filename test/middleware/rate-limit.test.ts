import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  createRateLimitMiddleware,
  createDefaultRateLimiter,
  createStrictRateLimiter,
  createPermissiveRateLimiter,
  MemoryRateLimitStore,
  DEFAULT_LIMITS,
  defaultKeyExtractor,
  defaultEndpointClassifier,
  createUserAwareKeyExtractor,
  type RateLimitStore,
  type RateLimitConfig,
  type RateLimitOptions,
} from '../../src/middleware/rate-limit'

// ============================================================================
// Test Helpers
// ============================================================================

function createTestApp(middleware: ReturnType<typeof createRateLimitMiddleware>) {
  const app = new Hono()
  app.use('*', middleware)
  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.get('/info', (c) => c.json({ info: 'test' }))
  app.get('/:namespace/info/refs', (c) => c.text('refs'))
  app.post('/:namespace/git-upload-pack', (c) => c.text('upload-pack'))
  app.post('/:namespace/git-receive-pack', (c) => c.text('receive-pack'))
  app.post('/sync', (c) => c.json({ synced: true }))
  app.post('/export', (c) => c.json({ exported: true }))
  return app
}

function createRequest(
  path: string,
  options: {
    method?: string
    headers?: Record<string, string>
    query?: Record<string, string>
  } = {}
): Request {
  const url = new URL(path, 'http://localhost')
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value)
    }
  }

  return new Request(url.toString(), {
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
  })
}

// ============================================================================
// MemoryRateLimitStore Tests
// ============================================================================

describe('MemoryRateLimitStore', () => {
  let store: MemoryRateLimitStore

  beforeEach(() => {
    store = new MemoryRateLimitStore()
  })

  afterEach(() => {
    store.destroy()
  })

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      const result = await store.get('nonexistent')
      expect(result).toBeNull()
    })

    it('should return stored info after increment', async () => {
      await store.increment('test-key', 60_000)
      const result = await store.get('test-key')

      expect(result).not.toBeNull()
      expect(result?.count).toBe(1)
      expect(result?.windowStart).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('increment', () => {
    it('should create new entry for new key', async () => {
      const result = await store.increment('new-key', 60_000)

      expect(result.count).toBe(1)
      expect(result.windowStart).toBeLessThanOrEqual(Date.now())
    })

    it('should increment count for existing key within window', async () => {
      await store.increment('key', 60_000)
      await store.increment('key', 60_000)
      const result = await store.increment('key', 60_000)

      expect(result.count).toBe(3)
    })

    it('should reset window when expired', async () => {
      const windowMs = 100 // 100ms window

      const first = await store.increment('key', windowMs)
      expect(first.count).toBe(1)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      const second = await store.increment('key', windowMs)
      expect(second.count).toBe(1) // Should be reset
      expect(second.windowStart).toBeGreaterThan(first.windowStart)
    })
  })

  describe('reset', () => {
    it('should remove key from store', async () => {
      await store.increment('key', 60_000)
      await store.reset('key')

      const result = await store.get('key')
      expect(result).toBeNull()
    })

    it('should not throw for non-existent key', async () => {
      await expect(store.reset('nonexistent')).resolves.toBeUndefined()
    })
  })

  describe('size', () => {
    it('should return 0 for empty store', () => {
      expect(store.size()).toBe(0)
    })

    it('should return correct count after increments', async () => {
      await store.increment('key1', 60_000)
      await store.increment('key2', 60_000)
      await store.increment('key3', 60_000)

      expect(store.size()).toBe(3)
    })
  })

  describe('clear', () => {
    it('should remove all entries', async () => {
      await store.increment('key1', 60_000)
      await store.increment('key2', 60_000)
      store.clear()

      expect(store.size()).toBe(0)
    })
  })
})

// ============================================================================
// Key Extraction Tests
// ============================================================================

describe('defaultKeyExtractor', () => {
  it('should extract CF-Connecting-IP header', () => {
    const app = new Hono()
    let extractedKey: string = ''

    app.use('*', async (c, next) => {
      extractedKey = defaultKeyExtractor(c)
      await next()
    })
    app.get('/', (c) => c.text('ok'))

    const req = createRequest('/', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    })

    app.fetch(req)

    expect(extractedKey).toBe('1.2.3.4')
  })

  it('should fall back to X-Real-IP', () => {
    const app = new Hono()
    let extractedKey: string = ''

    app.use('*', async (c, next) => {
      extractedKey = defaultKeyExtractor(c)
      await next()
    })
    app.get('/', (c) => c.text('ok'))

    const req = createRequest('/', {
      headers: { 'X-Real-IP': '5.6.7.8' },
    })

    app.fetch(req)

    expect(extractedKey).toBe('5.6.7.8')
  })

  it('should fall back to X-Forwarded-For (first IP)', () => {
    const app = new Hono()
    let extractedKey: string = ''

    app.use('*', async (c, next) => {
      extractedKey = defaultKeyExtractor(c)
      await next()
    })
    app.get('/', (c) => c.text('ok'))

    const req = createRequest('/', {
      headers: { 'X-Forwarded-For': '9.10.11.12, 192.168.1.1, 10.0.0.1' },
    })

    app.fetch(req)

    expect(extractedKey).toBe('9.10.11.12')
  })

  it('should return "unknown" when no IP headers present', () => {
    const app = new Hono()
    let extractedKey: string = ''

    app.use('*', async (c, next) => {
      extractedKey = defaultKeyExtractor(c)
      await next()
    })
    app.get('/', (c) => c.text('ok'))

    const req = createRequest('/')

    app.fetch(req)

    expect(extractedKey).toBe('unknown')
  })
})

describe('createUserAwareKeyExtractor', () => {
  it('should use user ID when authenticated', async () => {
    const extractor = createUserAwareKeyExtractor(() => 'user123')
    const app = new Hono()
    let extractedKey: string = ''

    app.use('*', async (c, next) => {
      extractedKey = await extractor(c)
      await next()
    })
    app.get('/', (c) => c.text('ok'))

    const req = createRequest('/', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    })

    await app.fetch(req)

    expect(extractedKey).toBe('user:user123')
  })

  it('should fall back to IP when not authenticated', async () => {
    const extractor = createUserAwareKeyExtractor(() => null)
    const app = new Hono()
    let extractedKey: string = ''

    app.use('*', async (c, next) => {
      extractedKey = await extractor(c)
      await next()
    })
    app.get('/', (c) => c.text('ok'))

    const req = createRequest('/', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    })

    await app.fetch(req)

    expect(extractedKey).toBe('ip:1.2.3.4')
  })

  it('should handle async user ID lookup', async () => {
    const extractor = createUserAwareKeyExtractor(async () => {
      await new Promise((r) => setTimeout(r, 10))
      return 'async-user'
    })
    const app = new Hono()
    let extractedKey: string = ''

    app.use('*', async (c, next) => {
      extractedKey = await extractor(c)
      await next()
    })
    app.get('/', (c) => c.text('ok'))

    const req = createRequest('/')

    await app.fetch(req)

    expect(extractedKey).toBe('user:async-user')
  })
})

// ============================================================================
// Endpoint Classification Tests
// ============================================================================

describe('defaultEndpointClassifier', () => {
  it('should classify /health as health endpoint', () => {
    const app = new Hono()
    let classified: string = ''

    app.use('*', async (c, next) => {
      classified = defaultEndpointClassifier(c)
      await next()
    })
    app.get('/health', (c) => c.text('ok'))

    app.fetch(createRequest('/health'))

    expect(classified).toBe('health')
  })

  it('should classify git-receive-pack as push', () => {
    const app = new Hono()
    let classified: string = ''

    app.use('*', async (c, next) => {
      classified = defaultEndpointClassifier(c)
      await next()
    })
    app.post('/:ns/git-receive-pack', (c) => c.text('ok'))

    app.fetch(createRequest('/test/git-receive-pack', { method: 'POST' }))

    expect(classified).toBe('push')
  })

  it('should classify git-upload-pack as fetch', () => {
    const app = new Hono()
    let classified: string = ''

    app.use('*', async (c, next) => {
      classified = defaultEndpointClassifier(c)
      await next()
    })
    app.post('/:ns/git-upload-pack', (c) => c.text('ok'))

    app.fetch(createRequest('/test/git-upload-pack', { method: 'POST' }))

    expect(classified).toBe('fetch')
  })

  it('should classify info/refs with git-receive-pack service as push', () => {
    const app = new Hono()
    let classified: string = ''

    app.use('*', async (c, next) => {
      classified = defaultEndpointClassifier(c)
      await next()
    })
    app.get('/:ns/info/refs', (c) => c.text('ok'))

    app.fetch(createRequest('/test/info/refs', { query: { service: 'git-receive-pack' } }))

    expect(classified).toBe('push')
  })

  it('should classify info/refs with git-upload-pack service as fetch', () => {
    const app = new Hono()
    let classified: string = ''

    app.use('*', async (c, next) => {
      classified = defaultEndpointClassifier(c)
      await next()
    })
    app.get('/:ns/info/refs', (c) => c.text('ok'))

    app.fetch(createRequest('/test/info/refs', { query: { service: 'git-upload-pack' } }))

    expect(classified).toBe('fetch')
  })

  it('should classify /sync as api', () => {
    const app = new Hono()
    let classified: string = ''

    app.use('*', async (c, next) => {
      classified = defaultEndpointClassifier(c)
      await next()
    })
    app.post('/sync', (c) => c.text('ok'))

    app.fetch(createRequest('/sync', { method: 'POST' }))

    expect(classified).toBe('api')
  })

  it('should classify /export as api', () => {
    const app = new Hono()
    let classified: string = ''

    app.use('*', async (c, next) => {
      classified = defaultEndpointClassifier(c)
      await next()
    })
    app.post('/export', (c) => c.text('ok'))

    app.fetch(createRequest('/export', { method: 'POST' }))

    expect(classified).toBe('api')
  })

  it('should classify unknown paths as api', () => {
    const app = new Hono()
    let classified: string = ''

    app.use('*', async (c, next) => {
      classified = defaultEndpointClassifier(c)
      await next()
    })
    app.get('/unknown/path', (c) => c.text('ok'))

    app.fetch(createRequest('/unknown/path'))

    expect(classified).toBe('api')
  })
})

// ============================================================================
// Rate Limit Middleware Tests
// ============================================================================

describe('createRateLimitMiddleware', () => {
  let store: MemoryRateLimitStore

  beforeEach(() => {
    store = new MemoryRateLimitStore()
  })

  afterEach(() => {
    store.destroy()
  })

  describe('basic rate limiting', () => {
    it('should allow requests under the limit', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 5, windowMs: 60_000 } },
      })
      const app = createTestApp(middleware)

      for (let i = 0; i < 5; i++) {
        const res = await app.fetch(createRequest('/info', {
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
        }))
        expect(res.status).toBe(200)
      }
    })

    it('should block requests over the limit', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 3, windowMs: 60_000 } },
      })
      const app = createTestApp(middleware)

      // Make 3 allowed requests
      for (let i = 0; i < 3; i++) {
        const res = await app.fetch(createRequest('/info', {
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
        }))
        expect(res.status).toBe(200)
      }

      // 4th request should be blocked
      const res = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
      expect(res.status).toBe(429)
    })

    it('should return 429 with proper error response', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 1, windowMs: 60_000 } },
      })
      const app = createTestApp(middleware)

      // First request succeeds
      await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      // Second request fails
      const res = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      expect(res.status).toBe(429)

      const body = await res.json() as { error: string; message: string; retryAfter: number }
      expect(body.error).toBe('Too Many Requests')
      expect(body.message).toContain('Rate limit exceeded')
      expect(body.retryAfter).toBeGreaterThan(0)
    })

    it('should include Retry-After header', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 1, windowMs: 60_000 } },
      })
      const app = createTestApp(middleware)

      await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      const res = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      expect(res.headers.get('Retry-After')).not.toBeNull()
      const retryAfter = parseInt(res.headers.get('Retry-After')!)
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(60)
    })
  })

  describe('rate limit headers', () => {
    it('should include rate limit headers in response', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 10, windowMs: 60_000 } },
        includeHeaders: true,
      })
      const app = createTestApp(middleware)

      const res = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      expect(res.headers.get('X-RateLimit-Limit')).toBe('10')
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('9')
      expect(res.headers.get('X-RateLimit-Reset')).not.toBeNull()
    })

    it('should decrement remaining count', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 5, windowMs: 60_000 } },
      })
      const app = createTestApp(middleware)

      const res1 = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
      expect(res1.headers.get('X-RateLimit-Remaining')).toBe('4')

      const res2 = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
      expect(res2.headers.get('X-RateLimit-Remaining')).toBe('3')
    })

    it('should support custom header prefix', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 10, windowMs: 60_000 } },
        headerPrefix: 'RateLimit-',
      })
      const app = createTestApp(middleware)

      const res = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      expect(res.headers.get('RateLimit-Limit')).toBe('10')
      expect(res.headers.get('X-RateLimit-Limit')).toBeNull()
    })

    it('should not include headers when disabled', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 10, windowMs: 60_000 } },
        includeHeaders: false,
      })
      const app = createTestApp(middleware)

      const res = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      expect(res.headers.get('X-RateLimit-Limit')).toBeNull()
    })
  })

  describe('endpoint-specific limits', () => {
    it('should apply different limits to different endpoints', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: {
          push: { requests: 2, windowMs: 60_000 },
          fetch: { requests: 5, windowMs: 60_000 },
          api: { requests: 3, windowMs: 60_000 },
        },
      })
      const app = createTestApp(middleware)

      // Push endpoint (limit: 2)
      for (let i = 0; i < 2; i++) {
        const res = await app.fetch(createRequest('/test/git-receive-pack', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
        }))
        expect(res.status).toBe(200)
      }

      const pushBlocked = await app.fetch(createRequest('/test/git-receive-pack', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
      expect(pushBlocked.status).toBe(429)

      // Fetch endpoint (limit: 5) - same IP, different endpoint type
      for (let i = 0; i < 5; i++) {
        const res = await app.fetch(createRequest('/test/git-upload-pack', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
        }))
        expect(res.status).toBe(200)
      }

      const fetchBlocked = await app.fetch(createRequest('/test/git-upload-pack', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
      expect(fetchBlocked.status).toBe(429)
    })

    it('should use default limit for unspecified endpoint types', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: {
          push: { requests: 2, windowMs: 60_000 },
          default: { requests: 10, windowMs: 60_000 },
        },
      })
      const app = createTestApp(middleware)

      const res = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      expect(res.headers.get('X-RateLimit-Limit')).toBe('10')
    })
  })

  describe('skip option', () => {
    it('should skip rate limiting when skip returns true', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 1, windowMs: 60_000 } },
        skip: () => true,
      })
      const app = createTestApp(middleware)

      // Should not be limited even though limit is 1
      for (let i = 0; i < 5; i++) {
        const res = await app.fetch(createRequest('/info', {
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
        }))
        expect(res.status).toBe(200)
      }
    })

    it('should apply rate limiting when skip returns false', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 1, windowMs: 60_000 } },
        skip: () => false,
      })
      const app = createTestApp(middleware)

      await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      const res = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
      expect(res.status).toBe(429)
    })

    it('should support async skip function', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 1, windowMs: 60_000 } },
        skip: async (c) => {
          await new Promise((r) => setTimeout(r, 10))
          return c.req.header('X-Skip-Rate-Limit') === 'true'
        },
      })
      const app = createTestApp(middleware)

      // Request with skip header - not limited
      for (let i = 0; i < 3; i++) {
        const res = await app.fetch(createRequest('/info', {
          headers: {
            'CF-Connecting-IP': '1.2.3.4',
            'X-Skip-Rate-Limit': 'true',
          },
        }))
        expect(res.status).toBe(200)
      }

      // Request without skip header - limited
      await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      const res = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
      expect(res.status).toBe(429)
    })
  })

  describe('custom onRateLimited handler', () => {
    it('should use custom handler for rate limited responses', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 1, windowMs: 60_000 } },
        onRateLimited: (c, result) => {
          return c.json({
            customError: true,
            remaining: result.remaining,
            retryIn: result.retryAfter,
          }, 429)
        },
      })
      const app = createTestApp(middleware)

      await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      const res = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      expect(res.status).toBe(429)

      const body = await res.json() as { customError: boolean; remaining: number; retryIn: number }
      expect(body.customError).toBe(true)
      expect(body.remaining).toBe(0)
    })
  })

  describe('custom key extractor', () => {
    it('should use custom key extractor', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 2, windowMs: 60_000 } },
        keyExtractor: (c) => c.req.header('X-API-Key') ?? 'anonymous',
      })
      const app = createTestApp(middleware)

      // Requests with API key 1
      for (let i = 0; i < 2; i++) {
        const res = await app.fetch(createRequest('/info', {
          headers: { 'X-API-Key': 'key1' },
        }))
        expect(res.status).toBe(200)
      }

      // Key1 should be limited
      const res1 = await app.fetch(createRequest('/info', {
        headers: { 'X-API-Key': 'key1' },
      }))
      expect(res1.status).toBe(429)

      // Key2 should not be limited
      const res2 = await app.fetch(createRequest('/info', {
        headers: { 'X-API-Key': 'key2' },
      }))
      expect(res2.status).toBe(200)
    })
  })

  describe('custom endpoint classifier', () => {
    it('should use custom endpoint classifier', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: {
          admin: { requests: 1, windowMs: 60_000 },
          user: { requests: 5, windowMs: 60_000 },
        },
        endpointClassifier: (c) => {
          return c.req.path.startsWith('/admin') ? 'admin' : 'user'
        },
      })

      const app = new Hono()
      app.use('*', middleware)
      app.get('/admin/settings', (c) => c.json({ settings: true }))
      app.get('/user/profile', (c) => c.json({ profile: true }))

      // Admin endpoint has limit of 1
      await app.fetch(createRequest('/admin/settings', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))

      const adminRes = await app.fetch(createRequest('/admin/settings', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
      expect(adminRes.status).toBe(429)

      // User endpoint has limit of 5 - same IP but different endpoint type
      for (let i = 0; i < 5; i++) {
        const res = await app.fetch(createRequest('/user/profile', {
          headers: { 'CF-Connecting-IP': '1.2.3.4' },
        }))
        expect(res.status).toBe(200)
      }
    })
  })

  describe('IP isolation', () => {
    it('should track rate limits separately per IP', async () => {
      const middleware = createRateLimitMiddleware({
        store,
        limits: { default: { requests: 2, windowMs: 60_000 } },
      })
      const app = createTestApp(middleware)

      // IP 1 makes 2 requests
      for (let i = 0; i < 2; i++) {
        await app.fetch(createRequest('/info', {
          headers: { 'CF-Connecting-IP': '1.1.1.1' },
        }))
      }

      // IP 1 should be limited
      const ip1Blocked = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.1.1.1' },
      }))
      expect(ip1Blocked.status).toBe(429)

      // IP 2 should not be limited
      const ip2Ok = await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '2.2.2.2' },
      }))
      expect(ip2Ok.status).toBe(200)
    })
  })
})

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('createDefaultRateLimiter', () => {
  it('should create middleware with default limits', async () => {
    const middleware = createDefaultRateLimiter()
    const app = createTestApp(middleware)

    const res = await app.fetch(createRequest('/info', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }))

    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBe(String(DEFAULT_LIMITS.api!.requests))
  })

  it('should accept config overrides', async () => {
    const middleware = createDefaultRateLimiter({
      limits: { api: { requests: 5, windowMs: 60_000 } },
    })
    const app = createTestApp(middleware)

    const res = await app.fetch(createRequest('/info', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }))

    expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
  })
})

describe('createStrictRateLimiter', () => {
  let store: MemoryRateLimitStore

  beforeEach(() => {
    store = new MemoryRateLimitStore()
  })

  afterEach(() => {
    store.destroy()
  })

  it('should apply strict limits', async () => {
    const middleware = createStrictRateLimiter(store)
    const app = createTestApp(middleware)

    // Strict push limit is 10
    for (let i = 0; i < 10; i++) {
      const res = await app.fetch(createRequest('/test/git-receive-pack', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
      expect(res.status).toBe(200)
    }

    const blocked = await app.fetch(createRequest('/test/git-receive-pack', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }))
    expect(blocked.status).toBe(429)
  })
})

describe('createPermissiveRateLimiter', () => {
  let store: MemoryRateLimitStore

  beforeEach(() => {
    store = new MemoryRateLimitStore()
  })

  afterEach(() => {
    store.destroy()
  })

  it('should apply permissive limits', async () => {
    const middleware = createPermissiveRateLimiter(store)
    const app = createTestApp(middleware)

    // Permissive push limit is 100
    for (let i = 0; i < 100; i++) {
      const res = await app.fetch(createRequest('/test/git-receive-pack', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
      expect(res.status).toBe(200)
    }

    const blocked = await app.fetch(createRequest('/test/git-receive-pack', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }))
    expect(blocked.status).toBe(429)
  })
})

// ============================================================================
// DEFAULT_LIMITS Tests
// ============================================================================

describe('DEFAULT_LIMITS', () => {
  it('should have expected endpoint types', () => {
    expect(DEFAULT_LIMITS.push).toBeDefined()
    expect(DEFAULT_LIMITS.fetch).toBeDefined()
    expect(DEFAULT_LIMITS.api).toBeDefined()
    expect(DEFAULT_LIMITS.health).toBeDefined()
    expect(DEFAULT_LIMITS.default).toBeDefined()
  })

  it('should have push limit stricter than fetch', () => {
    expect(DEFAULT_LIMITS.push!.requests).toBeLessThan(DEFAULT_LIMITS.fetch!.requests)
  })

  it('should have health limit most permissive', () => {
    expect(DEFAULT_LIMITS.health!.requests).toBeGreaterThan(DEFAULT_LIMITS.api!.requests)
    expect(DEFAULT_LIMITS.health!.requests).toBeGreaterThan(DEFAULT_LIMITS.push!.requests)
    expect(DEFAULT_LIMITS.health!.requests).toBeGreaterThan(DEFAULT_LIMITS.fetch!.requests)
  })
})

// ============================================================================
// Window Reset Tests
// ============================================================================

describe('window reset behavior', () => {
  let store: MemoryRateLimitStore

  beforeEach(() => {
    store = new MemoryRateLimitStore()
  })

  afterEach(() => {
    store.destroy()
  })

  it('should reset limit after window expires', async () => {
    const windowMs = 100 // 100ms window for fast testing

    const middleware = createRateLimitMiddleware({
      store,
      limits: { default: { requests: 2, windowMs } },
    })
    const app = createTestApp(middleware)

    // Exhaust the limit
    for (let i = 0; i < 2; i++) {
      await app.fetch(createRequest('/info', {
        headers: { 'CF-Connecting-IP': '1.2.3.4' },
      }))
    }

    // Should be blocked
    const blocked = await app.fetch(createRequest('/info', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }))
    expect(blocked.status).toBe(429)

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 150))

    // Should be allowed again
    const allowed = await app.fetch(createRequest('/info', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    }))
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('X-RateLimit-Remaining')).toBe('1')
  })
})
