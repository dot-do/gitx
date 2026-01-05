/**
 * Git Tag Operations
 *
 * Handles creation, deletion, and management of Git tags.
 * Supports both lightweight tags (refs pointing to commits)
 * and annotated tags (tag objects with metadata).
 */
/**
 * Error thrown when a tag operation fails
 */
export class TagError extends Error {
    code;
    tagName;
    constructor(message, code, tagName) {
        super(message);
        this.code = code;
        this.tagName = tagName;
        this.name = 'TagError';
    }
}
/**
 * Tag manager for handling Git tag operations
 */
export class TagManager {
    constructor(refStorage, objectStorage, gpgSigner) {
        void refStorage; // Suppress unused variable warning until implementation
        void objectStorage;
        void gpgSigner;
        // TODO: Implement in GREEN phase
    }
    /**
     * Create a new tag
     */
    async createTag(_name, _target, _options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Delete a tag
     */
    async deleteTag(_name, _options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * List all tags
     */
    async listTags(_options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Get a tag by name
     */
    async getTag(_name, _options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Check if a tag exists
     */
    async tagExists(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Get the target (commit SHA) that a tag points to
     */
    async getTagTarget(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Verify a tag's GPG signature
     */
    async verifyTag(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Check if a tag is annotated
     */
    async isAnnotatedTag(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
}
/**
 * Validate a tag name according to Git rules
 * Similar to ref name rules but with tag-specific constraints
 */
export function isValidTagName(_name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Check if a string is a valid annotated tag (has tag object)
 */
export function isAnnotatedTag(_tag) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Format a tag message (handle line endings, etc.)
 */
export function formatTagMessage(_message) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Parse a tag message from raw content
 */
export function parseTagMessage(_content) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
// Convenience functions that wrap TagManager methods
/**
 * Create a lightweight tag pointing to a commit
 */
export async function createTag(_manager, _name, _target, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Create an annotated tag with message
 */
export async function createAnnotatedTag(_manager, _name, _target, _message, _tagger, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Delete a tag
 */
export async function deleteTag(_manager, _name, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * List all tags
 */
export async function listTags(_manager, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Get a tag by name
 */
export async function getTag(_manager, _name, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Check if a tag is an annotated tag
 */
export async function checkIsAnnotatedTag(_manager, _name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Verify a tag's signature
 */
export async function verifyTagSignature(_manager, _name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Get the target commit SHA for a tag
 */
export async function getTagTarget(_manager, _name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Sort tags by semantic version
 */
export function sortTagsByVersion(_tags, _direction = 'asc') {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Filter tags by glob pattern
 */
export function filterTagsByPattern(_tags, _pattern) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
//# sourceMappingURL=tag.js.map