import { describe, it, expect, vi } from 'vitest'
import {
  searchToolDefinition,
  createSearchHandler,
  SearchInput
} from '../../../src/mcp/tools/search'
import type { GitBinding } from '../../../src/mcp/tools/do'

describe('MCP search Tool', () => {
  function createMockGit(): GitBinding {
    return {
      status: vi.fn().mockResolvedValue({
        branch: 'main',
        staged: [],
        unstaged: [],
        clean: true
      }),
      log: vi.fn().mockResolvedValue({
        commits: [
          { sha: 'abc123', message: 'feat: add new feature', author: 'Test Author', date: '2025-01-01' },
          { sha: 'def456', message: 'fix: bug fix', author: 'Test Author', date: '2025-01-02' }
        ]
      }),
      diff: vi.fn().mockResolvedValue(''),
      show: vi.fn().mockResolvedValue({}),
      commit: vi.fn().mockResolvedValue({ sha: 'new123' }),
      add: vi.fn().mockResolvedValue(undefined),
      checkout: vi.fn().mockResolvedValue(undefined),
      branch: vi.fn().mockResolvedValue({
        current: 'main',
        branches: [
          { name: 'main', sha: 'abc123' },
          { name: 'feature/new-feature', sha: 'def456' },
          { name: 'bugfix/fix-issue', sha: 'ghi789' }
        ]
      }),
      merge: vi.fn().mockResolvedValue({ merged: true }),
      push: vi.fn().mockResolvedValue({ pushed: true }),
      pull: vi.fn().mockResolvedValue({ pulled: true }),
      fetch: vi.fn().mockResolvedValue({ fetched: true }),
      clone: vi.fn().mockResolvedValue({ cloned: true }),
      init: vi.fn().mockResolvedValue({ initialized: true })
    }
  }

  describe('searchToolDefinition', () => {
    it('should have correct name', () => {
      expect(searchToolDefinition.name).toBe('search')
    })

    it('should have correct description', () => {
      expect(searchToolDefinition.description).toContain('Search')
      expect(searchToolDefinition.description).toContain('commits')
    })

    it('should have query as required parameter', () => {
      expect(searchToolDefinition.inputSchema.required).toContain('query')
    })

    it('should have type parameter with enum values', () => {
      expect(searchToolDefinition.inputSchema.properties.type.enum).toContain('commits')
      expect(searchToolDefinition.inputSchema.properties.type.enum).toContain('branches')
      expect(searchToolDefinition.inputSchema.properties.type.enum).toContain('tags')
      expect(searchToolDefinition.inputSchema.properties.type.enum).toContain('all')
    })

    it('should have limit parameter', () => {
      expect(searchToolDefinition.inputSchema.properties.limit.type).toBe('number')
    })
  })

  describe('createSearchHandler', () => {
    it('should search all types by default', async () => {
      const git = createMockGit()
      const handler = createSearchHandler(git)

      const input: SearchInput = { query: 'feature' }
      const result = await handler(input)

      expect(result.isError).toBeUndefined()
      expect(result.content[0].type).toBe('text')

      const parsed = JSON.parse(result.content[0].text)
      expect(Array.isArray(parsed)).toBe(true)
    })

    it('should search branches', async () => {
      const git = createMockGit()
      const handler = createSearchHandler(git)

      const input: SearchInput = { query: 'feature', type: 'branches' }
      const result = await handler(input)

      expect(result.isError).toBeUndefined()
      const parsed = JSON.parse(result.content[0].text)

      // Should find the feature branch
      const featureBranch = parsed.find((r: { ref: string }) => r.ref.includes('feature'))
      expect(featureBranch).toBeDefined()
      expect(featureBranch.type).toBe('branch')
    })

    it('should search commits', async () => {
      const git = createMockGit()
      const handler = createSearchHandler(git)

      const input: SearchInput = { query: 'add', type: 'commits' }
      const result = await handler(input)

      expect(result.isError).toBeUndefined()
      expect(git.log).toHaveBeenCalledWith({ maxCount: 20, grep: 'add' })
    })

    it('should respect limit parameter', async () => {
      const git = createMockGit()
      const handler = createSearchHandler(git)

      const input: SearchInput = { query: 'test', limit: 5 }
      const result = await handler(input)

      expect(result.isError).toBeUndefined()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.length).toBeLessThanOrEqual(5)
    })

    it('should handle errors gracefully', async () => {
      const git = createMockGit()
      git.log = vi.fn().mockRejectedValue(new Error('Git error'))
      git.branch = vi.fn().mockRejectedValue(new Error('Git error'))

      const handler = createSearchHandler(git)
      const input: SearchInput = { query: 'test' }
      const result = await handler(input)

      expect(result.isError).toBe(true)
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.error).toBeDefined()
    })
  })
})
