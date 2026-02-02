/**
 * @fileoverview Git pkt-line Protocol Implementation
 *
 * This module implements the pkt-line format used in Git's wire protocol for
 * client-server communication. The pkt-line format provides a simple framing
 * mechanism for variable-length data.
 *
 * @module wire/pkt-line
 *
 * ## Format Overview
 *
 * Each packet consists of a 4-byte hex length prefix followed by the data:
 * - Length includes the 4-byte prefix itself
 * - Maximum packet size is 65520 bytes (65516 data + 4 prefix)
 *
 * ## Special Packets
 *
 * - **flush-pkt** (`0000`): Indicates end of a message section
 * - **delim-pkt** (`0001`): Delimiter used in protocol v2
 *
 * @see {@link https://git-scm.com/docs/protocol-common#_pkt_line_format} Git pkt-line Format
 *
 * @example Basic encoding and decoding
 * ```typescript
 * import { encodePktLine, decodePktLine, FLUSH_PKT } from './wire/pkt-line'
 *
 * // Encode a message
 * const encoded = encodePktLine('hello\n')
 * // Result: '000ahello\n'
 *
 * // Decode a message
 * const decoded = decodePktLine('000ahello\n')
 * // Result: { data: 'hello\n', bytesRead: 10 }
 *
 * // Use flush packet to end a section
 * const message = encodePktLine('line1\n') + encodePktLine('line2\n') + FLUSH_PKT
 * ```
 *
 * @example Streaming multiple packets
 * ```typescript
 * import { pktLineStream } from './wire/pkt-line'
 *
 * const stream = '0009line1\n0009line2\n0000'
 * const { packets, remaining } = pktLineStream(stream)
 *
 * for (const packet of packets) {
 *   if (packet.type === 'flush') {
 *     console.log('End of section')
 *   } else {
 *     console.log('Data:', packet.data)
 *   }
 * }
 * ```
 */
/**
 * Length prefix size in bytes.
 *
 * @description
 * Every pkt-line starts with a 4-character hexadecimal length prefix
 * that indicates the total packet size (including the prefix itself).
 */
export declare const PKT_LINE_LENGTH_SIZE = 4;
/**
 * Maximum total packet size in bytes.
 *
 * @description
 * The maximum size of a complete pkt-line packet (prefix + data) is 65520 bytes.
 * This limit is defined by the Git protocol specification.
 */
export declare const MAX_PKT_LINE_SIZE = 65520;
/**
 * Maximum pkt-line data size in bytes.
 *
 * @description
 * The maximum data that can be included in a single pkt-line is 65516 bytes.
 * This is calculated as: MAX_PKT_LINE_SIZE (65520) - PKT_LINE_LENGTH_SIZE (4) = 65516.
 *
 * Attempting to encode data larger than this will result in an error
 * or require splitting into multiple packets.
 */
export declare const MAX_PKT_LINE_DATA: number;
/**
 * Flush packet - indicates end of a message section.
 *
 * @description
 * The flush packet is a special 4-byte sequence `0000` that signals
 * the end of a logical section in the protocol. It's used to:
 * - End ref advertisements
 * - Separate negotiation phases
 * - Signal end of packfile transmission
 *
 * @example
 * ```typescript
 * // Build a complete ref advertisement
 * let response = encodePktLine('# service=git-upload-pack\n')
 * response += FLUSH_PKT  // End service announcement
 * response += encodePktLine('abc123 refs/heads/main\n')
 * response += FLUSH_PKT  // End ref list
 * ```
 */
export declare const FLUSH_PKT = "0000";
/**
 * Delimiter packet - used in protocol v2.
 *
 * @description
 * The delimiter packet `0001` is used in Git protocol v2 to separate
 * sections within a single message, such as between command parameters
 * and command arguments.
 *
 * @example
 * ```typescript
 * // Protocol v2 command format
 * let request = encodePktLine('command=fetch')
 * request += encodePktLine('agent=git/2.30.0')
 * request += DELIM_PKT  // Separate metadata from arguments
 * request += encodePktLine('want abc123...')
 * request += FLUSH_PKT  // End of request
 * ```
 */
export declare const DELIM_PKT = "0001";
/**
 * Response-end packet - used in protocol v2.
 *
 * @description
 * The response-end packet `0002` is used in Git protocol v2 to indicate
 * the end of a response in stateless connections. It signals that no
 * more data will follow for this response.
 *
 * @example
 * ```typescript
 * // Protocol v2 response ending
 * let response = encodePktLine('acknowledgments\n')
 * response += encodePktLine('ACK abc123\n')
 * response += RESPONSE_END_PKT  // End of response
 * ```
 */
export declare const RESPONSE_END_PKT = "0002";
/**
 * Input type for pkt-line encoding/decoding functions.
 *
 * @description
 * Pkt-line functions accept both string and binary data:
 * - `string`: Used for text-based protocol messages
 * - `Uint8Array`: Used for binary data like packfiles
 */
export type PktLineInput = string | Uint8Array;
/**
 * Result of decoding a single pkt-line.
 *
 * @description
 * Contains the decoded data and metadata about the packet:
 * - For data packets: `data` contains the payload, `bytesRead` is the packet size
 * - For flush packets: `data` is null, `type` is 'flush', `bytesRead` is PKT_LINE_LENGTH_SIZE
 * - For delimiter packets: `data` is null, `type` is 'delim', `bytesRead` is PKT_LINE_LENGTH_SIZE
 * - For incomplete data: `data` is null, `type` is 'incomplete', `bytesRead` is 0
 */
export interface DecodedPktLine {
    /** The decoded data payload, or null for special/incomplete packets */
    data: string | null;
    /** Packet type for special packets: 'flush', 'delim', or 'incomplete' */
    type?: 'flush' | 'delim' | 'incomplete';
    /** Number of bytes consumed from the input */
    bytesRead: number;
}
/**
 * A single packet in a pkt-line stream.
 *
 * @description
 * Represents one packet parsed from a stream:
 * - `data`: Packets with payload have `type: 'data'` and non-null `data`
 * - `flush`: Special packet with `type: 'flush'` and null `data`
 * - `delim`: Special packet with `type: 'delim'` and null `data`
 */
export interface StreamPacket {
    /** The packet data, or null for special packets */
    data: string | null;
    /** The packet type */
    type: 'data' | 'flush' | 'delim';
}
/**
 * Result of parsing a pkt-line stream.
 *
 * @description
 * Contains all successfully parsed packets and any remaining unparsed data.
 * The `remaining` field is useful for streaming scenarios where data arrives
 * in chunks and a packet might be split across chunks.
 */
export interface PktLineStreamResult {
    /** Array of parsed packets */
    packets: StreamPacket[];
    /** Any remaining unparsed data (incomplete packet) */
    remaining: string;
}
/**
 * Encode data into pkt-line format.
 *
 * @description
 * Encodes the given data with a 4-character hex length prefix. The length
 * includes the 4-byte prefix itself, so a 6-byte payload results in a
 * 10-byte packet with prefix "000a".
 *
 * For binary data containing non-printable characters, returns a Uint8Array.
 * For text data, returns a string for easier concatenation.
 *
 * @param data - The data to encode (string or Uint8Array)
 * @returns Encoded pkt-line as string (for text) or Uint8Array (for binary)
 *
 * @throws {Error} If data exceeds MAX_PKT_LINE_DATA bytes
 *
 * @example Encoding text data
 * ```typescript
 * const line = encodePktLine('hello\n')
 * // Result: '000ahello\n'
 * // Length: 4 (prefix) + 6 (data) = 10 = 0x000a
 * ```
 *
 * @example Encoding binary data
 * ```typescript
 * const binaryData = new Uint8Array([0x01, 0x02, 0x03])
 * const encoded = encodePktLine(binaryData)
 * // Result: Uint8Array with hex prefix + data
 * ```
 *
 * @example Building a multi-line message
 * ```typescript
 * let message = ''
 * message += encodePktLine('want abc123...\n') as string
 * message += encodePktLine('have def456...\n') as string
 * message += FLUSH_PKT
 * ```
 */
export declare function encodePktLine(data: PktLineInput): string | Uint8Array;
/**
 * Decode a pkt-line format message.
 *
 * @description
 * Parses a single pkt-line from the input and returns the decoded data
 * along with metadata about the packet. Handles special packets (flush,
 * delim) and incomplete data gracefully.
 *
 * The function validates packet size to prevent denial-of-service attacks
 * from maliciously large length values.
 *
 * @param input - The input to decode (string or Uint8Array)
 * @returns Object with decoded data, packet type (if special), and bytes consumed
 *
 * @throws {Error} If packet size exceeds MAX_PKT_LINE_SIZE (65520 bytes)
 *
 * @example Decoding a data packet
 * ```typescript
 * const result = decodePktLine('000ahello\n')
 * // result.data === 'hello\n'
 * // result.bytesRead === 10
 * // result.type === undefined (data packet)
 * ```
 *
 * @example Decoding a flush packet
 * ```typescript
 * const result = decodePktLine('0000remaining...')
 * // result.data === null
 * // result.type === 'flush'
 * // result.bytesRead === 4
 * ```
 *
 * @example Handling incomplete data
 * ```typescript
 * const result = decodePktLine('00')  // Not enough for length prefix
 * // result.data === null
 * // result.type === 'incomplete'
 * // result.bytesRead === 0
 * ```
 */
export declare function decodePktLine(input: PktLineInput): DecodedPktLine;
/**
 * Create a flush-pkt (0000).
 *
 * @description
 * Returns the flush packet constant. Primarily useful for explicit intent
 * in code, as you can also use FLUSH_PKT directly.
 *
 * The flush packet signals the end of a logical section in the protocol.
 *
 * @returns The flush packet string '0000'
 *
 * @example
 * ```typescript
 * // These are equivalent:
 * const flush1 = encodeFlushPkt()
 * const flush2 = FLUSH_PKT
 *
 * // Using in a message
 * const message = encodePktLine('data\n') + encodeFlushPkt()
 * ```
 */
export declare function encodeFlushPkt(): string;
/**
 * Create a delim-pkt (0001).
 *
 * @description
 * Returns the delimiter packet constant. The delimiter packet is used
 * in Git protocol v2 to separate sections within a command.
 *
 * @returns The delimiter packet string '0001'
 *
 * @example
 * ```typescript
 * // Protocol v2 ls-refs command
 * let request = encodePktLine('command=ls-refs')
 * request += encodeDelimPkt()  // Separator
 * request += encodePktLine('ref-prefix refs/heads/')
 * request += encodeFlushPkt()  // End
 * ```
 */
export declare function encodeDelimPkt(): string;
/**
 * Create a response-end-pkt (0002).
 *
 * @description
 * Returns the response-end packet constant. The response-end packet is used
 * in Git protocol v2 to indicate the end of a response in stateless connections.
 *
 * @returns The response-end packet string '0002'
 *
 * @example
 * ```typescript
 * // Protocol v2 response ending
 * let response = encodePktLine('acknowledgments\n')
 * response += encodePktLine('ACK abc123\n')
 * response += encodeResponseEndPkt()  // End of response
 * ```
 */
export declare function encodeResponseEndPkt(): string;
/**
 * Parse a stream of pkt-lines.
 *
 * @description
 * Parses multiple pkt-lines from an input stream, returning all complete
 * packets and any remaining unparsed data. This is useful for:
 * - Processing multi-packet messages
 * - Handling streaming data that arrives in chunks
 * - Parsing complete protocol exchanges
 *
 * The function continues parsing until it encounters incomplete data
 * or reaches the end of input.
 *
 * @param input - The input stream to parse (string or Uint8Array)
 * @returns Object with parsed packets and any remaining unparsed data
 *
 * @example Parsing a complete message
 * ```typescript
 * const stream = '0009line1\n0009line2\n0000'
 * const { packets, remaining } = pktLineStream(stream)
 *
 * // packets = [
 * //   { data: 'line1\n', type: 'data' },
 * //   { data: 'line2\n', type: 'data' },
 * //   { data: null, type: 'flush' }
 * // ]
 * // remaining = ''
 * ```
 *
 * @example Handling chunked data
 * ```typescript
 * // First chunk arrives
 * let buffer = '0009line1\n00'  // Incomplete second packet
 * let result = pktLineStream(buffer)
 * // result.packets = [{ data: 'line1\n', type: 'data' }]
 * // result.remaining = '00'
 *
 * // Second chunk arrives
 * buffer = result.remaining + '09line2\n0000'
 * result = pktLineStream(buffer)
 * // result.packets = [
 * //   { data: 'line2\n', type: 'data' },
 * //   { data: null, type: 'flush' }
 * // ]
 * ```
 *
 * @example Processing ref advertisement
 * ```typescript
 * const refAdvert = '001e# service=git-upload-pack\n0000' +
 *                   '003fabc123... refs/heads/main\x00side-band-64k\n0000'
 *
 * const { packets } = pktLineStream(refAdvert)
 * for (const pkt of packets) {
 *   if (pkt.type === 'flush') {
 *     console.log('--- Section end ---')
 *   } else if (pkt.data) {
 *     console.log('Line:', pkt.data.trim())
 *   }
 * }
 * ```
 */
export declare function pktLineStream(input: PktLineInput): PktLineStreamResult;
//# sourceMappingURL=pkt-line.d.ts.map