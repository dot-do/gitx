/**
 * @fileoverview GitHub Webhook Handler
 *
 * Handles incoming GitHub webhook requests, verifies signatures,
 * and routes events to appropriate handlers.
 *
 * @module webhooks/github
 */
import type { WebhookEnv } from './types';
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
export declare class GitHubWebhookHandler {
    private env;
    constructor(env: WebhookEnv);
    /**
     * Handles an incoming GitHub webhook request.
     *
     * @param request - The incoming Request object
     * @returns Response with handling result
     */
    handle(request: Request): Promise<Response>;
    /**
     * Handles a push event.
     * Triggers repository sync to update local state.
     */
    private handlePush;
    /**
     * Handles a ping event.
     * Responds to initial webhook configuration.
     */
    private handlePing;
    /**
     * Handles a create event.
     * Logs branch/tag creation.
     */
    private handleCreate;
    /**
     * Handles a delete event.
     * Logs branch/tag deletion.
     */
    private handleDelete;
    /**
     * Creates an error response.
     */
    private errorResponse;
}
/**
 * Creates a webhook handler function for use with Hono.
 *
 * @param env - Environment bindings
 * @returns Async request handler function
 */
export declare function createGitHubWebhookHandler(env: WebhookEnv): (request: Request) => Promise<Response>;
//# sourceMappingURL=github.d.ts.map