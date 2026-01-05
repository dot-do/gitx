/**
 * MCP SDK Adapter
 *
 * This module provides a full-featured adapter for the MCP SDK,
 * including SDK initialization, tool registration, request/response
 * handling, error propagation, and connection lifecycle management.
 */
import { type MCPToolResult } from './tools';
/**
 * MCP SDK Error codes - JSON-RPC 2.0 standard codes and MCP-specific codes
 */
export declare enum MCPSDKErrorCode {
    PARSE_ERROR = -32700,
    INVALID_REQUEST = -32600,
    METHOD_NOT_FOUND = -32601,
    INVALID_PARAMS = -32602,
    INTERNAL_ERROR = -32603,
    TOOL_NOT_FOUND = -32001,
    RESOURCE_NOT_FOUND = -32002,
    PROMPT_NOT_FOUND = -32003,
    CAPABILITY_NOT_SUPPORTED = -32004
}
/**
 * MCP SDK Error class
 */
export declare class MCPSDKError extends Error {
    code: MCPSDKErrorCode;
    data?: unknown;
    constructor(code: MCPSDKErrorCode, message: string, data?: unknown);
    toJSONRPC(): {
        code: number;
        message: string;
        data?: unknown;
    };
}
/**
 * Transport type
 */
export type MCPSDKTransportType = 'stdio' | 'sse' | 'http' | 'custom';
/**
 * Connection state
 */
export type MCPSDKConnectionState = 'disconnected' | 'initializing' | 'connected';
/**
 * MCP SDK Transport interface
 */
export interface MCPSDKTransport {
    type: MCPSDKTransportType;
    send?: (data: string) => void;
    receive?: () => Promise<string>;
    close?: () => void;
    isConnected: () => boolean;
    handleRequest?: (request: unknown) => Promise<{
        status: number;
        headers: Record<string, string>;
        body?: string;
    }>;
}
/**
 * Logger interface
 */
export interface MCPSDKLogger {
    error?: (message: string, ...args: unknown[]) => void;
    warn?: (message: string, ...args: unknown[]) => void;
    info?: (message: string, ...args: unknown[]) => void;
    debug?: (message: string, ...args: unknown[]) => void;
}
/**
 * Capabilities configuration
 */
export interface MCPSDKCapabilities {
    tools?: {
        listChanged?: boolean;
    };
    resources?: {
        subscribe?: boolean;
    };
    prompts?: Record<string, unknown>;
}
/**
 * SDK Adapter configuration
 */
export interface MCPSDKAdapterConfig {
    name?: string;
    version?: string;
    vendor?: string;
    transports?: MCPSDKTransportType[];
    protocolVersion?: string;
    capabilities?: MCPSDKCapabilities;
    logger?: MCPSDKLogger;
    mode?: 'development' | 'production';
    pingInterval?: number;
    pingTimeout?: number;
}
/**
 * Tool handler context
 */
export interface MCPSDKToolContext {
    reportProgress: (progress: number, total: number) => Promise<void>;
    isCancelled: () => boolean;
}
/**
 * Tool registration
 */
export interface MCPSDKToolRegistration {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
    };
    handler: (params: Record<string, unknown>, context: MCPSDKToolContext) => Promise<MCPToolResult>;
}
/**
 * Session information
 */
export interface MCPSDKSession {
    id: string;
    clientInfo: {
        name: string;
        version: string;
    };
    clientCapabilities: {
        sampling?: Record<string, unknown>;
        roots?: {
            listChanged?: boolean;
        };
    };
}
/**
 * Client initialization request
 */
export interface MCPClientInitializeRequest {
    protocolVersion: string;
    clientInfo: {
        name: string;
        version: string;
    };
    capabilities: Record<string, unknown>;
}
/**
 * Tools call request
 */
export interface MCPToolsCallRequest {
    name: string;
    arguments: Record<string, unknown>;
}
/**
 * Tools call result with request ID
 */
export interface MCPToolsCallResult extends MCPToolResult {
    requestId?: string;
}
/**
 * Pending request for graceful shutdown
 */
interface PendingRequest {
    complete: () => Promise<void>;
}
/**
 * Progress event
 */
interface ProgressEvent {
    progress: number;
    total: number;
}
/**
 * MCP SDK Adapter class
 */
export declare class MCPSDKAdapter {
    private config;
    private connectionState;
    private tools;
    private toolIdCounter;
    private session;
    private stateChangeListeners;
    private connectedListeners;
    private disconnectedListeners;
    private notificationListeners;
    private progressListeners;
    private errorListeners;
    private pongListeners;
    private connectionTimeoutListeners;
    private pendingRequests;
    private currentRequestId;
    transport: MCPSDKTransport | null;
    private clientResponsive;
    private pingTimeoutId;
    cleanupOnShutdown: boolean;
    constructor(config?: MCPSDKAdapterConfig);
    /**
     * Get the adapter configuration
     */
    getConfig(): MCPSDKAdapterConfig;
    /**
     * Get supported transports
     */
    getSupportedTransports(): MCPSDKTransportType[];
    /**
     * Get protocol version
     */
    getProtocolVersion(): string;
    /**
     * Get SDK version
     */
    getSDKVersion(): string;
    /**
     * Get capabilities
     */
    getCapabilities(): MCPSDKCapabilities;
    /**
     * Get connection state
     */
    getConnectionState(): MCPSDKConnectionState;
    /**
     * Set connection state and notify listeners
     */
    private setConnectionState;
    /**
     * Register a state change listener
     */
    onStateChange(listener: (state: MCPSDKConnectionState) => void): void;
    /**
     * Register a connected listener
     */
    onConnected(listener: () => void): void;
    /**
     * Register a disconnected listener
     */
    onDisconnected(listener: () => void): void;
    /**
     * Register a notification listener
     */
    onNotification(type: string, listener: () => void): void;
    /**
     * Emit a notification
     */
    private emitNotification;
    /**
     * Register a progress listener
     */
    onProgress(listener: (progress: ProgressEvent) => void): void;
    /**
     * Register an error listener
     */
    onError(listener: (error: MCPSDKError) => void): void;
    /**
     * Register a pong listener
     */
    onPong(listener: () => void): void;
    /**
     * Register a connection timeout listener
     */
    onConnectionTimeout(listener: () => void): void;
    /**
     * Start the adapter
     */
    start(): Promise<void>;
    /**
     * Connect with a transport
     */
    connect(transport: MCPSDKTransport): Promise<void>;
    /**
     * Shutdown the adapter
     */
    shutdown(options?: {
        graceful?: boolean;
        timeout?: number;
        cleanup?: boolean;
    }): Promise<void>;
    /**
     * Wait for all pending requests to complete
     */
    private waitForPendingRequests;
    /**
     * Handle client initialization
     */
    handleClientInitialize(request: MCPClientInitializeRequest): Promise<{
        serverInfo: {
            name: string;
            version: string;
        };
        capabilities: MCPSDKCapabilities;
    }>;
    /**
     * Get current session
     */
    getSession(): MCPSDKSession | null;
    /**
     * Register a tool
     */
    registerTool(registration: MCPSDKToolRegistration): void;
    /**
     * Register multiple tools
     */
    registerTools(registrations: MCPSDKToolRegistration[]): void;
    /**
     * Unregister a tool
     */
    unregisterTool(name: string): void;
    /**
     * Get a tool by name
     */
    getTool(name: string): (Omit<MCPSDKToolRegistration, 'handler'> & {
        id: string;
    }) | undefined;
    /**
     * List all tools
     */
    listTools(): Array<Omit<MCPSDKToolRegistration, 'handler'> & {
        id: string;
    }>;
    /**
     * Register gitdo tools
     */
    registerGitdoTools(): void;
    /**
     * Handle tools/list request
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
     * Handle tools/call request
     */
    handleToolsCall(request: MCPToolsCallRequest): Promise<MCPToolsCallResult> & {
        requestId: string;
    };
    /**
     * Cancel a request
     */
    cancelRequest(requestId: string | undefined): void;
    /**
     * Handle raw JSON-RPC message
     */
    handleMessage(message: string): Promise<string>;
    /**
     * Handle a single JSON-RPC message
     */
    private handleSingleMessage;
    /**
     * Simulate a pending request (for testing)
     */
    simulatePendingRequest(): PendingRequest;
    /**
     * Simulate an internal error (for testing)
     */
    simulateInternalError(error: Error): void;
    /**
     * Send ping
     */
    sendPing(): void;
    /**
     * Simulate client becoming unresponsive (for testing)
     */
    simulateClientUnresponsive(): void;
}
/**
 * Transport factory
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
 * Factory function to create an MCP SDK adapter
 */
export declare function createMCPSDKAdapter(config?: MCPSDKAdapterConfig): MCPSDKAdapter;
export {};
//# sourceMappingURL=sdk-adapter.d.ts.map