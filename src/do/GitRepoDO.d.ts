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
import { type GitRepoDOInstance } from './routes';
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
    get db(): unknown;
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
     */
    alarm(): Promise<void>;
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
//# sourceMappingURL=GitRepoDO.d.ts.map