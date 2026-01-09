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
// GitModule Exports
// ============================================================================

export {
  // Main class
  GitModule,
  // Factory function
  createGitModule,
  // Type guard
  isGitModule,
  // Types
  type GitModuleOptions,
  type GitBinding,
  type GitStatus,
  type SyncResult,
  type PushResult,
  // Dependency types
  type FsCapability,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
} from './GitModule'

// ============================================================================
// Mixin Exports (placeholder for gitx-0qbp task)
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
  git: import('./GitModule').GitModule
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
  // This is a placeholder implementation
  // Full implementation is tracked in gitx-0qbp
  return class extends Base implements WithGitCapability {
    git: import('./GitModule').GitModule

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      // Placeholder - would need access to env for R2 bucket
      const { GitModule } = require('./GitModule')
      this.git = new GitModule({
        repo: options.repo,
        branch: options.branch,
        path: options.path
      })
    }
  } as TBase & Constructor<WithGitCapability>
}
