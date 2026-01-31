/**
 * @fileoverview Tree Diff Operations
 *
 * This module provides functionality for comparing Git trees and detecting
 * changes between them, including added, deleted, modified, renamed, and
 * copied files.
 *
 * @module ops/tree-diff
 */
import type { TreeEntry } from '../objects/types';
/**
 * Status of a file in a diff.
 */
export declare enum DiffStatus {
    ADDED = "A",
    DELETED = "D",
    MODIFIED = "M",
    RENAMED = "R",
    COPIED = "C",
    TYPE_CHANGED = "T",
    UNMERGED = "U"
}
/**
 * File mode constants for Git objects
 */
export declare enum FileMode {
    REGULAR = "100644",
    EXECUTABLE = "100755",
    SYMLINK = "120000",
    GITLINK = "160000",
    TREE = "040000"
}
/**
 * Represents a single entry in a diff result
 */
export interface DiffEntry {
    path: string;
    status: DiffStatus;
    oldMode: string | null;
    newMode: string | null;
    oldSha: string | null;
    newSha: string | null;
    oldPath?: string;
    similarity?: number;
    isBinary?: boolean;
}
/**
 * Options for tree diff operations
 */
export interface DiffOptions {
    detectRenames?: boolean;
    detectCopies?: boolean;
    similarityThreshold?: number;
    pathspecs?: string[];
    excludePaths?: string[];
    detectBinary?: boolean;
    maxRenameSize?: number;
    recursive?: boolean;
    nameOnly?: boolean;
    nameStatus?: boolean;
}
/**
 * Result of a tree diff operation
 */
export interface DiffResult {
    entries: DiffEntry[];
    stats: {
        added: number;
        deleted: number;
        modified: number;
        renamed: number;
        copied: number;
    };
}
/**
 * ObjectStore interface for tree diff operations.
 */
export interface ObjectStore {
    getTree(sha: string): Promise<{
        entries: TreeEntry[];
    } | null>;
    getBlob(sha: string): Promise<Uint8Array | null>;
}
/**
 * Represents an index entry for diff-to-index operations
 */
export interface IndexEntry {
    path: string;
    mode: string;
    sha: string;
    stage: number;
    mtime?: number;
    size?: number;
}
/**
 * Check if a file appears to be binary based on its content
 */
export declare function isBinaryContent(content: Uint8Array): boolean;
/**
 * Calculate similarity between two blobs for rename/copy detection
 */
export declare function calculateSimilarity(store: ObjectStore, oldSha: string, newSha: string): Promise<number>;
/**
 * Parse a file mode string and determine its type
 */
export declare function parseMode(mode: string): {
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    isSubmodule: boolean;
    isExecutable: boolean;
};
/**
 * Check if a mode change represents a significant type change
 */
export declare function isModeChangeSignificant(oldMode: string, newMode: string): boolean;
/**
 * Filter diff entries by pathspecs
 */
export declare function filterByPathspecs(entries: DiffEntry[], pathspecs?: string[], excludePaths?: string[]): DiffEntry[];
/**
 * Recursively walk a tree and collect all entries with full paths
 */
export declare function walkTree(store: ObjectStore, treeSha: string, prefix?: string): Promise<Array<TreeEntry & {
    fullPath: string;
}>>;
/**
 * Compare two trees and return the differences
 */
export declare function diffTrees(store: ObjectStore, oldTreeSha: string | null, newTreeSha: string | null, options?: DiffOptions): Promise<DiffResult>;
/**
 * Detect renames in a set of diff entries
 */
export declare function detectRenames(store: ObjectStore, entries: DiffEntry[], options?: DiffOptions): Promise<DiffEntry[]>;
/**
 * Detect copies in a set of diff entries
 */
export declare function detectCopies(store: ObjectStore, entries: DiffEntry[], existingPaths: Map<string, string>, options?: DiffOptions): Promise<DiffEntry[]>;
/**
 * Compare a tree to the index (staging area)
 */
export declare function diffTreeToIndex(store: ObjectStore, treeSha: string | null, index: IndexEntry[], options?: DiffOptions): Promise<DiffResult>;
/**
 * Compare a tree to working directory entries
 */
export declare function diffTreeToWorktree(store: ObjectStore, treeSha: string | null, workingEntries: IndexEntry[], options?: DiffOptions): Promise<DiffResult>;
//# sourceMappingURL=tree-diff.d.ts.map