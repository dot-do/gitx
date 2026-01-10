/**
 * @fileoverview MCP (Model Context Protocol) SDK Adapter
 *
 * This module provides an adapter that bridges the MCP protocol to git operations,
 * handling request/response, tool registration/invocation, resource listing,
 * and error handling. It implements the JSON-RPC 2.0 specification for MCP
 * communication.
 *
 * The adapter supports:
 * - Tool registration and invocation with schema validation
 * - Resource registration and reading
 * - Prompt registration and retrieval
 * - Standard and custom MCP error codes
 * - Batch request processing
 * - Capability negotiation
 *
 * @module mcp/adapter
 *
 * @example
 * // Create and configure an MCP adapter
 * import { createMCPAdapter, MCPAdapter } from './adapter'
 *
 * const adapter = createMCPAdapter({
 *   name: 'my-git-server',
 *   version: '1.0.0',
 *   capabilities: ['tools', 'resources']
 * })
 *
 * // Register git tools and start
 * adapter.registerGitTools()
 * await adapter.start()
 *
 * // Handle incoming requests
 * const response = await adapter.handleRequest({
 *   jsonrpc: '2.0',
 *   id: 1,
 *   method: 'tools/list',
 *   params: {}
 * })
 *
 * @example
 * // Handle raw JSON requests
 * const rawResponse = await adapter.handleRawRequest(
 *   '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
 * )
 */
import { type MCPToolResult } from './tools';
/**
 * JSON-RPC 2.0 error codes and MCP-specific error codes.
 *
 * @description
 * Enumeration of error codes used in MCP responses. Includes standard
 * JSON-RPC 2.0 error codes (negative 32xxx range) and MCP-specific
 * error codes for resource, tool, and prompt operations.
 *
 * @enum {number}
 *
 * @example
 * // Using error codes in responses
 * if (!tool) {
 *   return {
 *     jsonrpc: '2.0',
 *     id: requestId,
 *     error: {
 *       code: MCPErrorCode.TOOL_NOT_FOUND,
 *       message: 'Tool not found'
 *     }
 *   }
 * }
 */
export declare enum MCPErrorCode {
    /** Parse error - Invalid JSON was received (-32700) */
    PARSE_ERROR = -32700,
    /** Invalid Request - The JSON sent is not a valid Request object (-32600) */
    INVALID_REQUEST = -32600,
    /** Method not found - The method does not exist or is not available (-32601) */
    METHOD_NOT_FOUND = -32601,
    /** Invalid params - Invalid method parameter(s) (-32602) */
    INVALID_PARAMS = -32602,
    /** Internal error - Internal JSON-RPC error (-32603) */
    INTERNAL_ERROR = -32603,
    /** Resource not found - The requested resource does not exist (-32001) */
    RESOURCE_NOT_FOUND = -32001,
    /** Tool not found - Maps to METHOD_NOT_FOUND as tools are methods (-32601) */
    TOOL_NOT_FOUND = -32601,
    /** Prompt not found - The requested prompt does not exist (-32003) */
    PROMPT_NOT_FOUND = -32003,
    /** Capability not supported - The requested capability is not enabled (-32004) */
    CAPABILITY_NOT_SUPPORTED = -32004
}
/**
 * Custom error class for MCP errors.
 *
 * @description
 * Error class that encapsulates MCP error information including a numeric
 * error code, human-readable message, and optional additional data. Can be
 * serialized to JSON-RPC error format using the toJSON() method.
 *
 * @class MCPError
 * @extends Error
 *
 * @example
 * // Throw an MCP error
 * throw new MCPError(
 *   MCPErrorCode.TOOL_NOT_FOUND,
 *   'Tool "unknown_tool" not found',
 *   { toolName: 'unknown_tool' }
 * )
 *
 * @example
 * // Convert to JSON-RPC error format
 * const error = new MCPError(MCPErrorCode.INVALID_PARAMS, 'Missing required field')
 * const jsonError = error.toJSON()
 * // { code: -32602, message: 'Missing required field' }
 */
export declare class MCPError extends Error {
    /** The MCP error code */
    code: MCPErrorCode;
    /** Optional additional error data */
    data?: unknown;
    /**
     * Create a new MCP error.
     *
     * @param code - The MCP error code
     * @param message - Human-readable error message
     * @param data - Optional additional error data
     */
    constructor(code: MCPErrorCode, message: string, data?: unknown);
    /**
     * Convert the error to JSON-RPC error format.
     *
     * @returns Object suitable for JSON-RPC error responses
     */
    toJSON(): {
        code: MCPErrorCode;
        message: string;
        data?: unknown;
    };
}
/**
 * MCP capability types.
 *
 * @description
 * Type representing the different capabilities an MCP server can support.
 * Capabilities are negotiated during initialization.
 *
 * @typedef {'tools' | 'resources' | 'prompts'} MCPCapability
 */
export type MCPCapability = 'tools' | 'resources' | 'prompts';
/**
 * Server configuration for MCP adapter.
 *
 * @description
 * Configuration options for initializing an MCP adapter instance.
 * All fields are optional with sensible defaults.
 *
 * @interface MCPServerConfig
 *
 * @example
 * const config: MCPServerConfig = {
 *   name: 'my-git-server',
 *   version: '1.0.0',
 *   capabilities: ['tools', 'resources']
 * }
 */
export interface MCPServerConfig {
    /** Server name (default: 'gitx.do') */
    name?: string;
    /** Server version (default: '1.0.0') */
    version?: string;
    /** Enabled capabilities (default: ['tools']) */
    capabilities?: MCPCapability[];
}
/**
 * MCP request structure (JSON-RPC 2.0).
 *
 * @description
 * Represents an incoming MCP request following the JSON-RPC 2.0 specification.
 * Requests without an id are treated as notifications.
 *
 * @interface MCPRequest
 *
 * @example
 * const request: MCPRequest = {
 *   jsonrpc: '2.0',
 *   id: 1,
 *   method: 'tools/call',
 *   params: { name: 'git_status', arguments: {} }
 * }
 */
export interface MCPRequest {
    /** JSON-RPC version (must be '2.0') */
    jsonrpc: '2.0';
    /** Request identifier (omit for notifications) */
    id?: string | number;
    /** The method to invoke */
    method: string;
    /** Method parameters */
    params?: Record<string, unknown>;
}
/**
 * MCP response structure (JSON-RPC 2.0).
 *
 * @description
 * Represents an outgoing MCP response. Contains either a result or an error,
 * never both. Responses include the id from the corresponding request.
 *
 * @interface MCPResponse
 *
 * @example
 * // Success response
 * const success: MCPResponse = {
 *   jsonrpc: '2.0',
 *   id: 1,
 *   result: { tools: [...] }
 * }
 *
 * // Error response
 * const error: MCPResponse = {
 *   jsonrpc: '2.0',
 *   id: 1,
 *   error: { code: -32601, message: 'Method not found' }
 * }
 */
export interface MCPResponse {
    /** JSON-RPC version (always '2.0') */
    jsonrpc: '2.0';
    /** Request identifier from the corresponding request */
    id?: string | number;
    /** Result data (mutually exclusive with error) */
    result?: unknown;
    /** Error information (mutually exclusive with result) */
    error?: {
        /** Numeric error code */
        code: number;
        /** Human-readable error message */
        message: string;
        /** Additional error data */
        data?: unknown;
    };
}
/**
 * Tool information for registration.
 *
 * @description
 * Complete tool definition including metadata, input schema, and handler
 * function. Used when registering tools with the adapter.
 *
 * @interface MCPToolInfo
 *
 * @example
 * const toolInfo: MCPToolInfo = {
 *   name: 'my_tool',
 *   description: 'Does something useful',
 *   inputSchema: {
 *     type: 'object',
 *     properties: { input: { type: 'string' } },
 *     required: ['input']
 *   },
 *   handler: async (params) => ({
 *     content: [{ type: 'text', text: 'Result' }]
 *   })
 * }
 */
export interface MCPToolInfo {
    /** Unique tool name */
    name: string;
    /** Human-readable description */
    description: string;
    /** JSON Schema for input parameters */
    inputSchema: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
    };
    /** Async function that executes the tool */
    handler: (params: Record<string, unknown>) => Promise<MCPToolResult>;
}
/**
 * Resource information for registration.
 *
 * @description
 * Defines a resource that can be read via the resources/read method.
 * Resources have a URI, name, and optional handler for dynamic content.
 *
 * @interface MCPResourceInfo
 *
 * @example
 * const resource: MCPResourceInfo = {
 *   uri: 'git://repo/HEAD',
 *   name: 'Current HEAD',
 *   mimeType: 'text/plain',
 *   description: 'The current HEAD commit',
 *   handler: async () => ({ content: 'abc123...' })
 * }
 */
export interface MCPResourceInfo {
    /** Unique resource URI */
    uri: string;
    /** Human-readable name */
    name: string;
    /** MIME type of the resource content */
    mimeType?: string;
    /** Human-readable description */
    description?: string;
    /** Async function to retrieve resource content */
    handler?: () => Promise<{
        content: string;
    }>;
}
/**
 * Prompt argument definition.
 *
 * @description
 * Defines an argument that can be passed to a prompt template.
 *
 * @interface MCPPromptArgument
 */
export interface MCPPromptArgument {
    /** Argument name */
    name: string;
    /** Human-readable description */
    description?: string;
    /** Whether this argument is required */
    required?: boolean;
}
/**
 * Prompt information for registration.
 *
 * @description
 * Defines a prompt template that can be retrieved via prompts/get.
 * Prompts can have arguments and a handler to generate messages.
 *
 * @interface MCPPromptInfo
 *
 * @example
 * const prompt: MCPPromptInfo = {
 *   name: 'commit-message',
 *   description: 'Generate a commit message',
 *   arguments: [
 *     { name: 'changes', description: 'Description of changes', required: true }
 *   ],
 *   handler: async (args) => ({
 *     messages: [{
 *       role: 'user',
 *       content: { type: 'text', text: `Write commit message for: ${args.changes}` }
 *     }]
 *   })
 * }
 */
export interface MCPPromptInfo {
    /** Unique prompt name */
    name: string;
    /** Human-readable description */
    description?: string;
    /** Prompt arguments */
    arguments?: MCPPromptArgument[];
    /** Async function to generate prompt messages */
    handler?: (args: Record<string, unknown>) => Promise<{
        messages: Array<{
            role: string;
            content: {
                type: string;
                text: string;
            };
        }>;
    }>;
}
/**
 * MCP Adapter class that bridges MCP protocol to git operations.
 *
 * @description
 * The main adapter class that handles MCP protocol communication. It manages
 * tool, resource, and prompt registrations, processes JSON-RPC requests,
 * and returns properly formatted responses.
 *
 * The adapter supports the following MCP methods:
 * - initialize: Server initialization and capability negotiation
 * - tools/list: List all registered tools
 * - tools/call: Invoke a registered tool
 * - resources/list: List all registered resources
 * - resources/read: Read a resource's content
 * - prompts/list: List all registered prompts
 * - prompts/get: Get a prompt's generated messages
 *
 * @class MCPAdapter
 *
 * @example
 * // Create and use an adapter
 * const adapter = new MCPAdapter({
 *   name: 'my-server',
 *   version: '1.0.0',
 *   capabilities: ['tools']
 * })
 *
 * adapter.registerGitTools()
 * await adapter.start()
 *
 * const response = await adapter.handleRequest({
 *   jsonrpc: '2.0',
 *   id: 1,
 *   method: 'tools/list'
 * })
 */
export declare class MCPAdapter {
    /** @internal */
    private config;
    /** @internal */
    private initialized;
    /** @internal */
    private tools;
    /** @internal */
    private resources;
    /** @internal */
    private prompts;
    /**
     * Create a new MCP adapter instance.
     *
     * @param config - Optional configuration options
     *
     * @example
     * const adapter = new MCPAdapter({
     *   name: 'git-mcp-server',
     *   version: '2.0.0',
     *   capabilities: ['tools', 'resources', 'prompts']
     * })
     */
    constructor(config?: MCPServerConfig);
    /**
     * Get the server configuration.
     *
     * @description
     * Returns a copy of the current server configuration including name,
     * version, and enabled capabilities.
     *
     * @returns A copy of the server configuration
     *
     * @example
     * const config = adapter.getConfig()
     * console.log(`Server: ${config.name} v${config.version}`)
     */
    getConfig(): MCPServerConfig;
    /**
     * Check if adapter has a specific capability.
     *
     * @description
     * Tests whether a specific capability is enabled for this adapter.
     * Used internally to determine which methods are available.
     *
     * @param capability - The capability to check ('tools', 'resources', or 'prompts')
     * @returns True if the capability is enabled
     *
     * @example
     * if (adapter.hasCapability('resources')) {
     *   adapter.registerResource(myResource)
     * }
     */
    hasCapability(capability: MCPCapability): boolean;
    /**
     * Check if the adapter is initialized.
     *
     * @description
     * Returns whether the adapter has been started and is ready to handle requests.
     *
     * @returns True if the adapter is initialized and running
     */
    isInitialized(): boolean;
    /**
     * Start the MCP adapter.
     *
     * @description
     * Initializes the adapter and prepares it to handle requests.
     * Must be called before processing any MCP requests.
     *
     * @returns Promise that resolves when the adapter is started
     * @throws {Error} If the adapter is already started
     *
     * @example
     * const adapter = new MCPAdapter()
     * await adapter.start()
     * // Adapter is now ready to handle requests
     */
    start(): Promise<void>;
    /**
     * Stop the MCP adapter.
     *
     * @description
     * Shuts down the adapter and clears all registered tools, resources,
     * and prompts. After stopping, the adapter must be restarted before
     * handling new requests.
     *
     * @returns Promise that resolves when the adapter is stopped
     * @throws {Error} If the adapter is not currently running
     *
     * @example
     * await adapter.stop()
     * // All registrations are cleared
     */
    stop(): Promise<void>;
    /**
     * Register a tool.
     *
     * @description
     * Adds a tool to the adapter's registry. The tool will be available
     * for listing via tools/list and invocation via tools/call.
     *
     * @param toolInfo - The tool definition to register
     * @returns void
     * @throws {Error} If a tool with the same name is already registered
     *
     * @example
     * adapter.registerTool({
     *   name: 'my_tool',
     *   description: 'Does something',
     *   inputSchema: { type: 'object', properties: {} },
     *   handler: async (params) => ({
     *     content: [{ type: 'text', text: 'Done' }]
     *   })
     * })
     */
    registerTool(toolInfo: MCPToolInfo): void;
    /**
     * Unregister a tool by name.
     *
     * @description
     * Removes a tool from the adapter's registry. The tool will no longer
     * be available for listing or invocation.
     *
     * @param name - The name of the tool to unregister
     * @returns void
     * @throws {Error} If no tool with the given name exists
     *
     * @example
     * adapter.unregisterTool('my_tool')
     */
    unregisterTool(name: string): void;
    /**
     * List all registered tools (without handlers).
     *
     * @description
     * Returns an array of all registered tools with their metadata.
     * Handler functions are omitted for serialization safety.
     *
     * @returns Array of tool definitions without handlers
     *
     * @example
     * const tools = adapter.listTools()
     * for (const tool of tools) {
     *   console.log(`${tool.name}: ${tool.description}`)
     * }
     */
    listTools(): Array<Omit<MCPToolInfo, 'handler'>>;
    /**
     * Get a tool by name (without handler).
     *
     * @description
     * Retrieves a single tool's metadata by name. Returns undefined if
     * the tool is not found.
     *
     * @param name - The name of the tool to retrieve
     * @returns The tool definition without handler, or undefined if not found
     *
     * @example
     * const tool = adapter.getTool('git_status')
     * if (tool) {
     *   console.log(tool.description)
     * }
     */
    getTool(name: string): Omit<MCPToolInfo, 'handler'> | undefined;
    /**
     * Register all git tools.
     *
     * @description
     * Convenience method that registers all built-in git tools from the
     * tools module. Skips any tools that are already registered.
     *
     * @returns void
     *
     * @example
     * const adapter = new MCPAdapter()
     * adapter.registerGitTools()
     * // All 18 git tools are now registered
     */
    registerGitTools(): void;
    /**
     * Register a resource.
     *
     * @description
     * Adds a resource to the adapter's registry. The resource will be
     * available for listing and reading via the resources/* methods.
     *
     * @param resourceInfo - The resource definition to register
     * @returns void
     *
     * @example
     * adapter.registerResource({
     *   uri: 'git://repo/config',
     *   name: 'Repository Config',
     *   mimeType: 'application/json',
     *   handler: async () => ({ content: JSON.stringify(config) })
     * })
     */
    registerResource(resourceInfo: MCPResourceInfo): void;
    /**
     * Register a prompt.
     *
     * @description
     * Adds a prompt template to the adapter's registry. The prompt will
     * be available for listing and retrieval via the prompts/* methods.
     *
     * @param promptInfo - The prompt definition to register
     * @returns void
     *
     * @example
     * adapter.registerPrompt({
     *   name: 'review-code',
     *   description: 'Review code changes',
     *   handler: async () => ({
     *     messages: [{ role: 'user', content: { type: 'text', text: '...' } }]
     *   })
     * })
     */
    registerPrompt(promptInfo: MCPPromptInfo): void;
    /**
     * Handle a raw JSON string request.
     *
     * @description
     * Parses a raw JSON string as an MCP request and processes it.
     * Returns a parse error response if the JSON is invalid.
     *
     * @param rawRequest - Raw JSON string containing the request
     * @returns Promise resolving to the MCP response
     *
     * @example
     * const response = await adapter.handleRawRequest(
     *   '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
     * )
     */
    handleRawRequest(rawRequest: string): Promise<MCPResponse>;
    /**
     * Handle a batch of requests.
     *
     * @description
     * Processes multiple MCP requests sequentially. Notifications (requests
     * without an id) are processed but do not produce responses.
     *
     * @param requests - Array of MCP requests to process
     * @returns Promise resolving to array of responses (excluding notifications)
     *
     * @example
     * const responses = await adapter.handleBatchRequest([
     *   { jsonrpc: '2.0', id: 1, method: 'tools/list' },
     *   { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }
     * ])
     */
    handleBatchRequest(requests: MCPRequest[]): Promise<MCPResponse[]>;
    /**
     * Handle a single MCP request.
     *
     * @description
     * Main request handler that routes MCP requests to the appropriate
     * method handler. Supports initialize, tools/*, resources/*, and prompts/*
     * methods. Returns undefined for notifications (requests without id).
     *
     * @param request - The MCP request to handle
     * @returns Promise resolving to response, or undefined for notifications
     *
     * @example
     * const response = await adapter.handleRequest({
     *   jsonrpc: '2.0',
     *   id: 1,
     *   method: 'tools/call',
     *   params: { name: 'git_status', arguments: {} }
     * })
     */
    handleRequest(request: MCPRequest): Promise<MCPResponse | undefined>;
    /**
     * Handle initialize request.
     *
     * @description
     * Processes the MCP initialize request and returns server information
     * and capabilities. This is the first request a client should send.
     *
     * @param request - The initialize request
     * @returns Response with server info and capabilities
     * @internal
     */
    private handleInitialize;
    /**
     * Handle tools/list request.
     * @param request - The tools/list request
     * @returns Response with list of registered tools
     * @internal
     */
    private handleToolsList;
    /**
     * Handle tools/call request.
     * @param request - The tools/call request with tool name and arguments
     * @returns Response with tool execution result
     * @internal
     */
    private handleToolsCall;
    /**
     * Validate tool parameters against schema.
     * @param tool - The tool to validate parameters for
     * @param params - The parameters to validate
     * @returns Validation result with errors array
     * @internal
     */
    private validateToolParams;
    /**
     * Handle resources/list request.
     * @param request - The resources/list request
     * @returns Response with list of registered resources
     * @internal
     */
    private handleResourcesList;
    /**
     * Handle resources/read request.
     * @param request - The resources/read request with URI
     * @returns Response with resource content
     * @internal
     */
    private handleResourcesRead;
    /**
     * Handle prompts/list request.
     * @param request - The prompts/list request
     * @returns Response with list of registered prompts
     * @internal
     */
    private handlePromptsList;
    /**
     * Handle prompts/get request.
     * @param request - The prompts/get request with name and arguments
     * @returns Response with generated prompt messages
     * @internal
     */
    private handlePromptsGet;
    /**
     * Create an error response.
     * @param id - Request ID
     * @param code - Error code
     * @param message - Error message
     * @param data - Optional additional error data
     * @returns Formatted error response
     * @internal
     */
    private errorResponse;
}
/**
 * Factory function to create an MCP adapter.
 *
 * @description
 * Convenience function for creating a new MCP adapter instance.
 * Equivalent to using `new MCPAdapter(config)`.
 *
 * @param config - Optional server configuration
 * @returns A new MCPAdapter instance
 *
 * @example
 * import { createMCPAdapter } from './adapter'
 *
 * const adapter = createMCPAdapter({
 *   name: 'my-git-server',
 *   capabilities: ['tools', 'resources']
 * })
 *
 * adapter.registerGitTools()
 * await adapter.start()
 */
export declare function createMCPAdapter(config?: MCPServerConfig): MCPAdapter;
//# sourceMappingURL=adapter.d.ts.map