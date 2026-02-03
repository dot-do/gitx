/**
 * @fileoverview GitBackend Adapter for Durable Object Storage
 *
 * Provides an adapter that implements the GitBackend interface using
 * the DO's ObjectStore (SQLite) for storage. This allows the clone/fetch
 * operations from ops/clone.ts to work with Durable Object storage.
 *
 * @module do/git-backend-adapter
 */
import { SqliteObjectStore } from './object-store';
import { SchemaManager } from './schema';
import { parsePackHeader, decodeTypeAndSize, PackObjectType, packObjectTypeToString } from '../pack/format';
import { applyDelta } from '../pack/delta';
import pako from 'pako';
/**
 * Adapter that wraps ObjectStore to implement GitBackend interface.
 *
 * This allows the clone() function from ops/clone.ts to work with
 * Durable Object SQLite storage for efficient, cost-effective storage.
 */
export class GitBackendAdapter {
    store;
    schemaManager;
    storage;
    /** Read-through cache for refs. Null means cache is cold and must be loaded from SQLite. */
    refCache = null;
    schemaInitialized = false;
    constructor(storage, backend) {
        this.storage = storage;
        this.schemaManager = new SchemaManager(storage);
        this.store = new SqliteObjectStore(storage, backend ? { backend } : undefined);
    }
    /**
     * Ensure schema is initialized before any operations.
     */
    async ensureSchema() {
        if (!this.schemaInitialized) {
            await this.schemaManager.initializeSchema();
            this.schemaInitialized = true;
        }
    }
    /**
     * Load all refs from SQLite into the in-memory cache.
     * Called lazily on first read if the cache is cold.
     */
    async loadRefCache() {
        if (this.refCache !== null)
            return this.refCache;
        await this.ensureSchema();
        const result = this.storage.sql.exec('SELECT name, target FROM refs');
        const rows = result.toArray();
        this.refCache = new Map();
        for (const row of rows) {
            this.refCache.set(row.name, row.target);
        }
        return this.refCache;
    }
    /**
     * Read a Git object by SHA.
     */
    async readObject(sha) {
        await this.ensureSchema();
        const obj = await this.store.getObject(sha);
        if (!obj)
            return null;
        return {
            type: obj.type,
            data: obj.data,
        };
    }
    /**
     * Write a Git object and return its SHA.
     */
    async writeObject(obj) {
        await this.ensureSchema();
        return this.store.putObject(obj.type, obj.data);
    }
    /**
     * Check if an object exists.
     */
    async hasObject(sha) {
        await this.ensureSchema();
        return this.store.hasObject(sha);
    }
    /**
     * Read a reference by name.
     * Uses the read-through cache; falls back to SQLite on cache miss.
     */
    async readRef(name) {
        const cache = await this.loadRefCache();
        return cache.get(name) ?? null;
    }
    /**
     * Write a reference.
     * Writes to SQLite (source of truth) and updates the cache.
     */
    async writeRef(name, sha) {
        const target = sha.toLowerCase();
        // Write to SQLite first (source of truth)
        await this.ensureSchema();
        this.storage.sql.exec('INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)', name, target, 'sha', Date.now());
        // Update cache if populated (don't load cache just for a write)
        if (this.refCache !== null) {
            this.refCache.set(name, target);
        }
    }
    /**
     * Delete a reference.
     * Deletes from SQLite (source of truth) and invalidates the cache entry.
     */
    async deleteRef(name) {
        await this.ensureSchema();
        this.storage.sql.exec('DELETE FROM refs WHERE name = ?', name);
        // Update cache if populated
        if (this.refCache !== null) {
            this.refCache.delete(name);
        }
    }
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
    async compareAndSwapRef(name, expectedOldTarget, newTarget) {
        await this.ensureSchema();
        const ZERO_SHA = '0000000000000000000000000000000000000000';
        const isDelete = !newTarget || newTarget === ZERO_SHA;
        const expectMissing = expectedOldTarget === null || expectedOldTarget === '' || expectedOldTarget === ZERO_SHA;
        // Use a SQLite transaction for atomicity
        this.storage.sql.exec('BEGIN TRANSACTION');
        try {
            // Read current value within the transaction
            const result = this.storage.sql.exec('SELECT target FROM refs WHERE name = ?', name);
            const rows = result.toArray();
            const currentTarget = rows.length > 0 ? rows[0].target : null;
            // Check if current state matches expectation
            if (expectMissing) {
                // Caller expects ref does not exist
                if (currentTarget !== null) {
                    this.storage.sql.exec('ROLLBACK');
                    return false;
                }
            }
            else {
                // Caller expects ref exists with specific value
                if (currentTarget === null || currentTarget !== expectedOldTarget.toLowerCase()) {
                    this.storage.sql.exec('ROLLBACK');
                    return false;
                }
            }
            // Apply the update
            if (isDelete) {
                this.storage.sql.exec('DELETE FROM refs WHERE name = ?', name);
            }
            else {
                const target = newTarget.toLowerCase();
                this.storage.sql.exec('INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)', name, target, 'sha', Date.now());
            }
            this.storage.sql.exec('COMMIT');
            // Invalidate cache after successful CAS
            this.refCache = null;
            return true;
        }
        catch (error) {
            this.storage.sql.exec('ROLLBACK');
            throw error;
        }
    }
    /**
     * List all references, optionally filtered by prefix.
     * Uses the read-through cache; falls back to SQLite on cache miss.
     */
    async listRefs(prefix) {
        const cache = await this.loadRefCache();
        const result = [];
        for (const [name, target] of cache) {
            if (!prefix || name.startsWith(prefix)) {
                result.push({ name, target });
            }
        }
        return result;
    }
    /**
     * Read packed refs (returns empty since we don't use packed refs in DO).
     */
    async readPackedRefs() {
        return { refs: new Map() };
    }
    /**
     * Write a packfile by unpacking individual objects and storing them
     * via the ObjectStore.
     *
     * Parses the packfile header, iterates through each object entry,
     * decompresses its data, resolves deltas against their base objects,
     * and stores the resulting objects.
     */
    async writePackfile(pack) {
        await this.ensureSchema();
        // Parse and validate the 12-byte pack header
        const header = parsePackHeader(pack);
        const objectCount = header.objectCount;
        // We need to track objects by their pack offset for OFS_DELTA resolution
        const objectsByOffset = new Map();
        let offset = 12; // Skip past the 12-byte header
        for (let i = 0; i < objectCount; i++) {
            const entryOffset = offset;
            // Decode the type+size header for this object
            const { type, bytesRead: headerBytes } = decodeTypeAndSize(pack, offset);
            offset += headerBytes;
            let baseType;
            let data;
            if (type === PackObjectType.OBJ_OFS_DELTA) {
                // OFS_DELTA: read the negative offset to the base object
                // The offset is encoded as a variable-length integer where each byte
                // contributes 7 bits, but with a different encoding than standard varint:
                // the value is built by shifting left 7 and adding the next byte + 1
                let byte = pack[offset++];
                let baseOffset = byte & 0x7f;
                while (byte & 0x80) {
                    byte = pack[offset++];
                    baseOffset = ((baseOffset + 1) << 7) | (byte & 0x7f);
                }
                // Decompress the delta data and advance past compressed bytes
                const decompressed = pako.inflate(pack.subarray(offset));
                offset = advancePastZlibStream(pack, offset);
                // Resolve the base object
                const absoluteBaseOffset = entryOffset - baseOffset;
                const baseObj = objectsByOffset.get(absoluteBaseOffset);
                if (!baseObj) {
                    throw new Error(`[GitBackendAdapter] writePackfile: OFS_DELTA base object not found at offset ${absoluteBaseOffset}`);
                }
                baseType = baseObj.type;
                data = applyDelta(baseObj.data, decompressed);
            }
            else if (type === PackObjectType.OBJ_REF_DELTA) {
                // REF_DELTA: read the 20-byte base object SHA
                const baseShaBytes = pack.subarray(offset, offset + 20);
                offset += 20;
                const baseSha = Array.from(baseShaBytes)
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('');
                // Decompress the delta data
                const decompressed = pako.inflate(pack.subarray(offset));
                offset = advancePastZlibStream(pack, offset);
                // Resolve the base object - check local cache first, then ObjectStore
                const cachedBase = [...objectsByOffset.values()].find((o) => o.sha === baseSha);
                let baseData;
                if (cachedBase) {
                    baseType = cachedBase.type;
                    baseData = cachedBase.data;
                }
                else {
                    const storedBase = await this.store.getObject(baseSha);
                    if (!storedBase) {
                        throw new Error(`[GitBackendAdapter] writePackfile: REF_DELTA base object not found: ${baseSha}`);
                    }
                    baseType = storedBase.type;
                    baseData = storedBase.data;
                }
                data = applyDelta(baseData, decompressed);
            }
            else {
                // Regular object (commit, tree, blob, tag)
                baseType = packObjectTypeToString(type);
                data = pako.inflate(pack.subarray(offset));
                offset = advancePastZlibStream(pack, offset);
            }
            // Store the object (baseType is set in every branch above)
            const sha = await this.store.putObject(baseType, data);
            // Cache by offset for potential OFS_DELTA resolution by later entries
            objectsByOffset.set(entryOffset, { type: baseType, data, sha });
        }
    }
    /**
     * Get all refs as a plain object (for serialization).
     * Reads from SQLite to ensure freshness.
     */
    getRefsSnapshot() {
        // Synchronously read from SQLite to guarantee freshness
        if (this.schemaInitialized) {
            const result = this.storage.sql.exec('SELECT name, target FROM refs');
            const rows = result.toArray();
            const snapshot = {};
            for (const row of rows) {
                snapshot[row.name] = row.target;
            }
            return snapshot;
        }
        // Fallback to cache if schema not yet initialized
        const snapshot = {};
        if (this.refCache) {
            for (const [name, target] of this.refCache) {
                snapshot[name] = target;
            }
        }
        return snapshot;
    }
    /**
     * Invalidate the ref cache.
     *
     * Call this method when refs have been written to SQLite directly
     * (e.g. by ParquetRefStore or other components), so that subsequent
     * reads will reload from SQLite.
     */
    invalidateRefCache() {
        this.refCache = null;
    }
    // ===========================================================================
    // Pack Streaming Operations (stub implementations for interface compliance)
    // ===========================================================================
    /**
     * Read a pack file by ID.
     * @returns null - pack streaming not supported by DO adapter
     */
    async readPack(_id) {
        // Pack streaming not supported - we store objects individually in SQLite
        return null;
    }
    /**
     * Write a pack file from a stream.
     * @throws Error - pack streaming not supported by DO adapter
     */
    async writePack(_stream) {
        throw new Error('Pack streaming not supported by GitBackendAdapter - use writePackfile instead');
    }
    /**
     * List all pack file IDs.
     * @returns Empty array - no pack files stored
     */
    async listPacks() {
        // No pack files - we store objects individually
        return [];
    }
    /**
     * Delete a pack file.
     * No-op since we don't store pack files.
     */
    async deletePack(_id) {
        // No-op - we don't store pack files
    }
}
/**
 * Advance past a zlib-compressed stream in a buffer.
 *
 * Uses pako's Inflate in streaming mode to determine exactly how many
 * compressed bytes were consumed, since zlib streams are variable-length
 * and we need to know where the next object starts.
 *
 * @param data - The buffer containing the zlib stream
 * @param offset - The starting offset of the zlib stream
 * @returns The offset immediately after the end of the zlib stream
 */
function advancePastZlibStream(data, offset) {
    const inflator = new pako.Inflate();
    // Feed data in small chunks to track consumption accurately
    const chunkSize = 1024;
    let consumed = 0;
    const remaining = data.subarray(offset);
    for (let i = 0; i < remaining.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, remaining.length);
        const chunk = remaining.subarray(i, end);
        const isLast = end >= remaining.length;
        inflator.push(chunk, isLast);
        if (inflator.err) {
            throw new Error(`[GitBackendAdapter] zlib decompression error: ${inflator.msg}`);
        }
        if (inflator.ended) {
            // pako tracks how many bytes remain unconsumed in strm.avail_in
            consumed = end - (inflator.strm?.avail_in ?? 0);
            break;
        }
    }
    if (!inflator.ended) {
        throw new Error('[GitBackendAdapter] zlib stream did not terminate within the available data');
    }
    return offset + consumed;
}
/**
 * Create a GitBackend adapter for the given DO storage.
 */
export function createGitBackendAdapter(storage, backend) {
    return new GitBackendAdapter(storage, backend);
}
//# sourceMappingURL=git-backend-adapter.js.map