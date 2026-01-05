/**
 * Git pkt-line protocol implementation
 *
 * The pkt-line format is used in Git's wire protocol for communication.
 * Each packet starts with a 4-byte hex length prefix (including the 4 bytes itself).
 *
 * Special packets:
 * - flush-pkt (0000): Indicates end of a message section
 * - delim-pkt (0001): Delimiter used in protocol v2
 *
 * Reference: https://git-scm.com/docs/protocol-common#_pkt_line_format
 */
/** Flush packet - indicates end of section */
export const FLUSH_PKT = '0000';
/** Delimiter packet - used in protocol v2 */
export const DELIM_PKT = '0001';
/** Maximum pkt-line data size (65516 bytes = 65520 - 4 for length prefix) */
export const MAX_PKT_LINE_DATA = 65516;
/**
 * Encode data into pkt-line format.
 *
 * The format is: 4 hex chars (total length including prefix) + data
 *
 * @param data - The data to encode (string or Uint8Array)
 * @returns Encoded pkt-line as string (for text) or Uint8Array (for binary with non-printable chars)
 */
export function encodePktLine(data) {
    if (typeof data === 'string') {
        // String encoding - simple case
        const length = 4 + data.length;
        const hexLength = length.toString(16).padStart(4, '0');
        return hexLength + data;
    }
    // Uint8Array encoding
    const length = 4 + data.length;
    const hexLength = length.toString(16).padStart(4, '0');
    // Check if data contains only printable ASCII
    const isPrintable = data.every(byte => byte >= 0x20 && byte <= 0x7e || byte === 0x0a || byte === 0x0d);
    if (isPrintable) {
        // Return as string for printable content
        return hexLength + new TextDecoder().decode(data);
    }
    // Return as Uint8Array for binary content
    const result = new Uint8Array(4 + data.length);
    const encoder = new TextEncoder();
    result.set(encoder.encode(hexLength), 0);
    result.set(data, 4);
    return result;
}
/**
 * Decode a pkt-line format message.
 *
 * @param input - The input to decode (string or Uint8Array)
 * @returns Object with decoded data, packet type (if special), and bytes consumed
 */
export function decodePktLine(input) {
    // Convert to string for easier parsing
    let str;
    if (typeof input === 'string') {
        str = input;
    }
    else {
        str = new TextDecoder().decode(input);
    }
    // Need at least 4 bytes for length prefix
    if (str.length < 4) {
        return { data: null, type: 'incomplete', bytesRead: 0 };
    }
    const hexLength = str.slice(0, 4);
    // Check for special packets
    if (hexLength === '0000') {
        return { data: null, type: 'flush', bytesRead: 4 };
    }
    if (hexLength === '0001') {
        return { data: null, type: 'delim', bytesRead: 4 };
    }
    // Parse the length
    const length = parseInt(hexLength, 16);
    if (isNaN(length) || length < 4) {
        return { data: null, type: 'incomplete', bytesRead: 0 };
    }
    // Validate packet size to prevent DoS attacks
    if (length > MAX_PKT_LINE_DATA + 4) {
        throw new Error(`Packet too large: ${length} bytes exceeds maximum ${MAX_PKT_LINE_DATA + 4}`);
    }
    // Check if we have enough data
    if (str.length < length) {
        return { data: null, type: 'incomplete', bytesRead: 0 };
    }
    // Extract data (length includes the 4-byte prefix)
    const data = str.slice(4, length);
    return { data, bytesRead: length };
}
/**
 * Create a flush-pkt (0000).
 * Used to indicate end of a message section.
 */
export function encodeFlushPkt() {
    return FLUSH_PKT;
}
/**
 * Create a delim-pkt (0001).
 * Used as a delimiter in protocol v2.
 */
export function encodeDelimPkt() {
    return DELIM_PKT;
}
/**
 * Parse a stream of pkt-lines.
 *
 * @param input - The input stream to parse
 * @returns Object with parsed packets and any remaining unparsed data
 */
export function pktLineStream(input) {
    const packets = [];
    // Convert to string for parsing
    let str;
    if (typeof input === 'string') {
        str = input;
    }
    else {
        str = new TextDecoder().decode(input);
    }
    let offset = 0;
    while (offset < str.length) {
        const remaining = str.slice(offset);
        const result = decodePktLine(remaining);
        if (result.type === 'incomplete') {
            // Return remaining unparsed data
            return { packets, remaining: remaining };
        }
        if (result.type === 'flush') {
            packets.push({ data: null, type: 'flush' });
        }
        else if (result.type === 'delim') {
            packets.push({ data: null, type: 'delim' });
        }
        else {
            packets.push({ data: result.data, type: 'data' });
        }
        offset += result.bytesRead;
    }
    return { packets, remaining: '' };
}
//# sourceMappingURL=pkt-line.js.map