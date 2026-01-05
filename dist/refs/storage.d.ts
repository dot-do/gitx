/**
 * Git Reference Storage
 *
 * Handles storage and resolution of Git refs (branches, tags, HEAD).
 * Supports both loose refs and packed refs formats.
 */
export type RefType = 'direct' | 'symbolic';
/**
 * Represents a Git reference (branch, tag, HEAD, etc.)
 */
export interface Ref {
    /** Full ref name (e.g., 'refs/heads/main', 'HEAD') */
    name: string;
    /** Target - either a SHA-1 hash (direct) or another ref name (symbolic) */
    target: string;
    /** Type of reference */
    type: RefType;
}
/**
 * Options for updating a ref
 */
export interface UpdateRefOptions {
    /** If true, create the ref if it doesn't exist */
    create?: boolean;
    /** Expected old value for CAS (compare-and-swap) */
    oldValue?: string | null;
    /** Force update even if not a fast-forward */
    force?: boolean;
    /** Reason for the update (for reflog) */
    reason?: string;
    /** If provided, use this lock instead of acquiring a new one */
    lock?: RefLock;
}
/**
 * Options for listing refs
 */
export interface ListRefsOptions {
    /** Pattern to filter refs (e.g., 'refs/heads/*') */
    pattern?: string;
    /** Include HEAD in the listing */
    includeHead?: boolean;
    /** Include symbolic refs */
    includeSymbolic?: boolean;
}
/**
 * Options for resolving refs
 */
export interface ResolveRefOptions {
    /** Maximum depth for following symbolic refs (default: 10) */
    maxDepth?: number;
}
/**
 * Result of a ref resolution
 */
export interface ResolvedRef {
    /** The original ref that was resolved */
    ref: Ref;
    /** The final SHA-1 target after following all symbolic refs */
    sha: string;
    /** Chain of refs followed during resolution */
    chain: Ref[];
}
/**
 * Error thrown when a ref operation fails
 */
export declare class RefError extends Error {
    readonly code: RefErrorCode;
    readonly refName?: string | undefined;
    constructor(message: string, code: RefErrorCode, refName?: string | undefined);
}
export type RefErrorCode = 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INVALID_NAME' | 'LOCKED' | 'CONFLICT' | 'CIRCULAR_REF' | 'MAX_DEPTH_EXCEEDED' | 'INVALID_SHA';
/**
 * Lock handle for ref updates
 */
export interface RefLock {
    /** The ref being locked */
    refName: string;
    /** Release the lock */
    release(): Promise<void>;
    /** Check if lock is still held */
    isHeld(): boolean;
}
/**
 * Storage backend interface for refs
 */
export interface RefStorageBackend {
    /** Read a single ref */
    readRef(name: string): Promise<Ref | null>;
    /** Write a ref */
    writeRef(ref: Ref): Promise<void>;
    /** Delete a ref */
    deleteRef(name: string): Promise<boolean>;
    /** List all refs matching a pattern */
    listRefs(pattern?: string): Promise<Ref[]>;
    /** Acquire a lock on a ref */
    acquireLock(name: string, timeout?: number): Promise<RefLock>;
    /** Read packed refs */
    readPackedRefs(): Promise<Map<string, string>>;
    /** Write packed refs */
    writePackedRefs(refs: Map<string, string>): Promise<void>;
}
/**
 * Validate a ref name according to Git rules
 * See: https://git-scm.com/docs/git-check-ref-format
 */
export declare function isValidRefName(name: string): boolean;
/**
 * Validate a SHA-1 hash
 */
export declare function isValidSha(sha: string): boolean;
/**
 * Parse a ref file content
 */
export declare function parseRefContent(content: string): {
    type: RefType;
    target: string;
};
/**
 * Serialize a ref to file content
 */
export declare function serializeRefContent(ref: Ref): string;
/**
 * Parse packed-refs file content
 */
export declare function parsePackedRefs(content: string): Map<string, string>;
/**
 * Serialize refs to packed-refs format
 */
export declare function serializePackedRefs(refs: Map<string, string>): string;
/**
 * Ref storage implementation
 */
export declare class RefStorage {
    private backend;
    constructor(backend: RefStorageBackend);
    /**
     * Get a ref by name
     */
    getRef(name: string): Promise<Ref | null>;
    /**
     * Resolve a ref to its final SHA target
     */
    resolveRef(name: string, options?: ResolveRefOptions): Promise<ResolvedRef>;
    /**
     * Update or create a ref
     *
     * Note: For atomic operations, callers can acquire a lock via acquireLock()
     * and pass it via options.lock to avoid double-locking.
     */
    updateRef(name: string, target: string, options?: UpdateRefOptions): Promise<Ref>;
    /**
     * Delete a ref
     */
    deleteRef(name: string, options?: UpdateRefOptions): Promise<boolean>;
    /**
     * List refs matching a pattern
     */
    listRefs(options?: ListRefsOptions): Promise<Ref[]>;
    /**
     * List all branches
     */
    listBranches(): Promise<Ref[]>;
    /**
     * List all tags
     */
    listTags(): Promise<Ref[]>;
    /**
     * Get HEAD ref
     */
    getHead(): Promise<Ref>;
    /**
     * Update HEAD (can be symbolic or detached)
     */
    updateHead(target: string, symbolic?: boolean): Promise<Ref>;
    /**
     * Check if HEAD is detached
     */
    isHeadDetached(): Promise<boolean>;
    /**
     * Create a symbolic ref
     */
    createSymbolicRef(name: string, target: string): Promise<Ref>;
    /**
     * Acquire a lock for updating a ref
     */
    acquireLock(name: string, timeout?: number): Promise<RefLock>;
    /**
     * Pack loose refs into packed-refs file
     */
    packRefs(): Promise<void>;
}
/**
 * Resolve a ref to its final SHA target (convenience function)
 */
export declare function resolveRef(storage: RefStorage, name: string, options?: ResolveRefOptions): Promise<string>;
/**
 * Update a ref (convenience function)
 */
export declare function updateRef(storage: RefStorage, name: string, target: string, options?: UpdateRefOptions): Promise<Ref>;
/**
 * Delete a ref (convenience function)
 */
export declare function deleteRef(storage: RefStorage, name: string, options?: UpdateRefOptions): Promise<boolean>;
/**
 * List refs (convenience function)
 */
export declare function listRefs(storage: RefStorage, options?: ListRefsOptions): Promise<Ref[]>;
//# sourceMappingURL=storage.d.ts.map