/**
 * @fileoverview Git Smart HTTP Wire Protocol Routes for DO Router
 *
 * Bridges the wire protocol handlers (smart-http.ts, upload-pack.ts, receive-pack.ts)
 * to the DO's Hono router. Implements the RepositoryProvider interface by adapting
 * the DO's ObjectStore and SQLite-backed ref storage.
 *
 * @module do/wire-routes
 */

import type { Hono } from 'hono'
import type { GitRepoDOInstance, RouteContext } from './routes'
import type {
  RepositoryProvider,
  SmartHTTPRequest,
  ServerCapabilities,
  RefUpdateCommand as SmartHTTPRefUpdateCommand,
  ReceivePackResult as SmartHTTPReceivePackResult,
  GitRef,
} from '../wire/smart-http'
import {
  handleInfoRefs,
  handleUploadPack,
  handleReceivePack,
} from '../wire/smart-http'
import { SqliteObjectStore } from './object-store'
import { SchemaManager, type DurableObjectStorage } from './schema'
import type { ObjectType } from '../types/objects'
import { PushTransaction } from '../storage/push-transaction'
import type {
  UploadPackObjectStore,
  Ref as UploadPackRef,
} from '../wire/upload-pack'
import { generatePackfile } from '../wire/upload-pack'

// ============================================================================
// Default Server Capabilities
// ============================================================================

const DEFAULT_SERVER_CAPABILITIES: ServerCapabilities = {
  sideBand64k: true,
  thinPack: true,
  ofsDelta: false,
  shallow: true,
  noProgress: true,
  includeTag: true,
  reportStatus: true,
  deleteRefs: true,
  atomic: true,
  agent: 'gitx.do/1.0',
}

// ============================================================================
// Repository Provider Adapter
// ============================================================================

/**
 * Adapts the DO's ObjectStore and SQLite storage to the RepositoryProvider
 * interface expected by the Smart HTTP wire protocol handlers.
 */
class DORepositoryProvider implements RepositoryProvider {
  private storage: DurableObjectStorage
  private objectStore: SqliteObjectStore
  private schemaManager: SchemaManager
  private schemaInitialized = false

  constructor(storage: DurableObjectStorage) {
    this.storage = storage
    this.schemaManager = new SchemaManager(storage)
    this.objectStore = new SqliteObjectStore(storage)
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaInitialized) {
      await this.schemaManager.initializeSchema()
      this.schemaInitialized = true
    }
  }

  async getRefs(): Promise<GitRef[]> {
    await this.ensureSchema()
    try {
      const result = this.storage.sql.exec(
        "SELECT name, target FROM refs ORDER BY name"
      )
      const rows = result.toArray() as { name: string; target: string }[]
      return rows.map((row) => ({
        sha: row.target,
        name: row.name,
      }))
    } catch (error) {
      console.error('[WireProtocol] Error reading refs:', error)
      return []
    }
  }

  async exists(): Promise<boolean> {
    // Repository exists if schema can be initialized.
    // A more precise check would test for any refs or objects.
    await this.ensureSchema()
    return true
  }

  async hasPermission(_service: 'git-upload-pack' | 'git-receive-pack'): Promise<boolean> {
    // TODO: Implement proper authentication/authorization.
    // For now, allow all operations. In production this should check
    // bearer tokens, OAuth, or other auth mechanisms.
    return true
  }

  async uploadPack(
    wants: string[],
    haves: string[],
    _capabilities: string[]
  ): Promise<Uint8Array> {
    await this.ensureSchema()

    // Create an adapter that satisfies the upload-pack ObjectStore interface
    const store = this.createUploadPackStore()

    const result = await generatePackfile(store, wants, haves)
    return result.packfile
  }

  async receivePack(
    packData: Uint8Array,
    commands: SmartHTTPRefUpdateCommand[]
  ): Promise<SmartHTTPReceivePackResult> {
    await this.ensureSchema()

    // Use PushTransaction for atomic object-write + ref-update semantics.
    // This ensures refs are never updated without objects being present.
    const tx = new PushTransaction(this.storage, this.objectStore)

    // Phase 1: Unpack objects from packfile into the transaction buffer
    if (packData.length > 0) {
      try {
        await this.unpackPackfileIntoTransaction(packData, tx)
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unpack failed'
        console.error('[WireProtocol] Unpack error:', msg)
        // If unpack fails, all ref updates fail — no objects written, no refs changed
        return {
          success: false,
          refResults: commands.map((cmd) => ({
            refName: cmd.refName,
            success: false,
            error: `unpack error: ${msg}`,
          })),
        }
      }
    }

    // Phases 2-4: Flush objects to storage, then update refs atomically.
    // PushTransaction handles: flush -> ref CAS -> orphan identification.
    const txResult = await tx.execute(commands)

    return {
      success: txResult.success,
      refResults: txResult.refResults,
    }
  }

  /**
   * Unpack a packfile into a PushTransaction's buffer instead of
   * writing directly to the object store.
   *
   * This is the transactional variant of unpackPackfile. Objects are
   * buffered in the transaction and only flushed to storage when
   * tx.execute() is called, ensuring atomicity with ref updates.
   */
  private async unpackPackfileIntoTransaction(
    packData: Uint8Array,
    tx: PushTransaction
  ): Promise<void> {
    if (packData.length < 32) {
      console.warn('[WireProtocol] unpackPackfileIntoTransaction: packfile too short, skipping')
      return
    }

    // Use the full packfile unpacking implementation
    const { unpackPackfile } = await import('../pack/unpack')

    // Create an external base resolver that looks up objects in the existing store
    // This supports receiving thin packs where delta bases may already exist
    const resolveExternalBase = async (sha: string) => {
      const obj = await this.objectStore.getObject(sha)
      if (!obj) return null
      return { type: obj.type, data: obj.data }
    }

    const result = await unpackPackfile(packData, {
      resolveExternalBase,
      verifyChecksum: true,
      maxDeltaDepth: 50,
    })

    console.log(
      `[WireProtocol] unpackPackfileIntoTransaction: version=${result.version}, objects=${result.objectCount}, bytes=${packData.length}`
    )

    // Buffer each unpacked object in the transaction
    for (const obj of result.objects) {
      tx.bufferObject(obj.sha, obj.type, obj.data)
    }

    console.log(
      `[WireProtocol] unpackPackfileIntoTransaction: buffered ${result.objects.length} objects`
    )
  }

  /**
   * Creates an adapter satisfying the upload-pack ObjectStore interface,
   * backed by the DO's SQLite object store.
   */
  private createUploadPackStore(): UploadPackObjectStore {
    const storage = this.storage
    const objectStore = this.objectStore

    return {
      async getObject(
        sha: string
      ): Promise<{ type: ObjectType; data: Uint8Array } | null> {
        const obj = await objectStore.getObject(sha)
        if (!obj) return null
        return { type: obj.type, data: obj.data }
      },

      async hasObject(sha: string): Promise<boolean> {
        return objectStore.hasObject(sha)
      },

      async getCommitParents(sha: string): Promise<string[]> {
        const obj = await objectStore.getObject(sha)
        if (!obj || obj.type !== 'commit') return []

        const text = new TextDecoder().decode(obj.data)
        const parents: string[] = []
        const regex = /^parent ([0-9a-f]{40})/gm
        let match
        while ((match = regex.exec(text)) !== null) {
          parents.push(match[1]!)
        }
        return parents
      },

      async getRefs(): Promise<UploadPackRef[]> {
        try {
          const result = storage.sql.exec(
            'SELECT name, target FROM refs ORDER BY name'
          )
          const rows = result.toArray() as { name: string; target: string }[]
          return rows.map((row) => ({
            name: row.name,
            sha: row.target,
          }))
        } catch {
          return []
        }
      },

      async getReachableObjects(
        sha: string,
        _depth?: number
      ): Promise<string[]> {
        // Walk the object graph starting from the given SHA.
        // This is a simplified BFS traversal.
        const visited = new Set<string>()
        const queue = [sha]

        while (queue.length > 0) {
          const current = queue.shift()!
          if (visited.has(current)) continue
          visited.add(current)

          const obj = await objectStore.getObject(current)
          if (!obj) continue

          if (obj.type === 'commit') {
            // Extract tree SHA
            const text = new TextDecoder().decode(obj.data)
            const treeMatch = text.match(/^tree ([0-9a-f]{40})/m)
            if (treeMatch) {
              queue.push(treeMatch[1]!)
            }
            // Extract parent SHAs
            const parentRegex = /^parent ([0-9a-f]{40})/gm
            let parentMatch
            while ((parentMatch = parentRegex.exec(text)) !== null) {
              queue.push(parentMatch[1]!)
            }
          } else if (obj.type === 'tree') {
            // Parse binary tree format to extract entry SHAs
            const entries = parseTreeData(obj.data)
            for (const entry of entries) {
              queue.push(entry.sha)
            }
          } else if (obj.type === 'tag') {
            const text = new TextDecoder().decode(obj.data)
            const objMatch = text.match(/^object ([0-9a-f]{40})/m)
            if (objMatch) {
              queue.push(objMatch[1]!)
            }
          }
          // blobs are leaf nodes, nothing to traverse
        }

        return Array.from(visited)
      },
    }
  }
}

// ============================================================================
// Tree Parsing Helper
// ============================================================================

/**
 * Parse binary tree data to extract entry SHAs.
 * Git tree format: <mode> <name>\0<20-byte SHA>
 */
function parseTreeData(data: Uint8Array): { mode: string; name: string; sha: string }[] {
  const entries: { mode: string; name: string; sha: string }[] = []
  let offset = 0

  while (offset < data.length) {
    // Find the space after mode
    const spaceIdx = data.indexOf(0x20, offset)
    if (spaceIdx === -1) break

    const mode = new TextDecoder().decode(data.slice(offset, spaceIdx))

    // Find the null byte after name
    const nullIdx = data.indexOf(0x00, spaceIdx + 1)
    if (nullIdx === -1) break

    const name = new TextDecoder().decode(data.slice(spaceIdx + 1, nullIdx))

    // Next 20 bytes are the binary SHA
    const shaBytes = data.slice(nullIdx + 1, nullIdx + 21)
    if (shaBytes.length < 20) break

    const sha = Array.from(shaBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    entries.push({ mode, name, sha })
    offset = nullIdx + 21
  }

  return entries
}

// ============================================================================
// Hono Request to SmartHTTPRequest Converter
// ============================================================================

/**
 * Convert a Hono request context into a SmartHTTPRequest.
 */
async function toSmartHTTPRequest(
  c: RouteContext,
  path: string,
  repository: string
): Promise<SmartHTTPRequest> {
  const url = new URL(c.req.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    query[key] = value
  }

  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value
  })

  const request: SmartHTTPRequest = {
    method: c.req.method as 'GET' | 'POST',
    path,
    query,
    headers,
    repository,
  }

  if (c.req.method === 'POST') {
    const arrayBuffer = await c.req.arrayBuffer()
    request.body = new Uint8Array(arrayBuffer)
  }

  return request
}

/**
 * Convert a SmartHTTPResponse into a Web Response.
 */
function toWebResponse(smartResponse: {
  status: number
  statusText: string
  headers: Record<string, string>
  body: Uint8Array
}): Response {
  return new Response(smartResponse.body as unknown as BodyInit, {
    status: smartResponse.status,
    statusText: smartResponse.statusText,
    headers: smartResponse.headers,
  })
}

// ============================================================================
// Route Setup
// ============================================================================

/**
 * Register Git Smart HTTP protocol routes on the Hono router.
 *
 * Adds three routes:
 * - GET  /:namespace/info/refs      - ref advertisement
 * - POST /:namespace/git-upload-pack - fetch/clone serving
 * - POST /:namespace/git-receive-pack - push receiving
 *
 * @param router - Hono router instance
 * @param instance - GitRepoDO instance
 */
export function setupWireRoutes(
  router: Hono<{ Bindings: Record<string, unknown> }>,
  instance: GitRepoDOInstance
): void {
  // GET /:namespace/info/refs?service=git-upload-pack|git-receive-pack
  router.get('/:namespace/info/refs', async (c) => {
    try {
      const namespace = c.req.param('namespace')
      const storage = instance.getStorage()
      const provider = new DORepositoryProvider(storage)

      const request = await toSmartHTTPRequest(c, '/info/refs', namespace)
      const response = await handleInfoRefs(
        request,
        provider,
        DEFAULT_SERVER_CAPABILITIES
      )

      return toWebResponse(response)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal error'
      console.error('[WireProtocol] info/refs error:', error)
      return c.text(msg, 500)
    }
  })

  // POST /:namespace/git-upload-pack
  router.post('/:namespace/git-upload-pack', async (c) => {
    try {
      const namespace = c.req.param('namespace')
      const storage = instance.getStorage()
      const provider = new DORepositoryProvider(storage)

      const request = await toSmartHTTPRequest(
        c,
        '/git-upload-pack',
        namespace
      )
      const response = await handleUploadPack(request, provider)

      return toWebResponse(response)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal error'
      console.error('[WireProtocol] git-upload-pack error:', error)
      return c.text(msg, 500)
    }
  })

  // POST /:namespace/git-receive-pack
  router.post('/:namespace/git-receive-pack', async (c) => {
    try {
      const namespace = c.req.param('namespace')
      const storage = instance.getStorage()
      const provider = new DORepositoryProvider(storage)

      const request = await toSmartHTTPRequest(
        c,
        '/git-receive-pack',
        namespace
      )
      const response = await handleReceivePack(request, provider)

      return toWebResponse(response)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal error'
      console.error('[WireProtocol] git-receive-pack error:', error)
      return c.text(msg, 500)
    }
  })
}
