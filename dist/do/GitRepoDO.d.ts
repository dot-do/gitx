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
/**
 * Durable Object state interface.
 */
interface DOState {
    id: {
        toString(): string;
    };
    storage: {
        get(key: string): Promise<unknown>;
        put(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<boolean>;
        list(options?: {
            prefix?: string;
        }): Promise<Map<string, unknown>>;
        sql: {
            exec(query: string, ...params: unknown[]): {
                toArray(): unknown[];
            };
        };
    };
    waitUntil(promise: Promise<unknown>): void;
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
/**
 * Environment interface for GitRepoDO.
 */
interface GitRepoDOEnv {
    DO?: {
        idFromName(name: string): unknown;
        idFromString(id: string): unknown;
        newUniqueId(options?: {
            locationHint?: string;
        }): unknown;
        get(id: unknown): {
            fetch(request: Request | string, init?: RequestInit): Promise<Response>;
        };
    };
    R2?: {
        put(key: string, data: string | ArrayBuffer): Promise<unknown>;
        get(key: string): Promise<{
            text(): Promise<string>;
            arrayBuffer(): Promise<ArrayBuffer>;
        } | null>;
        list(options?: {
            prefix?: string;
        }): Promise<{
            objects: Array<{
                key: string;
            }>;
        }>;
    };
    KV?: {
        get(key: string): Promise<string | null>;
        put(key: string, value: string): Promise<void>;
    };
    PIPELINE?: {
        send(events: unknown[]): Promise<void>;
    };
}
/**
 * Initialize options for GitRepoDO.
 */
interface InitializeOptions {
    ns: string;
    parent?: string;
}
/**
 * Fork options for GitRepoDO.
 */
interface ForkOptions {
    to: string;
    branch?: string;
}
/**
 * Fork result.
 */
interface ForkResult {
    ns: string;
    doId: string;
}
/**
 * Compact result.
 */
interface CompactResult {
    thingsCompacted: number;
    actionsArchived: number;
    eventsArchived: number;
}
/**
 * Workflow context interface (the $ API).
 */
interface WorkflowContext {
    send(event: string, data?: unknown): void;
    try<T>(action: string, data?: unknown): Promise<T>;
    do<T>(action: string, data?: unknown): Promise<T>;
    on: Record<string, Record<string, (handler: unknown) => void>>;
    every: Record<string, {
        at: (time: string) => (handler: unknown) => void;
    }>;
    branch(name: string): Promise<void>;
    checkout(ref: string): Promise<void>;
    merge(branch: string): Promise<void>;
    [key: string]: unknown;
}
/**
 * Store accessor interface.
 */
interface StoreAccessor {
    get(id: string): Promise<unknown>;
    set(id: string, value: unknown): Promise<void>;
    delete(id: string): Promise<boolean>;
    list(options?: {
        prefix?: string;
    }): Promise<Map<string, unknown>>;
}
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
export declare class GitRepoDO extends DO {
    static $type: string;
    private _router;
    private _$;
    private _db;
    private _things;
    private _rels;
    private _actions;
    private _events;
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
     * Initialize the GitRepoDO with namespace and optional parent.
     */
    initialize(options: InitializeOptions): Promise<void>;
    /**
     * Fork this DO to create a new instance with copied state.
     */
    fork(options: ForkOptions): Promise<ForkResult>;
    /**
     * Compact the DO's data, archiving old things, actions, and events.
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
    private _setupRoutes;
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