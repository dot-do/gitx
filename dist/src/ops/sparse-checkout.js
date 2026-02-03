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
import { parseTree } from '../types/objects';
/**
 * Convert a glob pattern segment to a regex string.
 */
function globSegmentToRegex(segment) {
    let result = '';
    let i = 0;
    while (i < segment.length) {
        const ch = segment[i];
        if (ch === '*') {
            if (i + 1 < segment.length && segment[i + 1] === '*') {
                // ** matches everything including /
                result += '.*';
                i += 2;
                // skip trailing slash after **
                if (i < segment.length && segment[i] === '/') {
                    i++;
                }
                continue;
            }
            // single * matches anything except /
            result += '[^/]*';
        }
        else if (ch === '?') {
            result += '[^/]';
        }
        else if (ch === '[') {
            // character class - pass through
            const close = segment.indexOf(']', i + 1);
            if (close === -1) {
                result += '\\[';
            }
            else {
                result += segment.slice(i, close + 1);
                i = close;
            }
        }
        else if (ch && '.+^${}()|\\'.includes(ch)) {
            result += '\\' + ch;
        }
        else if (ch) {
            result += ch;
        }
        i++;
    }
    return result;
}
/**
 * Compile a sparse checkout pattern string into a SparsePattern.
 */
export function compilePattern(pattern) {
    // Skip comments and empty lines
    const trimmed = pattern.trim();
    if (!trimmed || trimmed.startsWith('#')) {
        return null;
    }
    let p = trimmed;
    const negate = p.startsWith('!');
    if (negate)
        p = p.slice(1);
    const anchored = p.startsWith('/');
    if (anchored)
        p = p.slice(1);
    const directoryOnly = p.endsWith('/');
    if (directoryOnly)
        p = p.slice(0, -1);
    // Build regex
    let regexStr = globSegmentToRegex(p);
    if (anchored) {
        regexStr = '^' + regexStr;
    }
    else {
        // Unanchored patterns match at any depth
        regexStr = '(?:^|/)' + regexStr;
    }
    // Directory-only patterns match the dir itself and everything under it
    if (directoryOnly) {
        regexStr = regexStr + '(?:/|$)';
    }
    else {
        regexStr = regexStr + '(?:/.*)?$';
    }
    return {
        original: trimmed,
        negate,
        anchored,
        directoryOnly,
        regex: new RegExp(regexStr),
    };
}
/**
 * Sparse checkout controller.
 *
 * Holds a set of compiled patterns and provides methods for testing
 * whether paths should be included in a sparse checkout.
 */
export class SparseCheckout {
    /** Compiled patterns in order */
    patterns;
    /**
     * Create a SparseCheckout from pattern strings.
     *
     * @param patternStrings - Array of sparse checkout pattern strings
     */
    constructor(patternStrings) {
        this.patterns = [];
        for (const p of patternStrings) {
            const compiled = compilePattern(p);
            if (compiled) {
                this.patterns.push(compiled);
            }
        }
    }
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
    matches(path, isDirectory = false) {
        let included = false;
        for (const pattern of this.patterns) {
            // Directory-only patterns skip non-directories
            if (pattern.directoryOnly && !isDirectory) {
                // But still match files *under* the directory
                // The regex already handles this with (?:/|$)
            }
            if (pattern.regex.test(path)) {
                included = !pattern.negate;
            }
        }
        return included;
    }
    /**
     * Test whether a directory could contain any matching paths.
     *
     * This is used for pruning during tree traversal - if a directory
     * cannot possibly contain matching paths, we skip recursing into it.
     *
     * @param dirPath - Directory path relative to repository root
     * @returns true if the directory might contain matching paths
     */
    couldContainMatches(dirPath) {
        // A directory could contain matches if any non-negated pattern
        // could match something under this directory
        for (const pattern of this.patterns) {
            if (pattern.negate)
                continue;
            // Check if the pattern could match paths under dirPath
            const testPath = dirPath + '/x';
            if (pattern.regex.test(testPath))
                return true;
            // Also check if dirPath is a prefix of the pattern's fixed portion
            // This handles cases like pattern "/src/foo/" and dirPath "src"
            const patternPath = pattern.original.replace(/^[!/]+/, '').replace(/\/+$/, '');
            if (patternPath.startsWith(dirPath + '/') || patternPath === dirPath) {
                return true;
            }
        }
        return false;
    }
    /**
     * Return the number of active (non-comment, non-empty) patterns.
     */
    get size() {
        return this.patterns.length;
    }
    /**
     * Check if sparse checkout is effectively empty (no patterns).
     */
    get isEmpty() {
        return this.patterns.length === 0;
    }
}
/**
 * Filter tree entries at a single level based on sparse checkout patterns.
 *
 * @param entries - Tree entries to filter
 * @param basePath - Path prefix for this tree level (empty string for root)
 * @param sparse - SparseCheckout instance
 * @returns Filtered entries
 */
export function filterEntries(entries, basePath, sparse) {
    const filtered = [];
    const total = entries.length;
    for (const entry of entries) {
        const fullPath = basePath ? basePath + '/' + entry.name : entry.name;
        const isDir = entry.mode === '040000';
        if (isDir) {
            // Include directory if it matches or could contain matches
            if (sparse.matches(fullPath, true) || sparse.couldContainMatches(fullPath)) {
                filtered.push(entry);
            }
        }
        else {
            if (sparse.matches(fullPath, false)) {
                filtered.push(entry);
            }
        }
    }
    return {
        entries: filtered,
        excludedCount: total - filtered.length,
        totalCount: total,
    };
}
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
export async function filterTreeEntries(store, treeSha, sparse, basePath = '') {
    const obj = await store.getObject(treeSha);
    if (!obj || obj.type !== 'tree') {
        throw new Error(`Object ${treeSha} is not a tree`);
    }
    const treeObj = parseTree(obj.data);
    const matchedPaths = [];
    for (const entry of treeObj.entries) {
        const fullPath = basePath ? basePath + '/' + entry.name : entry.name;
        const isDir = entry.mode === '040000';
        if (isDir) {
            // Only recurse if the directory could contain matches
            if (sparse.matches(fullPath, true) || sparse.couldContainMatches(fullPath)) {
                const subPaths = await filterTreeEntries(store, entry.sha, sparse, fullPath);
                matchedPaths.push(...subPaths);
            }
        }
        else {
            if (sparse.matches(fullPath, false)) {
                matchedPaths.push(fullPath);
            }
        }
    }
    return matchedPaths;
}
//# sourceMappingURL=sparse-checkout.js.map