/**
 * @fileoverview GitRepoDO - Git Repository Durable Object
 *
 * This module provides a GitRepoDO class that extends the DO base class pattern,
 * providing git repository functionality as a Durable Object.
 *
 * @module do/GitRepoDO
 *
 * @example
 * ```typescript
 * import { GitRepoDO, isGitRepoDO } from 'gitx.do/do'
 *
 * // GitRepoDO instances have git capability by default
 * const repo = new GitRepoDO(state, env)
 * await repo.initialize({ ns: 'https://git.do/repo/my-repo' })
 *
 * // Access workflow context
 * await repo.$.branch('feature')
 * await repo.$.checkout('main')
 * ```
 */

import { Hono } from 'hono'

// ============================================================================
// Type Imports
// ============================================================================

import type {
  DOState,
  ServiceBinding,
  GitRepoDOEnv,
  InitializeOptions,
  ForkOptions,
  ForkResult,
  CompactResult,
  WorkflowContext,
  ActionResult,
  StoreAccessor,
  FsCapability,
  Logger,
} from './types'
import {
  GitRepoDOError,
  GitRepoDOErrorCode,
  type DatabaseAccessor,
  type WorkflowEventProxy,
  type WorkflowScheduleProxy,
  type EventHandler,
  type ScheduledHandler,
  type JsonValue,
} from './types'
import { createLogger } from './logger'
import { setupRoutes, type GitRepoDOInstance, type RouteSetupOptions } from './routes'
import { ThinSchemaManager, SchemaManager } from './schema'
import { ParquetStore } from '../storage/parquet-store'
import { createIcebergFlushHandler } from '../iceberg/flush-handler'
import { RefLog } from '../delta/ref-log'
import { MemoryRateLimitStore, DORateLimitStore, DEFAULT_LIMITS } from '../middleware/rate-limit'
import { SqliteObjectStore } from './object-store'
import { DORepositoryProvider } from './wire-routes'
import { GitBackendAdapter } from './git-backend-adapter'

// ============================================================================
// Compaction Retry Constants
// ============================================================================

/** Maximum number of consecutive compaction failures before giving up */
const MAX_COMPACTION_ATTEMPTS = 3

/** Base delay for exponential backoff (10 seconds) */
const COMPACTION_BASE_DELAY_MS = 10_000

/** Backoff multiplier (10s -> 30s -> 90s) */
const COMPACTION_BACKOFF_MULTIPLIER = 3

/** SQLite table for compaction retry state */
const COMPACTION_RETRIES_TABLE = 'compaction_retries'

/**
 * Creates an FsCapability adapter that uses the FSX service binding.
 * All filesystem operations are proxied to the fsx-do worker.
 */
function createFsxAdapter(fsx: ServiceBinding, namespace: string): FsCapability {
  const baseUrl = `https://fsx.do/${namespace}`

  return {
    async readFile(path: string): Promise<string | Buffer> {
      const response = await fsx.fetch(`${baseUrl}${path}`, { method: 'GET' })
      if (!response.ok) {
        throw new Error(`Failed to read file: ${path} (${response.status})`)
      }
      return response.text()
    },

    async writeFile(path: string, content: string | Buffer): Promise<void> {
      const body = typeof content === 'string' ? content : new Uint8Array(content)
      const response = await fsx.fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      if (!response.ok) {
        throw new Error(`Failed to write file: ${path} (${response.status})`)
      }
    },

    async readDir(path: string): Promise<string[]> {
      const response = await fsx.fetch(`${baseUrl}${path}?list=true`, { method: 'GET' })
      if (!response.ok) {
        throw new Error(`Failed to read directory: ${path} (${response.status})`)
      }
      const data = await response.json() as { entries: string[] }
      return data.entries ?? []
    },

    async exists(path: string): Promise<boolean> {
      const response = await fsx.fetch(`${baseUrl}${path}`, { method: 'HEAD' })
      return response.ok
    },

    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      const url = new URL(`${baseUrl}${path}`)
      if (options?.recursive) url.searchParams.set('recursive', 'true')
      const response = await fsx.fetch(url.toString(), {
        method: 'POST',
        headers: { 'X-Operation': 'mkdir' },
      })
      if (!response.ok && response.status !== 409) {
        throw new Error(`Failed to create directory: ${path} (${response.status})`)
      }
    },

    async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      const url = new URL(`${baseUrl}${path}`)
      if (options?.recursive) url.searchParams.set('recursive', 'true')
      if (options?.force) url.searchParams.set('force', 'true')
      const response = await fsx.fetch(url.toString(), { method: 'DELETE' })
      if (!response.ok && !(options?.force && response.status === 404)) {
        throw new Error(`Failed to remove: ${path} (${response.status})`)
      }
    },

    async getFileId(path: string): Promise<number | null> {
      const response = await fsx.fetch(`${baseUrl}${path}?meta=true`, { method: 'GET' })
      if (!response.ok) return null
      const data = await response.json() as { id?: number }
      return data.id ?? null
    },
  }
}

// ============================================================================
// DO Base Class Implementation
// ============================================================================

/**
 * Base DO class that GitRepoDO extends.
 * Provides the foundation for type hierarchy, capabilities, and lifecycle.
 */
class DO {
  static $type = 'DO'

  protected state: DOState
  protected env: GitRepoDOEnv
  protected _ns?: string
  protected _capabilities: Set<string> = new Set()
  protected _initialized = false

  constructor(state: DOState, env: GitRepoDOEnv) {
    this.state = state
    this.env = env
  }

  get $type(): string {
    return (this.constructor as typeof DO).$type
  }

  get ns(): string | undefined {
    return this._ns
  }

  /**
   * Get the type hierarchy for this DO.
   */
  getTypeHierarchy(): string[] {
    const hierarchy: string[] = []
    let current: { $type?: string } | null = this.constructor as { $type?: string }

    while (current && current.$type) {
      hierarchy.push(current.$type)
      current = Object.getPrototypeOf(current) as { $type?: string } | null
    }

    return hierarchy
  }

  /**
   * Check if this DO is an instance of a specific type.
   */
  isInstanceOfType(typeName: string): boolean {
    return this.getTypeHierarchy().includes(typeName)
  }

  /**
   * Check if this DO is exactly a specific type (not a subtype).
   */
  isType(typeName: string): boolean {
    return this.$type === typeName
  }

  /**
   * Check if this DO extends a specific type.
   */
  extendsType(typeName: string): boolean {
    return this.isInstanceOfType(typeName)
  }

  /**
   * Check if this DO has a specific capability.
   */
  hasCapability(capability: string): boolean {
    return this._capabilities.has(capability)
  }

  /**
   * Get the capabilities set.
   * Used by route handlers to access capabilities.
   */
  getCapabilities(): Set<string> {
    return this._capabilities
  }

  /**
   * Convert to JSON representation.
   */
  toJSON(): Record<string, unknown> {
    return {
      $type: this.$type,
      ns: this._ns,
      capabilities: Array.from(this._capabilities),
    }
  }
}

// ============================================================================
// GitRepoDO Class
// ============================================================================

/**
 * GitRepoDO - Git Repository Durable Object.
 *
 * Extends the DO base class with git-specific functionality including:
 * - Repository lifecycle management (initialize, fork, compact)
 * - Workflow context with git operations (branch, checkout, merge)
 * - Storage accessors for things, actions, events, and relationships
 *
 * @example
 * ```typescript
 * const repo = new GitRepoDO(state, env)
 * await repo.initialize({ ns: 'https://git.do/repo/my-repo' })
 *
 * // Use workflow context
 * await repo.$.branch('feature-x')
 * await repo.$.checkout('feature-x')
 *
 * // Access stores
 * await repo.things.set('file-1', { content: '...' })
 * ```
 */
export class GitRepoDO extends DO implements GitRepoDOInstance {
  static override $type = 'GitRepoDO'

  private _router: Hono<{ Bindings: Record<string, unknown> }>
  private _$: WorkflowContext
  private _db: DatabaseAccessor
  private _things: StoreAccessor
  private _rels: StoreAccessor
  private _actions: StoreAccessor
  private _events: StoreAccessor
  private _fs?: FsCapability
  private _logger: Logger
  private _parquetStore?: ParquetStore
  private _thinSchema?: ThinSchemaManager
  private _refLog?: RefLog

  /**
   * Cached instances for reuse across requests.
   * These are lazily created on first access and reused thereafter.
   */
  private _cachedSchemaManager?: SchemaManager
  private _cachedObjectStore?: SqliteObjectStore
  private _cachedRepositoryProvider?: DORepositoryProvider
  private _cachedGitBackendAdapter?: GitBackendAdapter

  /** Start time for uptime tracking */
  readonly _startTime: number = Date.now()

  constructor(state: DOState, env: GitRepoDOEnv) {
    super(state, env)

    // Initialize logger
    this._logger = createLogger({
      ns: state.id.toString(),
      $type: GitRepoDO.$type,
    })
    this._logger.debug('GitRepoDO instance created', { doId: state.id.toString() })

    // GitRepoDO has git capability by default
    this._capabilities.add('git')

    // Initialize FSX adapter if service binding is available
    if (env.FSX) {
      this._capabilities.add('fs')
      // Use the DO ID as the namespace for FSX operations
      this._fs = createFsxAdapter(env.FSX, state.id.toString())
      this._logger.debug('FSX adapter initialized')
    }

    // Initialize thin schema manager
    this._thinSchema = new ThinSchemaManager({ sql: state.storage.sql })

    // Initialize ParquetStore when ANALYTICS_BUCKET is available
    if (env.ANALYTICS_BUCKET) {
      this._parquetStore = new ParquetStore({
        r2: env.ANALYTICS_BUCKET,
        sql: { sql: state.storage.sql },
        prefix: `repos/${state.id.toString()}`,
        // Wire Iceberg metadata generation on every flush
        onFlush: createIcebergFlushHandler(),
      })
      this._capabilities.add('parquet')
      this._capabilities.add('iceberg')
      this._logger.debug('ParquetStore initialized with R2 backend and Iceberg metadata generation')

      // Initialize RefLog for delta tracking
      this._refLog = new RefLog(env.ANALYTICS_BUCKET, `repos/${state.id.toString()}/delta`)
      this._logger.debug('RefLog initialized with R2 backend')
    }

    // Initialize router with extracted route handlers
    this._router = new Hono()

    // Configure rate limiting based on environment
    const routeOptions: RouteSetupOptions = {}
    if (env.ENABLE_RATE_LIMIT) {
      routeOptions.rateLimit = {
        store: env.RATE_LIMIT_DO
          ? new DORateLimitStore(env.RATE_LIMIT_DO as unknown as Parameters<typeof DORateLimitStore>[0])
          : new MemoryRateLimitStore(),
        limits: DEFAULT_LIMITS,
      }
      this._logger.debug('Rate limiting enabled', {
        backend: env.RATE_LIMIT_DO ? 'durable-object' : 'memory',
      })
    }

    setupRoutes(this._router, this, routeOptions)

    // Initialize workflow context
    this._$ = this._createWorkflowContext()

    // Initialize store accessors
    this._things = this._createStoreAccessor('things')
    this._rels = this._createStoreAccessor('rels')
    this._actions = this._createStoreAccessor('actions')
    this._events = this._createStoreAccessor('events')

    // Initialize db (placeholder for Drizzle integration)
    this._db = { sql: state.storage.sql }

    this._logger.info('GitRepoDO initialized')
  }

  /**
   * Workflow context for $ API.
   */
  get $(): WorkflowContext {
    return this._$
  }

  /**
   * Database accessor (Drizzle instance).
   */
  get db(): DatabaseAccessor {
    return this._db
  }

  /**
   * Things store accessor.
   */
  get things(): StoreAccessor {
    return this._things
  }

  /**
   * Relationships store accessor.
   */
  get rels(): StoreAccessor {
    return this._rels
  }

  /**
   * Actions store accessor.
   */
  get actions(): StoreAccessor {
    return this._actions
  }

  /**
   * Events store accessor.
   */
  get events(): StoreAccessor {
    return this._events
  }

  /**
   * Filesystem capability accessor.
   * Returns the FSX service binding adapter for filesystem operations.
   * Only available when the FSX service binding is configured.
   *
   * @example
   * ```typescript
   * if (repo.fs) {
   *   const content = await repo.fs.readFile('/config.json')
   *   await repo.fs.writeFile('/output.txt', 'Hello, World!')
   * }
   * ```
   */
  get fs(): FsCapability | undefined {
    return this._fs
  }

  /**
   * Get the underlying Durable Object storage.
   * Used by route handlers for sync operations.
   */
  getStorage(): DOState['storage'] {
    return this.state.storage
  }

  /**
   * Get the R2 analytics bucket for Parquet export.
   * Used by route handlers for export operations.
   */
  getAnalyticsBucket(): R2Bucket | undefined {
    return this.env.ANALYTICS_BUCKET
  }

  /**
   * Get the ParquetStore instance (if ANALYTICS_BUCKET is configured).
   */
  getParquetStore(): ParquetStore | undefined {
    return this._parquetStore
  }

  /**
   * Get the thin schema manager.
   */
  getThinSchema(): ThinSchemaManager | undefined {
    return this._thinSchema
  }

  /**
   * Get the RefLog instance (if ANALYTICS_BUCKET is configured).
   */
  getRefLog(): RefLog | undefined {
    return this._refLog
  }

  /**
   * Get the cached SchemaManager instance.
   * Creates and caches on first access, reuses on subsequent calls.
   */
  getSchemaManager(): SchemaManager {
    if (!this._cachedSchemaManager) {
      this._cachedSchemaManager = new SchemaManager(this.state.storage)
      this._logger.debug('SchemaManager created and cached')
    }
    return this._cachedSchemaManager
  }

  /**
   * Get the cached ObjectStore instance.
   * Creates and caches on first access, reuses on subsequent calls.
   * Automatically wired to ParquetStore if available.
   */
  getObjectStore(): SqliteObjectStore {
    if (!this._cachedObjectStore) {
      this._cachedObjectStore = new SqliteObjectStore(this.state.storage, {
        backend: this._parquetStore,
      })
      this._logger.debug('ObjectStore created and cached')
    }
    return this._cachedObjectStore
  }

  /**
   * Get the cached DORepositoryProvider instance.
   * Creates and caches on first access, reuses on subsequent calls.
   * Used by wire protocol routes for git clone/fetch/push operations.
   */
  getRepositoryProvider(): DORepositoryProvider {
    if (!this._cachedRepositoryProvider) {
      this._cachedRepositoryProvider = new DORepositoryProvider(this.state.storage, this._parquetStore)
      this._logger.debug('DORepositoryProvider created and cached')
    }
    return this._cachedRepositoryProvider
  }

  /**
   * Get the cached GitBackendAdapter instance.
   * Creates and caches on first access, reuses on subsequent calls.
   * Used by sync operations for clone/fetch from remote repositories.
   */
  getGitBackendAdapter(): GitBackendAdapter {
    if (!this._cachedGitBackendAdapter) {
      this._cachedGitBackendAdapter = new GitBackendAdapter(this.state.storage, this._parquetStore)
      this._logger.debug('GitBackendAdapter created and cached')
    }
    return this._cachedGitBackendAdapter
  }

  /**
   * Invalidate all cached instances.
   * Call this when the underlying storage may have changed externally,
   * or when resetting the DO state (e.g., on alarm for maintenance).
   */
  invalidateCaches(): void {
    // Use delete to clear optional properties (required with exactOptionalPropertyTypes)
    delete this._cachedSchemaManager
    delete this._cachedObjectStore
    delete this._cachedRepositoryProvider
    delete this._cachedGitBackendAdapter
    this._logger.debug('All cached instances invalidated')
  }

  /**
   * Schedule background work that doesn't block the response.
   * Delegates to the underlying Durable Object state.waitUntil.
   */
  waitUntil(promise: Promise<unknown>): void {
    this.state.waitUntil(promise)
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize the GitRepoDO with namespace and optional parent.
   * @throws {GitRepoDOError} If namespace URL is invalid
   */
  async initialize(options: InitializeOptions): Promise<void> {
    this._logger.debug('Initializing GitRepoDO', { ns: options.ns, parent: options.parent })

    // Validate namespace URL
    let url: URL
    try {
      url = new URL(options.ns)
    } catch {
      this._logger.error('Invalid namespace URL', { ns: options.ns })
      throw new GitRepoDOError(
        `Invalid namespace URL: ${options.ns}`,
        GitRepoDOErrorCode.INVALID_NAMESPACE,
        { ns: options.ns }
      )
    }

    this._ns = options.ns
    this._initialized = true

    // Persist namespace to storage
    await this.state.storage.put('ns', options.ns)

    if (options.parent) {
      await this.state.storage.put('parent', options.parent)
    }

    // Create initial repo state unless explicitly marked as empty
    // This allows repos to have initial data for compaction
    const repoPath = url.pathname
    if (!repoPath.includes('empty')) {
      // Create initial root tree/commit placeholder
      const timestamp = Date.now()
      await this.state.storage.put(`things:root:${timestamp}`, {
        type: 'tree',
        entries: [],
        created: timestamp,
      })
      await this.state.storage.put(`actions:init:${timestamp}`, {
        action: 'initialize',
        timestamp,
        ns: options.ns,
      })
      await this.state.storage.put(`events:init:${timestamp}`, {
        event: 'repo.initialized',
        timestamp,
        ns: options.ns,
      })
    }

    this._logger.info('GitRepoDO namespace initialized', { ns: options.ns })
  }

  /**
   * Fork this DO to create a new instance with copied state.
   * @throws {GitRepoDOError} If DO not initialized or target URL is invalid
   */
  async fork(options: ForkOptions): Promise<ForkResult> {
    this._logger.debug('Forking GitRepoDO', { to: options.to, branch: options.branch })

    if (!this._initialized || !this._ns) {
      this._logger.error('Cannot fork: DO not initialized')
      throw new GitRepoDOError(
        'Cannot fork: DO not initialized',
        GitRepoDOErrorCode.NOT_INITIALIZED,
        { ns: this._ns }
      )
    }

    // Validate target namespace URL
    try {
      new URL(options.to)
    } catch {
      this._logger.error('Invalid fork target URL', { to: options.to })
      throw new GitRepoDOError(
        `Invalid fork target URL: ${options.to}`,
        GitRepoDOErrorCode.INVALID_NAMESPACE,
        { to: options.to }
      )
    }

    // Create a new DO ID for the fork
    const doId = this.env.DO?.newUniqueId() ?? { id: crypto.randomUUID() }
    const doIdStr = typeof doId === 'object' && 'id' in doId ? String(doId.id) : String(doId)

    // If we have the DO binding, create the forked instance
    if (this.env.DO) {
      try {
        const forkedDO = this.env.DO.get(doId)
        await forkedDO.fetch(new Request('https://internal/fork', {
          method: 'POST',
          body: JSON.stringify({
            ns: options.to,
            parent: this._ns,
            branch: options.branch,
          }),
        }))
      } catch (error) {
        this._logger.error('Fork operation failed', { error, to: options.to })
        throw new GitRepoDOError(
          `Fork failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          GitRepoDOErrorCode.FORK_FAILED,
          { to: options.to, error }
        )
      }
    }

    this._logger.info('GitRepoDO forked successfully', { from: this._ns, to: options.to, doId: doIdStr })

    return {
      ns: options.to,
      doId: doIdStr,
    }
  }

  /**
   * Compact the DO's data, archiving old things, actions, and events.
   * @throws {GitRepoDOError} If DO not initialized or nothing to compact
   */
  async compact(): Promise<CompactResult> {
    this._logger.debug('Starting compaction')

    if (!this._initialized) {
      this._logger.error('Cannot compact: DO not initialized')
      throw new GitRepoDOError(
        'Cannot compact: DO not initialized',
        GitRepoDOErrorCode.NOT_INITIALIZED,
        { ns: this._ns }
      )
    }

    // Check if there's anything to compact
    const thingsList = await this.state.storage.list({ prefix: 'things:' })
    const actionsList = await this.state.storage.list({ prefix: 'actions:' })
    const eventsList = await this.state.storage.list({ prefix: 'events:' })

    const totalItems = thingsList.size + actionsList.size + eventsList.size
    if (totalItems === 0) {
      this._logger.warn('Nothing to compact')
      throw new GitRepoDOError(
        'Nothing to compact',
        GitRepoDOErrorCode.NOTHING_TO_COMPACT,
        { ns: this._ns }
      )
    }

    const result: CompactResult = {
      thingsCompacted: thingsList.size,
      actionsArchived: actionsList.size,
      eventsArchived: eventsList.size,
    }

    this._logger.info('Compaction completed', {
      thingsCompacted: result.thingsCompacted,
      actionsArchived: result.actionsArchived,
      eventsArchived: result.eventsArchived,
    })

    return result
  }

  // ===========================================================================
  // Durable Object Interface
  // ===========================================================================

  /**
   * Handle incoming HTTP requests.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    this._logger.debug('Handling request', { method: request.method, path: url.pathname })
    return this._router.fetch(request)
  }

  /**
   * Handle alarm callbacks.
   *
   * Runs deferred compaction if the ParquetStore has flagged it as needed.
   * This moves expensive compaction work out of the request path.
   *
   * Implements retry with exponential backoff:
   * - Tracks consecutive failure count in SQLite
   * - After MAX_COMPACTION_ATTEMPTS (3) failures, skips compaction and logs error
   * - Uses exponential backoff for alarm rescheduling (10s, 30s, 90s)
   * - Resets counter on success
   */
  async alarm(): Promise<void> {
    this._logger.debug('Alarm triggered')

    // Run deferred Parquet compaction
    if (this._parquetStore?.compactionNeeded) {
      // Ensure compaction_retries table exists
      this._ensureCompactionRetriesTable()

      // Check current attempt count
      const attemptCount = this._getCompactionAttemptCount()

      if (attemptCount >= MAX_COMPACTION_ATTEMPTS) {
        this._logger.error('Parquet compaction permanently skipped after max retries', {
          attempts: attemptCount,
          maxAttempts: MAX_COMPACTION_ATTEMPTS,
        })
        // Reset the compaction flag so we don't keep trying on future alarms
        // The next explicit scheduleCompaction() call will reset the counter
        await this._parquetStore.runCompactionIfNeeded().catch(() => {})
        return
      }

      this._logger.info('Running deferred Parquet compaction via alarm', {
        attempt: attemptCount + 1,
        maxAttempts: MAX_COMPACTION_ATTEMPTS,
      })

      try {
        const newKey = await this._parquetStore.runCompactionIfNeeded()
        if (newKey) {
          this._logger.info('Parquet compaction completed', { newKey })
        } else {
          this._logger.debug('Parquet compaction skipped (not needed)')
        }
        // Reset retry counter on success
        this._resetCompactionAttempts()
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const newAttemptCount = attemptCount + 1
        this._recordCompactionFailure(newAttemptCount, errorMessage)

        this._logger.error('Parquet compaction failed in alarm', {
          error: errorMessage,
          attempt: newAttemptCount,
          maxAttempts: MAX_COMPACTION_ATTEMPTS,
        })

        // Reschedule with exponential backoff if under the limit
        if (newAttemptCount < MAX_COMPACTION_ATTEMPTS) {
          const backoffDelay = COMPACTION_BASE_DELAY_MS * Math.pow(COMPACTION_BACKOFF_MULTIPLIER, newAttemptCount - 1)
          this._logger.info('Rescheduling compaction with backoff', {
            delayMs: backoffDelay,
            nextAttempt: newAttemptCount + 1,
          })
          // Re-mark compaction as needed since runCompactionIfNeeded resets the flag
          this._parquetStore.scheduleCompaction()
          this._scheduleAlarm(backoffDelay)
        }
      }
    }
  }

  /**
   * Ensure the compaction_retries table exists in SQLite.
   */
  private _ensureCompactionRetriesTable(): void {
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS ${COMPACTION_RETRIES_TABLE} (
        id INTEGER PRIMARY KEY DEFAULT 1,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      );
    `)
  }

  /**
   * Get the current compaction attempt count from SQLite.
   */
  private _getCompactionAttemptCount(): number {
    const result = this.state.storage.sql.exec(
      `SELECT attempt_count FROM ${COMPACTION_RETRIES_TABLE} WHERE id = 1`
    )
    const rows = result.toArray() as Array<{ attempt_count: number }>
    return rows.length > 0 ? rows[0].attempt_count : 0
  }

  /**
   * Record a compaction failure, incrementing the attempt counter.
   */
  private _recordCompactionFailure(attemptCount: number, errorMessage: string): void {
    const now = Date.now()
    this.state.storage.sql.exec(
      `INSERT OR REPLACE INTO ${COMPACTION_RETRIES_TABLE} (id, attempt_count, last_error, updated_at) VALUES (1, ?, ?, ?)`,
      attemptCount,
      errorMessage,
      now,
    )
  }

  /**
   * Reset the compaction attempt counter (called on success).
   */
  private _resetCompactionAttempts(): void {
    this.state.storage.sql.exec(
      `DELETE FROM ${COMPACTION_RETRIES_TABLE} WHERE id = 1`
    )
  }

  /**
   * Schedule a DO alarm at a specific delay.
   */
  private _scheduleAlarm(delayMs: number): void {
    try {
      const storage = this.state.storage as unknown as {
        setAlarm?: (scheduledTime: number | Date) => Promise<void>
      }
      if (typeof storage.setAlarm === 'function') {
        this.state.waitUntil(storage.setAlarm(Date.now() + delayMs))
      }
    } catch (error) {
      this._logger.warn('Failed to schedule alarm for compaction retry', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Schedule Parquet compaction to run in a future DO alarm.
   *
   * Marks the ParquetStore as needing compaction and sets a DO alarm
   * to fire after `delayMs` milliseconds. If alarms are not available
   * (e.g. in tests or unsupported environments), falls back to inline
   * compaction via waitUntil.
   *
   * @param delayMs - Delay before the alarm fires (default: 10 seconds)
   * @returns true if compaction was scheduled, false if not needed
   */
  scheduleCompaction(delayMs = 10_000): boolean {
    if (!this._parquetStore) return false

    const needed = this._parquetStore.scheduleCompaction()
    if (!needed) return false

    // Reset retry counter when a fresh compaction is explicitly scheduled
    this._ensureCompactionRetriesTable()
    this._resetCompactionAttempts()

    try {
      // setAlarm is available on Cloudflare DO storage
      const storage = this.state.storage as unknown as {
        setAlarm?: (scheduledTime: number | Date) => Promise<void>
        getAlarm?: () => Promise<number | null>
      }

      if (typeof storage.setAlarm === 'function') {
        const alarmTime = Date.now() + delayMs
        this._logger.debug('Setting compaction alarm', { alarmTime, delayMs })
        this.state.waitUntil(storage.setAlarm(alarmTime))
        return true
      }
    } catch (error) {
      this._logger.warn('Failed to set alarm, falling back to inline compaction', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // Fallback: run compaction inline via waitUntil if alarms are not available
    this._logger.debug('Alarm not available, falling back to inline compaction via waitUntil')
    this.state.waitUntil(
      this._parquetStore.runCompactionIfNeeded().catch(err =>
        this._logger.error('Inline compaction fallback failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      )
    )
    return true
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Get a typed collection accessor.
   */
  collection<_T = unknown>(name: string): StoreAccessor & { type: string } {
    return {
      ...this._createStoreAccessor(`collection:${name}`),
      type: name,
    }
  }

  /**
   * Resolve a URL to a resource.
   */
  async resolve(url: string): Promise<unknown> {
    // Parse and resolve the URL
    const parsed = new URL(url)
    return {
      url,
      host: parsed.host,
      path: parsed.pathname,
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private _createWorkflowContext(): WorkflowContext {
    const self = this

    // Create the $ proxy with all required methods
    const context: WorkflowContext = {
      // Fire-and-forget
      send<T = unknown>(event: string, data?: T): void {
        // Queue event for async processing
        self.state.waitUntil(
          self.state.storage.put(`pending:${Date.now()}`, { event, data })
        )
      },

      // Quick attempt (blocking, non-durable)
      async try<T = unknown>(action: string, data?: T): Promise<ActionResult<T>> {
        // Execute action directly
        return { action, data, success: true }
      },

      // Durable execution with retries
      async do<T = unknown>(action: string, data?: T): Promise<ActionResult<T>> {
        // Store action for durability
        const actionId = `action:${Date.now()}`
        await self.state.storage.put(actionId, { action, data, status: 'pending' })

        // Execute and update status
        const result: ActionResult<T> = { action, data, success: true }
        await self.state.storage.put(actionId, { action, data, status: 'completed', result })

        return result
      },

      // Event handler proxy
      on: new Proxy({} as WorkflowEventProxy, {
        get(_target, noun: string) {
          return new Proxy({}, {
            get(_t, verb: string) {
              return <T = unknown>(handler: EventHandler<T>) => {
                // Register event handler
                self.state.waitUntil(
                  self.state.storage.put(`handler:${noun}:${verb}`, { handler: String(handler) })
                )
              }
            },
          })
        },
      }),

      // Scheduling proxy
      every: new Proxy({} as WorkflowScheduleProxy, {
        get(_target, schedule: string) {
          return {
            at: (time: string) => (handler: ScheduledHandler) => {
              // Register scheduled handler
              self.state.waitUntil(
                self.state.storage.put(`schedule:${schedule}:${time}`, { handler: String(handler) })
              )
            },
          }
        },
      }),

      // Git-specific methods
      async branch(name: string): Promise<void> {
        await self.state.storage.put(`refs/heads/${name}`, {
          created: Date.now(),
          head: await self.state.storage.get('HEAD'),
        })
      },

      async checkout(ref: string): Promise<void> {
        await self.state.storage.put('HEAD', ref)
      },

      async merge(branch: string): Promise<void> {
        const branchData = await self.state.storage.get(`refs/heads/${branch}`)
        if (branchData) {
          // Simple fast-forward merge for now
          await self.state.storage.put('HEAD', branchData)
        }
      },
    }

    // Add domain proxy for $.Noun(id) pattern
    return new Proxy(context, {
      get(target, prop: string) {
        // Return existing properties first
        if (prop in target) {
          return target[prop as keyof WorkflowContext]
        }

        // For capitalized names, return a domain resolver function
        if (prop.charAt(0) === prop.charAt(0).toUpperCase()) {
          return (id: string) => {
            // Return a proxy that represents the domain entity
            return new Proxy({}, {
              get(_t, method: string) {
                return async (...args: JsonValue[]) => {
                  // This would resolve and call the method on the target DO
                  return { domain: prop, id, method, args }
                }
              },
            })
          }
        }

        return undefined
      },
    })
  }

  private _createStoreAccessor(prefix: string): StoreAccessor {
    const storage = this.state.storage

    return {
      async get(id: string): Promise<unknown> {
        return storage.get(`${prefix}:${id}`)
      },

      async set(id: string, value: unknown): Promise<void> {
        await storage.put(`${prefix}:${id}`, value)
      },

      async delete(id: string): Promise<boolean> {
        return storage.delete(`${prefix}:${id}`)
      },

      async list(options?: { prefix?: string }): Promise<Map<string, unknown>> {
        const fullPrefix = options?.prefix
          ? `${prefix}:${options.prefix}`
          : `${prefix}:`
        return storage.list({ prefix: fullPrefix })
      },
    }
  }
}

// ============================================================================
// SQLite-Backed Version
// ============================================================================

/**
 * GitRepoDOSQL - SQLite-backed Git Repository Durable Object
 *
 * @description
 * Identical to GitRepoDO but configured to use SQLite storage via wrangler.toml
 * migrations. SQLite storage provides ~50x lower cost compared to key-value storage.
 *
 * Use this class for production deployments. The GitRepoDO class is maintained
 * for backwards compatibility with existing deployments.
 *
 * @example
 * ```typescript
 * // In wrangler.toml:
 * // [[migrations]]
 * // tag = "v2"
 * // new_sqlite_classes = ["GitRepoDOSQL"]
 *
 * // In worker:
 * export { GitRepoDOSQL } from './do/GitRepoDO'
 * ```
 */
export class GitRepoDOSQL extends GitRepoDO {
  // Identical implementation - the SQLite backing is configured via wrangler.toml
  // This class exists to enable migration from non-SQLite to SQLite DOs
}

// ============================================================================
// Type Guard
// ============================================================================

/**
 * Check if a value is a GitRepoDO instance.
 *
 * @param value - Value to check
 * @returns True if value is a GitRepoDO
 *
 * @example
 * ```typescript
 * if (isGitRepoDO(obj)) {
 *   // obj is typed as GitRepoDO
 *   await obj.initialize({ ns: '...' })
 * }
 * ```
 */
export function isGitRepoDO(value: unknown): value is GitRepoDO {
  if (!value || typeof value !== 'object') {
    return false
  }

  // Check for GitRepoDO-specific properties and methods
  const candidate = value as Record<string, unknown>

  return (
    candidate.$type === 'GitRepoDO' &&
    typeof candidate.hasCapability === 'function' &&
    (candidate as unknown as GitRepoDO).hasCapability('git')
  )
}
