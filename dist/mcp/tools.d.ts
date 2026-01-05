/**
 * MCP (Model Context Protocol) Git Tool Definitions
 *
 * This module provides tool definitions for git operations that can be
 * exposed via the Model Context Protocol for AI assistants.
 */
import { RefStore } from '../ops/branch';
import type { CommitObject, TreeObject } from '../types/objects';
/**
 * Repository context for MCP tool operations
 * This provides access to the git repository's storage layers
 */
export interface RepositoryContext {
    /** Object store for reading git objects */
    objectStore: {
        getObject(sha: string): Promise<{
            type: string;
            data: Uint8Array;
        } | null>;
        getCommit(sha: string): Promise<CommitObject | null>;
        getTree(sha: string): Promise<TreeObject | null>;
        getBlob(sha: string): Promise<Uint8Array | null>;
        storeObject(type: string, data: Uint8Array): Promise<string>;
        hasObject(sha: string): Promise<boolean>;
    };
    /** Ref store for branch/tag operations */
    refStore: RefStore;
    /** Index/staging area (optional, for status/diff operations) */
    index?: {
        getEntries(): Promise<Array<{
            path: string;
            mode: string;
            sha: string;
            stage: number;
        }>>;
    };
    /** Working directory (optional, for status operations) */
    workdir?: {
        getFiles(): Promise<Array<{
            path: string;
            mode: string;
            sha: string;
        }>>;
    };
}
/**
 * Set the global repository context for MCP tools
 */
export declare function setRepositoryContext(ctx: RepositoryContext | null): void;
/**
 * Get the global repository context
 */
export declare function getRepositoryContext(): RepositoryContext | null;
/**
 * JSON Schema definition for tool input parameters
 */
export interface JSONSchema {
    type: string;
    properties?: Record<string, JSONSchema>;
    required?: string[];
    description?: string;
    items?: JSONSchema;
    enum?: string[];
    default?: unknown;
    minimum?: number;
    maximum?: number;
    pattern?: string;
}
/**
 * Represents the result of invoking an MCP tool
 */
export interface MCPToolResult {
    content: Array<{
        type: 'text' | 'image' | 'resource';
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}
/**
 * Handler function type for MCP tools
 */
export type MCPToolHandler = (params: Record<string, unknown>) => Promise<MCPToolResult>;
/**
 * Defines an MCP tool with its schema and handler
 */
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: JSONSchema;
    handler: MCPToolHandler;
}
/**
 * Registry of available git tools
 */
export declare const gitTools: MCPTool[];
/**
 * Register a new tool in the registry
 * @param tool - The tool to register
 * @throws Error if tool with same name already exists or if handler is missing
 */
export declare function registerTool(tool: MCPTool): void;
/**
 * Validate input parameters against a tool's schema
 * @param tool - The tool whose schema to validate against
 * @param params - The parameters to validate
 * @returns Validation result with errors if any
 */
export declare function validateToolInput(tool: MCPTool, params: Record<string, unknown>): {
    valid: boolean;
    errors: string[];
};
/**
 * Invoke a tool by name with the given parameters
 * @param toolName - Name of the tool to invoke
 * @param params - Parameters to pass to the tool
 * @returns Result of the tool invocation
 * @throws Error if tool not found
 */
export declare function invokeTool(toolName: string, params: Record<string, unknown>): Promise<MCPToolResult>;
/**
 * Get a list of all registered tools
 * @returns Array of tool definitions (without handlers)
 */
export declare function listTools(): Array<Omit<MCPTool, 'handler'>>;
/**
 * Get a tool by name
 * @param name - Name of the tool to retrieve
 * @returns The tool if found, undefined otherwise
 */
export declare function getTool(name: string): MCPTool | undefined;
//# sourceMappingURL=tools.d.ts.map