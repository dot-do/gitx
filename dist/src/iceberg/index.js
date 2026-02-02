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
// ============================================================================
// Legacy API (Backward Compatible)
// ============================================================================
// Table Metadata (legacy)
export { createTableMetadata, addSnapshot, serializeMetadata, GIT_OBJECTS_ICEBERG_SCHEMA, } from './adapter';
// Manifest (legacy)
export { createManifestEntry, createManifest, serializeManifest, createManifestList, serializeManifestList, FIELD_ID_MAP, } from './adapter';
// Flush Handler
export { createIcebergFlushHandler, } from './flush-handler';
// ============================================================================
// Advanced API (Full @dotdo/iceberg)
// ============================================================================
// Core classes from @dotdo/iceberg
export { ManifestGenerator, ManifestListGenerator, TableMetadataBuilder, SnapshotBuilder, SnapshotManager, generateUUID, generateSnapshotId, } from './adapter';
// Type conversion utilities
export { toLegacySchema, fromLegacySchema, toLegacyTableMetadata, fromLegacyTableMetadata, } from './adapter';
// ============================================================================
// Full @dotdo/iceberg Re-exports
// ============================================================================
// Re-export everything from @dotdo/iceberg for advanced users
// This allows: import { SchemaEvolutionBuilder } from 'gitx.do/iceberg'
export * as iceberg from '@dotdo/iceberg';
//# sourceMappingURL=index.js.map