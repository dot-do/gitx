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
// ============================================================================
// Constants
// ============================================================================
/** Maximum allowed length for branch names */
export const MAX_BRANCH_NAME_LENGTH = 255;
/** Prefix for local branch refs */
export const BRANCH_REF_PREFIX = 'refs/heads/';
/** Prefix for remote tracking branch refs */
export const REMOTE_REF_PREFIX = 'refs/remotes/';
// ============================================================================
// Validation Functions
// ============================================================================
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
export function validateBranchName(name) {
    // Empty name is invalid
    if (!name || name.length === 0) {
        return { valid: false, error: 'Branch name cannot be empty' };
    }
    // Check max length
    if (name.length > MAX_BRANCH_NAME_LENGTH) {
        return { valid: false, error: `Branch name exceeds maximum length of ${MAX_BRANCH_NAME_LENGTH} characters` };
    }
    // HEAD is not a valid branch name
    if (name === 'HEAD') {
        return { valid: false, error: 'HEAD is not a valid branch name' };
    }
    // Cannot start with refs/
    if (name.startsWith('refs/')) {
        return { valid: false, error: 'Branch name cannot start with refs/' };
    }
    // Cannot start with dash
    if (name.startsWith('-')) {
        return { valid: false, error: 'Branch name cannot start with a dash' };
    }
    // Cannot contain spaces
    if (name.includes(' ')) {
        return { valid: false, error: 'Branch name cannot contain spaces' };
    }
    // Cannot contain double dots
    if (name.includes('..')) {
        return { valid: false, error: 'Branch name cannot contain double dots (..)' };
    }
    // Cannot contain consecutive slashes
    if (name.includes('//')) {
        return { valid: false, error: 'Branch name cannot contain consecutive slashes' };
    }
    // Cannot end with .lock
    if (name.endsWith('.lock')) {
        return { valid: false, error: 'Branch name cannot end with .lock' };
    }
    // Cannot end with slash or dot
    if (name.endsWith('/') || name.endsWith('.')) {
        return { valid: false, error: 'Branch name cannot end with / or .' };
    }
    // Cannot be exactly "@"
    if (name === '@') {
        return { valid: false, error: 'Branch name cannot be @' };
    }
    // Cannot contain @{
    if (name.includes('@{')) {
        return { valid: false, error: 'Branch name cannot contain @{' };
    }
    // Cannot contain control characters (ASCII 0-31, 127)
    const controlCharRegex = /[\x00-\x1f\x7f]/;
    if (controlCharRegex.test(name)) {
        return { valid: false, error: 'Branch name cannot contain control characters' };
    }
    // Cannot contain ~, ^, :, ?, *, [, \, space
    const invalidChars = /[~^:?*[\]\\]/;
    if (invalidChars.test(name)) {
        return { valid: false, error: 'Branch name contains invalid characters (~, ^, :, ?, *, [, ], \\)' };
    }
    // Check for non-ASCII characters (unicode)
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7F]/.test(name)) {
        return { valid: false, error: 'Branch name can only contain ASCII characters' };
    }
    // Normalize the name (strip refs/heads/ if present)
    const normalized = normalizeBranchName(name);
    return { valid: true, normalized };
}
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
export function isValidBranchName(name) {
    return validateBranchName(name).valid;
}
// ============================================================================
// Normalization Functions
// ============================================================================
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
export function normalizeBranchName(name) {
    if (name.startsWith(BRANCH_REF_PREFIX)) {
        return name.slice(BRANCH_REF_PREFIX.length);
    }
    return name;
}
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
export function getBranchRefName(name) {
    if (name.startsWith(BRANCH_REF_PREFIX)) {
        return name;
    }
    return `${BRANCH_REF_PREFIX}${name}`;
}
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
export function getRemoteRefName(remote, branch) {
    return `${REMOTE_REF_PREFIX}${remote}/${branch}`;
}
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
export function parseRemoteRef(ref) {
    // Handle full ref path
    if (ref.startsWith(REMOTE_REF_PREFIX)) {
        const path = ref.slice(REMOTE_REF_PREFIX.length);
        const slashIndex = path.indexOf('/');
        if (slashIndex === -1)
            return null;
        return {
            remote: path.slice(0, slashIndex),
            branch: path.slice(slashIndex + 1)
        };
    }
    // Handle short form like 'origin/main'
    const slashIndex = ref.indexOf('/');
    if (slashIndex === -1)
        return null;
    return {
        remote: ref.slice(0, slashIndex),
        branch: ref.slice(slashIndex + 1)
    };
}
//# sourceMappingURL=branch-validation.js.map