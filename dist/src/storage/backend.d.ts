/**
 * @fileoverview Storage Backend Interface for Git Operations
 *
 * This module defines the `StorageBackend` interface that abstracts over different
 * storage implementations. It provides a unified API for:
 * - Content-addressable storage (CAS) for Git objects (blobs, trees, commits, tags)
 * - Reference management (branches, tags, HEAD)
 * - Raw file operations (for index, config, and other Git files)
 * - Directory operations
 *
 * **Implementations**:
 * - `FSStorageBackend` - Uses Node.js `fs/promises` for CLI usage
 * - `DOStorageBackend` - Uses SQLite in Durable Objects for cloud deployment
 *
 * @module storage/backend
 *
 * @example
 * ```typescript
 * import { StorageBackend } from './storage/backend'
 *
 * async function createCommit(backend: StorageBackend) {
 *   // Store a blob
 *   const blobSha = await backend.putObject('blob', content)
 *
 *   // Store a tree referencing the blob
 *   const treeSha = await backend.putObject('tree', treeContent)
 *
 *   // Store the commit
 *   const commitSha = await backend.putObject('commit', commitContent)
 *
 *   // Update the branch ref
 *   await backend.setRef('refs/heads/main', {
 *     name: 'refs/heads/main',
 *     target: commitSha,
 *     type: 'direct'
 *   })
 * }
 * ```
 */
import type { ObjectType } from '../types/objects';
import type { Ref } from '../refs/storage';
export type { ObjectType };
/**
 * The four Git object types.
 *
 * @description
 * - `blob`: Raw file content
 * - `tree`: Directory listing (contains references to blobs and other trees)
 * - `commit`: A snapshot pointing to a tree with metadata (author, message, parents)
 * - `tag`: An annotated tag pointing to another object with metadata
 */
export type ObjectTypeValue = 'blob' | 'tree' | 'commit' | 'tag';
/**
 * Result of retrieving a Git object from storage.
 *
 * @description
 * Contains the object type and raw binary content (without Git header).
 * The content is the object data only - the header is reconstructed when needed.
 */
export interface StoredObjectResult {
    /** The type of Git object */
    type: ObjectType;
    /** Raw binary content of the object (excluding Git header) */
    content: Uint8Array;
}
/**
 * Storage backend interface for Git operations.
 *
 * @description
 * This interface abstracts over different storage implementations to provide
 * a unified API for Git operations. Implementations must handle:
 *
 * 1. **Content-Addressable Storage (CAS)**: Objects are stored by their SHA-1 hash.
 *    The hash is computed from the Git object format: "{type} {size}\0{content}".
 *    Implementations should compute and verify hashes.
 *
 * 2. **Reference Storage**: Refs can be direct (pointing to a SHA) or symbolic
 *    (pointing to another ref). Implementations must handle both.
 *
 * 3. **Raw File Operations**: For Git files that aren't objects (index, config, etc.),
 *    standard file operations are needed.
 *
 * 4. **Directory Operations**: For managing the repository structure.
 *
 * @example
 * ```typescript
 * // Using the backend for basic operations
 * const backend: StorageBackend = createBackend()
 *
 * // Store an object
 * const content = new TextEncoder().encode('Hello, World!')
 * const sha = await backend.putObject('blob', content)
 *
 * // Retrieve it
 * const obj = await backend.getObject(sha)
 * if (obj) {
 *   console.log(`Type: ${obj.type}, Size: ${obj.content.length}`)
 * }
 *
 * // Work with refs
 * const head = await backend.getRef('HEAD')
 * if (head?.type === 'symbolic') {
 *   console.log(`On branch: ${head.target}`)
 * }
 * ```
 */
/**
 * Content-Addressable Storage (CAS) backend interface.
 *
 * @description
 * Provides operations for storing and retrieving Git objects by their SHA-1 hash.
 * Objects are stored by their content hash, making storage idempotent and
 * content-addressable. This is the minimal interface needed for object storage.
 *
 * Implementations: ParquetStore, FSxStorageAdapter (partial), SqliteObjectStore (via delegation)
 */
export interface CASBackend {
    /**
     * Store a Git object and return its SHA-1 hash.
     *
     * @description
     * Computes the SHA-1 hash of the object in Git format (type + size + content),
     * stores the object, and returns the hash. If an object with the same SHA
     * already exists, this operation is idempotent (no error, returns same SHA).
     *
     * The SHA is computed from: "{type} {size}\0{content}"
     *
     * @param type - Object type: 'blob', 'tree', 'commit', or 'tag'
     * @param content - Raw object content (without Git header)
     * @returns 40-character lowercase hexadecimal SHA-1 hash
     */
    putObject(type: ObjectType, content: Uint8Array): Promise<string>;
    /**
     * Retrieve a Git object by its SHA-1 hash.
     *
     * @description
     * Fetches an object from storage and returns its type and content.
     * Returns null if the object doesn't exist. The content returned is
     * the raw object data WITHOUT the Git header.
     *
     * @param sha - 40-character SHA-1 hash (case-insensitive)
     * @returns Object with type and content, or null if not found
     */
    getObject(sha: string): Promise<StoredObjectResult | null>;
    /**
     * Check if a Git object exists in storage.
     *
     * @description
     * Efficiently checks for object existence without fetching the full content.
     * This is useful for connectivity checks and optimizing transfers.
     *
     * @param sha - 40-character SHA-1 hash (case-insensitive)
     * @returns True if the object exists, false otherwise
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Delete a Git object from storage.
     *
     * @description
     * Removes an object from storage. This operation should be used with caution
     * as deleting objects that are still referenced by other objects (e.g., blobs
     * referenced by trees) will corrupt the repository.
     *
     * @param sha - 40-character SHA-1 hash (case-insensitive)
     * @returns Resolves when deletion is complete (no error if object didn't exist)
     */
    deleteObject(sha: string): Promise<void>;
}
/**
 * Reference storage backend interface.
 *
 * @description
 * Provides operations for managing Git references (branches, tags, HEAD).
 * References can be direct (pointing to a SHA) or symbolic (pointing to another ref).
 */
export interface RefBackend {
    /**
     * Get a reference by name.
     *
     * @description
     * Retrieves a Git reference (branch, tag, HEAD, etc.) by its full name.
     * Returns null if the reference doesn't exist. Does NOT follow symbolic refs -
     * use the RefStorage class for ref resolution.
     *
     * @param name - Full ref name (e.g., 'HEAD', 'refs/heads/main', 'refs/tags/v1.0.0')
     * @returns The reference or null if not found
     */
    getRef(name: string): Promise<Ref | null>;
    /**
     * Create or update a reference.
     *
     * @description
     * Sets a reference to point to a target (SHA for direct refs, ref name for symbolic).
     * Creates the ref if it doesn't exist, updates it if it does.
     *
     * @param name - Full ref name (e.g., 'HEAD', 'refs/heads/main')
     * @param ref - The reference object with name, target, and type
     */
    setRef(name: string, ref: Ref): Promise<void>;
    /**
     * Delete a reference.
     *
     * @description
     * Removes a reference from storage. Note that HEAD cannot be deleted.
     * No error is thrown if the ref doesn't exist.
     *
     * @param name - Full ref name to delete
     */
    deleteRef(name: string): Promise<void>;
    /**
     * List references matching an optional prefix.
     *
     * @description
     * Returns all references, optionally filtered by a prefix.
     * Does not include symbolic refs in the results by default.
     *
     * @param prefix - Optional prefix to filter refs (e.g., 'refs/heads/', 'refs/tags/')
     * @returns Array of matching references
     */
    listRefs(prefix?: string): Promise<Ref[]>;
}
/**
 * File storage backend interface.
 *
 * @description
 * Provides raw file and directory operations for Git repository files
 * that are not content-addressed objects (e.g., index, config, hooks).
 * Paths are relative to the Git directory (.git/).
 */
export interface FileBackend {
    /**
     * Read a raw file from the repository.
     *
     * @param path - Path relative to Git directory (e.g., 'index', 'config', 'hooks/pre-commit')
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
     * @returns True if the path exists (file or directory), false otherwise
     */
    exists(path: string): Promise<boolean>;
    /**
     * List contents of a directory.
     *
     * @param path - Path relative to Git directory
     * @returns Array of file and directory names (not full paths)
     */
    readdir(path: string): Promise<string[]>;
    /**
     * Create a directory.
     *
     * @param path - Path relative to Git directory
     * @param options - Options for directory creation
     * @param options.recursive - If true, create parent directories as needed
     */
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
}
/**
 * Full storage backend interface for Git operations.
 *
 * @description
 * This interface combines all three segregated backend interfaces into a single
 * unified API. Existing code that depends on `StorageBackend` continues to work
 * unchanged. New code should prefer the narrower interfaces (`CASBackend`,
 * `RefBackend`, `FileBackend`) to depend only on what it actually uses.
 *
 * @see {@link CASBackend} for content-addressable storage operations
 * @see {@link RefBackend} for reference management operations
 * @see {@link FileBackend} for raw file and directory operations
 */
export interface StorageBackend extends CASBackend, RefBackend, FileBackend {
}
//# sourceMappingURL=backend.d.ts.map