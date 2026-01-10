/**
 * @fileoverview Git Reference Types and Utilities (Platform Agnostic)
 *
 * Re-exports from the core refs module with backward compatibility layer.
 *
 * @module @dotdo/gitx/refs
 */
export * from '../../core/refs';
/**
 * A Git reference (branch, tag, or symbolic ref like HEAD).
 * @deprecated Use SymbolicRef or DirectRef from core/refs
 */
export interface Ref {
    name: string;
    target: string;
    type: 'direct' | 'symbolic';
}
/**
 * Result of a ref update operation.
 */
export interface RefUpdateResult {
    success: boolean;
    oldValue: string | null;
    newValue: string;
    error?: string;
}
/**
 * Options for listing refs.
 */
export interface ListRefsOptions {
    prefix?: string;
    includeSymbolic?: boolean;
    limit?: number;
}
/**
 * The zero SHA used to indicate ref creation or deletion in updates.
 */
export declare const ZERO_SHA = "0000000000000000000000000000000000000000";
/**
 * Common ref prefixes.
 */
export declare const REF_PREFIXES: {
    readonly HEADS: "refs/heads/";
    readonly TAGS: "refs/tags/";
    readonly REMOTES: "refs/remotes/";
    readonly STASH: "refs/stash";
    readonly NOTES: "refs/notes/";
};
/**
 * Validation result type.
 */
export interface ValidationResult {
    isValid: boolean;
    error?: string;
}
/**
 * Validate a ref name according to Git rules.
 */
export declare function validateRefName(refName: string): ValidationResult;
/**
 * Validate a ref update operation.
 */
export declare function validateRefUpdate(refName: string, oldSha: string, newSha: string): ValidationResult;
/**
 * Assert that a ref name is valid, throwing if not.
 */
export declare function assertValidRefName(refName: string): void;
/**
 * Check if a ref name is a branch ref.
 */
export declare function isBranchRef(refName: string): boolean;
/**
 * Check if a ref name is a tag ref.
 */
export declare function isTagRef(refName: string): boolean;
/**
 * Check if a ref name is a remote tracking ref.
 */
export declare function isRemoteRef(refName: string): boolean;
/**
 * Extract the short name from a full ref name.
 */
export declare function shortRefName(refName: string): string;
/**
 * Convert a short branch name to a full ref name.
 */
export declare function toBranchRef(name: string): string;
/**
 * Convert a short tag name to a full ref name.
 */
export declare function toTagRef(name: string): string;
/**
 * Parse a ref line from Git protocol (format: "sha ref-name").
 */
export declare function parseRefLine(line: string): {
    sha: string;
    name: string;
} | null;
/**
 * Format a ref for Git protocol (format: "sha ref-name\n").
 */
export declare function formatRefLine(sha: string, name: string): string;
//# sourceMappingURL=refs.d.ts.map