/**
 * @fileoverview Rate Limiting Middleware for Cloudflare Workers
 *
 * Provides configurable rate limiting to protect against abuse.
 * Supports different limits for different endpoint types (push, fetch, API)
 * and returns appropriate 429 responses with Retry-After headers.
 *
 * @module middleware/rate-limit
 *
 * ## Features
 *
 * - Configurable rate limits per endpoint type
 * - Sliding window rate limiting algorithm
 * - Supports both in-memory and Durable Object-backed storage
 * - Returns 429 Too Many Requests with Retry-After header
 * - Configurable key extraction (IP, user ID, API key, etc.)
 *
 * @example Basic usage with Hono
 * ```typescript
 * import { Hono } from 'hono'
 * import { createRateLimitMiddleware, MemoryRateLimitStore } from './middleware/rate-limit'
 *
 * const app = new Hono()
 * const store = new MemoryRateLimitStore()
 *
 * const rateLimiter = createRateLimitMiddleware({
 *   store,
 *   limits: {
 *     push: { requests: 10, windowMs: 60_000 },   // 10 pushes/minute
 *     fetch: { requests: 100, windowMs: 60_000 }, // 100 fetches/minute
 *     api: { requests: 60, windowMs: 60_000 },    // 60 API calls/minute
 *   },
 * })
 *
 * app.use('*', rateLimiter)
 * ```
 *
 * @example With Durable Object storage
 * ```typescript
 * import { DORateLimitStore } from './middleware/rate-limit'
 *
 * // In your worker
 * const store = new DORateLimitStore(env.RATE_LIMIT_DO)
 * const rateLimiter = createRateLimitMiddleware({ store, limits })
 * ```
 */
import type { Context, MiddlewareHandler } from 'hono';
/**
 * Rate limit configuration for a specific endpoint type.
 */
export interface RateLimitConfig {
    /** Maximum number of requests allowed in the window */
    requests: number;
    /** Time window in milliseconds */
    windowMs: number;
}
/**
 * Endpoint type categorization for rate limiting.
 */
export type EndpointType = 'push' | 'fetch' | 'api' | 'health' | 'default';
/**
 * Map of endpoint types to their rate limit configurations.
 */
export type RateLimitConfigs = Partial<Record<EndpointType, RateLimitConfig>>;
/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
    /** Whether the request is allowed */
    allowed: boolean;
    /** Number of requests remaining in the current window */
    remaining: number;
    /** Total limit for the window */
    limit: number;
    /** Unix timestamp (ms) when the rate limit resets */
    resetAt: number;
    /** Seconds until the rate limit resets (for Retry-After header) */
    retryAfter: number;
}
/**
 * Information tracked for a rate limit key.
 */
export interface RateLimitInfo {
    /** Number of requests made in the current window */
    count: number;
    /** Unix timestamp (ms) when the window started */
    windowStart: number;
}
/**
 * Storage interface for rate limit data.
 */
export interface RateLimitStore {
    /**
     * Get rate limit info for a key.
     * @param key - The rate limit key (e.g., IP + endpoint type)
     */
    get(key: string): Promise<RateLimitInfo | null>;
    /**
     * Increment the request count for a key.
     * @param key - The rate limit key
     * @param windowMs - Window duration in milliseconds
     * @returns The updated rate limit info
     */
    increment(key: string, windowMs: number): Promise<RateLimitInfo>;
    /**
     * Reset the rate limit for a key.
     * @param key - The rate limit key
     */
    reset(key: string): Promise<void>;
}
/**
 * Function to extract the rate limit key from a request.
 * Default: uses client IP address.
 */
export type KeyExtractor = (c: Context) => string | Promise<string>;
/**
 * Function to classify a request into an endpoint type.
 */
export type EndpointClassifier = (c: Context) => EndpointType;
/**
 * Options for the rate limit middleware.
 */
export interface RateLimitOptions {
    /** Storage backend for rate limit data */
    store: RateLimitStore;
    /** Rate limit configurations by endpoint type */
    limits: RateLimitConfigs;
    /** Custom key extractor (default: client IP) */
    keyExtractor?: KeyExtractor;
    /** Custom endpoint classifier */
    endpointClassifier?: EndpointClassifier;
    /** Skip rate limiting for certain conditions */
    skip?: (c: Context) => boolean | Promise<boolean>;
    /** Custom response handler for rate-limited requests */
    onRateLimited?: (c: Context, result: RateLimitResult) => Response | Promise<Response>;
    /** Whether to include rate limit headers in all responses (default: true) */
    includeHeaders?: boolean;
    /** Header prefix for rate limit headers (default: 'X-RateLimit-') */
    headerPrefix?: string;
}
/**
 * Default rate limits per endpoint type.
 */
export declare const DEFAULT_LIMITS: RateLimitConfigs;
/**
 * Default key extractor that uses the client IP address.
 */
export declare function defaultKeyExtractor(c: Context): string;
/**
 * Create a key extractor that combines IP with user ID if authenticated.
 */
export declare function createUserAwareKeyExtractor(getUserId: (c: Context) => string | null | Promise<string | null>): KeyExtractor;
/**
 * Default endpoint classifier based on request path and method.
 */
export declare function defaultEndpointClassifier(c: Context): EndpointType;
/**
 * In-memory rate limit store.
 *
 * @description
 * Simple in-memory storage for rate limiting. Suitable for single-instance
 * deployments or testing. For distributed rate limiting across multiple
 * workers, use DORateLimitStore.
 *
 * Note: This store will reset when the worker restarts or is evicted.
 *
 * @example
 * ```typescript
 * const store = new MemoryRateLimitStore()
 * const middleware = createRateLimitMiddleware({ store, limits: DEFAULT_LIMITS })
 * ```
 */
export declare class MemoryRateLimitStore implements RateLimitStore {
    private data;
    private cleanupInterval;
    constructor(options?: {
        cleanupIntervalMs?: number;
    });
    get(key: string): Promise<RateLimitInfo | null>;
    increment(key: string, windowMs: number): Promise<RateLimitInfo>;
    reset(key: string): Promise<void>;
    /**
     * Clean up expired entries.
     */
    private cleanup;
    /**
     * Stop the cleanup interval.
     */
    destroy(): void;
    /**
     * Get the number of tracked keys (for testing/debugging).
     */
    size(): number;
    /**
     * Clear all rate limit data (for testing).
     */
    clear(): void;
}
/**
 * Durable Object-backed rate limit store.
 *
 * @description
 * Distributed rate limiting using a Durable Object for storage.
 * Provides consistent rate limiting across all worker instances.
 *
 * Requires a Durable Object class that handles rate limit storage.
 * See RateLimitDO for the expected interface.
 *
 * @example
 * ```typescript
 * // In worker
 * const store = new DORateLimitStore(env.RATE_LIMIT_DO)
 * const middleware = createRateLimitMiddleware({ store, limits: DEFAULT_LIMITS })
 * ```
 */
export declare class DORateLimitStore implements RateLimitStore {
    private namespace;
    constructor(namespace: DurableObjectNamespace);
    private getStub;
    get(key: string): Promise<RateLimitInfo | null>;
    increment(key: string, windowMs: number): Promise<RateLimitInfo>;
    reset(key: string): Promise<void>;
}
/**
 * Durable Object namespace type (from Cloudflare Workers types).
 */
interface DurableObjectNamespace {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
}
interface DurableObjectId {
    toString(): string;
}
interface DurableObjectStub {
    fetch(request: Request): Promise<Response>;
}
/**
 * Durable Object for distributed rate limiting.
 *
 * @description
 * Handles rate limit storage and operations for a set of keys.
 * Multiple instances are used to distribute load.
 *
 * @example wrangler.toml
 * ```toml
 * [durable_objects]
 * bindings = [
 *   { name = "RATE_LIMIT_DO", class_name = "RateLimitDO" }
 * ]
 * ```
 */
export declare class RateLimitDO {
    private state;
    private data;
    constructor(state: DurableObjectState);
    fetch(request: Request): Promise<Response>;
}
interface DurableObjectState {
    storage?: {
        get<T>(key: string): Promise<T | undefined>;
        put<T>(key: string, value: T): Promise<void>;
    };
    blockConcurrencyWhile(fn: () => Promise<void>): void;
    waitUntil(promise: Promise<unknown>): void;
}
/**
 * Create a rate limiting middleware.
 *
 * @description
 * Creates a Hono middleware that enforces rate limits on incoming requests.
 * Different endpoint types can have different rate limits.
 *
 * @param options - Rate limit configuration options
 * @returns Hono middleware function
 *
 * @example
 * ```typescript
 * import { createRateLimitMiddleware, MemoryRateLimitStore, DEFAULT_LIMITS } from './middleware/rate-limit'
 *
 * const store = new MemoryRateLimitStore()
 * const rateLimiter = createRateLimitMiddleware({
 *   store,
 *   limits: DEFAULT_LIMITS,
 * })
 *
 * app.use('*', rateLimiter)
 * ```
 *
 * @example Custom limits
 * ```typescript
 * const rateLimiter = createRateLimitMiddleware({
 *   store,
 *   limits: {
 *     push: { requests: 5, windowMs: 60_000 },  // Very restrictive
 *     fetch: { requests: 200, windowMs: 60_000 }, // Very permissive
 *   },
 * })
 * ```
 *
 * @example Skip rate limiting for authenticated users
 * ```typescript
 * const rateLimiter = createRateLimitMiddleware({
 *   store,
 *   limits: DEFAULT_LIMITS,
 *   skip: (c) => c.get('authenticated') === true,
 * })
 * ```
 */
export declare function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler;
/**
 * Create rate limit middleware with default configuration.
 *
 * @description
 * Convenience function that creates rate limit middleware with
 * sensible defaults using in-memory storage.
 *
 * @param overrides - Optional config overrides
 * @returns Configured rate limit middleware
 */
export declare function createDefaultRateLimiter(overrides?: Partial<RateLimitOptions>): MiddlewareHandler;
/**
 * Create a stricter rate limiter for sensitive operations.
 */
export declare function createStrictRateLimiter(store: RateLimitStore): MiddlewareHandler;
/**
 * Create a permissive rate limiter for high-traffic scenarios.
 */
export declare function createPermissiveRateLimiter(store: RateLimitStore): MiddlewareHandler;
export {};
//# sourceMappingURL=rate-limit.d.ts.map