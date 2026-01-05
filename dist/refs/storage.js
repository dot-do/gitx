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
export class RefError extends Error {
    code;
    refName;
    /**
     * Create a new RefError.
     *
     * @param message - Human-readable error message
     * @param code - Error code for programmatic handling
     * @param refName - The ref that caused the error (optional)
     */
    constructor(message, code, refName) {
        super(message);
        this.code = code;
        this.refName = refName;
        this.name = 'RefError';
    }
}
// ============================================================================
// Validation Functions
// ============================================================================
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
export function isValidRefName(name) {
    // HEAD is always valid
    if (name === 'HEAD') {
        return true;
    }
    // Just @ is invalid
    if (name === '@') {
        return false;
    }
    // Cannot be empty
    if (!name || name.length === 0) {
        return false;
    }
    // Cannot end with /
    if (name.endsWith('/')) {
        return false;
    }
    // Cannot end with .lock
    if (name.endsWith('.lock')) {
        return false;
    }
    // Cannot contain @{
    if (name.includes('@{')) {
        return false;
    }
    // Cannot contain ..
    if (name.includes('..')) {
        return false;
    }
    // Cannot contain control characters (ASCII 0-31), space, ~, ^, :, ?, *, [, \
    const invalidChars = /[\x00-\x1f\x7f ~^:?*[\]\\]/;
    if (invalidChars.test(name)) {
        return false;
    }
    // Split into components and check each
    const components = name.split('/');
    for (const component of components) {
        // Cannot have empty components (// in path)
        if (component.length === 0) {
            return false;
        }
        // Cannot start with .
        if (component.startsWith('.')) {
            return false;
        }
        // Cannot end with .
        if (component.endsWith('.')) {
            return false;
        }
    }
    return true;
}
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
export function isValidSha(sha) {
    // Must be exactly 40 characters
    if (!sha || sha.length !== 40) {
        return false;
    }
    // Must be valid hex
    return /^[0-9a-fA-F]{40}$/.test(sha);
}
// ============================================================================
// Parsing and Serialization Functions
// ============================================================================
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
export function parseRefContent(content) {
    const trimmed = content.trim();
    // Check for symbolic ref (starts with "ref:")
    if (trimmed.startsWith('ref:')) {
        const target = trimmed.slice(4).trim();
        return { type: 'symbolic', target };
    }
    // Otherwise it's a direct ref (SHA)
    return { type: 'direct', target: trimmed };
}
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
export function serializeRefContent(ref) {
    if (ref.type === 'symbolic') {
        return `ref: ${ref.target}\n`;
    }
    return `${ref.target}\n`;
}
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
export function parsePackedRefs(content) {
    const refs = new Map();
    if (!content) {
        return refs;
    }
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines
        if (!trimmed) {
            continue;
        }
        // Skip comment lines
        if (trimmed.startsWith('#')) {
            continue;
        }
        // Skip peeled entries (lines starting with ^)
        if (trimmed.startsWith('^')) {
            continue;
        }
        // Parse "sha refname" format
        const spaceIndex = trimmed.indexOf(' ');
        if (spaceIndex > 0) {
            const sha = trimmed.slice(0, spaceIndex);
            const refName = trimmed.slice(spaceIndex + 1);
            refs.set(refName, sha);
        }
    }
    return refs;
}
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
export function serializePackedRefs(refs) {
    const lines = ['# pack-refs with: peeled fully-peeled sorted'];
    // Sort refs alphabetically
    const sortedRefs = Array.from(refs.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [refName, sha] of sortedRefs) {
        lines.push(`${sha} ${refName}`);
    }
    return lines.join('\n') + '\n';
}
// ============================================================================
// RefStorage Class
// ============================================================================
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
export class RefStorage {
    backend;
    /**
     * Create a new RefStorage instance.
     *
     * @param backend - Storage backend for persistence
     */
    constructor(backend) {
        this.backend = backend;
    }
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
    async getRef(name) {
        if (!this.backend.readRef) {
            throw new Error('Backend does not support readRef');
        }
        return this.backend.readRef(name);
    }
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
    async resolveRef(name, options) {
        const maxDepth = options?.maxDepth ?? 10;
        const chain = [];
        const visited = new Set();
        let currentName = name;
        let ref = null;
        for (let depth = 0; depth < maxDepth; depth++) {
            // Check for circular refs
            if (visited.has(currentName)) {
                throw new RefError(`Circular reference detected: ${currentName}`, 'CIRCULAR_REF', currentName);
            }
            visited.add(currentName);
            ref = await this.getRef(currentName);
            if (!ref) {
                throw new RefError(`Ref not found: ${currentName}`, 'NOT_FOUND', currentName);
            }
            chain.push(ref);
            // If it's a direct ref, we're done
            if (ref.type === 'direct') {
                return {
                    ref: chain[0],
                    sha: ref.target,
                    chain
                };
            }
            // Follow symbolic ref
            currentName = ref.target;
        }
        // Max depth exceeded
        throw new RefError(`Max ref resolution depth exceeded: ${maxDepth}`, 'MAX_DEPTH_EXCEEDED', name);
    }
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
    async updateRef(name, target, options) {
        // Validate ref name
        if (!isValidRefName(name)) {
            throw new RefError(`Invalid ref name: ${name}`, 'INVALID_NAME', name);
        }
        // Validate SHA
        if (!isValidSha(target)) {
            throw new RefError(`Invalid SHA: ${target}`, 'INVALID_SHA', name);
        }
        // Use provided lock or acquire a new one
        const externalLock = options?.lock;
        const lock = externalLock ?? await this.backend.acquireLock(name);
        try {
            const existingRef = await this.getRef(name);
            // Handle oldValue check (CAS - compare and swap)
            if (options?.oldValue !== undefined) {
                if (options.oldValue === null) {
                    // Expect ref to NOT exist
                    if (existingRef) {
                        throw new RefError(`Ref already exists: ${name}`, 'ALREADY_EXISTS', name);
                    }
                }
                else {
                    // Expect ref to have specific value
                    if (!existingRef || existingRef.target !== options.oldValue) {
                        throw new RefError(`Ref value mismatch: ${name}`, 'CONFLICT', name);
                    }
                }
            }
            else if (!options?.force && !options?.create && !existingRef) {
                // If not forcing and not creating, ref must exist
                throw new RefError(`Ref not found: ${name}`, 'NOT_FOUND', name);
            }
            const ref = {
                name,
                target,
                type: 'direct'
            };
            await this.backend.writeRef(ref);
            return ref;
        }
        finally {
            // Only release lock if we acquired it ourselves
            if (!externalLock) {
                await lock.release();
            }
        }
    }
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
    async deleteRef(name, options) {
        // Cannot delete HEAD
        if (name === 'HEAD') {
            throw new RefError('Cannot delete HEAD', 'INVALID_NAME', name);
        }
        // Validate ref name
        if (!isValidRefName(name)) {
            throw new RefError(`Invalid ref name: ${name}`, 'INVALID_NAME', name);
        }
        // Acquire lock for atomic operation
        const lock = await this.backend.acquireLock(name);
        try {
            const existingRef = await this.getRef(name);
            // Check oldValue if provided (compare-and-swap pattern)
            if (options?.oldValue !== undefined && options.oldValue !== null) {
                if (!existingRef || existingRef.target !== options.oldValue) {
                    throw new RefError(`Ref value mismatch: ${name}`, 'CONFLICT', name);
                }
            }
            if (!existingRef) {
                return false;
            }
            return this.backend.deleteRef(name);
        }
        finally {
            await lock.release();
        }
    }
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
    async listRefs(options) {
        let refs = await this.backend.listRefs(options?.pattern);
        // Filter out HEAD unless explicitly requested
        if (!options?.includeHead) {
            refs = refs.filter(r => r.name !== 'HEAD');
        }
        else {
            // If includeHead is true, make sure HEAD is in the list
            const hasHead = refs.some(r => r.name === 'HEAD');
            if (!hasHead) {
                const head = await this.getRef('HEAD');
                if (head) {
                    refs = [head, ...refs];
                }
            }
        }
        // Filter symbolic refs unless requested
        // Note: Always keep HEAD if includeHead is true, regardless of includeSymbolic
        if (!options?.includeSymbolic) {
            refs = refs.filter(r => r.type !== 'symbolic' || (options?.includeHead && r.name === 'HEAD'));
        }
        return refs;
    }
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
    async listBranches() {
        return this.listRefs({ pattern: 'refs/heads/*' });
    }
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
    async listTags() {
        return this.listRefs({ pattern: 'refs/tags/*' });
    }
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
    async getHead() {
        const head = await this.getRef('HEAD');
        if (!head) {
            throw new RefError('HEAD not found', 'NOT_FOUND', 'HEAD');
        }
        return head;
    }
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
    async updateHead(target, symbolic) {
        // Acquire lock for atomic HEAD update
        const lock = await this.backend.acquireLock('HEAD');
        try {
            const ref = {
                name: 'HEAD',
                target,
                type: symbolic ? 'symbolic' : 'direct'
            };
            await this.backend.writeRef(ref);
            return ref;
        }
        finally {
            await lock.release();
        }
    }
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
    async isHeadDetached() {
        const head = await this.getHead();
        return head.type === 'direct';
    }
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
    async createSymbolicRef(name, target) {
        // Validate ref name
        if (!isValidRefName(name)) {
            throw new RefError(`Invalid ref name: ${name}`, 'INVALID_NAME', name);
        }
        // Cannot point to itself
        if (name === target) {
            throw new RefError(`Symbolic ref cannot point to itself: ${name}`, 'CIRCULAR_REF', name);
        }
        // Acquire lock for atomic symbolic ref creation
        const lock = await this.backend.acquireLock(name);
        try {
            const ref = {
                name,
                target,
                type: 'symbolic'
            };
            await this.backend.writeRef(ref);
            return ref;
        }
        finally {
            await lock.release();
        }
    }
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
    async acquireLock(name, timeout) {
        return this.backend.acquireLock(name, timeout);
    }
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
    async packRefs() {
        const allRefs = await this.backend.listRefs();
        const packed = new Map();
        const locks = [];
        // Filter refs that can be packed (not HEAD, not symbolic)
        const packableRefs = allRefs.filter(ref => {
            if (ref.name === 'HEAD')
                return false;
            if (ref.type === 'symbolic')
                return false;
            return true;
        });
        // Acquire locks on all refs being packed for transactional consistency
        try {
            for (const ref of packableRefs) {
                const lock = await this.backend.acquireLock(ref.name);
                locks.push(lock);
            }
            // Re-read refs while holding locks to ensure consistency
            for (const ref of packableRefs) {
                const currentRef = await this.getRef(ref.name);
                if (currentRef && currentRef.type === 'direct') {
                    packed.set(currentRef.name, currentRef.target);
                }
            }
            // Write packed refs atomically
            await this.backend.writePackedRefs(packed);
        }
        finally {
            // Release all locks
            for (const lock of locks) {
                await lock.release();
            }
        }
    }
}
// ============================================================================
// Convenience Functions
// ============================================================================
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
export async function resolveRef(storage, name, options) {
    const resolved = await storage.resolveRef(name, options);
    return resolved.sha;
}
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
export async function updateRef(storage, name, target, options) {
    return storage.updateRef(name, target, options);
}
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
export async function deleteRef(storage, name, options) {
    return storage.deleteRef(name, options);
}
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
export async function listRefs(storage, options) {
    return storage.listRefs(options);
}
//# sourceMappingURL=storage.js.map