import { describe, it, expect, vi } from 'vitest'
import {
  fetchToolDefinition,
  createFetchHandler,
  FetchInput
} from '../../../src/mcp/tools/fetch'
import type { GitBinding } from '../../../src/mcp/tools/do'

describe('MCP fetch Tool', () => {
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
          { sha: 'abc123', message: 'feat: add new feature', author: 'Test Author', date: '2025-01-01' }
        ]
      }),
      diff: vi.fn().mockResolvedValue('diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new'),
      show: vi.fn().mockImplementation((ref: string) => {
        if (ref.includes(':')) {
          // File content request
          return Promise.resolve('file content here')
        }
        // Commit request
        return Promise.resolve({
          sha: ref,
          message: 'Test commit message',
          author: 'Test Author',
          date: '2025-01-01'
        })
      }),
      commit: vi.fn().mockResolvedValue({ sha: 'new123' }),
      add: vi.fn().mockResolvedValue(undefined),
      checkout: vi.fn().mockResolvedValue(undefined),
      branch: vi.fn().mockResolvedValue({
        current: 'main',
        branches: [{ name: 'main', sha: 'abc123' }]
      }),
      merge: vi.fn().mockResolvedValue({ merged: true }),
      push: vi.fn().mockResolvedValue({ pushed: true }),
      pull: vi.fn().mockResolvedValue({ pulled: true }),
      fetch: vi.fn().mockResolvedValue({ fetched: true }),
      clone: vi.fn().mockResolvedValue({ cloned: true }),
      init: vi.fn().mockResolvedValue({ initialized: true })
    }
  }

  describe('fetchToolDefinition', () => {
    it('should have correct name', () => {
      expect(fetchToolDefinition.name).toBe('fetch')
    })

    it('should have correct description', () => {
      expect(fetchToolDefinition.description).toContain('Retrieve')
      expect(fetchToolDefinition.description).toContain('resource')
    })

    it('should have resource as required parameter', () => {
      expect(fetchToolDefinition.inputSchema.required).toContain('resource')
    })

    it('should have format parameter with enum values', () => {
      expect(fetchToolDefinition.inputSchema.properties.format.enum).toContain('json')
      expect(fetchToolDefinition.inputSchema.properties.format.enum).toContain('text')
      expect(fetchToolDefinition.inputSchema.properties.format.enum).toContain('raw')
    })
  })

  describe('createFetchHandler', () => {
    describe('commit fetching', () => {
      it('should fetch commit by SHA', async () => {
        const git = createMockGit()
        const handler = createFetchHandler(git)

        const input: FetchInput = { resource: 'abc123def456789012345678901234567890abcd' }
        const result = await handler(input)

        expect(result.isError).toBeUndefined()
        expect(git.show).toHaveBeenCalled()
      })

      it('should fetch commit by short SHA', async () => {
        const git = createMockGit()
        const handler = createFetchHandler(git)

        const input: FetchInput = { resource: 'abc123d' }
        const result = await handler(input)

        expect(result.isError).toBeUndefined()
        expect(git.show).toHaveBeenCalledWith('abc123d', { format: 'commit' })
      })

      it('should fetch commit by ref name', async () => {
        const git = createMockGit()
        const handler = createFetchHandler(git)

        const input: FetchInput = { resource: 'main' }
        const result = await handler(input)

        expect(result.isError).toBeUndefined()
        expect(git.show).toHaveBeenCalledWith('main', { format: 'commit' })
      })
    })

    describe('file fetching', () => {
      it('should fetch file content with ref:path format', async () => {
        const git = createMockGit()
        const handler = createFetchHandler(git)

        const input: FetchInput = { resource: 'main:src/index.ts' }
        const result = await handler(input)

        expect(result.isError).toBeUndefined()
        expect(git.show).toHaveBeenCalledWith('main:src/index.ts')
      })

      it('should fetch file content with SHA:path format', async () => {
        const git = createMockGit()
        const handler = createFetchHandler(git)

        const input: FetchInput = { resource: 'abc123:package.json' }
        const result = await handler(input)

        expect(result.isError).toBeUndefined()
        expect(git.show).toHaveBeenCalledWith('abc123:package.json')
      })
    })

    describe('diff fetching', () => {
      it('should fetch diff with .. format', async () => {
        const git = createMockGit()
        const handler = createFetchHandler(git)

        const input: FetchInput = { resource: 'abc123..def456' }
        const result = await handler(input)

        expect(result.isError).toBeUndefined()
        expect(git.diff).toHaveBeenCalledWith({
          commit1: 'abc123',
          commit2: 'def456'
        })
      })

      it('should fetch diff with ... format', async () => {
        const git = createMockGit()
        const handler = createFetchHandler(git)

        const input: FetchInput = { resource: 'main...feature' }
        const result = await handler(input)

        expect(result.isError).toBeUndefined()
        expect(git.diff).toHaveBeenCalledWith({
          commit1: 'main',
          commit2: 'feature'
        })
      })
    })

    describe('output formats', () => {
      it('should return JSON format by default', async () => {
        const git = createMockGit()
        const handler = createFetchHandler(git)

        const input: FetchInput = { resource: 'abc123' }
        const result = await handler(input)

        const parsed = JSON.parse(result.content[0].text)
        expect(parsed.type).toBeDefined()
        expect(parsed.content).toBeDefined()
        expect(parsed.metadata).toBeDefined()
      })

      it('should return raw format when requested', async () => {
        const git = createMockGit()
        const handler = createFetchHandler(git)

        const input: FetchInput = { resource: 'abc123', format: 'raw' }
        const result = await handler(input)

        // Raw format should not be wrapped in JSON structure
        expect(result.content[0].text).not.toContain('"type":')
      })

      it('should return text format when requested', async () => {
        const git = createMockGit()
        const handler = createFetchHandler(git)

        const input: FetchInput = { resource: 'abc123', format: 'text' }
        const result = await handler(input)

        // Text format should not be wrapped in JSON structure
        expect(result.content[0].text).not.toContain('"type":')
      })
    })

    describe('error handling', () => {
      it('should handle errors gracefully', async () => {
        const git = createMockGit()
        git.show = vi.fn().mockRejectedValue(new Error('Object not found'))

        const handler = createFetchHandler(git)
        const input: FetchInput = { resource: 'nonexistent' }
        const result = await handler(input)

        expect(result.isError).toBe(true)
        const parsed = JSON.parse(result.content[0].text)
        expect(parsed.error).toBe('Object not found')
      })
    })
  })
})
