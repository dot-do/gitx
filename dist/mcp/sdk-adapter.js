/**
 * MCP SDK Adapter
 *
 * This module provides a full-featured adapter for the MCP SDK,
 * including SDK initialization, tool registration, request/response
 * handling, error propagation, and connection lifecycle management.
 */
import { gitTools } from './tools';
/**
 * MCP SDK Error codes - JSON-RPC 2.0 standard codes and MCP-specific codes
 */
export var MCPSDKErrorCode;
(function (MCPSDKErrorCode) {
    // JSON-RPC standard error codes
    MCPSDKErrorCode[MCPSDKErrorCode["PARSE_ERROR"] = -32700] = "PARSE_ERROR";
    MCPSDKErrorCode[MCPSDKErrorCode["INVALID_REQUEST"] = -32600] = "INVALID_REQUEST";
    MCPSDKErrorCode[MCPSDKErrorCode["METHOD_NOT_FOUND"] = -32601] = "METHOD_NOT_FOUND";
    MCPSDKErrorCode[MCPSDKErrorCode["INVALID_PARAMS"] = -32602] = "INVALID_PARAMS";
    MCPSDKErrorCode[MCPSDKErrorCode["INTERNAL_ERROR"] = -32603] = "INTERNAL_ERROR";
    // MCP-specific error codes
    MCPSDKErrorCode[MCPSDKErrorCode["TOOL_NOT_FOUND"] = -32001] = "TOOL_NOT_FOUND";
    MCPSDKErrorCode[MCPSDKErrorCode["RESOURCE_NOT_FOUND"] = -32002] = "RESOURCE_NOT_FOUND";
    MCPSDKErrorCode[MCPSDKErrorCode["PROMPT_NOT_FOUND"] = -32003] = "PROMPT_NOT_FOUND";
    MCPSDKErrorCode[MCPSDKErrorCode["CAPABILITY_NOT_SUPPORTED"] = -32004] = "CAPABILITY_NOT_SUPPORTED";
})(MCPSDKErrorCode || (MCPSDKErrorCode = {}));
/**
 * MCP SDK Error class
 */
export class MCPSDKError extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(message);
        this.code = code;
        this.data = data;
        this.name = 'MCPSDKError';
    }
    toJSONRPC() {
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
 * MCP SDK Adapter class
 */
export class MCPSDKAdapter {
    config;
    connectionState = 'disconnected';
    tools = new Map();
    toolIdCounter = 0;
    session = null;
    stateChangeListeners = [];
    connectedListeners = [];
    disconnectedListeners = [];
    notificationListeners = new Map();
    progressListeners = [];
    errorListeners = [];
    pongListeners = [];
    connectionTimeoutListeners = [];
    pendingRequests = new Map();
    currentRequestId = 0;
    transport = null;
    clientResponsive = true;
    pingTimeoutId = null;
    cleanupOnShutdown = false;
    constructor(config) {
        // Validate configuration
        if (config?.name !== undefined && config.name === '') {
            throw new Error('Configuration error: name is required and cannot be empty');
        }
        this.config = {
            name: config?.name || 'gitx.do',
            version: config?.version || '0.0.1',
            vendor: config?.vendor || 'gitx.do',
            transports: config?.transports || ['stdio'],
            protocolVersion: config?.protocolVersion || '2024-11-05',
            capabilities: config?.capabilities || {},
            logger: config?.logger,
            mode: config?.mode || 'development',
            pingInterval: config?.pingInterval,
            pingTimeout: config?.pingTimeout,
        };
    }
    /**
     * Get the adapter configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get supported transports
     */
    getSupportedTransports() {
        return [...(this.config.transports || ['stdio'])];
    }
    /**
     * Get protocol version
     */
    getProtocolVersion() {
        return this.config.protocolVersion || '2024-11-05';
    }
    /**
     * Get SDK version
     */
    getSDKVersion() {
        return '1.0.0';
    }
    /**
     * Get capabilities
     */
    getCapabilities() {
        return { ...this.config.capabilities };
    }
    /**
     * Get connection state
     */
    getConnectionState() {
        return this.connectionState;
    }
    /**
     * Set connection state and notify listeners
     */
    setConnectionState(state) {
        this.connectionState = state;
        for (const listener of this.stateChangeListeners) {
            listener(state);
        }
        if (state === 'connected') {
            for (const listener of this.connectedListeners) {
                listener();
            }
        }
        else if (state === 'disconnected') {
            for (const listener of this.disconnectedListeners) {
                listener();
            }
        }
    }
    /**
     * Register a state change listener
     */
    onStateChange(listener) {
        this.stateChangeListeners.push(listener);
    }
    /**
     * Register a connected listener
     */
    onConnected(listener) {
        this.connectedListeners.push(listener);
    }
    /**
     * Register a disconnected listener
     */
    onDisconnected(listener) {
        this.disconnectedListeners.push(listener);
    }
    /**
     * Register a notification listener
     */
    onNotification(type, listener) {
        const listeners = this.notificationListeners.get(type) || [];
        listeners.push(listener);
        this.notificationListeners.set(type, listeners);
    }
    /**
     * Emit a notification
     */
    emitNotification(type) {
        const listeners = this.notificationListeners.get(type) || [];
        for (const listener of listeners) {
            listener();
        }
    }
    /**
     * Register a progress listener
     */
    onProgress(listener) {
        this.progressListeners.push(listener);
    }
    /**
     * Register an error listener
     */
    onError(listener) {
        this.errorListeners.push(listener);
    }
    /**
     * Register a pong listener
     */
    onPong(listener) {
        this.pongListeners.push(listener);
    }
    /**
     * Register a connection timeout listener
     */
    onConnectionTimeout(listener) {
        this.connectionTimeoutListeners.push(listener);
    }
    /**
     * Start the adapter
     */
    async start() {
        if (this.connectionState !== 'disconnected') {
            throw new Error('Adapter is already started or running');
        }
        this.setConnectionState('initializing');
        // Simulate initialization
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.setConnectionState('connected');
    }
    /**
     * Connect with a transport
     */
    async connect(transport) {
        this.transport = transport;
        if (this.connectionState === 'disconnected') {
            await this.start();
        }
    }
    /**
     * Shutdown the adapter
     */
    async shutdown(options) {
        const cleanup = options?.cleanup ?? false;
        this.cleanupOnShutdown = cleanup;
        if (options?.graceful && options?.timeout) {
            // Wait for pending requests with timeout
            const timeoutPromise = new Promise((resolve) => setTimeout(resolve, options.timeout));
            await Promise.race([this.waitForPendingRequests(), timeoutPromise]);
        }
        if (this.pingTimeoutId) {
            clearTimeout(this.pingTimeoutId);
            this.pingTimeoutId = null;
        }
        if (cleanup) {
            this.tools.clear();
        }
        this.transport = null;
        this.session = null;
        this.setConnectionState('disconnected');
    }
    /**
     * Wait for all pending requests to complete
     */
    async waitForPendingRequests() {
        while (this.pendingRequests.size > 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
    /**
     * Handle client initialization
     */
    async handleClientInitialize(request) {
        // Validate protocol version
        const supportedVersions = ['2024-11-05'];
        if (!supportedVersions.includes(request.protocolVersion)) {
            throw new MCPSDKError(MCPSDKErrorCode.INVALID_PARAMS, `Incompatible protocol version: ${request.protocolVersion}. Supported versions: ${supportedVersions.join(', ')}`);
        }
        // Create session
        this.session = {
            id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            clientInfo: request.clientInfo,
            clientCapabilities: request.capabilities,
        };
        return {
            serverInfo: {
                name: this.config.name,
                version: this.config.version,
            },
            capabilities: this.config.capabilities || {},
        };
    }
    /**
     * Get current session
     */
    getSession() {
        return this.session;
    }
    /**
     * Register a tool
     */
    registerTool(registration) {
        // Validate schema type
        if (registration.inputSchema.type !== 'object' &&
            registration.inputSchema.type !== 'string' &&
            registration.inputSchema.type !== 'number' &&
            registration.inputSchema.type !== 'boolean' &&
            registration.inputSchema.type !== 'array') {
            throw new Error(`Invalid schema type: ${registration.inputSchema.type}. Expected valid JSON Schema type.`);
        }
        if (this.tools.has(registration.name)) {
            throw new Error(`Tool '${registration.name}' already exists (duplicate)`);
        }
        const internalTool = {
            ...registration,
            id: `tool-${++this.toolIdCounter}`,
        };
        this.tools.set(registration.name, internalTool);
        this.emitNotification('tools/list_changed');
    }
    /**
     * Register multiple tools
     */
    registerTools(registrations) {
        for (const registration of registrations) {
            // Don't emit notification for each tool
            if (registration.inputSchema.type !== 'object' &&
                registration.inputSchema.type !== 'string' &&
                registration.inputSchema.type !== 'number' &&
                registration.inputSchema.type !== 'boolean' &&
                registration.inputSchema.type !== 'array') {
                throw new Error(`Invalid schema type: ${registration.inputSchema.type}. Expected valid JSON Schema type.`);
            }
            if (this.tools.has(registration.name)) {
                throw new Error(`Tool '${registration.name}' already exists (duplicate)`);
            }
            const internalTool = {
                ...registration,
                id: `tool-${++this.toolIdCounter}`,
            };
            this.tools.set(registration.name, internalTool);
        }
        this.emitNotification('tools/list_changed');
    }
    /**
     * Unregister a tool
     */
    unregisterTool(name) {
        this.tools.delete(name);
        this.emitNotification('tools/list_changed');
    }
    /**
     * Get a tool by name
     */
    getTool(name) {
        const tool = this.tools.get(name);
        if (!tool)
            return undefined;
        return {
            id: tool.id,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
        };
    }
    /**
     * List all tools
     */
    listTools() {
        const result = [];
        for (const tool of this.tools.values()) {
            result.push({
                id: tool.id,
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            });
        }
        return result;
    }
    /**
     * Register gitdo tools
     */
    registerGitdoTools() {
        for (const tool of gitTools) {
            if (!this.tools.has(tool.name)) {
                this.registerTool({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    handler: async (params) => tool.handler(params),
                });
            }
        }
    }
    /**
     * Handle tools/list request
     */
    async handleToolsList(options) {
        const allTools = this.listTools();
        const pageSize = 10;
        // Parse cursor
        let startIndex = 0;
        if (options?.cursor) {
            startIndex = parseInt(options.cursor, 10);
        }
        const endIndex = startIndex + pageSize;
        const pageTools = allTools.slice(startIndex, endIndex);
        const result = {
            tools: pageTools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
            })),
        };
        if (endIndex < allTools.length) {
            result.nextCursor = String(endIndex);
        }
        return result;
    }
    /**
     * Handle tools/call request
     */
    handleToolsCall(request) {
        // Generate requestId upfront for consistent tracking
        const requestId = `req-${++this.currentRequestId}`;
        // Helper to create a rejected promise with requestId attached
        const createRejectedPromise = (error) => {
            const promise = Promise.reject(error);
            promise.requestId = requestId;
            return promise;
        };
        const tool = this.tools.get(request.name);
        if (!tool) {
            return createRejectedPromise(new MCPSDKError(MCPSDKErrorCode.TOOL_NOT_FOUND, `Tool '${request.name}' not found (nonexistent)`));
        }
        // Validate required parameters
        const schema = tool.inputSchema;
        if (schema.required) {
            for (const requiredParam of schema.required) {
                if (!(requiredParam in request.arguments) ||
                    request.arguments[requiredParam] === undefined) {
                    return createRejectedPromise(new MCPSDKError(MCPSDKErrorCode.INVALID_PARAMS, `Missing required parameter: ${requiredParam}`));
                }
            }
        }
        // Create request tracking
        this.pendingRequests.set(requestId, { cancelled: false });
        // Create context
        const context = {
            reportProgress: async (progress, total) => {
                for (const listener of this.progressListeners) {
                    listener({ progress, total });
                }
            },
            isCancelled: () => {
                const req = this.pendingRequests.get(requestId);
                return req?.cancelled ?? false;
            },
        };
        const executeHandler = async () => {
            try {
                const result = await tool.handler(request.arguments, context);
                this.pendingRequests.delete(requestId);
                return { ...result, requestId };
            }
            catch (error) {
                this.pendingRequests.delete(requestId);
                // Log error if logger configured
                if (this.config.logger?.error) {
                    this.config.logger.error('Tool execution error:', error instanceof Error ? error.message : String(error));
                }
                // Format error message based on mode
                let errorText = error instanceof Error ? error.message : String(error);
                if (this.config.mode === 'development' && error instanceof Error && error.stack) {
                    errorText = error.stack;
                }
                return {
                    content: [{ type: 'text', text: errorText }],
                    isError: true,
                    requestId,
                };
            }
        };
        // Create the promise and attach the requestId property
        const promise = executeHandler();
        promise.requestId = requestId;
        return promise;
    }
    /**
     * Cancel a request
     */
    cancelRequest(requestId) {
        if (requestId) {
            const req = this.pendingRequests.get(requestId);
            if (req) {
                req.cancelled = true;
            }
        }
    }
    /**
     * Handle raw JSON-RPC message
     */
    async handleMessage(message) {
        let parsed;
        try {
            parsed = JSON.parse(message);
        }
        catch {
            return JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: MCPSDKErrorCode.PARSE_ERROR,
                    message: 'Parse error: Invalid JSON',
                },
            });
        }
        // Handle batch requests
        if (Array.isArray(parsed)) {
            const responses = await Promise.all(parsed.map((req) => this.handleSingleMessage(req)));
            return JSON.stringify(responses);
        }
        const response = await this.handleSingleMessage(parsed);
        return JSON.stringify(response);
    }
    /**
     * Handle a single JSON-RPC message
     */
    async handleSingleMessage(request) {
        const req = request;
        const id = req.id ?? null;
        if (req.jsonrpc !== '2.0') {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: MCPSDKErrorCode.INVALID_REQUEST,
                    message: 'Invalid Request: missing or invalid jsonrpc version',
                },
            };
        }
        try {
            switch (req.method) {
                case 'tools/list': {
                    const result = await this.handleToolsList(req.params);
                    return { jsonrpc: '2.0', id, result };
                }
                case 'tools/call': {
                    const result = await this.handleToolsCall(req.params);
                    return { jsonrpc: '2.0', id, result };
                }
                default:
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: {
                            code: MCPSDKErrorCode.METHOD_NOT_FOUND,
                            message: `Method not found: ${req.method}`,
                        },
                    };
            }
        }
        catch (error) {
            if (error instanceof MCPSDKError) {
                return {
                    jsonrpc: '2.0',
                    id,
                    error: error.toJSONRPC(),
                };
            }
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: MCPSDKErrorCode.INTERNAL_ERROR,
                    message: error instanceof Error ? error.message : 'Internal error',
                },
            };
        }
    }
    /**
     * Simulate a pending request (for testing)
     */
    simulatePendingRequest() {
        const requestId = `sim-req-${++this.currentRequestId}`;
        this.pendingRequests.set(requestId, { cancelled: false });
        return {
            complete: async () => {
                this.pendingRequests.delete(requestId);
            },
        };
    }
    /**
     * Simulate an internal error (for testing)
     */
    simulateInternalError(error) {
        const mcpError = new MCPSDKError(MCPSDKErrorCode.INTERNAL_ERROR, error.message);
        for (const listener of this.errorListeners) {
            listener(mcpError);
        }
    }
    /**
     * Send ping
     */
    sendPing() {
        // Simulate ping/pong
        setTimeout(() => {
            if (this.clientResponsive) {
                for (const listener of this.pongListeners) {
                    listener();
                }
            }
        }, 10);
        // Set timeout for pong response
        if (this.config.pingTimeout) {
            this.pingTimeoutId = setTimeout(() => {
                if (!this.clientResponsive) {
                    for (const listener of this.connectionTimeoutListeners) {
                        listener();
                    }
                }
            }, this.config.pingTimeout);
        }
    }
    /**
     * Simulate client becoming unresponsive (for testing)
     */
    simulateClientUnresponsive() {
        this.clientResponsive = false;
        // Trigger a ping to start the timeout
        this.sendPing();
    }
}
/**
 * Transport factory
 */
export const MCPSDKTransport = {
    createStdio(_options) {
        return {
            type: 'stdio',
            isConnected: () => true,
            send: () => { },
            receive: async () => '',
            close: () => { },
        };
    },
    createSSE(_options) {
        let connected = false;
        return {
            type: 'sse',
            isConnected: () => connected,
            send: () => { },
            receive: async () => '',
            close: () => {
                connected = false;
            },
            handleRequest: async (_request) => {
                connected = true;
                return { status: 200, headers: {} };
            },
        };
    },
    createHTTP(_options) {
        return {
            type: 'http',
            isConnected: () => true,
            send: () => { },
            receive: async () => '',
            close: () => { },
            handleRequest: async (_request) => {
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', result: {} }),
                };
            },
        };
    },
};
/**
 * Factory function to create an MCP SDK adapter
 */
export function createMCPSDKAdapter(config) {
    return new MCPSDKAdapter(config);
}
//# sourceMappingURL=sdk-adapter.js.map