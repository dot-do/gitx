/**
 * @fileoverview GitBackend Adapter for Durable Object Storage
 *
 * Provides an adapter that implements the GitBackend interface using
 * the DO's ObjectStore (SQLite) for storage. This allows the clone/fetch
 * operations from ops/clone.ts to work with Durable Object storage.
 *
 * @module do/git-backend-adapter
 */
import type { GitBackend, GitObject, Ref, PackedRefs } from '../core/backend';
import type { CASBackend } from '../storage/backend';
import { type DurableObjectStorage } from './schema';
/**
 * Adapter that wraps ObjectStore to implement GitBackend interface.
 *
 * This allows the clone() function from ops/clone.ts to work with
 * Durable Object SQLite storage for efficient, cost-effective storage.
 */
export declare class GitBackendAdapter implements GitBackend {
    private store;
    private schemaManager;
    private storage;
    /** Read-through cache for refs. Null means cache is cold and must be loaded from SQLite. */
    private refCache;
    private schemaInitialized;
    constructor(storage: DurableObjectStorage, backend?: CASBackend);
    /**
     * Ensure schema is initialized before any operations.
     */
    private ensureSchema;
    /**
     * Load all refs from SQLite into the in-memory cache.
     * Called lazily on first read if the cache is cold.
     */
    private loadRefCache;
    /**
     * Read a Git object by SHA.
     */
    readObject(sha: string): Promise<GitObject | null>;
    /**
     * Write a Git object and return its SHA.
     */
    writeObject(obj: GitObject): Promise<string>;
    /**
     * Check if an object exists.
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Read a reference by name.
     * Uses the read-through cache; falls back to SQLite on cache miss.
     */
    readRef(name: string): Promise<string | null>;
    /**
     * Write a reference.
     * Writes to SQLite (source of truth) and updates the cache.
     */
    writeRef(name: string, sha: string): Promise<void>;
    /**
     * Delete a reference.
     * Deletes from SQLite (source of truth) and invalidates the cache entry.
     */
    deleteRef(name: string): Promise<void>;
    /**
     * Atomically update a ref using compare-and-swap semantics.
     *
     * Reads the current ref value inside a SQLite transaction and only
     * writes the new value if the current value matches `expectedOldTarget`.
     *
     * @param name - Full ref name (e.g., 'refs/heads/main')
     * @param expectedOldTarget - Expected current value of the ref:
     *   - A 40-char SHA means "ref must currently point to this SHA"
     *   - `null` means "ref must not exist" (create-only)
     *   - Empty string `""` means "ref must not exist" (Git zero-SHA convention)
     * @param newTarget - New SHA to set the ref to. Empty or zero-SHA means delete.
     * @returns `true` if the swap succeeded, `false` if the current value didn't match
     */
    compareAndSwapRef(name: string, expectedOldTarget: string | null, newTarget: string): Promise<boolean>;
    /**
     * List all references, optionally filtered by prefix.
     * Uses the read-through cache; falls back to SQLite on cache miss.
     */
    listRefs(prefix?: string): Promise<Ref[]>;
    /**
     * Read packed refs (returns empty since we don't use packed refs in DO).
     */
    readPackedRefs(): Promise<PackedRefs>;
    /**
     * Write a packfile by unpacking individual objects and storing them
     * via the ObjectStore.
     *
     * Parses the packfile header, iterates through each object entry,
     * decompresses its data, resolves deltas against their base objects,
     * and stores the resulting objects.
     */
    writePackfile(pack: Uint8Array): Promise<void>;
    /**
     * Get all refs as a plain object (for serialization).
     * Reads from SQLite to ensure freshness.
     */
    getRefsSnapshot(): Record<string, string>;
    /**
     * Invalidate the ref cache.
     *
     * Call this method when refs have been written to SQLite directly
     * (e.g. by ParquetRefStore or other components), so that subsequent
     * reads will reload from SQLite.
     */
    invalidateRefCache(): void;
    /**
     * Read a pack file by ID.
     * @returns null - pack streaming not supported by DO adapter
     */
    readPack(_id: string): Promise<ReadableStream<Uint8Array> | null>;
    /**
     * Write a pack file from a stream.
     * @throws Error - pack streaming not supported by DO adapter
     */
    writePack(_stream: ReadableStream<Uint8Array>): Promise<string>;
    /**
     * List all pack file IDs.
     * @returns Empty array - no pack files stored
     */
    listPacks(): Promise<string[]>;
    /**
     * Delete a pack file.
     * No-op since we don't store pack files.
     */
    deletePack(_id: string): Promise<void>;
}
/**
 * Create a GitBackend adapter for the given DO storage.
 */
export declare function createGitBackendAdapter(storage: DurableObjectStorage, backend?: CASBackend): GitBackendAdapter;
//# sourceMappingURL=git-backend-adapter.d.ts.map