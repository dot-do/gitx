/**
 * @fileoverview Git Object Types and Serialization
 *
 * This module defines the core Git object types (blob, tree, commit, tag) and provides
 * functions for serializing and deserializing these objects in the Git format.
 *
 * Git uses a content-addressable storage model where each object is identified by
 * its SHA-1 hash. The format for each object type is:
 * - Header: "{type} {size}\0"
 * - Content: type-specific binary data
 *
 * @module types/objects
 *
 * @example
 * ```typescript
 * import { serializeBlob, parseBlob, isBlob } from './types/objects'
 *
 * // Create and serialize a blob
 * const content = new TextEncoder().encode('Hello, World!')
 * const serialized = serializeBlob(content)
 *
 * // Parse it back
 * const blob = parseBlob(serialized)
 * console.log(blob.type) // 'blob'
 * ```
 */
/**
 * The four Git object types.
 *
 * @description
 * - `blob`: Raw file content
 * - `tree`: Directory listing (contains references to blobs and other trees)
 * - `commit`: A snapshot pointing to a tree with metadata (author, message, parents)
 * - `tag`: An annotated tag pointing to another object with metadata
 */
export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag';
/**
 * Base interface for all Git objects.
 *
 * @description
 * All Git objects share a common structure with a type discriminator
 * and raw binary data. The data field contains the object content
 * WITHOUT the Git header (type and size).
 *
 * @property type - The object type discriminator
 * @property data - Raw binary content of the object (excluding header)
 */
export interface GitObject {
    /** The type of Git object */
    type: ObjectType;
    /** Raw binary data of the object content */
    data: Uint8Array;
}
/**
 * A Git blob object representing raw file content.
 *
 * @description
 * Blobs are the simplest Git objects - they just store raw file content.
 * The data field contains the file content as-is, without any transformation.
 *
 * @example
 * ```typescript
 * const blob: BlobObject = {
 *   type: 'blob',
 *   data: new TextEncoder().encode('file content')
 * }
 * ```
 */
export interface BlobObject extends GitObject {
    /** Type discriminator - always 'blob' for blob objects */
    type: 'blob';
}
/**
 * A single entry in a Git tree object.
 *
 * @description
 * Tree entries represent files or subdirectories within a directory.
 * Each entry has a file mode, name, and SHA-1 reference to the content.
 *
 * @property mode - Unix file mode as a string
 * @property name - File or directory name (no path separators)
 * @property sha - 40-character hex SHA-1 of the referenced object
 *
 * @example
 * ```typescript
 * const fileEntry: TreeEntry = {
 *   mode: '100644',    // Regular file
 *   name: 'README.md',
 *   sha: 'abc123...'   // SHA-1 of the blob
 * }
 *
 * const dirEntry: TreeEntry = {
 *   mode: '040000',    // Directory
 *   name: 'src',
 *   sha: 'def456...'   // SHA-1 of another tree
 * }
 * ```
 */
export interface TreeEntry {
    /**
     * Unix file mode string.
     * Common values:
     * - '100644': Regular file
     * - '100755': Executable file
     * - '040000': Directory (subdirectory)
     * - '120000': Symbolic link
     * - '160000': Git submodule (gitlink)
     */
    mode: string;
    /** File or directory name */
    name: string;
    /** 40-character lowercase hex SHA-1 hash of the referenced object */
    sha: string;
}
/**
 * A Git tree object representing a directory.
 *
 * @description
 * Trees are Git's way of representing directories. Each tree contains
 * entries pointing to blobs (files) or other trees (subdirectories).
 * Entries are sorted by name with a special rule for directories.
 *
 * @example
 * ```typescript
 * const tree: TreeObject = {
 *   type: 'tree',
 *   data: rawTreeData,
 *   entries: [
 *     { mode: '100644', name: 'file.txt', sha: '...' },
 *     { mode: '040000', name: 'subdir', sha: '...' }
 *   ]
 * }
 * ```
 */
export interface TreeObject extends GitObject {
    /** Type discriminator - always 'tree' for tree objects */
    type: 'tree';
    /** Parsed tree entries (files and subdirectories) */
    entries: TreeEntry[];
}
/**
 * Author/committer/tagger information.
 *
 * @description
 * Represents identity information used in commits and tags.
 * Includes name, email, Unix timestamp, and timezone offset.
 *
 * @property name - Full name of the person
 * @property email - Email address
 * @property timestamp - Unix timestamp in seconds
 * @property timezone - Timezone offset string (e.g., '+0530', '-0800')
 *
 * @example
 * ```typescript
 * const author: Author = {
 *   name: 'John Doe',
 *   email: 'john@example.com',
 *   timestamp: 1704067200,  // Unix seconds
 *   timezone: '-0800'       // PST
 * }
 * ```
 */
export interface Author {
    /** Full name of the author */
    name: string;
    /** Email address */
    email: string;
    /** Unix timestamp in seconds since epoch */
    timestamp: number;
    /** Timezone offset in +/-HHMM format (e.g., '+0530', '-0800') */
    timezone: string;
}
/**
 * A Git commit object representing a snapshot in history.
 *
 * @description
 * Commits are the core of Git's version control. Each commit points to
 * a tree (representing the project state), has zero or more parent commits,
 * and includes author/committer information with a message.
 *
 * @property tree - SHA-1 of the tree object representing project state
 * @property parents - Array of parent commit SHA-1s (empty for initial commit)
 * @property author - Who created the original changes
 * @property committer - Who created the commit
 * @property message - Commit message describing the changes
 *
 * @example
 * ```typescript
 * const commit: CommitObject = {
 *   type: 'commit',
 *   data: rawCommitData,
 *   tree: 'abc123...',
 *   parents: ['parent1sha...'],
 *   author: { name: 'Alice', email: 'alice@example.com', timestamp: 1704067200, timezone: '+0000' },
 *   committer: { name: 'Alice', email: 'alice@example.com', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Initial commit\n\nAdd project structure'
 * }
 * ```
 */
export interface CommitObject extends GitObject {
    /** Type discriminator - always 'commit' for commit objects */
    type: 'commit';
    /** 40-character hex SHA-1 of the root tree object */
    tree: string;
    /** Array of parent commit SHA-1s (empty for root commit, multiple for merge) */
    parents: string[];
    /** Original author of the changes */
    author: Author;
    /** Person who created this commit (may differ from author in cherry-picks, rebases) */
    committer: Author;
    /** Commit message including subject line and optional body */
    message: string;
}
/**
 * A Git tag object (annotated tag).
 *
 * @description
 * Annotated tags are Git objects that contain metadata about a tag,
 * including who created it, when, and an optional message. They can
 * point to any Git object (usually commits).
 *
 * Note: Lightweight tags are just refs pointing directly to commits,
 * not tag objects.
 *
 * @property object - SHA-1 of the tagged object
 * @property objectType - Type of the tagged object
 * @property tagger - Who created the tag (optional for some tags)
 * @property message - Tag message/annotation
 * @property name - Tag name
 * @property tag - Alternative tag name field (deprecated, use name)
 *
 * @example
 * ```typescript
 * const tag: TagObject = {
 *   type: 'tag',
 *   data: rawTagData,
 *   object: 'commitsha...',
 *   objectType: 'commit',
 *   name: 'v1.0.0',
 *   tagger: { name: 'Bob', email: 'bob@example.com', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Release version 1.0.0'
 * }
 * ```
 */
export interface TagObject extends GitObject {
    /** Type discriminator - always 'tag' for tag objects */
    type: 'tag';
    /** 40-character hex SHA-1 of the tagged object */
    object: string;
    /** Type of the object being tagged */
    objectType: ObjectType;
    /** Tag creator information (optional for lightweight-style annotated tags) */
    tagger?: Author;
    /** Tag annotation message */
    message: string;
    /** Tag name (e.g., 'v1.0.0') */
    name: string;
    /** Alternative tag name field (deprecated, prefer 'name') */
    tag?: string;
}
/**
 * Type guard to check if a GitObject is a BlobObject.
 *
 * @description
 * Narrows the type of a GitObject to BlobObject based on the type field.
 *
 * @param obj - The Git object to check
 * @returns True if the object is a blob, false otherwise
 *
 * @example
 * ```typescript
 * const obj: GitObject = getObject(sha)
 * if (isBlob(obj)) {
 *   // obj is now typed as BlobObject
 *   const content = new TextDecoder().decode(obj.data)
 * }
 * ```
 */
export declare function isBlob(obj: GitObject): obj is BlobObject;
/**
 * Type guard to check if a GitObject is a TreeObject.
 *
 * @description
 * Narrows the type of a GitObject to TreeObject based on the type field.
 *
 * @param obj - The Git object to check
 * @returns True if the object is a tree, false otherwise
 *
 * @example
 * ```typescript
 * const obj: GitObject = getObject(sha)
 * if (isTree(obj)) {
 *   // obj is now typed as TreeObject
 *   for (const entry of obj.entries) {
 *     console.log(entry.name, entry.mode)
 *   }
 * }
 * ```
 */
export declare function isTree(obj: GitObject): obj is TreeObject;
/**
 * Type guard to check if a GitObject is a CommitObject.
 *
 * @description
 * Narrows the type of a GitObject to CommitObject based on the type field.
 *
 * @param obj - The Git object to check
 * @returns True if the object is a commit, false otherwise
 *
 * @example
 * ```typescript
 * const obj: GitObject = getObject(sha)
 * if (isCommit(obj)) {
 *   // obj is now typed as CommitObject
 *   console.log(obj.message, obj.author.name)
 * }
 * ```
 */
export declare function isCommit(obj: GitObject): obj is CommitObject;
/**
 * Type guard to check if a GitObject is a TagObject.
 *
 * @description
 * Narrows the type of a GitObject to TagObject based on the type field.
 *
 * @param obj - The Git object to check
 * @returns True if the object is a tag, false otherwise
 *
 * @example
 * ```typescript
 * const obj: GitObject = getObject(sha)
 * if (isTag(obj)) {
 *   // obj is now typed as TagObject
 *   console.log(obj.name, obj.message)
 * }
 * ```
 */
export declare function isTag(obj: GitObject): obj is TagObject;
/**
 * Serialize raw blob data into Git blob object format.
 *
 * @description
 * Creates a complete Git blob object with header: "blob {size}\0{content}"
 * This format is used for hashing and storage.
 *
 * @param data - Raw file content as binary data
 * @returns Complete blob object with Git header
 *
 * @example
 * ```typescript
 * const content = new TextEncoder().encode('Hello, World!')
 * const blob = serializeBlob(content)
 * // blob contains: "blob 13\0Hello, World!"
 *
 * // Hash it to get the SHA
 * const sha = await sha1(blob)
 * ```
 */
export declare function serializeBlob(data: Uint8Array): Uint8Array;
/**
 * Serialize tree entries into Git tree object format.
 *
 * @description
 * Creates a complete Git tree object with header and sorted entries.
 * Each entry format: "{mode} {name}\0{20-byte-sha}"
 * Entries are sorted by name with directories treated as having trailing slashes.
 *
 * @param entries - Array of tree entries to serialize
 * @returns Complete tree object with Git header
 *
 * @example
 * ```typescript
 * const entries: TreeEntry[] = [
 *   { mode: '100644', name: 'file.txt', sha: 'abc...' },
 *   { mode: '040000', name: 'src', sha: 'def...' }
 * ]
 * const tree = serializeTree(entries)
 * const sha = await sha1(tree)
 * ```
 */
export declare function serializeTree(entries: TreeEntry[]): Uint8Array;
/**
 * Serialize commit data into Git commit object format.
 *
 * @description
 * Creates a complete Git commit object with header and formatted content.
 * The content includes tree SHA, parent SHAs, author, committer, and message.
 *
 * @param commit - Commit data (without 'type' and 'data' fields)
 * @returns Complete commit object with Git header
 *
 * @example
 * ```typescript
 * const commit = serializeCommit({
 *   tree: 'abc123...',
 *   parents: ['parent1...'],
 *   author: { name: 'Alice', email: 'alice@example.com', timestamp: 1704067200, timezone: '+0000' },
 *   committer: { name: 'Alice', email: 'alice@example.com', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Initial commit'
 * })
 * const sha = await sha1(commit)
 * ```
 */
export declare function serializeCommit(commit: Omit<CommitObject, 'type' | 'data'>): Uint8Array;
/**
 * Serialize tag data into Git tag object format.
 *
 * @description
 * Creates a complete Git tag object with header and formatted content.
 * The content includes object SHA, object type, tag name, tagger (optional), and message.
 *
 * @param tag - Tag data (without 'type' and 'data' fields)
 * @returns Complete tag object with Git header
 *
 * @example
 * ```typescript
 * const tag = serializeTag({
 *   object: 'commitsha...',
 *   objectType: 'commit',
 *   name: 'v1.0.0',
 *   tagger: { name: 'Bob', email: 'bob@example.com', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Release v1.0.0'
 * })
 * const sha = await sha1(tag)
 * ```
 */
export declare function serializeTag(tag: Omit<TagObject, 'type' | 'data'>): Uint8Array;
/**
 * Parse a Git blob object from its serialized format.
 *
 * @description
 * Parses a complete Git blob object (with header) back into a BlobObject.
 * Validates the header format and extracts the content.
 *
 * @param data - Complete blob object data including Git header
 * @returns Parsed BlobObject
 * @throws Error if the data is not a valid blob object (missing null byte or invalid header)
 *
 * @example
 * ```typescript
 * const rawBlob = await storage.getObject(sha)
 * const blob = parseBlob(rawBlob)
 * const content = new TextDecoder().decode(blob.data)
 * ```
 */
export declare function parseBlob(data: Uint8Array): BlobObject;
/**
 * Parse a Git tree object from its serialized format.
 *
 * @description
 * Parses a complete Git tree object (with header) back into a TreeObject.
 * Extracts all tree entries with their modes, names, and SHA references.
 *
 * @param data - Complete tree object data including Git header
 * @returns Parsed TreeObject with entries array
 * @throws Error if the data is not a valid tree object (missing null byte or invalid header)
 *
 * @example
 * ```typescript
 * const rawTree = await storage.getObject(sha)
 * const tree = parseTree(rawTree)
 * for (const entry of tree.entries) {
 *   console.log(`${entry.mode} ${entry.name} ${entry.sha}`)
 * }
 * ```
 */
export declare function parseTree(data: Uint8Array): TreeObject;
/**
 * Parse a Git commit object from its serialized format.
 *
 * @description
 * Parses a complete Git commit object (with header) back into a CommitObject.
 * Extracts tree SHA, parent SHAs, author, committer, and message.
 *
 * @param data - Complete commit object data including Git header
 * @returns Parsed CommitObject
 * @throws Error if the data is not a valid commit object (missing null byte, invalid header, or missing author/committer)
 *
 * @example
 * ```typescript
 * const rawCommit = await storage.getObject(sha)
 * const commit = parseCommit(rawCommit)
 * console.log(`Author: ${commit.author.name}`)
 * console.log(`Message: ${commit.message}`)
 * console.log(`Parents: ${commit.parents.length}`)
 * ```
 */
export declare function parseCommit(data: Uint8Array): CommitObject;
/**
 * Parse a Git tag object from its serialized format.
 *
 * @description
 * Parses a complete Git tag object (with header) back into a TagObject.
 * Extracts object SHA, object type, tag name, tagger, and message.
 *
 * @param data - Complete tag object data including Git header
 * @returns Parsed TagObject
 * @throws Error if the data is not a valid tag object (missing null byte, invalid header, or missing tagger)
 *
 * @example
 * ```typescript
 * const rawTag = await storage.getObject(sha)
 * const tag = parseTag(rawTag)
 * console.log(`Tag: ${tag.name}`)
 * console.log(`Points to: ${tag.object} (${tag.objectType})`)
 * console.log(`Message: ${tag.message}`)
 * ```
 */
export declare function parseTag(data: Uint8Array): TagObject;
//# sourceMappingURL=objects.d.ts.map