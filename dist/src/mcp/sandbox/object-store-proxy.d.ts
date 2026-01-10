/**
 * @fileoverview Object Store Proxy for Sandbox Execution
 *
 * Provides controlled access to the git object store within sandboxed code.
 */
export interface ObjectStoreAccess {
    getProxy(): ObjectStoreProxy;
    getObject(sha: string): Promise<{
        type: string;
        data: Uint8Array;
    } | null>;
    putObject(type: string, data: Uint8Array): Promise<string>;
    listObjects(options?: {
        type?: string;
        limit?: number;
    }): Promise<string[]>;
}
export declare class ObjectStoreProxy {
    private objectStore;
    constructor(objectStore: any);
    getObject(sha: string): Promise<{
        type: string;
        data: Uint8Array;
    } | null>;
    putObject(type: string, data: Uint8Array): Promise<string>;
    listObjects(options?: {
        type?: string;
        limit?: number;
    }): Promise<string[]>;
}
export declare function createObjectStoreAccess(objectStore: any): ObjectStoreAccess;
//# sourceMappingURL=object-store-proxy.d.ts.map