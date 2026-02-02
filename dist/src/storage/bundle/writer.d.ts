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
import { type BundleObjectType } from './format';
/** Configuration for the BundleWriter */
export interface BundleWriterConfig {
    /** Maximum size of a single bundle before rotation (default: 128MB) */
    maxBundleSize?: number;
    /** R2 key prefix for bundle files (default: 'bundles/') */
    keyPrefix?: string;
    /** Whether to include checksums in written bundles (default: true) */
    checksums?: boolean;
}
/** R2-compatible storage interface for writing bundles */
export interface BundleWriteStorage {
    /** Write a bundle to storage at the given key */
    put(key: string, data: Uint8Array | ArrayBuffer): Promise<void>;
    /** Delete a bundle from storage */
    delete(key: string): Promise<void>;
}
/** Metadata about a sealed bundle */
export interface SealedBundleMetadata {
    /** Unique bundle ID */
    id: string;
    /** R2 key where the bundle is stored */
    key: string;
    /** Total size in bytes */
    size: number;
    /** Number of objects in the bundle */
    objectCount: number;
    /** Timestamp when the bundle was sealed */
    sealedAt: number;
}
/** Event emitted when a bundle is rotated */
export interface BundleRotationEvent {
    /** ID of the bundle that was just sealed */
    sealedBundleId: string;
    /** Metadata of the sealed bundle */
    sealedMetadata: SealedBundleMetadata;
    /** ID of the new active bundle */
    newBundleId: string;
}
/** Cumulative writer statistics */
export interface BundleWriterStats {
    /** Total objects written across all bundles */
    totalObjectsWritten: number;
    /** Total bytes written across all bundles */
    totalBytesWritten: number;
    /** Number of bundles sealed */
    bundlesSealed: number;
    /** Number of auto-rotations triggered */
    rotations: number;
}
/** Final metadata returned when writer is closed */
export interface BundleWriterFinalResult {
    /** Total bundles written (including final flush) */
    totalBundles: number;
    /** Total objects written */
    totalObjects: number;
    /** All sealed bundle IDs in order */
    bundleIds: string[];
    /** All sealed bundle metadata */
    bundles: SealedBundleMetadata[];
}
export declare class BundleWriterError extends Error {
    readonly cause?: Error | undefined;
    constructor(message: string, cause?: Error | undefined);
}
export type RotationCallback = (event: BundleRotationEvent) => void;
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
export declare class BundleWriter {
    private readonly config;
    private readonly storage;
    private currentBundleId;
    private objects;
    private sealedBundles;
    private rotationCallbacks;
    private closed;
    private flushLock;
    private stats;
    constructor(storage: BundleWriteStorage, config?: BundleWriterConfig);
    /** Current active bundle ID */
    get activeBundleId(): string;
    /** Number of objects in the current (unflushed) bundle */
    get pendingObjectCount(): number;
    /** Estimated size of the current bundle if it were sealed now */
    get pendingSize(): number;
    /** Remaining capacity in the current bundle before rotation */
    get remainingCapacity(): number;
    /** Whether the writer has been closed */
    get isClosed(): boolean;
    /** Check if a specific OID is in the current pending buffer */
    hasPendingObject(oid: string): boolean;
    /** Check if the writer can accept an object of the given size without rotating */
    canAccept(dataSize: number): boolean;
    /**
     * Add a git object to the current bundle.
     *
     * If adding the object would exceed the max bundle size and there are
     * already objects in the buffer, the current bundle is sealed and rotated
     * before the new object is added.
     */
    add(oid: string, type: BundleObjectType, data: Uint8Array): Promise<void>;
    /**
     * Add multiple objects in a batch. Each object may trigger rotation independently.
     */
    addBatch(objects: Array<{
        oid: string;
        type: BundleObjectType;
        data: Uint8Array;
    }>): Promise<void>;
    /** Register a callback to be notified when a bundle is rotated */
    onRotation(callback: RotationCallback): void;
    /**
     * Flush the current bundle to R2 storage.
     *
     * Returns null if there are no pending objects. Concurrent flush calls
     * are serialized (subsequent calls wait for the first to complete).
     */
    flush(): Promise<SealedBundleMetadata | null>;
    /**
     * Close the writer, flushing any remaining objects.
     *
     * After close, no more objects can be added. Calling close multiple
     * times is safe (idempotent).
     */
    close(): Promise<BundleWriterFinalResult>;
    /** Get cumulative statistics */
    getStats(): BundleWriterStats;
    /** Get metadata for all sealed bundles */
    getSealedBundles(): SealedBundleMetadata[];
    private rotate;
    private flushInternal;
    private buildFinalResult;
}
//# sourceMappingURL=writer.d.ts.map