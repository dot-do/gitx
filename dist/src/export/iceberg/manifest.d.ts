/**
 * @fileoverview Iceberg Manifest Management
 *
 * Utilities for creating and managing Iceberg manifest files
 * and snapshot metadata.
 *
 * @module export/iceberg/manifest
 */
import type { DataFile, ManifestEntry, ManifestFile, IcebergSnapshot, SnapshotSummary } from './types';
/**
 * Options for creating a manifest.
 */
export interface CreateManifestOptions {
    /** Snapshot ID this manifest belongs to */
    snapshotId: number;
    /** Sequence number */
    sequenceNumber: number;
    /** Partition spec ID */
    partitionSpecId?: number;
}
/**
 * Manifest builder for accumulating data files.
 */
export interface ManifestBuilder {
    /** Add a data file to the manifest */
    addFile(file: DataFile): void;
    /** Get all entries */
    getEntries(): ManifestEntry[];
    /** Build manifest metadata */
    build(): ManifestFile;
}
/**
 * Creates a new manifest builder.
 *
 * @param options - Manifest creation options
 * @returns ManifestBuilder instance
 *
 * @example
 * ```typescript
 * const builder = createManifestBuilder({
 *   snapshotId: 1234567890,
 *   sequenceNumber: 1,
 * })
 *
 * builder.addFile(dataFile1)
 * builder.addFile(dataFile2)
 *
 * const entries = builder.getEntries()
 * const manifest = builder.build()
 * ```
 */
export declare function createManifestBuilder(options: CreateManifestOptions): ManifestBuilder;
/**
 * Options for creating a snapshot.
 */
export interface CreateSnapshotOptions {
    /** Parent snapshot ID (if any) */
    parentSnapshotId?: number;
    /** Sequence number (auto-incremented from parent if not provided) */
    sequenceNumber?: number;
    /** Schema ID */
    schemaId?: number;
    /** Summary operation type */
    operation?: SnapshotSummary['operation'];
}
/**
 * Creates a new snapshot from manifest files.
 *
 * @param manifestList - Path to the manifest list
 * @param manifests - List of manifest files included
 * @param options - Snapshot creation options
 * @returns IcebergSnapshot
 */
export declare function createSnapshot(manifestList: string, manifests: ManifestFile[], options?: CreateSnapshotOptions): IcebergSnapshot;
/**
 * Serializes manifest entries to JSON format.
 *
 * @description
 * Note: In production, Iceberg manifests are typically Avro format.
 * This implementation uses JSON for simplicity and compatibility
 * with R2's storage model.
 *
 * @param entries - Manifest entries to serialize
 * @returns JSON string
 */
export declare function serializeManifest(entries: ManifestEntry[]): string;
/**
 * Serializes manifest list to JSON format.
 *
 * @param manifests - Manifest file metadata
 * @returns JSON string
 */
export declare function serializeManifestList(manifests: ManifestFile[]): string;
/**
 * Generates a unique manifest file name.
 */
export declare function generateManifestName(snapshotId: number, index?: number): string;
/**
 * Generates a unique manifest list file name.
 */
export declare function generateManifestListName(snapshotId: number): string;
//# sourceMappingURL=manifest.d.ts.map