/**
 * @fileoverview GitBackend Adapter for Durable Object Storage
 *
 * Provides an adapter that implements the GitBackend interface using
 * the DO's ObjectStore (SQLite) for storage. This allows the clone/fetch
 * operations from ops/clone.ts to work with Durable Object storage.
 *
 * @module do/git-backend-adapter
 */

import type { GitBackend, GitObject, Ref, PackedRefs } from '../core/backend'
import type { ObjectType } from '../types/objects'
import { ObjectStore } from './object-store'
import { SchemaManager, type DurableObjectStorage } from './schema'

/**
 * Adapter that wraps ObjectStore to implement GitBackend interface.
 *
 * This allows the clone() function from ops/clone.ts to work with
 * Durable Object SQLite storage for efficient, cost-effective storage.
 */
export class GitBackendAdapter implements GitBackend {
  private store: ObjectStore
  private schemaManager: SchemaManager
  private refs: Map<string, string> = new Map()
  private schemaInitialized = false

  constructor(storage: DurableObjectStorage) {
    this.schemaManager = new SchemaManager(storage)
    this.store = new ObjectStore(storage)
  }

  /**
   * Ensure schema is initialized before any operations.
   */
  private async ensureSchema(): Promise<void> {
    if (!this.schemaInitialized) {
      await this.schemaManager.initializeSchema()
      this.schemaInitialized = true
    }
  }

  /**
   * Read a Git object by SHA.
   */
  async readObject(sha: string): Promise<GitObject | null> {
    await this.ensureSchema()
    const obj = await this.store.getObject(sha)
    if (!obj) return null

    return {
      type: obj.type as ObjectType,
      data: obj.data,
    }
  }

  /**
   * Write a Git object and return its SHA.
   */
  async writeObject(obj: GitObject): Promise<string> {
    await this.ensureSchema()
    return this.store.putObject(obj.type, obj.data)
  }

  /**
   * Check if an object exists.
   */
  async hasObject(sha: string): Promise<boolean> {
    await this.ensureSchema()
    return this.store.hasObject(sha)
  }

  /**
   * Read a reference by name.
   */
  async readRef(name: string): Promise<string | null> {
    return this.refs.get(name) ?? null
  }

  /**
   * Write a reference.
   */
  async writeRef(name: string, sha: string): Promise<void> {
    this.refs.set(name, sha.toLowerCase())
  }

  /**
   * Delete a reference.
   */
  async deleteRef(name: string): Promise<void> {
    this.refs.delete(name)
  }

  /**
   * List all references, optionally filtered by prefix.
   */
  async listRefs(prefix?: string): Promise<Ref[]> {
    const result: Ref[] = []
    for (const [name, target] of this.refs) {
      if (!prefix || name.startsWith(prefix)) {
        result.push({ name, target })
      }
    }
    return result
  }

  /**
   * Read packed refs (returns empty since we don't use packed refs in DO).
   */
  async readPackedRefs(): Promise<PackedRefs> {
    return { refs: new Map() }
  }

  /**
   * Write a packfile (delegates to ObjectStore).
   */
  async writePackfile(pack: Uint8Array): Promise<void> {
    // For now, we don't need to implement packfile writing
    // since clone() unpacks objects individually
    console.log(`[GitBackendAdapter] writePackfile called with ${pack.length} bytes`)
  }

  /**
   * Get all refs as a plain object (for serialization).
   */
  getRefsSnapshot(): Record<string, string> {
    const snapshot: Record<string, string> = {}
    for (const [name, target] of this.refs) {
      snapshot[name] = target
    }
    return snapshot
  }
}

/**
 * Create a GitBackend adapter for the given DO storage.
 */
export function createGitBackendAdapter(storage: DurableObjectStorage): GitBackendAdapter {
  return new GitBackendAdapter(storage)
}
