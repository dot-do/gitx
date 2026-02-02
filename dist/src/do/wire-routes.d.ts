/**
 * @fileoverview Git Smart HTTP Wire Protocol Routes for DO Router
 *
 * Bridges the wire protocol handlers (smart-http.ts, upload-pack.ts, receive-pack.ts)
 * to the DO's Hono router. Implements the RepositoryProvider interface by adapting
 * the DO's ObjectStore and SQLite-backed ref storage.
 *
 * @module do/wire-routes
 */
import type { Hono } from 'hono';
import type { GitRepoDOInstance } from './routes';
import type { RepositoryProvider, RefUpdateCommand as SmartHTTPRefUpdateCommand, ReceivePackResult as SmartHTTPReceivePackResult, GitRef } from '../wire/smart-http';
import { type DurableObjectStorage } from './schema';
/**
 * Adapts the DO's ObjectStore and SQLite storage to the RepositoryProvider
 * interface expected by the Smart HTTP wire protocol handlers.
 *
 * This class is cached at the DO instance level to avoid recreation per-request.
 * @see GitRepoDO.getRepositoryProvider()
 */
export declare class DORepositoryProvider implements RepositoryProvider {
    private storage;
    private objectStore;
    private schemaManager;
    private schemaInitialized;
    constructor(storage: DurableObjectStorage);
    private ensureSchema;
    getRefs(): Promise<GitRef[]>;
    exists(): Promise<boolean>;
    hasPermission(_service: 'git-upload-pack' | 'git-receive-pack'): Promise<boolean>;
    uploadPack(wants: string[], haves: string[], _capabilities: string[]): Promise<Uint8Array>;
    receivePack(packData: Uint8Array, commands: SmartHTTPRefUpdateCommand[]): Promise<SmartHTTPReceivePackResult>;
    /**
     * Unpack a packfile into a PushTransaction's buffer instead of
     * writing directly to the object store.
     *
     * This is the transactional variant of unpackPackfile. Objects are
     * buffered in the transaction and only flushed to storage when
     * tx.execute() is called, ensuring atomicity with ref updates.
     */
    private unpackPackfileIntoTransaction;
    /**
     * Creates an adapter satisfying the upload-pack ObjectStore interface,
     * backed by the DO's SQLite object store.
     */
    private createUploadPackStore;
}
/**
 * Register Git Smart HTTP protocol routes on the Hono router.
 *
 * Adds three routes:
 * - GET  /:namespace/info/refs      - ref advertisement
 * - POST /:namespace/git-upload-pack - fetch/clone serving
 * - POST /:namespace/git-receive-pack - push receiving
 *
 * @param router - Hono router instance
 * @param instance - GitRepoDO instance
 */
export declare function setupWireRoutes(router: Hono<{
    Bindings: Record<string, unknown>;
}>, instance: GitRepoDOInstance): void;
//# sourceMappingURL=wire-routes.d.ts.map