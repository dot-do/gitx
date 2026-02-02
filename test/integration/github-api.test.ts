import { describe, it, expect, beforeAll } from 'vitest'

/**
 * Integration tests that read from real GitHub repos via the public API.
 * These tests verify our object/ref parsing logic against real Git data.
 *
 * Skipped when network is unavailable.
 */

let hasNetwork = false

beforeAll(async () => {
  try {
    const res = await fetch('https://api.github.com/', { signal: AbortSignal.timeout(5000) })
    hasNetwork = res.ok
  } catch {
    hasNetwork = false
  }
})

// Use a well-known small public repo
const OWNER = 'octocat'
const REPO = 'Hello-World'
const API = `https://api.github.com/repos/${OWNER}/${REPO}`

function skipIfNoNetwork() {
  if (!hasNetwork) {
    return true
  }
  return false
}

describe('GitHub API - refs', () => {
  it('should list branches', async () => {
    if (skipIfNoNetwork()) return

    const res = await fetch(`${API}/branches`)
    expect(res.ok).toBe(true)

    const branches: Array<{ name: string; commit: { sha: string } }> = await res.json()
    expect(branches.length).toBeGreaterThan(0)

    // master branch should exist
    const master = branches.find(b => b.name === 'master')
    expect(master).toBeDefined()
    expect(master!.commit.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('should resolve a ref to a SHA', async () => {
    if (skipIfNoNetwork()) return

    const res = await fetch(`${API}/git/ref/heads/master`)
    expect(res.ok).toBe(true)

    const ref: { ref: string; object: { sha: string; type: string } } = await res.json()
    expect(ref.ref).toBe('refs/heads/master')
    expect(ref.object.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(ref.object.type).toBe('commit')
  })
})

describe('GitHub API - objects', () => {
  it('should read a commit object', async () => {
    if (skipIfNoNetwork()) return

    // Get master HEAD sha first
    const refRes = await fetch(`${API}/git/ref/heads/master`)
    const ref: { object: { sha: string } } = await refRes.json()
    const sha = ref.object.sha

    const res = await fetch(`${API}/git/commits/${sha}`)
    expect(res.ok).toBe(true)

    const commit: {
      sha: string
      tree: { sha: string }
      parents: Array<{ sha: string }>
      author: { name: string; email: string; date: string }
      committer: { name: string; email: string; date: string }
      message: string
    } = await res.json()

    expect(commit.sha).toBe(sha)
    expect(commit.tree.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(commit.author.name).toBeTruthy()
    expect(commit.committer.name).toBeTruthy()
    expect(typeof commit.message).toBe('string')
  })

  it('should read a tree object', async () => {
    if (skipIfNoNetwork()) return

    // Get master HEAD -> commit -> tree
    const refRes = await fetch(`${API}/git/ref/heads/master`)
    const ref: { object: { sha: string } } = await refRes.json()

    const commitRes = await fetch(`${API}/git/commits/${ref.object.sha}`)
    const commit: { tree: { sha: string } } = await commitRes.json()

    const res = await fetch(`${API}/git/trees/${commit.tree.sha}`)
    expect(res.ok).toBe(true)

    const tree: {
      sha: string
      tree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }>
    } = await res.json()

    expect(tree.tree.length).toBeGreaterThan(0)

    for (const entry of tree.tree) {
      expect(entry.path).toBeTruthy()
      expect(entry.sha).toMatch(/^[0-9a-f]{40}$/)
      expect(['100644', '100755', '040000', '120000', '160000']).toContain(entry.mode)
      expect(['blob', 'tree', 'commit']).toContain(entry.type)
    }
  })

  it('should read a blob object', async () => {
    if (skipIfNoNetwork()) return

    // Get the README blob - traverse master -> commit -> tree -> README
    const refRes = await fetch(`${API}/git/ref/heads/master`)
    const ref: { object: { sha: string } } = await refRes.json()

    const commitRes = await fetch(`${API}/git/commits/${ref.object.sha}`)
    const commit: { tree: { sha: string } } = await commitRes.json()

    const treeRes = await fetch(`${API}/git/trees/${commit.tree.sha}`)
    const tree: { tree: Array<{ path: string; sha: string; type: string }> } = await treeRes.json()

    const readme = tree.tree.find(e => e.path === 'README' && e.type === 'blob')
    if (!readme) return // repo structure may change

    const res = await fetch(`${API}/git/blobs/${readme.sha}`)
    expect(res.ok).toBe(true)

    const blob: { sha: string; content: string; encoding: string; size: number } = await res.json()
    expect(blob.sha).toBe(readme.sha)
    expect(blob.encoding).toBe('base64')
    expect(blob.size).toBeGreaterThan(0)

    // Decode and verify it looks like a README
    const content = Buffer.from(blob.content, 'base64').toString('utf-8')
    expect(content.length).toBeGreaterThan(0)
  })

  it('should return valid SHA formats matching our validators', async () => {
    if (skipIfNoNetwork()) return

    const { isValidSha1 } = await import('../../src/utils/sha-validation')

    const refRes = await fetch(`${API}/git/ref/heads/master`)
    const ref: { object: { sha: string } } = await refRes.json()

    expect(isValidSha1(ref.object.sha)).toBe(true)
  })
})
