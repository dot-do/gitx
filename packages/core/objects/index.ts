/**
 * Git Object Model
 *
 * This module exports all Git object classes and utilities:
 * - GitBlob: File content storage
 * - GitTree: Directory structure
 * - GitCommit: Commit metadata and history
 * - GitTag: Annotated tags
 * - Hash utilities: SHA-1 calculation
 * - Loose object format: Zlib compression
 */

// =============================================================================
// Core Classes
// =============================================================================

export { GitBlob } from './blob'
export { GitTree, sortTreeEntries, parseTreeEntries, serializeTreeEntries } from './tree'
export {
  GitCommit,
  parseIdentity,
  formatIdentity,
  hasGpgSignature,
  parseGpgSignature,
  validateCommitData,
} from './commit'
export type {
  CommitValidationResult,
  CommitExtraHeaders,
  ExtendedCommitData,
} from './commit'
export { GitTag } from './tag'

// =============================================================================
// Types and Constants
// =============================================================================

export {
  OBJECT_TYPES,
  VALID_MODES,
  isValidSha,
  isValidMode,
  isValidObjectType,
  isValidIdentity,
  isValidTreeEntry,
  isBlobData,
  isTreeData,
  isCommitData,
  isTagData,
} from './types'
export type {
  ObjectType,
  GitObjectData,
  BlobData,
  TreeData,
  CommitData,
  TagData,
  GitIdentity,
  TreeEntry,
} from './types'

// =============================================================================
// Hash Utilities
// =============================================================================

export {
  calculateSha1,
  calculateObjectHash,
  createObjectHeader,
  parseObjectHeader,
  bytesToHex,
  hexToBytes,
} from './hash'

// =============================================================================
// Loose Object Format (Zlib Compression)
// =============================================================================

import pako from 'pako'
import { GitBlob } from './blob'
import { GitTree } from './tree'
import { GitCommit } from './commit'
import { GitTag } from './tag'
import { parseObjectHeader } from './hash'
import type { ObjectType } from './types'

/**
 * Compresses data using zlib deflate
 */
export async function compressObject(data: Uint8Array): Promise<Uint8Array> {
  return pako.deflate(data)
}

/**
 * Decompresses zlib-compressed data
 * @throws Error if decompression fails (invalid or truncated data)
 */
export async function decompressObject(data: Uint8Array): Promise<Uint8Array> {
  try {
    const result = pako.inflate(data)
    if (!result || result.length === 0) {
      throw new Error('Decompression produced empty result')
    }
    return result
  } catch (e) {
    throw new Error(`Failed to decompress object: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Prepares a Git object for writing as a loose object
 * @returns Object with path and compressed data
 */
export async function writeLooseObject(
  obj: GitBlob | GitTree | GitCommit | GitTag
): Promise<{ path: string; data: Uint8Array }> {
  const serialized = obj.serialize()
  const hash = await obj.hash()
  const compressed = await compressObject(serialized)

  // Path: objects/<first-2-chars>/<remaining-38-chars>
  const path = `objects/${hash.slice(0, 2)}/${hash.slice(2)}`

  return { path, data: compressed }
}

/**
 * Reads and parses a compressed loose object
 */
export async function readLooseObject(
  compressedData: Uint8Array
): Promise<GitBlob | GitTree | GitCommit | GitTag> {
  const decompressed = await decompressObject(compressedData)
  return parseGitObject(decompressed)
}

// =============================================================================
// Object Type Detection and Parsing
// =============================================================================

/**
 * Detects the object type from serialized data
 */
export function detectObjectType(data: Uint8Array): ObjectType {
  const { type } = parseObjectHeader(data)
  return type
}

/**
 * Parses any Git object from serialized format
 */
export function parseGitObject(data: Uint8Array): GitBlob | GitTree | GitCommit | GitTag {
  const type = detectObjectType(data)

  switch (type) {
    case 'blob':
      return GitBlob.parse(data)
    case 'tree':
      return GitTree.parse(data)
    case 'commit':
      return GitCommit.parse(data)
    case 'tag':
      return GitTag.parse(data)
  }
}

// =============================================================================
// Object Factory
// =============================================================================

import type { BlobData, TreeData, CommitData, TagData } from './types'
import { isBlobData, isTreeData, isCommitData, isTagData } from './types'

/**
 * Error thrown when createGitObject receives invalid data
 */
export class InvalidGitObjectDataError extends Error {
  constructor(
    public readonly objectType: ObjectType,
    public readonly data: unknown,
    message: string
  ) {
    super(message)
    this.name = 'InvalidGitObjectDataError'
  }
}

/**
 * Creates a Git object from type and data
 * @throws InvalidGitObjectDataError if the data doesn't match the expected type
 */
export function createGitObject(type: 'blob', data: BlobData): GitBlob
export function createGitObject(type: 'tree', data: TreeData): GitTree
export function createGitObject(type: 'commit', data: CommitData): GitCommit
export function createGitObject(type: 'tag', data: TagData): GitTag
export function createGitObject(
  type: ObjectType,
  data: BlobData | TreeData | CommitData | TagData
): GitBlob | GitTree | GitCommit | GitTag {
  switch (type) {
    case 'blob':
      if (!isBlobData(data)) {
        throw new InvalidGitObjectDataError(
          type,
          data,
          'Invalid blob data: expected object with content property as Uint8Array'
        )
      }
      return new GitBlob(data.content)
    case 'tree':
      if (!isTreeData(data)) {
        throw new InvalidGitObjectDataError(
          type,
          data,
          'Invalid tree data: expected object with entries array containing valid TreeEntry objects'
        )
      }
      return new GitTree(data.entries)
    case 'commit':
      if (!isCommitData(data)) {
        throw new InvalidGitObjectDataError(
          type,
          data,
          'Invalid commit data: expected object with tree (sha), author, committer (GitIdentity), and message'
        )
      }
      return new GitCommit(data)
    case 'tag':
      if (!isTagData(data)) {
        throw new InvalidGitObjectDataError(
          type,
          data,
          'Invalid tag data: expected object with object (sha), objectType, name, and message'
        )
      }
      return new GitTag(data)
  }
}
