/**
 * @fileoverview Sync and fork route handlers for GitRepoDO.
 *
 * Domain-specific handlers for repository synchronization operations.
 *
 * @module do/sync-routes
 */

import type { GitRepoDOInstance, RouteContext } from './routes'
import { clone, discoverRefs } from '../ops/clone'

// ============================================================================
// Types
// ============================================================================

/**
 * Sync request payload from webhook or manual trigger.
 */
export interface SyncRequest {
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

// ============================================================================
// Route Handlers
// ============================================================================

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

    const initOpts = body.parent
      ? { ns: body.ns, parent: body.parent }
      : { ns: body.ns }
    await instance.initialize(initOpts)

    return c.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fork failed'
    return c.json({ success: false, error: message }, 500)
  }
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

    // Use cached GitBackend adapter from DO instance (avoids per-request recreation)
    const backend = instance.getGitBackendAdapter()

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
