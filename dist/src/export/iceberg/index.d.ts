/**
 * @fileoverview Iceberg Module Exports
 *
 * Exports Iceberg table management utilities for GitX analytics.
 *
 * NOTE: Types are aliased to avoid conflicts with src/iceberg/index.ts
 *
 * @module export/iceberg
 */
export { R2DataCatalog, CatalogError, InvalidRefNameError, validateRefName, validateRefName as validateIcebergRefName, type R2CatalogConfig, } from './catalog';
export { IcebergTableManager, createDataFile, type TableManagerConfig, type CreateTableOptions as ExportCreateTableOptions, type AppendFilesOptions, } from './table';
export { createManifestBuilder, createSnapshot, createSnapshot as createExportSnapshot, serializeManifest, serializeManifest as serializeExportManifest, serializeManifestList, serializeManifestList as serializeExportManifestList, generateManifestName, generateManifestListName, type CreateManifestOptions as ExportCreateManifestOptions, type CreateSnapshotOptions, type ManifestBuilder, } from './manifest';
export type { IcebergSchema as ExportIcebergSchema, IcebergField as ExportIcebergField, IcebergPrimitiveType, IcebergStructType, IcebergListType, IcebergMapType, PartitionSpec as ExportPartitionSpec, PartitionField, PartitionTransform, IcebergSnapshot as ExportIcebergSnapshot, SnapshotSummary, DataFile as ExportDataFile, ManifestEntry as ExportManifestEntry, ManifestFile as ExportManifestFile, TableMetadata as ExportTableMetadata, TableMetadataV2, SortOrder as ExportSortOrder, SortField, TableIdentifier, TableUpdate, TableRequirement, } from './types';
//# sourceMappingURL=index.d.ts.map