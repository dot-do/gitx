import { describe, it, expect, vi } from 'vitest'
import {
  createGitTools,
  toolDefinitions,
  MCPTool
} from '../../../src/mcp/tools/index'
import type { ToolResponse } from '@dotdo/mcp'
import type { GitBinding } from '../../../src/mcp/tools/do'

describe('MCP Tools Index', () => {
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
          { sha: 'abc123', message: 'test commit', author: 'Test', date: '2025-01-01' }
        ]
      }),
      diff: vi.fn().mockResolvedValue(''),
      show: vi.fn().mockResolvedValue({ sha: 'abc123', message: 'test' }),
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

  describe('toolDefinitions', () => {
    it('should export exactly 3 tool definitions', () => {
      expect(toolDefinitions).toHaveLength(3)
    })

    it('should have search tool definition', () => {
      const searchDef = toolDefinitions.find(t => t.name === 'search')
      expect(searchDef).toBeDefined()
      expect(searchDef?.inputSchema.required).toContain('query')
    })

    it('should have fetch tool definition', () => {
      const fetchDef = toolDefinitions.find(t => t.name === 'fetch')
      expect(fetchDef).toBeDefined()
      expect(fetchDef?.inputSchema.required).toContain('resource')
    })

    it('should have do tool definition', () => {
      const doDef = toolDefinitions.find(t => t.name === 'do')
      expect(doDef).toBeDefined()
      expect(doDef?.inputSchema.required).toContain('code')
    })

    it('should have unique tool names', () => {
      const names = toolDefinitions.map(t => t.name)
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(names.length)
    })
  })

  describe('type exports', () => {
    it('should use ToolResponse from @dotdo/mcp for handler returns', async () => {
      const git = createMockGit()
      const tools = createGitTools(git)
      const searchTool = tools.find(t => t.name === 'search')!

      const result = await searchTool.handler({ query: 'test' })

      // Result should be compatible with ToolResponse from @dotdo/mcp
      const toolResponse: ToolResponse = result
      expect(toolResponse.content).toBeDefined()
      expect(Array.isArray(toolResponse.content)).toBe(true)
      expect(toolResponse.content[0]).toHaveProperty('type')
      expect(toolResponse.content[0]).toHaveProperty('text')
    })

    it('MCPTool handler should return ToolResponse compatible type', () => {
      // This test verifies at compile-time that MCPTool['handler'] returns
      // something compatible with ToolResponse
      type MCPToolHandlerReturn = ReturnType<MCPTool['handler']>
      type ExtractedReturnType = Awaited<MCPToolHandlerReturn>

      // If MCPTool uses ToolResponse, this should compile without error
      const assertAssignable = <T>(_: T) => {}

      // Create a mock tool response
      const mockResponse: ExtractedReturnType = {
        content: [{ type: 'text', text: 'test' }]
      }

      // This line would fail if MCPToolResult is incompatible with ToolResponse
      assertAssignable<ToolResponse>(mockResponse)
      expect(mockResponse.content[0].text).toBe('test')
    })
  })

  describe('handler type safety', () => {
    it('search handler should accept Record<string, unknown> input', async () => {
      const git = createMockGit()
      const tools = createGitTools(git)
      const searchTool = tools.find(t => t.name === 'search')!

      // Should work with Record<string, unknown> (generic MCP input)
      const params: Record<string, unknown> = { query: 'test', limit: 5 }
      const result = await searchTool.handler(params)
      expect(result.content).toBeDefined()
    })

    it('fetch handler should accept Record<string, unknown> input', async () => {
      const git = createMockGit()
      const tools = createGitTools(git)
      const fetchTool = tools.find(t => t.name === 'fetch')!

      // Should work with Record<string, unknown> (generic MCP input)
      const params: Record<string, unknown> = { resource: 'main' }
      const result = await fetchTool.handler(params)
      expect(result.content).toBeDefined()
    })

    it('do handler should accept Record<string, unknown> input', async () => {
      const git = createMockGit()
      const tools = createGitTools(git)
      const doTool = tools.find(t => t.name === 'do')!

      // Should work with Record<string, unknown> (generic MCP input)
      const params: Record<string, unknown> = { code: 'return 1' }
      const result = await doTool.handler(params)
      expect(result.content).toBeDefined()
    })
  })

  describe('createGitTools', () => {
    it('should create 3 tools with handlers', () => {
      const git = createMockGit()
      const tools = createGitTools(git)

      expect(tools).toHaveLength(3)
      tools.forEach(tool => {
        expect(typeof tool.handler).toBe('function')
      })
    })

    it('should create search tool with working handler', async () => {
      const git = createMockGit()
      const tools = createGitTools(git)
      const searchTool = tools.find(t => t.name === 'search')!

      const result = await searchTool.handler({ query: 'test' })
      expect(result.content).toBeDefined()
      expect(Array.isArray(result.content)).toBe(true)
    })

    it('should create fetch tool with working handler', async () => {
      const git = createMockGit()
      const tools = createGitTools(git)
      const fetchTool = tools.find(t => t.name === 'fetch')!

      const result = await fetchTool.handler({ resource: 'main' })
      expect(result.content).toBeDefined()
      expect(git.show).toHaveBeenCalled()
    })

    it('should create do tool with working handler', async () => {
      const git = createMockGit()
      const tools = createGitTools(git)
      const doTool = tools.find(t => t.name === 'do')!

      const result = await doTool.handler({ code: 'return 2 + 2' })
      expect(result.content).toBeDefined()

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.success).toBe(true)
      expect(parsed.result).toBe(4)
    })

    it('should pass git binding to do tool', async () => {
      const git = createMockGit()
      const tools = createGitTools(git)
      const doTool = tools.find(t => t.name === 'do')!

      const result = await doTool.handler({
        code: 'return await git.status()'
      })

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.success).toBe(true)
      expect(parsed.result.branch).toBe('main')
      expect(git.status).toHaveBeenCalled()
    })

    it('should have proper schemas on created tools', () => {
      const git = createMockGit()
      const tools = createGitTools(git)

      tools.forEach(tool => {
        expect(tool.name).toBeDefined()
        expect(tool.description).toBeDefined()
        expect(tool.inputSchema.type).toBe('object')
        expect(tool.inputSchema.properties).toBeDefined()
      })
    })
  })

  describe('tool interoperability', () => {
    it('should allow chaining search -> fetch', async () => {
      const git = createMockGit()
      const tools = createGitTools(git)
      const searchTool = tools.find(t => t.name === 'search')!
      const fetchTool = tools.find(t => t.name === 'fetch')!

      // Search for commits
      const searchResult = await searchTool.handler({ query: 'test', type: 'commits' })
      const commits = JSON.parse(searchResult.content[0].text)

      // If we found commits, fetch the first one
      if (commits.length > 0 && commits[0].sha) {
        const fetchResult = await fetchTool.handler({ resource: commits[0].sha })
        expect(fetchResult.content).toBeDefined()
      }
    })

    it('should allow using do tool to run complex git operations', async () => {
      const git = createMockGit()
      const tools = createGitTools(git)
      const doTool = tools.find(t => t.name === 'do')!

      const result = await doTool.handler({
        code: `
          const status = await git.status()
          const branches = await git.branch({ list: true })
          return { status, branches }
        `
      })

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.success).toBe(true)
      expect(parsed.result.status).toBeDefined()
      expect(parsed.result.branches).toBeDefined()
    })
  })
})
