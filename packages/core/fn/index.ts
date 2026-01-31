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

import type { AsyncFn } from '@dotdo/do/types'

// =============================================================================
// GitX Types
// =============================================================================

/**
 * Git command execution result
 */
export interface GitResult {
  /** Whether the command succeeded */
  success: boolean
  /** Exit code (0 = success) */
  exitCode: number
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** The command that was executed */
  command: string
  /** Execution duration in milliseconds */
  duration: number
}

/**
 * Options for git command execution
 */
export interface GitOptions extends Record<string, unknown> {
  /** Working directory for the command */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Timeout in milliseconds */
  timeout?: number
  /** Git executable path (default: 'git') */
  gitPath?: string
}

/**
 * Git context for configuring the gitx function
 */
export interface GitContext {
  /** Default working directory */
  cwd?: string
  /** Default environment variables */
  env?: Record<string, string>
  /** Default timeout */
  timeout?: number
  /** Git executable path */
  gitPath?: string
  /** Execute function (for custom implementations) */
  exec?: (command: string, options: GitOptions) => Promise<GitResult>
}

// =============================================================================
// GitX Function Type
// =============================================================================

/**
 * GitX AsyncFn type - a callable supporting all three invocation styles
 *
 * This is the type signature for the gitx function, following the
 * AsyncFn<Out, In, Opts> pattern from @dotdo/types.
 */
export type GitXFn = AsyncFn<GitResult, string, GitOptions>

// =============================================================================
// Implementation
// =============================================================================

/**
 * Default command executor (placeholder - actual implementation depends on runtime)
 */
const defaultExec = async (command: string, options: GitOptions): Promise<GitResult> => {
  // This is a placeholder implementation
  // The actual implementation would use Node.js child_process, Deno.Command,
  // or make an RPC call to git.do service
  const start = Date.now()

  // For now, return a not-implemented error
  // Real implementations should be provided via createGitX
  return {
    success: false,
    exitCode: 1,
    stdout: '',
    stderr: 'GitX: No executor configured. Use createGitX() to create a configured instance.',
    command,
    duration: Date.now() - start,
  }
}

/**
 * Parse a git command string into command and args
 */
function parseGitCommand(input: string): string {
  const trimmed = input.trim()
  // If input starts with 'git ', use it as-is
  // Otherwise, prepend 'git '
  if (trimmed.toLowerCase().startsWith('git ')) {
    return trimmed
  }
  return `git ${trimmed}`
}

/**
 * Process template literal into a command string
 */
function processTemplate(strings: TemplateStringsArray, values: unknown[]): string {
  let result = ''
  for (let i = 0; i < strings.length; i++) {
    result += strings[i]
    if (i < values.length) {
      const value = values[i]
      // Escape shell-unsafe characters in interpolated values
      if (typeof value === 'string') {
        // Simple escaping - wrap in quotes if contains spaces
        if (value.includes(' ') && !value.startsWith('"') && !value.startsWith("'")) {
          result += `"${value.replace(/"/g, '\\"')}"`
        } else {
          result += value
        }
      } else if (value !== null && value !== undefined) {
        result += String(value)
      }
    }
  }
  return result.trim()
}

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
export function createGitX(context: GitContext = {}): GitXFn {
  const executor = context.exec || defaultExec

  // Build default options, only including defined values
  const defaultOptions: GitOptions = {}
  if (context.cwd !== undefined) defaultOptions.cwd = context.cwd
  if (context.env !== undefined) defaultOptions.env = context.env
  if (context.timeout !== undefined) defaultOptions.timeout = context.timeout
  if (context.gitPath !== undefined) defaultOptions.gitPath = context.gitPath

  // The main function implementation
  function gitx(input: string | TemplateStringsArray, ...values: unknown[]): Promise<GitResult> | ((opts?: GitOptions) => Promise<GitResult>) {
    // Check if called as tagged template or direct call
    if (typeof input === 'string') {
      // Style 1: Direct call - gitx('git status')
      const command = parseGitCommand(input)
      return executor(command, defaultOptions)
    }

    // Tagged template literal
    const command = parseGitCommand(processTemplate(input, values))

    // Check if this template has {name} placeholders (for style 3)
    // For simplicity, we always return a function that can be called with options
    // This allows both gitx`status` and gitx`status`({ cwd: '/path' })

    // Return a thenable that also accepts options
    const execute = (opts?: GitOptions): Promise<GitResult> => {
      const mergedOptions: GitOptions = { ...defaultOptions, ...opts }
      return executor(command, mergedOptions)
    }

    // Make it both a Promise and callable with options
    const promise = execute()

    // Add a method to call with options
    ;(promise as any).call = execute
    ;(promise as any)[Symbol.toStringTag] = 'GitXPromise'

    // For style 3 support, we need to return something that can be:
    // 1. Awaited directly (Promise<GitResult>)
    // 2. Called with options ((opts) => Promise<GitResult>)

    // Create a callable that's also a promise
    const callable = Object.assign(
      (opts?: GitOptions) => execute(opts),
      {
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
        finally: promise.finally.bind(promise),
        [Symbol.toStringTag]: 'GitXPromise',
      }
    )

    return callable as any
  }

  return gitx as GitXFn
}

/**
 * Default gitx instance (uses placeholder executor)
 *
 * For actual execution, use createGitX() with a custom executor.
 */
export const gitx: GitXFn = createGitX()

// =============================================================================
// Re-exports from @dotdo/do/types
// =============================================================================

// Re-export AsyncFn for consumers who want to define their own git functions
export type { AsyncFn } from '@dotdo/do/types'

// Re-export relevant git types from @dotdo/do/types
export type {
  GitRepository,
  GitStatus,
  GitRef,
  GitAuthor,
  CommitObject,
  GitInitOptions,
  GitCloneOptions,
  GitCommitOptions,
  GitLogOptions,
  GitBranchOptions,
  GitCheckoutOptions,
  GitMergeOptions,
  GitFetchOptions,
  GitPullOptions,
  GitPushOptions,
  GitDiffOptions,
  MergeResult,
  StatusFile,
} from '@dotdo/do/types'
