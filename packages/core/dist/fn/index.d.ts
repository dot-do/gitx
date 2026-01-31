/**
 * @fileoverview GitX Function - AsyncFn Pattern for Git Operations
 *
 * Provides a callable git function supporting three invocation styles:
 * 1. gitx('git status') - Direct call with command string
 * 2. gitx`git status` - Tagged template literal
 * 3. gitx`git status`({ cwd: '/path' }) - Tagged template with options
 *
 * @module @dotdo/gitx/fn
 *
 * @example
 * ```typescript
 * import { gitx } from '@dotdo/gitx/fn'
 *
 * // Style 1: Direct call
 * const status = await gitx('git status')
 *
 * // Style 2: Tagged template
 * const log = await gitx`git log --oneline -5`
 *
 * // Style 3: Tagged template with options
 * const diff = await gitx`git diff HEAD~1`({ cwd: '/my/repo' })
 * ```
 */
import type { AsyncFn } from '@dotdo/do/types';
/**
 * Git command execution result
 */
export interface GitResult {
    /** Whether the command succeeded */
    success: boolean;
    /** Exit code (0 = success) */
    exitCode: number;
    /** Standard output */
    stdout: string;
    /** Standard error */
    stderr: string;
    /** The command that was executed */
    command: string;
    /** Execution duration in milliseconds */
    duration: number;
}
/**
 * Options for git command execution
 */
export interface GitOptions extends Record<string, unknown> {
    /** Working directory for the command */
    cwd?: string;
    /** Environment variables */
    env?: Record<string, string>;
    /** Timeout in milliseconds */
    timeout?: number;
    /** Git executable path (default: 'git') */
    gitPath?: string;
}
/**
 * Git context for configuring the gitx function
 */
export interface GitContext {
    /** Default working directory */
    cwd?: string;
    /** Default environment variables */
    env?: Record<string, string>;
    /** Default timeout */
    timeout?: number;
    /** Git executable path */
    gitPath?: string;
    /** Execute function (for custom implementations) */
    exec?: (command: string, options: GitOptions) => Promise<GitResult>;
}
/**
 * GitX AsyncFn type - a callable supporting all three invocation styles
 *
 * This is the type signature for the gitx function, following the
 * AsyncFn<Out, In, Opts> pattern from @dotdo/types.
 */
export type GitXFn = AsyncFn<GitResult, string, GitOptions>;
/**
 * Create a GitX function with custom configuration
 *
 * @param context - Configuration context
 * @returns A configured gitx function
 *
 * @example
 * ```typescript
 * // Create a gitx function with Node.js execution
 * import { exec } from 'child_process'
 * import { promisify } from 'util'
 *
 * const execAsync = promisify(exec)
 *
 * const gitx = createGitX({
 *   cwd: '/my/repo',
 *   exec: async (command, options) => {
 *     const start = Date.now()
 *     try {
 *       const { stdout, stderr } = await execAsync(command, {
 *         cwd: options.cwd,
 *         env: { ...process.env, ...options.env },
 *         timeout: options.timeout,
 *       })
 *       return {
 *         success: true,
 *         exitCode: 0,
 *         stdout,
 *         stderr,
 *         command,
 *         duration: Date.now() - start,
 *       }
 *     } catch (error) {
 *       return {
 *         success: false,
 *         exitCode: error.code || 1,
 *         stdout: error.stdout || '',
 *         stderr: error.stderr || error.message,
 *         command,
 *         duration: Date.now() - start,
 *       }
 *     }
 *   },
 * })
 *
 * const status = await gitx`status`
 * ```
 */
export declare function createGitX(context?: GitContext): GitXFn;
/**
 * Default gitx instance (uses placeholder executor)
 *
 * For actual execution, use createGitX() with a custom executor.
 */
export declare const gitx: GitXFn;
export type { AsyncFn } from '@dotdo/do/types';
export type { GitRepository, GitStatus, GitRef, GitAuthor, CommitObject, GitInitOptions, GitCloneOptions, GitCommitOptions, GitLogOptions, GitBranchOptions, GitCheckoutOptions, GitMergeOptions, GitFetchOptions, GitPullOptions, GitPushOptions, GitDiffOptions, MergeResult, StatusFile, } from '@dotdo/do/types';
//# sourceMappingURL=index.d.ts.map