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
export { createGitBindingFromContext, createGitTools, type GitBinding, gitTools, registerTool, validateToolInput, invokeTool, listTools, getTool, type JSONSchema, type MCPToolResult, type MCPToolHandler, type MCPTool, } from './tools';
export { MCPAdapter, createMCPAdapter, MCPError, MCPErrorCode, type MCPCapability, type MCPServerConfig, type MCPRequest, type MCPResponse, type MCPToolInfo, type MCPResourceInfo, type MCPPromptArgument, type MCPPromptInfo, } from './adapter';
//# sourceMappingURL=index.d.ts.map