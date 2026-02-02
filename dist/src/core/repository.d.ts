/**
 * @fileoverview Repository Abstraction
 *
 * Provides a high-level Repository interface that encapsulates ObjectStore,
 * ref operations, and tree operations into a single cohesive facade.
 *
 * This module is platform-agnostic and delegates all operations to existing
 * modules rather than reimplementing them.
 *
 * @module core/repository
 *
 * @example
 * ```typescript
 * import { GitBackendRepository } from './core/repository'
 * import { createMemoryBackend } from './core/backend'
 *
 * const backend = createMemoryBackend()
 * const repo = new GitBackendRepository(backend)
 *
 * // Object operations
 * const sha = await repo.storeObject('blob', new TextEncoder().encode('hello'))
 * const obj = await repo.getObject(sha)
 *
 * // Ref operations
 * await repo.setRef('refs/heads/main', sha)
 * const refs = await repo.listRefs('refs/heads/')
 *
 * // High-level operations
 * const commit = await repo.getCommit(sha)
 * const log = await repo.log('refs/heads/main', 10)
 * ```
 */
import type { GitBackend, Ref } from './backend';
import type { ObjectType, CommitObject, TreeEntry } from '../types/objects';
/**
 * High-level repository interface encapsulating object store, refs, and trees.
 *
 * @description
 * Provides a unified API for interacting with a Git repository. Combines
 * object storage, reference management, and high-level operations like
 * commit retrieval and log traversal into a single interface.
 *
 * Implementations should delegate to existing modules rather than
 * reimplementing Git operations.
 */
export interface Repository {
    /**
     * Retrieve a Git object by its SHA-1 hash.
     *
     * @param sha - 40-character hexadecimal SHA-1 hash
     * @returns The object with type and data, or null if not found
     */
    getObject(sha: string): Promise<{
        type: ObjectType;
        data: Uint8Array;
    } | null>;
    /**
     * Store a Git object and return its SHA-1 hash.
     *
     * @param type - Object type ('blob', 'tree', 'commit', 'tag')
     * @param data - Raw object content (without Git header)
     * @returns The 40-character SHA-1 hash of the stored object
     */
    storeObject(type: ObjectType, data: Uint8Array): Promise<string>;
    /**
     * Check if an object exists in the repository.
     *
     * @param sha - 40-character hexadecimal SHA-1 hash
     * @returns True if the object exists
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Get a reference by its name.
     *
     * @param name - Full ref name (e.g., 'refs/heads/main', 'HEAD')
     * @returns The SHA-1 hash the ref points to, or null if not found
     */
    getRef(name: string): Promise<string | null>;
    /**
     * Set a reference to point to a SHA.
     *
     * @param name - Full ref name (e.g., 'refs/heads/main')
     * @param target - 40-character SHA-1 hash to point to
     */
    setRef(name: string, target: string): Promise<void>;
    /**
     * Delete a reference.
     *
     * @param name - Full ref name to delete
     * @returns True if deleted, false if ref did not exist
     */
    deleteRef(name: string): Promise<boolean>;
    /**
     * List references matching an optional prefix.
     *
     * @param prefix - Optional prefix to filter refs (e.g., 'refs/heads/')
     * @returns Array of Ref objects with name and target
     */
    listRefs(prefix?: string): Promise<Ref[]>;
    /**
     * Get a parsed commit object by SHA.
     *
     * @param sha - 40-character SHA-1 hash of the commit
     * @returns Parsed CommitObject or null if not found or not a commit
     */
    getCommit(sha: string): Promise<CommitObject | null>;
    /**
     * Get parsed tree entries by SHA.
     *
     * @param sha - 40-character SHA-1 hash of the tree
     * @returns Array of tree entries, or empty array if not found
     */
    getTree(sha: string): Promise<TreeEntry[]>;
    /**
     * Walk commit history starting from a ref or SHA.
     *
     * @param ref - Ref name or commit SHA to start from
     * @param limit - Maximum number of commits to return (default: 20)
     * @returns Array of parsed CommitObjects in reverse chronological order
     */
    log(ref: string, limit?: number): Promise<CommitObject[]>;
}
/**
 * Repository implementation backed by a GitBackend.
 *
 * @description
 * Delegates all operations to the underlying GitBackend instance.
 * This is a thin facade that adds high-level operations (getCommit,
 * getTree, log) on top of the raw backend interface.
 *
 * @example
 * ```typescript
 * import { GitBackendRepository } from './core/repository'
 * import { createMemoryBackend } from './core/backend'
 *
 * const backend = createMemoryBackend()
 * const repo = new GitBackendRepository(backend)
 *
 * const sha = await repo.storeObject('blob', content)
 * await repo.setRef('refs/heads/main', commitSha)
 * const history = await repo.log('refs/heads/main', 10)
 * ```
 */
export declare class GitBackendRepository implements Repository {
    private readonly backend;
    constructor(backend: GitBackend);
    getObject(sha: string): Promise<{
        type: ObjectType;
        data: Uint8Array;
    } | null>;
    storeObject(type: ObjectType, data: Uint8Array): Promise<string>;
    hasObject(sha: string): Promise<boolean>;
    getRef(name: string): Promise<string | null>;
    setRef(name: string, target: string): Promise<void>;
    deleteRef(name: string): Promise<boolean>;
    listRefs(prefix?: string): Promise<Ref[]>;
    getCommit(sha: string): Promise<CommitObject | null>;
    getTree(sha: string): Promise<TreeEntry[]>;
    log(ref: string, limit?: number): Promise<CommitObject[]>;
}
//# sourceMappingURL=repository.d.ts.map