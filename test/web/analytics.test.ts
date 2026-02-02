/**
 * Tests for src/web/analytics.ts - Analytics dashboard and data gathering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { setupAnalyticsRoutes } from '../../src/web/analytics'
import type { CommitObject, TreeObject } from '../../src/types/objects'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommit(overrides: Partial<CommitObject> = {}): CommitObject {
  return {
    type: 'commit',
    data: new Uint8Array(),
    tree: 'aaaa000000000000000000000000000000000000',
    parents: [],
    author: { name: 'Alice', email: 'alice@example.com', timestamp: 1700000000, timezoneOffset: 0 },
    committer: { name: 'Alice', email: 'alice@example.com', timestamp: 1700000000, timezoneOffset: 0 },
    message: 'test commit',
    ...overrides,
  }
}

function createMockStore(options: {
  refs?: Record<string, string>
  commits?: Record<string, CommitObject>
  trees?: Record<string, TreeObject>
} = {}) {
  const { refs = {}, commits = {}, trees = {} } = options

  return {
    getRef: vi.fn(async (name: string) => refs[name] ?? null),
    getTree: vi.fn(async (sha: string) => trees[sha] ?? null),
    getCommit: vi.fn(async (sha: string) => commits[sha] ?? null),
    getObject: vi.fn(async () => null),
    putObject: vi.fn(async () => {}),
    hasObject: vi.fn(async () => false),
    putRef: vi.fn(async () => {}),
    deleteRef: vi.fn(async () => {}),
    listRefs: vi.fn(async () => []),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('web/analytics - setupAnalyticsRoutes', () => {
  describe('GET /analytics', () => {
    it('should return HTML dashboard with empty data when no HEAD ref', async () => {
      const store = createMockStore()
      const app = new Hono()
      setupAnalyticsRoutes(app as any, () => ({ getObjectStore: () => store as any }))

      const res = await app.request('/analytics')
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('Repository Analytics')
      expect(html).toContain('0') // 0 commits
    })

    it('should render dashboard with commit and contributor data', async () => {
      const headSha = 'head000000000000000000000000000000000000'
      const treeSha = 'tree000000000000000000000000000000000000'

      const store = createMockStore({
        refs: { 'refs/heads/main': headSha },
        commits: {
          [headSha]: makeCommit({
            tree: treeSha,
            message: 'Latest commit',
            author: { name: 'Alice', email: 'alice@example.com', timestamp: 1700000000, timezoneOffset: 0 },
          }),
        },
        trees: {
          [treeSha]: {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              { mode: '100644', name: 'index.ts', sha: 'f000000000000000000000000000000000000000' },
              { mode: '100644', name: 'README.md', sha: 'f100000000000000000000000000000000000000' },
            ],
          },
        },
      })

      const app = new Hono()
      setupAnalyticsRoutes(app as any, () => ({ getObjectStore: () => store as any }))

      const res = await app.request('/analytics')
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('Repository Analytics')
      expect(html).toContain('Alice')
      expect(html).toContain('1') // 1 commit
    })

    it('should return 500 with error message on failure', async () => {
      const store = createMockStore()
      store.getRef.mockRejectedValue(new Error('Database unavailable'))

      const app = new Hono()
      setupAnalyticsRoutes(app as any, () => ({ getObjectStore: () => store as any }))

      const res = await app.request('/analytics')
      expect(res.status).toBe(500)
      const html = await res.text()
      expect(html).toContain('Database unavailable')
    })
  })

  describe('GET /analytics/data - JSON API', () => {
    it('should return empty analytics JSON when no refs exist', async () => {
      const store = createMockStore()
      const app = new Hono()
      setupAnalyticsRoutes(app as any, () => ({ getObjectStore: () => store as any }))

      const res = await app.request('/analytics/data')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({
        commitFrequency: [],
        contributors: [],
        languages: [],
        fileChanges: [],
        churn: [],
        totalCommits: 0,
        totalContributors: 0,
      })
    })

    it('should return analytics data with commits', async () => {
      const headSha = 'head000000000000000000000000000000000000'
      const parentSha = 'par0000000000000000000000000000000000000'
      const treeSha1 = 'tre1000000000000000000000000000000000000'
      const treeSha2 = 'tre2000000000000000000000000000000000000'

      const store = createMockStore({
        refs: { 'refs/heads/main': headSha },
        commits: {
          [headSha]: makeCommit({
            tree: treeSha1,
            parents: [parentSha],
            message: 'Second commit',
            author: { name: 'Alice', email: 'alice@example.com', timestamp: 1700100000, timezoneOffset: 0 },
          }),
          [parentSha]: makeCommit({
            tree: treeSha2,
            parents: [],
            message: 'Initial commit',
            author: { name: 'Bob', email: 'bob@test.com', timestamp: 1700000000, timezoneOffset: 0 },
          }),
        },
        trees: {
          [treeSha1]: {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              { mode: '100644', name: 'app.ts', sha: 'a000000000000000000000000000000000000000' },
              { mode: '100644', name: 'lib.py', sha: 'b000000000000000000000000000000000000000' },
            ],
          },
          [treeSha2]: {
            type: 'tree',
            data: new Uint8Array(),
            entries: [
              { mode: '100644', name: 'app.ts', sha: 'c000000000000000000000000000000000000000' },
            ],
          },
        },
      })

      const app = new Hono()
      setupAnalyticsRoutes(app as any, () => ({ getObjectStore: () => store as any }))

      const res = await app.request('/analytics/data')
      expect(res.status).toBe(200)
      const data = await res.json() as any

      expect(data.totalCommits).toBe(2)
      expect(data.totalContributors).toBe(2)
      expect(data.contributors).toHaveLength(2)
      expect(data.contributors[0].commits).toBe(1)

      // Languages detected from tree at HEAD
      expect(data.languages.length).toBeGreaterThan(0)
      const langNames = data.languages.map((l: any) => l.language)
      expect(langNames).toContain('TypeScript')

      // Commit frequency buckets
      expect(data.commitFrequency.length).toBeGreaterThan(0)

      // File changes - app.ts sha changed between commits
      expect(data.fileChanges.length).toBeGreaterThan(0)
    })

    it('should return 500 JSON on error', async () => {
      const store = createMockStore()
      store.getRef.mockRejectedValue(new Error('Boom'))

      const app = new Hono()
      setupAnalyticsRoutes(app as any, () => ({ getObjectStore: () => store as any }))

      const res = await app.request('/analytics/data')
      expect(res.status).toBe(500)
      const data = await res.json() as any
      expect(data.error).toBe('Boom')
    })
  })

  describe('contributor aggregation', () => {
    it('should aggregate commits by email (case-insensitive)', async () => {
      const sha1 = 'sha1000000000000000000000000000000000000'
      const sha2 = 'sha2000000000000000000000000000000000000'
      const treeSha = 'tree000000000000000000000000000000000000'

      const store = createMockStore({
        refs: { 'refs/heads/main': sha1 },
        commits: {
          [sha1]: makeCommit({
            tree: treeSha,
            parents: [sha2],
            author: { name: 'Alice', email: 'Alice@Example.COM', timestamp: 1700100000, timezoneOffset: 0 },
          }),
          [sha2]: makeCommit({
            tree: treeSha,
            parents: [],
            author: { name: 'alice', email: 'alice@example.com', timestamp: 1700000000, timezoneOffset: 0 },
          }),
        },
        trees: {
          [treeSha]: { type: 'tree', data: new Uint8Array(), entries: [] },
        },
      })

      const app = new Hono()
      setupAnalyticsRoutes(app as any, () => ({ getObjectStore: () => store as any }))

      const res = await app.request('/analytics/data')
      const data = await res.json() as any
      // Both commits should be aggregated under the same contributor
      expect(data.totalContributors).toBe(1)
      expect(data.contributors[0].commits).toBe(2)
    })
  })
})
