/**
 * @fileoverview Export Module
 *
 * Provides git data export to Parquet/Iceberg format for analytics.
 *
 * @module export
 */

// Git to Parquet conversion
export {
  GitParquetExporter,
  StreamingExporter,
  FileStreamingExporter,
  exportCommitsToParquet,
  exportRefsToParquet,
  type GitCommitData,
  type GitRefData,
  type GitFileData,
  type GitParquetExportOptions,
  type GitParquetExportResult,
} from './git-parquet'

// Parquet schemas
export {
  COMMITS_SCHEMA,
  COMMIT_FIELDS,
  toCommitRow,
  type CommitRow,
  REFS_SCHEMA,
  REF_FIELDS,
  toRefRow,
  type RefRow,
  FILES_SCHEMA,
  FILE_FIELDS,
  toFileRow,
  FILE_CHANGE_DESCRIPTIONS,
  type FileRow,
  type FileChangeType,
  REPOSITORIES_SCHEMA,
  REPOSITORY_FIELDS,
  toRepositoryRow,
  toNamespace,
  fromNamespace,
  type RepositoryRow,
  type SyncStatus,
  type RepositorySource,
} from './schemas'

// Iceberg integration - using aliased names from ./iceberg
export {
  R2DataCatalog,
  CatalogError,
  IcebergTableManager,
  createDataFile,
  createManifestBuilder,
  createExportSnapshot as createSnapshot,
  type R2CatalogConfig,
  type TableManagerConfig,
  type ExportCreateTableOptions as CreateTableOptions,
  type AppendFilesOptions,
  type ExportTableMetadata as TableMetadata,
  type ExportIcebergSnapshot as IcebergSnapshot,
  type ExportDataFile as DataFile,
} from './iceberg'
