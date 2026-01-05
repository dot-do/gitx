/**
 * @fileoverview Git Object Store for Durable Objects
 *
 * This module provides a Git object storage implementation backed by SQLite
 * within Cloudflare Durable Objects. It handles CRUD operations for all four
 * Git object types (blob, tree, commit, tag) with proper SHA-1 hash computation.
 *
 * **Key Features**:
 * - Content-addressable storage using SHA-1 hashes
 * - Write-ahead logging (WAL) for durability
 * - Object index for tiered storage support
 * - Batch operations for efficiency
 * - Typed accessors for each Git object type
 *
 * @module durable-object/object-store
 *
 * @example
 * ```typescript
 * import { ObjectStore } from './durable-object/object-store'
 *
 * const store = new ObjectStore(durableObjectStorage)
 *
 * // Store a blob
 * const content = new TextEncoder().encode('Hello, World!')
 * const sha = await store.putObject('blob', content)
 *
 * // Retrieve it
 * const obj = await store.getObject(sha)
 * console.log(obj?.type, obj?.size)
 *
 * // Get typed object
 * const blob = await store.getBlobObject(sha)
 * ```
 */
import { DurableObjectStorage } from './schema';
import { ObjectType, BlobObject, TreeObject, CommitObject, TagObject, TreeEntry, Author } from '../types/objects';
/**
 * Stored object record as persisted in SQLite.
 *
 * @description
 * Represents a Git object with metadata as stored in the database.
 * The `data` field contains the object content WITHOUT the Git header.
 *
 * @example
 * ```typescript
 * const obj: StoredObject = {
 *   sha: 'abc123...',
 *   type: 'blob',
 *   size: 13,
 *   data: new Uint8Array([...]),
 *   createdAt: 1704067200000
 * }
 * ```
 */
export interface StoredObject {
    /** 40-character SHA-1 hash (primary key) */
    sha: string;
    /** Object type: 'blob', 'tree', 'commit', or 'tag' */
    type: ObjectType;
    /** Size of the data in bytes */
    size: number;
    /** Raw object content (without Git header) */
    data: Uint8Array;
    /** Unix timestamp (milliseconds) when object was created */
    createdAt: number;
}
/**
 * ObjectStore class for managing Git objects in SQLite storage.
 *
 * @description
 * Provides a complete implementation of Git object storage operations.
 * All objects are stored in the `objects` table and indexed in `object_index`
 * for tiered storage support. Write operations are logged to WAL for durability.
 *
 * @example
 * ```typescript
 * const store = new ObjectStore(durableObjectStorage)
 *
 * // Create a commit
 * const commitSha = await store.putCommitObject({
 *   tree: treeSha,
 *   parents: [parentSha],
 *   author: { name: 'Alice', email: 'alice@example.com', timestamp: 1704067200, timezone: '+0000' },
 *   committer: { name: 'Alice', email: 'alice@example.com', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Initial commit'
 * })
 *
 * // Read it back
 * const commit = await store.getCommitObject(commitSha)
 * console.log(commit?.message)
 * ```
 */
export declare class ObjectStore {
    private storage;
    /**
     * Create a new ObjectStore.
     *
     * @param storage - Durable Object storage interface with SQL support
     */
    constructor(storage: DurableObjectStorage);
    /**
     * Store a raw object and return its SHA.
     *
     * @description
     * Computes the SHA-1 hash of the object in Git format (type + size + content),
     * logs the operation to WAL, stores the object, and updates the object index.
     * If an object with the same SHA already exists, it is replaced (idempotent).
     *
     * @param type - Object type ('blob', 'tree', 'commit', 'tag')
     * @param data - Raw object content (without Git header)
     * @returns 40-character SHA-1 hash of the stored object
     *
     * @example
     * ```typescript
     * const content = new TextEncoder().encode('file content')
     * const sha = await store.putObject('blob', content)
     * console.log(`Stored blob: ${sha}`)
     * ```
     */
    putObject(type: ObjectType, data: Uint8Array): Promise<string>;
    /**
     * Store a tree object with entries.
     *
     * @description
     * Creates a Git tree object from an array of entries. Entries are sorted
     * by name (with directories treated as having trailing slashes for sorting).
     * Each entry is serialized as: "{mode} {name}\0{20-byte-sha}"
     *
     * @param entries - Array of tree entries (files and subdirectories)
     * @returns 40-character SHA-1 hash of the stored tree
     *
     * @example
     * ```typescript
     * const treeSha = await store.putTreeObject([
     *   { mode: '100644', name: 'README.md', sha: blobSha },
     *   { mode: '040000', name: 'src', sha: subdirSha }
     * ])
     * ```
     */
    putTreeObject(entries: TreeEntry[]): Promise<string>;
    /**
     * Store a commit object.
     *
     * @description
     * Creates a Git commit object with the specified tree, parents, author,
     * committer, and message. The commit content is formatted according to
     * the Git commit format specification.
     *
     * @param commit - Commit data
     * @param commit.tree - SHA of the root tree object
     * @param commit.parents - Array of parent commit SHAs (empty for root commit)
     * @param commit.author - Author information
     * @param commit.committer - Committer information
     * @param commit.message - Commit message
     * @returns 40-character SHA-1 hash of the stored commit
     *
     * @example
     * ```typescript
     * const now = Math.floor(Date.now() / 1000)
     * const author = { name: 'Alice', email: 'alice@example.com', timestamp: now, timezone: '+0000' }
     *
     * const sha = await store.putCommitObject({
     *   tree: treeSha,
     *   parents: [],
     *   author,
     *   committer: author,
     *   message: 'Initial commit\n\nThis is the first commit.'
     * })
     * ```
     */
    putCommitObject(commit: {
        tree: string;
        parents: string[];
        author: Author;
        committer: Author;
        message: string;
    }): Promise<string>;
    /**
     * Store a tag object (annotated tag).
     *
     * @description
     * Creates a Git tag object pointing to another object with tagger
     * information and a message. The tag content is formatted according
     * to the Git tag format specification.
     *
     * @param tag - Tag data
     * @param tag.object - SHA of the object being tagged
     * @param tag.objectType - Type of the object being tagged
     * @param tag.tagger - Tagger information
     * @param tag.message - Tag message
     * @param tag.name - Tag name
     * @returns 40-character SHA-1 hash of the stored tag object
     *
     * @example
     * ```typescript
     * const now = Math.floor(Date.now() / 1000)
     * const tagger = { name: 'Bob', email: 'bob@example.com', timestamp: now, timezone: '+0000' }
     *
     * const sha = await store.putTagObject({
     *   object: commitSha,
     *   objectType: 'commit',
     *   tagger,
     *   message: 'Release v1.0.0',
     *   name: 'v1.0.0'
     * })
     * ```
     */
    putTagObject(tag: {
        object: string;
        objectType: ObjectType;
        tagger: Author;
        message: string;
        name: string;
    }): Promise<string>;
    /**
     * Retrieve an object by SHA.
     *
     * @description
     * Fetches an object from the database by its SHA-1 hash.
     * Returns null if the object doesn't exist or if the SHA is invalid.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns The stored object or null if not found
     *
     * @example
     * ```typescript
     * const obj = await store.getObject(sha)
     * if (obj) {
     *   console.log(`Found ${obj.type} of ${obj.size} bytes`)
     * }
     * ```
     */
    getObject(sha: string): Promise<StoredObject | null>;
    /**
     * Delete an object by SHA.
     *
     * @description
     * Removes an object from both the objects table and the object index.
     * The operation is logged to WAL. Returns false if the object doesn't exist.
     *
     * **Warning**: Deleting objects that are still referenced by other objects
     * (e.g., blobs referenced by trees) will corrupt the repository.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns True if the object was deleted, false if it didn't exist
     *
     * @example
     * ```typescript
     * const deleted = await store.deleteObject(sha)
     * if (deleted) {
     *   console.log('Object removed')
     * }
     * ```
     */
    deleteObject(sha: string): Promise<boolean>;
    /**
     * Check if an object exists.
     *
     * @description
     * Efficiently checks for object existence without fetching the full content.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns True if the object exists, false otherwise
     *
     * @example
     * ```typescript
     * if (await store.hasObject(sha)) {
     *   console.log('Object exists')
     * }
     * ```
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Verify an object's integrity by recomputing its hash.
     *
     * @description
     * Computes the SHA-1 hash of the stored object and compares it
     * to the stored SHA. Returns false if the object is corrupted
     * or doesn't exist.
     *
     * @param sha - 40-character SHA-1 hash to verify
     * @returns True if the computed hash matches, false otherwise
     *
     * @example
     * ```typescript
     * if (await store.verifyObject(sha)) {
     *   console.log('Object integrity verified')
     * } else {
     *   console.log('Object is corrupted or missing')
     * }
     * ```
     */
    verifyObject(sha: string): Promise<boolean>;
    /**
     * Get object type by SHA.
     *
     * @description
     * Returns just the type of an object without fetching its content.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns Object type or null if not found
     *
     * @example
     * ```typescript
     * const type = await store.getObjectType(sha)
     * if (type === 'commit') {
     *   // Handle commit
     * }
     * ```
     */
    getObjectType(sha: string): Promise<ObjectType | null>;
    /**
     * Get object size by SHA.
     *
     * @description
     * Returns just the size of an object without fetching its content.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns Object size in bytes or null if not found
     *
     * @example
     * ```typescript
     * const size = await store.getObjectSize(sha)
     * console.log(`Object is ${size} bytes`)
     * ```
     */
    getObjectSize(sha: string): Promise<number | null>;
    /**
     * Store multiple objects in a batch.
     *
     * @description
     * Stores multiple objects sequentially. Each object is stored
     * individually with its own WAL entry. For atomic batch operations,
     * consider wrapping in a transaction.
     *
     * @param objects - Array of objects to store
     * @returns Array of SHA-1 hashes in the same order as input
     *
     * @example
     * ```typescript
     * const shas = await store.putObjects([
     *   { type: 'blob', data: content1 },
     *   { type: 'blob', data: content2 }
     * ])
     * ```
     */
    putObjects(objects: {
        type: ObjectType;
        data: Uint8Array;
    }[]): Promise<string[]>;
    /**
     * Retrieve multiple objects by SHA.
     *
     * @description
     * Fetches multiple objects by their SHAs. Missing objects
     * are returned as null in the result array.
     *
     * @param shas - Array of 40-character SHA-1 hashes
     * @returns Array of objects (or null for missing) in the same order
     *
     * @example
     * ```typescript
     * const objects = await store.getObjects([sha1, sha2, sha3])
     * objects.forEach((obj, i) => {
     *   if (obj) {
     *     console.log(`${i}: ${obj.type}`)
     *   }
     * })
     * ```
     */
    getObjects(shas: string[]): Promise<(StoredObject | null)[]>;
    /**
     * Get a blob object with typed result.
     *
     * @description
     * Fetches an object and returns it as a BlobObject if it's a blob.
     * Returns null if the object doesn't exist or isn't a blob.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns Typed BlobObject or null
     *
     * @example
     * ```typescript
     * const blob = await store.getBlobObject(sha)
     * if (blob) {
     *   const content = new TextDecoder().decode(blob.data)
     *   console.log(content)
     * }
     * ```
     */
    getBlobObject(sha: string): Promise<BlobObject | null>;
    /**
     * Get a tree object with parsed entries.
     *
     * @description
     * Fetches and parses a tree object, extracting all entries
     * with their modes, names, and SHA references.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns Parsed TreeObject with entries or null
     *
     * @example
     * ```typescript
     * const tree = await store.getTreeObject(sha)
     * if (tree) {
     *   for (const entry of tree.entries) {
     *     console.log(`${entry.mode} ${entry.name} ${entry.sha}`)
     *   }
     * }
     * ```
     */
    getTreeObject(sha: string): Promise<TreeObject | null>;
    /**
     * Get a commit object with parsed fields.
     *
     * @description
     * Fetches and parses a commit object, extracting tree SHA,
     * parent SHAs, author, committer, and message.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns Parsed CommitObject or null
     *
     * @example
     * ```typescript
     * const commit = await store.getCommitObject(sha)
     * if (commit) {
     *   console.log(`Author: ${commit.author.name}`)
     *   console.log(`Message: ${commit.message}`)
     *   console.log(`Parents: ${commit.parents.length}`)
     * }
     * ```
     */
    getCommitObject(sha: string): Promise<CommitObject | null>;
    /**
     * Get a tag object with parsed fields.
     *
     * @description
     * Fetches and parses an annotated tag object, extracting
     * the tagged object SHA, object type, tag name, tagger, and message.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns Parsed TagObject or null
     *
     * @example
     * ```typescript
     * const tag = await store.getTagObject(sha)
     * if (tag) {
     *   console.log(`Tag: ${tag.name}`)
     *   console.log(`Points to: ${tag.object} (${tag.objectType})`)
     *   console.log(`Tagger: ${tag.tagger?.name}`)
     * }
     * ```
     */
    getTagObject(sha: string): Promise<TagObject | null>;
    /**
     * Get raw serialized object with Git header.
     *
     * @description
     * Returns the complete Git object format including header:
     * "{type} {size}\0{content}"
     *
     * This is the format used for hashing and storage in pack files.
     *
     * @param sha - 40-character SHA-1 hash
     * @returns Complete object with Git header or null
     *
     * @example
     * ```typescript
     * const raw = await store.getRawObject(sha)
     * if (raw) {
     *   // Can be written directly to a pack file or loose object
     * }
     * ```
     */
    getRawObject(sha: string): Promise<Uint8Array | null>;
    /**
     * Log operation to WAL.
     *
     * @description
     * Writes an operation entry to the write-ahead log for durability.
     * The WAL ensures operations can be recovered after crashes.
     *
     * @param operation - Operation type ('PUT', 'DELETE', etc.)
     * @param sha - Object SHA being operated on
     * @param type - Object type
     * @param _data - Object data (not stored in WAL, just for signature compatibility)
     * @internal
     */
    private logToWAL;
}
//# sourceMappingURL=object-store.d.ts.map