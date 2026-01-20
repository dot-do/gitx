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
