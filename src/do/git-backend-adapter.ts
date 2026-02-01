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
import { SqliteObjectStore, type CASBackend } from './object-store'
import { SchemaManager, type DurableObjectStorage } from './schema'
import { parsePackHeader, decodeTypeAndSize, PackObjectType, packObjectTypeToString } from '../pack/format'
import { applyDelta } from '../pack/delta'
import pako from 'pako'

/**
 * Adapter that wraps ObjectStore to implement GitBackend interface.
 *
 * This allows the clone() function from ops/clone.ts to work with
 * Durable Object SQLite storage for efficient, cost-effective storage.
 */
export class GitBackendAdapter implements GitBackend {
  private store: SqliteObjectStore
  private schemaManager: SchemaManager
  private storage: DurableObjectStorage
  /** Read-through cache for refs. Null means cache is cold and must be loaded from SQLite. */
  private refCache: Map<string, string> | null = null
  private schemaInitialized = false

  constructor(storage: DurableObjectStorage, backend?: CASBackend) {
    this.storage = storage
    this.schemaManager = new SchemaManager(storage)
    this.store = new SqliteObjectStore(storage, backend ? { backend } : undefined)
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
   * Load all refs from SQLite into the in-memory cache.
   * Called lazily on first read if the cache is cold.
   */
  private async loadRefCache(): Promise<Map<string, string>> {
    if (this.refCache !== null) return this.refCache
    await this.ensureSchema()
    const result = this.storage.sql.exec('SELECT name, target FROM refs')
    const rows = result.toArray() as { name: string; target: string }[]
    this.refCache = new Map()
    for (const row of rows) {
      this.refCache.set(row.name, row.target)
    }
    return this.refCache
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
   * Uses the read-through cache; falls back to SQLite on cache miss.
   */
  async readRef(name: string): Promise<string | null> {
    const cache = await this.loadRefCache()
    return cache.get(name) ?? null
  }

  /**
   * Write a reference.
   * Writes to SQLite (source of truth) and updates the cache.
   */
  async writeRef(name: string, sha: string): Promise<void> {
    const target = sha.toLowerCase()
    // Write to SQLite first (source of truth)
    await this.ensureSchema()
    this.storage.sql.exec(
      'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
      name,
      target,
      'sha',
      Date.now()
    )
    // Update cache if populated (don't load cache just for a write)
    if (this.refCache !== null) {
      this.refCache.set(name, target)
    }
  }

  /**
   * Delete a reference.
   * Deletes from SQLite (source of truth) and invalidates the cache entry.
   */
  async deleteRef(name: string): Promise<void> {
    await this.ensureSchema()
    this.storage.sql.exec('DELETE FROM refs WHERE name = ?', name)
    // Update cache if populated
    if (this.refCache !== null) {
      this.refCache.delete(name)
    }
  }

  /**
   * List all references, optionally filtered by prefix.
   * Uses the read-through cache; falls back to SQLite on cache miss.
   */
  async listRefs(prefix?: string): Promise<Ref[]> {
    const cache = await this.loadRefCache()
    const result: Ref[] = []
    for (const [name, target] of cache) {
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
   * Write a packfile by unpacking individual objects and storing them
   * via the ObjectStore.
   *
   * Parses the packfile header, iterates through each object entry,
   * decompresses its data, resolves deltas against their base objects,
   * and stores the resulting objects.
   */
  async writePackfile(pack: Uint8Array): Promise<void> {
    await this.ensureSchema()

    // Parse and validate the 12-byte pack header
    const header = parsePackHeader(pack)
    const objectCount = header.objectCount

    // We need to track objects by their pack offset for OFS_DELTA resolution
    const objectsByOffset = new Map<number, { type: ObjectType; data: Uint8Array; sha: string }>()

    let offset = 12 // Skip past the 12-byte header

    for (let i = 0; i < objectCount; i++) {
      const entryOffset = offset

      // Decode the type+size header for this object
      const { type, bytesRead: headerBytes } = decodeTypeAndSize(pack, offset)
      offset += headerBytes

      let baseType: ObjectType
      let data: Uint8Array

      if (type === PackObjectType.OBJ_OFS_DELTA) {
        // OFS_DELTA: read the negative offset to the base object
        // The offset is encoded as a variable-length integer where each byte
        // contributes 7 bits, but with a different encoding than standard varint:
        // the value is built by shifting left 7 and adding the next byte + 1
        let byte = pack[offset++]!
        let baseOffset = byte & 0x7f
        while (byte & 0x80) {
          byte = pack[offset++]!
          baseOffset = ((baseOffset + 1) << 7) | (byte & 0x7f)
        }

        // Decompress the delta data and advance past compressed bytes
        const decompressed = pako.inflate(pack.subarray(offset))
        offset = advancePastZlibStream(pack, offset)

        // Resolve the base object
        const absoluteBaseOffset = entryOffset - baseOffset
        const baseObj = objectsByOffset.get(absoluteBaseOffset)
        if (!baseObj) {
          throw new Error(
            `[GitBackendAdapter] writePackfile: OFS_DELTA base object not found at offset ${absoluteBaseOffset}`
          )
        }

        baseType = baseObj.type
        data = applyDelta(baseObj.data, decompressed)
      } else if (type === PackObjectType.OBJ_REF_DELTA) {
        // REF_DELTA: read the 20-byte base object SHA
        const baseShaBytes = pack.subarray(offset, offset + 20)
        offset += 20
        const baseSha = Array.from(baseShaBytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')

        // Decompress the delta data
        const decompressed = pako.inflate(pack.subarray(offset))
        offset = advancePastZlibStream(pack, offset)

        // Resolve the base object - check local cache first, then ObjectStore
        const cachedBase = [...objectsByOffset.values()].find((o) => o.sha === baseSha)
        let baseData: Uint8Array
        if (cachedBase) {
          baseType = cachedBase.type
          baseData = cachedBase.data
        } else {
          const storedBase = await this.store.getObject(baseSha)
          if (!storedBase) {
            throw new Error(
              `[GitBackendAdapter] writePackfile: REF_DELTA base object not found: ${baseSha}`
            )
          }
          baseType = storedBase.type as ObjectType
          baseData = storedBase.data
        }

        data = applyDelta(baseData, decompressed)
      } else {
        // Regular object (commit, tree, blob, tag)
        baseType = packObjectTypeToString(type) as ObjectType
        data = pako.inflate(pack.subarray(offset))
        offset = advancePastZlibStream(pack, offset)
      }

      // Store the object (baseType is set in every branch above)
      const sha = await this.store.putObject(baseType, data)

      // Cache by offset for potential OFS_DELTA resolution by later entries
      objectsByOffset.set(entryOffset, { type: baseType, data, sha })
    }
  }

  /**
   * Get all refs as a plain object (for serialization).
   * Reads from SQLite to ensure freshness.
   */
  getRefsSnapshot(): Record<string, string> {
    // Synchronously read from SQLite to guarantee freshness
    if (this.schemaInitialized) {
      const result = this.storage.sql.exec('SELECT name, target FROM refs')
      const rows = result.toArray() as { name: string; target: string }[]
      const snapshot: Record<string, string> = {}
      for (const row of rows) {
        snapshot[row.name] = row.target
      }
      return snapshot
    }
    // Fallback to cache if schema not yet initialized
    const snapshot: Record<string, string> = {}
    if (this.refCache) {
      for (const [name, target] of this.refCache) {
        snapshot[name] = target
      }
    }
    return snapshot
  }

  /**
   * Invalidate the ref cache.
   *
   * Call this method when refs have been written to SQLite directly
   * (e.g. by ParquetRefStore or other components), so that subsequent
   * reads will reload from SQLite.
   */
  invalidateRefCache(): void {
    this.refCache = null
  }
}

/**
 * Advance past a zlib-compressed stream in a buffer.
 *
 * Uses pako's Inflate in streaming mode to determine exactly how many
 * compressed bytes were consumed, since zlib streams are variable-length
 * and we need to know where the next object starts.
 *
 * @param data - The buffer containing the zlib stream
 * @param offset - The starting offset of the zlib stream
 * @returns The offset immediately after the end of the zlib stream
 */
function advancePastZlibStream(data: Uint8Array, offset: number): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inflator: any = new pako.Inflate()
  // Feed data in small chunks to track consumption accurately
  const chunkSize = 1024
  let consumed = 0
  const remaining = data.subarray(offset)

  for (let i = 0; i < remaining.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, remaining.length)
    const chunk = remaining.subarray(i, end)
    const isLast = end >= remaining.length
    inflator.push(chunk, isLast)

    if (inflator.err) {
      throw new Error(`[GitBackendAdapter] zlib decompression error: ${inflator.msg}`)
    }

    if (inflator.ended) {
      // pako tracks how many bytes remain unconsumed in strm.avail_in
      consumed = end - (inflator.strm?.avail_in ?? 0)
      break
    }
  }

  if (!inflator.ended) {
    throw new Error('[GitBackendAdapter] zlib stream did not terminate within the available data')
  }

  return offset + consumed
}

/**
 * Create a GitBackend adapter for the given DO storage.
 */
export function createGitBackendAdapter(storage: DurableObjectStorage, backend?: CASBackend): GitBackendAdapter {
  return new GitBackendAdapter(storage, backend)
}
