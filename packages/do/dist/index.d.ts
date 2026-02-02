/**
 * @fileoverview gitx.do - Git on Cloudflare Durable Objects
 *
 * This package provides the Cloudflare Workers/Durable Objects integration
 * for gitx. It depends on @dotdo/gitx for the pure git implementation.
 *
 * @module gitx.do
 *
 * @example
 * ```typescript
 * import { GitRepoDO, GitModule, withGit } from 'gitx.do'
 *
 * // Use GitRepoDO for full repository management
 * export { GitRepoDO }
 *
 * // Or use mixins for custom DOs
 * class MyDO extends withGit(DurableObject) {
 *   async doSomething() {
 *     await this.git.clone('https://github.com/org/repo')
 *   }
 * }
 * ```
 */
export * from '@dotdo/gitx';
export { SchemaManager, SCHEMA_VERSION, SCHEMA_SQL, type DurableObjectStorage, } from './do/schema';
export { type DOState, type DOStorage, type ServiceBinding, type DONamespaceBinding, type DOStub, type R2Binding, type R2Object, type KVBinding, type PipelineBinding, type BaseEnv, type GitRepoDOEnv, type InitializeOptions, type ForkOptions, type ForkResult, type CompactResult, type WorkflowContext, type StoreAccessor, type TypedStoreAccessor, type FsCapability, GitRepoDOErrorCode, GitRepoDOError, LogLevel, type LogEntry, type Logger, type HealthCheckResponse, } from './do/types';
export { createLogger, createChildLogger, NOOP_LOGGER, noopLogger, type LoggerOptions, } from './do/logger';
export { type McpToolResult, type McpToolSchema, type McpToolHandler, type McpTool, type ToolRegistry, type ToolContext, type ToolMiddleware, type InvokeToolOptions, registerTool, unregisterTool, invokeTool, getToolRegistry, clearToolRegistry, useMiddleware, clearMiddleware, gitTools, gitStatusToolSchema, gitLogToolSchema, gitDiffToolSchema, gitShowToolSchema, gitCommitToolSchema, gitBranchToolSchema, gitCheckoutToolSchema, gitAddToolSchema, gitResetToolSchema, gitMergeToolSchema, gitRebaseToolSchema, gitStashToolSchema, gitTagToolSchema, gitRemoteToolSchema, gitFetchToolSchema, gitPushToolSchema, gitPullToolSchema, gitCloneToolSchema, gitInitToolSchema, gitBlameToolSchema, gitAuthMiddleware, requireGitAuth, requireGitWrite, requireGitAdmin, type GitAuthContext, type GitAuthConfig, createGitMCPServer, type GitMCPServerOptions, } from './mcp/index';
//# sourceMappingURL=index.d.ts.map