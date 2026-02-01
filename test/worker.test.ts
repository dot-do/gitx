/**
 * @fileoverview Worker Entry Point Routing Integration Tests
 *
 * Tests the Hono-based worker router defined in src/worker.ts, including:
 * - Health check and root endpoints
 * - 404 handling for unknown routes
 * - CORS headers
 * - Auth middleware (blocking unauthenticated, passing valid tokens)
 * - Git protocol route accessibility
 */

import { describe, it, expect } from 'vitest'
import app from '../src/worker'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Minimal mock environment with no auth configured (open mode).
 */
function createOpenEnv() {
  return {
    GITX: createMockDurableObjectNamespace(),
    R2: createMockR2Bucket(),
    PACK_STORAGE: createMockR2Bucket(),
    GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
  }
}

/**
 * Mock environment with AUTH_TOKEN set (auth required).
 */
function createAuthEnv(token = 'test-secret-token') {
  return {
    ...createOpenEnv(),
    AUTH_TOKEN: token,
  }
}

/**
 * Mock environment with API_KEYS set (multiple keys).
 */
function createApiKeysEnv(keys = 'key-one, key-two, key-three') {
  return {
    ...createOpenEnv(),
    API_KEYS: keys,
  }
}

function createMockR2Bucket(): R2Bucket {
  return {} as unknown as R2Bucket
}

function createMockDurableObjectNamespace(): DurableObjectNamespace {
  const mockStub = {
    fetch: async (req: Request) => new Response(JSON.stringify({ forwarded: true, url: req.url }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  }

  return {
    idFromName: (_name: string) => ({ toString: () => 'mock-id' }) as DurableObjectId,
    get: (_id: DurableObjectId) => mockStub as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace
}

// ============================================================================
// Health Check Endpoint
// ============================================================================

describe('Worker Routing', () => {
  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const res = await app.request('http://localhost/health', {}, createOpenEnv())
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body.status).toBe('ok')
      expect(body.service).toBe('gitx-do')
      expect(body.timestamp).toBeDefined()
    })

    it('should return 200 even when auth is configured (public path)', async () => {
      const res = await app.request('http://localhost/health', {}, createAuthEnv())
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body.status).toBe('ok')
    })
  })

  // ============================================================================
  // Root Endpoint
  // ============================================================================

  describe('GET /', () => {
    it('should return service info with endpoints', async () => {
      const res = await app.request('http://localhost/', {}, createOpenEnv())
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body.name).toBe('gitx-do')
      expect(body.version).toBeDefined()
      expect(body.description).toBeDefined()
      expect(body.endpoints).toBeDefined()
    })

    it('should be a public path (no auth required)', async () => {
      const res = await app.request('http://localhost/', {}, createAuthEnv())
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body.name).toBe('gitx-do')
    })
  })

  // ============================================================================
  // Unknown Routes (404)
  // ============================================================================

  describe('Unknown routes', () => {
    it('should return 404 for non-GET request to root', async () => {
      const res = await app.request('http://localhost/', { method: 'DELETE' }, createOpenEnv())
      expect(res.status).toBe(404)
    })

    it('should forward single-segment paths to Durable Object via /:namespace/* catch-all', async () => {
      // The /:namespace/* route catches any path with at least one segment,
      // so there are no true 404s for paths like /something — they route to a DO.
      const res = await app.request('http://localhost/nonexistent', {}, createOpenEnv())
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body.forwarded).toBe(true)
    })
  })

  // ============================================================================
  // Auth Middleware
  // ============================================================================

  describe('Auth middleware', () => {
    describe('when AUTH_TOKEN is set', () => {
      it('should block unauthenticated requests to non-public paths', async () => {
        const res = await app.request('http://localhost/my-repo/info/refs', {}, createAuthEnv())
        expect(res.status).toBe(401)
      })

      it('should block requests with wrong Bearer token', async () => {
        const res = await app.request(
          'http://localhost/my-repo/info/refs',
          { headers: { Authorization: 'Bearer wrong-token' } },
          createAuthEnv(),
        )
        expect(res.status).toBe(401)
      })

      it('should pass requests with correct Bearer token', async () => {
        const res = await app.request(
          'http://localhost/my-repo/info/refs',
          { headers: { Authorization: 'Bearer test-secret-token' } },
          createAuthEnv('test-secret-token'),
        )
        expect(res.status).toBe(200)
      })

      it('should pass requests with correct Basic auth (token as password)', async () => {
        const encoded = btoa(`git:test-secret-token`)
        const res = await app.request(
          'http://localhost/my-repo/info/refs',
          { headers: { Authorization: `Basic ${encoded}` } },
          createAuthEnv('test-secret-token'),
        )
        expect(res.status).toBe(200)
      })

      it('should return WWW-Authenticate header on 401 for git endpoints', async () => {
        const res = await app.request(
          'http://localhost/my-repo/info/refs',
          {},
          createAuthEnv(),
        )
        expect(res.status).toBe(401)
        expect(res.headers.get('WWW-Authenticate')).toContain('Basic')
      })

      it('should return JSON error body on 401 for non-git endpoints', async () => {
        const res = await app.request(
          'http://localhost/my-repo/some-api',
          {},
          createAuthEnv(),
        )
        expect(res.status).toBe(401)
        const body = await res.json() as Record<string, unknown>
        expect(body.error).toBeDefined()
      })
    })

    describe('when API_KEYS is set', () => {
      it('should accept any of the comma-separated keys', async () => {
        const env = createApiKeysEnv('alpha, beta, gamma')

        const res1 = await app.request(
          'http://localhost/my-repo/info/refs',
          { headers: { Authorization: 'Bearer alpha' } },
          env,
        )
        expect(res1.status).toBe(200)

        const res2 = await app.request(
          'http://localhost/my-repo/info/refs',
          { headers: { Authorization: 'Bearer gamma' } },
          env,
        )
        expect(res2.status).toBe(200)
      })

      it('should reject keys not in the list', async () => {
        const res = await app.request(
          'http://localhost/my-repo/info/refs',
          { headers: { Authorization: 'Bearer delta' } },
          createApiKeysEnv('alpha, beta, gamma'),
        )
        expect(res.status).toBe(401)
      })
    })

    describe('open mode (no auth configured)', () => {
      it('should allow all requests when no AUTH_TOKEN or API_KEYS set', async () => {
        const res = await app.request(
          'http://localhost/my-repo/info/refs',
          {},
          createOpenEnv(),
        )
        expect(res.status).toBe(200)
      })
    })
  })

  // ============================================================================
  // Git Protocol Routes
  // ============================================================================

  describe('Git protocol routes', () => {
    it('should route /:namespace/info/refs to Durable Object', async () => {
      const res = await app.request(
        'http://localhost/my-repo/info/refs?service=git-upload-pack',
        {},
        createOpenEnv(),
      )
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body.forwarded).toBe(true)
      // The namespace prefix should be stripped from the forwarded URL
      const url = body.url as string
      expect(url).toContain('/info/refs')
      expect(url).not.toContain('/my-repo/info/refs')
    })

    it('should route /:namespace/git-upload-pack to Durable Object', async () => {
      const res = await app.request(
        'http://localhost/my-repo/git-upload-pack',
        { method: 'POST' },
        createOpenEnv(),
      )
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body.forwarded).toBe(true)
      const url = body.url as string
      expect(url).toContain('/git-upload-pack')
      expect(url).not.toContain('/my-repo/git-upload-pack')
    })

    it('should route /:namespace/git-receive-pack to Durable Object', async () => {
      const res = await app.request(
        'http://localhost/my-repo/git-receive-pack',
        { method: 'POST' },
        createOpenEnv(),
      )
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body.forwarded).toBe(true)
      const url = body.url as string
      expect(url).toContain('/git-receive-pack')
      expect(url).not.toContain('/my-repo/git-receive-pack')
    })

    it('should preserve query parameters when forwarding to Durable Object', async () => {
      const res = await app.request(
        'http://localhost/my-repo/info/refs?service=git-upload-pack',
        {},
        createOpenEnv(),
      )
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      const url = body.url as string
      expect(url).toContain('service=git-upload-pack')
    })

    it('should require auth for git protocol routes when AUTH_TOKEN is set', async () => {
      const res = await app.request(
        'http://localhost/my-repo/info/refs?service=git-upload-pack',
        {},
        createAuthEnv(),
      )
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toContain('Basic realm="gitx"')
    })

    it('should allow authenticated git protocol requests', async () => {
      const res = await app.request(
        'http://localhost/my-repo/info/refs?service=git-upload-pack',
        { headers: { Authorization: 'Bearer test-secret-token' } },
        createAuthEnv('test-secret-token'),
      )
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body.forwarded).toBe(true)
    })
  })

  // ============================================================================
  // Namespace Routing
  // ============================================================================

  describe('Namespace routing (/:namespace/*)', () => {
    it('should forward arbitrary sub-paths to Durable Object', async () => {
      const res = await app.request(
        'http://localhost/my-namespace/some/deep/path',
        {},
        createOpenEnv(),
      )
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body.forwarded).toBe(true)
      const url = body.url as string
      expect(url).toContain('/some/deep/path')
    })

    it('should handle URL-encoded namespace names', async () => {
      const res = await app.request(
        'http://localhost/my%2Fnamespace/info/refs',
        {},
        createOpenEnv(),
      )
      expect(res.status).toBe(200)

      const body = await res.json() as Record<string, unknown>
      expect(body.forwarded).toBe(true)
    })
  })
})
