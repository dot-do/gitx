/**
 * @fileoverview Git Garbage Collection
 *
 * Implements garbage collection for unreferenced Git objects. GC removes objects
 * that are not reachable from any ref (branch, tag, HEAD) and are older than a
 * configurable grace period.
 *
 * Key features:
 * - Walks all objects reachable from refs (commits, trees, blobs, tags)
 * - Identifies unreferenced objects
 * - Respects a grace period to avoid deleting objects being written
 * - Concurrent-safe: marks objects before deletion to handle races
 *
 * R2 Lifecycle Integration:
 * - GC works in conjunction with R2 lifecycle policies defined in r2-lifecycle-policies.json
 * - Objects deleted by GC are removed from bloom cache and marked as tombstones
 * - R2 lifecycle policies provide a secondary safety net with 90-day retention
 * - Recommended: Run GC weekly with the default 14-day grace period
 *
 * @module storage/gc
 *
 * @example
 * ```typescript
 * import { GarbageCollector, createGCForParquetStore } from './storage/gc'
 *
 * const gc = createGCForParquetStore(parquetStore, refStore)
 * const result = await gc.collect()
 * console.log(`Deleted ${result.deletedCount} objects, freed ${result.freedBytes} bytes`)
 * ```
 */
// ============================================================================
// Constants
// ============================================================================
/** Default grace period: 2 weeks in milliseconds */
const DEFAULT_GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;
// ============================================================================
// Garbage Collector Class
// ============================================================================
/**
 * Git garbage collector for unreferenced objects.
 *
 * @description
 * The garbage collector identifies objects that are not reachable from any ref
 * and removes them from storage. It performs a mark-and-sweep algorithm:
 *
 * 1. **Mark phase**: Walk all refs and mark objects reachable from each ref.
 *    This includes walking commits (to trees and parents), trees (to blobs and
 *    subtrees), and tags (to tagged objects).
 *
 * 2. **Sweep phase**: Iterate over all objects in storage. For each object not
 *    marked as reachable, check if it's older than the grace period. If so,
 *    delete it.
 *
 * The grace period (default: 2 weeks) ensures objects that are being written
 * concurrently are not accidentally deleted. This handles scenarios like:
 * - Push in progress: Objects written but ref not yet updated
 * - Concurrent operations: Multiple writers operating simultaneously
 *
 * @example
 * ```typescript
 * const gc = new GarbageCollector(objectStore, refStore, {
 *   gracePeriodMs: 7 * 24 * 60 * 60 * 1000, // 1 week
 *   logger: console
 * })
 *
 * // Dry run first
 * const preview = await gc.collect({ dryRun: true })
 * console.log(`Would delete ${preview.unreferencedCount} objects`)
 *
 * // Actually delete
 * const result = await gc.collect()
 * console.log(`Deleted ${result.deletedCount} objects`)
 * ```
 */
export class GarbageCollector {
    objectStore;
    refStore;
    options;
    logger;
    /**
     * Create a new GarbageCollector.
     *
     * @param objectStore - Object storage backend
     * @param refStore - Reference storage backend
     * @param options - GC configuration options
     */
    constructor(objectStore, refStore, options) {
        this.objectStore = objectStore;
        this.refStore = refStore;
        this.options = options ?? {};
        this.logger = options?.logger ?? undefined;
    }
    /**
     * Log a message if logger is configured.
     */
    log(level, message, ...args) {
        if (!this.logger)
            return;
        const logFn = this.logger[level];
        if (logFn) {
            logFn.call(this.logger, `[GC] ${message}`, ...args);
        }
    }
    /**
     * Run garbage collection.
     *
     * @description
     * Performs a complete mark-and-sweep garbage collection pass.
     * Returns detailed statistics about the GC run.
     *
     * @param options - Runtime options that override constructor options
     * @returns GC result statistics
     */
    async collect(options) {
        const startTime = Date.now();
        const gracePeriodMs = options?.gracePeriodMs ?? this.options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
        const maxDeleteCount = options?.maxDeleteCount ?? this.options.maxDeleteCount ?? Infinity;
        const dryRun = options?.dryRun ?? this.options.dryRun ?? false;
        this.log('info', `Starting GC (gracePeriod=${gracePeriodMs}ms, maxDelete=${maxDeleteCount}, dryRun=${dryRun})`);
        // Phase 1: Mark - find all reachable objects
        const reachable = await this.markReachable();
        this.log('info', `Mark phase complete: ${reachable.size} reachable objects`);
        // Phase 2: List all objects in storage
        const allObjects = await this.objectStore.listAllObjects();
        this.log('info', `Found ${allObjects.length} total objects in storage`);
        // Phase 3: Sweep - identify and delete unreferenced objects
        const now = Date.now();
        const cutoffTime = now - gracePeriodMs;
        let deletedCount = 0;
        let freedBytes = 0;
        let unreferencedCount = 0;
        let skippedGracePeriod = 0;
        let skippedMaxLimit = 0;
        for (const obj of allObjects) {
            // Skip if object is reachable
            if (reachable.has(obj.sha)) {
                continue;
            }
            unreferencedCount++;
            // Check grace period
            const createdAt = obj.createdAt ?? 0;
            if (createdAt > cutoffTime) {
                this.log('debug', `Skipping ${obj.sha} - within grace period (created ${now - createdAt}ms ago)`);
                skippedGracePeriod++;
                continue;
            }
            // Check max delete limit
            if (deletedCount >= maxDeleteCount) {
                skippedMaxLimit++;
                continue;
            }
            // Delete the object
            if (!dryRun) {
                try {
                    await this.objectStore.deleteObject(obj.sha);
                    this.log('debug', `Deleted unreferenced object: ${obj.sha} (${obj.type}, ${obj.size} bytes)`);
                }
                catch (err) {
                    this.log('warn', `Failed to delete object ${obj.sha}:`, err);
                    continue;
                }
            }
            else {
                this.log('debug', `[DRY RUN] Would delete: ${obj.sha} (${obj.type}, ${obj.size} bytes)`);
            }
            deletedCount++;
            freedBytes += obj.size;
        }
        const durationMs = Date.now() - startTime;
        const result = {
            deletedCount,
            freedBytes,
            unreferencedCount,
            skippedGracePeriod,
            skippedMaxLimit,
            totalScanned: allObjects.length,
            reachableCount: reachable.size,
            durationMs,
            dryRun,
        };
        this.log('info', `GC complete: deleted=${deletedCount}, freed=${freedBytes} bytes, duration=${durationMs}ms`);
        return result;
    }
    /**
     * Mark all objects reachable from refs.
     *
     * @description
     * Walks from each ref's target object and recursively marks all reachable objects.
     * Handles commits (walking tree and parents), trees (walking entries), and tags
     * (walking tagged object).
     *
     * @returns Set of reachable SHA hashes
     */
    async markReachable() {
        const reachable = new Set();
        const visited = new Set();
        // Get all refs
        const refs = await this.refStore.listRefs();
        this.log('debug', `Found ${refs.length} refs to walk`);
        // Walk from each ref
        for (const ref of refs) {
            // Skip symbolic refs - they don't directly reference objects
            if (ref.type === 'symbolic') {
                continue;
            }
            const target = ref.target;
            if (target && target.length === 40 && /^[0-9a-f]{40}$/.test(target)) {
                this.log('debug', `Walking from ref ${ref.name} -> ${target}`);
                await this.walkObject(target, reachable, visited);
            }
        }
        return reachable;
    }
    /**
     * Walk an object and all objects it references.
     *
     * @description
     * Recursively walks the object graph starting from the given SHA.
     * Marks all visited objects as reachable.
     *
     * @param sha - SHA of the object to walk from
     * @param reachable - Set to add reachable SHAs to
     * @param visited - Set of already-visited SHAs (to prevent cycles)
     */
    async walkObject(sha, reachable, visited) {
        // Avoid cycles and redundant work
        if (visited.has(sha)) {
            return;
        }
        visited.add(sha);
        // Get the object
        const obj = await this.objectStore.getObject(sha);
        if (!obj) {
            this.log('warn', `Object not found during walk: ${sha}`);
            return;
        }
        // Mark as reachable
        reachable.add(sha);
        // Walk referenced objects based on type
        switch (obj.type) {
            case 'commit':
                await this.walkCommit(sha, obj.content, reachable, visited);
                break;
            case 'tree':
                await this.walkTree(sha, obj.content, reachable, visited);
                break;
            case 'tag':
                await this.walkTag(sha, obj.content, reachable, visited);
                break;
            case 'blob':
                // Blobs don't reference other objects
                break;
        }
    }
    /**
     * Walk a commit object and its references.
     *
     * @description
     * Commits reference:
     * - A tree (the snapshot)
     * - Parent commits (0 or more)
     *
     * @param sha - SHA of the commit
     * @param content - Raw commit content
     * @param reachable - Set to add reachable SHAs to
     * @param visited - Set of already-visited SHAs
     */
    async walkCommit(_sha, content, reachable, visited) {
        const text = new TextDecoder().decode(content);
        const lines = text.split('\n');
        for (const line of lines) {
            if (line.startsWith('tree ')) {
                const treeSha = line.slice(5).trim();
                await this.walkObject(treeSha, reachable, visited);
            }
            else if (line.startsWith('parent ')) {
                const parentSha = line.slice(7).trim();
                await this.walkObject(parentSha, reachable, visited);
            }
            else if (line === '') {
                // Empty line marks start of message - stop parsing headers
                break;
            }
        }
    }
    /**
     * Walk a tree object and its references.
     *
     * @description
     * Trees reference blobs (files) and other trees (subdirectories).
     * Tree entry format: "{mode} {name}\0{20-byte-sha}"
     *
     * @param sha - SHA of the tree
     * @param content - Raw tree content
     * @param reachable - Set to add reachable SHAs to
     * @param visited - Set of already-visited SHAs
     */
    async walkTree(_sha, content, reachable, visited) {
        let offset = 0;
        while (offset < content.length) {
            // Find the null byte that separates mode+name from SHA
            let nullIndex = offset;
            while (nullIndex < content.length && content[nullIndex] !== 0) {
                nullIndex++;
            }
            if (nullIndex >= content.length) {
                break;
            }
            // Extract the 20-byte SHA after the null byte
            const shaStart = nullIndex + 1;
            const shaEnd = shaStart + 20;
            if (shaEnd > content.length) {
                break;
            }
            // Convert 20-byte SHA to hex string
            const shaBytes = content.slice(shaStart, shaEnd);
            const entrySha = Array.from(shaBytes)
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
            // Walk the referenced object
            await this.walkObject(entrySha, reachable, visited);
            offset = shaEnd;
        }
    }
    /**
     * Walk a tag object and its references.
     *
     * @description
     * Tags reference a single object (usually a commit, but can be any type).
     *
     * @param sha - SHA of the tag
     * @param content - Raw tag content
     * @param reachable - Set to add reachable SHAs to
     * @param visited - Set of already-visited SHAs
     */
    async walkTag(_sha, content, reachable, visited) {
        const text = new TextDecoder().decode(content);
        const lines = text.split('\n');
        for (const line of lines) {
            if (line.startsWith('object ')) {
                const objectSha = line.slice(7).trim();
                await this.walkObject(objectSha, reachable, visited);
                break; // Tags only reference one object
            }
        }
    }
    /**
     * Get a preview of what would be collected without actually deleting.
     *
     * @description
     * Convenience method that runs GC in dry-run mode.
     *
     * @param options - Runtime options (gracePeriodMs, maxDeleteCount)
     * @returns GC result preview
     */
    async preview(options) {
        return this.collect({ ...options, dryRun: true });
    }
}
// ============================================================================
// ParquetStore Adapter
// ============================================================================
/**
 * Adapter to make ParquetStore compatible with GCObjectStore interface.
 *
 * @description
 * ParquetStore doesn't have a listAllObjects method, so this adapter
 * reads all Parquet files and extracts object metadata.
 */
export class ParquetStoreGCAdapter {
    store;
    r2;
    prefix;
    sql;
    constructor(store, r2, sql, prefix) {
        this.store = store;
        this.r2 = r2;
        this.sql = sql;
        this.prefix = prefix;
    }
    async getObject(sha) {
        return this.store.getObject(sha);
    }
    async hasObject(sha) {
        return this.store.hasObject(sha);
    }
    async deleteObject(sha) {
        return this.store.deleteObject(sha);
    }
    /**
     * List all objects by querying the bloom filter cache.
     *
     * @description
     * The bloom cache SQLite table stores SHA, type, and size for all objects.
     * We use this as the source of truth for listing objects.
     */
    async listAllObjects() {
        try {
            // Query the exact_cache table which stores all known SHAs
            const result = this.sql.sql.exec(`SELECT sha, type, size, added_at FROM exact_cache`);
            const rawRows = result.toArray();
            return rawRows.map(row => ({
                sha: row.sha,
                type: row.type,
                size: row.size,
                createdAt: row.added_at,
            }));
        }
        catch (err) {
            // If exact_cache doesn't exist, fall back to scanning Parquet files
            return this.listObjectsFromParquet();
        }
    }
    /**
     * Fallback method to list objects by scanning Parquet files.
     */
    async listObjectsFromParquet() {
        const objects = [];
        // List Parquet files from R2
        const listed = await this.r2.list({ prefix: `${this.prefix}/objects/` });
        for (const obj of listed.objects) {
            const key = obj.key;
            if (!key.endsWith('.parquet'))
                continue;
            const r2Obj = await this.r2.get(key);
            if (!r2Obj)
                continue;
            try {
                const { parquetReadObjects } = await import('hyparquet');
                const arrayBuffer = await r2Obj.arrayBuffer();
                const file = {
                    byteLength: arrayBuffer.byteLength,
                    slice: (start, end) => arrayBuffer.slice(start, end)
                };
                const rows = await parquetReadObjects({
                    file,
                    columns: ['sha', 'type', 'size'],
                    rowFormat: 'object',
                });
                for (const row of rows) {
                    if (row.sha && row.type) {
                        objects.push({
                            sha: String(row.sha),
                            type: row.type,
                            size: typeof row.size === 'bigint' ? Number(row.size) : (row.size ?? 0),
                            // Parquet files don't have creation timestamp per-object
                            // Use the file's upload timestamp as a rough approximation
                            createdAt: obj.uploaded?.getTime()
                        });
                    }
                }
            }
            catch (err) {
                // Skip unreadable files
                console.warn(`[GC] Failed to read Parquet file ${key}:`, err);
            }
        }
        return objects;
    }
}
/**
 * Create a GarbageCollector for a ParquetStore.
 *
 * @description
 * Factory function that creates a properly configured GarbageCollector
 * for use with ParquetStore and ParquetRefStore.
 *
 * @param store - ParquetStore instance
 * @param refStore - ParquetRefStore instance
 * @param r2 - R2 bucket reference
 * @param sql - SQLite storage reference
 * @param prefix - Repository prefix in R2
 * @param options - GC configuration options
 * @returns Configured GarbageCollector
 *
 * @example
 * ```typescript
 * const gc = createGCForParquetStore(
 *   parquetStore,
 *   refStore,
 *   r2Bucket,
 *   sqlStorage,
 *   'owner/repo',
 *   { gracePeriodMs: 7 * 24 * 60 * 60 * 1000 }
 * )
 * const result = await gc.collect()
 * ```
 */
export function createGCForParquetStore(store, refStore, r2, sql, prefix, options) {
    const adapter = new ParquetStoreGCAdapter(store, r2, sql, prefix);
    return new GarbageCollector(adapter, refStore, options);
}
//# sourceMappingURL=gc.js.map