/**
 * @fileoverview GitHub Webhook Payload Types
 *
 * Type definitions for GitHub webhook events, focused on push events
 * for triggering repository synchronization.
 *
 * @module webhooks/types
 */
/**
 * GitHub user information in webhook payloads.
 */
export interface GitHubUser {
    name: string;
    email: string;
    username?: string;
}
/**
 * GitHub repository information.
 */
export interface GitHubRepository {
    id: number;
    node_id: string;
    name: string;
    full_name: string;
    private: boolean;
    owner: {
        login: string;
        id: number;
        node_id: string;
        avatar_url: string;
        type: 'User' | 'Organization';
    };
    html_url: string;
    clone_url: string;
    git_url: string;
    ssh_url: string;
    default_branch: string;
}
/**
 * GitHub commit information in push payload.
 */
export interface GitHubCommit {
    id: string;
    tree_id: string;
    distinct: boolean;
    message: string;
    timestamp: string;
    url: string;
    author: GitHubUser;
    committer: GitHubUser;
    added: string[];
    removed: string[];
    modified: string[];
}
/**
 * GitHub push event payload.
 * Sent when commits are pushed to a repository.
 *
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#push
 */
export interface PushEventPayload {
    ref: string;
    before: string;
    after: string;
    created: boolean;
    deleted: boolean;
    forced: boolean;
    base_ref: string | null;
    compare: string;
    commits: GitHubCommit[];
    head_commit: GitHubCommit | null;
    repository: GitHubRepository;
    pusher: GitHubUser;
    sender: {
        login: string;
        id: number;
        node_id: string;
        avatar_url: string;
        type: string;
    };
}
/**
 * GitHub ping event payload.
 * Sent when a webhook is first configured.
 */
export interface PingEventPayload {
    zen: string;
    hook_id: number;
    hook: {
        type: string;
        id: number;
        name: string;
        active: boolean;
        events: string[];
        config: {
            content_type: string;
            url: string;
            insecure_ssl: string;
        };
    };
    repository?: GitHubRepository;
    sender: {
        login: string;
        id: number;
    };
}
/**
 * GitHub create event payload.
 * Sent when a branch or tag is created.
 */
export interface CreateEventPayload {
    ref: string;
    ref_type: 'branch' | 'tag';
    master_branch: string;
    description: string | null;
    pusher_type: string;
    repository: GitHubRepository;
    sender: {
        login: string;
        id: number;
    };
}
/**
 * GitHub delete event payload.
 * Sent when a branch or tag is deleted.
 */
export interface DeleteEventPayload {
    ref: string;
    ref_type: 'branch' | 'tag';
    pusher_type: string;
    repository: GitHubRepository;
    sender: {
        login: string;
        id: number;
    };
}
/**
 * All supported GitHub webhook event payloads.
 */
export type GitHubEventPayload = PushEventPayload | PingEventPayload | CreateEventPayload | DeleteEventPayload;
/**
 * Supported GitHub webhook event types.
 */
export type GitHubEventType = 'push' | 'ping' | 'create' | 'delete';
/**
 * Set of known GitHub event types for runtime validation.
 */
export declare const GITHUB_EVENT_TYPES: ReadonlySet<string>;
/**
 * Checks if a string is a valid GitHubEventType.
 */
export declare function isGitHubEventType(value: string): value is GitHubEventType;
/**
 * Validates that unknown data has the required shape of a PushEventPayload.
 * Does not exhaustively check all fields, but ensures fields accessed by handlers exist.
 */
export declare function isPushEventPayload(value: unknown): value is PushEventPayload;
/**
 * Validates that unknown data has the required shape of a PingEventPayload.
 */
export declare function isPingEventPayload(value: unknown): value is PingEventPayload;
/**
 * Validates that unknown data has the required shape of a CreateEventPayload.
 */
export declare function isCreateEventPayload(value: unknown): value is CreateEventPayload;
/**
 * Validates that unknown data has the required shape of a DeleteEventPayload.
 */
export declare function isDeleteEventPayload(value: unknown): value is DeleteEventPayload;
/**
 * Result of webhook handling.
 */
export interface WebhookHandlerResult {
    success: boolean;
    message: string;
    event?: GitHubEventType;
    repository?: string;
    ref?: string;
    error?: string;
}
/**
 * Webhook handler environment bindings.
 */
export interface WebhookEnv {
    /** Durable Object namespace for git repositories */
    GITX: DurableObjectNamespace;
    /** Secret for GitHub webhook signature verification */
    GITHUB_WEBHOOK_SECRET: string;
}
//# sourceMappingURL=types.d.ts.map