/**
 * Git MCP Server Tests
 *
 * @module mcp/server.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createGitMCPServer,
  gitTools,
  getToolRegistry,
  invokeTool,
  clearToolRegistry,
  type GitAuthContext,
} from '../../packages/do/src/mcp/index'

describe('Git MCP Server', () => {
  describe('createGitMCPServer', () => {
    it('should create a server with default options', () => {
      const server = createGitMCPServer()

      expect(server.info.name).toBe('gitx.do')
      expect(server.info.version).toBe('1.0.0')
      expect(server.app).toBeDefined()
    })

    it('should create a server with custom name and version', () => {
      const server = createGitMCPServer({
        name: 'my-git-server',
        version: '2.0.0',
      })

      expect(server.info.name).toBe('my-git-server')
      expect(server.info.version).toBe('2.0.0')
    })

    it('should return all registered tools', () => {
      const server = createGitMCPServer()
      const tools = server.getTools()

      expect(tools).toContain('git_status')
      expect(tools).toContain('git_log')
      expect(tools).toContain('git_diff')
      expect(tools).toContain('git_commit')
      expect(tools).toContain('git_branch')
    })
  })

  describe('gitTools', () => {
    it('should have all expected tools', () => {
      const toolNames = gitTools.map(t => t.schema.name)

      // Read tools
      expect(toolNames).toContain('git_status')
      expect(toolNames).toContain('git_log')
      expect(toolNames).toContain('git_diff')
      expect(toolNames).toContain('git_show')
      expect(toolNames).toContain('git_blame')

      // Branch/tag tools
      expect(toolNames).toContain('git_branch')
      expect(toolNames).toContain('git_tag')

      // Write tools
      expect(toolNames).toContain('git_commit')
      expect(toolNames).toContain('git_checkout')
      expect(toolNames).toContain('git_add')
      expect(toolNames).toContain('git_reset')
      expect(toolNames).toContain('git_merge')
      expect(toolNames).toContain('git_rebase')
      expect(toolNames).toContain('git_stash')

      // Remote tools
      expect(toolNames).toContain('git_remote')
      expect(toolNames).toContain('git_fetch')
      expect(toolNames).toContain('git_push')
      expect(toolNames).toContain('git_pull')
      expect(toolNames).toContain('git_clone')
      expect(toolNames).toContain('git_init')
    })

    it('should have proper input schemas for tools', () => {
      const statusTool = gitTools.find(t => t.schema.name === 'git_status')
      expect(statusTool).toBeDefined()
      expect(statusTool!.schema.inputSchema.type).toBe('object')

      const commitTool = gitTools.find(t => t.schema.name === 'git_commit')
      expect(commitTool).toBeDefined()
      expect(commitTool!.schema.inputSchema.required).toContain('message')
    })
  })

  describe('Tool Registry', () => {
    beforeEach(() => {
      clearToolRegistry()
    })

    it('should have all git tools registered', () => {
      const registry = getToolRegistry()

      expect(registry.has('git_status')).toBe(true)
      expect(registry.has('git_commit')).toBe(true)
      expect(registry.has('git_branch')).toBe(true)
    })

    it('should return tool schemas', () => {
      const registry = getToolRegistry()
      const schemas = registry.schemas()

      expect(schemas.length).toBeGreaterThan(0)
      expect(schemas.some(s => s.name === 'git_status')).toBe(true)
    })

    it('should filter tools by predicate', () => {
      const registry = getToolRegistry()
      const readTools = registry.filter(t => t.schema.name.includes('git_'))

      expect(readTools.length).toBe(gitTools.length)
    })
  })

  describe('Tool Invocation', () => {
    beforeEach(() => {
      clearToolRegistry()
    })

    it('should return error for unknown tool', async () => {
      const result = await invokeTool('unknown_tool', {})

      expect(result.isError).toBe(true)
      expect(result.content[0].type).toBe('text')
      expect((result.content[0] as { text: string }).text).toContain('Unknown tool')
    })

    it('should return stub error for tools without implementation', async () => {
      const result = await invokeTool('git_status', {})

      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('Not implemented')
    })

    it('should enforce required parameters', async () => {
      const result = await invokeTool('git_show', {})

      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('Missing required parameter')
    })

    it('should enforce write access for write tools', async () => {
      const readonlyAuth: GitAuthContext = {
        type: 'oauth',
        id: 'user-123',
        readonly: true,
      }

      const result = await invokeTool('git_commit', { message: 'test' }, undefined, { auth: readonlyAuth })

      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain('requires write access')
    })

    it('should allow read operations for readonly context', async () => {
      const readonlyAuth: GitAuthContext = {
        type: 'oauth',
        id: 'user-123',
        readonly: true,
      }

      // git_status is a read operation, should not fail due to readonly
      const result = await invokeTool('git_status', {}, undefined, { auth: readonlyAuth })

      // It will fail because no implementation, but NOT because of access
      expect((result.content[0] as { text: string }).text).not.toContain('requires write access')
    })
  })

  describe('Auth Context', () => {
    it('should correctly identify write requirements for tools', async () => {
      const writeAuth: GitAuthContext = {
        type: 'oauth',
        id: 'user-123',
        readonly: false,
      }

      // Write tools should work with write access
      const commitResult = await invokeTool('git_commit', { message: 'test' }, undefined, { auth: writeAuth })
      expect((commitResult.content[0] as { text: string }).text).not.toContain('requires write access')

      const checkoutResult = await invokeTool('git_checkout', { ref: 'main' }, undefined, { auth: writeAuth })
      expect((checkoutResult.content[0] as { text: string }).text).not.toContain('requires write access')
    })

    it('should handle conditional write tools correctly', async () => {
      const readonlyAuth: GitAuthContext = {
        type: 'oauth',
        id: 'user-123',
        readonly: true,
      }

      // git_branch with list=true should be allowed for readonly
      const listResult = await invokeTool('git_branch', { list: true }, undefined, { auth: readonlyAuth })
      expect((listResult.content[0] as { text: string }).text).not.toContain('requires write access')

      // git_branch with name (create) should fail for readonly
      const createResult = await invokeTool('git_branch', { name: 'new-branch' }, undefined, { auth: readonlyAuth })
      expect((createResult.content[0] as { text: string }).text).toContain('requires write access')
    })
  })
})
