/**
 * @fileoverview Git Reference Types and Utilities (Platform Agnostic)
 *
 * Re-exports from the core refs module with backward compatibility layer.
 *
 * @module @dotdo/gitx/refs
 */
// Re-export everything from the core refs module
export * from '../../core/refs';
// ============================================================================
// Legacy Types (for backward compatibility)
// ============================================================================
import { isValidSha } from '../../core/objects';
// ============================================================================
// Legacy Constants
// ============================================================================
/**
 * The zero SHA used to indicate ref creation or deletion in updates.
 */
export const ZERO_SHA = '0000000000000000000000000000000000000000';
/**
 * Common ref prefixes.
 */
export const REF_PREFIXES = {
    HEADS: 'refs/heads/',
    TAGS: 'refs/tags/',
    REMOTES: 'refs/remotes/',
    STASH: 'refs/stash',
    NOTES: 'refs/notes/',
};
/**
 * Validate a ref name according to Git rules.
 */
export function validateRefName(refName) {
    if (!refName || typeof refName !== 'string') {
        return { isValid: false, error: 'Ref name is required and must be a string' };
    }
    if (refName.startsWith('.') || refName.startsWith('/')) {
        return { isValid: false, error: 'Ref name cannot start with "." or "/"' };
    }
    if (refName.endsWith('/') || refName.endsWith('.')) {
        return { isValid: false, error: 'Ref name cannot end with "/" or "."' };
    }
    if (refName.includes('..')) {
        return { isValid: false, error: 'Ref name cannot contain ".."' };
    }
    if (refName.includes('//')) {
        return { isValid: false, error: 'Ref name cannot contain "//"' };
    }
    if (refName.endsWith('.lock')) {
        return { isValid: false, error: 'Ref name cannot end with ".lock"' };
    }
    if (/[\x00-\x1f\x7f ~^:?*\[\\]/.test(refName)) {
        return { isValid: false, error: 'Ref name contains invalid characters (control chars, space, ~, ^, :, ?, *, [, or \\)' };
    }
    return { isValid: true };
}
/**
 * Validate a ref update operation.
 */
export function validateRefUpdate(refName, oldSha, newSha) {
    const refResult = validateRefName(refName);
    if (!refResult.isValid) {
        return refResult;
    }
    if (oldSha !== ZERO_SHA && !isValidSha(oldSha)) {
        return { isValid: false, error: `Invalid old SHA: ${oldSha}. Must be 40 hex chars or zero SHA` };
    }
    if (newSha !== ZERO_SHA && !isValidSha(newSha)) {
        return { isValid: false, error: `Invalid new SHA: ${newSha}. Must be 40 hex chars or zero SHA` };
    }
    if (oldSha === ZERO_SHA && newSha === ZERO_SHA) {
        return { isValid: false, error: 'Cannot have both old and new SHA as zero (no-op)' };
    }
    return { isValid: true };
}
/**
 * Assert that a ref name is valid, throwing if not.
 */
export function assertValidRefName(refName) {
    const result = validateRefName(refName);
    if (!result.isValid) {
        throw new Error(result.error);
    }
}
// ============================================================================
// Legacy Utility Functions
// ============================================================================
/**
 * Check if a ref name is a branch ref.
 */
export function isBranchRef(refName) {
    return refName.startsWith(REF_PREFIXES.HEADS);
}
/**
 * Check if a ref name is a tag ref.
 */
export function isTagRef(refName) {
    return refName.startsWith(REF_PREFIXES.TAGS);
}
/**
 * Check if a ref name is a remote tracking ref.
 */
export function isRemoteRef(refName) {
    return refName.startsWith(REF_PREFIXES.REMOTES);
}
/**
 * Extract the short name from a full ref name.
 */
export function shortRefName(refName) {
    if (refName.startsWith(REF_PREFIXES.HEADS)) {
        return refName.slice(REF_PREFIXES.HEADS.length);
    }
    if (refName.startsWith(REF_PREFIXES.TAGS)) {
        return refName.slice(REF_PREFIXES.TAGS.length);
    }
    if (refName.startsWith(REF_PREFIXES.REMOTES)) {
        return refName.slice(REF_PREFIXES.REMOTES.length);
    }
    return refName;
}
/**
 * Convert a short branch name to a full ref name.
 */
export function toBranchRef(name) {
    if (name.startsWith('refs/')) {
        return name;
    }
    return `${REF_PREFIXES.HEADS}${name}`;
}
/**
 * Convert a short tag name to a full ref name.
 */
export function toTagRef(name) {
    if (name.startsWith('refs/')) {
        return name;
    }
    return `${REF_PREFIXES.TAGS}${name}`;
}
/**
 * Parse a ref line from Git protocol (format: "sha ref-name").
 */
export function parseRefLine(line) {
    const match = line.match(/^([0-9a-f]{40})\s+(.+)$/);
    if (!match) {
        return null;
    }
    const sha = match[1];
    const name = match[2];
    if (sha === undefined || name === undefined) {
        return null;
    }
    return { sha, name };
}
/**
 * Format a ref for Git protocol (format: "sha ref-name\n").
 */
export function formatRefLine(sha, name) {
    return `${sha} ${name}\n`;
}
//# sourceMappingURL=refs.js.map