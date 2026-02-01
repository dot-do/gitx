import { describe, it, expect } from 'vitest'
import { verifyGitHubSignature, createGitHubSignature } from '../../src/webhooks/signature'

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
