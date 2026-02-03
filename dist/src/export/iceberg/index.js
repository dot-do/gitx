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
export { R2DataCatalog, CatalogError, InvalidRefNameError, validateRefName, validateRefName as validateIcebergRefName, } from './catalog';
export { IcebergTableManager, createDataFile, } from './table';
// Manifest utilities - aliased to avoid conflicts with src/iceberg/index.ts
export { createManifestBuilder, createSnapshot, createSnapshot as createExportSnapshot, serializeManifest, serializeManifest as serializeExportManifest, serializeManifestList, serializeManifestList as serializeExportManifestList, generateManifestName, generateManifestListName, } from './manifest';
//# sourceMappingURL=index.js.map