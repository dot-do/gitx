/**
 * @fileoverview Git send-pack Protocol Implementation (Client)
 *
 * This module implements the client-side of Git's send-pack service, which is
 * used by `git-push` to push objects to a remote repository via the
 * git-receive-pack service.
 *
 * @module wire/send-pack
 *
 * ## Protocol Flow
 *
 * 1. **Ref Discovery**: GET /info/refs?service=git-receive-pack to discover remote refs
 * 2. **Command Phase**: Send ref update commands (old-sha new-sha refname)
 * 3. **Pack Phase**: Send packfile with objects the remote doesn't have
 * 4. **Report Status**: Receive status report from server (if report-status capability)
 *
 * ## Features
 *
 * - HTTPS authentication (Basic, Bearer token)
 * - Side-band progress reporting
 * - Report-status handling
 * - Atomic push support
 * - Thin pack generation
 *
 * @see {@link https://git-scm.com/docs/pack-protocol} Git Pack Protocol
 * @see {@link https://git-scm.com/docs/git-send-pack} git-send-pack Documentation
 *
 * @example Push to a remote repository
 * ```typescript
 * import { push } from './wire/send-pack'
 *
 * const result = await push({
 *   url: 'https://github.com/user/repo.git',
 *   auth: { username: 'token', password: 'ghp_xxx' },
 *   refUpdates: [
 *     { refName: 'refs/heads/main', oldSha: 'abc123...', newSha: 'def456...' }
 *   ],
 *   backend
 * })
 *
 * if (result.success) {
 *   console.log('Push successful')
 * }
 * ```
 */
import { encodePktLine, FLUSH_PKT, pktLineStream } from './pkt-line';
import { parseCloneUrl } from '../ops/clone';
import { generatePackfile } from '../pack/generation';
import { PackObjectType } from '../pack/format';
// ============================================================================
// Constants
// ============================================================================
/** Text encoder for string to bytes conversion */
const encoder = new TextEncoder();
/** Text decoder for bytes to string conversion */
const decoder = new TextDecoder();
/** SHA-1 regex pattern for validation */
const SHA1_REGEX = /^[0-9a-f]{40}$/i;
/** Zero SHA - indicates ref creation or deletion */
export const ZERO_SHA = '0'.repeat(40);
/** Default user agent */
const USER_AGENT = 'gitx.do/1.0';
// ============================================================================
// Capability Parsing
// ============================================================================
/**
 * Parse capabilities from the first ref line.
 *
 * @param capsString - Space-separated capability string
 * @returns Parsed capabilities object
 */
export function parseReceivePackCapabilities(capsString) {
    const caps = {};
    if (!capsString || capsString.trim() === '') {
        return caps;
    }
    const parts = capsString.trim().split(/\s+/);
    for (const part of parts) {
        if (part === 'report-status')
            caps.reportStatus = true;
        else if (part === 'delete-refs')
            caps.deleteRefs = true;
        else if (part === 'atomic')
            caps.atomic = true;
        else if (part === 'side-band-64k')
            caps.sideBand64k = true;
        else if (part === 'thin-pack')
            caps.thinPack = true;
        else if (part === 'ofs-delta')
            caps.ofsDelta = true;
        else if (part === 'push-options')
            caps.pushOptions = true;
        else if (part.startsWith('agent='))
            caps.agent = part.slice(6);
    }
    return caps;
}
/**
 * Build capability string for push request.
 *
 * @param serverCaps - Server capabilities
 * @param options - Push options
 * @returns Space-separated capability string
 */
function buildClientCapabilities(serverCaps, options) {
    const caps = [];
    // Only request capabilities the server supports
    if (serverCaps.reportStatus)
        caps.push('report-status');
    if (serverCaps.sideBand64k)
        caps.push('side-band-64k');
    if (serverCaps.ofsDelta)
        caps.push('ofs-delta');
    if (options.atomic && serverCaps.atomic)
        caps.push('atomic');
    if (options.pushOptions && options.pushOptions.length > 0 && serverCaps.pushOptions) {
        caps.push('push-options');
    }
    caps.push(`agent=${USER_AGENT}`);
    return caps.join(' ');
}
// ============================================================================
// Ref Discovery
// ============================================================================
/**
 * Discover refs from remote for git-receive-pack.
 *
 * @param url - Parsed or string URL
 * @param options - Push options (for auth and custom fetch)
 * @returns Remote ref advertisement
 */
export async function discoverReceivePackRefs(url, options) {
    const parsed = typeof url === 'string' ? parseCloneUrl(url) : url;
    if (parsed.protocol === 'ssh') {
        throw new Error('SSH protocol is not yet supported. Use HTTPS URL instead.');
    }
    const infoRefsUrl = `${parsed.baseUrl}/info/refs?service=git-receive-pack`;
    const fetchFn = options?.fetch ?? fetch;
    // Build headers
    const headers = {
        'Accept': 'application/x-git-receive-pack-advertisement',
        'User-Agent': USER_AGENT
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
    const response = await fetchFn(infoRefsUrl, { headers });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
        }
        throw new Error(`Failed to discover refs: ${response.status} ${response.statusText}`);
    }
    // Validate content type
    const contentType = response.headers.get('Content-Type') ?? '';
    if (!contentType.includes('application/x-git-receive-pack-advertisement')) {
        throw new Error(`Invalid content type: ${contentType}. Server may not support Smart HTTP.`);
    }
    const body = await response.text();
    return parseReceivePackAdvertisement(body);
}
/**
 * Parse git-receive-pack ref advertisement.
 *
 * @param body - Raw response body
 * @returns Parsed ref advertisement
 */
function parseReceivePackAdvertisement(body) {
    const { packets } = pktLineStream(body);
    const refs = [];
    let capabilities = {};
    let isFirstRef = true;
    for (const packet of packets) {
        if (packet.type === 'flush') {
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
                capabilities = parseReceivePackCapabilities(capsPart);
            }
            continue;
        }
        // Parse capabilities from first ref
        if (isFirstRef && capsPart) {
            capabilities = parseReceivePackCapabilities(capsPart);
            isFirstRef = false;
        }
        // Check for peeled ref (annotated tag target)
        if (name.endsWith('^{}')) {
            const tagName = name.slice(0, -3);
            const tagRef = refs.find(r => r.name === tagName);
            if (tagRef) {
                tagRef.peeled = sha;
            }
            continue;
        }
        // Skip HEAD - we only care about actual refs
        if (name !== 'HEAD') {
            refs.push({ sha, name });
        }
    }
    return { refs, capabilities };
}
// ============================================================================
// Object Collection
// ============================================================================
/**
 * Collect all objects that need to be sent to the remote.
 *
 * @param backend - Git backend
 * @param refUpdates - Ref updates being pushed
 * @param remoteRefs - Current remote refs
 * @param onProgress - Progress callback
 * @returns Array of packable objects
 */
async function collectObjectsToSend(backend, refUpdates, remoteRefs, onProgress) {
    const objectsToSend = new Set();
    const remoteHas = new Set(remoteRefs.values());
    if (onProgress) {
        onProgress('Counting objects...');
    }
    // For each ref update that's not a delete, walk the commit graph
    for (const update of refUpdates) {
        if (update.newSha === ZERO_SHA) {
            // Delete operation - no objects needed
            continue;
        }
        // Walk from newSha to collect all reachable objects
        // Stop at objects the remote already has
        await walkObjectTree(backend, update.newSha, objectsToSend, remoteHas);
    }
    if (onProgress) {
        onProgress(`Counting objects: ${objectsToSend.size}, done.`);
    }
    // Convert to packable objects
    const packableObjects = [];
    for (const sha of objectsToSend) {
        const obj = await backend.readObject(sha);
        if (obj) {
            packableObjects.push({
                sha,
                type: stringToPackObjectType(obj.type),
                data: obj.data
            });
        }
    }
    return packableObjects;
}
/**
 * Walk object tree to collect all reachable objects.
 *
 * @param backend - Git backend
 * @param sha - Starting object SHA
 * @param collected - Set to add objects to
 * @param remoteHas - Objects the remote already has
 */
async function walkObjectTree(backend, sha, collected, remoteHas) {
    // Use a queue for BFS traversal
    const queue = [sha];
    const visited = new Set();
    while (queue.length > 0) {
        const currentSha = queue.shift();
        if (visited.has(currentSha) || remoteHas.has(currentSha)) {
            continue;
        }
        visited.add(currentSha);
        const obj = await backend.readObject(currentSha);
        if (!obj)
            continue;
        collected.add(currentSha);
        if (obj.type === 'commit') {
            // Parse commit to get tree and parents
            const commitStr = decoder.decode(obj.data);
            // Extract tree SHA
            const treeMatch = commitStr.match(/^tree ([0-9a-f]{40})/m);
            if (treeMatch && treeMatch[1]) {
                queue.push(treeMatch[1]);
            }
            // Extract parent SHAs
            const parentRegex = /^parent ([0-9a-f]{40})/gm;
            let parentMatch;
            while ((parentMatch = parentRegex.exec(commitStr)) !== null) {
                if (parentMatch[1]) {
                    queue.push(parentMatch[1]);
                }
            }
        }
        else if (obj.type === 'tree') {
            // Parse tree to get entries
            const entries = parseTree(obj.data);
            for (const entry of entries) {
                queue.push(entry.sha);
            }
        }
        else if (obj.type === 'tag') {
            // Parse tag to get target
            const tagStr = decoder.decode(obj.data);
            const objectMatch = tagStr.match(/^object ([0-9a-f]{40})/m);
            if (objectMatch && objectMatch[1]) {
                queue.push(objectMatch[1]);
            }
        }
        // Blobs have no references
    }
}
/**
 * Parse a tree object to extract entries.
 *
 * @param data - Raw tree data
 * @returns Array of tree entries
 */
function parseTree(data) {
    const entries = [];
    let offset = 0;
    while (offset < data.length) {
        // Find space after mode
        let spaceIndex = offset;
        while (spaceIndex < data.length && data[spaceIndex] !== 0x20) {
            spaceIndex++;
        }
        if (spaceIndex >= data.length)
            break;
        const mode = decoder.decode(data.slice(offset, spaceIndex));
        // Find null after name
        let nullIndex = spaceIndex + 1;
        while (nullIndex < data.length && data[nullIndex] !== 0x00) {
            nullIndex++;
        }
        if (nullIndex >= data.length)
            break;
        const name = decoder.decode(data.slice(spaceIndex + 1, nullIndex));
        // Read 20-byte SHA
        if (nullIndex + 21 > data.length)
            break;
        const shaBytes = data.slice(nullIndex + 1, nullIndex + 21);
        const sha = Array.from(shaBytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        entries.push({ mode, name, sha });
        offset = nullIndex + 21;
    }
    return entries;
}
/**
 * Convert object type string to PackObjectType.
 */
function stringToPackObjectType(type) {
    switch (type) {
        case 'commit': return PackObjectType.OBJ_COMMIT;
        case 'tree': return PackObjectType.OBJ_TREE;
        case 'blob': return PackObjectType.OBJ_BLOB;
        case 'tag': return PackObjectType.OBJ_TAG;
        default: throw new Error(`Unknown object type: ${type}`);
    }
}
// ============================================================================
// Push Request Building
// ============================================================================
/**
 * Build the push request body.
 *
 * @param refUpdates - Ref updates to send
 * @param clientCaps - Client capabilities string
 * @param packfile - Packfile data
 * @param pushOptions - Optional push options
 * @returns Complete request body
 */
function buildPushRequest(refUpdates, clientCaps, packfile, pushOptions) {
    const parts = [];
    // Send ref update commands
    let isFirst = true;
    for (const update of refUpdates) {
        let line;
        if (isFirst) {
            // First command includes capabilities
            line = `${update.oldSha} ${update.newSha} ${update.refName}\x00${clientCaps}\n`;
            isFirst = false;
        }
        else {
            line = `${update.oldSha} ${update.newSha} ${update.refName}\n`;
        }
        const encoded = encodePktLine(line);
        if (typeof encoded === 'string') {
            parts.push(encoder.encode(encoded));
        }
        else {
            parts.push(encoded);
        }
    }
    // Flush after commands
    parts.push(encoder.encode(FLUSH_PKT));
    // Push options (if enabled and provided)
    if (pushOptions && pushOptions.length > 0) {
        for (const option of pushOptions) {
            const encoded = encodePktLine(`${option}\n`);
            if (typeof encoded === 'string') {
                parts.push(encoder.encode(encoded));
            }
            else {
                parts.push(encoded);
            }
        }
        parts.push(encoder.encode(FLUSH_PKT));
    }
    // Add packfile
    parts.push(packfile);
    // Concatenate all parts
    let totalLength = 0;
    for (const part of parts) {
        totalLength += part.length;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
// ============================================================================
// Response Parsing
// ============================================================================
/**
 * Parse the report-status response.
 *
 * @param data - Response data (may include side-band encoding)
 * @returns Parsed ref results
 */
function parseReportStatus(data) {
    let text;
    // Check if response uses side-band encoding
    if (data.length > 4) {
        const prefix = decoder.decode(data.slice(0, 4));
        const len = parseInt(prefix, 16);
        if (!isNaN(len) && len > 4 && data.length >= len && data[4] === 1) {
            // Side-band channel 1 - extract and demultiplex
            text = demultiplexSideBand(data);
        }
        else {
            text = decoder.decode(data);
        }
    }
    else {
        text = decoder.decode(data);
    }
    const { packets } = pktLineStream(text);
    const refResults = [];
    let unpackOk = false;
    for (const packet of packets) {
        if (packet.type === 'flush' || !packet.data)
            continue;
        const line = packet.data.trim();
        if (line.startsWith('unpack ')) {
            unpackOk = line === 'unpack ok';
        }
        else if (line.startsWith('ok ')) {
            const refName = line.slice(3).trim();
            refResults.push({ refName, success: true });
        }
        else if (line.startsWith('ng ')) {
            const rest = line.slice(3);
            const spaceIndex = rest.indexOf(' ');
            if (spaceIndex !== -1) {
                const refName = rest.slice(0, spaceIndex);
                const error = rest.slice(spaceIndex + 1);
                refResults.push({ refName, success: false, error });
            }
            else {
                refResults.push({ refName: rest, success: false, error: 'unknown error' });
            }
        }
    }
    return { unpackOk, refResults };
}
/**
 * Demultiplex side-band encoded response.
 *
 * @param data - Side-band encoded data
 * @returns Concatenated channel 1 data as string
 */
function demultiplexSideBand(data) {
    const parts = [];
    let offset = 0;
    while (offset < data.length) {
        if (offset + 4 > data.length)
            break;
        const hexLen = decoder.decode(data.slice(offset, offset + 4));
        // Flush packet
        if (hexLen === '0000') {
            break;
        }
        const len = parseInt(hexLen, 16);
        if (isNaN(len) || len < 5 || offset + len > data.length)
            break;
        const channel = data[offset + 4];
        // Channel 1 is data
        if (channel === 1) {
            parts.push(decoder.decode(data.slice(offset + 5, offset + len)));
        }
        // Channel 2 is progress (could log it)
        // Channel 3 is error
        else if (channel === 3) {
            const errorMsg = decoder.decode(data.slice(offset + 5, offset + len));
            throw new Error(`Server error: ${errorMsg}`);
        }
        offset += len;
    }
    return parts.join('');
}
// ============================================================================
// Main Push Function
// ============================================================================
/**
 * Push refs to a remote repository.
 *
 * @description
 * Implements the git send-pack protocol to push local refs to a remote
 * repository. This is equivalent to `git push`.
 *
 * The push process:
 * 1. Discover remote refs via info/refs?service=git-receive-pack
 * 2. Determine which objects need to be sent
 * 3. Generate a packfile with those objects
 * 4. Send ref update commands + packfile to the remote
 * 5. Parse and return the server's status report
 *
 * @param options - Push options
 * @returns Push result with per-ref status
 *
 * @example
 * ```typescript
 * const result = await push({
 *   url: 'https://github.com/user/repo.git',
 *   auth: { username: 'token', password: 'ghp_xxx' },
 *   refUpdates: [
 *     {
 *       refName: 'refs/heads/main',
 *       oldSha: 'abc123...',
 *       newSha: 'def456...'
 *     }
 *   ],
 *   backend
 * })
 *
 * if (result.success) {
 *   console.log(`Pushed ${result.objectsSent} objects`)
 * } else {
 *   console.error('Push failed:', result.error)
 * }
 * ```
 */
export async function push(options) {
    const { url, auth, refUpdates, backend, onProgress, fetch: fetchFn = fetch, force = false, atomic = false, pushOptions,
    // thinPack is reserved for future thin pack optimization
     } = options;
    try {
        // Step 1: Parse URL
        const parsed = parseCloneUrl(url);
        if (parsed.protocol === 'ssh') {
            return {
                success: false,
                error: 'SSH protocol is not yet supported. Use HTTPS URL instead.',
                refResults: [],
                objectsSent: 0,
                packSize: 0
            };
        }
        // Step 2: Discover remote refs
        if (onProgress) {
            onProgress('Discovering remote refs...');
        }
        const remoteAdvert = await discoverReceivePackRefs(parsed, { auth, fetch: fetchFn });
        // Build remote ref map
        const remoteRefs = new Map();
        for (const ref of remoteAdvert.refs) {
            remoteRefs.set(ref.name, ref.sha);
        }
        // Step 3: Validate ref updates
        const validatedUpdates = [];
        for (const update of refUpdates) {
            // Validate SHA format
            if (!SHA1_REGEX.test(update.oldSha) && update.oldSha !== ZERO_SHA) {
                return {
                    success: false,
                    error: `Invalid oldSha for ${update.refName}: ${update.oldSha}`,
                    refResults: [],
                    objectsSent: 0,
                    packSize: 0
                };
            }
            if (!SHA1_REGEX.test(update.newSha) && update.newSha !== ZERO_SHA) {
                return {
                    success: false,
                    error: `Invalid newSha for ${update.refName}: ${update.newSha}`,
                    refResults: [],
                    objectsSent: 0,
                    packSize: 0
                };
            }
            // Check for delete without delete-refs capability
            if (update.newSha === ZERO_SHA && !remoteAdvert.capabilities.deleteRefs) {
                return {
                    success: false,
                    error: `Server does not support delete-refs for ${update.refName}`,
                    refResults: [],
                    objectsSent: 0,
                    packSize: 0
                };
            }
            // Verify oldSha matches remote state (unless force push)
            const remoteCurrentSha = remoteRefs.get(update.refName) ?? ZERO_SHA;
            if (!force && !update.force && update.oldSha !== remoteCurrentSha) {
                return {
                    success: false,
                    error: `Ref ${update.refName} has changed on remote. Expected ${update.oldSha}, found ${remoteCurrentSha}`,
                    refResults: [],
                    objectsSent: 0,
                    packSize: 0
                };
            }
            // Use actual remote SHA as oldSha for the command
            validatedUpdates.push({
                ...update,
                oldSha: force || update.force ? remoteCurrentSha : update.oldSha
            });
        }
        if (validatedUpdates.length === 0) {
            return {
                success: true,
                refResults: [],
                objectsSent: 0,
                packSize: 0
            };
        }
        // Step 4: Collect objects to send
        if (onProgress) {
            onProgress('Collecting objects to push...');
        }
        const objectsToSend = await collectObjectsToSend(backend, validatedUpdates, remoteRefs, onProgress);
        // Step 5: Generate packfile
        if (onProgress) {
            onProgress(`Compressing ${objectsToSend.length} objects...`);
        }
        let packfile;
        if (objectsToSend.length > 0) {
            packfile = generatePackfile(objectsToSend);
        }
        else {
            // Empty packfile for delete-only operations
            packfile = generatePackfile([]);
        }
        if (onProgress) {
            onProgress(`Compressing objects: 100% (${objectsToSend.length}/${objectsToSend.length}), done.`);
        }
        // Step 6: Build client capabilities
        const clientCaps = buildClientCapabilities(remoteAdvert.capabilities, {
            ...options,
            atomic
        });
        // Step 7: Build request body
        const requestBody = buildPushRequest(validatedUpdates, clientCaps, packfile, remoteAdvert.capabilities.pushOptions ? pushOptions : undefined);
        // Step 8: Send push request
        if (onProgress) {
            onProgress('Pushing to remote...');
        }
        const serviceUrl = `${parsed.baseUrl}/git-receive-pack`;
        const headers = {
            'Content-Type': 'application/x-git-receive-pack-request',
            'Accept': 'application/x-git-receive-pack-result',
            'User-Agent': USER_AGENT
        };
        // Add authentication
        if (auth) {
            const credentials = btoa(`${auth.username}:${auth.password}`);
            headers['Authorization'] = `Basic ${credentials}`;
        }
        else if (parsed.username && parsed.password) {
            const credentials = btoa(`${parsed.username}:${parsed.password}`);
            headers['Authorization'] = `Basic ${credentials}`;
        }
        const response = await fetchFn(serviceUrl, {
            method: 'POST',
            headers,
            body: requestBody
        });
        if (!response.ok) {
            return {
                success: false,
                error: `Push failed: ${response.status} ${response.statusText}`,
                refResults: [],
                objectsSent: objectsToSend.length,
                packSize: packfile.length
            };
        }
        // Step 9: Parse response
        const responseData = new Uint8Array(await response.arrayBuffer());
        // If server supports report-status, parse the response
        if (remoteAdvert.capabilities.reportStatus && responseData.length > 0) {
            const { unpackOk, refResults } = parseReportStatus(responseData);
            if (!unpackOk) {
                return {
                    success: false,
                    error: 'Remote failed to unpack objects',
                    refResults,
                    objectsSent: objectsToSend.length,
                    packSize: packfile.length
                };
            }
            // Check if all refs succeeded
            const allSuccess = refResults.every(r => r.success);
            if (onProgress) {
                onProgress('Push complete.');
            }
            if (allSuccess) {
                return {
                    success: true,
                    refResults,
                    objectsSent: objectsToSend.length,
                    packSize: packfile.length
                };
            }
            else {
                return {
                    success: false,
                    error: 'Some refs failed to update',
                    refResults,
                    objectsSent: objectsToSend.length,
                    packSize: packfile.length
                };
            }
        }
        // No report-status - assume success if we got 200 OK
        if (onProgress) {
            onProgress('Push complete.');
        }
        return {
            success: true,
            refResults: validatedUpdates.map(u => ({
                refName: u.refName,
                success: true
            })),
            objectsSent: objectsToSend.length,
            packSize: packfile.length
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            refResults: [],
            objectsSent: 0,
            packSize: 0
        };
    }
}
// ============================================================================
// Convenience Functions
// ============================================================================
/**
 * Push a single branch to a remote.
 *
 * @param url - Remote repository URL
 * @param backend - Git backend
 * @param branchName - Branch name (without refs/heads/ prefix)
 * @param options - Additional options
 * @returns Push result
 *
 * @example
 * ```typescript
 * const result = await pushBranch(
 *   'https://github.com/user/repo.git',
 *   backend,
 *   'main',
 *   { auth: { username: 'token', password: 'ghp_xxx' } }
 * )
 * ```
 */
export async function pushBranch(url, backend, branchName, options) {
    const refName = branchName.startsWith('refs/') ? branchName : `refs/heads/${branchName}`;
    // Get local ref SHA
    const localSha = await backend.readRef(refName);
    if (!localSha) {
        return {
            success: false,
            error: `Local ref ${refName} not found`,
            refResults: [],
            objectsSent: 0,
            packSize: 0
        };
    }
    // Discover remote to get current SHA
    const discoverOpts = {};
    if (options?.auth)
        discoverOpts.auth = options.auth;
    if (options?.fetch)
        discoverOpts.fetch = options.fetch;
    const remoteAdvert = await discoverReceivePackRefs(url, discoverOpts);
    const remoteRef = remoteAdvert.refs.find(r => r.name === refName);
    const remoteSha = remoteRef?.sha ?? ZERO_SHA;
    const pushOpts = {
        url,
        backend,
        refUpdates: [{
                refName,
                oldSha: remoteSha,
                newSha: localSha
            }]
    };
    if (options?.auth)
        pushOpts.auth = options.auth;
    if (options?.force !== undefined)
        pushOpts.force = options.force;
    if (options?.onProgress)
        pushOpts.onProgress = options.onProgress;
    if (options?.fetch)
        pushOpts.fetch = options.fetch;
    return push(pushOpts);
}
/**
 * Delete a branch on a remote.
 *
 * @param url - Remote repository URL
 * @param branchName - Branch name to delete
 * @param options - Additional options
 * @returns Push result
 *
 * @example
 * ```typescript
 * const result = await deleteBranch(
 *   'https://github.com/user/repo.git',
 *   'old-feature',
 *   { auth: { username: 'token', password: 'ghp_xxx' } }
 * )
 * ```
 */
export async function deleteBranch(url, branchName, backend, options) {
    const refName = branchName.startsWith('refs/') ? branchName : `refs/heads/${branchName}`;
    // Discover remote to get current SHA
    const discoverOpts = {};
    if (options?.auth)
        discoverOpts.auth = options.auth;
    if (options?.fetch)
        discoverOpts.fetch = options.fetch;
    const remoteAdvert = await discoverReceivePackRefs(url, discoverOpts);
    const remoteRef = remoteAdvert.refs.find(r => r.name === refName);
    if (!remoteRef) {
        return {
            success: false,
            error: `Remote ref ${refName} not found`,
            refResults: [],
            objectsSent: 0,
            packSize: 0
        };
    }
    const pushOpts = {
        url,
        backend,
        refUpdates: [{
                refName,
                oldSha: remoteRef.sha,
                newSha: ZERO_SHA
            }]
    };
    if (options?.auth)
        pushOpts.auth = options.auth;
    if (options?.onProgress)
        pushOpts.onProgress = options.onProgress;
    if (options?.fetch)
        pushOpts.fetch = options.fetch;
    return push(pushOpts);
}
//# sourceMappingURL=send-pack.js.map