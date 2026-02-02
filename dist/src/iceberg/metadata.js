/**
 * @fileoverview Iceberg v2 Table Metadata Generation
 *
 * Generates Iceberg v2 metadata JSON pointing to existing Parquet data files
 * on R2. Follows the UniForm pattern: same Parquet files, Iceberg metadata overlay.
 *
 * @module iceberg/metadata
 */
// ============================================================================
// Git Objects Iceberg Schema
// ============================================================================
/**
 * Iceberg schema matching the GIT_OBJECTS_SCHEMA from parquet-store.ts.
 * Each field gets a unique field-id as required by Iceberg v2.
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
/**
 * Create a new Iceberg v2 table metadata object.
 */
export function createTableMetadata(options) {
    const now = Date.now();
    const lastColumnId = GIT_OBJECTS_ICEBERG_SCHEMA.fields.reduce((max, f) => Math.max(max, f.id), 0);
    return {
        'format-version': 2,
        'table-uuid': options.tableUuid ?? crypto.randomUUID(),
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
 * Each flush of Parquet data becomes a new snapshot.
 */
export function addSnapshot(metadata, options) {
    const now = Date.now();
    const snapshotId = options.snapshotId ?? now;
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
// ============================================================================
// Serialization
// ============================================================================
/**
 * Serialize Iceberg table metadata to JSON string.
 */
export function serializeMetadata(metadata) {
    return JSON.stringify(metadata, null, 2);
}
//# sourceMappingURL=metadata.js.map