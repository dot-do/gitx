/**
 * BundleWriter - High-level component for creating bundles from git objects
 *
 * Responsibilities:
 * - Accept git objects and add to current bundle
 * - Track bundle size, flush when reaching size limit
 * - Rotate to new bundle file when current is full
 * - Write bundle header and index on flush
 */
import { BundleObjectType } from './bundle-format';
export interface BundleWriterConfig {
    maxBundleSize?: number;
    storagePrefix?: string;
}
export interface BundleWriterStorage {
    write(key: string, data: Uint8Array): Promise<void>;
    read(key: string): Promise<Uint8Array | null>;
    delete(key: string): Promise<void>;
    list(prefix: string): Promise<string[]>;
}
export interface BundleMetadata {
    id: string;
    size: number;
    objectCount: number;
    isEmpty?: boolean;
    createdAt?: Date;
}
export interface BundleRotationEvent {
    previousBundleId: string;
    newBundleId: string;
    previousBundleMetadata: BundleMetadata;
}
export interface BundleWriterStats {
    totalObjectsWritten: number;
    totalBytesWritten: number;
    bundleCount: number;
}
export interface BundleWriterFinalMetadata {
    totalBundles: number;
    totalObjects: number;
    bundleIds: string[];
}
export declare class BundleWriterError extends Error {
    readonly cause?: Error | undefined;
    constructor(message: string, cause?: Error | undefined);
}
export type RotationCallback = (event: BundleRotationEvent) => void;
/**
 * BundleWriter class - creates bundles from git objects
 */
export declare class BundleWriter {
    private _config;
    private storage;
    private _currentBundleId;
    private objects;
    private _totalBundlesWritten;
    private rotationCallbacks;
    private writtenBundles;
    private _closed;
    private flushLock;
    private totalObjectsWritten;
    private totalBytesWritten;
    constructor(config: BundleWriterConfig, storage: BundleWriterStorage);
    get config(): BundleWriterConfig & {
        maxBundleSize: number;
        storagePrefix: string;
    };
    get currentBundleId(): string;
    get currentBundleObjectCount(): number;
    get currentBundleSize(): number;
    get remainingCapacity(): number;
    get totalBundlesWritten(): number;
    hasObject(oid: string): boolean;
    canAccept(bytes: number): boolean;
    /**
     * Add an object to the current bundle.
     *
     * @throws {BundleWriterError} If writer is closed
     * @throws {BundleWriterError} If object with same OID already exists
     * @throws {BundleWriterError} If bundle rotation fails
     */
    add(oid: string, type: BundleObjectType, data: Uint8Array): Promise<void>;
    addBatch(objects: Array<{
        oid: string;
        type: BundleObjectType;
        data: Uint8Array;
    }>): Promise<void>;
    private rotate;
    flush(): Promise<BundleMetadata>;
    private flushInternal;
    onRotation(callback: RotationCallback): void;
    getStats(): BundleWriterStats;
    getWrittenBundleIds(): string[];
    getBundleMetadata(id: string): BundleMetadata | undefined;
    close(): Promise<BundleWriterFinalMetadata>;
}
//# sourceMappingURL=bundle-writer.d.ts.map