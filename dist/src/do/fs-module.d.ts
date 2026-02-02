/**
 * @fileoverview FsModule for Durable Object Integration
 *
 * This module provides a FsModule class that integrates with dotdo's $ WorkflowContext,
 * providing $.fs.read(), $.fs.write(), and POSIX-like filesystem operations.
 *
 * The module uses SQLite for metadata storage and supports tiered blob storage
 * with R2 integration. Implements lazy initialization - schema is only created
 * on first use.
 *
 * @module do/FsModule
 *
 * @example
 * ```typescript
 * import { FsModule } from 'gitx.do/do'
 *
 * class MyDO extends DO {
 *   fs = new FsModule({
 *     sql: this.ctx.storage.sql
 *   })
 *
 *   async loadConfig() {
 *     await this.fs.initialize()
 *     const content = await this.fs.readFile('/config.json')
 *     return JSON.parse(content)
 *   }
 * }
 * ```
 */
import { type BundleWriteStorage, type BundleWriterConfig } from '../storage/bundle/writer';
import { type BundleReadStorage, type BundleReaderConfig } from '../storage/bundle/reader';
/**
 * SQL parameter types that can be passed to exec().
 */
export type SqlParam = string | number | boolean | null | Uint8Array;
/**
 * SQL storage interface for FsModule.
 * Matches Cloudflare Durable Object SQLite API.
 */
export interface SqlStorage {
    exec<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): SqlResult<T>;
}
/**
 * Result from SQL execution.
 */
export interface SqlResult<T> {
    one(): T | null;
    toArray(): T[];
}
/**
 * R2 Bucket interface for tiered storage.
 */
export interface R2BucketLike {
    get(key: string): Promise<R2ObjectLike | null>;
    put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<R2ObjectLike>;
    delete(key: string | string[]): Promise<void>;
}
/**
 * R2 Object interface.
 */
export interface R2ObjectLike {
    key: string;
    size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
}
/**
 * Configuration for bundle-based tiered storage.
 * When provided, warm/cold tier blobs are stored in R2 bundles
 * instead of individual R2 objects.
 */
export interface BundleStorageConfig {
    /**
     * R2-compatible write storage for bundles.
     */
    writeStorage: BundleWriteStorage;
    /**
     * R2-compatible read storage for bundles.
     */
    readStorage: BundleReadStorage;
    /**
     * BundleWriter configuration (max size, key prefix, etc.).
     */
    writerConfig?: BundleWriterConfig;
    /**
     * BundleReader configuration (cache size, etc.).
     */
    readerConfig?: BundleReaderConfig;
}
/**
 * Configuration options for FsModule.
 */
export interface FsModuleOptions {
    /**
     * SQLite storage instance from Durable Object context.
     */
    sql: SqlStorage;
    /**
     * Optional R2 bucket for warm tier storage.
     */
    r2?: R2BucketLike;
    /**
     * Optional R2 bucket for cold/archive tier storage.
     */
    archive?: R2BucketLike;
    /**
     * Optional bundle storage for warm/cold tiers.
     * When provided, blobs demoted to warm/cold are written into
     * R2 bundles (batched objects) instead of individual R2 objects.
     */
    bundleStorage?: BundleStorageConfig;
    /**
     * Base path prefix for all operations.
     * @default '/'
     */
    basePath?: string;
    /**
     * Hot tier max size in bytes.
     * Files larger than this are stored in R2 when available.
     * @default 1048576 (1MB)
     */
    hotMaxSize?: number;
    /**
     * Default file mode.
     * @default 0o644
     */
    defaultMode?: number;
    /**
     * Default directory mode.
     * @default 0o755
     */
    defaultDirMode?: number;
}
/**
 * Options for read operations.
 */
export interface ReadOptions {
    /**
     * Encoding for text output.
     * If set to 'utf-8', returns string instead of Uint8Array.
     */
    encoding?: 'utf-8' | 'utf8';
    /**
     * Start byte offset for partial reads.
     */
    start?: number;
    /**
     * End byte offset for partial reads (inclusive).
     */
    end?: number;
}
/**
 * Options for write operations.
 */
export interface WriteOptions {
    /**
     * File mode (permissions).
     */
    mode?: number;
    /**
     * Write flag.
     * - 'w': Write/create (default)
     * - 'wx' or 'ax': Exclusive create (fail if exists)
     * - 'a': Append mode
     */
    flag?: 'w' | 'wx' | 'ax' | 'a';
    /**
     * Force specific storage tier.
     */
    tier?: 'hot' | 'warm' | 'cold';
}
/**
 * Options for mkdir operations.
 */
export interface MkdirOptions {
    /**
     * Create parent directories if they don't exist.
     */
    recursive?: boolean;
    /**
     * Directory mode (permissions).
     */
    mode?: number;
}
/**
 * Options for rmdir operations.
 */
export interface RmdirOptions {
    /**
     * Remove directory and all contents recursively.
     */
    recursive?: boolean;
}
/**
 * Options for rm operations.
 */
export interface RemoveOptions {
    /**
     * Remove directories and contents recursively.
     */
    recursive?: boolean;
    /**
     * Don't throw error if path doesn't exist.
     */
    force?: boolean;
}
/**
 * Options for readdir operations.
 */
export interface ReaddirOptions {
    /**
     * Return Dirent objects instead of strings.
     */
    withFileTypes?: boolean;
    /**
     * List subdirectories recursively.
     */
    recursive?: boolean;
}
/**
 * Options for rename/move operations.
 */
export interface MoveOptions {
    /**
     * Overwrite destination if it exists.
     */
    overwrite?: boolean;
}
/**
 * Options for copy operations.
 */
export interface CopyOptions {
    /**
     * Overwrite destination if it exists.
     */
    overwrite?: boolean;
}
/**
 * Directory entry interface.
 */
export interface Dirent {
    name: string;
    parentPath: string;
    path: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}
/**
 * File stats interface.
 */
export interface Stats {
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    size: number;
    blksize: number;
    blocks: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}
/**
 * Blob entry stored in SQLite.
 * @internal Reserved for tiered storage implementation
 */
type _BlobEntry = {
    id: string;
    data: ArrayBuffer | null;
    size: number;
    tier: 'hot' | 'warm' | 'cold';
    created_at: number;
};
export type { _BlobEntry as BlobEntryInternal };
/**
 * File type mode bits (POSIX).
 */
export declare const S_IFMT = 61440;
export declare const S_IFREG = 32768;
export declare const S_IFDIR = 16384;
export declare const S_IFLNK = 40960;
/**
 * Base class for filesystem errors.
 */
declare class FsError extends Error {
    code: string;
    path?: string;
    constructor(code: string, message: string, path?: string);
}
/**
 * ENOENT: No such file or directory.
 */
export declare class ENOENT extends FsError {
    constructor(message?: string, path?: string);
}
/**
 * EEXIST: File already exists.
 */
export declare class EEXIST extends FsError {
    constructor(message?: string, path?: string);
}
/**
 * EISDIR: Illegal operation on a directory.
 */
export declare class EISDIR extends FsError {
    constructor(message?: string, path?: string);
}
/**
 * ENOTDIR: Not a directory.
 */
export declare class ENOTDIR extends FsError {
    constructor(message?: string, path?: string);
}
/**
 * ENOTEMPTY: Directory not empty.
 */
export declare class ENOTEMPTY extends FsError {
    constructor(message?: string, path?: string);
}
/**
 * FsModule - Filesystem capability module for Durable Object integration.
 *
 * Implements POSIX-like file operations with lazy initialization.
 * Uses SQLite for metadata and supports tiered storage with R2.
 *
 * @example
 * ```typescript
 * const fs = new FsModule({ sql: ctx.storage.sql })
 *
 * // First operation triggers initialization
 * await fs.writeFile('/config.json', JSON.stringify(config))
 *
 * // Subsequent operations use existing schema
 * const data = await fs.readFile('/config.json', { encoding: 'utf-8' })
 * ```
 */
export declare class FsModule {
    /**
     * Capability module name for identification.
     */
    readonly name: "fs";
    private readonly sql;
    private readonly r2?;
    private readonly archive?;
    private readonly bundleWriter?;
    private readonly bundleReader?;
    private readonly basePath;
    private readonly hotMaxSize;
    private readonly defaultMode;
    private readonly defaultDirMode;
    private initialized;
    /**
     * Create a new FsModule instance.
     *
     * @param options - Configuration options
     *
     * @example
     * ```typescript
     * const fs = new FsModule({
     *   sql: ctx.storage.sql,
     *   r2: env.R2_BUCKET,
     *   hotMaxSize: 512 * 1024 // 512KB
     * })
     * ```
     */
    constructor(options: FsModuleOptions);
    /**
     * Initialize the module - creates schema and root directory.
     * This is called automatically on first operation (lazy initialization).
     */
    initialize(): Promise<void>;
    /**
     * Cleanup hook for capability disposal.
     */
    dispose(): Promise<void>;
    private normalizePath;
    private getParentPath;
    private getFileName;
    private getFile;
    private selectTier;
    private storeBlob;
    private getBlob;
    private deleteBlob;
    /**
     * Read a file's contents.
     *
     * @param path - File path to read
     * @param options - Read options
     * @returns File contents as string or Uint8Array
     *
     * @example
     * ```typescript
     * // Read as bytes
     * const bytes = await fs.readFile('/data.bin')
     *
     * // Read as string
     * const text = await fs.readFile('/config.json', { encoding: 'utf-8' })
     * ```
     */
    readFile(path: string, options?: ReadOptions): Promise<string | Uint8Array>;
    /**
     * Write data to a file.
     *
     * @param path - File path to write
     * @param data - Data to write
     * @param options - Write options
     *
     * @example
     * ```typescript
     * // Write string
     * await fs.writeFile('/hello.txt', 'Hello, World!')
     *
     * // Write bytes
     * await fs.writeFile('/data.bin', new Uint8Array([1, 2, 3]))
     *
     * // Append mode
     * await fs.writeFile('/log.txt', 'New entry\n', { flag: 'a' })
     * ```
     */
    writeFile(path: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>;
    /**
     * Append data to a file.
     *
     * @param path - File path to append to
     * @param data - Data to append
     */
    appendFile(path: string, data: string | Uint8Array): Promise<void>;
    /**
     * Delete a file.
     *
     * @param path - File path to delete
     */
    unlink(path: string): Promise<void>;
    /**
     * Rename/move a file or directory.
     *
     * @param oldPath - Current path
     * @param newPath - New path
     * @param options - Move options
     */
    rename(oldPath: string, newPath: string, options?: MoveOptions): Promise<void>;
    /**
     * Copy a file.
     *
     * @param src - Source file path
     * @param dest - Destination file path
     * @param options - Copy options
     */
    copyFile(src: string, dest: string, options?: CopyOptions): Promise<void>;
    /**
     * Truncate a file to a specified length.
     *
     * @param path - File path
     * @param length - New length (default: 0)
     */
    truncate(path: string, length?: number): Promise<void>;
    /**
     * Create a directory.
     *
     * @param path - Directory path
     * @param options - Mkdir options
     */
    mkdir(path: string, options?: MkdirOptions): Promise<void>;
    /**
     * Remove a directory.
     *
     * @param path - Directory path
     * @param options - Rmdir options
     */
    rmdir(path: string, options?: RmdirOptions): Promise<void>;
    private deleteRecursive;
    /**
     * Remove a file or directory.
     *
     * @param path - Path to remove
     * @param options - Remove options
     */
    rm(path: string, options?: RemoveOptions): Promise<void>;
    /**
     * Read directory contents.
     *
     * @param path - Directory path
     * @param options - Readdir options
     * @returns Array of filenames or Dirent objects
     */
    readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>;
    /**
     * Get file stats (follows symlinks).
     *
     * @param path - File path
     * @returns Stats object
     */
    stat(path: string): Promise<Stats>;
    /**
     * Get file stats (does not follow symlinks).
     *
     * @param path - File path
     * @returns Stats object
     */
    lstat(path: string): Promise<Stats>;
    private fileToStats;
    /**
     * Check if a path exists.
     *
     * @param path - Path to check
     * @returns True if path exists
     */
    exists(path: string): Promise<boolean>;
    /**
     * Get the integer rowid (file_id) for a file path.
     * This is useful for foreign key references from other tables.
     *
     * @param path - File path to look up
     * @returns The file's integer rowid, or null if file doesn't exist
     *
     * @example
     * ```typescript
     * const fileId = await fs.getFileId('/config.json')
     * if (fileId !== null) {
     *   // Use fileId as foreign key reference
     * }
     * ```
     */
    getFileId(path: string): Promise<number | null>;
    /**
     * Check access to a file.
     *
     * @param path - Path to check
     * @param _mode - Access mode (not fully implemented)
     */
    access(path: string, _mode?: number): Promise<void>;
    /**
     * Change file mode.
     *
     * @param path - File path
     * @param mode - New mode
     */
    chmod(path: string, mode: number): Promise<void>;
    /**
     * Change file ownership.
     *
     * @param path - File path
     * @param uid - User ID
     * @param gid - Group ID
     */
    chown(path: string, uid: number, gid: number): Promise<void>;
    /**
     * Update access and modification times.
     *
     * @param path - File path
     * @param atime - Access time
     * @param mtime - Modification time
     */
    utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>;
    /**
     * Create a symbolic link.
     *
     * @param target - Target path the symlink points to
     * @param path - Path of the symlink
     */
    symlink(target: string, path: string): Promise<void>;
    /**
     * Create a hard link.
     *
     * @param existingPath - Path to existing file
     * @param newPath - Path for new link
     */
    link(existingPath: string, newPath: string): Promise<void>;
    /**
     * Read a symbolic link's target.
     *
     * @param path - Symlink path
     * @returns Target path
     */
    readlink(path: string): Promise<string>;
    /**
     * Get the real path (resolve symlinks).
     *
     * @param path - Path to resolve
     * @returns Resolved path
     */
    realpath(path: string): Promise<string>;
    /**
     * Get the current storage tier of a file.
     *
     * @param path - File path
     * @returns Current tier
     */
    getTier(path: string): Promise<'hot' | 'warm' | 'cold'>;
    /**
     * Promote a file to a hotter storage tier.
     *
     * @param path - File path
     * @param tier - Target tier ('hot' or 'warm')
     */
    promote(path: string, tier: 'hot' | 'warm'): Promise<void>;
    /**
     * Demote a file to a colder storage tier.
     *
     * @param path - File path
     * @param tier - Target tier ('warm' or 'cold')
     */
    demote(path: string, tier: 'warm' | 'cold'): Promise<void>;
    /**
     * Flush pending bundle writes to R2.
     * Call this periodically or before shutdown to ensure all
     * warm/cold tier data is persisted to bundle storage.
     *
     * @returns Metadata about the sealed bundle, or null if nothing to flush
     */
    flushBundles(): Promise<void>;
}
/**
 * Create an FsModule instance with the given options.
 *
 * @param options - Configuration options for the module
 * @returns A new FsModule instance
 *
 * @example
 * ```typescript
 * import { createFsModule } from 'gitx.do/do'
 *
 * const fs = createFsModule({
 *   sql: ctx.storage.sql,
 *   r2: env.R2_BUCKET
 * })
 * ```
 */
export declare function createFsModule(options: FsModuleOptions): FsModule;
/**
 * Check if a value is an FsModule instance.
 *
 * @param value - Value to check
 * @returns True if value is an FsModule
 */
export declare function isFsModule(value: unknown): value is FsModule;
//# sourceMappingURL=fs-module.d.ts.map