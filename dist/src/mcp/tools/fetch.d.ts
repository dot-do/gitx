/**
 * @fileoverview Fetch Tool
 *
 * MCP tool for retrieving git resources by reference (commit, file, diff).
 *
 * @module mcp/tools/fetch
 */
import type { ToolResponse } from '@dotdo/mcp';
import type { GitBinding } from './do';
export type { ToolResponse };
/**
 * Resource types that can be fetched (git-specific)
 */
export type ResourceType = 'commit' | 'file' | 'diff' | 'tree' | 'blob';
/**
 * Fetch input parameters (git-specific, extends beyond @dotdo/mcp's generic FetchInput)
 */
export interface FetchInput {
    resource: string;
    format?: 'json' | 'text' | 'raw';
}
/**
 * Fetch options (git-specific)
 */
export interface FetchOptions {
    format?: 'json' | 'text' | 'raw';
}
/**
 * Fetch result (git-specific, different from @dotdo/mcp's generic FetchResult)
 */
export interface FetchResult {
    type: ResourceType;
    content: string;
    metadata?: Record<string, unknown>;
}
/**
 * Fetch tool definition
 */
export declare const fetchToolDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            resource: {
                type: string;
                description: string;
            };
            format: {
                type: string;
                enum: string[];
                description: string;
            };
        };
        required: string[];
    };
};
/**
 * Create a fetch handler that uses the git binding
 */
export declare function createFetchHandler(git: GitBinding): (input: FetchInput) => Promise<ToolResponse>;
/**
 * Fetch tool instance (requires git binding to be set)
 */
export declare const fetchTool: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            resource: {
                type: string;
                description: string;
            };
            format: {
                type: string;
                enum: string[];
                description: string;
            };
        };
        required: string[];
    };
};
//# sourceMappingURL=fetch.d.ts.map