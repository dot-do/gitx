/**
 * @fileoverview GitHub Webhook Handler
 *
 * Handles incoming GitHub webhook requests, verifies signatures,
 * and routes events to appropriate handlers.
 *
 * @module webhooks/github
 */

import { verifyGitHubSignature } from './signature'
import {
  isGitHubEventType,
  isPushEventPayload,
  isPingEventPayload,
  isCreateEventPayload,
  isDeleteEventPayload,
} from './types'
import type {
  WebhookEnv,
  WebhookHandlerResult,
  GitHubEventType,
  PushEventPayload,
  PingEventPayload,
  CreateEventPayload,
  DeleteEventPayload,
} from './types'

// ============================================================================
// Constants
// ============================================================================

const GITHUB_EVENT_HEADER = 'x-github-event'
const GITHUB_SIGNATURE_HEADER = 'x-hub-signature-256'
const GITHUB_DELIVERY_HEADER = 'x-github-delivery'

// ============================================================================
// GitHub Webhook Handler
// ============================================================================

/**
 * GitHub webhook handler for GitX.
 *
 * @description
 * Handles incoming GitHub webhooks, verifies signatures, and routes
 * push events to trigger repository synchronization.
 *
 * @example
 * ```typescript
 * const handler = new GitHubWebhookHandler(env)
 * const response = await handler.handle(request)
 * ```
 */
export class GitHubWebhookHandler {
  private env: WebhookEnv

  constructor(env: WebhookEnv) {
    this.env = env
  }

  /**
   * Handles an incoming GitHub webhook request.
   *
   * @param request - The incoming Request object
   * @returns Response with handling result
   */
  async handle(request: Request): Promise<Response> {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return this.errorResponse(405, 'Method not allowed')
    }

    // Get required headers
    const rawEventType = request.headers.get(GITHUB_EVENT_HEADER)
    const signature = request.headers.get(GITHUB_SIGNATURE_HEADER)
    const deliveryId = request.headers.get(GITHUB_DELIVERY_HEADER)

    if (!rawEventType) {
      return this.errorResponse(400, 'Missing x-github-event header')
    }

    // Validate event type against known set
    if (!isGitHubEventType(rawEventType)) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Ignoring unsupported event: ${rawEventType}`,
          event: rawEventType,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const eventType: GitHubEventType = rawEventType

    // Read payload
    const payload = await request.text()

    // Verify signature
    const isValid = await verifyGitHubSignature(
      payload,
      signature,
      this.env.GITHUB_WEBHOOK_SECRET
    )

    if (!isValid) {
      return this.errorResponse(401, 'Invalid signature')
    }

    // Parse payload
    let data: unknown
    try {
      data = JSON.parse(payload)
    } catch {
      return this.errorResponse(400, 'Invalid JSON payload')
    }

    // Route to event handler with payload shape validation
    let result: WebhookHandlerResult

    switch (eventType) {
      case 'push':
        if (!isPushEventPayload(data)) {
          return this.errorResponse(400, 'Invalid push event payload')
        }
        result = await this.handlePush(data, deliveryId)
        break
      case 'ping':
        if (!isPingEventPayload(data)) {
          return this.errorResponse(400, 'Invalid ping event payload')
        }
        result = await this.handlePing(data)
        break
      case 'create':
        if (!isCreateEventPayload(data)) {
          return this.errorResponse(400, 'Invalid create event payload')
        }
        result = await this.handleCreate(data)
        break
      case 'delete':
        if (!isDeleteEventPayload(data)) {
          return this.errorResponse(400, 'Invalid delete event payload')
        }
        result = await this.handleDelete(data)
        break
    }

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Handles a push event.
   * Triggers repository sync to update local state.
   */
  private async handlePush(
    payload: PushEventPayload,
    deliveryId: string | null
  ): Promise<WebhookHandlerResult> {
    const { repository, ref, before, after, commits } = payload

    // Build the namespace key for the DO
    // Format: github:owner/repo
    const namespace = `github:${repository.full_name}`

    try {
      // Get the DO stub
      const id = this.env.GITX.idFromName(namespace)
      const stub = this.env.GITX.get(id)

      // Trigger sync with push context
      const syncResponse = await stub.fetch(
        new Request('https://internal/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Delivery': deliveryId ?? '',
          },
          body: JSON.stringify({
            source: 'webhook',
            ref,
            before,
            after,
            commits: commits.length,
            repository: {
              full_name: repository.full_name,
              clone_url: repository.clone_url,
              default_branch: repository.default_branch,
            },
          }),
        })
      )

      if (!syncResponse.ok) {
        const error = await syncResponse.text()
        return {
          success: false,
          message: 'Sync failed',
          event: 'push',
          repository: repository.full_name,
          ref,
          error,
        }
      }

      return {
        success: true,
        message: `Synced ${commits.length} commit(s) to ${ref}`,
        event: 'push',
        repository: repository.full_name,
        ref,
      }
    } catch (error) {
      return {
        success: false,
        message: 'Failed to trigger sync',
        event: 'push',
        repository: repository.full_name,
        ref,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Handles a ping event.
   * Responds to initial webhook configuration.
   */
  private async handlePing(payload: PingEventPayload): Promise<WebhookHandlerResult> {
    const result: WebhookHandlerResult = {
      success: true,
      message: `Pong! Webhook configured for ${payload.repository?.full_name ?? 'unknown'}`,
      event: 'ping',
    }
    if (payload.repository?.full_name) {
      result.repository = payload.repository.full_name
    }
    return result
  }

  /**
   * Handles a create event.
   * Logs branch/tag creation.
   */
  private async handleCreate(payload: CreateEventPayload): Promise<WebhookHandlerResult> {
    const { repository, ref, ref_type } = payload
    const namespace = `github:${repository.full_name}`

    try {
      const id = this.env.GITX.idFromName(namespace)
      const stub = this.env.GITX.get(id)

      await stub.fetch(
        new Request('https://internal/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'webhook',
            action: 'create',
            ref,
            ref_type,
            repository: {
              full_name: repository.full_name,
              clone_url: repository.clone_url,
            },
          }),
        })
      )

      return {
        success: true,
        message: `${ref_type} ${ref} created`,
        event: 'create',
        repository: repository.full_name,
        ref,
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to process ${ref_type} creation`,
        event: 'create',
        repository: repository.full_name,
        ref,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Handles a delete event.
   * Logs branch/tag deletion.
   */
  private async handleDelete(payload: DeleteEventPayload): Promise<WebhookHandlerResult> {
    const { repository, ref, ref_type } = payload
    const namespace = `github:${repository.full_name}`

    try {
      const id = this.env.GITX.idFromName(namespace)
      const stub = this.env.GITX.get(id)

      await stub.fetch(
        new Request('https://internal/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'webhook',
            action: 'delete',
            ref,
            ref_type,
            repository: {
              full_name: repository.full_name,
            },
          }),
        })
      )

      return {
        success: true,
        message: `${ref_type} ${ref} deleted`,
        event: 'delete',
        repository: repository.full_name,
        ref,
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to process ${ref_type} deletion`,
        event: 'delete',
        repository: repository.full_name,
        ref,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Creates an error response.
   */
  private errorResponse(status: number, message: string): Response {
    return new Response(
      JSON.stringify({ success: false, error: message }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

/**
 * Creates a webhook handler function for use with Hono.
 *
 * @param env - Environment bindings
 * @returns Async request handler function
 */
export function createGitHubWebhookHandler(env: WebhookEnv) {
  const handler = new GitHubWebhookHandler(env)
  return (request: Request) => handler.handle(request)
}
