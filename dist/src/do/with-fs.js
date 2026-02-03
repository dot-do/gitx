/**
 * @fileoverview withFs Mixin for DO Composition
 *
 * This module provides a mixin function that adds filesystem capability
 * to any Durable Object class. The mixin follows the TypeScript mixin pattern
 * and supports lazy initialization of the FsModule.
 *
 * @module do/withFs
 *
 * @example
 * ```typescript
 * import { withFs } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * // Basic usage with defaults
 * class MyDO extends withFs(DO) {
 *   async loadConfig() {
 *     const content = await this.fs.readFile('/config.json', { encoding: 'utf-8' })
 *     return JSON.parse(content as string)
 *   }
 * }
 *
 * // With custom options
 * class StorageDO extends withFs(DO, {
 *   basePath: '/data',
 *   hotMaxSize: 512 * 1024, // 512KB
 *   getR2: (instance) => instance.env?.R2_BUCKET
 * }) {
 *   async saveFile(name: string, data: string) {
 *     await this.fs.writeFile(name, data)
 *   }
 * }
 * ```
 */
import { FsModule, } from './fs-module';
// ============================================================================
// Mixin Implementation
// ============================================================================
/**
 * Symbol used to store the FsModule instance for lazy initialization.
 * Using a symbol prevents name collisions with user-defined properties.
 */
const FS_MODULE_SYMBOL = Symbol('fsModule');
/**
 * Symbol used to store the options for lazy initialization.
 */
const FS_OPTIONS_SYMBOL = Symbol('fsOptions');
/**
 * Symbol to track if the module has been initialized.
 */
const FS_INITIALIZED_SYMBOL = Symbol('fsInitialized');
/**
 * Mixin function to add filesystem capability to a DO class.
 *
 * @description
 * Composes filesystem functionality into a Durable Object class.
 * The resulting class will have a `fs` property that provides
 * FsModule functionality for POSIX-like file operations.
 *
 * The FsModule is lazily initialized on first access to the `fs`
 * property. This means:
 * - No overhead if filesystem is never used
 * - Factory functions (getSql, getR2, getArchive) are called at first access
 * - The module can be properly initialized with DO-specific context
 *
 * The mixin supports:
 * - File operations: readFile, writeFile, appendFile, unlink, rename, copyFile
 * - Directory operations: mkdir, rmdir, readdir, rm
 * - Metadata operations: stat, lstat, exists, access, chmod, chown, utimes
 * - Symbolic links: symlink, link, readlink, realpath
 * - Tiered storage: promote, demote, getTier
 *
 * @param Base - Base class to extend
 * @param options - Filesystem configuration options (optional)
 * @returns Extended class with filesystem capability
 *
 * @example
 * ```typescript
 * import { withFs } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * // Basic usage with defaults
 * class MyDO extends withFs(DO) {
 *   async loadConfig() {
 *     const content = await this.fs.readFile('/config.json', { encoding: 'utf-8' })
 *     return JSON.parse(content as string)
 *   }
 * }
 *
 * // With custom options and lazy binding
 * class StorageDO extends withFs(DO, {
 *   basePath: '/data',
 *   hotMaxSize: 512 * 1024,
 *   getSql: (instance) => (instance as any).ctx?.storage?.sql,
 *   getR2: (instance) => (instance as any).env?.R2_BUCKET
 * }) {
 *   async saveDocument(name: string, content: string) {
 *     await this.fs.mkdir('/documents', { recursive: true })
 *     await this.fs.writeFile(`/documents/${name}`, content)
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Combining with withGit and withBash
 * import { withGit, withBash, withFs } from 'gitx.do/do'
 * import { DO } from 'dotdo'
 *
 * class DevDO extends withFs(withBash(withGit(DO, { repo: 'org/repo' }), {
 *   cwd: '/workspace'
 * })) {
 *   async setupProject() {
 *     // Sync git repository
 *     await this.git.sync()
 *
 *     // Create workspace directories
 *     await this.fs.mkdir('/workspace/output', { recursive: true })
 *
 *     // Run build commands
 *     await this.bash.exec('npm', ['run', 'build'])
 *
 *     // Read build output
 *     const files = await this.fs.readdir('/workspace/output')
 *     return files
 *   }
 * }
 * ```
 */
export function withFs(Base, options = {}) {
    // Create the extended class
    class WithFsClass extends Base {
        /**
         * Static list of capabilities for introspection.
         */
        static capabilities = [...(Base['capabilities'] || []), 'fs'];
        /**
         * Internal storage for the lazily initialized FsModule.
         */
        [FS_MODULE_SYMBOL];
        /**
         * Internal storage for the options.
         */
        [FS_OPTIONS_SYMBOL];
        /**
         * Tracks whether initialization has been attempted.
         */
        [FS_INITIALIZED_SYMBOL] = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(...args) {
            super(...args);
            this[FS_OPTIONS_SYMBOL] = options;
            // Extend $ context if contextMode is enabled
            if (options.contextMode) {
                const dollarContext = this['$'];
                if (dollarContext) {
                    const self = this;
                    this['$'] = new Proxy(dollarContext, {
                        get(target, prop) {
                            if (prop === 'fs') {
                                return self.fs;
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
            }
            // Auto-initialize if requested
            if (options.autoInit) {
                // Access fs to trigger lazy initialization
                void this.fs.initialize();
                this[FS_INITIALIZED_SYMBOL] = true;
            }
        }
        /**
         * Get the FsModule instance, creating it lazily on first access.
         *
         * @returns The FsModule instance
         */
        get fs() {
            if (!this[FS_MODULE_SYMBOL]) {
                this[FS_MODULE_SYMBOL] = this._createFsModule();
            }
            return this[FS_MODULE_SYMBOL];
        }
        /**
         * Create the FsModule instance with resolved options.
         *
         * @returns A new FsModule instance
         * @private
         */
        _createFsModule() {
            const opts = this[FS_OPTIONS_SYMBOL];
            // Resolve SQL storage
            let sql;
            if (opts.getSql) {
                sql = opts.getSql(this);
            }
            // If no SQL factory provided, try common patterns
            if (!sql) {
                const ctx = this['ctx'];
                const state = this['state'];
                // Try ctx.storage.sql (dotdo pattern)
                sql = (ctx?.['storage']?.['sql']);
                // Try state.storage.sql (CF DO pattern)
                if (!sql) {
                    sql = (state?.['storage']?.['sql']);
                }
            }
            // Create a mock SQL storage if none available (for testing)
            if (!sql) {
                sql = createMockSqlStorage();
            }
            // Resolve R2 if factory provided
            let r2;
            if (opts.getR2) {
                r2 = opts.getR2(this);
            }
            // Resolve archive if factory provided
            let archive;
            if (opts.getArchive) {
                archive = opts.getArchive(this);
            }
            // Build module options - only include defined values
            const moduleOptions = { sql };
            if (r2 !== undefined)
                moduleOptions.r2 = r2;
            if (archive !== undefined)
                moduleOptions.archive = archive;
            if (opts.basePath !== undefined)
                moduleOptions.basePath = opts.basePath;
            if (opts.hotMaxSize !== undefined)
                moduleOptions.hotMaxSize = opts.hotMaxSize;
            if (opts.defaultMode !== undefined)
                moduleOptions.defaultMode = opts.defaultMode;
            if (opts.defaultDirMode !== undefined)
                moduleOptions.defaultDirMode = opts.defaultDirMode;
            return new FsModule(moduleOptions);
        }
        /**
         * Check if this DO class has a specific capability.
         * @param name - Capability name to check
         * @returns True if the capability is available
         */
        hasCapability(name) {
            if (name === 'fs')
                return true;
            // Check if parent class has the hasCapability method
            const baseProto = Base.prototype;
            if (baseProto && typeof baseProto['hasCapability'] === 'function') {
                return baseProto['hasCapability'].call(this, name);
            }
            return false;
        }
        /**
         * Initialize the filesystem module asynchronously.
         * This should be called if you need the schema to be created before operations.
         *
         * @returns Promise that resolves when initialization is complete
         */
        async initializeFs() {
            if (this[FS_INITIALIZED_SYMBOL])
                return;
            // Ensure fs module is created
            const fs = this.fs;
            // Initialize the module
            await fs.initialize();
            this[FS_INITIALIZED_SYMBOL] = true;
        }
        /**
         * Dispose the filesystem module and clean up resources.
         */
        async disposeFs() {
            if (this[FS_MODULE_SYMBOL]) {
                await this[FS_MODULE_SYMBOL].dispose();
                this[FS_MODULE_SYMBOL] = undefined;
                this[FS_INITIALIZED_SYMBOL] = false;
            }
        }
    }
    // Return the class with proper typing
    return WithFsClass;
}
/**
 * Creates a simple in-memory mock SQL storage for testing.
 * This allows withFs to work even without a real Durable Object context.
 */
function createMockSqlStorage() {
    const tables = new Map();
    let idCounter = 1;
    return {
        exec(sql, ..._params) {
            // Simple parsing for basic operations
            const sqlLower = sql.toLowerCase().trim();
            if (sqlLower.startsWith('create table')) {
                // Table creation - no-op in mock
                return {
                    one: () => null,
                    toArray: () => [],
                };
            }
            if (sqlLower.startsWith('create index')) {
                // Index creation - no-op in mock
                return {
                    one: () => null,
                    toArray: () => [],
                };
            }
            if (sqlLower.startsWith('insert')) {
                // Handle INSERT
                const match = sql.match(/INSERT.*INTO\s+(\w+)/i);
                const tableName = match?.[1] || 'unknown';
                if (!tables.has(tableName)) {
                    tables.set(tableName, []);
                }
                const table = tables.get(tableName);
                const id = idCounter++;
                const row = { id };
                table.push(row);
                return {
                    one: () => row,
                    toArray: () => [row],
                };
            }
            if (sqlLower.startsWith('select')) {
                // Handle SELECT
                const match = sql.match(/FROM\s+(\w+)/i);
                const tableName = match?.[1] || 'unknown';
                const table = tables.get(tableName) || [];
                return {
                    one: () => table[0] || null,
                    toArray: () => table,
                };
            }
            if (sqlLower.startsWith('update')) {
                // Handle UPDATE - simplified
                return {
                    one: () => null,
                    toArray: () => [],
                };
            }
            if (sqlLower.startsWith('delete')) {
                // Handle DELETE - simplified
                return {
                    one: () => null,
                    toArray: () => [],
                };
            }
            // Default fallback
            return {
                one: () => null,
                toArray: () => [],
            };
        },
    };
}
// ============================================================================
// Type Guards
// ============================================================================
/**
 * Check if a value has filesystem capability.
 *
 * @param value - Value to check
 * @returns True if value has the fs property and it's an FsModule
 *
 * @example
 * ```typescript
 * if (hasFsCapability(instance)) {
 *   const content = await instance.fs.readFile('/config.json')
 * }
 * ```
 */
export function hasFsCapability(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'fs' in value &&
        value.fs instanceof FsModule);
}
export { FsModule, };
//# sourceMappingURL=with-fs.js.map