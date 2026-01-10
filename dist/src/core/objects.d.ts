/**
 * @fileoverview Git Object Types and Serialization (Platform Agnostic)
 *
 * Re-exports from the core objects module with backward compatibility layer.
 *
 * @module @dotdo/gitx/objects
 */
export { GitBlob, GitTree, GitCommit, GitTag, sortTreeEntries, parseTreeEntries, serializeTreeEntries, type TreeEntry, parseIdentity, formatIdentity, hasGpgSignature, parseGpgSignature, type GitIdentity, type ObjectType, type GitObjectData, type BlobData, type TreeData, type CommitData, type TagData, OBJECT_TYPES, VALID_MODES, isValidSha, isValidMode, isValidObjectType, calculateSha1, calculateObjectHash, createObjectHeader, parseObjectHeader, bytesToHex, hexToBytes, compressObject, decompressObject, writeLooseObject, readLooseObject, detectObjectType, parseGitObject, createGitObject, } from '../../core/objects';
import { type ObjectType as CoreObjectType, type TreeEntry as CoreTreeEntry } from '../../core/objects';
/**
 * Base interface for all Git objects.
 * @deprecated Use GitBlob, GitTree, GitCommit, or GitTag classes instead
 */
export interface GitObject {
    type: CoreObjectType;
    data: Uint8Array;
}
/**
 * A Git blob object representing raw file content.
 * @deprecated Use GitBlob class instead
 */
export interface BlobObject extends GitObject {
    type: 'blob';
}
/**
 * A Git tree object representing a directory.
 * @deprecated Use GitTree class instead
 */
export interface TreeObject extends GitObject {
    type: 'tree';
    entries: CoreTreeEntry[];
}
/**
 * Author/committer/tagger information.
 */
export interface Author {
    name: string;
    email: string;
    timestamp: number;
    timezone: string;
}
/**
 * A Git commit object representing a snapshot in history.
 * @deprecated Use GitCommit class instead
 */
export interface CommitObject extends GitObject {
    type: 'commit';
    tree: string;
    parents: string[];
    author: Author;
    committer: Author;
    message: string;
}
/**
 * A Git tag object (annotated tag).
 * @deprecated Use GitTag class instead
 */
export interface TagObject extends GitObject {
    type: 'tag';
    object: string;
    objectType: CoreObjectType;
    tagger?: Author;
    message: string;
    name: string;
    tag?: string;
}
/**
 * Valid SHA-1 hash pattern (40 lowercase hexadecimal characters).
 */
export declare const SHA_PATTERN: RegExp;
/**
 * Serialize blob data to Git object format.
 * @deprecated Use new GitBlob(data).serialize() instead
 */
export declare function serializeBlob(data: Uint8Array): Uint8Array;
/**
 * Serialize tree entries to Git object format.
 * @deprecated Use new GitTree(entries).serialize() instead
 */
export declare function serializeTree(entries: CoreTreeEntry[]): Uint8Array;
/**
 * Serialize commit to Git object format.
 * @deprecated Use new GitCommit(data).serialize() instead
 */
export declare function serializeCommit(commit: Omit<CommitObject, 'type' | 'data'>): Uint8Array;
/**
 * Serialize tag to Git object format.
 * @deprecated Use new GitTag(data).serialize() instead
 */
export declare function serializeTag(tag: Omit<TagObject, 'type' | 'data'>): Uint8Array;
/**
 * Parse blob from serialized format.
 * @deprecated Use GitBlob.parse(data) instead
 */
export declare function parseBlob(data: Uint8Array): BlobObject;
/**
 * Parse tree from serialized format.
 * @deprecated Use GitTree.parse(data) instead
 */
export declare function parseTree(data: Uint8Array): TreeObject;
/**
 * Parse commit from serialized format.
 * @deprecated Use GitCommit.parse(data) instead
 */
export declare function parseCommit(data: Uint8Array): CommitObject;
/**
 * Parse tag from serialized format.
 * @deprecated Use GitTag.parse(data) instead
 */
export declare function parseTag(data: Uint8Array): TagObject;
export declare function isBlob(obj: GitObject): obj is BlobObject;
export declare function isTree(obj: GitObject): obj is TreeObject;
export declare function isCommit(obj: GitObject): obj is CommitObject;
export declare function isTag(obj: GitObject): obj is TagObject;
/**
 * Validate a tree entry object.
 */
export declare function validateTreeEntry(entry: CoreTreeEntry): {
    isValid: boolean;
    error?: string;
};
/**
 * Validate an author object.
 */
export declare function validateAuthor(author: Author): {
    isValid: boolean;
    error?: string;
};
/**
 * Validate a commit object (excluding type and data fields).
 */
export declare function validateCommit(commit: Omit<CommitObject, 'type' | 'data'>): {
    isValid: boolean;
    error?: string;
};
/**
 * Validate a tag object (excluding type and data fields).
 */
export declare function validateTag(tag: Omit<TagObject, 'type' | 'data'>): {
    isValid: boolean;
    error?: string;
};
//# sourceMappingURL=objects.d.ts.map