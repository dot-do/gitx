/**
 * @fileoverview withBash Mixin for DO Composition
 *
 * This module provides a mixin function that adds bash execution capability
 * to any Durable Object class. The mixin follows the TypeScript mixin pattern
 * and supports lazy initialization of the BashModule.
 *
 * @module do/withBash
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
 */
import { BashModule, type BashModuleOptions, type BashExecutor, type FsCapability, type BashStorage } from './BashModule';
/**
 * Type for a class constructor.
 * Used as the base constraint for mixin composition.
 */
export type Constructor<T = object> = new (...args: any[]) => T;
/**
 * Interface for DOs that have bash capability.
 * Classes extended with withBash will implement this interface.
 */
export interface WithBashCapability {
    /**
     * The BashModule instance providing bash execution functionality.
     * Lazily initialized on first access.
     */
    readonly bash: BashModule;
}
/**
 * Options for the withBash mixin.
 * These options configure the BashModule that will be created.
 */
export interface WithBashOptions {
    /**
     * Default working directory for commands.
     * @default '/'
     */
    cwd?: string;
    /**
     * Default timeout for commands in milliseconds.
     * @default 30000
     */
    defaultTimeout?: number;
    /**
     * List of commands that are blocked from execution.
     */
    blockedCommands?: string[];
    /**
     * Whether to require confirmation for dangerous commands.
     * @default true
     */
    requireConfirmation?: boolean;
    /**
     * Whether to use AST-based safety analysis.
     * @default true
     */
    useAST?: boolean;
    /**
     * Policy name to use when persisting settings to database.
     * @default 'default'
     */
    policyName?: string;
    /**
     * Factory function to get the executor from the DO instance.
     * This enables lazy binding of the executor based on the DO's environment.
     *
     * @param instance - The DO instance
     * @returns The BashExecutor to use, or undefined if none available
     *
     * @example
     * ```typescript
     * withBash(DO, {
     *   getExecutor: (instance) => instance.env?.CONTAINER_EXECUTOR
     * })
     * ```
     */
    getExecutor?: (instance: object) => BashExecutor | undefined;
    /**
     * Factory function to get the filesystem capability from the DO instance.
     * This enables lazy binding of the fs capability based on the DO's context.
     *
     * @param instance - The DO instance
     * @returns The FsCapability to use, or undefined if none available
     *
     * @example
     * ```typescript
     * withBash(DO, {
     *   getFs: (instance) => instance.$?.fs
     * })
     * ```
     */
    getFs?: (instance: object) => FsCapability | undefined;
    /**
     * Factory function to get the storage from the DO instance.
     * This enables lazy binding of storage for persistent settings.
     *
     * @param instance - The DO instance
     * @returns The BashStorage to use, or undefined if none available
     *
     * @example
     * ```typescript
     * withBash(DO, {
     *   getStorage: (instance) => instance.state?.storage
     * })
     * ```
     */
    getStorage?: (instance: object) => BashStorage | undefined;
}
/**
 * Mixin function to add bash capability to a DO class.
 *
 * @description
 * Composes bash execution functionality into a Durable Object class.
 * The resulting class will have a `bash` property that provides
 * BashModule functionality for executing shell commands.
 *
 * The BashModule is lazily initialized on first access to the `bash`
 * property. This means:
 * - No overhead if bash is never used
 * - Factory functions (getExecutor, getFs, getStorage) are called at first access
 * - The module can be properly initialized with DO-specific context
 *
 * The mixin supports:
 * - Command execution via exec() and run()
 * - Streaming execution via spawn()
 * - Safety analysis and command blocking
 * - Configurable timeouts and working directory
 * - Database persistence for execution policies
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
 * // With custom options and lazy binding
 * class SecureDO extends withBash(DO, {
 *   cwd: '/app',
 *   defaultTimeout: 60000,
 *   blockedCommands: ['rm', 'wget'],
 *   requireConfirmation: true,
 *   getExecutor: (instance) => (instance as any).env?.CONTAINER_EXECUTOR,
 *   getFs: (instance) => (instance as any).$?.fs,
 *   getStorage: (instance) => (instance as any).state?.storage
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
export declare function withBash<TBase extends Constructor>(Base: TBase, options?: WithBashOptions): TBase & Constructor<WithBashCapability>;
/**
 * Check if a value has bash capability.
 *
 * @param value - Value to check
 * @returns True if value has the bash property
 *
 * @example
 * ```typescript
 * if (hasBashCapability(instance)) {
 *   const result = await instance.bash.exec('ls')
 * }
 * ```
 */
export declare function hasBashCapability(value: unknown): value is WithBashCapability;
export { BashModule, type BashModuleOptions, type BashExecutor, type FsCapability, type BashStorage, };
//# sourceMappingURL=withBash.d.ts.map