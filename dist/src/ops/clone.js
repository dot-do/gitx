/**
 * @fileoverview Git Clone Operation Implementation
 *
 * This module implements the client-side Git clone operation for fetching repositories
 * from remote HTTPS URLs using the Git Smart HTTP protocol.
 *
 * ## Protocol Flow
 *
 * 1. **URL Parsing**: Extract host, path, and credentials from the clone URL
 * 2. **Ref Discovery**: GET /info/refs?service=git-upload-pack to discover refs
 * 3. **Negotiation**: POST /git-upload-pack with wants (no haves for clone)
 * 4. **Pack Fetch**: Receive packfile with all requested objects
 * 5. **Unpack**: Extract and store objects from the packfile
 * 6. **Refs Setup**: Create local refs pointing to fetched commits
 *
 * @module ops/clone
 * @see {@link https://git-scm.com/docs/http-protocol} Git HTTP Protocol
 * @see {@link https://git-scm.com/book/en/v2/Git-Internals-Transfer-Protocols}
 *
 * @example
 * ```typescript
 * import { clone, parseCloneUrl, discoverRefs, fetchPack } from './ops/clone'
 *
 * // Full clone operation
 * const result = await clone('https://github.com/user/repo.git', backend)
 *
 * // Or step by step:
 * const url = parseCloneUrl('https://github.com/user/repo.git')
 * const refs = await discoverRefs(url)
 * const packData = await fetchPack(url, refs.refs.map(r => r.sha))
 * await unpackObjects(backend, packData)
 * ```
 */
import { pktLineStream, encodePktLine, FLUSH_PKT } from '../wire/pkt-line';
import { parseCapabilities } from '../wire/smart-http';
import { PackObjectType, parsePackHeader, decodeTypeAndSize, packObjectTypeToString } from '../pack/format';
import { applyDelta } from '../pack/delta';
import * as pako from 'pako';
// ============================================================================
// URL Parsing
// ============================================================================
/**
 * Parse a Git clone URL into its components.
 *
 * @description
 * Supports the following URL formats:
 * - `https://github.com/user/repo.git`
 * - `https://github.com/user/repo` (without .git)
 * - `https://username:password@github.com/user/repo.git`
 * - `https://github.com:443/user/repo.git` (with port)
 *
 * SSH URLs are recognized but not yet fully supported:
 * - `git@github.com:user/repo.git`
 * - `ssh://git@github.com/user/repo.git`
 *
 * @param url - The Git remote URL to parse
 * @returns Parsed URL components
 * @throws {Error} If the URL format is invalid or unsupported
 *
 * @example
 * ```typescript
 * const parsed = parseCloneUrl('https://github.com/user/repo.git')
 * // {
 * //   protocol: 'https',
 * //   host: 'github.com',
 * //   port: null,
 * //   path: '/user/repo.git',
 * //   baseUrl: 'https://github.com/user/repo.git'
 * // }
 * ```
 */
export function parseCloneUrl(url) {
    // Handle SSH shorthand format: git@github.com:user/repo.git
    if (url.match(/^[^@]+@[^:]+:/)) {
        const match = url.match(/^([^@]+)@([^:]+):(.+)$/);
        if (!match) {
            throw new Error(`Invalid SSH URL format: ${url}`);
        }
        const [, username, host, path] = match;
        return {
            protocol: 'ssh',
            host: host,
            port: null,
            path: path.startsWith('/') ? path : '/' + path,
            username,
            baseUrl: `ssh://${username}@${host}/${path}`
        };
    }
    // Handle standard URL format
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    }
    catch {
        throw new Error(`Invalid URL format: ${url}`);
    }
    const protocol = parsedUrl.protocol.replace(':', '');
    if (protocol !== 'https' && protocol !== 'http' && protocol !== 'ssh') {
        throw new Error(`Unsupported protocol: ${protocol}. Only https is currently supported.`);
    }
    // Normalize path - ensure it doesn't have double slashes
    let path = parsedUrl.pathname;
    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    // Build base URL without credentials
    const port = parsedUrl.port ? parseInt(parsedUrl.port) : null;
    const portStr = port ? `:${port}` : '';
    const baseUrl = `${protocol}://${parsedUrl.host}${path}`;
    return {
        protocol: protocol === 'http' ? 'https' : protocol,
        host: parsedUrl.hostname,
        port,
        path,
        username: parsedUrl.username || undefined,
        password: parsedUrl.password || undefined,
        baseUrl
    };
}
/**
 * Build the info/refs URL for ref discovery.
 *
 * @param parsed - Parsed clone URL
 * @param service - Git service (git-upload-pack or git-receive-pack)
 * @returns Full URL for ref discovery
 *
 * @internal
 */
function buildInfoRefsUrl(parsed, service) {
    return `${parsed.baseUrl}/info/refs?service=${service}`;
}
/**
 * Build the service URL for data transfer.
 *
 * @param parsed - Parsed clone URL
 * @param service - Git service (git-upload-pack or git-receive-pack)
 * @returns Full URL for data transfer
 *
 * @internal
 */
function buildServiceUrl(parsed, service) {
    return `${parsed.baseUrl}/${service}`;
}
// ============================================================================
// Ref Discovery (Smart HTTP Protocol)
// ============================================================================
/**
 * Discover refs from a remote Git repository.
 *
 * @description
 * Performs the initial ref discovery phase of the Git Smart HTTP protocol.
 * This is equivalent to `git ls-remote` and returns all refs and server capabilities.
 *
 * The response format is:
 * 1. Service announcement: `# service=git-upload-pack`
 * 2. Flush packet
 * 3. Refs with capabilities on first line
 * 4. Flush packet
 *
 * @param url - Parsed clone URL or string URL
 * @param options - Clone options (for auth and custom fetch)
 * @returns Ref advertisement with refs and capabilities
 * @throws {Error} If the request fails or response is invalid
 *
 * @example
 * ```typescript
 * const refs = await discoverRefs('https://github.com/user/repo.git')
 * console.log(refs.refs.map(r => `${r.sha} ${r.name}`))
 * console.log('Default branch:', refs.symrefs.get('HEAD'))
 * ```
 */
export async function discoverRefs(url, options) {
    const parsed = typeof url === 'string' ? parseCloneUrl(url) : url;
    if (parsed.protocol === 'ssh') {
        throw new Error('SSH protocol is not yet supported. Use HTTPS URL instead.');
    }
    const infoRefsUrl = buildInfoRefsUrl(parsed, 'git-upload-pack');
    const fetchFn = options?.fetch ?? fetch;
    // Build headers
    const headers = {
        'Accept': 'application/x-git-upload-pack-advertisement',
        'User-Agent': 'gitx.do/1.0'
    };
    // Add authentication if provided
    if (options?.auth) {
        const credentials = btoa(`${options.auth.username}:${options.auth.password}`);
        headers['Authorization'] = `Basic ${credentials}`;
    }
    else if (parsed.username && parsed.password) {
        const credentials = btoa(`${parsed.username}:${parsed.password}`);
        headers['Authorization'] = `Basic ${credentials}`;
    }
    // Make the request
    const response = await fetchFn(infoRefsUrl, { headers });
    if (!response.ok) {
        throw new Error(`Failed to discover refs: ${response.status} ${response.statusText}`);
    }
    // Validate content type
    const contentType = response.headers.get('Content-Type') ?? '';
    if (!contentType.includes('application/x-git-upload-pack-advertisement')) {
        throw new Error(`Invalid content type: ${contentType}. Server may not support Smart HTTP.`);
    }
    // Parse response
    const body = await response.text();
    return parseRefAdvertisement(body);
}
/**
 * Parse ref advertisement response from server.
 *
 * @param body - Raw response body
 * @returns Parsed ref advertisement
 *
 * @internal
 */
function parseRefAdvertisement(body) {
    const { packets } = pktLineStream(body);
    const refs = [];
    let capabilities = {};
    const symrefs = new Map();
    let head;
    let isFirstRef = true;
    let passedServiceAnnouncement = false;
    for (const packet of packets) {
        if (packet.type === 'flush') {
            passedServiceAnnouncement = true;
            continue;
        }
        if (!packet.data)
            continue;
        const line = packet.data.trim();
        // Skip service announcement
        if (line.startsWith('# service=')) {
            continue;
        }
        // Parse ref line
        // Format: <sha> <refname>[\0<capabilities>]
        const nullIndex = line.indexOf('\x00');
        let refPart;
        let capsPart = null;
        if (nullIndex !== -1) {
            refPart = line.slice(0, nullIndex);
            capsPart = line.slice(nullIndex + 1);
        }
        else {
            refPart = line;
        }
        // Parse ref SHA and name
        const spaceIndex = refPart.indexOf(' ');
        if (spaceIndex === -1)
            continue;
        const sha = refPart.slice(0, spaceIndex).toLowerCase();
        const name = refPart.slice(spaceIndex + 1).trim();
        // Skip capabilities-only line (empty repo)
        if (name === 'capabilities^{}') {
            if (capsPart) {
                capabilities = parseCapabilities(capsPart.split(' '));
                parseSymrefs(capsPart, symrefs);
            }
            continue;
        }
        // Parse capabilities from first ref
        if (isFirstRef && capsPart) {
            capabilities = parseCapabilities(capsPart.split(' '));
            parseSymrefs(capsPart, symrefs);
            isFirstRef = false;
        }
        // Check for peeled ref (annotated tag target)
        if (name.endsWith('^{}')) {
            // This is a peeled ref - update the previous tag with peeled SHA
            const tagName = name.slice(0, -3);
            const tagRef = refs.find(r => r.name === tagName);
            if (tagRef) {
                tagRef.peeled = sha;
            }
            continue;
        }
        // Track HEAD
        if (name === 'HEAD') {
            head = sha;
        }
        refs.push({ sha, name });
    }
    return { refs, capabilities, head, symrefs };
}
/**
 * Parse symref capabilities from capability string.
 *
 * @param capsPart - Capability string
 * @param symrefs - Map to populate with symrefs
 *
 * @internal
 */
function parseSymrefs(capsPart, symrefs) {
    // Look for symref=HEAD:refs/heads/main pattern
    const parts = capsPart.split(' ');
    for (const part of parts) {
        if (part.startsWith('symref=')) {
            const symrefValue = part.slice(7);
            const colonIndex = symrefValue.indexOf(':');
            if (colonIndex !== -1) {
                const from = symrefValue.slice(0, colonIndex);
                const to = symrefValue.slice(colonIndex + 1);
                symrefs.set(from, to);
            }
        }
    }
}
// ============================================================================
// Pack Fetching
// ============================================================================
/**
 * Fetch pack data from a remote repository.
 *
 * @description
 * Performs the data transfer phase of the Git Smart HTTP protocol.
 * Sends want requests for the specified SHAs and receives a packfile
 * containing the requested objects (and all reachable objects).
 *
 * For clone operations, `haves` should be empty since we don't have
 * any objects yet. For fetch operations, `haves` contains SHAs of
 * objects we already have.
 *
 * @param url - Parsed clone URL or string URL
 * @param wants - SHA-1 hashes of objects we want
 * @param options - Clone options
 * @returns Pack data as Uint8Array (including NAK/ACK prefix)
 * @throws {Error} If the request fails
 *
 * @example
 * ```typescript
 * // Clone: want everything, have nothing
 * const packData = await fetchPack(url, refs.map(r => r.sha), [])
 *
 * // Fetch: want new commits, have old ones
 * const packData = await fetchPack(url, newShas, existingShas)
 * ```
 */
export async function fetchPack(url, wants, options) {
    const parsed = typeof url === 'string' ? parseCloneUrl(url) : url;
    if (parsed.protocol === 'ssh') {
        throw new Error('SSH protocol is not yet supported. Use HTTPS URL instead.');
    }
    if (wants.length === 0) {
        throw new Error('No refs to fetch');
    }
    const serviceUrl = buildServiceUrl(parsed, 'git-upload-pack');
    const fetchFn = options?.fetch ?? fetch;
    // Build request body
    const requestBody = buildUploadPackRequest(wants, options);
    // Build headers
    const headers = {
        'Content-Type': 'application/x-git-upload-pack-request',
        'Accept': 'application/x-git-upload-pack-result',
        'User-Agent': 'gitx.do/1.0'
    };
    // Add authentication
    if (options?.auth) {
        const credentials = btoa(`${options.auth.username}:${options.auth.password}`);
        headers['Authorization'] = `Basic ${credentials}`;
    }
    else if (parsed.username && parsed.password) {
        const credentials = btoa(`${parsed.username}:${parsed.password}`);
        headers['Authorization'] = `Basic ${credentials}`;
    }
    // Make the request
    const response = await fetchFn(serviceUrl, {
        method: 'POST',
        headers,
        body: requestBody
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch pack: ${response.status} ${response.statusText}`);
    }
    // Get response as ArrayBuffer
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
}
/**
 * Build the upload-pack request body.
 *
 * @param wants - SHA-1 hashes of objects we want
 * @param options - Clone options
 * @returns Request body as string
 *
 * @internal
 */
function buildUploadPackRequest(wants, options) {
    const lines = [];
    // Build capabilities for first want line
    const caps = ['side-band-64k', 'thin-pack', 'ofs-delta', 'agent=gitx.do/1.0'];
    if (options?.depth) {
        caps.push('shallow');
    }
    // Add want lines
    for (let i = 0; i < wants.length; i++) {
        const sha = wants[i].toLowerCase();
        if (i === 0) {
            // First want line includes capabilities
            lines.push(encodePktLine(`want ${sha} ${caps.join(' ')}\n`));
        }
        else {
            lines.push(encodePktLine(`want ${sha}\n`));
        }
    }
    // Add shallow depth if specified
    if (options?.depth) {
        lines.push(encodePktLine(`deepen ${options.depth}\n`));
    }
    // Flush after wants
    lines.push(FLUSH_PKT);
    // No haves for clone operation
    // Send done
    lines.push(encodePktLine('done\n'));
    return lines.join('');
}
// ============================================================================
// Pack Unpacking
// ============================================================================
/**
 * Extract packfile data from upload-pack response.
 *
 * @description
 * The upload-pack response contains:
 * 1. NAK or ACK lines
 * 2. Packfile data (possibly in side-band format)
 * 3. Flush packet
 *
 * This function extracts just the PACK data, handling side-band
 * demultiplexing if present.
 *
 * @param response - Full upload-pack response
 * @returns Extracted packfile data
 * @throws {Error} If response format is invalid
 *
 * @internal
 */
export function extractPackData(response) {
    const decoder = new TextDecoder();
    let offset = 0;
    // Skip NAK/ACK lines and find the start of pack data
    while (offset < response.length) {
        // Check for pack signature directly
        if (response.length - offset >= 4) {
            const sig = String.fromCharCode(response[offset], response[offset + 1], response[offset + 2], response[offset + 3]);
            if (sig === 'PACK') {
                // Found pack data directly (no side-band)
                return response.slice(offset);
            }
        }
        // Read pkt-line length
        if (offset + 4 > response.length)
            break;
        const hexLen = decoder.decode(response.slice(offset, offset + 4));
        // Flush packet
        if (hexLen === '0000') {
            offset += 4;
            continue;
        }
        const len = parseInt(hexLen, 16);
        if (isNaN(len) || len < 4) {
            offset += 4;
            continue;
        }
        // Check for side-band data
        if (len > 4) {
            const channelByte = response[offset + 4];
            // Side-band channel 1 is pack data
            if (channelByte === 1) {
                // Check if this contains PACK signature
                if (response.length - offset >= 9) {
                    const sig = String.fromCharCode(response[offset + 5], response[offset + 6], response[offset + 7], response[offset + 8]);
                    if (sig === 'PACK') {
                        // Found pack data in side-band
                        // Need to demultiplex all side-band packets
                        return demultiplexSideBand(response, offset);
                    }
                }
            }
            // Side-band channel 2 is progress (skip)
            // Side-band channel 3 is error
            else if (channelByte === 3) {
                const errorMsg = decoder.decode(response.slice(offset + 5, offset + len));
                throw new Error(`Server error: ${errorMsg}`);
            }
        }
        offset += len;
    }
    throw new Error('No pack data found in response');
}
/**
 * Demultiplex side-band encoded pack data.
 *
 * @param response - Full response with side-band data
 * @param startOffset - Offset where pack data starts
 * @returns Assembled pack data
 *
 * @internal
 */
function demultiplexSideBand(response, startOffset) {
    const decoder = new TextDecoder();
    const packParts = [];
    let offset = startOffset;
    while (offset < response.length) {
        // Read pkt-line length
        if (offset + 4 > response.length)
            break;
        const hexLen = decoder.decode(response.slice(offset, offset + 4));
        // Flush packet ends the stream
        if (hexLen === '0000') {
            break;
        }
        const len = parseInt(hexLen, 16);
        if (isNaN(len) || len < 5) {
            offset += 4;
            continue;
        }
        const channelByte = response[offset + 4];
        // Side-band channel 1 is pack data
        if (channelByte === 1) {
            packParts.push(response.slice(offset + 5, offset + len));
        }
        // Side-band channel 3 is error
        else if (channelByte === 3) {
            const errorMsg = decoder.decode(response.slice(offset + 5, offset + len));
            throw new Error(`Server error: ${errorMsg}`);
        }
        // Channel 2 is progress - ignore
        offset += len;
    }
    // Concatenate all pack parts
    const totalLength = packParts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(totalLength);
    let resultOffset = 0;
    for (const part of packParts) {
        result.set(part, resultOffset);
        resultOffset += part.length;
    }
    return result;
}
/**
 * Unpack objects from a packfile and store them in the backend.
 *
 * @description
 * Parses a Git packfile and extracts all objects, handling both
 * full objects and delta-compressed objects. Objects are stored
 * in the provided backend.
 *
 * The packfile format is:
 * 1. 12-byte header (PACK + version + object count)
 * 2. Object entries (variable-length encoded, zlib compressed)
 * 3. 20-byte SHA-1 checksum
 *
 * Delta objects (OFS_DELTA and REF_DELTA) are resolved by applying
 * delta instructions against their base objects.
 *
 * @param backend - Git backend to store objects
 * @param packData - Raw packfile data
 * @param onProgress - Optional progress callback
 * @returns Number of objects unpacked
 * @throws {Error} If packfile is invalid or corrupted
 *
 * @example
 * ```typescript
 * const packData = await fetchPack(url, wants)
 * const extractedPack = extractPackData(packData)
 * const objectCount = await unpackObjects(backend, extractedPack)
 * console.log(`Unpacked ${objectCount} objects`)
 * ```
 */
export async function unpackObjects(backend, packData, onProgress) {
    // Parse and validate header
    const header = parsePackHeader(packData);
    if (onProgress) {
        onProgress(`Unpacking ${header.objectCount} objects...`);
    }
    // Track parsed objects by offset (for ofs_delta resolution)
    const objectsByOffset = new Map();
    // Track objects by SHA (for ref_delta resolution)
    const objectsBySha = new Map();
    // Pending deltas that need resolution
    const pendingDeltas = [];
    let offset = 12; // Skip header
    // First pass: parse all objects
    for (let i = 0; i < header.objectCount; i++) {
        const objectOffset = offset;
        const { type, size, bytesRead } = decodeTypeAndSize(packData, offset);
        offset += bytesRead;
        // Handle delta objects
        if (type === PackObjectType.OBJ_OFS_DELTA) {
            // Read negative offset to base object
            const { baseOffset: negOffset, bytesRead: offsetBytes } = decodeOfsOffset(packData, offset);
            offset += offsetBytes;
            const baseOffset = objectOffset - negOffset;
            // Decompress delta data (use async for native stream support)
            const { data: deltaData, bytesConsumed } = await decompressObjectAsync(packData, offset, size);
            offset += bytesConsumed;
            pendingDeltas.push({
                deltaType: 'ofs',
                baseOffset,
                deltaData,
                offset: objectOffset
            });
            continue;
        }
        if (type === PackObjectType.OBJ_REF_DELTA) {
            // Read 20-byte base object SHA
            const baseSha = bytesToHex(packData.slice(offset, offset + 20));
            offset += 20;
            // Decompress delta data (use async for native stream support)
            const { data: deltaData, bytesConsumed } = await decompressObjectAsync(packData, offset, size);
            offset += bytesConsumed;
            pendingDeltas.push({
                deltaType: 'ref',
                baseSha,
                deltaData,
                offset: objectOffset
            });
            continue;
        }
        // Regular object - decompress (use async for native stream support)
        const { data, bytesConsumed } = await decompressObjectAsync(packData, offset, size);
        offset += bytesConsumed;
        const typeStr = packObjectTypeToString(type);
        const obj = {
            type: typeStr,
            data,
            offset: objectOffset
        };
        objectsByOffset.set(objectOffset, obj);
        // Store in backend and track by SHA
        const sha = await backend.writeObject({ type: typeStr, data });
        obj.sha = sha;
        objectsBySha.set(sha, obj);
        if (onProgress && (i + 1) % 100 === 0) {
            onProgress(`Unpacked ${i + 1}/${header.objectCount} objects...`);
        }
    }
    // Second pass: resolve deltas
    // Keep resolving until no more progress is made
    let resolved = 0;
    let lastResolved = -1;
    while (resolved > lastResolved) {
        lastResolved = resolved;
        for (let i = pendingDeltas.length - 1; i >= 0; i--) {
            const delta = pendingDeltas[i];
            let baseObj;
            if (delta.deltaType === 'ofs' && delta.baseOffset !== undefined) {
                baseObj = objectsByOffset.get(delta.baseOffset);
            }
            else if (delta.deltaType === 'ref' && delta.baseSha !== undefined) {
                baseObj = objectsBySha.get(delta.baseSha);
                // Try to get from backend if not in our parsed objects
                if (!baseObj) {
                    const backendObj = await backend.readObject(delta.baseSha);
                    if (backendObj) {
                        baseObj = {
                            type: backendObj.type,
                            data: backendObj.data,
                            offset: -1,
                            sha: delta.baseSha
                        };
                    }
                }
            }
            if (!baseObj)
                continue;
            // Apply delta
            const targetData = applyDelta(baseObj.data, delta.deltaData);
            const targetObj = {
                type: baseObj.type,
                data: targetData,
                offset: delta.offset
            };
            objectsByOffset.set(delta.offset, targetObj);
            // Store in backend
            const sha = await backend.writeObject({ type: baseObj.type, data: targetData });
            targetObj.sha = sha;
            objectsBySha.set(sha, targetObj);
            // Remove from pending
            pendingDeltas.splice(i, 1);
            resolved++;
        }
    }
    if (pendingDeltas.length > 0) {
        throw new Error(`Failed to resolve ${pendingDeltas.length} delta objects`);
    }
    if (onProgress) {
        onProgress(`Unpacked ${header.objectCount} objects.`);
    }
    return header.objectCount;
}
/**
 * Decode OFS_DELTA negative offset.
 *
 * @description
 * The offset is encoded as a variable-length integer where each
 * continuation byte adds 1 to account for the minimum value at each level.
 *
 * @param data - Packfile data
 * @param offset - Current offset
 * @returns Base offset and bytes read
 *
 * @internal
 */
function decodeOfsOffset(data, offset) {
    let byte = data[offset];
    let bytesRead = 1;
    let value = byte & 0x7f;
    while (byte & 0x80) {
        byte = data[offset + bytesRead];
        bytesRead++;
        // Each continuation byte adds 1 to account for minimum value
        value = ((value + 1) << 7) | (byte & 0x7f);
    }
    return { baseOffset: value, bytesRead };
}
/**
 * Decompress zlib-compressed object data from a packfile.
 *
 * @description
 * Git packfiles use zlib compression. This function handles decompression
 * using pako's inflateRaw function after manually skipping the 2-byte zlib header.
 * This approach handles packfiles correctly where multiple compressed objects
 * are concatenated without explicit size markers.
 *
 * The zlib format is: [2-byte header][deflate data][4-byte adler32]
 * We skip the header, use inflateRaw for the deflate data, and account for
 * the adler32 checksum when calculating bytes consumed.
 *
 * @param data - Packfile data
 * @param offset - Start of compressed data (zlib header)
 * @param expectedSize - Expected uncompressed size
 * @returns Decompressed data and bytes consumed
 *
 * @internal
 */
async function decompressObjectAsync(data, offset, expectedSize) {
    const maxCompressedSize = Math.min(data.length - offset, expectedSize * 10 + 1000);
    // Verify we have a valid zlib header
    if (data.length - offset < 2) {
        throw new Error(`Not enough data for zlib header at offset ${offset}`);
    }
    const cmf = data[offset];
    const flg = data[offset + 1];
    // Validate zlib header (CMF + FLG should pass checksum: (CMF*256 + FLG) % 31 == 0)
    if ((cmf * 256 + flg) % 31 !== 0) {
        const firstBytes = Array.from(data.slice(offset, offset + 16))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
        throw new Error(`Invalid zlib header at offset ${offset}: ${cmf.toString(16)} ${flg.toString(16)} ` +
            `(data: ${firstBytes}...)`);
    }
    // Skip the 2-byte zlib header and use inflateRaw
    const deflateData = data.slice(offset + 2, offset + maxCompressedSize);
    try {
        // Use Inflate class with raw:true to get strm.total_in
        const inflator = new pako.Inflate({ raw: true });
        inflator.push(deflateData, true);
        if (inflator.err !== 0) {
            throw new Error(`inflateRaw error: ${inflator.msg || 'unknown'}`);
        }
        const result = inflator.result;
        if (!result || result.length < expectedSize) {
            throw new Error(`Decompressed size ${result?.length ?? 0} < expected ${expectedSize}`);
        }
        // Get bytes consumed from strm.total_in
        const strm = inflator.strm;
        const deflateConsumed = strm?.total_in ?? 0;
        // Total consumed = 2 (header) + deflate data + 4 (adler32 checksum)
        // Note: strm.total_in is just the deflate portion, not the adler32
        const bytesConsumed = 2 + deflateConsumed + 4;
        return {
            data: result.slice(0, expectedSize),
            bytesConsumed,
        };
    }
    catch (e) {
        // Try direct inflateRaw as fallback (in case the Inflate class has issues)
        try {
            const result = pako.inflateRaw(deflateData);
            if (result && result.length >= expectedSize) {
                // Estimate consumed based on typical compression ratio (around 0.4-0.6 for text)
                const estimated = Math.ceil(expectedSize * 0.5) + 2 + 4;
                return {
                    data: result.slice(0, expectedSize),
                    bytesConsumed: Math.min(estimated, maxCompressedSize),
                };
            }
        }
        catch {
            // Fall through
        }
        // Debug info
        const firstBytes = Array.from(data.slice(offset, offset + 16))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
        throw new Error(`Decompression failed: expected ${expectedSize} bytes at offset ${offset} ` +
            `(data: ${firstBytes}..., available: ${data.length - offset} bytes, error: ${e instanceof Error ? e.message : 'unknown'})`);
    }
}
/**
 * Convert bytes to hexadecimal string.
 *
 * @internal
 */
function bytesToHex(bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
    }
    return hex;
}
// ============================================================================
// Full Clone Operation
// ============================================================================
/**
 * Clone a remote Git repository.
 *
 * @description
 * Performs a full clone operation, fetching all refs and objects from
 * the remote repository and storing them in the provided backend.
 *
 * This is equivalent to `git clone <url>` and performs:
 * 1. Ref discovery from the remote
 * 2. Packfile fetch with all refs
 * 3. Object unpacking
 * 4. Ref creation in the backend
 *
 * @param url - Remote repository URL (HTTPS)
 * @param backend - Git backend to store cloned data
 * @param options - Clone options
 * @returns Clone result with refs and object count
 *
 * @example
 * ```typescript
 * import { clone } from './ops/clone'
 * import { createMemoryBackend } from '../core/backend'
 *
 * const backend = createMemoryBackend()
 * const result = await clone('https://github.com/user/repo.git', backend, {
 *   onProgress: console.log
 * })
 *
 * console.log(`Cloned ${result.objectCount} objects`)
 * console.log(`Default branch: ${result.defaultBranch}`)
 * ```
 */
export async function clone(url, backend, options) {
    const onProgress = options?.onProgress;
    try {
        // Parse URL
        const parsed = parseCloneUrl(url);
        if (parsed.protocol === 'ssh') {
            return {
                success: false,
                error: 'SSH protocol is not yet supported. Use HTTPS URL instead.',
                refs: [],
                objectCount: 0
            };
        }
        if (onProgress) {
            onProgress(`Cloning from ${parsed.host}${parsed.path}...`);
        }
        // Discover refs
        if (onProgress) {
            onProgress('Discovering refs...');
        }
        const refAdvert = await discoverRefs(parsed, options);
        if (refAdvert.refs.length === 0) {
            return {
                success: true,
                refs: [],
                objectCount: 0,
                head: undefined,
                defaultBranch: undefined
            };
        }
        // Determine what to fetch
        let wantRefs = refAdvert.refs;
        // If a specific branch is requested, only fetch that
        if (options?.branch) {
            const branchRef = refAdvert.refs.find(r => r.name === `refs/heads/${options.branch}` || r.name === options.branch);
            if (!branchRef) {
                return {
                    success: false,
                    error: `Branch not found: ${options.branch}`,
                    refs: [],
                    objectCount: 0
                };
            }
            wantRefs = [branchRef];
        }
        // Get unique SHAs to fetch (exclude HEAD if it points to a branch)
        const wantShas = new Set();
        for (const ref of wantRefs) {
            // Skip HEAD as it's typically a symref
            if (ref.name !== 'HEAD') {
                wantShas.add(ref.sha);
            }
        }
        if (wantShas.size === 0 && refAdvert.head) {
            wantShas.add(refAdvert.head);
        }
        if (wantShas.size === 0) {
            return {
                success: true,
                refs: [],
                objectCount: 0,
                head: undefined,
                defaultBranch: undefined
            };
        }
        // Fetch pack
        if (onProgress) {
            onProgress(`Fetching ${wantShas.size} refs...`);
        }
        const packResponse = await fetchPack(parsed, Array.from(wantShas), options);
        // Extract pack data from response
        const packData = extractPackData(packResponse);
        // Unpack objects
        const objectCount = await unpackObjects(backend, packData, onProgress);
        // Create refs
        for (const ref of wantRefs) {
            if (ref.name !== 'HEAD') {
                await backend.writeRef(ref.name, ref.sha);
            }
        }
        // Determine default branch
        let defaultBranch = refAdvert.symrefs.get('HEAD');
        if (defaultBranch?.startsWith('refs/heads/')) {
            defaultBranch = defaultBranch.slice('refs/heads/'.length);
        }
        // Set HEAD ref
        if (refAdvert.head) {
            await backend.writeRef('HEAD', refAdvert.head);
        }
        if (onProgress) {
            onProgress('Clone complete.');
        }
        return {
            success: true,
            refs: wantRefs.filter(r => r.name !== 'HEAD'),
            head: refAdvert.head,
            defaultBranch,
            objectCount
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            refs: [],
            objectCount: 0
        };
    }
}
//# sourceMappingURL=clone.js.map