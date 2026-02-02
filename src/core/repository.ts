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

import type { GitBackend, Ref } from './backend'
import type { ObjectType, CommitObject, TreeEntry, Author } from '../types/objects'
import { GitCommit, parseTreeEntries } from '../../core/objects'

const decoder = new TextDecoder()

// ============================================================================
// Repository Interface
// ============================================================================

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
  // ─────────────────────────────────────────────────────────────────────────
  // Object operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retrieve a Git object by its SHA-1 hash.
   *
   * @param sha - 40-character hexadecimal SHA-1 hash
   * @returns The object with type and data, or null if not found
   */
  getObject(sha: string): Promise<{ type: ObjectType; data: Uint8Array } | null>

  /**
   * Store a Git object and return its SHA-1 hash.
   *
   * @param type - Object type ('blob', 'tree', 'commit', 'tag')
   * @param data - Raw object content (without Git header)
   * @returns The 40-character SHA-1 hash of the stored object
   */
  storeObject(type: ObjectType, data: Uint8Array): Promise<string>

  /**
   * Check if an object exists in the repository.
   *
   * @param sha - 40-character hexadecimal SHA-1 hash
   * @returns True if the object exists
   */
  hasObject(sha: string): Promise<boolean>

  // ─────────────────────────────────────────────────────────────────────────
  // Ref operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a reference by its name.
   *
   * @param name - Full ref name (e.g., 'refs/heads/main', 'HEAD')
   * @returns The SHA-1 hash the ref points to, or null if not found
   */
  getRef(name: string): Promise<string | null>

  /**
   * Set a reference to point to a SHA.
   *
   * @param name - Full ref name (e.g., 'refs/heads/main')
   * @param target - 40-character SHA-1 hash to point to
   */
  setRef(name: string, target: string): Promise<void>

  /**
   * Delete a reference.
   *
   * @param name - Full ref name to delete
   * @returns True if deleted, false if ref did not exist
   */
  deleteRef(name: string): Promise<boolean>

  /**
   * List references matching an optional prefix.
   *
   * @param prefix - Optional prefix to filter refs (e.g., 'refs/heads/')
   * @returns Array of Ref objects with name and target
   */
  listRefs(prefix?: string): Promise<Ref[]>

  // ─────────────────────────────────────────────────────────────────────────
  // High-level operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a parsed commit object by SHA.
   *
   * @param sha - 40-character SHA-1 hash of the commit
   * @returns Parsed CommitObject or null if not found or not a commit
   */
  getCommit(sha: string): Promise<CommitObject | null>

  /**
   * Get parsed tree entries by SHA.
   *
   * @param sha - 40-character SHA-1 hash of the tree
   * @returns Array of tree entries, or empty array if not found
   */
  getTree(sha: string): Promise<TreeEntry[]>

  /**
   * Walk commit history starting from a ref or SHA.
   *
   * @param ref - Ref name or commit SHA to start from
   * @param limit - Maximum number of commits to return (default: 20)
   * @returns Array of parsed CommitObjects in reverse chronological order
   */
  log(ref: string, limit?: number): Promise<CommitObject[]>
}

// ============================================================================
// GitBackendRepository Implementation
// ============================================================================

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
export class GitBackendRepository implements Repository {
  constructor(private readonly backend: GitBackend) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Object operations
  // ─────────────────────────────────────────────────────────────────────────

  async getObject(sha: string): Promise<{ type: ObjectType; data: Uint8Array } | null> {
    const obj = await this.backend.readObject(sha)
    if (!obj) return null
    return { type: obj.type, data: obj.data }
  }

  async storeObject(type: ObjectType, data: Uint8Array): Promise<string> {
    return this.backend.writeObject({ type, data })
  }

  async hasObject(sha: string): Promise<boolean> {
    return this.backend.hasObject(sha)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ref operations
  // ─────────────────────────────────────────────────────────────────────────

  async getRef(name: string): Promise<string | null> {
    return this.backend.readRef(name)
  }

  async setRef(name: string, target: string): Promise<void> {
    return this.backend.writeRef(name, target)
  }

  async deleteRef(name: string): Promise<boolean> {
    const existing = await this.backend.readRef(name)
    if (existing === null) return false
    await this.backend.deleteRef(name)
    return true
  }

  async listRefs(prefix?: string): Promise<Ref[]> {
    return this.backend.listRefs(prefix)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // High-level operations
  // ─────────────────────────────────────────────────────────────────────────

  async getCommit(sha: string): Promise<CommitObject | null> {
    const obj = await this.backend.readObject(sha)
    if (!obj || obj.type !== 'commit') return null
    try {
      const content = decoder.decode(obj.data)
      const gitCommit = GitCommit.fromContent(content)
      return {
        type: 'commit',
        data: obj.data,
        tree: gitCommit.tree,
        parents: [...(gitCommit.parents || [])],
        author: gitCommit.author as Author,
        committer: gitCommit.committer as Author,
        message: gitCommit.message,
      }
    } catch {
      return null
    }
  }

  async getTree(sha: string): Promise<TreeEntry[]> {
    const obj = await this.backend.readObject(sha)
    if (!obj || obj.type !== 'tree') return []
    try {
      return parseTreeEntries(obj.data)
    } catch {
      return []
    }
  }

  async log(ref: string, limit: number = 20): Promise<CommitObject[]> {
    // Resolve ref to SHA if it's a ref name
    let sha: string | null = ref
    if (!/^[0-9a-f]{40}$/i.test(ref)) {
      sha = await this.backend.readRef(ref)
      if (!sha) return []
    }

    const commits: CommitObject[] = []
    const queue: string[] = [sha!]
    const visited = new Set<string>()

    while (queue.length > 0 && commits.length < limit) {
      const currentSha = queue.shift()!
      if (visited.has(currentSha)) continue
      visited.add(currentSha)

      const commit = await this.getCommit(currentSha)
      if (!commit) continue

      commits.push(commit)

      // Add parents to queue for traversal
      for (const parentSha of commit.parents) {
        if (!visited.has(parentSha)) {
          queue.push(parentSha)
        }
      }
    }

    return commits
  }
}
