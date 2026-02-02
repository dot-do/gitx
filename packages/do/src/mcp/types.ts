/**
 * MCP Types for gitx.do
 *
 * Type definitions for the MCP git tools and server.
 *
 * @module mcp/types
 */

/**
 * MCP tool result format.
 */
export interface McpToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >
  isError?: boolean
}

/**
 * Property schema for tool parameters.
 */
export interface PropertySchema {
  type?: string
  description?: string
  enum?: readonly unknown[]
  default?: unknown
  items?: PropertySchema
  properties?: Record<string, PropertySchema>
  required?: readonly string[]
  minimum?: number
  maximum?: number
  pattern?: string
}

/**
 * Input schema for MCP tools.
 */
export interface InputSchema<P extends Record<string, PropertySchema> = Record<string, PropertySchema>> {
  type: 'object'
  properties: P
  required?: readonly string[] | string[]
}

/**
 * MCP tool schema definition.
 */
export interface McpToolSchema<P extends Record<string, PropertySchema> = Record<string, PropertySchema>> {
  name: string
  description: string
  inputSchema: InputSchema<P>
}

/**
 * Git authentication context.
 */
export interface GitAuthContext {
  type: 'oauth' | 'apikey' | 'anon'
  id: string
  readonly: boolean
  isAdmin?: boolean
  scopes?: Set<string>
  metadata?: Record<string, unknown>
}

/**
 * Git authentication configuration.
 */
export interface GitAuthConfig {
  /** OAuth introspection URL (from oauth.do) */
  introspectionUrl?: string
  /** OAuth client ID */
  clientId?: string
  /** OAuth client secret */
  clientSecret?: string
  /** API key verification function */
  verifyApiKey?: (key: string) => Promise<GitAuthContext | null>
  /** Allow anonymous access for read operations */
  allowAnonymous?: boolean
  /** Anonymous access is readonly by default */
  anonymousReadonly?: boolean
}

/**
 * Context passed to tool handlers.
 */
export interface ToolContext {
  toolName: string
  timestamp: number
  metadata?: Record<string, unknown> | undefined
  auth?: GitAuthContext | undefined
}

/**
 * Tool handler function type.
 */
export type McpToolHandler<
  TParams extends Record<string, unknown> = Record<string, unknown>,
  TStorage = unknown
> = (
  params: TParams,
  storage?: TStorage,
  context?: ToolContext
) => Promise<McpToolResult>

/**
 * Middleware function type.
 */
export type ToolMiddleware = (
  context: ToolContext,
  params: Record<string, unknown>,
  next: () => Promise<McpToolResult>
) => Promise<McpToolResult>

/**
 * Registered MCP tool.
 */
export interface McpTool<
  P extends Record<string, PropertySchema> = Record<string, PropertySchema>
> {
  schema: McpToolSchema<P>
  handler: McpToolHandler
}

/**
 * Tool registry interface.
 */
export interface ToolRegistry {
  has(name: string): boolean
  get(name: string): McpTool | undefined
  list(): string[]
  schemas(): McpToolSchema[]
  count(): number
  filter(predicate: (tool: McpTool) => boolean): McpTool[]
}

/**
 * Options for tool invocation.
 */
export interface InvokeToolOptions {
  strictValidation?: boolean
  metadata?: Record<string, unknown> | undefined
  auth?: GitAuthContext | undefined
}
