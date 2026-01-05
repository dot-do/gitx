/**
 * @fileoverview Worker Loader Types
 *
 * This module defines types for loading and interacting with Cloudflare Workers
 * in the gitdo environment. Based on patterns from mongo.do research.
 *
 * @module types/worker-loader
 */
/**
 * Internal marker symbol for identifying real Cloudflare worker loaders.
 */
const REAL_WORKER_LOADER_MARKER = Symbol.for('cloudflare.worker_loader');
/**
 * MockWorkerLoader provides a mock implementation of the WorkerLoader interface
 * for testing purposes. It caches WorkerStubs by ID.
 */
export class MockWorkerLoader {
    cache = new Map();
    get(id, getCode) {
        const cached = this.cache.get(id);
        if (cached) {
            return cached;
        }
        const stub = {
            fetch: async (request) => {
                return new Response('MockWorkerLoader response');
            },
            getEntrypoint: (name) => {
                return {
                    fetch: async (request) => {
                        return new Response('MockWorkerLoader entrypoint response');
                    }
                };
            }
        };
        this.cache.set(id, stub);
        return stub;
    }
}
/**
 * Type guard to check if a loader is a real Cloudflare worker loader.
 * Returns false for MockWorkerLoader instances, null, undefined, or non-WorkerLoader objects.
 * Returns true only for real Cloudflare worker_loaders that have the internal marker.
 *
 * @param loader - The loader to check
 * @returns true if the loader is a real Cloudflare worker loader
 */
export function isRealWorkerLoader(loader) {
    if (loader === null || loader === undefined) {
        return false;
    }
    if (loader instanceof MockWorkerLoader) {
        return false;
    }
    if (typeof loader !== 'object') {
        return false;
    }
    // Check for the internal marker that real Cloudflare worker loaders would have
    const obj = loader;
    return obj[REAL_WORKER_LOADER_MARKER] === true;
}
//# sourceMappingURL=worker-loader.js.map