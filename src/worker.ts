/**
 * @fileoverview gitx-do Worker Entry Point
 *
 * Production entry point for the gitx-do Cloudflare Worker.
 * Exports the Durable Object classes and provides a default fetch handler
 * that routes requests to the appropriate DO.
 *
 * @module gitx.do/worker
 */

import { Hono } from 'hono'
import { GitRepoDO, GitRepoDOSQL } from './do/GitRepoDO'
import { GitHubWebhookHandler } from './webhooks'

// ============================================================================
// Environment Interface
// ============================================================================

interface Env {
  // Durable Object namespaces
  GITX: DurableObjectNamespace

  // R2 buckets
  R2: R2Bucket
  PACK_STORAGE: R2Bucket
  ANALYTICS_BUCKET?: R2Bucket

  // Service bindings
  FSX?: Fetcher
  BASHX?: Fetcher

  // Secrets
  GITHUB_WEBHOOK_SECRET: string
}

// ============================================================================
// Router Setup
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'gitx-do',
    timestamp: new Date().toISOString(),
  })
})

// GitHub webhook handler
app.post('/webhooks/github', async (c) => {
  const handler = new GitHubWebhookHandler({
    GITX: c.env.GITX,
    GITHUB_WEBHOOK_SECRET: c.env.GITHUB_WEBHOOK_SECRET,
  })
  return handler.handle(c.req.raw)
})

// Route to GitRepoDO by namespace
// Pattern: /:namespace/* - routes to a DO instance keyed by namespace
app.all('/:namespace/*', async (c) => {
  const namespace = c.req.param('namespace')
  const id = c.env.GITX.idFromName(namespace)
  const stub = c.env.GITX.get(id)

  // Strip the namespace prefix from the path
  // Note: namespace is URL-decoded by Hono, so we need to URL-encode it
  // to match the pathname which is still URL-encoded
  const url = new URL(c.req.url)
  const encodedNamespace = encodeURIComponent(namespace)
  const newPath = url.pathname.replace(`/${encodedNamespace}`, '') || '/'
  const newUrl = new URL(newPath, url.origin)
  newUrl.search = url.search

  return stub.fetch(new Request(newUrl.toString(), c.req.raw))
})

// Default route - root health check
app.get('/', (c) => {
  return c.json({
    name: 'gitx-do',
    version: '0.1.0',
    description: 'Git implementation for Cloudflare Durable Objects',
    endpoints: {
      health: '/health',
      webhooks: '/webhooks/github',
      repo: '/:namespace/*',
    },
  })
})

// ============================================================================
// Exports
// ============================================================================

export default app

// Export Durable Object classes for Wrangler
// GitRepoDO: Original non-SQLite version (deprecated)
// GitRepoDOSQL: SQLite-backed version with ~50x lower storage costs
export { GitRepoDO, GitRepoDOSQL }
