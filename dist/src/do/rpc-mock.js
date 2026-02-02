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
};
// ============================================================================
// RPC Error Class
// ============================================================================
/**
 * RPC Error with code and optional data
 * @template T - The type of additional error data
 */
export class RPCError extends Error {
    code;
    data;
    constructor(message, code, data) {
        super(message);
        this.name = 'RPCError';
        this.code = code;
        this.data = data;
    }
}
// ============================================================================
// Client Functions
// ============================================================================
/**
 * Create a DO client with magic proxy
 */
export function DO(url, options) {
    // This is a placeholder - actual implementation in rpc.ts
    // Returns an object-type proxy that acts as both object and callable
    return createMagicProxyObject([]);
}
/**
 * Create an RPC client
 */
export function createClient(options) {
    return DO(options.url, options);
}
// ============================================================================
// Server Functions
// ============================================================================
/**
 * Server-side magic proxy placeholder
 */
export const $ = {};
/**
 * Create RPC handler from a DO instance
 * @template TInstance - The type of the DO instance
 */
export function createRPCHandler(instance, state, options) {
    // Placeholder - actual implementation in rpc.ts
    return {
        fetch: async () => new Response('OK'),
    };
}
/**
 * RPC decorator for methods (placeholder)
 */
export function rpc(target, propertyKey, descriptor) {
    return descriptor;
}
/**
 * Create a stream response
 */
export function createStreamResponse(handler) {
    const results = [];
    const controller = {
        send: (chunk) => results.push(chunk),
        done: () => { },
        error: () => { },
        isClosed: false,
    };
    handler(controller);
    return Promise.resolve(results);
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Create a magic proxy for path-based RPC calls (function target)
 */
function createMagicProxy(path) {
    const proxy = new Proxy(() => { }, {
        get(_target, prop) {
            if (typeof prop === 'string') {
                return createMagicProxy([...path, prop]);
            }
            return undefined;
        },
        apply(_target, _thisArg, args) {
            // Return a promise that would be resolved by the actual implementation
            return Promise.resolve({ path, args });
        },
    });
    // Cast through unknown since Proxy doesn't preserve type information
    return proxy;
}
/**
 * Create a magic proxy for path-based RPC calls (object target)
 * This returns typeof 'object' instead of 'function'
 */
function createMagicProxyObject(path) {
    const proxy = new Proxy({}, {
        get(_target, prop) {
            if (typeof prop === 'string') {
                // Return a callable proxy for method calls
                return createMagicProxy([...path, prop]);
            }
            return undefined;
        },
    });
    return proxy;
}
//# sourceMappingURL=rpc-mock.js.map