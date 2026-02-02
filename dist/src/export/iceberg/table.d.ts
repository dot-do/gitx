/**
 * @fileoverview Iceberg Table Manager
 *
 * Provides high-level table operations for managing Iceberg tables
 * including data file management and snapshot creation.
 *
 * @module export/iceberg/table
 */
import type { TableMetadata, IcebergSnapshot, DataFile, PartitionSpec, SortOrder } from './types';
import type { R2DataCatalog } from './catalog';
import { ParquetSchema } from '../../tiered/parquet-writer';
/**
 * Table manager configuration.
 */
export interface TableManagerConfig {
    /** R2 Data Catalog instance */
    catalog: R2DataCatalog;
    /** R2 bucket for data storage */
    bucket: R2Bucket;
    /** Base path prefix */
    prefix?: string;
}
/**
 * Options for creating a new table.
 */
export interface CreateTableOptions {
    /** Parquet schema to convert to Iceberg */
    schema: ParquetSchema;
    /** Partition specification */
    partitionSpec?: PartitionSpec;
    /** Sort order */
    sortOrder?: SortOrder;
    /** Table properties */
    properties?: Record<string, string>;
}
/**
 * Options for appending files to a table.
 */
export interface AppendFilesOptions {
    /** Data files to append */
    files: DataFile[];
    /** Snapshot summary operation */
    operation?: 'append' | 'overwrite';
}
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
export declare class IcebergTableManager {
    private catalog;
    private bucket;
    private prefix;
    constructor(config: TableManagerConfig);
    /**
     * Creates a new Iceberg table.
     *
     * @param namespace - Catalog namespace
     * @param table - Table name
     * @param options - Table creation options
     */
    createTable(namespace: string, table: string, options: CreateTableOptions): Promise<TableMetadata>;
    /**
     * Gets table metadata.
     */
    getMetadata(namespace: string, table: string): Promise<TableMetadata>;
    /**
     * Appends data files to a table, creating a new snapshot.
     *
     * @param namespace - Catalog namespace
     * @param table - Table name
     * @param options - Append options with data files
     * @returns The new snapshot
     */
    appendFiles(namespace: string, table: string, options: AppendFilesOptions): Promise<IcebergSnapshot>;
    /**
     * Converts a Parquet schema to Iceberg schema.
     */
    private parquetToIcebergSchema;
    /**
     * Converts a Parquet field type to Iceberg type.
     */
    private parquetToIcebergType;
    /**
     * Writes a manifest file for data files.
     *
     * @returns Path to the manifest file
     */
    private writeManifest;
    /**
     * Writes a manifest list file.
     *
     * @returns Path to the manifest list file
     */
    private writeManifestList;
    private tableLocation;
    private r2Path;
}
/**
 * Creates a DataFile entry for a Parquet file.
 *
 * @param path - Path to the Parquet file in R2
 * @param recordCount - Number of records in the file
 * @param fileSize - Size of the file in bytes
 * @param partition - Partition values (empty for unpartitioned)
 */
export declare function createDataFile(path: string, recordCount: number, fileSize: number, partition?: Record<string, unknown>): DataFile;
//# sourceMappingURL=table.d.ts.map