/**
 * @fileoverview Git Object Types and Serialization (Platform Agnostic)
 *
 * Re-exports from the core objects module with backward compatibility layer.
 *
 * @module @dotdo/gitx/objects
 */
// Re-export everything from the core objects module
export { 
// Core Classes
GitBlob, GitTree, GitCommit, GitTag, 
// Tree utilities
sortTreeEntries, parseTreeEntries, serializeTreeEntries, 
// Commit utilities
parseIdentity, formatIdentity, hasGpgSignature, parseGpgSignature, 
// Constants
OBJECT_TYPES, VALID_MODES, 
// Validation
isValidSha, isValidMode, isValidObjectType, 
// Runtime type guards
isValidIdentity, isValidTreeEntry, isBlobData, isTreeData, isCommitData, isTagData, 
// Errors
InvalidGitObjectDataError, 
// Hash utilities
calculateSha1, calculateObjectHash, createObjectHeader, parseObjectHeader, bytesToHex, hexToBytes, 
// Loose object format
compressObject, decompressObject, writeLooseObject, readLooseObject, 
// Object type detection
detectObjectType, parseGitObject, createGitObject, } from '../../core/objects';
// ============================================================================
// Legacy API Compatibility Layer
// ============================================================================
// For backward compatibility with the old API, we provide type aliases and
// adapter functions that map to the new class-based API.
import { GitBlob, GitTree, GitCommit, GitTag, isValidSha, isValidMode, isValidObjectType, VALID_MODES, } from '../../core/objects';
/**
 * Valid SHA-1 hash pattern (40 lowercase hexadecimal characters).
 */
export const SHA_PATTERN = /^[0-9a-f]{40}$/;
// ============================================================================
// Legacy Serialization Functions (Backward Compatible)
// ============================================================================
/**
 * Serialize blob data to Git object format.
 * @deprecated Use new GitBlob(data).serialize() instead
 */
export function serializeBlob(data) {
    const blob = new GitBlob(data);
    return blob.serialize();
}
/**
 * Serialize tree entries to Git object format.
 * @deprecated Use new GitTree(entries).serialize() instead
 */
export function serializeTree(entries) {
    const tree = new GitTree(entries);
    return tree.serialize();
}
/**
 * Serialize commit to Git object format.
 * @deprecated Use new GitCommit(data).serialize() instead
 */
export function serializeCommit(commit) {
    const gitCommit = new GitCommit({
        tree: commit.tree,
        parents: commit.parents,
        author: commit.author,
        committer: commit.committer,
        message: commit.message,
    });
    return gitCommit.serialize();
}
/**
 * Serialize tag to Git object format.
 * @deprecated Use new GitTag(data).serialize() instead
 */
export function serializeTag(tag) {
    const gitTag = new GitTag({
        object: tag.object,
        objectType: tag.objectType,
        name: tag.name,
        message: tag.message,
        ...(tag.tagger !== undefined ? { tagger: tag.tagger } : {}),
    });
    return gitTag.serialize();
}
// ============================================================================
// Legacy Parsing Functions (Backward Compatible)
// ============================================================================
/**
 * Parse blob from serialized format.
 * @deprecated Use GitBlob.parse(data) instead
 */
export function parseBlob(data) {
    const blob = GitBlob.parse(data);
    return {
        type: 'blob',
        data: blob.content,
    };
}
/**
 * Parse tree from serialized format.
 * @deprecated Use GitTree.parse(data) instead
 */
export function parseTree(data) {
    const tree = GitTree.parse(data);
    return {
        type: 'tree',
        data: tree.serialize(),
        entries: [...tree.entries],
    };
}
/**
 * Parse commit from serialized format.
 * @deprecated Use GitCommit.parse(data) instead
 */
export function parseCommit(data) {
    const commit = GitCommit.parse(data);
    return {
        type: 'commit',
        data: commit.serialize(),
        tree: commit.tree,
        parents: [...(commit.parents || [])],
        author: commit.author,
        committer: commit.committer,
        message: commit.message,
    };
}
/**
 * Parse tag from serialized format.
 * @deprecated Use GitTag.parse(data) instead
 */
export function parseTag(data) {
    const tag = GitTag.parse(data);
    return {
        type: 'tag',
        data: tag.serialize(),
        object: tag.object,
        objectType: tag.objectType,
        name: tag.name,
        message: tag.message,
        ...(tag.tagger !== undefined ? { tagger: tag.tagger } : {}),
    };
}
// ============================================================================
// Type Guards
// ============================================================================
/** Type guard that checks whether a GitObject is a blob. */
export function isBlob(obj) {
    return obj.type === 'blob';
}
/** Type guard that checks whether a GitObject is a tree. */
export function isTree(obj) {
    return obj.type === 'tree';
}
/** Type guard that checks whether a GitObject is a commit. */
export function isCommit(obj) {
    return obj.type === 'commit';
}
/** Type guard that checks whether a GitObject is an annotated tag. */
export function isTag(obj) {
    return obj.type === 'tag';
}
// ============================================================================
// Validation Helpers (Legacy)
// ============================================================================
/**
 * Validate a tree entry object.
 */
export function validateTreeEntry(entry) {
    if (!isValidMode(entry.mode)) {
        return { isValid: false, error: `Invalid mode: ${entry.mode}. Valid modes: ${Array.from(VALID_MODES).join(', ')}` };
    }
    if (!entry.name || typeof entry.name !== 'string') {
        return { isValid: false, error: 'Entry name is required and must be a string' };
    }
    if (entry.name.includes('/') || entry.name.includes('\0')) {
        return { isValid: false, error: 'Entry name cannot contain "/" or null characters' };
    }
    if (!isValidSha(entry.sha)) {
        return { isValid: false, error: `Invalid SHA: ${entry.sha}. Must be 40 lowercase hex characters` };
    }
    return { isValid: true };
}
/**
 * Validate an author object.
 */
export function validateAuthor(author) {
    if (!author.name || typeof author.name !== 'string') {
        return { isValid: false, error: 'Author name is required and must be a string' };
    }
    if (!author.email || typeof author.email !== 'string') {
        return { isValid: false, error: 'Author email is required and must be a string' };
    }
    if (typeof author.timestamp !== 'number' || !Number.isInteger(author.timestamp) || author.timestamp < 0) {
        return { isValid: false, error: 'Timestamp must be a non-negative integer (Unix seconds)' };
    }
    if (!/^[+-]\d{4}$/.test(author.timezone)) {
        return { isValid: false, error: `Invalid timezone format: ${author.timezone}. Expected +/-HHMM (e.g., +0530, -0800)` };
    }
    return { isValid: true };
}
/**
 * Validate a commit object (excluding type and data fields).
 */
export function validateCommit(commit) {
    if (!isValidSha(commit.tree)) {
        return { isValid: false, error: `Invalid tree SHA: ${commit.tree}` };
    }
    for (let i = 0; i < commit.parents.length; i++) {
        const parent = commit.parents[i];
        if (parent === undefined || !isValidSha(parent)) {
            return { isValid: false, error: `Invalid parent SHA at index ${i}: ${parent}` };
        }
    }
    const authorResult = validateAuthor(commit.author);
    if (!authorResult.isValid) {
        return { isValid: false, error: `Invalid author: ${authorResult.error}` };
    }
    const committerResult = validateAuthor(commit.committer);
    if (!committerResult.isValid) {
        return { isValid: false, error: `Invalid committer: ${committerResult.error}` };
    }
    if (typeof commit.message !== 'string') {
        return { isValid: false, error: 'Commit message must be a string' };
    }
    return { isValid: true };
}
/**
 * Validate a tag object (excluding type and data fields).
 */
export function validateTag(tag) {
    if (!isValidSha(tag.object)) {
        return { isValid: false, error: `Invalid object SHA: ${tag.object}` };
    }
    if (!isValidObjectType(tag.objectType)) {
        return { isValid: false, error: `Invalid object type: ${tag.objectType}` };
    }
    if (!tag.name || typeof tag.name !== 'string') {
        return { isValid: false, error: 'Tag name is required and must be a string' };
    }
    if (tag.tagger) {
        const taggerResult = validateAuthor(tag.tagger);
        if (!taggerResult.isValid) {
            return { isValid: false, error: `Invalid tagger: ${taggerResult.error}` };
        }
    }
    if (typeof tag.message !== 'string') {
        return { isValid: false, error: 'Tag message must be a string' };
    }
    return { isValid: true };
}
//# sourceMappingURL=objects.js.map