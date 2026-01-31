/**
 * @fileoverview GitBackend Adapter for Durable Object Storage
 *
 * Provides an adapter that implements the GitBackend interface using
 * simple DO key-value storage. This allows the clone/fetch operations
 * from ops/clone.ts to work with any Durable Object (no SQLite required).
 *
 * @module do/git-backend-adapter
 */

import type { GitBackend, GitObject, Ref, PackedRefs } from '../core/backend'
import type { ObjectType } from '../types/objects'
import { hashObject } from '../utils/hash'

/**
 * Simple storage interface for DO key-value operations.
 * Works with both SQLite and non-SQLite DOs.
 */
interface SimpleStorage {
  get<T>(key: string): Promise<T | undefined>
  get<T>(keys: string[]): Promise<Map<string, T>>
  put<T>(key: string, value: T): Promise<void>
  put<T>(entries: Record<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>
}

/**
 * Stored object format for key-value storage.
 */
interface StoredGitObject {
  type: ObjectType
  data: number[] // Store as number array since Uint8Array doesn't serialize well
}

/**
 * Adapter that implements GitBackend using simple DO key-value storage.
 *
 * This allows the clone() function from ops/clone.ts to work with
 * any Durable Object, regardless of SQLite support.
 *
 * Objects are stored with key prefix "obj:" and refs with "ref:".
 */
export class GitBackendAdapter implements GitBackend {
  private storage: SimpleStorage
  private refsCache: Map<string, string> = new Map()

  constructor(storage: SimpleStorage) {
    this.storage = storage
  }

  /**
   * Read a Git object by SHA.
   */
  async readObject(sha: string): Promise<GitObject | null> {
    const stored = await this.storage.get<StoredGitObject>(`obj:${sha}`)
    if (!stored) return null

    return {
      type: stored.type,
      data: new Uint8Array(stored.data),
    }
  }

  /**
   * Write a Git object and return its SHA.
   */
  async writeObject(obj: GitObject): Promise<string> {
    const sha = await hashObject(obj.type, obj.data)

    const stored: StoredGitObject = {
      type: obj.type,
      data: Array.from(obj.data),
    }

    await this.storage.put(`obj:${sha}`, stored)
    return sha
  }

  /**
   * Check if an object exists.
   */
  async hasObject(sha: string): Promise<boolean> {
    const obj = await this.storage.get(`obj:${sha}`)
    return obj !== undefined
  }

  /**
   * Read a reference by name.
   */
  async readRef(name: string): Promise<string | null> {
    // Check cache first
    if (this.refsCache.has(name)) {
      return this.refsCache.get(name)!
    }

    const sha = await this.storage.get<string>(`ref:${name}`)
    if (sha) {
      this.refsCache.set(name, sha)
    }
    return sha ?? null
  }

  /**
   * Write a reference.
   */
  async writeRef(name: string, sha: string): Promise<void> {
    const normalizedSha = sha.toLowerCase()
    await this.storage.put(`ref:${name}`, normalizedSha)
    this.refsCache.set(name, normalizedSha)
  }

  /**
   * Delete a reference.
   */
  async deleteRef(name: string): Promise<void> {
    await this.storage.delete(`ref:${name}`)
    this.refsCache.delete(name)
  }

  /**
   * List all references, optionally filtered by prefix.
   */
  async listRefs(prefix?: string): Promise<Ref[]> {
    const allRefs = await this.storage.list<string>({ prefix: 'ref:' })
    const result: Ref[] = []

    for (const [key, target] of allRefs) {
      const name = key.slice(4) // Remove 'ref:' prefix
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
   * Write a packfile (not implemented - clone unpacks objects individually).
   */
  async writePackfile(pack: Uint8Array): Promise<void> {
    console.log(`[GitBackendAdapter] writePackfile called with ${pack.length} bytes`)
  }

  /**
   * Get all refs as a plain object (for serialization).
   */
  async getRefsSnapshot(): Promise<Record<string, string>> {
    const refs = await this.listRefs()
    const snapshot: Record<string, string> = {}
    for (const ref of refs) {
      snapshot[ref.name] = ref.target
    }
    return snapshot
  }
}

/**
 * Create a GitBackend adapter for the given DO storage.
 */
export function createGitBackendAdapter(storage: SimpleStorage): GitBackendAdapter {
  return new GitBackendAdapter(storage)
}
