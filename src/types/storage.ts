/**
 * Storage Interface Types
 *
 * Canonical interfaces for object storage and commit providers.
 * These are the single source of truth - all modules should import from here.
 */

import type { CommitObject, TreeObject } from './objects'

// ============================================================================
// Object Storage
// ============================================================================

/**
 * Interface for Git object storage operations.
 *
 * This is the canonical ObjectStore interface that combines all required
 * methods from various modules. Implementations should provide all methods.
 *
 * Used by: commit.ts, tag.ts, tree-builder.ts, tree-diff.ts
 */
export interface ObjectStore {
  // Core object operations (from commit.ts, tag.ts, tree-builder.ts)
  /** Get an object by SHA */
  getObject(sha: string): Promise<{ type: string; data: Uint8Array } | null>
  /** Store an object and return its SHA */
  storeObject(type: string, data: Uint8Array): Promise<string>
  /** Check if an object exists */
  hasObject(sha: string): Promise<boolean>

  // Ref operations (from tag.ts)
  /** Get a ref by name */
  getRef(refName: string): Promise<string | null>
  /** Set a ref to point to a SHA */
  setRef(refName: string, sha: string): Promise<void>
  /** Delete a ref */
  deleteRef(refName: string): Promise<boolean>
  /** List refs with a given prefix */
  listRefs(prefix: string): Promise<Array<{ name: string; sha: string }>>

  // Typed object accessors (from tree-diff.ts)
  /** Get a tree object by SHA */
  getTree(sha: string): Promise<TreeObject | null>
  /** Get blob content by SHA */
  getBlob(sha: string): Promise<Uint8Array | null>
  /** Check if an object exists (alias for hasObject) */
  exists(sha: string): Promise<boolean>
}

/**
 * Minimal ObjectStore interface for basic operations.
 *
 * Use this when only core object operations are needed,
 * without ref management or typed accessors.
 */
export interface BasicObjectStore {
  /** Get an object by SHA */
  getObject(sha: string): Promise<{ type: string; data: Uint8Array } | null>
  /** Store an object and return its SHA */
  storeObject(type: string, data: Uint8Array): Promise<string>
  /** Check if an object exists */
  hasObject(sha: string): Promise<boolean>
}

/**
 * ObjectStore with ref management capabilities.
 *
 * Extends BasicObjectStore with ref operations needed for tag management.
 */
export interface RefObjectStore extends BasicObjectStore {
  /** Get a ref by name */
  getRef(refName: string): Promise<string | null>
  /** Set a ref to point to a SHA */
  setRef(refName: string, sha: string): Promise<void>
  /** Delete a ref */
  deleteRef(refName: string): Promise<boolean>
  /** List refs with a given prefix */
  listRefs(prefix: string): Promise<Array<{ name: string; sha: string }>>
}

/**
 * ObjectStore for tree diff operations.
 *
 * Provides typed accessors for tree and blob objects.
 */
export interface TreeDiffObjectStore {
  /** Get a tree object by SHA */
  getTree(sha: string): Promise<TreeObject | null>
  /** Get blob content by SHA */
  getBlob(sha: string): Promise<Uint8Array | null>
  /** Check if an object exists */
  exists(sha: string): Promise<boolean>
}

// ============================================================================
// Commit Provider
// ============================================================================

/**
 * Interface for retrieving commits from storage.
 *
 * This is the canonical CommitProvider interface that combines all required
 * methods from various modules. The base method is required; others are optional.
 *
 * Used by: commit-traversal.ts, merge-base.ts
 */
export interface CommitProvider {
  /** Get a commit by SHA */
  getCommit(sha: string): Promise<CommitObject | null>
  /** Get commits that modify a path (optional, for path filtering) */
  getCommitsForPath?(path: string): Promise<string[]>
  /** Get the tree for a commit (optional, for tree operations) */
  getTree?(commitSha: string): Promise<unknown>
}

/**
 * Minimal CommitProvider interface for basic operations.
 *
 * Use this when only the core getCommit method is needed.
 */
export interface BasicCommitProvider {
  /** Get a commit by SHA */
  getCommit(sha: string): Promise<CommitObject | null>
}
