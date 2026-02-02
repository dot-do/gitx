/**
 * @fileoverview Production Hardening for Pack Negotiation
 *
 * This module provides production hardening for Git pack negotiation:
 * - Limits on negotiation rounds to prevent DoS attacks
 * - Input validation for SHA formats, ref names, and capabilities
 * - Timeout handling for long-running negotiations
 * - Graceful malformed packet handling
 * - Rate limiting hooks and integration points
 *
 * @module wire/hardening
 *
 * @example
 * ```typescript
 * import {
 *   NegotiationLimits,
 *   createNegotiationContext,
 *   validateNegotiationRound,
 *   validateSha,
 *   validateCapabilities,
 *   createRateLimiter,
 * } from './wire/hardening'
 *
 * // Create negotiation context with limits
 * const ctx = createNegotiationContext({
 *   maxRounds: 50,
 *   maxWants: 1000,
 *   maxHaves: 10000,
 *   timeout: 120000,
 * })
 *
 * // Validate each round
 * const roundResult = validateNegotiationRound(ctx)
 * if (!roundResult.valid) {
 *   return rejectRequest(roundResult.error)
 * }
 * ```
 */
import { WireError } from '../errors';
/**
 * Negotiation limits configuration.
 *
 * @description
 * Configures limits for pack negotiation to prevent DoS attacks
 * and resource exhaustion.
 */
export interface NegotiationLimits {
    /** Maximum number of negotiation rounds (default: 50) */
    maxRounds: number;
    /** Maximum number of want lines per request (default: 1000) */
    maxWants: number;
    /** Maximum total number of have lines (default: 10000) */
    maxHaves: number;
    /** Timeout in milliseconds for entire negotiation (default: 120000) */
    timeout: number;
    /** Maximum capabilities count (default: 100) */
    maxCapabilities: number;
    /** Maximum ref name length (default: 4096) */
    maxRefLength: number;
}
/**
 * Negotiation context tracking state across rounds.
 */
export interface NegotiationContext {
    /** Repository identifier for logging */
    repoId: string;
    /** Configured limits */
    limits: NegotiationLimits;
    /** Current negotiation round number */
    round: number;
    /** Total wants seen */
    totalWants: number;
    /** Total haves seen */
    totalHaves: number;
    /** Negotiation start timestamp */
    startTime: number;
    /** Whether negotiation has completed */
    completed: boolean;
    /** Whether negotiation was aborted */
    aborted: boolean;
    /** Abort reason if aborted */
    abortReason?: string;
}
/**
 * Validation result for hardening checks.
 *
 * Note: This uses 'valid' (boolean) instead of 'isValid' to match the
 * pattern used throughout the wire protocol module. It also includes
 * an error code for programmatic handling.
 */
export interface HardeningValidationResult {
    /** Whether validation passed */
    valid: boolean;
    /** Error message if validation failed */
    error?: string;
    /** Error code for programmatic handling */
    code?: string;
}
/** @deprecated Use HardeningValidationResult */
export type ValidationResult = HardeningValidationResult;
/**
 * Rate limiter configuration.
 */
export interface RateLimiterConfig {
    /** Maximum requests per window */
    maxRequests: number;
    /** Window size in milliseconds */
    windowMs: number;
    /** Key extractor function (e.g., extract client IP) */
    keyExtractor: (request: RateLimitRequest) => string;
}
/**
 * Rate limit request context.
 */
export interface RateLimitRequest {
    /** Client IP address */
    ip?: string;
    /** Repository identifier */
    repoId?: string;
    /** User identifier */
    userId?: string;
    /** Request headers */
    headers?: Record<string, string>;
}
/**
 * Rate limit result.
 */
export interface RateLimitResult {
    /** Whether the request is allowed */
    allowed: boolean;
    /** Remaining requests in current window */
    remaining: number;
    /** When the window resets (Unix timestamp) */
    resetAt: number;
    /** Retry after seconds (if not allowed) */
    retryAfter?: number;
}
/**
 * Rate limiter interface for production deployments.
 */
export interface RateLimiter {
    /** Check if request is allowed */
    check(request: RateLimitRequest): Promise<RateLimitResult>;
    /** Record a request (increment counter) */
    record(request: RateLimitRequest): Promise<void>;
    /** Reset rate limit for a key */
    reset(key: string): Promise<void>;
}
/**
 * Malformed packet error.
 */
export declare class MalformedPacketError extends WireError {
    constructor(message: string, code?: string, packet?: Uint8Array);
}
/**
 * Negotiation limit exceeded error.
 */
export declare class NegotiationLimitError extends WireError {
    readonly limit: string;
    readonly value: number;
    readonly max: number;
    constructor(message: string, code: string, limit: string, value: number, max: number);
}
/**
 * Timeout error.
 */
export declare class NegotiationTimeoutError extends WireError {
    readonly elapsed: number;
    readonly timeout: number;
    constructor(elapsed: number, timeout: number);
}
/**
 * Get default negotiation limits.
 *
 * @returns Default NegotiationLimits
 */
export declare function getDefaultLimits(): NegotiationLimits;
/**
 * Create a new negotiation context.
 *
 * @param repoId - Repository identifier
 * @param limits - Optional custom limits
 * @returns New negotiation context
 *
 * @example
 * ```typescript
 * const ctx = createNegotiationContext('my-repo', {
 *   maxRounds: 100,
 *   timeout: 300000,
 * })
 * ```
 */
export declare function createNegotiationContext(repoId: string, limits?: Partial<NegotiationLimits>): NegotiationContext;
/**
 * Check and increment negotiation round.
 *
 * @param ctx - Negotiation context
 * @returns Validation result
 *
 * @throws {NegotiationLimitError} If max rounds exceeded
 * @throws {NegotiationTimeoutError} If timeout exceeded
 */
export declare function validateNegotiationRound(ctx: NegotiationContext): ValidationResult;
/**
 * Record wants in negotiation context.
 *
 * @param ctx - Negotiation context
 * @param count - Number of wants to record
 * @returns Validation result
 */
export declare function recordWants(ctx: NegotiationContext, count: number): ValidationResult;
/**
 * Record haves in negotiation context.
 *
 * @param ctx - Negotiation context
 * @param count - Number of haves to record
 * @returns Validation result
 */
export declare function recordHaves(ctx: NegotiationContext, count: number): ValidationResult;
/**
 * Check if negotiation has timed out.
 *
 * @param ctx - Negotiation context
 * @returns true if timed out
 */
export declare function isTimedOut(ctx: NegotiationContext): boolean;
/**
 * Get remaining time in negotiation.
 *
 * @param ctx - Negotiation context
 * @returns Remaining time in milliseconds (0 if timed out)
 */
export declare function getRemainingTime(ctx: NegotiationContext): number;
/**
 * Complete the negotiation successfully.
 *
 * @param ctx - Negotiation context
 */
export declare function completeNegotiation(ctx: NegotiationContext): void;
/**
 * Abort the negotiation.
 *
 * @param ctx - Negotiation context
 * @param reason - Reason for abortion
 */
export declare function abortNegotiation(ctx: NegotiationContext, reason: string): void;
/**
 * Validate a SHA-1 hash string.
 *
 * @param sha - SHA string to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateSha('abc123...') // 40 hex chars
 * if (!result.valid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export declare function validateSha(sha: string): ValidationResult;
/**
 * Validate an array of SHA strings.
 *
 * @param shas - Array of SHA strings
 * @returns Validation result with index of first invalid SHA
 */
export declare function validateShas(shas: string[]): ValidationResult & {
    invalidIndex?: number;
};
/**
 * Validate capabilities for upload-pack.
 *
 * @param capabilities - Capability strings to validate
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const caps = ['thin-pack', 'side-band-64k', 'agent=git/2.30.0']
 * const result = validateCapabilities(caps, { type: 'upload-pack' })
 * if (!result.valid) {
 *   console.warn('Unknown capabilities:', result.unknownCapabilities)
 * }
 * ```
 */
export declare function validateCapabilities(capabilities: string[], options: {
    type: 'upload-pack' | 'receive-pack';
    strict?: boolean;
    maxCount?: number;
}): ValidationResult & {
    unknownCapabilities?: string[];
};
/**
 * Validate a ref name with length limits.
 *
 * @param refName - Ref name to validate
 * @param maxLength - Maximum allowed length (default: 4096)
 * @returns Validation result
 */
export declare function validateRefNameLength(refName: string, maxLength?: number): ValidationResult;
/**
 * Validate a pkt-line packet.
 *
 * @param packet - Raw packet bytes
 * @returns Validation result
 */
export declare function validatePacket(packet: Uint8Array): ValidationResult;
/**
 * Safely parse a want line with validation.
 *
 * @param line - Want line string
 * @returns Parsed want or error
 *
 * @description
 * Git want lines can have capabilities in two formats:
 * 1. NUL-separated: "want <sha>\0cap1 cap2 cap3"
 * 2. Space-separated (first want line): "want <sha> cap1 cap2 cap3"
 */
export declare function safeParseWantLine(line: string): {
    valid: true;
    sha: string;
    capabilities: string[];
} | {
    valid: false;
    error: string;
    code: string;
};
/**
 * Safely parse a have line with validation.
 *
 * @param line - Have line string
 * @returns Parsed have or error
 */
export declare function safeParseHaveLine(line: string): {
    valid: true;
    sha: string;
} | {
    valid: false;
    error: string;
    code: string;
};
/**
 * Create a timeout-wrapped promise.
 *
 * @param promise - Promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Custom error message
 * @returns Promise that rejects on timeout
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   processNegotiation(request),
 *   30000,
 *   'Negotiation timed out'
 * )
 * ```
 */
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage?: string): Promise<T>;
/**
 * Create a deadline-based timeout checker.
 *
 * @param deadlineMs - Deadline timestamp in milliseconds
 * @returns Function that throws if deadline exceeded
 *
 * @example
 * ```typescript
 * const checkDeadline = createDeadlineChecker(Date.now() + 30000)
 *
 * for (const item of items) {
 *   checkDeadline() // Throws if past deadline
 *   await processItem(item)
 * }
 * ```
 */
export declare function createDeadlineChecker(deadlineMs: number): () => void;
/**
 * Create an in-memory rate limiter.
 *
 * @description
 * Creates a simple in-memory rate limiter for development/testing.
 * For production, use a distributed rate limiter (Redis, Durable Objects, etc).
 *
 * @param config - Rate limiter configuration
 * @returns Rate limiter instance
 *
 * @example
 * ```typescript
 * const limiter = createInMemoryRateLimiter({
 *   maxRequests: 100,
 *   windowMs: 60000,
 *   keyExtractor: (req) => req.ip || 'unknown',
 * })
 *
 * const result = await limiter.check({ ip: '192.168.1.1' })
 * if (!result.allowed) {
 *   return new Response('Rate limited', {
 *     status: 429,
 *     headers: { 'Retry-After': String(result.retryAfter) },
 *   })
 * }
 * ```
 */
export declare function createInMemoryRateLimiter(config: RateLimiterConfig): RateLimiter;
/**
 * Rate limiter middleware hook interface.
 *
 * @description
 * Integration point for production rate limiting. Implement this interface
 * to integrate with your rate limiting infrastructure.
 */
export interface RateLimiterHook {
    /** Called before processing a request */
    beforeRequest(request: RateLimitRequest): Promise<RateLimitResult>;
    /** Called after processing a request */
    afterRequest(request: RateLimitRequest): Promise<void>;
}
/**
 * Create a noop rate limiter hook (allows all requests).
 *
 * @returns Noop rate limiter hook
 */
export declare function createNoopRateLimiterHook(): RateLimiterHook;
/**
 * Create a rate limiter hook from a RateLimiter instance.
 *
 * @param limiter - Rate limiter instance
 * @returns Rate limiter hook
 */
export declare function createRateLimiterHook(limiter: RateLimiter): RateLimiterHook;
/**
 * Wrap a handler with graceful error recovery.
 *
 * @param handler - Handler function
 * @param onError - Error handler function
 * @returns Wrapped handler
 */
export declare function withErrorRecovery<T, R>(handler: (input: T) => Promise<R>, onError: (error: Error, input: T) => R | Promise<R>): (input: T) => Promise<R>;
/**
 * Create a graceful error response for pack negotiation errors.
 *
 * @param error - The error that occurred
 * @param useSideBand - Whether to use side-band error channel
 * @returns Error response bytes
 */
export declare function createErrorResponse(error: Error, useSideBand?: boolean): Uint8Array;
//# sourceMappingURL=hardening.d.ts.map