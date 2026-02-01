/**
 * @fileoverview Iceberg Subpath Barrel
 *
 * Targeted exports for Iceberg v2 metadata generation: table metadata,
 * manifests, and the flush handler bridge.
 *
 * @module iceberg
 *
 * @example
 * ```typescript
 * import { createTableMetadata, createManifest } from 'gitx.do/iceberg'
 * ```
 */

// Table Metadata
export {
  createTableMetadata,
  addSnapshot,
  serializeMetadata,
  GIT_OBJECTS_ICEBERG_SCHEMA,
  type IcebergField,
  type IcebergSchema,
  type IcebergPartitionSpec,
  type IcebergSortOrder,
  type IcebergSnapshot,
  type SnapshotLogEntry,
  type IcebergTableMetadata,
  type CreateTableMetadataOptions,
  type AddSnapshotOptions,
} from './metadata'

// Manifest
export {
  createManifestEntry,
  createManifest,
  serializeManifest,
  createManifestList,
  serializeManifestList,
  type ColumnStat,
  type DataFileInput,
  type IcebergDataFile,
  type ManifestEntry,
  type Manifest,
  type ManifestListEntry,
  type ManifestList,
  type CreateManifestOptions,
  type CreateManifestListOptions,
} from './manifest'

// Flush Handler
export {
  createIcebergFlushHandler,
} from './flush-handler'
