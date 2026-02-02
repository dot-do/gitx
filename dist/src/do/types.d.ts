/**
 * @fileoverview Type definitions for GitRepoDO and related classes.
 *
 * This module contains all TypeScript interfaces and types used by GitRepoDO,
 * extracted for better code organization and reusability.
 *
 * @module do/types
 */
/**
 * Durable Object state interface.
 * Represents the state passed to a Durable Object constructor.
 */
export interface DOState {
    id: {
        toString(): string;
    };
    storage: DOStorage;
    waitUntil(promise: Promise<unknown>): void;
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
/**
 * Durable Object storage interface.
 * @template T - The type of values stored (defaults to unknown for flexibility)
 */
export interface DOStorage<T = unknown> {
    get<V = T>(key: string): Promise<V | undefined>;
    put<V = T>(key: string, value: V): Promise<void>;
    delete(key: string): Promise<boolean>;
    list<V = T>(options?: {
        prefix?: string;
    }): Promise<Map<string, V>>;
    sql: {
        exec<R = Record<string, unknown>>(query: string, ...params: SqlParam[]): {
            toArray(): R[];
        };
    };
}
/**
 * SQL parameter types that can be passed to exec().
 */
export type SqlParam = string | number | boolean | null | Uint8Array;
/**
 * SQL execution result interface.
 */
export interface SqlExecResult<T = Record<string, unknown>> {
    toArray(): T[];
}
/**
 * SQL interface for database operations.
 */
export interface SqlInterface {
    exec<T = Record<string, unknown>>(query: string, ...params: SqlParam[]): SqlExecResult<T>;
}
/**
 * Database accessor interface for GitRepoDO.
 * Wraps the SQL interface for type-safe database access.
 */
export interface DatabaseAccessor {
    sql: SqlInterface;
}
/**
 * Service binding interface for cross-worker communication.
 */
export interface ServiceBinding {
    fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}
/**
 * Durable Object ID type.
 * Represents the opaque ID returned by namespace methods.
 */
export interface DurableObjectId {
    toString(): string;
    equals(other: DurableObjectId): boolean;
}
/**
 * Durable Object namespace binding.
 */
export interface DONamespaceBinding {
    idFromName(name: string): DurableObjectId;
    idFromString(id: string): DurableObjectId;
    newUniqueId(options?: {
        locationHint?: string;
    }): DurableObjectId;
    get(id: DurableObjectId): DOStub;
}
/**
 * Durable Object stub for RPC calls.
 */
export interface DOStub {
    fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}
/**
 * R2 put result metadata.
 */
export interface R2PutResult {
    key: string;
    version: string;
    size: number;
    etag: string;
    httpEtag: string;
    uploaded: Date;
}
/**
 * R2 bucket binding interface.
 */
export interface R2Binding {
    put(key: string, data: string | ArrayBuffer): Promise<R2PutResult>;
    get(key: string): Promise<R2Object | null>;
    list(options?: {
        prefix?: string;
    }): Promise<{
        objects: Array<{
            key: string;
        }>;
    }>;
}
/**
 * R2 object interface.
 */
export interface R2Object {
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}
/**
 * KV namespace binding interface.
 */
export interface KVBinding {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
}
/**
 * JSON-serializable value type for data payloads.
 * Used across pipeline events, logging, errors, and workflow context.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
/**
 * Pipeline event type.
 * @template TData - The type of the event data payload (defaults to Record<string, JsonValue>)
 */
export interface PipelineEvent<TData = Record<string, JsonValue>> {
    type: string;
    timestamp?: number;
    data?: TData;
}
/**
 * Pipeline binding interface.
 * @template E - The event type (defaults to PipelineEvent)
 */
export interface PipelineBinding<E extends PipelineEvent = PipelineEvent> {
    send(events: E[]): Promise<void>;
}
/**
 * Base environment interface for all DOs.
 */
export interface BaseEnv {
    DO?: DONamespaceBinding;
    R2?: R2Binding;
    KV?: KVBinding;
    PIPELINE?: PipelineBinding;
}
/**
 * Environment interface for GitRepoDO.
 * Extends BaseEnv with FSX and BASHX service bindings.
 */
export interface GitRepoDOEnv extends BaseEnv {
    /**
     * FSX service binding for filesystem operations.
     * Bound via wrangler.toml [[services]] configuration.
     */
    FSX?: ServiceBinding;
    /**
     * BASHX service binding for shell command execution.
     * Bound via wrangler.toml [[services]] configuration.
     */
    BASHX?: ServiceBinding;
    /**
     * R2 bucket for Parquet/analytics data export.
     * Bound via wrangler.toml [[r2_buckets]] configuration.
     */
    ANALYTICS_BUCKET?: R2Bucket;
    /**
     * Durable Object binding for distributed rate limiting.
     * Optional - if not provided, rate limiting will use in-memory storage.
     */
    RATE_LIMIT_DO?: DONamespaceBinding;
    /**
     * Enable rate limiting on DO routes.
     * When true, applies default rate limits using in-memory or DO-backed storage.
     */
    ENABLE_RATE_LIMIT?: boolean;
}
/**
 * Initialize options for GitRepoDO.
 */
export interface InitializeOptions {
    ns: string;
    parent?: string;
}
/**
 * Fork options for GitRepoDO.
 */
export interface ForkOptions {
    to: string;
    branch?: string;
}
/**
 * Fork result.
 */
export interface ForkResult {
    ns: string;
    doId: string;
}
/**
 * Compact result.
 */
export interface CompactResult {
    thingsCompacted: number;
    actionsArchived: number;
    eventsArchived: number;
}
/**
 * Result returned by $.try() and $.do() workflow actions.
 * @template T - The type of the data payload (defaults to unknown)
 */
export interface ActionResult<T = unknown> {
    /** The name of the action that was executed */
    action: string;
    /** The data payload that was passed to the action */
    data?: T;
    /** Whether the action completed successfully */
    success: boolean;
}
/**
 * Event handler function type.
 * @template T - The type of the event data
 */
export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;
/**
 * Scheduled handler function type.
 */
export type ScheduledHandler = () => void | Promise<void>;
/**
 * Workflow context interface (the $ API).
 * Provides durable execution primitives and git operations.
 */
export interface WorkflowContext {
    /** Fire-and-forget event emission */
    send<T = unknown>(event: string, data?: T): void;
    /** Single attempt execution (blocking, non-durable) */
    try<T = unknown>(action: string, data?: T): Promise<ActionResult<T>>;
    /** Durable execution with retries */
    do<T = unknown>(action: string, data?: T): Promise<ActionResult<T>>;
    /** Event handler registration proxy */
    on: WorkflowEventProxy;
    /** Scheduling proxy */
    every: WorkflowScheduleProxy;
    /** Create a new git branch */
    branch(name: string): Promise<void>;
    /** Checkout a git ref */
    checkout(ref: string): Promise<void>;
    /** Merge a branch into current */
    merge(branch: string): Promise<void>;
    /** Allow extension with typed access */
    [key: string]: WorkflowContextValue<JsonValue[], JsonValue | void | Promise<JsonValue | void>>;
}
/**
 * Valid types for workflow context extension values.
 * Uses bounded generics instead of unknown for better type inference.
 * @template TArgs - The argument types for function values (defaults to JsonValue[])
 * @template TReturn - The return type for function values (defaults to JsonValue | void | Promise<JsonValue | void>)
 */
export type WorkflowContextValue<TArgs extends JsonValue[] = JsonValue[], TReturn = JsonValue | void | Promise<JsonValue | void>> = ((...args: TArgs) => TReturn) | string | number | boolean | object | undefined;
/**
 * Proxy type for event handler registration ($.on.noun.verb pattern).
 */
export type WorkflowEventProxy = Record<string, Record<string, <T = unknown>(handler: EventHandler<T>) => void>>;
/**
 * Proxy type for scheduled handler registration ($.every.interval.at pattern).
 */
export type WorkflowScheduleProxy = Record<string, {
    at: (time: string) => (handler: ScheduledHandler) => void;
}>;
/**
 * Store accessor interface.
 * Provides CRUD operations for a storage prefix.
 * @template T - The type of values stored (defaults to unknown for flexibility)
 */
export interface StoreAccessor<T = unknown> {
    get<V = T>(id: string): Promise<V | undefined>;
    set<V = T>(id: string, value: V): Promise<void>;
    delete(id: string): Promise<boolean>;
    list<V = T>(options?: {
        prefix?: string;
    }): Promise<Map<string, V>>;
}
/**
 * Typed collection accessor interface.
 * Extends StoreAccessor with type information.
 */
export interface TypedStoreAccessor extends StoreAccessor {
    type: string;
}
/**
 * Filesystem capability interface for FSX service binding integration.
 * Wraps the FSX service binding to provide filesystem operations.
 */
export interface FsCapability {
    readFile(path: string): Promise<string | Buffer>;
    writeFile(path: string, content: string | Buffer): Promise<void>;
    readDir(path: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    rm(path: string, options?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<void>;
    getFileId?(path: string): Promise<number | null>;
}
/**
 * Error codes for GitRepoDO operations.
 */
export declare enum GitRepoDOErrorCode {
    NOT_INITIALIZED = "NOT_INITIALIZED",
    INVALID_NAMESPACE = "INVALID_NAMESPACE",
    NOTHING_TO_COMPACT = "NOTHING_TO_COMPACT",
    FORK_FAILED = "FORK_FAILED",
    STORAGE_ERROR = "STORAGE_ERROR"
}
/**
 * Error context type - values must be JSON-serializable.
 */
export type ErrorContext = Record<string, JsonValue>;
/**
 * Custom error class for GitRepoDO operations.
 * @template TContext - The type of the context object (defaults to ErrorContext)
 */
export declare class GitRepoDOError<TContext extends ErrorContext = ErrorContext> extends Error {
    readonly code: GitRepoDOErrorCode;
    readonly context: TContext | undefined;
    constructor(message: string, code: GitRepoDOErrorCode, context?: TContext);
    toJSON(): {
        name: string;
        message: string;
        code: GitRepoDOErrorCode;
        context?: TContext | undefined;
    };
}
/**
 * Log levels for GitRepoDO logging.
 */
export declare enum LogLevel {
    DEBUG = "debug",
    INFO = "info",
    WARN = "warn",
    ERROR = "error"
}
/**
 * Log context type - values must be JSON-serializable.
 */
export type LogContext = Record<string, JsonValue>;
/**
 * Log entry interface.
 * @template TContext - The type of the context object (defaults to LogContext)
 */
export interface LogEntry<TContext extends LogContext = LogContext> {
    level: LogLevel;
    message: string;
    timestamp: number;
    context?: TContext;
}
/**
 * Logger interface for GitRepoDO.
 * @template TContext - The type of the context object (defaults to LogContext)
 */
export interface Logger<TContext extends LogContext = LogContext> {
    debug(message: string, context?: TContext): void;
    info(message: string, context?: TContext): void;
    warn(message: string, context?: TContext): void;
    error(message: string, context?: TContext): void;
}
/**
 * Additional component health metadata.
 */
export interface ComponentHealthMetadata {
    latencyMs?: number;
    lastCheck?: number;
    errorCount?: number;
    [key: string]: string | number | boolean | undefined;
}
/**
 * Per-component health status returned in the health check response.
 */
export interface ComponentHealth extends ComponentHealthMetadata {
    status: 'ok' | 'degraded' | 'unhealthy';
    message?: string;
}
/**
 * Health check response.
 */
export interface HealthCheckResponse {
    status: 'ok' | 'degraded' | 'unhealthy';
    ns?: string;
    $type: string;
    uptime?: number;
    capabilities?: string[];
    components?: {
        sqlite?: ComponentHealth;
        bloom?: ComponentHealth;
        parquet?: ComponentHealth;
    };
}
//# sourceMappingURL=types.d.ts.map