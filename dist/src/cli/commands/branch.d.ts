/**
 * @fileoverview Git Branch Command
 *
 * This module implements the `gitx branch` command which manages local branches.
 * Features include:
 * - Listing local branches with optional verbose output
 * - Creating new branches from HEAD or a specific start point
 * - Deleting branches (with merge safety check or force)
 * - Renaming branches
 * - Showing upstream tracking information
 *
 * @module cli/commands/branch
 *
 * @example
 * // List all branches
 * const branches = await listBranches(cwd)
 * for (const branch of branches) {
 *   console.log(branch.isCurrent ? '* ' : '  ', branch.name)
 * }
 *
 * @example
 * // Create a new branch
 * await createBranch(cwd, 'feature/new-feature')
 *
 * @example
 * // Delete a merged branch
 * await deleteBranch(cwd, 'old-feature', { force: false })
 */
import type { CommandContext } from '../index';
/**
 * Information about a git branch.
 *
 * @description Contains all relevant information about a branch including
 * its name, current state, and optional upstream tracking information.
 *
 * @property name - Branch name (e.g., "main", "feature/auth")
 * @property sha - Full 40-character commit SHA the branch points to
 * @property isCurrent - True if this is the currently checked out branch
 * @property upstream - Upstream tracking branch name (e.g., "origin/main")
 * @property ahead - Number of commits ahead of upstream
 * @property behind - Number of commits behind upstream
 * @property upstreamGone - True if upstream branch was deleted on remote
 */
export interface BranchInfo {
    /** Branch name */
    name: string;
    /** Commit SHA the branch points to */
    sha: string;
    /** Whether this is the current branch */
    isCurrent: boolean;
    /** Upstream tracking branch (e.g., "origin/main") */
    upstream?: string;
    /** Number of commits ahead of upstream */
    ahead?: number;
    /** Number of commits behind upstream */
    behind?: number;
    /** Whether the upstream branch is gone (deleted on remote) */
    upstreamGone?: boolean;
}
/**
 * Options for listing branches.
 *
 * @description Controls the verbosity of branch listing output.
 *
 * @property verbose - Show commit SHA alongside branch names (-v flag)
 * @property veryVerbose - Show upstream tracking info (-vv flag)
 */
export interface BranchListOptions {
    /** Show verbose output with commit info */
    verbose?: boolean;
    /** Show very verbose output with upstream info */
    veryVerbose?: boolean;
}
/**
 * Options for deleting a branch.
 *
 * @description Controls the safety behavior when deleting branches.
 *
 * @property force - If true, delete even if not fully merged (-D flag)
 */
export interface DeleteBranchOptions {
    /** Force delete even if not fully merged */
    force: boolean;
}
/**
 * Execute the branch command from the CLI.
 *
 * @description Main entry point for the `gitx branch` command. Handles all
 * branch operations based on command-line flags:
 * - No flags: List branches
 * - `-v`: List with commit info
 * - `-vv`: List with upstream info
 * - `-d <name>`: Delete branch (safe)
 * - `-D <name>`: Delete branch (force)
 * - `-m <old> <new>`: Rename branch
 * - `<name> [start]`: Create branch
 *
 * @param ctx - Command context with cwd, args, options, and output functions
 * @returns Promise that resolves when command completes
 * @throws {Error} If not in a git repository
 * @throws {Error} If branch operation fails (see individual functions)
 *
 * @example
 * // CLI usage examples
 * // gitx branch                  - List branches
 * // gitx branch -v               - List with SHAs
 * // gitx branch feature/auth     - Create branch
 * // gitx branch -d old-branch    - Delete merged branch
 * // gitx branch -m old new       - Rename branch
 */
export declare function branchCommand(ctx: CommandContext): Promise<void>;
/**
 * List all local branches.
 *
 * @description Reads all branch refs from .git/refs/heads and returns
 * information about each branch including which one is currently checked out.
 *
 * @param cwd - Working directory (repository root)
 * @param options - List options (currently unused, reserved for future use)
 * @returns Promise resolving to array of branch info, sorted alphabetically
 * @throws {Error} If not in a git repository
 *
 * @example
 * const branches = await listBranches('/path/to/repo')
 * const current = branches.find(b => b.isCurrent)
 * console.log(`Current branch: ${current?.name}`)
 *
 * @example
 * // List all branch names
 * const branches = await listBranches(cwd)
 * console.log(branches.map(b => b.name).join('\n'))
 */
export declare function listBranches(cwd: string, _options?: BranchListOptions): Promise<BranchInfo[]>;
/**
 * Create a new branch.
 *
 * @description Creates a new branch ref pointing to either HEAD or a specified
 * commit/branch. The branch name is validated against git naming rules.
 *
 * Branch names cannot:
 * - Start with a dash (-)
 * - Contain double dots (..)
 * - End with .lock
 * - Contain spaces, tildes, carets, colons, question marks, asterisks, or backslashes
 *
 * @param cwd - Working directory (repository root)
 * @param name - Name for the new branch
 * @param startPoint - Optional commit SHA or branch name to start from (defaults to HEAD)
 * @returns Promise that resolves when branch is created
 * @throws {Error} If not in a git repository
 * @throws {Error} If branch name is invalid
 * @throws {Error} If branch already exists
 * @throws {Error} If startPoint reference is invalid
 * @throws {Error} If HEAD cannot be resolved
 *
 * @example
 * // Create branch from HEAD
 * await createBranch(cwd, 'feature/new-feature')
 *
 * @example
 * // Create branch from specific commit
 * await createBranch(cwd, 'hotfix/bug-123', 'abc1234')
 *
 * @example
 * // Create branch from another branch
 * await createBranch(cwd, 'feature/derived', 'main')
 */
export declare function createBranch(cwd: string, name: string, startPoint?: string): Promise<void>;
/**
 * Delete a branch.
 *
 * @description Deletes a local branch ref. By default, includes a safety check
 * to prevent deleting unmerged branches. Use `force: true` to override.
 *
 * Safety checks:
 * - Cannot delete the currently checked out branch
 * - Cannot delete unmerged branch unless force is true
 *
 * @param cwd - Working directory (repository root)
 * @param name - Name of the branch to delete
 * @param options - Delete options controlling safety behavior
 * @param options.force - If true, skip merge check and force delete
 * @returns Promise that resolves when branch is deleted
 * @throws {Error} If not in a git repository
 * @throws {Error} If branch does not exist
 * @throws {Error} If trying to delete the current branch
 * @throws {Error} If branch is not fully merged and force is false
 *
 * @example
 * // Delete a merged branch (safe)
 * await deleteBranch(cwd, 'old-feature', { force: false })
 *
 * @example
 * // Force delete an unmerged branch
 * await deleteBranch(cwd, 'abandoned-work', { force: true })
 */
export declare function deleteBranch(cwd: string, name: string, options: DeleteBranchOptions): Promise<void>;
/**
 * Rename a branch.
 *
 * @description Renames a branch by creating a new ref with the old SHA and
 * deleting the old ref. If renaming the current branch, also updates HEAD.
 *
 * @param cwd - Working directory (repository root)
 * @param oldName - Current branch name
 * @param newName - New branch name (validated against git naming rules)
 * @returns Promise that resolves when branch is renamed
 * @throws {Error} If not in a git repository
 * @throws {Error} If new branch name is invalid
 * @throws {Error} If old branch does not exist
 * @throws {Error} If new branch name already exists
 *
 * @example
 * // Rename a feature branch
 * await renameBranch(cwd, 'feature/old-name', 'feature/new-name')
 *
 * @example
 * // Rename the current branch
 * await renameBranch(cwd, 'main', 'master') // Also updates HEAD
 */
export declare function renameBranch(cwd: string, oldName: string, newName: string): Promise<void>;
/**
 * Get branches with upstream tracking information.
 *
 * @description Lists all local branches with additional upstream tracking
 * information including remote name, ahead/behind counts, and whether
 * the upstream branch still exists.
 *
 * This is used for the `-vv` verbose output mode.
 *
 * @param cwd - Working directory (repository root)
 * @returns Promise resolving to branches with upstream info populated
 * @throws {Error} If not in a git repository
 *
 * @example
 * const branches = await getBranchesWithUpstream(cwd)
 * for (const branch of branches) {
 *   if (branch.upstream) {
 *     console.log(`${branch.name} tracks ${branch.upstream}`)
 *     if (branch.upstreamGone) {
 *       console.log('  (upstream deleted)')
 *     } else {
 *       console.log(`  ahead ${branch.ahead}, behind ${branch.behind}`)
 *     }
 *   }
 * }
 */
export declare function getBranchesWithUpstream(cwd: string): Promise<BranchInfo[]>;
//# sourceMappingURL=branch.d.ts.map