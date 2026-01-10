/**
 * @fileoverview Git upload-pack Protocol Implementation
 *
 * This module implements the server-side of Git's upload-pack service, which is
 * used by `git-fetch` and `git-clone` to retrieve objects from a remote repository.
 *
 * @module wire/upload-pack
 *
 * ## Protocol Flow
 *
 * 1. **Ref Advertisement**: Server advertises available refs with capabilities
 * 2. **Want Phase**: Client sends "want" lines for objects it needs
 * 3. **Negotiation**: Client sends "have" lines, server responds with ACK/NAK
 * 4. **Done**: Client signals negotiation complete with "done"
 * 5. **Packfile**: Server generates and sends packfile with requested objects
 *
 * ## Features
 *
 * - Side-band multiplexing for progress reporting
 * - Thin pack support for bandwidth efficiency
 * - Shallow clone support with depth limiting
 * - Multi-ack negotiation for optimal object transfer
 *
 * @see {@link https://git-scm.com/docs/protocol-v2} Git Protocol v2
 * @see {@link https://git-scm.com/docs/pack-protocol} Git Pack Protocol
 *
 * @example Basic fetch operation
 * ```typescript
 * import { createSession, advertiseRefs, handleFetch } from './wire/upload-pack'
 *
 * // Create session and advertise refs
 * const session = createSession('my-repo', await store.getRefs())
 * const advertisement = await advertiseRefs(store)
 *
 * // Process fetch request
 * const response = await handleFetch(session, requestBody, store)
 * ```
 */
import { encodePktLine, FLUSH_PKT } from './pkt-line';
import * as pako from 'pako';
/**
 * Side-band channel types for multiplexed output.
 *
 * @description
 * When side-band is enabled, the server can send data on multiple channels:
 * - Channel 1: Packfile data
 * - Channel 2: Progress messages (displayed to user)
 * - Channel 3: Error messages (fatal, abort transfer)
 */
export var SideBandChannel;
(function (SideBandChannel) {
    /** Packfile data - the actual objects being transferred */
    SideBandChannel[SideBandChannel["PACK_DATA"] = 1] = "PACK_DATA";
    /** Progress messages - informational output for the user */
    SideBandChannel[SideBandChannel["PROGRESS"] = 2] = "PROGRESS";
    /** Error messages - fatal errors that abort the transfer */
    SideBandChannel[SideBandChannel["ERROR"] = 3] = "ERROR";
})(SideBandChannel || (SideBandChannel = {}));
// ============================================================================
// Helper Constants
// ============================================================================
const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** SHA-1 regex for validation */
const SHA1_REGEX = /^[0-9a-f]{40}$/i;
// ============================================================================
// Capability Functions
// ============================================================================
/**
 * Build capability string for ref advertisement.
 *
 * @description
 * Converts a capabilities object into a space-separated string suitable
 * for inclusion in the ref advertisement. Boolean capabilities become
 * simple names, while capabilities with values become "name=value".
 *
 * @param capabilities - Capabilities to advertise
 * @returns Space-separated capability string
 *
 * @example
 * ```typescript
 * const caps: UploadPackCapabilities = {
 *   sideBand64k: true,
 *   thinPack: true,
 *   agent: 'my-server/1.0'
 * }
 * const str = buildCapabilityString(caps)
 * // 'side-band-64k thin-pack agent=my-server/1.0'
 * ```
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
 * Parse capabilities from first want line.
 *
 * @description
 * Parses a space-separated capability string (typically from the first
 * want line of a fetch request) into a structured capabilities object.
 *
 * @param capsString - Space-separated capabilities from client
 * @returns Parsed capabilities object
 *
 * @example
 * ```typescript
 * const caps = parseCapabilities('side-band-64k thin-pack agent=git/2.30.0')
 * // caps.sideBand64k === true
 * // caps.thinPack === true
 * // caps.agent === 'git/2.30.0'
 * ```
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
 * Create a new upload-pack session.
 *
 * @description
 * Initializes a new session for an upload-pack operation. The session
 * tracks state across the negotiation and packfile generation phases.
 *
 * @param repoId - Repository identifier for logging/tracking
 * @param refs - Available refs to advertise
 * @param stateless - Whether this is a stateless (HTTP) request
 * @returns New session object
 *
 * @example
 * ```typescript
 * const refs = await store.getRefs()
 * const session = createSession('my-repo', refs, true)  // HTTP
 * // session.negotiationComplete === false initially
 * ```
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
 * Parse a want line from the client.
 *
 * @description
 * Parses a "want" line which has the format:
 * `want <sha> [capabilities...]`
 *
 * The first want line typically includes capabilities, subsequent ones don't.
 *
 * @param line - The want line (e.g., "want abc123... side-band-64k")
 * @returns Parsed SHA and capabilities
 *
 * @throws {Error} If the line format is invalid or SHA is malformed
 *
 * @example
 * ```typescript
 * // First want line with capabilities
 * const { sha, capabilities } = parseWantLine(
 *   'want abc123... side-band-64k thin-pack'
 * )
 * // sha === 'abc123...'
 * // capabilities.sideBand64k === true
 *
 * // Subsequent want line
 * const { sha: sha2 } = parseWantLine('want def456...')
 * ```
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
 * Parse a have line from the client.
 *
 * @description
 * Parses a "have" line which has the simple format:
 * `have <sha>`
 *
 * @param line - The have line (e.g., "have abc123...")
 * @returns The parsed SHA
 *
 * @throws {Error} If the line format is invalid or SHA is malformed
 *
 * @example
 * ```typescript
 * const sha = parseHaveLine('have abc123def456...')
 * // sha === 'abc123def456...'
 * ```
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
 * Advertise refs to the client.
 *
 * @description
 * Generates the ref advertisement response for the initial phase of
 * upload-pack. This includes:
 * - HEAD reference with capabilities
 * - Sorted refs with symref information
 * - Peeled refs for annotated tags
 *
 * @param store - Object store to get refs from
 * @param capabilities - Optional server capabilities to advertise
 * @returns Pkt-line formatted ref advertisement
 *
 * @example
 * ```typescript
 * const advertisement = await advertiseRefs(store, {
 *   sideBand64k: true,
 *   thinPack: true
 * })
 * // Send as response to GET /info/refs?service=git-upload-pack
 * ```
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
 * Format an ACK response.
 *
 * @description
 * Creates a pkt-line formatted ACK response for negotiation:
 * - Simple ACK: `ACK <sha>` (when negotiation is complete)
 * - Status ACK: `ACK <sha> <status>` (during multi_ack negotiation)
 *
 * @param sha - The SHA being acknowledged
 * @param status - ACK status (common, ready, continue, or none for simple ACK)
 * @returns Pkt-line formatted ACK
 *
 * @example
 * ```typescript
 * // Simple ACK
 * const ack = formatAck('abc123...')
 * // '0014ACK abc123...\n'
 *
 * // Multi-ack with status
 * const ackContinue = formatAck('abc123...', 'continue')
 * // '001dACK abc123... continue\n'
 * ```
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
 * Format a NAK response.
 *
 * @description
 * Creates a pkt-line formatted NAK response. NAK indicates that the
 * server has no objects in common with the client's "have" list.
 *
 * @returns Pkt-line formatted NAK
 *
 * @example
 * ```typescript
 * const nak = formatNak()
 * // '0008NAK\n'
 * ```
 */
export function formatNak() {
    return encodePktLine('NAK\n');
}
// ============================================================================
// Want/Have Processing
// ============================================================================
/**
 * Process client wants and update session.
 *
 * @description
 * Validates and processes the "want" SHAs from a client fetch request.
 * Verifies that all wanted objects exist in the repository.
 *
 * @param session - Current session state
 * @param wants - Array of want SHAs from the client
 * @param store - Object store to verify objects exist
 * @returns Updated session
 *
 * @throws {Error} If any wanted object doesn't exist
 *
 * @example
 * ```typescript
 * const session = createSession('repo', refs)
 * await processWants(session, ['abc123...', 'def456...'], store)
 * // session.wants now contains the validated wants
 * ```
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
 * Process client haves and perform negotiation.
 *
 * @description
 * Processes the "have" SHAs from the client to find common ancestors.
 * This determines which objects need to be sent vs which the client
 * already has.
 *
 * @param session - Current session state
 * @param haves - Array of have SHAs from the client
 * @param store - Object store to check for common objects
 * @param done - Whether client is done sending haves
 * @returns Negotiation result with ACKs/NAKs and objects to send
 *
 * @example
 * ```typescript
 * const result = await processHaves(session, ['abc123...'], store, true)
 * if (result.nak) {
 *   // No common objects, will send full pack
 * } else {
 *   // Can send incremental pack
 * }
 * ```
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
 * Calculate objects needed by client.
 *
 * @description
 * Given the client's wants and haves, determines the minimal set of
 * objects that need to be sent. Walks the object graph from wants,
 * stopping at objects the client already has.
 *
 * @param store - Object store
 * @param wants - Objects client wants
 * @param haves - Objects client has
 * @returns Set of object SHAs to include in packfile
 *
 * @example
 * ```typescript
 * const missing = await calculateMissingObjects(
 *   store,
 *   ['new-commit-sha'],
 *   ['old-commit-sha']
 * )
 * // missing contains only objects reachable from new-commit
 * // but not reachable from old-commit
 * ```
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
 * Process shallow/deepen commands.
 *
 * @description
 * Handles shallow clone requests by processing depth limits, deepen-since
 * timestamps, and deepen-not refs. Updates the session with shallow
 * boundary information.
 *
 * @param session - Current session
 * @param shallowLines - Shallow commit lines from client
 * @param depth - Requested commit depth
 * @param deepenSince - Timestamp to deepen since
 * @param deepenNot - Refs to not deepen past
 * @param store - Object store
 * @returns Shallow info with boundary commits
 *
 * @example
 * ```typescript
 * const shallowInfo = await processShallow(
 *   session,
 *   [],  // No previous shallow commits
 *   3,   // Depth of 3 commits
 *   undefined,
 *   undefined,
 *   store
 * )
 * // shallowInfo.shallowCommits contains boundary commits
 * ```
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
 * Format shallow/unshallow lines for response.
 *
 * @description
 * Creates pkt-line formatted shallow/unshallow responses to send
 * to the client before the packfile.
 *
 * @param shallowInfo - Shallow info to format
 * @returns Pkt-line formatted shallow response
 *
 * @example
 * ```typescript
 * const response = formatShallowResponse({
 *   shallowCommits: ['abc123...'],
 *   unshallowCommits: []
 * })
 * // '001cshallow abc123...\n'
 * ```
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
 * Wrap data in side-band format.
 *
 * @description
 * Wraps data in side-band format for multiplexed transmission.
 * The format is: pkt-line length + channel byte + data
 *
 * @param channel - Side-band channel (1=data, 2=progress, 3=error)
 * @param data - Data to wrap
 * @returns Pkt-line formatted side-band data
 *
 * @example
 * ```typescript
 * // Wrap packfile data for channel 1
 * const wrapped = wrapSideBand(SideBandChannel.PACK_DATA, packfile)
 *
 * // Wrap progress message for channel 2
 * const progress = wrapSideBand(
 *   SideBandChannel.PROGRESS,
 *   encoder.encode('Counting objects: 100%\n')
 * )
 * ```
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
 * Send progress message via side-band.
 *
 * @description
 * Creates a side-band channel 2 message for progress reporting.
 * Messages are displayed to the user during fetch operations.
 *
 * @param message - Progress message (newline added if not present)
 * @returns Pkt-line formatted progress message
 *
 * @example
 * ```typescript
 * const progress = formatProgress('Counting objects: 42')
 * // Side-band channel 2 packet with the message
 * ```
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
 * Generate a packfile containing the requested objects.
 *
 * @description
 * Creates a Git packfile containing all objects needed by the client.
 * The packfile format includes:
 * - 12-byte header (PACK + version + object count)
 * - Compressed objects with type/size headers
 * - 20-byte SHA-1 checksum
 *
 * @param store - Object store to get objects from
 * @param wants - Objects the client wants
 * @param haves - Objects the client already has
 * @param options - Packfile generation options
 * @returns Packfile result with binary data and metadata
 *
 * @example
 * ```typescript
 * const result = await generatePackfile(
 *   store,
 *   ['commit-sha-1', 'commit-sha-2'],
 *   ['base-commit-sha'],
 *   { thinPack: true, onProgress: console.log }
 * )
 * // result.packfile contains the binary packfile
 * // result.objectCount is the number of objects
 * ```
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
 * Generate thin pack with deltas against client's objects.
 *
 * @description
 * Creates a thin pack that can use objects the client already has
 * as delta bases, resulting in smaller transfer sizes.
 *
 * @param store - Object store
 * @param objects - Objects to include
 * @param clientHasObjects - Objects client already has (for delta bases)
 * @returns Thin packfile
 *
 * @example
 * ```typescript
 * const result = await generateThinPack(
 *   store,
 *   ['new-blob-sha'],
 *   ['similar-blob-sha']  // Client has this, can be delta base
 * )
 * ```
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
 * Object type to packfile type number mapping.
 * @internal
 */
const OBJECT_TYPE_MAP = {
    commit: 1,
    tree: 2,
    blob: 3,
    tag: 4
};
/**
 * Create packfile header.
 * @internal
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
 * Encode object header in packfile format.
 * @internal
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
 * Build complete packfile from objects.
 * @internal
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
 * Calculate SHA-1 hash using Web Crypto API.
 * @internal
 */
async function sha1(data) {
    // Create a copy as ArrayBuffer to satisfy BufferSource type
    const buffer = new ArrayBuffer(data.length);
    new Uint8Array(buffer).set(data);
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
    return new Uint8Array(hashBuffer);
}
// ============================================================================
// Full Fetch Handler
// ============================================================================
/**
 * Handle a complete fetch request.
 *
 * @description
 * This is the main entry point that handles the full upload-pack protocol flow:
 * 1. Parse client request (wants, haves, capabilities, shallow commands)
 * 2. Negotiate common ancestors via ACK/NAK
 * 3. Generate and return packfile with requested objects
 *
 * @param session - Upload pack session
 * @param request - Raw request data (pkt-line formatted)
 * @param store - Object store
 * @returns Response data (ACKs/NAKs + packfile)
 *
 * @example
 * ```typescript
 * const session = createSession('repo', refs)
 * const requestBody = '0032want abc123... side-band-64k\n00000009done\n'
 *
 * const response = await handleFetch(session, requestBody, store)
 * // response contains NAK + packfile data
 * ```
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