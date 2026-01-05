/**
 * @fileoverview Git Reference Storage System
 *
 * This module provides a complete implementation of Git reference management,
 * including branches, tags, HEAD, and symbolic refs. It supports both loose refs
 * (individual files) and packed refs (consolidated file).
 *
 * **Key Concepts**:
 * - **Direct refs**: Point directly to a SHA-1 hash (e.g., branch pointing to commit)
 * - **Symbolic refs**: Point to another ref (e.g., HEAD -> refs/heads/main)
 * - **Loose refs**: Individual ref files in .git/refs/
 * - **Packed refs**: Consolidated refs in .git/packed-refs for efficiency
 *
 * @module refs/storage
 *
 * @example
 * ```typescript
 * import { RefStorage, isValidRefName, isValidSha } from './refs/storage'
 *
 * // Create storage with backend
 * const storage = new RefStorage(backend)
 *
 * // Resolve HEAD to get current commit
 * const resolved = await storage.resolveRef('HEAD')
 * console.log(`Current commit: ${resolved.sha}`)
 *
 * // Update a branch
 * await storage.updateRef('refs/heads/feature', newCommitSha, { create: true })
 *
 * // List all branches
 * const branches = await storage.listBranches()
 * ```
 */
/**
 * Type discriminator for reference types.
 *
 * @description
 * - `direct`: Points directly to a SHA-1 hash
 * - `symbolic`: Points to another ref name (follows chain on resolution)
 */
export type RefType = 'direct' | 'symbolic';
/**
 * Represents a Git reference (branch, tag, HEAD, etc.).
 *
 * @description
 * References are named pointers in Git. They can point directly to objects
 * (like commits) or symbolically to other refs.
 *
 * @example
 * ```typescript
 * // Direct ref (branch pointing to commit)
 * const branch: Ref = {
 *   name: 'refs/heads/main',
 *   target: 'abc123def456...',
 *   type: 'direct'
 * }
 *
 * // Symbolic ref (HEAD pointing to branch)
 * const head: Ref = {
 *   name: 'HEAD',
 *   target: 'refs/heads/main',
 *   type: 'symbolic'
 * }
 * ```
 */
export interface Ref {
    /** Full ref name (e.g., 'refs/heads/main', 'HEAD') */
    name: string;
    /** Target - SHA-1 hash for direct refs, ref name for symbolic refs */
    target: string;
    /** Whether this is a direct or symbolic reference */
    type: RefType;
}
/**
 * Options for updating a reference.
 *
 * @description
 * Provides control over ref update behavior including atomic operations
 * (compare-and-swap), creation, and force updates.
 */
export interface UpdateRefOptions {
    /** If true, create the ref if it doesn't exist (default: false) */
    create?: boolean;
    /**
     * Expected old value for compare-and-swap (CAS) operation.
     * - `null`: Expect ref to NOT exist (atomic create)
     * - SHA string: Expect ref to have this exact value
     * - undefined: No CAS check
     */
    oldValue?: string | null;
    /** Force update even if not a fast-forward (for branch updates) */
    force?: boolean;
    /** Reason for the update (stored in reflog if implemented) */
    reason?: string;
    /** Use an existing lock instead of acquiring a new one */
    lock?: RefLock;
}
/**
 * Options for listing references.
 *
 * @description
 * Controls which refs are included in listing operations.
 */
export interface ListRefsOptions {
    /** Glob pattern to filter refs (e.g., 'refs/heads/*', 'refs/tags/v*') */
    pattern?: string;
    /** Include HEAD in the listing (default: false) */
    includeHead?: boolean;
    /** Include symbolic refs in the listing (default: false) */
    includeSymbolic?: boolean;
}
/**
 * Options for resolving references.
 */
export interface ResolveRefOptions {
    /**
     * Maximum depth for following symbolic refs (default: 10).
     * Prevents infinite loops from circular refs.
     */
    maxDepth?: number;
}
/**
 * Result of resolving a reference.
 *
 * @description
 * Contains the resolved SHA and the chain of refs followed during resolution.
 * Useful for understanding ref structure and debugging.
 */
export interface ResolvedRef {
    /** The original ref that was resolved */
    ref: Ref;
    /** The final SHA-1 target after following all symbolic refs */
    sha: string;
    /** Chain of refs followed during resolution (for debugging/display) */
    chain: Ref[];
}
/**
 * Error thrown when a ref operation fails.
 *
 * @description
 * Provides structured error information including error code
 * and the ref name that caused the error.
 *
 * @example
 * ```typescript
 * try {
 *   await storage.updateRef('refs/heads/main', sha)
 * } catch (e) {
 *   if (e instanceof RefError) {
 *     switch (e.code) {
 *       case 'NOT_FOUND': // Ref doesn't exist
 *       case 'CONFLICT':  // CAS failed
 *       case 'LOCKED':    // Ref is locked
 *     }
 *   }
 * }
 * ```
 */
export declare class RefError extends Error {
    readonly code: RefErrorCode;
    readonly refName?: string | undefined;
    /**
     * Create a new RefError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param refName - The ref that caused the error (optional)
     */
    constructor(message: string, code: RefErrorCode, refName?: string | undefined);
}
/**
 * Error codes for ref operations.
 *
 * @description
 * - `NOT_FOUND`: Ref doesn't exist
 * - `ALREADY_EXISTS`: Ref already exists (when creating)
 * - `INVALID_NAME`: Ref name fails validation
 * - `LOCKED`: Another process holds the ref lock
 * - `CONFLICT`: CAS operation failed (value changed)
 * - `CIRCULAR_REF`: Symbolic ref chain loops back on itself
 * - `MAX_DEPTH_EXCEEDED`: Too many symbolic ref redirects
 * - `INVALID_SHA`: SHA format is invalid
 */
export type RefErrorCode = 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INVALID_NAME' | 'LOCKED' | 'CONFLICT' | 'CIRCULAR_REF' | 'MAX_DEPTH_EXCEEDED' | 'INVALID_SHA';
/**
 * Lock handle for atomic ref updates.
 *
 * @description
 * Ref locks prevent concurrent modifications to the same ref.
 * Always release locks when done, preferably in a finally block.
 *
 * @example
 * ```typescript
 * const lock = await storage.acquireLock('refs/heads/main')
 * try {
 *   const ref = await storage.getRef('refs/heads/main')
 *   // ... modify and write ref ...
 * } finally {
 *   await lock.release()
 * }
 * ```
 */
export interface RefLock {
    /** The ref being locked */
    refName: string;
    /** Release the lock - should be idempotent */
    release(): Promise<void>;
    /** Check if this lock is still held by us */
    isHeld(): boolean;
}
/**
 * Storage backend interface for refs.
 *
 * @description
 * Implement this interface to provide ref storage.
 * The backend is responsible for persistence, locking, and packed refs.
 */
export interface RefStorageBackend {
    /**
     * Read a single ref from storage.
     *
     * @param name - Full ref name
     * @returns The ref or null if not found
     */
    readRef(name: string): Promise<Ref | null>;
    /**
     * Write a ref to storage.
     *
     * @param ref - The ref to write
     */
    writeRef(ref: Ref): Promise<void>;
    /**
     * Delete a ref from storage.
     *
     * @param name - Full ref name
     * @returns True if deleted, false if not found
     */
    deleteRef(name: string): Promise<boolean>;
    /**
     * List all refs matching a pattern.
     *
     * @param pattern - Optional glob pattern
     * @returns Array of matching refs
     */
    listRefs(pattern?: string): Promise<Ref[]>;
    /**
     * Acquire an exclusive lock on a ref.
     *
     * @param name - Full ref name
     * @param timeout - Lock acquisition timeout in ms
     * @returns Lock handle
     * @throws RefError with code 'LOCKED' if lock cannot be acquired
     */
    acquireLock(name: string, timeout?: number): Promise<RefLock>;
    /**
     * Read packed refs file.
     *
     * @returns Map of ref names to SHA values
     */
    readPackedRefs(): Promise<Map<string, string>>;
    /**
     * Write packed refs file.
     *
     * @param refs - Map of ref names to SHA values
     */
    writePackedRefs(refs: Map<string, string>): Promise<void>;
}
/**
 * Validate a ref name according to Git rules.
 *
 * @description
 * Git has specific rules for valid ref names. This function implements
 * the validation from `git check-ref-format`.
 *
 * **Rules**:
 * - Cannot be empty or just '@'
 * - Cannot end with '/' or '.lock'
 * - Cannot contain '..', '@{', control chars, space, ~, ^, :, ?, *, [, \
 * - Components cannot start or end with '.'
 * - HEAD is always valid
 *
 * @param name - Ref name to validate
 * @returns True if the name is valid
 *
 * @see https://git-scm.com/docs/git-check-ref-format
 *
 * @example
 * ```typescript
 * isValidRefName('refs/heads/main')       // true
 * isValidRefName('refs/heads/feature/x')  // true
 * isValidRefName('HEAD')                   // true
 * isValidRefName('refs/heads/../main')    // false (contains ..)
 * isValidRefName('refs/heads/.hidden')    // false (component starts with .)
 * isValidRefName('refs/heads/foo.lock')   // false (ends with .lock)
 * ```
 */
export declare function isValidRefName(name: string): boolean;
/**
 * Validate a SHA-1 hash string.
 *
 * @description
 * SHA-1 hashes must be exactly 40 hexadecimal characters.
 * This validates the format, not whether the object exists.
 *
 * @param sha - SHA string to validate
 * @returns True if the string is a valid SHA-1 format
 *
 * @example
 * ```typescript
 * isValidSha('abc123def456789...')  // true (if 40 hex chars)
 * isValidSha('abc123')              // false (too short)
 * isValidSha('xyz...')              // false (invalid hex)
 * isValidSha(null)                  // false
 * ```
 */
export declare function isValidSha(sha: string): boolean;
/**
 * Parse ref file content into type and target.
 *
 * @description
 * Ref files either contain a SHA directly or "ref: <target>" for symbolic refs.
 *
 * @param content - Raw ref file content
 * @returns Parsed type and target
 *
 * @example
 * ```typescript
 * // Direct ref
 * parseRefContent('abc123def456...\n')
 * // => { type: 'direct', target: 'abc123def456...' }
 *
 * // Symbolic ref
 * parseRefContent('ref: refs/heads/main\n')
 * // => { type: 'symbolic', target: 'refs/heads/main' }
 * ```
 */
export declare function parseRefContent(content: string): {
    type: RefType;
    target: string;
};
/**
 * Serialize a ref to file content format.
 *
 * @description
 * Converts a Ref object to the string format stored in ref files.
 *
 * @param ref - Ref to serialize
 * @returns File content string (with trailing newline)
 *
 * @example
 * ```typescript
 * serializeRefContent({ name: 'HEAD', target: 'refs/heads/main', type: 'symbolic' })
 * // => 'ref: refs/heads/main\n'
 *
 * serializeRefContent({ name: 'refs/heads/main', target: 'abc123...', type: 'direct' })
 * // => 'abc123...\n'
 * ```
 */
export declare function serializeRefContent(ref: Ref): string;
/**
 * Parse packed-refs file content.
 *
 * @description
 * The packed-refs file contains multiple refs in a space-efficient format.
 * Format: "<sha> <refname>" on each line, with optional comments (#) and
 * peeled entries (^sha for annotated tags).
 *
 * @param content - Raw packed-refs file content
 * @returns Map of ref names to SHA values
 *
 * @example
 * ```typescript
 * const content = `# pack-refs with: peeled fully-peeled sorted
 * abc123 refs/heads/main
 * def456 refs/tags/v1.0.0
 * ^aaa111
 * `
 * const refs = parsePackedRefs(content)
 * // Map { 'refs/heads/main' => 'abc123', 'refs/tags/v1.0.0' => 'def456' }
 * ```
 */
export declare function parsePackedRefs(content: string): Map<string, string>;
/**
 * Serialize refs to packed-refs file format.
 *
 * @description
 * Creates the content for a packed-refs file from a map of refs.
 * Refs are sorted alphabetically for consistency.
 *
 * @param refs - Map of ref names to SHA values
 * @returns Packed-refs file content
 *
 * @example
 * ```typescript
 * const refs = new Map([
 *   ['refs/heads/main', 'abc123...'],
 *   ['refs/tags/v1.0.0', 'def456...']
 * ])
 * const content = serializePackedRefs(refs)
 * // '# pack-refs with: peeled fully-peeled sorted\nabc123... refs/heads/main\n...'
 * ```
 */
export declare function serializePackedRefs(refs: Map<string, string>): string;
/**
 * Reference storage manager.
 *
 * @description
 * Provides a high-level API for managing Git references. Handles ref
 * resolution, updates with locking, symbolic refs, and packed refs.
 *
 * @example
 * ```typescript
 * const storage = new RefStorage(myBackend)
 *
 * // Get current branch
 * const head = await storage.getHead()
 * if (head.type === 'symbolic') {
 *   console.log(`On branch: ${head.target}`)
 * }
 *
 * // Resolve to SHA
 * const resolved = await storage.resolveRef('HEAD')
 * console.log(`Current commit: ${resolved.sha}`)
 *
 * // Create a branch
 * await storage.updateRef('refs/heads/feature', commitSha, { create: true })
 * ```
 */
export declare class RefStorage {
    private backend;
    /**
     * Create a new RefStorage instance.
     *
     * @param backend - Storage backend for persistence
     */
    constructor(backend: RefStorageBackend);
    /**
     * Get a ref by name.
     *
     * @description
     * Retrieves a ref without resolving symbolic refs.
     * Use `resolveRef` to follow symbolic refs to their final target.
     *
     * @param name - Full ref name
     * @returns The ref or null if not found
     * @throws Error if backend doesn't support readRef
     *
     * @example
     * ```typescript
     * const head = await storage.getRef('HEAD')
     * if (head && head.type === 'symbolic') {
     *   console.log(`HEAD points to ${head.target}`)
     * }
     * ```
     */
    getRef(name: string): Promise<Ref | null>;
    /**
     * Resolve a ref to its final SHA target.
     *
     * @description
     * Follows symbolic refs until reaching a direct ref, then returns
     * the SHA and the chain of refs followed.
     *
     * @param name - Ref name to resolve
     * @param options - Resolution options (maxDepth)
     * @returns Resolved ref with SHA and chain
     * @throws RefError with code 'NOT_FOUND' if ref doesn't exist
     * @throws RefError with code 'CIRCULAR_REF' if circular reference detected
     * @throws RefError with code 'MAX_DEPTH_EXCEEDED' if too many redirects
     *
     * @example
     * ```typescript
     * const resolved = await storage.resolveRef('HEAD')
     * console.log(`SHA: ${resolved.sha}`)
     * console.log(`Chain: ${resolved.chain.map(r => r.name).join(' -> ')}`)
     * // Chain: HEAD -> refs/heads/main
     * ```
     */
    resolveRef(name: string, options?: ResolveRefOptions): Promise<ResolvedRef>;
    /**
     * Update or create a ref.
     *
     * @description
     * Creates a new ref or updates an existing one. Supports atomic
     * compare-and-swap operations via oldValue option.
     *
     * Note: For atomic operations, callers can acquire a lock via acquireLock()
     * and pass it via options.lock to avoid double-locking.
     *
     * @param name - Full ref name
     * @param target - SHA-1 hash to point to
     * @param options - Update options (create, oldValue, force, lock)
     * @returns The updated/created ref
     * @throws RefError with code 'INVALID_NAME' if ref name is invalid
     * @throws RefError with code 'INVALID_SHA' if SHA format is invalid
     * @throws RefError with code 'ALREADY_EXISTS' if creating and ref exists
     * @throws RefError with code 'CONFLICT' if oldValue doesn't match
     * @throws RefError with code 'NOT_FOUND' if ref doesn't exist and not creating
     *
     * @example
     * ```typescript
     * // Create a new branch
     * await storage.updateRef('refs/heads/feature', sha, { create: true })
     *
     * // Atomic update (fails if someone else modified)
     * await storage.updateRef('refs/heads/main', newSha, { oldValue: currentSha })
     *
     * // Force update (skips fast-forward check)
     * await storage.updateRef('refs/heads/main', sha, { force: true })
     * ```
     */
    updateRef(name: string, target: string, options?: UpdateRefOptions): Promise<Ref>;
    /**
     * Delete a ref.
     *
     * @description
     * Removes a ref from storage. HEAD cannot be deleted.
     * Uses locking for atomic compare-and-swap operations when oldValue is specified.
     *
     * @param name - Full ref name to delete
     * @param options - Delete options (oldValue for CAS)
     * @returns True if deleted, false if ref didn't exist
     * @throws RefError with code 'INVALID_NAME' for HEAD or invalid names
     * @throws RefError with code 'CONFLICT' if oldValue doesn't match
     *
     * @example
     * ```typescript
     * // Simple delete
     * const deleted = await storage.deleteRef('refs/heads/old-branch')
     *
     * // Atomic delete (only if value matches)
     * await storage.deleteRef('refs/heads/feature', { oldValue: expectedSha })
     * ```
     */
    deleteRef(name: string, options?: UpdateRefOptions): Promise<boolean>;
    /**
     * List refs matching a pattern.
     *
     * @description
     * Returns refs filtered by pattern and options.
     * By default, excludes HEAD and symbolic refs.
     *
     * @param options - Listing options (pattern, includeHead, includeSymbolic)
     * @returns Array of matching refs
     *
     * @example
     * ```typescript
     * // List all refs
     * const all = await storage.listRefs()
     *
     * // List branches only
     * const branches = await storage.listRefs({ pattern: 'refs/heads/*' })
     *
     * // Include HEAD
     * const withHead = await storage.listRefs({ includeHead: true })
     * ```
     */
    listRefs(options?: ListRefsOptions): Promise<Ref[]>;
    /**
     * List all branches.
     *
     * @description
     * Convenience method to list refs under refs/heads/.
     *
     * @returns Array of branch refs
     *
     * @example
     * ```typescript
     * const branches = await storage.listBranches()
     * for (const branch of branches) {
     *   console.log(branch.name.replace('refs/heads/', ''))
     * }
     * ```
     */
    listBranches(): Promise<Ref[]>;
    /**
     * List all tags.
     *
     * @description
     * Convenience method to list refs under refs/tags/.
     *
     * @returns Array of tag refs
     *
     * @example
     * ```typescript
     * const tags = await storage.listTags()
     * for (const tag of tags) {
     *   console.log(tag.name.replace('refs/tags/', ''))
     * }
     * ```
     */
    listTags(): Promise<Ref[]>;
    /**
     * Get HEAD ref.
     *
     * @description
     * Returns the HEAD ref. Every repository should have HEAD.
     *
     * @returns The HEAD ref
     * @throws RefError with code 'NOT_FOUND' if HEAD doesn't exist
     *
     * @example
     * ```typescript
     * const head = await storage.getHead()
     * if (head.type === 'symbolic') {
     *   console.log(`On branch: ${head.target}`)
     * } else {
     *   console.log(`Detached at: ${head.target}`)
     * }
     * ```
     */
    getHead(): Promise<Ref>;
    /**
     * Update HEAD (can be symbolic or detached).
     *
     * @description
     * Sets HEAD to point to a branch (symbolic) or commit (detached).
     * Uses locking to ensure atomic updates to HEAD.
     *
     * @param target - Branch ref name (symbolic) or SHA (detached)
     * @param symbolic - If true, create symbolic ref; if false, direct ref
     * @returns The updated HEAD ref
     *
     * @example
     * ```typescript
     * // Switch to branch
     * await storage.updateHead('refs/heads/main', true)
     *
     * // Detach HEAD at commit
     * await storage.updateHead(commitSha, false)
     * ```
     */
    updateHead(target: string, symbolic?: boolean): Promise<Ref>;
    /**
     * Check if HEAD is detached.
     *
     * @description
     * HEAD is detached when it points directly to a commit SHA
     * rather than symbolically to a branch.
     *
     * @returns True if HEAD is detached (points to SHA directly)
     *
     * @example
     * ```typescript
     * if (await storage.isHeadDetached()) {
     *   console.log('You are in detached HEAD state')
     * }
     * ```
     */
    isHeadDetached(): Promise<boolean>;
    /**
     * Create a symbolic ref.
     *
     * @description
     * Creates a ref that points to another ref name (not a SHA).
     * Used primarily for HEAD pointing to a branch.
     * Uses locking to ensure atomic creation.
     *
     * @param name - Name for the new symbolic ref
     * @param target - Target ref name (not SHA)
     * @returns The created symbolic ref
     * @throws RefError with code 'INVALID_NAME' if name is invalid
     * @throws RefError with code 'CIRCULAR_REF' if name equals target
     *
     * @example
     * ```typescript
     * // Make HEAD point to main branch
     * await storage.createSymbolicRef('HEAD', 'refs/heads/main')
     * ```
     */
    createSymbolicRef(name: string, target: string): Promise<Ref>;
    /**
     * Acquire a lock for updating a ref.
     *
     * @description
     * Acquires an exclusive lock on a ref. Use this for complex operations
     * that need to read-modify-write atomically.
     *
     * @param name - Full ref name to lock
     * @param timeout - Lock acquisition timeout in milliseconds
     * @returns Lock handle - must be released when done
     *
     * @example
     * ```typescript
     * const lock = await storage.acquireLock('refs/heads/main', 5000)
     * try {
     *   // Perform atomic operations
     *   await storage.updateRef('refs/heads/main', sha, { lock })
     * } finally {
     *   await lock.release()
     * }
     * ```
     */
    acquireLock(name: string, timeout?: number): Promise<RefLock>;
    /**
     * Pack loose refs into packed-refs file.
     *
     * @description
     * Consolidates loose ref files into a single packed-refs file.
     * This improves performance for repositories with many refs.
     * HEAD and symbolic refs are not packed.
     *
     * Uses a transactional approach by acquiring locks on all refs being packed
     * to ensure consistency during the packing operation.
     *
     * @example
     * ```typescript
     * // After creating many branches/tags
     * await storage.packRefs()
     * ```
     */
    packRefs(): Promise<void>;
}
/**
 * Resolve a ref to its final SHA target.
 *
 * @description
 * Convenience function that wraps RefStorage.resolveRef.
 *
 * @param storage - RefStorage instance
 * @param name - Ref name to resolve
 * @param options - Resolution options
 * @returns The final SHA target
 *
 * @example
 * ```typescript
 * const sha = await resolveRef(storage, 'HEAD')
 * ```
 */
export declare function resolveRef(storage: RefStorage, name: string, options?: ResolveRefOptions): Promise<string>;
/**
 * Update a ref.
 *
 * @description
 * Convenience function that wraps RefStorage.updateRef.
 *
 * @param storage - RefStorage instance
 * @param name - Full ref name
 * @param target - SHA target
 * @param options - Update options
 * @returns The updated ref
 */
export declare function updateRef(storage: RefStorage, name: string, target: string, options?: UpdateRefOptions): Promise<Ref>;
/**
 * Delete a ref.
 *
 * @description
 * Convenience function that wraps RefStorage.deleteRef.
 *
 * @param storage - RefStorage instance
 * @param name - Full ref name to delete
 * @param options - Delete options
 * @returns True if deleted
 */
export declare function deleteRef(storage: RefStorage, name: string, options?: UpdateRefOptions): Promise<boolean>;
/**
 * List refs.
 *
 * @description
 * Convenience function that wraps RefStorage.listRefs.
 *
 * @param storage - RefStorage instance
 * @param options - Listing options
 * @returns Array of refs
 */
export declare function listRefs(storage: RefStorage, options?: ListRefsOptions): Promise<Ref[]>;
//# sourceMappingURL=storage.d.ts.map