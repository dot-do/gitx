import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  // Negotiation limits and context
  getDefaultLimits,
  createNegotiationContext,
  validateNegotiationRound,
  recordWants,
  recordHaves,
  isTimedOut,
  getRemainingTime,
  completeNegotiation,
  abortNegotiation,
  // Validation
  validateSha,
  validateShas,
  validateCapabilities,
  validateRefNameLength,
  validatePacket,
  safeParseWantLine,
  safeParseHaveLine,
  // Timeout handling
  withTimeout,
  createDeadlineChecker,
  // Rate limiting
  createInMemoryRateLimiter,
  createNoopRateLimiterHook,
  createRateLimiterHook,
  // Error recovery
  withErrorRecovery,
  createErrorResponse,
  // Error classes
  MalformedPacketError,
  NegotiationLimitError,
  NegotiationTimeoutError,
  // Types
  type NegotiationLimits,
  type NegotiationContext,
  type RateLimitRequest,
} from '../../src/wire/hardening'

// Helper constants
const VALID_SHA1 = 'a'.repeat(40)
const VALID_SHA256 = 'b'.repeat(64)
const ZERO_SHA = '0'.repeat(40)

describe('Production Hardening', () => {
  // ==========================================================================
  // 1. Negotiation Limits
  // ==========================================================================
  describe('Negotiation Limits', () => {
    describe('getDefaultLimits', () => {
      it('should return sensible defaults', () => {
        const limits = getDefaultLimits()

        expect(limits.maxRounds).toBe(50)
        expect(limits.maxWants).toBe(1000)
        expect(limits.maxHaves).toBe(10000)
        expect(limits.timeout).toBe(120000)
        expect(limits.maxCapabilities).toBe(100)
        expect(limits.maxRefLength).toBe(4096)
      })
    })

    describe('createNegotiationContext', () => {
      it('should create context with default limits', () => {
        const ctx = createNegotiationContext('test-repo')

        expect(ctx.repoId).toBe('test-repo')
        expect(ctx.limits).toEqual(getDefaultLimits())
        expect(ctx.round).toBe(0)
        expect(ctx.totalWants).toBe(0)
        expect(ctx.totalHaves).toBe(0)
        expect(ctx.completed).toBe(false)
        expect(ctx.aborted).toBe(false)
        expect(ctx.startTime).toBeLessThanOrEqual(Date.now())
      })

      it('should allow custom limits', () => {
        const ctx = createNegotiationContext('test-repo', {
          maxRounds: 100,
          timeout: 300000,
        })

        expect(ctx.limits.maxRounds).toBe(100)
        expect(ctx.limits.timeout).toBe(300000)
        // Other limits should be defaults
        expect(ctx.limits.maxWants).toBe(1000)
      })
    })

    describe('validateNegotiationRound', () => {
      it('should pass for valid round', () => {
        const ctx = createNegotiationContext('test-repo')
        const result = validateNegotiationRound(ctx)

        expect(result.valid).toBe(true)
        expect(ctx.round).toBe(1)
      })

      it('should increment round counter', () => {
        const ctx = createNegotiationContext('test-repo')

        validateNegotiationRound(ctx)
        expect(ctx.round).toBe(1)

        validateNegotiationRound(ctx)
        expect(ctx.round).toBe(2)

        validateNegotiationRound(ctx)
        expect(ctx.round).toBe(3)
      })

      it('should fail when max rounds exceeded', () => {
        const ctx = createNegotiationContext('test-repo', { maxRounds: 3 })

        validateNegotiationRound(ctx) // round 1
        validateNegotiationRound(ctx) // round 2
        validateNegotiationRound(ctx) // round 3
        const result = validateNegotiationRound(ctx) // round 4 - exceeds

        expect(result.valid).toBe(false)
        expect(result.code).toBe('MAX_ROUNDS_EXCEEDED')
        expect(ctx.aborted).toBe(true)
      })

      it('should fail when already aborted', () => {
        const ctx = createNegotiationContext('test-repo')
        abortNegotiation(ctx, 'Test abort')

        const result = validateNegotiationRound(ctx)

        expect(result.valid).toBe(false)
        expect(result.code).toBe('ABORTED')
      })

      it('should fail when already completed', () => {
        const ctx = createNegotiationContext('test-repo')
        completeNegotiation(ctx)

        const result = validateNegotiationRound(ctx)

        expect(result.valid).toBe(false)
        expect(result.code).toBe('COMPLETED')
      })

      it('should fail on timeout', async () => {
        const ctx = createNegotiationContext('test-repo', { timeout: 10 })

        // Wait for timeout
        await new Promise((resolve) => setTimeout(resolve, 20))

        const result = validateNegotiationRound(ctx)

        expect(result.valid).toBe(false)
        expect(result.code).toBe('TIMEOUT')
        expect(ctx.aborted).toBe(true)
      })
    })

    describe('recordWants', () => {
      it('should track want count', () => {
        const ctx = createNegotiationContext('test-repo')

        recordWants(ctx, 5)
        expect(ctx.totalWants).toBe(5)

        recordWants(ctx, 10)
        expect(ctx.totalWants).toBe(15)
      })

      it('should fail when max wants exceeded', () => {
        const ctx = createNegotiationContext('test-repo', { maxWants: 10 })

        const result1 = recordWants(ctx, 5)
        expect(result1.valid).toBe(true)

        const result2 = recordWants(ctx, 10) // Total: 15 > 10
        expect(result2.valid).toBe(false)
        expect(result2.code).toBe('MAX_WANTS_EXCEEDED')
        expect(ctx.aborted).toBe(true)
      })
    })

    describe('recordHaves', () => {
      it('should track have count', () => {
        const ctx = createNegotiationContext('test-repo')

        recordHaves(ctx, 100)
        expect(ctx.totalHaves).toBe(100)

        recordHaves(ctx, 200)
        expect(ctx.totalHaves).toBe(300)
      })

      it('should fail when max haves exceeded', () => {
        const ctx = createNegotiationContext('test-repo', { maxHaves: 100 })

        const result1 = recordHaves(ctx, 50)
        expect(result1.valid).toBe(true)

        const result2 = recordHaves(ctx, 100) // Total: 150 > 100
        expect(result2.valid).toBe(false)
        expect(result2.code).toBe('MAX_HAVES_EXCEEDED')
        expect(ctx.aborted).toBe(true)
      })
    })

    describe('isTimedOut', () => {
      it('should return false before timeout', () => {
        const ctx = createNegotiationContext('test-repo', { timeout: 10000 })
        expect(isTimedOut(ctx)).toBe(false)
      })

      it('should return true after timeout', async () => {
        const ctx = createNegotiationContext('test-repo', { timeout: 10 })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(isTimedOut(ctx)).toBe(true)
      })
    })

    describe('getRemainingTime', () => {
      it('should return remaining time', () => {
        const ctx = createNegotiationContext('test-repo', { timeout: 10000 })
        const remaining = getRemainingTime(ctx)

        expect(remaining).toBeGreaterThan(9900)
        expect(remaining).toBeLessThanOrEqual(10000)
      })

      it('should return 0 after timeout', async () => {
        const ctx = createNegotiationContext('test-repo', { timeout: 10 })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(getRemainingTime(ctx)).toBe(0)
      })
    })
  })

  // ==========================================================================
  // 2. SHA Validation
  // ==========================================================================
  describe('SHA Validation', () => {
    describe('validateSha', () => {
      it('should accept valid SHA-1', () => {
        const result = validateSha(VALID_SHA1)
        expect(result.valid).toBe(true)
      })

      it('should accept valid SHA-256', () => {
        const result = validateSha(VALID_SHA256)
        expect(result.valid).toBe(true)
      })

      it('should accept ZERO_SHA', () => {
        const result = validateSha(ZERO_SHA)
        expect(result.valid).toBe(true)
      })

      it('should accept lowercase hex', () => {
        const result = validateSha('abcdef0123456789abcdef0123456789abcdef01')
        expect(result.valid).toBe(true)
      })

      it('should accept uppercase hex', () => {
        const result = validateSha('ABCDEF0123456789ABCDEF0123456789ABCDEF01')
        expect(result.valid).toBe(true)
      })

      it('should accept mixed case hex', () => {
        const result = validateSha('AbCdEf0123456789AbCdEf0123456789AbCdEf01')
        expect(result.valid).toBe(true)
      })

      it('should reject empty string', () => {
        const result = validateSha('')
        expect(result.valid).toBe(false)
        expect(result.code).toBe('EMPTY_SHA')
      })

      it('should reject non-string', () => {
        const result = validateSha(123 as unknown as string)
        expect(result.valid).toBe(false)
        expect(result.code).toBe('INVALID_TYPE')
      })

      it('should reject wrong length', () => {
        const result = validateSha('abc123')
        expect(result.valid).toBe(false)
        expect(result.code).toBe('INVALID_SHA_LENGTH')
      })

      it('should reject non-hex characters in SHA-1', () => {
        const result = validateSha('g'.repeat(40))
        expect(result.valid).toBe(false)
        expect(result.code).toBe('INVALID_SHA1')
      })

      it('should reject non-hex characters in SHA-256', () => {
        const result = validateSha('g'.repeat(64))
        expect(result.valid).toBe(false)
        expect(result.code).toBe('INVALID_SHA256')
      })
    })

    describe('validateShas', () => {
      it('should validate array of valid SHAs', () => {
        const result = validateShas([VALID_SHA1, ZERO_SHA, 'b'.repeat(40)])
        expect(result.valid).toBe(true)
      })

      it('should return index of first invalid SHA', () => {
        const result = validateShas([VALID_SHA1, 'invalid', ZERO_SHA])
        expect(result.valid).toBe(false)
        expect(result.invalidIndex).toBe(1)
      })

      it('should handle empty array', () => {
        const result = validateShas([])
        expect(result.valid).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 3. Capability Validation
  // ==========================================================================
  describe('Capability Validation', () => {
    describe('validateCapabilities (upload-pack)', () => {
      it('should accept known upload-pack capabilities', () => {
        const result = validateCapabilities(
          ['multi_ack', 'thin-pack', 'side-band-64k', 'shallow'],
          { type: 'upload-pack' }
        )
        expect(result.valid).toBe(true)
        expect(result.unknownCapabilities).toBeUndefined()
      })

      it('should report unknown capabilities in non-strict mode', () => {
        const result = validateCapabilities(
          ['thin-pack', 'custom-cap', 'unknown-feature'],
          { type: 'upload-pack', strict: false }
        )
        expect(result.valid).toBe(true)
        expect(result.unknownCapabilities).toContain('custom-cap')
        expect(result.unknownCapabilities).toContain('unknown-feature')
      })

      it('should reject unknown capabilities in strict mode', () => {
        const result = validateCapabilities(
          ['thin-pack', 'custom-cap'],
          { type: 'upload-pack', strict: true }
        )
        expect(result.valid).toBe(false)
        expect(result.code).toBe('UNKNOWN_CAPABILITIES')
      })

      it('should accept capabilities with values', () => {
        const result = validateCapabilities(
          ['agent=git/2.40.0', 'object-format=sha256'],
          { type: 'upload-pack' }
        )
        expect(result.valid).toBe(true)
      })

      it('should reject capabilities with null bytes', () => {
        const result = validateCapabilities(
          ['thin-pack', 'bad\x00cap'],
          { type: 'upload-pack' }
        )
        expect(result.valid).toBe(false)
        expect(result.code).toBe('DANGEROUS_CAPABILITY')
      })

      it('should reject capabilities with newlines', () => {
        const result = validateCapabilities(
          ['thin-pack', 'bad\ncap'],
          { type: 'upload-pack' }
        )
        expect(result.valid).toBe(false)
        expect(result.code).toBe('DANGEROUS_CAPABILITY')
      })

      it('should reject too many capabilities', () => {
        const caps = Array.from({ length: 200 }, (_, i) => `cap${i}`)
        const result = validateCapabilities(caps, { type: 'upload-pack', maxCount: 100 })
        expect(result.valid).toBe(false)
        expect(result.code).toBe('TOO_MANY_CAPABILITIES')
      })
    })

    describe('validateCapabilities (receive-pack)', () => {
      it('should accept known receive-pack capabilities', () => {
        const result = validateCapabilities(
          ['report-status', 'delete-refs', 'atomic', 'push-options'],
          { type: 'receive-pack' }
        )
        expect(result.valid).toBe(true)
      })

      it('should reject upload-pack-only capabilities as unknown', () => {
        const result = validateCapabilities(
          ['report-status', 'thin-pack'], // thin-pack is upload-pack only
          { type: 'receive-pack', strict: true }
        )
        expect(result.valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // 4. Ref Name Validation
  // ==========================================================================
  describe('Ref Name Validation', () => {
    describe('validateRefNameLength', () => {
      it('should accept ref names within limit', () => {
        const result = validateRefNameLength('refs/heads/main', 4096)
        expect(result.valid).toBe(true)
      })

      it('should reject ref names exceeding limit', () => {
        const longRef = 'refs/heads/' + 'a'.repeat(5000)
        const result = validateRefNameLength(longRef, 4096)
        expect(result.valid).toBe(false)
        expect(result.code).toBe('REF_NAME_TOO_LONG')
      })

      it('should use default max length', () => {
        const result = validateRefNameLength('refs/heads/main')
        expect(result.valid).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 5. Packet Validation
  // ==========================================================================
  describe('Packet Validation', () => {
    const encoder = new TextEncoder()

    describe('validatePacket', () => {
      it('should accept valid data packet', () => {
        const packet = encoder.encode('000ahello\n')
        const result = validatePacket(packet)
        expect(result.valid).toBe(true)
      })

      it('should accept flush packet', () => {
        const packet = encoder.encode('0000')
        const result = validatePacket(packet)
        expect(result.valid).toBe(true)
      })

      it('should accept delim packet', () => {
        const packet = encoder.encode('0001')
        const result = validatePacket(packet)
        expect(result.valid).toBe(true)
      })

      it('should accept response-end packet', () => {
        const packet = encoder.encode('0002')
        const result = validatePacket(packet)
        expect(result.valid).toBe(true)
      })

      it('should reject packet shorter than length prefix', () => {
        const packet = encoder.encode('00')
        const result = validatePacket(packet)
        expect(result.valid).toBe(false)
        expect(result.code).toBe('PACKET_TOO_SHORT')
      })

      it('should reject invalid length prefix', () => {
        const packet = encoder.encode('gggg')
        const result = validatePacket(packet)
        expect(result.valid).toBe(false)
        expect(result.code).toBe('INVALID_LENGTH_PREFIX')
      })

      it('should reject packet with length < 4', () => {
        const packet = encoder.encode('0003')
        const result = validatePacket(packet)
        expect(result.valid).toBe(false)
        expect(result.code).toBe('INVALID_LENGTH_VALUE')
      })

      it('should reject oversized packet', () => {
        // 65521 in hex is 0000fff1
        const packet = encoder.encode('fff1' + 'x'.repeat(65517))
        const result = validatePacket(packet)
        expect(result.valid).toBe(false)
        expect(result.code).toBe('PACKET_TOO_LARGE')
      })

      it('should reject truncated packet', () => {
        // Says length is 10 but only 5 bytes present
        const packet = encoder.encode('000ahell')
        const result = validatePacket(packet)
        expect(result.valid).toBe(false)
        expect(result.code).toBe('PACKET_TRUNCATED')
      })
    })

    describe('safeParseWantLine', () => {
      it('should parse valid want line', () => {
        const result = safeParseWantLine(`want ${VALID_SHA1}`)
        expect(result.valid).toBe(true)
        if (result.valid) {
          expect(result.sha).toBe(VALID_SHA1)
          expect(result.capabilities).toEqual([])
        }
      })

      it('should parse want line with capabilities', () => {
        const result = safeParseWantLine(`want ${VALID_SHA1} thin-pack side-band-64k`)
        expect(result.valid).toBe(true)
        if (result.valid) {
          expect(result.sha).toBe(VALID_SHA1)
          expect(result.capabilities).toContain('thin-pack')
          expect(result.capabilities).toContain('side-band-64k')
        }
      })

      it('should parse want line with NUL-separated capabilities', () => {
        const result = safeParseWantLine(`want ${VALID_SHA1}\x00thin-pack side-band-64k`)
        expect(result.valid).toBe(true)
        if (result.valid) {
          expect(result.sha).toBe(VALID_SHA1)
          expect(result.capabilities).toContain('thin-pack')
          expect(result.capabilities).toContain('side-band-64k')
        }
      })

      it('should normalize SHA to lowercase', () => {
        const result = safeParseWantLine(`want ${VALID_SHA1.toUpperCase()}`)
        expect(result.valid).toBe(true)
        if (result.valid) {
          expect(result.sha).toBe(VALID_SHA1.toLowerCase())
        }
      })

      it('should reject line without want prefix', () => {
        const result = safeParseWantLine(`have ${VALID_SHA1}`)
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.code).toBe('INVALID_WANT_PREFIX')
        }
      })

      it('should reject invalid SHA', () => {
        const result = safeParseWantLine('want invalid')
        expect(result.valid).toBe(false)
      })
    })

    describe('safeParseHaveLine', () => {
      it('should parse valid have line', () => {
        const result = safeParseHaveLine(`have ${VALID_SHA1}`)
        expect(result.valid).toBe(true)
        if (result.valid) {
          expect(result.sha).toBe(VALID_SHA1)
        }
      })

      it('should normalize SHA to lowercase', () => {
        const result = safeParseHaveLine(`have ${VALID_SHA1.toUpperCase()}`)
        expect(result.valid).toBe(true)
        if (result.valid) {
          expect(result.sha).toBe(VALID_SHA1.toLowerCase())
        }
      })

      it('should reject line without have prefix', () => {
        const result = safeParseHaveLine(`want ${VALID_SHA1}`)
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.code).toBe('INVALID_HAVE_PREFIX')
        }
      })

      it('should reject invalid SHA', () => {
        const result = safeParseHaveLine('have invalid')
        expect(result.valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // 6. Timeout Handling
  // ==========================================================================
  describe('Timeout Handling', () => {
    describe('withTimeout', () => {
      it('should resolve for fast operations', async () => {
        const result = await withTimeout(
          Promise.resolve('success'),
          1000
        )
        expect(result).toBe('success')
      })

      it('should reject on timeout', async () => {
        const slowPromise = new Promise((resolve) => setTimeout(() => resolve('done'), 1000))

        await expect(withTimeout(slowPromise, 10)).rejects.toThrow(NegotiationTimeoutError)
      })

      it('should preserve original rejection', async () => {
        const failingPromise = Promise.reject(new Error('Original error'))

        await expect(withTimeout(failingPromise, 1000)).rejects.toThrow('Original error')
      })
    })

    describe('createDeadlineChecker', () => {
      it('should not throw before deadline', () => {
        const checkDeadline = createDeadlineChecker(Date.now() + 10000)
        expect(() => checkDeadline()).not.toThrow()
      })

      it('should throw after deadline', async () => {
        const checkDeadline = createDeadlineChecker(Date.now() + 10)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(() => checkDeadline()).toThrow(NegotiationTimeoutError)
      })
    })
  })

  // ==========================================================================
  // 7. Rate Limiting
  // ==========================================================================
  describe('Rate Limiting', () => {
    describe('createInMemoryRateLimiter', () => {
      it('should allow requests within limit', async () => {
        const limiter = createInMemoryRateLimiter({
          maxRequests: 10,
          windowMs: 60000,
          keyExtractor: (req) => req.ip || 'unknown',
        })

        const result = await limiter.check({ ip: '192.168.1.1' })
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(10)
      })

      it('should track request counts', async () => {
        const limiter = createInMemoryRateLimiter({
          maxRequests: 5,
          windowMs: 60000,
          keyExtractor: (req) => req.ip || 'unknown',
        })

        const request = { ip: '192.168.1.1' }

        await limiter.record(request)
        await limiter.record(request)
        await limiter.record(request)

        const result = await limiter.check(request)
        expect(result.remaining).toBe(2)
      })

      it('should deny requests exceeding limit', async () => {
        const limiter = createInMemoryRateLimiter({
          maxRequests: 3,
          windowMs: 60000,
          keyExtractor: (req) => req.ip || 'unknown',
        })

        const request = { ip: '192.168.1.1' }

        await limiter.record(request)
        await limiter.record(request)
        await limiter.record(request)

        const result = await limiter.check(request)
        expect(result.allowed).toBe(false)
        expect(result.remaining).toBe(0)
        expect(result.retryAfter).toBeGreaterThan(0)
      })

      it('should use separate counters per key', async () => {
        const limiter = createInMemoryRateLimiter({
          maxRequests: 2,
          windowMs: 60000,
          keyExtractor: (req) => req.ip || 'unknown',
        })

        const request1 = { ip: '192.168.1.1' }
        const request2 = { ip: '192.168.1.2' }

        await limiter.record(request1)
        await limiter.record(request1)

        const result1 = await limiter.check(request1)
        const result2 = await limiter.check(request2)

        expect(result1.allowed).toBe(false)
        expect(result2.allowed).toBe(true)
      })

      it('should reset after window expires', async () => {
        const limiter = createInMemoryRateLimiter({
          maxRequests: 1,
          windowMs: 50, // Very short window
          keyExtractor: (req) => req.ip || 'unknown',
        })

        const request = { ip: '192.168.1.1' }

        await limiter.record(request)
        let result = await limiter.check(request)
        expect(result.allowed).toBe(false)

        // Wait for window to expire
        await new Promise((resolve) => setTimeout(resolve, 60))

        result = await limiter.check(request)
        expect(result.allowed).toBe(true)
      })

      it('should support reset method', async () => {
        const limiter = createInMemoryRateLimiter({
          maxRequests: 1,
          windowMs: 60000,
          keyExtractor: (req) => req.ip || 'unknown',
        })

        const request = { ip: '192.168.1.1' }

        await limiter.record(request)
        let result = await limiter.check(request)
        expect(result.allowed).toBe(false)

        await limiter.reset('192.168.1.1')

        result = await limiter.check(request)
        expect(result.allowed).toBe(true)
      })
    })

    describe('createNoopRateLimiterHook', () => {
      it('should always allow requests', async () => {
        const hook = createNoopRateLimiterHook()

        const result = await hook.beforeRequest({ ip: 'any' })
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(Infinity)
      })

      it('should have noop afterRequest', async () => {
        const hook = createNoopRateLimiterHook()
        await expect(hook.afterRequest({ ip: 'any' })).resolves.toBeUndefined()
      })
    })

    describe('createRateLimiterHook', () => {
      it('should check and record in beforeRequest', async () => {
        const limiter = createInMemoryRateLimiter({
          maxRequests: 2,
          windowMs: 60000,
          keyExtractor: (req) => req.ip || 'unknown',
        })

        const hook = createRateLimiterHook(limiter)
        const request = { ip: '192.168.1.1' }

        // First request - allowed and recorded
        const result1 = await hook.beforeRequest(request)
        expect(result1.allowed).toBe(true)

        // Second request - allowed and recorded
        const result2 = await hook.beforeRequest(request)
        expect(result2.allowed).toBe(true)

        // Third request - denied (limit reached)
        const result3 = await hook.beforeRequest(request)
        expect(result3.allowed).toBe(false)
      })
    })
  })

  // ==========================================================================
  // 8. Error Recovery
  // ==========================================================================
  describe('Error Recovery', () => {
    describe('withErrorRecovery', () => {
      it('should return handler result on success', async () => {
        const handler = withErrorRecovery(
          async (x: number) => x * 2,
          () => -1
        )

        const result = await handler(5)
        expect(result).toBe(10)
      })

      it('should call error handler on failure', async () => {
        const handler = withErrorRecovery(
          async (_x: number): Promise<number> => {
            throw new Error('Test error')
          },
          (error) => {
            expect(error.message).toBe('Test error')
            return -1
          }
        )

        const result = await handler(5)
        expect(result).toBe(-1)
      })

      it('should pass input to error handler', async () => {
        const handler = withErrorRecovery(
          async (_x: number): Promise<number> => {
            throw new Error('Test error')
          },
          (_, input) => input * 10
        )

        const result = await handler(5)
        expect(result).toBe(50)
      })

      it('should convert non-Error throws to Error', async () => {
        const handler = withErrorRecovery(
          async (_x: number): Promise<number> => {
            throw 'string error'
          },
          (error) => {
            expect(error).toBeInstanceOf(Error)
            expect(error.message).toBe('string error')
            return -1
          }
        )

        const result = await handler(5)
        expect(result).toBe(-1)
      })
    })

    describe('createErrorResponse', () => {
      const decoder = new TextDecoder()

      it('should create pkt-line error response', () => {
        const error = new Error('Test error')
        const response = createErrorResponse(error, false)

        const text = decoder.decode(response)
        expect(text).toContain('ERR')
        expect(text).toContain('Test error')
      })

      it('should create side-band error response', () => {
        const error = new Error('Test error')
        const response = createErrorResponse(error, true)

        // Side-band channel 3
        expect(response[4]).toBe(3)

        const text = decoder.decode(response.slice(5))
        expect(text).toContain('ERR')
        expect(text).toContain('Test error')
      })

      it('should format NegotiationLimitError', () => {
        const error = new NegotiationLimitError(
          'Max rounds exceeded',
          'MAX_ROUNDS_EXCEEDED',
          'rounds',
          51,
          50
        )
        const response = createErrorResponse(error, false)

        const text = decoder.decode(response)
        expect(text).toContain('Limit exceeded')
      })

      it('should format NegotiationTimeoutError', () => {
        const error = new NegotiationTimeoutError(130000, 120000)
        const response = createErrorResponse(error, false)

        const text = decoder.decode(response)
        expect(text).toContain('Timeout')
      })

      it('should format MalformedPacketError', () => {
        const error = new MalformedPacketError('Invalid packet', 'BAD_PACKET')
        const response = createErrorResponse(error, false)

        const text = decoder.decode(response)
        expect(text).toContain('Malformed packet')
      })
    })
  })

  // ==========================================================================
  // 9. Error Classes
  // ==========================================================================
  describe('Error Classes', () => {
    describe('MalformedPacketError', () => {
      it('should have correct properties', () => {
        const packet = new Uint8Array([0x00, 0x01, 0x02])
        const error = new MalformedPacketError('Bad packet', 'BAD_PACKET', packet)

        expect(error.name).toBe('MalformedPacketError')
        expect(error.message).toBe('Bad packet')
        expect(error.code).toBe('BAD_PACKET')
        expect(error.packet).toEqual(packet)
      })

      it('should use default code', () => {
        const error = new MalformedPacketError('Bad packet')

        expect(error.code).toBe('MALFORMED_PACKET')
      })
    })

    describe('NegotiationLimitError', () => {
      it('should have correct properties', () => {
        const error = new NegotiationLimitError(
          'Max rounds exceeded',
          'MAX_ROUNDS_EXCEEDED',
          'rounds',
          51,
          50
        )

        expect(error.name).toBe('NegotiationLimitError')
        expect(error.message).toBe('Max rounds exceeded')
        expect(error.code).toBe('MAX_ROUNDS_EXCEEDED')
        expect(error.limit).toBe('rounds')
        expect(error.value).toBe(51)
        expect(error.max).toBe(50)
      })
    })

    describe('NegotiationTimeoutError', () => {
      it('should have correct properties', () => {
        const error = new NegotiationTimeoutError(130000, 120000)

        expect(error.name).toBe('NegotiationTimeoutError')
        expect(error.code).toBe('NEGOTIATION_TIMEOUT')
        expect(error.elapsed).toBe(130000)
        expect(error.timeout).toBe(120000)
        expect(error.message).toContain('130000')
        expect(error.message).toContain('120000')
      })
    })
  })

  // ==========================================================================
  // 10. Edge Cases and Security
  // ==========================================================================
  describe('Edge Cases and Security', () => {
    it('should handle rapid negotiation rounds', () => {
      const ctx = createNegotiationContext('test-repo', { maxRounds: 1000 })

      for (let i = 0; i < 1000; i++) {
        const result = validateNegotiationRound(ctx)
        expect(result.valid).toBe(true)
      }

      const finalResult = validateNegotiationRound(ctx)
      expect(finalResult.valid).toBe(false)
      expect(finalResult.code).toBe('MAX_ROUNDS_EXCEEDED')
    })

    it('should reject SHAs with special characters', () => {
      expect(validateSha('a'.repeat(39) + '\n').valid).toBe(false)
      expect(validateSha('a'.repeat(39) + '\x00').valid).toBe(false)
      expect(validateSha('a'.repeat(39) + ' ').valid).toBe(false)
    })

    it('should handle concurrent rate limit checks', async () => {
      const limiter = createInMemoryRateLimiter({
        maxRequests: 5,
        windowMs: 60000,
        keyExtractor: (req) => req.ip || 'unknown',
      })

      const request = { ip: '192.168.1.1' }

      // Record 5 requests in parallel
      await Promise.all([
        limiter.record(request),
        limiter.record(request),
        limiter.record(request),
        limiter.record(request),
        limiter.record(request),
      ])

      // Should be denied now
      const result = await limiter.check(request)
      expect(result.allowed).toBe(false)
    })

    it('should properly track state across multiple operations', () => {
      const ctx = createNegotiationContext('test-repo', {
        maxRounds: 10,
        maxWants: 100,
        maxHaves: 1000,
      })

      // Simulate a multi-round negotiation
      for (let round = 0; round < 5; round++) {
        const roundResult = validateNegotiationRound(ctx)
        expect(roundResult.valid).toBe(true)

        const wantResult = recordWants(ctx, 10)
        expect(wantResult.valid).toBe(true)

        const haveResult = recordHaves(ctx, 100)
        expect(haveResult.valid).toBe(true)
      }

      expect(ctx.round).toBe(5)
      expect(ctx.totalWants).toBe(50)
      expect(ctx.totalHaves).toBe(500)
    })
  })
})
