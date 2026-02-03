/**
 * @fileoverview Mock rpc.do Module for gitx.do
 *
 * This module provides mock types and implementations for rpc.do
 * that enable the RPC-based git operations in gitx.do.
 *
 * @module do/rpc-mock
 */
/**
 * Standard RPC error codes
 */
export declare const ErrorCodes: {
    readonly UNAUTHORIZED: "UNAUTHORIZED";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly TIMEOUT: "TIMEOUT";
    readonly CONNECTION_CLOSED: "CONNECTION_CLOSED";
    readonly CONNECTION_FAILED: "CONNECTION_FAILED";
    readonly METHOD_NOT_FOUND: "METHOD_NOT_FOUND";
    readonly INVALID_ARGUMENTS: "INVALID_ARGUMENTS";
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
    readonly STREAM_ERROR: "STREAM_ERROR";
    readonly PARTIAL_PUSH_FAILURE: "PARTIAL_PUSH_FAILURE";
};
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
/**
 * RPC Error with code and optional data
 * @template T - The type of additional error data
 */
export declare class RPCError<T = unknown> extends Error {
    code: string;
    data?: T;
    constructor(message: string, code: string, data?: T);
}
/**
 * Connection state for RPC client
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
/**
 * Reconnection options
 */
export interface ReconnectOptions {
    enabled?: boolean;
    maxAttempts?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
}
/**
 * Batching options
 */
export interface BatchingOptions {
    enabled?: boolean;
    maxSize?: number;
    delayMs?: number;
}
/**
 * Custom serializer interface
 * @template TEncode - The type of messages to encode
 * @template TDecode - The type of decoded messages
 */
export interface Serializer<TEncode = RPCMessage, TDecode = RPCMessage> {
    encode(msg: TEncode): ArrayBuffer;
    decode(data: ArrayBuffer): TDecode;
}
/**
 * Union of all RPC message types.
 */
export type RPCMessage = RPCRequest | RPCResponse | RPCStreamMessage | RPCBatchMessage | RPCPingMessage | RPCPongMessage;
/**
 * Client options for DO connection
 */
export interface DOClientOptions {
    url: string;
    protocol?: 'ws' | 'wss';
    timeout?: number;
    reconnect?: ReconnectOptions;
    headers?: Record<string, string>;
    batching?: BatchingOptions;
    serializer?: Serializer;
    onTokenRefresh?: () => Promise<string>;
    maxRefreshAttempts?: number;
}
/**
 * RPC argument types that can be serialized.
 */
export type RPCArg = string | number | boolean | null | undefined | Uint8Array | RPCArg[] | {
    [key: string]: RPCArg;
};
/**
 * RPC Request message structure
 * @template TArgs - The type of arguments array
 */
export interface RPCRequest<TArgs extends RPCArg[] = RPCArg[]> {
    type: 'request';
    id: string;
    path: string[];
    args: TArgs;
    timestamp: number;
}
/**
 * RPC error details in a response.
 * @template T - The type of additional error data
 */
export interface RPCResponseError<T = unknown> {
    code: string;
    message: string;
    data?: T;
    stack?: string;
}
/**
 * RPC Response message structure
 * @template TResult - The type of the result value
 * @template TErrorData - The type of error data
 */
export interface RPCResponse<TResult = unknown, TErrorData = unknown> {
    type: 'response';
    id: string;
    success: boolean;
    result?: TResult;
    error?: RPCResponseError<TErrorData>;
    timestamp: number;
}
/**
 * RPC Stream message structure
 * @template TChunk - The type of streamed chunks
 */
export interface RPCStreamMessage<TChunk = unknown> {
    type: 'stream';
    id: string;
    chunk: TChunk;
    done: boolean;
    index: number;
    timestamp: number;
}
/**
 * RPC Batch message structure
 */
export interface RPCBatchMessage {
    type: 'batch';
    requests?: RPCRequest[];
    responses?: RPCResponse[];
    timestamp: number;
}
/**
 * RPC Ping/Pong messages
 */
export interface RPCPingMessage {
    type: 'ping';
    timestamp: number;
}
export interface RPCPongMessage {
    type: 'pong';
    timestamp: number;
}
/**
 * Magic proxy type for RPC calls.
 * Provides typed method invocation when T is known, falls back to RPCArg for dynamic access.
 * @template T - The interface being proxied (defaults to Record<string, RPCMethodValue>)
 */
export type MagicProxy<T = Record<string, RPCMethodValue>> = {
    [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : T[K] extends object ? MagicProxy<T[K]> : T[K];
} & {
    [key: string]: MagicProxy & ((...args: RPCArg[]) => Promise<RPCArg | void>);
};
/**
 * Stream controller for server-side streaming
 * @template TChunk - The type of chunks being streamed
 * @template TResult - The type of the final result (defaults to TChunk)
 */
export interface StreamController<TChunk, TResult = TChunk> {
    send(chunk: TChunk): void;
    done(result?: TResult): void;
    error(err: Error): void;
    isClosed: boolean;
}
/**
 * Async iterator with cancel support
 */
export interface CancellableAsyncIterator<T> extends AsyncIterator<T> {
    cancel(): void;
    [Symbol.asyncIterator](): CancellableAsyncIterator<T>;
}
/**
 * Create a DO client with magic proxy
 */
export declare function DO(_url: string, _options?: Partial<DOClientOptions>): MagicProxy;
/**
 * Create an RPC client
 */
export declare function createClient(options: DOClientOptions): MagicProxy;
/**
 * Server-side magic proxy placeholder
 */
export declare const $: MagicProxy;
/**
 * RPC handler options
 */
export interface RPCHandlerOptions {
    production?: boolean;
}
/**
 * RPC handler interface
 */
export interface RPCHandler {
    fetch(request: Request): Promise<Response>;
}
/**
 * Valid RPC method types that can be exposed on a DO instance.
 */
export type RPCMethodValue = ((...args: RPCArg[]) => Promise<RPCArg | void> | RPCArg | void) | RPCArg | {
    [key: string]: RPCMethodValue;
};
/**
 * Durable Object instance type for RPC handler.
 * @template T - The methods/properties exposed by this DO (defaults to Record<string, RPCMethodValue>)
 */
export interface RPCDOInstance<_T extends Record<string, RPCMethodValue> = Record<string, RPCMethodValue>> {
    [key: string]: RPCMethodValue;
}
/**
 * Durable Object state type for RPC handler.
 */
export interface RPCDOState {
    storage: {
        get<T>(key: string): Promise<T | undefined>;
        put<T>(key: string, value: T): Promise<void>;
        delete(key: string): Promise<boolean>;
    };
}
/**
 * Create RPC handler from a DO instance
 * @template TInstance - The type of the DO instance
 */
export declare function createRPCHandler<TInstance extends RPCDOInstance>(_instance: TInstance, _state: RPCDOState, _options?: RPCHandlerOptions): RPCHandler;
/**
 * RPC decorator for methods (placeholder)
 */
export declare function rpc<T>(_target: T, _propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor;
/**
 * Create a stream response
 */
export declare function createStreamResponse<T>(handler: (controller: StreamController<T>) => void | Promise<void>): Promise<T[]>;
//# sourceMappingURL=rpc-mock.d.ts.map