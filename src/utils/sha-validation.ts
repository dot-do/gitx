/**
 * @fileoverview SHA Validation Utilities
 *
 * This module provides validation functions for Git SHA hashes.
 * Git primarily uses SHA-1 (40 hexadecimal characters) but also supports
 * SHA-256 (64 hexadecimal characters) as of Git v2.29+.
 *
 * These utilities consolidate SHA validation logic that was previously
 * duplicated across multiple modules.
 *
 * @module utils/sha-validation
 *
 * @example
 * ```typescript
 * import { isValidSha, isValidSha1, isValidSha256, assertValidSha } from './utils/sha-validation'
 *
 * // Validate any supported SHA format
 * if (isValidSha('abc123...')) {
 *   // Valid SHA-1 or SHA-256
 * }
 *
 * // Validate specific SHA types
 * if (isValidSha1(sha)) { /* 40-char hex *\/ }
 * if (isValidSha256(sha)) { /* 64-char hex *\/ }
 *
 * // Assert with automatic error throwing
 * assertValidSha(sha, 'tree') // Throws: "Invalid tree SHA: ..."
 * ```
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Regular expression pattern for SHA-1 hashes (40 lowercase hexadecimal characters).
 *
 * @description
 * Matches exactly 40 lowercase hexadecimal characters (0-9, a-f).
 * This is the standard Git object identifier format.
 *
 * @example
 * ```typescript
 * SHA1_PATTERN.test('da39a3ee5e6b4b0d3255bfef95601890afd80709') // true
 * SHA1_PATTERN.test('abc123') // false (too short)
 * SHA1_PATTERN.test('DA39A3EE5E6B4B0D3255BFEF95601890AFD80709') // false (uppercase)
 * ```
 */
export const SHA1_PATTERN = /^[0-9a-f]{40}$/

/**
 * Regular expression pattern for SHA-256 hashes (64 lowercase hexadecimal characters).
 *
 * @description
 * Matches exactly 64 lowercase hexadecimal characters (0-9, a-f).
 * SHA-256 support was added in Git v2.29+ as an alternative to SHA-1.
 *
 * @example
 * ```typescript
 * SHA256_PATTERN.test('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') // true
 * ```
 */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/

/**
 * Combined pattern that matches either SHA-1 or SHA-256.
 *
 * @description
 * Matches either 40 or 64 lowercase hexadecimal characters.
 */
export const SHA_PATTERN = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/

/**
 * The zero SHA for SHA-1 format (40 zeros).
 *
 * @description
 * Used to represent "no object" or "delete" in Git protocol operations.
 * Common in ref update operations where:
 * - old=ZERO_SHA means creating a new ref
 * - new=ZERO_SHA means deleting an existing ref
 */
export const ZERO_SHA = '0000000000000000000000000000000000000000'

/**
 * The zero SHA for SHA-256 format (64 zeros).
 *
 * @description
 * Used in Git repositories configured for SHA-256 to represent "no object".
 */
export const ZERO_SHA256 = '0000000000000000000000000000000000000000000000000000000000000000'

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Result of SHA validation.
 *
 * @description
 * Provides detailed validation result including the SHA type if valid.
 */
export interface ShaValidationResult {
  /** Whether the SHA passes validation */
  valid: boolean
  /** The type of SHA detected ('sha1', 'sha256', or undefined if invalid) */
  type?: 'sha1' | 'sha256'
  /** Error message explaining why validation failed */
  error?: string
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a SHA-1 hash string.
 *
 * @description
 * Checks if a string is a valid Git SHA-1 hash (40 lowercase hex characters).
 * This is the standard Git object identifier format.
 *
 * @param sha - The string to validate
 * @returns True if the string is a valid SHA-1 hash
 *
 * @example
 * ```typescript
 * isValidSha1('da39a3ee5e6b4b0d3255bfef95601890afd80709') // true
 * isValidSha1('abc123') // false (too short)
 * isValidSha1('DA39A3EE5E6B4B0D3255BFEF95601890AFD80709') // false (uppercase)
 * isValidSha1(null) // false
 * isValidSha1(123) // false
 * ```
 */
export function isValidSha1(sha: unknown): sha is string {
  return typeof sha === 'string' && SHA1_PATTERN.test(sha)
}

/**
 * Validate a SHA-256 hash string.
 *
 * @description
 * Checks if a string is a valid Git SHA-256 hash (64 lowercase hex characters).
 * SHA-256 support was added in Git v2.29+ as an alternative to SHA-1.
 *
 * @param sha - The string to validate
 * @returns True if the string is a valid SHA-256 hash
 *
 * @example
 * ```typescript
 * isValidSha256('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') // true
 * isValidSha256('abc123') // false (too short)
 * ```
 */
export function isValidSha256(sha: unknown): sha is string {
  return typeof sha === 'string' && SHA256_PATTERN.test(sha)
}

/**
 * Validate a SHA hash string (either SHA-1 or SHA-256).
 *
 * @description
 * Checks if a string is a valid Git SHA hash in either format:
 * - SHA-1: 40 lowercase hexadecimal characters
 * - SHA-256: 64 lowercase hexadecimal characters
 *
 * Use this function when you want to accept either format.
 * For strict validation of a specific format, use isValidSha1 or isValidSha256.
 *
 * @param sha - The string to validate
 * @returns True if the string is a valid SHA-1 or SHA-256 hash
 *
 * @example
 * ```typescript
 * // SHA-1 (40 chars)
 * isValidSha('da39a3ee5e6b4b0d3255bfef95601890afd80709') // true
 *
 * // SHA-256 (64 chars)
 * isValidSha('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') // true
 *
 * // Invalid
 * isValidSha('abc123') // false (too short)
 * isValidSha('DA39A3EE5E6B4B0D3255BFEF95601890AFD80709') // false (uppercase)
 * isValidSha(null) // false
 * isValidSha(undefined) // false
 * isValidSha(123) // false (not a string)
 * ```
 */
export function isValidSha(sha: unknown): sha is string {
  return typeof sha === 'string' && SHA_PATTERN.test(sha)
}

/**
 * Validate a SHA with detailed result.
 *
 * @description
 * Provides detailed validation including the type of SHA detected.
 * Useful when you need to know whether the SHA is SHA-1 or SHA-256.
 *
 * @param sha - The string to validate
 * @returns Validation result with type and error information
 *
 * @example
 * ```typescript
 * const result = validateSha('da39a3ee5e6b4b0d3255bfef95601890afd80709')
 * if (result.valid) {
 *   console.log(`Valid ${result.type}`) // "Valid sha1"
 * } else {
 *   console.error(result.error)
 * }
 * ```
 */
export function validateSha(sha: unknown): ShaValidationResult {
  if (typeof sha !== 'string') {
    return {
      valid: false,
      error: `SHA must be a string, got ${typeof sha}`
    }
  }

  if (sha.length === 0) {
    return {
      valid: false,
      error: 'SHA cannot be empty'
    }
  }

  if (SHA1_PATTERN.test(sha)) {
    return { valid: true, type: 'sha1' }
  }

  if (SHA256_PATTERN.test(sha)) {
    return { valid: true, type: 'sha256' }
  }

  // Provide helpful error messages
  if (sha.length === 40) {
    // Right length for SHA-1 but invalid characters
    if (/[A-F]/.test(sha)) {
      return {
        valid: false,
        error: 'SHA-1 must be lowercase hexadecimal characters (got uppercase)'
      }
    }
    if (/[^0-9a-fA-F]/.test(sha)) {
      return {
        valid: false,
        error: 'SHA-1 must contain only hexadecimal characters (0-9, a-f)'
      }
    }
  }

  if (sha.length === 64) {
    // Right length for SHA-256 but invalid characters
    if (/[A-F]/.test(sha)) {
      return {
        valid: false,
        error: 'SHA-256 must be lowercase hexadecimal characters (got uppercase)'
      }
    }
    if (/[^0-9a-fA-F]/.test(sha)) {
      return {
        valid: false,
        error: 'SHA-256 must contain only hexadecimal characters (0-9, a-f)'
      }
    }
  }

  return {
    valid: false,
    error: `Invalid SHA format: must be 40 (SHA-1) or 64 (SHA-256) lowercase hexadecimal characters, got ${sha.length} characters`
  }
}

/**
 * Assert that a SHA is valid, throwing if not.
 *
 * @description
 * Throws a descriptive error if the SHA is invalid.
 * Use this for input validation at function entry points.
 *
 * @param sha - The SHA to validate
 * @param context - Optional context for the error message (e.g., 'tree', 'parent', 'commit')
 * @throws Error if SHA is invalid with descriptive message
 *
 * @example
 * ```typescript
 * // Basic usage
 * assertValidSha(sha) // Throws: "Invalid SHA: ..."
 *
 * // With context
 * assertValidSha(treeSha, 'tree') // Throws: "Invalid tree SHA: ..."
 * assertValidSha(parentSha, 'parent commit') // Throws: "Invalid parent commit SHA: ..."
 *
 * // Function entry point validation
 * function getObject(sha: string) {
 *   assertValidSha(sha, 'object')
 *   // ... proceed with valid SHA
 * }
 * ```
 */
export function assertValidSha(sha: unknown, context?: string): asserts sha is string {
  const result = validateSha(sha)
  if (!result.valid) {
    const prefix = context ? `Invalid ${context} SHA` : 'Invalid SHA'
    throw new Error(`${prefix}: ${result.error}`)
  }
}

/**
 * Assert that a SHA is a valid SHA-1, throwing if not.
 *
 * @description
 * Throws a descriptive error if the SHA is not a valid SHA-1 (40 chars).
 * Use this when you specifically need a SHA-1 hash.
 *
 * @param sha - The SHA to validate
 * @param context - Optional context for the error message
 * @throws Error if SHA is not a valid SHA-1
 *
 * @example
 * ```typescript
 * assertValidSha1(sha, 'object')
 * // Proceeds only if sha is a valid 40-char hex string
 * ```
 */
export function assertValidSha1(sha: unknown, context?: string): asserts sha is string {
  if (!isValidSha1(sha)) {
    const prefix = context ? `Invalid ${context} SHA-1` : 'Invalid SHA-1'
    const typeInfo = typeof sha === 'string' ? ` (got ${sha.length} characters)` : ` (got ${typeof sha})`
    throw new Error(`${prefix}: must be 40 lowercase hexadecimal characters${typeInfo}`)
  }
}

/**
 * Assert that a SHA is a valid SHA-256, throwing if not.
 *
 * @description
 * Throws a descriptive error if the SHA is not a valid SHA-256 (64 chars).
 * Use this when you specifically need a SHA-256 hash.
 *
 * @param sha - The SHA to validate
 * @param context - Optional context for the error message
 * @throws Error if SHA is not a valid SHA-256
 *
 * @example
 * ```typescript
 * assertValidSha256(sha, 'object')
 * // Proceeds only if sha is a valid 64-char hex string
 * ```
 */
export function assertValidSha256(sha: unknown, context?: string): asserts sha is string {
  if (!isValidSha256(sha)) {
    const prefix = context ? `Invalid ${context} SHA-256` : 'Invalid SHA-256'
    const typeInfo = typeof sha === 'string' ? ` (got ${sha.length} characters)` : ` (got ${typeof sha})`
    throw new Error(`${prefix}: must be 64 lowercase hexadecimal characters${typeInfo}`)
  }
}

/**
 * Check if a SHA is the zero SHA (for either SHA-1 or SHA-256).
 *
 * @description
 * Returns true if the SHA is the special "zero SHA" value used in Git
 * to represent "no object" or "delete" operations.
 *
 * @param sha - The SHA to check
 * @returns True if the SHA is a zero SHA
 *
 * @example
 * ```typescript
 * isZeroSha('0000000000000000000000000000000000000000') // true (SHA-1 zero)
 * isZeroSha('0000000000000000000000000000000000000000000000000000000000000000') // true (SHA-256 zero)
 * isZeroSha('da39a3ee5e6b4b0d3255bfef95601890afd80709') // false
 * ```
 */
export function isZeroSha(sha: string): boolean {
  return sha === ZERO_SHA || sha === ZERO_SHA256
}

/**
 * Get the SHA type from a valid SHA string.
 *
 * @description
 * Returns the type of SHA ('sha1' or 'sha256') for a valid SHA string.
 * Returns null if the SHA is invalid.
 *
 * @param sha - The SHA to check
 * @returns 'sha1', 'sha256', or null if invalid
 *
 * @example
 * ```typescript
 * getShaType('da39a3ee5e6b4b0d3255bfef95601890afd80709') // 'sha1'
 * getShaType('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') // 'sha256'
 * getShaType('invalid') // null
 * ```
 */
export function getShaType(sha: string): 'sha1' | 'sha256' | null {
  if (isValidSha1(sha)) return 'sha1'
  if (isValidSha256(sha)) return 'sha256'
  return null
}

/**
 * Normalize a SHA to lowercase.
 *
 * @description
 * Converts a SHA string to lowercase. Useful when handling user input
 * that may have mixed case. Note: This does NOT validate the SHA.
 *
 * @param sha - The SHA to normalize
 * @returns Lowercase SHA string
 *
 * @example
 * ```typescript
 * normalizeSha('DA39A3EE5E6B4B0D3255BFEF95601890AFD80709')
 * // 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
 * ```
 */
export function normalizeSha(sha: string): string {
  return sha.toLowerCase()
}

/**
 * Validate and normalize a SHA.
 *
 * @description
 * Normalizes the SHA to lowercase and validates it.
 * Returns the normalized SHA if valid, throws otherwise.
 *
 * @param sha - The SHA to validate and normalize
 * @param context - Optional context for error messages
 * @returns Normalized (lowercase) SHA string
 * @throws Error if SHA is invalid
 *
 * @example
 * ```typescript
 * const normalized = validateAndNormalizeSha('DA39A3EE...', 'object')
 * // Returns lowercase version if valid, throws otherwise
 * ```
 */
export function validateAndNormalizeSha(sha: string, context?: string): string {
  const normalized = normalizeSha(sha)
  assertValidSha(normalized, context)
  return normalized
}
