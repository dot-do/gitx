/**
 * @fileoverview Iceberg v2 Table Metadata Generation
 *
 * Generates Iceberg v2 metadata JSON pointing to existing Parquet data files
 * on R2. Follows the UniForm pattern: same Parquet files, Iceberg metadata overlay.
 *
 * @module iceberg/metadata
 */
export interface IcebergField {
    id: number;
    name: string;
    required: boolean;
    type: string;
}
export interface IcebergSchema {
    'schema-id': number;
    type: 'struct';
    fields: IcebergField[];
}
export interface IcebergPartitionSpec {
    'spec-id': number;
    fields: unknown[];
}
export interface IcebergSortOrder {
    'order-id': number;
    fields: unknown[];
}
export interface IcebergSnapshot {
    'snapshot-id': number;
    'parent-snapshot-id'?: number;
    'timestamp-ms': number;
    summary: Record<string, string>;
    'manifest-list': string;
    'schema-id': number;
}
export interface SnapshotLogEntry {
    'timestamp-ms': number;
    'snapshot-id': number;
}
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
    'snapshot-log': SnapshotLogEntry[];
}
/**
 * Iceberg schema matching the GIT_OBJECTS_SCHEMA from parquet-store.ts.
 * Each field gets a unique field-id as required by Iceberg v2.
 */
export declare const GIT_OBJECTS_ICEBERG_SCHEMA: {
    'schema-id': number;
    type: 'struct';
    fields: IcebergField[];
};
export interface CreateTableMetadataOptions {
    location: string;
    tableUuid?: string;
}
/**
 * Create a new Iceberg v2 table metadata object.
 */
export declare function createTableMetadata(options: CreateTableMetadataOptions): IcebergTableMetadata;
export interface AddSnapshotOptions {
    manifestListPath: string;
    summary?: Record<string, string>;
    snapshotId?: number;
}
/**
 * Add a new snapshot to the table metadata (immutable - returns new metadata).
 * Each flush of Parquet data becomes a new snapshot.
 */
export declare function addSnapshot(metadata: IcebergTableMetadata, options: AddSnapshotOptions): IcebergTableMetadata;
/**
 * Serialize Iceberg table metadata to JSON string.
 */
export declare function serializeMetadata(metadata: IcebergTableMetadata): string;
//# sourceMappingURL=metadata.d.ts.map