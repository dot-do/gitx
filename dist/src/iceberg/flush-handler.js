/**
 * @fileoverview Iceberg Flush Handler for ParquetStore
 *
 * Creates an `OnFlushHandler` callback that generates Iceberg v2 metadata
 * (manifest, manifest list, table metadata) after each ParquetStore flush.
 *
 * This module is the sole bridge between the storage layer (ParquetStore)
 * and Iceberg metadata generation. ParquetStore itself has no knowledge of
 * Iceberg -- it simply invokes the injected `onFlush` callback.
 *
 * @module iceberg/flush-handler
 */
import { createTableMetadata, addSnapshot, serializeMetadata, createManifestEntry, createManifest, serializeManifest, createManifestList, serializeManifestList, generateSnapshotId, } from './adapter';
// ============================================================================
// Factory
// ============================================================================
/**
 * Creates an `OnFlushHandler` that writes Iceberg v2 metadata to R2
 * after each ParquetStore flush.
 *
 * The handler is stateful: it keeps an in-memory copy of the Iceberg
 * table metadata and appends a new snapshot on every invocation.
 *
 * @example
 * ```ts
 * import { createIcebergFlushHandler } from '../iceberg/flush-handler'
 *
 * const store = new ParquetStore({
 *   r2: bucket,
 *   sql: sqlStorage,
 *   prefix: 'repos/abc123',
 *   onFlush: createIcebergFlushHandler(),
 * })
 * ```
 */
export function createIcebergFlushHandler() {
    // Mutable state: accumulated table metadata across flushes
    let icebergMetadata = null;
    return async (event) => {
        const { parquetKey, fileSizeBytes, recordCount, r2, prefix } = event;
        // Generate a unique snapshot ID using timestamp + random component
        const snapshotId = generateSnapshotId();
        // (a) Create a manifest entry for the new Parquet file
        const entry = createManifestEntry({
            filePath: parquetKey,
            fileSizeBytes,
            recordCount,
        });
        // (b) Create a manifest containing that entry
        const manifestId = crypto.randomUUID();
        const manifestPath = `${prefix}/iceberg/manifests/${manifestId}.avro`;
        const manifest = createManifest({
            entries: [entry],
            schemaId: 0,
            manifestPath,
        });
        // (c) Write manifest JSON to R2
        await r2.put(manifestPath, serializeManifest(manifest));
        // (d) Create manifest list
        const manifestListId = crypto.randomUUID();
        const manifestListPath = `${prefix}/iceberg/manifest-lists/${manifestListId}.avro`;
        const manifestList = createManifestList({
            manifests: [manifest],
            snapshotId,
        });
        // (e) Write manifest list to R2
        await r2.put(manifestListPath, serializeManifestList(manifestList));
        // (f) Load or create table metadata, add snapshot pointing to manifest list
        if (!icebergMetadata) {
            icebergMetadata = createTableMetadata({
                location: `${prefix}/iceberg`,
            });
        }
        icebergMetadata = addSnapshot(icebergMetadata, {
            manifestListPath,
            snapshotId,
            summary: {
                operation: 'append',
                'added-data-files': '1',
                'added-records': String(recordCount),
            },
        });
        // (g) Write metadata.json to R2
        const metadataPath = `${prefix}/iceberg/metadata.json`;
        await r2.put(metadataPath, serializeMetadata(icebergMetadata));
    };
}
//# sourceMappingURL=flush-handler.js.map