/**
 * MCP (Model Context Protocol) SDK Adapter
 *
 * This module provides an adapter that bridges the MCP protocol to git operations,
 * handling request/response, tool registration/invocation, resource listing,
 * and error handling.
 */
import { gitTools } from './tools';
/**
 * JSON-RPC 2.0 error codes and MCP-specific error codes
 */
export var MCPErrorCode;
(function (MCPErrorCode) {
    // JSON-RPC standard error codes
    MCPErrorCode[MCPErrorCode["PARSE_ERROR"] = -32700] = "PARSE_ERROR";
    MCPErrorCode[MCPErrorCode["INVALID_REQUEST"] = -32600] = "INVALID_REQUEST";
    MCPErrorCode[MCPErrorCode["METHOD_NOT_FOUND"] = -32601] = "METHOD_NOT_FOUND";
    MCPErrorCode[MCPErrorCode["INVALID_PARAMS"] = -32602] = "INVALID_PARAMS";
    MCPErrorCode[MCPErrorCode["INTERNAL_ERROR"] = -32603] = "INTERNAL_ERROR";
    // MCP-specific error codes (must be < -32000 per JSON-RPC spec)
    MCPErrorCode[MCPErrorCode["RESOURCE_NOT_FOUND"] = -32001] = "RESOURCE_NOT_FOUND";
    // TOOL_NOT_FOUND maps to METHOD_NOT_FOUND as tools are essentially methods
    MCPErrorCode[MCPErrorCode["TOOL_NOT_FOUND"] = -32601] = "TOOL_NOT_FOUND";
    MCPErrorCode[MCPErrorCode["PROMPT_NOT_FOUND"] = -32003] = "PROMPT_NOT_FOUND";
    MCPErrorCode[MCPErrorCode["CAPABILITY_NOT_SUPPORTED"] = -32004] = "CAPABILITY_NOT_SUPPORTED";
})(MCPErrorCode || (MCPErrorCode = {}));
/**
 * Custom error class for MCP errors
 */
export class MCPError extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(message);
        this.code = code;
        this.data = data;
        this.name = 'MCPError';
    }
    toJSON() {
        const result = {
            code: this.code,
            message: this.message,
        };
        if (this.data !== undefined) {
            result.data = this.data;
        }
        return result;
    }
}
/**
 * MCP Adapter class that bridges MCP protocol to git operations
 */
export class MCPAdapter {
    config;
    initialized = false;
    tools = new Map();
    resources = new Map();
    prompts = new Map();
    constructor(config) {
        this.config = {
            name: config?.name || 'gitx.do',
            version: config?.version || '1.0.0',
            capabilities: config?.capabilities || ['tools'],
        };
    }
    /**
     * Get the server configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Check if adapter has a specific capability
     */
    hasCapability(capability) {
        return this.config.capabilities.includes(capability);
    }
    /**
     * Check if the adapter is initialized
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * Start the MCP adapter
     */
    async start() {
        if (this.initialized) {
            throw new Error('MCP adapter is already initialized/started');
        }
        this.initialized = true;
    }
    /**
     * Stop the MCP adapter
     */
    async stop() {
        if (!this.initialized) {
            throw new Error('MCP adapter is not initialized/not started');
        }
        this.initialized = false;
        this.tools.clear();
        this.resources.clear();
        this.prompts.clear();
    }
    /**
     * Register a tool
     */
    registerTool(toolInfo) {
        if (this.tools.has(toolInfo.name)) {
            throw new Error(`Tool '${toolInfo.name}' is already registered (duplicate)`);
        }
        this.tools.set(toolInfo.name, toolInfo);
    }
    /**
     * Unregister a tool by name
     */
    unregisterTool(name) {
        if (!this.tools.has(name)) {
            throw new Error(`Tool '${name}' not found (does not exist)`);
        }
        this.tools.delete(name);
    }
    /**
     * List all registered tools (without handlers)
     */
    listTools() {
        const result = [];
        for (const tool of this.tools.values()) {
            result.push({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            });
        }
        return result;
    }
    /**
     * Get a tool by name (without handler)
     */
    getTool(name) {
        const tool = this.tools.get(name);
        if (!tool)
            return undefined;
        return {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        };
    }
    /**
     * Register all git tools
     */
    registerGitTools() {
        for (const tool of gitTools) {
            if (!this.tools.has(tool.name)) {
                this.registerTool({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    handler: tool.handler,
                });
            }
        }
    }
    /**
     * Register a resource
     */
    registerResource(resourceInfo) {
        this.resources.set(resourceInfo.uri, resourceInfo);
    }
    /**
     * Register a prompt
     */
    registerPrompt(promptInfo) {
        this.prompts.set(promptInfo.name, promptInfo);
    }
    /**
     * Handle a raw JSON string request
     */
    async handleRawRequest(rawRequest) {
        let request;
        try {
            request = JSON.parse(rawRequest);
        }
        catch {
            return {
                jsonrpc: '2.0',
                error: {
                    code: MCPErrorCode.PARSE_ERROR,
                    message: 'Parse error: Invalid JSON',
                },
            };
        }
        const response = await this.handleRequest(request);
        return response ?? {
            jsonrpc: '2.0',
            error: {
                code: MCPErrorCode.INVALID_REQUEST,
                message: 'Invalid Request: notification without id',
            },
        };
    }
    /**
     * Handle a batch of requests
     */
    async handleBatchRequest(requests) {
        const responses = [];
        for (const request of requests) {
            const response = await this.handleRequest(request);
            // Only include responses for requests with id (not notifications)
            if (response !== undefined) {
                responses.push(response);
            }
        }
        return responses;
    }
    /**
     * Handle a single MCP request
     */
    async handleRequest(request) {
        // Handle notifications (no id) - they don't expect a response
        if (request.id === undefined) {
            // Process notification but don't return a response
            return undefined;
        }
        // Validate jsonrpc version
        if (request.jsonrpc !== '2.0') {
            return this.errorResponse(request.id, MCPErrorCode.INVALID_REQUEST, 'Invalid Request: missing or invalid jsonrpc version');
        }
        try {
            // Route to appropriate handler based on method
            switch (request.method) {
                case 'initialize':
                    return this.handleInitialize(request);
                case 'tools/list':
                    return this.handleToolsList(request);
                case 'tools/call':
                    return this.handleToolsCall(request);
                case 'resources/list':
                    return this.handleResourcesList(request);
                case 'resources/read':
                    return this.handleResourcesRead(request);
                case 'prompts/list':
                    return this.handlePromptsList(request);
                case 'prompts/get':
                    return this.handlePromptsGet(request);
                default:
                    return this.errorResponse(request.id, MCPErrorCode.METHOD_NOT_FOUND, `Method not found: ${request.method}`);
            }
        }
        catch (error) {
            if (error instanceof MCPError) {
                return this.errorResponse(request.id, error.code, error.message, error.data);
            }
            return this.errorResponse(request.id, MCPErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : 'Internal error');
        }
    }
    /**
     * Handle initialize request
     */
    handleInitialize(request) {
        const params = request.params || {};
        const protocolVersion = params.protocolVersion || '2024-11-05';
        const capabilities = {};
        if (this.hasCapability('tools')) {
            capabilities.tools = {};
        }
        if (this.hasCapability('resources')) {
            capabilities.resources = {};
        }
        if (this.hasCapability('prompts')) {
            capabilities.prompts = {};
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
        };
    }
    /**
     * Handle tools/list request
     */
    handleToolsList(request) {
        if (!this.hasCapability('tools')) {
            return this.errorResponse(request.id, MCPErrorCode.CAPABILITY_NOT_SUPPORTED, 'Tools capability is not supported');
        }
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
                tools: this.listTools(),
            },
        };
    }
    /**
     * Handle tools/call request
     */
    async handleToolsCall(request) {
        if (!this.hasCapability('tools')) {
            return this.errorResponse(request.id, MCPErrorCode.CAPABILITY_NOT_SUPPORTED, 'Tools capability is not supported');
        }
        const params = request.params || {};
        const toolName = params.name;
        const toolArgs = (params.arguments || {});
        const tool = this.tools.get(toolName);
        if (!tool) {
            // Use TOOL_NOT_FOUND (which equals METHOD_NOT_FOUND) for non-existent tools
            return this.errorResponse(request.id, MCPErrorCode.TOOL_NOT_FOUND, `Tool '${toolName}' not found (does not exist)`);
        }
        // Validate parameters
        const validation = this.validateToolParams(tool, toolArgs);
        if (!validation.valid) {
            return this.errorResponse(request.id, MCPErrorCode.INVALID_PARAMS, validation.errors.join('; '));
        }
        // Execute tool
        try {
            const result = await tool.handler(toolArgs);
            return {
                jsonrpc: '2.0',
                id: request.id,
                result,
            };
        }
        catch (error) {
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
            };
        }
    }
    /**
     * Validate tool parameters against schema
     */
    validateToolParams(tool, params) {
        const errors = [];
        const schema = tool.inputSchema;
        // Check required parameters
        if (schema.required) {
            for (const requiredParam of schema.required) {
                if (!(requiredParam in params) || params[requiredParam] === undefined) {
                    errors.push(`Missing required parameter: ${requiredParam}`);
                }
            }
        }
        // Check parameter types and constraints
        if (schema.properties) {
            for (const [key, value] of Object.entries(params)) {
                const propSchema = schema.properties[key];
                if (!propSchema)
                    continue;
                // Type validation
                const expectedType = propSchema.type;
                const valueType = Array.isArray(value) ? 'array' : typeof value;
                if (expectedType && valueType !== expectedType) {
                    errors.push(`Parameter '${key}' has invalid type: expected ${expectedType}, got ${valueType}`);
                }
                // Pattern validation for strings
                if (expectedType === 'string' &&
                    typeof value === 'string' &&
                    propSchema.pattern) {
                    const pattern = new RegExp(propSchema.pattern);
                    if (!pattern.test(value)) {
                        errors.push(`Parameter '${key}' does not match pattern: ${propSchema.pattern}`);
                    }
                }
            }
        }
        return { valid: errors.length === 0, errors };
    }
    /**
     * Handle resources/list request
     */
    handleResourcesList(request) {
        if (!this.hasCapability('resources')) {
            return this.errorResponse(request.id, MCPErrorCode.CAPABILITY_NOT_SUPPORTED, 'Resources capability is not supported');
        }
        const resources = Array.from(this.resources.values()).map((r) => ({
            uri: r.uri,
            name: r.name,
            mimeType: r.mimeType,
            description: r.description,
        }));
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: { resources },
        };
    }
    /**
     * Handle resources/read request
     */
    async handleResourcesRead(request) {
        if (!this.hasCapability('resources')) {
            return this.errorResponse(request.id, MCPErrorCode.CAPABILITY_NOT_SUPPORTED, 'Resources capability is not supported');
        }
        const params = request.params || {};
        const uri = params.uri;
        const resource = this.resources.get(uri);
        if (!resource) {
            return this.errorResponse(request.id, MCPErrorCode.RESOURCE_NOT_FOUND, `Resource not found: ${uri}`);
        }
        let content = '';
        if (resource.handler) {
            const result = await resource.handler();
            content = result.content;
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
        };
    }
    /**
     * Handle prompts/list request
     */
    handlePromptsList(request) {
        if (!this.hasCapability('prompts')) {
            return this.errorResponse(request.id, MCPErrorCode.CAPABILITY_NOT_SUPPORTED, 'Prompts capability is not supported');
        }
        const prompts = Array.from(this.prompts.values()).map((p) => ({
            name: p.name,
            description: p.description,
            arguments: p.arguments,
        }));
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: { prompts },
        };
    }
    /**
     * Handle prompts/get request
     */
    async handlePromptsGet(request) {
        if (!this.hasCapability('prompts')) {
            return this.errorResponse(request.id, MCPErrorCode.CAPABILITY_NOT_SUPPORTED, 'Prompts capability is not supported');
        }
        const params = request.params || {};
        const name = params.name;
        const args = (params.arguments || {});
        const prompt = this.prompts.get(name);
        if (!prompt) {
            return this.errorResponse(request.id, MCPErrorCode.PROMPT_NOT_FOUND, `Prompt not found: ${name}`);
        }
        let messages = [];
        if (prompt.handler) {
            const result = await prompt.handler(args);
            messages = result.messages;
        }
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: { messages },
        };
    }
    /**
     * Create an error response
     */
    errorResponse(id, code, message, data) {
        const response = {
            jsonrpc: '2.0',
            id,
            error: { code, message },
        };
        if (data !== undefined) {
            response.error.data = data;
        }
        return response;
    }
}
/**
 * Factory function to create an MCP adapter
 */
export function createMCPAdapter(config) {
    return new MCPAdapter(config);
}
//# sourceMappingURL=adapter.js.map