/**
 * MCP (Model Context Protocol) SDK Adapter
 *
 * This module provides an adapter that bridges the MCP protocol to git operations,
 * handling request/response, tool registration/invocation, resource listing,
 * and error handling.
 */

import { gitTools, type MCPToolResult } from './tools'

/**
 * JSON-RPC 2.0 error codes and MCP-specific error codes
 */
export enum MCPErrorCode {
  // JSON-RPC standard error codes
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,

  // MCP-specific error codes (must be < -32000 per JSON-RPC spec)
  RESOURCE_NOT_FOUND = -32001,
  // TOOL_NOT_FOUND maps to METHOD_NOT_FOUND as tools are essentially methods
  TOOL_NOT_FOUND = -32601,
  PROMPT_NOT_FOUND = -32003,
  CAPABILITY_NOT_SUPPORTED = -32004,
}

/**
 * Custom error class for MCP errors
 */
export class MCPError extends Error {
  code: MCPErrorCode
  data?: unknown

  constructor(code: MCPErrorCode, message: string, data?: unknown) {
    super(message)
    this.code = code
    this.data = data
    this.name = 'MCPError'
  }

  toJSON(): { code: MCPErrorCode; message: string; data?: unknown } {
    const result: { code: MCPErrorCode; message: string; data?: unknown } = {
      code: this.code,
      message: this.message,
    }
    if (this.data !== undefined) {
      result.data = this.data
    }
    return result
  }
}

/**
 * MCP capability types
 */
export type MCPCapability = 'tools' | 'resources' | 'prompts'

/**
 * Server configuration for MCP adapter
 */
export interface MCPServerConfig {
  name?: string
  version?: string
  capabilities?: MCPCapability[]
}

/**
 * MCP request structure (JSON-RPC 2.0)
 */
export interface MCPRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

/**
 * MCP response structure (JSON-RPC 2.0)
 */
export interface MCPResponse {
  jsonrpc: '2.0'
  id?: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/**
 * Tool information for registration
 */
export interface MCPToolInfo {
  name: string
  description: string
  inputSchema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
  }
  handler: (params: Record<string, unknown>) => Promise<MCPToolResult>
}

/**
 * Resource information for registration
 */
export interface MCPResourceInfo {
  uri: string
  name: string
  mimeType?: string
  description?: string
  handler?: () => Promise<{ content: string }>
}

/**
 * Prompt argument definition
 */
export interface MCPPromptArgument {
  name: string
  description?: string
  required?: boolean
}

/**
 * Prompt information for registration
 */
export interface MCPPromptInfo {
  name: string
  description?: string
  arguments?: MCPPromptArgument[]
  handler?: (args: Record<string, unknown>) => Promise<{
    messages: Array<{
      role: string
      content: { type: string; text: string }
    }>
  }>
}

/**
 * MCP Adapter class that bridges MCP protocol to git operations
 */
export class MCPAdapter {
  private config: Required<MCPServerConfig>
  private initialized: boolean = false
  private tools: Map<string, MCPToolInfo> = new Map()
  private resources: Map<string, MCPResourceInfo> = new Map()
  private prompts: Map<string, MCPPromptInfo> = new Map()

  constructor(config?: MCPServerConfig) {
    this.config = {
      name: config?.name || 'gitx.do',
      version: config?.version || '1.0.0',
      capabilities: config?.capabilities || ['tools'],
    }
  }

  /**
   * Get the server configuration
   */
  getConfig(): MCPServerConfig {
    return { ...this.config }
  }

  /**
   * Check if adapter has a specific capability
   */
  hasCapability(capability: MCPCapability): boolean {
    return this.config.capabilities.includes(capability)
  }

  /**
   * Check if the adapter is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Start the MCP adapter
   */
  async start(): Promise<void> {
    if (this.initialized) {
      throw new Error('MCP adapter is already initialized/started')
    }
    this.initialized = true
  }

  /**
   * Stop the MCP adapter
   */
  async stop(): Promise<void> {
    if (!this.initialized) {
      throw new Error('MCP adapter is not initialized/not started')
    }
    this.initialized = false
    this.tools.clear()
    this.resources.clear()
    this.prompts.clear()
  }

  /**
   * Register a tool
   */
  registerTool(toolInfo: MCPToolInfo): void {
    if (this.tools.has(toolInfo.name)) {
      throw new Error(`Tool '${toolInfo.name}' is already registered (duplicate)`)
    }
    this.tools.set(toolInfo.name, toolInfo)
  }

  /**
   * Unregister a tool by name
   */
  unregisterTool(name: string): void {
    if (!this.tools.has(name)) {
      throw new Error(`Tool '${name}' not found (does not exist)`)
    }
    this.tools.delete(name)
  }

  /**
   * List all registered tools (without handlers)
   */
  listTools(): Array<Omit<MCPToolInfo, 'handler'>> {
    const result: Array<Omit<MCPToolInfo, 'handler'>> = []
    for (const tool of this.tools.values()) {
      result.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })
    }
    return result
  }

  /**
   * Get a tool by name (without handler)
   */
  getTool(name: string): Omit<MCPToolInfo, 'handler'> | undefined {
    const tool = this.tools.get(name)
    if (!tool) return undefined
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }
  }

  /**
   * Register all git tools
   */
  registerGitTools(): void {
    for (const tool of gitTools) {
      if (!this.tools.has(tool.name)) {
        this.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          handler: tool.handler,
        })
      }
    }
  }

  /**
   * Register a resource
   */
  registerResource(resourceInfo: MCPResourceInfo): void {
    this.resources.set(resourceInfo.uri, resourceInfo)
  }

  /**
   * Register a prompt
   */
  registerPrompt(promptInfo: MCPPromptInfo): void {
    this.prompts.set(promptInfo.name, promptInfo)
  }

  /**
   * Handle a raw JSON string request
   */
  async handleRawRequest(rawRequest: string): Promise<MCPResponse> {
    let request: MCPRequest
    try {
      request = JSON.parse(rawRequest) as MCPRequest
    } catch {
      return {
        jsonrpc: '2.0',
        error: {
          code: MCPErrorCode.PARSE_ERROR,
          message: 'Parse error: Invalid JSON',
        },
      }
    }
    const response = await this.handleRequest(request)
    return response ?? {
      jsonrpc: '2.0',
      error: {
        code: MCPErrorCode.INVALID_REQUEST,
        message: 'Invalid Request: notification without id',
      },
    }
  }

  /**
   * Handle a batch of requests
   */
  async handleBatchRequest(requests: MCPRequest[]): Promise<MCPResponse[]> {
    const responses: MCPResponse[] = []
    for (const request of requests) {
      const response = await this.handleRequest(request)
      // Only include responses for requests with id (not notifications)
      if (response !== undefined) {
        responses.push(response)
      }
    }
    return responses
  }

  /**
   * Handle a single MCP request
   */
  async handleRequest(request: MCPRequest): Promise<MCPResponse | undefined> {
    // Handle notifications (no id) - they don't expect a response
    if (request.id === undefined) {
      // Process notification but don't return a response
      return undefined
    }

    // Validate jsonrpc version
    if (request.jsonrpc !== '2.0') {
      return this.errorResponse(
        request.id,
        MCPErrorCode.INVALID_REQUEST,
        'Invalid Request: missing or invalid jsonrpc version'
      )
    }

    try {
      // Route to appropriate handler based on method
      switch (request.method) {
        case 'initialize':
          return this.handleInitialize(request)

        case 'tools/list':
          return this.handleToolsList(request)

        case 'tools/call':
          return this.handleToolsCall(request)

        case 'resources/list':
          return this.handleResourcesList(request)

        case 'resources/read':
          return this.handleResourcesRead(request)

        case 'prompts/list':
          return this.handlePromptsList(request)

        case 'prompts/get':
          return this.handlePromptsGet(request)

        default:
          return this.errorResponse(
            request.id,
            MCPErrorCode.METHOD_NOT_FOUND,
            `Method not found: ${request.method}`
          )
      }
    } catch (error) {
      if (error instanceof MCPError) {
        return this.errorResponse(request.id, error.code, error.message, error.data)
      }
      return this.errorResponse(
        request.id,
        MCPErrorCode.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Internal error'
      )
    }
  }

  /**
   * Handle initialize request
   */
  private handleInitialize(request: MCPRequest): MCPResponse {
    const params = request.params || {}
    const protocolVersion = (params.protocolVersion as string) || '2024-11-05'

    const capabilities: Record<string, unknown> = {}
    if (this.hasCapability('tools')) {
      capabilities.tools = {}
    }
    if (this.hasCapability('resources')) {
      capabilities.resources = {}
    }
    if (this.hasCapability('prompts')) {
      capabilities.prompts = {}
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion,
        serverInfo: {
          name: this.config.name,
          version: this.config.version,
        },
        capabilities,
      },
    }
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(request: MCPRequest): MCPResponse {
    if (!this.hasCapability('tools')) {
      return this.errorResponse(
        request.id,
        MCPErrorCode.CAPABILITY_NOT_SUPPORTED,
        'Tools capability is not supported'
      )
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: this.listTools(),
      },
    }
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(request: MCPRequest): Promise<MCPResponse> {
    if (!this.hasCapability('tools')) {
      return this.errorResponse(
        request.id,
        MCPErrorCode.CAPABILITY_NOT_SUPPORTED,
        'Tools capability is not supported'
      )
    }

    const params = request.params || {}
    const toolName = params.name as string
    const toolArgs = (params.arguments || {}) as Record<string, unknown>

    const tool = this.tools.get(toolName)
    if (!tool) {
      // Use TOOL_NOT_FOUND (which equals METHOD_NOT_FOUND) for non-existent tools
      return this.errorResponse(
        request.id,
        MCPErrorCode.TOOL_NOT_FOUND,
        `Tool '${toolName}' not found (does not exist)`
      )
    }

    // Validate parameters
    const validation = this.validateToolParams(tool, toolArgs)
    if (!validation.valid) {
      return this.errorResponse(
        request.id,
        MCPErrorCode.INVALID_PARAMS,
        validation.errors.join('; ')
      )
    }

    // Execute tool
    try {
      const result = await tool.handler(toolArgs)
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      }
    } catch (error) {
      // Tool execution errors are returned as successful responses with isError flag
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        },
      }
    }
  }

  /**
   * Validate tool parameters against schema
   */
  private validateToolParams(
    tool: MCPToolInfo,
    params: Record<string, unknown>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const schema = tool.inputSchema

    // Check required parameters
    if (schema.required) {
      for (const requiredParam of schema.required) {
        if (!(requiredParam in params) || params[requiredParam] === undefined) {
          errors.push(`Missing required parameter: ${requiredParam}`)
        }
      }
    }

    // Check parameter types and constraints
    if (schema.properties) {
      for (const [key, value] of Object.entries(params)) {
        const propSchema = schema.properties[key] as Record<string, unknown> | undefined
        if (!propSchema) continue

        // Type validation
        const expectedType = propSchema.type as string | undefined
        const valueType = Array.isArray(value) ? 'array' : typeof value
        if (expectedType && valueType !== expectedType) {
          errors.push(
            `Parameter '${key}' has invalid type: expected ${expectedType}, got ${valueType}`
          )
        }

        // Pattern validation for strings
        if (
          expectedType === 'string' &&
          typeof value === 'string' &&
          propSchema.pattern
        ) {
          const pattern = new RegExp(propSchema.pattern as string)
          if (!pattern.test(value)) {
            errors.push(
              `Parameter '${key}' does not match pattern: ${propSchema.pattern}`
            )
          }
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Handle resources/list request
   */
  private handleResourcesList(request: MCPRequest): MCPResponse {
    if (!this.hasCapability('resources')) {
      return this.errorResponse(
        request.id,
        MCPErrorCode.CAPABILITY_NOT_SUPPORTED,
        'Resources capability is not supported'
      )
    }

    const resources = Array.from(this.resources.values()).map((r) => ({
      uri: r.uri,
      name: r.name,
      mimeType: r.mimeType,
      description: r.description,
    }))

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { resources },
    }
  }

  /**
   * Handle resources/read request
   */
  private async handleResourcesRead(request: MCPRequest): Promise<MCPResponse> {
    if (!this.hasCapability('resources')) {
      return this.errorResponse(
        request.id,
        MCPErrorCode.CAPABILITY_NOT_SUPPORTED,
        'Resources capability is not supported'
      )
    }

    const params = request.params || {}
    const uri = params.uri as string
    const resource = this.resources.get(uri)

    if (!resource) {
      return this.errorResponse(
        request.id,
        MCPErrorCode.RESOURCE_NOT_FOUND,
        `Resource not found: ${uri}`
      )
    }

    let content = ''
    if (resource.handler) {
      const result = await resource.handler()
      content = result.content
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: content,
          },
        ],
      },
    }
  }

  /**
   * Handle prompts/list request
   */
  private handlePromptsList(request: MCPRequest): MCPResponse {
    if (!this.hasCapability('prompts')) {
      return this.errorResponse(
        request.id,
        MCPErrorCode.CAPABILITY_NOT_SUPPORTED,
        'Prompts capability is not supported'
      )
    }

    const prompts = Array.from(this.prompts.values()).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    }))

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { prompts },
    }
  }

  /**
   * Handle prompts/get request
   */
  private async handlePromptsGet(request: MCPRequest): Promise<MCPResponse> {
    if (!this.hasCapability('prompts')) {
      return this.errorResponse(
        request.id,
        MCPErrorCode.CAPABILITY_NOT_SUPPORTED,
        'Prompts capability is not supported'
      )
    }

    const params = request.params || {}
    const name = params.name as string
    const args = (params.arguments || {}) as Record<string, unknown>
    const prompt = this.prompts.get(name)

    if (!prompt) {
      return this.errorResponse(
        request.id,
        MCPErrorCode.PROMPT_NOT_FOUND,
        `Prompt not found: ${name}`
      )
    }

    let messages: Array<{ role: string; content: { type: string; text: string } }> = []
    if (prompt.handler) {
      const result = await prompt.handler(args)
      messages = result.messages
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { messages },
    }
  }

  /**
   * Create an error response
   */
  private errorResponse(
    id: string | number | undefined,
    code: MCPErrorCode,
    message: string,
    data?: unknown
  ): MCPResponse {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    }
    if (data !== undefined) {
      response.error!.data = data
    }
    return response
  }
}

/**
 * Factory function to create an MCP adapter
 */
export function createMCPAdapter(config?: MCPServerConfig): MCPAdapter {
  return new MCPAdapter(config)
}
