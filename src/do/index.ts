/**
 * @fileoverview gitx.do/do Entry Point
 *
 * This is the entry point for integrating gitx with dotdo's Durable Objects.
 * It exports the GitModule class and related utilities for use in DOs.
 *
 * @module gitx.do/do
 *
 * @example
 * ```typescript
 * // Import for DO integration
 * import { GitModule, createGitModule, withGit } from 'gitx.do/do'
 *
 * // Create a GitModule in your DO
 * class MyDO extends DO {
 *   git = new GitModule({
 *     repo: 'org/repo',
 *     branch: 'main',
 *     r2: this.env.R2_BUCKET
 *   })
 *
 *   async syncRepository() {
 *     await this.git.sync()
 *   }
 * }
 *
 * // Or use the withGit mixin
 * class MyDO extends withGit(DO, { repo: 'org/repo' }) {
 *   // this.git is automatically available
 * }
 * ```
 */

// ============================================================================
// GitModule Imports and Exports
// ============================================================================

import {
  GitModule,
  createGitModule,
  isGitModule,
  type GitModuleOptions,
  type GitBinding,
  type GitStatus,
  type SyncResult,
  type PushResult,
  type FsCapability,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
} from './GitModule'

export {
  GitModule,
  createGitModule,
  isGitModule,
  type GitModuleOptions,
  type GitBinding,
  type GitStatus,
  type SyncResult,
  type PushResult,
  type FsCapability,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
}

// ============================================================================
// BashModule Imports and Exports
// ============================================================================

import {
  BashModule,
  createBashModule,
  isBashModule,
  type BashModuleOptions,
  type BashResult,
  type ExecOptions,
  type SpawnOptions,
  type SpawnHandle,
  type BashExecutor,
  type SafetyAnalysis,
  type FsCapability as BashFsCapability,
  type BashStorage,
  type ExecRow,
  type ExecPolicy,
} from './BashModule'

export {
  BashModule,
  createBashModule,
  isBashModule,
  type BashModuleOptions,
  type BashResult,
  type ExecOptions,
  type SpawnOptions,
  type SpawnHandle,
  type BashExecutor,
  type SafetyAnalysis,
  type BashFsCapability,
  type BashStorage,
  type ExecRow,
  type ExecPolicy,
}

// ============================================================================
// Bash AST Parser Imports and Exports
// ============================================================================

import {
  parseBashCommand,
  analyzeASTSafety,
  parseAndAnalyze,
  type ASTNodeType,
  type ListOperator,
  type RedirectType,
  type ASTNode,
  type WordNode,
  type RedirectNode,
  type AssignmentNode,
  type CommandNode,
  type PipelineNode,
  type ListNode,
  type SubshellNode,
  type FunctionNode,
  type ImpactLevel,
  type ASTSafetyAnalysis,
  type SafetyIssue,
} from './bash-ast'

export {
  parseBashCommand,
  analyzeASTSafety,
  parseAndAnalyze,
  type ASTNodeType,
  type ListOperator,
  type RedirectType,
  type ASTNode,
  type WordNode,
  type RedirectNode,
  type AssignmentNode,
  type CommandNode,
  type PipelineNode,
  type ListNode,
  type SubshellNode,
  type FunctionNode,
  type ImpactLevel,
  type ASTSafetyAnalysis,
  type SafetyIssue,
}

// ============================================================================
// Mixin Exports
// ============================================================================

/**
 * Type for a class constructor.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T

/**
 * Interface for DOs that have git capability.
 */
export interface WithGitCapability {
  git: GitModule
}

/**
 * Interface for DOs that have bash capability.
 */
export interface WithBashCapability {
  bash: BashModule
}

/**
 * Options for the withGit mixin.
 */
export interface WithGitOptions {
  /**
   * Repository identifier
   */
  repo: string
  /**
   * Branch to track
   * @default 'main'
   */
  branch?: string
  /**
   * Path prefix within the repository
   */
  path?: string
  /**
   * R2 binding name in env
   * @default 'R2_BUCKET'
   */
  r2Binding?: string
}

/**
 * Options for the withBash mixin.
 */
export interface WithBashOptions {
  /**
   * Default working directory for commands.
   * @default '/'
   */
  cwd?: string
  /**
   * Default timeout for commands in milliseconds.
   * @default 30000
   */
  defaultTimeout?: number
  /**
   * List of commands that are blocked from execution.
   */
  blockedCommands?: string[]
  /**
   * Whether to require confirmation for dangerous commands.
   * @default true
   */
  requireConfirmation?: boolean
  /**
   * Executor binding name in env (for getting the executor from env).
   * If not provided, the bash module will be created without an executor.
   */
  executorBinding?: string
}

/**
 * Mixin function to add git capability to a DO class.
 *
 * @description
 * Composes git functionality into a Durable Object class.
 * The resulting class will have a `git` property that provides
 * GitModule functionality.
 *
 * This is a placeholder for the gitx-0qbp task.
 *
 * @param Base - Base class to extend
 * @param options - Git configuration options
 * @returns Extended class with git capability
 *
 * @example
 * ```typescript
 * import { withGit } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * class MyDO extends withGit(DO, { repo: 'org/repo' }) {
 *   async handleRequest() {
 *     await this.git.sync()
 *     const status = await this.git.status()
 *     return new Response(JSON.stringify(status))
 *   }
 * }
 * ```
 */
export function withGit<TBase extends Constructor>(
  Base: TBase,
  options: WithGitOptions
): TBase & Constructor<WithGitCapability> {
  return class extends Base implements WithGitCapability {
    git: GitModule

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      // Placeholder - would need access to env for R2 bucket
      this.git = new GitModule({
        repo: options.repo,
        branch: options.branch,
        path: options.path
      })
    }
  } as TBase & Constructor<WithGitCapability>
}

/**
 * Mixin function to add bash capability to a DO class.
 *
 * @description
 * Composes bash execution functionality into a Durable Object class.
 * The resulting class will have a `bash` property that provides
 * BashModule functionality for executing shell commands.
 *
 * The mixin supports:
 * - Command execution via exec() and run()
 * - Streaming execution via spawn()
 * - Safety analysis and command blocking
 * - Configurable timeouts and working directory
 *
 * @param Base - Base class to extend
 * @param options - Bash configuration options (optional)
 * @returns Extended class with bash capability
 *
 * @example
 * ```typescript
 * import { withBash } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * // Basic usage with defaults
 * class MyDO extends withBash(DO) {
 *   async runCommand() {
 *     const result = await this.bash.exec('ls', ['-la'])
 *     return new Response(result.stdout)
 *   }
 * }
 *
 * // With custom options
 * class SecureDO extends withBash(DO, {
 *   cwd: '/app',
 *   defaultTimeout: 60000,
 *   blockedCommands: ['rm', 'wget'],
 *   requireConfirmation: true
 * }) {
 *   async buildProject() {
 *     const result = await this.bash.exec('npm', ['run', 'build'])
 *     if (result.exitCode !== 0) {
 *       throw new Error(`Build failed: ${result.stderr}`)
 *     }
 *     return new Response('Build successful')
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Combining with withGit
 * import { withGit, withBash } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * class DevDO extends withBash(withGit(DO, { repo: 'org/repo' }), {
 *   cwd: '/workspace'
 * }) {
 *   async setupAndBuild() {
 *     // Sync git repository
 *     await this.git.sync()
 *
 *     // Run build commands
 *     await this.bash.exec('npm', ['install'])
 *     await this.bash.exec('npm', ['run', 'build'])
 *   }
 * }
 * ```
 */
export function withBash<TBase extends Constructor>(
  Base: TBase,
  options: WithBashOptions = {}
): TBase & Constructor<WithBashCapability> {
  return class extends Base implements WithBashCapability {
    bash: BashModule

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      this.bash = new BashModule({
        cwd: options.cwd,
        defaultTimeout: options.defaultTimeout,
        blockedCommands: options.blockedCommands,
        requireConfirmation: options.requireConfirmation
        // Note: executor and fs would need to be provided separately
        // or obtained from the DO's env/context in a full implementation
      })
    }
  } as TBase & Constructor<WithBashCapability>
}
