/**
 * @fileoverview Iceberg Manifest Management
 *
 * Utilities for creating and managing Iceberg manifest files
 * and snapshot metadata.
 *
 * @module export/iceberg/manifest
 */
// ============================================================================
// Manifest Builder
// ============================================================================
/**
 * Creates a new manifest builder.
 *
 * @param options - Manifest creation options
 * @returns ManifestBuilder instance
 *
 * @example
 * ```typescript
 * const builder = createManifestBuilder({
 *   snapshotId: 1234567890,
 *   sequenceNumber: 1,
 * })
 *
 * builder.addFile(dataFile1)
 * builder.addFile(dataFile2)
 *
 * const entries = builder.getEntries()
 * const manifest = builder.build()
 * ```
 */
export function createManifestBuilder(options) {
    const entries = [];
    let addedRowCount = 0;
    let addedFileCount = 0;
    return {
        addFile(file) {
            entries.push({
                status: 1, // added
                snapshot_id: options.snapshotId,
                sequence_number: options.sequenceNumber,
                data_file: file,
            });
            addedRowCount += file.record_count;
            addedFileCount++;
        },
        getEntries() {
            return [...entries];
        },
        build() {
            return {
                manifest_path: '', // To be set when writing
                manifest_length: 0, // To be set after serialization
                partition_spec_id: options.partitionSpecId ?? 0,
                content: 0, // data manifest
                sequence_number: options.sequenceNumber,
                min_sequence_number: options.sequenceNumber,
                added_snapshot_id: options.snapshotId,
                added_data_files_count: addedFileCount,
                existing_data_files_count: 0,
                deleted_data_files_count: 0,
                added_rows_count: addedRowCount,
                existing_rows_count: 0,
                deleted_rows_count: 0,
            };
        },
    };
}
/**
 * Creates a new snapshot from manifest files.
 *
 * @param manifestList - Path to the manifest list
 * @param manifests - List of manifest files included
 * @param options - Snapshot creation options
 * @returns IcebergSnapshot
 */
export function createSnapshot(manifestList, manifests, options = {}) {
    const now = Date.now();
    // Calculate summary from manifests
    const addedFiles = manifests.reduce((sum, m) => sum + m.added_data_files_count, 0);
    const addedRows = manifests.reduce((sum, m) => sum + m.added_rows_count, 0);
    const deletedFiles = manifests.reduce((sum, m) => sum + m.deleted_data_files_count, 0);
    const deletedRows = manifests.reduce((sum, m) => sum + m.deleted_rows_count, 0);
    const summary = {
        operation: options.operation ?? 'append',
    };
    if (addedFiles > 0) {
        summary['added-data-files'] = String(addedFiles);
        summary['added-records'] = String(addedRows);
    }
    if (deletedFiles > 0) {
        summary['deleted-data-files'] = String(deletedFiles);
        summary['deleted-records'] = String(deletedRows);
    }
    const snapshot = {
        snapshot_id: now,
        sequence_number: options.sequenceNumber ?? 1,
        timestamp_ms: now,
        manifest_list: manifestList,
        summary,
    };
    if (options.parentSnapshotId !== undefined) {
        snapshot.parent_snapshot_id = options.parentSnapshotId;
    }
    if (options.schemaId !== undefined) {
        snapshot.schema_id = options.schemaId;
    }
    return snapshot;
}
// ============================================================================
// Manifest Serialization
// ============================================================================
/**
 * Serializes manifest entries to JSON format.
 *
 * @description
 * Note: In production, Iceberg manifests are typically Avro format.
 * This implementation uses JSON for simplicity and compatibility
 * with R2's storage model.
 *
 * @param entries - Manifest entries to serialize
 * @returns JSON string
 */
export function serializeManifest(entries) {
    return JSON.stringify({
        format_version: 2,
        entries: entries.map(entry => ({
            status: entry.status,
            snapshot_id: entry.snapshot_id,
            sequence_number: entry.sequence_number,
            data_file: {
                content: entry.data_file.content,
                file_path: entry.data_file.file_path,
                file_format: entry.data_file.file_format,
                partition: entry.data_file.partition,
                record_count: entry.data_file.record_count,
                file_size_in_bytes: entry.data_file.file_size_in_bytes,
                column_sizes: entry.data_file.column_sizes,
                value_counts: entry.data_file.value_counts,
                null_value_counts: entry.data_file.null_value_counts,
                lower_bounds: entry.data_file.lower_bounds
                    ? encodeColumnBounds(entry.data_file.lower_bounds)
                    : undefined,
                upper_bounds: entry.data_file.upper_bounds
                    ? encodeColumnBounds(entry.data_file.upper_bounds)
                    : undefined,
            },
        })),
    }, null, 2);
}
/**
 * Serializes manifest list to JSON format.
 *
 * @param manifests - Manifest file metadata
 * @returns JSON string
 */
export function serializeManifestList(manifests) {
    return JSON.stringify({
        format_version: 2,
        manifests: manifests.map(m => ({
            manifest_path: m.manifest_path,
            manifest_length: m.manifest_length,
            partition_spec_id: m.partition_spec_id,
            content: m.content,
            sequence_number: m.sequence_number,
            min_sequence_number: m.min_sequence_number,
            added_snapshot_id: m.added_snapshot_id,
            added_data_files_count: m.added_data_files_count,
            existing_data_files_count: m.existing_data_files_count,
            deleted_data_files_count: m.deleted_data_files_count,
            added_rows_count: m.added_rows_count,
            existing_rows_count: m.existing_rows_count,
            deleted_rows_count: m.deleted_rows_count,
        })),
    }, null, 2);
}
// ============================================================================
// Helpers
// ============================================================================
/**
 * Encodes column bounds (Uint8Array) to base64 strings for JSON serialization.
 */
function encodeColumnBounds(bounds) {
    const result = {};
    for (const [key, value] of Object.entries(bounds)) {
        result[Number(key)] = btoa(String.fromCharCode(...value));
    }
    return result;
}
/**
 * Generates a unique manifest file name.
 */
export function generateManifestName(snapshotId, index = 0) {
    return `snap-${snapshotId}-${index}-manifest.avro`;
}
/**
 * Generates a unique manifest list file name.
 */
export function generateManifestListName(snapshotId) {
    return `snap-${snapshotId}.avro`;
}
//# sourceMappingURL=manifest.js.map