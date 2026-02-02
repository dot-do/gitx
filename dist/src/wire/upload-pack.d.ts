/**
 * @fileoverview Git upload-pack Protocol Implementation
 *
 * This module implements the server-side of Git's upload-pack service, which is
 * used by `git-fetch` and `git-clone` to retrieve objects from a remote repository.
 *
 * @module wire/upload-pack
 *
 * ## Protocol Flow
 *
 * 1. **Ref Advertisement**: Server advertises available refs with capabilities
 * 2. **Want Phase**: Client sends "want" lines for objects it needs
 * 3. **Negotiation**: Client sends "have" lines, server responds with ACK/NAK
 * 4. **Done**: Client signals negotiation complete with "done"
 * 5. **Packfile**: Server generates and sends packfile with requested objects
 *
 * ## Features
 *
 * - Side-band multiplexing for progress reporting
 * - Thin pack support for bandwidth efficiency
 * - Shallow clone support with depth limiting
 * - Multi-ack negotiation for optimal object transfer
 *
 * @see {@link https://git-scm.com/docs/protocol-v2} Git Protocol v2
 * @see {@link https://git-scm.com/docs/pack-protocol} Git Pack Protocol
 *
 * @example Basic fetch operation
 * ```typescript
 * import { createSession, advertiseRefs, handleFetch } from './wire/upload-pack'
 *
 * // Create session and advertise refs
 * const session = createSession('my-repo', await store.getRefs())
 * const advertisement = await advertiseRefs(store)
 *
 * // Process fetch request
 * const response = await handleFetch(session, requestBody, store)
 * ```
 */
import type { ObjectType } from '../types/objects';
/**
 * A reference (branch, tag, etc.) with its SHA and optional peeled value.
 *
 * @description
 * Represents a Git reference that can be advertised to clients. For annotated
 * tags, the `peeled` field contains the SHA of the underlying commit.
 *
 * @example
 * ```typescript
 * const branch: Ref = {
 *   name: 'refs/heads/main',
 *   sha: 'abc123def456...'
 * }
 *
 * const annotatedTag: Ref = {
 *   name: 'refs/tags/v1.0.0',
 *   sha: 'tag-object-sha...',
 *   peeled: 'target-commit-sha...'
 * }
 * ```
 */
export interface Ref {
    /** Full ref name (e.g., 'refs/heads/main', 'refs/tags/v1.0.0') */
    name: string;
    /** SHA-1 hash of the object this ref points to */
    sha: string;
    /** For annotated tags, the SHA of the target object (commit) */
    peeled?: string;
}
/**
 * Capabilities supported by the upload-pack service.
 *
 * @description
 * These capabilities are advertised to clients and negotiated during the
 * initial handshake. Clients select which capabilities to use based on
 * what the server supports.
 *
 * @example
 * ```typescript
 * const caps: UploadPackCapabilities = {
 *   sideBand64k: true,
 *   thinPack: true,
 *   shallow: true,
 *   includeTag: true,
 *   multiAckDetailed: true,
 *   agent: 'my-server/1.0'
 * }
 * ```
 */
export interface UploadPackCapabilities {
    /** Side-band multiplexing for progress reporting (8KB limit) */
    sideBand?: boolean;
    /** Side-band-64k multiplexing (64KB limit, preferred) */
    sideBand64k?: boolean;
    /** Thin pack support - allows deltas against objects client has */
    thinPack?: boolean;
    /** Include tags that point to fetched objects automatically */
    includeTag?: boolean;
    /** Shallow clone support (limited history depth) */
    shallow?: boolean;
    /** Deepen relative to current shallow boundary */
    deepenRelative?: boolean;
    /** Don't send progress messages */
    noProgress?: boolean;
    /** Object filtering (partial clone) support */
    filter?: boolean;
    /** Allow fetching reachable SHA-1 not advertised in refs */
    allowReachableSha1InWant?: boolean;
    /** Allow fetching any SHA-1 (dangerous, usually disabled) */
    allowAnySha1InWant?: boolean;
    /** Multi-ack for negotiation optimization */
    multiAck?: boolean;
    /** Multi-ack with detailed status */
    multiAckDetailed?: boolean;
    /** Object format (sha1 or sha256) */
    objectFormat?: 'sha1' | 'sha256';
    /** Server agent identification string */
    agent?: string;
}
/**
 * Session state for an upload-pack operation.
 *
 * @description
 * Maintains state across the multi-phase upload-pack protocol. For stateless
 * protocols like HTTP, some state must be reconstructed from each request.
 *
 * @example
 * ```typescript
 * const session = createSession('my-repo', refs, false)
 * // session.wants, session.haves populated during negotiation
 * // session.negotiationComplete set to true when ready for packfile
 * ```
 */
export interface UploadPackSession {
    /** Repository identifier for logging/tracking */
    repoId: string;
    /** Advertised references from the repository */
    refs: Ref[];
    /** Capabilities negotiated with the client */
    capabilities: UploadPackCapabilities;
    /** Object SHAs the client wants to receive */
    wants: string[];
    /** Object SHAs the client already has */
    haves: string[];
    /** Common ancestor commits found during negotiation */
    commonAncestors: string[];
    /** Shallow boundary commits (for shallow clones) */
    shallowCommits: string[];
    /** Depth limit for shallow clone */
    depth?: number;
    /** Deepen-since timestamp for shallow clone */
    deepenSince?: number;
    /** Refs to exclude when deepening */
    deepenNot?: string[];
    /** Whether negotiation is complete and packfile should be sent */
    negotiationComplete: boolean;
    /** Whether this is a stateless request (HTTP protocol) */
    stateless: boolean;
}
/**
 * Result of want/have negotiation.
 *
 * @description
 * Contains the ACK/NAK responses to send to the client and information
 * about which objects need to be included in the packfile.
 */
export interface WantHaveNegotiation {
    /** ACK responses for common objects found */
    acks: Array<{
        sha: string;
        status: 'common' | 'ready' | 'continue';
    }>;
    /** Whether server has nothing in common with client (NAK) */
    nak: boolean;
    /** Common ancestor commits found during negotiation */
    commonAncestors: string[];
    /** Object SHAs that need to be sent to the client */
    objectsToSend: string[];
    /** Whether negotiation is complete and packfile should be sent */
    ready: boolean;
}
/**
 * Side-band channel types for multiplexed output.
 *
 * @description
 * When side-band is enabled, the server can send data on multiple channels:
 * - Channel 1: Packfile data
 * - Channel 2: Progress messages (displayed to user)
 * - Channel 3: Error messages (fatal, abort transfer)
 */
export declare enum SideBandChannel {
    /** Packfile data - the actual objects being transferred */
    PACK_DATA = 1,
    /** Progress messages - informational output for the user */
    PROGRESS = 2,
    /** Error messages - fatal errors that abort the transfer */
    ERROR = 3
}
/**
 * Progress callback for packfile generation.
 *
 * @description
 * Called during packfile generation to report progress. Messages are
 * typically sent via side-band channel 2 to the client.
 *
 * @param message - Progress message to display
 */
export type ProgressCallback = (message: string) => void;
/**
 * Options for packfile generation.
 *
 * @description
 * Controls how the packfile is generated, including delta compression
 * settings and progress reporting.
 */
export interface PackfileOptions {
    /** Generate thin pack (use deltas against client's objects) */
    thinPack?: boolean;
    /** Include tags pointing to requested objects */
    includeTag?: boolean;
    /** Progress callback for status updates */
    onProgress?: ProgressCallback;
    /** Objects client already has (for thin pack delta bases) */
    clientHasObjects?: string[];
    /** Maximum delta chain depth */
    maxDeltaDepth?: number;
    /** Window size for delta compression algorithm */
    deltaWindowSize?: number;
    /** Shallow boundary commits - don't traverse past these */
    shallowCommits?: string[];
}
/**
 * Result of packfile generation.
 *
 * @description
 * Contains the generated packfile along with metadata about what
 * was included.
 */
export interface PackfileResult {
    /** The generated packfile binary data */
    packfile: Uint8Array;
    /** Number of objects in the pack */
    objectCount: number;
    /** List of object SHAs included in the pack */
    includedObjects: string[];
}
/**
 * Object storage interface for upload-pack operations.
 *
 * @description
 * Defines the methods required from an object store to support
 * upload-pack operations. Implementations typically wrap a Git
 * object database or similar storage.
 *
 * This interface shares `getObject` and `hasObject` with the canonical
 * {@link import('../types/storage').BasicObjectStore BasicObjectStore},
 * but adds wire-protocol-specific methods (`getCommitParents`, `getRefs`,
 * `getReachableObjects`) needed for fetch negotiation and packfile
 * generation. It cannot directly extend BasicObjectStore because it
 * does not include `storeObject` (upload-pack is read-only).
 *
 * @see {@link import('../types/storage').BasicObjectStore} for the canonical minimal store
 * @see {@link import('../types/storage').ObjectStore} for the canonical full-featured store
 * @see {@link import('./receive-pack').ReceivePackObjectStore} for the receive-pack counterpart
 *
 * @example
 * ```typescript
 * class MyObjectStore implements UploadPackObjectStore {
 *   async getObject(sha: string) {
 *     return this.database.get(sha)
 *   }
 *   async hasObject(sha: string) {
 *     return this.database.has(sha)
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface UploadPackObjectStore {
    /**
     * Get an object by its SHA.
     * @param sha - The SHA-1 hash of the object
     * @returns The object type and data, or null if not found
     */
    getObject(sha: string): Promise<{
        type: ObjectType;
        data: Uint8Array;
    } | null>;
    /**
     * Check if an object exists in the store.
     * @param sha - The SHA-1 hash to check
     * @returns true if the object exists
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Get the parent commit SHAs for a commit.
     * @param sha - The commit SHA
     * @returns Array of parent commit SHAs
     */
    getCommitParents(sha: string): Promise<string[]>;
    /**
     * Get all refs in the repository.
     * @returns Array of Ref objects
     */
    getRefs(): Promise<Ref[]>;
    /**
     * Get all objects reachable from a given SHA.
     * @param sha - Starting object SHA
     * @param depth - Optional depth limit
     * @returns Array of reachable object SHAs
     */
    getReachableObjects(sha: string, depth?: number): Promise<string[]>;
}
/**
 * @deprecated Use {@link UploadPackObjectStore} instead. This alias exists for backward compatibility.
 */
export type ObjectStore = UploadPackObjectStore;
/**
 * Shallow clone information.
 *
 * @description
 * Contains information about shallow boundary changes during
 * fetch operations with depth limiting.
 */
export interface ShallowInfo {
    /** Commits at the new shallow boundary */
    shallowCommits: string[];
    /** Commits that are no longer shallow (deepened) */
    unshallowCommits: string[];
}
/**
 * Build capability string for ref advertisement.
 *
 * @description
 * Converts a capabilities object into a space-separated string suitable
 * for inclusion in the ref advertisement. Boolean capabilities become
 * simple names, while capabilities with values become "name=value".
 *
 * @param capabilities - Capabilities to advertise
 * @returns Space-separated capability string
 *
 * @example
 * ```typescript
 * const caps: UploadPackCapabilities = {
 *   sideBand64k: true,
 *   thinPack: true,
 *   agent: 'my-server/1.0'
 * }
 * const str = buildCapabilityString(caps)
 * // 'side-band-64k thin-pack agent=my-server/1.0'
 * ```
 */
export declare function buildCapabilityString(capabilities: UploadPackCapabilities): string;
/**
 * Parse capabilities from first want line.
 *
 * @description
 * Parses a space-separated capability string (typically from the first
 * want line of a fetch request) into a structured capabilities object.
 *
 * @param capsString - Space-separated capabilities from client
 * @returns Parsed capabilities object
 *
 * @example
 * ```typescript
 * const caps = parseCapabilities('side-band-64k thin-pack agent=git/2.30.0')
 * // caps.sideBand64k === true
 * // caps.thinPack === true
 * // caps.agent === 'git/2.30.0'
 * ```
 */
export declare function parseCapabilities(capsString: string): UploadPackCapabilities;
/**
 * Create a new upload-pack session.
 *
 * @description
 * Initializes a new session for an upload-pack operation. The session
 * tracks state across the negotiation and packfile generation phases.
 *
 * @param repoId - Repository identifier for logging/tracking
 * @param refs - Available refs to advertise
 * @param stateless - Whether this is a stateless (HTTP) request
 * @returns New session object
 *
 * @example
 * ```typescript
 * const refs = await store.getRefs()
 * const session = createSession('my-repo', refs, true)  // HTTP
 * // session.negotiationComplete === false initially
 * ```
 */
export declare function createSession(repoId: string, refs: Ref[], stateless?: boolean): UploadPackSession;
/**
 * Parse a want line from the client.
 *
 * @description
 * Parses a "want" line which has the format:
 * `want <sha> [capabilities...]`
 *
 * The first want line typically includes capabilities, subsequent ones don't.
 *
 * @param line - The want line (e.g., "want abc123... side-band-64k")
 * @returns Parsed SHA and capabilities
 *
 * @throws {Error} If the line format is invalid or SHA is malformed
 *
 * @example
 * ```typescript
 * // First want line with capabilities
 * const { sha, capabilities } = parseWantLine(
 *   'want abc123... side-band-64k thin-pack'
 * )
 * // sha === 'abc123...'
 * // capabilities.sideBand64k === true
 *
 * // Subsequent want line
 * const { sha: sha2 } = parseWantLine('want def456...')
 * ```
 */
export declare function parseWantLine(line: string): {
    sha: string;
    capabilities: UploadPackCapabilities;
};
/**
 * Parse a have line from the client.
 *
 * @description
 * Parses a "have" line which has the simple format:
 * `have <sha>`
 *
 * @param line - The have line (e.g., "have abc123...")
 * @returns The parsed SHA
 *
 * @throws {Error} If the line format is invalid or SHA is malformed
 *
 * @example
 * ```typescript
 * const sha = parseHaveLine('have abc123def456...')
 * // sha === 'abc123def456...'
 * ```
 */
export declare function parseHaveLine(line: string): string;
/**
 * Advertise refs to the client.
 *
 * @description
 * Generates the ref advertisement response for the initial phase of
 * upload-pack. This includes:
 * - HEAD reference with capabilities
 * - Sorted refs with symref information
 * - Peeled refs for annotated tags
 *
 * @param store - Object store to get refs from
 * @param capabilities - Optional server capabilities to advertise
 * @returns Pkt-line formatted ref advertisement
 *
 * @example
 * ```typescript
 * const advertisement = await advertiseRefs(store, {
 *   sideBand64k: true,
 *   thinPack: true
 * })
 * // Send as response to GET /info/refs?service=git-upload-pack
 * ```
 */
export declare function advertiseRefs(store: UploadPackObjectStore, capabilities?: Partial<UploadPackCapabilities>): Promise<string>;
/**
 * Format an ACK response.
 *
 * @description
 * Creates a pkt-line formatted ACK response for negotiation:
 * - Simple ACK: `ACK <sha>` (when negotiation is complete)
 * - Status ACK: `ACK <sha> <status>` (during multi_ack negotiation)
 *
 * @param sha - The SHA being acknowledged
 * @param status - ACK status (common, ready, continue, or none for simple ACK)
 * @returns Pkt-line formatted ACK
 *
 * @example
 * ```typescript
 * // Simple ACK
 * const ack = formatAck('abc123...')
 * // '0014ACK abc123...\n'
 *
 * // Multi-ack with status
 * const ackContinue = formatAck('abc123...', 'continue')
 * // '001dACK abc123... continue\n'
 * ```
 */
export declare function formatAck(sha: string, status?: 'common' | 'ready' | 'continue'): string;
/**
 * Format a NAK response.
 *
 * @description
 * Creates a pkt-line formatted NAK response. NAK indicates that the
 * server has no objects in common with the client's "have" list.
 *
 * @returns Pkt-line formatted NAK
 *
 * @example
 * ```typescript
 * const nak = formatNak()
 * // '0008NAK\n'
 * ```
 */
export declare function formatNak(): string;
/**
 * Process client wants and update session.
 *
 * @description
 * Validates and processes the "want" SHAs from a client fetch request.
 * Verifies that all wanted objects exist in the repository.
 *
 * @param session - Current session state
 * @param wants - Array of want SHAs from the client
 * @param store - Object store to verify objects exist
 * @returns Updated session
 *
 * @throws {Error} If any wanted object doesn't exist
 *
 * @example
 * ```typescript
 * const session = createSession('repo', refs)
 * await processWants(session, ['abc123...', 'def456...'], store)
 * // session.wants now contains the validated wants
 * ```
 */
export declare function processWants(session: UploadPackSession, wants: string[], store: UploadPackObjectStore): Promise<UploadPackSession>;
/**
 * Process client haves and perform negotiation.
 *
 * @description
 * Processes the "have" SHAs from the client to find common ancestors.
 * This determines which objects need to be sent vs which the client
 * already has.
 *
 * @param session - Current session state
 * @param haves - Array of have SHAs from the client
 * @param store - Object store to check for common objects
 * @param done - Whether client is done sending haves
 * @returns Negotiation result with ACKs/NAKs and objects to send
 *
 * @example
 * ```typescript
 * const result = await processHaves(session, ['abc123...'], store, true)
 * if (result.nak) {
 *   // No common objects, will send full pack
 * } else {
 *   // Can send incremental pack
 * }
 * ```
 */
export declare function processHaves(session: UploadPackSession, haves: string[], store: UploadPackObjectStore, done: boolean): Promise<WantHaveNegotiation>;
/**
 * Calculate objects needed by client.
 *
 * @description
 * Given the client's wants and haves, determines the minimal set of
 * objects that need to be sent. Walks the object graph from wants,
 * stopping at objects the client already has.
 *
 * @param store - Object store
 * @param wants - Objects client wants
 * @param haves - Objects client has
 * @returns Set of object SHAs to include in packfile
 *
 * @example
 * ```typescript
 * const missing = await calculateMissingObjects(
 *   store,
 *   ['new-commit-sha'],
 *   ['old-commit-sha']
 * )
 * // missing contains only objects reachable from new-commit
 * // but not reachable from old-commit
 * ```
 */
export declare function calculateMissingObjects(store: UploadPackObjectStore, wants: string[], haves: string[], shallowCommits?: string[]): Promise<Set<string>>;
/**
 * Process shallow/deepen commands.
 *
 * @description
 * Handles shallow clone requests by processing depth limits, deepen-since
 * timestamps, and deepen-not refs. Updates the session with shallow
 * boundary information.
 *
 * @param session - Current session
 * @param shallowLines - Shallow commit lines from client
 * @param depth - Requested commit depth
 * @param deepenSince - Timestamp to deepen since
 * @param deepenNot - Refs to not deepen past
 * @param store - Object store
 * @returns Shallow info with boundary commits
 *
 * @example
 * ```typescript
 * const shallowInfo = await processShallow(
 *   session,
 *   [],  // No previous shallow commits
 *   3,   // Depth of 3 commits
 *   undefined,
 *   undefined,
 *   store
 * )
 * // shallowInfo.shallowCommits contains boundary commits
 * ```
 */
export declare function processShallow(session: UploadPackSession, shallowLines: string[], depth?: number, deepenSince?: number, deepenNot?: string[], store?: UploadPackObjectStore): Promise<ShallowInfo>;
/**
 * Format shallow/unshallow lines for response.
 *
 * @description
 * Creates pkt-line formatted shallow/unshallow responses to send
 * to the client before the packfile.
 *
 * @param shallowInfo - Shallow info to format
 * @returns Pkt-line formatted shallow response
 *
 * @example
 * ```typescript
 * const response = formatShallowResponse({
 *   shallowCommits: ['abc123...'],
 *   unshallowCommits: []
 * })
 * // '001cshallow abc123...\n'
 * ```
 */
export declare function formatShallowResponse(shallowInfo: ShallowInfo): string;
/**
 * Wrap data in side-band format.
 *
 * @description
 * Wraps data in side-band format for multiplexed transmission.
 * The format is: pkt-line length + channel byte + data
 *
 * @param channel - Side-band channel (1=data, 2=progress, 3=error)
 * @param data - Data to wrap
 * @returns Pkt-line formatted side-band data
 *
 * @example
 * ```typescript
 * // Wrap packfile data for channel 1
 * const wrapped = wrapSideBand(SideBandChannel.PACK_DATA, packfile)
 *
 * // Wrap progress message for channel 2
 * const progress = wrapSideBand(
 *   SideBandChannel.PROGRESS,
 *   encoder.encode('Counting objects: 100%\n')
 * )
 * ```
 */
export declare function wrapSideBand(channel: SideBandChannel, data: Uint8Array): Uint8Array;
/**
 * Send progress message via side-band.
 *
 * @description
 * Creates a side-band channel 2 message for progress reporting.
 * Messages are displayed to the user during fetch operations.
 *
 * @param message - Progress message (newline added if not present)
 * @returns Pkt-line formatted progress message
 *
 * @example
 * ```typescript
 * const progress = formatProgress('Counting objects: 42')
 * // Side-band channel 2 packet with the message
 * ```
 */
export declare function formatProgress(message: string): Uint8Array;
/**
 * Generate a packfile containing the requested objects.
 *
 * @description
 * Creates a Git packfile containing all objects needed by the client.
 * The packfile format includes:
 * - 12-byte header (PACK + version + object count)
 * - Compressed objects with type/size headers
 * - 20-byte SHA-1 checksum
 *
 * @param store - Object store to get objects from
 * @param wants - Objects the client wants
 * @param haves - Objects the client already has
 * @param options - Packfile generation options
 * @returns Packfile result with binary data and metadata
 *
 * @example
 * ```typescript
 * const result = await generatePackfile(
 *   store,
 *   ['commit-sha-1', 'commit-sha-2'],
 *   ['base-commit-sha'],
 *   { thinPack: true, onProgress: console.log }
 * )
 * // result.packfile contains the binary packfile
 * // result.objectCount is the number of objects
 * ```
 */
export declare function generatePackfile(store: UploadPackObjectStore, wants: string[], haves: string[], options?: PackfileOptions): Promise<PackfileResult>;
/**
 * Generate thin pack with deltas against client's objects.
 *
 * @description
 * Creates a thin pack that can use objects the client already has
 * as delta bases, resulting in smaller transfer sizes.
 *
 * @param store - Object store
 * @param objects - Objects to include
 * @param clientHasObjects - Objects client already has (for delta bases)
 * @returns Thin packfile
 *
 * @example
 * ```typescript
 * const result = await generateThinPack(
 *   store,
 *   ['new-blob-sha'],
 *   ['similar-blob-sha']  // Client has this, can be delta base
 * )
 * ```
 */
export declare function generateThinPack(store: UploadPackObjectStore, objects: string[], clientHasObjects: string[]): Promise<PackfileResult>;
/**
 * Handle a complete fetch request.
 *
 * @description
 * This is the main entry point that handles the full upload-pack protocol flow:
 * 1. Parse client request (wants, haves, capabilities, shallow commands)
 * 2. Negotiate common ancestors via ACK/NAK
 * 3. Generate and return packfile with requested objects
 *
 * @param session - Upload pack session
 * @param request - Raw request data (pkt-line formatted)
 * @param store - Object store
 * @returns Response data (ACKs/NAKs + packfile)
 *
 * @example
 * ```typescript
 * const session = createSession('repo', refs)
 * const requestBody = '0032want abc123... side-band-64k\n00000009done\n'
 *
 * const response = await handleFetch(session, requestBody, store)
 * // response contains NAK + packfile data
 * ```
 */
export declare function handleFetch(session: UploadPackSession, request: string, store: UploadPackObjectStore): Promise<Uint8Array>;
//# sourceMappingURL=upload-pack.d.ts.map