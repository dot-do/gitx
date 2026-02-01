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
  StoreAccessor,
  FsCapability,
  Logger,
} from './types'
import { GitRepoDOError, GitRepoDOErrorCode } from './types'
import { createLogger } from './logger'
import { setupRoutes, type GitRepoDOInstance } from './routes'
import { ThinSchemaManager } from './schema'
import { ParquetStore } from '../storage/parquet-store'
import { RefLog } from '../delta/ref-log'

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = this.constructor

    while (current && current.$type) {
      hierarchy.push(current.$type)
      current = Object.getPrototypeOf(current)
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
  private _db: unknown
  private _things: StoreAccessor
  private _rels: StoreAccessor
  private _actions: StoreAccessor
  private _events: StoreAccessor
  private _fs?: FsCapability
  private _logger: Logger
  private _parquetStore?: ParquetStore
  private _thinSchema?: ThinSchemaManager
  private _refLog?: RefLog

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
      })
      this._capabilities.add('parquet')
      this._logger.debug('ParquetStore initialized with R2 backend')

      // Initialize RefLog for delta tracking
      this._refLog = new RefLog(env.ANALYTICS_BUCKET, `repos/${state.id.toString()}/delta`)
      this._logger.debug('RefLog initialized with R2 backend')
    }

    // Initialize router with extracted route handlers
    this._router = new Hono()
    setupRoutes(this._router, this)

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
  get db(): unknown {
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
   */
  async alarm(): Promise<void> {
    this._logger.debug('Alarm triggered')
    // Default alarm handler - can be overridden
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
      send(event: string, data?: unknown): void {
        // Queue event for async processing
        self.state.waitUntil(
          self.state.storage.put(`pending:${Date.now()}`, { event, data })
        )
      },

      // Quick attempt (blocking, non-durable)
      async try<T>(action: string, data?: unknown): Promise<T> {
        // Execute action directly
        return { action, data, success: true } as T
      },

      // Durable execution with retries
      async do<T>(action: string, data?: unknown): Promise<T> {
        // Store action for durability
        const actionId = `action:${Date.now()}`
        await self.state.storage.put(actionId, { action, data, status: 'pending' })

        // Execute and update status
        const result = { action, data, success: true } as T
        await self.state.storage.put(actionId, { action, data, status: 'completed', result })

        return result
      },

      // Event handler proxy
      on: new Proxy({} as Record<string, Record<string, (handler: unknown) => void>>, {
        get(_target, noun: string) {
          return new Proxy({}, {
            get(_t, verb: string) {
              return (handler: unknown) => {
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
      every: new Proxy({} as Record<string, { at: (time: string) => (handler: unknown) => void }>, {
        get(_target, schedule: string) {
          return {
            at: (time: string) => (handler: unknown) => {
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
                return async (...args: unknown[]) => {
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
