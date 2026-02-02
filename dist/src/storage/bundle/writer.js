/**
 * @fileoverview BundleWriter - Buffered writes with rotation and sealing for R2 bundle storage
 *
 * The BundleWriter accumulates git objects in memory until a size threshold is reached,
 * then flushes (seals) the current bundle to R2 and rotates to a new one. This batching
 * strategy minimizes R2 PUT operations while keeping memory usage bounded.
 *
 * Lifecycle:
 * 1. Create writer with R2 bucket and config
 * 2. Add objects via add() - auto-rotates when bundle is full
 * 3. Call flush() to seal the current bundle to R2
 * 4. Call close() to flush remaining objects and finalize
 *
 * @module storage/bundle/writer
 */
import { BUNDLE_HEADER_SIZE, BUNDLE_INDEX_ENTRY_SIZE, DEFAULT_MAX_BUNDLE_SIZE, createBundle, } from './format';
export class BundleWriterError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'BundleWriterError';
    }
}
// ============================================================================
// BundleWriter
// ============================================================================
function generateBundleId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `${timestamp}-${random}`;
}
/**
 * BundleWriter accumulates git objects and writes them as bundles to R2.
 *
 * Objects are buffered in memory. When the buffer exceeds `maxBundleSize`,
 * the current bundle is sealed (written to R2) and a new bundle is started.
 *
 * @example
 * ```typescript
 * const writer = new BundleWriter(r2Storage, { maxBundleSize: 64 * 1024 * 1024 })
 * await writer.add(oid, BundleObjectType.BLOB, data)
 * await writer.add(oid2, BundleObjectType.TREE, treeData)
 * const result = await writer.close()
 * console.log(`Wrote ${result.totalObjects} objects in ${result.totalBundles} bundles`)
 * ```
 */
export class BundleWriter {
    config;
    storage;
    currentBundleId;
    objects = new Map();
    sealedBundles = [];
    rotationCallbacks = [];
    closed = false;
    flushLock = null;
    stats = {
        totalObjectsWritten: 0,
        totalBytesWritten: 0,
        bundlesSealed: 0,
        rotations: 0,
    };
    constructor(storage, config) {
        this.config = {
            maxBundleSize: config?.maxBundleSize ?? DEFAULT_MAX_BUNDLE_SIZE,
            keyPrefix: config?.keyPrefix ?? 'bundles/',
            checksums: config?.checksums ?? true,
        };
        this.storage = storage;
        this.currentBundleId = generateBundleId();
    }
    /** Current active bundle ID */
    get activeBundleId() {
        return this.currentBundleId;
    }
    /** Number of objects in the current (unflushed) bundle */
    get pendingObjectCount() {
        return this.objects.size;
    }
    /** Estimated size of the current bundle if it were sealed now */
    get pendingSize() {
        let dataSize = 0;
        for (const obj of this.objects.values()) {
            dataSize += obj.data.length;
        }
        return BUNDLE_HEADER_SIZE + dataSize + this.objects.size * BUNDLE_INDEX_ENTRY_SIZE;
    }
    /** Remaining capacity in the current bundle before rotation */
    get remainingCapacity() {
        return Math.max(0, this.config.maxBundleSize - this.pendingSize);
    }
    /** Whether the writer has been closed */
    get isClosed() {
        return this.closed;
    }
    /** Check if a specific OID is in the current pending buffer */
    hasPendingObject(oid) {
        return this.objects.has(oid);
    }
    /** Check if the writer can accept an object of the given size without rotating */
    canAccept(dataSize) {
        const projected = this.pendingSize + dataSize + BUNDLE_INDEX_ENTRY_SIZE;
        return projected <= this.config.maxBundleSize;
    }
    /**
     * Add a git object to the current bundle.
     *
     * If adding the object would exceed the max bundle size and there are
     * already objects in the buffer, the current bundle is sealed and rotated
     * before the new object is added.
     */
    async add(oid, type, data) {
        if (this.closed) {
            throw new BundleWriterError('Cannot add to closed writer');
        }
        if (this.objects.has(oid)) {
            throw new BundleWriterError(`Duplicate OID: ${oid}`);
        }
        const entrySize = data.length + BUNDLE_INDEX_ENTRY_SIZE;
        const projected = this.pendingSize + entrySize;
        if (projected > this.config.maxBundleSize && this.objects.size > 0) {
            await this.rotate();
        }
        this.objects.set(oid, { type, data });
    }
    /**
     * Add multiple objects in a batch. Each object may trigger rotation independently.
     */
    async addBatch(objects) {
        for (const obj of objects) {
            await this.add(obj.oid, obj.type, obj.data);
        }
    }
    /** Register a callback to be notified when a bundle is rotated */
    onRotation(callback) {
        this.rotationCallbacks.push(callback);
    }
    /**
     * Flush the current bundle to R2 storage.
     *
     * Returns null if there are no pending objects. Concurrent flush calls
     * are serialized (subsequent calls wait for the first to complete).
     */
    async flush() {
        if (this.flushLock) {
            await this.flushLock;
            return null;
        }
        const promise = this.flushInternal();
        this.flushLock = promise;
        try {
            return await promise;
        }
        finally {
            this.flushLock = null;
        }
    }
    /**
     * Close the writer, flushing any remaining objects.
     *
     * After close, no more objects can be added. Calling close multiple
     * times is safe (idempotent).
     */
    async close() {
        if (this.closed) {
            return this.buildFinalResult();
        }
        if (this.objects.size > 0) {
            await this.flush();
        }
        this.closed = true;
        return this.buildFinalResult();
    }
    /** Get cumulative statistics */
    getStats() {
        return { ...this.stats };
    }
    /** Get metadata for all sealed bundles */
    getSealedBundles() {
        return [...this.sealedBundles];
    }
    // --------------------------------------------------------------------------
    // Private
    // --------------------------------------------------------------------------
    async rotate() {
        const sealedId = this.currentBundleId;
        const metadata = await this.flushInternal();
        this.currentBundleId = generateBundleId();
        this.stats.rotations++;
        if (metadata) {
            const event = {
                sealedBundleId: sealedId,
                sealedMetadata: metadata,
                newBundleId: this.currentBundleId,
            };
            for (const cb of this.rotationCallbacks) {
                cb(event);
            }
        }
    }
    async flushInternal() {
        if (this.objects.size === 0) {
            return null;
        }
        const objectsArray = Array.from(this.objects.entries()).map(([oid, obj]) => ({
            oid,
            type: obj.type,
            data: obj.data,
        }));
        const bundleData = createBundle(objectsArray);
        const key = `${this.config.keyPrefix}${this.currentBundleId}.bundle`;
        try {
            await this.storage.put(key, bundleData);
        }
        catch (error) {
            throw new BundleWriterError('Failed to write bundle to R2', error instanceof Error ? error : new Error(String(error)));
        }
        const metadata = {
            id: this.currentBundleId,
            key,
            size: bundleData.length,
            objectCount: this.objects.size,
            sealedAt: Date.now(),
        };
        this.stats.totalObjectsWritten += this.objects.size;
        this.stats.totalBytesWritten += bundleData.length;
        this.stats.bundlesSealed++;
        this.sealedBundles.push(metadata);
        this.objects.clear();
        this.currentBundleId = generateBundleId();
        return metadata;
    }
    buildFinalResult() {
        return {
            totalBundles: this.sealedBundles.length,
            totalObjects: this.stats.totalObjectsWritten,
            bundleIds: this.sealedBundles.map((b) => b.id),
            bundles: [...this.sealedBundles],
        };
    }
}
//# sourceMappingURL=writer.js.map