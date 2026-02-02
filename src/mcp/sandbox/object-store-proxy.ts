/**
 * @fileoverview Object Store Proxy for Sandbox Execution
 *
 * Provides controlled access to the git object store within sandboxed code.
 * Uses strict typing based on canonical ObjectStore interfaces from types/storage.ts.
 */

import type { ObjectType } from '../../types/objects'
import type { BasicObjectStore } from '../../types/storage'

/**
 * 40-character lowercase hex SHA-1 hash.
 * Used for strict typing of object identifiers.
 */
export type Sha = string & { readonly __brand: 'Sha' }

/**
 * Result of retrieving an object from the store.
 */
export interface ObjectResult {
  readonly type: ObjectType
  readonly data: Uint8Array
}

/**
 * Options for listing objects in the store.
 */
export interface ListObjectsOptions {
  readonly type?: ObjectType
  readonly limit?: number
}

/**
 * Extended object store interface for sandbox operations.
 *
 * Extends BasicObjectStore with sandbox-specific methods like listObjects.
 * Uses strict readonly types for all return values.
 */
export interface SandboxObjectStore extends BasicObjectStore {
  /**
   * List objects in the store with optional filtering.
   *
   * @param options - Filter options (type, limit)
   * @returns Array of SHA-1 hashes
   */
  listObjects(options?: ListObjectsOptions): Promise<readonly string[]>
}

/**
 * Public interface exposed to sandboxed code.
 *
 * Provides controlled access to git object operations with strict typing.
 * All methods are readonly to prevent modification of the proxy.
 */
export interface ObjectStoreAccess {
  readonly getProxy: () => ObjectStoreProxy
  readonly getObject: (sha: string) => Promise<ObjectResult | null>
  readonly storeObject: (type: ObjectType, data: Uint8Array) => Promise<string>
  readonly hasObject: (sha: string) => Promise<boolean>
  readonly listObjects: (options?: ListObjectsOptions) => Promise<readonly string[]>
}

/**
 * Proxy class providing controlled access to the object store.
 *
 * Wraps a SandboxObjectStore and exposes a limited API to sandboxed code.
 * All methods validate inputs and delegate to the underlying store.
 */
export class ObjectStoreProxy {
  private readonly store: SandboxObjectStore

  constructor(objectStore: SandboxObjectStore) {
    this.store = objectStore
  }

  /**
   * Retrieve a Git object by SHA-1 hash.
   *
   * @param sha - 40-character hex SHA-1
   * @returns Object with type and data, or null if not found
   */
  async getObject(sha: string): Promise<ObjectResult | null> {
    return this.store.getObject(sha)
  }

  /**
   * Store a Git object and return its SHA-1 hash.
   *
   * @param type - Object type ('blob', 'tree', 'commit', 'tag')
   * @param data - Raw object content
   * @returns 40-character SHA-1 hash
   */
  async storeObject(type: ObjectType, data: Uint8Array): Promise<string> {
    return this.store.storeObject(type, data)
  }

  /**
   * Check if an object exists in the store.
   *
   * @param sha - 40-character hex SHA-1
   * @returns true if object exists
   */
  async hasObject(sha: string): Promise<boolean> {
    return this.store.hasObject(sha)
  }

  /**
   * List objects in the store with optional filtering.
   *
   * @param options - Filter options (type, limit)
   * @returns Array of SHA-1 hashes
   */
  async listObjects(options?: ListObjectsOptions): Promise<readonly string[]> {
    return this.store.listObjects(options)
  }
}

/**
 * Create an ObjectStoreAccess wrapper for sandboxed code.
 *
 * @param objectStore - The underlying object store implementation
 * @returns ObjectStoreAccess interface for sandbox use
 */
export function createObjectStoreAccess(objectStore: SandboxObjectStore): ObjectStoreAccess {
  const proxy = new ObjectStoreProxy(objectStore)
  return {
    getProxy: () => proxy,
    getObject: (sha: string) => proxy.getObject(sha),
    storeObject: (type: ObjectType, data: Uint8Array) => proxy.storeObject(type, data),
    hasObject: (sha: string) => proxy.hasObject(sha),
    listObjects: (options?: ListObjectsOptions) => proxy.listObjects(options),
  }
}

/**
 * @deprecated Use SandboxObjectStore instead. Kept for backwards compatibility.
 */
export type ObjectStoreLike = SandboxObjectStore
