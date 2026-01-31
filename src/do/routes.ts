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
import { clone, discoverRefs } from '../ops/clone'
import { createGitBackendAdapter } from './git-backend-adapter'
import { ObjectStore } from './object-store'
import { SchemaManager } from './schema'
import type {
  GitCommitData,
  GitRefData,
} from '../export/git-parquet'

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

    // Create GitBackend adapter for DO storage
    const storage = instance.getStorage()
    const backend = createGitBackendAdapter(storage)

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
export async function handleExport(
  c: RouteContext,
  instance: GitRepoDOInstance
): Promise<Response> {
  try {
    const body = await c.req.json<ExportRequest>().catch(() => ({} as ExportRequest))
    const tables = body.tables ?? ['commits', 'refs']
    const exportId = crypto.randomUUID()
    const timestamp = Date.now()

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
    const objectStore = new ObjectStore(storage)

    const results: ExportJobStatus['results'] = []

    // Export commits as NDJSON (newline-delimited JSON)
    // NDJSON is readable by DuckDB, Spark, Pandas, etc.
    if (tables.includes('commits')) {
      const commits = await readCommitsFromStorage(objectStore)
      if (commits.length > 0) {
        const ndjson = commits.map(c => JSON.stringify({
          sha: c.sha,
          tree_sha: c.treeSha,
          parent_shas: c.parentShas,
          author_name: c.author.name,
          author_email: c.author.email,
          author_date: c.author.date,
          committer_name: c.committer.name,
          committer_email: c.committer.email,
          committer_date: c.committer.date,
          message: c.message,
          repository: repoName,
        })).join('\n')
        const buffer = new TextEncoder().encode(ndjson)
        const path = `${repoName}/commits/${exportId}.ndjson`
        await bucket.put(path, buffer)
        results.push({
          table: 'commits',
          rowCount: commits.length,
          fileSize: buffer.length,
          path,
        })
      }
    }

    // Export refs as NDJSON
    if (tables.includes('refs')) {
      const refs = await readRefsFromStorage(storage)
      if (refs.length > 0) {
        const ndjson = refs.map(r => JSON.stringify({
          name: r.name,
          target_sha: r.targetSha,
          repository: repoName,
        })).join('\n')
        const buffer = new TextEncoder().encode(ndjson)
        const path = `${repoName}/refs/${exportId}.ndjson`
        await bucket.put(path, buffer)
        results.push({
          table: 'refs',
          rowCount: refs.length,
          fileSize: buffer.length,
          path,
        })
      }
    }

    return c.json({
      success: true,
      exportId,
      repository: repoName,
      timestamp,
      results,
      message: `Exported ${results.length} table(s) to NDJSON`,
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
async function readCommitsFromStorage(store: ObjectStore): Promise<GitCommitData[]> {
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
    return { name: '', email: '', date: 0 }
  }
  return {
    name: match[1]!,
    email: match[2]!,
    date: parseInt(match[3]!, 10) * 1000, // Convert to milliseconds
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
