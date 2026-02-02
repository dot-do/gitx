/**
 * @fileoverview Iceberg Manifest File Management
 *
 * Generates manifest-list and manifest files for Iceberg v2.
 * Each manifest entry references a Parquet data file with column stats.
 * Uses JSON format (not Avro) for Workers environment compatibility.
 *
 * @module iceberg/manifest
 */
export interface ColumnStat {
    minValue: string | number;
    maxValue: string | number;
    nullCount: number;
}
export interface DataFileInput {
    filePath: string;
    fileSizeBytes: number;
    recordCount: number;
    columnStats?: Record<string, ColumnStat>;
}
export interface IcebergDataFile {
    content: number;
    'file-path': string;
    'file-format': 'PARQUET';
    partition: Record<string, never>;
    'record-count': number;
    'file-size-in-bytes': number;
    'column-sizes'?: Record<number, number>;
    'lower-bounds'?: Record<number, string | number>;
    'upper-bounds'?: Record<number, string | number>;
    'null-value-counts'?: Record<number, number>;
}
export interface ManifestEntry {
    status: number;
    content: number;
    'data-file': IcebergDataFile;
    'snapshot-id'?: number;
    'sequence-number'?: number;
}
export interface Manifest {
    'manifest-path': string;
    'schema-id': number;
    'partition-spec-id': number;
    content: number;
    'added-files-count': number;
    'added-rows-count': number;
    'existing-files-count': number;
    'deleted-files-count': number;
    entries: ManifestEntry[];
}
export interface ManifestListEntry {
    'manifest-path': string;
    'manifest-length': number;
    'partition-spec-id': number;
    content: number;
    'added-data-files-count': number;
    'added-rows-count': number;
    'existing-data-files-count': number;
    'deleted-data-files-count': number;
    'snapshot-id': number;
}
export interface ManifestList {
    entries: ManifestListEntry[];
}
/**
 * Create a manifest entry for a Parquet data file.
 */
export declare function createManifestEntry(dataFile: DataFileInput, options?: {
    status?: number;
}): ManifestEntry;
export interface CreateManifestOptions {
    entries: ManifestEntry[];
    schemaId: number;
    manifestPath: string;
    partitionSpecId?: number;
}
/**
 * Create a manifest containing references to data files.
 */
export declare function createManifest(options: CreateManifestOptions): Manifest;
export interface CreateManifestListOptions {
    manifests: Manifest[];
    snapshotId: number;
}
/**
 * Create a manifest list referencing one or more manifests.
 */
export declare function createManifestList(options: CreateManifestListOptions): ManifestList;
/**
 * Serialize a manifest to JSON.
 */
export declare function serializeManifest(manifest: Manifest): string;
/**
 * Serialize a manifest list to JSON.
 */
export declare function serializeManifestList(manifestList: ManifestList): string;
//# sourceMappingURL=manifest.d.ts.map