/**
 * @fileoverview GitHub Webhook Payload Types
 *
 * Type definitions for GitHub webhook events, focused on push events
 * for triggering repository synchronization.
 *
 * @module webhooks/types
 */

// ============================================================================
// Common Types
// ============================================================================

/**
 * GitHub user information in webhook payloads.
 */
export interface GitHubUser {
  name: string
  email: string
  username?: string
}

/**
 * GitHub repository information.
 */
export interface GitHubRepository {
  id: number
  node_id: string
  name: string
  full_name: string
  private: boolean
  owner: {
    login: string
    id: number
    node_id: string
    avatar_url: string
    type: 'User' | 'Organization'
  }
  html_url: string
  clone_url: string
  git_url: string
  ssh_url: string
  default_branch: string
}

/**
 * GitHub commit information in push payload.
 */
export interface GitHubCommit {
  id: string
  tree_id: string
  distinct: boolean
  message: string
  timestamp: string
  url: string
  author: GitHubUser
  committer: GitHubUser
  added: string[]
  removed: string[]
  modified: string[]
}

// ============================================================================
// Push Event
// ============================================================================

/**
 * GitHub push event payload.
 * Sent when commits are pushed to a repository.
 *
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#push
 */
export interface PushEventPayload {
  ref: string
  before: string
  after: string
  created: boolean
  deleted: boolean
  forced: boolean
  base_ref: string | null
  compare: string
  commits: GitHubCommit[]
  head_commit: GitHubCommit | null
  repository: GitHubRepository
  pusher: GitHubUser
  sender: {
    login: string
    id: number
    node_id: string
    avatar_url: string
    type: string
  }
}

// ============================================================================
// Ping Event
// ============================================================================

/**
 * GitHub ping event payload.
 * Sent when a webhook is first configured.
 */
export interface PingEventPayload {
  zen: string
  hook_id: number
  hook: {
    type: string
    id: number
    name: string
    active: boolean
    events: string[]
    config: {
      content_type: string
      url: string
      insecure_ssl: string
    }
  }
  repository?: GitHubRepository
  sender: {
    login: string
    id: number
  }
}

// ============================================================================
// Create/Delete Events
// ============================================================================

/**
 * GitHub create event payload.
 * Sent when a branch or tag is created.
 */
export interface CreateEventPayload {
  ref: string
  ref_type: 'branch' | 'tag'
  master_branch: string
  description: string | null
  pusher_type: string
  repository: GitHubRepository
  sender: {
    login: string
    id: number
  }
}

/**
 * GitHub delete event payload.
 * Sent when a branch or tag is deleted.
 */
export interface DeleteEventPayload {
  ref: string
  ref_type: 'branch' | 'tag'
  pusher_type: string
  repository: GitHubRepository
  sender: {
    login: string
    id: number
  }
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * All supported GitHub webhook event payloads.
 */
export type GitHubEventPayload =
  | PushEventPayload
  | PingEventPayload
  | CreateEventPayload
  | DeleteEventPayload

/**
 * Supported GitHub webhook event types.
 */
export type GitHubEventType = 'push' | 'ping' | 'create' | 'delete'

/**
 * Set of known GitHub event types for runtime validation.
 */
export const GITHUB_EVENT_TYPES: ReadonlySet<string> = new Set<GitHubEventType>([
  'push',
  'ping',
  'create',
  'delete',
])

/**
 * Checks if a string is a valid GitHubEventType.
 */
export function isGitHubEventType(value: string): value is GitHubEventType {
  return GITHUB_EVENT_TYPES.has(value)
}

// ============================================================================
// Payload Validators
// ============================================================================

/**
 * Checks if an object has the basic shape of a GitHub repository.
 * Validates required fields used by webhook handlers.
 */
function hasGitHubRepository(value: unknown): value is { repository: GitHubRepository } {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (typeof obj['repository'] !== 'object' || obj['repository'] === null) return false
  const repo = obj['repository'] as Record<string, unknown>
  return (
    typeof repo['full_name'] === 'string' &&
    typeof repo['clone_url'] === 'string'
  )
}

/**
 * Validates that unknown data has the required shape of a PushEventPayload.
 * Does not exhaustively check all fields, but ensures fields accessed by handlers exist.
 */
export function isPushEventPayload(value: unknown): value is PushEventPayload {
  if (!hasGitHubRepository(value)) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj['ref'] === 'string' &&
    typeof obj['before'] === 'string' &&
    typeof obj['after'] === 'string' &&
    Array.isArray(obj['commits'])
  )
}

/**
 * Validates that unknown data has the required shape of a PingEventPayload.
 */
export function isPingEventPayload(value: unknown): value is PingEventPayload {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj['zen'] === 'string' &&
    typeof obj['hook_id'] === 'number'
  )
}

/**
 * Validates that unknown data has the required shape of a CreateEventPayload.
 */
export function isCreateEventPayload(value: unknown): value is CreateEventPayload {
  if (!hasGitHubRepository(value)) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj['ref'] === 'string' &&
    (obj['ref_type'] === 'branch' || obj['ref_type'] === 'tag')
  )
}

/**
 * Validates that unknown data has the required shape of a DeleteEventPayload.
 */
export function isDeleteEventPayload(value: unknown): value is DeleteEventPayload {
  if (!hasGitHubRepository(value)) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj['ref'] === 'string' &&
    (obj['ref_type'] === 'branch' || obj['ref_type'] === 'tag')
  )
}

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Result of webhook handling.
 */
export interface WebhookHandlerResult {
  success: boolean
  message: string
  event?: GitHubEventType
  repository?: string
  ref?: string
  error?: string
}

/**
 * Webhook handler environment bindings.
 */
export interface WebhookEnv {
  /** Durable Object namespace for git repositories */
  GITX: DurableObjectNamespace
  /** Secret for GitHub webhook signature verification */
  GITHUB_WEBHOOK_SECRET: string
}
