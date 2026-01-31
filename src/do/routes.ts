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
 * Export route handler - triggers Parquet export.
 *
 * @param c - Hono context
 * @param _instance - GitRepoDO instance (unused, for future implementation)
 * @returns Export job response
 */
export async function handleExport(
  c: RouteContext,
  _instance: GitRepoDOInstance
): Promise<Response> {
  try {
    const body = await c.req.json<ExportRequest>().catch(() => ({} as ExportRequest))
    const tables = body.tables ?? ['commits', 'refs', 'files']

    // Create export job
    const jobId = crypto.randomUUID()

    // In a full implementation, this would:
    // 1. Queue the export job
    // 2. Read commit/ref/file data from storage
    // 3. Write to Parquet using GitParquetExporter
    // 4. Upload to ANALYTICS_BUCKET
    // 5. Update Iceberg catalog

    // For now, return the job ID for status polling
    return c.json({
      success: true,
      jobId,
      message: `Export job created for tables: ${tables.join(', ')}`,
      statusUrl: `/export/status/${jobId}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed'
    return c.json({ success: false, error: message }, 500)
  }
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
