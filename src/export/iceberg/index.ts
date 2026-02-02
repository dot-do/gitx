/**
 * @fileoverview Iceberg Module Exports
 *
 * Exports Iceberg table management utilities for GitX analytics.
 *
 * @module export/iceberg
 */

export { R2DataCatalog, CatalogError, InvalidRefNameError, validateRefName, type R2CatalogConfig } from './catalog'

export {
  IcebergTableManager,
  createDataFile,
  type TableManagerConfig,
  type CreateTableOptions,
  type AppendFilesOptions,
} from './table'

export {
  createManifestBuilder,
  createSnapshot,
  serializeManifest,
  serializeManifestList,
  generateManifestName,
  generateManifestListName,
  type CreateManifestOptions,
  type CreateSnapshotOptions,
  type ManifestBuilder,
} from './manifest'

export type {
  // Schema types
  IcebergSchema,
  IcebergField,
  IcebergPrimitiveType,
  IcebergStructType,
  IcebergListType,
  IcebergMapType,
  // Partition types
  PartitionSpec,
  PartitionField,
  PartitionTransform,
  // Snapshot types
  IcebergSnapshot,
  SnapshotSummary,
  // Manifest types
  DataFile,
  ManifestEntry,
  ManifestFile,
  // Table metadata
  TableMetadata,
  TableMetadataV2,
  SortOrder,
  SortField,
  // Catalog types
  TableIdentifier,
  TableUpdate,
  TableRequirement,
} from './types'
