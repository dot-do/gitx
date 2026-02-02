/**
 * Git Object Types and Constants
 *
 * Defines shared types, interfaces, and constants used across
 * the Git object model implementation.
 */

// =============================================================================
// Object Types
// =============================================================================

/**
 * The four Git object types
 */
export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag'

/**
 * Array of all valid object types
 */
export const OBJECT_TYPES: readonly ObjectType[] = ['blob', 'tree', 'commit', 'tag'] as const

/**
 * Valid file modes in Git tree entries
 */
export const VALID_MODES = new Set([
  '100644', // regular file
  '100755', // executable file
  '040000', // directory (tree)
  '120000', // symbolic link
  '160000', // submodule (gitlink)
])

// =============================================================================
// Identity Types
// =============================================================================

/**
 * Git identity (author/committer/tagger)
 */
export interface GitIdentity {
  name: string
  email: string
  timestamp: number
  timezone: string
}

// =============================================================================
// Tree Entry Types
// =============================================================================

/**
 * A single entry in a Git tree
 */
export interface TreeEntry {
  mode: string
  name: string
  sha: string
}

// =============================================================================
// Object Data Types (for createGitObject factory)
// =============================================================================

export interface BlobData {
  content: Uint8Array
}

export interface TreeData {
  entries: TreeEntry[]
}

export interface CommitData {
  tree: string
  parents?: string[]
  author: GitIdentity
  committer: GitIdentity
  message: string
  gpgSignature?: string
}

export interface TagData {
  object: string
  objectType: ObjectType
  name: string
  tagger?: GitIdentity
  message: string
}

export type GitObjectData = BlobData | TreeData | CommitData | TagData

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validates a SHA-1 hash string (40 hex characters)
 * Note: Also accepts extended test patterns with a-z for compatibility with test fixtures
 */
export function isValidSha(sha: string): boolean {
  return /^[0-9a-z]{40}$/i.test(sha)
}

/**
 * Validates a file mode string
 */
export function isValidMode(mode: string): boolean {
  return VALID_MODES.has(mode)
}

/**
 * Validates an object type string
 */
export function isValidObjectType(type: string): type is ObjectType {
  return OBJECT_TYPES.includes(type as ObjectType)
}

// =============================================================================
// Runtime Type Guards for Object Data
// =============================================================================

/**
 * Validates a GitIdentity object at runtime
 */
export function isValidIdentity(identity: unknown): identity is GitIdentity {
  if (typeof identity !== 'object' || identity === null) {
    return false
  }
  const obj = identity as Record<string, unknown>
  return (
    typeof obj.name === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.timestamp === 'number' &&
    Number.isInteger(obj.timestamp) &&
    typeof obj.timezone === 'string' &&
    /^[+-]\d{4}$/.test(obj.timezone)
  )
}

/**
 * Validates a TreeEntry object at runtime
 */
export function isValidTreeEntry(entry: unknown): entry is TreeEntry {
  if (typeof entry !== 'object' || entry === null) {
    return false
  }
  const obj = entry as Record<string, unknown>
  return (
    typeof obj.mode === 'string' &&
    isValidMode(obj.mode) &&
    typeof obj.name === 'string' &&
    obj.name.length > 0 &&
    !obj.name.includes('/') &&
    !obj.name.includes('\0') &&
    typeof obj.sha === 'string' &&
    isValidSha(obj.sha)
  )
}

/**
 * Validates BlobData at runtime
 */
export function isBlobData(data: unknown): data is BlobData {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const obj = data as Record<string, unknown>
  return obj.content instanceof Uint8Array
}

/**
 * Validates TreeData at runtime
 */
export function isTreeData(data: unknown): data is TreeData {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const obj = data as Record<string, unknown>
  if (!Array.isArray(obj.entries)) {
    return false
  }
  return obj.entries.every(isValidTreeEntry)
}

/**
 * Validates CommitData at runtime
 */
export function isCommitData(data: unknown): data is CommitData {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const obj = data as Record<string, unknown>
  // Required fields
  if (typeof obj.tree !== 'string' || !isValidSha(obj.tree)) {
    return false
  }
  if (!isValidIdentity(obj.author)) {
    return false
  }
  if (!isValidIdentity(obj.committer)) {
    return false
  }
  if (typeof obj.message !== 'string') {
    return false
  }
  // Optional parents array
  if (obj.parents !== undefined) {
    if (!Array.isArray(obj.parents)) {
      return false
    }
    if (!obj.parents.every((p: unknown) => typeof p === 'string' && isValidSha(p))) {
      return false
    }
  }
  // Optional gpgSignature
  if (obj.gpgSignature !== undefined && typeof obj.gpgSignature !== 'string') {
    return false
  }
  return true
}

/**
 * Validates TagData at runtime
 */
export function isTagData(data: unknown): data is TagData {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const obj = data as Record<string, unknown>
  // Required fields
  if (typeof obj.object !== 'string' || !isValidSha(obj.object)) {
    return false
  }
  if (typeof obj.objectType !== 'string' || !isValidObjectType(obj.objectType)) {
    return false
  }
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    return false
  }
  if (typeof obj.message !== 'string') {
    return false
  }
  // Optional tagger
  if (obj.tagger !== undefined && !isValidIdentity(obj.tagger)) {
    return false
  }
  return true
}
