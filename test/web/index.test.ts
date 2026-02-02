/**
 * Tests for src/web/index.ts - Web UI route handlers and utility functions
 *
 * Since the utility functions (escapeHtml, timeAgo, fileIcon, etc.) are not
 * exported directly, we test them indirectly through the route handlers
 * by setting up a Hono app with setupWebRoutes and making requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { setupWebRoutes } from '../../src/web/index'
import type { CommitObject, TreeObject } from '../../src/types/objects'

// ---------------------------------------------------------------------------
// Mock GitRepoDOInstance
// ---------------------------------------------------------------------------

function createMockInstance(options: {
  refs?: Array<{ name: string; sha: string }>
  commits?: Record<string, CommitObject>
  trees?: Record<string, TreeObject>
  blobs?: Record<string, { type: 'blob'; data: Uint8Array }>
} = {}) {
  const { refs = [], commits = {}, trees = {}, blobs = {} } = options

  const mockStore = {
    getCommitObject: vi.fn(async (sha: string) => commits[sha] ?? null),
    getTreeObject: vi.fn(async (sha: string) => trees[sha] ?? null),
    getBlobObject: vi.fn(async (sha: string) => blobs[sha] ?? null),
  }

  const sqlExec = vi.fn((query: string, ...args: unknown[]) => {
    if (query.includes('SELECT sha FROM refs WHERE name = ?')) {
      const ref = refs.find((r) => r.name === args[0])
      return { toArray: () => (ref ? [{ sha: ref.sha }] : []) }
    }
    if (query.includes('SELECT name, sha FROM refs')) {
      return { toArray: () => refs }
    }
    return { toArray: () => [] }
  })

  const instance = {
    getObjectStore: () => mockStore,
    getSchemaManager: () => ({}),
    getStorage: () => ({ sql: { exec: sqlExec } }),
  }

  return { instance, mockStore, sqlExec }
}

function makeCommit(overrides: Partial<CommitObject> = {}): CommitObject {
  return {
    type: 'commit',
    data: new Uint8Array(),
    tree: 'aaaa000000000000000000000000000000000000',
    parents: [],
    author: { name: 'Alice', email: 'alice@example.com', timestamp: 1700000000, timezoneOffset: 0 },
    committer: { name: 'Alice', email: 'alice@example.com', timestamp: 1700000000, timezoneOffset: 0 },
    message: 'Initial commit',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('web/index - setupWebRoutes', () => {
  let app: Hono
  let mockStore: ReturnType<typeof createMockInstance>['mockStore']

  describe('GET /web - repository overview', () => {
    it('should render overview page with branches and tags', async () => {
      const { instance } = createMockInstance({
        refs: [
          { name: 'refs/heads/main', sha: 'abc1234567890000000000000000000000000000' },
          { name: 'refs/heads/feature', sha: 'def1234567890000000000000000000000000000' },
          { name: 'refs/tags/v1.0', sha: 'tag1234567890000000000000000000000000000' },
        ],
      })

      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request('/web')
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('main')
      expect(html).toContain('feature')
      expect(html).toContain('v1.0')
      expect(html).toContain('Branches')
      expect(html).toContain('Tags')
    })

    it('should show empty state when no branches exist', async () => {
      const { instance } = createMockInstance({ refs: [] })
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request('/web')
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('No branches found')
    })

    it('should escape HTML in branch names', async () => {
      const { instance } = createMockInstance({
        refs: [
          { name: 'refs/heads/<script>alert(1)</script>', sha: 'abc1234567890000000000000000000000000000' },
        ],
      })
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request('/web')
      const html = await res.text()
      expect(html).not.toContain('<script>alert(1)</script>')
      expect(html).toContain('&lt;script&gt;')
    })
  })

  describe('GET /web/log - commit log', () => {
    it('should show empty state when ref not found', async () => {
      const { instance } = createMockInstance({ refs: [] })
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request('/web/log')
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('No commits found')
    })

    it('should list commits for the default ref', async () => {
      const commitSha = 'abc1234567890000000000000000000000000000'
      const { instance } = createMockInstance({
        refs: [{ name: 'refs/heads/main', sha: commitSha }],
        commits: {
          [commitSha]: makeCommit({ message: 'Add feature X' }),
        },
      })
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request('/web/log')
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('Add feature X')
      expect(html).toContain('Alice')
      expect(html).toContain('abc1234')
    })

    it('should accept a custom ref query parameter', async () => {
      const commitSha = 'bbb1234567890000000000000000000000000000'
      const { instance } = createMockInstance({
        refs: [{ name: 'refs/heads/dev', sha: commitSha }],
        commits: {
          [commitSha]: makeCommit({ message: 'Dev branch commit' }),
        },
      })
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request('/web/log?ref=refs/heads/dev')
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('Dev branch commit')
    })
  })

  describe('GET /web/commit/:sha - commit detail', () => {
    it('should return 404 for unknown commit', async () => {
      const { instance } = createMockInstance()
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request('/web/commit/0000000000000000000000000000000000000000')
      expect(res.status).toBe(404)
      const html = await res.text()
      expect(html).toContain('not found')
    })

    it('should render commit details', async () => {
      const sha = 'abc1234567890000000000000000000000000000'
      const treeSha = 'tree234567890000000000000000000000000000'
      const { instance } = createMockInstance({
        commits: {
          [sha]: makeCommit({
            tree: treeSha,
            message: 'Fix bug in parser\n\nDetailed description here.',
            author: { name: 'Bob', email: 'bob@test.com', timestamp: 1700000000, timezoneOffset: -300 },
          }),
        },
        trees: {
          [treeSha]: { type: 'tree', data: new Uint8Array(), entries: [] },
        },
      })
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request(`/web/commit/${sha}`)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('Fix bug in parser')
      expect(html).toContain('Bob')
      expect(html).toContain('bob@test.com')
      // Multi-line message should show full message block
      expect(html).toContain('Detailed description here.')
    })
  })

  describe('GET /web/tree/:ref - tree viewer', () => {
    it('should return 404 for unknown ref', async () => {
      const { instance } = createMockInstance({ refs: [] })
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request('/web/tree/nonexistent')
      expect(res.status).toBe(404)
    })

    it('should render tree entries sorted dirs-first', async () => {
      const commitSha = 'ccc1234567890000000000000000000000000000'
      const treeSha = 'ttt1234567890000000000000000000000000000'
      const { instance } = createMockInstance({
        refs: [{ name: 'refs/heads/main', sha: commitSha }],
        commits: {
          [commitSha]: makeCommit({ tree: treeSha }),
        },
        trees: {
          [treeSha]: {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              { mode: '100644', name: 'README.md', sha: 'bbb0000000000000000000000000000000000000' },
              { mode: '040000', name: 'src', sha: 'ddd0000000000000000000000000000000000000' },
              { mode: '100644', name: 'index.ts', sha: 'eee0000000000000000000000000000000000000' },
            ],
          },
        },
      })
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request('/web/tree/main')
      expect(res.status).toBe(200)
      const html = await res.text()
      // All entries present
      expect(html).toContain('src')
      expect(html).toContain('README.md')
      expect(html).toContain('index.ts')
      // Directory icon for src (folder emoji codepoint)
      expect(html).toContain('&#128193;')
    })
  })

  describe('GET /web/blob/:sha - raw blob viewer', () => {
    it('should return 404 for unknown blob', async () => {
      const { instance } = createMockInstance()
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request('/web/blob/0000000000000000000000000000000000000000')
      expect(res.status).toBe(404)
      const html = await res.text()
      expect(html).toContain('Blob not found')
    })

    it('should render text blob with line numbers', async () => {
      const sha = 'blob234567890000000000000000000000000000'
      const content = 'line one\nline two\nline three\n'
      const { instance } = createMockInstance({
        blobs: {
          [sha]: { type: 'blob', data: new TextEncoder().encode(content) },
        },
      })
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request(`/web/blob/${sha}`)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('line one')
      expect(html).toContain('line two')
      // Line numbers
      expect(html).toContain('>1<')
      expect(html).toContain('>2<')
      expect(html).toContain('>3<')
    })

    it('should show binary message for binary content', async () => {
      const sha = 'bin1234567890000000000000000000000000000'
      const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a])
      const { instance } = createMockInstance({
        blobs: {
          [sha]: { type: 'blob', data },
        },
      })
      app = new Hono()
      setupWebRoutes(app as any, instance as any)

      const res = await app.request(`/web/blob/${sha}`)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('Binary file')
    })
  })
})
