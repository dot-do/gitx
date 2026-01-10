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
    partialChain?: string[];
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
export {};
//# sourceMappingURL=index.d.ts.map