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
createGitBindingFromContext, createGitTools, 
// Legacy tool definitions (backward compat)
gitTools, registerTool, validateToolInput, invokeTool, listTools, getTool, } from './tools';
// MCP Adapter
export { 
// Adapter
MCPAdapter, createMCPAdapter, MCPError, MCPErrorCode, } from './adapter';
//# sourceMappingURL=index.js.map