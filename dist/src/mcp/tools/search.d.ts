/**
 * @fileoverview Search Tool
 *
 * MCP tool for searching git repository content including commits, branches, and tags.
 *
 * @module mcp/tools/search
 */
import type { ToolResponse, SearchResult as BaseSearchResult } from '@dotdo/mcp';
import type { GitBinding } from './do';
export type { ToolResponse };
/**
 * Search input parameters (git-specific, extends beyond @dotdo/mcp's generic SearchInput)
 */
export interface SearchInput {
    query: string;
    type?: 'commits' | 'branches' | 'tags' | 'all';
    limit?: number;
}
/**
 * Search options (git-specific)
 */
export interface SearchOptions {
    type?: 'commits' | 'branches' | 'tags' | 'all';
    limit?: number;
}
/**
 * Git object type
 */
export type GitObjectType = 'commit' | 'branch' | 'tag';
/**
 * Search result item extending @dotdo/mcp base SearchResult with git-specific fields.
 *
 * Base fields (from @dotdo/mcp):
 * - id: Unique identifier (maps to sha or ref)
 * - title: Display title (maps to branch name or commit summary)
 * - description: Description (maps to commit message or branch info)
 *
 * Git-specific extensions:
 * - gitType: The type of git object (commit, branch, tag)
 * - ref: Git reference string
 * - sha: Full commit SHA (optional)
 * - author: Commit author (optional)
 * - date: Commit date (optional)
 */
export interface SearchResult extends BaseSearchResult {
    /** Git object type (commit, branch, or tag) */
    gitType: GitObjectType;
    /** Git reference string */
    ref: string;
    /** Full commit SHA (when available) */
    sha?: string;
    /** Commit author (for commits) */
    author?: string;
    /** Commit date (for commits) */
    date?: string;
}
/**
 * Search tool definition
 */
export declare const searchToolDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            type: {
                type: string;
                enum: string[];
                description: string;
            };
            limit: {
                type: string;
                description: string;
                minimum: number;
                maximum: number;
            };
        };
        required: string[];
    };
};
/**
 * Create a search handler that uses the git binding
 */
export declare function createSearchHandler(git: GitBinding): (input: SearchInput) => Promise<ToolResponse>;
/**
 * Search tool instance (requires git binding to be set)
 */
export declare const searchTool: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            query: {
                type: string;
                description: string;
            };
            type: {
                type: string;
                enum: string[];
                description: string;
            };
            limit: {
                type: string;
                description: string;
                minimum: number;
                maximum: number;
            };
        };
        required: string[];
    };
};
//# sourceMappingURL=search.d.ts.map