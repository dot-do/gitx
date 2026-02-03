/**
 * @fileoverview Do Tool
 *
 * MCP tool for executing code in a sandboxed environment with access to git bindings.
 * Uses @dotdo/mcp's createDoHandler with ai-evaluate for secure V8 sandbox execution.
 *
 * @module mcp/tools/do
 */
import type { DoScope, DoPermissions, ToolResponse } from '@dotdo/mcp';
/**
 * Sandbox environment type for Cloudflare Workers.
 * This type is used when evaluating code in a sandboxed environment.
 */
type SandboxEnv = {
    LOADER?: unknown;
};
import { ObjectStoreProxy } from '../sandbox/object-store-proxy';
import { type GitStatusOptions, type GitStatusResult, type GitLogOptions, type GitLogResult, type GitDiffOptions, type GitShowOptions, type GitCommitOptions, type GitAddOptions, type GitCheckoutOptions, type GitBranchOptions, type GitBranchResult, type GitMergeOptions, type GitPushOptions, type GitPullOptions, type GitFetchOptions, type GitCloneOptions, type GitInitOptions, type McpGitBinding } from '../../types/git-binding';
export type { GitStatusOptions, GitStatusResult, GitLogOptions, GitLogResult, GitDiffOptions, GitShowOptions, GitCommitOptions, GitAddOptions, GitCheckoutOptions, GitBranchOptions, GitBranchResult, GitMergeOptions, GitPushOptions, GitPullOptions, GitFetchOptions, GitCloneOptions, GitInitOptions, };
/**
 * Git binding interface exposing git operations
 *
 * @deprecated Use McpGitBinding from types/git-binding instead
 */
export type GitBinding = McpGitBinding;
export type { DoPermissions };
/**
 * Git-specific DoScope configuration (extends DoScope with typed git binding)
 */
export interface GitScope extends DoScope {
    bindings: {
        git: GitBinding;
        [key: string]: unknown;
    };
}
export interface DoToolInput {
    code: string;
    timeout?: number;
}
export interface DoToolOutput {
    success: boolean;
    result?: unknown;
    error?: string;
    logs: string[];
    duration: number;
}
export type { ToolResponse };
/**
 * Create a GitScope with the provided git binding
 */
export declare function createGitScope(git: GitBinding, options?: {
    timeout?: number;
    permissions?: DoPermissions;
}): GitScope;
/**
 * Execute code with git binding available
 *
 * @param input - The code to execute and optional timeout
 * @param objectStore - Object store proxy for advanced operations
 * @returns Execution result
 */
export declare function executeDo(input: DoToolInput, objectStore: ObjectStoreProxy): Promise<DoToolOutput>;
/**
 * Create a do handler that uses the git scope
 *
 * Uses @dotdo/mcp's createDoHandler which leverages ai-evaluate for secure
 * V8 sandbox execution. In Cloudflare Workers, pass env with LOADER binding.
 * In Node.js/testing, ai-evaluate falls back to Miniflare automatically.
 *
 * @param scope - The GitScope with git binding and configuration
 * @param env - Optional worker environment with LOADER binding (from cloudflare:workers)
 * @returns Handler function for the do tool
 */
export declare function createDoHandler(scope: GitScope, _env?: SandboxEnv): (input: DoToolInput) => Promise<ToolResponse>;
/**
 * Do tool definition
 */
export declare const doToolDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            code: {
                type: string;
                description: string;
            };
            timeout: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
//# sourceMappingURL=do.d.ts.map