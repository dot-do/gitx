/**
 * @fileoverview Git Commit Command
 *
 * This module implements the `gitx commit` command which records changes to
 * the repository by creating commit objects. Features include:
 * - Creating commits with messages (-m flag)
 * - Amending the previous commit (--amend flag)
 * - Auto-staging modified tracked files (-a flag)
 * - Commit message validation
 * - User identity verification (requires user.name and user.email)
 *
 * @module cli/commands/commit
 *
 * @example
 * // Create a commit with a message
 * const result = await createCommit(cwd, { message: 'feat: add new feature' })
 * console.log(`Created commit ${result.sha.substring(0, 7)}`)
 *
 * @example
 * // Amend the previous commit with new staged changes
 * const result = await createCommit(cwd, { amend: true })
 *
 * @example
 * // Auto-stage and commit all modified tracked files
 * const result = await createCommit(cwd, { message: 'fix: bug fix', all: true })
 */
import type { CommandContext } from '../index';
/**
 * Options for creating a commit.
 *
 * @description Configuration options controlling commit behavior.
 *
 * @property message - Commit message (required unless amending)
 * @property amend - If true, amend the previous commit instead of creating new
 * @property all - If true, auto-stage all modified tracked files before committing
 */
export interface CommitOptions {
    /** Commit message */
    message?: string;
    /** Amend the previous commit */
    amend?: boolean;
    /** Auto-stage all modified tracked files */
    all?: boolean;
}
/**
 * Information about a staged file.
 *
 * @description Represents a file in the git index (staging area) with
 * its path, blob SHA, and file mode.
 *
 * @property path - File path relative to repository root
 * @property sha - SHA-1 hash of the file's blob object
 * @property mode - Unix file mode (e.g., 0o100644 for regular file)
 */
export interface StagedFile {
    /** File path */
    path: string;
    /** Object SHA */
    sha: string;
    /** File mode */
    mode: number;
}
/**
 * Result of a commit operation.
 *
 * @description Contains all information about the newly created commit.
 *
 * @property sha - Full 40-character SHA of the new commit
 * @property message - The commit message
 * @property author - Author string in "Name <email>" format
 * @property committer - Committer string in "Name <email>" format
 * @property date - Timestamp when the commit was created
 * @property tree - SHA of the tree object for this commit
 * @property parents - Array of parent commit SHAs (empty for initial, 1+ for normal/merge)
 */
export interface CommitResult {
    /** Commit SHA */
    sha: string;
    /** Commit message */
    message: string;
    /** Author string (name <email>) */
    author: string;
    /** Committer string (name <email>) */
    committer: string;
    /** Commit date */
    date: Date;
    /** Tree SHA */
    tree: string;
    /** Parent commit SHAs */
    parents: string[];
}
/**
 * Execute the commit command from the CLI.
 *
 * @description Main entry point for the `gitx commit` command. Parses
 * command-line options and creates a commit with the staged changes.
 *
 * @param ctx - Command context with cwd, options, and output functions
 * @returns Promise that resolves when commit is complete
 * @throws {Error} If message not provided and not amending
 * @throws {Error} If not in a git repository
 * @throws {Error} If user identity not configured
 * @throws {Error} If nothing to commit and not amending
 *
 * @example
 * // CLI usage
 * // gitx commit -m "feat: add new feature"
 * // gitx commit --amend
 * // gitx commit -a -m "fix: update all files"
 */
export declare function commitCommand(ctx: CommandContext): Promise<void>;
/**
 * Create a new commit.
 *
 * @description Creates a commit object from staged changes and updates the
 * current branch ref. Handles all commit scenarios:
 * - Normal commit with staged files
 * - Amending previous commit
 * - Auto-staging modified tracked files (-a flag)
 *
 * The commit is created with the configured user.name and user.email from
 * the repository's git config.
 *
 * @param cwd - Working directory (repository root)
 * @param options - Commit options (message, amend, all)
 * @returns Promise resolving to commit result with SHA and metadata
 * @throws {Error} If not in a git repository
 * @throws {Error} If amending with no previous commit
 * @throws {Error} If message is empty or missing (when not using original message)
 * @throws {Error} If user.name is not configured
 * @throws {Error} If user.email is not configured
 * @throws {Error} If nothing to commit (no staged files, not amending)
 *
 * @example
 * // Simple commit
 * const result = await createCommit(cwd, { message: 'Initial commit' })
 *
 * @example
 * // Amend with new message
 * const result = await createCommit(cwd, { amend: true, message: 'Updated message' })
 *
 * @example
 * // Amend keeping original message
 * const result = await createCommit(cwd, { amend: true })
 *
 * @example
 * // Auto-stage and commit
 * const result = await createCommit(cwd, { message: 'Update all', all: true })
 */
export declare function createCommit(cwd: string, options: CommitOptions): Promise<CommitResult>;
/**
 * Validate commit message format.
 *
 * @description Checks if a commit message is valid. A message is valid if
 * it is non-empty after trimming whitespace.
 *
 * @param message - Commit message to validate
 * @returns True if message is valid, false otherwise
 *
 * @example
 * validateCommitMessage('feat: add feature') // true
 * validateCommitMessage('') // false
 * validateCommitMessage('   ') // false
 */
export declare function validateCommitMessage(message: string): boolean;
/**
 * Get list of staged files.
 *
 * @description Reads the staging area (index) and returns information about
 * all staged files. In this implementation, reads from a mock file for testing.
 *
 * @param cwd - Working directory (repository root)
 * @returns Promise resolving to array of staged files
 *
 * @example
 * const staged = await getStagedFiles(cwd)
 * for (const file of staged) {
 *   console.log(`${file.path}: ${file.sha}`)
 * }
 */
export declare function getStagedFiles(cwd: string): Promise<StagedFile[]>;
//# sourceMappingURL=commit.d.ts.map