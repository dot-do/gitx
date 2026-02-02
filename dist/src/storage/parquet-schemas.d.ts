/**
 * @fileoverview Parquet Schema Definitions for hyparquet-writer
 *
 * Low-level Parquet schemas used by the storage layer and route handlers
 * for writing Parquet files via `parquetWriteBuffer()`. These schemas use
 * the hyparquet-writer schema format (array of column descriptors).
 *
 * Note: The higher-level schemas in `src/export/schemas/` use the tiered
 * ParquetWriter abstraction. These schemas are for direct hyparquet-writer
 * usage where we need fine-grained control (VARIANT types, raw column data).
 *
 * @module storage/parquet-schemas
 */
import type { SchemaElement } from 'hyparquet';
/**
 * Parquet schema for git object storage.
 *
 * Used by ParquetStore to write buffered objects to R2 as Parquet files.
 * Includes VARIANT-encoded data columns and shredded commit fields for
 * efficient query pushdown.
 */
export declare const GIT_OBJECTS_SCHEMA: SchemaElement[];
/**
 * Parquet schema for git commit analytics export.
 *
 * Uses VARIANT type for `parent_shas` to store semi-structured arrays
 * in a DuckDB-compatible format. This schema is used by the `/export`
 * route handler to write commit data directly via `parquetWriteBuffer()`.
 */
export declare const EXPORT_COMMITS_SCHEMA: SchemaElement[];
//# sourceMappingURL=parquet-schemas.d.ts.map