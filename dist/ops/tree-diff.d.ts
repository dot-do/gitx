/**
 * Tree Diff Operations
 *
 * This module provides functionality for comparing Git trees and detecting
 * changes between them, including added, deleted, modified, renamed, and
 * copied files.
 */
import type { TreeEntry } from '../types/objects';
import type { TreeDiffObjectStore as ObjectStore } from '../types/storage';
/**
 * Status of a file in a diff
 */
export declare enum DiffStatus {
    /** File was added */
    ADDED = "A",
    /** File was deleted */
    DELETED = "D",
    /** File was modified */
    MODIFIED = "M",
    /** File was renamed */
    RENAMED = "R",
    /** File was copied */
    COPIED = "C",
    /** File type changed (e.g., file to symlink) */
    TYPE_CHANGED = "T",
    /** Unmerged (conflict) */
    UNMERGED = "U"
}
/**
 * File mode constants for Git objects
 */
export declare enum FileMode {
    /** Regular file (not executable) */
    REGULAR = "100644",
    /** Executable file */
    EXECUTABLE = "100755",
    /** Symbolic link */
    SYMLINK = "120000",
    /** Git submodule (gitlink) */
    GITLINK = "160000",
    /** Directory (tree) */
    TREE = "040000"
}
/**
 * Represents a single entry in a diff result
 */
export interface DiffEntry {
    /** Path to the file (new path for renames/copies) */
    path: string;
    /** Status of the change */
    status: DiffStatus;
    /** Old file mode (null for added files) */
    oldMode: string | null;
    /** New file mode (null for deleted files) */
    newMode: string | null;
    /** Old object SHA (null for added files) */
    oldSha: string | null;
    /** New object SHA (null for deleted files) */
    newSha: string | null;
    /** Original path (for renames/copies) */
    oldPath?: string;
    /** Similarity percentage (for renames/copies, 0-100) */
    similarity?: number;
    /** Whether the file is binary */
    isBinary?: boolean;
}
/**
 * Options for tree diff operations
 */
export interface DiffOptions {
    /** Enable rename detection (default: true) */
    detectRenames?: boolean;
    /** Enable copy detection (default: false) */
    detectCopies?: boolean;
    /** Similarity threshold for rename/copy detection (0-100, default: 50) */
    similarityThreshold?: number;
    /** Filter paths by glob patterns (include) */
    pathspecs?: string[];
    /** Paths to exclude */
    excludePaths?: string[];
    /** Include binary file detection (default: true) */
    detectBinary?: boolean;
    /** Maximum file size to consider for rename/copy detection */
    maxRenameSize?: number;
    /** Whether to recurse into subdirectories (default: true) */
    recursive?: boolean;
    /** Only show names, not full diff info */
    nameOnly?: boolean;
    /** Show only file status, not diff content */
    nameStatus?: boolean;
}
/**
 * Result of a tree diff operation
 */
export interface DiffResult {
    /** List of diff entries */
    entries: DiffEntry[];
    /** Statistics about the diff */
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
 * Re-exported from storage types for convenience.
 */
export type { ObjectStore };
/**
 * Represents an index entry for diff-to-index operations
 */
export interface IndexEntry {
    path: string;
    mode: string;
    sha: string;
    /** Stage number (0 = normal, 1-3 = merge conflict stages) */
    stage: number;
    /** File modification time */
    mtime?: number;
    /** File size */
    size?: number;
}
/**
 * Check if a file appears to be binary based on its content
 *
 * A file is considered binary if it contains null bytes in the first
 * 8000 bytes (similar to Git's heuristic).
 *
 * @param content - File content to check
 * @returns true if the file appears to be binary
 */
export declare function isBinaryContent(content: Uint8Array): boolean;
/**
 * Calculate similarity between two blobs for rename/copy detection
 *
 * Uses a simple heuristic based on shared content.
 *
 * @param store - Object store for retrieving blob contents
 * @param oldSha - SHA of the old blob
 * @param newSha - SHA of the new blob
 * @returns Promise resolving to similarity percentage (0-100)
 */
export declare function calculateSimilarity(store: ObjectStore, oldSha: string, newSha: string): Promise<number>;
/**
 * Parse a file mode string and determine its type
 *
 * @param mode - File mode string (e.g., '100644', '040000')
 * @returns Object with mode information
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
 *
 * @param oldMode - Old file mode
 * @param newMode - New file mode
 * @returns true if the mode change is significant (e.g., file to symlink)
 */
export declare function isModeChangeSignificant(oldMode: string, newMode: string): boolean;
/**
 * Filter diff entries by pathspecs
 *
 * @param entries - Diff entries to filter
 * @param pathspecs - Glob patterns to include
 * @param excludePaths - Paths to exclude
 * @returns Filtered entries
 */
export declare function filterByPathspecs(entries: DiffEntry[], pathspecs?: string[], excludePaths?: string[]): DiffEntry[];
/**
 * Recursively walk a tree and collect all entries with full paths
 *
 * @param store - Object store for retrieving tree contents
 * @param treeSha - SHA of the tree to walk
 * @param prefix - Path prefix for entries
 * @returns Promise resolving to flat list of entries with full paths
 */
export declare function walkTree(store: ObjectStore, treeSha: string, prefix?: string): Promise<Array<TreeEntry & {
    fullPath: string;
}>>;
/**
 * Compare two trees and return the differences
 *
 * @param store - Object store for retrieving tree contents
 * @param oldTreeSha - SHA of the old tree (null for initial commit comparison)
 * @param newTreeSha - SHA of the new tree (null to compare against empty)
 * @param options - Diff options
 * @returns Promise resolving to diff result
 */
export declare function diffTrees(store: ObjectStore, oldTreeSha: string | null, newTreeSha: string | null, options?: DiffOptions): Promise<DiffResult>;
/**
 * Detect renames in a set of diff entries
 *
 * This function takes a list of added and deleted files and attempts to
 * match them based on content similarity to detect renames.
 *
 * @param store - Object store for retrieving blob contents
 * @param entries - Initial diff entries (before rename detection)
 * @param options - Diff options (particularly similarityThreshold)
 * @returns Promise resolving to entries with renames detected
 */
export declare function detectRenames(store: ObjectStore, entries: DiffEntry[], options?: DiffOptions): Promise<DiffEntry[]>;
/**
 * Detect copies in a set of diff entries
 *
 * This function takes a list of diff entries and attempts to detect
 * if any added files are copies of existing files.
 *
 * @param store - Object store for retrieving blob contents
 * @param entries - Initial diff entries
 * @param existingPaths - Map of existing paths to their SHAs
 * @param options - Diff options
 * @returns Promise resolving to entries with copies detected
 */
export declare function detectCopies(store: ObjectStore, entries: DiffEntry[], existingPaths: Map<string, string>, options?: DiffOptions): Promise<DiffEntry[]>;
/**
 * Compare a tree to the index (staging area)
 *
 * @param store - Object store for retrieving tree contents
 * @param treeSha - SHA of the tree to compare (typically HEAD)
 * @param index - Index entries to compare against
 * @param options - Diff options
 * @returns Promise resolving to diff result
 */
export declare function diffTreeToIndex(store: ObjectStore, treeSha: string | null, index: IndexEntry[], options?: DiffOptions): Promise<DiffResult>;
/**
 * Compare a tree to working directory entries
 *
 * @param store - Object store for retrieving tree contents
 * @param treeSha - SHA of the tree to compare
 * @param workingEntries - Working directory file entries
 * @param options - Diff options
 * @returns Promise resolving to diff result
 */
export declare function diffTreeToWorktree(store: ObjectStore, treeSha: string | null, workingEntries: IndexEntry[], options?: DiffOptions): Promise<DiffResult>;
//# sourceMappingURL=tree-diff.d.ts.map