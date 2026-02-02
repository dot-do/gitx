/**
 * @fileoverview RPC.do Integration for gitx.do
 *
 * This module provides RPC-based git operations for gitx.do including:
 * - RPCGitBackend: Client class for remote git operations via RPC
 * - RPCGitDO: Server Durable Object exposing GitRepository via RPC
 * - Transport Layer: WebSocket connection, binary serialization, batching
 * - OAuth Integration: Auth headers, token refresh, permission checking
 * - Error Handling: Timeouts, connection failures, streaming errors
 *
 * @module do/rpc
 */
import { type DOClientOptions, type ConnectionState, type MagicProxy, type RPCHandler, type RPCHandlerOptions, type CancellableAsyncIterator, type Serializer } from './rpc-mock';
import type { OAuthContext } from './oauth';
import type { ObjectType, TreeEntry as CoreTreeEntry, Author } from '../types/objects';
export type { ObjectType, CoreTreeEntry, Author };
export { type DOClientOptions, type ConnectionState, type MagicProxy, type RPCRequest, type RPCResponse, type StreamController, RPCError, ErrorCodes, } from './rpc-mock';
/**
 * Git RPC configuration
 */
export interface RPCGitConfig extends DOClientOptions {
    /** Repository owner */
    owner?: string;
    /** Repository name */
    repo?: string;
}
/**
 * Clone progress update
 */
export interface CloneProgress {
    phase: 'counting' | 'compressing' | 'receiving' | 'resolving' | 'done';
    current?: number;
    total?: number;
    progress?: number;
}
/**
 * Fetch progress update
 */
export interface FetchProgress {
    phase: 'counting' | 'compressing' | 'receiving' | 'resolving' | 'done';
    current?: number;
    total?: number;
}
/**
 * Push progress update
 */
export interface PushProgress {
    phase: 'counting' | 'compressing' | 'writing' | 'done';
    current?: number;
    total?: number;
}
/**
 * Git author/committer info for RPC calls.
 *
 * Note: This is a simplified version of the canonical Author type from types/objects.
 * The timestamp is optional here because it can be defaulted server-side.
 * Use Author from types/objects for full Git identity with timezone.
 */
export interface RPCGitIdentity {
    name: string;
    email: string;
    timestamp?: number;
}
/** @deprecated Use RPCGitIdentity or Author from types/objects */
export type GitIdentity = RPCGitIdentity;
/**
 * Commit options
 */
export interface CommitOptions {
    message: string;
    tree: string;
    parents?: string[];
    author?: GitIdentity;
    committer?: GitIdentity;
}
/**
 * Tree entry for RPC calls.
 *
 * Note: This extends the canonical TreeEntry with a 'type' field for
 * RPC convenience. Use CoreTreeEntry from types/objects for the
 * canonical definition that matches Git's internal format.
 */
export interface RPCTreeEntry {
    name: string;
    mode: string;
    type: 'blob' | 'tree' | 'commit';
    sha: string;
}
/** @deprecated Use RPCTreeEntry or CoreTreeEntry from types/objects */
export type TreeEntry = RPCTreeEntry;
/**
 * Tag options
 */
export interface TagOptions {
    name: string;
    target: string;
    message?: string;
    tagger?: GitIdentity;
}
/**
 * Git object for RPC calls.
 *
 * Note: This includes 'sha' and optional 'size' fields for RPC wire format.
 * Use GitObject from types/objects for the canonical definition that only
 * contains 'type' and 'data'.
 */
export interface RPCGitObject {
    sha: string;
    type: 'blob' | 'tree' | 'commit' | 'tag';
    data: Uint8Array;
    size?: number;
}
/** @deprecated Use RPCGitObject */
export type GitObject = RPCGitObject;
/**
 * Git reference
 */
export interface GitRef {
    name: string;
    sha: string;
    peeled?: string;
}
/**
 * Clone options
 */
export interface CloneOptions {
    url: string;
    branch?: string;
    depth?: number;
    onProgress?: (progress: CloneProgress) => void;
    _simulateError?: string;
}
/**
 * Fetch options
 */
export interface FetchOptions {
    remote: string;
    refs?: string[];
    depth?: number;
    onProgress?: (progress: FetchProgress) => void;
}
/**
 * Push options
 */
export interface PushOptions {
    remote: string;
    refs: string[];
    force?: boolean;
}
/**
 * Pack send options
 */
export interface PackSendOptions {
    refs: string[];
    wants: string[];
    haves: string[];
}
/**
 * Batch commit options
 */
export interface BatchCommitOptions {
    atomic?: boolean;
}
/**
 * Clone resume token
 */
export interface CloneResumeToken {
    url: string;
    haves: string[];
    partialRefs: Record<string, string>;
}
/**
 * Git RPC methods interface
 */
export interface GitRPCMethods {
    commit(options: CommitOptions): Promise<{
        sha: string;
    }>;
    push(options: PushOptions): Promise<{
        success: boolean;
        refs?: string[];
    }>;
    clone(options: CloneOptions): Promise<{
        refs: GitRef[];
    }>;
    cloneStream(options: CloneOptions): Promise<CancellableAsyncIterator<CloneProgress>>;
    fetch(options: FetchOptions): Promise<{
        refs: GitRef[];
    }>;
    getObject(sha: string): Promise<GitObject>;
    listRefs(prefix?: string): Promise<GitRef[]>;
    updateRef(ref: string, newSha: string, oldSha?: string): Promise<{
        success: boolean;
        ref: string;
    }>;
    resolveRef(ref: string): Promise<{
        sha: string;
    }>;
    getTree(sha: string): Promise<{
        entries?: TreeEntry[];
    }>;
    createBlob(data: Uint8Array): Promise<{
        sha: string;
    }>;
    createTree(options: {
        entries: TreeEntry[];
        base?: string;
    }): Promise<{
        sha: string;
    }>;
    createTag(options: TagOptions): Promise<{
        sha: string;
        name: string;
    }>;
    createBranch(options: {
        name: string;
        startPoint?: string;
    }): Promise<{
        ref: string;
        sha: string;
    }>;
    merge(options: {
        source: string;
        target: string;
        message?: string;
    }): Promise<{
        sha: string;
        conflicts: string[];
    }>;
    receivePack(data: Uint8Array): Promise<{
        objectsReceived: number;
    }>;
    sendPack(options: PackSendOptions): Promise<Uint8Array>;
    storeDelta(baseSha: string, deltaData: Uint8Array): Promise<{
        sha: string;
    }>;
    packObjects(objects: Array<{
        sha: string;
        type: ObjectType;
        data: Uint8Array;
    }>): Promise<Uint8Array>;
    batchCommit(commits: CommitOptions[], options?: BatchCommitOptions): Promise<Array<{
        sha: string;
        index: number;
    }>>;
    batchCommitChain(commits: Array<Omit<CommitOptions, 'parents'>>): Promise<Array<{
        sha: string;
        parents: string[];
    }>>;
    getCloneResumeToken(url: string): Promise<CloneResumeToken>;
}
/**
 * Event listener function type.
 * @template TArgs - The argument types for the listener (defaults to unknown[] for flexibility)
 */
type EventListener<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void;
declare class SimpleEventEmitter {
    private listeners;
    on(event: string, listener: EventListener): void;
    off(event: string, listener: EventListener): void;
    emit(event: string, ...args: unknown[]): void;
}
/**
 * RPC Git Backend client for remote git operations
 */
export declare class RPCGitBackend extends SimpleEventEmitter {
    private ws;
    private _connectionState;
    private _reconnectAttempts;
    private pendingCalls;
    private queuedRequests;
    private messageIdCounter;
    private pingInterval;
    private pongTimeout;
    private lastMessageTime;
    private manualClose;
    private batchQueue;
    private batchTimeout;
    private _headers;
    private refreshAttempts;
    readonly url: string;
    readonly timeout: number;
    readonly reconnect: {
        enabled: boolean;
        maxAttempts: number;
        backoffMs: number;
        maxBackoffMs: number;
    };
    readonly batching: {
        enabled: boolean;
        maxSize: number;
        delayMs: number;
    };
    readonly serializer?: Serializer;
    readonly onTokenRefresh?: () => Promise<string>;
    readonly maxRefreshAttempts: number;
    constructor(options: DOClientOptions);
    get connectionState(): ConnectionState;
    get isConnected(): boolean;
    get reconnectAttempts(): number;
    get pendingCallCount(): number;
    get queuedRequestCount(): number;
    get headers(): Record<string, string>;
    /**
     * Create a magic proxy for git operations
     */
    get proxy(): MagicProxy<{
        git: GitRPCMethods;
    }> & MagicProxy;
    /**
     * Connect to the RPC server
     */
    connect(): Promise<void>;
    /**
     * Close the connection
     */
    close(): void;
    /**
     * Refresh the auth token
     */
    refreshToken(): Promise<void>;
    private setConnectionState;
    private getWebSocketUrl;
    private startPingInterval;
    private stopPingInterval;
    private sendPing;
    private handleClose;
    private attemptReconnect;
    private handleMessage;
    private handleResponse;
    private handleUnauthorized;
    private handleStream;
    private handleBatch;
    private sendPong;
    private rejectPendingCalls;
    private rejectNonIdempotentCalls;
    private rejectQueuedRequests;
    private flushQueuedRequests;
    private isIdempotentMethod;
    private createProxy;
    private call;
    private sendRequest;
    private addToBatch;
    private flushBatch;
    private serializeMessage;
    private containsLargeBinary;
    private serializeBinary;
    private extractBinaryParts;
}
/**
 * Base binding types that can appear in an RPCGitDO environment.
 * Allows R2 buckets, KV namespaces, service bindings, DO namespaces, and primitives.
 */
export type RPCEnvBinding = R2Bucket | KVNamespace | Fetcher | DurableObjectNamespace | string | number | boolean | undefined;
/**
 * Environment type for RPCGitDO.
 * Can be extended with specific bindings.
 * @template TBindings - Additional binding types (defaults to RPCEnvBinding)
 */
export interface RPCGitDOEnv<TBindings = RPCEnvBinding> {
    [key: string]: TBindings;
}
/**
 * RPC Git Durable Object for server-side git operations
 * @template TEnv - The environment type with bindings
 */
export declare class RPCGitDO<TEnv extends RPCGitDOEnv = RPCGitDOEnv> {
    private state;
    protected env: TEnv;
    private objects;
    private refs;
    private partialClones;
    readonly git: GitRPCMethods;
    constructor(state: DurableObjectState, env: TEnv);
    /**
     * Check if user has permission for an operation
     */
    checkPermission(context: OAuthContext, operation: string, repo?: string): boolean;
    private commit;
    private push;
    private clone;
    private cloneStream;
    private fetch;
    private getObject;
    private listRefs;
    private updateRef;
    private resolveRef;
    private getTree;
    private createBlob;
    private createTree;
    private createTag;
    private createBranch;
    private merge;
    private receivePack;
    private sendPack;
    private storeDelta;
    private packObjects;
    private batchCommit;
    private batchCommitChain;
    private getCloneResumeToken;
    private hashObject;
    private hexToBytes;
}
/**
 * Create an RPC Git Backend client
 */
export declare function createRPCGitBackend(options: DOClientOptions | RPCGitConfig): RPCGitBackend;
/**
 * Create an RPC handler for a DO instance
 */
export declare function createRPCHandler(instance: RPCGitDO, state: DurableObjectState | {
    storage: unknown;
}, options?: RPCHandlerOptions): RPCHandler;
declare class DurableObjectState {
    id: {
        toString(): string;
    };
    storage: DurableObjectStorage;
    waitUntil(promise: Promise<unknown>): void;
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
declare class DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
    list<T>(options?: {
        prefix?: string;
    }): Promise<Map<string, T>>;
}
declare class R2Bucket {
    put(key: string, value: ReadableStream | ArrayBuffer | string): Promise<R2Object | null>;
    get(key: string): Promise<R2ObjectBody | null>;
    delete(key: string): Promise<void>;
    list(options?: {
        prefix?: string;
    }): Promise<R2Objects>;
}
interface R2Object {
    key: string;
    size: number;
    etag: string;
}
interface R2ObjectBody extends R2Object {
    body: ReadableStream;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
}
interface R2Objects {
    objects: R2Object[];
    truncated: boolean;
}
declare class KVNamespace {
    get(key: string, options?: {
        type?: 'text' | 'json' | 'arrayBuffer' | 'stream';
    }): Promise<string | null>;
    put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: {
        prefix?: string;
    }): Promise<{
        keys: {
            name: string;
        }[];
    }>;
}
interface Fetcher {
    fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}
declare class DurableObjectNamespace {
    idFromName(name: string): DurableObjectId;
    idFromString(id: string): DurableObjectId;
    newUniqueId(): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
}
interface DurableObjectId {
    toString(): string;
}
interface DurableObjectStub {
    fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}
//# sourceMappingURL=rpc.d.ts.map