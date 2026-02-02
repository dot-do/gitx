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

import type { Context, Next, MiddlewareHandler } from 'hono'

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limit configuration for a specific endpoint type.
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  requests: number
  /** Time window in milliseconds */
  windowMs: number
}

/**
 * Endpoint type categorization for rate limiting.
 */
export type EndpointType = 'push' | 'fetch' | 'api' | 'health' | 'default'

/**
 * Map of endpoint types to their rate limit configurations.
 */
export type RateLimitConfigs = Partial<Record<EndpointType, RateLimitConfig>>

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Number of requests remaining in the current window */
  remaining: number
  /** Total limit for the window */
  limit: number
  /** Unix timestamp (ms) when the rate limit resets */
  resetAt: number
  /** Seconds until the rate limit resets (for Retry-After header) */
  retryAfter: number
}

/**
 * Information tracked for a rate limit key.
 */
export interface RateLimitInfo {
  /** Number of requests made in the current window */
  count: number
  /** Unix timestamp (ms) when the window started */
  windowStart: number
}

/**
 * Storage interface for rate limit data.
 */
export interface RateLimitStore {
  /**
   * Get rate limit info for a key.
   * @param key - The rate limit key (e.g., IP + endpoint type)
   */
  get(key: string): Promise<RateLimitInfo | null>

  /**
   * Increment the request count for a key.
   * @param key - The rate limit key
   * @param windowMs - Window duration in milliseconds
   * @returns The updated rate limit info
   */
  increment(key: string, windowMs: number): Promise<RateLimitInfo>

  /**
   * Reset the rate limit for a key.
   * @param key - The rate limit key
   */
  reset(key: string): Promise<void>
}

/**
 * Function to extract the rate limit key from a request.
 * Default: uses client IP address.
 */
export type KeyExtractor = (c: Context) => string | Promise<string>

/**
 * Function to classify a request into an endpoint type.
 */
export type EndpointClassifier = (c: Context) => EndpointType

/**
 * Options for the rate limit middleware.
 */
export interface RateLimitOptions {
  /** Storage backend for rate limit data */
  store: RateLimitStore
  /** Rate limit configurations by endpoint type */
  limits: RateLimitConfigs
  /** Custom key extractor (default: client IP) */
  keyExtractor?: KeyExtractor
  /** Custom endpoint classifier */
  endpointClassifier?: EndpointClassifier
  /** Skip rate limiting for certain conditions */
  skip?: (c: Context) => boolean | Promise<boolean>
  /** Custom response handler for rate-limited requests */
  onRateLimited?: (c: Context, result: RateLimitResult) => Response | Promise<Response>
  /** Whether to include rate limit headers in all responses (default: true) */
  includeHeaders?: boolean
  /** Header prefix for rate limit headers (default: 'X-RateLimit-') */
  headerPrefix?: string
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default rate limits per endpoint type.
 */
export const DEFAULT_LIMITS: RateLimitConfigs = {
  // Git push operations - more restrictive
  push: { requests: 30, windowMs: 60_000 }, // 30 pushes per minute

  // Git fetch/clone operations - more permissive
  fetch: { requests: 120, windowMs: 60_000 }, // 120 fetches per minute

  // General API endpoints
  api: { requests: 60, windowMs: 60_000 }, // 60 API calls per minute

  // Health check endpoints - very permissive
  health: { requests: 300, windowMs: 60_000 }, // 300 checks per minute

  // Default fallback
  default: { requests: 60, windowMs: 60_000 }, // 60 requests per minute
}

// ============================================================================
// Key Extraction
// ============================================================================

/**
 * Default key extractor that uses the client IP address.
 */
export function defaultKeyExtractor(c: Context): string {
  // Try various headers for client IP (in order of preference)
  const cfConnectingIp = c.req.header('CF-Connecting-IP')
  if (cfConnectingIp) return cfConnectingIp

  const xRealIp = c.req.header('X-Real-IP')
  if (xRealIp) return xRealIp

  const xForwardedFor = c.req.header('X-Forwarded-For')
  if (xForwardedFor) {
    // X-Forwarded-For can contain multiple IPs, take the first one
    return xForwardedFor.split(',')[0]!.trim()
  }

  // Fallback to a generic key if no IP available
  return 'unknown'
}

/**
 * Create a key extractor that combines IP with user ID if authenticated.
 */
export function createUserAwareKeyExtractor(
  getUserId: (c: Context) => string | null | Promise<string | null>
): KeyExtractor {
  return async (c: Context): Promise<string> => {
    const ip = defaultKeyExtractor(c)
    const userId = await getUserId(c)
    return userId ? `user:${userId}` : `ip:${ip}`
  }
}

// ============================================================================
// Endpoint Classification
// ============================================================================

/**
 * Default endpoint classifier based on request path and method.
 */
export function defaultEndpointClassifier(c: Context): EndpointType {
  const path = new URL(c.req.url).pathname
  const method = c.req.method

  // Health check endpoints
  if (path === '/health' || path.endsWith('/health')) {
    return 'health'
  }

  // Git wire protocol endpoints
  if (path.includes('/git-receive-pack') || (path.includes('/info/refs') && c.req.query('service') === 'git-receive-pack')) {
    return 'push'
  }

  if (path.includes('/git-upload-pack') || (path.includes('/info/refs') && c.req.query('service') === 'git-upload-pack')) {
    return 'fetch'
  }

  // Sync and export are API operations
  if (path.includes('/sync') || path.includes('/export')) {
    return 'api'
  }

  // LFS batch API
  if (path.includes('/objects/batch')) {
    return method === 'POST' ? 'push' : 'fetch'
  }

  // Default to API for everything else
  return 'api'
}

// ============================================================================
// In-Memory Store
// ============================================================================

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
export class MemoryRateLimitStore implements RateLimitStore {
  private data = new Map<string, RateLimitInfo>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(options: { cleanupIntervalMs?: number } = {}) {
    // Periodically clean up expired entries
    const cleanupMs = options.cleanupIntervalMs ?? 60_000
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), cleanupMs)
    }
  }

  async get(key: string): Promise<RateLimitInfo | null> {
    return this.data.get(key) ?? null
  }

  async increment(key: string, windowMs: number): Promise<RateLimitInfo> {
    const now = Date.now()
    const existing = this.data.get(key)

    if (existing && now - existing.windowStart < windowMs) {
      // Within the current window, increment count
      existing.count++
      return existing
    }

    // Start a new window
    const info: RateLimitInfo = {
      count: 1,
      windowStart: now,
    }
    this.data.set(key, info)
    return info
  }

  async reset(key: string): Promise<void> {
    this.data.delete(key)
  }

  /**
   * Clean up expired entries.
   */
  private cleanup(): void {
    const now = Date.now()
    const maxAge = 5 * 60_000 // Remove entries older than 5 minutes

    const keysToDelete: string[] = []
    this.data.forEach((info, key) => {
      if (now - info.windowStart > maxAge) {
        keysToDelete.push(key)
      }
    })

    for (const key of keysToDelete) {
      this.data.delete(key)
    }
  }

  /**
   * Stop the cleanup interval.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Get the number of tracked keys (for testing/debugging).
   */
  size(): number {
    return this.data.size
  }

  /**
   * Clear all rate limit data (for testing).
   */
  clear(): void {
    this.data.clear()
  }
}

// ============================================================================
// Durable Object Store
// ============================================================================

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
export class DORateLimitStore implements RateLimitStore {
  private namespace: DurableObjectNamespace

  constructor(namespace: DurableObjectNamespace) {
    this.namespace = namespace
  }

  private getStub(key: string): DurableObjectStub {
    // Use the key to determine which DO instance handles this rate limit
    // This distributes load across multiple DO instances
    const id = this.namespace.idFromName(key)
    return this.namespace.get(id)
  }

  async get(key: string): Promise<RateLimitInfo | null> {
    const stub = this.getStub(key)
    const response = await stub.fetch(new Request(`https://rate-limit/get?key=${encodeURIComponent(key)}`))
    if (!response.ok) return null
    const data = await response.json() as RateLimitInfo | null
    return data
  }

  async increment(key: string, windowMs: number): Promise<RateLimitInfo> {
    const stub = this.getStub(key)
    const response = await stub.fetch(new Request(`https://rate-limit/increment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, windowMs }),
    }))
    return await response.json() as RateLimitInfo
  }

  async reset(key: string): Promise<void> {
    const stub = this.getStub(key)
    await stub.fetch(new Request(`https://rate-limit/reset?key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }))
  }
}

/**
 * Durable Object namespace type (from Cloudflare Workers types).
 */
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

interface DurableObjectId {
  toString(): string
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

// ============================================================================
// Rate Limit DO (Durable Object)
// ============================================================================

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
export class RateLimitDO {
  private state: DurableObjectState
  private data = new Map<string, RateLimitInfo>()

  constructor(state: DurableObjectState) {
    this.state = state
    // Load existing data from storage
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage?.get<Map<string, RateLimitInfo>>('data')
      if (stored) {
        this.data = stored
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/get') {
      const key = url.searchParams.get('key')
      if (!key) {
        return new Response('Missing key', { status: 400 })
      }
      const info = this.data.get(key) ?? null
      return new Response(JSON.stringify(info), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (path === '/increment' && request.method === 'POST') {
      const body = await request.json() as { key: string; windowMs: number }
      const { key, windowMs } = body

      const now = Date.now()
      const existing = this.data.get(key)

      let info: RateLimitInfo
      if (existing && now - existing.windowStart < windowMs) {
        existing.count++
        info = existing
      } else {
        info = { count: 1, windowStart: now }
        this.data.set(key, info)
      }

      // Persist changes
      this.state.waitUntil(this.state.storage?.put('data', this.data) ?? Promise.resolve())

      return new Response(JSON.stringify(info), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (path === '/reset' && request.method === 'DELETE') {
      const key = url.searchParams.get('key')
      if (key) {
        this.data.delete(key)
        this.state.waitUntil(this.state.storage?.put('data', this.data) ?? Promise.resolve())
      }
      return new Response(null, { status: 204 })
    }

    return new Response('Not Found', { status: 404 })
  }
}

interface DurableObjectState {
  storage?: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
  }
  blockConcurrencyWhile(fn: () => Promise<void>): void
  waitUntil(promise: Promise<unknown>): void
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Check if a request should be rate limited.
 */
async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const info = await store.increment(key, config.windowMs)
  const resetAt = info.windowStart + config.windowMs
  const now = Date.now()
  const retryAfter = Math.max(0, Math.ceil((resetAt - now) / 1000))

  const allowed = info.count <= config.requests
  const remaining = Math.max(0, config.requests - info.count)

  return {
    allowed,
    remaining,
    limit: config.requests,
    resetAt,
    retryAfter,
  }
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
export function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
  const {
    store,
    limits,
    keyExtractor = defaultKeyExtractor,
    endpointClassifier = defaultEndpointClassifier,
    skip,
    onRateLimited,
    includeHeaders = true,
    headerPrefix = 'X-RateLimit-',
  } = options

  return async (c: Context, next: Next) => {
    // Check if rate limiting should be skipped
    if (skip && await skip(c)) {
      return next()
    }

    // Extract key and classify endpoint
    const key = await keyExtractor(c)
    const endpointType = endpointClassifier(c)

    // Get the rate limit config for this endpoint type
    const config = limits[endpointType] ?? limits.default ?? DEFAULT_LIMITS.default!

    // Build the full rate limit key
    const fullKey = `${key}:${endpointType}`

    // Check rate limit
    const result = await checkRateLimit(store, fullKey, config)

    // Add rate limit headers if enabled
    if (includeHeaders) {
      c.header(`${headerPrefix}Limit`, String(result.limit))
      c.header(`${headerPrefix}Remaining`, String(result.remaining))
      c.header(`${headerPrefix}Reset`, String(result.resetAt))
    }

    // If rate limited, return 429 response
    if (!result.allowed) {
      if (onRateLimited) {
        return onRateLimited(c, result)
      }

      return c.json(
        {
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Please retry after ${result.retryAfter} seconds.`,
          retryAfter: result.retryAfter,
        },
        429,
        {
          'Retry-After': String(result.retryAfter),
          [`${headerPrefix}Limit`]: String(result.limit),
          [`${headerPrefix}Remaining`]: '0',
          [`${headerPrefix}Reset`]: String(result.resetAt),
        }
      )
    }

    // Continue to next handler
    return next()
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

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
export function createDefaultRateLimiter(
  overrides: Partial<RateLimitOptions> = {}
): MiddlewareHandler {
  const store = overrides.store ?? new MemoryRateLimitStore()
  return createRateLimitMiddleware({
    store,
    limits: { ...DEFAULT_LIMITS, ...overrides.limits },
    ...overrides,
  })
}

/**
 * Create a stricter rate limiter for sensitive operations.
 */
export function createStrictRateLimiter(store: RateLimitStore): MiddlewareHandler {
  return createRateLimitMiddleware({
    store,
    limits: {
      push: { requests: 10, windowMs: 60_000 },  // 10 pushes/minute
      fetch: { requests: 60, windowMs: 60_000 }, // 60 fetches/minute
      api: { requests: 30, windowMs: 60_000 },   // 30 API calls/minute
      health: { requests: 60, windowMs: 60_000 }, // 60 health checks/minute
      default: { requests: 30, windowMs: 60_000 },
    },
  })
}

/**
 * Create a permissive rate limiter for high-traffic scenarios.
 */
export function createPermissiveRateLimiter(store: RateLimitStore): MiddlewareHandler {
  return createRateLimitMiddleware({
    store,
    limits: {
      push: { requests: 100, windowMs: 60_000 },   // 100 pushes/minute
      fetch: { requests: 500, windowMs: 60_000 },  // 500 fetches/minute
      api: { requests: 300, windowMs: 60_000 },    // 300 API calls/minute
      health: { requests: 1000, windowMs: 60_000 }, // 1000 health checks/minute
      default: { requests: 200, windowMs: 60_000 },
    },
  })
}
