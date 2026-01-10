/**
 * @fileoverview Git Checkout Command
 *
 * This module implements the `gitx checkout` command which handles:
 * - Switching to existing branches
 * - Creating and switching to new branches (-b flag)
 * - Checking out specific files from commits
 * - Restoring working tree files
 * - Handling detached HEAD state
 * - Force checkout to discard local changes
 *
 * @module cli/commands/checkout
 */
import type { CommandContext } from '../index';
/**
 * Options for checkout operation.
 */
export interface CheckoutOptions {
    /** Create and checkout a new branch */
    createBranch?: string;
    /** Create/reset and checkout a branch */
    resetBranch?: string;
    /** Force checkout (discard local changes) */
    force?: boolean;
    /** Quiet mode - suppress output */
    quiet?: boolean;
    /** Detach HEAD at commit */
    detach?: boolean;
    /** Create orphan branch */
    orphan?: string;
    /** Set up tracking mode */
    track?: boolean;
    /** Merge with current branch */
    merge?: boolean;
}
/**
 * Result of a checkout operation.
 */
export interface CheckoutResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** The branch or commit checked out */
    target: string;
    /** Whether HEAD is detached */
    detached: boolean;
    /** Files that were modified */
    modifiedFiles?: string[];
    /** Error message if failed */
    error?: string;
}
/**
 * Switch to an existing branch.
 */
export declare function switchBranch(cwd: string, branchName: string, options?: CheckoutOptions): Promise<CheckoutResult>;
/**
 * Create a new branch and switch to it.
 */
export declare function createAndSwitch(cwd: string, branchName: string, startPoint?: string, options?: CheckoutOptions & {
    reset?: boolean;
}): Promise<CheckoutResult>;
/**
 * Checkout specific files from a commit or HEAD.
 */
export declare function checkoutFiles(cwd: string, files: string[], _source?: string, _options?: CheckoutOptions): Promise<CheckoutResult>;
/**
 * Create an orphan branch (no history).
 */
export declare function createOrphanBranch(cwd: string, branchName: string, _options?: CheckoutOptions): Promise<CheckoutResult>;
/**
 * Command handler for `gitx checkout`
 */
export declare function checkoutCommand(ctx: CommandContext): Promise<void>;
//# sourceMappingURL=checkout.d.ts.map