/**
 * @fileoverview Iceberg Manifest File Management
 *
 * Generates manifest-list and manifest files for Iceberg v2.
 * Each manifest entry references a Parquet data file with column stats.
 * Uses JSON format (not Avro) for Workers environment compatibility.
 *
 * @module iceberg/manifest
 */

// ============================================================================
// Types
// ============================================================================

export interface ColumnStat {
  minValue: string | number
  maxValue: string | number
  nullCount: number
}

export interface DataFileInput {
  filePath: string
  fileSizeBytes: number
  recordCount: number
  columnStats?: Record<string, ColumnStat>
}

export interface IcebergDataFile {
  content: number // 0 = DATA
  'file-path': string
  'file-format': 'PARQUET'
  partition: Record<string, never>
  'record-count': number
  'file-size-in-bytes': number
  'column-sizes'?: Record<number, number>
  'lower-bounds'?: Record<number, string | number>
  'upper-bounds'?: Record<number, string | number>
  'null-value-counts'?: Record<number, number>
}

export interface ManifestEntry {
  status: number // 1 = ADDED, 2 = DELETED, 0 = EXISTING
  content: number // 0 = DATA
  'data-file': IcebergDataFile
  'snapshot-id'?: number
  'sequence-number'?: number
}

export interface Manifest {
  'manifest-path': string
  'schema-id': number
  'partition-spec-id': number
  content: number // 0 = DATA
  'added-files-count': number
  'added-rows-count': number
  'existing-files-count': number
  'deleted-files-count': number
  entries: ManifestEntry[]
}

export interface ManifestListEntry {
  'manifest-path': string
  'manifest-length': number
  'partition-spec-id': number
  content: number
  'added-data-files-count': number
  'added-rows-count': number
  'existing-data-files-count': number
  'deleted-data-files-count': number
  'snapshot-id': number
}

export interface ManifestList {
  entries: ManifestListEntry[]
}

// ============================================================================
// Field ID mapping (matches GIT_OBJECTS_ICEBERG_SCHEMA)
// ============================================================================

const FIELD_ID_MAP: Record<string, number> = {
  sha: 1,
  type: 2,
  size: 3,
  storage: 4,
  data: 5,
  path: 6,
}

// ============================================================================
// Manifest Entry Creation
// ============================================================================

/**
 * Create a manifest entry for a Parquet data file.
 */
export function createManifestEntry(
  dataFile: DataFileInput,
  options?: { status?: number },
): ManifestEntry {
  const lowerBounds: Record<number, string | number> = {}
  const upperBounds: Record<number, string | number> = {}
  const nullValueCounts: Record<number, number> = {}

  if (dataFile.columnStats) {
    for (const [colName, stat] of Object.entries(dataFile.columnStats)) {
      const fieldId = FIELD_ID_MAP[colName]
      if (fieldId !== undefined) {
        lowerBounds[fieldId] = stat.minValue
        upperBounds[fieldId] = stat.maxValue
        nullValueCounts[fieldId] = stat.nullCount
      }
    }
  }

  const icebergDataFile: IcebergDataFile = {
    content: 0,
    'file-path': dataFile.filePath,
    'file-format': 'PARQUET',
    partition: {} as Record<string, never>,
    'record-count': dataFile.recordCount,
    'file-size-in-bytes': dataFile.fileSizeBytes,
    ...(Object.keys(lowerBounds).length > 0
      ? {
          'lower-bounds': lowerBounds,
          'upper-bounds': upperBounds,
          'null-value-counts': nullValueCounts,
        }
      : {}),
  }

  return {
    status: options?.status ?? 1, // ADDED
    content: 0, // DATA
    'data-file': icebergDataFile,
  }
}

// ============================================================================
// Manifest Creation
// ============================================================================

export interface CreateManifestOptions {
  entries: ManifestEntry[]
  schemaId: number
  manifestPath: string
  partitionSpecId?: number
}

/**
 * Create a manifest containing references to data files.
 */
export function createManifest(options: CreateManifestOptions): Manifest {
  const added = options.entries.filter(e => e.status === 1)
  const deleted = options.entries.filter(e => e.status === 2)
  const existing = options.entries.filter(e => e.status === 0)

  const addedRows = added.reduce((sum, e) => sum + e['data-file']['record-count'], 0)

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
  }
}

// ============================================================================
// Manifest List Creation
// ============================================================================

export interface CreateManifestListOptions {
  manifests: Manifest[]
  snapshotId: number
}

/**
 * Create a manifest list referencing one or more manifests.
 */
export function createManifestList(options: CreateManifestListOptions): ManifestList {
  const entries: ManifestListEntry[] = options.manifests.map(m => ({
    'manifest-path': m['manifest-path'],
    'manifest-length': JSON.stringify(m).length,
    'partition-spec-id': m['partition-spec-id'],
    content: m.content,
    'added-data-files-count': m['added-files-count'],
    'added-rows-count': m['added-rows-count'],
    'existing-data-files-count': m['existing-files-count'],
    'deleted-data-files-count': m['deleted-files-count'],
    'snapshot-id': options.snapshotId,
  }))

  return { entries }
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize a manifest to JSON.
 */
export function serializeManifest(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2)
}

/**
 * Serialize a manifest list to JSON.
 */
export function serializeManifestList(manifestList: ManifestList): string {
  return JSON.stringify(manifestList, null, 2)
}
