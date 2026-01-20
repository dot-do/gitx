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
/** Error for ref validation failures */
export declare class RefValidationError extends Error {
    constructor(message: string);
}
/** Base error for resolution failures */
export declare class ResolutionError extends Error {
    partialChain?: string[] | undefined;
    constructor(message: string, partialChain?: string[]);
}
/** Error when ref not found */
export declare class RefNotFoundError extends ResolutionError {
    constructor(refName: string, partialChain?: string[]);
}
/** Error when circular ref detected */
export declare class CircularRefError extends ResolutionError {
    constructor(chain: string[]);
}
/** Error when max resolution depth exceeded */
export declare class MaxDepthExceededError extends ResolutionError {
    constructor(chain: string[], maxDepth: number);
}
/** Error for ref locking issues */
export declare class RefLockError extends Error {
    constructor(message: string);
}
/** Error when lock acquisition times out */
export declare class LockTimeoutError extends RefLockError {
    constructor(refName: string);
}
/** Error when lock is stale */
export declare class StaleLockError extends RefLockError {
    constructor(refName: string);
}
/** Symbolic ref (points to another ref) */
export interface SymbolicRef {
    type: 'symbolic';
    target: string;
}
/** Direct ref (points to a SHA) */
export interface DirectRef {
    type: 'direct';
    sha: string;
}
/** Union of ref types */
export type Ref = SymbolicRef | DirectRef;
/** Ref kind enumeration */
export declare enum RefKind {
    Head = "head",
    Branch = "branch",
    Tag = "tag",
    Remote = "remote",
    Notes = "notes",
    Stash = "stash",
    Other = "other"
}
/** Packed refs entry */
export interface PackedRefsEntry {
    sha: string;
    peeledSha?: string;
}
/** Packed refs file */
export interface PackedRefs {
    entries: Map<string, string>;
    peeledEntries: Map<string, string>;
    traits: string[];
}
/** Resolved ref result */
export interface ResolvedRef {
    finalSha: string;
    chain: string[];
}
/** Refspec */
export interface Refspec {
    source: string;
    destination: string;
    force: boolean;
    hasWildcard: boolean;
}
/** Ref pattern for matching */
export interface RefPattern {
    prefix: string;
    isWildcard: boolean;
}
/** Peeled ref (dereferenced tag) */
export interface PeeledRef {
    sha: string;
    peeledSha?: string;
}
/** HEAD state (attached or detached) */
export interface HeadState {
    attached: boolean;
    branch?: string;
    sha?: string;
}
/** Ref lock */
export interface RefLock {
    refName: string;
    owner?: string;
    isHeld(): boolean;
}
/** Lock backend interface */
export interface LockBackend {
    createLock(name: string, owner?: string): Promise<boolean>;
    removeLock(name: string): Promise<void>;
    checkLock?(name: string): Promise<boolean>;
    getLockAge?(name: string): Promise<number>;
    breakLock?(name: string): Promise<boolean>;
}
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
export declare function isValidRefName(name: string): boolean;
/**
 * Validate a ref name, throwing on invalid.
 */
export declare function validateRefName(name: string): boolean;
/**
 * Check if a branch name is valid (short name, not full ref path).
 */
export declare function isValidBranchName(name: string): boolean;
/**
 * Check if a tag name is valid (short name, not full ref path).
 */
export declare function isValidTagName(name: string): boolean;
/**
 * Check if a remote name is valid.
 */
export declare function isValidRemoteName(name: string): boolean;
/**
 * Parse a symbolic ref file content.
 */
export declare function parseSymbolicRef(content: string): SymbolicRef;
/**
 * Serialize a symbolic ref to file content.
 */
export declare function serializeSymbolicRef(ref: SymbolicRef): string;
/**
 * Check if a ref is symbolic.
 */
export declare function isSymbolicRef(ref: Ref): ref is SymbolicRef;
/**
 * Get the target of a symbolic ref, or null if direct.
 */
export declare function getSymbolicTarget(ref: Ref): string | null;
/**
 * Parse a direct ref file content (SHA hash).
 */
export declare function parseDirectRef(content: string): DirectRef;
/**
 * Serialize a direct ref to file content.
 */
export declare function serializeDirectRef(ref: DirectRef): string;
/**
 * Check if a ref is direct.
 */
export declare function isDirectRef(ref: Ref): ref is DirectRef;
/**
 * Get the kind of a ref from its name.
 */
export declare function getRefKind(refName: string): RefKind;
/**
 * Check if a ref is a HEAD ref.
 */
export declare function isHeadRef(refName: string): boolean;
/**
 * Check if a ref is a branch ref.
 */
export declare function isBranchRef(refName: string): boolean;
/**
 * Check if a ref is a tag ref.
 */
export declare function isTagRef(refName: string): boolean;
/**
 * Check if a ref is a remote ref.
 */
export declare function isRemoteRef(refName: string): boolean;
/**
 * Check if a ref is a notes ref.
 */
export declare function isNotesRef(refName: string): boolean;
/**
 * Check if a ref is the stash ref.
 */
export declare function isStashRef(refName: string): boolean;
/**
 * Parse a packed-refs file.
 */
export declare function parsePackedRefsFile(content: string): PackedRefs;
/**
 * Serialize a packed-refs file.
 */
export declare function serializePackedRefsFile(refs: PackedRefs): string;
/**
 * Get peeled target from packed refs.
 */
export declare function getPeeledTarget(refs: PackedRefs, refName: string): string | null;
/**
 * Check if a ref has a peeled entry.
 */
export declare function hasPeeledEntry(refs: PackedRefs, refName: string): boolean;
type RefGetter = (name: string) => Promise<Ref | null>;
/** Options for ref resolution */
export interface ResolveOptions {
    maxDepth?: number;
}
/**
 * Resolve a ref through symbolic chains to a SHA.
 */
export declare function resolveRefChain(refName: string, getRef: RefGetter, options?: ResolveOptions): Promise<ResolvedRef>;
/**
 * Resolve a ref to its final SHA.
 */
export declare function resolveToSha(refName: string, getRef: RefGetter, options?: ResolveOptions): Promise<string>;
/**
 * Parse a refspec string.
 */
export declare function parseRefspec(refspec: string): Refspec;
/**
 * Serialize a refspec to string.
 */
export declare function serializeRefspec(refspec: Refspec): string;
/**
 * Check if a refspec is forced.
 */
export declare function isForceRefspec(refspec: Refspec): boolean;
/**
 * Get the source of a refspec.
 */
export declare function getRefspecSource(refspec: Refspec): string;
/**
 * Get the destination of a refspec.
 */
export declare function getRefspecDestination(refspec: Refspec): string;
/**
 * Check if a ref matches a refspec.
 */
export declare function matchRefspec(refspec: Refspec, ref: string): boolean;
/**
 * Expand a refspec for a specific ref.
 */
export declare function expandRefspec(refspec: Refspec, ref: string): {
    source: string;
    destination: string;
};
/**
 * Parse a ref pattern.
 */
export declare function parseRefPattern(pattern: string): RefPattern;
/**
 * Match a ref against a pattern.
 */
export declare function matchRefPattern(pattern: RefPattern, ref: string): boolean;
/**
 * Expand a pattern to matching refs.
 */
export declare function expandRefPattern(pattern: RefPattern, refs: string[]): string[];
/**
 * Check if a pattern string is a wildcard.
 */
export declare function isWildcardPattern(pattern: string): boolean;
type ObjectGetter = (sha: string) => Promise<{
    type: string;
    target?: string;
    tree?: string;
} | null>;
/** Options for peeling */
export interface PeelOptions {
    target?: 'commit' | 'tree';
}
/**
 * Peel a ref to its target commit/tree.
 */
export declare function peelRef(sha: string, getObject: ObjectGetter, options?: PeelOptions): Promise<string>;
/**
 * Check if a ref name is a peeled ref (ends with ^{}).
 */
export declare function isPeeledRef(refName: string): boolean;
/**
 * Get cached peeled SHA.
 */
export declare function getPeeledSha(cache: Map<string, string>, refName: string): string | null;
/**
 * Get the current HEAD state.
 */
export declare function getHeadState(getRef: RefGetter): Promise<HeadState>;
/**
 * Check if HEAD is detached.
 */
export declare function isDetachedHead(state: HeadState): boolean;
/**
 * Get SHA when HEAD is detached.
 */
export declare function getDetachedSha(state: HeadState): string | null;
/**
 * Get the attached branch.
 */
export declare function getAttachedBranch(state: HeadState, options?: {
    stripPrefix?: boolean;
}): string | null;
/** Lock acquisition options */
export interface LockOptions {
    timeout?: number;
    retryInterval?: number;
    owner?: string;
    staleThreshold?: number;
    breakStale?: boolean;
}
/**
 * Acquire a lock on a ref.
 */
export declare function acquireRefLock(refName: string, backend: LockBackend, options?: LockOptions): Promise<RefLock>;
/**
 * Release a ref lock.
 */
export declare function releaseRefLock(lock: RefLock): Promise<void>;
/**
 * Check if a ref is locked.
 */
export declare function isRefLocked(refName: string, backend: {
    checkLock?: (name: string) => Promise<boolean>;
}): Promise<boolean>;
/**
 * A single entry in the reflog.
 *
 * The reflog tracks changes to refs over time, recording:
 * - What SHA the ref changed from/to
 * - Who made the change
 * - When the change was made
 * - Why the change was made (message)
 */
export interface ReflogEntry {
    /** SHA before the change (zero SHA for creation) */
    oldSha: string;
    /** SHA after the change (zero SHA for deletion) */
    newSha: string;
    /** Committer/author identity */
    committer: {
        name: string;
        email: string;
    };
    /** Unix timestamp of the change */
    timestamp: number;
    /** Timezone offset in minutes */
    timezoneOffset: number;
    /** Message describing the change (e.g., "commit: Initial commit") */
    message: string;
}
/**
 * Zero SHA used for ref creation/deletion in reflog.
 */
export declare const ZERO_SHA = "0000000000000000000000000000000000000000";
/**
 * Parse a single reflog line.
 *
 * Format: <old-sha> <new-sha> <committer> <timestamp> <tz> <tab><message>
 * Example: abc123... def456... John Doe <john@example.com> 1234567890 -0500	commit: message
 */
export declare function parseReflogLine(line: string): ReflogEntry | null;
/**
 * Serialize a reflog entry to a line.
 */
export declare function serializeReflogEntry(entry: ReflogEntry): string;
/**
 * Parse a complete reflog file.
 *
 * Returns entries in reverse chronological order (newest first),
 * which is the standard Git reflog display order.
 */
export declare function parseReflogFile(content: string): ReflogEntry[];
/**
 * Serialize reflog entries to file content.
 *
 * Entries should be in chronological order (oldest first) for storage.
 */
export declare function serializeReflogFile(entries: ReflogEntry[]): string;
/**
 * Create a reflog entry for a ref update.
 *
 * @param oldSha - Previous SHA (use ZERO_SHA for creation)
 * @param newSha - New SHA (use ZERO_SHA for deletion)
 * @param committer - Who made the change
 * @param message - Description of the change
 */
export declare function createReflogEntry(oldSha: string, newSha: string, committer: {
    name: string;
    email: string;
}, message: string): ReflogEntry;
/**
 * Reflog backend interface for storing reflog entries.
 */
export interface ReflogBackend {
    /**
     * Append an entry to a ref's reflog.
     */
    appendEntry(refName: string, entry: ReflogEntry): Promise<void>;
    /**
     * Read all entries from a ref's reflog.
     * Returns entries in reverse chronological order (newest first).
     */
    readEntries(refName: string): Promise<ReflogEntry[]>;
    /**
     * Delete a reflog for a ref.
     */
    deleteReflog(refName: string): Promise<void>;
    /**
     * Check if a reflog exists for a ref.
     */
    reflogExists(refName: string): Promise<boolean>;
}
/**
 * In-memory reflog backend for testing and simple use cases.
 */
export declare class InMemoryReflogBackend implements ReflogBackend {
    private reflogs;
    appendEntry(refName: string, entry: ReflogEntry): Promise<void>;
    readEntries(refName: string): Promise<ReflogEntry[]>;
    deleteReflog(refName: string): Promise<void>;
    reflogExists(refName: string): Promise<boolean>;
    /**
     * Get raw entries in chronological order (for testing).
     */
    getRawEntries(refName: string): ReflogEntry[];
    /**
     * Clear all reflogs (for testing).
     */
    clear(): void;
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
export declare class ReflogManager {
    private backend;
    private defaultCommitter;
    constructor(backend: ReflogBackend, defaultCommitter?: {
        name: string;
        email: string;
    });
    /**
     * Record a ref update in the reflog.
     *
     * @param refName - The ref being updated (e.g., 'HEAD', 'refs/heads/main')
     * @param oldSha - Previous SHA (use ZERO_SHA for creation)
     * @param newSha - New SHA (use ZERO_SHA for deletion)
     * @param message - Description of the change
     * @param committer - Optional committer info (defaults to constructor default)
     */
    recordUpdate(refName: string, oldSha: string, newSha: string, message: string, committer?: {
        name: string;
        email: string;
    }): Promise<void>;
    /**
     * Record a HEAD update (convenience method).
     */
    recordHeadUpdate(oldSha: string, newSha: string, message: string, committer?: {
        name: string;
        email: string;
    }): Promise<void>;
    /**
     * Get reflog history for a ref.
     *
     * @param refName - The ref to get history for
     * @param options - Optional limit and offset
     * @returns Entries in reverse chronological order (newest first)
     */
    getHistory(refName: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<ReflogEntry[]>;
    /**
     * Get a specific reflog entry by index.
     *
     * @param refName - The ref to look up
     * @param index - Entry index (0 = newest, @{n} syntax)
     * @returns The entry or null if not found
     */
    getEntry(refName: string, index: number): Promise<ReflogEntry | null>;
    /**
     * Get the SHA at a specific reflog position.
     *
     * @param refName - The ref to look up
     * @param index - Entry index (0 = current, 1 = previous, etc.)
     * @returns The SHA or null if not found
     */
    getShaAtIndex(refName: string, index: number): Promise<string | null>;
    /**
     * Delete reflog for a ref.
     */
    deleteReflog(refName: string): Promise<void>;
    /**
     * Check if a reflog exists for a ref.
     */
    hasReflog(refName: string): Promise<boolean>;
}
/**
 * Result of an atomic ref update.
 */
export interface AtomicUpdateResult {
    success: boolean;
    oldSha: string | null;
    newSha: string | null;
    error?: string;
}
/**
 * Command for a batch atomic ref update.
 *
 * This is used for the atomic update helpers in refs module.
 * Note: The protocol module has its own RefUpdateCommand for wire protocol.
 */
export interface AtomicRefUpdateCommand {
    refName: string;
    oldSha: string | null;
    newSha: string | null;
    force?: boolean;
}
/**
 * Validate an atomic update command.
 */
export declare function validateAtomicUpdateCommand(cmd: AtomicRefUpdateCommand): string | null;
/**
 * Compare-and-swap check for atomic updates.
 */
export declare function casCheck(expectedOld: string | null, actualOld: string | null): boolean;
export {};
//# sourceMappingURL=index.d.ts.map