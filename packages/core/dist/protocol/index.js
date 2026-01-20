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
// =============================================================================
// Constants
// =============================================================================
/** Maximum pkt-line length (65520 bytes) */
export const MAX_PKT_LINE_LENGTH = 65520;
/** Flush packet marker */
export const FLUSH_PKT = '0000';
/** Delimiter packet marker (protocol v2) */
export const DELIM_PKT = '0001';
/** Response end packet marker (protocol v2) */
export const RESPONSE_END_PKT = '0002';
/** Common Git capabilities */
export const COMMON_CAPABILITIES = [
    'multi_ack',
    'multi_ack_detailed',
    'thin-pack',
    'side-band',
    'side-band-64k',
    'ofs-delta',
    'shallow',
    'deepen-since',
    'deepen-not',
    'deepen-relative',
    'no-progress',
    'include-tag',
    'report-status',
    'report-status-v2',
    'delete-refs',
    'quiet',
    'atomic',
    'push-options',
    'allow-tip-sha1-in-want',
    'allow-reachable-sha1-in-want',
    'filter',
    'agent',
    'object-format',
    'symref',
];
// =============================================================================
// Error Classes
// =============================================================================
/** Base error for wire protocol issues */
export class WireProtocolError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WireProtocolError';
    }
}
/** Error for pkt-line encoding/decoding issues */
export class PktLineError extends WireProtocolError {
    constructor(message) {
        super(message);
        this.name = 'PktLineError';
    }
}
/** Error for capability parsing issues */
export class CapabilityError extends WireProtocolError {
    constructor(message) {
        super(message);
        this.name = 'CapabilityError';
    }
}
/** Error for negotiation issues */
export class NegotiationError extends WireProtocolError {
    constructor(message) {
        super(message);
        this.name = 'NegotiationError';
    }
}
/** Side-band channel numbers */
export var SideBandChannel;
(function (SideBandChannel) {
    SideBandChannel[SideBandChannel["PackData"] = 1] = "PackData";
    SideBandChannel[SideBandChannel["Progress"] = 2] = "Progress";
    SideBandChannel[SideBandChannel["Error"] = 3] = "Error";
})(SideBandChannel || (SideBandChannel = {}));
// =============================================================================
// Pkt-line Encoding/Decoding
// =============================================================================
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function encodePktLine(data) {
    const isString = typeof data === 'string';
    const bytes = isString ? encoder.encode(data) : data;
    const totalLength = 4 + bytes.length;
    if (totalLength > MAX_PKT_LINE_LENGTH) {
        throw new PktLineError(`Pkt-line data exceeds maximum length: ${totalLength} > ${MAX_PKT_LINE_LENGTH}`);
    }
    const lengthHex = totalLength.toString(16).padStart(4, '0');
    if (isString) {
        return lengthHex + data;
    }
    else {
        const result = new Uint8Array(totalLength);
        result.set(encoder.encode(lengthHex), 0);
        result.set(bytes, 4);
        return result;
    }
}
/**
 * Decode a pkt-line from input.
 */
export function decodePktLine(input) {
    const isString = typeof input === 'string';
    const str = isString ? input : decoder.decode(input);
    // Need at least 4 bytes for length
    if (str.length < 4) {
        return { type: 'incomplete', data: null, bytesConsumed: 0 };
    }
    const lengthHex = str.slice(0, 4);
    // Check for special packets
    if (lengthHex === FLUSH_PKT) {
        return { type: 'flush', data: null, bytesConsumed: 4 };
    }
    if (lengthHex === DELIM_PKT) {
        return { type: 'delim', data: null, bytesConsumed: 4 };
    }
    if (lengthHex === RESPONSE_END_PKT) {
        return { type: 'response-end', data: null, bytesConsumed: 4 };
    }
    // Parse length
    if (!/^[0-9a-fA-F]{4}$/.test(lengthHex)) {
        throw new PktLineError(`Invalid pkt-line length hex: "${lengthHex}"`);
    }
    const length = parseInt(lengthHex, 16);
    // Reserved length
    if (length === 3) {
        throw new PktLineError('Reserved pkt-line length 0003');
    }
    // Validate length
    if (length > MAX_PKT_LINE_LENGTH) {
        throw new PktLineError(`Pkt-line length exceeds maximum: ${length} > ${MAX_PKT_LINE_LENGTH}`);
    }
    // Empty data packet
    if (length === 4) {
        return { type: 'data', data: '', bytesConsumed: 4 };
    }
    // Check if we have enough data
    if (str.length < length) {
        return { type: 'incomplete', data: null, bytesConsumed: 0 };
    }
    const data = str.slice(4, length);
    return { type: 'data', data, bytesConsumed: length };
}
/**
 * Decode a stream of pkt-lines.
 */
export function decodePktLineStream(input) {
    const str = typeof input === 'string' ? input : decoder.decode(input);
    const packets = [];
    let offset = 0;
    while (offset < str.length) {
        const result = decodePktLine(str.slice(offset));
        if (result.type === 'incomplete') {
            break;
        }
        packets.push(result);
        offset += result.bytesConsumed;
    }
    return {
        packets,
        remaining: str.slice(offset),
    };
}
/**
 * Encode a flush packet.
 */
export function encodeFlushPkt() {
    return FLUSH_PKT;
}
/**
 * Encode a delimiter packet.
 */
export function encodeDelimPkt() {
    return DELIM_PKT;
}
/**
 * Encode a response-end packet.
 */
export function encodeResponseEndPkt() {
    return RESPONSE_END_PKT;
}
// =============================================================================
// Reference Advertisement
// =============================================================================
const SHA_REGEX = /^[0-9a-fA-F]{40}$/;
/**
 * Parse a reference advertisement line.
 */
export function parseRefAdvertisement(line, isFirst) {
    const trimmed = line.trim();
    let refPart = trimmed;
    let capsPart = '';
    // Check for capabilities on first line
    if (isFirst && trimmed.includes('\0')) {
        const nulIndex = trimmed.indexOf('\0');
        refPart = trimmed.slice(0, nulIndex);
        capsPart = trimmed.slice(nulIndex + 1);
    }
    // Parse SHA and ref
    const spaceIndex = refPart.indexOf(' ');
    if (spaceIndex === -1) {
        throw new WireProtocolError(`Malformed ref line: "${line}"`);
    }
    const sha = refPart.slice(0, spaceIndex).toLowerCase();
    const ref = refPart.slice(spaceIndex + 1);
    if (!SHA_REGEX.test(sha)) {
        throw new WireProtocolError(`Invalid SHA in ref line: "${sha}"`);
    }
    if (!ref) {
        throw new WireProtocolError(`Missing ref name in line: "${line}"`);
    }
    const result = { sha, ref };
    if (capsPart) {
        result.capabilities = parseCapabilities(capsPart);
    }
    if (ref.endsWith('^{}')) {
        result.peeled = true;
    }
    return result;
}
/**
 * Format reference advertisement as pkt-lines.
 */
export function formatRefAdvertisement(refs, capabilities) {
    const lines = [];
    if (refs.length === 0) {
        // Empty repository - send capabilities line
        const capsStr = capabilities ? ' ' + formatCapabilities(capabilities) : '';
        const line = `${'0'.repeat(40)} capabilities^{}\0${capsStr.trim()}\n`;
        lines.push(encodePktLine(line));
    }
    else {
        for (let i = 0; i < refs.length; i++) {
            const { sha, ref } = refs[i];
            let line = `${sha} ${ref}`;
            if (i === 0 && capabilities) {
                line += '\0' + formatCapabilities(capabilities);
            }
            line += '\n';
            lines.push(encodePktLine(line));
        }
    }
    lines.push(FLUSH_PKT);
    return lines.join('');
}
// =============================================================================
// Capabilities
// =============================================================================
/**
 * Parse space-separated capabilities string.
 */
export function parseCapabilities(capString) {
    const caps = new Map();
    const parts = capString.trim().split(/\s+/).filter(Boolean);
    for (const part of parts) {
        const eqIndex = part.indexOf('=');
        if (eqIndex === -1) {
            caps.set(part, true);
        }
        else {
            const key = part.slice(0, eqIndex);
            const value = part.slice(eqIndex + 1);
            caps.set(key, value);
        }
    }
    return caps;
}
/**
 * Format capabilities as space-separated string.
 */
export function formatCapabilities(caps) {
    const parts = [];
    for (const [key, value] of caps) {
        if (value === false)
            continue;
        if (value === true) {
            parts.push(key);
        }
        else {
            parts.push(`${key}=${value}`);
        }
    }
    return parts.join(' ');
}
/**
 * Parse a capability line (ref part + capabilities after NUL).
 */
export function parseCapabilityLine(line) {
    const nulIndex = line.indexOf('\0');
    if (nulIndex === -1) {
        return { refPart: line, capabilities: new Map() };
    }
    return {
        refPart: line.slice(0, nulIndex),
        capabilities: parseCapabilities(line.slice(nulIndex + 1)),
    };
}
// =============================================================================
// Want/Have Negotiation
// =============================================================================
/**
 * Parse a want line.
 */
export function parseWantLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('want ')) {
        throw new NegotiationError(`Invalid want line: "${line}"`);
    }
    const rest = trimmed.slice(5);
    const spaceIndex = rest.indexOf(' ');
    let sha;
    let capabilities;
    if (spaceIndex === -1) {
        sha = rest.toLowerCase();
    }
    else {
        sha = rest.slice(0, spaceIndex).toLowerCase();
        capabilities = parseCapabilities(rest.slice(spaceIndex + 1));
    }
    if (!SHA_REGEX.test(sha)) {
        throw new NegotiationError(`Invalid SHA in want line: "${sha}"`);
    }
    return capabilities ? { sha, capabilities } : { sha };
}
/**
 * Parse a have line.
 */
export function parseHaveLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('have ')) {
        throw new NegotiationError(`Invalid have line: "${line}"`);
    }
    const sha = trimmed.slice(5).toLowerCase();
    if (!SHA_REGEX.test(sha)) {
        throw new NegotiationError(`Invalid SHA in have line: "${sha}"`);
    }
    return { sha };
}
/**
 * Format a want line.
 */
export function formatWantLine(sha, capabilities) {
    const normalizedSha = sha.toLowerCase();
    let line = `want ${normalizedSha}`;
    if (capabilities && capabilities.size > 0) {
        line += ' ' + formatCapabilities(capabilities);
    }
    return line + '\n';
}
/**
 * Format a have line.
 */
export function formatHaveLine(sha) {
    return `have ${sha.toLowerCase()}\n`;
}
// =============================================================================
// ACK/NAK Responses
// =============================================================================
const VALID_ACK_STATUSES = ['continue', 'common', 'ready'];
/**
 * Parse an ACK or NAK response.
 */
export function parseAckNak(line) {
    const trimmed = line.trim();
    if (trimmed === 'NAK') {
        return { type: 'NAK' };
    }
    if (!trimmed.startsWith('ACK ')) {
        throw new NegotiationError(`Invalid ACK/NAK response: "${line}"`);
    }
    const rest = trimmed.slice(4);
    const parts = rest.split(' ');
    if (parts.length === 0 || !parts[0]) {
        throw new NegotiationError(`ACK missing SHA: "${line}"`);
    }
    const sha = parts[0].toLowerCase();
    if (!SHA_REGEX.test(sha)) {
        throw new NegotiationError(`Invalid SHA in ACK: "${sha}"`);
    }
    const result = { type: 'ACK', sha };
    if (parts.length > 1) {
        const status = parts[1];
        if (!VALID_ACK_STATUSES.includes(status)) {
            throw new NegotiationError(`Invalid ACK status: "${status}"`);
        }
        result.status = status;
    }
    return result;
}
/**
 * Format an ACK response.
 */
export function formatAck(sha) {
    return `ACK ${sha}\n`;
}
/**
 * Format an ACK continue response.
 */
export function formatAckContinue(sha) {
    return `ACK ${sha} continue\n`;
}
/**
 * Format an ACK common response.
 */
export function formatAckCommon(sha) {
    return `ACK ${sha} common\n`;
}
/**
 * Format an ACK ready response.
 */
export function formatAckReady(sha) {
    return `ACK ${sha} ready\n`;
}
/**
 * Format a NAK response.
 */
export function formatNak() {
    return 'NAK\n';
}
// =============================================================================
// Side-band Demultiplexing
// =============================================================================
/**
 * Parse a side-band packet.
 */
export function parseSideBandPacket(data) {
    if (data.length === 0) {
        throw new WireProtocolError('Empty side-band packet');
    }
    const channel = data[0];
    if (channel < 1 || channel > 3) {
        throw new WireProtocolError(`Invalid side-band channel: ${channel}`);
    }
    return {
        channel,
        data: data.slice(1),
    };
}
/**
 * Format a side-band packet.
 */
export function formatSideBandPacket(channel, data) {
    const result = new Uint8Array(1 + data.length);
    result[0] = channel;
    result.set(data, 1);
    return result;
}
/**
 * Demultiplex a side-band stream.
 */
export function demultiplexSideBand(stream) {
    const packChunks = [];
    const progress = [];
    const errors = [];
    const str = decoder.decode(stream);
    const { packets } = decodePktLineStream(str);
    for (const packet of packets) {
        if (packet.type === 'flush')
            continue;
        if (packet.type !== 'data' || !packet.data)
            continue;
        const data = encoder.encode(packet.data);
        if (data.length === 0)
            continue;
        const channel = data[0];
        const payload = data.slice(1);
        switch (channel) {
            case SideBandChannel.PackData:
                packChunks.push(payload);
                break;
            case SideBandChannel.Progress:
                progress.push(decoder.decode(payload));
                break;
            case SideBandChannel.Error:
                errors.push(decoder.decode(payload));
                break;
        }
    }
    // Concatenate pack data chunks
    const totalLength = packChunks.reduce((sum, c) => sum + c.length, 0);
    const packData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of packChunks) {
        packData.set(chunk, offset);
        offset += chunk.length;
    }
    return { packData, progress, errors };
}
// =============================================================================
// Shallow/Unshallow
// =============================================================================
/**
 * Parse a shallow line.
 */
export function parseShallowLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('shallow ')) {
        throw new WireProtocolError(`Invalid shallow line: "${line}"`);
    }
    const sha = trimmed.slice(8).toLowerCase();
    if (!SHA_REGEX.test(sha)) {
        throw new WireProtocolError(`Invalid SHA in shallow line: "${sha}"`);
    }
    return { type: 'shallow', sha };
}
/**
 * Parse an unshallow line.
 */
export function parseUnshallowLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('unshallow ')) {
        throw new WireProtocolError(`Invalid unshallow line: "${line}"`);
    }
    const sha = trimmed.slice(10).toLowerCase();
    if (!SHA_REGEX.test(sha)) {
        throw new WireProtocolError(`Invalid SHA in unshallow line: "${sha}"`);
    }
    return { type: 'unshallow', sha };
}
/**
 * Format a shallow line.
 */
export function formatShallowLine(sha) {
    return `shallow ${sha.toLowerCase()}\n`;
}
/**
 * Format an unshallow line.
 */
export function formatUnshallowLine(sha) {
    return `unshallow ${sha.toLowerCase()}\n`;
}
// =============================================================================
// Info/Refs Response
// =============================================================================
/**
 * Parse an info/refs response.
 */
export function parseInfoRefsResponse(response) {
    const { packets } = decodePktLineStream(response);
    let service = '';
    const refs = [];
    let capabilities = new Map();
    let afterServiceFlush = false;
    let isFirstRef = true;
    for (const packet of packets) {
        if (packet.type === 'flush') {
            if (!afterServiceFlush) {
                afterServiceFlush = true;
            }
            continue;
        }
        if (packet.type !== 'data' || !packet.data)
            continue;
        const line = packet.data.trim();
        // Parse service announcement
        if (!afterServiceFlush && line.startsWith('# service=')) {
            service = line.slice(10);
            continue;
        }
        if (!afterServiceFlush) {
            throw new WireProtocolError(`Invalid service line: "${line}"`);
        }
        // Parse ref lines
        const ref = parseRefAdvertisement(line, isFirstRef);
        if (isFirstRef && ref.capabilities) {
            capabilities = ref.capabilities;
        }
        // Skip capabilities-only line for empty repo
        if (ref.ref !== 'capabilities^{}') {
            refs.push(ref);
        }
        isFirstRef = false;
    }
    if (!service) {
        throw new WireProtocolError('Missing service announcement');
    }
    if (!afterServiceFlush) {
        throw new WireProtocolError('Missing service flush packet');
    }
    return { service, refs, capabilities };
}
/**
 * Format an info/refs response.
 */
export function formatInfoRefsResponse(info) {
    const lines = [];
    // Service announcement
    const serviceLine = `# service=${info.service}\n`;
    lines.push(encodePktLine(serviceLine));
    lines.push(FLUSH_PKT);
    // Refs
    lines.push(formatRefAdvertisement(info.refs, info.capabilities));
    return lines.join('');
}
// =============================================================================
// Upload-Pack Request
// =============================================================================
/**
 * Parse an upload-pack request.
 */
export function parseUploadPackRequest(request) {
    const { packets } = decodePktLineStream(request);
    const wants = [];
    const haves = [];
    const shallows = [];
    let capabilities = new Map();
    let done = false;
    let depth;
    let deepenSince;
    const deepenNot = [];
    let filter;
    let isFirstWant = true;
    for (const packet of packets) {
        if (packet.type === 'flush')
            continue;
        if (packet.type !== 'data' || !packet.data)
            continue;
        const line = packet.data.trim();
        if (line.startsWith('want ')) {
            const want = parseWantLine(line);
            wants.push(want.sha);
            if (isFirstWant && want.capabilities) {
                capabilities = want.capabilities;
            }
            isFirstWant = false;
        }
        else if (line.startsWith('have ')) {
            const have = parseHaveLine(line);
            haves.push(have.sha);
        }
        else if (line.startsWith('shallow ')) {
            const shallow = parseShallowLine(line);
            shallows.push(shallow.sha);
        }
        else if (line === 'done') {
            done = true;
        }
        else if (line.startsWith('deepen ')) {
            depth = parseInt(line.slice(7), 10);
        }
        else if (line.startsWith('deepen-since ')) {
            deepenSince = parseInt(line.slice(13), 10);
        }
        else if (line.startsWith('deepen-not ')) {
            deepenNot.push(line.slice(11));
        }
        else if (line.startsWith('filter ')) {
            filter = line.slice(7);
        }
    }
    const result = { wants, haves, capabilities, done };
    if (depth !== undefined)
        result.depth = depth;
    if (deepenSince !== undefined)
        result.deepenSince = deepenSince;
    if (deepenNot.length > 0)
        result.deepenNot = deepenNot;
    if (shallows.length > 0)
        result.shallows = shallows;
    if (filter)
        result.filter = filter;
    return result;
}
/**
 * Format an upload-pack request.
 */
export function formatUploadPackRequest(request) {
    const lines = [];
    // Wants (capabilities on first)
    for (let i = 0; i < request.wants.length; i++) {
        const sha = request.wants[i];
        const caps = i === 0 ? request.capabilities : undefined;
        lines.push(encodePktLine(formatWantLine(sha, caps)));
    }
    // Shallows
    if (request.shallows) {
        for (const sha of request.shallows) {
            lines.push(encodePktLine(formatShallowLine(sha)));
        }
    }
    // Deepen
    if (request.depth !== undefined) {
        lines.push(encodePktLine(`deepen ${request.depth}\n`));
    }
    if (request.deepenSince !== undefined) {
        lines.push(encodePktLine(`deepen-since ${request.deepenSince}\n`));
    }
    if (request.deepenNot) {
        for (const ref of request.deepenNot) {
            lines.push(encodePktLine(`deepen-not ${ref}\n`));
        }
    }
    // Filter
    if (request.filter) {
        lines.push(encodePktLine(`filter ${request.filter}\n`));
    }
    // Flush after wants
    lines.push(FLUSH_PKT);
    // Haves
    for (const sha of request.haves) {
        lines.push(encodePktLine(formatHaveLine(sha)));
    }
    // Done
    if (request.done) {
        lines.push(encodePktLine('done\n'));
    }
    return lines.join('');
}
// =============================================================================
// Receive-Pack Request
// =============================================================================
/**
 * Determine ref update type from old/new SHA.
 */
function getRefUpdateType(oldSha, newSha) {
    const zeroSha = '0'.repeat(40);
    if (oldSha === zeroSha)
        return 'create';
    if (newSha === zeroSha)
        return 'delete';
    return 'update';
}
/**
 * Parse a receive-pack request.
 */
export function parseReceivePackRequest(request) {
    const str = typeof request === 'string' ? request : decoder.decode(request);
    const { packets } = decodePktLineStream(str);
    const commands = [];
    let capabilities = new Map();
    let isFirstCommand = true;
    let pushOptions;
    let inPushOptions = false;
    for (const packet of packets) {
        if (packet.type === 'flush') {
            if (!inPushOptions && capabilities.has('push-options')) {
                inPushOptions = true;
                continue;
            }
            break;
        }
        if (packet.type !== 'data' || !packet.data)
            continue;
        const line = packet.data.trim();
        if (inPushOptions) {
            if (!pushOptions)
                pushOptions = [];
            pushOptions.push(line);
            continue;
        }
        // Parse command line
        const { refPart, capabilities: lineCaps } = parseCapabilityLine(line);
        if (isFirstCommand) {
            capabilities = lineCaps;
            isFirstCommand = false;
        }
        // Parse old-sha new-sha ref
        const parts = refPart.split(' ');
        if (parts.length !== 3) {
            throw new WireProtocolError(`Invalid command line: "${line}"`);
        }
        const [oldSha, newSha, ref] = parts;
        commands.push({
            oldSha: oldSha.toLowerCase(),
            newSha: newSha.toLowerCase(),
            ref,
            type: getRefUpdateType(oldSha, newSha),
        });
    }
    // Check for packfile after commands
    let packfile;
    if (typeof request !== 'string') {
        const packStart = findPackStart(request);
        if (packStart !== -1) {
            packfile = request.slice(packStart);
        }
    }
    const result = { commands, capabilities };
    if (packfile)
        result.packfile = packfile;
    if (pushOptions)
        result.pushOptions = pushOptions;
    return result;
}
/**
 * Format a receive-pack request.
 */
export function formatReceivePackRequest(request) {
    const lines = [];
    // Commands (capabilities on first)
    for (let i = 0; i < request.commands.length; i++) {
        const cmd = request.commands[i];
        let line = `${cmd.oldSha} ${cmd.newSha} ${cmd.ref}`;
        if (i === 0 && request.capabilities.size > 0) {
            line += '\0' + formatCapabilities(request.capabilities);
        }
        line += '\n';
        lines.push(encodePktLine(line));
    }
    lines.push(FLUSH_PKT);
    // Push options
    if (request.pushOptions && request.pushOptions.length > 0) {
        for (const option of request.pushOptions) {
            lines.push(encodePktLine(option + '\n'));
        }
        lines.push(FLUSH_PKT);
    }
    return lines.join('');
}
// =============================================================================
// Helpers
// =============================================================================
/**
 * Find the start of a packfile in a buffer.
 */
function findPackStart(data) {
    // Look for "PACK" magic
    const packMagic = [0x50, 0x41, 0x43, 0x4b]; // "PACK"
    for (let i = 0; i < data.length - 4; i++) {
        if (data[i] === packMagic[0] &&
            data[i + 1] === packMagic[1] &&
            data[i + 2] === packMagic[2] &&
            data[i + 3] === packMagic[3]) {
            return i;
        }
    }
    return -1;
}
//# sourceMappingURL=index.js.map