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
import { FsModule, type FsModuleOptions, type SqlStorage, type R2BucketLike, type Stats, type Dirent, type ReadOptions, type WriteOptions, type MkdirOptions, type RmdirOptions, type RemoveOptions, type ReaddirOptions, type MoveOptions, type CopyOptions } from './FsModule';
/**
 * Type for a class constructor.
 * Used as the base constraint for mixin composition.
 */
export type Constructor<T = object> = new (...args: any[]) => T;
/**
 * Interface for DOs that have filesystem capability.
 * Classes extended with withFs will implement this interface.
 */
export interface WithFsCapability {
    /**
     * The FsModule instance providing filesystem functionality.
     * Lazily initialized on first access.
     */
    readonly fs: FsModule;
}
/**
 * Options for the withFs mixin.
 * These options configure the FsModule that will be created.
 */
export interface WithFsOptions {
    /**
     * Base path prefix for all filesystem operations.
     * @default '/'
     */
    basePath?: string;
    /**
     * Hot tier maximum size in bytes.
     * Files larger than this are stored in R2 when available.
     * @default 1048576 (1MB)
     */
    hotMaxSize?: number;
    /**
     * Default file mode (permissions).
     * @default 0o644
     */
    defaultMode?: number;
    /**
     * Default directory mode (permissions).
     * @default 0o755
     */
    defaultDirMode?: number;
    /**
     * Whether to extend the $ WorkflowContext with fs capability.
     * When true, this.$.fs will be available in addition to this.fs.
     * @default false
     */
    contextMode?: boolean;
    /**
     * Whether to auto-initialize the FsModule on construction.
     * When false (default), FsModule is lazily initialized on first access.
     * @default false
     */
    autoInit?: boolean;
    /**
     * Factory function to get the SQL storage from the DO instance.
     * This enables lazy binding of the storage based on the DO's context.
     *
     * @param instance - The DO instance
     * @returns The SqlStorage to use, or undefined if none available
     *
     * @example
     * ```typescript
     * withFs(DO, {
     *   getSql: (instance) => instance.ctx?.storage?.sql
     * })
     * ```
     */
    getSql?: (instance: object) => SqlStorage | undefined;
    /**
     * Factory function to get the R2 bucket for warm tier storage.
     * This enables lazy binding of R2 based on the DO's environment.
     *
     * @param instance - The DO instance
     * @returns The R2 bucket to use, or undefined if none available
     *
     * @example
     * ```typescript
     * withFs(DO, {
     *   getR2: (instance) => instance.env?.R2_BUCKET
     * })
     * ```
     */
    getR2?: (instance: object) => R2BucketLike | undefined;
    /**
     * Factory function to get the archive R2 bucket for cold tier storage.
     *
     * @param instance - The DO instance
     * @returns The archive R2 bucket to use, or undefined if none available
     *
     * @example
     * ```typescript
     * withFs(DO, {
     *   getArchive: (instance) => instance.env?.ARCHIVE_BUCKET
     * })
     * ```
     */
    getArchive?: (instance: object) => R2BucketLike | undefined;
}
/**
 * Interface for the extended WorkflowContext with fs capability.
 * Used when contextMode is enabled.
 */
export interface WithFsContext {
    fs: FsModule;
    [key: string]: unknown;
}
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
export declare function withFs<TBase extends Constructor>(Base: TBase, options?: WithFsOptions): TBase & Constructor<WithFsCapability>;
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
export declare function hasFsCapability(value: unknown): value is WithFsCapability;
export { FsModule, type FsModuleOptions, type SqlStorage, type R2BucketLike, type Stats, type Dirent, type ReadOptions, type WriteOptions, type MkdirOptions, type RmdirOptions, type RemoveOptions, type ReaddirOptions, type MoveOptions, type CopyOptions, };
//# sourceMappingURL=withFs.d.ts.map