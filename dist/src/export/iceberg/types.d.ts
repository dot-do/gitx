/**
 * @fileoverview Iceberg Types
 *
 * Type definitions for Apache Iceberg table format metadata.
 *
 * @module export/iceberg/types
 */
/**
 * Iceberg primitive types.
 */
export type IcebergPrimitiveType = 'boolean' | 'int' | 'long' | 'float' | 'double' | 'decimal' | 'date' | 'time' | 'timestamp' | 'timestamptz' | 'string' | 'uuid' | 'fixed' | 'binary';
/**
 * Iceberg field definition.
 */
export interface IcebergField {
    id: number;
    name: string;
    required: boolean;
    type: IcebergPrimitiveType | IcebergStructType | IcebergListType | IcebergMapType;
    doc?: string;
}
/**
 * Iceberg struct type (nested fields).
 */
export interface IcebergStructType {
    type: 'struct';
    fields: IcebergField[];
}
/**
 * Iceberg list type.
 */
export interface IcebergListType {
    type: 'list';
    element_id: number;
    element: IcebergPrimitiveType | IcebergStructType;
    element_required: boolean;
}
/**
 * Iceberg map type.
 */
export interface IcebergMapType {
    type: 'map';
    key_id: number;
    key: IcebergPrimitiveType;
    value_id: number;
    value: IcebergPrimitiveType | IcebergStructType;
    value_required: boolean;
}
/**
 * Iceberg schema definition.
 */
export interface IcebergSchema {
    type: 'struct';
    schema_id: number;
    fields: IcebergField[];
}
/**
 * Partition transform types.
 */
export type PartitionTransform = 'identity' | 'year' | 'month' | 'day' | 'hour' | 'bucket' | 'truncate' | 'void';
/**
 * Partition field specification.
 */
export interface PartitionField {
    source_id: number;
    field_id: number;
    name: string;
    transform: PartitionTransform | {
        type: 'bucket' | 'truncate';
        width: number;
    };
}
/**
 * Partition specification.
 */
export interface PartitionSpec {
    spec_id: number;
    fields: PartitionField[];
}
/**
 * Snapshot summary statistics.
 */
export interface SnapshotSummary {
    operation: 'append' | 'replace' | 'overwrite' | 'delete';
    'added-data-files'?: string;
    'added-records'?: string;
    'added-files-size'?: string;
    'deleted-data-files'?: string;
    'deleted-records'?: string;
    [key: string]: string | undefined;
}
/**
 * Iceberg snapshot.
 */
export interface IcebergSnapshot {
    snapshot_id: number;
    parent_snapshot_id?: number;
    sequence_number: number;
    timestamp_ms: number;
    manifest_list: string;
    summary: SnapshotSummary;
    schema_id?: number;
}
/**
 * Data file entry in a manifest.
 */
export interface DataFile {
    content: 0 | 1 | 2;
    file_path: string;
    file_format: 'PARQUET' | 'ORC' | 'AVRO';
    partition: Record<string, unknown>;
    record_count: number;
    file_size_in_bytes: number;
    column_sizes?: Record<number, number>;
    value_counts?: Record<number, number>;
    null_value_counts?: Record<number, number>;
    nan_value_counts?: Record<number, number>;
    lower_bounds?: Record<number, Uint8Array>;
    upper_bounds?: Record<number, Uint8Array>;
    sort_order_id?: number;
}
/**
 * Manifest file entry.
 */
export interface ManifestEntry {
    status: 0 | 1 | 2;
    snapshot_id: number;
    sequence_number?: number;
    data_file: DataFile;
}
/**
 * Manifest file metadata.
 */
export interface ManifestFile {
    manifest_path: string;
    manifest_length: number;
    partition_spec_id: number;
    content: 0 | 1;
    sequence_number: number;
    min_sequence_number: number;
    added_snapshot_id: number;
    added_data_files_count: number;
    existing_data_files_count: number;
    deleted_data_files_count: number;
    added_rows_count: number;
    existing_rows_count: number;
    deleted_rows_count: number;
    partitions?: Array<{
        contains_null: boolean;
        contains_nan?: boolean;
        lower_bound?: Uint8Array;
        upper_bound?: Uint8Array;
    }>;
}
/**
 * Sort field specification.
 */
export interface SortField {
    transform: PartitionTransform;
    source_id: number;
    direction: 'asc' | 'desc';
    null_order: 'nulls-first' | 'nulls-last';
}
/**
 * Sort order specification.
 */
export interface SortOrder {
    order_id: number;
    fields: SortField[];
}
/**
 * Iceberg table metadata (v2 format).
 */
export interface TableMetadataV2 {
    format_version: 2;
    table_uuid: string;
    location: string;
    last_sequence_number: number;
    last_updated_ms: number;
    last_column_id: number;
    current_schema_id: number;
    schemas: IcebergSchema[];
    default_spec_id: number;
    partition_specs: PartitionSpec[];
    last_partition_id: number;
    default_sort_order_id: number;
    sort_orders: SortOrder[];
    properties?: Record<string, string>;
    current_snapshot_id?: number;
    snapshots?: IcebergSnapshot[];
    snapshot_log?: Array<{
        snapshot_id: number;
        timestamp_ms: number;
    }>;
    metadata_log?: Array<{
        metadata_file: string;
        timestamp_ms: number;
    }>;
    refs?: Record<string, {
        snapshot_id: number;
        type: 'tag' | 'branch';
        max_ref_age_ms?: number;
        max_snapshot_age_ms?: number;
        min_snapshots_to_keep?: number;
    }>;
}
/**
 * Alias for current table metadata version.
 */
export type TableMetadata = TableMetadataV2;
/**
 * Table identifier in a catalog.
 */
export interface TableIdentifier {
    namespace: string[];
    name: string;
}
/**
 * Table update operation.
 */
export type TableUpdate = {
    action: 'add-schema';
    schema: IcebergSchema;
} | {
    action: 'set-current-schema';
    schema_id: number;
} | {
    action: 'add-partition-spec';
    spec: PartitionSpec;
} | {
    action: 'set-default-spec';
    spec_id: number;
} | {
    action: 'add-sort-order';
    sort_order: SortOrder;
} | {
    action: 'set-default-sort-order';
    sort_order_id: number;
} | {
    action: 'add-snapshot';
    snapshot: IcebergSnapshot;
} | {
    action: 'set-snapshot-ref';
    ref_name: string;
    type: 'branch' | 'tag';
    snapshot_id: number;
} | {
    action: 'remove-snapshots';
    snapshot_ids: number[];
} | {
    action: 'set-properties';
    updates: Record<string, string>;
} | {
    action: 'remove-properties';
    removals: string[];
} | {
    action: 'set-location';
    location: string;
};
/**
 * Requirements for committing table updates.
 */
export type TableRequirement = {
    type: 'assert-create';
} | {
    type: 'assert-table-uuid';
    uuid: string;
} | {
    type: 'assert-ref-snapshot-id';
    ref: string;
    snapshot_id: number | null;
} | {
    type: 'assert-last-assigned-field-id';
    last_assigned_field_id: number;
} | {
    type: 'assert-current-schema-id';
    current_schema_id: number;
} | {
    type: 'assert-last-assigned-partition-id';
    last_assigned_partition_id: number;
} | {
    type: 'assert-default-spec-id';
    default_spec_id: number;
} | {
    type: 'assert-default-sort-order-id';
    default_sort_order_id: number;
};
//# sourceMappingURL=types.d.ts.map