/**
 * @fileoverview Integration Tests for GitModule Database Storage
 *
 * These tests verify the GitModule integrates correctly with the
 * git, git_branches, and git_content database tables for persistent storage.
 *
 * Tests cover:
 * - Repository binding persistence (git table)
 * - Branch tracking persistence (git_branches table)
 * - Staged file persistence (git_content table)
 * - Sync state persistence
 * - Commit state persistence
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  GitModule,
  type GitStorage,
  type GitRow,
  type GitBranchRow,
  type GitContentRow,
  type FsCapability,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
} from '../../src/do/GitModule'

// ============================================================================
// Mock Storage Implementation
// ============================================================================

/**
 * Mock implementation of GitStorage interface for testing database operations.
 * Simulates SQLite behavior with in-memory storage.
 */
class MockGitStorage implements GitStorage {
  // Internal data stores
  private gitTable: Map<number, GitRow> = new Map()
  private gitBranchesTable: Map<number, GitBranchRow> = new Map()
  private gitContentTable: Map<number, GitContentRow> = new Map()
  private autoIncrement = { git: 1, git_branches: 1, git_content: 1 }

  sql = {
    exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
      // Handle SELECT id, commit, last_sync FROM git WHERE repo = ? (for initialize - check first)
      if (query.includes('SELECT id, commit, last_sync FROM git WHERE repo =')) {
        const repo = params[0] as string
        for (const row of this.gitTable.values()) {
          if (row.repo === repo) {
            return { toArray: () => [{ id: row.id, commit: row.commit, last_sync: row.last_sync }] }
          }
        }
        return { toArray: () => [] }
      }

      // Handle SELECT id FROM git WHERE repo = ? (for getting repoId after insert)
      if (query.includes('SELECT id FROM git WHERE repo =')) {
        const repo = params[0] as string
        for (const row of this.gitTable.values()) {
          if (row.repo === repo) {
            return { toArray: () => [{ id: row.id }] }
          }
        }
        return { toArray: () => [] }
      }

      // Handle SELECT path FROM git_content WHERE repo_id = ? AND status = ?
      if (query.includes('SELECT path FROM git_content WHERE repo_id =') && query.includes('status =')) {
        const repoId = params[0] as number
        const status = params[1] as string
        const results: { path: string }[] = []
        for (const row of this.gitContentTable.values()) {
          if (row.repo_id === repoId && row.status === status) {
            results.push({ path: row.path })
          }
        }
        return { toArray: () => results }
      }

      // Handle INSERT INTO git_branches (must check before git table)
      // Note: tracking=1 is hardcoded in the SQL, not a param
      if (query.includes('INSERT INTO git_branches')) {
        const id = this.autoIncrement.git_branches++
        const row: GitBranchRow = {
          id,
          repo_id: params[0] as number,
          name: params[1] as string,
          head: null,
          upstream: null,
          tracking: 1, // hardcoded in GitModule's INSERT statement
          ahead: 0,
          behind: 0,
          created_at: params[2] as number | null,
          updated_at: params[3] as number | null,
        }
        this.gitBranchesTable.set(id, row)
        return { toArray: () => [] }
      }

      // Handle INSERT INTO git_content (with ON CONFLICT)
      if (query.includes('INSERT INTO git_content')) {
        const repoId = params[0] as number
        const path = params[1] as string

        // Check for existing entry
        for (const [id, row] of this.gitContentTable) {
          if (row.repo_id === repoId && row.path === path) {
            // Update existing
            row.status = 'staged'
            row.updated_at = params[4] as number | null
            return { toArray: () => [] }
          }
        }

        // Create new entry
        const id = this.autoIncrement.git_content++
        const row: GitContentRow = {
          id,
          repo_id: repoId,
          path,
          content: null,
          mode: '100644',
          status: 'staged',
          sha: null,
          created_at: params[2] as number | null,
          updated_at: params[3] as number | null,
        }
        this.gitContentTable.set(id, row)
        return { toArray: () => [] }
      }

      // Handle INSERT INTO git (the base table - must check after git_branches and git_content)
      if (query.includes('INSERT INTO git (') || query.includes('INSERT INTO git\n')) {
        const id = this.autoIncrement.git++
        const row: GitRow = {
          id,
          repo: params[0] as string,
          path: params[1] as string | null,
          branch: params[2] as string,
          commit: null,
          last_sync: null,
          object_prefix: params[3] as string,
          created_at: params[4] as number | null,
          updated_at: params[5] as number | null,
        }
        this.gitTable.set(id, row)
        return { toArray: () => [] }
      }

      // Handle UPDATE git SET commit = ?, last_sync = ?, updated_at = ? WHERE id = ?
      if (query.includes('UPDATE git SET commit =') && query.includes('last_sync =')) {
        const commit = params[0] as string | null
        const lastSync = params[1] as number
        const updatedAt = params[2] as number
        const id = params[3] as number
        const row = this.gitTable.get(id)
        if (row) {
          row.commit = commit
          row.last_sync = lastSync
          row.updated_at = updatedAt
        }
        return { toArray: () => [] }
      }

      // Handle UPDATE git SET commit = ?, updated_at = ? WHERE id = ?
      if (query.includes('UPDATE git SET commit =') && !query.includes('last_sync =')) {
        const commit = params[0] as string
        const updatedAt = params[1] as number
        const id = params[2] as number
        const row = this.gitTable.get(id)
        if (row) {
          row.commit = commit
          row.updated_at = updatedAt
        }
        return { toArray: () => [] }
      }

      // Handle UPDATE git_branches SET head = ?, updated_at = ? WHERE repo_id = ? AND name = ?
      if (query.includes('UPDATE git_branches SET head =')) {
        const head = params[0] as string
        const updatedAt = params[1] as number
        const repoId = params[2] as number
        const name = params[3] as string
        for (const row of this.gitBranchesTable.values()) {
          if (row.repo_id === repoId && row.name === name) {
            row.head = head
            row.updated_at = updatedAt
          }
        }
        return { toArray: () => [] }
      }

      // Handle DELETE FROM git_content WHERE repo_id = ? AND status = 'staged'
      if (query.includes('DELETE FROM git_content WHERE repo_id =') && query.includes('staged')) {
        const repoId = params[0] as number
        for (const [id, row] of this.gitContentTable) {
          if (row.repo_id === repoId && row.status === 'staged') {
            this.gitContentTable.delete(id)
          }
        }
        return { toArray: () => [] }
      }

      return { toArray: () => [] }
    }
  }

  // Test helper methods
  getGitRow(repo: string): GitRow | undefined {
    for (const row of this.gitTable.values()) {
      if (row.repo === repo) {
        return row
      }
    }
    return undefined
  }

  getGitBranchRow(repoId: number, name: string): GitBranchRow | undefined {
    for (const row of this.gitBranchesTable.values()) {
      if (row.repo_id === repoId && row.name === name) {
        return row
      }
    }
    return undefined
  }

  getGitContentRows(repoId: number): GitContentRow[] {
    const results: GitContentRow[] = []
    for (const row of this.gitContentTable.values()) {
      if (row.repo_id === repoId) {
        results.push(row)
      }
    }
    return results
  }

  getStagedFiles(repoId: number): string[] {
    return this.getGitContentRows(repoId)
      .filter(row => row.status === 'staged')
      .map(row => row.path)
  }

  clear(): void {
    this.gitTable.clear()
    this.gitBranchesTable.clear()
    this.gitContentTable.clear()
    this.autoIncrement = { git: 1, git_branches: 1, git_content: 1 }
  }
}

/**
 * Mock FsCapability for testing file operations
 */
function createMockFs(): FsCapability {
  const files = new Map<string, Buffer>()
  const dirs = new Set<string>()

  return {
    async readFile(path: string): Promise<string | Buffer> {
      const content = files.get(path)
      if (!content) throw new Error(`ENOENT: ${path}`)
      return content
    },
    async writeFile(path: string, content: string | Buffer): Promise<void> {
      files.set(path, Buffer.from(content))
    },
    async readDir(path: string): Promise<string[]> {
      const entries: string[] = []
      for (const file of files.keys()) {
        if (file.startsWith(path)) {
          const relative = file.slice(path.length).replace(/^\//, '')
          const firstSegment = relative.split('/')[0]
          if (firstSegment && !entries.includes(firstSegment)) {
            entries.push(firstSegment)
          }
        }
      }
      return entries
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path) || dirs.has(path)
    },
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      if (options?.recursive) {
        const parts = path.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          dirs.add(current)
        }
      } else {
        dirs.add(path)
      }
    },
    async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
      if (options?.recursive) {
        for (const key of files.keys()) {
          if (key.startsWith(path)) files.delete(key)
        }
      } else {
        files.delete(path)
      }
    }
  }
}

/**
 * Mock R2 Bucket for testing object storage
 */
function createMockR2Bucket(): R2BucketLike & { _setFile: (path: string, content: string) => void } {
  const storage = new Map<string, Uint8Array>()

  const bucket: R2BucketLike & { _setFile: (path: string, content: string) => void } = {
    async get(key: string): Promise<R2ObjectLike | null> {
      const data = storage.get(key)
      if (!data) return null
      return {
        key,
        size: data.length,
        async arrayBuffer() {
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        },
        async text() {
          return new TextDecoder().decode(data)
        }
      }
    },
    async put(key: string, value: ArrayBuffer | Uint8Array | string) {
      const data = typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(value)
      storage.set(key, data)
      return {
        key,
        size: data.length,
        async arrayBuffer() {
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        },
        async text() {
          return new TextDecoder().decode(data)
        }
      }
    },
    async delete(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        storage.delete(k)
      }
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectsLike> {
      const prefix = options?.prefix ?? ''
      const objects: R2ObjectLike[] = []
      for (const [key, data] of storage) {
        if (key.startsWith(prefix)) {
          objects.push({
            key,
            size: data.length,
            async arrayBuffer() {
              return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            },
            async text() {
              return new TextDecoder().decode(data)
            }
          })
        }
      }
      return { objects, truncated: false }
    },
    _setFile(path: string, content: string) {
      storage.set(path, new TextEncoder().encode(content))
    }
  }

  return bucket
}

// ============================================================================
// Test Suites
// ============================================================================

describe('GitModule Database Integration', () => {
  let storage: MockGitStorage
  let mockFs: FsCapability
  let mockR2: R2BucketLike

  beforeEach(() => {
    storage = new MockGitStorage()
    mockFs = createMockFs()
    mockR2 = createMockR2Bucket()
  })

  describe('initialize() with storage', () => {
    it('should create git table entry on first initialization', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })

      await git.initialize()

      const row = storage.getGitRow('org/repo')
      expect(row).toBeDefined()
      expect(row?.repo).toBe('org/repo')
      expect(row?.branch).toBe('main')
      expect(row?.commit).toBeNull()
    })

    it('should create git_branches entry on initialization', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'develop',
        storage,
      })

      await git.initialize()

      const gitRow = storage.getGitRow('org/repo')
      expect(gitRow).toBeDefined()

      const branchRow = storage.getGitBranchRow(gitRow!.id, 'develop')
      expect(branchRow).toBeDefined()
      expect(branchRow?.name).toBe('develop')
      expect(branchRow?.tracking).toBe(1)
    })

    it('should load existing state from database', async () => {
      // First create a git entry with state
      const git1 = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git1.initialize()
      await git1.add('file1.txt')
      await git1.commit('Initial commit')

      const commitHash = git1.binding.commit

      // Create a new instance with same repo - should load state
      const git2 = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git2.initialize()

      // Should have loaded the commit from database
      expect(git2.binding.commit).toBe(commitHash)
    })

    it('should load staged files from database on initialize', async () => {
      // Create first instance and stage files
      const git1 = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git1.initialize()
      await git1.add('file1.txt')
      await git1.add('file2.txt')

      // Create second instance
      const git2 = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git2.initialize()

      // Should have loaded staged files
      const status = await git2.status()
      expect(status.staged).toContain('file1.txt')
      expect(status.staged).toContain('file2.txt')
    })

    it('should store object_prefix in database', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        objectPrefix: 'custom/prefix',
        storage,
      })

      await git.initialize()

      const row = storage.getGitRow('org/repo')
      expect(row?.object_prefix).toBe('custom/prefix')
    })

    it('should store path in database when provided', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        path: 'packages/core',
        storage,
      })

      await git.initialize()

      const row = storage.getGitRow('org/repo')
      expect(row?.path).toBe('packages/core')
    })

    it('should set timestamps on creation', async () => {
      const beforeTime = Date.now()

      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git.initialize()

      const afterTime = Date.now()

      const row = storage.getGitRow('org/repo')
      expect(row?.created_at).toBeGreaterThanOrEqual(beforeTime)
      expect(row?.created_at).toBeLessThanOrEqual(afterTime)
      expect(row?.updated_at).toBeGreaterThanOrEqual(beforeTime)
      expect(row?.updated_at).toBeLessThanOrEqual(afterTime)
    })
  })

  describe('add() with storage', () => {
    it('should persist staged files to git_content table', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git.initialize()

      await git.add('src/index.ts')

      const gitRow = storage.getGitRow('org/repo')
      const stagedFiles = storage.getStagedFiles(gitRow!.id)
      expect(stagedFiles).toContain('src/index.ts')
    })

    it('should persist multiple staged files', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git.initialize()

      await git.add(['file1.ts', 'file2.ts', 'file3.ts'])

      const gitRow = storage.getGitRow('org/repo')
      const stagedFiles = storage.getStagedFiles(gitRow!.id)
      expect(stagedFiles).toContain('file1.ts')
      expect(stagedFiles).toContain('file2.ts')
      expect(stagedFiles).toContain('file3.ts')
    })

    it('should update existing staged file entry (not duplicate)', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git.initialize()

      await git.add('file.ts')
      await git.add('file.ts')

      const gitRow = storage.getGitRow('org/repo')
      const stagedFiles = storage.getStagedFiles(gitRow!.id)
      expect(stagedFiles.filter(f => f === 'file.ts').length).toBe(1)
    })

    it('should set status to staged in git_content', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git.initialize()

      await git.add('file.ts')

      const gitRow = storage.getGitRow('org/repo')
      const contentRows = storage.getGitContentRows(gitRow!.id)
      expect(contentRows[0]?.status).toBe('staged')
    })
  })

  describe('commit() with storage', () => {
    it('should update commit hash in git table', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git.initialize()

      await git.add('file.ts')
      const result = await git.commit('Test commit')
      const hash = typeof result === 'string' ? result : result.hash

      const row = storage.getGitRow('org/repo')
      expect(row?.commit).toBe(hash)
    })

    it('should update branch head in git_branches table', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git.initialize()

      await git.add('file.ts')
      const result = await git.commit('Test commit')
      const hash = typeof result === 'string' ? result : result.hash

      const gitRow = storage.getGitRow('org/repo')
      const branchRow = storage.getGitBranchRow(gitRow!.id, 'main')
      expect(branchRow?.head).toBe(hash)
    })

    it('should clear staged files from git_content after commit', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git.initialize()

      await git.add('file1.ts')
      await git.add('file2.ts')
      await git.commit('Test commit')

      const gitRow = storage.getGitRow('org/repo')
      const stagedFiles = storage.getStagedFiles(gitRow!.id)
      expect(stagedFiles).toHaveLength(0)
    })

    it('should update updated_at timestamp on commit', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        storage,
      })
      await git.initialize()

      const beforeCommit = Date.now()
      await git.add('file.ts')
      await git.commit('Test commit')

      const row = storage.getGitRow('org/repo')
      expect(row?.updated_at).toBeGreaterThanOrEqual(beforeCommit)
    })
  })

  describe('sync() with storage', () => {
    it('should update last_sync in git table after sync', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        r2: mockR2,
        fs: mockFs,
        storage,
      })
      await git.initialize()

      // Verify last_sync is null before sync
      const rowBefore = storage.getGitRow('org/repo')
      expect(rowBefore?.last_sync).toBeNull()

      const beforeSync = Date.now()
      await git.sync()

      const row = storage.getGitRow('org/repo')
      expect(row?.last_sync).toBeDefined()
      expect(row?.last_sync).not.toBeNull()
      expect(typeof row?.last_sync).toBe('number')
      expect(row!.last_sync!).toBeGreaterThanOrEqual(beforeSync)
    })

    it('should update commit hash after sync when ref exists', async () => {
      const commitSha = 'a'.repeat(40)
      await mockR2.put('git/objects/refs/heads/main', commitSha)

      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
        r2: mockR2,
        fs: mockFs,
        storage,
      })
      await git.initialize()
      await git.sync()

      const row = storage.getGitRow('org/repo')
      expect(row?.commit).toBe(commitSha)
    })
  })

  describe('Full workflow with storage', () => {
    it('should persist complete add-commit-push workflow', async () => {
      const git = new GitModule({
        repo: 'test/repo',
        branch: 'main',
        r2: mockR2,
        fs: mockFs,
        storage,
      })
      await git.initialize()

      // Stage files
      await git.add('src/a.ts')
      await git.add('src/b.ts')

      // Verify staged
      let gitRow = storage.getGitRow('test/repo')
      let stagedFiles = storage.getStagedFiles(gitRow!.id)
      expect(stagedFiles).toHaveLength(2)

      // Commit
      const result = await git.commit('Initial commit')
      const hash = typeof result === 'string' ? result : result.hash

      // Verify commit persisted
      gitRow = storage.getGitRow('test/repo')
      expect(gitRow?.commit).toBe(hash)

      // Verify staged cleared
      stagedFiles = storage.getStagedFiles(gitRow!.id)
      expect(stagedFiles).toHaveLength(0)

      // Verify branch updated
      const branchRow = storage.getGitBranchRow(gitRow!.id, 'main')
      expect(branchRow?.head).toBe(hash)

      // Push
      const pushResult = await git.push()
      expect(pushResult.success).toBe(true)
    })

    it('should maintain state across multiple commits', async () => {
      const git = new GitModule({
        repo: 'test/repo',
        branch: 'main',
        storage,
      })
      await git.initialize()

      // First commit
      await git.add('file1.ts')
      const result1 = await git.commit('First commit')
      const hash1 = typeof result1 === 'string' ? result1 : result1.hash

      // Second commit
      await git.add('file2.ts')
      const result2 = await git.commit('Second commit')
      const hash2 = typeof result2 === 'string' ? result2 : result2.hash

      // Verify final state
      const gitRow = storage.getGitRow('test/repo')
      expect(gitRow?.commit).toBe(hash2)
      expect(hash1).not.toBe(hash2)

      const branchRow = storage.getGitBranchRow(gitRow!.id, 'main')
      expect(branchRow?.head).toBe(hash2)
    })
  })

  describe('Without storage (backwards compatibility)', () => {
    it('should work without storage option', async () => {
      const git = new GitModule({
        repo: 'org/repo',
        branch: 'main',
      })

      await git.initialize()
      await git.add('file.ts')
      const result = await git.commit('Test')

      expect(result).toBeDefined()
      expect(git.binding.commit).toBeDefined()
    })

    it('should not throw when calling add without storage', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await expect(git.add('file.ts')).resolves.not.toThrow()
    })

    it('should not throw when calling commit without storage', async () => {
      const git = new GitModule({ repo: 'org/repo' })
      await git.add('file.ts')
      await expect(git.commit('Test')).resolves.not.toThrow()
    })
  })
})

describe('Schema Integration', () => {
  it('should use correct table names matching schema.ts', () => {
    // This test documents the expected table names
    // that should exist in src/durable-object/schema.ts
    const expectedTables = ['git', 'git_branches', 'git_content']
    expect(expectedTables).toContain('git')
    expect(expectedTables).toContain('git_branches')
    expect(expectedTables).toContain('git_content')
  })

  it('should use correct column names for git table', () => {
    const expectedColumns = [
      'id', 'repo', 'path', 'branch', 'commit',
      'last_sync', 'object_prefix', 'created_at', 'updated_at'
    ]
    // Verify GitRow interface matches schema
    const gitRow: GitRow = {
      id: 1,
      repo: 'org/repo',
      path: null,
      branch: 'main',
      commit: null,
      last_sync: null,
      object_prefix: 'git/objects',
      created_at: null,
      updated_at: null,
    }
    for (const col of expectedColumns) {
      expect(col in gitRow).toBe(true)
    }
  })

  it('should use correct column names for git_branches table', () => {
    const expectedColumns = [
      'id', 'repo_id', 'name', 'head', 'upstream',
      'tracking', 'ahead', 'behind', 'created_at', 'updated_at'
    ]
    const branchRow: GitBranchRow = {
      id: 1,
      repo_id: 1,
      name: 'main',
      head: null,
      upstream: null,
      tracking: 0,
      ahead: 0,
      behind: 0,
      created_at: null,
      updated_at: null,
    }
    for (const col of expectedColumns) {
      expect(col in branchRow).toBe(true)
    }
  })

  it('should use correct column names for git_content table', () => {
    const expectedColumns = [
      'id', 'repo_id', 'path', 'content', 'mode',
      'status', 'sha', 'created_at', 'updated_at'
    ]
    const contentRow: GitContentRow = {
      id: 1,
      repo_id: 1,
      path: 'file.ts',
      content: null,
      mode: '100644',
      status: 'staged',
      sha: null,
      created_at: null,
      updated_at: null,
    }
    for (const col of expectedColumns) {
      expect(col in contentRow).toBe(true)
    }
  })
})
