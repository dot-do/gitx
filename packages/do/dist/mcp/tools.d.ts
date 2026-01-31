/**
 * Git MCP Tools
 *
 * MCP tool definitions for git operations.
 * Each tool follows the MCP specification with JSON Schema input validation.
 *
 * Available tools:
 * - git_status: Show repository status
 * - git_log: Show commit history
 * - git_diff: Show differences
 * - git_show: Show objects
 * - git_commit: Create commits
 * - git_branch: Manage branches
 * - git_checkout: Switch branches
 * - git_add: Stage files
 * - git_reset: Reset HEAD
 * - git_merge: Merge branches
 * - git_rebase: Rebase commits
 * - git_stash: Stash changes
 * - git_tag: Manage tags
 * - git_remote: Manage remotes
 * - git_fetch: Fetch from remotes
 * - git_push: Push to remotes
 * - git_pull: Pull from remotes
 * - git_clone: Clone repositories
 * - git_init: Initialize repositories
 * - git_blame: Show line-by-line authorship
 *
 * @module mcp/tools
 */
import type { McpToolSchema, McpTool } from './types';
/**
 * git_status - Show repository status
 */
export declare const gitStatusToolSchema: McpToolSchema;
/**
 * git_log - Show commit history
 */
export declare const gitLogToolSchema: McpToolSchema;
/**
 * git_diff - Show differences
 */
export declare const gitDiffToolSchema: McpToolSchema;
/**
 * git_show - Show objects
 */
export declare const gitShowToolSchema: McpToolSchema;
/**
 * git_commit - Create commits (write operation)
 */
export declare const gitCommitToolSchema: McpToolSchema;
/**
 * git_branch - Manage branches
 */
export declare const gitBranchToolSchema: McpToolSchema;
/**
 * git_checkout - Switch branches (write operation)
 */
export declare const gitCheckoutToolSchema: McpToolSchema;
/**
 * git_add - Stage files (write operation)
 */
export declare const gitAddToolSchema: McpToolSchema;
/**
 * git_reset - Reset HEAD (write operation)
 */
export declare const gitResetToolSchema: McpToolSchema;
/**
 * git_merge - Merge branches (write operation)
 */
export declare const gitMergeToolSchema: McpToolSchema;
/**
 * git_rebase - Rebase commits (write operation)
 */
export declare const gitRebaseToolSchema: McpToolSchema;
/**
 * git_stash - Stash changes (write operation)
 */
export declare const gitStashToolSchema: McpToolSchema;
/**
 * git_tag - Manage tags
 */
export declare const gitTagToolSchema: McpToolSchema;
/**
 * git_remote - Manage remotes
 */
export declare const gitRemoteToolSchema: McpToolSchema;
/**
 * git_fetch - Fetch from remotes (write operation - updates refs)
 */
export declare const gitFetchToolSchema: McpToolSchema;
/**
 * git_push - Push to remotes (write operation)
 */
export declare const gitPushToolSchema: McpToolSchema;
/**
 * git_pull - Pull from remotes (write operation)
 */
export declare const gitPullToolSchema: McpToolSchema;
/**
 * git_clone - Clone repositories (write operation)
 */
export declare const gitCloneToolSchema: McpToolSchema;
/**
 * git_init - Initialize repositories (write operation)
 */
export declare const gitInitToolSchema: McpToolSchema;
/**
 * git_blame - Show line-by-line authorship
 */
export declare const gitBlameToolSchema: McpToolSchema;
/**
 * Tools that require write access (modify repository state)
 */
export declare const WRITE_TOOLS: Set<string>;
/**
 * Tools that may require write access depending on operation
 */
export declare const CONDITIONAL_WRITE_TOOLS: Set<string>;
/**
 * Read-only tools (never modify repository state)
 */
export declare const READ_TOOLS: Set<string>;
/**
 * Check if a tool invocation requires write access
 */
export declare function requiresWriteAccess(toolName: string, params: Record<string, unknown>): boolean;
/**
 * Array of all built-in git MCP tools.
 */
export declare const gitTools: McpTool[];
/**
 * Map of tool names to tools for quick lookup
 */
export declare const gitToolMap: Map<string, McpTool<Record<string, import("./types").PropertySchema>>>;
//# sourceMappingURL=tools.d.ts.map