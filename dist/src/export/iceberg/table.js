/**
 * @fileoverview Iceberg Table Manager
 *
 * Provides high-level table operations for managing Iceberg tables
 * including data file management and snapshot creation.
 *
 * @module export/iceberg/table
 */
import { ParquetFieldType } from '../../tiered/parquet-writer';
import { generateSnapshotId } from '../../iceberg/adapter';
import { r2PathWithPrefix } from '../../utils/r2-path';
// ============================================================================
// Iceberg Table Manager
// ============================================================================
/**
 * Iceberg table manager for creating tables and managing snapshots.
 *
 * @description
 * Provides a high-level API for:
 * - Creating Iceberg tables from Parquet schemas
 * - Appending data files to tables
 * - Creating and managing snapshots
 * - Generating manifest files
 *
 * @example
 * ```typescript
 * const manager = new IcebergTableManager({
 *   catalog,
 *   bucket: env.ANALYTICS_BUCKET,
 * })
 *
 * // Create a table
 * await manager.createTable('gitx', 'commits', {
 *   schema: COMMITS_SCHEMA,
 * })
 *
 * // Append data files
 * const snapshot = await manager.appendFiles('gitx', 'commits', {
 *   files: [dataFile1, dataFile2],
 * })
 * ```
 */
export class IcebergTableManager {
    catalog;
    bucket;
    prefix;
    constructor(config) {
        this.catalog = config.catalog;
        this.bucket = config.bucket;
        this.prefix = config.prefix ?? '';
    }
    // ===========================================================================
    // Table Operations
    // ===========================================================================
    /**
     * Creates a new Iceberg table.
     *
     * @param namespace - Catalog namespace
     * @param table - Table name
     * @param options - Table creation options
     */
    async createTable(namespace, table, options) {
        const location = this.tableLocation(namespace, table);
        const icebergSchema = this.parquetToIcebergSchema(options.schema);
        const tableConfig = {
            schemas: [icebergSchema],
            partition_specs: options.partitionSpec
                ? [options.partitionSpec]
                : [{ spec_id: 0, fields: [] }],
            sort_orders: options.sortOrder
                ? [options.sortOrder]
                : [{ order_id: 0, fields: [] }],
        };
        if (options.properties) {
            tableConfig.properties = options.properties;
        }
        return this.catalog.registerTable(namespace, table, location, tableConfig);
    }
    /**
     * Gets table metadata.
     */
    async getMetadata(namespace, table) {
        return this.catalog.getTable(namespace, table);
    }
    /**
     * Appends data files to a table, creating a new snapshot.
     *
     * @param namespace - Catalog namespace
     * @param table - Table name
     * @param options - Append options with data files
     * @returns The new snapshot
     */
    async appendFiles(namespace, table, options) {
        const metadata = await this.catalog.getTable(namespace, table);
        // Generate new snapshot ID using collision-resistant algorithm
        const snapshotId = generateSnapshotId();
        const sequenceNumber = metadata.last_sequence_number + 1;
        // Calculate summary statistics
        const addedRecords = options.files.reduce((sum, f) => sum + f.record_count, 0);
        const addedSize = options.files.reduce((sum, f) => sum + f.file_size_in_bytes, 0);
        // Write manifest file
        const manifestPath = await this.writeManifest(namespace, table, snapshotId, options.files);
        // Write manifest list
        const manifestListPath = await this.writeManifestList(namespace, table, snapshotId, [manifestPath], options.files);
        // Create snapshot
        const snapshot = {
            snapshot_id: snapshotId,
            sequence_number: sequenceNumber,
            timestamp_ms: Date.now(),
            manifest_list: manifestListPath,
            summary: {
                operation: options.operation ?? 'append',
                'added-data-files': String(options.files.length),
                'added-records': String(addedRecords),
                'added-files-size': String(addedSize),
            },
            schema_id: metadata.current_schema_id,
        };
        if (metadata.current_snapshot_id !== undefined) {
            snapshot.parent_snapshot_id = metadata.current_snapshot_id;
        }
        // Update table with new snapshot
        await this.catalog.updateTable(namespace, table, [
            { action: 'add-snapshot', snapshot },
            { action: 'set-snapshot-ref', ref_name: 'main', type: 'branch', snapshot_id: snapshotId },
        ]);
        return snapshot;
    }
    // ===========================================================================
    // Schema Conversion
    // ===========================================================================
    /**
     * Converts a Parquet schema to Iceberg schema.
     */
    parquetToIcebergSchema(parquetSchema) {
        return {
            type: 'struct',
            schema_id: 0,
            fields: parquetSchema.fields.map((field, index) => {
                const icebergField = {
                    id: index + 1,
                    name: field.name,
                    required: field.required,
                    type: this.parquetToIcebergType(field.type),
                };
                if (field.metadata?.['description']) {
                    icebergField.doc = field.metadata['description'];
                }
                return icebergField;
            }),
        };
    }
    /**
     * Converts a Parquet field type to Iceberg type.
     */
    parquetToIcebergType(parquetType) {
        switch (parquetType) {
            case ParquetFieldType.STRING:
                return 'string';
            case ParquetFieldType.INT32:
                return 'int';
            case ParquetFieldType.INT64:
                return 'long';
            case ParquetFieldType.BOOLEAN:
                return 'boolean';
            case ParquetFieldType.FLOAT:
                return 'float';
            case ParquetFieldType.DOUBLE:
                return 'double';
            case ParquetFieldType.BINARY:
                return 'binary';
            case ParquetFieldType.TIMESTAMP_MILLIS:
            case ParquetFieldType.TIMESTAMP_MICROS:
                return 'timestamptz';
            default:
                return 'string';
        }
    }
    // ===========================================================================
    // Manifest Operations
    // ===========================================================================
    /**
     * Writes a manifest file for data files.
     *
     * @returns Path to the manifest file
     */
    async writeManifest(namespace, table, snapshotId, files) {
        const manifestPath = `${this.tableLocation(namespace, table)}/metadata/snap-${snapshotId}-manifest.avro`;
        const manifestContent = {
            format_version: 2,
            entries: files.map(file => ({
                status: 1, // added
                snapshot_id: snapshotId,
                data_file: file,
            })),
        };
        await this.bucket.put(this.r2Path(manifestPath), JSON.stringify(manifestContent, null, 2), { httpMetadata: { contentType: 'application/json' } });
        return manifestPath;
    }
    /**
     * Writes a manifest list file.
     *
     * @returns Path to the manifest list file
     */
    async writeManifestList(namespace, table, snapshotId, manifestPaths, files) {
        const manifestListPath = `${this.tableLocation(namespace, table)}/metadata/snap-${snapshotId}.avro`;
        // For simplicity, we write manifest list as JSON
        // In production, this should be Avro format
        const manifestListContent = {
            format_version: 2,
            manifests: manifestPaths.map(path => ({
                manifest_path: path,
                manifest_length: 0, // Would be actual size
                partition_spec_id: 0,
                content: 0, // data
                sequence_number: 1,
                min_sequence_number: 1,
                added_snapshot_id: snapshotId,
                added_data_files_count: files.length,
                existing_data_files_count: 0,
                deleted_data_files_count: 0,
                added_rows_count: files.reduce((sum, f) => sum + f.record_count, 0),
                existing_rows_count: 0,
                deleted_rows_count: 0,
            })),
        };
        await this.bucket.put(this.r2Path(manifestListPath), JSON.stringify(manifestListContent, null, 2), { httpMetadata: { contentType: 'application/json' } });
        return manifestListPath;
    }
    // ===========================================================================
    // Path Helpers
    // ===========================================================================
    tableLocation(namespace, table) {
        const base = this.prefix ? `r2://bucket/${this.prefix}` : 'r2://bucket';
        return `${base}/${namespace}/${table}`;
    }
    r2Path(location) {
        return r2PathWithPrefix(location, this.prefix || undefined);
    }
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Creates a DataFile entry for a Parquet file.
 *
 * @param path - Path to the Parquet file in R2
 * @param recordCount - Number of records in the file
 * @param fileSize - Size of the file in bytes
 * @param partition - Partition values (empty for unpartitioned)
 */
export function createDataFile(path, recordCount, fileSize, partition = {}) {
    return {
        content: 0, // data
        file_path: path,
        file_format: 'PARQUET',
        partition,
        record_count: recordCount,
        file_size_in_bytes: fileSize,
    };
}
//# sourceMappingURL=table.js.map