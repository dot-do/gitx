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
     * @param rootPath - The root path for the Git repository (typically .git directory)
     */
    constructor(rootPath: string);
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
 *
 * @param rootPath - The root path for the Git repository (typically .git directory)
 * @returns A StorageBackend instance backed by fsx
 *
 * @example
 * ```typescript
 * const storage = createFSxAdapter('/repos/my-project/.git')
 *
 * // Use the storage backend
 * const sha = await storage.putObject('blob', content)
 * const ref = await storage.getRef('HEAD')
 * ```
 */
export declare function createFSxAdapter(rootPath: string): StorageBackend;
//# sourceMappingURL=fsx-adapter.d.ts.map