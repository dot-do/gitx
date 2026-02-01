import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryBackend } from '../../src/core/backend'
import { GitBackendRepository } from '../../src/core/repository'
import type { Repository } from '../../src/core/repository'
import type { GitBackend } from '../../src/core/backend'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()

function createRepo(): { repo: Repository; backend: GitBackend } {
  const backend = createMemoryBackend()
  const repo = new GitBackendRepository(backend)
  return { repo, backend }
}

// ============================================================================
// Tests
// ============================================================================

describe('Repository', () => {
  let repo: Repository
  let backend: GitBackend

  beforeEach(() => {
    const ctx = createRepo()
    repo = ctx.repo
    backend = ctx.backend
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Object operations
  // ─────────────────────────────────────────────────────────────────────────

  describe('object operations', () => {
    it('should store and retrieve a blob', async () => {
      const content = encoder.encode('Hello, World!')
      const sha = await repo.storeObject('blob', content)

      expect(sha).toMatch(/^[0-9a-f]{40}$/)

      const obj = await repo.getObject(sha)
      expect(obj).not.toBeNull()
      expect(obj!.type).toBe('blob')
      expect(new TextDecoder().decode(obj!.data)).toBe('Hello, World!')
    })

    it('should return null for non-existent object', async () => {
      const sha = 'a'.repeat(40)
      const obj = await repo.getObject(sha)
      expect(obj).toBeNull()
    })

    it('should check object existence', async () => {
      const content = encoder.encode('test')
      const sha = await repo.storeObject('blob', content)

      expect(await repo.hasObject(sha)).toBe(true)
      expect(await repo.hasObject('b'.repeat(40))).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Ref operations
  // ─────────────────────────────────────────────────────────────────────────

  describe('ref operations', () => {
    it('should set and get a ref', async () => {
      const sha = 'a'.repeat(40)
      await repo.setRef('refs/heads/main', sha)

      const result = await repo.getRef('refs/heads/main')
      expect(result).toBe(sha)
    })

    it('should return null for non-existent ref', async () => {
      const result = await repo.getRef('refs/heads/nonexistent')
      expect(result).toBeNull()
    })

    it('should delete a ref', async () => {
      const sha = 'a'.repeat(40)
      await repo.setRef('refs/heads/feature', sha)

      const deleted = await repo.deleteRef('refs/heads/feature')
      expect(deleted).toBe(true)

      const result = await repo.getRef('refs/heads/feature')
      expect(result).toBeNull()
    })

    it('should return false when deleting non-existent ref', async () => {
      const deleted = await repo.deleteRef('refs/heads/nonexistent')
      expect(deleted).toBe(false)
    })

    it('should list refs by prefix', async () => {
      const sha1 = 'a'.repeat(40)
      const sha2 = 'b'.repeat(40)
      await repo.setRef('refs/heads/main', sha1)
      await repo.setRef('refs/heads/feature', sha2)
      await repo.setRef('refs/tags/v1.0', sha1)

      const branches = await repo.listRefs('refs/heads/')
      expect(branches).toHaveLength(2)
      expect(branches.map((r) => r.name).sort()).toEqual([
        'refs/heads/feature',
        'refs/heads/main',
      ])

      const tags = await repo.listRefs('refs/tags/')
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('refs/tags/v1.0')
    })

    it('should list all refs without prefix', async () => {
      const sha = 'a'.repeat(40)
      await repo.setRef('refs/heads/main', sha)
      await repo.setRef('refs/tags/v1.0', sha)

      const all = await repo.listRefs()
      expect(all).toHaveLength(2)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // High-level operations
  // ─────────────────────────────────────────────────────────────────────────

  describe('getCommit', () => {
    it('should parse a stored commit', async () => {
      const commitContent = encoder.encode(
        `tree ${'a'.repeat(40)}\n` +
        `author Test User <test@example.com> 1704067200 +0000\n` +
        `committer Test User <test@example.com> 1704067200 +0000\n` +
        `\n` +
        `Initial commit`
      )
      const sha = await repo.storeObject('commit', commitContent)
      const commit = await repo.getCommit(sha)

      expect(commit).not.toBeNull()
      expect(commit!.type).toBe('commit')
      expect(commit!.tree).toBe('a'.repeat(40))
      expect(commit!.parents).toEqual([])
      expect(commit!.author.name).toBe('Test User')
      expect(commit!.message).toBe('Initial commit')
    })

    it('should return null for non-commit object', async () => {
      const sha = await repo.storeObject('blob', encoder.encode('not a commit'))
      const commit = await repo.getCommit(sha)
      expect(commit).toBeNull()
    })

    it('should return null for non-existent SHA', async () => {
      const commit = await repo.getCommit('f'.repeat(40))
      expect(commit).toBeNull()
    })
  })

  describe('getTree', () => {
    it('should parse a stored tree', async () => {
      // Build a valid Git tree binary format:
      // Each entry: "{mode} {name}\0{20-byte-sha}"
      const name = 'README.md'
      const mode = '100644'
      const entrySha = new Uint8Array(20).fill(0xaa)

      const header = encoder.encode(`${mode} ${name}\0`)
      const treeData = new Uint8Array(header.length + 20)
      treeData.set(header)
      treeData.set(entrySha, header.length)

      const sha = await repo.storeObject('tree', treeData)
      const entries = await repo.getTree(sha)

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('README.md')
      expect(entries[0].mode).toBe('100644')
    })

    it('should return empty array for non-tree object', async () => {
      const sha = await repo.storeObject('blob', encoder.encode('not a tree'))
      const entries = await repo.getTree(sha)
      expect(entries).toEqual([])
    })

    it('should return empty array for non-existent SHA', async () => {
      const entries = await repo.getTree('f'.repeat(40))
      expect(entries).toEqual([])
    })
  })

  describe('log', () => {
    it('should walk commit history from a ref', async () => {
      // Create root commit (no parents)
      const rootContent = encoder.encode(
        `tree ${'a'.repeat(40)}\n` +
        `author Test <t@t.com> 1000000 +0000\n` +
        `committer Test <t@t.com> 1000000 +0000\n` +
        `\n` +
        `root commit`
      )
      const rootSha = await repo.storeObject('commit', rootContent)

      // Create child commit with parent
      const childContent = encoder.encode(
        `tree ${'b'.repeat(40)}\n` +
        `parent ${rootSha}\n` +
        `author Test <t@t.com> 2000000 +0000\n` +
        `committer Test <t@t.com> 2000000 +0000\n` +
        `\n` +
        `child commit`
      )
      const childSha = await repo.storeObject('commit', childContent)

      await repo.setRef('refs/heads/main', childSha)

      const commits = await repo.log('refs/heads/main')

      expect(commits).toHaveLength(2)
      expect(commits[0].message).toBe('child commit')
      expect(commits[1].message).toBe('root commit')
    })

    it('should respect the limit parameter', async () => {
      const rootContent = encoder.encode(
        `tree ${'a'.repeat(40)}\n` +
        `author Test <t@t.com> 1000000 +0000\n` +
        `committer Test <t@t.com> 1000000 +0000\n` +
        `\n` +
        `root`
      )
      const rootSha = await repo.storeObject('commit', rootContent)

      const childContent = encoder.encode(
        `tree ${'b'.repeat(40)}\n` +
        `parent ${rootSha}\n` +
        `author Test <t@t.com> 2000000 +0000\n` +
        `committer Test <t@t.com> 2000000 +0000\n` +
        `\n` +
        `child`
      )
      const childSha = await repo.storeObject('commit', childContent)

      await repo.setRef('refs/heads/main', childSha)

      const commits = await repo.log('refs/heads/main', 1)
      expect(commits).toHaveLength(1)
      expect(commits[0].message).toBe('child')
    })

    it('should accept a raw SHA instead of a ref', async () => {
      const commitContent = encoder.encode(
        `tree ${'a'.repeat(40)}\n` +
        `author Test <t@t.com> 1000000 +0000\n` +
        `committer Test <t@t.com> 1000000 +0000\n` +
        `\n` +
        `direct sha`
      )
      const sha = await repo.storeObject('commit', commitContent)

      const commits = await repo.log(sha)
      expect(commits).toHaveLength(1)
      expect(commits[0].message).toBe('direct sha')
    })

    it('should return empty array for non-existent ref', async () => {
      const commits = await repo.log('refs/heads/nonexistent')
      expect(commits).toEqual([])
    })

    it('should not visit the same commit twice (diamond merges)', async () => {
      // Create a diamond history: A <- B, A <- C, B+C <- D
      const commitA = encoder.encode(
        `tree ${'a'.repeat(40)}\n` +
        `author Test <t@t.com> 1000000 +0000\n` +
        `committer Test <t@t.com> 1000000 +0000\n` +
        `\n` +
        `A`
      )
      const shaA = await repo.storeObject('commit', commitA)

      const commitB = encoder.encode(
        `tree ${'b'.repeat(40)}\n` +
        `parent ${shaA}\n` +
        `author Test <t@t.com> 2000000 +0000\n` +
        `committer Test <t@t.com> 2000000 +0000\n` +
        `\n` +
        `B`
      )
      const shaB = await repo.storeObject('commit', commitB)

      const commitC = encoder.encode(
        `tree ${'c'.repeat(40)}\n` +
        `parent ${shaA}\n` +
        `author Test <t@t.com> 2000000 +0000\n` +
        `committer Test <t@t.com> 2000000 +0000\n` +
        `\n` +
        `C`
      )
      const shaC = await repo.storeObject('commit', commitC)

      const commitD = encoder.encode(
        `tree ${'d'.repeat(40)}\n` +
        `parent ${shaB}\n` +
        `parent ${shaC}\n` +
        `author Test <t@t.com> 3000000 +0000\n` +
        `committer Test <t@t.com> 3000000 +0000\n` +
        `\n` +
        `D`
      )
      const shaD = await repo.storeObject('commit', commitD)

      const commits = await repo.log(shaD)

      // Should have exactly 4 commits: D, B, C, A (no duplicates)
      expect(commits).toHaveLength(4)
      const messages = commits.map((c) => c.message)
      expect(messages).toContain('A')
      expect(messages).toContain('B')
      expect(messages).toContain('C')
      expect(messages).toContain('D')
      // No duplicates
      expect(new Set(messages).size).toBe(4)
    })
  })
})
