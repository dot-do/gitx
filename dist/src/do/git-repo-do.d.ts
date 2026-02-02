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
import type { DOState, GitRepoDOEnv, InitializeOptions, ForkOptions, ForkResult, CompactResult, WorkflowContext, StoreAccessor, FsCapability } from './types';
import { type DatabaseAccessor } from './types';
import { type GitRepoDOInstance } from './routes';
import { ThinSchemaManager, SchemaManager } from './schema';
import { ParquetStore } from '../storage/parquet-store';
import { RefLog } from '../delta/ref-log';
import { SqliteObjectStore } from './object-store';
import { DORepositoryProvider } from './wire-routes';
import { GitBackendAdapter } from './git-backend-adapter';
/**
 * Base DO class that GitRepoDO extends.
 * Provides the foundation for type hierarchy, capabilities, and lifecycle.
 */
declare class DO {
    static $type: string;
    protected state: DOState;
    protected env: GitRepoDOEnv;
    protected _ns?: string;
    protected _capabilities: Set<string>;
    protected _initialized: boolean;
    constructor(state: DOState, env: GitRepoDOEnv);
    get $type(): string;
    get ns(): string | undefined;
    /**
     * Get the type hierarchy for this DO.
     */
    getTypeHierarchy(): string[];
    /**
     * Check if this DO is an instance of a specific type.
     */
    isInstanceOfType(typeName: string): boolean;
    /**
     * Check if this DO is exactly a specific type (not a subtype).
     */
    isType(typeName: string): boolean;
    /**
     * Check if this DO extends a specific type.
     */
    extendsType(typeName: string): boolean;
    /**
     * Check if this DO has a specific capability.
     */
    hasCapability(capability: string): boolean;
    /**
     * Get the capabilities set.
     * Used by route handlers to access capabilities.
     */
    getCapabilities(): Set<string>;
    /**
     * Convert to JSON representation.
     */
    toJSON(): Record<string, unknown>;
}
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
export declare class GitRepoDO extends DO implements GitRepoDOInstance {
    static $type: string;
    private _router;
    private _$;
    private _db;
    private _things;
    private _rels;
    private _actions;
    private _events;
    private _fs?;
    private _logger;
    private _parquetStore?;
    private _thinSchema?;
    private _refLog?;
    /**
     * Cached instances for reuse across requests.
     * These are lazily created on first access and reused thereafter.
     */
    private _cachedSchemaManager?;
    private _cachedObjectStore?;
    private _cachedRepositoryProvider?;
    private _cachedGitBackendAdapter?;
    /** Start time for uptime tracking */
    readonly _startTime: number;
    constructor(state: DOState, env: GitRepoDOEnv);
    /**
     * Workflow context for $ API.
     */
    get $(): WorkflowContext;
    /**
     * Database accessor (Drizzle instance).
     */
    get db(): DatabaseAccessor;
    /**
     * Things store accessor.
     */
    get things(): StoreAccessor;
    /**
     * Relationships store accessor.
     */
    get rels(): StoreAccessor;
    /**
     * Actions store accessor.
     */
    get actions(): StoreAccessor;
    /**
     * Events store accessor.
     */
    get events(): StoreAccessor;
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
    get fs(): FsCapability | undefined;
    /**
     * Get the underlying Durable Object storage.
     * Used by route handlers for sync operations.
     */
    getStorage(): DOState['storage'];
    /**
     * Get the R2 analytics bucket for Parquet export.
     * Used by route handlers for export operations.
     */
    getAnalyticsBucket(): R2Bucket | undefined;
    /**
     * Get the ParquetStore instance (if ANALYTICS_BUCKET is configured).
     */
    getParquetStore(): ParquetStore | undefined;
    /**
     * Get the thin schema manager.
     */
    getThinSchema(): ThinSchemaManager | undefined;
    /**
     * Get the RefLog instance (if ANALYTICS_BUCKET is configured).
     */
    getRefLog(): RefLog | undefined;
    /**
     * Get the cached SchemaManager instance.
     * Creates and caches on first access, reuses on subsequent calls.
     */
    getSchemaManager(): SchemaManager;
    /**
     * Get the cached ObjectStore instance.
     * Creates and caches on first access, reuses on subsequent calls.
     * Automatically wired to ParquetStore if available.
     */
    getObjectStore(): SqliteObjectStore;
    /**
     * Get the cached DORepositoryProvider instance.
     * Creates and caches on first access, reuses on subsequent calls.
     * Used by wire protocol routes for git clone/fetch/push operations.
     */
    getRepositoryProvider(): DORepositoryProvider;
    /**
     * Get the cached GitBackendAdapter instance.
     * Creates and caches on first access, reuses on subsequent calls.
     * Used by sync operations for clone/fetch from remote repositories.
     */
    getGitBackendAdapter(): GitBackendAdapter;
    /**
     * Invalidate all cached instances.
     * Call this when the underlying storage may have changed externally,
     * or when resetting the DO state (e.g., on alarm for maintenance).
     */
    invalidateCaches(): void;
    /**
     * Schedule background work that doesn't block the response.
     * Delegates to the underlying Durable Object state.waitUntil.
     */
    waitUntil(promise: Promise<unknown>): void;
    /**
     * Initialize the GitRepoDO with namespace and optional parent.
     * @throws {GitRepoDOError} If namespace URL is invalid
     */
    initialize(options: InitializeOptions): Promise<void>;
    /**
     * Fork this DO to create a new instance with copied state.
     * @throws {GitRepoDOError} If DO not initialized or target URL is invalid
     */
    fork(options: ForkOptions): Promise<ForkResult>;
    /**
     * Compact the DO's data, archiving old things, actions, and events.
     * @throws {GitRepoDOError} If DO not initialized or nothing to compact
     */
    compact(): Promise<CompactResult>;
    /**
     * Handle incoming HTTP requests.
     */
    fetch(request: Request): Promise<Response>;
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
    alarm(): Promise<void>;
    /**
     * Ensure the compaction_retries table exists in SQLite.
     */
    private _ensureCompactionRetriesTable;
    /**
     * Get the current compaction attempt count from SQLite.
     */
    private _getCompactionAttemptCount;
    /**
     * Record a compaction failure, incrementing the attempt counter.
     */
    private _recordCompactionFailure;
    /**
     * Reset the compaction attempt counter (called on success).
     */
    private _resetCompactionAttempts;
    /**
     * Schedule a DO alarm at a specific delay.
     */
    private _scheduleAlarm;
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
    scheduleCompaction(delayMs?: number): boolean;
    /**
     * Get a typed collection accessor.
     */
    collection<_T = unknown>(name: string): StoreAccessor & {
        type: string;
    };
    /**
     * Resolve a URL to a resource.
     */
    resolve(url: string): Promise<unknown>;
    private _createWorkflowContext;
    private _createStoreAccessor;
}
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
export declare class GitRepoDOSQL extends GitRepoDO {
}
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
export declare function isGitRepoDO(value: unknown): value is GitRepoDO;
export {};
//# sourceMappingURL=git-repo-do.d.ts.map