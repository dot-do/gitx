/**
 * @fileoverview Git Tag Operations
 *
 * Implements lightweight and annotated tag operations with
 * support for GPG signatures, pattern filtering, and version sorting.
 *
 * ## Features
 *
 * - Create lightweight tags (ref pointing directly to commit)
 * - Create annotated tags (tag object with message)
 * - GPG signing and verification
 * - Tag listing with pattern filtering
 * - Version-based sorting
 * - Nested tag resolution
 *
 * ## Tag Types
 *
 * Git supports two types of tags:
 *
 * - **Lightweight tags**: Simply a ref pointing to a commit
 * - **Annotated tags**: A tag object with tagger info, message, and optional signature
 *
 * ## Usage Example
 *
 * ```typescript
 * import { createLightweightTag, createAnnotatedTag, listTags } from './ops/tag'
 *
 * // Create a lightweight tag
 * await createLightweightTag(store, {
 *   name: 'v1.0.0',
 *   target: commitSha
 * })
 *
 * // Create an annotated tag
 * await createAnnotatedTag(store, {
 *   name: 'v2.0.0',
 *   target: commitSha,
 *   message: 'Release version 2.0.0',
 *   tagger: { name: 'John Doe', email: 'john@example.com' }
 * })
 *
 * // List tags matching pattern
 * const tags = await listTags(store, { pattern: 'v*', sortByVersion: true })
 * ```
 *
 * @module ops/tag
 */
import { Author, ObjectType, TagObject } from '../types/objects';
import type { RefObjectStore as ObjectStore } from '../types/storage';
/**
 * Options for creating a lightweight tag.
 *
 * A lightweight tag is simply a ref pointing directly to a commit.
 *
 * @interface TagOptions
 *
 * @example
 * ```typescript
 * const options: TagOptions = {
 *   name: 'v1.0.0',
 *   target: 'abc123def456...',
 *   verify: true,
 *   force: false
 * }
 * ```
 */
export interface TagOptions {
    /** Tag name (without refs/tags/ prefix) */
    name: string;
    /** Target commit SHA */
    target: string;
    /**
     * If true, verify that the target exists before creating.
     * @default false
     */
    verify?: boolean;
    /**
     * If true, overwrite existing tag with same name.
     * @default false
     */
    force?: boolean;
}
/**
 * Options for signing a tag
 */
export interface SigningOptions {
    sign: boolean;
    keyId?: string;
    signer?: (data: Uint8Array, keyId?: string) => Promise<string>;
}
/**
 * Options for creating an annotated tag
 */
export interface AnnotatedTagOptions extends TagOptions {
    message: string;
    tagger: Partial<Author> & {
        name: string;
        email: string;
    };
    targetType?: ObjectType;
    signing?: SigningOptions;
}
/**
 * Result of creating a tag
 */
export interface TagResult {
    name: string;
    target: string;
    isAnnotated: boolean;
    tagSha?: string;
    signed?: boolean;
}
/**
 * Options for listing tags
 */
export interface TagListOptions {
    pattern?: string;
    sortByVersion?: boolean;
    pointsAt?: string;
    limit?: number;
}
/**
 * Entry in the tag list
 */
export interface TagListEntry {
    name: string;
    sha: string;
    isAnnotated: boolean;
    target?: string;
}
/**
 * Options for verifying a tag
 */
export interface TagVerifyOptions {
    verifier?: (data: Uint8Array, signature: string) => Promise<{
        valid: boolean;
        keyId?: string;
        signer?: string;
        error?: string;
    }>;
}
/**
 * Result of verifying a tag
 */
export interface TagVerifyResult {
    valid: boolean;
    signed: boolean;
    keyId?: string;
    signer?: string;
    error?: string;
}
/**
 * Represents a tag (can be lightweight or annotated)
 */
export interface TagInfo {
    name: string;
    target: string;
    isAnnotated: boolean;
    sha?: string;
    objectType?: ObjectType;
    tagger?: Author;
    message?: string;
    signature?: string;
}
/**
 * Result of deleting a tag
 */
export interface DeleteTagResult {
    deleted: boolean;
    name: string;
    sha?: string;
}
/**
 * Options for deleting a tag
 */
export interface DeleteTagOptions {
    force?: boolean;
}
/**
 * ObjectStore interface for tag operations.
 * Re-exported from storage types for convenience.
 */
export type { ObjectStore };
/**
 * Create a lightweight tag
 */
export declare function createLightweightTag(store: ObjectStore, options: TagOptions): Promise<TagResult>;
/**
 * Create an annotated tag
 */
export declare function createAnnotatedTag(store: ObjectStore, options: AnnotatedTagOptions): Promise<TagResult>;
/**
 * Build a tag object without storing it
 */
export declare function buildTagObject(options: AnnotatedTagOptions): TagObject;
/**
 * Delete a tag
 */
export declare function deleteTag(store: ObjectStore, name: string, options?: DeleteTagOptions): Promise<DeleteTagResult>;
/**
 * List tags
 */
export declare function listTags(store: ObjectStore, options?: TagListOptions): Promise<TagListEntry[]>;
/**
 * Get a tag by name
 */
export declare function getTag(store: ObjectStore, name: string): Promise<TagInfo | null>;
/**
 * Verify a tag's signature
 */
export declare function verifyTag(store: ObjectStore, name: string, options?: TagVerifyOptions): Promise<TagVerifyResult>;
/**
 * Parse a tag object from raw data
 */
export declare function parseTagObject(data: Uint8Array): {
    object: string;
    objectType: ObjectType;
    tag: string;
    tagger?: Author;
    message: string;
    signature?: string;
};
/**
 * Format a tag message with cleanup options
 */
export declare function formatTagMessage(message: string, options?: {
    cleanup?: boolean;
    commentChar?: string;
}): string;
/**
 * Check if a tag is an annotated tag
 */
export declare function isAnnotatedTag(store: ObjectStore, name: string): Promise<boolean>;
/**
 * Get the target SHA for a tag
 */
export declare function getTagTarget(store: ObjectStore, name: string): Promise<string>;
/**
 * Get the tagger info for a tag
 */
export declare function getTagTagger(store: ObjectStore, name: string): Promise<Author | null>;
/**
 * Resolve a tag to its final commit SHA
 * Follows nested tags until reaching a commit
 */
export declare function resolveTagToCommit(store: ObjectStore, name: string, depth?: number): Promise<string>;
//# sourceMappingURL=tag.d.ts.map