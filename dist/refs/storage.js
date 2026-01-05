/**
 * Git Reference Storage
 *
 * Handles storage and resolution of Git refs (branches, tags, HEAD).
 * Supports both loose refs and packed refs formats.
 */
/**
 * Error thrown when a ref operation fails
 */
export class RefError extends Error {
    code;
    refName;
    constructor(message, code, refName) {
        super(message);
        this.code = code;
        this.refName = refName;
        this.name = 'RefError';
    }
}
/**
 * Validate a ref name according to Git rules
 * See: https://git-scm.com/docs/git-check-ref-format
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
 * Validate a SHA-1 hash
 */
export function isValidSha(sha) {
    // Must be exactly 40 characters
    if (!sha || sha.length !== 40) {
        return false;
    }
    // Must be valid hex
    return /^[0-9a-fA-F]{40}$/.test(sha);
}
/**
 * Parse a ref file content
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
 * Serialize a ref to file content
 */
export function serializeRefContent(ref) {
    if (ref.type === 'symbolic') {
        return `ref: ${ref.target}\n`;
    }
    return `${ref.target}\n`;
}
/**
 * Parse packed-refs file content
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
 * Serialize refs to packed-refs format
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
/**
 * Ref storage implementation
 */
export class RefStorage {
    backend;
    constructor(backend) {
        this.backend = backend;
    }
    /**
     * Get a ref by name
     */
    async getRef(name) {
        if (!this.backend.readRef) {
            throw new Error('Backend does not support readRef');
        }
        return this.backend.readRef(name);
    }
    /**
     * Resolve a ref to its final SHA target
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
     * Update or create a ref
     *
     * Note: For atomic operations, callers can acquire a lock via acquireLock()
     * and pass it via options.lock to avoid double-locking.
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
     * Delete a ref
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
        const existingRef = await this.getRef(name);
        // Check oldValue if provided
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
    /**
     * List refs matching a pattern
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
     * List all branches
     */
    async listBranches() {
        return this.listRefs({ pattern: 'refs/heads/*' });
    }
    /**
     * List all tags
     */
    async listTags() {
        return this.listRefs({ pattern: 'refs/tags/*' });
    }
    /**
     * Get HEAD ref
     */
    async getHead() {
        const head = await this.getRef('HEAD');
        if (!head) {
            throw new RefError('HEAD not found', 'NOT_FOUND', 'HEAD');
        }
        return head;
    }
    /**
     * Update HEAD (can be symbolic or detached)
     */
    async updateHead(target, symbolic) {
        const ref = {
            name: 'HEAD',
            target,
            type: symbolic ? 'symbolic' : 'direct'
        };
        await this.backend.writeRef(ref);
        return ref;
    }
    /**
     * Check if HEAD is detached
     */
    async isHeadDetached() {
        const head = await this.getHead();
        return head.type === 'direct';
    }
    /**
     * Create a symbolic ref
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
        const ref = {
            name,
            target,
            type: 'symbolic'
        };
        await this.backend.writeRef(ref);
        return ref;
    }
    /**
     * Acquire a lock for updating a ref
     */
    async acquireLock(name, timeout) {
        return this.backend.acquireLock(name, timeout);
    }
    /**
     * Pack loose refs into packed-refs file
     */
    async packRefs() {
        const allRefs = await this.backend.listRefs();
        const packed = new Map();
        for (const ref of allRefs) {
            // Don't pack HEAD
            if (ref.name === 'HEAD') {
                continue;
            }
            // Don't pack symbolic refs
            if (ref.type === 'symbolic') {
                continue;
            }
            packed.set(ref.name, ref.target);
        }
        await this.backend.writePackedRefs(packed);
    }
}
/**
 * Resolve a ref to its final SHA target (convenience function)
 */
export async function resolveRef(storage, name, options) {
    const resolved = await storage.resolveRef(name, options);
    return resolved.sha;
}
/**
 * Update a ref (convenience function)
 */
export async function updateRef(storage, name, target, options) {
    return storage.updateRef(name, target, options);
}
/**
 * Delete a ref (convenience function)
 */
export async function deleteRef(storage, name, options) {
    return storage.deleteRef(name, options);
}
/**
 * List refs (convenience function)
 */
export async function listRefs(storage, options) {
    return storage.listRefs(options);
}
//# sourceMappingURL=storage.js.map