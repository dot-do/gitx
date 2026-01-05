/**
 * @fileoverview Worker Loader Types
 *
 * This module defines types for loading and interacting with Cloudflare Workers
 * in the gitdo environment. Based on patterns from mongo.do research.
 *
 * @module types/worker-loader
 */
/**
 * WorkerLoader interface for managing worker instances.
 */
export interface WorkerLoader {
    get(id: string, getCode: () => Promise<WorkerCode>): WorkerStub;
}
/**
 * WorkerCode defines the configuration and modules for a worker.
 */
export interface WorkerCode {
    compatibilityDate: string;
    compatibilityFlags?: string[];
    mainModule: string;
    modules: Record<string, string | {
        js: string;
    } | {
        text: string;
    }>;
    globalOutbound?: null;
    env?: Record<string, unknown>;
}
/**
 * WorkerStub provides methods to interact with a worker instance.
 */
export interface WorkerStub {
    fetch?(request: Request): Promise<Response>;
    getEntrypoint?(name?: string): WorkerEntrypoint;
}
/**
 * WorkerEntrypoint represents a worker's entrypoint.
 */
export interface WorkerEntrypoint {
    fetch(request: Request): Promise<Response>;
}
/**
 * MockWorkerLoader provides a mock implementation of the WorkerLoader interface
 * for testing purposes. It caches WorkerStubs by ID.
 */
export declare class MockWorkerLoader implements WorkerLoader {
    private cache;
    get(id: string, getCode: () => Promise<WorkerCode>): WorkerStub;
}
/**
 * Type guard to check if a loader is a real Cloudflare worker loader.
 * Returns false for MockWorkerLoader instances, null, undefined, or non-WorkerLoader objects.
 * Returns true only for real Cloudflare worker_loaders that have the internal marker.
 *
 * @param loader - The loader to check
 * @returns true if the loader is a real Cloudflare worker loader
 */
export declare function isRealWorkerLoader(loader: unknown): loader is WorkerLoader;
//# sourceMappingURL=worker-loader.d.ts.map