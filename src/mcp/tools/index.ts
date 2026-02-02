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

// =============================================================================
// Generic Tool Handler Types
// =============================================================================

/**
 * Generic MCP tool handler type.
 * Accepts Record<string, unknown> to be compatible with any MCP input.
 */
export type MCPToolHandler = (params: Record<string, unknown>) => Promise<ToolResponse>

/**
 * Typed tool handler with generic input type for better type safety.
 *
 * @template TInput - The expected input type for the handler
 *
 * @example
 * interface MyToolInput {
 *   path: string
 *   recursive?: boolean
 * }
 *
 * const handler: TypedToolHandler<MyToolInput> = async (input) => {
 *   // input.path is typed as string
 *   // input.recursive is typed as boolean | undefined
 *   return { content: [{ type: 'text', text: input.path }] }
 * }
 */
export type TypedToolHandler<TInput> = (input: TInput) => Promise<ToolResponse>

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
 * Typed MCP Tool with generic input type for better type safety.
 *
 * @template TInput - The expected input type for the tool's handler
 *
 * @example
 * interface ListFilesInput {
 *   path: string
 *   pattern?: string
 * }
 *
 * const listFilesTool: TypedMCPTool<ListFilesInput> = {
 *   name: 'list_files',
 *   description: 'List files in a directory',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       path: { type: 'string' },
 *       pattern: { type: 'string' }
 *     },
 *     required: ['path']
 *   },
 *   handler: async (input) => {
 *     // input.path and input.pattern are fully typed
 *     return { content: [{ type: 'text', text: input.path }] }
 *   }
 * }
 */
export interface TypedMCPTool<TInput> {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  handler: TypedToolHandler<TInput>
}

/**
 * @deprecated Use ToolResponse from @dotdo/mcp instead
 */
export type MCPToolResult = ToolResponse

// =============================================================================
// Storage Type Helpers
// =============================================================================

/**
 * Generic storage backend interface for type-safe storage operations.
 *
 * @template TObject - The type of objects stored
 * @template TKey - The type of keys used to identify objects (default: string)
 *
 * @example
 * interface GitObject {
 *   type: 'commit' | 'tree' | 'blob' | 'tag'
 *   data: Uint8Array
 * }
 *
 * const store: StorageBackend<GitObject> = {
 *   get: async (sha) => ({ type: 'blob', data: new Uint8Array() }),
 *   put: async (sha, obj) => { ... },
 *   has: async (sha) => true,
 *   delete: async (sha) => { ... }
 * }
 */
export interface StorageBackend<TObject, TKey = string> {
  /** Retrieve an object by key */
  get(key: TKey): Promise<TObject | null>
  /** Store an object with the given key */
  put(key: TKey, value: TObject): Promise<void>
  /** Check if an object exists */
  has(key: TKey): Promise<boolean>
  /** Delete an object by key */
  delete?(key: TKey): Promise<void>
}

/**
 * Tool handler factory with typed storage backend.
 *
 * @template TStorage - The storage backend type
 * @template TInput - The tool input type
 *
 * @example
 * interface MyStorage {
 *   getFile(path: string): Promise<string | null>
 * }
 *
 * interface ReadFileInput {
 *   path: string
 * }
 *
 * const createHandler: StorageToolHandlerFactory<MyStorage, ReadFileInput> = (storage) => {
 *   return async (input) => {
 *     const content = await storage.getFile(input.path)
 *     return { content: [{ type: 'text', text: content ?? 'Not found' }] }
 *   }
 * }
 */
export type StorageToolHandlerFactory<TStorage, TInput> = (
  storage: TStorage
) => TypedToolHandler<TInput>

/**
 * Create a typed tool handler factory for a specific storage backend.
 *
 * @template TStorage - The storage backend type
 * @template TInput - The tool input type
 * @param handlerFn - Function that receives storage and input, returns ToolResponse
 * @returns A factory function that creates handlers bound to a storage instance
 *
 * @example
 * interface ObjectStore {
 *   getObject(sha: string): Promise<{ type: string; data: Uint8Array } | null>
 * }
 *
 * interface GetObjectInput {
 *   sha: string
 * }
 *
 * const createGetObjectHandler = createStorageHandler<ObjectStore, GetObjectInput>(
 *   async (storage, input) => {
 *     const obj = await storage.getObject(input.sha)
 *     if (!obj) {
 *       return { content: [{ type: 'text', text: 'Object not found' }], isError: true }
 *     }
 *     return { content: [{ type: 'text', text: JSON.stringify(obj) }] }
 *   }
 * )
 *
 * // Usage:
 * const handler = createGetObjectHandler(myObjectStore)
 */
export function createStorageHandler<TStorage, TInput>(
  handlerFn: (storage: TStorage, input: TInput) => Promise<ToolResponse>
): StorageToolHandlerFactory<TStorage, TInput> {
  return (storage: TStorage) => {
    return (input: TInput) => handlerFn(storage, input)
  }
}

/**
 * Wrap a typed handler to accept Record<string, unknown> input.
 * The handler validates input at runtime through its implementation.
 *
 * @template TInput - The expected input type
 * @param handler - The typed handler function
 * @returns An MCPToolHandler that accepts generic params
 *
 * @example
 * interface MyInput { name: string }
 * const typedHandler: TypedToolHandler<MyInput> = async (input) => {
 *   return { content: [{ type: 'text', text: input.name }] }
 * }
 * const genericHandler: MCPToolHandler = wrapHandler(typedHandler)
 */
export function wrapHandler<TInput>(handler: TypedToolHandler<TInput>): MCPToolHandler {
  return (params: Record<string, unknown>) => handler(params as TInput)
}

/**
 * Convert a TypedMCPTool to a standard MCPTool.
 * Useful when you need to pass typed tools to APIs that expect MCPTool.
 *
 * @template TInput - The input type of the typed tool
 * @param tool - The typed tool to convert
 * @returns An MCPTool with the handler wrapped for generic params
 *
 * @example
 * const typedTool: TypedMCPTool<{ path: string }> = { ... }
 * const genericTool: MCPTool = toMCPTool(typedTool)
 */
export function toMCPTool<TInput>(tool: TypedMCPTool<TInput>): MCPTool {
  return {
    ...tool,
    handler: wrapHandler(tool.handler)
  }
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
