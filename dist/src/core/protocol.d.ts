/**
 * @fileoverview Git Wire Protocol Types and Utilities (Platform Agnostic)
 *
 * Re-exports from the core protocol module with backward compatibility layer.
 *
 * @module @dotdo/gitx/protocol
 */
export * from '../../core/protocol';
/**
 * Git capability advertised during protocol negotiation.
 */
export interface Capability {
    name: string;
    value?: string;
}
/**
 * Reference advertisement from server.
 */
export interface RefAdvertisement {
    sha: string;
    name: string;
    peeled?: string;
}
/**
 * Git protocol version.
 */
export type ProtocolVersion = 1 | 2;
/**
 * Request for git-upload-pack (fetch/clone).
 */
export interface UploadPackRequest {
    wants: string[];
    haves: string[];
    depth?: number;
    shallows?: string[];
    deepenSince?: Date;
    deepenNot?: string[];
    includeTags?: boolean;
    done?: boolean;
}
/**
 * Response from git-upload-pack.
 */
export interface UploadPackResponse {
    acks: Array<{
        sha: string;
        type: 'continue' | 'common' | 'ready';
    }>;
    nak?: boolean;
    shallows?: string[];
    unshallows?: string[];
    packData?: Uint8Array;
}
/**
 * Request for git-receive-pack (push).
 */
export interface ReceivePackRequest {
    updates: RefUpdate[];
    packData?: Uint8Array;
    reportStatus?: boolean;
    sideBand?: boolean;
}
/**
 * A single reference update in a push.
 */
export interface RefUpdate {
    refName: string;
    oldSha: string;
    newSha: string;
}
/**
 * Response from git-receive-pack.
 */
export interface ReceivePackResponse {
    status: 'ok' | 'error';
    refStatuses: Array<{
        refName: string;
        status: 'ok' | 'ng';
        message?: string;
    }>;
}
/**
 * Zero SHA used for ref creation/deletion.
 */
export declare const ZERO_SHA = "0000000000000000000000000000000000000000";
/**
 * Known Git capabilities.
 */
export declare const CAPABILITIES: {
    readonly MULTI_ACK: "multi_ack";
    readonly MULTI_ACK_DETAILED: "multi_ack_detailed";
    readonly NO_DONE: "no-done";
    readonly THIN_PACK: "thin-pack";
    readonly SIDE_BAND: "side-band";
    readonly SIDE_BAND_64K: "side-band-64k";
    readonly OFS_DELTA: "ofs-delta";
    readonly SHALLOW: "shallow";
    readonly DEEPEN_SINCE: "deepen-since";
    readonly DEEPEN_NOT: "deepen-not";
    readonly DEEPEN_RELATIVE: "deepen-relative";
    readonly NO_PROGRESS: "no-progress";
    readonly INCLUDE_TAG: "include-tag";
    readonly REPORT_STATUS: "report-status";
    readonly DELETE_REFS: "delete-refs";
    readonly QUIET: "quiet";
    readonly ATOMIC: "atomic";
    readonly PUSH_OPTIONS: "push-options";
    readonly ALLOW_TIP_SHA1_IN_WANT: "allow-tip-sha1-in-want";
    readonly ALLOW_REACHABLE_SHA1_IN_WANT: "allow-reachable-sha1-in-want";
    readonly SYMREF: "symref";
    readonly AGENT: "agent";
};
/**
 * Side-band channel IDs.
 */
export declare const SIDE_BAND: {
    readonly DATA: 1;
    readonly PROGRESS: 2;
    readonly ERROR: 3;
};
/**
 * Encode a line in pkt-line format.
 */
export declare function encodePktLine(data: string | Uint8Array): Uint8Array;
/**
 * Create a flush packet.
 */
export declare function flushPkt(): Uint8Array;
/**
 * Create a delimiter packet (protocol v2).
 */
export declare function delimPkt(): Uint8Array;
/**
 * Create a response-end packet (protocol v2).
 */
export declare function responseEndPkt(): Uint8Array;
/**
 * Parse pkt-line data.
 */
export declare function parsePktLines(data: Uint8Array): Array<Uint8Array | null>;
/**
 * Parse a single pkt-line from data.
 */
export declare function parsePktLine(data: Uint8Array): {
    line: Uint8Array | null;
    remaining: Uint8Array;
};
/**
 * Parse capabilities from the first ref line.
 */
export declare function parseCapabilities(line: string): Capability[];
/**
 * Format capabilities for protocol negotiation.
 */
export declare function formatCapabilities(caps: Capability[]): string;
/**
 * Check if a specific capability is present.
 */
export declare function hasCapability(caps: Capability[], name: string): boolean;
/**
 * Get the value of a capability.
 */
export declare function getCapabilityValue(caps: Capability[], name: string): string | undefined;
/**
 * Parse reference advertisements from server.
 */
export declare function parseRefAdvertisements(lines: Array<Uint8Array | null>): {
    refs: RefAdvertisement[];
    capabilities: Capability[];
};
/**
 * Format reference advertisements for sending.
 */
export declare function formatRefAdvertisements(refs: RefAdvertisement[], capabilities: Capability[]): Uint8Array[];
//# sourceMappingURL=protocol.d.ts.map