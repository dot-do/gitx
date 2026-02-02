/**
 * Shared constants used across the GitX codebase.
 *
 * Centralizes magic numbers to improve readability and maintainability.
 */

// ============================================================================
// Binary Detection
// ============================================================================

/**
 * Number of bytes to check when detecting binary content.
 * Matches Git's heuristic of checking the first 8000 bytes for null bytes.
 */
export const BINARY_CHECK_BYTES = 8000

// ============================================================================
// Parquet / Row Groups
// ============================================================================

/** Default row group size for Parquet exports */
export const DEFAULT_ROW_GROUP_SIZE = 10000

// ============================================================================
// Caching
// ============================================================================

/** Default maximum number of entries in the SHA hash cache */
export const DEFAULT_HASH_CACHE_SIZE = 10000

// ============================================================================
// Branch Protection
// ============================================================================

/** Specificity score for an exact ref match in branch protection rules */
export const EXACT_MATCH_SPECIFICITY = 1_000_000

// ============================================================================
// Storage Thresholds
// ============================================================================

/** Inline storage threshold: objects smaller than this go into VARIANT in Parquet (1 MB) */
export const INLINE_STORAGE_THRESHOLD = 1024 * 1024
