/**
 * @fileoverview GitBackend Interface and MemoryBackend Implementation
 *
 * This module defines the core storage abstraction for Git objects and references.
 * The GitBackend interface provides a minimal API for:
 * - Object storage (blobs, trees, commits, tags)
 * - Reference management (branches, tags, HEAD)
 * - Packfile operations
 *
 * The MemoryBackend implementation is provided for testing purposes.
 *
 * @module core/backend
 *
 * @example
 * ```typescript
 * import { createMemoryBackend } from './core/backend'
 * import type { GitBackend, GitObject } from './core/backend'
 *
 * const backend = createMemoryBackend()
 *
 * // Write a blob
 * const blob: GitObject = { type: 'blob', data: new TextEncoder().encode('Hello') }
 * const sha = await backend.writeObject(blob)
 *
 * // Read it back
 * const obj = await backend.readObject(sha)
 * ```
 */
import type { GitObject } from '../types/objects';
export type { GitObject, ObjectType, BlobObject, TreeObject, CommitObject, TagObject } from '../types/objects';
/**
 * Represents a Git reference.
 *
 * @property name - Full ref name (e.g., 'refs/heads/main', 'HEAD')
 * @property target - SHA-1 hash the ref points to
 */
export interface Ref {
    /** Full ref name */
    name: string;
    /** SHA-1 target (40-character lowercase hex) */
    target: string;
}
/**
 * Packed refs container.
 *
 * @description
 * Packed refs consolidate multiple loose refs into a single structure
 * for efficiency. The refs Map contains ref names to SHA mappings.
 * The optional peeled Map contains peeled values for annotated tags.
 */
export interface PackedRefs {
    /** Map of ref names to SHA values */
    refs: Map<string, string>;
    /** Optional map of ref names to peeled (dereferenced) SHA values */
    peeled?: Map<string, string>;
}
/**
 * Storage backend interface for Git operations.
 *
 * @description
 * This interface abstracts over different storage implementations to provide
 * a unified API for Git operations. Implementations must handle:
 *
 * 1. **Object Storage**: Content-addressable storage using SHA-1 hashes.
 *    The hash is computed from the Git object format: "{type} {size}\0{content}".
 *
 * 2. **Reference Storage**: Refs point to SHA-1 hashes.
 *
 * 3. **Packfile Support**: For efficient bulk object storage.
 *
 * @example
 * ```typescript
 * // Using the backend for basic operations
 * const backend: GitBackend = createMemoryBackend()
 *
 * // Store an object
 * const blob: GitObject = { type: 'blob', data: content }
 * const sha = await backend.writeObject(blob)
 *
 * // Retrieve it
 * const obj = await backend.readObject(sha)
 * if (obj) {
 *   console.log(`Type: ${obj.type}, Size: ${obj.data.length}`)
 * }
 * ```
 */
export interface GitBackend {
    /**
     * Read a Git object by its SHA-1 hash.
     *
     * @param sha - 40-character SHA-1 hash (case-insensitive)
     * @returns GitObject with type and data, or null if not found
     *
     * @example
     * ```typescript
     * const obj = await backend.readObject(sha)
     * if (obj) {
     *   if (obj.type === 'blob') {
     *     const text = new TextDecoder().decode(obj.data)
     *   }
     * }
     * ```
     */
    readObject(sha: string): Promise<GitObject | null>;
    /**
     * Write a Git object and return its SHA-1 hash.
     *
     * @description
     * Computes the SHA-1 hash of the object in Git format (type + size + content),
     * stores the object, and returns the hash. Idempotent - writing the same
     * content returns the same SHA.
     *
     * @param obj - Git object with type and data
     * @returns 40-character lowercase hexadecimal SHA-1 hash
     *
     * @example
     * ```typescript
     * const blob: GitObject = { type: 'blob', data: content }
     * const sha = await backend.writeObject(blob)
     * console.log(`Stored as: ${sha}`)
     * ```
     */
    writeObject(obj: GitObject): Promise<string>;
    /**
     * Check if a Git object exists in storage.
     *
     * @param sha - 40-character SHA-1 hash (case-insensitive)
     * @returns True if the object exists, false otherwise
     *
     * @example
     * ```typescript
     * if (await backend.hasObject(sha)) {
     *   console.log('Object exists')
     * }
     * ```
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Read a reference by name.
     *
     * @param name - Full ref name (e.g., 'refs/heads/main', 'HEAD')
     * @returns SHA-1 hash the ref points to, or null if not found
     *
     * @example
     * ```typescript
     * const sha = await backend.readRef('refs/heads/main')
     * if (sha) {
     *   console.log(`main branch at: ${sha}`)
     * }
     * ```
     */
    readRef(name: string): Promise<string | null>;
    /**
     * Write a reference.
     *
     * @param name - Full ref name
     * @param sha - SHA-1 hash to point to (will be normalized to lowercase)
     *
     * @example
     * ```typescript
     * await backend.writeRef('refs/heads/main', commitSha)
     * ```
     */
    writeRef(name: string, sha: string): Promise<void>;
    /**
     * Delete a reference.
     *
     * @param name - Full ref name to delete
     * @description Idempotent - no error if ref doesn't exist
     *
     * @example
     * ```typescript
     * await backend.deleteRef('refs/heads/old-branch')
     * ```
     */
    deleteRef(name: string): Promise<void>;
    /**
     * List references matching an optional prefix.
     *
     * @param prefix - Optional prefix to filter refs
     * @returns Array of Ref objects with name and target
     *
     * @example
     * ```typescript
     * // List all branches
     * const branches = await backend.listRefs('refs/heads/')
     *
     * // List all refs
     * const all = await backend.listRefs()
     * ```
     */
    listRefs(prefix?: string): Promise<Ref[]>;
    /**
     * Read packed refs.
     *
     * @returns PackedRefs containing refs Map and optional peeled Map
     *
     * @example
     * ```typescript
     * const packed = await backend.readPackedRefs()
     * for (const [name, sha] of packed.refs) {
     *   console.log(`${name}: ${sha}`)
     * }
     * ```
     */
    readPackedRefs(): Promise<PackedRefs>;
    /**
     * Write a packfile to storage.
     *
     * @description
     * Parses and stores objects from a Git packfile. The packfile format includes:
     * - 4 bytes: "PACK" signature
     * - 4 bytes: version number (2)
     * - 4 bytes: object count
     * - Objects (variable-length encoded, zlib compressed)
     * - 20 bytes: SHA-1 checksum
     *
     * @param pack - Raw packfile data
     *
     * @example
     * ```typescript
     * // Receive packfile from remote
     * await backend.writePackfile(packData)
     * ```
     */
    writePackfile(pack: Uint8Array): Promise<void>;
}
/**
 * Memory-backed GitBackend implementation for testing.
 *
 * @description
 * Extends GitBackend with a clear() method to reset state between tests.
 */
export interface MemoryBackend extends GitBackend {
    /**
     * Clear all stored objects and refs.
     *
     * @description
     * Resets the backend to a clean state. Useful for test isolation.
     */
    clear(): void;
    /**
     * Read a pack file by name.
     *
     * @param name - Name of the pack file
     * @returns Pack data or null if not found
     */
    readPack(name: string): Promise<Uint8Array | null>;
    /**
     * List all pack files.
     *
     * @returns Array of pack file names
     */
    listPacks(): Promise<string[]>;
    /**
     * Write a symbolic reference.
     *
     * @param name - Symbolic ref name (e.g., 'HEAD')
     * @param target - Target ref name (e.g., 'refs/heads/main')
     */
    writeSymbolicRef(name: string, target: string): Promise<void>;
    /**
     * Read a symbolic reference.
     *
     * @param name - Symbolic ref name
     * @returns Target ref name or null if not found
     */
    readSymbolicRef(name: string): Promise<string | null>;
    /**
     * Compare and swap a reference atomically.
     *
     * @param name - Ref name
     * @param expectedSha - Expected current value (null for new refs)
     * @param newSha - New value to set
     * @returns True if successful, false if current value didn't match
     */
    compareAndSwapRef(name: string, expectedSha: string | null, newSha: string): Promise<boolean>;
    /**
     * Delete an object from storage.
     *
     * @param sha - SHA of object to delete
     */
    deleteObject(sha: string): Promise<void>;
}
/**
 * Create a memory-backed GitBackend for testing.
 *
 * @description
 * Creates an isolated in-memory storage backend. Each call returns
 * a new independent instance - instances do not share state.
 *
 * @returns MemoryBackend instance
 *
 * @example
 * ```typescript
 * const backend = createMemoryBackend()
 *
 * // Write objects
 * const sha = await backend.writeObject({ type: 'blob', data: content })
 *
 * // Clear for next test
 * backend.clear()
 * ```
 */
export declare function createMemoryBackend(): MemoryBackend;
//# sourceMappingURL=backend.d.ts.map