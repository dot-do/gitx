/**
 * @fileoverview MCP SDK Adapter
 *
 * This module provides a full-featured adapter for the MCP SDK,
 * including SDK initialization, tool registration, request/response
 * handling, error propagation, and connection lifecycle management.
 *
 * The SDK adapter extends the basic adapter with:
 * - Multiple transport support (stdio, SSE, HTTP)
 * - Connection state management and events
 * - Request cancellation and progress reporting
 * - Session management with client information
 * - Ping/pong health checking
 * - Graceful shutdown with pending request handling
 *
 * @module mcp/sdk-adapter
 *
 * @example
 * // Create and start an SDK adapter
 * import { createMCPSDKAdapter, MCPSDKTransport } from './sdk-adapter'
 *
 * const adapter = createMCPSDKAdapter({
 *   name: 'git-mcp-server',
 *   version: '1.0.0',
 *   transports: ['stdio', 'http'],
 *   capabilities: { tools: { listChanged: true } }
 * })
 *
 * adapter.registerGitdoTools()
 * await adapter.start()
 *
 * // Connect with a transport
 * const transport = MCPSDKTransport.createStdio()
 * await adapter.connect(transport)
 *
 * @example
 * // Handle tool calls with progress
 * const result = adapter.handleToolsCall({
 *   name: 'git_log',
 *   arguments: { maxCount: 100 }
 * })
 *
 * adapter.onProgress((event) => {
 *   console.log(`Progress: ${event.progress}/${event.total}`)
 * })
 *
 * const output = await result
 */
import { type MCPToolResult } from './tools';
/**
 * MCP SDK Error codes - JSON-RPC 2.0 standard codes and MCP-specific codes.
 *
 * @description
 * Enumeration of error codes used in MCP SDK responses. Follows JSON-RPC 2.0
 * specification for standard errors and defines MCP-specific codes for
 * resource, tool, and prompt operations.
 *
 * @enum {number}
 */
export declare enum MCPSDKErrorCode {
    /** Parse error - Invalid JSON (-32700) */
    PARSE_ERROR = -32700,
    /** Invalid Request - Not a valid Request object (-32600) */
    INVALID_REQUEST = -32600,
    /** Method not found - Method does not exist (-32601) */
    METHOD_NOT_FOUND = -32601,
    /** Invalid params - Invalid method parameters (-32602) */
    INVALID_PARAMS = -32602,
    /** Internal error - Internal JSON-RPC error (-32603) */
    INTERNAL_ERROR = -32603,
    /** Tool not found - Requested tool does not exist (-32001) */
    TOOL_NOT_FOUND = -32001,
    /** Resource not found - Requested resource does not exist (-32002) */
    RESOURCE_NOT_FOUND = -32002,
    /** Prompt not found - Requested prompt does not exist (-32003) */
    PROMPT_NOT_FOUND = -32003,
    /** Capability not supported - Capability is not enabled (-32004) */
    CAPABILITY_NOT_SUPPORTED = -32004
}
/**
 * MCP SDK Error class.
 *
 * @description
 * Error class for MCP SDK operations. Encapsulates error code, message,
 * and optional data. Can be converted to JSON-RPC format.
 *
 * @class MCPSDKError
 * @extends Error
 *
 * @example
 * throw new MCPSDKError(
 *   MCPSDKErrorCode.TOOL_NOT_FOUND,
 *   'Tool "unknown" not found'
 * )
 */
export declare class MCPSDKError extends Error {
    /** The error code */
    code: MCPSDKErrorCode;
    /** Optional additional error data */
    data?: unknown;
    /**
     * Create a new MCP SDK error.
     * @param code - The error code
     * @param message - Human-readable error message
     * @param data - Optional additional data
     */
    constructor(code: MCPSDKErrorCode, message: string, data?: unknown);
    /**
     * Convert to JSON-RPC error format.
     * @returns Object suitable for JSON-RPC error responses
     */
    toJSONRPC(): {
        code: number;
        message: string;
        data?: unknown;
    };
}
/**
 * Transport type.
 * @description Supported transport mechanisms for MCP communication.
 * @typedef {'stdio' | 'sse' | 'http' | 'custom'} MCPSDKTransportType
 */
export type MCPSDKTransportType = 'stdio' | 'sse' | 'http' | 'custom';
/**
 * Connection state.
 * @description Represents the current state of the adapter connection.
 * @typedef {'disconnected' | 'initializing' | 'connected'} MCPSDKConnectionState
 */
export type MCPSDKConnectionState = 'disconnected' | 'initializing' | 'connected';
/**
 * MCP SDK Transport interface.
 *
 * @description
 * Interface for transport implementations that handle sending and receiving
 * MCP messages. Different transports (stdio, SSE, HTTP) implement this interface.
 *
 * @interface MCPSDKTransport
 */
export interface MCPSDKTransport {
    /** Transport type identifier */
    type: MCPSDKTransportType;
    /** Send data through the transport */
    send?: (data: string) => void;
    /** Receive data from the transport */
    receive?: () => Promise<string>;
    /** Close the transport connection */
    close?: () => void;
    /** Check if transport is connected */
    isConnected: () => boolean;
    /** Handle an HTTP-style request (for HTTP/SSE transports) */
    handleRequest?: (request: unknown) => Promise<{
        status: number;
        headers: Record<string, string>;
        body?: string;
    }>;
}
/**
 * Logger interface.
 *
 * @description
 * Interface for logging implementations. All methods are optional,
 * allowing partial logger implementations.
 *
 * @interface MCPSDKLogger
 */
export interface MCPSDKLogger {
    /** Log error messages */
    error?: (message: string, ...args: unknown[]) => void;
    /** Log warning messages */
    warn?: (message: string, ...args: unknown[]) => void;
    /** Log info messages */
    info?: (message: string, ...args: unknown[]) => void;
    /** Log debug messages */
    debug?: (message: string, ...args: unknown[]) => void;
}
/**
 * Capabilities configuration.
 *
 * @description
 * Server capabilities that can be advertised to clients during initialization.
 *
 * @interface MCPSDKCapabilities
 */
export interface MCPSDKCapabilities {
    /** Tool-related capabilities */
    tools?: {
        listChanged?: boolean;
    };
    /** Resource-related capabilities */
    resources?: {
        subscribe?: boolean;
    };
    /** Prompt-related capabilities */
    prompts?: Record<string, unknown>;
}
/**
 * SDK Adapter configuration.
 *
 * @description
 * Configuration options for creating an MCP SDK adapter instance.
 *
 * @interface MCPSDKAdapterConfig
 *
 * @example
 * const config: MCPSDKAdapterConfig = {
 *   name: 'my-server',
 *   version: '1.0.0',
 *   transports: ['stdio', 'http'],
 *   capabilities: { tools: { listChanged: true } },
 *   mode: 'production'
 * }
 */
export interface MCPSDKAdapterConfig {
    /** Server name (default: 'gitx.do') */
    name?: string;
    /** Server version (default: '0.0.1') */
    version?: string;
    /** Vendor identifier (default: 'gitx.do') */
    vendor?: string;
    /** Supported transport types (default: ['stdio']) */
    transports?: MCPSDKTransportType[];
    /** MCP protocol version (default: '2024-11-05') */
    protocolVersion?: string;
    /** Server capabilities */
    capabilities?: MCPSDKCapabilities;
    /** Optional logger implementation */
    logger?: MCPSDKLogger;
    /** Execution mode affecting error verbosity (default: 'development') */
    mode?: 'development' | 'production';
    /** Ping interval in milliseconds */
    pingInterval?: number;
    /** Ping timeout in milliseconds */
    pingTimeout?: number;
}
/**
 * Tool handler context.
 *
 * @description
 * Context provided to tool handlers for reporting progress and
 * checking cancellation status.
 *
 * @interface MCPSDKToolContext
 *
 * @example
 * const handler = async (params, context: MCPSDKToolContext) => {
 *   for (let i = 0; i < 100; i++) {
 *     if (context.isCancelled()) break
 *     await context.reportProgress(i, 100)
 *     // ... do work
 *   }
 *   return { content: [{ type: 'text', text: 'Done' }] }
 * }
 */
export interface MCPSDKToolContext {
    /** Report progress to the client */
    reportProgress: (progress: number, total: number) => Promise<void>;
    /** Check if the request has been cancelled */
    isCancelled: () => boolean;
}
/**
 * Tool registration.
 *
 * @description
 * Complete tool definition for SDK adapter registration.
 * Includes context-aware handler for progress/cancellation support.
 *
 * @interface MCPSDKToolRegistration
 */
export interface MCPSDKToolRegistration {
    /** Unique tool name */
    name: string;
    /** Human-readable description */
    description: string;
    /** JSON Schema for input validation */
    inputSchema: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
    };
    /** Handler with context for progress/cancellation */
    handler: (params: Record<string, unknown>, context: MCPSDKToolContext) => Promise<MCPToolResult>;
}
/**
 * Session information.
 *
 * @description
 * Information about the current client session established during initialization.
 *
 * @interface MCPSDKSession
 */
export interface MCPSDKSession {
    /** Unique session identifier */
    id: string;
    /** Client information from initialization */
    clientInfo: {
        name: string;
        version: string;
    };
    /** Client capabilities */
    clientCapabilities: {
        sampling?: Record<string, unknown>;
        roots?: {
            listChanged?: boolean;
        };
    };
}
/**
 * Client initialization request.
 *
 * @description
 * Request sent by client during protocol initialization.
 *
 * @interface MCPClientInitializeRequest
 */
export interface MCPClientInitializeRequest {
    /** Requested protocol version */
    protocolVersion: string;
    /** Client identification */
    clientInfo: {
        name: string;
        version: string;
    };
    /** Client capabilities */
    capabilities: Record<string, unknown>;
}
/**
 * Tools call request.
 *
 * @description
 * Request to execute a registered tool.
 *
 * @interface MCPToolsCallRequest
 */
export interface MCPToolsCallRequest {
    /** Name of the tool to call */
    name: string;
    /** Arguments to pass to the tool */
    arguments: Record<string, unknown>;
}
/**
 * Tools call result with request ID.
 *
 * @description
 * Extended tool result that includes the request ID for tracking.
 *
 * @interface MCPToolsCallResult
 * @extends MCPToolResult
 */
export interface MCPToolsCallResult extends MCPToolResult {
    /** Optional request ID for tracking */
    requestId?: string;
}
/**
 * Pending request for graceful shutdown.
 * @internal
 */
interface PendingRequest {
    complete: () => Promise<void>;
}
/**
 * Progress event.
 * @internal
 */
interface ProgressEvent {
    progress: number;
    total: number;
}
/**
 * MCP SDK Adapter class.
 *
 * @description
 * Full-featured MCP adapter with advanced features including:
 * - Multiple transport support (stdio, SSE, HTTP)
 * - Connection lifecycle management with events
 * - Request tracking, cancellation, and progress reporting
 * - Session management with client capabilities
 * - Health checking via ping/pong
 * - Graceful shutdown with request draining
 *
 * @class MCPSDKAdapter
 *
 * @example
 * const adapter = new MCPSDKAdapter({
 *   name: 'git-server',
 *   version: '1.0.0',
 *   capabilities: { tools: { listChanged: true } }
 * })
 *
 * adapter.onConnected(() => console.log('Connected!'))
 * adapter.onError((err) => console.error(err))
 *
 * adapter.registerGitdoTools()
 * await adapter.start()
 */
export declare class MCPSDKAdapter {
    /** @internal */
    private config;
    /** @internal */
    private connectionState;
    /** @internal */
    private tools;
    /** @internal */
    private toolIdCounter;
    /** @internal */
    private session;
    /** @internal */
    private stateChangeListeners;
    /** @internal */
    private connectedListeners;
    /** @internal */
    private disconnectedListeners;
    /** @internal */
    private notificationListeners;
    /** @internal */
    private progressListeners;
    /** @internal */
    private errorListeners;
    /** @internal */
    private pongListeners;
    /** @internal */
    private connectionTimeoutListeners;
    /** @internal */
    private pendingRequests;
    /** @internal */
    private currentRequestId;
    /** Current transport connection */
    transport: MCPSDKTransport | null;
    /** @internal */
    private clientResponsive;
    /** @internal */
    private pingTimeoutId;
    /** Whether to cleanup tools on shutdown */
    cleanupOnShutdown: boolean;
    /**
     * Create a new MCP SDK adapter.
     *
     * @param config - Optional configuration options
     * @throws {Error} If name is explicitly set to empty string
     *
     * @example
     * const adapter = new MCPSDKAdapter({
     *   name: 'my-server',
     *   version: '1.0.0',
     *   mode: 'production',
     *   logger: console
     * })
     */
    constructor(config?: MCPSDKAdapterConfig);
    /**
     * Get the adapter configuration.
     * @returns Copy of the current configuration
     */
    getConfig(): MCPSDKAdapterConfig;
    /**
     * Get supported transports.
     * @returns Array of supported transport types
     */
    getSupportedTransports(): MCPSDKTransportType[];
    /**
     * Get protocol version.
     * @returns The MCP protocol version string
     */
    getProtocolVersion(): string;
    /**
     * Get SDK version.
     * @returns The SDK version string
     */
    getSDKVersion(): string;
    /**
     * Get capabilities.
     * @returns Copy of the server capabilities configuration
     */
    getCapabilities(): MCPSDKCapabilities;
    /**
     * Get connection state.
     * @returns Current connection state
     */
    getConnectionState(): MCPSDKConnectionState;
    /**
     * Set connection state and notify listeners.
     * @internal
     */
    private setConnectionState;
    /**
     * Register a state change listener.
     * @param listener - Callback invoked when connection state changes
     * @example
     * adapter.onStateChange((state) => {
     *   console.log(`State changed to: ${state}`)
     * })
     */
    onStateChange(listener: (state: MCPSDKConnectionState) => void): void;
    /**
     * Register a connected listener.
     * @param listener - Callback invoked when connection is established
     */
    onConnected(listener: () => void): void;
    /**
     * Register a disconnected listener.
     * @param listener - Callback invoked when connection is lost
     */
    onDisconnected(listener: () => void): void;
    /**
     * Register a notification listener.
     * @param type - Notification type to listen for (e.g., 'tools/list_changed')
     * @param listener - Callback invoked when notification is emitted
     */
    onNotification(type: string, listener: () => void): void;
    /**
     * Emit a notification.
     * @internal
     */
    private emitNotification;
    /**
     * Register a progress listener.
     * @param listener - Callback invoked when tool reports progress
     */
    onProgress(listener: (progress: ProgressEvent) => void): void;
    /**
     * Register an error listener.
     * @param listener - Callback invoked when an error occurs
     */
    onError(listener: (error: MCPSDKError) => void): void;
    /**
     * Register a pong listener.
     * @param listener - Callback invoked when pong response is received
     */
    onPong(listener: () => void): void;
    /**
     * Register a connection timeout listener.
     * @param listener - Callback invoked when connection times out
     */
    onConnectionTimeout(listener: () => void): void;
    /**
     * Start the adapter.
     *
     * @description
     * Initializes the adapter and transitions to connected state.
     * Must be called before handling any requests.
     *
     * @returns Promise that resolves when started
     * @throws {Error} If adapter is already started
     *
     * @example
     * await adapter.start()
     */
    start(): Promise<void>;
    /**
     * Connect with a transport.
     *
     * @description
     * Attaches a transport and starts the adapter if not already running.
     *
     * @param transport - The transport to connect with
     * @returns Promise that resolves when connected
     */
    connect(transport: MCPSDKTransport): Promise<void>;
    /**
     * Shutdown the adapter.
     *
     * @description
     * Gracefully shuts down the adapter, optionally waiting for pending
     * requests and cleaning up registered tools.
     *
     * @param options - Shutdown options
     * @param options.graceful - If true, wait for pending requests
     * @param options.timeout - Max time to wait for pending requests (ms)
     * @param options.cleanup - If true, clear all registered tools
     * @returns Promise that resolves when shutdown is complete
     *
     * @example
     * await adapter.shutdown({ graceful: true, timeout: 5000, cleanup: true })
     */
    shutdown(options?: {
        graceful?: boolean;
        timeout?: number;
        cleanup?: boolean;
    }): Promise<void>;
    /**
     * Wait for all pending requests to complete.
     * @internal
     */
    private waitForPendingRequests;
    /**
     * Handle client initialization.
     *
     * @description
     * Processes the client's initialize request, validates protocol version,
     * and creates a session.
     *
     * @param request - Client initialization request
     * @returns Server info and capabilities
     * @throws {MCPSDKError} If protocol version is incompatible
     */
    handleClientInitialize(request: MCPClientInitializeRequest): Promise<{
        serverInfo: {
            name: string;
            version: string;
        };
        capabilities: MCPSDKCapabilities;
    }>;
    /**
     * Get current session.
     * @returns Current session or null if not initialized
     */
    getSession(): MCPSDKSession | null;
    /**
     * Register a tool.
     *
     * @description
     * Adds a tool to the adapter's registry. Emits tools/list_changed notification.
     *
     * @param registration - Tool registration details
     * @throws {Error} If schema type is invalid
     * @throws {Error} If tool with same name already exists
     *
     * @example
     * adapter.registerTool({
     *   name: 'my_tool',
     *   description: 'Does something',
     *   inputSchema: { type: 'object', properties: {} },
     *   handler: async (params, ctx) => ({
     *     content: [{ type: 'text', text: 'Done' }]
     *   })
     * })
     */
    registerTool(registration: MCPSDKToolRegistration): void;
    /**
     * Register multiple tools.
     *
     * @description
     * Batch registers multiple tools. More efficient than registering
     * individually as it only emits one notification.
     *
     * @param registrations - Array of tool registrations
     * @throws {Error} If any schema type is invalid
     * @throws {Error} If any tool name already exists
     */
    registerTools(registrations: MCPSDKToolRegistration[]): void;
    /**
     * Unregister a tool.
     * @param name - Name of the tool to unregister
     */
    unregisterTool(name: string): void;
    /**
     * Get a tool by name.
     * @param name - Name of the tool to retrieve
     * @returns Tool metadata (without handler) or undefined if not found
     */
    getTool(name: string): (Omit<MCPSDKToolRegistration, 'handler'> & {
        id: string;
    }) | undefined;
    /**
     * List all tools.
     * @returns Array of tool metadata (without handlers)
     */
    listTools(): Array<Omit<MCPSDKToolRegistration, 'handler'> & {
        id: string;
    }>;
    /**
     * Register gitdo tools.
     *
     * @description
     * Convenience method that registers all built-in git tools.
     * Skips tools that are already registered.
     */
    registerGitdoTools(): void;
    /**
     * Handle tools/list request.
     *
     * @description
     * Returns paginated list of registered tools. Supports cursor-based pagination.
     *
     * @param options - Pagination options
     * @param options.cursor - Pagination cursor from previous response
     * @returns Paginated tool list with optional next cursor
     */
    handleToolsList(options?: {
        cursor?: string;
    }): Promise<{
        tools: Array<{
            name: string;
            description: string;
            inputSchema: {
                type: string;
                properties?: Record<string, unknown>;
                required?: string[];
            };
        }>;
        nextCursor?: string;
    }>;
    /**
     * Handle tools/call request.
     *
     * @description
     * Executes a tool and returns the result. Provides progress reporting
     * and cancellation support through the tool context.
     *
     * @param request - Tool call request with name and arguments
     * @returns Promise with result and requestId for tracking
     * @throws {MCPSDKError} If tool not found or parameters invalid
     *
     * @example
     * const call = adapter.handleToolsCall({
     *   name: 'git_status',
     *   arguments: { short: true }
     * })
     * console.log(`Request ID: ${call.requestId}`)
     * const result = await call
     */
    handleToolsCall(request: MCPToolsCallRequest): Promise<MCPToolsCallResult> & {
        requestId: string;
    };
    /**
     * Cancel a request.
     *
     * @description
     * Marks a pending request as cancelled. The tool handler can check
     * cancellation status via context.isCancelled().
     *
     * @param requestId - The request ID to cancel
     */
    cancelRequest(requestId: string | undefined): void;
    /**
     * Handle raw JSON-RPC message.
     *
     * @description
     * Parses and processes a raw JSON-RPC message string. Routes to
     * appropriate handlers based on the method.
     *
     * @param message - Raw JSON-RPC message string
     * @returns JSON-RPC response string
     */
    handleMessage(message: string): Promise<string>;
    /**
     * Handle a single JSON-RPC message
     */
    private handleSingleMessage;
    /**
     * Simulate a pending request (for testing).
     * @internal
     */
    simulatePendingRequest(): PendingRequest;
    /**
     * Simulate an internal error (for testing).
     * @internal
     */
    simulateInternalError(error: Error): void;
    /**
     * Send ping to check client responsiveness.
     */
    sendPing(): void;
    /**
     * Simulate client becoming unresponsive (for testing).
     * @internal
     */
    simulateClientUnresponsive(): void;
}
/**
 * Transport factory.
 *
 * @description
 * Factory object for creating transport instances. Provides methods
 * for creating stdio, SSE, and HTTP transports.
 *
 * @example
 * // Create a stdio transport
 * const transport = MCPSDKTransport.createStdio()
 *
 * // Create an SSE transport
 * const sseTransport = MCPSDKTransport.createSSE({ endpoint: '/sse' })
 *
 * // Create an HTTP transport
 * const httpTransport = MCPSDKTransport.createHTTP({ endpoint: '/api' })
 */
export declare const MCPSDKTransport: {
    createStdio(_options?: {
        stdin?: {
            on: unknown;
            read: unknown;
            pipe: unknown;
        };
        stdout?: {
            write: unknown;
            end: unknown;
        };
    }): MCPSDKTransport;
    createSSE(_options: {
        endpoint: string;
    }): MCPSDKTransport & {
        handleRequest: (request: unknown) => Promise<{
            status: number;
            headers: Record<string, string>;
            body?: string;
        }>;
    };
    createHTTP(_options: {
        endpoint: string;
    }): MCPSDKTransport & {
        handleRequest: (request: {
            method: string;
            body: string;
            headers: Record<string, string>;
        }) => Promise<{
            status: number;
            headers: Record<string, string>;
            body?: string;
        }>;
    };
};
/**
 * Factory function to create an MCP SDK adapter.
 *
 * @description
 * Convenience function for creating a new MCP SDK adapter instance.
 * Equivalent to using `new MCPSDKAdapter(config)`.
 *
 * @param config - Optional adapter configuration
 * @returns A new MCPSDKAdapter instance
 *
 * @example
 * import { createMCPSDKAdapter } from './sdk-adapter'
 *
 * const adapter = createMCPSDKAdapter({
 *   name: 'git-server',
 *   version: '1.0.0',
 *   capabilities: { tools: { listChanged: true } }
 * })
 *
 * adapter.registerGitdoTools()
 * await adapter.start()
 */
export declare function createMCPSDKAdapter(config?: MCPSDKAdapterConfig): MCPSDKAdapter;
export {};
//# sourceMappingURL=sdk-adapter.d.ts.map