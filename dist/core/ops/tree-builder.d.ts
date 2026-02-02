/**
 * @fileoverview Tree Builder - builds git tree objects from index entries
 *
 * Provides functionality for creating Git tree objects from a flat list
 * of index entries, handling directory hierarchies, proper sorting,
 * and deduplication.
 *
 * @module ops/tree-builder
 */
import type { TreeEntry } from '../objects/types';
import type { BasicObjectStore } from '../types';
/**
 * Index entry from git index file.
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
 */
export interface ObjectStore extends BasicObjectStore {
    storeObject(type: string, data: Uint8Array): Promise<string>;
}
/**
 * Tree node for building hierarchy.
 */
export interface TreeNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children: Map<string, TreeNode>;
    entry?: IndexEntry;
}
/**
 * Result of building a tree.
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
 */
export declare function deduplicateTrees(trees: Map<string, TreeEntry[]>): {
    deduplicated: Map<string, TreeEntry[]>;
    mapping: Map<string, string>;
};
/**
 * Build tree from index entries
 */
export declare function buildTreeFromIndex(store: ObjectStore, entries: IndexEntry[]): Promise<BuildTreeResult>;
//# sourceMappingURL=tree-builder.d.ts.map