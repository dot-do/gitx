/**
 * @fileoverview Storage and Provider Interfaces for @dotdo/gitx
 *
 * These interfaces define the storage abstraction that allows the core
 * git implementation to work with any storage backend (memory, file system,
 * R2, KV, etc.) without any platform-specific dependencies.
 *
 * Implementations of these interfaces are provided by platform-specific
 * packages like gitx.do for Cloudflare Workers.
 */

import type { ObjectType, TreeEntry } from './objects/types'

// =============================================================================
// Object Storage Interfaces
// =============================================================================

/**
 * Result from reading a stored Git object
 */
export interface StoredObjectResult {
  type: ObjectType
  data: Uint8Array
  size: number
}

/**
 * Basic object storage - minimal interface for reading/writing git objects
 */
export interface BasicObjectStore {
  /**
   * Check if an object exists
   */
  has(sha: string): Promise<boolean>

  /**
   * Read an object by SHA
   */
  read(sha: string): Promise<StoredObjectResult | null>

  /**
   * Write an object and return its SHA
   */
  write(type: ObjectType, data: Uint8Array): Promise<string>
}

/**
 * Extended object store with ref management
 */
export interface RefObjectStore extends BasicObjectStore {
  /**
   * Get ref value (SHA or symbolic ref)
   */
  getRef(name: string): Promise<string | null>

  /**
   * Set ref value
   */
  setRef(name: string, value: string): Promise<void>

  /**
   * Delete a ref
   */
  deleteRef(name: string): Promise<boolean>

  /**
   * List all refs matching a prefix
   */
  listRefs(prefix?: string): Promise<Array<{ name: string; sha: string }>>
}

/**
 * Full object store interface with tree diff support
 */
export interface ObjectStore extends RefObjectStore {
  /**
   * Read a tree object's entries
   */
  readTree(sha: string): Promise<TreeEntry[]>

  /**
   * Read a blob's content
   */
  readBlob(sha: string): Promise<Uint8Array>

  /**
   * Get the SHA that HEAD points to
   */
  resolveHead(): Promise<string | null>
}

// =============================================================================
// Commit Provider Interface
// =============================================================================

/**
 * Minimal commit data for traversal
 */
export interface CommitInfo {
  sha: string
  treeSha: string
  parentShas: string[]
  message: string
  author: {
    name: string
    email: string
    timestamp: number
  }
}

/**
 * Provider for accessing commits during traversal operations
 */
export interface CommitProvider {
  /**
   * Get commit info by SHA
   */
  getCommit(sha: string): Promise<CommitInfo | null>

  /**
   * Get multiple commits
   */
  getCommits(shas: string[]): Promise<Map<string, CommitInfo>>
}

// =============================================================================
// Storage Backend Interface
// =============================================================================

/**
 * Low-level storage backend for raw data
 */
export interface StorageBackend {
  /**
   * Read raw bytes from storage
   */
  get(key: string): Promise<Uint8Array | null>

  /**
   * Write raw bytes to storage
   */
  put(key: string, value: Uint8Array): Promise<void>

  /**
   * Delete from storage
   */
  delete(key: string): Promise<boolean>

  /**
   * List keys with prefix
   */
  list(prefix: string): Promise<string[]>
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Hash function signature for SHA-1 calculation
 */
export type HashFunction = (data: Uint8Array) => Promise<string>

/**
 * Compression provider for loose objects
 */
export interface CompressionProvider {
  compress(data: Uint8Array): Uint8Array | Promise<Uint8Array>
  decompress(data: Uint8Array): Uint8Array | Promise<Uint8Array>
}

/**
 * Result of validation operations
 */
export interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * Generic operation result
 */
export interface OperationResult<T = void> {
  success: boolean
  data?: T
  error?: string
}
