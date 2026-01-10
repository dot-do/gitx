/**
 * @fileoverview MCP (Model Context Protocol) Git Tool Definitions
 *
 * This module provides tool definitions for git operations that can be
 * exposed via the Model Context Protocol for AI assistants. It defines
 * a comprehensive set of git tools including status, log, diff, commit,
 * branch, checkout, push, pull, clone, init, add, reset, merge, rebase,
 * stash, tag, remote, and fetch operations.
 *
 * The module uses a registry pattern for tool management, allowing dynamic
 * registration, validation, and invocation of tools. Each tool follows the
 * MCP specification with JSON Schema input validation and standardized
 * result formatting.
 *
 * @module mcp/tools
 *
 * @example
 * // Setting up repository context and invoking a tool
 * import { setRepositoryContext, invokeTool } from './tools'
 *
 * // Set up the repository context first
 * setRepositoryContext({
 *   objectStore: myObjectStore,
 *   refStore: myRefStore,
 *   index: myIndex
 * })
 *
 * // Invoke a tool
 * const result = await invokeTool('git_status', { short: true })
 * console.log(result.content[0].text)
 *
 * @example
 * // Registering a custom tool
 * import { registerTool } from './tools'
 *
 * registerTool({
 *   name: 'my_custom_tool',
 *   description: 'A custom tool',
 *   inputSchema: { type: 'object', properties: {} },
 *   handler: async (params) => ({
 *     content: [{ type: 'text', text: 'Hello!' }]
 *   })
 * })
 */
import { RefStore } from '../ops/branch';
import type { CommitObject, TreeObject } from '../types/objects';
/**
 * Repository context for MCP tool operations.
 *
 * @description
 * This interface provides access to the git repository's storage layers,
 * enabling MCP tools to read and write git objects, manage references,
 * and interact with the index and working directory.
 *
 * The context must be set globally using {@link setRepositoryContext} before
 * invoking any tools that require repository access.
 *
 * @interface RepositoryContext
 *
 * @example
 * const context: RepositoryContext = {
 *   objectStore: {
 *     getObject: async (sha) => { ... },
 *     getCommit: async (sha) => { ... },
 *     getTree: async (sha) => { ... },
 *     getBlob: async (sha) => { ... },
 *     storeObject: async (type, data) => { ... },
 *     hasObject: async (sha) => { ... }
 *   },
 *   refStore: myRefStore,
 *   index: { getEntries: async () => [...] }
 * }
 * setRepositoryContext(context)
 */
export interface RepositoryContext {
    /**
     * Object store for reading and writing git objects.
     * @description Provides methods to access commits, trees, blobs, and raw objects.
     */
    objectStore: {
        /**
         * Get a raw git object by SHA.
         * @param sha - The 40-character hexadecimal SHA-1 hash
         * @returns The object with its type and data, or null if not found
         */
        getObject(sha: string): Promise<{
            type: string;
            data: Uint8Array;
        } | null>;
        /**
         * Get a parsed commit object by SHA.
         * @param sha - The commit SHA
         * @returns The parsed commit object, or null if not found
         */
        getCommit(sha: string): Promise<CommitObject | null>;
        /**
         * Get a parsed tree object by SHA.
         * @param sha - The tree SHA
         * @returns The parsed tree object, or null if not found
         */
        getTree(sha: string): Promise<TreeObject | null>;
        /**
         * Get blob content by SHA.
         * @param sha - The blob SHA
         * @returns The blob data, or null if not found
         */
        getBlob(sha: string): Promise<Uint8Array | null>;
        /**
         * Store a new git object.
         * @param type - The object type ('commit', 'tree', 'blob', 'tag')
         * @param data - The raw object data
         * @returns The SHA of the stored object
         */
        storeObject(type: string, data: Uint8Array): Promise<string>;
        /**
         * Check if an object exists.
         * @param sha - The object SHA to check
         * @returns True if the object exists
         */
        hasObject(sha: string): Promise<boolean>;
    };
    /**
     * Ref store for branch/tag operations.
     * @description Manages git references including HEAD, branches, and tags.
     */
    refStore: RefStore;
    /**
     * Index/staging area for status/diff operations.
     * @description Optional - required for git_status and staged diff operations.
     */
    index?: {
        /**
         * Get all entries in the index.
         * @returns Array of index entries with path, mode, SHA, and stage number
         */
        getEntries(): Promise<Array<{
            path: string;
            mode: string;
            sha: string;
            stage: number;
        }>>;
    };
    /**
     * Working directory interface for status operations.
     * @description Optional - required for working tree comparisons.
     */
    workdir?: {
        /**
         * Get all files in the working directory.
         * @returns Array of file entries with path, mode, and SHA
         */
        getFiles(): Promise<Array<{
            path: string;
            mode: string;
            sha: string;
        }>>;
    };
}
/**
 * Set the global repository context for MCP tools.
 *
 * @description
 * This function sets the global repository context that will be used by all
 * MCP git tools. The context provides access to the object store, ref store,
 * index, and working directory. This must be called before invoking any tools
 * that require repository access.
 *
 * @param ctx - The repository context to set, or null to clear it
 * @returns void
 *
 * @example
 * // Set up context before using tools
 * setRepositoryContext({
 *   objectStore: myObjectStore,
 *   refStore: myRefStore
 * })
 *
 * // Clear context when done
 * setRepositoryContext(null)
 */
export declare function setRepositoryContext(ctx: RepositoryContext | null): void;
/**
 * Get the global repository context.
 *
 * @description
 * Returns the currently set repository context, or null if no context has
 * been set. Tools use this internally to access repository data.
 *
 * @returns The current repository context, or null if not set
 *
 * @example
 * const ctx = getRepositoryContext()
 * if (ctx) {
 *   const commit = await ctx.objectStore.getCommit(sha)
 * }
 */
export declare function getRepositoryContext(): RepositoryContext | null;
/**
 * JSON Schema definition for tool input parameters.
 *
 * @description
 * Defines the structure of JSON Schema objects used to describe and validate
 * tool input parameters. Supports standard JSON Schema features including
 * type validation, required fields, enums, numeric constraints, and patterns.
 *
 * @interface JSONSchema
 *
 * @example
 * const schema: JSONSchema = {
 *   type: 'object',
 *   properties: {
 *     path: { type: 'string', description: 'File path' },
 *     maxCount: { type: 'number', minimum: 1 }
 *   },
 *   required: ['path']
 * }
 */
export interface JSONSchema {
    /** The JSON Schema type ('object', 'string', 'number', 'boolean', 'array') */
    type: string;
    /** Property definitions for object types */
    properties?: Record<string, JSONSchema>;
    /** List of required property names */
    required?: string[];
    /** Human-readable description of the schema */
    description?: string;
    /** Schema for array items */
    items?: JSONSchema;
    /** Allowed values for enum types */
    enum?: string[];
    /** Default value if not provided */
    default?: unknown;
    /** Minimum value for numeric types */
    minimum?: number;
    /** Maximum value for numeric types */
    maximum?: number;
    /** Regex pattern for string validation */
    pattern?: string;
}
/**
 * Represents the result of invoking an MCP tool.
 *
 * @description
 * The standard result format returned by all MCP tools. Contains an array
 * of content blocks that can include text, images, or resource references.
 * The isError flag indicates whether the result represents an error condition.
 *
 * @interface MCPToolResult
 *
 * @example
 * // Successful text result
 * const result: MCPToolResult = {
 *   content: [{ type: 'text', text: 'On branch main\nnothing to commit' }]
 * }
 *
 * // Error result
 * const errorResult: MCPToolResult = {
 *   content: [{ type: 'text', text: 'Repository not found' }],
 *   isError: true
 * }
 */
export interface MCPToolResult {
    /**
     * Array of content blocks in the result.
     * Each block has a type and corresponding data.
     */
    content: Array<{
        /** Content type: 'text', 'image', or 'resource' */
        type: 'text' | 'image' | 'resource';
        /** Text content (for type: 'text') */
        text?: string;
        /** Base64-encoded data (for type: 'image') */
        data?: string;
        /** MIME type for binary content */
        mimeType?: string;
    }>;
    /** If true, the result represents an error condition */
    isError?: boolean;
}
/**
 * Handler function type for MCP tools.
 *
 * @description
 * Type definition for tool handler functions. Handlers receive parameters
 * as a record of unknown values and must return a Promise resolving to
 * an MCPToolResult.
 *
 * @param params - The input parameters passed to the tool
 * @returns Promise resolving to the tool result
 *
 * @example
 * const handler: MCPToolHandler = async (params) => {
 *   const { path } = params as { path?: string }
 *   return {
 *     content: [{ type: 'text', text: `Processed: ${path}` }]
 *   }
 * }
 */
export type MCPToolHandler = (params: Record<string, unknown>) => Promise<MCPToolResult>;
/**
 * Defines an MCP tool with its schema and handler.
 *
 * @description
 * Complete tool definition including name, description, input schema
 * for parameter validation, and the async handler function that
 * implements the tool's functionality.
 *
 * @interface MCPTool
 *
 * @example
 * const myTool: MCPTool = {
 *   name: 'my_tool',
 *   description: 'Does something useful',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       input: { type: 'string', description: 'The input value' }
 *     },
 *     required: ['input']
 *   },
 *   handler: async (params) => {
 *     const { input } = params as { input: string }
 *     return { content: [{ type: 'text', text: `Result: ${input}` }] }
 *   }
 * }
 */
export interface MCPTool {
    /** Unique name identifying the tool (e.g., 'git_status') */
    name: string;
    /** Human-readable description of what the tool does */
    description: string;
    /** JSON Schema defining the tool's input parameters */
    inputSchema: JSONSchema;
    /** Async function that implements the tool's functionality */
    handler: MCPToolHandler;
}
/**
 * Registry of available git tools.
 *
 * @description
 * Array containing all built-in git tool definitions. These tools are
 * automatically registered in the tool registry on module load. Each
 * tool implements a specific git operation following the MCP specification.
 *
 * Available tools:
 * - git_status: Show repository status
 * - git_log: Show commit history
 * - git_diff: Show differences between commits
 * - git_commit: Create a new commit
 * - git_branch: List, create, or delete branches
 * - git_checkout: Switch branches or restore files
 * - git_push: Upload commits to remote
 * - git_pull: Fetch and integrate from remote
 * - git_clone: Clone a repository
 * - git_init: Initialize a new repository
 * - git_add: Stage files for commit
 * - git_reset: Reset HEAD to a state
 * - git_merge: Merge branches
 * - git_rebase: Rebase commits
 * - git_stash: Stash changes
 * - git_tag: Manage tags
 * - git_remote: Manage remotes
 * - git_fetch: Fetch from remotes
 *
 * @example
 * // Access git tools array
 * import { gitTools } from './tools'
 *
 * for (const tool of gitTools) {
 *   console.log(`Tool: ${tool.name} - ${tool.description}`)
 * }
 */
export declare const gitTools: MCPTool[];
/**
 * Register a new tool in the registry.
 *
 * @description
 * Adds a custom tool to the global tool registry. The tool must have a valid
 * handler function and a unique name. Once registered, the tool can be invoked
 * using {@link invokeTool}.
 *
 * Note: Built-in git tools are automatically registered on module load.
 *
 * @param tool - The tool definition to register
 * @returns void
 * @throws {Error} If tool handler is missing or not a function
 * @throws {Error} If a tool with the same name already exists
 *
 * @example
 * import { registerTool, invokeTool } from './tools'
 *
 * // Register a custom tool
 * registerTool({
 *   name: 'custom_operation',
 *   description: 'Performs a custom operation',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       value: { type: 'string', description: 'Input value' }
 *     },
 *     required: ['value']
 *   },
 *   handler: async (params) => {
 *     const { value } = params as { value: string }
 *     return {
 *       content: [{ type: 'text', text: `Processed: ${value}` }]
 *     }
 *   }
 * })
 *
 * // Now invoke the registered tool
 * const result = await invokeTool('custom_operation', { value: 'test' })
 */
export declare function registerTool(tool: MCPTool): void;
/**
 * Validate input parameters against a tool's schema.
 *
 * @description
 * Performs comprehensive validation of tool parameters against the tool's
 * JSON Schema definition. Checks for required parameters, type correctness,
 * enum values, numeric constraints, string patterns, and array item types.
 *
 * This function is called automatically by {@link invokeTool} before
 * executing a tool handler, but can also be used independently for
 * pre-validation.
 *
 * @param tool - The tool whose schema to validate against
 * @param params - The parameters to validate
 * @returns Validation result object with valid flag and array of error messages
 *
 * @example
 * import { validateToolInput, getTool } from './tools'
 *
 * const tool = getTool('git_commit')
 * if (tool) {
 *   const validation = validateToolInput(tool, { path: '/repo' })
 *   if (!validation.valid) {
 *     console.error('Validation errors:', validation.errors)
 *     // Output: ['Missing required parameter: message']
 *   }
 * }
 *
 * @example
 * // Type validation example
 * const result = validateToolInput(tool, { maxCount: 'not-a-number' })
 * // result.errors: ["Parameter 'maxCount' has invalid type: expected number, got string"]
 */
export declare function validateToolInput(tool: MCPTool, params: Record<string, unknown>): {
    valid: boolean;
    errors: string[];
};
/**
 * Invoke a tool by name with the given parameters.
 *
 * @description
 * Looks up a tool by name in the registry, validates the provided parameters
 * against the tool's schema, and executes the tool's handler. Validation
 * errors and execution errors are returned as MCPToolResult with isError=true
 * rather than throwing exceptions.
 *
 * This is the primary function for executing MCP tools. Ensure the repository
 * context is set via {@link setRepositoryContext} before invoking git tools.
 *
 * @param toolName - Name of the tool to invoke (e.g., 'git_status')
 * @param params - Parameters to pass to the tool handler
 * @returns Promise resolving to the tool result
 * @throws {Error} If the tool is not found in the registry
 *
 * @example
 * import { invokeTool, setRepositoryContext } from './tools'
 *
 * // Set up repository context first
 * setRepositoryContext(myRepoContext)
 *
 * // Invoke git_status tool
 * const status = await invokeTool('git_status', { short: true })
 * if (!status.isError) {
 *   console.log(status.content[0].text)
 * }
 *
 * @example
 * // Invoke git_log with parameters
 * const log = await invokeTool('git_log', {
 *   maxCount: 10,
 *   oneline: true,
 *   ref: 'main'
 * })
 *
 * @example
 * // Handle validation errors
 * const result = await invokeTool('git_commit', {})
 * if (result.isError) {
 *   // result.content[0].text contains validation error message
 *   console.error('Error:', result.content[0].text)
 * }
 */
export declare function invokeTool(toolName: string, params: Record<string, unknown>): Promise<MCPToolResult>;
/**
 * Get a list of all registered tools.
 *
 * @description
 * Returns an array of all tools in the registry with their names, descriptions,
 * and input schemas. Handler functions are omitted for security and serialization.
 * This is useful for discovery and documentation purposes.
 *
 * @returns Array of tool definitions without handler functions
 *
 * @example
 * import { listTools } from './tools'
 *
 * const tools = listTools()
 * console.log(`Available tools: ${tools.length}`)
 *
 * for (const tool of tools) {
 *   console.log(`- ${tool.name}: ${tool.description}`)
 *   console.log(`  Required params: ${tool.inputSchema.required?.join(', ') || 'none'}`)
 * }
 */
export declare function listTools(): Array<Omit<MCPTool, 'handler'>>;
/**
 * Get a tool by name.
 *
 * @description
 * Retrieves a tool definition from the registry by its name. Returns the
 * complete tool object including the handler function. Returns undefined
 * if no tool with the given name exists.
 *
 * @param name - Name of the tool to retrieve (e.g., 'git_status')
 * @returns The complete tool definition if found, undefined otherwise
 *
 * @example
 * import { getTool } from './tools'
 *
 * const statusTool = getTool('git_status')
 * if (statusTool) {
 *   console.log(`Description: ${statusTool.description}`)
 *   console.log(`Parameters:`, Object.keys(statusTool.inputSchema.properties || {}))
 * }
 *
 * @example
 * // Check if a tool exists before using it
 * const tool = getTool('my_custom_tool')
 * if (!tool) {
 *   console.error('Tool not found')
 * }
 */
export declare function getTool(name: string): MCPTool | undefined;
//# sourceMappingURL=tools.d.ts.map