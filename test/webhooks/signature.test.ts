import { describe, it, expect } from 'vitest'
import {
  verifyGitHubSignature,
  createGitHubSignature,
  timingSafeEqual,
  constantTimeEqual,
} from '../../src/webhooks/signature'

// ============================================================================
// Constants
// ============================================================================

const TEST_SECRET = 'test-webhook-secret-key'
const TEST_PAYLOAD = '{"action":"push","ref":"refs/heads/main"}'

// ============================================================================
// Signature Creation Tests
// ============================================================================

describe('createGitHubSignature', () => {
  it('should return a string prefixed with sha256=', async () => {
    const signature = await createGitHubSignature(TEST_PAYLOAD, TEST_SECRET)

    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/)
  })

  it('should produce consistent signatures for the same payload and secret', async () => {
    const sig1 = await createGitHubSignature(TEST_PAYLOAD, TEST_SECRET)
    const sig2 = await createGitHubSignature(TEST_PAYLOAD, TEST_SECRET)

    expect(sig1).toBe(sig2)
  })

  it('should produce different signatures for different payloads', async () => {
    const sig1 = await createGitHubSignature('payload-one', TEST_SECRET)
    const sig2 = await createGitHubSignature('payload-two', TEST_SECRET)

    expect(sig1).not.toBe(sig2)
  })

  it('should produce different signatures for different secrets', async () => {
    const sig1 = await createGitHubSignature(TEST_PAYLOAD, 'secret-one')
    const sig2 = await createGitHubSignature(TEST_PAYLOAD, 'secret-two')

    expect(sig1).not.toBe(sig2)
  })

  it('should handle empty payload', async () => {
    const signature = await createGitHubSignature('', TEST_SECRET)

    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/)
  })

  it('should throw on empty secret (Web Crypto rejects zero-length HMAC keys)', async () => {
    await expect(createGitHubSignature(TEST_PAYLOAD, '')).rejects.toThrow()
  })

  it('should handle unicode payload', async () => {
    const signature = await createGitHubSignature('{"message":"Hello, World!"}', TEST_SECRET)

    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/)
  })
})

// ============================================================================
// Signature Verification Tests
// ============================================================================

describe('verifyGitHubSignature', () => {
  describe('valid signatures', () => {
    it('should verify a correctly signed payload', async () => {
      const signature = await createGitHubSignature(TEST_PAYLOAD, TEST_SECRET)
      const isValid = await verifyGitHubSignature(TEST_PAYLOAD, signature, TEST_SECRET)

      expect(isValid).toBe(true)
    })

    it('should verify an empty payload with valid signature', async () => {
      const payload = ''
      const signature = await createGitHubSignature(payload, TEST_SECRET)
      const isValid = await verifyGitHubSignature(payload, signature, TEST_SECRET)

      expect(isValid).toBe(true)
    })

    it('should verify a large JSON payload', async () => {
      const payload = JSON.stringify({
        ref: 'refs/heads/main',
        before: 'a'.repeat(40),
        after: 'b'.repeat(40),
        commits: Array.from({ length: 100 }, (_, i) => ({
          id: `commit-${i}`,
          message: `Commit message ${i}`,
          timestamp: new Date().toISOString(),
        })),
      })
      const signature = await createGitHubSignature(payload, TEST_SECRET)
      const isValid = await verifyGitHubSignature(payload, signature, TEST_SECRET)

      expect(isValid).toBe(true)
    })

    it('should verify payload with special characters', async () => {
      const payload = '{"branch":"feat/special-chars-&-symbols!@#$%"}'
      const signature = await createGitHubSignature(payload, TEST_SECRET)
      const isValid = await verifyGitHubSignature(payload, signature, TEST_SECRET)

      expect(isValid).toBe(true)
    })
  })

  describe('invalid signatures', () => {
    it('should reject when signature is null', async () => {
      const isValid = await verifyGitHubSignature(TEST_PAYLOAD, null, TEST_SECRET)

      expect(isValid).toBe(false)
    })

    it('should reject when signature is empty string', async () => {
      const isValid = await verifyGitHubSignature(TEST_PAYLOAD, '', TEST_SECRET)

      expect(isValid).toBe(false)
    })

    it('should reject when signature does not start with sha256=', async () => {
      const isValid = await verifyGitHubSignature(
        TEST_PAYLOAD,
        'sha1=' + 'a'.repeat(64),
        TEST_SECRET
      )

      expect(isValid).toBe(false)
    })

    it('should reject when signature has wrong prefix', async () => {
      const isValid = await verifyGitHubSignature(
        TEST_PAYLOAD,
        'md5=' + 'a'.repeat(64),
        TEST_SECRET
      )

      expect(isValid).toBe(false)
    })

    it('should reject when hex digest is too short', async () => {
      const isValid = await verifyGitHubSignature(
        TEST_PAYLOAD,
        'sha256=' + 'a'.repeat(32),
        TEST_SECRET
      )

      expect(isValid).toBe(false)
    })

    it('should reject when hex digest is too long', async () => {
      const isValid = await verifyGitHubSignature(
        TEST_PAYLOAD,
        'sha256=' + 'a'.repeat(128),
        TEST_SECRET
      )

      expect(isValid).toBe(false)
    })

    it('should reject when hex digest is empty', async () => {
      const isValid = await verifyGitHubSignature(TEST_PAYLOAD, 'sha256=', TEST_SECRET)

      expect(isValid).toBe(false)
    })

    it('should reject a tampered payload', async () => {
      const signature = await createGitHubSignature(TEST_PAYLOAD, TEST_SECRET)
      const tamperedPayload = TEST_PAYLOAD.replace('push', 'pull')
      const isValid = await verifyGitHubSignature(tamperedPayload, signature, TEST_SECRET)

      expect(isValid).toBe(false)
    })

    it('should reject when signed with a different secret', async () => {
      const signature = await createGitHubSignature(TEST_PAYLOAD, 'wrong-secret')
      const isValid = await verifyGitHubSignature(TEST_PAYLOAD, signature, TEST_SECRET)

      expect(isValid).toBe(false)
    })

    it('should reject a completely fabricated signature', async () => {
      const fakeSignature = 'sha256=' + 'deadbeef'.repeat(8)
      const isValid = await verifyGitHubSignature(TEST_PAYLOAD, fakeSignature, TEST_SECRET)

      expect(isValid).toBe(false)
    })

    it('should reject signature with single bit difference in payload', async () => {
      const payload = 'original payload content'
      const signature = await createGitHubSignature(payload, TEST_SECRET)
      // Change a single character
      const altered = 'Original payload content'
      const isValid = await verifyGitHubSignature(altered, signature, TEST_SECRET)

      expect(isValid).toBe(false)
    })
  })

  describe('roundtrip verification', () => {
    it('should roundtrip with createGitHubSignature', async () => {
      const payloads = [
        '{}',
        '{"key":"value"}',
        'plain text body',
        JSON.stringify({ nested: { deep: { data: true } } }),
      ]

      for (const payload of payloads) {
        const sig = await createGitHubSignature(payload, TEST_SECRET)
        const isValid = await verifyGitHubSignature(payload, sig, TEST_SECRET)
        expect(isValid).toBe(true)
      }
    })
  })
})

// ============================================================================
// Constant-Time Comparison Tests
// ============================================================================

describe('timingSafeEqual', () => {
  describe('equality checks', () => {
    it('should return true for identical strings', () => {
      expect(timingSafeEqual('hello', 'hello')).toBe(true)
    })

    it('should return true for empty strings', () => {
      expect(timingSafeEqual('', '')).toBe(true)
    })

    it('should return true for long identical strings', () => {
      const longStr = 'a'.repeat(1000)
      expect(timingSafeEqual(longStr, longStr)).toBe(true)
    })

    it('should return true for identical hex digests', () => {
      const digest = 'deadbeef'.repeat(8)
      expect(timingSafeEqual(digest, digest)).toBe(true)
    })
  })

  describe('inequality checks', () => {
    it('should return false for different strings', () => {
      expect(timingSafeEqual('hello', 'world')).toBe(false)
    })

    it('should return false for strings differing by one character', () => {
      expect(timingSafeEqual('hello', 'hellp')).toBe(false)
    })

    it('should return false for strings with different case', () => {
      expect(timingSafeEqual('Hello', 'hello')).toBe(false)
    })

    it('should return false for strings differing only at the start', () => {
      expect(timingSafeEqual('xello', 'hello')).toBe(false)
    })

    it('should return false for strings differing only at the end', () => {
      expect(timingSafeEqual('hellx', 'hello')).toBe(false)
    })
  })

  describe('length mismatch handling (timing leak prevention)', () => {
    it('should return false when first string is shorter', () => {
      expect(timingSafeEqual('short', 'longer string')).toBe(false)
    })

    it('should return false when second string is shorter', () => {
      expect(timingSafeEqual('longer string', 'short')).toBe(false)
    })

    it('should return false for empty vs non-empty', () => {
      expect(timingSafeEqual('', 'nonempty')).toBe(false)
      expect(timingSafeEqual('nonempty', '')).toBe(false)
    })

    it('should return false for one character difference in length', () => {
      expect(timingSafeEqual('abc', 'ab')).toBe(false)
      expect(timingSafeEqual('ab', 'abc')).toBe(false)
    })

    it('should handle significantly different lengths', () => {
      expect(timingSafeEqual('x', 'x'.repeat(100))).toBe(false)
      expect(timingSafeEqual('x'.repeat(100), 'x')).toBe(false)
    })
  })

  describe('special characters', () => {
    it('should handle unicode strings', () => {
      expect(timingSafeEqual('\u0000', '\u0000')).toBe(true)
      expect(timingSafeEqual('\u0000', '\u0001')).toBe(false)
    })

    it('should handle null bytes', () => {
      expect(timingSafeEqual('\0', '\0')).toBe(true)
      expect(timingSafeEqual('\0', 'a')).toBe(false)
    })

    it('should handle special characters', () => {
      const special = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/`~'
      expect(timingSafeEqual(special, special)).toBe(true)
    })
  })
})

describe('constantTimeEqual', () => {
  describe('equality checks', () => {
    it('should return true for identical byte arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5])
      const b = new Uint8Array([1, 2, 3, 4, 5])
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should return true for empty arrays', () => {
      const a = new Uint8Array([])
      const b = new Uint8Array([])
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should return true for single byte arrays', () => {
      const a = new Uint8Array([42])
      const b = new Uint8Array([42])
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should return true for large identical arrays', () => {
      const a = new Uint8Array(1000).fill(0xff)
      const b = new Uint8Array(1000).fill(0xff)
      expect(constantTimeEqual(a, b)).toBe(true)
    })
  })

  describe('inequality checks', () => {
    it('should return false for different byte arrays', () => {
      const a = new Uint8Array([1, 2, 3])
      const b = new Uint8Array([4, 5, 6])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return false for arrays differing by one byte', () => {
      const a = new Uint8Array([1, 2, 3])
      const b = new Uint8Array([1, 2, 4])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return false for arrays differing only at the start', () => {
      const a = new Uint8Array([0, 2, 3])
      const b = new Uint8Array([1, 2, 3])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return false for single bit difference', () => {
      const a = new Uint8Array([0b11111111])
      const b = new Uint8Array([0b11111110])
      expect(constantTimeEqual(a, b)).toBe(false)
    })
  })

  describe('length mismatch handling (timing leak prevention)', () => {
    it('should return false when first array is shorter', () => {
      const a = new Uint8Array([1, 2])
      const b = new Uint8Array([1, 2, 3, 4, 5])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return false when second array is shorter', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5])
      const b = new Uint8Array([1, 2])
      expect(constantTimeEqual(a, b)).toBe(false)
    })

    it('should return false for empty vs non-empty', () => {
      const empty = new Uint8Array([])
      const nonEmpty = new Uint8Array([1, 2, 3])
      expect(constantTimeEqual(empty, nonEmpty)).toBe(false)
      expect(constantTimeEqual(nonEmpty, empty)).toBe(false)
    })

    it('should return false for one byte difference in length', () => {
      const a = new Uint8Array([1, 2, 3])
      const b = new Uint8Array([1, 2])
      expect(constantTimeEqual(a, b)).toBe(false)
      expect(constantTimeEqual(b, a)).toBe(false)
    })

    it('should handle significantly different lengths', () => {
      const small = new Uint8Array([42])
      const large = new Uint8Array(100).fill(42)
      expect(constantTimeEqual(small, large)).toBe(false)
      expect(constantTimeEqual(large, small)).toBe(false)
    })

    it('should still fail with matching prefix but different lengths', () => {
      // This is the key test for the timing leak fix
      const a = new Uint8Array([1, 2, 3])
      const b = new Uint8Array([1, 2, 3, 4])
      expect(constantTimeEqual(a, b)).toBe(false)
    })
  })

  describe('boundary values', () => {
    it('should handle zero bytes', () => {
      const a = new Uint8Array([0, 0, 0])
      const b = new Uint8Array([0, 0, 0])
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should handle max byte values', () => {
      const a = new Uint8Array([255, 255, 255])
      const b = new Uint8Array([255, 255, 255])
      expect(constantTimeEqual(a, b)).toBe(true)
    })

    it('should distinguish zero from max', () => {
      const a = new Uint8Array([0])
      const b = new Uint8Array([255])
      expect(constantTimeEqual(a, b)).toBe(false)
    })
  })
})
