/**
 * @fileoverview Route handlers for GitRepoDO.
 *
 * Extracted HTTP route handlers for cleaner code organization.
 *
 * @module do/routes
 */

import type { Context, Hono } from 'hono'
import type {
  HealthCheckResponse,
  InitializeOptions,
} from './types'
import type { DurableObjectStorage } from './schema'
import type { ParquetStore } from '../storage/parquet-store'
import { EXPORT_COMMITS_SCHEMA } from '../storage/parquet-schemas'
import { clone, discoverRefs } from '../ops/clone'
import { createGitBackendAdapter } from './git-backend-adapter'
import { SqliteObjectStore } from './object-store'
import { SchemaManager } from './schema'
import { parquetWriteBuffer, encodeVariant } from 'hyparquet-writer'
import type { CompressionCodec } from 'hyparquet'
import type {
  GitCommitData,
  GitRefData,
} from '../export/git-parquet'
import * as lz4js from 'lz4js'
import { LfsInterop, type LfsBatchRequest, type LfsBatchResponse } from '../storage/lfs-interop'
import { setupWireRoutes } from './wire-routes'

// ============================================================================
// Sync/Export Types
// ============================================================================

/**
 * Sync request payload from webhook or manual trigger.
 */
interface SyncRequest {
  source: 'webhook' | 'manual'
  ref?: string
  before?: string
  after?: string
  commits?: number
  action?: 'create' | 'delete'
  ref_type?: 'branch' | 'tag'
  repository?: {
    full_name: string
    clone_url?: string
    default_branch?: string
  }
}

/**
 * Export request payload.
 */
interface ExportRequest {
  /** Tables to export (commits, refs, files, or all) */
  tables?: ('commits' | 'refs' | 'files')[]
  /** Force full export even if incremental is available */
  fullExport?: boolean
  /** Repository name (e.g., "owner/repo") - used as fallback if DO ns not set */
  repository?: string
  /** Compression codec: 'LZ4', 'UNCOMPRESSED', or 'SNAPPY' (default) */
  codec?: 'LZ4' | 'LZ4_RAW' | 'UNCOMPRESSED' | 'SNAPPY'
}

/**
 * Export job status.
 */
interface ExportJobStatus {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  tables: string[]
  startedAt: number
  completedAt?: number
  error?: string
  results?: {
    table: string
    rowCount: number
    fileSize: number
    path: string
  }[]
}

// ============================================================================
// Route Handler Types
// ============================================================================

/**
 * GitRepoDO instance interface for route handlers.
 * Provides access to DO properties needed by routes.
 */
export interface GitRepoDOInstance {
  readonly $type: string
  readonly ns: string | undefined
  initialize(options: InitializeOptions): Promise<void>
  /** Capabilities set - accessed via getter in implementation */
  getCapabilities(): Set<string>
  /** Start time for uptime tracking */
  readonly _startTime: number
  /** Access to DO SQLite storage for sync operations */
  getStorage(): DurableObjectStorage
  /** Access to R2 analytics bucket for Parquet export */
  getAnalyticsBucket(): R2Bucket | undefined
  /** Access to ParquetStore for buffered Parquet writes to R2 */
  getParquetStore(): ParquetStore | undefined
  /** Schedule background work that doesn't block the response */
  waitUntil(promise: Promise<unknown>): void
  /** Schedule Parquet compaction to run in a future DO alarm */
  scheduleCompaction(delayMs?: number): boolean
}

/**
 * Route context with typed bindings.
 */
export type RouteContext = Context<{ Bindings: Record<string, unknown> }>

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * Health check route handler.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Health check response
 */
export function handleHealthCheck(
  c: RouteContext,
  instance: GitRepoDOInstance
): Response {
  const response: HealthCheckResponse = {
    status: 'ok',
    ns: instance.ns,
    $type: instance.$type,
    uptime: Date.now() - instance._startTime,
    capabilities: Array.from(instance.getCapabilities()),
  }

  return c.json(response)
}

/**
 * Fork route handler (internal).
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Fork response
 */
export async function handleFork(
  c: RouteContext,
  instance: GitRepoDOInstance
): Promise<Response> {
  try {
    const body = await c.req.json<{
      ns: string
      parent?: string
      branch?: string
    }>()

    await instance.initialize({ ns: body.ns, parent: body.parent })

    return c.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fork failed'
    return c.json({ success: false, error: message }, 500)
  }
}

/**
 * Info route handler - returns DO metadata.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Info response
 */
export function handleInfo(
  c: RouteContext,
  instance: GitRepoDOInstance
): Response {
  return c.json({
    $type: instance.$type,
    ns: instance.ns,
    capabilities: Array.from(instance.getCapabilities()),
  })
}

/**
 * Sync route handler - triggers repository sync.
 *
 * @description
 * Clones or fetches from a remote Git repository using the Smart HTTP protocol.
 * On success, stores all objects in the DO's SQLite storage and returns
 * information about the sync operation.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance with storage access
 * @returns Sync response with clone results
 */
export async function handleSync(
  c: RouteContext,
  instance: GitRepoDOInstance
): Promise<Response> {
  try {
    const body = await c.req.json<SyncRequest>()
    const syncId = crypto.randomUUID()
    const timestamp = Date.now()

    // Get clone URL from request
    const cloneUrl = body.repository?.clone_url
    if (!cloneUrl) {
      return c.json({
        success: false,
        error: 'No clone_url provided in repository data',
        syncId,
        timestamp,
      }, 400)
    }

    // Create GitBackend adapter for DO storage, wired to ParquetStore if available
    const storage = instance.getStorage()
    const backend = createGitBackendAdapter(storage, instance.getParquetStore())

    // First, discover refs to see what's available
    let refAdvertisement
    try {
      refAdvertisement = await discoverRefs(cloneUrl)
    } catch (error) {
      return c.json({
        success: false,
        error: `Failed to discover refs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        syncId,
        timestamp,
      }, 500)
    }

    // If no refs, repo is empty
    if (refAdvertisement.refs.length === 0) {
      return c.json({
        success: true,
        syncId,
        message: 'Repository is empty',
        timestamp,
        objectCount: 0,
        refs: [],
      })
    }

    // Clone the repository
    const result = await clone(cloneUrl, backend, {
      onProgress: (msg) => console.log(`[Sync ${syncId}] ${msg}`),
    })

    if (!result.success) {
      return c.json({
        success: false,
        error: result.error ?? 'Clone failed',
        syncId,
        timestamp,
      }, 500)
    }

    // Flush buffered objects to Parquet on R2 (background)
    // Flush is append-only and fast, so it runs inline via waitUntil.
    // Compaction (merging multiple files) is expensive, so it's deferred to a DO alarm.
    const parquetStore = instance.getParquetStore()
    if (parquetStore) {
      instance.waitUntil(
        parquetStore.flush()
          .then(() => {
            // Schedule compaction to run in a future alarm (not inline)
            instance.scheduleCompaction()
          })
          .catch(err => console.error('Parquet flush failed:', err))
      )
    }

    // Return success with details
    return c.json({
      success: true,
      syncId,
      message: `Synced ${result.objectCount} objects`,
      timestamp,
      objectCount: result.objectCount,
      head: result.head,
      defaultBranch: result.defaultBranch,
      refs: result.refs.map(r => ({ name: r.name, sha: r.sha })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed'
    return c.json({ success: false, error: message }, 500)
  }
}

/**
 * Export route handler - exports git data to Parquet and uploads to R2.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Export result with file paths and row counts
 */
/**
 * LZ4 compressor function for hyparquet-writer.
 * Uses raw LZ4 block compression (no framing) for Parquet LZ4_RAW codec.
 * Uses lz4js.compressBlock which produces raw block format compatible with DuckDB.
 */
function lz4Compress(input: Uint8Array): Uint8Array {
  // LZ4 block format max size: inputSize + inputSize/255 + 16
  const maxSize = input.length + Math.ceil(input.length / 255) + 16
  const output = new Uint8Array(maxSize)
  // compressBlock returns the number of bytes written
  const compressedSize = lz4js.compressBlock(input, output, 0, input.length, lz4js.makeHashTable())
  if (compressedSize === 0) {
    // Data is incompressible, return as-is
    return input
  }
  return output.slice(0, compressedSize)
}

export async function handleExport(
  c: RouteContext,
  instance: GitRepoDOInstance
): Promise<Response> {
  try {
    const body = await c.req.json<ExportRequest>().catch(() => ({} as ExportRequest))
    const tables = body.tables ?? ['commits', 'refs']
    const exportId = crypto.randomUUID()
    const timestamp = Date.now()

    // Get compression codec - default to SNAPPY (built-in support, DuckDB compatible)
    // LZ4_RAW requires proper raw block format which lz4js doesn't produce correctly
    const codec: CompressionCodec = body.codec ?? 'SNAPPY'

    // Build compressors map for LZ4 support (only include if using LZ4)
    const useLZ4 = codec === 'LZ4' || codec === 'LZ4_RAW'
    const lz4Compressors = { LZ4: lz4Compress, LZ4_RAW: lz4Compress }

    // Get repository name from namespace or request body
    const ns = instance.ns
    let repoName = body.repository
    if (ns) {
      // Extract repo name from namespace (e.g., "github:owner/repo" -> "owner/repo")
      repoName = ns.replace(/^github:/, '')
    }
    if (!repoName) {
      return c.json({ success: false, error: 'Repository not specified (provide "repository" in request body)' }, 400)
    }

    // Get R2 bucket
    const bucket = instance.getAnalyticsBucket()
    if (!bucket) {
      return c.json({ success: false, error: 'Analytics bucket not available' }, 500)
    }

    // Initialize storage and schema
    const storage = instance.getStorage()
    const schemaManager = new SchemaManager(storage)
    await schemaManager.initializeSchema()
    const objectStore = new SqliteObjectStore(storage, {
      backend: instance.getParquetStore(),
    })

    const results: ExportJobStatus['results'] = []

    // Export commits to Parquet with VARIANT type for parent_shas
    if (tables.includes('commits')) {
      const commits = await readCommitsFromStorage(objectStore)
      if (commits.length > 0) {
        // Encode parent_shas as VARIANT binary format
        const parentShasData = commits.map(c => {
          const encoded = encodeVariant(c.parentShas)
          return { metadata: encoded.metadata, value: encoded.value }
        })

        const buffer = parquetWriteBuffer({
          codec,
          ...(useLZ4 && { compressors: lz4Compressors }),
          schema: EXPORT_COMMITS_SCHEMA,
          columnData: [
            { name: 'sha', data: commits.map(c => c.sha) },
            { name: 'tree_sha', data: commits.map(c => c.treeSha) },
            { name: 'parent_shas', data: parentShasData },
            { name: 'author_name', data: commits.map(c => c.author.name) },
            { name: 'author_email', data: commits.map(c => c.author.email) },
            { name: 'author_date', data: commits.map(c => BigInt(c.author.date || Date.now())) },
            { name: 'committer_name', data: commits.map(c => c.committer.name) },
            { name: 'committer_email', data: commits.map(c => c.committer.email) },
            { name: 'committer_date', data: commits.map(c => BigInt(c.committer.date || Date.now())) },
            { name: 'message', data: commits.map(c => c.message) },
            { name: 'repository', data: commits.map(() => repoName) },
          ],
        })
        const path = `${repoName}/commits/${exportId}.parquet`
        await bucket.put(path, buffer)
        results.push({
          table: 'commits',
          rowCount: commits.length,
          fileSize: buffer.byteLength,
          path,
        })
      }
    }

    // Export refs to Parquet
    if (tables.includes('refs')) {
      const refs = await readRefsFromStorage(storage)
      if (refs.length > 0) {
        const buffer = parquetWriteBuffer({
          codec,
          ...(useLZ4 && { compressors: lz4Compressors }),
          columnData: [
            { name: 'name', data: refs.map(r => r.name), type: 'STRING' },
            { name: 'target_sha', data: refs.map(r => r.targetSha), type: 'STRING' },
            { name: 'repository', data: refs.map(() => repoName), type: 'STRING' },
          ],
        })
        const path = `${repoName}/refs/${exportId}.parquet`
        await bucket.put(path, buffer)
        results.push({
          table: 'refs',
          rowCount: refs.length,
          fileSize: buffer.byteLength,
          path,
        })
      }
    }

    return c.json({
      success: true,
      exportId,
      repository: repoName,
      codec,
      timestamp,
      results,
      message: `Exported ${results.length} table(s) to Parquet with ${codec} compression`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed'
    console.error('[Export] Error:', error)
    return c.json({ success: false, error: message }, 500)
  }
}

/**
 * Read commits from ObjectStore and convert to GitCommitData format.
 */
async function readCommitsFromStorage(store: SqliteObjectStore): Promise<GitCommitData[]> {
  const commits: GitCommitData[] = []

  // Query all commit objects from the objects table
  // Note: This uses a raw SQL query since ObjectStore doesn't have a listByType method
  const storage = (store as unknown as { storage: DurableObjectStorage }).storage
  if (!storage?.sql) return commits

  try {
    const result = storage.sql.exec(
      "SELECT sha, data FROM objects WHERE type = 'commit' ORDER BY created_at DESC LIMIT 10000"
    )
    const rows = result.toArray() as { sha: string; data: Uint8Array }[]

    for (const row of rows) {
      const commit = parseCommitObject(row.sha, row.data)
      if (commit) {
        commits.push(commit)
      }
    }
  } catch (error) {
    console.error('[Export] Error reading commits:', error)
  }

  return commits
}

/**
 * Parse a raw git commit object into GitCommitData format.
 */
function parseCommitObject(sha: string, data: Uint8Array): GitCommitData | null {
  try {
    const content = new TextDecoder().decode(data)
    const lines = content.split('\n')

    let treeSha = ''
    const parentShas: string[] = []
    let author = { name: '', email: '', date: 0 }
    let committer = { name: '', email: '', date: 0 }
    let messageStartIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === '') {
        messageStartIndex = i + 1
        break
      }

      if (line.startsWith('tree ')) {
        treeSha = line.slice(5)
      } else if (line.startsWith('parent ')) {
        parentShas.push(line.slice(7))
      } else if (line.startsWith('author ')) {
        author = parseAuthorLine(line.slice(7))
      } else if (line.startsWith('committer ')) {
        committer = parseAuthorLine(line.slice(10))
      }
    }

    const message = lines.slice(messageStartIndex).join('\n')

    return {
      sha,
      treeSha,
      parentShas,
      author,
      committer,
      message,
    }
  } catch {
    return null
  }
}

/**
 * Parse author/committer line: "Name <email> timestamp timezone"
 */
function parseAuthorLine(line: string): { name: string; email: string; date: number } {
  const match = line.match(/^(.+) <(.+)> (\d+) ([+-]\d{4})$/)
  if (!match) {
    // Fallback: try simpler pattern without timezone
    const simpleMatch = line.match(/^(.+) <(.+)> (\d+)/)
    if (simpleMatch) {
      const timestamp = parseInt(simpleMatch[3]!, 10)
      return {
        name: simpleMatch[1]!,
        email: simpleMatch[2]!,
        date: isNaN(timestamp) ? 0 : timestamp * 1000,
      }
    }
    return { name: '', email: '', date: 0 }
  }
  const timestamp = parseInt(match[3]!, 10)
  return {
    name: match[1]!,
    email: match[2]!,
    date: isNaN(timestamp) ? 0 : timestamp * 1000, // Convert to milliseconds
  }
}

/**
 * Read refs from storage.
 */
async function readRefsFromStorage(storage: DurableObjectStorage): Promise<GitRefData[]> {
  const refs: GitRefData[] = []

  try {
    const result = storage.sql.exec(
      "SELECT name, target FROM refs WHERE name LIKE 'refs/%' ORDER BY name"
    )
    const rows = result.toArray() as { name: string; target: string }[]

    for (const row of rows) {
      refs.push({
        name: row.name,
        targetSha: row.target,
      })
    }
  } catch (error) {
    console.error('[Export] Error reading refs:', error)
  }

  return refs
}

/**
 * Export status route handler.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Export job status
 */
export async function handleExportStatus(
  c: RouteContext,
  _instance: GitRepoDOInstance
): Promise<Response> {
  const jobId = c.req.param('jobId')

  // In a full implementation, this would look up the job status from storage
  // For now, return a mock status
  return c.json({
    id: jobId,
    status: 'completed',
    message: 'Export job status lookup not yet implemented',
  })
}

/**
 * LFS batch API endpoint handler.
 *
 * @description
 * Handles Git LFS batch API requests for download/upload operations.
 * This endpoint is used by git-lfs clients to check object availability
 * and get signed URLs for direct R2 access.
 *
 * TODO: This implementation requires:
 * 1. R2 bucket binding in the DO environment
 * 2. Access to LfsInterop instance or factory method
 * 3. Proper integration with the ParquetStore or ObjectStore
 * 4. Base URL configuration for generating download/upload hrefs
 *
 * @param c - Hono context
 * @param _instance - GitRepoDO instance
 * @returns LFS batch response
 */
export async function handleLfsBatch(
  c: RouteContext,
  _instance: GitRepoDOInstance
): Promise<Response> {
  try {
    const body = await c.req.json<LfsBatchRequest>()

    // TODO: Implement LFS batch handler
    // This requires:
    // 1. Get R2 bucket from instance or environment
    // 2. Create LfsInterop instance with bucket
    // 3. Call lfsInterop.handleBatchRequest(body)
    // 4. Return LfsBatchResponse

    const response: LfsBatchResponse = {
      transfer: 'basic',
      objects: body.objects.map(obj => ({
        oid: obj.oid,
        size: obj.size,
        error: { code: 501, message: 'Not Implemented' },
      })),
    }

    return c.json(response, 501)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LFS batch request failed'
    return c.json({ error: { code: 500, message } }, 500)
  }
}

// ============================================================================
// Route Setup
// ============================================================================

/**
 * Setup all routes on a Hono router.
 *
 * @param router - Hono router instance
 * @param instance - GitRepoDO instance
 */
export function setupRoutes(
  router: Hono<{ Bindings: Record<string, unknown> }>,
  instance: GitRepoDOInstance
): void {
  // Health check endpoint
  router.get('/health', (c) => handleHealthCheck(c, instance))

  // Info endpoint
  router.get('/info', (c) => handleInfo(c, instance))

  // Fork endpoint (internal)
  router.post('/fork', (c) => handleFork(c, instance))

  // Sync endpoint - trigger repository sync from remote
  router.post('/sync', (c) => handleSync(c, instance))

  // Export endpoints - trigger Parquet export
  router.post('/export', (c) => handleExport(c, instance))
  router.get('/export/status/:jobId', (c) => handleExportStatus(c, instance))

  // LFS batch API endpoint
  router.post('/objects/batch', (c) => handleLfsBatch(c, instance))

  // Git Smart HTTP wire protocol routes
  // These serve git clone/fetch/push over HTTP:
  //   GET  /:namespace/info/refs         - ref advertisement
  //   POST /:namespace/git-upload-pack   - fetch/clone serving
  //   POST /:namespace/git-receive-pack  - push receiving
  setupWireRoutes(router, instance)

  // Catch-all for 404
  router.all('*', (c) => {
    return c.json(
      {
        error: 'Not Found',
        path: new URL(c.req.url).pathname,
      },
      404
    )
  })
}
