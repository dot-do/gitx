/**
 * @fileoverview Git HTTP Clone Implementation
 *
 * This module implements end-to-end cloning from GitHub HTTPS URLs using
 * the Git Smart HTTP protocol. It handles:
 *
 * - Ref discovery via GET /info/refs?service=git-upload-pack
 * - Packfile negotiation via POST /git-upload-pack
 * - Packfile parsing and object extraction
 * - Object storage with SHA-1 verification
 *
 * @module clone/http-clone
 *
 * @example
 * ```typescript
 * import { cloneFromUrl } from './clone/http-clone'
 *
 * const storage = {
 *   async storeObject(type: string, data: Uint8Array): Promise<string> {
 *     // Store and return SHA-1
 *   }
 * }
 *
 * const { refs } = await cloneFromUrl('https://github.com/user/repo.git', storage)
 * console.log('Cloned refs:', refs)
 * ```
 */
import pako from 'pako';
import { pktLineStream, encodePktLine, FLUSH_PKT } from '../wire/pkt-line';
import { parsePackHeader, decodeTypeAndSize, PackObjectType, packObjectTypeToString, } from '../pack/format';
import { applyDelta } from '../pack/delta';
// ============================================================================
// Constants
// ============================================================================
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CONTENT_TYPE_UPLOAD_PACK_REQUEST = 'application/x-git-upload-pack-request';
const CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT = 'application/x-git-upload-pack-advertisement';
// ============================================================================
// Main Clone Function
// ============================================================================
/**
 * Clone a repository from a Git HTTP URL.
 *
 * @description
 * Performs an end-to-end clone operation using the Git Smart HTTP protocol:
 *
 * 1. **Ref Discovery**: GET {url}/info/refs?service=git-upload-pack
 *    - Receives list of available refs and server capabilities
 *
 * 2. **Want/Have Negotiation**: POST {url}/git-upload-pack
 *    - Sends "want" lines for all discovered refs
 *    - Receives packfile with all needed objects
 *
 * 3. **Packfile Unpacking**:
 *    - Parses packfile header and objects
 *    - Decompresses zlib-compressed data
 *    - Resolves delta objects (ofs_delta and ref_delta)
 *
 * 4. **Object Storage**:
 *    - Computes SHA-1 for each object
 *    - Stores objects via the provided storage interface
 *
 * @param url - Git repository URL (e.g., 'https://github.com/user/repo.git')
 * @param storage - Storage interface for persisting objects
 * @returns Clone result with discovered refs
 * @throws Error if the clone operation fails
 *
 * @example
 * ```typescript
 * const result = await cloneFromUrl(
 *   'https://github.com/octocat/Hello-World.git',
 *   myStorage
 * )
 * console.log('HEAD:', result.refs.get('HEAD'))
 * ```
 */
export async function cloneFromUrl(url, storage) {
    // Normalize URL (remove trailing slash)
    url = url.replace(/\/$/, '');
    // Step 1: Discover refs
    const { refs, capabilities } = await discoverRefs(url);
    if (refs.length === 0) {
        // Empty repository
        return { refs: new Map() };
    }
    // Step 2: Fetch packfile
    const packfile = await fetchPackfile(url, refs, capabilities);
    // Step 3: Unpack objects
    await unpackAndStore(packfile, storage);
    // Step 4: Build ref map
    const refMap = new Map();
    for (const ref of refs) {
        refMap.set(ref.name, ref.sha);
    }
    return { refs: refMap };
}
// ============================================================================
// Ref Discovery
// ============================================================================
/**
 * Discover refs from a Git server via Smart HTTP.
 *
 * @param url - Repository base URL
 * @returns Discovered refs and server capabilities
 */
async function discoverRefs(url) {
    const infoRefsUrl = `${url}/info/refs?service=git-upload-pack`;
    const response = await fetch(infoRefsUrl, {
        headers: {
            'User-Agent': 'gitx/1.0',
        },
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch refs: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get('Content-Type');
    if (contentType && !contentType.includes(CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT)) {
        throw new Error(`Unexpected Content-Type: ${contentType}`);
    }
    const body = await response.arrayBuffer();
    return parseRefAdvertisement(new Uint8Array(body));
}
/**
 * Parse the ref advertisement response.
 *
 * @description
 * The response format is:
 * 1. Service announcement: "# service=git-upload-pack\n"
 * 2. Flush packet: 0000
 * 3. First ref with capabilities: "<sha> <refname>\0<capabilities>\n"
 * 4. Additional refs: "<sha> <refname>\n"
 * 5. Peeled refs for tags: "<sha> <refname>^{}\n"
 * 6. Flush packet: 0000
 *
 * @param data - Raw response body
 * @returns Parsed refs and capabilities
 */
function parseRefAdvertisement(data) {
    const text = decoder.decode(data);
    const { packets } = pktLineStream(text);
    const refs = [];
    let capabilities = [];
    let isFirstRef = true;
    let pastServiceLine = false;
    for (const packet of packets) {
        if (packet.type === 'flush') {
            if (!pastServiceLine) {
                pastServiceLine = true;
            }
            continue;
        }
        if (!packet.data)
            continue;
        const line = packet.data.trim();
        // Skip service announcement line
        if (line.startsWith('# service=')) {
            continue;
        }
        // Skip empty lines
        if (!line)
            continue;
        // Parse ref line
        // Format: "<sha> <refname>[\0<capabilities>]"
        const nullIndex = line.indexOf('\x00');
        let refPart;
        let capPart;
        if (nullIndex !== -1) {
            refPart = line.slice(0, nullIndex);
            capPart = line.slice(nullIndex + 1);
        }
        else {
            refPart = line;
        }
        const spaceIndex = refPart.indexOf(' ');
        if (spaceIndex === -1)
            continue;
        const sha = refPart.slice(0, spaceIndex).toLowerCase();
        let refName = refPart.slice(spaceIndex + 1);
        // Handle symref info that might be attached to ref name
        // Format: "refs/heads/main symref=HEAD:refs/heads/main"
        const refNameSpaceIndex = refName.indexOf(' ');
        if (refNameSpaceIndex !== -1) {
            refName = refName.slice(0, refNameSpaceIndex);
        }
        // Skip peeled refs (they're just metadata for annotated tags)
        if (refName.endsWith('^{}'))
            continue;
        // Validate SHA format
        if (!/^[0-9a-f]{40}$/i.test(sha))
            continue;
        const ref = { sha, name: refName };
        if (isFirstRef && capPart) {
            capabilities = capPart.split(' ').filter((c) => c.length > 0);
            ref.capabilities = capabilities;
            isFirstRef = false;
        }
        refs.push(ref);
    }
    return { refs, capabilities };
}
// ============================================================================
// Packfile Fetching
// ============================================================================
/**
 * Fetch a packfile from the server.
 *
 * @param url - Repository base URL
 * @param refs - Refs to request
 * @param capabilities - Server capabilities to use
 * @returns Packfile binary data
 */
async function fetchPackfile(url, refs, capabilities) {
    const uploadPackUrl = `${url}/git-upload-pack`;
    // Build the request body
    const body = buildUploadPackRequest(refs, capabilities);
    const response = await fetch(uploadPackUrl, {
        method: 'POST',
        headers: {
            'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST,
            'User-Agent': 'gitx/1.0',
        },
        body,
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch packfile: ${response.status} ${response.statusText}`);
    }
    const responseBody = await response.arrayBuffer();
    return extractPackfile(new Uint8Array(responseBody));
}
/**
 * Build the upload-pack request body.
 *
 * @param refs - Refs to request (want)
 * @param serverCapabilities - Capabilities the server advertised
 * @returns Request body as Uint8Array
 */
function buildUploadPackRequest(refs, serverCapabilities) {
    // Select capabilities we want to use
    const wantedCapabilities = [
        'no-progress', // We don't need progress messages
        'ofs-delta', // Use offset deltas if available
    ].filter((cap) => serverCapabilities.includes(cap));
    // Build want lines
    let body = '';
    // Deduplicate SHAs (multiple refs might point to same commit)
    const uniqueShas = [...new Set(refs.map((r) => r.sha))];
    for (let i = 0; i < uniqueShas.length; i++) {
        const sha = uniqueShas[i];
        if (i === 0 && wantedCapabilities.length > 0) {
            // First want line includes capabilities
            body += encodePktLine(`want ${sha} ${wantedCapabilities.join(' ')}\n`);
        }
        else {
            body += encodePktLine(`want ${sha}\n`);
        }
    }
    // No haves (this is a full clone)
    body += FLUSH_PKT;
    // Signal done
    body += encodePktLine('done\n');
    return encoder.encode(body);
}
/**
 * Extract the packfile from the upload-pack response.
 *
 * @description
 * The response format is:
 * - NAK or ACK lines (pkt-line format)
 * - Packfile data (either direct or in side-band format)
 * - Flush packet
 *
 * @param response - Raw response body
 * @returns Extracted packfile data
 */
function extractPackfile(response) {
    // Parse pkt-lines to find NAK/ACK and start of pack data
    let offset = 0;
    let packStart = -1;
    while (offset < response.length) {
        // Check for PACK signature directly (some servers don't use pkt-line for pack data)
        if (response[offset] === 0x50 && // P
            response[offset + 1] === 0x41 && // A
            response[offset + 2] === 0x43 && // C
            response[offset + 3] === 0x4b // K
        ) {
            packStart = offset;
            break;
        }
        // Need at least 4 bytes for pkt-line length
        if (offset + 4 > response.length)
            break;
        const hexLength = decoder.decode(response.subarray(offset, offset + 4));
        // Check for flush packet
        if (hexLength === '0000') {
            offset += 4;
            continue;
        }
        const length = parseInt(hexLength, 16);
        if (isNaN(length) || length < 4)
            break;
        // Check if this packet contains pack data (side-band)
        const packetData = response.subarray(offset + 4, offset + length);
        // Side-band channel 1 = pack data
        if (packetData[0] === 1 && packetData.length > 1) {
            // Check if remaining data after channel byte starts with PACK
            if (packetData[1] === 0x50 && // P
                packetData[2] === 0x41 && // A
                packetData[3] === 0x43 && // C
                packetData[4] === 0x4b // K
            ) {
                // Found pack data in side-band - need to reassemble
                return reassembleSideBandPack(response, offset);
            }
        }
        offset += length;
    }
    if (packStart === -1) {
        throw new Error('No PACK signature found in response');
    }
    return response.subarray(packStart);
}
/**
 * Reassemble packfile from side-band multiplexed data.
 *
 * @param response - Full response data
 * @param startOffset - Offset where side-band pack data starts
 * @returns Reassembled packfile
 */
function reassembleSideBandPack(response, startOffset) {
    const packParts = [];
    let offset = startOffset;
    while (offset < response.length) {
        // Need at least 4 bytes for pkt-line length
        if (offset + 4 > response.length)
            break;
        const hexLength = decoder.decode(response.subarray(offset, offset + 4));
        // Check for flush packet
        if (hexLength === '0000') {
            break;
        }
        const length = parseInt(hexLength, 16);
        if (isNaN(length) || length < 5)
            break; // Need at least header + 1 byte
        const packetData = response.subarray(offset + 4, offset + length);
        // Channel 1 = pack data, Channel 2 = progress, Channel 3 = error
        const channel = packetData[0];
        const data = packetData.subarray(1);
        if (channel === 1) {
            packParts.push(data);
        }
        else if (channel === 3) {
            // Error message
            throw new Error(`Server error: ${decoder.decode(data)}`);
        }
        // Ignore channel 2 (progress)
        offset += length;
    }
    // Combine all pack parts
    const totalLength = packParts.reduce((sum, part) => sum + part.length, 0);
    const packfile = new Uint8Array(totalLength);
    let packOffset = 0;
    for (const part of packParts) {
        packfile.set(part, packOffset);
        packOffset += part.length;
    }
    return packfile;
}
// ============================================================================
// Packfile Unpacking
// ============================================================================
/**
 * Unpack a packfile and store all objects.
 *
 * @param packfile - Raw packfile data
 * @param storage - Storage interface
 */
async function unpackAndStore(packfile, storage) {
    // Parse pack header
    const header = parsePackHeader(packfile);
    // Track objects by offset for delta resolution
    const objectsByOffset = new Map();
    // Track objects by SHA for ref_delta resolution
    const objectsBySha = new Map();
    // Pending deltas that need resolution
    const pendingDeltas = [];
    // Parse all objects
    let offset = 12; // Skip 12-byte header
    for (let i = 0; i < header.objectCount; i++) {
        const objectOffset = offset;
        const extracted = extractObject(packfile, offset);
        offset = extracted.nextOffset;
        if (extracted.type === PackObjectType.OBJ_OFS_DELTA) {
            // Offset delta - needs base object from this packfile
            pendingDeltas.push({
                type: 'ofs_delta',
                baseOffset: objectOffset - extracted.baseOffset,
                deltaData: extracted.data,
                offset: objectOffset,
            });
        }
        else if (extracted.type === PackObjectType.OBJ_REF_DELTA) {
            // Ref delta - needs base object by SHA
            pendingDeltas.push({
                type: 'ref_delta',
                baseSha: extracted.baseSha,
                deltaData: extracted.data,
                offset: objectOffset,
            });
        }
        else {
            // Base object - store immediately
            objectsByOffset.set(objectOffset, {
                type: extracted.type,
                data: extracted.data,
            });
        }
    }
    // Resolve deltas (may need multiple passes for delta chains)
    let resolvedCount = 0;
    let lastResolvedCount = -1;
    while (resolvedCount !== lastResolvedCount) {
        lastResolvedCount = resolvedCount;
        for (let i = pendingDeltas.length - 1; i >= 0; i--) {
            const delta = pendingDeltas[i];
            let baseObj;
            if (delta.type === 'ofs_delta' && delta.baseOffset !== undefined) {
                baseObj = objectsByOffset.get(delta.baseOffset);
            }
            else if (delta.type === 'ref_delta' && delta.baseSha) {
                baseObj = objectsBySha.get(delta.baseSha);
            }
            if (baseObj) {
                // Apply delta
                const resolvedData = applyDelta(baseObj.data, delta.deltaData);
                const resolvedObj = {
                    type: baseObj.type, // Delta inherits base type
                    data: resolvedData,
                };
                objectsByOffset.set(delta.offset, resolvedObj);
                pendingDeltas.splice(i, 1);
                resolvedCount++;
            }
        }
    }
    if (pendingDeltas.length > 0) {
        throw new Error(`Failed to resolve ${pendingDeltas.length} delta objects - missing base objects`);
    }
    // Store all resolved objects
    for (const [, obj] of objectsByOffset) {
        const typeStr = packObjectTypeToString(obj.type);
        const sha = await storage.storeObject(typeStr, obj.data);
        objectsBySha.set(sha, obj);
    }
}
/**
 * Extract a single object from the packfile.
 *
 * @param packfile - Raw packfile data
 * @param offset - Starting offset of the object
 * @returns Extracted object data and next offset
 */
function extractObject(packfile, offset) {
    const { type, size, bytesRead } = decodeTypeAndSize(packfile, offset);
    offset += bytesRead;
    let baseOffset;
    let baseSha;
    // Handle delta base references
    if (type === PackObjectType.OBJ_OFS_DELTA) {
        // Read negative offset to base object
        const { value, bytesConsumed } = readOfsOffset(packfile, offset);
        baseOffset = value;
        offset += bytesConsumed;
    }
    else if (type === PackObjectType.OBJ_REF_DELTA) {
        // Read 20-byte SHA of base object
        const shaBytes = packfile.subarray(offset, offset + 20);
        baseSha = bytesToHex(shaBytes);
        offset += 20;
    }
    // Decompress zlib data
    const { data, bytesConsumed } = inflateData(packfile, offset, size);
    return {
        type,
        data,
        offset,
        nextOffset: offset + bytesConsumed,
        baseOffset,
        baseSha,
    };
}
/**
 * Read the offset delta base offset value.
 *
 * @description
 * The offset is encoded as a variable-length integer where:
 * - MSB indicates continuation
 * - Lower 7 bits contribute to the value
 * - Each continuation byte adds 1 to the accumulated value before shifting
 *
 * @param data - Packfile data
 * @param offset - Current position
 * @returns Decoded offset value and bytes consumed
 */
function readOfsOffset(data, offset) {
    let value = data[offset] & 0x7f;
    let bytesConsumed = 1;
    while (data[offset + bytesConsumed - 1] & 0x80) {
        value = ((value + 1) << 7) | (data[offset + bytesConsumed] & 0x7f);
        bytesConsumed++;
    }
    return { value, bytesConsumed };
}
/**
 * Inflate (decompress) zlib data from packfile.
 *
 * @param packfile - Packfile data
 * @param offset - Start of compressed data
 * @param expectedSize - Expected uncompressed size
 * @returns Decompressed data and bytes consumed
 */
function inflateData(packfile, offset, expectedSize) {
    // Use pako's inflateRaw with a streaming approach to determine consumed bytes
    const inflator = new pako.Inflate();
    // Feed data in chunks to find the end of the zlib stream
    let consumed = 0;
    const maxChunkSize = 1024;
    while (offset + consumed < packfile.length) {
        const chunkSize = Math.min(maxChunkSize, packfile.length - offset - consumed);
        const chunk = packfile.subarray(offset + consumed, offset + consumed + chunkSize);
        inflator.push(chunk, false);
        consumed += chunkSize;
        // Check if we have enough decompressed data
        if (inflator.result && inflator.result.length >= expectedSize) {
            break;
        }
        if (inflator.err) {
            throw new Error(`Decompression error: ${inflator.msg}`);
        }
    }
    // Finalize
    inflator.push(new Uint8Array(0), true);
    if (inflator.err) {
        throw new Error(`Decompression error: ${inflator.msg}`);
    }
    const result = inflator.result;
    if (result.length !== expectedSize) {
        // Sometimes we get more data than expected, use only what we need
        if (result.length > expectedSize) {
            return { data: result.subarray(0, expectedSize), bytesConsumed: consumed };
        }
        throw new Error(`Decompression size mismatch: expected ${expectedSize}, got ${result.length}`);
    }
    return { data: result, bytesConsumed: consumed };
}
/**
 * Convert bytes to lowercase hex string.
 */
function bytesToHex(bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
    }
    return hex;
}
// ============================================================================
// Exports for Testing
// ============================================================================
export { parseRefAdvertisement, buildUploadPackRequest, extractPackfile, extractObject, };
//# sourceMappingURL=http-clone.js.map