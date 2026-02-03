/**
 * @fileoverview Repository Mirroring and Sync
 *
 * This module implements bidirectional repository mirroring with GitHub/GitLab
 * and other Git HTTP remotes. It supports:
 *
 * - **Pull mirror**: Periodically fetch refs + objects from an upstream remote
 * - **Push mirror**: Push local refs + objects to a downstream remote
 * - **Conflict resolution**: Configurable strategies for diverged refs
 *
 * Uses the existing HTTP clone infrastructure from `ops/clone` and `clone/http-clone`.
 *
 * @module ops/mirror
 *
 * @example
 * ```typescript
 * import { MirrorSync } from './ops/mirror'
 *
 * const mirror = new MirrorSync(backend, {
 *   upstream: { url: 'https://github.com/user/repo.git' },
 *   direction: 'pull',
 *   conflictStrategy: 'force-remote',
 * })
 *
 * const result = await mirror.sync()
 * console.log(`Synced ${result.refsUpdated} refs, ${result.objectsFetched} objects`)
 * ```
 */
import type { GitBackend } from '../core/backend';
import type { GitRef } from '../wire/smart-http';
/**
 * Mirror direction.
 *
 * - `pull`: Fetch from upstream into local store
 * - `push`: Push local refs to downstream remote
 * - `bidirectional`: Both pull and push (requires conflict resolution)
 */
export type MirrorDirection = 'pull' | 'push' | 'bidirectional';
/**
 * Strategy for resolving conflicts when refs have diverged.
 *
 * - `force-remote`: Remote always wins (overwrite local)
 * - `force-local`: Local always wins (overwrite remote on push)
 * - `skip`: Skip diverged refs, only update fast-forwards
 * - `error`: Fail on any divergence
 */
export type ConflictStrategy = 'force-remote' | 'force-local' | 'skip' | 'error';
/**
 * Remote endpoint configuration.
 */
export interface MirrorRemote {
    /** Git HTTP(S) URL of the remote repository */
    url: string;
    /** Authentication credentials */
    auth?: {
        username: string;
        password: string;
    };
    /** Custom fetch function (for testing or custom transport) */
    fetch?: typeof fetch;
}
/**
 * Mirror configuration.
 */
export interface MirrorConfig {
    /** Upstream remote to sync with */
    upstream: MirrorRemote;
    /** Optional downstream remote for push mirroring (defaults to upstream) */
    downstream?: MirrorRemote;
    /** Sync direction */
    direction: MirrorDirection;
    /** Conflict resolution strategy */
    conflictStrategy: ConflictStrategy;
    /** Ref patterns to include (glob-style). Default: all refs */
    refPatterns?: string[];
    /** Ref patterns to exclude. Default: none */
    excludePatterns?: string[];
    /** Progress callback */
    onProgress?: (message: string) => void;
}
/**
 * Result of a ref update during sync.
 */
export interface RefSyncResult {
    /** Ref name */
    ref: string;
    /** Previous SHA (null if new ref) */
    previousSha: string | null;
    /** New SHA (null if deleted) */
    newSha: string | null;
    /** Whether this ref was updated */
    updated: boolean;
    /** Whether this was a fast-forward update */
    fastForward: boolean;
    /** Whether a conflict was detected */
    conflict: boolean;
    /** How the conflict was resolved, if any */
    resolution?: 'force-remote' | 'force-local' | 'skipped';
}
/**
 * Result of a mirror sync operation.
 */
export interface MirrorSyncResult {
    /** Whether the sync completed successfully */
    success: boolean;
    /** Error message if sync failed */
    error?: string;
    /** Direction that was synced */
    direction: MirrorDirection;
    /** Number of refs updated */
    refsUpdated: number;
    /** Number of refs skipped (due to conflicts or exclusion) */
    refsSkipped: number;
    /** Number of objects fetched (pull) or pushed */
    objectsFetched: number;
    /** Per-ref sync results */
    refs: RefSyncResult[];
    /** Timestamp of sync completion */
    timestamp: number;
}
/**
 * Mirror state persisted between syncs.
 */
export interface MirrorState {
    /** Last successful sync timestamp */
    lastSync: number | null;
    /** Remote refs at last sync (ref name -> SHA) */
    lastRemoteRefs: Map<string, string>;
    /** Local refs at last sync (ref name -> SHA) */
    lastLocalRefs: Map<string, string>;
}
/**
 * Check if a ref name matches a glob-style pattern.
 *
 * Supports `*` as a wildcard for any sequence of characters within a path segment,
 * and `**` for matching across path segments.
 *
 * @param ref - Ref name to test
 * @param pattern - Glob pattern (e.g., 'refs/heads/*', 'refs/tags/**')
 * @returns True if the ref matches the pattern
 */
export declare function matchRefPattern(ref: string, pattern: string): boolean;
/**
 * Filter refs based on include/exclude patterns.
 *
 * @param refs - Refs to filter
 * @param include - Patterns to include (if empty, include all)
 * @param exclude - Patterns to exclude
 * @returns Filtered refs
 */
export declare function filterRefs(refs: GitRef[], include?: string[], exclude?: string[]): GitRef[];
/**
 * Repository mirroring and synchronization.
 *
 * Handles fetching refs and objects from upstream remotes and optionally
 * pushing to downstream remotes. Supports configurable conflict resolution
 * for diverged refs.
 *
 * @example
 * ```typescript
 * const mirror = new MirrorSync(backend, {
 *   upstream: { url: 'https://github.com/user/repo.git' },
 *   direction: 'pull',
 *   conflictStrategy: 'force-remote',
 * })
 *
 * // Perform a sync
 * const result = await mirror.sync()
 *
 * // Check for conflicts
 * for (const ref of result.refs) {
 *   if (ref.conflict) {
 *     console.log(`Conflict on ${ref.ref}: resolved by ${ref.resolution}`)
 *   }
 * }
 * ```
 */
export declare class MirrorSync {
    private readonly backend;
    private readonly config;
    private state;
    constructor(backend: GitBackend, config: MirrorConfig);
    /**
     * Get current mirror state.
     */
    getState(): MirrorState;
    /**
     * Restore mirror state from a previous sync.
     */
    setState(state: MirrorState): void;
    /**
     * Perform a mirror sync operation.
     *
     * Based on the configured direction, this will:
     * - `pull`: Fetch from upstream and update local refs
     * - `push`: Push local refs to downstream
     * - `bidirectional`: Pull then push, with conflict resolution
     *
     * @returns Sync result with details about updated refs and objects
     */
    sync(): Promise<MirrorSyncResult>;
    /**
     * Pull refs and objects from upstream.
     */
    private pullSync;
    /**
     * Push local refs to downstream using git send-pack protocol.
     *
     * Uses the send-pack protocol to push objects and update refs on the remote.
     */
    private pushSync;
    /**
     * Resolve a conflict between local and remote refs.
     *
     * @param refName - The conflicting ref
     * @param currentSha - Current SHA at the destination
     * @param incomingSha - Incoming SHA from the source
     * @param strategy - Conflict resolution strategy
     * @param direction - Whether this is a pull or push operation
     * @returns Ref sync result with resolution
     */
    private resolveConflict;
}
/**
 * Pull-mirror a remote repository into the local backend.
 *
 * Convenience function for one-shot pull sync.
 *
 * @param url - Remote repository URL
 * @param backend - Local Git backend
 * @param options - Additional options
 * @returns Sync result
 *
 * @example
 * ```typescript
 * const result = await pullMirror(
 *   'https://github.com/user/repo.git',
 *   backend,
 *   { auth: { username: 'token', password: 'ghp_xxx' } }
 * )
 * ```
 */
export declare function pullMirror(url: string, backend: GitBackend, options?: {
    auth?: {
        username: string;
        password: string;
    };
    refPatterns?: string[];
    excludePatterns?: string[];
    conflictStrategy?: ConflictStrategy;
    onProgress?: (message: string) => void;
    fetch?: typeof fetch;
}): Promise<MirrorSyncResult>;
/**
 * Push-mirror local refs to a remote repository.
 *
 * Convenience function for one-shot push sync.
 *
 * @param url - Remote repository URL
 * @param backend - Local Git backend
 * @param options - Additional options
 * @returns Sync result
 *
 * @example
 * ```typescript
 * const result = await pushMirror(
 *   'https://gitlab.com/user/repo.git',
 *   backend,
 *   { auth: { username: 'token', password: 'glpat-xxx' } }
 * )
 * ```
 */
export declare function pushMirror(url: string, backend: GitBackend, options?: {
    auth?: {
        username: string;
        password: string;
    };
    refPatterns?: string[];
    excludePatterns?: string[];
    conflictStrategy?: ConflictStrategy;
    onProgress?: (message: string) => void;
    fetch?: typeof fetch;
}): Promise<MirrorSyncResult>;
//# sourceMappingURL=mirror.d.ts.map