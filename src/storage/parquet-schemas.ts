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

import type { SchemaElement } from 'hyparquet'

// ============================================================================
// Git Objects Schema (used by ParquetStore for object storage)
// ============================================================================

/**
 * Parquet schema for git object storage.
 *
 * Used by ParquetStore to write buffered objects to R2 as Parquet files.
 * Includes VARIANT-encoded data columns and shredded commit fields for
 * efficient query pushdown.
 */
export const GIT_OBJECTS_SCHEMA: SchemaElement[] = [
  { name: 'root', num_children: 11 },
  { name: 'sha', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  { name: 'type', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  { name: 'size', type: 'INT64' as const, repetition_type: 'REQUIRED' as const },
  { name: 'storage', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  // VARIANT-encoded data stored as flat BYTE_ARRAY columns
  { name: 'variant_metadata', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const },
  { name: 'variant_value', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const },
  // Raw object data for inline storage (enables fast reads without VARIANT decoding)
  { name: 'raw_data', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const },
  { name: 'path', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const, converted_type: 'UTF8' as const },
  // Shredded commit fields (null for non-commit objects)
  { name: 'author_name', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const, converted_type: 'UTF8' as const },
  { name: 'author_date', type: 'INT64' as const, repetition_type: 'OPTIONAL' as const },
  { name: 'message', type: 'BYTE_ARRAY' as const, repetition_type: 'OPTIONAL' as const, converted_type: 'UTF8' as const },
]

// ============================================================================
// Export Commits Schema (used by route handler for analytics export)
// ============================================================================

/**
 * Parquet schema for git commit analytics export.
 *
 * Uses VARIANT type for `parent_shas` to store semi-structured arrays
 * in a DuckDB-compatible format. This schema is used by the `/export`
 * route handler to write commit data directly via `parquetWriteBuffer()`.
 */
export const EXPORT_COMMITS_SCHEMA: SchemaElement[] = [
  { name: 'root', num_children: 11 },
  { name: 'sha', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
  { name: 'tree_sha', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
  // VARIANT group for parent_shas (semi-structured array)
  { name: 'parent_shas', repetition_type: 'OPTIONAL', num_children: 2, logical_type: { type: 'VARIANT' } },
  { name: 'metadata', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED' },
  { name: 'value', type: 'BYTE_ARRAY', repetition_type: 'OPTIONAL' },
  { name: 'author_name', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
  { name: 'author_email', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
  { name: 'author_date', type: 'INT64', repetition_type: 'REQUIRED', logical_type: { type: 'TIMESTAMP', isAdjustedToUTC: true, unit: 'MILLIS' } },
  { name: 'committer_name', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
  { name: 'committer_email', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
  { name: 'committer_date', type: 'INT64', repetition_type: 'REQUIRED', logical_type: { type: 'TIMESTAMP', isAdjustedToUTC: true, unit: 'MILLIS' } },
  { name: 'message', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
  { name: 'repository', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
]
