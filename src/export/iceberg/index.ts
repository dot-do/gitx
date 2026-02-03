/**
 * @fileoverview Iceberg Module Exports
 *
 * Exports Iceberg table management utilities for GitX analytics.
 *
 * NOTE: Types are aliased to avoid conflicts with src/iceberg/index.ts
 *
 * @module export/iceberg
 */

// R2 Data Catalog
export {
  R2DataCatalog,
  CatalogError,
  InvalidRefNameError,
  validateRefName,
  validateRefName as validateIcebergRefName,
  type R2CatalogConfig,
} from './catalog'

export {
  IcebergTableManager,
  createDataFile,
  type TableManagerConfig,
  type CreateTableOptions as ExportCreateTableOptions,
  type AppendFilesOptions,
} from './table'

// Manifest utilities - aliased to avoid conflicts with src/iceberg/index.ts
export {
  createManifestBuilder,
  createSnapshot,
  createSnapshot as createExportSnapshot,
  serializeManifest,
  serializeManifest as serializeExportManifest,
  serializeManifestList,
  serializeManifestList as serializeExportManifestList,
  generateManifestName,
  generateManifestListName,
  type CreateManifestOptions as ExportCreateManifestOptions,
  type CreateSnapshotOptions,
  type ManifestBuilder,
} from './manifest'

// Types - aliased to avoid conflicts with src/iceberg/index.ts
export type {
  // Schema types
  IcebergSchema as ExportIcebergSchema,
  IcebergField as ExportIcebergField,
  IcebergPrimitiveType,
  IcebergStructType,
  IcebergListType,
  IcebergMapType,
  // Partition types
  PartitionSpec as ExportPartitionSpec,
  PartitionField,
  PartitionTransform,
  // Snapshot types
  IcebergSnapshot as ExportIcebergSnapshot,
  SnapshotSummary,
  // Manifest types
  DataFile as ExportDataFile,
  ManifestEntry as ExportManifestEntry,
  ManifestFile as ExportManifestFile,
  // Table metadata
  TableMetadata as ExportTableMetadata,
  TableMetadataV2,
  SortOrder as ExportSortOrder,
  SortField,
  // Catalog types
  TableIdentifier,
  TableUpdate,
  TableRequirement,
} from './types'
