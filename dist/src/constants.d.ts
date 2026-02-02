/**
 * Shared constants used across the GitX codebase.
 *
 * Centralizes magic numbers to improve readability and maintainability.
 */
/**
 * Number of bytes to check when detecting binary content.
 * Matches Git's heuristic of checking the first 8000 bytes for null bytes.
 */
export declare const BINARY_CHECK_BYTES = 8000;
/** Default row group size for Parquet exports */
export declare const DEFAULT_ROW_GROUP_SIZE = 10000;
/** Default maximum number of entries in the SHA hash cache */
export declare const DEFAULT_HASH_CACHE_SIZE = 10000;
/** Specificity score for an exact ref match in branch protection rules */
export declare const EXACT_MATCH_SPECIFICITY = 1000000;
/** Inline storage threshold: objects smaller than this go into VARIANT in Parquet (1 MB) */
export declare const INLINE_STORAGE_THRESHOLD: number;
//# sourceMappingURL=constants.d.ts.map