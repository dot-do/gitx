/**
 * @fileoverview gitx status command
 *
 * This module implements the `gitx status` command which displays the
 * working tree status. It shows:
 * - Untracked files (not yet added to git)
 * - Modified files (changed but not staged)
 * - Staged files (ready to commit)
 * - Deleted files
 * - Renamed files
 * - Current branch and tracking information
 *
 * Supports both long format (default) and short format (--short) output,
 * similar to git's status command.
 *
 * @module cli/commands/status
 *
 * @example
 * // Long format output
 * await statusCommand(ctx)
 * // On branch main
 * // Your branch is up to date with 'origin/main'.
 * //
 * // Changes to be committed:
 * //   new file:   src/new-file.ts
 *
 * @example
 * // Short format output
 * ctx.options.short = true
 * await statusCommand(ctx)
 * // A  src/new-file.ts
 * // ?? untracked-file.txt
 */
import type { CommandContext } from '../index';
/**
 * Options for the status command.
 *
 * @description Configuration options that control the output format
 * of the status command.
 *
 * @property short - Show output in short format (two-character status codes)
 * @property branch - Show only branch information (with short format)
 */
export interface StatusOptions {
    /** Show output in short format */
    short?: boolean;
    /** Show only branch info */
    branch?: boolean;
}
/**
 * Status information for a single file.
 *
 * @description Represents the status of a file in both the index (staging area)
 * and working tree. Uses git-style two-character status codes.
 *
 * @property path - File path relative to repository root
 * @property index - Status in the index (staged changes)
 * @property workingTree - Status in the working tree (unstaged changes)
 * @property origPath - Original path for renamed files
 *
 * @example
 * // A staged new file
 * const status: FileStatus = {
 *   path: 'src/new.ts',
 *   index: 'A',
 *   workingTree: ' '
 * }
 *
 * @example
 * // A renamed file
 * const status: FileStatus = {
 *   path: 'new-name.ts',
 *   index: 'R',
 *   workingTree: ' ',
 *   origPath: 'old-name.ts'
 * }
 */
export interface FileStatus {
    /** File path */
    path: string;
    /** Status in index (staged) */
    index: StatusCode;
    /** Status in working tree */
    workingTree: StatusCode;
    /** Original path for renamed files */
    origPath?: string;
}
/**
 * Git status codes for files.
 *
 * @description Single-character codes representing file status:
 * - ' ' - Unmodified
 * - 'M' - Modified
 * - 'A' - Added
 * - 'D' - Deleted
 * - 'R' - Renamed
 * - 'C' - Copied
 * - '?' - Untracked
 * - '!' - Ignored
 * - 'U' - Updated but unmerged (conflict)
 */
export type StatusCode = ' ' | 'M' | 'A' | 'D' | 'R' | 'C' | '?' | '!' | 'U';
/**
 * Branch information for status display.
 *
 * @description Contains information about the current branch,
 * its tracking upstream, and ahead/behind counts.
 *
 * @property name - Current branch name (or short SHA if detached)
 * @property upstream - Remote tracking branch (e.g., 'origin/main')
 * @property ahead - Number of commits ahead of upstream
 * @property behind - Number of commits behind upstream
 * @property detached - Whether HEAD is detached (not on a branch)
 */
export interface BranchInfo {
    /** Current branch name */
    name: string;
    /** Remote tracking branch */
    upstream?: string;
    /** Number of commits ahead of upstream */
    ahead?: number;
    /** Number of commits behind upstream */
    behind?: number;
    /** Whether HEAD is detached */
    detached?: boolean;
}
/**
 * Complete result of the status command.
 *
 * @description Contains all information needed to display the status:
 * branch info, file statuses, and whether the working tree is clean.
 *
 * @property branch - Branch information
 * @property files - Array of file status objects
 * @property isClean - true if there are no changes to commit
 */
export interface StatusResult {
    /** Branch information */
    branch: BranchInfo;
    /** File statuses */
    files: FileStatus[];
    /** Whether the working tree is clean */
    isClean: boolean;
}
/**
 * Execute the status command.
 *
 * @description Main entry point for the status command. Displays the working
 * tree status in either long or short format based on options.
 *
 * @param ctx - Command context with cwd, options, and I/O functions
 *
 * @throws {Error} With message starting "fatal:" if not in a git repository
 *
 * @example
 * // Long format (default)
 * await statusCommand({ cwd: '/repo', options: {}, stdout: console.log, stderr: console.error, args: [], rawArgs: [] })
 *
 * @example
 * // Short format
 * await statusCommand({ cwd: '/repo', options: { short: true }, stdout: console.log, stderr: console.error, args: [], rawArgs: [] })
 *
 * @example
 * // Branch only
 * await statusCommand({ cwd: '/repo', options: { branch: true }, stdout: console.log, stderr: console.error, args: [], rawArgs: [] })
 */
export declare function statusCommand(ctx: CommandContext): Promise<void>;
/**
 * Get the working tree status.
 *
 * @description Computes the complete status of the working tree by comparing
 * the index (staging area), working directory, and HEAD commit. Returns
 * structured status information for all tracked and untracked files.
 *
 * @param cwd - Working directory (repository root)
 * @returns Promise<StatusResult> with branch info, file statuses, and isClean flag
 *
 * @throws {Error} With message starting "fatal:" if not in a git repository
 *
 * @example
 * const status = await getStatus('/path/to/repo')
 * if (status.isClean) {
 *   console.log('Nothing to commit, working tree clean')
 * } else {
 *   console.log(`${status.files.length} files with changes`)
 * }
 */
export declare function getStatus(cwd: string): Promise<StatusResult>;
/**
 * Get branch information for the current repository.
 *
 * @description Retrieves information about the current branch including
 * its name, upstream tracking branch, and ahead/behind counts. Detects
 * detached HEAD state.
 *
 * @param cwd - Working directory (repository root)
 * @returns Promise<BranchInfo> with branch name and tracking information
 *
 * @throws {Error} With message starting "fatal:" if not in a git repository
 *
 * @example
 * const branch = await getBranchInfo('/path/to/repo')
 * if (branch.detached) {
 *   console.log(`Detached at ${branch.name}`)
 * } else {
 *   console.log(`On branch ${branch.name}`)
 *   if (branch.upstream) {
 *     console.log(`Tracking ${branch.upstream}`)
 *   }
 * }
 */
export declare function getBranchInfo(cwd: string): Promise<BranchInfo>;
/**
 * Format status output for display (long format).
 *
 * @description Formats the status result in git's long format, showing
 * grouped sections for staged changes, unstaged changes, and untracked files.
 * Includes branch tracking information and helpful hints.
 *
 * @param result - StatusResult object with branch and file information
 * @returns Formatted multi-line string suitable for terminal output
 *
 * @example
 * const status = await getStatus('/repo')
 * console.log(formatStatusLong(status))
 * // On branch main
 * // Your branch is up to date with 'origin/main'.
 * //
 * // Changes to be committed:
 * //   new file:   src/feature.ts
 */
export declare function formatStatusLong(result: StatusResult): string;
/**
 * Format status output for display (short format).
 *
 * @description Formats the status result in git's short/porcelain format,
 * showing two-character status codes followed by the file path. Used with
 * the --short flag.
 *
 * @param result - StatusResult object with branch and file information
 * @returns Formatted string with one file per line (empty string if no changes)
 *
 * @example
 * const status = await getStatus('/repo')
 * console.log(formatStatusShort(status))
 * // A  src/new-file.ts
 * // M  src/modified.ts
 * // ?? untracked.txt
 */
export declare function formatStatusShort(result: StatusResult): string;
/**
 * Format branch info for --branch flag.
 *
 * @description Formats branch information in the short format used with
 * --branch flag. Shows branch name, tracking upstream, and ahead/behind counts.
 *
 * @param branch - BranchInfo object
 * @returns Single-line string starting with "## " showing branch status
 *
 * @example
 * console.log(formatBranchOnly({ name: 'main', upstream: 'origin/main', ahead: 2, behind: 0 }))
 * // ## main...origin/main [ahead 2]
 *
 * @example
 * console.log(formatBranchOnly({ name: 'abc1234', detached: true }))
 * // ## HEAD (no branch)
 */
export declare function formatBranchOnly(branch: BranchInfo): string;
//# sourceMappingURL=status.d.ts.map