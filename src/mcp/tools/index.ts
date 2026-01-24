/**
 * @fileoverview MCP Git Tools - search/fetch/do pattern
 *
 * This module provides three MCP tools following the search/fetch/do pattern:
 * - search: Search commits, branches, tags
 * - fetch: Retrieve git resources by reference
 * - do: Execute code with git binding available
 *
 * @module mcp/tools
 */

import type { Tool as BaseTool, ToolHandler as BaseToolHandler, DoScope, DoPermissions } from '@dotdo/mcp'

export { searchTool, searchToolDefinition, createSearchHandler } from './search'
export { fetchTool, fetchToolDefinition, createFetchHandler } from './fetch'
export { executeDo, doToolDefinition, createDoHandler, createGitScope } from './do'
export type { SearchInput, SearchResult, SearchOptions } from './search'
export type { FetchInput, FetchResult, FetchOptions, ResourceType } from './fetch'
export type { DoToolInput, DoToolOutput, GitBinding, GitScope } from './do'

// Re-export shared types from @dotdo/mcp for consumers
export type { BaseTool, BaseToolHandler, DoScope, DoPermissions }

import { searchToolDefinition, createSearchHandler } from './search'
import { fetchToolDefinition, createFetchHandler } from './fetch'
import { doToolDefinition, createDoHandler, createGitScope } from './do'
import type { GitBinding } from './do'

/**
 * MCP Tool definition with handler.
 * Compatible with @dotdo/mcp's Tool interface but specialized for git operations.
 */
export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  handler: (params: Record<string, unknown>) => Promise<MCPToolResult>
}

/**
 * MCP Tool result
 */
export interface MCPToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >
  isError?: boolean
}

/**
 * Create all three tools with the provided git binding
 *
 * @param git - The git binding providing access to git operations
 * @returns Array of MCP tools [search, fetch, do]
 */
export function createGitTools(git: GitBinding): MCPTool[] {
  const scope = createGitScope(git)

  return [
    {
      ...searchToolDefinition,
      handler: createSearchHandler(git) as unknown as MCPTool['handler']
    },
    {
      ...fetchToolDefinition,
      handler: createFetchHandler(git) as unknown as MCPTool['handler']
    },
    {
      ...doToolDefinition,
      handler: createDoHandler(scope) as unknown as MCPTool['handler']
    }
  ]
}

/**
 * Tool definitions without handlers (for MCP discovery)
 */
export const toolDefinitions = [
  searchToolDefinition,
  fetchToolDefinition,
  doToolDefinition
]
