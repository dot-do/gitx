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
 *   tagger: { name: 'Alice', email: 'alice@example.com.ai', timestamp: Date.now()/1000, timezone: '+0000' }
 * })
 *
 * // List version tags
 * const versions = await listTags(manager, { pattern: 'v*' })
 * ```
 */
const encoder = new TextEncoder();
// Re-export RefStorage for backward compatibility
export { RefStorage } from './storage';
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
 *   tagger: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' }
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
    refStorage;
    objectStorage;
    gpgSigner;
    // Simple in-memory lock to handle concurrent tag creation
    pendingCreations = new Set();
    /**
     * Create a new TagManager.
     *
     * @param refStorage - RefStorage instance for managing tag refs
     * @param objectStorage - Storage for reading/writing tag objects
     * @param gpgSigner - Optional GPG signer for signed tags
     */
    constructor(refStorage, objectStorage, gpgSigner) {
        this.refStorage = refStorage;
        this.objectStorage = objectStorage;
        this.gpgSigner = gpgSigner;
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
     *   tagger: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' }
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
    async createTag(name, target, options) {
        // Validate tag name
        if (!isValidTagName(name)) {
            throw new TagError(`Invalid tag name: ${name}`, 'INVALID_TAG_NAME', name);
        }
        const refName = `refs/tags/${name}`;
        // Synchronous check-and-lock to handle concurrent creation attempts
        if (this.pendingCreations.has(name)) {
            throw new TagError(`Tag already exists: ${name}`, 'TAG_EXISTS', name);
        }
        // Check if tag already exists
        const existingSha = await this.refStorage.getRef(refName);
        if (existingSha !== null && !options?.force) {
            throw new TagError(`Tag already exists: ${name}`, 'TAG_EXISTS', name);
        }
        // Mark as pending (synchronous operation for atomicity)
        if (!options?.force) {
            if (this.pendingCreations.has(name)) {
                throw new TagError(`Tag already exists: ${name}`, 'TAG_EXISTS', name);
            }
            this.pendingCreations.add(name);
        }
        // Determine if this should be an annotated tag
        const isAnnotated = options?.annotated === true || (options?.message !== undefined && options?.message !== '');
        try {
            if (isAnnotated) {
                // Validate message for annotated tags
                const rawMessage = options?.message;
                if (!rawMessage || rawMessage.trim().length === 0) {
                    throw new TagError('Annotated tag requires a message', 'MESSAGE_REQUIRED', name);
                }
                const formattedMessage = formatTagMessage(rawMessage);
                // Validate tagger (can have timestamp set to 0 or undefined, we'll use current time)
                let tagger = options?.tagger;
                if (tagger && tagger.timestamp === undefined) {
                    tagger = {
                        ...tagger,
                        timestamp: Math.floor(Date.now() / 1000)
                    };
                }
                // Handle signing
                let signature;
                let finalMessage = formattedMessage;
                if (options?.sign) {
                    if (!this.gpgSigner) {
                        throw new TagError('GPG signer not available', 'GPG_ERROR', name);
                    }
                    // Sign the tag content
                    signature = await this.gpgSigner.sign(encoder.encode(formattedMessage), options?.keyId);
                    // Append signature to message (Git stores signature in the tag object)
                    finalMessage = formattedMessage + '\n' + signature;
                }
                // Get the target object type
                const targetType = await this.objectStorage.readObjectType(target);
                // Create tag object
                const tagObj = {
                    object: target,
                    objectType: targetType || 'commit',
                    name,
                    message: finalMessage
                };
                if (tagger !== undefined) {
                    tagObj.tagger = tagger;
                }
                // Write tag object and get its SHA
                const tagObjSha = await this.objectStorage.writeTagObject(tagObj);
                // Write ref pointing to tag object
                await this.refStorage.setRef(refName, tagObjSha);
                const annotatedResult = {
                    name,
                    type: 'annotated',
                    sha: tagObjSha,
                    targetSha: target,
                    targetType: targetType || 'commit',
                    message: formattedMessage,
                };
                if (tagger !== undefined) {
                    annotatedResult.tagger = tagger;
                }
                if (signature !== undefined) {
                    annotatedResult.signature = signature;
                }
                return annotatedResult;
            }
            else {
                // Lightweight tag - just write ref pointing to target
                await this.refStorage.setRef(refName, target);
                return {
                    name,
                    type: 'lightweight',
                    sha: target
                };
            }
        }
        finally {
            // Clear the pending lock
            this.pendingCreations.delete(name);
        }
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
    async deleteTag(name, options) {
        const refName = `refs/tags/${name}`;
        // Check if tag exists
        const existingSha = await this.refStorage.getRef(refName);
        if (existingSha === null) {
            if (options?.force) {
                return false;
            }
            throw new TagError(`Tag not found: ${name}`, 'TAG_NOT_FOUND', name);
        }
        // Delete the ref (but not the tag object)
        await this.refStorage.deleteRef(refName);
        return true;
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
    async listTags(options) {
        // List all refs under refs/tags/
        const tagRefs = await this.refStorage.listRefs('refs/tags/');
        // Determine if we need metadata (either explicitly requested or for date sorting)
        const needMetadata = options?.includeMetadata || options?.sort === 'date';
        // Build tag list
        let tags = [];
        for (const refEntry of tagRefs) {
            const tagName = refEntry.name.replace('refs/tags/', '');
            const sha = refEntry.sha;
            // Check if it's an annotated tag by trying to read the tag object
            const tagObj = await this.objectStorage.readTagObject(sha);
            if (tagObj) {
                // Annotated tag
                const tag = {
                    name: tagName,
                    type: 'annotated',
                    sha
                };
                if (needMetadata) {
                    tag.targetSha = tagObj.object;
                    tag.targetType = tagObj.objectType;
                    if (tagObj.tagger !== undefined) {
                        tag.tagger = tagObj.tagger;
                    }
                    if (tagObj.message !== undefined) {
                        tag.message = tagObj.message;
                    }
                }
                tags.push(tag);
            }
            else {
                // Lightweight tag
                tags.push({
                    name: tagName,
                    type: 'lightweight',
                    sha
                });
            }
        }
        // Filter by pattern if provided
        if (options?.pattern) {
            tags = filterTagsByPattern(tags, options.pattern);
        }
        // Sort tags
        const sortType = options?.sort || 'name';
        const sortDirection = options?.sortDirection || 'asc';
        if (sortType === 'version') {
            tags = sortTagsByVersion(tags, sortDirection);
        }
        else if (sortType === 'date') {
            // Filter out tags without timestamps when sorting by date
            tags = tags.filter(t => t.tagger?.timestamp !== undefined);
            // Sort by tagger timestamp
            tags.sort((a, b) => {
                const aTime = a.tagger.timestamp;
                const bTime = b.tagger.timestamp;
                const timeDiff = sortDirection === 'asc' ? aTime - bTime : bTime - aTime;
                // Secondary sort by name when timestamps are equal
                if (timeDiff === 0) {
                    return a.name.localeCompare(b.name);
                }
                return timeDiff;
            });
        }
        else {
            // Sort by name (default)
            tags.sort((a, b) => {
                const cmp = a.name.localeCompare(b.name);
                return sortDirection === 'asc' ? cmp : -cmp;
            });
        }
        // Limit results
        if (options?.limit !== undefined) {
            tags = tags.slice(0, options.limit);
        }
        return tags;
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
    async getTag(name, options) {
        const refName = `refs/tags/${name}`;
        const sha = await this.refStorage.getRef(refName);
        if (sha === null) {
            return null;
        }
        // Try to read as tag object (annotated tag)
        const tagObj = await this.objectStorage.readTagObject(sha);
        if (tagObj) {
            // Annotated tag
            const tag = {
                name,
                type: 'annotated',
                sha
            };
            if (options?.resolve) {
                tag.targetSha = tagObj.object;
                tag.targetType = tagObj.objectType;
                if (tagObj.tagger !== undefined) {
                    tag.tagger = tagObj.tagger;
                }
                if (tagObj.message !== undefined) {
                    tag.message = tagObj.message;
                    // Check for signature in message
                    const parsed = parseTagMessage(tagObj.message);
                    if (parsed.signature) {
                        tag.signature = parsed.signature;
                        tag.message = parsed.message;
                    }
                }
            }
            return tag;
        }
        else {
            // Lightweight tag
            return {
                name,
                type: 'lightweight',
                sha
            };
        }
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
    async tagExists(name) {
        const refName = `refs/tags/${name}`;
        const sha = await this.refStorage.getRef(refName);
        return sha !== null;
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
    async getTagTarget(name) {
        const refName = `refs/tags/${name}`;
        let sha = await this.refStorage.getRef(refName);
        if (sha === null) {
            throw new TagError(`Tag not found: ${name}`, 'TAG_NOT_FOUND', name);
        }
        // Resolve through tag objects to get final commit
        let depth = 0;
        const maxDepth = 10;
        while (depth < maxDepth) {
            const tagObj = await this.objectStorage.readTagObject(sha);
            if (!tagObj) {
                // Not a tag object, this is the final target
                return sha;
            }
            // Follow the tag to its target
            sha = tagObj.object;
            depth++;
        }
        return sha;
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
    async verifyTag(name) {
        const refName = `refs/tags/${name}`;
        const sha = await this.refStorage.getRef(refName);
        if (sha === null) {
            throw new TagError(`Tag not found: ${name}`, 'TAG_NOT_FOUND', name);
        }
        // Get tag object
        const tagObj = await this.objectStorage.readTagObject(sha);
        if (!tagObj) {
            // Lightweight tag - cannot be signed
            return { valid: false };
        }
        // Parse message to check for signature
        const parsed = parseTagMessage(tagObj.message);
        if (!parsed.signature) {
            // No signature
            return { valid: false };
        }
        // Verify signature using GPG signer
        if (!this.gpgSigner) {
            return { valid: false, error: 'GPG signer not available' };
        }
        return this.gpgSigner.verify(encoder.encode(parsed.message), parsed.signature);
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
    async isAnnotatedTag(name) {
        const refName = `refs/tags/${name}`;
        const sha = await this.refStorage.getRef(refName);
        if (sha === null) {
            throw new TagError(`Tag not found: ${name}`, 'TAG_NOT_FOUND', name);
        }
        // Try to read as tag object
        const tagObj = await this.objectStorage.readTagObject(sha);
        return tagObj !== null;
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
export function isValidTagName(name) {
    // Empty name is invalid
    if (!name || name.length === 0 || name.trim().length === 0) {
        return false;
    }
    // Cannot end with .lock
    if (name.endsWith('.lock')) {
        return false;
    }
    // Cannot contain ..
    if (name.includes('..')) {
        return false;
    }
    // Cannot contain @{
    if (name.includes('@{')) {
        return false;
    }
    // Cannot contain control characters (ASCII 0-31, 127), space, ~, ^, :, ?, *, [, \
    const invalidChars = /[\x00-\x1f\x7f ~^:?*[\]\\]/;
    if (invalidChars.test(name)) {
        return false;
    }
    // Cannot end with /
    if (name.endsWith('/')) {
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
export function isAnnotatedTag(tag) {
    return tag.type === 'annotated' &&
        tag.tagger !== undefined &&
        tag.message !== undefined;
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
export function formatTagMessage(message) {
    // Normalize line endings (CRLF -> LF)
    let formatted = message.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Trim leading and trailing whitespace, but preserve internal structure
    // The test expects 'Hello\r\nWorld\r\n' to become 'Hello\nWorld\n'
    // So we trim leading whitespace, convert line endings, but preserve trailing newline if present
    const hadTrailingNewline = formatted.endsWith('\n');
    formatted = formatted.trim();
    if (hadTrailingNewline && formatted.length > 0) {
        formatted += '\n';
    }
    return formatted;
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
export function parseTagMessage(content) {
    const sigMarker = '-----BEGIN PGP SIGNATURE-----';
    const sigIndex = content.indexOf(sigMarker);
    if (sigIndex === -1) {
        // No signature
        return { message: content.trim() };
    }
    // Split message and signature
    const message = content.slice(0, sigIndex).trim();
    const signature = content.slice(sigIndex);
    return { message, signature };
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
export async function createTag(manager, name, target, options) {
    return manager.createTag(name, target, options);
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
 *   { name: 'Alice', email: 'alice@example.com.ai', timestamp: Date.now()/1000, timezone: '+0000' }
 * )
 * ```
 */
export async function createAnnotatedTag(manager, name, target, message, tagger, options) {
    return manager.createTag(name, target, {
        ...options,
        annotated: true,
        message,
        tagger
    });
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
export async function deleteTag(manager, name, options) {
    return manager.deleteTag(name, options);
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
export async function listTags(manager, options) {
    return manager.listTags(options);
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
export async function getTag(manager, name, options) {
    return manager.getTag(name, options);
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
export async function checkIsAnnotatedTag(manager, name) {
    return manager.isAnnotatedTag(name);
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
export async function verifyTagSignature(manager, name) {
    return manager.verifyTag(name);
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
export async function getTagTarget(manager, name) {
    return manager.getTagTarget(name);
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
export function sortTagsByVersion(tags, direction = 'asc') {
    // Parse version from tag name (handles v1.2.3, 1.2.3, v1.2.3-beta, etc.)
    const parseVersion = (name) => {
        // Remove 'v' prefix if present
        const normalized = name.startsWith('v') ? name.slice(1) : name;
        // Extract numeric version parts (split on non-digit, non-dot)
        const splitResult = normalized.split(/[^0-9.]/);
        const versionPart = splitResult[0] ?? '';
        const parts = versionPart.split('.');
        return parts.map(p => parseInt(p, 10) || 0);
    };
    const compareVersions = (a, b) => {
        const maxLen = Math.max(a.length, b.length);
        for (let i = 0; i < maxLen; i++) {
            const aVal = a[i] || 0;
            const bVal = b[i] || 0;
            if (aVal !== bVal) {
                return aVal - bVal;
            }
        }
        return 0;
    };
    const sorted = [...tags].sort((a, b) => {
        const aVer = parseVersion(a.name);
        const bVer = parseVersion(b.name);
        const cmp = compareVersions(aVer, bVer);
        return direction === 'asc' ? cmp : -cmp;
    });
    return sorted;
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
export function filterTagsByPattern(tags, pattern) {
    // Convert glob pattern to regex
    // * matches any number of characters
    // ? matches a single character
    // Escape special regex characters except * and ?
    const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
        .replace(/\*/g, '.*') // * -> .*
        .replace(/\?/g, '.'); // ? -> .
    const regex = new RegExp(`^${regexPattern}$`);
    return tags.filter(tag => regex.test(tag.name));
}
//# sourceMappingURL=tag.js.map