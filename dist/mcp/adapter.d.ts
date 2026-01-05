/**
 * MCP (Model Context Protocol) SDK Adapter
 *
 * This module provides an adapter that bridges the MCP protocol to git operations,
 * handling request/response, tool registration/invocation, resource listing,
 * and error handling.
 */
import { type MCPToolResult } from './tools';
/**
 * JSON-RPC 2.0 error codes and MCP-specific error codes
 */
export declare enum MCPErrorCode {
    PARSE_ERROR = -32700,
    INVALID_REQUEST = -32600,
    METHOD_NOT_FOUND = -32601,
    INVALID_PARAMS = -32602,
    INTERNAL_ERROR = -32603,
    RESOURCE_NOT_FOUND = -32001,
    TOOL_NOT_FOUND = -32601,
    PROMPT_NOT_FOUND = -32003,
    CAPABILITY_NOT_SUPPORTED = -32004
}
/**
 * Custom error class for MCP errors
 */
export declare class MCPError extends Error {
    code: MCPErrorCode;
    data?: unknown;
    constructor(code: MCPErrorCode, message: string, data?: unknown);
    toJSON(): {
        code: MCPErrorCode;
        message: string;
        data?: unknown;
    };
}
/**
 * MCP capability types
 */
export type MCPCapability = 'tools' | 'resources' | 'prompts';
/**
 * Server configuration for MCP adapter
 */
export interface MCPServerConfig {
    name?: string;
    version?: string;
    capabilities?: MCPCapability[];
}
/**
 * MCP request structure (JSON-RPC 2.0)
 */
export interface MCPRequest {
    jsonrpc: '2.0';
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
}
/**
 * MCP response structure (JSON-RPC 2.0)
 */
export interface MCPResponse {
    jsonrpc: '2.0';
    id?: string | number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}
/**
 * Tool information for registration
 */
export interface MCPToolInfo {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
    };
    handler: (params: Record<string, unknown>) => Promise<MCPToolResult>;
}
/**
 * Resource information for registration
 */
export interface MCPResourceInfo {
    uri: string;
    name: string;
    mimeType?: string;
    description?: string;
    handler?: () => Promise<{
        content: string;
    }>;
}
/**
 * Prompt argument definition
 */
export interface MCPPromptArgument {
    name: string;
    description?: string;
    required?: boolean;
}
/**
 * Prompt information for registration
 */
export interface MCPPromptInfo {
    name: string;
    description?: string;
    arguments?: MCPPromptArgument[];
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
 * MCP Adapter class that bridges MCP protocol to git operations
 */
export declare class MCPAdapter {
    private config;
    private initialized;
    private tools;
    private resources;
    private prompts;
    constructor(config?: MCPServerConfig);
    /**
     * Get the server configuration
     */
    getConfig(): MCPServerConfig;
    /**
     * Check if adapter has a specific capability
     */
    hasCapability(capability: MCPCapability): boolean;
    /**
     * Check if the adapter is initialized
     */
    isInitialized(): boolean;
    /**
     * Start the MCP adapter
     */
    start(): Promise<void>;
    /**
     * Stop the MCP adapter
     */
    stop(): Promise<void>;
    /**
     * Register a tool
     */
    registerTool(toolInfo: MCPToolInfo): void;
    /**
     * Unregister a tool by name
     */
    unregisterTool(name: string): void;
    /**
     * List all registered tools (without handlers)
     */
    listTools(): Array<Omit<MCPToolInfo, 'handler'>>;
    /**
     * Get a tool by name (without handler)
     */
    getTool(name: string): Omit<MCPToolInfo, 'handler'> | undefined;
    /**
     * Register all git tools
     */
    registerGitTools(): void;
    /**
     * Register a resource
     */
    registerResource(resourceInfo: MCPResourceInfo): void;
    /**
     * Register a prompt
     */
    registerPrompt(promptInfo: MCPPromptInfo): void;
    /**
     * Handle a raw JSON string request
     */
    handleRawRequest(rawRequest: string): Promise<MCPResponse>;
    /**
     * Handle a batch of requests
     */
    handleBatchRequest(requests: MCPRequest[]): Promise<MCPResponse[]>;
    /**
     * Handle a single MCP request
     */
    handleRequest(request: MCPRequest): Promise<MCPResponse | undefined>;
    /**
     * Handle initialize request
     */
    private handleInitialize;
    /**
     * Handle tools/list request
     */
    private handleToolsList;
    /**
     * Handle tools/call request
     */
    private handleToolsCall;
    /**
     * Validate tool parameters against schema
     */
    private validateToolParams;
    /**
     * Handle resources/list request
     */
    private handleResourcesList;
    /**
     * Handle resources/read request
     */
    private handleResourcesRead;
    /**
     * Handle prompts/list request
     */
    private handlePromptsList;
    /**
     * Handle prompts/get request
     */
    private handlePromptsGet;
    /**
     * Create an error response
     */
    private errorResponse;
}
/**
 * Factory function to create an MCP adapter
 */
export declare function createMCPAdapter(config?: MCPServerConfig): MCPAdapter;
//# sourceMappingURL=adapter.d.ts.map