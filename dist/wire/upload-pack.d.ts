/**
 * Git upload-pack protocol implementation
 *
 * The upload-pack service is used by git-fetch and git-clone to retrieve
 * objects from a remote repository.
 *
 * Protocol flow:
 * 1. Server advertises refs (ref advertisement)
 * 2. Client sends "want" lines for desired objects
 * 3. Client sends "have" lines for objects it already has
 * 4. Server responds with ACK/NAK
 * 5. Server sends packfile with requested objects
 *
 * Reference: https://git-scm.com/docs/protocol-v2
 *            https://git-scm.com/docs/pack-protocol
 */
import type { ObjectType } from '../types/objects';
/**
 * A reference (branch, tag, etc.) with its SHA and optional peeled value
 */
export interface Ref {
    name: string;
    sha: string;
    peeled?: string;
}
/**
 * Capabilities supported by the upload-pack service
 */
export interface UploadPackCapabilities {
    /** Side-band multiplexing for progress reporting */
    sideBand?: boolean;
    sideBand64k?: boolean;
    /** Thin pack support - allows deltas against objects client has */
    thinPack?: boolean;
    /** Include tags that point to fetched objects */
    includeTag?: boolean;
    /** Shallow clone support */
    shallow?: boolean;
    /** Deepen relative to current shallow boundary */
    deepenRelative?: boolean;
    /** Don't send objects in common */
    noProgress?: boolean;
    /** Object filtering (partial clone) */
    filter?: boolean;
    /** Allow fetching reachable SHA-1 not advertised */
    allowReachableSha1InWant?: boolean;
    /** Allow fetching any SHA-1 */
    allowAnySha1InWant?: boolean;
    /** Multi-ack for better negotiation */
    multiAck?: boolean;
    multiAckDetailed?: boolean;
    /** Object format (sha1 or sha256) */
    objectFormat?: 'sha1' | 'sha256';
    /** Protocol version */
    agent?: string;
}
/**
 * Session state for an upload-pack operation
 */
export interface UploadPackSession {
    /** Repository identifier */
    repoId: string;
    /** Advertised references */
    refs: Ref[];
    /** Capabilities negotiated with client */
    capabilities: UploadPackCapabilities;
    /** Objects the client wants */
    wants: string[];
    /** Objects the client already has */
    haves: string[];
    /** Common ancestors found during negotiation */
    commonAncestors: string[];
    /** Shallow boundary commits (for shallow clones) */
    shallowCommits: string[];
    /** Depth limit for shallow clone */
    depth?: number;
    /** Deepen-since timestamp */
    deepenSince?: number;
    /** Deepen-not refs */
    deepenNot?: string[];
    /** Whether negotiation is complete */
    negotiationComplete: boolean;
    /** Whether this is a stateless request (HTTP) */
    stateless: boolean;
}
/**
 * Result of want/have negotiation
 */
export interface WantHaveNegotiation {
    /** ACK responses for common objects */
    acks: Array<{
        sha: string;
        status: 'common' | 'ready' | 'continue';
    }>;
    /** Whether server has nothing in common (NAK) */
    nak: boolean;
    /** Common ancestor commits found */
    commonAncestors: string[];
    /** Objects the server needs to send */
    objectsToSend: string[];
    /** Whether negotiation is complete and packfile should be sent */
    ready: boolean;
}
/**
 * Side-band channel types
 */
export declare enum SideBandChannel {
    /** Packfile data */
    PACK_DATA = 1,
    /** Progress messages */
    PROGRESS = 2,
    /** Error messages */
    ERROR = 3
}
/**
 * Progress callback for packfile generation
 */
export type ProgressCallback = (message: string) => void;
/**
 * Options for packfile generation
 */
export interface PackfileOptions {
    /** Generate thin pack (use deltas against client's objects) */
    thinPack?: boolean;
    /** Include tags pointing to requested objects */
    includeTag?: boolean;
    /** Progress callback */
    onProgress?: ProgressCallback;
    /** Objects client already has (for thin pack) */
    clientHasObjects?: string[];
    /** Maximum delta depth */
    maxDeltaDepth?: number;
    /** Window size for delta compression */
    deltaWindowSize?: number;
}
/**
 * Result of packfile generation
 */
export interface PackfileResult {
    /** The packfile data */
    packfile: Uint8Array;
    /** Number of objects in the pack */
    objectCount: number;
    /** Objects included in the pack */
    includedObjects: string[];
}
/**
 * Object storage interface for retrieving git objects
 */
export interface ObjectStore {
    /** Get an object by SHA */
    getObject(sha: string): Promise<{
        type: ObjectType;
        data: Uint8Array;
    } | null>;
    /** Check if object exists */
    hasObject(sha: string): Promise<boolean>;
    /** Get commit parents */
    getCommitParents(sha: string): Promise<string[]>;
    /** Get all refs */
    getRefs(): Promise<Ref[]>;
    /** Get objects reachable from a commit */
    getReachableObjects(sha: string, depth?: number): Promise<string[]>;
}
/**
 * Shallow clone info
 */
export interface ShallowInfo {
    /** Commits at the shallow boundary */
    shallowCommits: string[];
    /** Commits that are no longer shallow */
    unshallowCommits: string[];
}
/**
 * Build capability string for ref advertisement
 *
 * @param capabilities - Capabilities to advertise
 * @returns Space-separated capability string
 */
export declare function buildCapabilityString(capabilities: UploadPackCapabilities): string;
/**
 * Parse capabilities from first want line
 *
 * @param capsString - Space-separated capabilities
 * @returns Parsed capabilities
 */
export declare function parseCapabilities(capsString: string): UploadPackCapabilities;
/**
 * Create a new upload-pack session
 *
 * @param repoId - Repository identifier
 * @param refs - Available refs
 * @param stateless - Whether this is a stateless (HTTP) request
 * @returns New session object
 */
export declare function createSession(repoId: string, refs: Ref[], stateless?: boolean): UploadPackSession;
/**
 * Parse a want line from the client
 *
 * @param line - The want line (e.g., "want <sha> [capabilities]")
 * @returns Parsed SHA and capabilities
 */
export declare function parseWantLine(line: string): {
    sha: string;
    capabilities: UploadPackCapabilities;
};
/**
 * Parse a have line from the client
 *
 * @param line - The have line (e.g., "have <sha>")
 * @returns Parsed SHA
 */
export declare function parseHaveLine(line: string): string;
/**
 * Advertise refs to the client
 *
 * @param store - Object store to get refs from
 * @param capabilities - Server capabilities to advertise
 * @returns Pkt-line formatted ref advertisement
 */
export declare function advertiseRefs(store: ObjectStore, capabilities?: Partial<UploadPackCapabilities>): Promise<string>;
/**
 * Format an ACK response
 *
 * @param sha - The SHA being acknowledged
 * @param status - ACK status (common, ready, continue, or none for simple ACK)
 * @returns Pkt-line formatted ACK
 */
export declare function formatAck(sha: string, status?: 'common' | 'ready' | 'continue'): string;
/**
 * Format a NAK response
 *
 * @returns Pkt-line formatted NAK
 */
export declare function formatNak(): string;
/**
 * Process client wants and update session
 *
 * @param session - Current session state
 * @param wants - Array of want SHAs
 * @param store - Object store to verify objects exist
 * @returns Updated session
 */
export declare function processWants(session: UploadPackSession, wants: string[], store: ObjectStore): Promise<UploadPackSession>;
/**
 * Process client haves and perform negotiation
 *
 * @param session - Current session state
 * @param haves - Array of have SHAs
 * @param store - Object store to check for common objects
 * @param done - Whether client is done sending haves
 * @returns Negotiation result
 */
export declare function processHaves(session: UploadPackSession, haves: string[], store: ObjectStore, done: boolean): Promise<WantHaveNegotiation>;
/**
 * Calculate objects needed by client
 *
 * Given wants and haves, determine minimal set of objects to send.
 *
 * @param store - Object store
 * @param wants - Objects client wants
 * @param haves - Objects client has
 * @returns Set of object SHAs to include in packfile
 */
export declare function calculateMissingObjects(store: ObjectStore, wants: string[], haves: string[]): Promise<Set<string>>;
/**
 * Process shallow/deepen commands
 *
 * @param session - Current session
 * @param shallowLines - Shallow commit lines from client
 * @param depth - Requested depth
 * @param deepenSince - Timestamp to deepen since
 * @param deepenNot - Refs to not deepen past
 * @param store - Object store
 * @returns Shallow info with boundary commits
 */
export declare function processShallow(session: UploadPackSession, shallowLines: string[], depth?: number, deepenSince?: number, deepenNot?: string[], store?: ObjectStore): Promise<ShallowInfo>;
/**
 * Format shallow/unshallow lines for response
 *
 * @param shallowInfo - Shallow info to format
 * @returns Pkt-line formatted shallow response
 */
export declare function formatShallowResponse(shallowInfo: ShallowInfo): string;
/**
 * Wrap data in side-band format
 *
 * @param channel - Side-band channel (1=data, 2=progress, 3=error)
 * @param data - Data to wrap
 * @returns Pkt-line formatted side-band data
 */
export declare function wrapSideBand(channel: SideBandChannel, data: Uint8Array): Uint8Array;
/**
 * Send progress message via side-band
 *
 * @param message - Progress message
 * @returns Pkt-line formatted progress message
 */
export declare function formatProgress(message: string): Uint8Array;
/**
 * Generate a packfile containing the requested objects
 *
 * @param store - Object store to get objects from
 * @param wants - Objects the client wants
 * @param haves - Objects the client already has
 * @param options - Packfile generation options
 * @returns Packfile result
 */
export declare function generatePackfile(store: ObjectStore, wants: string[], haves: string[], options?: PackfileOptions): Promise<PackfileResult>;
/**
 * Generate thin pack with deltas against client's objects
 *
 * @param store - Object store
 * @param objects - Objects to include
 * @param clientHasObjects - Objects client already has (for delta bases)
 * @returns Thin packfile
 */
export declare function generateThinPack(store: ObjectStore, objects: string[], clientHasObjects: string[]): Promise<PackfileResult>;
/**
 * Handle a complete fetch request
 *
 * This is the main entry point that handles the full protocol flow:
 * 1. Parse client request (wants, haves, capabilities)
 * 2. Negotiate common ancestors
 * 3. Generate and send packfile
 *
 * @param session - Upload pack session
 * @param request - Raw request data
 * @param store - Object store
 * @returns Response data (ACKs/NAKs + packfile)
 */
export declare function handleFetch(session: UploadPackSession, request: string, store: ObjectStore): Promise<Uint8Array>;
//# sourceMappingURL=upload-pack.d.ts.map