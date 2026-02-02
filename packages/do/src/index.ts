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

// =============================================================================
// Re-export core git types from @dotdo/gitx
// =============================================================================

export * from '@dotdo/gitx'

// =============================================================================
// Cloudflare-specific Schema Management
// =============================================================================

export {
  SchemaManager,
  SCHEMA_VERSION,
  SCHEMA_SQL,
  type DurableObjectStorage,
} from './do/schema'

// =============================================================================
// Cloudflare-specific Types
// =============================================================================

export {
  // Core DO types
  type DOState,
  type DOStorage,
  type ServiceBinding,
  type DONamespaceBinding,
  type DOStub,

  // Environment bindings
  type R2Binding,
  type R2Object,
  type KVBinding,
  type PipelineBinding,
  type BaseEnv,
  type GitRepoDOEnv,

  // Repository options
  type InitializeOptions,
  type ForkOptions,
  type ForkResult,
  type CompactResult,

  // Workflow types
  type WorkflowContext,
  type StoreAccessor,
  type TypedStoreAccessor,

  // FS Capability
  type FsCapability,

  // Error types
  GitRepoDOErrorCode,
  GitRepoDOError,

  // Logging types
  LogLevel,
  type LogEntry,
  type Logger,

  // Health check
  type HealthCheckResponse,
} from './do/types'

// =============================================================================
// Logger utilities
// =============================================================================

export {
  createLogger,
  createChildLogger,
  NOOP_LOGGER,
  noopLogger,
  type LoggerOptions,
} from './do/logger'

// =============================================================================
// MCP Server
// =============================================================================

export {
  // Tool registry
  type McpToolResult,
  type McpToolSchema,
  type McpToolHandler,
  type McpTool,
  type ToolRegistry,
  type ToolContext,
  type ToolMiddleware,
  type InvokeToolOptions,
  registerTool,
  unregisterTool,
  invokeTool,
  getToolRegistry,
  clearToolRegistry,
  useMiddleware,
  clearMiddleware,
  // Git tools
  gitTools,
  gitStatusToolSchema,
  gitLogToolSchema,
  gitDiffToolSchema,
  gitShowToolSchema,
  gitCommitToolSchema,
  gitBranchToolSchema,
  gitCheckoutToolSchema,
  gitAddToolSchema,
  gitResetToolSchema,
  gitMergeToolSchema,
  gitRebaseToolSchema,
  gitStashToolSchema,
  gitTagToolSchema,
  gitRemoteToolSchema,
  gitFetchToolSchema,
  gitPushToolSchema,
  gitPullToolSchema,
  gitCloneToolSchema,
  gitInitToolSchema,
  gitBlameToolSchema,
  // Auth
  gitAuthMiddleware,
  requireGitAuth,
  requireGitWrite,
  requireGitAdmin,
  type GitAuthContext,
  type GitAuthConfig,
  // Server
  createGitMCPServer,
  type GitMCPServerOptions,
} from './mcp/index'

// =============================================================================
// TODO: Additional exports to be added as migration continues
// =============================================================================
// - GitRepoDO
// - GitModule
// - FsModule
// - withGit, withFs mixins
// - TieredStorage
// - ObjectStore
// - WAL
// - Container executor
