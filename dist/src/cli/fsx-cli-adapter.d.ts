/**
 * @fileoverview FSx CLI Adapter for Git Repository Operations
 *
 * This module provides a CLI adapter that uses the FSxStorageAdapter for Git
 * repository operations. It bridges the CLI interface (FSAdapter-compatible)
 * with the fsx-backed storage, allowing the CLI to work with any fsx storage.
 *
 * **Features**:
 * - Compatible with FSAdapter interface from fs-adapter.ts
 * - Uses FSxStorageAdapter for underlying storage operations
 * - Provides object retrieval, ref resolution, and listing operations
 * - Handles both loose objects and references
 *
 * **Note**: Pack file operations are not implemented as fsx uses CAS storage.
 * For pack file reading, use the standard fs-adapter.ts instead.
 *
 * @module cli/fsx-cli-adapter
 *
 * @example
 * ```typescript
 * import { createFSxCLIAdapter } from './fsx-cli-adapter'
 *
 * const adapter = await createFSxCLIAdapter('/path/to/repo')
 * const head = await adapter.getHead()
 * const commit = await adapter.getObject(head.target)
 * ```
 */
import type { ObjectType } from '../types/objects';
/**
 * Type of git reference.
 */
export type FSRefType = 'direct' | 'symbolic';
/**
 * A git reference.
 */
export interface FSRef {
    /** Full ref name (e.g., 'refs/heads/main') */
    name: string;
    /** Target - SHA (direct) or ref name (symbolic) */
    target: string;
    /** Type of reference */
    type: FSRefType;
}
/**
 * A stored git object with metadata.
 */
export interface FSObject {
    /** SHA-1 hash of the object */
    sha: string;
    /** Object type: blob, tree, commit, tag */
    type: ObjectType;
    /** Size of the object data in bytes */
    size: number;
    /** Raw object data (uncompressed) */
    data: Uint8Array;
    /** Source location: 'loose' or 'pack' */
    source: 'loose' | 'pack';
    /** If from a pack, the pack file name */
    packFile?: string;
}
/**
 * Resolved reference with SHA.
 */
export interface FSResolvedRef {
    /** The original ref */
    ref: FSRef;
    /** Final SHA after resolving symbolic refs */
    sha: string;
    /** Chain of refs followed */
    chain: FSRef[];
}
/**
 * A single entry in the git index (staging area).
 */
export interface IndexEntry {
    /** File path relative to repo root */
    path: string;
    /** SHA of the blob */
    sha: string;
    /** File mode */
    mode: number;
    /** File size */
    size: number;
    /** Modification time */
    mtime: Date;
    /** Creation time */
    ctime: Date;
    /** Stage number (0 for normal, 1-3 for conflicts) */
    stage: number;
    /** Various flags */
    flags: {
        assumeValid: boolean;
        extended: boolean;
        skipWorktree: boolean;
        intentToAdd: boolean;
    };
}
/**
 * Tree entry from a tree object.
 */
export interface TreeEntry {
    /** File/directory mode */
    mode: number;
    /** Name of the entry */
    name: string;
    /** SHA-1 hash of the referenced object */
    sha: string;
    /** Whether this is a tree (directory) or blob (file) */
    type: 'tree' | 'blob';
}
/**
 * Parsed commit object.
 */
export interface ParsedCommit {
    /** Tree SHA referenced by this commit */
    tree: string;
    /** Parent commit SHAs */
    parents: string[];
    /** Author information */
    author: {
        name: string;
        email: string;
        timestamp: number;
        timezone: string;
    };
    /** Committer information */
    committer: {
        name: string;
        email: string;
        timestamp: number;
        timezone: string;
    };
    /** Commit message */
    message: string;
    /** GPG signature if present */
    gpgSig?: string;
}
/**
 * Error codes for FSx CLI adapter operations.
 */
export type FSxCLIAdapterErrorCode = 'NOT_A_GIT_REPO' | 'OBJECT_NOT_FOUND' | 'REF_NOT_FOUND' | 'CORRUPT_OBJECT' | 'INVALID_SHA' | 'READ_ERROR' | 'NOT_IMPLEMENTED';
/**
 * Error thrown by FSx CLI adapter operations.
 */
export declare class FSxCLIAdapterError extends Error {
    readonly code: FSxCLIAdapterErrorCode;
    readonly path?: string | undefined;
    constructor(message: string, code: FSxCLIAdapterErrorCode, path?: string | undefined);
}
/**
 * CLI adapter that uses fsx for Git repository operations.
 *
 * @description
 * This adapter wraps FSxStorageAdapter to provide a CLI-friendly interface
 * compatible with the FSAdapter interface from fs-adapter.ts. It allows
 * the CLI to work with any fsx-backed storage.
 *
 * @example
 * ```typescript
 * const adapter = await createFSxCLIAdapter('/path/to/repo')
 *
 * // Get HEAD reference
 * const head = await adapter.getHead()
 *
 * // Resolve to SHA
 * const resolved = await adapter.resolveRef('HEAD')
 * console.log(`Current commit: ${resolved.sha}`)
 *
 * // Get commit object
 * const commit = await adapter.getCommit(resolved.sha)
 * console.log(`Message: ${commit.message}`)
 * ```
 */
export declare class FSxCLIAdapter {
    private backend;
    private gitDir;
    private repoPath;
    /**
     * Create a new FSxCLIAdapter.
     *
     * @param repoPath - Path to the repository root
     * @param options - Optional configuration
     */
    constructor(repoPath: string, options?: {
        gitDir?: string;
    });
    /**
     * Get a git object by its SHA.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns The object if found, null otherwise
     */
    getObject(sha: string): Promise<FSObject | null>;
    /**
     * Check if an object exists.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns true if the object exists
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Get object type without loading full data.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns The object type if found, null otherwise
     */
    getObjectType(sha: string): Promise<ObjectType | null>;
    /**
     * Get object size without loading full data.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns The object size in bytes if found, null otherwise
     */
    getObjectSize(sha: string): Promise<number | null>;
    /**
     * Read a blob object's content.
     *
     * @param sha - 40-character SHA-1 hash of a blob
     * @returns The blob content as Uint8Array
     */
    readBlob(sha: string): Promise<Uint8Array>;
    /**
     * Read a tree object's entries.
     *
     * @param sha - 40-character SHA-1 hash of a tree
     * @returns Array of tree entries
     */
    readTree(sha: string): Promise<TreeEntry[]>;
    /**
     * Get a parsed commit object.
     *
     * @param sha - 40-character SHA-1 hash of a commit
     * @returns Parsed commit object
     */
    getCommit(sha: string): Promise<ParsedCommit>;
    /**
     * Get HEAD reference.
     *
     * @returns HEAD reference (symbolic or direct), or null if not found
     */
    getHead(): Promise<FSRef | null>;
    /**
     * Get a reference by name.
     *
     * @param name - Full ref name (e.g., 'refs/heads/main', 'HEAD')
     * @returns The ref if found, null otherwise
     */
    getRef(name: string): Promise<FSRef | null>;
    /**
     * Resolve a reference to its final SHA.
     *
     * @param name - Ref name to resolve
     * @returns Resolved ref with SHA and resolution chain, or null if not found
     */
    resolveRef(name: string): Promise<FSResolvedRef | null>;
    /**
     * Check if HEAD is detached (pointing directly to a SHA).
     *
     * @returns true if HEAD points directly to a SHA
     */
    isHeadDetached(): Promise<boolean>;
    /**
     * List all branches.
     *
     * @returns Array of branch names (without 'refs/heads/' prefix)
     */
    listBranches(): Promise<string[]>;
    /**
     * List all tags.
     *
     * @returns Array of tag names (without 'refs/tags/' prefix)
     */
    listTags(): Promise<string[]>;
    /**
     * List all refs matching an optional prefix.
     *
     * @param prefix - Optional prefix to filter refs
     * @returns Array of refs
     */
    listRefs(prefix?: string): Promise<FSRef[]>;
    /**
     * Get the repository path.
     */
    getRepoPath(): string;
    /**
     * Get the git directory path.
     */
    getGitDir(): string;
    /**
     * Check if this is a valid git repository.
     *
     * @returns true if valid git repository structure exists
     */
    isGitRepository(): Promise<boolean>;
    /**
     * Get repository description.
     *
     * @returns Contents of .git/description file, or null
     */
    getDescription(): Promise<string | null>;
    /**
     * Get index entries.
     *
     * @description Index operations are not implemented in the fsx adapter.
     * Use the standard fs-adapter for index operations.
     */
    getIndexEntries(): Promise<IndexEntry[]>;
    /**
     * List pack files.
     *
     * @description Pack file operations are not implemented in the fsx adapter.
     * fsx uses CAS storage instead of pack files.
     */
    listPackFiles(): Promise<string[]>;
}
/**
 * Check if a directory is a git repository.
 *
 * @description Validates whether the given path is a valid git repository
 * by checking for the presence of .git directory and required git files.
 *
 * @param repoPath - Path to check
 * @returns true if the path is a valid git repository
 *
 * @example
 * ```typescript
 * if (await isGitRepository('/path/to/repo')) {
 *   console.log('Valid git repository')
 * }
 * ```
 */
export declare function isGitRepository(repoPath: string): Promise<boolean>;
/**
 * Create an FSx CLI adapter for a local git repository.
 *
 * @description Factory function that creates an FSxCLIAdapter for a git repository.
 * Uses fsx storage backend for all operations.
 *
 * @param repoPath - Path to the repository root
 * @param options - Optional configuration
 * @returns A fully initialized FSxCLIAdapter instance
 *
 * @throws {FSxCLIAdapterError} With code 'NOT_A_GIT_REPO' if the path is not a valid git repository
 *
 * @example
 * ```typescript
 * // Create adapter for a regular repository
 * const adapter = await createFSxCLIAdapter('/path/to/repo')
 *
 * // Create adapter with custom git directory
 * const adapter = await createFSxCLIAdapter('/path/to/repo', {
 *   gitDir: '/path/to/custom/.git'
 * })
 * ```
 */
export declare function createFSxCLIAdapter(repoPath: string, options?: {
    gitDir?: string;
}): Promise<FSxCLIAdapter>;
//# sourceMappingURL=fsx-cli-adapter.d.ts.map