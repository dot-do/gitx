/**
 * @fileoverview GitModule for Durable Object Integration
 *
 * This module provides a GitModule class that integrates with dotdo's $ WorkflowContext,
 * providing $.git.sync(), $.git.push(), and $.git.binding functionality.
 *
 * The module depends on FsModule for file operations and uses R2 as the
 * global git object store for cross-DO synchronization.
 *
 * @module do/GitModule
 *
 * @example
 * ```typescript
 * import { GitModule } from 'gitx.do/do'
 *
 * class MyDO extends DO {
 *   git = new GitModule(this.$, {
 *     repo: 'org/repo',
 *     branch: 'main',
 *     r2: this.env.R2_BUCKET
 *   })
 *
 *   async syncRepository() {
 *     await this.git.sync()
 *     const status = await this.git.status()
 *     console.log(`On branch ${status.branch}`)
 *   }
 * }
 * ```
 */
/**
 * Filesystem capability interface that GitModule depends on.
 * Mirrors the FsCapability from dotdo's WorkflowContext.
 */
export interface FsCapability {
    readFile(path: string): Promise<string | Buffer>;
    writeFile(path: string, content: string | Buffer): Promise<void>;
    readDir(path: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    rm(path: string, options?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<void>;
    /**
     * Get the integer rowid (file_id) for a file path.
     * Used to establish foreign key references in git_content table.
     * @param path - File path to look up
     * @returns The file's integer rowid, or null if file doesn't exist
     */
    getFileId?(path: string): Promise<number | null>;
}
/**
 * R2 Bucket interface for object storage operations.
 * Used as the global git object store.
 */
export interface R2BucketLike {
    get(key: string): Promise<R2ObjectLike | null>;
    put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<R2ObjectLike>;
    delete(key: string | string[]): Promise<void>;
    list(options?: {
        prefix?: string;
        limit?: number;
        cursor?: string;
    }): Promise<R2ObjectsLike>;
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
 * R2 Objects list result interface.
 */
export interface R2ObjectsLike {
    objects: R2ObjectLike[];
    truncated: boolean;
    cursor?: string;
}
/**
 * Database storage interface for GitModule persistence.
 * Provides access to the git, git_branches, and git_content tables.
 */
export interface GitStorage {
    /**
     * SQL execution interface.
     */
    sql: {
        /**
         * Execute a SQL query with optional parameters.
         * @param query - SQL query string (can use ? placeholders)
         * @param params - Parameter values for placeholders
         * @returns Result object with toArray() method for reading rows
         */
        exec(query: string, ...params: unknown[]): {
            toArray(): unknown[];
        };
    };
}
/**
 * Row structure for the git table.
 */
export interface GitRow {
    id: number;
    repo: string;
    path: string | null;
    branch: string;
    commit: string | null;
    last_sync: number | null;
    object_prefix: string;
    created_at: number | null;
    updated_at: number | null;
}
/**
 * Row structure for the git_branches table.
 */
export interface GitBranchRow {
    id: number;
    repo_id: number;
    name: string;
    head: string | null;
    upstream: string | null;
    tracking: number;
    ahead: number;
    behind: number;
    created_at: number | null;
    updated_at: number | null;
}
/**
 * Row structure for the git_content table.
 * Uses file_id to reference the shared files table for efficient lookups.
 */
export interface GitContentRow {
    id: number;
    repo_id: number;
    file_id: number | null;
    path: string;
    content: Uint8Array | null;
    mode: string;
    status: string;
    sha: string | null;
    created_at: number | null;
    updated_at: number | null;
}
/**
 * Git binding configuration for the module.
 * Represents the connection between a DO and a git repository.
 */
export interface GitBinding {
    /**
     * Repository identifier (e.g., 'org/repo' or full URL)
     */
    repo: string;
    /**
     * Optional path prefix within the repository
     */
    path?: string;
    /**
     * Branch name to track
     * @default 'main'
     */
    branch: string;
    /**
     * Current commit SHA that this DO is synced to
     */
    commit?: string;
    /**
     * Last sync timestamp
     */
    lastSync?: Date;
}
/**
 * Configuration options for GitModule.
 */
export interface GitModuleOptions {
    /**
     * Repository identifier (e.g., 'org/repo')
     */
    repo: string;
    /**
     * Branch to track
     * @default 'main'
     */
    branch?: string;
    /**
     * Optional path prefix within the repository
     */
    path?: string;
    /**
     * R2 bucket for global object storage
     */
    r2?: R2BucketLike;
    /**
     * Filesystem capability to use for file operations
     */
    fs?: FsCapability;
    /**
     * Custom object key prefix in R2
     * @default 'git/objects'
     */
    objectPrefix?: string;
    /**
     * Database storage for persistent state.
     * When provided, GitModule will persist state to the git, git_branches,
     * and git_content tables.
     */
    storage?: GitStorage;
}
/**
 * Git status information.
 */
export interface GitStatus {
    /**
     * Current branch name
     */
    branch: string;
    /**
     * Current HEAD commit SHA
     */
    head?: string;
    /**
     * Files staged for commit
     */
    staged: string[];
    /**
     * Files with unstaged changes
     */
    unstaged: string[];
    /**
     * Untracked files
     */
    untracked?: string[];
    /**
     * Whether the working tree is clean
     */
    clean: boolean;
}
/**
 * Result of a sync operation.
 */
export interface SyncResult {
    /**
     * Whether the sync succeeded
     */
    success: boolean;
    /**
     * Number of objects fetched
     */
    objectsFetched: number;
    /**
     * Number of files written
     */
    filesWritten: number;
    /**
     * New HEAD commit after sync
     */
    commit?: string;
    /**
     * Error message if sync failed
     */
    error?: string;
}
/**
 * Result of a push operation.
 */
export interface PushResult {
    /**
     * Whether the push succeeded
     */
    success: boolean;
    /**
     * Number of objects pushed
     */
    objectsPushed: number;
    /**
     * New commit SHA after push
     */
    commit?: string;
    /**
     * Error message if push failed
     */
    error?: string;
}
/**
 * GitModule class for integration with dotdo's $ WorkflowContext.
 *
 * @description
 * Provides git functionality as a capability module that integrates with
 * dotdo's Durable Object framework. The module:
 *
 * - Syncs git objects from R2 global object store to local storage via FsModule
 * - Pushes local changes back to R2 for cross-DO synchronization
 * - Provides a binding property for repository configuration
 * - Implements standard git operations (status, add, commit)
 *
 * @example
 * ```typescript
 * // In a Durable Object
 * class MyDO extends DO {
 *   private git: GitModule
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *     this.git = new GitModule({
 *       repo: 'my-org/my-repo',
 *       branch: 'main',
 *       r2: env.GIT_OBJECTS,
 *       fs: this.$.fs
 *     })
 *   }
 *
 *   async fetch(request: Request) {
 *     // Sync from R2
 *     await this.git.sync()
 *
 *     // Make changes via $.fs
 *     await this.$.fs.writeFile('/src/index.ts', 'new code')
 *
 *     // Stage and commit
 *     await this.git.add('src/index.ts')
 *     await this.git.commit('Update code')
 *
 *     // Push to R2
 *     await this.git.push()
 *
 *     return new Response('OK')
 *   }
 * }
 * ```
 */
export declare class GitModule {
    /**
     * Capability module name for identification.
     */
    readonly name: "git";
    /**
     * Repository identifier.
     */
    private readonly repo;
    /**
     * Branch being tracked.
     */
    private readonly branch;
    /**
     * Path prefix within the repository.
     */
    private readonly path?;
    /**
     * R2 bucket for global object storage.
     */
    private readonly r2?;
    /**
     * Filesystem capability for file operations.
     */
    private readonly fs?;
    /**
     * Object key prefix in R2.
     */
    private readonly objectPrefix;
    /**
     * Database storage for persistence.
     */
    private readonly storage?;
    /**
     * Database row ID for this repository binding.
     */
    private repoId?;
    /**
     * Current HEAD commit SHA.
     */
    private currentCommit?;
    /**
     * Timestamp of last sync operation.
     */
    private lastSyncTime?;
    /**
     * Staged files pending commit.
     */
    private stagedFiles;
    /**
     * Pending objects to push to R2.
     * Map of SHA to { type, data } for objects that have been committed locally
     * but not yet pushed to the R2 object store.
     */
    private pendingObjects;
    /**
     * Create a new GitModule instance.
     *
     * @param options - Configuration options
     *
     * @example
     * ```typescript
     * const git = new GitModule({
     *   repo: 'org/repo',
     *   branch: 'main',
     *   r2: env.R2_BUCKET,
     *   fs: workflowContext.fs
     * })
     * ```
     */
    constructor(options: GitModuleOptions);
    /**
     * Get the current git binding configuration.
     *
     * @description
     * Returns the binding information connecting this module to a git repository.
     * This includes the repository, branch, path, current commit, and last sync time.
     *
     * @returns Current git binding
     *
     * @example
     * ```typescript
     * const binding = git.binding
     * console.log(`Repo: ${binding.repo}`)
     * console.log(`Branch: ${binding.branch}`)
     * console.log(`Commit: ${binding.commit ?? 'not synced'}`)
     * ```
     */
    get binding(): GitBinding;
    /**
     * Optional initialization hook.
     * Called when the module is first loaded.
     * When storage is provided, loads or creates the repository binding from the database.
     */
    initialize(): Promise<void>;
    /**
     * Optional cleanup hook.
     * Called when the capability is unloaded.
     */
    dispose(): Promise<void>;
    /**
     * Sync git objects from R2 to local storage via FsModule.
     *
     * @description
     * Fetches git objects from the R2 global object store and writes them
     * to the local filesystem via the FsModule. This syncs the DO's local
     * state with the shared repository state.
     *
     * @returns Result of the sync operation
     *
     * @example
     * ```typescript
     * const result = await git.sync()
     * if (result.success) {
     *   console.log(`Synced ${result.objectsFetched} objects`)
     *   console.log(`Now at commit ${result.commit}`)
     * } else {
     *   console.error(`Sync failed: ${result.error}`)
     * }
     * ```
     */
    sync(): Promise<SyncResult>;
    /**
     * Push local changes to R2 object store.
     *
     * @description
     * Writes local git objects to the R2 global object store for
     * cross-DO synchronization. This makes local changes available
     * to other DOs that sync from the same repository.
     *
     * @returns Result of the push operation
     *
     * @example
     * ```typescript
     * // Make changes and commit
     * await git.add('src/index.ts')
     * await git.commit('Update code')
     *
     * // Push to R2
     * const result = await git.push()
     * if (result.success) {
     *   console.log(`Pushed ${result.objectsPushed} objects`)
     * }
     * ```
     */
    push(): Promise<PushResult>;
    /**
     * Get the current repository status.
     *
     * @description
     * Returns information about the current branch, HEAD commit,
     * and staged/unstaged files.
     *
     * @returns Status object with branch and file information
     *
     * @example
     * ```typescript
     * const status = await git.status()
     * console.log(`On branch ${status.branch}`)
     * if (status.staged.length > 0) {
     *   console.log(`${status.staged.length} files staged`)
     * }
     * ```
     */
    status(): Promise<GitStatus>;
    /**
     * Stage files for commit.
     *
     * @description
     * Adds files to the staging area for the next commit.
     *
     * @param files - File path or array of file paths to stage
     *
     * @example
     * ```typescript
     * await git.add('src/index.ts')
     * await git.add(['src/a.ts', 'src/b.ts'])
     * ```
     */
    add(files: string | string[]): Promise<void>;
    /**
     * Create a new commit with staged changes.
     *
     * @description
     * Creates a commit object with the currently staged changes.
     * Returns the commit hash.
     *
     * @param message - Commit message
     * @returns Commit hash or object with hash
     *
     * @example
     * ```typescript
     * await git.add('src/index.ts')
     * const result = await git.commit('Update code')
     * console.log(`Created commit: ${result}`)
     * ```
     */
    commit(message: string): Promise<string | {
        hash: string;
    }>;
    /**
     * Build tree content from entries.
     * Format: mode name\0sha20bytes (repeated)
     */
    private buildTreeContent;
    /**
     * Convert hex string to bytes.
     */
    private hexToBytes;
    /**
     * Hash raw bytes using SHA-1.
     */
    private hashBytes;
    /**
     * Get diff between references or working tree.
     *
     * @param _ref - Reference to diff against (not yet implemented)
     * @returns Unified diff output
     */
    diff(_ref?: string): Promise<string>;
    /**
     * Get commit history.
     *
     * @param _options - Options for filtering results (not yet implemented)
     * @returns Array of commit objects
     */
    log(_options?: {
        limit?: number;
    }): Promise<Array<{
        hash: string;
        message: string;
    }>>;
    /**
     * Pull changes from R2 (alias for sync).
     *
     * @param _remote - Remote name (ignored, always uses R2)
     * @param _branch - Branch to pull (uses configured branch)
     */
    pull(_remote?: string, _branch?: string): Promise<void>;
    /**
     * Fetch a git object from R2 by SHA.
     */
    private fetchObject;
    /**
     * Store a git object in R2.
     */
    private storeObject;
    /**
     * Recursively sync a tree and its contents.
     */
    private syncTree;
    /**
     * Convert bytes to hex string.
     */
    private bytesToHex;
    /**
     * Persist sync state to the database.
     * Updates the git table with the current commit and last sync timestamp.
     */
    private persistSyncState;
    /**
     * Persist a staged file to the database.
     * Inserts or updates a record in the git_content table.
     * Uses file_id foreign key to reference the shared files table when available.
     */
    private persistStagedFile;
    /**
     * Persist commit state to the database.
     * Updates the git table with the new commit hash and clears staged files.
     */
    private persistCommitState;
}
/**
 * Create a GitModule instance with the given options.
 *
 * @param options - Configuration options for the module
 * @returns A new GitModule instance
 *
 * @example
 * ```typescript
 * import { createGitModule } from 'gitx.do/do'
 *
 * const git = createGitModule({
 *   repo: 'org/repo',
 *   branch: 'main',
 *   r2: env.R2_BUCKET,
 *   fs: workflowContext.fs
 * })
 * ```
 */
export declare function createGitModule(options: GitModuleOptions): GitModule;
/**
 * Check if a value is a GitModule instance.
 *
 * @param value - Value to check
 * @returns True if value is a GitModule
 */
export declare function isGitModule(value: unknown): value is GitModule;
//# sourceMappingURL=GitModule.d.ts.map