/**
 * @fileoverview FSx Storage Adapter for gitx
 *
 * This module provides a storage backend implementation that uses fsx.do for
 * both content-addressable storage (CAS) and file system operations. It bridges
 * gitx's StorageBackend interface with fsx's CAS and fs operations.
 *
 * **Features**:
 * - Content-addressable storage using fsx CAS (putObject, getObject, hasObject)
 * - Reference storage using fsx file operations
 * - Full file system operations for index, config, and other Git files
 *
 * @module storage/fsx-adapter
 *
 * @example
 * ```typescript
 * import { createFSxAdapter } from './storage/fsx-adapter'
 *
 * const storage = createFSxAdapter('/repos/my-repo/.git')
 *
 * // Store a blob
 * const sha = await storage.putObject('blob', content)
 *
 * // Work with refs
 * await storage.setRef('refs/heads/main', {
 *   name: 'refs/heads/main',
 *   target: sha,
 *   type: 'direct'
 * })
 * ```
 */
import type { StorageBackend, StoredObjectResult, ObjectType } from './backend';
import type { Ref } from '../refs/storage';
/**
 * Configuration options for FSxStorageAdapter
 */
export interface FSxStorageAdapterOptions {
    /**
     * Root path for the Git repository (typically .git directory)
     */
    rootPath: string;
}
/**
 * Storage interface for file operations.
 *
 * @description
 * This interface abstracts over different fsx storage backends (R2, SQLite, etc.).
 * Implementations must provide basic file system operations for the FSxStorageAdapter.
 *
 * In production, this should be backed by persistent storage (e.g., R2, SQLite).
 * The InMemoryStorage class is exported for testing purposes only.
 */
export interface FSxFileStorage {
    /** Read a file, returns null if not found */
    read(path: string): Promise<Uint8Array | null>;
    /** Write data to a file */
    write(path: string, data: Uint8Array): Promise<void>;
    /** Delete a file */
    delete(path: string): Promise<void>;
    /** Check if a file or directory exists */
    exists(path: string): Promise<boolean>;
    /** List contents of a directory */
    readdir(path: string): Promise<string[]>;
    /** Create a directory */
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
}
/**
 * Simple in-memory storage for development and testing.
 *
 * @description
 * **WARNING**: This storage is NOT persistent. All data is lost when the process restarts.
 * Use this only for testing. In production, inject a persistent storage implementation
 * (e.g., R2Storage, SQLiteStorage) via the FSxStorageAdapter constructor.
 *
 * @example
 * ```typescript
 * // For testing only
 * const testStorage = new InMemoryStorage()
 * const adapter = new FSxStorageAdapter('/test/.git', testStorage)
 * ```
 */
export declare class InMemoryStorage implements FSxFileStorage {
    private files;
    private directories;
    constructor();
    read(path: string): Promise<Uint8Array | null>;
    write(path: string, data: Uint8Array): Promise<void>;
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    readdir(path: string): Promise<string[]>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
}
/**
 * FSx storage adapter implementing the StorageBackend interface.
 *
 * @description
 * This adapter uses fsx for all storage operations:
 * - CAS operations use fsx's git-compatible object storage
 * - Refs are stored as files at {rootPath}/refs/{refname}
 * - File operations are relative to the rootPath
 */
export declare class FSxStorageAdapter implements StorageBackend {
    private rootPath;
    private storage;
    /**
     * Create a new FSxStorageAdapter
     *
     * @description
     * The storage backend must be injected - this ensures that production code
     * uses persistent storage (R2, SQLite, etc.) rather than the in-memory
     * implementation which loses data on restart.
     *
     * @param rootPath - The root path for the Git repository (typically .git directory)
     * @param storage - The storage backend implementation (must be persistent in production)
     *
     * @example
     * ```typescript
     * // Production usage with R2
     * const r2Storage = new R2FileStorage(env.R2_BUCKET)
     * const adapter = new FSxStorageAdapter('/repos/my-repo/.git', r2Storage)
     *
     * // Testing with in-memory storage
     * const testStorage = new InMemoryStorage()
     * const adapter = new FSxStorageAdapter('/test/.git', testStorage)
     * ```
     */
    constructor(rootPath: string, storage: FSxFileStorage);
    /**
     * Resolve a relative path to an absolute path within the repository
     *
     * @param p - Relative path within the repository
     * @returns Absolute path
     */
    private resolvePath;
    /**
     * Get the path for an object based on its SHA
     *
     * @param sha - 40-character SHA-1 hash
     * @returns Path in format: objects/xx/yyyy...
     */
    private getObjectPath;
    /**
     * Get the path for a ref
     *
     * @param name - Ref name (e.g., 'refs/heads/main', 'HEAD')
     * @returns Absolute path to the ref file
     */
    private getRefPath;
    /**
     * Store a Git object and return its SHA-1 hash.
     *
     * @description
     * Creates a Git object in the format: "{type} {size}\0{content}",
     * computes its SHA-1 hash, compresses it with zlib, and stores it.
     *
     * @param type - Object type: 'blob', 'tree', 'commit', or 'tag'
     * @param content - Raw object content (without Git header)
     * @returns 40-character lowercase hexadecimal SHA-1 hash
     */
    putObject(type: ObjectType, content: Uint8Array): Promise<string>;
    /**
     * Retrieve a Git object by its SHA-1 hash.
     *
     * @param sha - 40-character SHA-1 hash (case-insensitive)
     * @returns Object with type and content, or null if not found
     */
    getObject(sha: string): Promise<StoredObjectResult | null>;
    /**
     * Check if a Git object exists in storage.
     *
     * @param sha - 40-character SHA-1 hash (case-insensitive)
     * @returns True if the object exists, false otherwise
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Delete a Git object from storage.
     *
     * @param sha - 40-character SHA-1 hash (case-insensitive)
     */
    deleteObject(sha: string): Promise<void>;
    /**
     * Get a reference by name.
     *
     * @param name - Full ref name (e.g., 'HEAD', 'refs/heads/main')
     * @returns The reference or null if not found
     */
    getRef(name: string): Promise<Ref | null>;
    /**
     * Create or update a reference.
     *
     * @param name - Full ref name (e.g., 'HEAD', 'refs/heads/main')
     * @param ref - The reference object
     */
    setRef(name: string, ref: Ref): Promise<void>;
    /**
     * Delete a reference.
     *
     * @param name - Full ref name to delete
     */
    deleteRef(name: string): Promise<void>;
    /**
     * List references matching an optional prefix.
     *
     * @param prefix - Optional prefix to filter refs (e.g., 'refs/heads/')
     * @returns Array of matching references
     */
    listRefs(prefix?: string): Promise<Ref[]>;
    /**
     * Read a raw file from the repository.
     *
     * @param path - Path relative to Git directory
     * @returns File contents as Uint8Array, or null if not found
     */
    readFile(path: string): Promise<Uint8Array | null>;
    /**
     * Write a raw file to the repository.
     *
     * @param path - Path relative to Git directory
     * @param content - File contents as Uint8Array
     */
    writeFile(path: string, content: Uint8Array): Promise<void>;
    /**
     * Delete a raw file from the repository.
     *
     * @param path - Path relative to Git directory
     */
    deleteFile(path: string): Promise<void>;
    /**
     * Check if a file or directory exists.
     *
     * @param path - Path relative to Git directory
     * @returns True if the path exists
     */
    exists(path: string): Promise<boolean>;
    /**
     * List contents of a directory.
     *
     * @param path - Path relative to Git directory
     * @returns Array of file and directory names
     */
    readdir(path: string): Promise<string[]>;
    /**
     * Create a directory.
     *
     * @param path - Path relative to Git directory
     * @param options - Options for directory creation
     */
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
}
/**
 * Create an FSx storage adapter.
 *
 * @description
 * Factory function for creating an FSxStorageAdapter instance.
 * The storage backend must be provided to ensure proper persistence in production.
 *
 * @param rootPath - The root path for the Git repository (typically .git directory)
 * @param storage - The storage backend implementation (R2, SQLite, etc.)
 * @returns A StorageBackend instance backed by the provided storage
 *
 * @example
 * ```typescript
 * // Production usage with persistent storage
 * const r2Storage = new R2FileStorage(env.R2_BUCKET)
 * const adapter = createFSxAdapter('/repos/my-project/.git', r2Storage)
 *
 * // Use the storage backend
 * const sha = await adapter.putObject('blob', content)
 * const ref = await adapter.getRef('HEAD')
 *
 * // Testing with in-memory storage
 * const testStorage = new InMemoryStorage()
 * const testAdapter = createFSxAdapter('/test/.git', testStorage)
 * ```
 */
export declare function createFSxAdapter(rootPath: string, storage: FSxFileStorage): StorageBackend;
//# sourceMappingURL=fsx-adapter.d.ts.map