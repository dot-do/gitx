/**
 * @fileoverview Core Type Definitions (Platform Agnostic)
 *
 * This module defines the storage abstraction interfaces and common types
 * used throughout the core git implementation. These interfaces are designed
 * to be implemented by platform-specific backends (Node.js fs, Cloudflare R2, etc.)
 *
 * This module has ZERO Cloudflare dependencies and can run in any JavaScript runtime.
 *
 * @module core/types
 */

import type { CommitObject, TreeObject, ObjectType } from './objects'
import type { Ref } from './refs'

// ============================================================================
// Storage Interfaces
// ============================================================================

/**
 * Result of retrieving a Git object from storage.
 */
export interface StoredObjectResult {
  /** The type of Git object */
  type: ObjectType
  /** Raw binary content of the object (excluding Git header) */
  data: Uint8Array
}

/**
 * Basic object store interface for core operations.
 *
 * This is the minimal interface needed for object storage.
 */
export interface BasicObjectStore {
  /**
   * Retrieve a Git object by its SHA-1 hash.
   */
  getObject(sha: string): Promise<StoredObjectResult | null>

  /**
   * Store a Git object and return its SHA-1 hash.
   */
  storeObject(type: ObjectType, data: Uint8Array): Promise<string>

  /**
   * Check if an object exists in the store.
   */
  hasObject(sha: string): Promise<boolean>
}

/**
 * Object store with reference management capabilities.
 */
export interface RefObjectStore extends BasicObjectStore {
  /**
   * Get a reference by its name.
   */
  getRef(refName: string): Promise<string | null>

  /**
   * Set a reference to point to a SHA.
   */
  setRef(refName: string, sha: string): Promise<void>

  /**
   * Delete a reference.
   */
  deleteRef(refName: string): Promise<boolean>

  /**
   * List references with a given prefix.
   */
  listRefs(prefix: string): Promise<Array<{ name: string; sha: string }>>
}

/**
 * Object store specialized for tree diff operations.
 */
export interface TreeDiffObjectStore {
  /**
   * Get a tree object by SHA.
   */
  getTree(sha: string): Promise<TreeObject | null>

  /**
   * Get blob content by SHA.
   */
  getBlob(sha: string): Promise<Uint8Array | null>

  /**
   * Check if an object exists.
   */
  exists(sha: string): Promise<boolean>
}

/**
 * Full-featured object store interface.
 */
export interface ObjectStore extends RefObjectStore, TreeDiffObjectStore {
  // Combined from RefObjectStore and TreeDiffObjectStore
}

/**
 * Interface for retrieving commits from storage.
 */
export interface CommitProvider {
  /**
   * Get a commit by SHA.
   */
  getCommit(sha: string): Promise<CommitObject | null>

  /**
   * Get commits that modify a specific path (optional).
   */
  getCommitsForPath?(path: string): Promise<string[]>

  /**
   * Get the tree for a commit (optional).
   */
  getTree?(commitSha: string): Promise<unknown>
}

/**
 * Minimal commit provider interface.
 */
export interface BasicCommitProvider {
  /**
   * Get a commit by SHA.
   */
  getCommit(sha: string): Promise<CommitObject | null>
}

// ============================================================================
// Segregated Storage Backend Interfaces (ISP)
// ============================================================================

/**
 * Content-Addressable Storage (CAS) backend interface.
 *
 * Provides operations for storing and retrieving Git objects by their SHA-1 hash.
 */
export interface CASBackend {
  putObject(type: ObjectType, content: Uint8Array): Promise<string>
  getObject(sha: string): Promise<StoredObjectResult | null>
  hasObject(sha: string): Promise<boolean>
  deleteObject(sha: string): Promise<void>
}

/**
 * Reference storage backend interface.
 *
 * Provides operations for managing Git references (branches, tags, HEAD).
 */
export interface RefBackend {
  getRef(name: string): Promise<Ref | null>
  setRef(name: string, ref: Ref): Promise<void>
  deleteRef(name: string): Promise<void>
  listRefs(prefix?: string): Promise<Ref[]>
}

/**
 * File storage backend interface.
 *
 * Provides raw file and directory operations for Git repository files.
 */
export interface FileBackend {
  readFile(path: string): Promise<Uint8Array | null>
  writeFile(path: string, content: Uint8Array): Promise<void>
  deleteFile(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  readdir(path: string): Promise<string[]>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
}

/**
 * Full storage backend interface (backward-compatible).
 *
 * Combines CASBackend, RefBackend, and FileBackend. Existing code using
 * StorageBackend continues to work unchanged.
 */
export interface StorageBackend extends CASBackend, RefBackend, FileBackend {}

// ============================================================================
// Hash Function Interface
// ============================================================================

/**
 * Interface for SHA-1 hashing.
 *
 * This allows different runtime implementations (Web Crypto, Node.js crypto, etc.)
 */
export interface HashFunction {
  /**
   * Compute SHA-1 hash of data.
   * @returns 40-character lowercase hexadecimal string
   */
  sha1(data: Uint8Array): Promise<string>

  /**
   * Compute SHA-1 hash synchronously (if available).
   */
  sha1Sync?(data: Uint8Array): string
}

// ============================================================================
// Compression Interface
// ============================================================================

/**
 * Interface for zlib compression/decompression.
 *
 * This allows different runtime implementations (pako, Node.js zlib, etc.)
 */
export interface CompressionProvider {
  /**
   * Deflate (compress) data.
   */
  deflate(data: Uint8Array): Promise<Uint8Array>

  /**
   * Inflate (decompress) data.
   */
  inflate(data: Uint8Array): Promise<Uint8Array>

  /**
   * Synchronous deflate (if available).
   */
  deflateSync?(data: Uint8Array): Uint8Array

  /**
   * Synchronous inflate (if available).
   */
  inflateSync?(data: Uint8Array): Uint8Array
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Standard validation result.
 */
export interface ValidationResult {
  isValid: boolean
  error?: string
}

/**
 * Operation result with optional error.
 */
export interface OperationResult<T = void> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Options for walk operations.
 */
export interface WalkOptions {
  /** Maximum depth to traverse (-1 for unlimited) */
  maxDepth?: number
  /** Filter function for entries */
  filter?: (entry: { path: string; type: string }) => boolean
}

/**
 * File entry for tree walking.
 */
export interface FileEntry {
  /** Path relative to repository root */
  path: string
  /** File mode string */
  mode: string
  /** SHA-1 of the blob */
  sha: string
  /** Object type ('blob' or 'tree') */
  type: 'blob' | 'tree'
}

/**
 * Diff entry between two trees.
 */
export interface DiffEntry {
  /** Path relative to repository root */
  path: string
  /** Old file SHA (null if added) */
  oldSha: string | null
  /** New file SHA (null if deleted) */
  newSha: string | null
  /** Old file mode (null if added) */
  oldMode: string | null
  /** New file mode (null if deleted) */
  newMode: string | null
  /** Type of change */
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied'
  /** For renames/copies: similarity percentage */
  similarity?: number
  /** For renames/copies: old path */
  oldPath?: string
}
