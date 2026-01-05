/**
 * @fileoverview Object Store Proxy for Sandbox Execution
 *
 * Provides controlled access to the git object store within sandboxed code.
 */
export class ObjectStoreProxy {
    objectStore;
    constructor(objectStore) {
        this.objectStore = objectStore;
    }
    async getObject(sha) {
        return this.objectStore.getObject(sha);
    }
    async putObject(type, data) {
        return this.objectStore.putObject(type, data);
    }
    async listObjects(options) {
        return this.objectStore.listObjects(options);
    }
}
export function createObjectStoreAccess(objectStore) {
    const proxy = new ObjectStoreProxy(objectStore);
    return {
        getProxy: () => proxy,
        getObject: (sha) => proxy.getObject(sha),
        putObject: (type, data) => proxy.putObject(type, data),
        listObjects: (options) => proxy.listObjects(options),
    };
}
//# sourceMappingURL=object-store-proxy.js.map