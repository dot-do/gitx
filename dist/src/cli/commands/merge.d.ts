/**
 * @fileoverview Git Merge Command
 *
 * This module implements the `gitx merge` command which merges branches.
 * Features include:
 * - Fast-forward merging
 * - Three-way merging with merge commits
 * - --no-ff flag to force merge commit
 * - --squash flag for squash merging
 * - Conflict detection and handling
 * - --abort to cancel in-progress merge
 * - --continue to complete merge after conflict resolution
 *
 * @module cli/commands/merge
 */
import type { CommandContext } from '../index';
/**
 * Options for merge operation.
 */
export interface MergeOptions {
    /** Force merge commit even when fast-forward is possible */
    noFastForward?: boolean;
    /** Only allow fast-forward merge */
    fastForwardOnly?: boolean;
    /** Squash commits (stage changes without committing) */
    squash?: boolean;
    /** Custom merge commit message */
    message?: string;
    /** Merge strategy (e.g., 'recursive', 'ours', 'theirs') */
    strategy?: string;
    /** Strategy-specific option (e.g., 'ours', 'theirs') */
    strategyOption?: string;
}
/**
 * Result of a merge operation.
 */
export interface MergeResult {
    /** Status of the merge */
    status: 'fast-forward' | 'merged' | 'conflicted' | 'already-up-to-date' | 'squashed';
    /** New HEAD SHA after merge */
    newHead?: string;
    /** SHA of the merge commit (for non-fast-forward merges) */
    mergeCommitSha?: string;
    /** Commit message used for merge */
    message?: string;
    /** Parent commit SHAs */
    parents?: string[];
    /** List of conflicted file paths */
    conflicts?: string[];
    /** Whether a manual commit is required (for squash) */
    requiresCommit?: boolean;
    /** Number of commits that were squashed */
    squashedCommits?: number;
    /** Merge statistics */
    stats?: {
        filesChanged: number;
        insertions: number;
        deletions: number;
    };
}
/**
 * Status of an in-progress merge.
 */
export interface MergeStatus {
    /** Whether a merge is in progress */
    inProgress: boolean;
    /** SHA of the branch being merged (MERGE_HEAD) */
    mergeHead?: string;
    /** SHA of HEAD before merge started (ORIG_HEAD) */
    origHead?: string;
    /** List of unresolved conflict file paths */
    unresolvedConflicts: string[];
}
/**
 * Result of continuing or aborting a merge.
 */
export interface MergeActionResult {
    success: boolean;
    commitSha?: string;
    error?: string;
}
/**
 * Check if a fast-forward merge is possible from source to target.
 */
export declare function canFastForward(cwd: string, source: string, target: string): Promise<boolean>;
/**
 * Get the status of an in-progress merge.
 */
export declare function getMergeStatus(cwd: string): Promise<MergeStatus>;
/**
 * Merge a branch or branches into the current branch.
 */
export declare function mergeBranches(cwd: string, target: string | string[], options?: MergeOptions): Promise<MergeResult>;
/**
 * Abort an in-progress merge.
 */
export declare function abortMerge(cwd: string): Promise<MergeActionResult>;
/**
 * Continue a merge after resolving conflicts.
 */
export declare function continueMerge(cwd: string): Promise<MergeActionResult>;
/**
 * Command handler for `gitx merge`
 */
export declare function mergeCommand(ctx: CommandContext): Promise<void>;
//# sourceMappingURL=merge.d.ts.map