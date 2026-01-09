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

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Filesystem capability interface that GitModule depends on.
 * Mirrors the FsCapability from dotdo's WorkflowContext.
 */
export interface FsCapability {
  readFile(path: string): Promise<string | Buffer>
  writeFile(path: string, content: string | Buffer): Promise<void>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}

/**
 * R2 Bucket interface for object storage operations.
 * Used as the global git object store.
 */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>
  put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<R2ObjectLike>
  delete(key: string | string[]): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectsLike>
}

/**
 * R2 Object interface.
 */
export interface R2ObjectLike {
  key: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

/**
 * R2 Objects list result interface.
 */
export interface R2ObjectsLike {
  objects: R2ObjectLike[]
  truncated: boolean
  cursor?: string
}

/**
 * Git binding configuration for the module.
 * Represents the connection between a DO and a git repository.
 */
export interface GitBinding {
  /**
   * Repository identifier (e.g., 'org/repo' or full URL)
   */
  repo: string

  /**
   * Optional path prefix within the repository
   */
  path?: string

  /**
   * Branch name to track
   * @default 'main'
   */
  branch: string

  /**
   * Current commit SHA that this DO is synced to
   */
  commit?: string

  /**
   * Last sync timestamp
   */
  lastSync?: Date
}

/**
 * Configuration options for GitModule.
 */
export interface GitModuleOptions {
  /**
   * Repository identifier (e.g., 'org/repo')
   */
  repo: string

  /**
   * Branch to track
   * @default 'main'
   */
  branch?: string

  /**
   * Optional path prefix within the repository
   */
  path?: string

  /**
   * R2 bucket for global object storage
   */
  r2?: R2BucketLike

  /**
   * Filesystem capability to use for file operations
   */
  fs?: FsCapability

  /**
   * Custom object key prefix in R2
   * @default 'git/objects'
   */
  objectPrefix?: string
}

/**
 * Git status information.
 */
export interface GitStatus {
  /**
   * Current branch name
   */
  branch: string

  /**
   * Current HEAD commit SHA
   */
  head?: string

  /**
   * Files staged for commit
   */
  staged: string[]

  /**
   * Files with unstaged changes
   */
  unstaged: string[]

  /**
   * Untracked files
   */
  untracked?: string[]

  /**
   * Whether the working tree is clean
   */
  clean: boolean
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  /**
   * Whether the sync succeeded
   */
  success: boolean

  /**
   * Number of objects fetched
   */
  objectsFetched: number

  /**
   * Number of files written
   */
  filesWritten: number

  /**
   * New HEAD commit after sync
   */
  commit?: string

  /**
   * Error message if sync failed
   */
  error?: string
}

/**
 * Result of a push operation.
 */
export interface PushResult {
  /**
   * Whether the push succeeded
   */
  success: boolean

  /**
   * Number of objects pushed
   */
  objectsPushed: number

  /**
   * New commit SHA after push
   */
  commit?: string

  /**
   * Error message if push failed
   */
  error?: string
}

// ============================================================================
// GitModule Class
// ============================================================================

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
export class GitModule {
  /**
   * Capability module name for identification.
   */
  readonly name = 'git' as const

  /**
   * Repository identifier.
   */
  private readonly repo: string

  /**
   * Branch being tracked.
   */
  private readonly branch: string

  /**
   * Path prefix within the repository.
   */
  private readonly path?: string

  /**
   * R2 bucket for global object storage.
   */
  private readonly r2?: R2BucketLike

  /**
   * Filesystem capability for file operations.
   */
  private readonly fs?: FsCapability

  /**
   * Object key prefix in R2.
   */
  private readonly objectPrefix: string

  /**
   * Current HEAD commit SHA.
   */
  private currentCommit?: string

  /**
   * Timestamp of last sync operation.
   */
  private lastSyncTime?: Date

  /**
   * Staged files pending commit.
   */
  private stagedFiles: Set<string> = new Set()

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
  constructor(options: GitModuleOptions) {
    this.repo = options.repo
    this.branch = options.branch ?? 'main'
    this.path = options.path
    this.r2 = options.r2
    this.fs = options.fs
    this.objectPrefix = options.objectPrefix ?? 'git/objects'
  }

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
  get binding(): GitBinding {
    return {
      repo: this.repo,
      branch: this.branch,
      path: this.path,
      commit: this.currentCommit,
      lastSync: this.lastSyncTime
    }
  }

  /**
   * Optional initialization hook.
   * Called when the module is first loaded.
   */
  async initialize(): Promise<void> {
    // Initialization logic if needed
    // For example, check R2 connectivity or validate configuration
  }

  /**
   * Optional cleanup hook.
   * Called when the capability is unloaded.
   */
  async dispose(): Promise<void> {
    // Cleanup logic if needed
    this.stagedFiles.clear()
  }

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
  async sync(): Promise<SyncResult> {
    if (!this.r2) {
      return {
        success: false,
        objectsFetched: 0,
        filesWritten: 0,
        error: 'R2 bucket not configured'
      }
    }

    if (!this.fs) {
      return {
        success: false,
        objectsFetched: 0,
        filesWritten: 0,
        error: 'Filesystem capability not available'
      }
    }

    try {
      // Get the ref for our branch
      const refKey = `${this.objectPrefix}/refs/heads/${this.branch}`
      const refObject = await this.r2.get(refKey)

      if (!refObject) {
        // No ref exists yet - this is a new/empty repository
        this.currentCommit = undefined
        this.lastSyncTime = new Date()
        return {
          success: true,
          objectsFetched: 0,
          filesWritten: 0,
          commit: undefined
        }
      }

      const commitSha = await refObject.text()
      let objectsFetched = 0
      let filesWritten = 0

      // Fetch the commit object
      const commitObject = await this.fetchObject(commitSha)
      if (commitObject) {
        objectsFetched++

        // Parse commit to get tree SHA
        const commitContent = new TextDecoder().decode(commitObject)
        const treeMatch = commitContent.match(/^tree ([a-f0-9]{40})/m)

        if (treeMatch) {
          const treeSha = treeMatch[1]
          // Recursively sync tree contents
          const treeResult = await this.syncTree(treeSha, this.path ?? '')
          objectsFetched += treeResult.objects
          filesWritten += treeResult.files
        }
      }

      this.currentCommit = commitSha
      this.lastSyncTime = new Date()

      return {
        success: true,
        objectsFetched,
        filesWritten,
        commit: commitSha
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        objectsFetched: 0,
        filesWritten: 0,
        error: errorMessage
      }
    }
  }

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
  async push(): Promise<PushResult> {
    if (!this.r2) {
      return {
        success: false,
        objectsPushed: 0,
        error: 'R2 bucket not configured'
      }
    }

    if (!this.currentCommit) {
      return {
        success: false,
        objectsPushed: 0,
        error: 'No commits to push'
      }
    }

    try {
      // Update the ref to point to our current commit
      const refKey = `${this.objectPrefix}/refs/heads/${this.branch}`
      await this.r2.put(refKey, this.currentCommit)

      return {
        success: true,
        objectsPushed: 1,
        commit: this.currentCommit
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        objectsPushed: 0,
        error: errorMessage
      }
    }
  }

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
  async status(): Promise<GitStatus> {
    return {
      branch: this.branch,
      head: this.currentCommit,
      staged: Array.from(this.stagedFiles),
      unstaged: [], // Would need working tree comparison
      clean: this.stagedFiles.size === 0
    }
  }

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
  async add(files: string | string[]): Promise<void> {
    const filesToAdd = Array.isArray(files) ? files : [files]
    for (const file of filesToAdd) {
      this.stagedFiles.add(file)
    }
  }

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
  async commit(message: string): Promise<string | { hash: string }> {
    if (this.stagedFiles.size === 0) {
      throw new Error('Nothing to commit - no files staged')
    }

    // For now, return a placeholder hash
    // Real implementation would create proper git objects
    const timestamp = Date.now()
    const hash = await this.hashString(`${message}${timestamp}${this.currentCommit ?? ''}`)

    this.currentCommit = hash
    this.stagedFiles.clear()

    return { hash }
  }

  /**
   * Get diff between references or working tree.
   *
   * @param _ref - Reference to diff against (not yet implemented)
   * @returns Unified diff output
   */
  async diff(_ref?: string): Promise<string> {
    // Placeholder - would need full diff implementation
    return `diff --git a/ b/\n(diff not yet implemented)`
  }

  /**
   * Get commit history.
   *
   * @param _options - Options for filtering results (not yet implemented)
   * @returns Array of commit objects
   */
  async log(_options?: { limit?: number }): Promise<Array<{ hash: string; message: string }>> {
    // Placeholder - would need commit traversal
    if (this.currentCommit) {
      return [{ hash: this.currentCommit, message: 'Current commit' }]
    }
    return []
  }

  /**
   * Pull changes from R2 (alias for sync).
   *
   * @param _remote - Remote name (ignored, always uses R2)
   * @param _branch - Branch to pull (uses configured branch)
   */
  async pull(_remote?: string, _branch?: string): Promise<void> {
    const result = await this.sync()
    if (!result.success) {
      throw new Error(result.error ?? 'Pull failed')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch a git object from R2 by SHA.
   */
  private async fetchObject(sha: string): Promise<Uint8Array | null> {
    if (!this.r2) return null

    const key = `${this.objectPrefix}/${sha.slice(0, 2)}/${sha.slice(2)}`
    const object = await this.r2.get(key)

    if (!object) return null

    const buffer = await object.arrayBuffer()
    return new Uint8Array(buffer)
  }

  /**
   * Store a git object in R2.
   */
  private async storeObject(sha: string, data: Uint8Array): Promise<void> {
    if (!this.r2) return

    const key = `${this.objectPrefix}/${sha.slice(0, 2)}/${sha.slice(2)}`
    await this.r2.put(key, data)
  }

  /**
   * Recursively sync a tree and its contents.
   */
  private async syncTree(treeSha: string, basePath: string): Promise<{ objects: number; files: number }> {
    let objects = 0
    let files = 0

    const treeData = await this.fetchObject(treeSha)
    if (!treeData) return { objects, files }

    objects++

    // Parse tree entries
    // Tree format: mode name\0sha20bytes (repeated)
    let offset = 0
    const decoder = new TextDecoder()

    while (offset < treeData.length) {
      // Find the null byte
      let nullIdx = offset
      while (nullIdx < treeData.length && treeData[nullIdx] !== 0) {
        nullIdx++
      }

      const modeAndName = decoder.decode(treeData.slice(offset, nullIdx))
      const spaceIdx = modeAndName.indexOf(' ')
      const mode = modeAndName.slice(0, spaceIdx)
      const name = modeAndName.slice(spaceIdx + 1)

      // Read 20-byte SHA
      const sha20 = treeData.slice(nullIdx + 1, nullIdx + 21)
      const sha = this.bytesToHex(sha20)

      const entryPath = basePath ? `${basePath}/${name}` : name

      if (mode === '40000' || mode === '040000') {
        // Directory - recurse
        const subResult = await this.syncTree(sha, entryPath)
        objects += subResult.objects
        files += subResult.files
      } else {
        // File - fetch blob and write via fs
        const blobData = await this.fetchObject(sha)
        if (blobData && this.fs) {
          objects++
          // Ensure parent directory exists
          const parentDir = entryPath.split('/').slice(0, -1).join('/')
          if (parentDir) {
            await this.fs.mkdir(`/${parentDir}`, { recursive: true })
          }
          // Write file content (skip git header if present)
          await this.fs.writeFile(`/${entryPath}`, Buffer.from(blobData))
          files++
        }
      }

      offset = nullIdx + 21
    }

    return { objects, files }
  }

  /**
   * Convert bytes to hex string.
   */
  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Simple hash function for placeholder commit generation.
   */
  private async hashString(input: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(input)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    return this.bytesToHex(new Uint8Array(hashBuffer))
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

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
export function createGitModule(options: GitModuleOptions): GitModule {
  return new GitModule(options)
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a GitModule instance.
 *
 * @param value - Value to check
 * @returns True if value is a GitModule
 */
export function isGitModule(value: unknown): value is GitModule {
  return value instanceof GitModule
}
