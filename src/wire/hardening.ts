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

import { WireError } from '../errors'

// ============================================================================
// Constants
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** SHA-1 hex pattern for validation */
const SHA1_REGEX = /^[0-9a-f]{40}$/i

/** SHA-256 hex pattern for validation */
const SHA256_REGEX = /^[0-9a-f]{64}$/i

/** Maximum valid pkt-line length */
const MAX_PKT_LINE_LENGTH = 65520

/** Default maximum negotiation rounds */
const DEFAULT_MAX_ROUNDS = 50

/** Default maximum wants per request */
const DEFAULT_MAX_WANTS = 1000

/** Default maximum haves per negotiation */
const DEFAULT_MAX_HAVES = 10000

/** Default timeout in milliseconds (2 minutes) */
const DEFAULT_TIMEOUT_MS = 120000

/** Default maximum capabilities count */
const DEFAULT_MAX_CAPABILITIES = 100

/** Default maximum ref name length */
const DEFAULT_MAX_REF_LENGTH = 4096

/** Known valid Git capabilities for upload-pack */
const VALID_UPLOAD_PACK_CAPABILITIES = new Set([
  'multi_ack',
  'multi_ack_detailed',
  'thin-pack',
  'side-band',
  'side-band-64k',
  'ofs-delta',
  'shallow',
  'deepen-since',
  'deepen-not',
  'deepen-relative',
  'no-progress',
  'include-tag',
  'allow-tip-sha1-in-want',
  'allow-reachable-sha1-in-want',
  'filter',
  'agent',
  'symref',
  'object-format',
  'session-id',
  'wait-for-done',
])

/** Known valid Git capabilities for receive-pack */
const VALID_RECEIVE_PACK_CAPABILITIES = new Set([
  'report-status',
  'report-status-v2',
  'delete-refs',
  'quiet',
  'atomic',
  'push-options',
  'side-band-64k',
  'push-cert',
  'agent',
  'object-format',
])

// ============================================================================
// Types
// ============================================================================

/**
 * Negotiation limits configuration.
 *
 * @description
 * Configures limits for pack negotiation to prevent DoS attacks
 * and resource exhaustion.
 */
export interface NegotiationLimits {
  /** Maximum number of negotiation rounds (default: 50) */
  maxRounds: number
  /** Maximum number of want lines per request (default: 1000) */
  maxWants: number
  /** Maximum total number of have lines (default: 10000) */
  maxHaves: number
  /** Timeout in milliseconds for entire negotiation (default: 120000) */
  timeout: number
  /** Maximum capabilities count (default: 100) */
  maxCapabilities: number
  /** Maximum ref name length (default: 4096) */
  maxRefLength: number
}

/**
 * Negotiation context tracking state across rounds.
 */
export interface NegotiationContext {
  /** Repository identifier for logging */
  repoId: string
  /** Configured limits */
  limits: NegotiationLimits
  /** Current negotiation round number */
  round: number
  /** Total wants seen */
  totalWants: number
  /** Total haves seen */
  totalHaves: number
  /** Negotiation start timestamp */
  startTime: number
  /** Whether negotiation has completed */
  completed: boolean
  /** Whether negotiation was aborted */
  aborted: boolean
  /** Abort reason if aborted */
  abortReason?: string
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
  valid: boolean
  /** Error message if validation failed */
  error?: string
  /** Error code for programmatic handling */
  code?: string
}

/** @deprecated Use HardeningValidationResult */
export type ValidationResult = HardeningValidationResult

/**
 * Rate limiter configuration.
 */
export interface RateLimiterConfig {
  /** Maximum requests per window */
  maxRequests: number
  /** Window size in milliseconds */
  windowMs: number
  /** Key extractor function (e.g., extract client IP) */
  keyExtractor: (request: RateLimitRequest) => string
}

/**
 * Rate limit request context.
 */
export interface RateLimitRequest {
  /** Client IP address */
  ip?: string
  /** Repository identifier */
  repoId?: string
  /** User identifier */
  userId?: string
  /** Request headers */
  headers?: Record<string, string>
}

/**
 * Rate limit result.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in current window */
  remaining: number
  /** When the window resets (Unix timestamp) */
  resetAt: number
  /** Retry after seconds (if not allowed) */
  retryAfter?: number
}

/**
 * Rate limiter interface for production deployments.
 */
export interface RateLimiter {
  /** Check if request is allowed */
  check(request: RateLimitRequest): Promise<RateLimitResult>
  /** Record a request (increment counter) */
  record(request: RateLimitRequest): Promise<void>
  /** Reset rate limit for a key */
  reset(key: string): Promise<void>
}

/**
 * Malformed packet error.
 */
export class MalformedPacketError extends WireError {
  constructor(message: string, code: string = 'MALFORMED_PACKET', packet?: Uint8Array) {
    super(message, code as any, { packet })
    this.name = 'MalformedPacketError'
  }
}

/**
 * Negotiation limit exceeded error.
 */
export class NegotiationLimitError extends WireError {
  readonly limit: string
  readonly value: number
  readonly max: number

  constructor(message: string, code: string, limit: string, value: number, max: number) {
    super(message, code as any)
    this.name = 'NegotiationLimitError'
    this.limit = limit
    this.value = value
    this.max = max
  }
}

/**
 * Timeout error.
 */
export class NegotiationTimeoutError extends WireError {
  readonly elapsed: number
  readonly timeout: number

  constructor(elapsed: number, timeout: number) {
    super(`Negotiation timeout: ${elapsed}ms exceeded ${timeout}ms limit`, 'NEGOTIATION_TIMEOUT' as any)
    this.name = 'NegotiationTimeoutError'
    this.elapsed = elapsed
    this.timeout = timeout
  }
}

// ============================================================================
// Default Limits
// ============================================================================

/**
 * Get default negotiation limits.
 *
 * @returns Default NegotiationLimits
 */
export function getDefaultLimits(): NegotiationLimits {
  return {
    maxRounds: DEFAULT_MAX_ROUNDS,
    maxWants: DEFAULT_MAX_WANTS,
    maxHaves: DEFAULT_MAX_HAVES,
    timeout: DEFAULT_TIMEOUT_MS,
    maxCapabilities: DEFAULT_MAX_CAPABILITIES,
    maxRefLength: DEFAULT_MAX_REF_LENGTH,
  }
}

// ============================================================================
// Negotiation Context
// ============================================================================

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
export function createNegotiationContext(
  repoId: string,
  limits?: Partial<NegotiationLimits>
): NegotiationContext {
  return {
    repoId,
    limits: { ...getDefaultLimits(), ...limits },
    round: 0,
    totalWants: 0,
    totalHaves: 0,
    startTime: Date.now(),
    completed: false,
    aborted: false,
  }
}

/**
 * Check and increment negotiation round.
 *
 * @param ctx - Negotiation context
 * @returns Validation result
 *
 * @throws {NegotiationLimitError} If max rounds exceeded
 * @throws {NegotiationTimeoutError} If timeout exceeded
 */
export function validateNegotiationRound(ctx: NegotiationContext): ValidationResult {
  // Check if already aborted or completed
  if (ctx.aborted) {
    return { valid: false, error: ctx.abortReason || 'Negotiation aborted', code: 'ABORTED' }
  }

  if (ctx.completed) {
    return { valid: false, error: 'Negotiation already completed', code: 'COMPLETED' }
  }

  // Check timeout
  const elapsed = Date.now() - ctx.startTime
  if (elapsed > ctx.limits.timeout) {
    ctx.aborted = true
    ctx.abortReason = `Timeout exceeded: ${elapsed}ms > ${ctx.limits.timeout}ms`
    return {
      valid: false,
      error: ctx.abortReason,
      code: 'TIMEOUT',
    }
  }

  // Check round limit
  ctx.round++
  if (ctx.round > ctx.limits.maxRounds) {
    ctx.aborted = true
    ctx.abortReason = `Max rounds exceeded: ${ctx.round} > ${ctx.limits.maxRounds}`
    return {
      valid: false,
      error: ctx.abortReason,
      code: 'MAX_ROUNDS_EXCEEDED',
    }
  }

  return { valid: true }
}

/**
 * Record wants in negotiation context.
 *
 * @param ctx - Negotiation context
 * @param count - Number of wants to record
 * @returns Validation result
 */
export function recordWants(ctx: NegotiationContext, count: number): ValidationResult {
  ctx.totalWants += count

  if (ctx.totalWants > ctx.limits.maxWants) {
    ctx.aborted = true
    ctx.abortReason = `Max wants exceeded: ${ctx.totalWants} > ${ctx.limits.maxWants}`
    return {
      valid: false,
      error: ctx.abortReason,
      code: 'MAX_WANTS_EXCEEDED',
    }
  }

  return { valid: true }
}

/**
 * Record haves in negotiation context.
 *
 * @param ctx - Negotiation context
 * @param count - Number of haves to record
 * @returns Validation result
 */
export function recordHaves(ctx: NegotiationContext, count: number): ValidationResult {
  ctx.totalHaves += count

  if (ctx.totalHaves > ctx.limits.maxHaves) {
    ctx.aborted = true
    ctx.abortReason = `Max haves exceeded: ${ctx.totalHaves} > ${ctx.limits.maxHaves}`
    return {
      valid: false,
      error: ctx.abortReason,
      code: 'MAX_HAVES_EXCEEDED',
    }
  }

  return { valid: true }
}

/**
 * Check if negotiation has timed out.
 *
 * @param ctx - Negotiation context
 * @returns true if timed out
 */
export function isTimedOut(ctx: NegotiationContext): boolean {
  return Date.now() - ctx.startTime > ctx.limits.timeout
}

/**
 * Get remaining time in negotiation.
 *
 * @param ctx - Negotiation context
 * @returns Remaining time in milliseconds (0 if timed out)
 */
export function getRemainingTime(ctx: NegotiationContext): number {
  const elapsed = Date.now() - ctx.startTime
  return Math.max(0, ctx.limits.timeout - elapsed)
}

/**
 * Complete the negotiation successfully.
 *
 * @param ctx - Negotiation context
 */
export function completeNegotiation(ctx: NegotiationContext): void {
  ctx.completed = true
}

/**
 * Abort the negotiation.
 *
 * @param ctx - Negotiation context
 * @param reason - Reason for abortion
 */
export function abortNegotiation(ctx: NegotiationContext, reason: string): void {
  ctx.aborted = true
  ctx.abortReason = reason
}

// ============================================================================
// SHA Validation
// ============================================================================

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
export function validateSha(sha: string): ValidationResult {
  if (typeof sha !== 'string') {
    return { valid: false, error: 'SHA must be a string', code: 'INVALID_TYPE' }
  }

  if (sha.length === 0) {
    return { valid: false, error: 'SHA cannot be empty', code: 'EMPTY_SHA' }
  }

  // Check for SHA-1 (40 chars)
  if (sha.length === 40) {
    if (SHA1_REGEX.test(sha)) {
      return { valid: true }
    }
    return { valid: false, error: 'Invalid SHA-1 format: must be 40 hex characters', code: 'INVALID_SHA1' }
  }

  // Check for SHA-256 (64 chars)
  if (sha.length === 64) {
    if (SHA256_REGEX.test(sha)) {
      return { valid: true }
    }
    return { valid: false, error: 'Invalid SHA-256 format: must be 64 hex characters', code: 'INVALID_SHA256' }
  }

  return {
    valid: false,
    error: `Invalid SHA length: ${sha.length} (expected 40 or 64)`,
    code: 'INVALID_SHA_LENGTH',
  }
}

/**
 * Validate an array of SHA strings.
 *
 * @param shas - Array of SHA strings
 * @returns Validation result with index of first invalid SHA
 */
export function validateShas(shas: string[]): ValidationResult & { invalidIndex?: number } {
  for (let i = 0; i < shas.length; i++) {
    const sha = shas[i]
    if (!sha) {
      return { valid: false, error: 'Empty SHA at index ' + i, code: 'EMPTY_SHA', invalidIndex: i }
    }
    const result = validateSha(sha)
    if (!result.valid) {
      return { ...result, invalidIndex: i }
    }
  }
  return { valid: true }
}

// ============================================================================
// Capability Validation
// ============================================================================

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
export function validateCapabilities(
  capabilities: string[],
  options: {
    type: 'upload-pack' | 'receive-pack'
    strict?: boolean
    maxCount?: number
  }
): ValidationResult & { unknownCapabilities?: string[] } {
  const maxCount = options.maxCount ?? DEFAULT_MAX_CAPABILITIES

  // Check count limit
  if (capabilities.length > maxCount) {
    return {
      valid: false,
      error: `Too many capabilities: ${capabilities.length} > ${maxCount}`,
      code: 'TOO_MANY_CAPABILITIES',
    }
  }

  const validCaps = options.type === 'upload-pack'
    ? VALID_UPLOAD_PACK_CAPABILITIES
    : VALID_RECEIVE_PACK_CAPABILITIES

  const unknown: string[] = []

  for (const cap of capabilities) {
    // Check for dangerous characters
    if (cap.includes('\x00') || cap.includes('\n') || cap.includes('\r')) {
      return {
        valid: false,
        error: `Capability contains dangerous characters: ${cap.slice(0, 50)}`,
        code: 'DANGEROUS_CAPABILITY',
      }
    }

    // Extract capability name (before =)
    const eqIndex = cap.indexOf('=')
    const capName = eqIndex === -1 ? cap : cap.slice(0, eqIndex)

    // Validate capability name characters
    if (!/^[a-z0-9_-]+$/i.test(capName)) {
      return {
        valid: false,
        error: `Invalid capability name: ${capName}`,
        code: 'INVALID_CAPABILITY_NAME',
      }
    }

    // Check if known capability
    if (!validCaps.has(capName)) {
      unknown.push(capName)
    }
  }

  // In strict mode, reject unknown capabilities
  if (options.strict && unknown.length > 0) {
    return {
      valid: false,
      error: `Unknown capabilities: ${unknown.join(', ')}`,
      code: 'UNKNOWN_CAPABILITIES',
      unknownCapabilities: unknown,
    }
  }

  // In non-strict mode, just report unknown capabilities
  const result: ValidationResult & { unknownCapabilities?: string[] } = { valid: true }
  if (unknown.length > 0) {
    result.unknownCapabilities = unknown
  }
  return result
}

// ============================================================================
// Ref Name Validation
// ============================================================================

/**
 * Validate a ref name with length limits.
 *
 * @param refName - Ref name to validate
 * @param maxLength - Maximum allowed length (default: 4096)
 * @returns Validation result
 */
export function validateRefNameLength(
  refName: string,
  maxLength: number = DEFAULT_MAX_REF_LENGTH
): ValidationResult {
  if (refName.length > maxLength) {
    return {
      valid: false,
      error: `Ref name too long: ${refName.length} > ${maxLength}`,
      code: 'REF_NAME_TOO_LONG',
    }
  }
  return { valid: true }
}

// ============================================================================
// Packet Validation
// ============================================================================

/**
 * Validate a pkt-line packet.
 *
 * @param packet - Raw packet bytes
 * @returns Validation result
 */
export function validatePacket(packet: Uint8Array): ValidationResult {
  // Check minimum length for length prefix
  if (packet.length < 4) {
    return {
      valid: false,
      error: 'Packet too short: missing length prefix',
      code: 'PACKET_TOO_SHORT',
    }
  }

  // Decode length prefix
  const hexLength = decoder.decode(packet.slice(0, 4))

  // Check for special packets
  if (hexLength === '0000' || hexLength === '0001' || hexLength === '0002') {
    return { valid: true }
  }

  // Validate hex format
  if (!/^[0-9a-fA-F]{4}$/.test(hexLength)) {
    return {
      valid: false,
      error: `Invalid length prefix: ${hexLength}`,
      code: 'INVALID_LENGTH_PREFIX',
    }
  }

  const length = parseInt(hexLength, 16)

  // Validate length value
  if (length < 4) {
    return {
      valid: false,
      error: `Invalid length value: ${length}`,
      code: 'INVALID_LENGTH_VALUE',
    }
  }

  if (length > MAX_PKT_LINE_LENGTH) {
    return {
      valid: false,
      error: `Packet too large: ${length} > ${MAX_PKT_LINE_LENGTH}`,
      code: 'PACKET_TOO_LARGE',
    }
  }

  // Check actual packet length matches declared length
  if (packet.length < length) {
    return {
      valid: false,
      error: `Packet truncated: expected ${length}, got ${packet.length}`,
      code: 'PACKET_TRUNCATED',
    }
  }

  return { valid: true }
}

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
export function safeParseWantLine(
  line: string
): { valid: true; sha: string; capabilities: string[] } | { valid: false; error: string; code: string } {
  // Check for null bytes (NUL-separated capabilities)
  if (line.includes('\x00')) {
    // Split capabilities
    const nullIndex = line.indexOf('\x00')
    const wantPart = line.slice(0, nullIndex)
    const capsPart = line.slice(nullIndex + 1)

    // Parse want part
    const wantResult = parseWantPart(wantPart)
    if (!wantResult.valid) {
      return wantResult
    }

    // Parse capabilities from after NUL
    const caps = capsPart.trim().split(/\s+/).filter(c => c.length > 0)

    return { valid: true, sha: wantResult.sha, capabilities: caps }
  }

  // No NUL byte - capabilities might be space-separated after SHA
  const result = parseWantPartWithCaps(line)
  if (!result.valid) {
    return result
  }

  return { valid: true, sha: result.sha, capabilities: result.capabilities }
}

function parseWantPart(
  part: string
): { valid: true; sha: string } | { valid: false; error: string; code: string } {
  const trimmed = part.trim()

  if (!trimmed.startsWith('want ')) {
    return { valid: false, error: 'Want line must start with "want "', code: 'INVALID_WANT_PREFIX' }
  }

  const rest = trimmed.slice(5).trim()
  const parts = rest.split(/\s+/)
  const sha = parts[0]

  if (!sha) {
    return { valid: false, error: 'Want line must contain SHA', code: 'MISSING_SHA' }
  }

  const shaResult = validateSha(sha)
  if (!shaResult.valid) {
    return { valid: false, error: shaResult.error ?? 'Invalid SHA', code: shaResult.code ?? 'INVALID_SHA' }
  }

  return { valid: true, sha: sha.toLowerCase() }
}

function parseWantPartWithCaps(
  part: string
): { valid: true; sha: string; capabilities: string[] } | { valid: false; error: string; code: string } {
  const trimmed = part.trim()

  if (!trimmed.startsWith('want ')) {
    return { valid: false, error: 'Want line must start with "want "', code: 'INVALID_WANT_PREFIX' }
  }

  const rest = trimmed.slice(5).trim()
  const parts = rest.split(/\s+/).filter(p => p.length > 0)

  if (parts.length === 0) {
    return { valid: false, error: 'Want line must contain SHA', code: 'MISSING_SHA' }
  }

  const sha = parts[0]!

  const shaResult = validateSha(sha)
  if (!shaResult.valid) {
    return { valid: false, error: shaResult.error ?? 'Invalid SHA', code: shaResult.code ?? 'INVALID_SHA' }
  }

  // Everything after SHA is capabilities
  const capabilities = parts.slice(1)

  return { valid: true, sha: sha.toLowerCase(), capabilities }
}

/**
 * Safely parse a have line with validation.
 *
 * @param line - Have line string
 * @returns Parsed have or error
 */
export function safeParseHaveLine(
  line: string
): { valid: true; sha: string } | { valid: false; error: string; code: string } {
  const trimmed = line.trim()

  if (!trimmed.startsWith('have ')) {
    return { valid: false, error: 'Have line must start with "have "', code: 'INVALID_HAVE_PREFIX' }
  }

  const sha = trimmed.slice(5).trim()

  const shaResult = validateSha(sha)
  if (!shaResult.valid) {
    return { valid: false, error: shaResult.error!, code: shaResult.code! }
  }

  return { valid: true, sha: sha.toLowerCase() }
}

// ============================================================================
// Timeout Handling
// ============================================================================

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
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  _errorMessage?: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new NegotiationTimeoutError(timeoutMs, timeoutMs))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

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
export function createDeadlineChecker(deadlineMs: number): () => void {
  return () => {
    const now = Date.now()
    if (now > deadlineMs) {
      throw new NegotiationTimeoutError(now - (deadlineMs - DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS)
    }
  }
}

// ============================================================================
// Rate Limiting
// ============================================================================

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
export function createInMemoryRateLimiter(config: RateLimiterConfig): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>()

  return {
    async check(request: RateLimitRequest): Promise<RateLimitResult> {
      const key = config.keyExtractor(request)
      const now = Date.now()

      let window = windows.get(key)

      // Create new window if none exists or window expired
      if (!window || now > window.resetAt) {
        window = { count: 0, resetAt: now + config.windowMs }
        windows.set(key, window)
      }

      const remaining = Math.max(0, config.maxRequests - window.count)
      const allowed = window.count < config.maxRequests

      const result: RateLimitResult = {
        allowed,
        remaining,
        resetAt: window.resetAt,
      }
      if (!allowed) {
        result.retryAfter = Math.ceil((window.resetAt - now) / 1000)
      }
      return result
    },

    async record(request: RateLimitRequest): Promise<void> {
      const key = config.keyExtractor(request)
      const now = Date.now()

      let window = windows.get(key)

      if (!window || now > window.resetAt) {
        window = { count: 0, resetAt: now + config.windowMs }
        windows.set(key, window)
      }

      window.count++
    },

    async reset(key: string): Promise<void> {
      windows.delete(key)
    },
  }
}

/**
 * Rate limiter middleware hook interface.
 *
 * @description
 * Integration point for production rate limiting. Implement this interface
 * to integrate with your rate limiting infrastructure.
 */
export interface RateLimiterHook {
  /** Called before processing a request */
  beforeRequest(request: RateLimitRequest): Promise<RateLimitResult>
  /** Called after processing a request */
  afterRequest(request: RateLimitRequest): Promise<void>
}

/**
 * Create a noop rate limiter hook (allows all requests).
 *
 * @returns Noop rate limiter hook
 */
export function createNoopRateLimiterHook(): RateLimiterHook {
  return {
    async beforeRequest(): Promise<RateLimitResult> {
      return { allowed: true, remaining: Infinity, resetAt: Infinity }
    },
    async afterRequest(): Promise<void> {
      // No-op
    },
  }
}

/**
 * Create a rate limiter hook from a RateLimiter instance.
 *
 * @param limiter - Rate limiter instance
 * @returns Rate limiter hook
 */
export function createRateLimiterHook(limiter: RateLimiter): RateLimiterHook {
  return {
    async beforeRequest(request: RateLimitRequest): Promise<RateLimitResult> {
      const result = await limiter.check(request)
      if (result.allowed) {
        await limiter.record(request)
      }
      return result
    },
    async afterRequest(): Promise<void> {
      // Request already recorded in beforeRequest
    },
  }
}

// ============================================================================
// Error Recovery
// ============================================================================

/**
 * Wrap a handler with graceful error recovery.
 *
 * @param handler - Handler function
 * @param onError - Error handler function
 * @returns Wrapped handler
 */
export function withErrorRecovery<T, R>(
  handler: (input: T) => Promise<R>,
  onError: (error: Error, input: T) => R | Promise<R>
): (input: T) => Promise<R> {
  return async (input: T): Promise<R> => {
    try {
      return await handler(input)
    } catch (error) {
      if (error instanceof Error) {
        return onError(error, input)
      }
      return onError(new Error(String(error)), input)
    }
  }
}

/**
 * Create a graceful error response for pack negotiation errors.
 *
 * @param error - The error that occurred
 * @param useSideBand - Whether to use side-band error channel
 * @returns Error response bytes
 */
export function createErrorResponse(error: Error, useSideBand: boolean = false): Uint8Array {
  let message = 'ERR '

  if (error instanceof NegotiationLimitError) {
    message += `Limit exceeded: ${error.message}`
  } else if (error instanceof NegotiationTimeoutError) {
    message += `Timeout: ${error.message}`
  } else if (error instanceof MalformedPacketError) {
    message += `Malformed packet: ${error.message}`
  } else {
    message += `Server error: ${error.message}`
  }

  message += '\n'

  if (useSideBand) {
    // Side-band channel 3 for errors
    const data = encoder.encode(message)
    const totalLength = 4 + 1 + data.length
    const hexLength = totalLength.toString(16).padStart(4, '0')
    const result = new Uint8Array(totalLength)
    result.set(encoder.encode(hexLength), 0)
    result[4] = 3 // Error channel
    result.set(data, 5)
    return result
  }

  // Simple pkt-line error
  const totalLength = 4 + message.length
  const hexLength = totalLength.toString(16).padStart(4, '0')
  return encoder.encode(hexLength + message)
}
