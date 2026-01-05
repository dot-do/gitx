/**
 * Git Reference Storage
 *
 * Handles storage and resolution of Git refs (branches, tags, HEAD).
 * Supports both loose refs and packed refs formats.
 */

// Ref type discriminator
export type RefType = 'direct' | 'symbolic'

/**
 * Represents a Git reference (branch, tag, HEAD, etc.)
 */
export interface Ref {
  /** Full ref name (e.g., 'refs/heads/main', 'HEAD') */
  name: string
  /** Target - either a SHA-1 hash (direct) or another ref name (symbolic) */
  target: string
  /** Type of reference */
  type: RefType
}

/**
 * Options for updating a ref
 */
export interface UpdateRefOptions {
  /** If true, create the ref if it doesn't exist */
  create?: boolean
  /** Expected old value for CAS (compare-and-swap) */
  oldValue?: string | null
  /** Force update even if not a fast-forward */
  force?: boolean
  /** Reason for the update (for reflog) */
  reason?: string
  /** If provided, use this lock instead of acquiring a new one */
  lock?: RefLock
}

/**
 * Options for listing refs
 */
export interface ListRefsOptions {
  /** Pattern to filter refs (e.g., 'refs/heads/*') */
  pattern?: string
  /** Include HEAD in the listing */
  includeHead?: boolean
  /** Include symbolic refs */
  includeSymbolic?: boolean
}

/**
 * Options for resolving refs
 */
export interface ResolveRefOptions {
  /** Maximum depth for following symbolic refs (default: 10) */
  maxDepth?: number
}

/**
 * Result of a ref resolution
 */
export interface ResolvedRef {
  /** The original ref that was resolved */
  ref: Ref
  /** The final SHA-1 target after following all symbolic refs */
  sha: string
  /** Chain of refs followed during resolution */
  chain: Ref[]
}

/**
 * Error thrown when a ref operation fails
 */
export class RefError extends Error {
  constructor(
    message: string,
    public readonly code: RefErrorCode,
    public readonly refName?: string
  ) {
    super(message)
    this.name = 'RefError'
  }
}

export type RefErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_NAME'
  | 'LOCKED'
  | 'CONFLICT'
  | 'CIRCULAR_REF'
  | 'MAX_DEPTH_EXCEEDED'
  | 'INVALID_SHA'

/**
 * Lock handle for ref updates
 */
export interface RefLock {
  /** The ref being locked */
  refName: string
  /** Release the lock */
  release(): Promise<void>
  /** Check if lock is still held */
  isHeld(): boolean
}

/**
 * Storage backend interface for refs
 */
export interface RefStorageBackend {
  /** Read a single ref */
  readRef(name: string): Promise<Ref | null>
  /** Write a ref */
  writeRef(ref: Ref): Promise<void>
  /** Delete a ref */
  deleteRef(name: string): Promise<boolean>
  /** List all refs matching a pattern */
  listRefs(pattern?: string): Promise<Ref[]>
  /** Acquire a lock on a ref */
  acquireLock(name: string, timeout?: number): Promise<RefLock>
  /** Read packed refs */
  readPackedRefs(): Promise<Map<string, string>>
  /** Write packed refs */
  writePackedRefs(refs: Map<string, string>): Promise<void>
}

/**
 * Validate a ref name according to Git rules
 * See: https://git-scm.com/docs/git-check-ref-format
 */
export function isValidRefName(name: string): boolean {
  // HEAD is always valid
  if (name === 'HEAD') {
    return true
  }

  // Just @ is invalid
  if (name === '@') {
    return false
  }

  // Cannot be empty
  if (!name || name.length === 0) {
    return false
  }

  // Cannot end with /
  if (name.endsWith('/')) {
    return false
  }

  // Cannot end with .lock
  if (name.endsWith('.lock')) {
    return false
  }

  // Cannot contain @{
  if (name.includes('@{')) {
    return false
  }

  // Cannot contain ..
  if (name.includes('..')) {
    return false
  }

  // Cannot contain control characters (ASCII 0-31), space, ~, ^, :, ?, *, [, \
  const invalidChars = /[\x00-\x1f\x7f ~^:?*[\]\\]/
  if (invalidChars.test(name)) {
    return false
  }

  // Split into components and check each
  const components = name.split('/')
  for (const component of components) {
    // Cannot have empty components (// in path)
    if (component.length === 0) {
      return false
    }
    // Cannot start with .
    if (component.startsWith('.')) {
      return false
    }
    // Cannot end with .
    if (component.endsWith('.')) {
      return false
    }
  }

  return true
}

/**
 * Validate a SHA-1 hash
 */
export function isValidSha(sha: string): boolean {
  // Must be exactly 40 characters
  if (!sha || sha.length !== 40) {
    return false
  }
  // Must be valid hex
  return /^[0-9a-fA-F]{40}$/.test(sha)
}

/**
 * Parse a ref file content
 */
export function parseRefContent(content: string): { type: RefType; target: string } {
  const trimmed = content.trim()

  // Check for symbolic ref (starts with "ref:")
  if (trimmed.startsWith('ref:')) {
    const target = trimmed.slice(4).trim()
    return { type: 'symbolic', target }
  }

  // Otherwise it's a direct ref (SHA)
  return { type: 'direct', target: trimmed }
}

/**
 * Serialize a ref to file content
 */
export function serializeRefContent(ref: Ref): string {
  if (ref.type === 'symbolic') {
    return `ref: ${ref.target}\n`
  }
  return `${ref.target}\n`
}

/**
 * Parse packed-refs file content
 */
export function parsePackedRefs(content: string): Map<string, string> {
  const refs = new Map<string, string>()

  if (!content) {
    return refs
  }

  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) {
      continue
    }

    // Skip comment lines
    if (trimmed.startsWith('#')) {
      continue
    }

    // Skip peeled entries (lines starting with ^)
    if (trimmed.startsWith('^')) {
      continue
    }

    // Parse "sha refname" format
    const spaceIndex = trimmed.indexOf(' ')
    if (spaceIndex > 0) {
      const sha = trimmed.slice(0, spaceIndex)
      const refName = trimmed.slice(spaceIndex + 1)
      refs.set(refName, sha)
    }
  }

  return refs
}

/**
 * Serialize refs to packed-refs format
 */
export function serializePackedRefs(refs: Map<string, string>): string {
  const lines: string[] = ['# pack-refs with: peeled fully-peeled sorted']

  // Sort refs alphabetically
  const sortedRefs = Array.from(refs.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  for (const [refName, sha] of sortedRefs) {
    lines.push(`${sha} ${refName}`)
  }

  return lines.join('\n') + '\n'
}

/**
 * Ref storage implementation
 */
export class RefStorage {
  constructor(private backend: RefStorageBackend) {}

  /**
   * Get a ref by name
   */
  async getRef(name: string): Promise<Ref | null> {
    if (!this.backend.readRef) {
      throw new Error('Backend does not support readRef')
    }
    return this.backend.readRef(name)
  }

  /**
   * Resolve a ref to its final SHA target
   */
  async resolveRef(name: string, options?: ResolveRefOptions): Promise<ResolvedRef> {
    const maxDepth = options?.maxDepth ?? 10
    const chain: Ref[] = []
    const visited = new Set<string>()

    let currentName = name
    let ref: Ref | null = null

    for (let depth = 0; depth < maxDepth; depth++) {
      // Check for circular refs
      if (visited.has(currentName)) {
        throw new RefError(`Circular reference detected: ${currentName}`, 'CIRCULAR_REF', currentName)
      }
      visited.add(currentName)

      ref = await this.getRef(currentName)

      if (!ref) {
        throw new RefError(`Ref not found: ${currentName}`, 'NOT_FOUND', currentName)
      }

      chain.push(ref)

      // If it's a direct ref, we're done
      if (ref.type === 'direct') {
        return {
          ref: chain[0],
          sha: ref.target,
          chain
        }
      }

      // Follow symbolic ref
      currentName = ref.target
    }

    // Max depth exceeded
    throw new RefError(`Max ref resolution depth exceeded: ${maxDepth}`, 'MAX_DEPTH_EXCEEDED', name)
  }

  /**
   * Update or create a ref
   *
   * Note: For atomic operations, callers can acquire a lock via acquireLock()
   * and pass it via options.lock to avoid double-locking.
   */
  async updateRef(name: string, target: string, options?: UpdateRefOptions): Promise<Ref> {
    // Validate ref name
    if (!isValidRefName(name)) {
      throw new RefError(`Invalid ref name: ${name}`, 'INVALID_NAME', name)
    }

    // Validate SHA
    if (!isValidSha(target)) {
      throw new RefError(`Invalid SHA: ${target}`, 'INVALID_SHA', name)
    }

    // Use provided lock or acquire a new one
    const externalLock = options?.lock
    const lock = externalLock ?? await this.backend.acquireLock(name)

    try {
      const existingRef = await this.getRef(name)

      // Handle oldValue check (CAS - compare and swap)
      if (options?.oldValue !== undefined) {
        if (options.oldValue === null) {
          // Expect ref to NOT exist
          if (existingRef) {
            throw new RefError(`Ref already exists: ${name}`, 'ALREADY_EXISTS', name)
          }
        } else {
          // Expect ref to have specific value
          if (!existingRef || existingRef.target !== options.oldValue) {
            throw new RefError(`Ref value mismatch: ${name}`, 'CONFLICT', name)
          }
        }
      } else if (!options?.force && !options?.create && !existingRef) {
        // If not forcing and not creating, ref must exist
        throw new RefError(`Ref not found: ${name}`, 'NOT_FOUND', name)
      }

      const ref: Ref = {
        name,
        target,
        type: 'direct'
      }

      await this.backend.writeRef(ref)
      return ref
    } finally {
      // Only release lock if we acquired it ourselves
      if (!externalLock) {
        await lock.release()
      }
    }
  }

  /**
   * Delete a ref
   */
  async deleteRef(name: string, options?: UpdateRefOptions): Promise<boolean> {
    // Cannot delete HEAD
    if (name === 'HEAD') {
      throw new RefError('Cannot delete HEAD', 'INVALID_NAME', name)
    }

    // Validate ref name
    if (!isValidRefName(name)) {
      throw new RefError(`Invalid ref name: ${name}`, 'INVALID_NAME', name)
    }

    const existingRef = await this.getRef(name)

    // Check oldValue if provided
    if (options?.oldValue !== undefined && options.oldValue !== null) {
      if (!existingRef || existingRef.target !== options.oldValue) {
        throw new RefError(`Ref value mismatch: ${name}`, 'CONFLICT', name)
      }
    }

    if (!existingRef) {
      return false
    }

    return this.backend.deleteRef(name)
  }

  /**
   * List refs matching a pattern
   */
  async listRefs(options?: ListRefsOptions): Promise<Ref[]> {
    let refs = await this.backend.listRefs(options?.pattern)

    // Filter out HEAD unless explicitly requested
    if (!options?.includeHead) {
      refs = refs.filter(r => r.name !== 'HEAD')
    } else {
      // If includeHead is true, make sure HEAD is in the list
      const hasHead = refs.some(r => r.name === 'HEAD')
      if (!hasHead) {
        const head = await this.getRef('HEAD')
        if (head) {
          refs = [head, ...refs]
        }
      }
    }

    // Filter symbolic refs unless requested
    // Note: Always keep HEAD if includeHead is true, regardless of includeSymbolic
    if (!options?.includeSymbolic) {
      refs = refs.filter(r => r.type !== 'symbolic' || (options?.includeHead && r.name === 'HEAD'))
    }

    return refs
  }

  /**
   * List all branches
   */
  async listBranches(): Promise<Ref[]> {
    return this.listRefs({ pattern: 'refs/heads/*' })
  }

  /**
   * List all tags
   */
  async listTags(): Promise<Ref[]> {
    return this.listRefs({ pattern: 'refs/tags/*' })
  }

  /**
   * Get HEAD ref
   */
  async getHead(): Promise<Ref> {
    const head = await this.getRef('HEAD')
    if (!head) {
      throw new RefError('HEAD not found', 'NOT_FOUND', 'HEAD')
    }
    return head
  }

  /**
   * Update HEAD (can be symbolic or detached)
   */
  async updateHead(target: string, symbolic?: boolean): Promise<Ref> {
    const ref: Ref = {
      name: 'HEAD',
      target,
      type: symbolic ? 'symbolic' : 'direct'
    }

    await this.backend.writeRef(ref)
    return ref
  }

  /**
   * Check if HEAD is detached
   */
  async isHeadDetached(): Promise<boolean> {
    const head = await this.getHead()
    return head.type === 'direct'
  }

  /**
   * Create a symbolic ref
   */
  async createSymbolicRef(name: string, target: string): Promise<Ref> {
    // Validate ref name
    if (!isValidRefName(name)) {
      throw new RefError(`Invalid ref name: ${name}`, 'INVALID_NAME', name)
    }

    // Cannot point to itself
    if (name === target) {
      throw new RefError(`Symbolic ref cannot point to itself: ${name}`, 'CIRCULAR_REF', name)
    }

    const ref: Ref = {
      name,
      target,
      type: 'symbolic'
    }

    await this.backend.writeRef(ref)
    return ref
  }

  /**
   * Acquire a lock for updating a ref
   */
  async acquireLock(name: string, timeout?: number): Promise<RefLock> {
    return this.backend.acquireLock(name, timeout)
  }

  /**
   * Pack loose refs into packed-refs file
   */
  async packRefs(): Promise<void> {
    const allRefs = await this.backend.listRefs()
    const packed = new Map<string, string>()

    for (const ref of allRefs) {
      // Don't pack HEAD
      if (ref.name === 'HEAD') {
        continue
      }

      // Don't pack symbolic refs
      if (ref.type === 'symbolic') {
        continue
      }

      packed.set(ref.name, ref.target)
    }

    await this.backend.writePackedRefs(packed)
  }
}

/**
 * Resolve a ref to its final SHA target (convenience function)
 */
export async function resolveRef(
  storage: RefStorage,
  name: string,
  options?: ResolveRefOptions
): Promise<string> {
  const resolved = await storage.resolveRef(name, options)
  return resolved.sha
}

/**
 * Update a ref (convenience function)
 */
export async function updateRef(
  storage: RefStorage,
  name: string,
  target: string,
  options?: UpdateRefOptions
): Promise<Ref> {
  return storage.updateRef(name, target, options)
}

/**
 * Delete a ref (convenience function)
 */
export async function deleteRef(
  storage: RefStorage,
  name: string,
  options?: UpdateRefOptions
): Promise<boolean> {
  return storage.deleteRef(name, options)
}

/**
 * List refs (convenience function)
 */
export async function listRefs(
  storage: RefStorage,
  options?: ListRefsOptions
): Promise<Ref[]> {
  return storage.listRefs(options)
}
