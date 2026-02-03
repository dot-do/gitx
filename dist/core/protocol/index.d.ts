/**
 * @fileoverview Git Wire Protocol Implementation
 *
 * This module implements the Git smart HTTP wire protocol for
 * clone, fetch, and push operations.
 *
 * Protocol overview:
 * - Pkt-line format: 4-hex-digit length prefix + data
 * - Special packets: flush (0000), delim (0001), response-end (0002)
 * - Reference advertisement with capabilities
 * - Want/have negotiation for pack file generation
 * - Side-band multiplexing for progress and error messages
 */
/** Maximum pkt-line length (65520 bytes) */
export declare const MAX_PKT_LINE_LENGTH = 65520;
/** Flush packet marker */
export declare const FLUSH_PKT = "0000";
/** Delimiter packet marker (protocol v2) */
export declare const DELIM_PKT = "0001";
/** Response end packet marker (protocol v2) */
export declare const RESPONSE_END_PKT = "0002";
/** Common Git capabilities */
export declare const COMMON_CAPABILITIES: readonly ["multi_ack", "multi_ack_detailed", "thin-pack", "side-band", "side-band-64k", "ofs-delta", "shallow", "deepen-since", "deepen-not", "deepen-relative", "no-progress", "include-tag", "report-status", "report-status-v2", "delete-refs", "quiet", "atomic", "push-options", "allow-tip-sha1-in-want", "allow-reachable-sha1-in-want", "filter", "agent", "object-format", "symref"];
/** Base error for wire protocol issues */
export declare class WireProtocolError extends Error {
    constructor(message: string);
}
/** Error for pkt-line encoding/decoding issues */
export declare class PktLineError extends WireProtocolError {
    constructor(message: string);
}
/** Error for capability parsing issues */
export declare class CapabilityError extends WireProtocolError {
    constructor(message: string);
}
/** Error for negotiation issues */
export declare class NegotiationError extends WireProtocolError {
    constructor(message: string);
}
/** Git wire protocol version (v1 or v2) */
export type ProtocolVersion = 1 | 2;
/** Pkt-line input type (string or binary) */
export type PktLineInput = string | Uint8Array;
/** Capability value (true for presence, string for key=value) */
export type CapabilityValue = boolean | string;
/** Capability map */
export type Capabilities = Map<string, CapabilityValue>;
/** Reference line in advertisement */
export interface RefLine {
    sha: string;
    ref: string;
    capabilities?: Capabilities;
    peeled?: boolean;
}
/** Reference advertisement */
export interface RefAdvertisement extends RefLine {
}
/** Decoded pkt-line result */
export interface DecodedPktLine {
    type: 'data' | 'flush' | 'delim' | 'response-end' | 'incomplete';
    data: string | null;
    bytesConsumed: number;
}
/** Decoded pkt-line stream result */
export interface DecodedPktLineStream {
    packets: DecodedPktLine[];
    remaining: string | Uint8Array;
}
/** Want line in negotiation */
export interface WantLine {
    sha: string;
    capabilities?: Capabilities;
}
/** Have line in negotiation */
export interface HaveLine {
    sha: string;
}
/** ACK status */
export type AckStatus = 'continue' | 'common' | 'ready';
/** ACK/NAK response */
export interface AckNakResponse {
    type: 'ACK' | 'NAK';
    sha?: string;
    status?: AckStatus;
}
/** Side-band channel numbers */
export declare enum SideBandChannel {
    PackData = 1,
    Progress = 2,
    Error = 3
}
/** Side-band packet */
export interface SideBandPacket {
    channel: SideBandChannel;
    data: Uint8Array;
}
/** Demultiplexed side-band result */
export interface DemultiplexedSideBand {
    packData: Uint8Array;
    progress: string[];
    errors: string[];
}
/** Shallow update */
export interface ShallowUpdate {
    type: 'shallow' | 'unshallow';
    sha: string;
}
/** Info/refs response */
export interface InfoRefsResponse {
    service: string;
    refs: RefLine[];
    capabilities: Capabilities;
}
/** Upload-pack request */
export interface UploadPackRequest {
    wants: string[];
    haves: string[];
    capabilities: Capabilities;
    done: boolean;
    depth?: number;
    deepenSince?: number;
    deepenNot?: string[];
    shallows?: string[];
    filter?: string;
}
/** Ref update command type */
export type RefUpdateType = 'create' | 'update' | 'delete';
/** Ref update command */
export interface RefUpdateCommand {
    oldSha: string;
    newSha: string;
    ref: string;
    type: RefUpdateType;
}
/** Receive-pack request */
export interface ReceivePackRequest {
    commands: RefUpdateCommand[];
    capabilities: Capabilities;
    packfile?: Uint8Array;
    pushOptions?: string[];
}
/** Receive-pack response status for a single ref */
export interface RefStatus {
    ref: string;
    status: 'ok' | 'ng';
    message?: string;
}
/** Receive-pack response */
export interface ReceivePackResponse {
    unpackStatus: 'ok' | string;
    refStatuses: RefStatus[];
}
/** Upload-pack response */
export interface UploadPackResponse {
    acks: AckNakResponse[];
    shallows?: ShallowUpdate[];
    packData?: Uint8Array;
    progress?: string[];
    errors?: string[];
}
/** Common capability names as constants */
export declare const CAPABILITY_NAMES: {
    readonly MULTI_ACK: "multi_ack";
    readonly MULTI_ACK_DETAILED: "multi_ack_detailed";
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
    readonly REPORT_STATUS_V2: "report-status-v2";
    readonly DELETE_REFS: "delete-refs";
    readonly QUIET: "quiet";
    readonly ATOMIC: "atomic";
    readonly PUSH_OPTIONS: "push-options";
    readonly ALLOW_TIP_SHA1_IN_WANT: "allow-tip-sha1-in-want";
    readonly ALLOW_REACHABLE_SHA1_IN_WANT: "allow-reachable-sha1-in-want";
    readonly FILTER: "filter";
    readonly AGENT: "agent";
    readonly OBJECT_FORMAT: "object-format";
    readonly SYMREF: "symref";
};
export { ZERO_SHA } from '../refs';
/**
 * Encode data as a pkt-line.
 * Returns string when given string, Uint8Array when given Uint8Array.
 */
export declare function encodePktLine(data: string): string;
export declare function encodePktLine(data: Uint8Array): Uint8Array;
/**
 * Decode a pkt-line from input.
 */
export declare function decodePktLine(input: string | Uint8Array): DecodedPktLine;
/**
 * Decode a stream of pkt-lines.
 *
 * Note: This function stops parsing when it encounters invalid pkt-line data
 * (such as raw binary data after a flush packet). The remaining unparsed data
 * is returned in the `remaining` field.
 */
export declare function decodePktLineStream(input: string | Uint8Array): DecodedPktLineStream;
/**
 * Encode a flush packet.
 */
export declare function encodeFlushPkt(): string;
/**
 * Encode a delimiter packet.
 */
export declare function encodeDelimPkt(): string;
/**
 * Encode a response-end packet.
 */
export declare function encodeResponseEndPkt(): string;
/**
 * Parse a reference advertisement line.
 */
export declare function parseRefAdvertisement(line: string, isFirst: boolean): RefAdvertisement;
/**
 * Format reference advertisement as pkt-lines.
 */
export declare function formatRefAdvertisement(refs: RefLine[], capabilities?: Capabilities): string;
/**
 * Parse space-separated capabilities string.
 */
export declare function parseCapabilities(capString: string): Capabilities;
/**
 * Format capabilities as space-separated string.
 */
export declare function formatCapabilities(caps: Capabilities): string;
/**
 * Parse a capability line (ref part + capabilities after NUL).
 */
export declare function parseCapabilityLine(line: string): {
    refPart: string;
    capabilities: Capabilities;
};
/**
 * Parse a want line.
 */
export declare function parseWantLine(line: string): WantLine;
/**
 * Parse a have line.
 */
export declare function parseHaveLine(line: string): HaveLine;
/**
 * Format a want line.
 */
export declare function formatWantLine(sha: string, capabilities?: Capabilities): string;
/**
 * Format a have line.
 */
export declare function formatHaveLine(sha: string): string;
/**
 * Parse an ACK or NAK response.
 */
export declare function parseAckNak(line: string): AckNakResponse;
/**
 * Format an ACK response.
 */
export declare function formatAck(sha: string): string;
/**
 * Format an ACK continue response.
 */
export declare function formatAckContinue(sha: string): string;
/**
 * Format an ACK common response.
 */
export declare function formatAckCommon(sha: string): string;
/**
 * Format an ACK ready response.
 */
export declare function formatAckReady(sha: string): string;
/**
 * Format a NAK response.
 */
export declare function formatNak(): string;
/**
 * Parse a side-band packet.
 */
export declare function parseSideBandPacket(data: Uint8Array): SideBandPacket;
/**
 * Format a side-band packet.
 */
export declare function formatSideBandPacket(channel: SideBandChannel, data: Uint8Array): Uint8Array;
/**
 * Demultiplex a side-band stream.
 */
export declare function demultiplexSideBand(stream: Uint8Array): DemultiplexedSideBand;
/**
 * Parse a shallow line.
 */
export declare function parseShallowLine(line: string): ShallowUpdate;
/**
 * Parse an unshallow line.
 */
export declare function parseUnshallowLine(line: string): ShallowUpdate;
/**
 * Format a shallow line.
 */
export declare function formatShallowLine(sha: string): string;
/**
 * Format an unshallow line.
 */
export declare function formatUnshallowLine(sha: string): string;
/**
 * Parse an info/refs response.
 */
export declare function parseInfoRefsResponse(response: string): InfoRefsResponse;
/**
 * Format an info/refs response.
 */
export declare function formatInfoRefsResponse(info: InfoRefsResponse): string;
/**
 * Parse an upload-pack request.
 */
export declare function parseUploadPackRequest(request: string): UploadPackRequest;
/**
 * Format an upload-pack request.
 */
export declare function formatUploadPackRequest(request: UploadPackRequest): string;
/**
 * Parse a receive-pack request.
 */
export declare function parseReceivePackRequest(request: string | Uint8Array): ReceivePackRequest;
/**
 * Format a receive-pack request.
 */
export declare function formatReceivePackRequest(request: ReceivePackRequest): string;
//# sourceMappingURL=index.d.ts.map