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
export class TagError extends Error {
    code;
    tagName;
    /**
     * Create a new TagError.
     *
     * @param message - Human-readable error description
     * @param code - Error code for programmatic handling
     * @param tagName - The tag that caused the error (optional)
     */
    constructor(message, code, tagName) {
        super(message);
        this.code = code;
        this.tagName = tagName;
        this.name = 'TagError';
    }
}
// ============================================================================
// TagManager Class
// ============================================================================
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
export class TagManager {
    /**
     * Create a new TagManager.
     *
     * @param refStorage - RefStorage instance for managing tag refs
     * @param objectStorage - Storage for reading/writing tag objects
     * @param gpgSigner - Optional GPG signer for signed tags
     */
    constructor(refStorage, objectStorage, gpgSigner) {
        void refStorage; // Suppress unused variable warning until implementation
        void objectStorage;
        void gpgSigner;
        // TODO: Implement in GREEN phase
    }
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
    async createTag(_name, _target, _options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
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
    async deleteTag(_name, _options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
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
    async listTags(_options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
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
    async getTag(_name, _options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
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
    async tagExists(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
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
    async getTagTarget(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
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
    async verifyTag(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
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
    async isAnnotatedTag(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
}
// ============================================================================
// Validation Functions
// ============================================================================
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
export function isValidTagName(_name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export function isAnnotatedTag(_tag) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export function formatTagMessage(_message) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export function parseTagMessage(_content) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
// ============================================================================
// Convenience Functions
// ============================================================================
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
export async function createTag(_manager, _name, _target, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export async function createAnnotatedTag(_manager, _name, _target, _message, _tagger, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export async function deleteTag(_manager, _name, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export async function listTags(_manager, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export async function getTag(_manager, _name, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export async function checkIsAnnotatedTag(_manager, _name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export async function verifyTagSignature(_manager, _name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export async function getTagTarget(_manager, _name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export function sortTagsByVersion(_tags, _direction = 'asc') {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
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
export function filterTagsByPattern(_tags, _pattern) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
//# sourceMappingURL=tag.js.map