/**
 * @fileoverview Sparse Checkout - pattern-based tree entry filtering
 *
 * Implements sparse checkout functionality that filters tree entries based on
 * glob-like patterns, so only a subset of files are materialized during checkout.
 *
 * Supports the same pattern syntax as git's sparse-checkout:
 * - Leading `/` anchors to repository root
 * - Trailing `/` matches directories only
 * - `*` matches anything except `/`
 * - `**` matches zero or more path components
 * - `!` prefix negates a pattern (re-includes previously excluded paths)
 * - `#` prefix for comments
 *
 * ## Usage Example
 *
 * ```typescript
 * import { SparseCheckout, filterTreeEntries } from './ops/sparse-checkout'
 *
 * const sparse = new SparseCheckout([
 *   '/src/',
 *   '/README.md',
 *   '!/src/vendor/',
 * ])
 *
 * // Check individual paths
 * sparse.matches('src/main.ts')        // true
 * sparse.matches('docs/guide.md')      // false
 * sparse.matches('src/vendor/lib.ts')  // false (negated)
 *
 * // Filter tree entries in bulk
 * const filtered = await filterTreeEntries(store, treeSha, sparse)
 * ```
 *
 * @module ops/sparse-checkout
 */
import type { TreeEntry } from '../types/objects';
import type { BasicObjectStore as ObjectStore } from '../types/storage';
/**
 * A compiled sparse checkout pattern.
 *
 * @interface SparsePattern
 */
export interface SparsePattern {
    /** Original pattern string */
    original: string;
    /** Whether this is a negation pattern (prefixed with !) */
    negate: boolean;
    /** Whether anchored to root (prefixed with /) */
    anchored: boolean;
    /** Whether this only matches directories (trailing /) */
    directoryOnly: boolean;
    /** Compiled regex for matching */
    regex: RegExp;
}
/**
 * Result of filtering a tree with sparse checkout patterns.
 *
 * @interface SparseFilterResult
 */
export interface SparseFilterResult {
    /** Filtered tree entries that match the sparse patterns */
    entries: TreeEntry[];
    /** Number of entries that were excluded */
    excludedCount: number;
    /** Total entries before filtering */
    totalCount: number;
}
/**
 * Compile a sparse checkout pattern string into a SparsePattern.
 */
export declare function compilePattern(pattern: string): SparsePattern | null;
/**
 * Sparse checkout controller.
 *
 * Holds a set of compiled patterns and provides methods for testing
 * whether paths should be included in a sparse checkout.
 */
export declare class SparseCheckout {
    /** Compiled patterns in order */
    readonly patterns: SparsePattern[];
    /**
     * Create a SparseCheckout from pattern strings.
     *
     * @param patternStrings - Array of sparse checkout pattern strings
     */
    constructor(patternStrings: string[]);
    /**
     * Test whether a path matches the sparse checkout patterns.
     *
     * Patterns are evaluated in order. The last matching pattern wins.
     * If no pattern matches, the path is excluded (sparse checkout
     * defaults to excluding everything not explicitly included).
     *
     * @param path - File path relative to repository root (no leading /)
     * @param isDirectory - Whether the path represents a directory
     * @returns true if the path should be included
     */
    matches(path: string, isDirectory?: boolean): boolean;
    /**
     * Test whether a directory could contain any matching paths.
     *
     * This is used for pruning during tree traversal - if a directory
     * cannot possibly contain matching paths, we skip recursing into it.
     *
     * @param dirPath - Directory path relative to repository root
     * @returns true if the directory might contain matching paths
     */
    couldContainMatches(dirPath: string): boolean;
    /**
     * Return the number of active (non-comment, non-empty) patterns.
     */
    get size(): number;
    /**
     * Check if sparse checkout is effectively empty (no patterns).
     */
    get isEmpty(): boolean;
}
/**
 * Filter tree entries at a single level based on sparse checkout patterns.
 *
 * @param entries - Tree entries to filter
 * @param basePath - Path prefix for this tree level (empty string for root)
 * @param sparse - SparseCheckout instance
 * @returns Filtered entries
 */
export declare function filterEntries(entries: TreeEntry[], basePath: string, sparse: SparseCheckout): SparseFilterResult;
/**
 * Recursively walk a tree and collect all file paths that match
 * the sparse checkout patterns.
 *
 * @param store - Object store for reading tree objects
 * @param treeSha - SHA of the root tree
 * @param sparse - SparseCheckout instance
 * @param basePath - Current path prefix (used in recursion)
 * @returns Array of matching file paths
 */
export declare function filterTreeEntries(store: ObjectStore, treeSha: string, sparse: SparseCheckout, basePath?: string): Promise<string[]>;
//# sourceMappingURL=sparse-checkout.d.ts.map