/**
 * @fileoverview withGit Mixin Function for DO Composition
 *
 * This module provides a mixin function that adds git capability to any
 * Durable Object class. The mixin supports lazy initialization of the
 * GitModule for optimal performance.
 *
 * @module do/withGit
 *
 * @example
 * ```typescript
 * import { withGit } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * // Basic usage - adds this.git property
 * class MyDO extends withGit(DO, { repo: 'org/repo' }) {
 *   async handleRequest() {
 *     await this.git.sync()
 *     const status = await this.git.status()
 *     return new Response(JSON.stringify(status))
 *   }
 * }
 *
 * // With $.git context integration
 * class WorkflowDO extends withGit(DO, {
 *   repo: 'org/repo',
 *   contextMode: true
 * }) {
 *   async handleRequest() {
 *     // Access via $.git when contextMode is enabled
 *     await this.$.git.sync()
 *   }
 * }
 * ```
 */
import { GitModule, type GitModuleOptions, type GitBinding, type GitStatus, type SyncResult, type PushResult, type FsCapability, type R2BucketLike } from './GitModule';
/**
 * Type for a class constructor.
 * @template T - The type that the constructor creates
 */
export type Constructor<T = object> = new (...args: any[]) => T;
/**
 * Interface for DOs that have git capability.
 * This is the shape of a class after applying the withGit mixin.
 */
export interface WithGitCapability {
    /** The GitModule instance providing git operations */
    git: GitModule;
}
/**
 * Interface for the extended WorkflowContext with git capability.
 * Used when contextMode is enabled.
 */
export interface WithGitContext {
    git: GitModule;
    [key: string]: unknown;
}
/**
 * Configuration options for the withGit mixin.
 */
export interface WithGitOptions {
    /**
     * Repository identifier (e.g., 'org/repo' or full URL)
     */
    repo: string;
    /**
     * Branch to track
     * @default 'main'
     */
    branch?: string;
    /**
     * Path prefix within the repository
     */
    path?: string;
    /**
     * R2 binding name in env to use for object storage
     * @default 'R2_BUCKET'
     */
    r2Binding?: string;
    /**
     * Custom object key prefix in R2
     * @default 'git/objects'
     */
    objectPrefix?: string;
    /**
     * Whether to extend the $ WorkflowContext with git capability.
     * When true, this.$.git will be available in addition to this.git.
     * @default false
     */
    contextMode?: boolean;
    /**
     * Whether to auto-initialize the GitModule on construction.
     * When false (default), GitModule is lazily initialized on first access.
     * @default false
     */
    autoInit?: boolean;
}
/**
 * Mixin function to add git capability to a DO class.
 *
 * @description
 * Composes git functionality into a Durable Object class using the mixin pattern.
 * The resulting class will have a `git` property that provides GitModule functionality.
 *
 * Features:
 * - Lazy initialization: GitModule is only created when first accessed
 * - R2 integration: Automatically resolves R2 bucket from env bindings
 * - Context mode: Optionally extends the $ WorkflowContext with git capability
 * - Composable: Can be combined with other mixins like withBash
 *
 * @param Base - Base class to extend
 * @param options - Git configuration options
 * @returns Extended class with git capability
 *
 * @example
 * ```typescript
 * // Basic usage
 * import { withGit } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * class MyDO extends withGit(DO, { repo: 'org/repo' }) {
 *   async syncAndCommit() {
 *     await this.git.sync()
 *     await this.git.add('.')
 *     await this.git.commit('Update files')
 *     await this.git.push()
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With custom R2 binding
 * class MyDO extends withGit(DO, {
 *   repo: 'org/repo',
 *   branch: 'develop',
 *   r2Binding: 'GIT_OBJECTS'
 * }) {
 *   async handleRequest() {
 *     await this.git.sync()
 *     return new Response('Synced!')
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Composing with other mixins
 * import { withGit, withBash } from 'gitx.do/do'
 *
 * class DevDO extends withBash(withGit(DO, { repo: 'org/repo' }), {
 *   cwd: '/workspace'
 * }) {
 *   async buildAndPush() {
 *     await this.git.sync()
 *     await this.bash.exec('npm', ['run', 'build'])
 *     await this.git.add('dist/')
 *     await this.git.commit('Build: update dist')
 *     await this.git.push()
 *   }
 * }
 * ```
 */
export declare function withGit<TBase extends Constructor>(Base: TBase, options: WithGitOptions): TBase & Constructor<WithGitCapability>;
/**
 * Check if a value has git capability.
 *
 * @param value - Value to check
 * @returns True if value has the git property and it's a GitModule
 *
 * @example
 * ```typescript
 * if (hasGitCapability(instance)) {
 *   await instance.git.sync()
 * }
 * ```
 */
export declare function hasGitCapability(value: unknown): value is WithGitCapability;
export { GitModule, type GitModuleOptions, type GitBinding, type GitStatus, type SyncResult, type PushResult, type FsCapability, type R2BucketLike, };
//# sourceMappingURL=withGit.d.ts.map