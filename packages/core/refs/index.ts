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
  constructor(message: string) {
    super(message)
    this.name = 'RefValidationError'
  }
}

/** Base error for resolution failures */
export class ResolutionError extends Error {
  public partialChain?: string[] | undefined

  constructor(message: string, partialChain?: string[]) {
    super(message)
    this.name = 'ResolutionError'
    this.partialChain = partialChain
  }
}

/** Error when ref not found */
export class RefNotFoundError extends ResolutionError {
  constructor(refName: string, partialChain?: string[]) {
    super(`Ref not found: ${refName}`, partialChain)
    this.name = 'RefNotFoundError'
  }
}

/** Error when circular ref detected */
export class CircularRefError extends ResolutionError {
  constructor(chain: string[]) {
    super(`Circular ref detected: ${chain.join(' -> ')}`, chain)
    this.name = 'CircularRefError'
  }
}

/** Error when max resolution depth exceeded */
export class MaxDepthExceededError extends ResolutionError {
  constructor(chain: string[], maxDepth: number) {
    super(`Max ref resolution depth exceeded (${maxDepth})`, chain)
    this.name = 'MaxDepthExceededError'
  }
}

/** Error for ref locking issues */
export class RefLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefLockError'
  }
}

/** Error when lock acquisition times out */
export class LockTimeoutError extends RefLockError {
  constructor(refName: string) {
    super(`Lock acquisition timed out for: ${refName}`)
    this.name = 'LockTimeoutError'
  }
}

/** Error when lock is stale */
export class StaleLockError extends RefLockError {
  constructor(refName: string) {
    super(`Stale lock detected for: ${refName}`)
    this.name = 'StaleLockError'
  }
}

// =============================================================================
// Types
// =============================================================================

/** Symbolic ref (points to another ref) */
export interface SymbolicRef {
  type: 'symbolic'
  target: string
}

/** Direct ref (points to a SHA) */
export interface DirectRef {
  type: 'direct'
  sha: string
}

/** Union of ref types */
export type Ref = SymbolicRef | DirectRef

/** Ref kind enumeration */
export enum RefKind {
  Head = 'head',
  Branch = 'branch',
  Tag = 'tag',
  Remote = 'remote',
  Notes = 'notes',
  Stash = 'stash',
  Other = 'other',
}

/** Packed refs entry */
export interface PackedRefsEntry {
  sha: string
  peeledSha?: string
}

/** Packed refs file */
export interface PackedRefs {
  entries: Map<string, string>
  peeledEntries: Map<string, string>
  traits: string[]
}

/** Resolved ref result */
export interface ResolvedRef {
  finalSha: string
  chain: string[]
}

/** Refspec */
export interface Refspec {
  source: string
  destination: string
  force: boolean
  hasWildcard: boolean
}

/** Ref pattern for matching */
export interface RefPattern {
  prefix: string
  isWildcard: boolean
}

/** Peeled ref (dereferenced tag) */
export interface PeeledRef {
  sha: string
  peeledSha?: string
}

/** HEAD state (attached or detached) */
export interface HeadState {
  attached: boolean
  branch?: string
  sha?: string
}

/** Ref lock */
export interface RefLock {
  refName: string
  owner?: string | undefined
  isHeld(): boolean
}

/** Lock backend interface */
export interface LockBackend {
  createLock(name: string, owner?: string): Promise<boolean>
  removeLock(name: string): Promise<void>
  checkLock?(name: string): Promise<boolean>
  getLockAge?(name: string): Promise<number>
  breakLock?(name: string): Promise<boolean>
}

// =============================================================================
// Ref Name Validation
// =============================================================================

const SHA_REGEX = /^[0-9a-fA-F]{40}$/
const SPECIAL_HEADS = [
  'HEAD',
  'FETCH_HEAD',
  'ORIG_HEAD',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_HEAD',
]

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
export function isValidRefName(name: string): boolean {
  if (!name || name.length === 0) return false

  // Single @ is invalid
  if (name === '@') return false

  // Special HEADs are valid
  if (SPECIAL_HEADS.includes(name)) return true

  // Check for consecutive dots
  if (name.includes('..')) return false

  // Check for @{
  if (name.includes('@{')) return false

  // Check for invalid characters
  const invalidChars = /[\x00-\x1f\x7f ~^:?*\[\\]/
  if (invalidChars.test(name)) return false

  // Split into components
  const components = name.split('/')

  // Cannot start or end with slash (empty first/last component)
  if (components[0] === '' || components[components.length - 1] === '') {
    return false
  }

  for (const component of components) {
    // Empty component (consecutive slashes)
    if (component === '') return false

    // Cannot start with dot
    if (component.startsWith('.')) return false

    // Cannot end with dot
    if (component.endsWith('.')) return false

    // Cannot end with .lock
    if (component.endsWith('.lock')) return false
  }

  return true
}

/**
 * Validate a ref name, throwing on invalid.
 */
export function validateRefName(name: string): boolean {
  if (!isValidRefName(name)) {
    let reason = 'invalid ref name'

    if (name.includes('..')) reason = 'contains consecutive dots (..)'
    else if (name.includes('@{')) reason = 'contains @{'
    else if (name === '@') reason = 'bare @ is not allowed'
    else if (name.endsWith('.lock')) reason = 'ends with .lock'
    else if (name.includes('//')) reason = 'contains empty component'
    else if (/[\x00-\x1f\x7f ~^:?*\[\\]/.test(name)) reason = 'contains invalid character'

    throw new RefValidationError(`Invalid ref name "${name}": ${reason}`)
  }
  return true
}

/**
 * Check if a branch name is valid (short name, not full ref path).
 */
export function isValidBranchName(name: string): boolean {
  if (!name) return false

  // Cannot look like a full ref path
  if (name.startsWith('refs/')) return false

  // Cannot be HEAD
  if (name === 'HEAD') return false

  // Cannot start with dash
  if (name.startsWith('-')) return false

  // Use general ref validation for the rest
  return isValidRefName(`refs/heads/${name}`)
}

/**
 * Check if a tag name is valid (short name, not full ref path).
 */
export function isValidTagName(name: string): boolean {
  if (!name) return false

  // Cannot look like a full ref path
  if (name.startsWith('refs/')) return false

  // Use general ref validation
  return isValidRefName(`refs/tags/${name}`)
}

/**
 * Check if a remote name is valid.
 */
export function isValidRemoteName(name: string): boolean {
  if (!name) return false

  // Cannot contain slashes
  if (name.includes('/')) return false

  // Use general ref validation
  return isValidRefName(`refs/remotes/${name}`)
}

// =============================================================================
// Symbolic Refs
// =============================================================================

/**
 * Parse a symbolic ref file content.
 */
export function parseSymbolicRef(content: string): SymbolicRef {
  const trimmed = content.trim().replace(/\r\n/g, '\n').replace(/\n$/, '')

  if (!trimmed.startsWith('ref: ')) {
    throw new Error(`Invalid symbolic ref format: "${content}"`)
  }

  const target = trimmed.slice(5).trim()

  if (!target) {
    throw new Error('Empty symbolic ref target')
  }

  return { type: 'symbolic', target }
}

/**
 * Serialize a symbolic ref to file content.
 */
export function serializeSymbolicRef(ref: SymbolicRef): string {
  return `ref: ${ref.target}\n`
}

/**
 * Check if a ref is symbolic.
 */
export function isSymbolicRef(ref: Ref): ref is SymbolicRef {
  return ref.type === 'symbolic'
}

/**
 * Get the target of a symbolic ref, or null if direct.
 */
export function getSymbolicTarget(ref: Ref): string | null {
  return isSymbolicRef(ref) ? ref.target : null
}

// =============================================================================
// Direct Refs
// =============================================================================

/**
 * Parse a direct ref file content (SHA hash).
 */
export function parseDirectRef(content: string): DirectRef {
  const trimmed = content.trim()

  // Check if it looks like a symbolic ref
  if (trimmed.startsWith('ref:')) {
    throw new Error('Content appears to be a symbolic ref, not direct')
  }

  if (!SHA_REGEX.test(trimmed)) {
    throw new Error(`Invalid SHA hash: "${trimmed}"`)
  }

  return { type: 'direct', sha: trimmed.toLowerCase() }
}

/**
 * Serialize a direct ref to file content.
 */
export function serializeDirectRef(ref: DirectRef): string {
  return `${ref.sha.toLowerCase()}\n`
}

/**
 * Check if a ref is direct.
 */
export function isDirectRef(ref: Ref): ref is DirectRef {
  return ref.type === 'direct'
}

// =============================================================================
// Ref Type Classification
// =============================================================================

/**
 * Get the kind of a ref from its name.
 */
export function getRefKind(refName: string): RefKind {
  if (SPECIAL_HEADS.includes(refName)) return RefKind.Head

  if (refName.startsWith('refs/heads/')) return RefKind.Branch
  if (refName.startsWith('refs/tags/')) return RefKind.Tag
  if (refName.startsWith('refs/remotes/')) return RefKind.Remote
  if (refName.startsWith('refs/notes/')) return RefKind.Notes
  if (refName === 'refs/stash') return RefKind.Stash

  return RefKind.Other
}

/**
 * Check if a ref is a HEAD ref.
 */
export function isHeadRef(refName: string): boolean {
  return SPECIAL_HEADS.includes(refName)
}

/**
 * Check if a ref is a branch ref.
 */
export function isBranchRef(refName: string): boolean {
  return refName.startsWith('refs/heads/')
}

/**
 * Check if a ref is a tag ref.
 */
export function isTagRef(refName: string): boolean {
  return refName.startsWith('refs/tags/')
}

/**
 * Check if a ref is a remote ref.
 */
export function isRemoteRef(refName: string): boolean {
  return refName.startsWith('refs/remotes/')
}

/**
 * Check if a ref is a notes ref.
 */
export function isNotesRef(refName: string): boolean {
  return refName.startsWith('refs/notes/')
}

/**
 * Check if a ref is the stash ref.
 */
export function isStashRef(refName: string): boolean {
  return refName === 'refs/stash'
}

// =============================================================================
// Packed-refs File Format
// =============================================================================

/**
 * Parse a packed-refs file.
 */
export function parsePackedRefsFile(content: string): PackedRefs {
  const lines = content.split(/\r?\n/)
  const entries = new Map<string, string>()
  const peeledEntries = new Map<string, string>()
  const traits: string[] = []

  let lastRef: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines
    if (!trimmed) continue

    // Parse header for traits
    if (trimmed.startsWith('# pack-refs with:')) {
      const traitsStr = trimmed.slice(17).trim()
      traits.push(...traitsStr.split(/\s+/).filter(Boolean))
      continue
    }

    // Skip other comments
    if (trimmed.startsWith('#')) continue

    // Parse peeled entry (^SHA)
    if (trimmed.startsWith('^')) {
      if (!lastRef) {
        throw new Error('Orphaned peeled entry in packed-refs')
      }

      const sha = trimmed.slice(1)
      if (!SHA_REGEX.test(sha)) {
        throw new Error(`Invalid SHA in peeled entry: "${sha}"`)
      }

      peeledEntries.set(lastRef, sha.toLowerCase())
      continue
    }

    // Parse regular entry (SHA ref)
    const spaceIndex = trimmed.indexOf(' ')
    if (spaceIndex === -1) {
      throw new Error(`Malformed packed-refs entry: "${line}"`)
    }

    const sha = trimmed.slice(0, spaceIndex)
    const ref = trimmed.slice(spaceIndex + 1)

    if (!SHA_REGEX.test(sha)) {
      throw new Error(`Invalid SHA in packed-refs: "${sha}"`)
    }

    entries.set(ref, sha.toLowerCase())
    lastRef = ref
  }

  return { entries, peeledEntries, traits }
}

/**
 * Serialize a packed-refs file.
 */
export function serializePackedRefsFile(refs: PackedRefs): string {
  const lines: string[] = []

  // Header
  if (refs.traits.length > 0) {
    lines.push(`# pack-refs with: ${refs.traits.join(' ')}`)
  }

  // Sort entries alphabetically
  const sortedRefs = [...refs.entries.keys()].sort()

  for (const ref of sortedRefs) {
    const sha = refs.entries.get(ref)!
    lines.push(`${sha} ${ref}`)

    // Add peeled entry if present
    const peeled = refs.peeledEntries.get(ref)
    if (peeled) {
      lines.push(`^${peeled}`)
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * Get peeled target from packed refs.
 */
export function getPeeledTarget(refs: PackedRefs, refName: string): string | null {
  return refs.peeledEntries.get(refName) ?? null
}

/**
 * Check if a ref has a peeled entry.
 */
export function hasPeeledEntry(refs: PackedRefs, refName: string): boolean {
  return refs.peeledEntries.has(refName)
}

// =============================================================================
// Ref Resolution
// =============================================================================

type RefGetter = (name: string) => Promise<Ref | null>

/** Options for ref resolution */
export interface ResolveOptions {
  maxDepth?: number
}

/**
 * Resolve a ref through symbolic chains to a SHA.
 */
export async function resolveRefChain(
  refName: string,
  getRef: RefGetter,
  options?: ResolveOptions
): Promise<ResolvedRef> {
  const maxDepth = options?.maxDepth ?? 100
  const chain: string[] = []
  const visited = new Set<string>()

  let current = refName

  while (true) {
    // Check for circular refs
    if (visited.has(current)) {
      throw new CircularRefError([...chain, current])
    }

    // Check max depth
    if (chain.length >= maxDepth) {
      throw new MaxDepthExceededError(chain, maxDepth)
    }

    visited.add(current)
    chain.push(current)

    const ref = await getRef(current)

    if (!ref) {
      throw new RefNotFoundError(current, chain.slice(0, -1))
    }

    if (isDirectRef(ref)) {
      return { finalSha: ref.sha, chain }
    }

    current = ref.target
  }
}

/**
 * Resolve a ref to its final SHA.
 */
export async function resolveToSha(
  refName: string,
  getRef: RefGetter,
  options?: ResolveOptions
): Promise<string> {
  const result = await resolveRefChain(refName, getRef, options)
  return result.finalSha
}

// =============================================================================
// Refspec Parsing
// =============================================================================

/**
 * Parse a refspec string.
 */
export function parseRefspec(refspec: string): Refspec {
  let force = false
  let spec = refspec

  // Check for force prefix
  if (spec.startsWith('+')) {
    force = true
    spec = spec.slice(1)
  }

  // Split on colon
  const colons = (spec.match(/:/g) || []).length
  if (colons > 1) {
    throw new Error(`Invalid refspec: multiple colons in "${refspec}"`)
  }

  const colonIndex = spec.indexOf(':')
  let source: string
  let destination: string

  if (colonIndex === -1) {
    source = spec
    destination = ''
  } else {
    source = spec.slice(0, colonIndex)
    destination = spec.slice(colonIndex + 1)
  }

  // Check for wildcards
  const sourceWildcard = source.includes('*')
  const destWildcard = destination.includes('*')

  if (sourceWildcard !== destWildcard && destination !== '') {
    throw new Error(`Mismatched wildcards in refspec: "${refspec}"`)
  }

  // Check for multiple wildcards
  if (source.split('*').length > 2 || destination.split('*').length > 2) {
    throw new Error(`Multiple wildcards not allowed in refspec: "${refspec}"`)
  }

  return {
    source,
    destination,
    force,
    hasWildcard: sourceWildcard,
  }
}

/**
 * Serialize a refspec to string.
 */
export function serializeRefspec(refspec: Refspec): string {
  let result = ''
  if (refspec.force) result += '+'
  result += refspec.source
  if (refspec.destination) {
    result += ':' + refspec.destination
  }
  return result
}

/**
 * Check if a refspec is forced.
 */
export function isForceRefspec(refspec: Refspec): boolean {
  return refspec.force
}

/**
 * Get the source of a refspec.
 */
export function getRefspecSource(refspec: Refspec): string {
  return refspec.source
}

/**
 * Get the destination of a refspec.
 */
export function getRefspecDestination(refspec: Refspec): string {
  return refspec.destination
}

/**
 * Check if a ref matches a refspec.
 */
export function matchRefspec(refspec: Refspec, ref: string): boolean {
  if (!refspec.hasWildcard) {
    return refspec.source === ref
  }

  const pattern = refspec.source.replace('*', '')
  return ref.startsWith(pattern)
}

/**
 * Expand a refspec for a specific ref.
 */
export function expandRefspec(
  refspec: Refspec,
  ref: string
): { source: string; destination: string } {
  if (!matchRefspec(refspec, ref)) {
    throw new Error(`Ref "${ref}" does not match refspec "${serializeRefspec(refspec)}"`)
  }

  if (!refspec.hasWildcard) {
    return { source: refspec.source, destination: refspec.destination }
  }

  const prefix = refspec.source.replace('*', '')
  const match = ref.slice(prefix.length)
  const destPrefix = refspec.destination.replace('*', '')

  return {
    source: ref,
    destination: destPrefix + match,
  }
}

// =============================================================================
// Ref Patterns/Globs
// =============================================================================

/**
 * Parse a ref pattern.
 */
export function parseRefPattern(pattern: string): RefPattern {
  const wildcardIndex = pattern.indexOf('*')

  if (wildcardIndex === -1) {
    return { prefix: pattern, isWildcard: false }
  }

  return {
    prefix: pattern.slice(0, wildcardIndex),
    isWildcard: true,
  }
}

/**
 * Match a ref against a pattern.
 */
export function matchRefPattern(pattern: RefPattern, ref: string): boolean {
  if (!pattern.isWildcard) {
    return pattern.prefix === ref
  }

  return ref.startsWith(pattern.prefix)
}

/**
 * Expand a pattern to matching refs.
 */
export function expandRefPattern(pattern: RefPattern, refs: string[]): string[] {
  return refs.filter((ref) => matchRefPattern(pattern, ref))
}

/**
 * Check if a pattern string is a wildcard.
 */
export function isWildcardPattern(pattern: string): boolean {
  return pattern.includes('*')
}

// =============================================================================
// Peeled Refs
// =============================================================================

type ObjectGetter = (sha: string) => Promise<{ type: string; target?: string; tree?: string } | null>

/** Options for peeling */
export interface PeelOptions {
  target?: 'commit' | 'tree'
}

/**
 * Peel a ref to its target commit/tree.
 */
export async function peelRef(
  sha: string,
  getObject: ObjectGetter,
  options?: PeelOptions
): Promise<string> {
  const targetType = options?.target ?? 'commit'
  let current = sha

  while (true) {
    const obj = await getObject(current)

    if (!obj) {
      throw new Error(`Object not found: ${current}`)
    }

    if (obj.type === targetType) {
      return current
    }

    if (obj.type === 'tag' && obj.target) {
      current = obj.target
      continue
    }

    if (obj.type === 'commit' && targetType === 'tree' && obj.tree) {
      return obj.tree
    }

    throw new Error(`Cannot peel ${obj.type} to ${targetType}`)
  }
}

/**
 * Check if a ref name is a peeled ref (ends with ^{}).
 */
export function isPeeledRef(refName: string): boolean {
  return refName.endsWith('^{}')
}

/**
 * Get cached peeled SHA.
 */
export function getPeeledSha(cache: Map<string, string>, refName: string): string | null {
  return cache.get(refName) ?? null
}

// =============================================================================
// HEAD Detached State
// =============================================================================

/**
 * Get the current HEAD state.
 */
export async function getHeadState(getRef: RefGetter): Promise<HeadState> {
  const headRef = await getRef('HEAD')

  if (!headRef) {
    throw new Error('HEAD not found')
  }

  if (isDirectRef(headRef)) {
    return { attached: false, sha: headRef.sha }
  }

  // Attached to a branch
  const branch = headRef.target

  // Try to resolve the branch
  try {
    const branchRef = await getRef(branch)
    if (branchRef && isDirectRef(branchRef)) {
      return { attached: true, branch, sha: branchRef.sha }
    }
  } catch {
    // Branch might not exist yet (new repo)
  }

  return { attached: true, branch }
}

/**
 * Check if HEAD is detached.
 */
export function isDetachedHead(state: HeadState): boolean {
  return !state.attached
}

/**
 * Get SHA when HEAD is detached.
 */
export function getDetachedSha(state: HeadState): string | null {
  return state.attached ? null : state.sha ?? null
}

/**
 * Get the attached branch.
 */
export function getAttachedBranch(
  state: HeadState,
  options?: { stripPrefix?: boolean }
): string | null {
  if (!state.attached || !state.branch) return null

  if (options?.stripPrefix && state.branch.startsWith('refs/heads/')) {
    return state.branch.slice(11)
  }

  return state.branch
}

// =============================================================================
// Ref Locking
// =============================================================================

class RefLockImpl implements RefLock {
  private held = true

  constructor(
    public readonly refName: string,
    public readonly owner?: string,
    private readonly backend?: LockBackend
  ) {}

  isHeld(): boolean {
    return this.held
  }

  async release(): Promise<void> {
    if (this.held && this.backend) {
      await this.backend.removeLock(this.refName)
    }
    this.held = false
  }
}

/** Lock acquisition options */
export interface LockOptions {
  timeout?: number
  retryInterval?: number
  owner?: string
  staleThreshold?: number
  breakStale?: boolean
}

/**
 * Acquire a lock on a ref.
 */
export async function acquireRefLock(
  refName: string,
  backend: LockBackend,
  options?: LockOptions
): Promise<RefLock> {
  const timeout = options?.timeout ?? 0
  const retryInterval = options?.retryInterval ?? 100
  const owner = options?.owner
  const staleThreshold = options?.staleThreshold
  const breakStale = options?.breakStale ?? false

  const startTime = Date.now()

  while (true) {
    const acquired = await backend.createLock(refName, owner)

    if (acquired) {
      return new RefLockImpl(refName, owner, backend)
    }

    // Check for stale lock
    if (staleThreshold && backend.getLockAge) {
      const age = await backend.getLockAge(refName)

      if (age > staleThreshold) {
        if (breakStale && backend.breakLock) {
          const broken = await backend.breakLock(refName)
          if (broken) {
            continue // Try again
          }
        }
        throw new StaleLockError(refName)
      }
    }

    // Check timeout
    if (timeout === 0) {
      throw new RefLockError(`Failed to acquire lock: ${refName}`)
    }

    const elapsed = Date.now() - startTime
    if (elapsed >= timeout) {
      throw new LockTimeoutError(refName)
    }

    // Wait and retry
    await new Promise((resolve) => setTimeout(resolve, retryInterval))
  }
}

/**
 * Release a ref lock.
 */
export async function releaseRefLock(lock: RefLock): Promise<void> {
  if (lock instanceof RefLockImpl) {
    await lock.release()
  }
}

/**
 * Check if a ref is locked.
 */
export async function isRefLocked(
  refName: string,
  backend: { checkLock?: (name: string) => Promise<boolean> }
): Promise<boolean> {
  if (backend.checkLock) {
    return backend.checkLock(refName)
  }
  return false
}

// =============================================================================
// Reflog Types and Implementation
// =============================================================================

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
  oldSha: string
  /** SHA after the change (zero SHA for deletion) */
  newSha: string
  /** Committer/author identity */
  committer: {
    name: string
    email: string
  }
  /** Unix timestamp of the change */
  timestamp: number
  /** Timezone offset in minutes */
  timezoneOffset: number
  /** Message describing the change (e.g., "commit: Initial commit") */
  message: string
}

/**
 * Zero SHA used for ref creation/deletion in reflog.
 */
export const ZERO_SHA = '0000000000000000000000000000000000000000'

/**
 * Parse a single reflog line.
 *
 * Format: <old-sha> <new-sha> <committer> <timestamp> <tz> <tab><message>
 * Example: abc123... def456... John Doe <john@example.com> 1234567890 -0500	commit: message
 */
export function parseReflogLine(line: string): ReflogEntry | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  // Match: oldSha newSha name <email> timestamp tz\tmessage
  const match = trimmed.match(
    /^([0-9a-f]{40})\s+([0-9a-f]{40})\s+(.+?)\s+<([^>]+)>\s+(\d+)\s+([+-]\d{4})\t(.*)$/
  )

  if (!match) {
    // Try alternate format without tab (some implementations)
    const altMatch = trimmed.match(
      /^([0-9a-f]{40})\s+([0-9a-f]{40})\s+(.+?)\s+<([^>]+)>\s+(\d+)\s+([+-]\d{4})\s+(.*)$/
    )
    if (!altMatch) return null

    const [, oldSha, newSha, name, email, ts, tz, message] = altMatch
    // These are guaranteed to exist by the regex match
    if (!oldSha || !newSha || !name || !email || !ts || !tz || message === undefined) return null
    return {
      oldSha: oldSha.toLowerCase(),
      newSha: newSha.toLowerCase(),
      committer: { name, email },
      timestamp: parseInt(ts, 10),
      timezoneOffset: parseTimezoneOffset(tz),
      message,
    }
  }

  const [, oldSha, newSha, name, email, ts, tz, message] = match
  // These are guaranteed to exist by the regex match
  if (!oldSha || !newSha || !name || !email || !ts || !tz || message === undefined) return null
  return {
    oldSha: oldSha.toLowerCase(),
    newSha: newSha.toLowerCase(),
    committer: { name, email },
    timestamp: parseInt(ts, 10),
    timezoneOffset: parseTimezoneOffset(tz),
    message,
  }
}

/**
 * Parse timezone offset string (+0500 or -0800) to minutes.
 */
function parseTimezoneOffset(tz: string): number {
  const sign = tz.startsWith('-') ? -1 : 1
  const hours = parseInt(tz.slice(1, 3), 10)
  const minutes = parseInt(tz.slice(3, 5), 10)
  return sign * (hours * 60 + minutes)
}

/**
 * Format timezone offset in minutes to string (+0500 or -0800).
 */
function formatTimezoneOffset(offset: number): string {
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60
  return `${sign}${hours.toString().padStart(2, '0')}${minutes.toString().padStart(2, '0')}`
}

/**
 * Serialize a reflog entry to a line.
 */
export function serializeReflogEntry(entry: ReflogEntry): string {
  const { oldSha, newSha, committer, timestamp, timezoneOffset, message } = entry
  const tz = formatTimezoneOffset(timezoneOffset)
  return `${oldSha} ${newSha} ${committer.name} <${committer.email}> ${timestamp} ${tz}\t${message}\n`
}

/**
 * Parse a complete reflog file.
 *
 * Returns entries in reverse chronological order (newest first),
 * which is the standard Git reflog display order.
 */
export function parseReflogFile(content: string): ReflogEntry[] {
  const lines = content.split(/\r?\n/)
  const entries: ReflogEntry[] = []

  for (const line of lines) {
    const entry = parseReflogLine(line)
    if (entry) {
      entries.push(entry)
    }
  }

  // Return in reverse order (newest first) for display
  return entries.reverse()
}

/**
 * Serialize reflog entries to file content.
 *
 * Entries should be in chronological order (oldest first) for storage.
 */
export function serializeReflogFile(entries: ReflogEntry[]): string {
  // Store in chronological order (oldest first)
  return entries.map(serializeReflogEntry).join('')
}

/**
 * Create a reflog entry for a ref update.
 *
 * @param oldSha - Previous SHA (use ZERO_SHA for creation)
 * @param newSha - New SHA (use ZERO_SHA for deletion)
 * @param committer - Who made the change
 * @param message - Description of the change
 */
export function createReflogEntry(
  oldSha: string,
  newSha: string,
  committer: { name: string; email: string },
  message: string
): ReflogEntry {
  const now = new Date()
  return {
    oldSha: oldSha.toLowerCase(),
    newSha: newSha.toLowerCase(),
    committer,
    timestamp: Math.floor(now.getTime() / 1000),
    timezoneOffset: -now.getTimezoneOffset(), // Note: getTimezoneOffset returns opposite sign
    message,
  }
}

/**
 * Reflog backend interface for storing reflog entries.
 */
export interface ReflogBackend {
  /**
   * Append an entry to a ref's reflog.
   */
  appendEntry(refName: string, entry: ReflogEntry): Promise<void>

  /**
   * Read all entries from a ref's reflog.
   * Returns entries in reverse chronological order (newest first).
   */
  readEntries(refName: string): Promise<ReflogEntry[]>

  /**
   * Delete a reflog for a ref.
   */
  deleteReflog(refName: string): Promise<void>

  /**
   * Check if a reflog exists for a ref.
   */
  reflogExists(refName: string): Promise<boolean>
}

/**
 * In-memory reflog backend for testing and simple use cases.
 */
export class InMemoryReflogBackend implements ReflogBackend {
  private reflogs = new Map<string, ReflogEntry[]>()

  async appendEntry(refName: string, entry: ReflogEntry): Promise<void> {
    const entries = this.reflogs.get(refName) ?? []
    entries.push(entry)
    this.reflogs.set(refName, entries)
  }

  async readEntries(refName: string): Promise<ReflogEntry[]> {
    const entries = this.reflogs.get(refName) ?? []
    // Return in reverse chronological order (newest first)
    return [...entries].reverse()
  }

  async deleteReflog(refName: string): Promise<void> {
    this.reflogs.delete(refName)
  }

  async reflogExists(refName: string): Promise<boolean> {
    return this.reflogs.has(refName) && (this.reflogs.get(refName)?.length ?? 0) > 0
  }

  /**
   * Get raw entries in chronological order (for testing).
   */
  getRawEntries(refName: string): ReflogEntry[] {
    return [...(this.reflogs.get(refName) ?? [])]
  }

  /**
   * Clear all reflogs (for testing).
   */
  clear(): void {
    this.reflogs.clear()
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
  constructor(
    private backend: ReflogBackend,
    private defaultCommitter: { name: string; email: string } = {
      name: 'Unknown',
      email: 'unknown@unknown',
    }
  ) {}

  /**
   * Record a ref update in the reflog.
   *
   * @param refName - The ref being updated (e.g., 'HEAD', 'refs/heads/main')
   * @param oldSha - Previous SHA (use ZERO_SHA for creation)
   * @param newSha - New SHA (use ZERO_SHA for deletion)
   * @param message - Description of the change
   * @param committer - Optional committer info (defaults to constructor default)
   */
  async recordUpdate(
    refName: string,
    oldSha: string,
    newSha: string,
    message: string,
    committer?: { name: string; email: string }
  ): Promise<void> {
    const entry = createReflogEntry(oldSha, newSha, committer ?? this.defaultCommitter, message)
    await this.backend.appendEntry(refName, entry)
  }

  /**
   * Record a HEAD update (convenience method).
   */
  async recordHeadUpdate(
    oldSha: string,
    newSha: string,
    message: string,
    committer?: { name: string; email: string }
  ): Promise<void> {
    await this.recordUpdate('HEAD', oldSha, newSha, message, committer)
  }

  /**
   * Get reflog history for a ref.
   *
   * @param refName - The ref to get history for
   * @param options - Optional limit and offset
   * @returns Entries in reverse chronological order (newest first)
   */
  async getHistory(
    refName: string,
    options?: { limit?: number; offset?: number }
  ): Promise<ReflogEntry[]> {
    let entries = await this.backend.readEntries(refName)

    if (options?.offset) {
      entries = entries.slice(options.offset)
    }

    if (options?.limit) {
      entries = entries.slice(0, options.limit)
    }

    return entries
  }

  /**
   * Get a specific reflog entry by index.
   *
   * @param refName - The ref to look up
   * @param index - Entry index (0 = newest, @{n} syntax)
   * @returns The entry or null if not found
   */
  async getEntry(refName: string, index: number): Promise<ReflogEntry | null> {
    const entries = await this.backend.readEntries(refName)
    return entries[index] ?? null
  }

  /**
   * Get the SHA at a specific reflog position.
   *
   * @param refName - The ref to look up
   * @param index - Entry index (0 = current, 1 = previous, etc.)
   * @returns The SHA or null if not found
   */
  async getShaAtIndex(refName: string, index: number): Promise<string | null> {
    const entry = await this.getEntry(refName, index)
    return entry?.newSha ?? null
  }

  /**
   * Delete reflog for a ref.
   */
  async deleteReflog(refName: string): Promise<void> {
    await this.backend.deleteReflog(refName)
  }

  /**
   * Check if a reflog exists for a ref.
   */
  async hasReflog(refName: string): Promise<boolean> {
    return this.backend.reflogExists(refName)
  }
}

// =============================================================================
// Atomic Ref Update Helpers
// =============================================================================

/**
 * Result of an atomic ref update.
 */
export interface AtomicUpdateResult {
  success: boolean
  oldSha: string | null
  newSha: string | null
  error?: string
}

/**
 * Command for a batch atomic ref update.
 *
 * This is used for the atomic update helpers in refs module.
 * Note: The protocol module has its own RefUpdateCommand for wire protocol.
 */
export interface AtomicRefUpdateCommand {
  refName: string
  oldSha: string | null  // null = don't care / create only
  newSha: string | null  // null = delete
  force?: boolean
}

/**
 * Validate an atomic update command.
 */
export function validateAtomicUpdateCommand(cmd: AtomicRefUpdateCommand): string | null {
  if (!isValidRefName(cmd.refName)) {
    return `Invalid ref name: ${cmd.refName}`
  }

  if (cmd.oldSha !== null && cmd.oldSha !== ZERO_SHA && !SHA_REGEX.test(cmd.oldSha)) {
    return `Invalid old SHA: ${cmd.oldSha}`
  }

  if (cmd.newSha !== null && cmd.newSha !== ZERO_SHA && !SHA_REGEX.test(cmd.newSha)) {
    return `Invalid new SHA: ${cmd.newSha}`
  }

  return null
}

/**
 * Compare-and-swap check for atomic updates.
 */
export function casCheck(expectedOld: string | null, actualOld: string | null): boolean {
  // null expectedOld means "don't care"
  if (expectedOld === null) return true

  // ZERO_SHA expected means ref should not exist
  if (expectedOld === ZERO_SHA) {
    return actualOld === null || actualOld === ZERO_SHA
  }

  // Otherwise must match exactly
  return actualOld?.toLowerCase() === expectedOld.toLowerCase()
}
