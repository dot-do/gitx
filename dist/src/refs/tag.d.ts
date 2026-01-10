/**
 * @fileoverview Git Tag Operations
 *
 * This module provides comprehensive tag management functionality including
 * creation (lightweight and annotated), deletion, listing, and verification.
 *
 * **Tag Types in Git**:
 * - **Lightweight tags**: Simple refs under refs/tags/ pointing to commits
 * - **Annotated tags**: Refs pointing to tag objects containing metadata
 *   (tagger, date, message, and optional GPG signature)
 *
 * Annotated tags are recommended for releases as they include metadata
 * and can be cryptographically signed.
 *
 * @module refs/tag
 *
 * @example
 * ```typescript
 * import { TagManager, createTag, listTags } from './refs/tag'
 *
 * // Create manager
 * const manager = new TagManager(refStorage, objectStorage, gpgSigner)
 *
 * // Create annotated tag
 * const tag = await manager.createTag('v1.0.0', commitSha, {
 *   annotated: true,
 *   message: 'Release 1.0.0',
 *   tagger: { name: 'Alice', email: 'alice@example.com', timestamp: Date.now()/1000, timezone: '+0000' }
 * })
 *
 * // List version tags
 * const versions = await listTags(manager, { pattern: 'v*' })
 * ```
 */
import { Author, TagObject, ObjectType } from '../types/objects';
import { RefErrorCode } from './storage';
/**
 * Simplified ref storage interface for TagManager.
 *
 * This interface is a subset of RefStorage that TagManager needs.
 * It allows for simpler mocking in tests.
 */
export interface TagRefStorage {
    getRef(name: string): Promise<string | null>;
    setRef(name: string, sha: string): Promise<void>;
    deleteRef(name: string): Promise<boolean>;
    listRefs(prefix: string): Promise<Array<{
        name: string;
        sha: string;
    }>>;
}
export { RefStorage } from './storage';
/**
 * Tag type discriminator.
 *
 * @description
 * - `lightweight`: Simple ref pointing directly to a commit
 * - `annotated`: Ref pointing to a tag object containing metadata
 */
export type TagType = 'lightweight' | 'annotated';
/**
 * Represents a Git tag (either lightweight or annotated).
 *
 * @description
 * Unified interface for both lightweight and annotated tags.
 * For annotated tags, includes additional metadata from the tag object.
 *
 * @example
 * ```typescript
 * // Lightweight tag
 * const light: Tag = {
 *   name: 'v0.1.0',
 *   type: 'lightweight',
 *   sha: 'commitsha...'
 * }
 *
 * // Annotated tag
 * const annotated: Tag = {
 *   name: 'v1.0.0',
 *   type: 'annotated',
 *   sha: 'tagobjectsha...',
 *   targetSha: 'commitsha...',
 *   targetType: 'commit',
 *   tagger: { name: 'Alice', email: 'alice@example.com', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Release 1.0.0'
 * }
 * ```
 */
export interface Tag {
    /** Tag name (e.g., 'v1.0.0') without refs/tags/ prefix */
    name: string;
    /** Tag type: 'lightweight' or 'annotated' */
    type: TagType;
    /**
     * SHA this ref points to.
     * For lightweight tags: commit SHA
     * For annotated tags: tag object SHA
     */
    sha: string;
    /**
     * For annotated tags: the commit/object the tag points to.
     * Undefined for lightweight tags.
     */
    targetSha?: string;
    /**
     * For annotated tags: the type of object being tagged.
     * Usually 'commit', but could be 'blob', 'tree', or even 'tag'.
     */
    targetType?: ObjectType;
    /**
     * For annotated tags: the tagger information.
     * Contains name, email, timestamp, and timezone.
     */
    tagger?: Author;
    /**
     * For annotated tags: the tag message.
     * Can be multi-line with a subject and body.
     */
    message?: string;
    /**
     * For signed annotated tags: the GPG signature.
     * ASCII-armored GPG signature block.
     */
    signature?: string;
}
/**
 * Options for creating a tag.
 *
 * @description
 * Controls tag creation behavior including whether to create
 * an annotated tag, message content, and signing options.
 */
export interface CreateTagOptions {
    /**
     * Create an annotated tag (default: false for lightweight).
     * If message is provided, defaults to true.
     */
    annotated?: boolean;
    /**
     * Tag message (required for annotated tags unless using empty message).
     * Can be multi-line with subject and body separated by blank line.
     */
    message?: string;
    /**
     * Tagger information (defaults to configured user).
     * Required for annotated tags if no global config is set.
     */
    tagger?: Author;
    /**
     * Sign the tag with GPG.
     * Requires GPGSigner to be provided to TagManager.
     */
    sign?: boolean;
    /**
     * GPG key ID to use for signing.
     * Defaults to the user's default signing key.
     */
    keyId?: string;
    /**
     * Force overwrite if tag exists.
     * Without force, creating an existing tag throws TagError.
     */
    force?: boolean;
}
/**
 * Options for listing tags.
 *
 * @description
 * Provides filtering, sorting, and inclusion options for tag listing.
 */
export interface ListTagsOptions {
    /**
     * Pattern to filter tags (glob-like, e.g., 'v1.*', 'release-*').
     * Supports * and ? wildcards.
     */
    pattern?: string;
    /**
     * Sort order: 'name', 'version', or 'date'.
     * 'version' uses semantic versioning comparison.
     * 'date' requires includeMetadata=true for annotated tags.
     */
    sort?: 'name' | 'version' | 'date';
    /** Sort direction: 'asc' or 'desc' */
    sortDirection?: 'asc' | 'desc';
    /** Maximum number of tags to return */
    limit?: number;
    /**
     * Include annotated tag metadata (tagger, message).
     * Slower as it requires reading tag objects.
     */
    includeMetadata?: boolean;
}
/**
 * Options for deleting a tag.
 */
export interface DeleteTagOptions {
    /**
     * Delete even if tag doesn't exist locally.
     * Without force, deleting non-existent tag throws TagError.
     */
    force?: boolean;
}
/**
 * Options for getting a tag.
 */
export interface GetTagOptions {
    /**
     * Resolve to get full annotated tag info.
     * Reads the tag object to populate tagger, message, etc.
     */
    resolve?: boolean;
}
/**
 * Result of tag signature verification.
 *
 * @description
 * Contains verification status and signer information
 * for signed annotated tags.
 *
 * @example
 * ```typescript
 * const result = await manager.verifyTag('v1.0.0')
 * if (result.valid) {
 *   console.log(`Signed by: ${result.signer} (${result.keyId})`)
 *   console.log(`Trust: ${result.trustLevel}`)
 * } else {
 *   console.log(`Verification failed: ${result.error}`)
 * }
 * ```
 */
export interface TagSignatureVerification {
    /** Whether the signature is valid */
    valid: boolean;
    /** GPG key ID used for signing (e.g., '0x1234ABCD') */
    keyId?: string;
    /** Signer identity from the key */
    signer?: string;
    /**
     * Trust level of the signing key.
     * Based on GPG web of trust model.
     */
    trustLevel?: 'ultimate' | 'full' | 'marginal' | 'never' | 'undefined' | 'expired' | 'unknown';
    /** Error message if verification failed */
    error?: string;
}
/**
 * Error codes specific to tag operations.
 *
 * @description
 * Extends RefErrorCode with tag-specific errors:
 * - `TAG_EXISTS`: Tag already exists (when creating without force)
 * - `TAG_NOT_FOUND`: Tag doesn't exist
 * - `INVALID_TAG_NAME`: Tag name fails validation
 * - `MESSAGE_REQUIRED`: Annotated tag requires a message
 * - `GPG_ERROR`: GPG signing or verification failed
 */
export type TagErrorCode = RefErrorCode | 'TAG_EXISTS' | 'TAG_NOT_FOUND' | 'INVALID_TAG_NAME' | 'MESSAGE_REQUIRED' | 'GPG_ERROR';
/**
 * Error thrown when a tag operation fails.
 *
 * @description
 * Provides structured error information with error code
 * for programmatic error handling.
 *
 * @example
 * ```typescript
 * try {
 *   await manager.createTag('v1.0.0', 'abc123')
 * } catch (e) {
 *   if (e instanceof TagError) {
 *     switch (e.code) {
 *       case 'TAG_EXISTS':
 *         console.log('Tag already exists, use force=true to overwrite')
 *         break
 *       case 'MESSAGE_REQUIRED':
 *         console.log('Annotated tags require a message')
 *         break
 *     }
 *   }
 * }
 * ```
 */
export declare class TagError extends Error {
    readonly code: TagErrorCode;
    readonly tagName?: string | undefined;
    /**
     * Create a new TagError.
     *
     * @param message - Human-readable error description
     * @param code - Error code for programmatic handling
     * @param tagName - The tag that caused the error (optional)
     */
    constructor(message: string, code: TagErrorCode, tagName?: string | undefined);
}
/**
 * Storage backend interface for tag objects.
 *
 * @description
 * Interface for reading and writing tag objects.
 * Used by TagManager for annotated tag operations.
 */
export interface TagObjectStorage {
    /**
     * Read a tag object by SHA.
     *
     * @param sha - 40-character SHA-1 of the tag object
     * @returns Parsed TagObject or null if not found
     */
    readTagObject(sha: string): Promise<TagObject | null>;
    /**
     * Write a tag object and return its SHA.
     *
     * @param tag - Tag object data (without type and data fields)
     * @returns 40-character SHA-1 of the stored tag object
     */
    writeTagObject(tag: Omit<TagObject, 'type' | 'data'>): Promise<string>;
    /**
     * Read any object to determine its type.
     *
     * @param sha - 40-character SHA-1 of the object
     * @returns Object type or null if not found
     */
    readObjectType(sha: string): Promise<ObjectType | null>;
}
/**
 * GPG signing interface.
 *
 * @description
 * Interface for GPG signing and verification operations.
 * Used for signed tag creation and verification.
 */
export interface GPGSigner {
    /**
     * Sign data and return the signature.
     *
     * @param data - Binary data to sign
     * @param keyId - Optional specific key ID to use
     * @returns ASCII-armored GPG signature
     * @throws Error if signing fails
     */
    sign(data: Uint8Array, keyId?: string): Promise<string>;
    /**
     * Verify a signature.
     *
     * @param data - Binary data that was signed
     * @param signature - ASCII-armored GPG signature to verify
     * @returns Verification result with validity and signer info
     */
    verify(data: Uint8Array, signature: string): Promise<TagSignatureVerification>;
}
/**
 * Tag manager for handling Git tag operations.
 *
 * @description
 * Provides a comprehensive API for tag management including both
 * lightweight and annotated tags. Uses RefStorage for refs and
 * TagObjectStorage for tag objects.
 *
 * Note: Most methods are currently stubs (TODO) and will throw 'Not implemented'.
 * These will be implemented in the GREEN phase of TDD development.
 *
 * @example
 * ```typescript
 * const manager = new TagManager(refStorage, objectStorage, gpgSigner)
 *
 * // Create a release tag
 * const tag = await manager.createTag('v1.0.0', commitSha, {
 *   annotated: true,
 *   message: 'Version 1.0.0 release',
 *   tagger: { name: 'Alice', email: 'alice@example.com', timestamp: 1704067200, timezone: '+0000' }
 * })
 *
 * // List version tags
 * const versions = await manager.listTags({ pattern: 'v*' })
 *
 * // Verify signed tag
 * const verification = await manager.verifyTag('v1.0.0')
 * ```
 */
export declare class TagManager {
    private refStorage;
    private objectStorage;
    private gpgSigner?;
    private pendingCreations;
    /**
     * Create a new TagManager.
     *
     * @param refStorage - RefStorage instance for managing tag refs
     * @param objectStorage - Storage for reading/writing tag objects
     * @param gpgSigner - Optional GPG signer for signed tags
     */
    constructor(refStorage: TagRefStorage, objectStorage: TagObjectStorage, gpgSigner?: GPGSigner);
    /**
     * Create a new tag.
     *
     * @description
     * Creates either a lightweight or annotated tag pointing to the
     * specified target. For annotated tags, creates a tag object with
     * metadata and optionally signs it.
     *
     * @param name - Tag name (without refs/tags/ prefix)
     * @param target - Target SHA to tag (usually a commit)
     * @param options - Creation options
     * @returns The created tag
     * @throws TagError with code 'INVALID_TAG_NAME' if name is invalid
     * @throws TagError with code 'TAG_EXISTS' if tag exists and not forcing
     * @throws TagError with code 'MESSAGE_REQUIRED' for annotated tag without message
     * @throws TagError with code 'GPG_ERROR' if signing fails
     *
     * @example
     * ```typescript
     * // Create lightweight tag
     * const light = await manager.createTag('v0.1.0', commitSha)
     *
     * // Create annotated tag
     * const annotated = await manager.createTag('v1.0.0', commitSha, {
     *   annotated: true,
     *   message: 'Release 1.0.0',
     *   tagger: { name: 'Alice', email: 'alice@example.com', timestamp: 1704067200, timezone: '+0000' }
     * })
     *
     * // Create signed tag
     * const signed = await manager.createTag('v1.0.0', commitSha, {
     *   annotated: true,
     *   message: 'Release 1.0.0',
     *   sign: true
     * })
     * ```
     */
    createTag(name: string, target: string, options?: CreateTagOptions): Promise<Tag>;
    /**
     * Delete a tag.
     *
     * @description
     * Removes a tag ref. Does not delete the tag object (if annotated)
     * as it may be referenced elsewhere (reflog, etc.).
     *
     * @param name - Tag name to delete
     * @param options - Deletion options
     * @returns True if tag was deleted, false if it didn't exist (with force)
     * @throws TagError with code 'TAG_NOT_FOUND' if tag doesn't exist (without force)
     *
     * @example
     * ```typescript
     * await manager.deleteTag('v0.9.0-beta')
     *
     * // Delete even if doesn't exist
     * await manager.deleteTag('maybe-exists', { force: true })
     * ```
     */
    deleteTag(name: string, options?: DeleteTagOptions): Promise<boolean>;
    /**
     * List all tags.
     *
     * @description
     * Returns tags matching the specified criteria.
     * By default returns all tags sorted by name.
     *
     * @param options - Listing options
     * @returns Array of tags matching criteria
     *
     * @example
     * ```typescript
     * // List all tags
     * const all = await manager.listTags()
     *
     * // List version tags with metadata
     * const versions = await manager.listTags({
     *   pattern: 'v*',
     *   sort: 'version',
     *   includeMetadata: true
     * })
     *
     * // Get latest 5 tags
     * const latest = await manager.listTags({
     *   sort: 'date',
     *   sortDirection: 'desc',
     *   limit: 5,
     *   includeMetadata: true
     * })
     * ```
     */
    listTags(options?: ListTagsOptions): Promise<Tag[]>;
    /**
     * Get a tag by name.
     *
     * @description
     * Retrieves tag information. Use resolve=true to get full
     * annotated tag metadata.
     *
     * @param name - Tag name
     * @param options - Get options
     * @returns Tag info or null if not found
     *
     * @example
     * ```typescript
     * // Quick lookup
     * const tag = await manager.getTag('v1.0.0')
     *
     * // Get full metadata
     * const full = await manager.getTag('v1.0.0', { resolve: true })
     * if (full?.type === 'annotated') {
     *   console.log(`Tagged by: ${full.tagger?.name}`)
     *   console.log(`Message: ${full.message}`)
     * }
     * ```
     */
    getTag(name: string, options?: GetTagOptions): Promise<Tag | null>;
    /**
     * Check if a tag exists.
     *
     * @description
     * Quick check for tag existence without fetching full info.
     *
     * @param name - Tag name
     * @returns True if tag exists
     *
     * @example
     * ```typescript
     * if (await manager.tagExists('v1.0.0')) {
     *   console.log('Tag already exists')
     * }
     * ```
     */
    tagExists(name: string): Promise<boolean>;
    /**
     * Get the target (commit SHA) that a tag points to.
     *
     * @description
     * Resolves through annotated tags to get the final target.
     * For lightweight tags, returns the sha directly.
     * For annotated tags, returns the targetSha.
     *
     * @param name - Tag name
     * @returns Target commit SHA
     * @throws TagError with code 'TAG_NOT_FOUND' if tag doesn't exist
     *
     * @example
     * ```typescript
     * const commitSha = await manager.getTagTarget('v1.0.0')
     * ```
     */
    getTagTarget(name: string): Promise<string>;
    /**
     * Verify a tag's GPG signature.
     *
     * @description
     * Verifies the GPG signature on a signed annotated tag.
     * Returns verification result with signer info.
     *
     * @param name - Tag name to verify
     * @returns Verification result
     * @throws TagError with code 'TAG_NOT_FOUND' if tag doesn't exist
     *
     * @example
     * ```typescript
     * const result = await manager.verifyTag('v1.0.0')
     * if (result.valid) {
     *   console.log(`Signed by: ${result.signer}`)
     *   console.log(`Trust: ${result.trustLevel}`)
     * } else {
     *   console.log(`Verification failed: ${result.error}`)
     * }
     * ```
     */
    verifyTag(name: string): Promise<TagSignatureVerification>;
    /**
     * Check if a tag is annotated.
     *
     * @description
     * Determines if a tag is annotated (has a tag object) or lightweight.
     *
     * @param name - Tag name
     * @returns True if the tag is annotated
     * @throws TagError with code 'TAG_NOT_FOUND' if tag doesn't exist
     *
     * @example
     * ```typescript
     * if (await manager.isAnnotatedTag('v1.0.0')) {
     *   console.log('This is an annotated tag')
     * }
     * ```
     */
    isAnnotatedTag(name: string): Promise<boolean>;
}
/**
 * Validate a tag name according to Git rules.
 *
 * @description
 * Tags follow the same rules as refs but under refs/tags/.
 * This validates against the full git-check-ref-format rules.
 *
 * **Rules**:
 * - Cannot be empty
 * - Cannot end with '/' or '.lock'
 * - Cannot contain '..', '@{', control chars, space, ~, ^, :, ?, *, [, \
 * - Components cannot start or end with '.'
 *
 * Note: This is a stub implementation. Full validation will be added in GREEN phase.
 *
 * @param name - Tag name to validate
 * @returns True if valid
 *
 * @see https://git-scm.com/docs/git-check-ref-format
 *
 * @example
 * ```typescript
 * isValidTagName('v1.0.0')        // true
 * isValidTagName('release/1.0')   // true
 * isValidTagName('v1.0.0.lock')   // false (ends with .lock)
 * isValidTagName('v1..0')         // false (contains ..)
 * isValidTagName('')              // false (empty)
 * ```
 */
export declare function isValidTagName(name: string): boolean;
/**
 * Type guard for annotated tags.
 *
 * @description
 * Checks if a tag is annotated with full metadata.
 * Narrows the type to include tagger and message.
 *
 * @param tag - Tag to check
 * @returns True if the tag is annotated with full metadata
 *
 * @example
 * ```typescript
 * if (isAnnotatedTag(tag)) {
 *   // tag.tagger and tag.message are now guaranteed
 *   console.log(`Tagged by: ${tag.tagger.name}`)
 * }
 * ```
 */
export declare function isAnnotatedTag(tag: Tag): tag is Tag & {
    type: 'annotated';
    tagger: Author;
    message: string;
};
/**
 * Format a tag message.
 *
 * @description
 * Normalizes a tag message: handles line endings, trims whitespace,
 * ensures proper formatting.
 *
 * @param message - Raw message input
 * @returns Formatted message
 *
 * @example
 * ```typescript
 * formatTagMessage('  Hello World  \r\n')  // 'Hello World\n'
 * ```
 */
export declare function formatTagMessage(message: string): string;
/**
 * Parse a tag message from raw content.
 *
 * @description
 * Separates the message from any GPG signature.
 * GPG signatures start with '-----BEGIN PGP SIGNATURE-----'.
 *
 * @param content - Raw tag content
 * @returns Parsed message and optional signature
 *
 * @example
 * ```typescript
 * const { message, signature } = parseTagMessage(content)
 * if (signature) {
 *   console.log('Tag is signed')
 * }
 * ```
 */
export declare function parseTagMessage(content: string): {
    message: string;
    signature?: string;
};
/**
 * Create a tag (lightweight or annotated).
 *
 * @description
 * Convenience function that wraps TagManager.createTag.
 *
 * @param manager - TagManager instance
 * @param name - Tag name
 * @param target - Target SHA to tag
 * @param options - Creation options
 * @returns Created tag
 *
 * @example
 * ```typescript
 * const tag = await createTag(manager, 'v1.0.0', commitSha, {
 *   annotated: true,
 *   message: 'Release 1.0.0'
 * })
 * ```
 */
export declare function createTag(manager: TagManager, name: string, target: string, options?: CreateTagOptions): Promise<Tag>;
/**
 * Create an annotated tag with message.
 *
 * @description
 * Convenience function for creating annotated tags.
 * Automatically sets annotated=true.
 *
 * @param manager - TagManager instance
 * @param name - Tag name
 * @param target - Target SHA to tag
 * @param message - Tag message
 * @param tagger - Tagger information
 * @param options - Additional options (excluding annotated, message, tagger)
 * @returns Created annotated tag
 *
 * @example
 * ```typescript
 * const tag = await createAnnotatedTag(
 *   manager,
 *   'v1.0.0',
 *   commitSha,
 *   'Release 1.0.0',
 *   { name: 'Alice', email: 'alice@example.com', timestamp: Date.now()/1000, timezone: '+0000' }
 * )
 * ```
 */
export declare function createAnnotatedTag(manager: TagManager, name: string, target: string, message: string, tagger: Author, options?: Omit<CreateTagOptions, 'annotated' | 'message' | 'tagger'>): Promise<Tag>;
/**
 * Delete a tag.
 *
 * @description
 * Convenience function that wraps TagManager.deleteTag.
 *
 * @param manager - TagManager instance
 * @param name - Tag name to delete
 * @param options - Deletion options
 * @returns True if deleted
 *
 * @example
 * ```typescript
 * await deleteTag(manager, 'v0.9.0-beta')
 * ```
 */
export declare function deleteTag(manager: TagManager, name: string, options?: DeleteTagOptions): Promise<boolean>;
/**
 * List all tags.
 *
 * @description
 * Convenience function that wraps TagManager.listTags.
 *
 * @param manager - TagManager instance
 * @param options - Listing options
 * @returns Array of tags
 *
 * @example
 * ```typescript
 * const tags = await listTags(manager, { pattern: 'v1.*' })
 * ```
 */
export declare function listTags(manager: TagManager, options?: ListTagsOptions): Promise<Tag[]>;
/**
 * Get a tag by name.
 *
 * @description
 * Convenience function that wraps TagManager.getTag.
 *
 * @param manager - TagManager instance
 * @param name - Tag name
 * @param options - Get options
 * @returns Tag info or null
 *
 * @example
 * ```typescript
 * const tag = await getTag(manager, 'v1.0.0', { resolve: true })
 * ```
 */
export declare function getTag(manager: TagManager, name: string, options?: GetTagOptions): Promise<Tag | null>;
/**
 * Check if a tag is annotated.
 *
 * @description
 * Convenience function that wraps TagManager.isAnnotatedTag.
 *
 * @param manager - TagManager instance
 * @param name - Tag name
 * @returns True if annotated
 *
 * @example
 * ```typescript
 * if (await checkIsAnnotatedTag(manager, 'v1.0.0')) {
 *   console.log('Annotated tag')
 * }
 * ```
 */
export declare function checkIsAnnotatedTag(manager: TagManager, name: string): Promise<boolean>;
/**
 * Verify a tag's signature.
 *
 * @description
 * Convenience function that wraps TagManager.verifyTag.
 *
 * @param manager - TagManager instance
 * @param name - Tag name
 * @returns Verification result
 *
 * @example
 * ```typescript
 * const result = await verifyTagSignature(manager, 'v1.0.0')
 * ```
 */
export declare function verifyTagSignature(manager: TagManager, name: string): Promise<TagSignatureVerification>;
/**
 * Get the target commit SHA for a tag.
 *
 * @description
 * Convenience function that wraps TagManager.getTagTarget.
 *
 * @param manager - TagManager instance
 * @param name - Tag name
 * @returns Target commit SHA
 *
 * @example
 * ```typescript
 * const sha = await getTagTarget(manager, 'v1.0.0')
 * ```
 */
export declare function getTagTarget(manager: TagManager, name: string): Promise<string>;
/**
 * Sort tags by semantic version.
 *
 * @description
 * Sorts tags that look like semantic versions (v1.2.3).
 * Non-semver tags are sorted lexicographically at the end.
 *
 * @param tags - Array of tags to sort
 * @param direction - Sort direction ('asc' or 'desc')
 * @returns Sorted array of tags
 *
 * @example
 * ```typescript
 * const sorted = sortTagsByVersion(tags, 'desc')
 * // ['v2.0.0', 'v1.10.0', 'v1.9.0', 'v1.0.0', ...]
 * ```
 */
export declare function sortTagsByVersion(tags: Tag[], direction?: 'asc' | 'desc'): Tag[];
/**
 * Filter tags by glob pattern.
 *
 * @description
 * Filters tags matching a glob pattern.
 * Supports * (any chars) and ? (single char) wildcards.
 *
 * @param tags - Array of tags to filter
 * @param pattern - Glob pattern (e.g., 'v1.*', 'release-*')
 * @returns Filtered array of tags
 *
 * @example
 * ```typescript
 * const v1Tags = filterTagsByPattern(tags, 'v1.*')
 * ```
 */
export declare function filterTagsByPattern(tags: Tag[], pattern: string): Tag[];
//# sourceMappingURL=tag.d.ts.map