/**
 * @fileoverview MCP (Model Context Protocol) Subpath Barrel
 *
 * Targeted exports for MCP integration: tools, adapter, and protocol handling.
 *
 * @module mcp
 *
 * @example
 * ```typescript
 * import { gitTools, createMCPAdapter, MCPError } from 'gitx.do/mcp'
 * ```
 */

// MCP Tool Definitions
export {
  // New search/fetch/do tools
  createGitBindingFromContext,
  createGitTools,
  type GitBinding,
  // Legacy tool definitions (backward compat)
  gitTools,
  registerTool,
  validateToolInput,
  invokeTool,
  listTools,
  getTool,
  // Types
  type JSONSchema,
  type MCPToolResult,
  type MCPToolHandler,
  type MCPTool,
} from './tools'

// MCP Adapter
export {
  // Adapter
  MCPAdapter,
  createMCPAdapter,
  MCPError,
  MCPErrorCode,
  // Types
  type MCPCapability,
  type MCPServerConfig,
  type MCPRequest,
  type MCPResponse,
  type MCPToolInfo,
  type MCPResourceInfo,
  type MCPPromptArgument,
  type MCPPromptInfo,
} from './adapter'
