/**
 * @fileoverview Iceberg Module Exports
 *
 * Exports Iceberg table management utilities for GitX analytics.
 *
 * @module export/iceberg
 */
export { R2DataCatalog, CatalogError, InvalidRefNameError, validateRefName, type R2CatalogConfig } from './catalog';
export { IcebergTableManager, createDataFile, type TableManagerConfig, type CreateTableOptions, type AppendFilesOptions, } from './table';
export { createManifestBuilder, createSnapshot, serializeManifest, serializeManifestList, generateManifestName, generateManifestListName, type CreateManifestOptions, type CreateSnapshotOptions, type ManifestBuilder, } from './manifest';
export type { IcebergSchema, IcebergField, IcebergPrimitiveType, IcebergStructType, IcebergListType, IcebergMapType, PartitionSpec, PartitionField, PartitionTransform, IcebergSnapshot, SnapshotSummary, DataFile, ManifestEntry, ManifestFile, TableMetadata, TableMetadataV2, SortOrder, SortField, TableIdentifier, TableUpdate, TableRequirement, } from './types';
//# sourceMappingURL=index.d.ts.map