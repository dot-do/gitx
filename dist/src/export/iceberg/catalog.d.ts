/**
 * @fileoverview R2 Data Catalog Client
 *
 * Implements the Iceberg REST catalog protocol for R2 Data Catalog
 * integration, enabling queryable Iceberg tables via DuckDB/Spark.
 *
 * @module export/iceberg/catalog
 */
import type { TableIdentifier, TableMetadata, TableUpdate, TableRequirement } from './types';
/**
 * R2 Data Catalog configuration.
 */
export interface R2CatalogConfig {
    /** R2 bucket for storing Iceberg data */
    bucket: R2Bucket;
    /** Base path prefix within bucket */
    prefix?: string;
    /** Warehouse location URL */
    warehouseLocation: string;
    /** Maximum retry attempts for optimistic concurrency conflicts (default: 3) */
    maxRetries?: number;
}
/**
 * Catalog error.
 */
export declare class CatalogError extends Error {
    readonly code: 'NOT_FOUND' | 'ALREADY_EXISTS' | 'CONFLICT' | 'INTERNAL';
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, code: 'NOT_FOUND' | 'ALREADY_EXISTS' | 'CONFLICT' | 'INTERNAL', details?: Record<string, unknown> | undefined);
}
/**
 * Error thrown when a ref name fails validation.
 */
export declare class InvalidRefNameError extends Error {
    readonly refName: string;
    readonly reason: string;
    constructor(refName: string, reason: string);
}
/**
 * Validates a Git ref name according to Git ref naming rules.
 *
 * Valid Git ref names:
 * - Cannot be empty
 * - Cannot start with a dot or end with .lock
 * - Cannot contain ..
 * - Cannot contain control characters (ASCII < 32)
 * - Cannot contain ~ ^ : \ ? * [ or @{
 *
 * @param refName - The ref name to validate
 * @throws InvalidRefNameError if the ref name is invalid
 */
export declare function validateRefName(refName: string): void;
/**
 * R2 Data Catalog client for Iceberg table management.
 *
 * @description
 * Implements a minimal Iceberg REST catalog protocol compatible with
 * R2 Data Catalog, storing metadata in R2 alongside Parquet data files.
 *
 * @example
 * ```typescript
 * const catalog = new R2DataCatalog({
 *   bucket: env.ANALYTICS_BUCKET,
 *   warehouseLocation: 'r2://gitx-analytics',
 * })
 *
 * // Register a new table
 * await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')
 *
 * // Update table with new snapshot
 * await catalog.updateTable('gitx', 'commits', [
 *   { action: 'add-snapshot', snapshot: newSnapshot },
 *   { action: 'set-snapshot-ref', ref_name: 'main', type: 'branch', snapshot_id: newSnapshot.snapshot_id },
 * ])
 * ```
 */
export declare class R2DataCatalog {
    private bucket;
    private prefix;
    private maxRetries;
    constructor(config: R2CatalogConfig);
    /**
     * Lists all namespaces in the catalog.
     */
    listNamespaces(): Promise<string[][]>;
    /**
     * Creates a namespace.
     */
    createNamespace(namespace: string[], properties?: Record<string, string>): Promise<void>;
    /**
     * Lists tables in a namespace.
     */
    listTables(namespace: string): Promise<TableIdentifier[]>;
    /**
     * Registers a new table in the catalog.
     *
     * @param namespace - Catalog namespace
     * @param table - Table name
     * @param location - R2 location for table data
     * @param metadata - Optional initial table metadata
     */
    registerTable(namespace: string, table: string, location: string, metadata?: Partial<TableMetadata>): Promise<TableMetadata>;
    /**
     * Gets table metadata.
     */
    getTable(namespace: string, table: string): Promise<TableMetadata>;
    /**
     * Gets table metadata along with version information for optimistic concurrency control.
     * @internal
     */
    private getTableWithVersion;
    /**
     * Updates table metadata with atomic operations using optimistic concurrency control.
     *
     * This method implements the Iceberg standard pattern:
     * 1. Reads current metadata and location pointer (with ETag)
     * 2. Validates requirements against current state
     * 3. Applies updates in memory
     * 4. Writes new versioned metadata file (v1.metadata.json, v2.metadata.json, etc.)
     * 5. Atomically updates location pointer using conditional put (ETag check)
     *
     * If a concurrent update occurs, the conditional put fails and the operation is retried.
     *
     * @param namespace - Catalog namespace
     * @param table - Table name
     * @param updates - List of update operations
     * @param requirements - Optional requirements for optimistic locking
     * @throws CatalogError with code 'CONFLICT' if max retries exceeded due to concurrent updates
     */
    updateTable(namespace: string, table: string, updates: TableUpdate[], requirements?: TableRequirement[]): Promise<TableMetadata>;
    /**
     * Attempts a single table update with optimistic concurrency control.
     * @internal
     */
    private tryUpdateTable;
    /**
     * Extracts version number from metadata path (e.g., "v2.metadata.json" -> 2).
     * @internal
     */
    private extractVersionFromPath;
    /**
     * Checks if an error is a precondition failed error (412).
     * @internal
     */
    private isPreconditionFailed;
    /**
     * Drops a table from the catalog.
     *
     * @param namespace - Catalog namespace
     * @param table - Table name
     * @param purge - If true, delete all data files under the table location
     */
    dropTable(namespace: string, table: string, purge?: boolean): Promise<void>;
    private catalogPath;
    private r2Path;
    private getMetadataVersion;
    private validateRequirement;
    /**
     * Validates a TableUpdate object has the required structure for its action type.
     * Throws CatalogError if validation fails.
     * @internal
     */
    private validateUpdate;
    /**
     * Validates that a value is a valid IcebergSchema.
     * @internal
     */
    private isValidSchema;
    /**
     * Validates that a value is a valid IcebergField.
     * @internal
     */
    private isValidField;
    /**
     * Validates that a value is a valid PartitionSpec.
     * @internal
     */
    private isValidPartitionSpec;
    /**
     * Validates that a value is a valid SortOrder.
     * @internal
     */
    private isValidSortOrder;
    /**
     * Validates that a value is a valid IcebergSnapshot.
     * @internal
     */
    private isValidSnapshot;
    private applyUpdate;
}
//# sourceMappingURL=catalog.d.ts.map