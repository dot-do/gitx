/**
 * @fileoverview Export Module
 *
 * Provides git data export to Parquet/Iceberg format for analytics.
 *
 * @module export
 */
// Git to Parquet conversion
export { GitParquetExporter, StreamingExporter, FileStreamingExporter, exportCommitsToParquet, exportRefsToParquet, } from './git-parquet';
// Parquet schemas
export { COMMITS_SCHEMA, COMMIT_FIELDS, toCommitRow, REFS_SCHEMA, REF_FIELDS, toRefRow, FILES_SCHEMA, FILE_FIELDS, toFileRow, FILE_CHANGE_DESCRIPTIONS, REPOSITORIES_SCHEMA, REPOSITORY_FIELDS, toRepositoryRow, toNamespace, fromNamespace, } from './schemas';
// Iceberg integration - using aliased names from ./iceberg
export { R2DataCatalog, CatalogError, IcebergTableManager, createDataFile, createManifestBuilder, createExportSnapshot as createSnapshot, } from './iceberg';
//# sourceMappingURL=index.js.map