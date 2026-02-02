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
export { searchTool, searchToolDefinition, createSearchHandler } from './search';
export { fetchTool, fetchToolDefinition, createFetchHandler } from './fetch';
export { executeDo, doToolDefinition, createDoHandler, createGitScope } from './do';
import { searchToolDefinition, createSearchHandler } from './search';
import { fetchToolDefinition, createFetchHandler } from './fetch';
import { doToolDefinition, createDoHandler, createGitScope } from './do';
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
export function createStorageHandler(handlerFn) {
    return (storage) => {
        return (input) => handlerFn(storage, input);
    };
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
export function wrapHandler(handler) {
    return (params) => handler(params);
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
export function toMCPTool(tool) {
    return {
        ...tool,
        handler: wrapHandler(tool.handler)
    };
}
/**
 * Create all three tools with the provided git binding
 *
 * @param git - The git binding providing access to git operations
 * @returns Array of MCP tools [search, fetch, do]
 */
export function createGitTools(git) {
    const scope = createGitScope(git);
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
    ];
}
/**
 * Tool definitions without handlers (for MCP discovery)
 */
export const toolDefinitions = [
    searchToolDefinition,
    fetchToolDefinition,
    doToolDefinition
];
//# sourceMappingURL=index.js.map