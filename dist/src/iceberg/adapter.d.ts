/**
 * @fileoverview Adapter layer between GitX's Iceberg API and @dotdo/iceberg
 *
 * This module provides backward-compatible wrappers that bridge the local
 * GitX Iceberg implementation to the comprehensive @dotdo/iceberg library.
 * It ensures existing code continues to work while leveraging the full
 * capabilities of @dotdo/iceberg.
 *
 * @module iceberg/adapter
 */
import { type TableMetadata, type IcebergSchema as LibIcebergSchema } from '@dotdo/iceberg';
export type { TableMetadata, Snapshot, ManifestFile, DataFile, PartitionSpec, SortOrder, ManifestEntry as LibManifestEntry, ManifestEntryStatus, SnapshotSummary, SnapshotRef, SnapshotLogEntry as LibSnapshotLogEntry, MetadataLogEntry, } from '@dotdo/iceberg';
export { ManifestGenerator, ManifestListGenerator, TableMetadataBuilder, SnapshotBuilder, SnapshotManager, generateUUID, } from '@dotdo/iceberg';
/**
 * Generates a unique snapshot ID that is collision-resistant.
 *
 * Uses a combination of:
 * - Timestamp in milliseconds (provides ordering across time)
 * - Monotonic counter (guarantees uniqueness within same millisecond)
 *
 * This ensures uniqueness even when multiple snapshots are created in the same millisecond.
 * The resulting ID is a positive integer that fits within JavaScript's safe integer range.
 *
 * Format: timestamp_ms * 10_000 + counter
 * - Counter resets each millisecond and provides up to 10,000 unique values per ms
 * - This allows for very rapid ID generation without collisions
 *
 * Max value calculation:
 * - Current timestamp: ~1.74e12 (year 2025)
 * - Max timestamp by year 2500: ~1.67e13
 * - With multiplier 10_000: ~1.67e17 (still within MAX_SAFE_INTEGER = 9e15)
 *
 * Wait, that exceeds MAX_SAFE_INTEGER. Let's use a smaller multiplier.
 * With multiplier 1000: max ~1.74e15 (safely within 9e15)
 *
 * @returns A unique snapshot ID as a positive integer
 *
 * @example
 * ```typescript
 * const id1 = generateSnapshotId() // e.g., 1706889600000000
 * const id2 = generateSnapshotId() // e.g., 1706889600000001
 * ```
 */
export declare function generateSnapshotId(): number;
/**
 * Legacy IcebergField type (compatible with existing GitX code)
 * Maps to @dotdo/iceberg's IcebergStructField
 */
export interface IcebergField {
    id: number;
    name: string;
    required: boolean;
    type: string;
}
/**
 * Legacy IcebergSchema type (compatible with existing GitX code)
 */
export interface IcebergSchema {
    'schema-id': number;
    type: 'struct';
    fields: IcebergField[];
}
/**
 * Legacy IcebergPartitionSpec type
 */
export interface IcebergPartitionSpec {
    'spec-id': number;
    fields: unknown[];
}
/**
 * Legacy IcebergSortOrder type
 */
export interface IcebergSortOrder {
    'order-id': number;
    fields: unknown[];
}
/**
 * Legacy IcebergSnapshot type (compatible with existing GitX code)
 */
export interface IcebergSnapshot {
    'snapshot-id': number;
    'parent-snapshot-id'?: number;
    'timestamp-ms': number;
    summary: Record<string, string>;
    'manifest-list': string;
    'schema-id': number;
}
/**
 * Legacy SnapshotLogEntry type
 */
export interface LegacySnapshotLogEntry {
    'timestamp-ms': number;
    'snapshot-id': number;
}
/**
 * Legacy IcebergTableMetadata type (compatible with existing GitX code)
 * Bridges to @dotdo/iceberg's TableMetadata
 */
export interface IcebergTableMetadata {
    'format-version': 2;
    'table-uuid': string;
    location: string;
    'last-updated-ms': number;
    'last-column-id': number;
    schemas: IcebergSchema[];
    'current-schema-id': number;
    'partition-specs': IcebergPartitionSpec[];
    'default-spec-id': number;
    'sort-orders': IcebergSortOrder[];
    'default-sort-order-id': number;
    properties: Record<string, string>;
    snapshots: IcebergSnapshot[];
    'current-snapshot-id': number;
    'snapshot-log': LegacySnapshotLogEntry[];
}
export interface ColumnStat {
    minValue: string | number;
    maxValue: string | number;
    nullCount: number;
}
export interface DataFileInput {
    filePath: string;
    fileSizeBytes: number;
    recordCount: number;
    columnStats?: Record<string, ColumnStat>;
}
export interface LegacyIcebergDataFile {
    content: number;
    'file-path': string;
    'file-format': 'PARQUET';
    partition: Record<string, never>;
    'record-count': number;
    'file-size-in-bytes': number;
    'column-sizes'?: Record<number, number>;
    'lower-bounds'?: Record<number, string | number>;
    'upper-bounds'?: Record<number, string | number>;
    'null-value-counts'?: Record<number, number>;
}
export interface ManifestEntry {
    status: number;
    content: number;
    'data-file': LegacyIcebergDataFile;
    'snapshot-id'?: number;
    'sequence-number'?: number;
}
export interface Manifest {
    'manifest-path': string;
    'schema-id': number;
    'partition-spec-id': number;
    content: number;
    'added-files-count': number;
    'added-rows-count': number;
    'existing-files-count': number;
    'deleted-files-count': number;
    entries: ManifestEntry[];
}
export interface ManifestListEntry {
    'manifest-path': string;
    'manifest-length': number;
    'partition-spec-id': number;
    content: number;
    'added-data-files-count': number;
    'added-rows-count': number;
    'existing-data-files-count': number;
    'deleted-data-files-count': number;
    'snapshot-id': number;
}
export interface ManifestList {
    entries: ManifestListEntry[];
}
/**
 * Field ID mapping for Git objects schema
 */
export declare const FIELD_ID_MAP: Record<string, number>;
/**
 * Git Objects Iceberg Schema (legacy format compatible with existing GitX code)
 */
export declare const GIT_OBJECTS_ICEBERG_SCHEMA: IcebergSchema;
/**
 * Convert legacy IcebergSchema to @dotdo/iceberg IcebergSchema
 */
export declare function toLegacySchema(schema: LibIcebergSchema): IcebergSchema;
/**
 * Convert legacy IcebergSchema to @dotdo/iceberg IcebergSchema
 */
export declare function fromLegacySchema(schema: IcebergSchema): LibIcebergSchema;
/**
 * Convert @dotdo/iceberg TableMetadata to legacy IcebergTableMetadata
 */
export declare function toLegacyTableMetadata(metadata: TableMetadata): IcebergTableMetadata;
/**
 * Convert legacy IcebergTableMetadata to @dotdo/iceberg TableMetadata
 */
export declare function fromLegacyTableMetadata(legacy: IcebergTableMetadata): TableMetadata;
/**
 * Create table metadata options (legacy compatible)
 */
export interface CreateTableMetadataOptions {
    location: string;
    tableUuid?: string;
}
/**
 * Create a new Iceberg v2 table metadata object (legacy API).
 * This wraps @dotdo/iceberg's TableMetadataBuilder.
 */
export declare function createTableMetadata(options: CreateTableMetadataOptions): IcebergTableMetadata;
/**
 * Add snapshot options (legacy compatible)
 */
export interface AddSnapshotOptions {
    manifestListPath: string;
    summary?: Record<string, string>;
    snapshotId?: number;
}
/**
 * Add a new snapshot to the table metadata (immutable - returns new metadata).
 * Legacy API wrapping @dotdo/iceberg functionality.
 */
export declare function addSnapshot(metadata: IcebergTableMetadata, options: AddSnapshotOptions): IcebergTableMetadata;
/**
 * Serialize Iceberg table metadata to JSON string.
 */
export declare function serializeMetadata(metadata: IcebergTableMetadata): string;
/**
 * Create a manifest entry for a Parquet data file (legacy API).
 */
export declare function createManifestEntry(dataFile: DataFileInput, options?: {
    status?: number;
}): ManifestEntry;
/**
 * Create manifest options (legacy API)
 */
export interface CreateManifestOptions {
    entries: ManifestEntry[];
    schemaId: number;
    manifestPath: string;
    partitionSpecId?: number;
}
/**
 * Create a manifest containing references to data files (legacy API).
 */
export declare function createManifest(options: CreateManifestOptions): Manifest;
/**
 * Create manifest list options (legacy API)
 */
export interface CreateManifestListOptions {
    manifests: Manifest[];
    snapshotId: number;
}
/**
 * Create a manifest list referencing one or more manifests (legacy API).
 */
export declare function createManifestList(options: CreateManifestListOptions): ManifestList;
/**
 * Serialize a manifest to JSON.
 */
export declare function serializeManifest(manifest: Manifest): string;
/**
 * Serialize a manifest list to JSON.
 */
export declare function serializeManifestList(manifestList: ManifestList): string;
//# sourceMappingURL=adapter.d.ts.map