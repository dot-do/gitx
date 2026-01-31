/**
 * MCP Tool Registry for gitx.do
 *
 * Provides a central registry for MCP tools with:
 * - Tool registration and unregistration
 * - Tool invocation via dispatcher
 * - Built-in git tools
 * - Parameter validation
 * - Middleware support
 *
 * @module mcp/tool-registry
 */
import type { McpToolResult, McpToolSchema, McpToolHandler, McpTool, ToolRegistry, ToolContext, ToolMiddleware, InvokeToolOptions, PropertySchema } from './types';
export type { McpToolResult, McpToolSchema, McpToolHandler, McpTool, ToolRegistry, ToolContext, ToolMiddleware, InvokeToolOptions, PropertySchema, };
/**
 * Register a custom tool.
 */
export declare function registerTool(schema: McpToolSchema, handler: McpToolHandler): void;
/**
 * Unregister a tool.
 */
export declare function unregisterTool(name: string): void;
/**
 * Register middleware that runs on all tool invocations.
 */
export declare function useMiddleware(middleware: ToolMiddleware): void;
/**
 * Clear all registered middleware.
 */
export declare function clearMiddleware(): void;
/**
 * Get the tool registry interface.
 */
export declare function getToolRegistry(): ToolRegistry;
/**
 * Clear all custom tools from the registry.
 */
export declare function clearToolRegistry(): void;
/**
 * Invoke a tool by name.
 */
export declare function invokeTool(name: string, params: Record<string, unknown>, storage?: unknown, options?: InvokeToolOptions): Promise<McpToolResult>;
/**
 * Check if a tool is a builtin tool.
 */
export declare function isBuiltinTool(name: string): boolean;
//# sourceMappingURL=tool-registry.d.ts.map