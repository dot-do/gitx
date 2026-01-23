/**
 * @fileoverview Mock rpc.do Module for gitx.do
 *
 * This module provides mock types and implementations for rpc.do
 * that enable the RPC-based git operations in gitx.do.
 *
 * @module do/rpc-mock
 */

// ============================================================================
// Error Codes
// ============================================================================

/**
 * Standard RPC error codes
 */
export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  TIMEOUT: 'TIMEOUT',
  CONNECTION_CLOSED: 'CONNECTION_CLOSED',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  INVALID_ARGUMENTS: 'INVALID_ARGUMENTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  STREAM_ERROR: 'STREAM_ERROR',
  PARTIAL_PUSH_FAILURE: 'PARTIAL_PUSH_FAILURE',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

// ============================================================================
// RPC Error Class
// ============================================================================

/**
 * RPC Error with code and optional data
 */
export class RPCError extends Error {
  code: string
  data?: unknown

  constructor(message: string, code: string, data?: unknown) {
    super(message)
    this.name = 'RPCError'
    this.code = code
    this.data = data
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Connection state for RPC client
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

/**
 * Reconnection options
 */
export interface ReconnectOptions {
  enabled?: boolean
  maxAttempts?: number
  backoffMs?: number
  maxBackoffMs?: number
}

/**
 * Batching options
 */
export interface BatchingOptions {
  enabled?: boolean
  maxSize?: number
  delayMs?: number
}

/**
 * Custom serializer interface
 */
export interface Serializer {
  encode(msg: unknown): ArrayBuffer
  decode(data: ArrayBuffer): unknown
}

/**
 * Client options for DO connection
 */
export interface DOClientOptions {
  url: string
  protocol?: 'ws' | 'wss'
  timeout?: number
  reconnect?: ReconnectOptions
  headers?: Record<string, string>
  batching?: BatchingOptions
  serializer?: Serializer
  onTokenRefresh?: () => Promise<string>
  maxRefreshAttempts?: number
}

/**
 * RPC Request message structure
 */
export interface RPCRequest {
  type: 'request'
  id: string
  path: string[]
  args: unknown[]
  timestamp: number
}

/**
 * RPC Response message structure
 */
export interface RPCResponse {
  type: 'response'
  id: string
  success: boolean
  result?: unknown
  error?: {
    code: string
    message: string
    data?: unknown
    stack?: string
  }
  timestamp: number
}

/**
 * RPC Stream message structure
 */
export interface RPCStreamMessage {
  type: 'stream'
  id: string
  chunk: unknown
  done: boolean
  index: number
  timestamp: number
}

/**
 * RPC Batch message structure
 */
export interface RPCBatchMessage {
  type: 'batch'
  requests?: RPCRequest[]
  responses?: RPCResponse[]
  timestamp: number
}

/**
 * RPC Ping/Pong messages
 */
export interface RPCPingMessage {
  type: 'ping'
  timestamp: number
}

export interface RPCPongMessage {
  type: 'pong'
  timestamp: number
}

/**
 * Magic proxy type for RPC calls
 */
export type MagicProxy<T = unknown> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : MagicProxy<T[K]>
} & {
  [key: string]: MagicProxy & ((...args: unknown[]) => Promise<unknown>)
}

/**
 * Stream controller for server-side streaming
 */
export interface StreamController<T> {
  send(chunk: T): void
  done(result?: unknown): void
  error(err: Error): void
  isClosed: boolean
}

/**
 * Async iterator with cancel support
 */
export interface CancellableAsyncIterator<T> extends AsyncIterator<T> {
  cancel(): void
  [Symbol.asyncIterator](): CancellableAsyncIterator<T>
}

// ============================================================================
// Client Functions
// ============================================================================

/**
 * Create a DO client with magic proxy
 */
export function DO(url: string, options?: Partial<DOClientOptions>): MagicProxy {
  // This is a placeholder - actual implementation in rpc.ts
  // Returns an object-type proxy that acts as both object and callable
  return createMagicProxyObject([])
}

/**
 * Create an RPC client
 */
export function createClient(options: DOClientOptions): MagicProxy {
  return DO(options.url, options)
}

// ============================================================================
// Server Functions
// ============================================================================

/**
 * Server-side magic proxy placeholder
 */
export const $ = {} as MagicProxy

/**
 * RPC handler options
 */
export interface RPCHandlerOptions {
  production?: boolean
}

/**
 * RPC handler interface
 */
export interface RPCHandler {
  fetch(request: Request): Promise<Response>
}

/**
 * Create RPC handler from a DO instance
 */
export function createRPCHandler(
  instance: unknown,
  state: unknown,
  options?: RPCHandlerOptions
): RPCHandler {
  // Placeholder - actual implementation in rpc.ts
  return {
    fetch: async () => new Response('OK'),
  }
}

/**
 * RPC decorator for methods (placeholder)
 */
export function rpc(target: unknown, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  return descriptor
}

/**
 * Create a stream response
 */
export function createStreamResponse<T>(
  handler: (controller: StreamController<T>) => void | Promise<void>
): Promise<T[]> {
  const results: T[] = []
  const controller: StreamController<T> = {
    send: (chunk) => results.push(chunk),
    done: () => {},
    error: () => {},
    isClosed: false,
  }
  handler(controller)
  return Promise.resolve(results)
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a magic proxy for path-based RPC calls (function target)
 */
function createMagicProxy(path: string[]): MagicProxy {
  const proxy = new Proxy(() => {}, {
    get(_target, prop) {
      if (typeof prop === 'string') {
        return createMagicProxy([...path, prop])
      }
      return undefined
    },
    apply(_target, _thisArg, args) {
      // Return a promise that would be resolved by the actual implementation
      return Promise.resolve({ path, args })
    },
  })
  return proxy as MagicProxy
}

/**
 * Create a magic proxy for path-based RPC calls (object target)
 * This returns typeof 'object' instead of 'function'
 */
function createMagicProxyObject(path: string[]): MagicProxy {
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop === 'string') {
        // Return a callable proxy for method calls
        return createMagicProxy([...path, prop])
      }
      return undefined
    },
  })
  return proxy as MagicProxy
}
