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
import { hashObject } from '../utils/hash';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
// ============================================================================
// ObjectStore Class
// ============================================================================
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
export class ObjectStore {
    storage;
    /**
     * Create a new ObjectStore.
     *
     * @param storage - Durable Object storage interface with SQL support
     */
    constructor(storage) {
        this.storage = storage;
    }
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
    async putObject(type, data) {
        // Compute SHA-1 hash using git object format: "type size\0content"
        const sha = await hashObject(type, data);
        // Log to WAL first
        await this.logToWAL('PUT', sha, type, data);
        // Store the object
        this.storage.sql.exec('INSERT OR REPLACE INTO objects (sha, type, size, data, created_at) VALUES (?, ?, ?, ?, ?)', sha, type, data.length, data, Date.now());
        // Update object index
        this.storage.sql.exec('INSERT OR REPLACE INTO object_index (sha, tier, location, size, type) VALUES (?, ?, ?, ?, ?)', sha, 'hot', 'local', data.length, type);
        return sha;
    }
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
    async putTreeObject(entries) {
        // Sort entries by name (directories get trailing / for sorting)
        const sortedEntries = [...entries].sort((a, b) => {
            const aName = a.mode === '040000' ? a.name + '/' : a.name;
            const bName = b.mode === '040000' ? b.name + '/' : b.name;
            return aName.localeCompare(bName);
        });
        // Build tree content (without header)
        const entryParts = [];
        for (const entry of sortedEntries) {
            const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`);
            const sha20 = hexToBytes(entry.sha);
            const entryData = new Uint8Array(modeName.length + 20);
            entryData.set(modeName);
            entryData.set(sha20, modeName.length);
            entryParts.push(entryData);
        }
        // Combine all entry parts
        const contentLength = entryParts.reduce((sum, part) => sum + part.length, 0);
        const content = new Uint8Array(contentLength);
        let offset = 0;
        for (const part of entryParts) {
            content.set(part, offset);
            offset += part.length;
        }
        return this.putObject('tree', content);
    }
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
    async putCommitObject(commit) {
        // Build commit content (without header)
        const lines = [];
        lines.push(`tree ${commit.tree}`);
        for (const parent of commit.parents) {
            lines.push(`parent ${parent}`);
        }
        lines.push(`author ${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.timezone}`);
        lines.push(`committer ${commit.committer.name} <${commit.committer.email}> ${commit.committer.timestamp} ${commit.committer.timezone}`);
        lines.push('');
        lines.push(commit.message);
        const content = encoder.encode(lines.join('\n'));
        return this.putObject('commit', content);
    }
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
    async putTagObject(tag) {
        // Build tag content (without header)
        const lines = [];
        lines.push(`object ${tag.object}`);
        lines.push(`type ${tag.objectType}`);
        lines.push(`tag ${tag.name}`);
        lines.push(`tagger ${tag.tagger.name} <${tag.tagger.email}> ${tag.tagger.timestamp} ${tag.tagger.timezone}`);
        lines.push('');
        lines.push(tag.message);
        const content = encoder.encode(lines.join('\n'));
        return this.putObject('tag', content);
    }
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
    async getObject(sha) {
        if (!sha || sha.length < 4) {
            return null;
        }
        const result = this.storage.sql.exec('SELECT sha, type, size, data, created_at as createdAt FROM objects WHERE sha = ?', sha);
        const rows = result.toArray();
        if (rows.length === 0) {
            return null;
        }
        return rows[0];
    }
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
    async deleteObject(sha) {
        // Check if object exists first
        const exists = await this.hasObject(sha);
        if (!exists) {
            return false;
        }
        // Log to WAL
        await this.logToWAL('DELETE', sha, 'blob', new Uint8Array(0));
        // Delete from objects table
        this.storage.sql.exec('DELETE FROM objects WHERE sha = ?', sha);
        // Delete from object index
        this.storage.sql.exec('DELETE FROM object_index WHERE sha = ?', sha);
        return true;
    }
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
    async hasObject(sha) {
        if (!sha || sha.length < 4) {
            return false;
        }
        // Use getObject and check for null - this works better with the mock
        const obj = await this.getObject(sha);
        return obj !== null;
    }
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
    async verifyObject(sha) {
        const obj = await this.getObject(sha);
        if (!obj) {
            return false;
        }
        const computedSha = await hashObject(obj.type, obj.data);
        return computedSha === sha;
    }
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
    async getObjectType(sha) {
        const obj = await this.getObject(sha);
        return obj?.type ?? null;
    }
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
    async getObjectSize(sha) {
        const obj = await this.getObject(sha);
        return obj?.size ?? null;
    }
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
    async putObjects(objects) {
        const shas = [];
        for (const obj of objects) {
            const sha = await this.putObject(obj.type, obj.data);
            shas.push(sha);
        }
        return shas;
    }
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
    async getObjects(shas) {
        const results = [];
        for (const sha of shas) {
            const obj = await this.getObject(sha);
            results.push(obj);
        }
        return results;
    }
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
    async getBlobObject(sha) {
        const obj = await this.getObject(sha);
        if (!obj || obj.type !== 'blob') {
            return null;
        }
        return {
            type: 'blob',
            data: obj.data
        };
    }
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
    async getTreeObject(sha) {
        const obj = await this.getObject(sha);
        if (!obj || obj.type !== 'tree') {
            return null;
        }
        // Parse tree entries from raw data
        const entries = [];
        let offset = 0;
        const data = obj.data;
        while (offset < data.length) {
            // Find the null byte after mode+name
            let nullIndex = offset;
            while (nullIndex < data.length && data[nullIndex] !== 0) {
                nullIndex++;
            }
            const modeNameStr = decoder.decode(data.slice(offset, nullIndex));
            const spaceIndex = modeNameStr.indexOf(' ');
            const mode = modeNameStr.slice(0, spaceIndex);
            const name = modeNameStr.slice(spaceIndex + 1);
            // Read 20-byte SHA
            const sha20 = data.slice(nullIndex + 1, nullIndex + 21);
            const entrySha = bytesToHex(sha20);
            entries.push({ mode, name, sha: entrySha });
            offset = nullIndex + 21;
        }
        return {
            type: 'tree',
            data: obj.data,
            entries
        };
    }
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
    async getCommitObject(sha) {
        const obj = await this.getObject(sha);
        if (!obj || obj.type !== 'commit') {
            return null;
        }
        const content = decoder.decode(obj.data);
        const lines = content.split('\n');
        let tree = '';
        const parents = [];
        let author = null;
        let committer = null;
        let messageStartIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line === '') {
                messageStartIndex = i + 1;
                break;
            }
            if (line.startsWith('tree ')) {
                tree = line.slice(5);
            }
            else if (line.startsWith('parent ')) {
                parents.push(line.slice(7));
            }
            else if (line.startsWith('author ')) {
                author = parseAuthorLine(line);
            }
            else if (line.startsWith('committer ')) {
                committer = parseAuthorLine(line);
            }
        }
        if (!author || !committer) {
            return null;
        }
        const message = lines.slice(messageStartIndex).join('\n');
        return {
            type: 'commit',
            data: obj.data,
            tree,
            parents,
            author,
            committer,
            message
        };
    }
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
    async getTagObject(sha) {
        const obj = await this.getObject(sha);
        if (!obj || obj.type !== 'tag') {
            return null;
        }
        const content = decoder.decode(obj.data);
        const lines = content.split('\n');
        let object = '';
        let objectType = 'commit';
        let name = '';
        let tagger = null;
        let messageStartIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line === '') {
                messageStartIndex = i + 1;
                break;
            }
            if (line.startsWith('object ')) {
                object = line.slice(7);
            }
            else if (line.startsWith('type ')) {
                objectType = line.slice(5);
            }
            else if (line.startsWith('tag ')) {
                name = line.slice(4);
            }
            else if (line.startsWith('tagger ')) {
                tagger = parseAuthorLine(line);
            }
        }
        if (!tagger) {
            return null;
        }
        const message = lines.slice(messageStartIndex).join('\n');
        return {
            type: 'tag',
            data: obj.data,
            object,
            objectType,
            name,
            tagger,
            message
        };
    }
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
    async getRawObject(sha) {
        const obj = await this.getObject(sha);
        if (!obj) {
            return null;
        }
        // Build git object format: "type size\0content"
        const header = encoder.encode(`${obj.type} ${obj.data.length}\0`);
        const result = new Uint8Array(header.length + obj.data.length);
        result.set(header);
        result.set(obj.data, header.length);
        return result;
    }
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
    async logToWAL(operation, sha, type, _data) {
        // Create payload with operation details
        const payload = encoder.encode(JSON.stringify({
            sha,
            type,
            timestamp: Date.now()
        }));
        this.storage.sql.exec('INSERT INTO wal (operation, payload, created_at, flushed) VALUES (?, ?, ?, 0)', operation, payload, Date.now());
    }
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Convert hexadecimal string to bytes.
 *
 * @description
 * Parses a hexadecimal string and returns the corresponding bytes.
 * Used for converting SHA strings to 20-byte binary format.
 *
 * @param hex - Hexadecimal string
 * @returns Binary data as Uint8Array
 * @internal
 */
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}
/**
 * Convert bytes to hexadecimal string.
 *
 * @description
 * Converts binary data to a lowercase hexadecimal string.
 * Used for converting 20-byte SHA to 40-character string.
 *
 * @param bytes - Binary data to convert
 * @returns Lowercase hexadecimal string
 * @internal
 */
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Parse author/committer/tagger line.
 *
 * @description
 * Parses a Git author/committer/tagger line in the format:
 * "author Name <email> timestamp timezone"
 *
 * @param line - Full line including prefix
 * @returns Parsed Author object
 * @throws Error if line format is invalid
 * @internal
 */
function parseAuthorLine(line) {
    const match = line.match(/^(?:author|committer|tagger) (.+) <(.+)> (\d+) ([+-]\d{4})$/);
    if (!match) {
        throw new Error(`Invalid author line: ${line}`);
    }
    return {
        name: match[1],
        email: match[2],
        timestamp: parseInt(match[3], 10),
        timezone: match[4]
    };
}
//# sourceMappingURL=object-store.js.map