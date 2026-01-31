/**
 * @fileoverview GitHub Webhook Signature Verification
 *
 * Implements HMAC-SHA256 signature verification for GitHub webhooks
 * using the Web Crypto API for edge runtime compatibility.
 *
 * @module webhooks/signature
 */

// ============================================================================
// Constants
// ============================================================================

const ALGORITHM = 'SHA-256'
const SIGNATURE_PREFIX = 'sha256='

// ============================================================================
// Signature Verification
// ============================================================================

/**
 * Verifies a GitHub webhook signature using HMAC-SHA256.
 *
 * @description
 * GitHub signs webhook payloads with HMAC-SHA256 using the configured
 * webhook secret. This function verifies the signature to ensure the
 * request came from GitHub.
 *
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param payload - The raw request body as a string
 * @param signature - The x-hub-signature-256 header value
 * @param secret - The webhook secret configured in GitHub
 * @returns Promise resolving to true if signature is valid
 *
 * @example
 * ```typescript
 * const isValid = await verifyGitHubSignature(
 *   await request.text(),
 *   request.headers.get('x-hub-signature-256'),
 *   env.GITHUB_WEBHOOK_SECRET
 * )
 *
 * if (!isValid) {
 *   return new Response('Invalid signature', { status: 401 })
 * }
 * ```
 */
export async function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  // No signature provided
  if (!signature) {
    return false
  }

  // Signature must start with sha256=
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    return false
  }

  // Extract the hex digest from signature
  const expectedDigest = signature.slice(SIGNATURE_PREFIX.length)
  if (!expectedDigest || expectedDigest.length !== 64) {
    return false
  }

  try {
    // Import the secret as a CryptoKey
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: ALGORITHM },
      false,
      ['sign']
    )

    // Sign the payload
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    )

    // Convert to hex
    const actualDigest = bufferToHex(signatureBuffer)

    // Constant-time comparison
    return timingSafeEqual(expectedDigest, actualDigest)
  } catch {
    return false
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Converts an ArrayBuffer to a hex string.
 *
 * @param buffer - The buffer to convert
 * @returns Hex string representation
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Performs constant-time string comparison.
 *
 * @description
 * Prevents timing attacks by always comparing all bytes,
 * regardless of where the first difference is.
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return result === 0
}

/**
 * Creates a signature for a payload (for testing purposes).
 *
 * @param payload - The payload to sign
 * @param secret - The webhook secret
 * @returns Promise resolving to the signature header value
 */
export async function createGitHubSignature(
  payload: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: ALGORITHM },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload)
  )

  return SIGNATURE_PREFIX + bufferToHex(signatureBuffer)
}
