/**
 * @fileoverview Webhook Module Exports
 *
 * Provides GitHub webhook handling for GitX.
 *
 * @module webhooks
 */

export { GitHubWebhookHandler, createGitHubWebhookHandler } from './github'
export {
  verifyGitHubSignature,
  createGitHubSignature,
  timingSafeEqual,
  constantTimeEqual,
} from './signature'
export type {
  // Payload types
  GitHubEventPayload,
  GitHubEventType,
  PushEventPayload,
  PingEventPayload,
  CreateEventPayload,
  DeleteEventPayload,
  // Common types
  GitHubUser,
  GitHubRepository,
  GitHubCommit,
  // Handler types
  WebhookHandlerResult,
  WebhookEnv,
} from './types'
