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
import { GitModule, } from './git-module';
// ============================================================================
// Symbol for Lazy Initialization Cache
// ============================================================================
/**
 * Symbol key for caching the GitModule instance.
 * Using a symbol prevents property name collisions.
 */
const GIT_MODULE_CACHE = Symbol('gitModuleCache');
/**
 * Symbol key for storing resolved options.
 */
const GIT_OPTIONS = Symbol('gitOptions');
// ============================================================================
// withGit Mixin Function
// ============================================================================
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
export function withGit(Base, options) {
    // Validate required options
    if (!options.repo) {
        throw new Error('withGit: repo option is required');
    }
    return class WithGitMixin extends Base {
        /**
         * Static list of capabilities for introspection.
         */
        static capabilities = [...(Base['capabilities'] || []), 'git'];
        /**
         * Cached GitModule instance (lazy initialized).
         */
        [GIT_MODULE_CACHE];
        /**
         * Resolved options for GitModule creation.
         */
        [GIT_OPTIONS];
        /**
         * Whether the git module has been initialized.
         */
        gitInitialized = false;
        /**
         * The git property provides access to the GitModule.
         * Implements lazy initialization - the module is only created
         * when this property is first accessed.
         */
        get git() {
            if (!this[GIT_MODULE_CACHE]) {
                this[GIT_MODULE_CACHE] = this.createGitModule();
            }
            return this[GIT_MODULE_CACHE];
        }
        /**
         * Check if this DO class has a specific capability.
         * @param name - Capability name to check
         * @returns True if the capability is available
         */
        hasCapability(name) {
            if (name === 'git')
                return true;
            // Check if parent class has the hasCapability method
            const baseProto = Base.prototype;
            if (baseProto && typeof baseProto['hasCapability'] === 'function') {
                return baseProto['hasCapability'].call(this, name);
            }
            return false;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(...args) {
            super(...args);
            // Resolve R2 bucket from env if available
            const env = this['env'];
            const r2BindingName = options.r2Binding ?? 'R2_BUCKET';
            const r2 = env?.[r2BindingName];
            // Get filesystem capability if available from $ context
            const dollarContext = this['$'];
            const fs = dollarContext?.['fs'];
            // Store resolved options - only include defined values
            const resolvedOpts = { ...options };
            if (r2 !== undefined)
                resolvedOpts.r2 = r2;
            if (fs !== undefined)
                resolvedOpts.fs = fs;
            this[GIT_OPTIONS] = resolvedOpts;
            // Extend $ context if contextMode is enabled
            if (options.contextMode && dollarContext) {
                const self = this;
                const original$ = dollarContext;
                this['$'] = new Proxy(original$, {
                    get(target, prop) {
                        if (prop === 'git') {
                            return self.git;
                        }
                        // Forward to original context
                        const value = target[prop];
                        if (typeof value === 'function') {
                            return value.bind(target);
                        }
                        return value;
                    },
                });
            }
            // Auto-initialize if requested
            if (options.autoInit) {
                // Access git to trigger lazy initialization
                void this.git.initialize();
                this.gitInitialized = true;
            }
        }
        /**
         * Creates the GitModule instance with resolved options.
         * @returns A new GitModule instance
         */
        createGitModule() {
            const opts = this[GIT_OPTIONS];
            // Build options - only include defined values
            const moduleOpts = { repo: opts.repo };
            if (opts.branch !== undefined)
                moduleOpts.branch = opts.branch;
            if (opts.path !== undefined)
                moduleOpts.path = opts.path;
            if (opts.r2 !== undefined)
                moduleOpts.r2 = opts.r2;
            if (opts.fs !== undefined)
                moduleOpts.fs = opts.fs;
            if (opts.objectPrefix !== undefined)
                moduleOpts.objectPrefix = opts.objectPrefix;
            return new GitModule(moduleOpts);
        }
        /**
         * Initialize the git module explicitly.
         * This is useful when you need to ensure the module is ready
         * before performing operations.
         */
        async initializeGit() {
            if (!this.gitInitialized) {
                await this.git.initialize();
                this.gitInitialized = true;
            }
        }
        /**
         * Dispose the git module and clean up resources.
         */
        async disposeGit() {
            if (this[GIT_MODULE_CACHE]) {
                await this[GIT_MODULE_CACHE].dispose();
                delete this[GIT_MODULE_CACHE];
                this.gitInitialized = false;
            }
        }
    };
}
// ============================================================================
// Type Guards
// ============================================================================
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
export function hasGitCapability(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'git' in value &&
        value.git instanceof GitModule);
}
export { GitModule, };
//# sourceMappingURL=with-git.js.map