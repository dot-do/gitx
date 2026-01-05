/**
 * Git Tag Operations
 *
 * Handles creation, deletion, and management of Git tags.
 * Supports both lightweight tags (refs pointing to commits)
 * and annotated tags (tag objects with metadata).
 */

import { Author, TagObject, ObjectType } from '../types/objects'
import { RefStorage, RefErrorCode } from './storage'

/**
 * Tag type discriminator
 */
export type TagType = 'lightweight' | 'annotated'

/**
 * Represents a Git tag (either lightweight or annotated)
 */
export interface Tag {
  /** Tag name (e.g., 'v1.0.0') */
  name: string
  /** Tag type */
  type: TagType
  /** Target SHA - for lightweight: commit SHA, for annotated: tag object SHA */
  sha: string
  /** For annotated tags: the commit/object the tag points to */
  targetSha?: string
  /** For annotated tags: the type of object being tagged */
  targetType?: ObjectType
  /** For annotated tags: the tagger information */
  tagger?: Author
  /** For annotated tags: the tag message */
  message?: string
  /** For annotated tags with GPG signature */
  signature?: string
}

/**
 * Options for creating a tag
 */
export interface CreateTagOptions {
  /** Create an annotated tag (default: false for lightweight) */
  annotated?: boolean
  /** Tag message (required for annotated tags) */
  message?: string
  /** Tagger information (defaults to configured user) */
  tagger?: Author
  /** Sign the tag with GPG */
  sign?: boolean
  /** GPG key ID to use for signing */
  keyId?: string
  /** Force overwrite if tag exists */
  force?: boolean
}

/**
 * Options for listing tags
 */
export interface ListTagsOptions {
  /** Pattern to filter tags (glob-like, e.g., 'v1.*') */
  pattern?: string
  /** Sort order: 'name' | 'version' | 'date' */
  sort?: 'name' | 'version' | 'date'
  /** Sort direction */
  sortDirection?: 'asc' | 'desc'
  /** Maximum number of tags to return */
  limit?: number
  /** Include annotated tag metadata */
  includeMetadata?: boolean
}

/**
 * Options for deleting a tag
 */
export interface DeleteTagOptions {
  /** Delete even if tag doesn't exist locally */
  force?: boolean
}

/**
 * Options for getting a tag
 */
export interface GetTagOptions {
  /** Resolve to get full annotated tag info */
  resolve?: boolean
}

/**
 * Result of tag signature verification
 */
export interface TagSignatureVerification {
  /** Whether the signature is valid */
  valid: boolean
  /** GPG key ID used for signing */
  keyId?: string
  /** Signer identity */
  signer?: string
  /** Trust level of the key */
  trustLevel?: 'ultimate' | 'full' | 'marginal' | 'never' | 'undefined' | 'expired' | 'unknown'
  /** Error message if verification failed */
  error?: string
}

/**
 * Error codes specific to tag operations
 */
export type TagErrorCode = RefErrorCode | 'TAG_EXISTS' | 'TAG_NOT_FOUND' | 'INVALID_TAG_NAME' | 'MESSAGE_REQUIRED' | 'GPG_ERROR'

/**
 * Error thrown when a tag operation fails
 */
export class TagError extends Error {
  constructor(
    message: string,
    public readonly code: TagErrorCode,
    public readonly tagName?: string
  ) {
    super(message)
    this.name = 'TagError'
  }
}

/**
 * Storage backend interface for tag objects
 */
export interface TagObjectStorage {
  /** Read a tag object by SHA */
  readTagObject(sha: string): Promise<TagObject | null>
  /** Write a tag object and return its SHA */
  writeTagObject(tag: Omit<TagObject, 'type' | 'data'>): Promise<string>
  /** Read any object to determine its type */
  readObjectType(sha: string): Promise<ObjectType | null>
}

/**
 * GPG signing interface
 */
export interface GPGSigner {
  /** Sign data and return the signature */
  sign(data: Uint8Array, keyId?: string): Promise<string>
  /** Verify a signature */
  verify(data: Uint8Array, signature: string): Promise<TagSignatureVerification>
}

/**
 * Tag manager for handling Git tag operations
 */
export class TagManager {
  constructor(
    refStorage: RefStorage,
    objectStorage: TagObjectStorage,
    gpgSigner?: GPGSigner
  ) {
    void refStorage // Suppress unused variable warning until implementation
    void objectStorage
    void gpgSigner
    // TODO: Implement in GREEN phase
  }

  /**
   * Create a new tag
   */
  async createTag(_name: string, _target: string, _options?: CreateTagOptions): Promise<Tag> {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented')
  }

  /**
   * Delete a tag
   */
  async deleteTag(_name: string, _options?: DeleteTagOptions): Promise<boolean> {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented')
  }

  /**
   * List all tags
   */
  async listTags(_options?: ListTagsOptions): Promise<Tag[]> {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented')
  }

  /**
   * Get a tag by name
   */
  async getTag(_name: string, _options?: GetTagOptions): Promise<Tag | null> {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented')
  }

  /**
   * Check if a tag exists
   */
  async tagExists(_name: string): Promise<boolean> {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented')
  }

  /**
   * Get the target (commit SHA) that a tag points to
   */
  async getTagTarget(_name: string): Promise<string> {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented')
  }

  /**
   * Verify a tag's GPG signature
   */
  async verifyTag(_name: string): Promise<TagSignatureVerification> {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented')
  }

  /**
   * Check if a tag is annotated
   */
  async isAnnotatedTag(_name: string): Promise<boolean> {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented')
  }
}

/**
 * Validate a tag name according to Git rules
 * Similar to ref name rules but with tag-specific constraints
 */
export function isValidTagName(_name: string): boolean {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Check if a string is a valid annotated tag (has tag object)
 */
export function isAnnotatedTag(_tag: Tag): _tag is Tag & { type: 'annotated'; tagger: Author; message: string } {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Format a tag message (handle line endings, etc.)
 */
export function formatTagMessage(_message: string): string {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Parse a tag message from raw content
 */
export function parseTagMessage(_content: string): { message: string; signature?: string } {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

// Convenience functions that wrap TagManager methods

/**
 * Create a lightweight tag pointing to a commit
 */
export async function createTag(
  _manager: TagManager,
  _name: string,
  _target: string,
  _options?: CreateTagOptions
): Promise<Tag> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Create an annotated tag with message
 */
export async function createAnnotatedTag(
  _manager: TagManager,
  _name: string,
  _target: string,
  _message: string,
  _tagger: Author,
  _options?: Omit<CreateTagOptions, 'annotated' | 'message' | 'tagger'>
): Promise<Tag> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Delete a tag
 */
export async function deleteTag(
  _manager: TagManager,
  _name: string,
  _options?: DeleteTagOptions
): Promise<boolean> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * List all tags
 */
export async function listTags(
  _manager: TagManager,
  _options?: ListTagsOptions
): Promise<Tag[]> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Get a tag by name
 */
export async function getTag(
  _manager: TagManager,
  _name: string,
  _options?: GetTagOptions
): Promise<Tag | null> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Check if a tag is an annotated tag
 */
export async function checkIsAnnotatedTag(
  _manager: TagManager,
  _name: string
): Promise<boolean> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Verify a tag's signature
 */
export async function verifyTagSignature(
  _manager: TagManager,
  _name: string
): Promise<TagSignatureVerification> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Get the target commit SHA for a tag
 */
export async function getTagTarget(
  _manager: TagManager,
  _name: string
): Promise<string> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Sort tags by semantic version
 */
export function sortTagsByVersion(_tags: Tag[], _direction: 'asc' | 'desc' = 'asc'): Tag[] {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}

/**
 * Filter tags by glob pattern
 */
export function filterTagsByPattern(_tags: Tag[], _pattern: string): Tag[] {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented')
}
