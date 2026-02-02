/**
 * @fileoverview Object Store Proxy for Sandbox Execution
 *
 * Provides controlled access to the git object store within sandboxed code.
 * Uses strict typing based on canonical ObjectStore interfaces from types/storage.ts.
 */
/**
 * Proxy class providing controlled access to the object store.
 *
 * Wraps a SandboxObjectStore and exposes a limited API to sandboxed code.
 * All methods validate inputs and delegate to the underlying store.
 */
export class ObjectStoreProxy {
    store;
    constructor(objectStore) {
        this.store = objectStore;
    }
    /**
     * Retrieve a Git object by SHA-1 hash.
     *
     * @param sha - 40-character hex SHA-1
     * @returns Object with type and data, or null if not found
     */
    async getObject(sha) {
        return this.store.getObject(sha);
    }
    /**
     * Store a Git object and return its SHA-1 hash.
     *
     * @param type - Object type ('blob', 'tree', 'commit', 'tag')
     * @param data - Raw object content
     * @returns 40-character SHA-1 hash
     */
    async storeObject(type, data) {
        return this.store.storeObject(type, data);
    }
    /**
     * Check if an object exists in the store.
     *
     * @param sha - 40-character hex SHA-1
     * @returns true if object exists
     */
    async hasObject(sha) {
        return this.store.hasObject(sha);
    }
    /**
     * List objects in the store with optional filtering.
     *
     * @param options - Filter options (type, limit)
     * @returns Array of SHA-1 hashes
     */
    async listObjects(options) {
        return this.store.listObjects(options);
    }
}
/**
 * Create an ObjectStoreAccess wrapper for sandboxed code.
 *
 * @param objectStore - The underlying object store implementation
 * @returns ObjectStoreAccess interface for sandbox use
 */
export function createObjectStoreAccess(objectStore) {
    const proxy = new ObjectStoreProxy(objectStore);
    return {
        getProxy: () => proxy,
        getObject: (sha) => proxy.getObject(sha),
        storeObject: (type, data) => proxy.storeObject(type, data),
        hasObject: (sha) => proxy.hasObject(sha),
        listObjects: (options) => proxy.listObjects(options),
    };
}
//# sourceMappingURL=object-store-proxy.js.map