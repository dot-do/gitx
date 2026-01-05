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
export declare const FLUSH_PKT = "0000";
/** Delimiter packet - used in protocol v2 */
export declare const DELIM_PKT = "0001";
/** Maximum pkt-line data size (65516 bytes = 65520 - 4 for length prefix) */
export declare const MAX_PKT_LINE_DATA = 65516;
type PktLineInput = string | Uint8Array;
interface DecodedPktLine {
    data: string | null;
    type?: 'flush' | 'delim' | 'incomplete';
    bytesRead: number;
}
interface StreamPacket {
    data: string | null;
    type: 'data' | 'flush' | 'delim';
}
interface PktLineStreamResult {
    packets: StreamPacket[];
    remaining: string;
}
/**
 * Encode data into pkt-line format.
 *
 * The format is: 4 hex chars (total length including prefix) + data
 *
 * @param data - The data to encode (string or Uint8Array)
 * @returns Encoded pkt-line as string (for text) or Uint8Array (for binary with non-printable chars)
 */
export declare function encodePktLine(data: PktLineInput): string | Uint8Array;
/**
 * Decode a pkt-line format message.
 *
 * @param input - The input to decode (string or Uint8Array)
 * @returns Object with decoded data, packet type (if special), and bytes consumed
 */
export declare function decodePktLine(input: PktLineInput): DecodedPktLine;
/**
 * Create a flush-pkt (0000).
 * Used to indicate end of a message section.
 */
export declare function encodeFlushPkt(): string;
/**
 * Create a delim-pkt (0001).
 * Used as a delimiter in protocol v2.
 */
export declare function encodeDelimPkt(): string;
/**
 * Parse a stream of pkt-lines.
 *
 * @param input - The input stream to parse
 * @returns Object with parsed packets and any remaining unparsed data
 */
export declare function pktLineStream(input: PktLineInput): PktLineStreamResult;
export {};
//# sourceMappingURL=pkt-line.d.ts.map