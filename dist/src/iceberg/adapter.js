/**
 * @fileoverview Adapter layer between GitX's Iceberg API and @dotdo/iceberg
 *
 * This module provides backward-compatible wrappers that bridge the local
 * GitX Iceberg implementation to the comprehensive @dotdo/iceberg library.
 * It ensures existing code continues to work while leveraging the full
 * capabilities of @dotdo/iceberg.
 *
 * @module iceberg/adapter
 */
import { generateUUID, } from '@dotdo/iceberg';
// Re-export classes for direct usage
export { ManifestGenerator, ManifestListGenerator, TableMetadataBuilder, SnapshotBuilder, SnapshotManager, generateUUID, } from '@dotdo/iceberg';
// ============================================================================
// Snapshot ID Generation
// ============================================================================
/**
 * Generates a unique snapshot ID that is collision-resistant.
 *
 * Uses a combination of:
 * - Timestamp in milliseconds
 * - Random component (4 digits of randomness = 10,000 possibilities)
 *
 * This ensures uniqueness even when multiple snapshots are created in the same millisecond.
 * The resulting ID is a positive integer that fits within JavaScript's safe integer range.
 *
 * Format: timestamp_ms * 10_000 + random(0-9999)
 * Max value: ~1.7e17 at year 2100, but currently ~1.7e16 (safe integer limit is 9e15)
 *
 * To stay within safe integer range, we use a smaller multiplier.
 * Current timestamp (~1.7e12) * 1000 + random(0-999) = ~1.7e15 (well within 9e15)
 *
 * @returns A unique snapshot ID as a positive integer
 *
 * @example
 * ```typescript
 * const id1 = generateSnapshotId() // e.g., 1706889600000123
 * const id2 = generateSnapshotId() // e.g., 1706889600000789
 * ```
 */
export function generateSnapshotId() {
    const timestamp = Date.now();
    // Use 3 digits of randomness (0-999) for collision resistance
    // This gives 1000 possible values per millisecond
    const random = Math.floor(Math.random() * 1000);
    // Combine: timestamp * 1000 + random gives unique IDs even in same millisecond
    // Max value: ~1.7e15 (well within Number.MAX_SAFE_INTEGER = 9e15)
    return timestamp * 1000 + random;
}
// ============================================================================
// Schema Constants
// ============================================================================
/**
 * Field ID mapping for Git objects schema
 */
export const FIELD_ID_MAP = {
    sha: 1,
    type: 2,
    size: 3,
    storage: 4,
    data: 5,
    path: 6,
    variant_metadata: 7,
    variant_value: 8,
    raw_data: 9,
    author_name: 10,
    author_date: 11,
    message: 12,
};
/**
 * Git Objects Iceberg Schema (legacy format compatible with existing GitX code)
 */
export const GIT_OBJECTS_ICEBERG_SCHEMA = {
    'schema-id': 0,
    type: 'struct',
    fields: [
        { id: 1, name: 'sha', required: true, type: 'string' },
        { id: 2, name: 'type', required: true, type: 'string' },
        { id: 3, name: 'size', required: true, type: 'long' },
        { id: 4, name: 'storage', required: true, type: 'string' },
        { id: 5, name: 'data', required: false, type: 'binary' },
        { id: 6, name: 'path', required: false, type: 'string' },
        { id: 7, name: 'variant_metadata', required: false, type: 'binary' },
        { id: 8, name: 'variant_value', required: false, type: 'binary' },
        { id: 9, name: 'raw_data', required: false, type: 'binary' },
        { id: 10, name: 'author_name', required: false, type: 'string' },
        { id: 11, name: 'author_date', required: false, type: 'long' },
        { id: 12, name: 'message', required: false, type: 'string' },
    ],
};
// ============================================================================
// Conversion Functions
// ============================================================================
/**
 * Convert legacy IcebergSchema to @dotdo/iceberg IcebergSchema
 */
export function toLegacySchema(schema) {
    return {
        'schema-id': schema['schema-id'],
        type: 'struct',
        fields: schema.fields.map(f => ({
            id: f.id,
            name: f.name,
            required: f.required,
            type: typeof f.type === 'string' ? f.type : 'binary',
        })),
    };
}
/**
 * Convert legacy IcebergSchema to @dotdo/iceberg IcebergSchema
 */
export function fromLegacySchema(schema) {
    return {
        'schema-id': schema['schema-id'],
        type: 'struct',
        fields: schema.fields.map(f => ({
            id: f.id,
            name: f.name,
            required: f.required,
            type: f.type,
        })),
    };
}
/**
 * Convert @dotdo/iceberg TableMetadata to legacy IcebergTableMetadata
 */
export function toLegacyTableMetadata(metadata) {
    return {
        'format-version': 2,
        'table-uuid': metadata['table-uuid'],
        location: metadata.location,
        'last-updated-ms': metadata['last-updated-ms'],
        'last-column-id': metadata['last-column-id'],
        schemas: metadata.schemas.map(toLegacySchema),
        'current-schema-id': metadata['current-schema-id'],
        'partition-specs': metadata['partition-specs'].map(ps => ({
            'spec-id': ps['spec-id'],
            fields: ps.fields,
        })),
        'default-spec-id': metadata['default-spec-id'],
        'sort-orders': metadata['sort-orders'].map(so => ({
            'order-id': so['order-id'],
            fields: so.fields,
        })),
        'default-sort-order-id': metadata['default-sort-order-id'],
        properties: { ...metadata.properties },
        snapshots: metadata.snapshots.map(s => ({
            'snapshot-id': s['snapshot-id'],
            ...(s['parent-snapshot-id'] !== undefined ? { 'parent-snapshot-id': s['parent-snapshot-id'] } : {}),
            'timestamp-ms': s['timestamp-ms'],
            summary: { ...s.summary },
            'manifest-list': s['manifest-list'],
            'schema-id': s['schema-id'],
        })),
        'current-snapshot-id': metadata['current-snapshot-id'] ?? -1,
        'snapshot-log': metadata['snapshot-log'].map(e => ({
            'timestamp-ms': e['timestamp-ms'],
            'snapshot-id': e['snapshot-id'],
        })),
    };
}
/**
 * Convert legacy IcebergTableMetadata to @dotdo/iceberg TableMetadata
 */
export function fromLegacyTableMetadata(legacy) {
    return {
        'format-version': 2,
        'table-uuid': legacy['table-uuid'],
        location: legacy.location,
        'last-sequence-number': legacy.snapshots.length,
        'last-updated-ms': legacy['last-updated-ms'],
        'last-column-id': legacy['last-column-id'],
        'current-schema-id': legacy['current-schema-id'],
        schemas: legacy.schemas.map(fromLegacySchema),
        'default-spec-id': legacy['default-spec-id'],
        'partition-specs': legacy['partition-specs'].map(ps => ({
            'spec-id': ps['spec-id'],
            fields: (ps.fields || []),
        })),
        'last-partition-id': 999,
        'default-sort-order-id': legacy['default-sort-order-id'],
        'sort-orders': legacy['sort-orders'].map(so => ({
            'order-id': so['order-id'],
            fields: (so.fields || []),
        })),
        properties: { ...legacy.properties },
        'current-snapshot-id': legacy['current-snapshot-id'] === -1 ? null : legacy['current-snapshot-id'],
        snapshots: legacy.snapshots.map(s => ({
            'snapshot-id': s['snapshot-id'],
            ...(s['parent-snapshot-id'] !== undefined ? { 'parent-snapshot-id': s['parent-snapshot-id'] } : {}),
            'sequence-number': legacy['snapshot-log'].findIndex(e => e['snapshot-id'] === s['snapshot-id']) + 1,
            'timestamp-ms': s['timestamp-ms'],
            'manifest-list': s['manifest-list'],
            summary: s.summary,
            'schema-id': s['schema-id'],
        })),
        'snapshot-log': legacy['snapshot-log'],
        'metadata-log': [],
        refs: {},
    };
}
/**
 * Create a new Iceberg v2 table metadata object (legacy API).
 * This wraps @dotdo/iceberg's TableMetadataBuilder.
 */
export function createTableMetadata(options) {
    const now = Date.now();
    const lastColumnId = GIT_OBJECTS_ICEBERG_SCHEMA.fields.reduce((max, f) => Math.max(max, f.id), 0);
    return {
        'format-version': 2,
        'table-uuid': options.tableUuid ?? generateUUID(),
        location: options.location,
        'last-updated-ms': now,
        'last-column-id': lastColumnId,
        schemas: [GIT_OBJECTS_ICEBERG_SCHEMA],
        'current-schema-id': 0,
        'partition-specs': [{ 'spec-id': 0, fields: [] }],
        'default-spec-id': 0,
        'sort-orders': [{ 'order-id': 0, fields: [] }],
        'default-sort-order-id': 0,
        properties: {},
        snapshots: [],
        'current-snapshot-id': -1,
        'snapshot-log': [],
    };
}
/**
 * Add a new snapshot to the table metadata (immutable - returns new metadata).
 * Legacy API wrapping @dotdo/iceberg functionality.
 */
export function addSnapshot(metadata, options) {
    const now = Date.now();
    const snapshotId = options.snapshotId ?? generateSnapshotId();
    if (metadata.snapshots.some(s => s['snapshot-id'] === snapshotId)) {
        throw new Error(`Duplicate snapshot ID: ${snapshotId}`);
    }
    const parentSnapshotId = metadata['current-snapshot-id'] !== -1 ? metadata['current-snapshot-id'] : undefined;
    const snapshot = {
        'snapshot-id': snapshotId,
        ...(parentSnapshotId !== undefined ? { 'parent-snapshot-id': parentSnapshotId } : {}),
        'timestamp-ms': now,
        summary: options.summary ?? { operation: 'append' },
        'manifest-list': options.manifestListPath,
        'schema-id': metadata['current-schema-id'],
    };
    const logEntry = {
        'timestamp-ms': now,
        'snapshot-id': snapshotId,
    };
    return {
        ...metadata,
        'last-updated-ms': now,
        snapshots: [...metadata.snapshots, snapshot],
        'current-snapshot-id': snapshotId,
        'snapshot-log': [...metadata['snapshot-log'], logEntry],
    };
}
/**
 * Serialize Iceberg table metadata to JSON string.
 */
export function serializeMetadata(metadata) {
    return JSON.stringify(metadata, null, 2);
}
// ============================================================================
// Manifest Functions (Legacy API)
// ============================================================================
/**
 * Create a manifest entry for a Parquet data file (legacy API).
 */
export function createManifestEntry(dataFile, options) {
    const lowerBounds = {};
    const upperBounds = {};
    const nullValueCounts = {};
    if (dataFile.columnStats) {
        for (const [colName, stat] of Object.entries(dataFile.columnStats)) {
            const fieldId = FIELD_ID_MAP[colName];
            if (fieldId !== undefined) {
                lowerBounds[fieldId] = stat.minValue;
                upperBounds[fieldId] = stat.maxValue;
                nullValueCounts[fieldId] = stat.nullCount;
            }
        }
    }
    const icebergDataFile = {
        content: 0,
        'file-path': dataFile.filePath,
        'file-format': 'PARQUET',
        partition: {},
        'record-count': dataFile.recordCount,
        'file-size-in-bytes': dataFile.fileSizeBytes,
        ...(Object.keys(lowerBounds).length > 0
            ? {
                'lower-bounds': lowerBounds,
                'upper-bounds': upperBounds,
                'null-value-counts': nullValueCounts,
            }
            : {}),
    };
    return {
        status: options?.status ?? 1, // ADDED
        content: 0, // DATA
        'data-file': icebergDataFile,
    };
}
/**
 * Create a manifest containing references to data files (legacy API).
 */
export function createManifest(options) {
    const added = options.entries.filter(e => e.status === 1);
    const deleted = options.entries.filter(e => e.status === 2);
    const existing = options.entries.filter(e => e.status === 0);
    const addedRows = added.reduce((sum, e) => sum + e['data-file']['record-count'], 0);
    return {
        'manifest-path': options.manifestPath,
        'schema-id': options.schemaId,
        'partition-spec-id': options.partitionSpecId ?? 0,
        content: 0, // DATA
        'added-files-count': added.length,
        'added-rows-count': addedRows,
        'existing-files-count': existing.length,
        'deleted-files-count': deleted.length,
        entries: options.entries,
    };
}
/**
 * Create a manifest list referencing one or more manifests (legacy API).
 */
export function createManifestList(options) {
    const entries = options.manifests.map(m => ({
        'manifest-path': m['manifest-path'],
        'manifest-length': JSON.stringify(m).length,
        'partition-spec-id': m['partition-spec-id'],
        content: m.content,
        'added-data-files-count': m['added-files-count'],
        'added-rows-count': m['added-rows-count'],
        'existing-data-files-count': m['existing-files-count'],
        'deleted-data-files-count': m['deleted-files-count'],
        'snapshot-id': options.snapshotId,
    }));
    return { entries };
}
/**
 * Serialize a manifest to JSON.
 */
export function serializeManifest(manifest) {
    return JSON.stringify(manifest, null, 2);
}
/**
 * Serialize a manifest list to JSON.
 */
export function serializeManifestList(manifestList) {
    return JSON.stringify(manifestList, null, 2);
}
//# sourceMappingURL=adapter.js.map