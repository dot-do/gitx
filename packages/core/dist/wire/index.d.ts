/**
 * @fileoverview Wire Protocol Types
 *
 * Platform-agnostic type definitions for the Git wire protocol, covering:
 * - Smart HTTP protocol types (service, refs, requests, responses)
 * - Authentication types (basic, bearer, anonymous)
 * - Production hardening types (negotiation limits, rate limiting, validation)
 * - Streaming types (blob streaming, side-band, pack streaming)
 *
 * @module wire
 *
 * @example
 * ```typescript
 * import type { GitService, SmartHTTPRequest, AuthProvider } from '@dotdo/gitx/wire'
 * ```
 */
/** Supported Git Smart HTTP services */
export type GitService = 'git-upload-pack' | 'git-receive-pack';
/** HTTP methods supported by the Smart HTTP protocol */
export type HTTPMethod = 'GET' | 'POST';
/** A Git reference (branch, tag, etc.) */
export interface GitRef {
    /** SHA-1 hash of the object this ref points to (40 hex characters) */
    sha: string;
    /** Full ref name (e.g., 'refs/heads/main', 'refs/tags/v1.0.0') */
    name: string;
    /** Optional peeled SHA for annotated tags */
    peeled?: string;
}
/** Server capabilities advertised during ref discovery */
export interface ServerCapabilities {
    /** Multi-ack support for efficient negotiation */
    multiAck?: boolean;
    /** Detailed multi-ack with continue/common/ready states */
    multiAckDetailed?: boolean;
    /** Thin pack support (delta against objects not in pack) */
    thinPack?: boolean;
    /** Side-band support for multiplexed data streams */
    sideBand?: boolean;
    /** Side-band-64k support (larger packet payloads) */
    sideBand64k?: boolean;
    /** OFS-delta support (offset-based delta encoding) */
    ofsDelta?: boolean;
    /** Shallow clone support */
    shallow?: boolean;
    /** Report-status support for push results */
    reportStatus?: boolean;
    /** Delete-refs support */
    deleteRefs?: boolean;
    /** Atomic push support */
    atomic?: boolean;
    /** Push options support */
    pushOptions?: boolean;
    /** Allow tip SHA1 in want */
    allowTipSha1InWant?: boolean;
    /** Allow reachable SHA1 in want */
    allowReachableSha1InWant?: boolean;
    /** Filter support (partial clone) */
    filter?: boolean;
    /** Server agent string */
    agent?: string;
    /** Symref mappings (e.g., HEAD -> refs/heads/main) */
    symrefs?: Record<string, string>;
}
/** Incoming Smart HTTP request */
export interface SmartHTTPRequest {
    method: HTTPMethod;
    path: string;
    query: Record<string, string | undefined>;
    headers: Record<string, string | undefined>;
    body?: Uint8Array | ReadableStream<Uint8Array>;
    repository: string;
}
/** Smart HTTP response */
export interface SmartHTTPResponse {
    status: number;
    headers: Record<string, string>;
    body: string | Uint8Array | ReadableStream<Uint8Array>;
}
/** Smart HTTP error */
export interface SmartHTTPError {
    status: number;
    message: string;
    code?: string;
}
/** Repository provider for Smart HTTP handlers */
export interface RepositoryProvider {
    /** List refs for a repository */
    listRefs(repo: string): Promise<GitRef[]>;
    /** Check if a repository exists */
    exists(repo: string): Promise<boolean>;
    /** Get an object by SHA */
    getObject?(repo: string, sha: string): Promise<{
        type: string;
        data: Uint8Array;
    } | null>;
    /** Store an object */
    putObject?(repo: string, sha: string, type: string, data: Uint8Array): Promise<void>;
    /** Update a ref */
    updateRef?(repo: string, ref: string, oldSha: string, newSha: string): Promise<boolean>;
}
/**
 * Ref update command for receive-pack.
 * Note: The base `RefUpdateCommand` interface is exported from the `protocol` module.
 * This extended version adds the `type` discriminator used by Smart HTTP handlers.
 */
export interface SmartHTTPRefUpdateCommand {
    oldSha: string;
    newSha: string;
    ref: string;
    type: 'create' | 'update' | 'delete';
}
/** Result of a receive-pack operation */
export interface ReceivePackResult {
    ok: boolean;
    refResults: Array<{
        ref: string;
        status: 'ok' | 'ng';
        message?: string;
    }>;
    unpackStatus: 'ok' | string;
}
/** Authentication type */
export type AuthType = 'basic' | 'bearer' | 'anonymous';
/** Basic authentication credentials */
export interface BasicCredentials {
    type: 'basic';
    username: string;
    password: string;
}
/** Bearer token credentials */
export interface BearerCredentials {
    type: 'bearer';
    token: string;
}
/** Anonymous credentials (no auth provided) */
export interface AnonymousCredentials {
    type: 'anonymous';
}
/** Union of all credential types */
export type Credentials = BasicCredentials | BearerCredentials | AnonymousCredentials;
/** Authentication context passed to auth providers */
export interface AuthContext {
    repository: string;
    service: GitService;
    remoteAddress?: string;
}
/** Result of authentication validation */
export interface AuthResult {
    valid: boolean;
    reason?: string;
    user?: AuthenticatedUser;
}
/** Authenticated user information */
export interface AuthenticatedUser {
    id: string;
    username: string;
    email?: string;
    permissions?: string[];
}
/** Auth provider interface for credential validation */
export interface AuthProvider {
    validateCredentials(credentials: Credentials, context: AuthContext): Promise<AuthResult>;
}
/** Auth configuration options */
export interface AuthOptions {
    realm?: string;
    allowAnonymousRead?: boolean;
    allowAnonymousPush?: boolean;
}
/** Auth middleware function type */
export type AuthMiddleware = (request: SmartHTTPRequest, context: AuthContext) => Promise<AuthenticationResult>;
/** Authentication middleware result */
export interface AuthenticationResult {
    authenticated: boolean;
    user?: AuthenticatedUser;
    response?: SmartHTTPResponse;
}
/** Memory-based auth provider configuration */
export interface MemoryAuthProviderConfig {
    users: Array<{
        username: string;
        password: string;
        id?: string;
        email?: string;
        permissions?: string[];
    }>;
}
/** Negotiation round/request limits */
export interface NegotiationLimits {
    maxRounds?: number;
    maxWants?: number;
    maxHaves?: number;
    timeout?: number;
    maxCapabilities?: number;
    maxRefNameLength?: number;
}
/** Negotiation state context */
export interface NegotiationContext {
    limits: Required<NegotiationLimits>;
    round: number;
    wantCount: number;
    haveCount: number;
    startTime: number;
    completed: boolean;
    aborted: boolean;
}
/** Validation result from hardening checks */
export interface ValidationResult {
    valid: boolean;
    error?: string;
}
/** Rate limiter configuration */
export interface RateLimiterConfig {
    maxRequests: number;
    windowMs: number;
    keyPrefix?: string;
}
/** Rate limit request descriptor */
export interface RateLimitRequest {
    key: string;
    cost?: number;
}
/** Rate limit check result */
export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfter?: number;
}
/** Rate limiter interface */
export interface RateLimiter {
    check(request: RateLimitRequest): Promise<RateLimitResult>;
    consume(request: RateLimitRequest): Promise<RateLimitResult>;
    reset(key: string): Promise<void>;
}
/** Rate limiter hook for integration */
export type RateLimiterHook = (request: SmartHTTPRequest, context: AuthContext) => Promise<RateLimitResult>;
/** Options for blob streaming */
export interface BlobStreamOptions {
    chunkSize?: number;
    highWaterMark?: number;
}
/** Options for side-band streaming */
export interface SideBandOptions {
    channel?: number;
    maxPayloadSize?: number;
}
/** Options for streaming pack writer */
export interface StreamingPackWriterOptions {
    expectedObjects?: number;
    compress?: boolean;
}
/** A streamable Git object descriptor */
export interface StreamableObject {
    sha: string;
    type: string;
    size: number;
    data: Uint8Array | ReadableStream<Uint8Array>;
}
/** Statistics from streaming operations */
export interface StreamingStats {
    objectCount: number;
    totalBytes: number;
    elapsedMs: number;
}
/** Progress callback for streaming operations */
export type StreamProgressCallback = (stats: StreamingStats) => void;
/** Options for streaming pack reader */
export interface StreamingPackReaderOptions {
    maxObjectSize?: number;
    onProgress?: StreamProgressCallback;
}
/** Side-band channel numbers for multiplexed streams */
export declare enum StreamChannel {
    PackData = 1,
    Progress = 2,
    Error = 3
}
//# sourceMappingURL=index.d.ts.map