/**
 * gitx.do MCP Server
 *
 * Model Context Protocol server for git operations.
 * Exposes git tools with OAuth 2.1 authentication via oauth.do.
 *
 * @module mcp
 */
// Core MCP types and server
export { registerTool, unregisterTool, invokeTool, getToolRegistry, clearToolRegistry, useMiddleware, clearMiddleware, } from './tool-registry';
// Git tools
export { gitTools, 
// Individual tool schemas
gitStatusToolSchema, gitLogToolSchema, gitDiffToolSchema, gitShowToolSchema, gitCommitToolSchema, gitBranchToolSchema, gitCheckoutToolSchema, gitAddToolSchema, gitResetToolSchema, gitMergeToolSchema, gitRebaseToolSchema, gitStashToolSchema, gitTagToolSchema, gitRemoteToolSchema, gitFetchToolSchema, gitPushToolSchema, gitPullToolSchema, gitCloneToolSchema, gitInitToolSchema, gitBlameToolSchema, } from './tools';
// Auth middleware
export { gitAuthMiddleware, requireGitAuth, requireGitWrite, requireGitAdmin, } from './auth';
// Server factory
export { createGitMCPServer } from './server';
//# sourceMappingURL=index.js.map