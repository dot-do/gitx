/**
 * @fileoverview Local Filesystem Git Repository Adapter
 *
 * This module provides a filesystem adapter for reading git repositories
 * directly from the local .git directory. It implements interfaces for:
 * - Object storage (blobs, trees, commits, tags)
 * - Reference storage (branches, tags, HEAD)
 * - Index/staging area
 * - Git configuration
 * - Pack file reading
 *
 * The adapter supports both loose objects and packed objects, handles
 * symbolic and direct references, and can detect bare repositories.
 *
 * @module cli/fs-adapter
 *
 * @example
 * // Create an adapter for a repository
 * import { createFSAdapter } from './fs-adapter'
 *
 * const adapter = await createFSAdapter('/path/to/repo')
 * const head = await adapter.getHead()
 * const commit = await adapter.getObject(head.target)
 *
 * @example
 * // Check if a directory is a git repository
 * import { isGitRepository } from './fs-adapter'
 *
 * if (await isGitRepository('/some/path')) {
 *   console.log('Valid git repository')
 * }
 */
import type { ObjectType } from '../types/objects';
/**
 * Configuration for the filesystem adapter.
 *
 * @description Allows customization of the adapter behavior including
 * specifying a custom git directory path and memory limits for pack files.
 *
 * @property gitDir - Custom path to the git directory. Defaults to '.git' relative to repo root.
 * @property followSymlinks - Whether to follow symbolic links when traversing. Defaults to true.
 * @property maxPackSize - Maximum pack file size in bytes to load into memory. Large packs may be streamed.
 *
 * @example
 * const config: FSAdapterConfig = {
 *   gitDir: '/custom/.git',
 *   maxPackSize: 100 * 1024 * 1024 // 100MB
 * }
 */
export interface FSAdapterConfig {
    /** Path to the git directory (defaults to '.git') */
    gitDir?: string;
    /** Whether to follow symbolic links */
    followSymlinks?: boolean;
    /** Maximum pack file size to load into memory */
    maxPackSize?: number;
}
/**
 * A stored git object with metadata.
 *
 * @description Represents a git object (blob, tree, commit, or tag) retrieved
 * from the repository. Includes both the object data and metadata about its
 * storage location (loose file or pack file).
 *
 * @property sha - SHA-1 hash of the object (40 hex characters)
 * @property type - Object type: 'blob', 'tree', 'commit', or 'tag'
 * @property size - Size of the object data in bytes
 * @property data - Raw object data (uncompressed)
 * @property source - Storage location: 'loose' for individual files, 'pack' for pack files
 * @property packFile - If from a pack, the pack file name (without extension)
 *
 * @example
 * const obj = await adapter.getObject('abc123...')
 * if (obj.type === 'blob') {
 *   console.log('File content:', new TextDecoder().decode(obj.data))
 * }
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
 * Interface for reading git objects from the filesystem.
 *
 * @description Provides methods for accessing git objects stored in the
 * repository, supporting both loose objects and pack files. All methods
 * are asynchronous and return null for non-existent objects.
 *
 * @example
 * const obj = await store.getObject('abc123def...')
 * if (obj) {
 *   console.log(`Found ${obj.type} object, ${obj.size} bytes`)
 * }
 */
export interface FSObjectStore {
    /**
     * Get an object by SHA.
     * @param sha - 40-character SHA-1 hash
     * @returns The object if found, null otherwise
     */
    getObject(sha: string): Promise<FSObject | null>;
    /**
     * Check if an object exists.
     * @param sha - 40-character SHA-1 hash
     * @returns true if the object exists
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Get object type without loading full data.
     * @param sha - 40-character SHA-1 hash
     * @returns The object type if found, null otherwise
     */
    getObjectType(sha: string): Promise<ObjectType | null>;
    /**
     * Get object size without loading full data.
     * @param sha - 40-character SHA-1 hash
     * @returns The object size in bytes if found, null otherwise
     */
    getObjectSize(sha: string): Promise<number | null>;
    /**
     * List all available object SHAs.
     * @returns Array of 40-character SHA-1 hashes
     */
    listObjects(): Promise<string[]>;
}
/**
 * Type of git reference.
 *
 * @description Git references can be either 'direct' (pointing to a SHA)
 * or 'symbolic' (pointing to another reference like HEAD -> refs/heads/main).
 */
export type FSRefType = 'direct' | 'symbolic';
/**
 * A git reference.
 *
 * @description Represents a named pointer in the git repository.
 * Direct refs point to a commit SHA, while symbolic refs point to
 * another reference name.
 *
 * @property name - Full ref name (e.g., 'refs/heads/main', 'HEAD')
 * @property target - For direct refs: SHA-1 hash. For symbolic refs: target ref name.
 * @property type - 'direct' for SHA targets, 'symbolic' for ref targets
 *
 * @example
 * // Direct reference
 * const mainRef: FSRef = {
 *   name: 'refs/heads/main',
 *   target: 'abc123def456...',
 *   type: 'direct'
 * }
 *
 * @example
 * // Symbolic reference
 * const headRef: FSRef = {
 *   name: 'HEAD',
 *   target: 'refs/heads/main',
 *   type: 'symbolic'
 * }
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
 * Resolved reference with SHA.
 *
 * @description Contains the result of resolving a reference to its final
 * commit SHA, including the chain of symbolic refs that were followed.
 *
 * @property ref - The final resolved reference
 * @property sha - The commit SHA that the ref ultimately points to
 * @property chain - Array of refs followed during resolution (for symbolic refs)
 *
 * @example
 * const resolved = await adapter.resolveRef('HEAD')
 * console.log(`HEAD -> ${resolved.sha}`)
 * console.log(`Resolution chain: ${resolved.chain.map(r => r.name).join(' -> ')}`)
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
 * Interface for reading git refs from the filesystem.
 *
 * @description Provides methods for accessing and resolving git references
 * including branches, tags, HEAD, and packed refs. Supports both loose
 * refs (individual files) and packed refs.
 *
 * @example
 * const head = await store.getHead()
 * if (head?.type === 'symbolic') {
 *   console.log(`On branch: ${head.target}`)
 * } else {
 *   console.log('Detached HEAD')
 * }
 */
export interface FSRefStore {
    /**
     * Get a ref by name.
     * @param name - Ref name (e.g., 'refs/heads/main', 'HEAD')
     * @returns The ref if found, null otherwise
     */
    getRef(name: string): Promise<FSRef | null>;
    /**
     * Resolve a ref to its final SHA.
     * @param name - Ref name to resolve
     * @returns Resolved ref with SHA and resolution chain
     */
    resolveRef(name: string): Promise<FSResolvedRef | null>;
    /**
     * Get HEAD ref.
     * @returns HEAD reference (symbolic or direct)
     */
    getHead(): Promise<FSRef | null>;
    /**
     * Check if HEAD is detached.
     * @returns true if HEAD points directly to a SHA
     */
    isHeadDetached(): Promise<boolean>;
    /**
     * List all branches.
     * @returns Array of refs under refs/heads/
     */
    listBranches(): Promise<FSRef[]>;
    /**
     * List all tags.
     * @returns Array of refs under refs/tags/
     */
    listTags(): Promise<FSRef[]>;
    /**
     * List all refs matching a pattern.
     * @param pattern - Optional glob pattern to filter refs
     * @returns Array of matching refs
     */
    listRefs(pattern?: string): Promise<FSRef[]>;
    /**
     * Get packed refs.
     * @returns Map of ref name to SHA from packed-refs file
     */
    getPackedRefs(): Promise<Map<string, string>>;
}
/**
 * A single entry in the git index (staging area).
 *
 * @description Represents a file entry in the git index, which tracks staged
 * changes for the next commit. Each entry contains file metadata, blob SHA,
 * and staging information.
 *
 * @property path - File path relative to repository root
 * @property sha - SHA-1 hash of the blob content
 * @property mode - File mode (e.g., 0o100644 for regular file, 0o100755 for executable)
 * @property size - File size in bytes
 * @property mtime - Last modification time
 * @property ctime - Creation time (inode change time)
 * @property stage - Stage number: 0 for normal, 1-3 for merge conflicts
 * @property flags - Various index entry flags
 *
 * @example
 * const entry = await index.getEntry('src/main.ts')
 * console.log(`${entry.path}: ${entry.sha.substring(0, 7)} (stage ${entry.stage})`)
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
        /** Assume file is unchanged (skip stat calls) */
        assumeValid: boolean;
        /** Entry uses extended flags */
        extended: boolean;
        /** Skip file in worktree operations */
        skipWorktree: boolean;
        /** File is marked as intent-to-add */
        intentToAdd: boolean;
    };
}
/**
 * Interface for reading the git index (staging area).
 *
 * @description Provides methods for accessing the git index file, which
 * tracks staged changes and merge conflicts. The index is used to prepare
 * the next commit.
 *
 * @example
 * const entries = await index.getEntries()
 * const conflicts = await index.listConflicts()
 * if (conflicts.length > 0) {
 *   console.log('Merge conflicts in:', conflicts.join(', '))
 * }
 */
export interface FSIndex {
    /**
     * Get all index entries.
     * @returns Array of all entries in the index
     */
    getEntries(): Promise<IndexEntry[]>;
    /**
     * Get an entry by path.
     * @param path - File path relative to repo root
     * @returns The entry if found, null otherwise
     */
    getEntry(path: string): Promise<IndexEntry | null>;
    /**
     * Check if a path is staged.
     * @param path - File path to check
     * @returns true if the path has an entry in the index
     */
    isStaged(path: string): Promise<boolean>;
    /**
     * Get conflict entries for a path (stages 1, 2, 3).
     * @param path - File path to check
     * @returns Array of conflict entries (base, ours, theirs)
     */
    getConflicts(path: string): Promise<IndexEntry[]>;
    /**
     * Get all conflicted paths.
     * @returns Array of paths with merge conflicts
     */
    listConflicts(): Promise<string[]>;
    /**
     * Get the index version.
     * @returns Index format version (2, 3, or 4)
     */
    getVersion(): Promise<number>;
}
/**
 * Interface for reading git configuration.
 *
 * @description Provides methods for reading git configuration values from
 * the repository's .git/config file. Supports single values, multi-valued
 * configs, and common shorthand methods for remotes and branch tracking.
 *
 * @example
 * const name = await config.get('user', 'name')
 * const email = await config.get('user', 'email')
 * const upstream = await config.getBranchUpstream('main')
 */
export interface FSConfig {
    /**
     * Get a config value.
     * @param section - Config section (e.g., 'user', 'core', 'remote.origin')
     * @param key - Config key (e.g., 'name', 'email')
     * @returns The value if found, null otherwise
     */
    get(section: string, key: string): Promise<string | null>;
    /**
     * Get all values for a key (for multi-valued configs).
     * @param section - Config section
     * @param key - Config key
     * @returns Array of all values for this key
     */
    getAll(section: string, key: string): Promise<string[]>;
    /**
     * Get all config entries.
     * @returns Map of full key names to values
     */
    getAllEntries(): Promise<Map<string, string>>;
    /**
     * Check if config has a key.
     * @param section - Config section
     * @param key - Config key
     * @returns true if the key exists
     */
    has(section: string, key: string): Promise<boolean>;
    /**
     * Get remote URL.
     * @param remoteName - Name of the remote (e.g., 'origin')
     * @returns The remote URL if configured
     */
    getRemoteUrl(remoteName: string): Promise<string | null>;
    /**
     * Get branch tracking info.
     * @param branchName - Name of the branch
     * @returns Object with remote and merge ref, or null if not tracking
     */
    getBranchUpstream(branchName: string): Promise<{
        remote: string;
        merge: string;
    } | null>;
}
/**
 * Pack file index entry.
 *
 * @description Represents an entry in a pack index (.idx) file, which
 * maps object SHAs to their locations within the pack file.
 *
 * @property sha - SHA-1 hash of the object
 * @property offset - Byte offset of the object within the pack file
 * @property crc32 - CRC32 checksum for data integrity verification
 */
export interface PackIndexEntry {
    /** SHA of the object */
    sha: string;
    /** Offset in the pack file */
    offset: number;
    /** CRC32 checksum */
    crc32: number;
}
/**
 * Interface for reading pack files.
 *
 * @description Provides methods for working with git pack files, which
 * store multiple compressed objects efficiently. Supports listing packs,
 * reading the index, and extracting individual objects.
 *
 * @example
 * const packs = await packReader.listPackFiles()
 * for (const pack of packs) {
 *   const objects = await packReader.getPackObjects(pack)
 *   console.log(`Pack ${pack}: ${objects.length} objects`)
 * }
 */
export interface FSPackReader {
    /**
     * List all pack files.
     * @returns Array of pack names (without .pack extension)
     */
    listPackFiles(): Promise<string[]>;
    /**
     * Get objects from a pack file.
     * @param packName - Pack name (without extension)
     * @returns Array of index entries for all objects in the pack
     */
    getPackObjects(packName: string): Promise<PackIndexEntry[]>;
    /**
     * Read an object from a pack file.
     * @param packName - Pack name (without extension)
     * @param offset - Byte offset in the pack file
     * @returns The decompressed object, or null if not found
     */
    readPackObject(packName: string, offset: number): Promise<FSObject | null>;
    /**
     * Get pack file checksum.
     * @param packName - Pack name (without extension)
     * @returns SHA-1 checksum of the pack file
     */
    getPackChecksum(packName: string): Promise<string | null>;
}
/**
 * Main filesystem adapter that combines all interfaces.
 *
 * @description The primary interface for interacting with a git repository
 * on the local filesystem. Combines object store, ref store, and provides
 * access to index, config, and pack readers.
 *
 * @extends FSObjectStore - Methods for reading git objects
 * @extends FSRefStore - Methods for reading git references
 *
 * @example
 * const adapter = await createFSAdapter('/path/to/repo')
 *
 * // Read HEAD
 * const head = await adapter.getHead()
 *
 * // Get commit object
 * const resolved = await adapter.resolveRef('HEAD')
 * const commit = await adapter.getObject(resolved.sha)
 *
 * // Access staging area
 * const index = adapter.getIndex()
 * const entries = await index.getEntries()
 */
export interface FSAdapter extends FSObjectStore, FSRefStore {
    /** Path to the repository root (working directory) */
    readonly repoPath: string;
    /** Path to the git directory (.git or bare repo root) */
    readonly gitDir: string;
    /** Whether this is a bare repository (no working directory) */
    readonly isBare: boolean;
    /**
     * Get the index/staging area.
     * @returns FSIndex interface for reading the index
     */
    getIndex(): FSIndex;
    /**
     * Get the config reader.
     * @returns FSConfig interface for reading configuration
     */
    getConfig(): FSConfig;
    /**
     * Get the pack reader.
     * @returns FSPackReader interface for reading pack files
     */
    getPackReader(): FSPackReader;
    /**
     * Check if the directory is a valid git repository.
     * @returns true if valid git repository structure exists
     */
    isGitRepository(): Promise<boolean>;
    /**
     * Get repository description.
     * @returns Contents of .git/description file, or null
     */
    getDescription(): Promise<string | null>;
}
/**
 * Error codes for filesystem operations.
 *
 * @description Enum-like type of error codes that can occur during
 * filesystem adapter operations. Used to identify specific error types.
 *
 * - NOT_A_GIT_REPO: Path is not a valid git repository
 * - OBJECT_NOT_FOUND: Requested object SHA does not exist
 * - REF_NOT_FOUND: Requested reference does not exist
 * - CORRUPT_OBJECT: Object data is malformed or corrupt
 * - CORRUPT_PACK: Pack file is malformed or corrupt
 * - CORRUPT_INDEX: Index file is malformed or corrupt
 * - INVALID_SHA: Provided SHA is not valid format
 * - READ_ERROR: General filesystem read error
 * - UNSUPPORTED_VERSION: File format version not supported
 */
export type FSAdapterErrorCode = 'NOT_A_GIT_REPO' | 'OBJECT_NOT_FOUND' | 'REF_NOT_FOUND' | 'CORRUPT_OBJECT' | 'CORRUPT_PACK' | 'CORRUPT_INDEX' | 'INVALID_SHA' | 'READ_ERROR' | 'UNSUPPORTED_VERSION';
/**
 * Error thrown by filesystem operations.
 *
 * @description Custom error class for filesystem adapter operations.
 * Includes an error code for programmatic handling and optional path
 * information for debugging.
 *
 * @extends Error
 *
 * @example
 * try {
 *   await adapter.getObject(sha)
 * } catch (error) {
 *   if (error instanceof FSAdapterError) {
 *     if (error.code === 'OBJECT_NOT_FOUND') {
 *       console.log('Object does not exist')
 *     } else if (error.code === 'CORRUPT_OBJECT') {
 *       console.log('Object is corrupted:', error.path)
 *     }
 *   }
 * }
 */
export declare class FSAdapterError extends Error {
    /** Error code for programmatic handling */
    readonly code: FSAdapterErrorCode;
    /** Optional path related to the error */
    readonly path?: string | undefined;
    /**
     * Creates a new FSAdapterError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param path - Optional path related to the error
     */
    constructor(message: string, 
    /** Error code for programmatic handling */
    code: FSAdapterErrorCode, 
    /** Optional path related to the error */
    path?: string | undefined);
}
/**
 * Check if a directory is a git repository.
 *
 * @description Validates whether the given path is a valid git repository
 * by checking for the presence of .git (directory or file for worktrees)
 * and validating the git directory structure.
 *
 * @param repoPath - Path to check
 * @returns true if the path is a valid git repository
 *
 * @example
 * if (await isGitRepository('/path/to/repo')) {
 *   console.log('Valid git repository')
 * } else {
 *   console.log('Not a git repository')
 * }
 *
 * @example
 * // Works with worktrees (where .git is a file)
 * const isRepo = await isGitRepository('/path/to/worktree')
 */
export declare function isGitRepository(repoPath: string): Promise<boolean>;
/**
 * Detect if a repository is bare.
 *
 * @description Checks whether a git directory represents a bare repository
 * (one without a working directory). Looks at the config file for the
 * 'bare' setting, or infers from directory structure.
 *
 * @param gitDir - Path to .git directory or potential bare repo root
 * @returns true if the repository is bare
 *
 * @example
 * const isBare = await isBareRepository('/path/to/.git')
 * // or for bare repos
 * const isBare = await isBareRepository('/path/to/repo.git')
 */
export declare function isBareRepository(gitDir: string): Promise<boolean>;
/**
 * Create a filesystem adapter for a local git repository.
 *
 * @description Factory function that creates an FSAdapter for a git repository.
 * Automatically detects the git directory, handles worktrees (where .git is
 * a file), and identifies bare repositories.
 *
 * @param repoPath - Path to the repository root (or bare repo directory)
 * @param config - Optional configuration for the adapter
 * @returns A fully initialized FSAdapter instance
 *
 * @throws {FSAdapterError} With code 'NOT_A_GIT_REPO' if the path is not a valid git repository
 *
 * @example
 * // Create adapter for a regular repository
 * const adapter = await createFSAdapter('/path/to/repo')
 *
 * @example
 * // Create adapter with custom git directory
 * const adapter = await createFSAdapter('/path/to/repo', {
 *   gitDir: '/path/to/custom/.git'
 * })
 *
 * @example
 * // Handle errors
 * try {
 *   const adapter = await createFSAdapter('/not/a/repo')
 * } catch (error) {
 *   if (error instanceof FSAdapterError && error.code === 'NOT_A_GIT_REPO') {
 *     console.log('Not a git repository')
 *   }
 * }
 */
export declare function createFSAdapter(repoPath: string, config?: FSAdapterConfig): Promise<FSAdapter>;
//# sourceMappingURL=fs-adapter.d.ts.map