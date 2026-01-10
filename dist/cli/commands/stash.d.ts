/**
 * @fileoverview gitx stash command
 *
 * This module implements the `gitx stash` command which temporarily stores
 * modified working directory contents. Features include:
 * - stash push - save changes to a new stash
 * - stash list - list all stashes
 * - stash apply - apply a stash without removing it
 * - stash pop - apply and remove a stash
 * - stash drop - remove a stash
 * - stash show - show stash contents
 * - stash clear - remove all stashes
 *
 * @module cli/commands/stash
 */
import type { CommandContext } from '../index';
/**
 * Represents a single stash entry.
 */
export interface StashEntry {
    /** Stash reference (e.g., stash@{0}) */
    ref: string;
    /** Stash index (e.g., 0 for stash@{0}) */
    index: number;
    /** Branch the stash was created from */
    branch: string;
    /** Stash message */
    message: string;
    /** SHA of the stash commit */
    sha: string;
    /** Short SHA (7 chars) */
    shortSha: string;
    /** When the stash was created */
    date: Date;
    /** Files included in the stash */
    files: string[];
}
/**
 * Options for stash push operation.
 */
export interface StashPushOptions {
    /** Include untracked files */
    includeUntracked?: boolean;
    /** Keep the changes in the index */
    keepIndex?: boolean;
    /** Custom message for the stash */
    message?: string;
    /** Only stash specific paths */
    pathspec?: string[];
    /** Stash all files including ignored */
    all?: boolean;
    /** Stage mode - only stash staged changes */
    staged?: boolean;
    /** Quiet mode - suppress output */
    quiet?: boolean;
}
/**
 * Options for stash apply/pop operations.
 */
export interface StashApplyOptions {
    /** Stash reference to apply (e.g., 'stash@{0}' or '0') */
    ref?: string;
    /** Stash index to apply (default: 0) - deprecated, use ref */
    index?: boolean;
    /** Restore the index state too */
    restoreIndex?: boolean;
    /** Quiet mode - suppress output */
    quiet?: boolean;
}
/**
 * Result of a stash push operation.
 */
export interface StashPushResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** The stash reference created (e.g., stash@{0}) */
    stashRef: string;
    /** The stash message */
    message: string;
    /** Error message if failed */
    error?: string;
}
/**
 * Result of a stash apply/pop operation.
 */
export interface StashApplyResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** The stash reference that was applied */
    appliedRef: string;
    /** Whether there were conflicts */
    conflicts?: boolean;
    /** Error message if failed */
    error?: string;
}
/**
 * Result of a stash drop operation.
 */
export interface StashDropResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** The stash reference that was dropped */
    droppedRef: string;
    /** The SHA of the dropped stash */
    droppedSha: string;
    /** Error message if failed */
    error?: string;
}
/**
 * Result of a stash show operation.
 */
export interface StashShowResult {
    /** Files in the stash */
    files: Array<{
        path: string;
        status?: string;
    }>;
    /** Diff content */
    diff?: string;
}
/**
 * Get the count of stash entries.
 */
export declare function getStashCount(cwd: string): Promise<number>;
/**
 * List all stash entries.
 */
export declare function stashList(cwd: string): Promise<StashEntry[]>;
/**
 * Push changes to a new stash entry.
 */
export declare function stashPush(cwd: string, options?: StashPushOptions): Promise<StashPushResult>;
/**
 * Apply a stash entry without removing it.
 */
export declare function stashApply(cwd: string, options?: StashApplyOptions): Promise<StashApplyResult>;
/**
 * Apply and remove a stash entry.
 */
export declare function stashPop(cwd: string, options?: StashApplyOptions): Promise<StashApplyResult>;
/**
 * Remove a specific stash entry.
 */
export declare function stashDrop(cwd: string, ref?: string): Promise<StashDropResult>;
/**
 * Show the contents of a stash entry.
 */
export declare function stashShow(cwd: string, ref?: string): Promise<StashShowResult>;
/**
 * Remove all stash entries.
 */
export declare function stashClear(cwd: string): Promise<void>;
/**
 * Command handler for `gitx stash`.
 */
export declare function stashCommand(context: CommandContext): Promise<void>;
//# sourceMappingURL=stash.d.ts.map