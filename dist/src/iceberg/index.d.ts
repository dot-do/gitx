/**
 * @fileoverview Iceberg Subpath Barrel
 *
 * Targeted exports for Iceberg v2 metadata generation: table metadata,
 * manifests, and the flush handler bridge.
 *
 * This module integrates with @dotdo/iceberg for comprehensive Iceberg support
 * while maintaining backward compatibility with the local GitX Iceberg API.
 *
 * @module iceberg
 *
 * @example
 * ```typescript
 * // Legacy API (backward compatible)
 * import { createTableMetadata, createManifest } from 'gitx.do/iceberg'
 *
 * // Advanced API (full @dotdo/iceberg)
 * import {
 *   ManifestGenerator,
 *   TableMetadataBuilder,
 *   SnapshotManager,
 * } from 'gitx.do/iceberg'
 * ```
 */
export { createTableMetadata, addSnapshot, serializeMetadata, GIT_OBJECTS_ICEBERG_SCHEMA, type IcebergField, type IcebergSchema, type IcebergPartitionSpec, type IcebergSortOrder, type IcebergSnapshot, type LegacySnapshotLogEntry as SnapshotLogEntry, type IcebergTableMetadata, type CreateTableMetadataOptions, type AddSnapshotOptions, } from './adapter';
export { createManifestEntry, createManifest, serializeManifest, createManifestList, serializeManifestList, FIELD_ID_MAP, type ColumnStat, type DataFileInput, type LegacyIcebergDataFile as IcebergDataFile, type ManifestEntry, type Manifest, type ManifestListEntry, type ManifestList, type CreateManifestOptions, type CreateManifestListOptions, } from './adapter';
export { createIcebergFlushHandler, } from './flush-handler';
export { ManifestGenerator, ManifestListGenerator, TableMetadataBuilder, SnapshotBuilder, SnapshotManager, generateUUID, generateSnapshotId, } from './adapter';
export { toLegacySchema, fromLegacySchema, toLegacyTableMetadata, fromLegacyTableMetadata, } from './adapter';
export type { TableMetadata, Snapshot, ManifestFile, DataFile, PartitionSpec, SortOrder, } from './adapter';
export * as iceberg from '@dotdo/iceberg';
//# sourceMappingURL=index.d.ts.map