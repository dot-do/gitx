/**
 * @fileoverview Branch Name Validation Utilities
 *
 * This module provides shared validation and normalization functions for Git branch names.
 * These utilities are used by both the refs/branch.ts and ops/branch.ts modules to ensure
 * consistent validation behavior across the codebase.
 *
 * Git branch naming rules are defined in git-check-ref-format(1):
 * - Cannot start with a dash (-)
 * - Cannot contain double dots (..)
 * - Cannot end with .lock
 * - Cannot contain control characters (ASCII 0-31, 127)
 * - Cannot contain spaces, ~, ^, :, ?, *, [, \
 * - Cannot be "HEAD" or start with "refs/"
 *
 * @module utils/branch-validation
 */
/** Maximum allowed length for branch names */
export declare const MAX_BRANCH_NAME_LENGTH = 255;
/** Prefix for local branch refs */
export declare const BRANCH_REF_PREFIX = "refs/heads/";
/** Prefix for remote tracking branch refs */
export declare const REMOTE_REF_PREFIX = "refs/remotes/";
/**
 * Result of branch name validation.
 *
 * @description
 * Provides detailed validation result including the normalized
 * form of the branch name if valid.
 */
export interface BranchValidationResult {
    /** Whether the name passes validation */
    valid: boolean;
    /** Error message explaining why validation failed */
    error?: string;
    /** Normalized branch name (cleaned up form) */
    normalized?: string;
}
/**
 * Validate a branch name according to Git rules.
 *
 * @description
 * Checks if a branch name is valid and returns detailed validation results
 * including the normalized form of the name.
 *
 * @param name - Branch name to validate
 * @returns Validation result with valid flag, error message, and normalized name
 *
 * @see https://git-scm.com/docs/git-check-ref-format
 *
 * @example
 * ```typescript
 * const result = validateBranchName('feature/auth')
 * if (result.valid) {
 *   console.log(`Valid: ${result.normalized}`)
 * } else {
 *   console.log(`Invalid: ${result.error}`)
 * }
 * ```
 */
export declare function validateBranchName(name: string): BranchValidationResult;
/**
 * Check if a string is a valid branch name.
 *
 * @description
 * Simple boolean check for branch name validity.
 *
 * @param name - Branch name to check
 * @returns True if valid
 *
 * @example
 * ```typescript
 * if (isValidBranchName('feature/new')) {
 *   // Create the branch
 * }
 * ```
 */
export declare function isValidBranchName(name: string): boolean;
/**
 * Normalize a branch name.
 *
 * @description
 * Removes refs/heads/ prefix if present, cleans up the name.
 *
 * @param name - Branch name or ref
 * @returns Normalized short branch name
 *
 * @example
 * ```typescript
 * normalizeBranchName('refs/heads/main')  // 'main'
 * normalizeBranchName('main')              // 'main'
 * ```
 */
export declare function normalizeBranchName(name: string): string;
/**
 * Get the full ref name for a branch.
 *
 * @description
 * Adds refs/heads/ prefix if not present.
 *
 * @param name - Short branch name
 * @returns Full ref name
 *
 * @example
 * ```typescript
 * getBranchRefName('main')            // 'refs/heads/main'
 * getBranchRefName('refs/heads/main') // 'refs/heads/main'
 * ```
 */
export declare function getBranchRefName(name: string): string;
/**
 * Get the full ref name for a remote tracking branch.
 *
 * @description
 * Builds the refs/remotes/... path for a remote tracking branch.
 *
 * @param remote - Remote name (e.g., 'origin')
 * @param branch - Branch name (e.g., 'main')
 * @returns Full ref name (e.g., 'refs/remotes/origin/main')
 *
 * @example
 * ```typescript
 * getRemoteRefName('origin', 'main')  // 'refs/remotes/origin/main'
 * ```
 */
export declare function getRemoteRefName(remote: string, branch: string): string;
/**
 * Parse a remote ref into its components.
 *
 * @description
 * Extracts remote name and branch name from a remote ref path.
 *
 * @param ref - Full remote ref or short form (e.g., 'origin/main')
 * @returns Object with remote and branch names, or null if invalid
 *
 * @example
 * ```typescript
 * parseRemoteRef('refs/remotes/origin/main')  // { remote: 'origin', branch: 'main' }
 * parseRemoteRef('origin/main')               // { remote: 'origin', branch: 'main' }
 * parseRemoteRef('main')                      // null
 * ```
 */
export declare function parseRemoteRef(ref: string): {
    remote: string;
    branch: string;
} | null;
//# sourceMappingURL=branch-validation.d.ts.map