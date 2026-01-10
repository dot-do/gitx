/**
 * @fileoverview Three-way Merge Implementation for Git
 *
 * This module provides a complete implementation of Git's three-way merge algorithm,
 * enabling branch merging with automatic conflict detection and resolution capabilities.
 *
 * ## Overview
 *
 * The three-way merge algorithm works by:
 * 1. Finding the common ancestor (merge base) of two commits
 * 2. Comparing both branches against this base to identify changes
 * 3. Automatically merging non-conflicting changes
 * 4. Detecting and reporting conflicts for manual resolution
 *
 * ## Supported Features
 *
 * - Fast-forward merges when possible
 * - Three-way content merging for text files
 * - Binary file detection and handling
 * - Multiple conflict types (content, add-add, modify-delete, etc.)
 * - Conflict resolution strategies (ours, theirs, custom)
 * - Merge state persistence for multi-step conflict resolution
 *
 * ## Usage Example
 *
 * ```typescript
 * import { merge, resolveConflict, continueMerge } from './ops/merge'
 *
 * // Perform a merge
 * const result = await merge(storage, currentBranchSha, featureBranchSha, {
 *   message: 'Merge feature branch',
 *   allowFastForward: true
 * })
 *
 * if (result.status === 'conflicted') {
 *   // Resolve conflicts
 *   for (const conflict of result.conflicts) {
 *     await resolveConflict(storage, conflict.path, { resolution: 'ours' })
 *   }
 *   // Complete the merge
 *   await continueMerge(storage)
 * }
 * ```
 *
 * @module ops/merge
 */
/**
 * Types of merge conflicts that can occur during a three-way merge.
 *
 * @description
 * Each conflict type represents a different scenario where automatic
 * merging is not possible and manual intervention is required.
 *
 * - `content`: Both sides modified the same file with different changes
 * - `add-add`: Both sides added the same file with different content
 * - `modify-delete`: One side modified a file that the other side deleted
 * - `delete-modify`: One side deleted a file that the other side modified
 * - `rename-rename`: Both sides renamed the same file to different names
 * - `rename-delete`: One side renamed a file that the other side deleted
 * - `directory-file`: One side has a directory where the other has a file
 */
export type ConflictType = 'content' | 'add-add' | 'modify-delete' | 'delete-modify' | 'rename-rename' | 'rename-delete' | 'directory-file';
/**
 * Available merge strategies for combining branches.
 *
 * @description
 * Different strategies determine how the merge algorithm handles
 * combining changes from multiple branches.
 *
 * - `recursive`: Default three-way merge with recursive conflict resolution
 * - `ours`: Automatically resolve all conflicts favoring the current branch
 * - `theirs`: Automatically resolve all conflicts favoring the merged branch
 * - `octopus`: Merge multiple branches simultaneously (no conflict resolution)
 * - `subtree`: Merge into a subdirectory of the current tree
 */
export type MergeStrategy = 'recursive' | 'ours' | 'theirs' | 'octopus' | 'subtree';
/**
 * Status indicating the outcome of a merge operation.
 *
 * @description
 * The merge status determines what action, if any, needs to be taken
 * after a merge operation completes.
 *
 * - `fast-forward`: Branch pointer was simply moved forward (no merge commit)
 * - `merged`: Changes were successfully combined into a merge commit
 * - `conflicted`: Merge has conflicts requiring manual resolution
 * - `up-to-date`: Target branch is already merged; nothing to do
 * - `aborted`: Merge was cancelled and changes were rolled back
 * - `in-progress`: Merge started but not yet completed (conflicts pending)
 */
export type MergeStatus = 'fast-forward' | 'merged' | 'conflicted' | 'up-to-date' | 'aborted' | 'in-progress';
/**
 * Represents the position and content of conflict markers in a file.
 *
 * @description
 * When a content conflict occurs, the file is written with standard Git
 * conflict markers. This interface describes the location and content
 * of each conflicting section.
 *
 * @example
 * ```typescript
 * // A typical conflict marker structure in a file:
 * // <<<<<<< ours
 * // our changes here
 * // =======
 * // their changes here
 * // >>>>>>> theirs
 *
 * const marker: ConflictMarker = {
 *   startLine: 10,
 *   endLine: 16,
 *   baseContent: 'original line',
 *   oursContent: 'our changes here',
 *   theirsContent: 'their changes here'
 * }
 * ```
 */
export interface ConflictMarker {
    /** Line number where the conflict marker starts (1-indexed) */
    startLine: number;
    /** Line number where the conflict marker ends (1-indexed) */
    endLine: number;
    /** The conflicting content from the base (common ancestor) version */
    baseContent?: string;
    /** The conflicting content from our (current branch) version */
    oursContent: string;
    /** The conflicting content from their (merged branch) version */
    theirsContent: string;
}
/**
 * Represents a single merge conflict that requires resolution.
 *
 * @description
 * A MergeConflict contains all information needed to understand and
 * resolve a conflict between two versions of a file. It includes
 * references to all three versions (base, ours, theirs) when available.
 *
 * @example
 * ```typescript
 * const conflict: MergeConflict = {
 *   type: 'content',
 *   path: 'src/utils.ts',
 *   baseSha: 'abc123...',
 *   oursSha: 'def456...',
 *   theirsSha: 'ghi789...',
 *   baseMode: '100644',
 *   oursMode: '100644',
 *   theirsMode: '100644',
 *   conflictedContent: mergedContentWithMarkers,
 *   markers: [{ startLine: 10, endLine: 16, ... }]
 * }
 * ```
 */
export interface MergeConflict {
    /** The type of conflict that occurred */
    type: ConflictType;
    /** Path to the conflicted file relative to repository root */
    path: string;
    /** SHA of the file in the base (common ancestor) commit */
    baseSha?: string;
    /** SHA of the file in our (current branch) commit */
    oursSha?: string;
    /** SHA of the file in their (merged branch) commit */
    theirsSha?: string;
    /** File mode (permissions) in the base version */
    baseMode?: string;
    /** File mode (permissions) in our version */
    oursMode?: string;
    /** File mode (permissions) in their version */
    theirsMode?: string;
    /** Merged content with conflict markers embedded (for content conflicts) */
    conflictedContent?: Uint8Array;
    /** Detailed information about each conflict region in the file */
    markers?: ConflictMarker[];
    /** Original path if this conflict involves a rename */
    originalPath?: string;
    /** Renamed paths when both sides renamed the same file differently */
    renamedPaths?: {
        /** Path the file was renamed to in our branch */
        ours?: string;
        /** Path the file was renamed to in their branch */
        theirs?: string;
    };
}
/**
 * Configuration options for merge operations.
 *
 * @description
 * These options control how the merge algorithm behaves, including
 * whether to allow fast-forward merges, how to handle conflicts,
 * and metadata for the resulting merge commit.
 *
 * @example
 * ```typescript
 * const options: MergeOptions = {
 *   strategy: 'recursive',
 *   allowFastForward: true,
 *   message: 'Merge feature/new-feature into main',
 *   author: {
 *     name: 'Developer',
 *     email: 'dev@example.com'
 *   },
 *   detectRenames: true,
 *   renameThreshold: 60
 * }
 * ```
 */
export interface MergeOptions {
    /** Merge strategy to use (default: 'recursive') */
    strategy?: MergeStrategy;
    /** Whether to allow fast-forward merges when possible (default: true) */
    allowFastForward?: boolean;
    /** Only allow fast-forward merges; fail if not possible (default: false) */
    fastForwardOnly?: boolean;
    /** Automatically resolve conflicts using the specified strategy (default: false) */
    autoResolve?: boolean;
    /** Strategy for automatic conflict resolution when autoResolve is true */
    conflictStrategy?: 'ours' | 'theirs' | 'union';
    /** Commit message for the merge commit */
    message?: string;
    /** Stage changes but do not create a merge commit (default: false) */
    noCommit?: boolean;
    /** Squash all commits from the merged branch into a single change (default: false) */
    squash?: boolean;
    /** Additional branch SHAs for octopus merges */
    additionalBranches?: string[];
    /** Similarity threshold for rename detection (0-100, default: 50) */
    renameThreshold?: number;
    /** Enable rename detection during merge (default: true) */
    detectRenames?: boolean;
    /** Enable copy detection during merge (default: false) */
    detectCopies?: boolean;
    /** Author information for the merge commit */
    author?: {
        /** Author's name */
        name: string;
        /** Author's email address */
        email: string;
        /** Unix timestamp in seconds */
        timestamp?: number;
        /** Timezone offset (e.g., '+0000', '-0500') */
        timezone?: string;
    };
    /** Committer information for the merge commit (defaults to author if not specified) */
    committer?: {
        /** Committer's name */
        name: string;
        /** Committer's email address */
        email: string;
        /** Unix timestamp in seconds */
        timestamp?: number;
        /** Timezone offset (e.g., '+0000', '-0500') */
        timezone?: string;
    };
}
/**
 * Statistics about files changed during a merge operation.
 *
 * @description
 * Provides a summary of what changes were made during the merge,
 * useful for displaying merge summaries to users.
 */
export interface MergeStats {
    /** Number of files that were added */
    filesAdded: number;
    /** Number of files that were modified */
    filesModified: number;
    /** Number of files that were deleted */
    filesDeleted: number;
    /** Number of files that were renamed */
    filesRenamed: number;
    /** Number of binary files that were changed */
    binaryFilesChanged: number;
    /** Total lines added across all text files */
    linesAdded: number;
    /** Total lines removed across all text files */
    linesRemoved: number;
}
/**
 * Result returned from a merge operation.
 *
 * @description
 * Contains complete information about the merge outcome, including
 * the status, any conflicts that occurred, and statistics about
 * the changes made.
 *
 * @example
 * ```typescript
 * const result = await merge(storage, oursSha, theirsSha, options)
 *
 * switch (result.status) {
 *   case 'fast-forward':
 *     console.log(`Fast-forwarded to ${result.treeSha}`)
 *     break
 *   case 'merged':
 *     console.log(`Created merge commit ${result.commitSha}`)
 *     break
 *   case 'conflicted':
 *     console.log(`${result.conflicts?.length} conflicts to resolve`)
 *     break
 *   case 'up-to-date':
 *     console.log('Already up to date')
 *     break
 * }
 * ```
 */
export interface MergeResult {
    /** The outcome status of the merge operation */
    status: MergeStatus;
    /** SHA of the created merge commit (if a commit was created) */
    commitSha?: string;
    /** SHA of the resulting merged tree */
    treeSha?: string;
    /** SHA of the common ancestor commit used as merge base */
    baseSha?: string;
    /** SHA of the current branch's commit before the merge */
    oursSha: string;
    /** SHA of the commit that was merged in */
    theirsSha: string;
    /** List of conflicts if status is 'conflicted' */
    conflicts?: MergeConflict[];
    /** Statistics about files changed during the merge */
    stats?: MergeStats;
    /** The merge commit message */
    message?: string;
    /** Whether this was a fast-forward merge (no merge commit created) */
    fastForward: boolean;
}
/**
 * Persistent state of an in-progress merge operation.
 *
 * @description
 * When a merge results in conflicts, this state is persisted to allow
 * the user to resolve conflicts and continue the merge in a separate
 * operation. Corresponds to Git's .git/MERGE_HEAD and related files.
 *
 * @example
 * ```typescript
 * const state = await storage.readMergeState()
 * if (state) {
 *   console.log(`Merge in progress from ${state.mergeHead}`)
 *   console.log(`${state.unresolvedConflicts.length} conflicts remaining`)
 * }
 * ```
 */
export interface MergeState {
    /** SHA of the commit being merged (stored in MERGE_HEAD) */
    mergeHead: string;
    /** SHA of HEAD before the merge started (stored in ORIG_HEAD) */
    origHead: string;
    /** Commit message for the eventual merge commit */
    message: string;
    /** Special merge mode if applicable */
    mode?: 'squash' | 'no-ff';
    /** Conflicts that have not yet been resolved */
    unresolvedConflicts: MergeConflict[];
    /** Conflicts that have been resolved */
    resolvedConflicts: MergeConflict[];
    /** Options that were passed to the original merge operation */
    options: MergeOptions;
}
/**
 * Options for resolving an individual merge conflict.
 *
 * @description
 * Specifies how to resolve a particular conflict. Can use one of the
 * three-way merge versions (ours, theirs, base) or provide custom content.
 *
 * @example
 * ```typescript
 * // Use our version
 * await resolveConflict(storage, 'file.ts', { resolution: 'ours' })
 *
 * // Use their version
 * await resolveConflict(storage, 'file.ts', { resolution: 'theirs' })
 *
 * // Provide custom merged content
 * await resolveConflict(storage, 'file.ts', {
 *   resolution: 'custom',
 *   customContent: encoder.encode('manually merged content')
 * })
 * ```
 */
export interface ResolveOptions {
    /** Which version to use for resolution */
    resolution: 'ours' | 'theirs' | 'base' | 'custom';
    /** Custom content when resolution is 'custom' */
    customContent?: Uint8Array;
    /** Custom file mode when resolution is 'custom' */
    customMode?: string;
}
/**
 * Result of resolving a single conflict.
 *
 * @description
 * Indicates whether the conflict was successfully resolved and how
 * many conflicts remain to be resolved before the merge can continue.
 */
export interface ResolveResult {
    /** Whether the resolution was successful */
    success: boolean;
    /** Path of the file that was resolved */
    path: string;
    /** Error message if resolution failed */
    error?: string;
    /** Number of conflicts still remaining after this resolution */
    remainingConflicts: number;
}
/**
 * Result of merge management operations (abort, continue).
 *
 * @description
 * Used for operations that manage merge state rather than performing
 * the actual merge, such as aborting or continuing a conflicted merge.
 */
export interface MergeOperationResult {
    /** Whether the operation completed successfully */
    success: boolean;
    /** Error message if the operation failed */
    error?: string;
    /** Current HEAD SHA after the operation */
    headSha?: string;
    /** Human-readable status message */
    message?: string;
}
/**
 * Extended object type that may include parsed commit/tree data.
 *
 * @description
 * Internal type used to represent Git objects that may have been
 * pre-parsed for efficiency in testing or caching scenarios.
 *
 * @internal
 */
interface ExtendedObject {
    /** Object type ('commit', 'tree', 'blob', 'tag') */
    type: string;
    /** Raw object data */
    data: Uint8Array;
    /** Pre-parsed tree SHA for commit objects */
    tree?: string;
    /** Pre-parsed parent SHAs for commit objects */
    parents?: string[];
    /** Pre-parsed entries for tree objects */
    entries?: Array<{
        mode: string;
        name: string;
        sha: string;
    }>;
}
/**
 * Storage interface required for merge operations.
 *
 * @description
 * Defines the storage layer abstraction that merge operations use to
 * read and write Git objects, references, and merge state. Implementations
 * must provide all methods for merge functionality to work correctly.
 *
 * @example
 * ```typescript
 * class GitStorage implements MergeStorage {
 *   async readObject(sha: string) {
 *     // Read from .git/objects
 *   }
 *   async writeObject(type: string, data: Uint8Array) {
 *     // Write to .git/objects and return SHA
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface MergeStorage {
    /**
     * Read a Git object by its SHA.
     * @param sha - The 40-character hexadecimal SHA
     * @returns The object if found, null otherwise
     */
    readObject(sha: string): Promise<ExtendedObject | null>;
    /**
     * Write a Git object and return its SHA.
     * @param type - Object type ('commit', 'tree', 'blob', 'tag')
     * @param data - Raw object content
     * @returns The SHA of the written object
     */
    writeObject(type: string, data: Uint8Array): Promise<string>;
    /**
     * Read a Git reference (branch, tag, etc.).
     * @param ref - Reference path (e.g., 'refs/heads/main')
     * @returns The SHA the reference points to, or null
     */
    readRef(ref: string): Promise<string | null>;
    /**
     * Write/update a Git reference.
     * @param ref - Reference path
     * @param sha - SHA to point the reference to
     */
    writeRef(ref: string, sha: string): Promise<void>;
    /**
     * Read the current merge state if a merge is in progress.
     * @returns Merge state if present, null otherwise
     */
    readMergeState(): Promise<MergeState | null>;
    /**
     * Persist merge state for conflict resolution.
     * @param state - The merge state to persist
     */
    writeMergeState(state: MergeState): Promise<void>;
    /**
     * Delete merge state after merge completes or is aborted.
     */
    deleteMergeState(): Promise<void>;
    /**
     * Stage a file in the index.
     * @param path - File path
     * @param sha - Blob SHA
     * @param mode - File mode
     * @param stage - Stage number (0 for normal, 1-3 for conflicts)
     */
    stageFile(path: string, sha: string, mode: string, stage?: number): Promise<void>;
    /**
     * Get all entries from the current index.
     * @returns Map of path to index entry
     */
    getIndex(): Promise<Map<string, {
        sha: string;
        mode: string;
        stage: number;
    }>>;
}
/**
 * Performs a three-way merge between the current branch and another commit.
 *
 * @description
 * This function implements Git's three-way merge algorithm:
 * 1. Find the common ancestor (merge base) of the two commits
 * 2. Compare both sides against the base to identify changes
 * 3. Apply non-conflicting changes automatically
 * 4. Identify and report conflicts for manual resolution
 *
 * The merge can result in several outcomes:
 * - **fast-forward**: If the current branch is an ancestor of the target,
 *   the branch pointer is simply moved forward
 * - **merged**: Changes were successfully combined into a merge commit
 * - **conflicted**: Some changes conflict and require manual resolution
 * - **up-to-date**: The target is already merged; nothing to do
 *
 * @param storage - The storage interface for reading/writing Git objects
 * @param oursSha - SHA of the current branch's HEAD commit
 * @param theirsSha - SHA of the commit to merge into the current branch
 * @param options - Configuration options for the merge operation
 *
 * @returns A promise resolving to the merge result with status and any conflicts
 *
 * @throws {Error} When commit objects cannot be read
 * @throws {Error} When tree objects cannot be parsed
 * @throws {Error} When fastForwardOnly is true but fast-forward is not possible
 *
 * @example
 * ```typescript
 * // Basic merge
 * const result = await merge(storage, 'abc123', 'def456', {
 *   message: 'Merge feature branch'
 * })
 *
 * if (result.status === 'merged') {
 *   console.log('Merge successful:', result.commitSha)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Fast-forward only merge
 * try {
 *   const result = await merge(storage, 'abc123', 'def456', {
 *     fastForwardOnly: true
 *   })
 *   console.log('Fast-forwarded to:', result.treeSha)
 * } catch (error) {
 *   console.log('Cannot fast-forward, branches have diverged')
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Merge with auto-resolve conflicts using 'ours' strategy
 * const result = await merge(storage, 'abc123', 'def456', {
 *   autoResolve: true,
 *   conflictStrategy: 'ours',
 *   message: 'Merge with our changes taking precedence'
 * })
 * ```
 */
export declare function merge(storage: MergeStorage, oursSha: string, theirsSha: string, options?: MergeOptions): Promise<MergeResult>;
/**
 * Resolves a single merge conflict with the specified strategy.
 *
 * @description
 * After a merge results in conflicts, use this function to resolve
 * individual files. The resolution can use one of the three versions
 * (ours, theirs, base) or provide custom merged content.
 *
 * Once all conflicts are resolved, use {@link continueMerge} to create
 * the merge commit and complete the operation.
 *
 * @param storage - The storage interface for reading/writing objects
 * @param path - Path to the conflicted file to resolve
 * @param options - Resolution options specifying which version to use
 *
 * @returns A promise resolving to the resolution result
 *
 * @throws {Error} When no merge is in progress
 * @throws {Error} When the specified path has no conflict
 *
 * @example
 * ```typescript
 * // Resolve using our version
 * const result = await resolveConflict(storage, 'src/file.ts', {
 *   resolution: 'ours'
 * })
 * console.log(`${result.remainingConflicts} conflicts remaining`)
 * ```
 *
 * @example
 * ```typescript
 * // Resolve using their version
 * await resolveConflict(storage, 'config.json', {
 *   resolution: 'theirs'
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Resolve with manually merged content
 * const mergedContent = new TextEncoder().encode(`
 *   // Manually resolved: kept both features
 *   export function feature1() { ... }
 *   export function feature2() { ... }
 * `)
 *
 * await resolveConflict(storage, 'src/features.ts', {
 *   resolution: 'custom',
 *   customContent: mergedContent
 * })
 * ```
 */
export declare function resolveConflict(storage: MergeStorage, path: string, options: ResolveOptions): Promise<ResolveResult>;
/**
 * Aborts an in-progress merge operation.
 *
 * @description
 * Cancels the current merge and restores the repository to its state
 * before the merge began. Any conflict resolutions or staged changes
 * from the merge will be discarded.
 *
 * This is equivalent to `git merge --abort`.
 *
 * @param storage - The storage interface
 *
 * @returns A promise resolving to the operation result
 *
 * @throws {Error} When no merge is in progress
 *
 * @example
 * ```typescript
 * // User decides to cancel the merge
 * const result = await abortMerge(storage)
 *
 * if (result.success) {
 *   console.log('Merge aborted, HEAD restored to', result.headSha)
 * } else {
 *   console.error('Failed to abort:', result.error)
 * }
 * ```
 */
export declare function abortMerge(storage: MergeStorage): Promise<MergeOperationResult>;
/**
 * Continues a merge after all conflicts have been resolved.
 *
 * @description
 * After resolving all conflicts using {@link resolveConflict}, call this
 * function to create the merge commit and complete the merge operation.
 * The merge state will be cleaned up automatically.
 *
 * This is equivalent to `git merge --continue` or `git commit` after
 * resolving conflicts.
 *
 * @param storage - The storage interface
 * @param message - Optional commit message (overrides the stored message)
 *
 * @returns A promise resolving to the operation result with the new commit SHA
 *
 * @throws {Error} When no merge is in progress
 * @throws {Error} When unresolved conflicts remain
 *
 * @example
 * ```typescript
 * // After resolving all conflicts
 * const result = await continueMerge(storage)
 *
 * if (result.success) {
 *   console.log('Merge completed:', result.headSha)
 * } else {
 *   console.error('Cannot continue:', result.error)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Continue with a custom commit message
 * const result = await continueMerge(storage, 'Merge feature-x with conflict resolution')
 * ```
 */
export declare function continueMerge(storage: MergeStorage, message?: string): Promise<MergeOperationResult>;
/**
 * Finds the best common ancestor (merge base) of two commits.
 *
 * @description
 * Implements the merge base algorithm by finding the most recent commit
 * that is an ancestor of both input commits. This is the commit from
 * which both branches diverged.
 *
 * Uses a breadth-first search from both commits to find their
 * intersection in the commit graph.
 *
 * @param storage - The storage interface for reading commit objects
 * @param commit1 - SHA of the first commit
 * @param commit2 - SHA of the second commit
 *
 * @returns A promise resolving to the merge base SHA, or null if no common ancestor exists
 *
 * @example
 * ```typescript
 * const base = await findMergeBase(storage, 'feature-sha', 'main-sha')
 * if (base) {
 *   console.log('Common ancestor:', base)
 * } else {
 *   console.log('No common history')
 * }
 * ```
 */
export declare function findMergeBase(storage: MergeStorage, commit1: string, commit2: string): Promise<string | null>;
/**
 * Performs a content-level three-way merge on text files.
 *
 * @description
 * Takes three versions of a file (base, ours, theirs) and attempts to
 * automatically merge them. Non-conflicting changes are combined
 * automatically. Conflicting changes are marked with standard Git
 * conflict markers.
 *
 * The algorithm:
 * 1. Compute the diff hunks from base to ours
 * 2. Compute the diff hunks from base to theirs
 * 3. Process hunks in order, detecting overlaps
 * 4. Non-overlapping hunks are applied automatically
 * 5. Overlapping hunks with identical changes are deduplicated
 * 6. Overlapping hunks with different changes create conflict markers
 *
 * @param base - Content of the base (common ancestor) version
 * @param ours - Content of our (current branch) version
 * @param theirs - Content of their (merged branch) version
 *
 * @returns Object containing merged content, conflict flag, and marker locations
 *
 * @example
 * ```typescript
 * const result = mergeContent(baseContent, oursContent, theirsContent)
 *
 * if (result.hasConflicts) {
 *   console.log('Content has conflicts at:', result.markers)
 *   // Write file with conflict markers for manual resolution
 *   await writeFile(path, result.merged)
 * } else {
 *   console.log('Content merged cleanly')
 *   await writeFile(path, result.merged)
 * }
 * ```
 */
export declare function mergeContent(base: Uint8Array, ours: Uint8Array, theirs: Uint8Array): {
    merged: Uint8Array;
    hasConflicts: boolean;
    markers: ConflictMarker[];
};
/**
 * Determines if a file is binary (non-text) based on its content.
 *
 * @description
 * Uses Git's heuristic: a file is considered binary if it contains
 * null bytes (0x00) within the first 8000 bytes, or if it has
 * specific binary file magic numbers (PNG, JPEG, GIF).
 *
 * Binary files cannot be automatically merged and always result
 * in conflicts when both sides modify them.
 *
 * @param content - File content to analyze
 *
 * @returns true if the file appears to be binary, false for text files
 *
 * @example
 * ```typescript
 * const content = await readFile('image.png')
 * if (isBinaryFile(content)) {
 *   console.log('Cannot perform text merge on binary file')
 * }
 * ```
 */
export declare function isBinaryFile(content: Uint8Array): boolean;
/**
 * Gets the current merge state if a merge is in progress.
 *
 * @description
 * Returns the persisted merge state, which includes information about
 * the merge in progress, any unresolved conflicts, and the original
 * merge options.
 *
 * @param storage - The storage interface
 *
 * @returns A promise resolving to the merge state, or null if no merge is in progress
 *
 * @example
 * ```typescript
 * const state = await getMergeState(storage)
 * if (state) {
 *   console.log('Merging', state.mergeHead, 'into', state.origHead)
 *   console.log('Unresolved conflicts:', state.unresolvedConflicts.length)
 * } else {
 *   console.log('No merge in progress')
 * }
 * ```
 */
export declare function getMergeState(storage: MergeStorage): Promise<MergeState | null>;
/**
 * Checks if a merge is currently in progress.
 *
 * @description
 * Quick check to determine if there's an active merge that hasn't
 * been completed or aborted. Useful for UI state and command validation.
 *
 * @param storage - The storage interface
 *
 * @returns A promise resolving to true if a merge is in progress
 *
 * @example
 * ```typescript
 * if (await isMergeInProgress(storage)) {
 *   console.log('Please complete or abort the current merge first')
 * } else {
 *   // Safe to start a new merge
 *   await merge(storage, oursSha, theirsSha, options)
 * }
 * ```
 */
export declare function isMergeInProgress(storage: MergeStorage): Promise<boolean>;
export {};
//# sourceMappingURL=merge.d.ts.map