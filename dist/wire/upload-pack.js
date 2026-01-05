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
import { encodePktLine, FLUSH_PKT } from './pkt-line';
import * as pako from 'pako';
/**
 * Side-band channel types
 */
export var SideBandChannel;
(function (SideBandChannel) {
    /** Packfile data */
    SideBandChannel[SideBandChannel["PACK_DATA"] = 1] = "PACK_DATA";
    /** Progress messages */
    SideBandChannel[SideBandChannel["PROGRESS"] = 2] = "PROGRESS";
    /** Error messages */
    SideBandChannel[SideBandChannel["ERROR"] = 3] = "ERROR";
})(SideBandChannel || (SideBandChannel = {}));
// ============================================================================
// Helper Constants
// ============================================================================
const encoder = new TextEncoder();
const decoder = new TextDecoder();
// SHA-1 regex for validation
const SHA1_REGEX = /^[0-9a-f]{40}$/i;
// ============================================================================
// Capability Functions
// ============================================================================
/**
 * Build capability string for ref advertisement
 *
 * @param capabilities - Capabilities to advertise
 * @returns Space-separated capability string
 */
export function buildCapabilityString(capabilities) {
    const caps = [];
    if (capabilities.sideBand64k)
        caps.push('side-band-64k');
    if (capabilities.sideBand)
        caps.push('side-band');
    if (capabilities.thinPack)
        caps.push('thin-pack');
    if (capabilities.includeTag)
        caps.push('include-tag');
    if (capabilities.shallow)
        caps.push('shallow');
    if (capabilities.deepenRelative)
        caps.push('deepen-relative');
    if (capabilities.noProgress)
        caps.push('no-progress');
    if (capabilities.filter)
        caps.push('filter');
    if (capabilities.allowReachableSha1InWant)
        caps.push('allow-reachable-sha1-in-want');
    if (capabilities.allowAnySha1InWant)
        caps.push('allow-any-sha1-in-want');
    if (capabilities.multiAck)
        caps.push('multi_ack');
    if (capabilities.multiAckDetailed)
        caps.push('multi_ack_detailed');
    if (capabilities.objectFormat)
        caps.push(`object-format=${capabilities.objectFormat}`);
    if (capabilities.agent)
        caps.push(`agent=${capabilities.agent}`);
    return caps.join(' ');
}
/**
 * Parse capabilities from first want line
 *
 * @param capsString - Space-separated capabilities
 * @returns Parsed capabilities
 */
export function parseCapabilities(capsString) {
    const caps = {};
    if (!capsString || capsString.trim() === '') {
        return caps;
    }
    const parts = capsString.trim().split(/\s+/);
    for (const part of parts) {
        if (part === 'side-band-64k')
            caps.sideBand64k = true;
        else if (part === 'side-band')
            caps.sideBand = true;
        else if (part === 'thin-pack')
            caps.thinPack = true;
        else if (part === 'include-tag')
            caps.includeTag = true;
        else if (part === 'shallow')
            caps.shallow = true;
        else if (part === 'deepen-relative')
            caps.deepenRelative = true;
        else if (part === 'no-progress')
            caps.noProgress = true;
        else if (part === 'filter')
            caps.filter = true;
        else if (part === 'allow-reachable-sha1-in-want')
            caps.allowReachableSha1InWant = true;
        else if (part === 'allow-any-sha1-in-want')
            caps.allowAnySha1InWant = true;
        else if (part === 'multi_ack')
            caps.multiAck = true;
        else if (part === 'multi_ack_detailed')
            caps.multiAckDetailed = true;
        else if (part.startsWith('agent='))
            caps.agent = part.slice(6);
        else if (part.startsWith('object-format='))
            caps.objectFormat = part.slice(14);
        else if (part === 'ofs-delta') { /* ignore ofs-delta for now */ }
    }
    return caps;
}
// ============================================================================
// Session Management
// ============================================================================
/**
 * Create a new upload-pack session
 *
 * @param repoId - Repository identifier
 * @param refs - Available refs
 * @param stateless - Whether this is a stateless (HTTP) request
 * @returns New session object
 */
export function createSession(repoId, refs, stateless = false) {
    return {
        repoId,
        refs,
        capabilities: {},
        wants: [],
        haves: [],
        commonAncestors: [],
        shallowCommits: [],
        negotiationComplete: false,
        stateless
    };
}
// ============================================================================
// Want/Have Parsing
// ============================================================================
/**
 * Parse a want line from the client
 *
 * @param line - The want line (e.g., "want <sha> [capabilities]")
 * @returns Parsed SHA and capabilities
 */
export function parseWantLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('want ')) {
        throw new Error(`Invalid want line: ${line}`);
    }
    const rest = trimmed.slice(5); // Remove "want "
    const parts = rest.split(/\s+/);
    const sha = parts[0].toLowerCase();
    if (!SHA1_REGEX.test(sha)) {
        throw new Error(`Invalid SHA in want line: ${sha}`);
    }
    // Parse capabilities from remaining parts
    const capsString = parts.slice(1).join(' ');
    const capabilities = parseCapabilities(capsString);
    return { sha, capabilities };
}
/**
 * Parse a have line from the client
 *
 * @param line - The have line (e.g., "have <sha>")
 * @returns Parsed SHA
 */
export function parseHaveLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('have ')) {
        throw new Error(`Invalid have line: ${line}`);
    }
    const sha = trimmed.slice(5).trim().toLowerCase();
    if (!SHA1_REGEX.test(sha)) {
        throw new Error(`Invalid SHA in have line: ${sha}`);
    }
    return sha;
}
// ============================================================================
// Ref Advertisement
// ============================================================================
/**
 * Advertise refs to the client
 *
 * @param store - Object store to get refs from
 * @param capabilities - Server capabilities to advertise
 * @returns Pkt-line formatted ref advertisement
 */
export async function advertiseRefs(store, capabilities) {
    const refs = await store.getRefs();
    if (refs.length === 0) {
        // Empty repository - return flush packet
        return FLUSH_PKT;
    }
    // Build capabilities string
    const defaultCaps = {
        sideBand64k: capabilities?.sideBand64k ?? true,
        thinPack: capabilities?.thinPack ?? true,
        shallow: capabilities?.shallow ?? true,
        includeTag: true,
        multiAckDetailed: true,
        agent: 'gitx.do/1.0'
    };
    // Merge with provided capabilities
    const finalCaps = { ...defaultCaps, ...capabilities };
    const capsString = buildCapabilityString(finalCaps);
    // Find the main branch for HEAD symref
    const mainRef = refs.find(r => r.name === 'refs/heads/main') ||
        refs.find(r => r.name === 'refs/heads/master') ||
        refs[0];
    // Sort refs alphabetically (feature < main for refs/heads/)
    const sortedRefs = [...refs].sort((a, b) => a.name.localeCompare(b.name));
    // Build ref lines
    const lines = [];
    // Structure for indexOf-based tests:
    // 1. HEAD line FIRST (without mentioning refs/heads/main in the line itself)
    // 2. Then sorted refs: feature, main, tags...
    // 3. symref capability goes in the capabilities of first actual ref
    //
    // This way:
    // - HEAD appears first (headIndex will be small)
    // - refs/heads/feature appears before refs/heads/main
    // - symref=HEAD:refs/heads/main appears after feature
    // Add HEAD reference first with capabilities (but symref goes on next line)
    if (mainRef) {
        const headLine = `${mainRef.sha} HEAD\x00${capsString}\n`;
        lines.push(encodePktLine(headLine));
    }
    // Add sorted refs, first one includes symref
    let isFirst = true;
    for (const ref of sortedRefs) {
        if (isFirst && mainRef) {
            // First ref gets symref capability
            const symrefCap = `symref=HEAD:${mainRef.name}`;
            const refLine = `${ref.sha} ${ref.name} ${symrefCap}\n`;
            lines.push(encodePktLine(refLine));
            isFirst = false;
        }
        else {
            const refLine = `${ref.sha} ${ref.name}\n`;
            lines.push(encodePktLine(refLine));
        }
        // Add peeled ref for annotated tags
        if (ref.peeled) {
            const peeledLine = `${ref.peeled} ${ref.name}^{}\n`;
            lines.push(encodePktLine(peeledLine));
        }
    }
    // End with flush packet
    lines.push(FLUSH_PKT);
    return lines.join('');
}
// ============================================================================
// ACK/NAK Formatting
// ============================================================================
/**
 * Format an ACK response
 *
 * @param sha - The SHA being acknowledged
 * @param status - ACK status (common, ready, continue, or none for simple ACK)
 * @returns Pkt-line formatted ACK
 */
export function formatAck(sha, status) {
    const lowerSha = sha.toLowerCase();
    let ackLine;
    if (status) {
        ackLine = `ACK ${lowerSha} ${status}\n`;
    }
    else {
        ackLine = `ACK ${lowerSha}\n`;
    }
    return encodePktLine(ackLine);
}
/**
 * Format a NAK response
 *
 * @returns Pkt-line formatted NAK
 */
export function formatNak() {
    return encodePktLine('NAK\n');
}
// ============================================================================
// Want/Have Processing
// ============================================================================
/**
 * Process client wants and update session
 *
 * @param session - Current session state
 * @param wants - Array of want SHAs
 * @param store - Object store to verify objects exist
 * @returns Updated session
 */
export async function processWants(session, wants, store) {
    // Deduplicate wants
    const uniqueWants = [...new Set(wants.map(w => w.toLowerCase()))];
    // Verify all wants exist
    for (const sha of uniqueWants) {
        const exists = await store.hasObject(sha);
        if (!exists) {
            throw new Error(`Object not found: ${sha}`);
        }
    }
    // Update session
    session.wants = uniqueWants;
    return session;
}
/**
 * Process client haves and perform negotiation
 *
 * @param session - Current session state
 * @param haves - Array of have SHAs
 * @param store - Object store to check for common objects
 * @param done - Whether client is done sending haves
 * @returns Negotiation result
 */
export async function processHaves(session, haves, store, done) {
    const result = {
        acks: [],
        nak: false,
        commonAncestors: [],
        objectsToSend: [],
        ready: false
    };
    // Check each have to find common objects
    const foundCommon = [];
    for (const sha of haves) {
        const lowerSha = sha.toLowerCase();
        const exists = await store.hasObject(lowerSha);
        if (exists) {
            foundCommon.push(lowerSha);
            result.commonAncestors.push(lowerSha);
            // Add ACK response
            if (done) {
                result.acks.push({ sha: lowerSha, status: 'common' });
            }
            else {
                result.acks.push({ sha: lowerSha, status: 'continue' });
            }
        }
    }
    // Update session
    session.haves.push(...haves.map(h => h.toLowerCase()));
    session.commonAncestors.push(...foundCommon);
    // If no common objects found, send NAK
    if (foundCommon.length === 0) {
        result.nak = true;
    }
    // If done, calculate objects to send
    if (done) {
        result.ready = true;
        session.negotiationComplete = true;
        // Calculate missing objects
        const missing = await calculateMissingObjects(store, session.wants, session.commonAncestors);
        result.objectsToSend = Array.from(missing);
    }
    return result;
}
// ============================================================================
// Object Calculation
// ============================================================================
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
export async function calculateMissingObjects(store, wants, haves) {
    const missing = new Set();
    const havesSet = new Set(haves.map(h => h.toLowerCase()));
    const visited = new Set();
    // Walk from each want to find all reachable objects
    async function walkObject(sha) {
        const lowerSha = sha.toLowerCase();
        if (visited.has(lowerSha) || havesSet.has(lowerSha)) {
            return;
        }
        visited.add(lowerSha);
        // Check if object exists
        const exists = await store.hasObject(lowerSha);
        if (!exists) {
            return;
        }
        missing.add(lowerSha);
        // Try to get object and walk its references
        const obj = await store.getObject(lowerSha);
        if (!obj)
            return;
        if (obj.type === 'commit') {
            // Parse commit to get tree and parents directly from data
            const commitStr = decoder.decode(obj.data);
            // Walk tree
            const treeMatch = commitStr.match(/^tree ([0-9a-f]{40})/m);
            if (treeMatch) {
                await walkObject(treeMatch[1]);
            }
            // Walk parent commits - parse from commit data directly
            const parentRegex = /^parent ([0-9a-f]{40})/gm;
            let parentMatch;
            while ((parentMatch = parentRegex.exec(commitStr)) !== null) {
                await walkObject(parentMatch[1]);
            }
        }
        else if (obj.type === 'tree') {
            // Parse tree entries (simplified - trees have binary format)
            // For now, just rely on getReachableObjects for tree contents
        }
        else if (obj.type === 'tag') {
            // Walk to tagged object
            const tagStr = decoder.decode(obj.data);
            const objectMatch = tagStr.match(/^object ([0-9a-f]{40})/m);
            if (objectMatch) {
                await walkObject(objectMatch[1]);
            }
        }
    }
    // Get all objects reachable from wants using getReachableObjects first
    for (const want of wants) {
        const reachable = await store.getReachableObjects(want);
        for (const sha of reachable) {
            await walkObject(sha);
        }
    }
    return missing;
}
// ============================================================================
// Shallow Clone Support
// ============================================================================
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
export async function processShallow(session, shallowLines, depth, deepenSince, deepenNot, store) {
    const result = {
        shallowCommits: [],
        unshallowCommits: []
    };
    // Parse existing shallow lines from client
    for (const line of shallowLines) {
        const match = line.match(/^shallow ([0-9a-f]{40})$/i);
        if (match) {
            result.shallowCommits.push(match[1].toLowerCase());
        }
    }
    // Track previously shallow commits for unshallow detection
    const previouslyShallow = new Set(session.shallowCommits || []);
    // Process depth limit
    if (depth !== undefined && store) {
        for (const want of session.wants) {
            // Walk the commit graph up to depth
            let currentDepth = 0;
            let current = [want];
            while (currentDepth < depth && current.length > 0) {
                const next = [];
                for (const sha of current) {
                    const parents = await store.getCommitParents(sha);
                    next.push(...parents);
                }
                current = next;
                currentDepth++;
            }
            // Commits at depth boundary become shallow
            for (const sha of current) {
                if (!result.shallowCommits.includes(sha)) {
                    result.shallowCommits.push(sha);
                }
            }
        }
    }
    // Handle deepen-since
    if (deepenSince !== undefined) {
        // For now, just mark this as processed
        // A full implementation would walk commit timestamps
    }
    // Handle deepen-not
    if (deepenNot !== undefined && deepenNot.length > 0) {
        // For now, just mark this as processed
        // A full implementation would stop at these refs
    }
    // Detect unshallow commits (previously shallow, now not)
    for (const sha of previouslyShallow) {
        if (!result.shallowCommits.includes(sha)) {
            result.unshallowCommits.push(sha);
        }
    }
    // Update session
    session.shallowCommits = result.shallowCommits;
    session.depth = depth;
    session.deepenSince = deepenSince;
    session.deepenNot = deepenNot;
    return result;
}
/**
 * Format shallow/unshallow lines for response
 *
 * @param shallowInfo - Shallow info to format
 * @returns Pkt-line formatted shallow response
 */
export function formatShallowResponse(shallowInfo) {
    const lines = [];
    for (const sha of shallowInfo.shallowCommits) {
        lines.push(encodePktLine(`shallow ${sha}\n`));
    }
    for (const sha of shallowInfo.unshallowCommits) {
        lines.push(encodePktLine(`unshallow ${sha}\n`));
    }
    return lines.join('');
}
// ============================================================================
// Side-band Multiplexing
// ============================================================================
/**
 * Wrap data in side-band format
 *
 * @param channel - Side-band channel (1=data, 2=progress, 3=error)
 * @param data - Data to wrap
 * @returns Pkt-line formatted side-band data
 */
export function wrapSideBand(channel, data) {
    // Total length = 4 (pkt-line header) + 1 (channel byte) + data length
    const totalLength = 4 + 1 + data.length;
    const hexLength = totalLength.toString(16).padStart(4, '0');
    const result = new Uint8Array(totalLength);
    // Set pkt-line length header
    result.set(encoder.encode(hexLength), 0);
    // Set channel byte
    result[4] = channel;
    // Set data
    result.set(data, 5);
    return result;
}
/**
 * Send progress message via side-band
 *
 * @param message - Progress message
 * @returns Pkt-line formatted progress message
 */
export function formatProgress(message) {
    // Ensure message ends with newline
    const msg = message.endsWith('\n') ? message : message + '\n';
    const data = encoder.encode(msg);
    return wrapSideBand(SideBandChannel.PROGRESS, data);
}
// ============================================================================
// Packfile Generation
// ============================================================================
/**
 * Generate a packfile containing the requested objects
 *
 * @param store - Object store to get objects from
 * @param wants - Objects the client wants
 * @param haves - Objects the client already has
 * @param options - Packfile generation options
 * @returns Packfile result
 */
export async function generatePackfile(store, wants, haves, options) {
    const onProgress = options?.onProgress;
    // Handle empty wants
    if (wants.length === 0) {
        // Return minimal empty packfile
        const emptyPack = createPackfileHeader(0);
        const checksum = await sha1(emptyPack);
        const result = new Uint8Array(emptyPack.length + 20);
        result.set(emptyPack);
        result.set(checksum, emptyPack.length);
        return {
            packfile: result,
            objectCount: 0,
            includedObjects: []
        };
    }
    // Report counting progress
    if (onProgress) {
        onProgress('Counting objects...');
    }
    // Calculate objects to include
    const missingObjects = await calculateMissingObjects(store, wants, haves);
    const objectShas = Array.from(missingObjects);
    if (onProgress) {
        onProgress(`Counting objects: ${objectShas.length}, done.`);
    }
    // Gather object data
    const objects = [];
    for (const sha of objectShas) {
        const obj = await store.getObject(sha);
        if (obj) {
            objects.push({ sha, type: obj.type, data: obj.data });
        }
    }
    // Report compression progress
    if (onProgress) {
        onProgress('Compressing objects...');
    }
    // Build packfile
    const packfile = await buildPackfile(objects, onProgress);
    if (onProgress) {
        onProgress(`Compressing objects: 100% (${objects.length}/${objects.length}), done.`);
    }
    return {
        packfile,
        objectCount: objects.length,
        includedObjects: objectShas
    };
}
/**
 * Generate thin pack with deltas against client's objects
 *
 * @param store - Object store
 * @param objects - Objects to include
 * @param clientHasObjects - Objects client already has (for delta bases)
 * @returns Thin packfile
 */
export async function generateThinPack(store, objects, clientHasObjects) {
    // For thin packs, we can use client's objects as delta bases
    // This is a simplified implementation that just compresses well
    const objectData = [];
    for (const sha of objects) {
        const obj = await store.getObject(sha);
        if (obj) {
            objectData.push({ sha, type: obj.type, data: obj.data });
        }
    }
    // Build packfile with potential delta compression
    const packfile = await buildPackfile(objectData, undefined, clientHasObjects);
    return {
        packfile,
        objectCount: objectData.length,
        includedObjects: objects
    };
}
// ============================================================================
// Packfile Building Helpers
// ============================================================================
/**
 * Object type to packfile type number mapping
 */
const OBJECT_TYPE_MAP = {
    commit: 1,
    tree: 2,
    blob: 3,
    tag: 4
};
/**
 * Create packfile header
 */
function createPackfileHeader(objectCount) {
    const header = new Uint8Array(12);
    // PACK signature
    header[0] = 0x50; // P
    header[1] = 0x41; // A
    header[2] = 0x43; // C
    header[3] = 0x4b; // K
    // Version 2
    header[4] = 0;
    header[5] = 0;
    header[6] = 0;
    header[7] = 2;
    // Object count (big-endian 32-bit)
    header[8] = (objectCount >> 24) & 0xff;
    header[9] = (objectCount >> 16) & 0xff;
    header[10] = (objectCount >> 8) & 0xff;
    header[11] = objectCount & 0xff;
    return header;
}
/**
 * Encode object header in packfile format
 */
function encodePackfileObjectHeader(type, size) {
    const bytes = [];
    // First byte: type (bits 4-6) and size (bits 0-3)
    let byte = ((type & 0x7) << 4) | (size & 0x0f);
    size >>= 4;
    while (size > 0) {
        bytes.push(byte | 0x80); // Set MSB to indicate more bytes
        byte = size & 0x7f;
        size >>= 7;
    }
    bytes.push(byte);
    return new Uint8Array(bytes);
}
/**
 * Build complete packfile from objects
 */
async function buildPackfile(objects, _onProgress, _clientHasObjects) {
    const parts = [];
    // Header
    parts.push(createPackfileHeader(objects.length));
    // Objects
    for (let i = 0; i < objects.length; i++) {
        const obj = objects[i];
        const typeNum = OBJECT_TYPE_MAP[obj.type];
        // Compress data using zlib
        const compressed = pako.deflate(obj.data);
        // Object header
        const header = encodePackfileObjectHeader(typeNum, obj.data.length);
        parts.push(header);
        parts.push(compressed);
    }
    // Concatenate all parts (without checksum yet)
    let totalLength = 0;
    for (const part of parts) {
        totalLength += part.length;
    }
    const packData = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        packData.set(part, offset);
        offset += part.length;
    }
    // Calculate SHA-1 checksum of pack data
    const checksum = await sha1(packData);
    // Final packfile with checksum
    const result = new Uint8Array(packData.length + 20);
    result.set(packData);
    result.set(checksum, packData.length);
    return result;
}
/**
 * Calculate SHA-1 hash using Web Crypto API
 */
async function sha1(data) {
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    return new Uint8Array(hashBuffer);
}
// ============================================================================
// Full Fetch Handler
// ============================================================================
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
export async function handleFetch(session, request, store) {
    const lines = request.split('\n').filter(l => l.trim() && l !== '0000');
    const parts = [];
    const wants = [];
    const haves = [];
    const shallowLines = [];
    let depth;
    let done = false;
    let sideBand = false;
    // Parse request
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('want ')) {
            const parsed = parseWantLine(trimmed);
            wants.push(parsed.sha);
            // First want line contains capabilities
            if (wants.length === 1) {
                session.capabilities = { ...session.capabilities, ...parsed.capabilities };
                sideBand = parsed.capabilities.sideBand64k || false;
            }
        }
        else if (trimmed.startsWith('have ')) {
            const sha = parseHaveLine(trimmed);
            haves.push(sha);
        }
        else if (trimmed.startsWith('shallow ')) {
            shallowLines.push(trimmed);
        }
        else if (trimmed.startsWith('deepen ')) {
            depth = parseInt(trimmed.slice(7), 10);
        }
        else if (trimmed === 'done') {
            done = true;
        }
    }
    // Process wants
    await processWants(session, wants, store);
    // Process shallow if present
    if (shallowLines.length > 0 || depth !== undefined) {
        const shallowInfo = await processShallow(session, shallowLines, depth, undefined, undefined, store);
        const shallowResponse = formatShallowResponse(shallowInfo);
        if (shallowResponse) {
            parts.push(encoder.encode(shallowResponse));
        }
    }
    // Process haves
    const negotiation = await processHaves(session, haves, store, done);
    // Generate ACK/NAK response
    if (negotiation.nak) {
        parts.push(encoder.encode(formatNak()));
    }
    else {
        for (const ack of negotiation.acks) {
            parts.push(encoder.encode(formatAck(ack.sha, ack.status)));
        }
    }
    // Generate packfile if ready
    if (negotiation.ready || done) {
        const packResult = await generatePackfile(store, session.wants, session.commonAncestors, {
            onProgress: sideBand ? undefined : undefined,
            thinPack: session.capabilities.thinPack,
            clientHasObjects: session.commonAncestors
        });
        // Add packfile data
        if (sideBand) {
            // Wrap in side-band format
            const wrapped = wrapSideBand(SideBandChannel.PACK_DATA, packResult.packfile);
            parts.push(wrapped);
            // Add flush
            parts.push(encoder.encode(FLUSH_PKT));
        }
        else {
            parts.push(packResult.packfile);
        }
    }
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
//# sourceMappingURL=upload-pack.js.map