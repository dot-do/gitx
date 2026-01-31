/**
 * gitx.do MCP Server
 *
 * Model Context Protocol server for git operations.
 * Exposes git tools with OAuth 2.1 authentication via oauth.do.
 *
 * @module mcp
 */
export { type McpToolResult, type McpToolSchema, type McpToolHandler, type McpTool, type ToolRegistry, type ToolContext, type ToolMiddleware, type InvokeToolOptions, registerTool, unregisterTool, invokeTool, getToolRegistry, clearToolRegistry, useMiddleware, clearMiddleware, } from './tool-registry';
export { gitTools, gitStatusToolSchema, gitLogToolSchema, gitDiffToolSchema, gitShowToolSchema, gitCommitToolSchema, gitBranchToolSchema, gitCheckoutToolSchema, gitAddToolSchema, gitResetToolSchema, gitMergeToolSchema, gitRebaseToolSchema, gitStashToolSchema, gitTagToolSchema, gitRemoteToolSchema, gitFetchToolSchema, gitPushToolSchema, gitPullToolSchema, gitCloneToolSchema, gitInitToolSchema, gitBlameToolSchema, } from './tools';
export { gitAuthMiddleware, requireGitAuth, requireGitWrite, requireGitAdmin, type GitAuthContext, type GitAuthConfig, } from './auth';
export { createGitMCPServer, type GitMCPServerOptions } from './server';
//# sourceMappingURL=index.d.ts.map