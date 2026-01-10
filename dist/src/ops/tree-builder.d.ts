/**
 * @fileoverview Tree Builder - builds git tree objects from index entries
 *
 * Provides functionality for creating Git tree objects from a flat list
 * of index entries, handling directory hierarchies, proper sorting,
 * and deduplication.
 *
 * ## Features
 *
 * - File modes (100644 regular, 100755 executable, 040000 directory, 120000 symlink, 160000 submodule)
 * - Proper tree entry format (mode + space + name + null + sha)
 * - Sorted entries (git requires lexicographic ordering)
 * - Nested tree building for directory hierarchies
 * - Tree SHA computation
 * - Tree deduplication for identical subtrees
 *
 * ## Usage Example
 *
 * ```typescript
 * import { buildTreeFromIndex } from './ops/tree-builder'
 *
 * // Build tree from index entries
 * const entries = [
 *   { path: 'src/main.ts', sha: 'abc123...', mode: '100644', ... },
 *   { path: 'src/utils/helper.ts', sha: 'def456...', mode: '100644', ... },
 *   { path: 'README.md', sha: 'ghi789...', mode: '100644', ... }
 * ]
 *
 * const result = await buildTreeFromIndex(store, entries)
 * console.log('Root tree SHA:', result.sha)
 * console.log('Trees created:', result.treeCount)
 * console.log('Deduplicated:', result.deduplicatedCount)
 * ```
 *
 * @module ops/tree-builder
 */
import { TreeEntry } from '../types/objects';
import type { BasicObjectStore as ObjectStore } from '../types/storage';
/**
 * Index entry from git index file.
 *
 * Represents a single file entry as stored in the Git index (staging area).
 *
 * @interface IndexEntry
 *
 * @example
 * ```typescript
 * const entry: IndexEntry = {
 *   path: 'src/main.ts',
 *   sha: 'abc123def456...',
 *   mode: '100644',
 *   flags: 0,
 *   size: 1234,
 *   mtime: Date.now(),
 *   ctime: Date.now()
 * }
 * ```
 */
export interface IndexEntry {
    /** File path relative to repository root */
    path: string;
    /** SHA of the blob content */
    sha: string;
    /**
     * File mode:
     * - '100644': Regular file
     * - '100755': Executable file
     * - '120000': Symbolic link
     * - '160000': Git submodule
     */
    mode: string;
    /** Index flags (for merging, assume-unchanged, etc.) */
    flags: number;
    /** File size in bytes */
    size: number;
    /** Modification time (Unix timestamp or milliseconds) */
    mtime: number;
    /** Creation/change time (Unix timestamp or milliseconds) */
    ctime: number;
}
/**
 * ObjectStore interface for tree builder operations.
 * Re-exported from storage types for convenience.
 */
export type { ObjectStore };
/**
 * Tree node for building hierarchy.
 *
 * Represents a node in the intermediate tree structure used
 * during the build process.
 *
 * @interface TreeNode
 * @internal
 */
export interface TreeNode {
    /** Name of this node (file or directory name) */
    name: string;
    /** Full path from repository root */
    path: string;
    /** Whether this node represents a directory */
    isDirectory: boolean;
    /** Child nodes (for directories) */
    children: Map<string, TreeNode>;
    /** The index entry (only set for files, not directories) */
    entry?: IndexEntry;
}
/**
 * Result of building a tree.
 *
 * Contains the root tree SHA, statistics about the build,
 * and optionally detailed information about subtrees.
 *
 * @interface BuildTreeResult
 *
 * @example
 * ```typescript
 * const result = await buildTreeFromIndex(store, entries)
 *
 * console.log(`Root SHA: ${result.sha}`)
 * console.log(`Created ${result.treeCount} tree objects`)
 * console.log(`${result.deduplicatedCount} were deduplicated`)
 *
 * // Access subtree information if available
 * if (result.subtrees) {
 *   for (const [name, subtree] of Object.entries(result.subtrees)) {
 *     console.log(`${name}/: ${subtree.sha}`)
 *   }
 * }
 * ```
 */
export interface BuildTreeResult {
    /** SHA of the root tree object */
    sha: string;
    /** Tree entries at this level */
    entries: TreeEntry[];
    /** Total number of tree objects processed */
    treeCount: number;
    /** Number of unique tree objects created */
    uniqueTreeCount: number;
    /** Number of trees that were deduplicated (reused existing) */
    deduplicatedCount: number;
    /**
     * Nested subtree results.
     * Keys are directory names, values are their BuildTreeResult.
     */
    subtrees?: Record<string, BuildTreeResult>;
}
/**
 * Build a tree hierarchy from index entries
 */
export declare function buildTreeHierarchy(entries: IndexEntry[]): TreeNode;
/**
 * Sort tree entries according to git conventions
 * Directories are sorted as if they have a trailing slash
 */
export declare function sortTreeEntries(entries: TreeEntry[]): TreeEntry[];
/**
 * Create a tree object and store it
 */
export declare function createTreeObject(store: ObjectStore, entries: TreeEntry[]): Promise<{
    sha: string;
    type: 'tree';
    data: Uint8Array;
}>;
/**
 * Deduplicate trees based on their content hash
 * Returns a map of canonical tree content to path, and mapping of paths to canonical paths
 */
export declare function deduplicateTrees(trees: Map<string, TreeEntry[]>): {
    deduplicated: Map<string, TreeEntry[]>;
    mapping: Map<string, string>;
};
/**
 * Build tree from index entries
 * This is the main entry point for tree building
 */
export declare function buildTreeFromIndex(store: ObjectStore, entries: IndexEntry[]): Promise<BuildTreeResult>;
//# sourceMappingURL=tree-builder.d.ts.map