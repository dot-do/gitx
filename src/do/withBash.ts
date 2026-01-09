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

import {
  BashModule,
  type BashModuleOptions,
  type BashExecutor,
  type FsCapability,
  type BashStorage,
} from './BashModule'

// ============================================================================
// Types
// ============================================================================

/**
 * Type for a class constructor.
 * Used as the base constraint for mixin composition.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T

/**
 * Interface for DOs that have bash capability.
 * Classes extended with withBash will implement this interface.
 */
export interface WithBashCapability {
  /**
   * The BashModule instance providing bash execution functionality.
   * Lazily initialized on first access.
   */
  readonly bash: BashModule
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
   * Whether to use AST-based safety analysis.
   * @default true
   */
  useAST?: boolean

  /**
   * Policy name to use when persisting settings to database.
   * @default 'default'
   */
  policyName?: string

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
  getExecutor?: (instance: object) => BashExecutor | undefined

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
  getFs?: (instance: object) => FsCapability | undefined

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
  getStorage?: (instance: object) => BashStorage | undefined
}

// ============================================================================
// Mixin Implementation
// ============================================================================

/**
 * Symbol used to store the BashModule instance for lazy initialization.
 * Using a symbol prevents name collisions with user-defined properties.
 */
const BASH_MODULE_SYMBOL = Symbol('bashModule')

/**
 * Symbol used to store the options for lazy initialization.
 */
const BASH_OPTIONS_SYMBOL = Symbol('bashOptions')

/**
 * Symbol to track if the module has been initialized.
 */
const BASH_INITIALIZED_SYMBOL = Symbol('bashInitialized')

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
export function withBash<TBase extends Constructor>(
  Base: TBase,
  options: WithBashOptions = {}
): TBase & Constructor<WithBashCapability> {
  // Create the extended class
  class WithBashClass extends Base implements WithBashCapability {
    /**
     * Internal storage for the lazily initialized BashModule.
     */
    private [BASH_MODULE_SYMBOL]: BashModule | undefined

    /**
     * Internal storage for the options.
     */
    private [BASH_OPTIONS_SYMBOL]: WithBashOptions

    /**
     * Tracks whether initialization has been attempted.
     */
    private [BASH_INITIALIZED_SYMBOL]: boolean = false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)
      this[BASH_OPTIONS_SYMBOL] = options
    }

    /**
     * Get the BashModule instance, creating it lazily on first access.
     *
     * @returns The BashModule instance
     */
    get bash(): BashModule {
      if (!this[BASH_MODULE_SYMBOL]) {
        this[BASH_MODULE_SYMBOL] = this._createBashModule()
      }
      return this[BASH_MODULE_SYMBOL]
    }

    /**
     * Create the BashModule instance with resolved options.
     *
     * @returns A new BashModule instance
     * @private
     */
    private _createBashModule(): BashModule {
      const opts = this[BASH_OPTIONS_SYMBOL]

      // Build module options, resolving lazy factories
      const moduleOptions: BashModuleOptions = {
        cwd: opts.cwd,
        defaultTimeout: opts.defaultTimeout,
        blockedCommands: opts.blockedCommands,
        requireConfirmation: opts.requireConfirmation,
        useAST: opts.useAST,
        policyName: opts.policyName,
      }

      // Resolve executor if factory provided
      if (opts.getExecutor) {
        moduleOptions.executor = opts.getExecutor(this)
      }

      // Resolve filesystem if factory provided
      if (opts.getFs) {
        moduleOptions.fs = opts.getFs(this)
      }

      // Resolve storage if factory provided
      if (opts.getStorage) {
        moduleOptions.storage = opts.getStorage(this)
      }

      return new BashModule(moduleOptions)
    }

    /**
     * Initialize the bash module asynchronously.
     * This should be called if you need database-backed settings to be loaded.
     *
     * @returns Promise that resolves when initialization is complete
     */
    async initializeBash(): Promise<void> {
      if (this[BASH_INITIALIZED_SYMBOL]) return

      // Ensure bash module is created
      const bash = this.bash

      // Initialize if storage is configured
      if (bash.hasStorage()) {
        await bash.initialize()
      }

      this[BASH_INITIALIZED_SYMBOL] = true
    }
  }

  // Return the class with proper typing
  return WithBashClass as TBase & Constructor<WithBashCapability>
}

// ============================================================================
// Type Guards
// ============================================================================

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
export function hasBashCapability(value: unknown): value is WithBashCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bash' in value &&
    value.bash instanceof BashModule
  )
}

// ============================================================================
// Re-exports for Convenience
// ============================================================================

export {
  BashModule,
  type BashModuleOptions,
  type BashExecutor,
  type FsCapability,
  type BashStorage,
}
