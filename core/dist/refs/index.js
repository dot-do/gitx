/**
 * @fileoverview Git Reference (Refs) Implementation
 *
 * This module implements Git reference parsing, validation, and resolution.
 *
 * Reference types:
 * - Direct refs: Point directly to a SHA (e.g., branch tips)
 * - Symbolic refs: Point to another ref (e.g., HEAD -> refs/heads/main)
 * - Packed refs: Consolidated refs in .git/packed-refs file
 *
 * Ref namespaces:
 * - refs/heads/* - Local branches
 * - refs/tags/* - Tags
 * - refs/remotes/* - Remote tracking branches
 * - refs/notes/* - Git notes
 * - refs/stash - Stash
 */
// =============================================================================
// Error Classes
// =============================================================================
/** Error for ref validation failures */
export class RefValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RefValidationError';
    }
}
/** Base error for resolution failures */
export class ResolutionError extends Error {
    partialChain;
    constructor(message, partialChain) {
        super(message);
        this.name = 'ResolutionError';
        this.partialChain = partialChain;
    }
}
/** Error when ref not found */
export class RefNotFoundError extends ResolutionError {
    constructor(refName, partialChain) {
        super(`Ref not found: ${refName}`, partialChain);
        this.name = 'RefNotFoundError';
    }
}
/** Error when circular ref detected */
export class CircularRefError extends ResolutionError {
    constructor(chain) {
        super(`Circular ref detected: ${chain.join(' -> ')}`, chain);
        this.name = 'CircularRefError';
    }
}
/** Error when max resolution depth exceeded */
export class MaxDepthExceededError extends ResolutionError {
    constructor(chain, maxDepth) {
        super(`Max ref resolution depth exceeded (${maxDepth})`, chain);
        this.name = 'MaxDepthExceededError';
    }
}
/** Error for ref locking issues */
export class RefLockError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RefLockError';
    }
}
/** Error when lock acquisition times out */
export class LockTimeoutError extends RefLockError {
    constructor(refName) {
        super(`Lock acquisition timed out for: ${refName}`);
        this.name = 'LockTimeoutError';
    }
}
/** Error when lock is stale */
export class StaleLockError extends RefLockError {
    constructor(refName) {
        super(`Stale lock detected for: ${refName}`);
        this.name = 'StaleLockError';
    }
}
/** Ref kind enumeration */
export var RefKind;
(function (RefKind) {
    RefKind["Head"] = "head";
    RefKind["Branch"] = "branch";
    RefKind["Tag"] = "tag";
    RefKind["Remote"] = "remote";
    RefKind["Notes"] = "notes";
    RefKind["Stash"] = "stash";
    RefKind["Other"] = "other";
})(RefKind || (RefKind = {}));
// =============================================================================
// Ref Name Validation
// =============================================================================
const SHA_REGEX = /^[0-9a-fA-F]{40}$/;
const SPECIAL_HEADS = [
    'HEAD',
    'FETCH_HEAD',
    'ORIG_HEAD',
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'BISECT_HEAD',
];
/**
 * Check if a ref name is valid.
 *
 * Git ref naming rules:
 * - Cannot contain: space, ~, ^, :, ?, *, [, \, NUL, control chars (0x00-0x1F, 0x7F)
 * - Cannot contain consecutive dots (..)
 * - Cannot start or end with a dot
 * - Cannot end with .lock
 * - Cannot have empty components (consecutive slashes)
 * - Cannot be empty
 * - Cannot contain @{
 * - Cannot be just @
 */
export function isValidRefName(name) {
    if (!name || name.length === 0)
        return false;
    // Single @ is invalid
    if (name === '@')
        return false;
    // Special HEADs are valid
    if (SPECIAL_HEADS.includes(name))
        return true;
    // Check for consecutive dots
    if (name.includes('..'))
        return false;
    // Check for @{
    if (name.includes('@{'))
        return false;
    // Check for invalid characters
    const invalidChars = /[\x00-\x1f\x7f ~^:?*\[\\]/;
    if (invalidChars.test(name))
        return false;
    // Split into components
    const components = name.split('/');
    // Cannot start or end with slash (empty first/last component)
    if (components[0] === '' || components[components.length - 1] === '') {
        return false;
    }
    for (const component of components) {
        // Empty component (consecutive slashes)
        if (component === '')
            return false;
        // Cannot start with dot
        if (component.startsWith('.'))
            return false;
        // Cannot end with dot
        if (component.endsWith('.'))
            return false;
        // Cannot end with .lock
        if (component.endsWith('.lock'))
            return false;
    }
    return true;
}
/**
 * Validate a ref name, throwing on invalid.
 */
export function validateRefName(name) {
    if (!isValidRefName(name)) {
        let reason = 'invalid ref name';
        if (name.includes('..'))
            reason = 'contains consecutive dots (..)';
        else if (name.includes('@{'))
            reason = 'contains @{';
        else if (name === '@')
            reason = 'bare @ is not allowed';
        else if (name.endsWith('.lock'))
            reason = 'ends with .lock';
        else if (name.includes('//'))
            reason = 'contains empty component';
        else if (/[\x00-\x1f\x7f ~^:?*\[\\]/.test(name))
            reason = 'contains invalid character';
        throw new RefValidationError(`Invalid ref name "${name}": ${reason}`);
    }
    return true;
}
/**
 * Check if a branch name is valid (short name, not full ref path).
 */
export function isValidBranchName(name) {
    if (!name)
        return false;
    // Cannot look like a full ref path
    if (name.startsWith('refs/'))
        return false;
    // Cannot be HEAD
    if (name === 'HEAD')
        return false;
    // Cannot start with dash
    if (name.startsWith('-'))
        return false;
    // Use general ref validation for the rest
    return isValidRefName(`refs/heads/${name}`);
}
/**
 * Check if a tag name is valid (short name, not full ref path).
 */
export function isValidTagName(name) {
    if (!name)
        return false;
    // Cannot look like a full ref path
    if (name.startsWith('refs/'))
        return false;
    // Use general ref validation
    return isValidRefName(`refs/tags/${name}`);
}
/**
 * Check if a remote name is valid.
 */
export function isValidRemoteName(name) {
    if (!name)
        return false;
    // Cannot contain slashes
    if (name.includes('/'))
        return false;
    // Use general ref validation
    return isValidRefName(`refs/remotes/${name}`);
}
// =============================================================================
// Symbolic Refs
// =============================================================================
/**
 * Parse a symbolic ref file content.
 */
export function parseSymbolicRef(content) {
    const trimmed = content.trim().replace(/\r\n/g, '\n').replace(/\n$/, '');
    if (!trimmed.startsWith('ref: ')) {
        throw new Error(`Invalid symbolic ref format: "${content}"`);
    }
    const target = trimmed.slice(5).trim();
    if (!target) {
        throw new Error('Empty symbolic ref target');
    }
    return { type: 'symbolic', target };
}
/**
 * Serialize a symbolic ref to file content.
 */
export function serializeSymbolicRef(ref) {
    return `ref: ${ref.target}\n`;
}
/**
 * Check if a ref is symbolic.
 */
export function isSymbolicRef(ref) {
    return ref.type === 'symbolic';
}
/**
 * Get the target of a symbolic ref, or null if direct.
 */
export function getSymbolicTarget(ref) {
    return isSymbolicRef(ref) ? ref.target : null;
}
// =============================================================================
// Direct Refs
// =============================================================================
/**
 * Parse a direct ref file content (SHA hash).
 */
export function parseDirectRef(content) {
    const trimmed = content.trim();
    // Check if it looks like a symbolic ref
    if (trimmed.startsWith('ref:')) {
        throw new Error('Content appears to be a symbolic ref, not direct');
    }
    if (!SHA_REGEX.test(trimmed)) {
        throw new Error(`Invalid SHA hash: "${trimmed}"`);
    }
    return { type: 'direct', sha: trimmed.toLowerCase() };
}
/**
 * Serialize a direct ref to file content.
 */
export function serializeDirectRef(ref) {
    return `${ref.sha.toLowerCase()}\n`;
}
/**
 * Check if a ref is direct.
 */
export function isDirectRef(ref) {
    return ref.type === 'direct';
}
// =============================================================================
// Ref Type Classification
// =============================================================================
/**
 * Get the kind of a ref from its name.
 */
export function getRefKind(refName) {
    if (SPECIAL_HEADS.includes(refName))
        return RefKind.Head;
    if (refName.startsWith('refs/heads/'))
        return RefKind.Branch;
    if (refName.startsWith('refs/tags/'))
        return RefKind.Tag;
    if (refName.startsWith('refs/remotes/'))
        return RefKind.Remote;
    if (refName.startsWith('refs/notes/'))
        return RefKind.Notes;
    if (refName === 'refs/stash')
        return RefKind.Stash;
    return RefKind.Other;
}
/**
 * Check if a ref is a HEAD ref.
 */
export function isHeadRef(refName) {
    return SPECIAL_HEADS.includes(refName);
}
/**
 * Check if a ref is a branch ref.
 */
export function isBranchRef(refName) {
    return refName.startsWith('refs/heads/');
}
/**
 * Check if a ref is a tag ref.
 */
export function isTagRef(refName) {
    return refName.startsWith('refs/tags/');
}
/**
 * Check if a ref is a remote ref.
 */
export function isRemoteRef(refName) {
    return refName.startsWith('refs/remotes/');
}
/**
 * Check if a ref is a notes ref.
 */
export function isNotesRef(refName) {
    return refName.startsWith('refs/notes/');
}
/**
 * Check if a ref is the stash ref.
 */
export function isStashRef(refName) {
    return refName === 'refs/stash';
}
// =============================================================================
// Packed-refs File Format
// =============================================================================
/**
 * Parse a packed-refs file.
 */
export function parsePackedRefsFile(content) {
    const lines = content.split(/\r?\n/);
    const entries = new Map();
    const peeledEntries = new Map();
    const traits = [];
    let lastRef = null;
    for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines
        if (!trimmed)
            continue;
        // Parse header for traits
        if (trimmed.startsWith('# pack-refs with:')) {
            const traitsStr = trimmed.slice(17).trim();
            traits.push(...traitsStr.split(/\s+/).filter(Boolean));
            continue;
        }
        // Skip other comments
        if (trimmed.startsWith('#'))
            continue;
        // Parse peeled entry (^SHA)
        if (trimmed.startsWith('^')) {
            if (!lastRef) {
                throw new Error('Orphaned peeled entry in packed-refs');
            }
            const sha = trimmed.slice(1);
            if (!SHA_REGEX.test(sha)) {
                throw new Error(`Invalid SHA in peeled entry: "${sha}"`);
            }
            peeledEntries.set(lastRef, sha.toLowerCase());
            continue;
        }
        // Parse regular entry (SHA ref)
        const spaceIndex = trimmed.indexOf(' ');
        if (spaceIndex === -1) {
            throw new Error(`Malformed packed-refs entry: "${line}"`);
        }
        const sha = trimmed.slice(0, spaceIndex);
        const ref = trimmed.slice(spaceIndex + 1);
        if (!SHA_REGEX.test(sha)) {
            throw new Error(`Invalid SHA in packed-refs: "${sha}"`);
        }
        entries.set(ref, sha.toLowerCase());
        lastRef = ref;
    }
    return { entries, peeledEntries, traits };
}
/**
 * Serialize a packed-refs file.
 */
export function serializePackedRefsFile(refs) {
    const lines = [];
    // Header
    if (refs.traits.length > 0) {
        lines.push(`# pack-refs with: ${refs.traits.join(' ')}`);
    }
    // Sort entries alphabetically
    const sortedRefs = [...refs.entries.keys()].sort();
    for (const ref of sortedRefs) {
        const sha = refs.entries.get(ref);
        lines.push(`${sha} ${ref}`);
        // Add peeled entry if present
        const peeled = refs.peeledEntries.get(ref);
        if (peeled) {
            lines.push(`^${peeled}`);
        }
    }
    return lines.join('\n') + '\n';
}
/**
 * Get peeled target from packed refs.
 */
export function getPeeledTarget(refs, refName) {
    return refs.peeledEntries.get(refName) ?? null;
}
/**
 * Check if a ref has a peeled entry.
 */
export function hasPeeledEntry(refs, refName) {
    return refs.peeledEntries.has(refName);
}
/**
 * Resolve a ref through symbolic chains to a SHA.
 */
export async function resolveRefChain(refName, getRef, options) {
    const maxDepth = options?.maxDepth ?? 100;
    const chain = [];
    const visited = new Set();
    let current = refName;
    while (true) {
        // Check for circular refs
        if (visited.has(current)) {
            throw new CircularRefError([...chain, current]);
        }
        // Check max depth
        if (chain.length >= maxDepth) {
            throw new MaxDepthExceededError(chain, maxDepth);
        }
        visited.add(current);
        chain.push(current);
        const ref = await getRef(current);
        if (!ref) {
            throw new RefNotFoundError(current, chain.slice(0, -1));
        }
        if (isDirectRef(ref)) {
            return { finalSha: ref.sha, chain };
        }
        current = ref.target;
    }
}
/**
 * Resolve a ref to its final SHA.
 */
export async function resolveToSha(refName, getRef, options) {
    const result = await resolveRefChain(refName, getRef, options);
    return result.finalSha;
}
// =============================================================================
// Refspec Parsing
// =============================================================================
/**
 * Parse a refspec string.
 */
export function parseRefspec(refspec) {
    let force = false;
    let spec = refspec;
    // Check for force prefix
    if (spec.startsWith('+')) {
        force = true;
        spec = spec.slice(1);
    }
    // Split on colon
    const colons = (spec.match(/:/g) || []).length;
    if (colons > 1) {
        throw new Error(`Invalid refspec: multiple colons in "${refspec}"`);
    }
    const colonIndex = spec.indexOf(':');
    let source;
    let destination;
    if (colonIndex === -1) {
        source = spec;
        destination = '';
    }
    else {
        source = spec.slice(0, colonIndex);
        destination = spec.slice(colonIndex + 1);
    }
    // Check for wildcards
    const sourceWildcard = source.includes('*');
    const destWildcard = destination.includes('*');
    if (sourceWildcard !== destWildcard && destination !== '') {
        throw new Error(`Mismatched wildcards in refspec: "${refspec}"`);
    }
    // Check for multiple wildcards
    if (source.split('*').length > 2 || destination.split('*').length > 2) {
        throw new Error(`Multiple wildcards not allowed in refspec: "${refspec}"`);
    }
    return {
        source,
        destination,
        force,
        hasWildcard: sourceWildcard,
    };
}
/**
 * Serialize a refspec to string.
 */
export function serializeRefspec(refspec) {
    let result = '';
    if (refspec.force)
        result += '+';
    result += refspec.source;
    if (refspec.destination) {
        result += ':' + refspec.destination;
    }
    return result;
}
/**
 * Check if a refspec is forced.
 */
export function isForceRefspec(refspec) {
    return refspec.force;
}
/**
 * Get the source of a refspec.
 */
export function getRefspecSource(refspec) {
    return refspec.source;
}
/**
 * Get the destination of a refspec.
 */
export function getRefspecDestination(refspec) {
    return refspec.destination;
}
/**
 * Check if a ref matches a refspec.
 */
export function matchRefspec(refspec, ref) {
    if (!refspec.hasWildcard) {
        return refspec.source === ref;
    }
    const pattern = refspec.source.replace('*', '');
    return ref.startsWith(pattern);
}
/**
 * Expand a refspec for a specific ref.
 */
export function expandRefspec(refspec, ref) {
    if (!matchRefspec(refspec, ref)) {
        throw new Error(`Ref "${ref}" does not match refspec "${serializeRefspec(refspec)}"`);
    }
    if (!refspec.hasWildcard) {
        return { source: refspec.source, destination: refspec.destination };
    }
    const prefix = refspec.source.replace('*', '');
    const match = ref.slice(prefix.length);
    const destPrefix = refspec.destination.replace('*', '');
    return {
        source: ref,
        destination: destPrefix + match,
    };
}
// =============================================================================
// Ref Patterns/Globs
// =============================================================================
/**
 * Parse a ref pattern.
 */
export function parseRefPattern(pattern) {
    const wildcardIndex = pattern.indexOf('*');
    if (wildcardIndex === -1) {
        return { prefix: pattern, isWildcard: false };
    }
    return {
        prefix: pattern.slice(0, wildcardIndex),
        isWildcard: true,
    };
}
/**
 * Match a ref against a pattern.
 */
export function matchRefPattern(pattern, ref) {
    if (!pattern.isWildcard) {
        return pattern.prefix === ref;
    }
    return ref.startsWith(pattern.prefix);
}
/**
 * Expand a pattern to matching refs.
 */
export function expandRefPattern(pattern, refs) {
    return refs.filter((ref) => matchRefPattern(pattern, ref));
}
/**
 * Check if a pattern string is a wildcard.
 */
export function isWildcardPattern(pattern) {
    return pattern.includes('*');
}
/**
 * Peel a ref to its target commit/tree.
 */
export async function peelRef(sha, getObject, options) {
    const targetType = options?.target ?? 'commit';
    let current = sha;
    while (true) {
        const obj = await getObject(current);
        if (!obj) {
            throw new Error(`Object not found: ${current}`);
        }
        if (obj.type === targetType) {
            return current;
        }
        if (obj.type === 'tag' && obj.target) {
            current = obj.target;
            continue;
        }
        if (obj.type === 'commit' && targetType === 'tree' && obj.tree) {
            return obj.tree;
        }
        throw new Error(`Cannot peel ${obj.type} to ${targetType}`);
    }
}
/**
 * Check if a ref name is a peeled ref (ends with ^{}).
 */
export function isPeeledRef(refName) {
    return refName.endsWith('^{}');
}
/**
 * Get cached peeled SHA.
 */
export function getPeeledSha(cache, refName) {
    return cache.get(refName) ?? null;
}
// =============================================================================
// HEAD Detached State
// =============================================================================
/**
 * Get the current HEAD state.
 */
export async function getHeadState(getRef) {
    const headRef = await getRef('HEAD');
    if (!headRef) {
        throw new Error('HEAD not found');
    }
    if (isDirectRef(headRef)) {
        return { attached: false, sha: headRef.sha };
    }
    // Attached to a branch
    const branch = headRef.target;
    // Try to resolve the branch
    try {
        const branchRef = await getRef(branch);
        if (branchRef && isDirectRef(branchRef)) {
            return { attached: true, branch, sha: branchRef.sha };
        }
    }
    catch {
        // Branch might not exist yet (new repo)
    }
    return { attached: true, branch };
}
/**
 * Check if HEAD is detached.
 */
export function isDetachedHead(state) {
    return !state.attached;
}
/**
 * Get SHA when HEAD is detached.
 */
export function getDetachedSha(state) {
    return state.attached ? null : state.sha ?? null;
}
/**
 * Get the attached branch.
 */
export function getAttachedBranch(state, options) {
    if (!state.attached || !state.branch)
        return null;
    if (options?.stripPrefix && state.branch.startsWith('refs/heads/')) {
        return state.branch.slice(11);
    }
    return state.branch;
}
// =============================================================================
// Ref Locking
// =============================================================================
class RefLockImpl {
    refName;
    owner;
    backend;
    held = true;
    constructor(refName, owner, backend) {
        this.refName = refName;
        this.owner = owner;
        this.backend = backend;
    }
    isHeld() {
        return this.held;
    }
    async release() {
        if (this.held && this.backend) {
            await this.backend.removeLock(this.refName);
        }
        this.held = false;
    }
}
/**
 * Acquire a lock on a ref.
 */
export async function acquireRefLock(refName, backend, options) {
    const timeout = options?.timeout ?? 0;
    const retryInterval = options?.retryInterval ?? 100;
    const owner = options?.owner;
    const staleThreshold = options?.staleThreshold;
    const breakStale = options?.breakStale ?? false;
    const startTime = Date.now();
    while (true) {
        const acquired = await backend.createLock(refName, owner);
        if (acquired) {
            return new RefLockImpl(refName, owner, backend);
        }
        // Check for stale lock
        if (staleThreshold && backend.getLockAge) {
            const age = await backend.getLockAge(refName);
            if (age > staleThreshold) {
                if (breakStale && backend.breakLock) {
                    const broken = await backend.breakLock(refName);
                    if (broken) {
                        continue; // Try again
                    }
                }
                throw new StaleLockError(refName);
            }
        }
        // Check timeout
        if (timeout === 0) {
            throw new RefLockError(`Failed to acquire lock: ${refName}`);
        }
        const elapsed = Date.now() - startTime;
        if (elapsed >= timeout) {
            throw new LockTimeoutError(refName);
        }
        // Wait and retry
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }
}
/**
 * Release a ref lock.
 */
export async function releaseRefLock(lock) {
    if (lock instanceof RefLockImpl) {
        await lock.release();
    }
}
/**
 * Check if a ref is locked.
 */
export async function isRefLocked(refName, backend) {
    if (backend.checkLock) {
        return backend.checkLock(refName);
    }
    return false;
}
/**
 * Zero SHA used for ref creation/deletion in reflog.
 */
export const ZERO_SHA = '0000000000000000000000000000000000000000';
/**
 * Parse a single reflog line.
 *
 * Format: <old-sha> <new-sha> <committer> <timestamp> <tz> <tab><message>
 * Example: abc123... def456... John Doe <john@example.com> 1234567890 -0500	commit: message
 */
export function parseReflogLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    // Match: oldSha newSha name <email> timestamp tz\tmessage
    const match = trimmed.match(/^([0-9a-f]{40})\s+([0-9a-f]{40})\s+(.+?)\s+<([^>]+)>\s+(\d+)\s+([+-]\d{4})\t(.*)$/);
    if (!match) {
        // Try alternate format without tab (some implementations)
        const altMatch = trimmed.match(/^([0-9a-f]{40})\s+([0-9a-f]{40})\s+(.+?)\s+<([^>]+)>\s+(\d+)\s+([+-]\d{4})\s+(.*)$/);
        if (!altMatch)
            return null;
        const [, oldSha, newSha, name, email, ts, tz, message] = altMatch;
        // These are guaranteed to exist by the regex match
        if (!oldSha || !newSha || !name || !email || !ts || !tz || message === undefined)
            return null;
        return {
            oldSha: oldSha.toLowerCase(),
            newSha: newSha.toLowerCase(),
            committer: { name, email },
            timestamp: parseInt(ts, 10),
            timezoneOffset: parseTimezoneOffset(tz),
            message,
        };
    }
    const [, oldSha, newSha, name, email, ts, tz, message] = match;
    // These are guaranteed to exist by the regex match
    if (!oldSha || !newSha || !name || !email || !ts || !tz || message === undefined)
        return null;
    return {
        oldSha: oldSha.toLowerCase(),
        newSha: newSha.toLowerCase(),
        committer: { name, email },
        timestamp: parseInt(ts, 10),
        timezoneOffset: parseTimezoneOffset(tz),
        message,
    };
}
/**
 * Parse timezone offset string (+0500 or -0800) to minutes.
 */
function parseTimezoneOffset(tz) {
    const sign = tz.startsWith('-') ? -1 : 1;
    const hours = parseInt(tz.slice(1, 3), 10);
    const minutes = parseInt(tz.slice(3, 5), 10);
    return sign * (hours * 60 + minutes);
}
/**
 * Format timezone offset in minutes to string (+0500 or -0800).
 */
function formatTimezoneOffset(offset) {
    const sign = offset >= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    const hours = Math.floor(abs / 60);
    const minutes = abs % 60;
    return `${sign}${hours.toString().padStart(2, '0')}${minutes.toString().padStart(2, '0')}`;
}
/**
 * Serialize a reflog entry to a line.
 */
export function serializeReflogEntry(entry) {
    const { oldSha, newSha, committer, timestamp, timezoneOffset, message } = entry;
    const tz = formatTimezoneOffset(timezoneOffset);
    return `${oldSha} ${newSha} ${committer.name} <${committer.email}> ${timestamp} ${tz}\t${message}\n`;
}
/**
 * Parse a complete reflog file.
 *
 * Returns entries in reverse chronological order (newest first),
 * which is the standard Git reflog display order.
 */
export function parseReflogFile(content) {
    const lines = content.split(/\r?\n/);
    const entries = [];
    for (const line of lines) {
        const entry = parseReflogLine(line);
        if (entry) {
            entries.push(entry);
        }
    }
    // Return in reverse order (newest first) for display
    return entries.reverse();
}
/**
 * Serialize reflog entries to file content.
 *
 * Entries should be in chronological order (oldest first) for storage.
 */
export function serializeReflogFile(entries) {
    // Store in chronological order (oldest first)
    return entries.map(serializeReflogEntry).join('');
}
/**
 * Create a reflog entry for a ref update.
 *
 * @param oldSha - Previous SHA (use ZERO_SHA for creation)
 * @param newSha - New SHA (use ZERO_SHA for deletion)
 * @param committer - Who made the change
 * @param message - Description of the change
 */
export function createReflogEntry(oldSha, newSha, committer, message) {
    const now = new Date();
    return {
        oldSha: oldSha.toLowerCase(),
        newSha: newSha.toLowerCase(),
        committer,
        timestamp: Math.floor(now.getTime() / 1000),
        timezoneOffset: -now.getTimezoneOffset(),
        message,
    };
}
/**
 * In-memory reflog backend for testing and simple use cases.
 */
export class InMemoryReflogBackend {
    reflogs = new Map();
    async appendEntry(refName, entry) {
        const entries = this.reflogs.get(refName) ?? [];
        entries.push(entry);
        this.reflogs.set(refName, entries);
    }
    async readEntries(refName) {
        const entries = this.reflogs.get(refName) ?? [];
        // Return in reverse chronological order (newest first)
        return [...entries].reverse();
    }
    async deleteReflog(refName) {
        this.reflogs.delete(refName);
    }
    async reflogExists(refName) {
        return this.reflogs.has(refName) && (this.reflogs.get(refName)?.length ?? 0) > 0;
    }
    /**
     * Get raw entries in chronological order (for testing).
     */
    getRawEntries(refName) {
        return [...(this.reflogs.get(refName) ?? [])];
    }
    /**
     * Clear all reflogs (for testing).
     */
    clear() {
        this.reflogs.clear();
    }
}
/**
 * Reflog manager for tracking ref changes.
 *
 * The reflog is Git's safety net - it records every change to refs,
 * allowing recovery of "lost" commits and understanding ref history.
 *
 * @example
 * ```typescript
 * const reflog = new ReflogManager(backend)
 *
 * // Record a commit
 * await reflog.recordUpdate('HEAD', oldSha, newSha, 'commit: Add feature')
 *
 * // View history
 * const history = await reflog.getHistory('HEAD', { limit: 10 })
 * ```
 */
export class ReflogManager {
    backend;
    defaultCommitter;
    constructor(backend, defaultCommitter = {
        name: 'Unknown',
        email: 'unknown@unknown',
    }) {
        this.backend = backend;
        this.defaultCommitter = defaultCommitter;
    }
    /**
     * Record a ref update in the reflog.
     *
     * @param refName - The ref being updated (e.g., 'HEAD', 'refs/heads/main')
     * @param oldSha - Previous SHA (use ZERO_SHA for creation)
     * @param newSha - New SHA (use ZERO_SHA for deletion)
     * @param message - Description of the change
     * @param committer - Optional committer info (defaults to constructor default)
     */
    async recordUpdate(refName, oldSha, newSha, message, committer) {
        const entry = createReflogEntry(oldSha, newSha, committer ?? this.defaultCommitter, message);
        await this.backend.appendEntry(refName, entry);
    }
    /**
     * Record a HEAD update (convenience method).
     */
    async recordHeadUpdate(oldSha, newSha, message, committer) {
        await this.recordUpdate('HEAD', oldSha, newSha, message, committer);
    }
    /**
     * Get reflog history for a ref.
     *
     * @param refName - The ref to get history for
     * @param options - Optional limit and offset
     * @returns Entries in reverse chronological order (newest first)
     */
    async getHistory(refName, options) {
        let entries = await this.backend.readEntries(refName);
        if (options?.offset) {
            entries = entries.slice(options.offset);
        }
        if (options?.limit) {
            entries = entries.slice(0, options.limit);
        }
        return entries;
    }
    /**
     * Get a specific reflog entry by index.
     *
     * @param refName - The ref to look up
     * @param index - Entry index (0 = newest, @{n} syntax)
     * @returns The entry or null if not found
     */
    async getEntry(refName, index) {
        const entries = await this.backend.readEntries(refName);
        return entries[index] ?? null;
    }
    /**
     * Get the SHA at a specific reflog position.
     *
     * @param refName - The ref to look up
     * @param index - Entry index (0 = current, 1 = previous, etc.)
     * @returns The SHA or null if not found
     */
    async getShaAtIndex(refName, index) {
        const entry = await this.getEntry(refName, index);
        return entry?.newSha ?? null;
    }
    /**
     * Delete reflog for a ref.
     */
    async deleteReflog(refName) {
        await this.backend.deleteReflog(refName);
    }
    /**
     * Check if a reflog exists for a ref.
     */
    async hasReflog(refName) {
        return this.backend.reflogExists(refName);
    }
}
/**
 * Validate an atomic update command.
 */
export function validateAtomicUpdateCommand(cmd) {
    if (!isValidRefName(cmd.refName)) {
        return `Invalid ref name: ${cmd.refName}`;
    }
    if (cmd.oldSha !== null && cmd.oldSha !== ZERO_SHA && !SHA_REGEX.test(cmd.oldSha)) {
        return `Invalid old SHA: ${cmd.oldSha}`;
    }
    if (cmd.newSha !== null && cmd.newSha !== ZERO_SHA && !SHA_REGEX.test(cmd.newSha)) {
        return `Invalid new SHA: ${cmd.newSha}`;
    }
    return null;
}
/**
 * Compare-and-swap check for atomic updates.
 */
export function casCheck(expectedOld, actualOld) {
    // null expectedOld means "don't care"
    if (expectedOld === null)
        return true;
    // ZERO_SHA expected means ref should not exist
    if (expectedOld === ZERO_SHA) {
        return actualOld === null || actualOld === ZERO_SHA;
    }
    // Otherwise must match exactly
    return actualOld?.toLowerCase() === expectedOld.toLowerCase();
}
//# sourceMappingURL=index.js.map