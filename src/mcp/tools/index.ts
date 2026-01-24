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

import type {
  Tool as BaseTool,
  ToolHandler as BaseToolHandler,
  ToolResponse,
  DoScope,
  DoPermissions
} from '@dotdo/mcp'

export { searchTool, searchToolDefinition, createSearchHandler } from './search'
export { fetchTool, fetchToolDefinition, createFetchHandler } from './fetch'
export { executeDo, doToolDefinition, createDoHandler, createGitScope } from './do'
export type { SearchInput, SearchResult, SearchOptions, GitObjectType } from './search'
export type { FetchInput, FetchResult, FetchOptions, ResourceType } from './fetch'
export type { DoToolInput, DoToolOutput, GitBinding, GitScope } from './do'

// Re-export shared types from @dotdo/mcp for consumers
export type { BaseTool, BaseToolHandler, ToolResponse, DoScope, DoPermissions }

import { searchToolDefinition, createSearchHandler } from './search'
import { fetchToolDefinition, createFetchHandler } from './fetch'
import { doToolDefinition, createDoHandler, createGitScope } from './do'
import type { GitBinding } from './do'

/**
 * Generic MCP tool handler type.
 * Accepts Record<string, unknown> to be compatible with any MCP input.
 */
export type MCPToolHandler = (params: Record<string, unknown>) => Promise<ToolResponse>

/**
 * MCP Tool definition with handler.
 * Uses ToolResponse from @dotdo/mcp for handler return type.
 */
export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  handler: MCPToolHandler
}

/**
 * @deprecated Use ToolResponse from @dotdo/mcp instead
 */
export type MCPToolResult = ToolResponse

/**
 * Wrap a typed handler to accept Record<string, unknown> input.
 * The handler validates input at runtime through its implementation.
 */
function wrapHandler<T>(handler: (input: T) => Promise<ToolResponse>): MCPToolHandler {
  return (params: Record<string, unknown>) => handler(params as T)
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
      handler: wrapHandler(createSearchHandler(git))
    },
    {
      ...fetchToolDefinition,
      handler: wrapHandler(createFetchHandler(git))
    },
    {
      ...doToolDefinition,
      handler: wrapHandler(createDoHandler(scope))
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
