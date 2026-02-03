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

import {
  discoverRefs,
  fetchPack,
  extractPackData,
  unpackObjects,
  parseCloneUrl,
  type CloneOptions,
} from './clone'
import type { GitBackend } from '../core/backend'
import type { GitRef } from '../wire/smart-http'
import {
  push as sendPack,
  discoverReceivePackRefs,
  ZERO_SHA,
  type RefUpdate,
  type PushResult,
} from '../wire/send-pack'

// ============================================================================
// Types
// ============================================================================

/**
 * Mirror direction.
 *
 * - `pull`: Fetch from upstream into local store
 * - `push`: Push local refs to downstream remote
 * - `bidirectional`: Both pull and push (requires conflict resolution)
 */
export type MirrorDirection = 'pull' | 'push' | 'bidirectional'

/**
 * Strategy for resolving conflicts when refs have diverged.
 *
 * - `force-remote`: Remote always wins (overwrite local)
 * - `force-local`: Local always wins (overwrite remote on push)
 * - `skip`: Skip diverged refs, only update fast-forwards
 * - `error`: Fail on any divergence
 */
export type ConflictStrategy = 'force-remote' | 'force-local' | 'skip' | 'error'

/**
 * Remote endpoint configuration.
 */
export interface MirrorRemote {
  /** Git HTTP(S) URL of the remote repository */
  url: string
  /** Authentication credentials */
  auth?: {
    username: string
    password: string
  }
  /** Custom fetch function (for testing or custom transport) */
  fetch?: typeof fetch
}

/**
 * Mirror configuration.
 */
export interface MirrorConfig {
  /** Upstream remote to sync with */
  upstream: MirrorRemote
  /** Optional downstream remote for push mirroring (defaults to upstream) */
  downstream?: MirrorRemote
  /** Sync direction */
  direction: MirrorDirection
  /** Conflict resolution strategy */
  conflictStrategy: ConflictStrategy
  /** Ref patterns to include (glob-style). Default: all refs */
  refPatterns?: string[]
  /** Ref patterns to exclude. Default: none */
  excludePatterns?: string[]
  /** Progress callback */
  onProgress?: (message: string) => void
}

/**
 * Result of a ref update during sync.
 */
export interface RefSyncResult {
  /** Ref name */
  ref: string
  /** Previous SHA (null if new ref) */
  previousSha: string | null
  /** New SHA (null if deleted) */
  newSha: string | null
  /** Whether this ref was updated */
  updated: boolean
  /** Whether this was a fast-forward update */
  fastForward: boolean
  /** Whether a conflict was detected */
  conflict: boolean
  /** How the conflict was resolved, if any */
  resolution?: 'force-remote' | 'force-local' | 'skipped'
}

/**
 * Result of a mirror sync operation.
 */
export interface MirrorSyncResult {
  /** Whether the sync completed successfully */
  success: boolean
  /** Error message if sync failed */
  error?: string
  /** Direction that was synced */
  direction: MirrorDirection
  /** Number of refs updated */
  refsUpdated: number
  /** Number of refs skipped (due to conflicts or exclusion) */
  refsSkipped: number
  /** Number of objects fetched (pull) or pushed */
  objectsFetched: number
  /** Per-ref sync results */
  refs: RefSyncResult[]
  /** Timestamp of sync completion */
  timestamp: number
}

/**
 * Mirror state persisted between syncs.
 */
export interface MirrorState {
  /** Last successful sync timestamp */
  lastSync: number | null
  /** Remote refs at last sync (ref name -> SHA) */
  lastRemoteRefs: Map<string, string>
  /** Local refs at last sync (ref name -> SHA) */
  lastLocalRefs: Map<string, string>
}

// ============================================================================
// Ref Pattern Matching
// ============================================================================

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
export function matchRefPattern(ref: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(ref)
}

/**
 * Filter refs based on include/exclude patterns.
 *
 * @param refs - Refs to filter
 * @param include - Patterns to include (if empty, include all)
 * @param exclude - Patterns to exclude
 * @returns Filtered refs
 */
export function filterRefs(
  refs: GitRef[],
  include?: string[],
  exclude?: string[],
): GitRef[] {
  let filtered = refs

  // Apply include filter
  if (include && include.length > 0) {
    filtered = filtered.filter((ref) =>
      include.some((pattern) => matchRefPattern(ref.name, pattern)),
    )
  }

  // Apply exclude filter
  if (exclude && exclude.length > 0) {
    filtered = filtered.filter(
      (ref) => !exclude.some((pattern) => matchRefPattern(ref.name, pattern)),
    )
  }

  return filtered
}

// ============================================================================
// MirrorSync Class
// ============================================================================

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
export class MirrorSync {
  private readonly backend: GitBackend
  private readonly config: MirrorConfig
  private state: MirrorState

  constructor(backend: GitBackend, config: MirrorConfig) {
    this.backend = backend
    this.config = config
    this.state = {
      lastSync: null,
      lastRemoteRefs: new Map(),
      lastLocalRefs: new Map(),
    }
  }

  /**
   * Get current mirror state.
   */
  getState(): MirrorState {
    return { ...this.state }
  }

  /**
   * Restore mirror state from a previous sync.
   */
  setState(state: MirrorState): void {
    this.state = {
      lastSync: state.lastSync,
      lastRemoteRefs: new Map(state.lastRemoteRefs),
      lastLocalRefs: new Map(state.lastLocalRefs),
    }
  }

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
  async sync(): Promise<MirrorSyncResult> {
    const { direction } = this.config
    const progress = this.config.onProgress

    try {
      if (direction === 'pull' || direction === 'bidirectional') {
        if (progress) progress('Starting pull sync...')
        const pullResult = await this.pullSync()

        if (direction === 'pull') {
          return pullResult
        }

        // For bidirectional, continue with push after pull
        if (!pullResult.success) {
          return pullResult
        }

        if (progress) progress('Starting push sync...')
        const pushResult = await this.pushSync()

        // Merge results
        return {
          success: pushResult.success,
          ...(pushResult.error ? { error: pushResult.error } : {}),
          direction: 'bidirectional',
          refsUpdated: pullResult.refsUpdated + pushResult.refsUpdated,
          refsSkipped: pullResult.refsSkipped + pushResult.refsSkipped,
          objectsFetched: pullResult.objectsFetched + pushResult.objectsFetched,
          refs: [...pullResult.refs, ...pushResult.refs],
          timestamp: Date.now(),
        }
      }

      if (direction === 'push') {
        if (progress) progress('Starting push sync...')
        return await this.pushSync()
      }

      return {
        success: false,
        error: `Unknown direction: ${direction}`,
        direction,
        refsUpdated: 0,
        refsSkipped: 0,
        objectsFetched: 0,
        refs: [],
        timestamp: Date.now(),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        direction,
        refsUpdated: 0,
        refsSkipped: 0,
        objectsFetched: 0,
        refs: [],
        timestamp: Date.now(),
      }
    }
  }

  /**
   * Pull refs and objects from upstream.
   */
  private async pullSync(): Promise<MirrorSyncResult> {
    const { upstream, conflictStrategy, refPatterns, excludePatterns } = this.config
    const progress = this.config.onProgress

    // Build clone options from remote config
    const cloneOptions: CloneOptions = {
      ...(upstream.auth ? { auth: upstream.auth } : {}),
      ...(upstream.fetch ? { fetch: upstream.fetch } : {}),
      ...(progress ? { onProgress: progress } : {}),
    }

    // Step 1: Discover remote refs
    if (progress) progress('Discovering upstream refs...')
    const parsed = parseCloneUrl(upstream.url)
    const remoteAdvert = await discoverRefs(parsed, cloneOptions)

    if (remoteAdvert.refs.length === 0) {
      return {
        success: true,
        direction: 'pull',
        refsUpdated: 0,
        refsSkipped: 0,
        objectsFetched: 0,
        refs: [],
        timestamp: Date.now(),
      }
    }

    // Step 2: Filter refs by patterns
    const filteredRefs = filterRefs(remoteAdvert.refs, refPatterns, excludePatterns)
      .filter((r) => r.name !== 'HEAD') // Skip HEAD symref

    if (filteredRefs.length === 0) {
      if (progress) progress('No matching refs to sync.')
      return {
        success: true,
        direction: 'pull',
        refsUpdated: 0,
        refsSkipped: 0,
        objectsFetched: 0,
        refs: [],
        timestamp: Date.now(),
      }
    }

    // Step 3: Compare with local refs to determine what needs updating
    const refResults: RefSyncResult[] = []
    const wantShas = new Set<string>()

    for (const remoteRef of filteredRefs) {
      const localSha = await this.backend.readRef(remoteRef.name)

      if (localSha === remoteRef.sha) {
        // Already up to date
        refResults.push({
          ref: remoteRef.name,
          previousSha: localSha,
          newSha: remoteRef.sha,
          updated: false,
          fastForward: false,
          conflict: false,
        })
        continue
      }

      // Need to fetch this SHA
      wantShas.add(remoteRef.sha)

      if (localSha === null) {
        // New ref - no conflict
        refResults.push({
          ref: remoteRef.name,
          previousSha: null,
          newSha: remoteRef.sha,
          updated: true,
          fastForward: true,
          conflict: false,
        })
      } else {
        // Ref exists locally with different SHA - potential conflict
        const result = this.resolveConflict(
          remoteRef.name,
          localSha,
          remoteRef.sha,
          conflictStrategy,
          'pull',
        )
        refResults.push(result)

        if (result.resolution === 'skipped') {
          // Don't need to fetch objects for skipped refs
          // But we still added the SHA above; remove if no other ref needs it
        }
      }
    }

    // Step 4: Fetch objects for refs we want to update
    let objectsFetched = 0

    if (wantShas.size > 0) {
      if (progress) progress(`Fetching ${wantShas.size} object trees...`)

      try {
        const packResponse = await fetchPack(parsed, Array.from(wantShas), cloneOptions)
        const packData = extractPackData(packResponse)
        objectsFetched = await unpackObjects(this.backend, packData, progress)
      } catch (error) {
        // If fetch fails, mark all as failed
        return {
          success: false,
          error: `Failed to fetch objects: ${error instanceof Error ? error.message : String(error)}`,
          direction: 'pull',
          refsUpdated: 0,
          refsSkipped: 0,
          objectsFetched: 0,
          refs: refResults,
          timestamp: Date.now(),
        }
      }
    }

    // Step 5: Update local refs
    let refsUpdated = 0
    let refsSkipped = 0

    for (const result of refResults) {
      if (result.updated && result.newSha && result.resolution !== 'skipped') {
        await this.backend.writeRef(result.ref, result.newSha)
        refsUpdated++
      } else if (!result.updated || result.resolution === 'skipped') {
        refsSkipped++
      }
    }

    // Step 6: Update mirror state
    const remoteRefMap = new Map<string, string>()
    for (const ref of filteredRefs) {
      remoteRefMap.set(ref.name, ref.sha)
    }

    this.state = {
      lastSync: Date.now(),
      lastRemoteRefs: remoteRefMap,
      lastLocalRefs: new Map(
        await Promise.all(
          filteredRefs.map(async (ref) => {
            const sha = await this.backend.readRef(ref.name)
            return [ref.name, sha ?? ''] as [string, string]
          }),
        ),
      ),
    }

    if (progress) progress(`Pull sync complete: ${refsUpdated} refs updated, ${objectsFetched} objects fetched.`)

    return {
      success: true,
      direction: 'pull',
      refsUpdated,
      refsSkipped,
      objectsFetched,
      refs: refResults,
      timestamp: Date.now(),
    }
  }

  /**
   * Push local refs to downstream using git send-pack protocol.
   *
   * Uses the send-pack protocol to push objects and update refs on the remote.
   */
  private async pushSync(): Promise<MirrorSyncResult> {
    const downstream = this.config.downstream ?? this.config.upstream
    const { conflictStrategy, refPatterns, excludePatterns } = this.config
    const progress = this.config.onProgress

    // Step 1: Discover downstream refs via git-receive-pack service
    if (progress) progress('Discovering downstream refs...')

    let remoteRefs: Array<{ name: string; sha: string }>
    try {
      // Build options only with defined values
      const discoverOpts: { auth?: { username: string; password: string }; fetch?: typeof fetch } = {}
      if (downstream.auth) discoverOpts.auth = downstream.auth
      if (downstream.fetch) discoverOpts.fetch = downstream.fetch
      const remoteAdvert = await discoverReceivePackRefs(downstream.url, discoverOpts)
      remoteRefs = remoteAdvert.refs
    } catch {
      // Remote may be empty or unreachable
      remoteRefs = []
    }

    // Build remote ref map
    const remoteRefMap = new Map<string, string>()
    for (const ref of remoteRefs) {
      remoteRefMap.set(ref.name, ref.sha)
    }

    // Step 2: Get local refs
    const localBranches = await this.backend.listRefs('refs/heads/')
    const localTags = await this.backend.listRefs('refs/tags/')
    const allLocalRefs: GitRef[] = [
      ...localBranches.map((r) => ({ name: r.name, sha: r.target })),
      ...localTags.map((r) => ({ name: r.name, sha: r.target })),
    ]

    // Step 3: Filter refs
    const filteredRefs = filterRefs(allLocalRefs, refPatterns, excludePatterns)

    // Step 4: Compare and build push plan
    const refResults: RefSyncResult[] = []
    const refUpdatesToPush: RefUpdate[] = []

    for (const localRef of filteredRefs) {
      const remoteSha = remoteRefMap.get(localRef.name) ?? null

      if (remoteSha === localRef.sha) {
        // Already up to date
        refResults.push({
          ref: localRef.name,
          previousSha: remoteSha,
          newSha: localRef.sha,
          updated: false,
          fastForward: false,
          conflict: false,
        })
        continue
      }

      if (remoteSha === null) {
        // New ref on remote
        refResults.push({
          ref: localRef.name,
          previousSha: null,
          newSha: localRef.sha,
          updated: true,
          fastForward: true,
          conflict: false,
        })
        refUpdatesToPush.push({
          refName: localRef.name,
          oldSha: ZERO_SHA,
          newSha: localRef.sha,
        })
      } else {
        // Diverged - resolve conflict
        const result = this.resolveConflict(
          localRef.name,
          remoteSha,
          localRef.sha,
          conflictStrategy,
          'push',
        )
        refResults.push(result)

        // Only push if the conflict was resolved to update
        if (result.updated && result.resolution !== 'skipped') {
          refUpdatesToPush.push({
            refName: localRef.name,
            oldSha: remoteSha,
            newSha: localRef.sha,
            force: result.resolution === 'force-local',
          })
        }
      }
    }

    const refsToUpdate = refUpdatesToPush.length
    const refsSkipped = refResults.filter((r) => !r.updated || r.resolution === 'skipped').length

    // Step 5: Execute push via send-pack if there are refs to update
    let objectsPushed = 0

    if (refsToUpdate > 0) {
      if (progress) progress(`Pushing ${refsToUpdate} refs to remote...`)

      try {
        // Build push options only with defined values
        const pushOpts: {
          url: string
          refUpdates: RefUpdate[]
          backend: GitBackend
          auth?: { username: string; password: string }
          onProgress?: (message: string) => void
          fetch?: typeof fetch
          force?: boolean
        } = {
          url: downstream.url,
          refUpdates: refUpdatesToPush,
          backend: this.backend,
          force: conflictStrategy === 'force-local',
        }
        if (downstream.auth) pushOpts.auth = downstream.auth
        if (progress) pushOpts.onProgress = progress
        if (downstream.fetch) pushOpts.fetch = downstream.fetch

        const pushResult: PushResult = await sendPack(pushOpts)

        objectsPushed = pushResult.objectsSent

        if (!pushResult.success) {
          // Mark failed refs in results
          for (const refResult of pushResult.refResults) {
            const syncResult = refResults.find((r) => r.ref === refResult.refName)
            if (syncResult && !refResult.success) {
              syncResult.updated = false
            }
          }

          return {
            success: false,
            error: pushResult.error ?? 'Push failed',
            direction: 'push',
            refsUpdated: pushResult.refResults.filter((r) => r.success).length,
            refsSkipped,
            objectsFetched: objectsPushed,
            refs: refResults,
            timestamp: Date.now(),
          }
        }

        if (progress) progress(`Push complete: ${objectsPushed} objects sent.`)
      } catch (error) {
        return {
          success: false,
          error: `Push failed: ${error instanceof Error ? error.message : String(error)}`,
          direction: 'push',
          refsUpdated: 0,
          refsSkipped,
          objectsFetched: 0,
          refs: refResults,
          timestamp: Date.now(),
        }
      }
    } else {
      if (progress) progress('No refs to push - already up to date.')
    }

    // Step 6: Update state
    this.state = {
      lastSync: Date.now(),
      lastRemoteRefs: remoteRefMap,
      lastLocalRefs: new Map(filteredRefs.map((r) => [r.name, r.sha])),
    }

    const refsUpdated = refResults.filter((r) => r.updated && r.resolution !== 'skipped').length

    return {
      success: true,
      direction: 'push',
      refsUpdated,
      refsSkipped,
      objectsFetched: objectsPushed,
      refs: refResults,
      timestamp: Date.now(),
    }
  }

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
  private resolveConflict(
    refName: string,
    currentSha: string,
    incomingSha: string,
    strategy: ConflictStrategy,
    direction: 'pull' | 'push',
  ): RefSyncResult {
    switch (strategy) {
      case 'force-remote': {
        if (direction === 'pull') {
          // Remote wins: update local with remote SHA
          return {
            ref: refName,
            previousSha: currentSha,
            newSha: incomingSha,
            updated: true,
            fastForward: false,
            conflict: true,
            resolution: 'force-remote',
          }
        }
        // Push direction with force-remote: skip (don't overwrite remote)
        return {
          ref: refName,
          previousSha: currentSha,
          newSha: incomingSha,
          updated: false,
          fastForward: false,
          conflict: true,
          resolution: 'skipped',
        }
      }

      case 'force-local': {
        if (direction === 'push') {
          // Local wins: push local SHA to remote
          return {
            ref: refName,
            previousSha: currentSha,
            newSha: incomingSha,
            updated: true,
            fastForward: false,
            conflict: true,
            resolution: 'force-local',
          }
        }
        // Pull direction with force-local: skip (don't overwrite local)
        return {
          ref: refName,
          previousSha: currentSha,
          newSha: incomingSha,
          updated: false,
          fastForward: false,
          conflict: true,
          resolution: 'skipped',
        }
      }

      case 'skip':
        return {
          ref: refName,
          previousSha: currentSha,
          newSha: incomingSha,
          updated: false,
          fastForward: false,
          conflict: true,
          resolution: 'skipped',
        }

      case 'error':
        throw new Error(
          `Conflict on ref ${refName}: local=${currentSha}, remote=${incomingSha}. ` +
            `Use a different conflict strategy to resolve.`,
        )

      default:
        throw new Error(`Unknown conflict strategy: ${strategy}`)
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

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
export async function pullMirror(
  url: string,
  backend: GitBackend,
  options?: {
    auth?: { username: string; password: string }
    refPatterns?: string[]
    excludePatterns?: string[]
    conflictStrategy?: ConflictStrategy
    onProgress?: (message: string) => void
    fetch?: typeof fetch
  },
): Promise<MirrorSyncResult> {
  const upstream: MirrorRemote = { url }
  if (options?.auth) upstream.auth = options.auth
  if (options?.fetch) upstream.fetch = options.fetch

  const config: MirrorConfig = {
    upstream,
    direction: 'pull',
    conflictStrategy: options?.conflictStrategy ?? 'force-remote',
  }
  if (options?.refPatterns) config.refPatterns = options.refPatterns
  if (options?.excludePatterns) config.excludePatterns = options.excludePatterns
  if (options?.onProgress) config.onProgress = options.onProgress

  const mirror = new MirrorSync(backend, config)
  return mirror.sync()
}

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
export async function pushMirror(
  url: string,
  backend: GitBackend,
  options?: {
    auth?: { username: string; password: string }
    refPatterns?: string[]
    excludePatterns?: string[]
    conflictStrategy?: ConflictStrategy
    onProgress?: (message: string) => void
    fetch?: typeof fetch
  },
): Promise<MirrorSyncResult> {
  const upstream: MirrorRemote = { url }
  if (options?.auth) upstream.auth = options.auth
  if (options?.fetch) upstream.fetch = options.fetch

  const config: MirrorConfig = {
    upstream,
    direction: 'push',
    conflictStrategy: options?.conflictStrategy ?? 'force-local',
  }
  if (options?.refPatterns) config.refPatterns = options.refPatterns
  if (options?.excludePatterns) config.excludePatterns = options.excludePatterns
  if (options?.onProgress) config.onProgress = options.onProgress

  const mirror = new MirrorSync(backend, config)
  return mirror.sync()
}
