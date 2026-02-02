/**
 * @fileoverview GitHub Webhook Signature Verification
 *
 * Implements HMAC-SHA256 signature verification for GitHub webhooks
 * using the Web Crypto API for edge runtime compatibility.
 *
 * @module webhooks/signature
 */
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
export declare function verifyGitHubSignature(payload: string, signature: string | null, secret: string): Promise<boolean>;
/**
 * Performs constant-time byte array comparison.
 *
 * @description
 * Prevents timing attacks by always comparing all bytes,
 * regardless of where the first difference is. Critically,
 * this function also avoids early returns based on length
 * to prevent timing leaks that could reveal length information.
 *
 * @param a - First byte array
 * @param b - Second byte array
 * @returns True if arrays are equal
 */
export declare function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean;
/**
 * Performs constant-time string comparison.
 *
 * @description
 * Prevents timing attacks by always comparing all bytes,
 * regardless of where the first difference is. Critically,
 * this function also avoids early returns based on length
 * to prevent timing leaks that could reveal length information.
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
export declare function timingSafeEqual(a: string, b: string): boolean;
/**
 * Creates a signature for a payload (for testing purposes).
 *
 * @param payload - The payload to sign
 * @param secret - The webhook secret
 * @returns Promise resolving to the signature header value
 */
export declare function createGitHubSignature(payload: string, secret: string): Promise<string>;
//# sourceMappingURL=signature.d.ts.map