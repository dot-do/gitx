/**
 * @fileoverview GitHub Webhook Payload Types
 *
 * Type definitions for GitHub webhook events, focused on push events
 * for triggering repository synchronization.
 *
 * @module webhooks/types
 */
/**
 * Set of known GitHub event types for runtime validation.
 */
export const GITHUB_EVENT_TYPES = new Set([
    'push',
    'ping',
    'create',
    'delete',
]);
/**
 * Checks if a string is a valid GitHubEventType.
 */
export function isGitHubEventType(value) {
    return GITHUB_EVENT_TYPES.has(value);
}
// ============================================================================
// Payload Validators
// ============================================================================
/**
 * Checks if an object has the basic shape of a GitHub repository.
 * Validates required fields used by webhook handlers.
 */
function hasGitHubRepository(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const obj = value;
    if (typeof obj['repository'] !== 'object' || obj['repository'] === null)
        return false;
    const repo = obj['repository'];
    return (typeof repo['full_name'] === 'string' &&
        typeof repo['clone_url'] === 'string');
}
/**
 * Validates that unknown data has the required shape of a PushEventPayload.
 * Does not exhaustively check all fields, but ensures fields accessed by handlers exist.
 */
export function isPushEventPayload(value) {
    if (!hasGitHubRepository(value))
        return false;
    const obj = value;
    return (typeof obj['ref'] === 'string' &&
        typeof obj['before'] === 'string' &&
        typeof obj['after'] === 'string' &&
        Array.isArray(obj['commits']));
}
/**
 * Validates that unknown data has the required shape of a PingEventPayload.
 */
export function isPingEventPayload(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const obj = value;
    return (typeof obj['zen'] === 'string' &&
        typeof obj['hook_id'] === 'number');
}
/**
 * Validates that unknown data has the required shape of a CreateEventPayload.
 */
export function isCreateEventPayload(value) {
    if (!hasGitHubRepository(value))
        return false;
    const obj = value;
    return (typeof obj['ref'] === 'string' &&
        (obj['ref_type'] === 'branch' || obj['ref_type'] === 'tag'));
}
/**
 * Validates that unknown data has the required shape of a DeleteEventPayload.
 */
export function isDeleteEventPayload(value) {
    if (!hasGitHubRepository(value))
        return false;
    const obj = value;
    return (typeof obj['ref'] === 'string' &&
        (obj['ref_type'] === 'branch' || obj['ref_type'] === 'tag'));
}
//# sourceMappingURL=types.js.map