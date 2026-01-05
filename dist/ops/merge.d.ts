/**
 * Three-way merge implementation for Git
 *
 * This module provides functionality for merging branches using
 * three-way merge algorithm, including conflict detection and resolution.
 */
/**
 * Types of merge conflicts that can occur
 */
export type ConflictType = 'content' | 'add-add' | 'modify-delete' | 'delete-modify' | 'rename-rename' | 'rename-delete' | 'directory-file';
/**
 * Merge strategies available
 */
export type MergeStrategy = 'recursive' | 'ours' | 'theirs' | 'octopus' | 'subtree';
/**
 * Status of a merge operation
 */
export type MergeStatus = 'fast-forward' | 'merged' | 'conflicted' | 'up-to-date' | 'aborted' | 'in-progress';
/**
 * Represents a conflict marker position in a file
 */
export interface ConflictMarker {
    /** Line number where marker starts (1-indexed) */
    startLine: number;
    /** Line number where marker ends (1-indexed) */
    endLine: number;
    /** The conflicting content from the base version */
    baseContent?: string;
    /** The conflicting content from our (current) version */
    oursContent: string;
    /** The conflicting content from theirs (merged) version */
    theirsContent: string;
}
/**
 * Represents a single merge conflict
 */
export interface MergeConflict {
    /** Type of conflict */
    type: ConflictType;
    /** Path to the conflicted file */
    path: string;
    /** SHA of the file in base (common ancestor) */
    baseSha?: string;
    /** SHA of the file in our (current) branch */
    oursSha?: string;
    /** SHA of the file in their (merged) branch */
    theirsSha?: string;
    /** Mode of the file in base */
    baseMode?: string;
    /** Mode of the file in ours */
    oursMode?: string;
    /** Mode of the file in theirs */
    theirsMode?: string;
    /** Content with conflict markers if type is 'content' */
    conflictedContent?: Uint8Array;
    /** Detailed conflict markers for content conflicts */
    markers?: ConflictMarker[];
    /** Original path if this was a rename */
    originalPath?: string;
    /** Renamed path(s) in case of rename conflicts */
    renamedPaths?: {
        ours?: string;
        theirs?: string;
    };
}
/**
 * Options for merge operations
 */
export interface MergeOptions {
    /** Merge strategy to use (default: 'recursive') */
    strategy?: MergeStrategy;
    /** Whether to allow fast-forward merges (default: true) */
    allowFastForward?: boolean;
    /** Force fast-forward only, fail if not possible (default: false) */
    fastForwardOnly?: boolean;
    /** Automatically resolve conflicts using strategy (default: false) */
    autoResolve?: boolean;
    /** Strategy option for conflict resolution when autoResolve is true */
    conflictStrategy?: 'ours' | 'theirs' | 'union';
    /** Commit message for merge commit */
    message?: string;
    /** Do not create a merge commit, leave changes staged */
    noCommit?: boolean;
    /** Squash commits from the merged branch */
    squash?: boolean;
    /** For octopus merges: list of additional branch SHAs */
    additionalBranches?: string[];
    /** Rename detection threshold (0-100, default: 50) */
    renameThreshold?: number;
    /** Whether to detect renames (default: true) */
    detectRenames?: boolean;
    /** Whether to detect copies (default: false) */
    detectCopies?: boolean;
    /** Author for the merge commit */
    author?: {
        name: string;
        email: string;
        timestamp?: number;
        timezone?: string;
    };
    /** Committer for the merge commit */
    committer?: {
        name: string;
        email: string;
        timestamp?: number;
        timezone?: string;
    };
}
/**
 * Statistics about the merge operation
 */
export interface MergeStats {
    /** Number of files added */
    filesAdded: number;
    /** Number of files modified */
    filesModified: number;
    /** Number of files deleted */
    filesDeleted: number;
    /** Number of files renamed */
    filesRenamed: number;
    /** Number of binary files changed */
    binaryFilesChanged: number;
    /** Total lines added (text files only) */
    linesAdded: number;
    /** Total lines removed (text files only) */
    linesRemoved: number;
}
/**
 * Result of a merge operation
 */
export interface MergeResult {
    /** Status of the merge */
    status: MergeStatus;
    /** SHA of the resulting merge commit (if created) */
    commitSha?: string;
    /** SHA of the resulting tree */
    treeSha?: string;
    /** Common ancestor commit SHA */
    baseSha?: string;
    /** SHA of the current branch before merge */
    oursSha: string;
    /** SHA of the merged branch */
    theirsSha: string;
    /** List of conflicts if status is 'conflicted' */
    conflicts?: MergeConflict[];
    /** Statistics about the merge */
    stats?: MergeStats;
    /** Message for the merge (user-provided or auto-generated) */
    message?: string;
    /** Whether the merge was a fast-forward */
    fastForward: boolean;
}
/**
 * State of an in-progress merge (stored in .git/MERGE_HEAD, etc.)
 */
export interface MergeState {
    /** SHA of the commit being merged */
    mergeHead: string;
    /** SHA of the original HEAD before merge */
    origHead: string;
    /** Commit message for the merge */
    message: string;
    /** Merge mode (for special merges) */
    mode?: 'squash' | 'no-ff';
    /** List of unresolved conflicts */
    unresolvedConflicts: MergeConflict[];
    /** List of resolved conflicts */
    resolvedConflicts: MergeConflict[];
    /** Options used for the merge */
    options: MergeOptions;
}
/**
 * Options for resolving a conflict
 */
export interface ResolveOptions {
    /** Resolution strategy */
    resolution: 'ours' | 'theirs' | 'base' | 'custom';
    /** Custom content when resolution is 'custom' */
    customContent?: Uint8Array;
    /** Custom mode when resolution is 'custom' */
    customMode?: string;
}
/**
 * Result of conflict resolution
 */
export interface ResolveResult {
    /** Whether resolution was successful */
    success: boolean;
    /** Path that was resolved */
    path: string;
    /** Error message if resolution failed */
    error?: string;
    /** Remaining unresolved conflicts */
    remainingConflicts: number;
}
/**
 * Result of abort or continue operations
 */
export interface MergeOperationResult {
    /** Whether the operation was successful */
    success: boolean;
    /** Error message if operation failed */
    error?: string;
    /** Current HEAD SHA after operation */
    headSha?: string;
    /** Status message */
    message?: string;
}
/**
 * Extended object type that may include parsed commit/tree data
 */
interface ExtendedObject {
    type: string;
    data: Uint8Array;
    tree?: string;
    parents?: string[];
    entries?: Array<{
        mode: string;
        name: string;
        sha: string;
    }>;
}
/**
 * Interface for the storage layer used by merge operations
 */
export interface MergeStorage {
    /** Read an object by SHA */
    readObject(sha: string): Promise<ExtendedObject | null>;
    /** Write an object and return its SHA */
    writeObject(type: string, data: Uint8Array): Promise<string>;
    /** Read a reference */
    readRef(ref: string): Promise<string | null>;
    /** Write a reference */
    writeRef(ref: string, sha: string): Promise<void>;
    /** Read merge state */
    readMergeState(): Promise<MergeState | null>;
    /** Write merge state */
    writeMergeState(state: MergeState): Promise<void>;
    /** Delete merge state */
    deleteMergeState(): Promise<void>;
    /** Stage a file for the index */
    stageFile(path: string, sha: string, mode: string, stage?: number): Promise<void>;
    /** Get the current index */
    getIndex(): Promise<Map<string, {
        sha: string;
        mode: string;
        stage: number;
    }>>;
}
/**
 * Performs a three-way merge between the current branch and another commit.
 *
 * This function implements Git's three-way merge algorithm:
 * 1. Find the common ancestor (merge base) of the two commits
 * 2. Compare both sides against the base to identify changes
 * 3. Apply non-conflicting changes automatically
 * 4. Identify and report conflicts for manual resolution
 *
 * @param storage - The storage interface for reading/writing objects
 * @param oursSha - SHA of the current branch's HEAD commit
 * @param theirsSha - SHA of the commit to merge
 * @param options - Merge options
 * @returns MergeResult with status and any conflicts
 *
 * @example
 * ```typescript
 * const result = await merge(storage, 'abc123', 'def456', {
 *   message: 'Merge feature branch',
 *   allowFastForward: true
 * })
 *
 * if (result.status === 'conflicted') {
 *   console.log('Conflicts:', result.conflicts)
 * }
 * ```
 */
export declare function merge(storage: MergeStorage, oursSha: string, theirsSha: string, options?: MergeOptions): Promise<MergeResult>;
/**
 * Resolves a single merge conflict.
 *
 * After a merge results in conflicts, use this function to resolve
 * individual files. Once all conflicts are resolved, use continueMerge()
 * to complete the merge.
 *
 * @param storage - The storage interface
 * @param path - Path to the conflicted file
 * @param options - Resolution options
 * @returns ResolveResult indicating success and remaining conflicts
 *
 * @example
 * ```typescript
 * // Resolve using "ours" strategy
 * await resolveConflict(storage, 'src/file.ts', { resolution: 'ours' })
 *
 * // Resolve with custom content
 * await resolveConflict(storage, 'src/file.ts', {
 *   resolution: 'custom',
 *   customContent: new TextEncoder().encode('merged content')
 * })
 * ```
 */
export declare function resolveConflict(storage: MergeStorage, path: string, options: ResolveOptions): Promise<ResolveResult>;
/**
 * Aborts an in-progress merge operation.
 *
 * This restores the repository to its state before the merge began,
 * discarding any changes made during conflict resolution.
 *
 * @param storage - The storage interface
 * @returns MergeOperationResult indicating success
 *
 * @example
 * ```typescript
 * const result = await abortMerge(storage)
 * if (result.success) {
 *   console.log('Merge aborted, HEAD is now', result.headSha)
 * }
 * ```
 */
export declare function abortMerge(storage: MergeStorage): Promise<MergeOperationResult>;
/**
 * Continues a merge after all conflicts have been resolved.
 *
 * This creates the merge commit with the resolved files and
 * cleans up the merge state.
 *
 * @param storage - The storage interface
 * @param message - Optional commit message (overrides stored message)
 * @returns MergeOperationResult with the new commit SHA
 *
 * @example
 * ```typescript
 * // After resolving all conflicts
 * const result = await continueMerge(storage)
 * if (result.success) {
 *   console.log('Merge completed with commit', result.headSha)
 * }
 * ```
 */
export declare function continueMerge(storage: MergeStorage, message?: string): Promise<MergeOperationResult>;
/**
 * Finds the best common ancestor (merge base) for two commits.
 *
 * @param storage - The storage interface
 * @param commit1 - First commit SHA
 * @param commit2 - Second commit SHA
 * @returns SHA of the merge base, or null if no common ancestor exists
 */
export declare function findMergeBase(storage: MergeStorage, commit1: string, commit2: string): Promise<string | null>;
/**
 * Performs a content-level three-way merge on text files.
 *
 * @param base - Content of the base (common ancestor) version
 * @param ours - Content of our (current) version
 * @param theirs - Content of their (merged) version
 * @returns Merged content and any conflict markers
 */
export declare function mergeContent(base: Uint8Array, ours: Uint8Array, theirs: Uint8Array): {
    merged: Uint8Array;
    hasConflicts: boolean;
    markers: ConflictMarker[];
};
/**
 * Checks if a file is binary (non-text).
 *
 * @param content - File content to check
 * @returns true if the file appears to be binary
 */
export declare function isBinaryFile(content: Uint8Array): boolean;
/**
 * Gets the current merge state if a merge is in progress.
 *
 * @param storage - The storage interface
 * @returns MergeState if merge is in progress, null otherwise
 */
export declare function getMergeState(storage: MergeStorage): Promise<MergeState | null>;
/**
 * Checks if a merge is currently in progress.
 *
 * @param storage - The storage interface
 * @returns true if a merge is in progress
 */
export declare function isMergeInProgress(storage: MergeStorage): Promise<boolean>;
export {};
//# sourceMappingURL=merge.d.ts.map