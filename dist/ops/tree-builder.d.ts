/**
 * Tree Builder - builds git tree objects from index entries
 *
 * Supports:
 * - File modes (100644 regular, 100755 executable, 040000 directory, 120000 symlink, 160000 submodule)
 * - Proper tree entry format (mode + space + name + null + sha)
 * - Sorted entries (git requires lexicographic ordering)
 * - Nested tree building for directory hierarchies
 * - Tree SHA computation
 * - Tree deduplication
 */
import { TreeEntry } from '../types/objects';
import type { BasicObjectStore as ObjectStore } from '../types/storage';
/**
 * Index entry from git index file
 */
export interface IndexEntry {
    path: string;
    sha: string;
    mode: string;
    flags: number;
    size: number;
    mtime: number;
    ctime: number;
}
/**
 * ObjectStore interface for tree builder operations.
 * Re-exported from storage types for convenience.
 */
export type { ObjectStore };
/**
 * Tree node for building hierarchy
 */
export interface TreeNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children: Map<string, TreeNode>;
    entry?: IndexEntry;
}
/**
 * Result of building a tree
 */
export interface BuildTreeResult {
    sha: string;
    entries: TreeEntry[];
    treeCount: number;
    uniqueTreeCount: number;
    deduplicatedCount: number;
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