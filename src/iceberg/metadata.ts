/**
 * @fileoverview Iceberg v2 Table Metadata Generation
 *
 * Generates Iceberg v2 metadata JSON pointing to existing Parquet data files
 * on R2. Follows the UniForm pattern: same Parquet files, Iceberg metadata overlay.
 *
 * @module iceberg/metadata
 */

// ============================================================================
// Types
// ============================================================================

export interface IcebergField {
  id: number
  name: string
  required: boolean
  type: string
}

export interface IcebergSchema {
  'schema-id': number
  type: 'struct'
  fields: IcebergField[]
}

export interface IcebergPartitionSpec {
  'spec-id': number
  fields: unknown[]
}

export interface IcebergSortOrder {
  'order-id': number
  fields: unknown[]
}

export interface IcebergSnapshot {
  'snapshot-id': number
  'parent-snapshot-id'?: number
  'timestamp-ms': number
  summary: Record<string, string>
  'manifest-list': string
  'schema-id': number
}

export interface SnapshotLogEntry {
  'timestamp-ms': number
  'snapshot-id': number
}

export interface IcebergTableMetadata {
  'format-version': 2
  'table-uuid': string
  location: string
  'last-updated-ms': number
  'last-column-id': number
  schemas: IcebergSchema[]
  'current-schema-id': number
  'partition-specs': IcebergPartitionSpec[]
  'default-spec-id': number
  'sort-orders': IcebergSortOrder[]
  'default-sort-order-id': number
  properties: Record<string, string>
  snapshots: IcebergSnapshot[]
  'current-snapshot-id': number
  'snapshot-log': SnapshotLogEntry[]
}

// ============================================================================
// Git Objects Iceberg Schema
// ============================================================================

/**
 * Iceberg schema matching the GIT_OBJECTS_SCHEMA from parquet-store.ts.
 * Each field gets a unique field-id as required by Iceberg v2.
 */
export const GIT_OBJECTS_ICEBERG_SCHEMA: { 'schema-id': number; type: 'struct'; fields: IcebergField[] } = {
  'schema-id': 0,
  type: 'struct',
  fields: [
    { id: 1, name: 'sha', required: true, type: 'string' },
    { id: 2, name: 'type', required: true, type: 'string' },
    { id: 3, name: 'size', required: true, type: 'long' },
    { id: 4, name: 'storage', required: true, type: 'string' },
    { id: 5, name: 'data', required: false, type: 'binary' },
    { id: 6, name: 'path', required: false, type: 'string' },
  ],
}

// ============================================================================
// Metadata Creation
// ============================================================================

export interface CreateTableMetadataOptions {
  location: string
  tableUuid?: string
}

/**
 * Create a new Iceberg v2 table metadata object.
 */
export function createTableMetadata(options: CreateTableMetadataOptions): IcebergTableMetadata {
  const now = Date.now()
  const lastColumnId = GIT_OBJECTS_ICEBERG_SCHEMA.fields.reduce(
    (max, f) => Math.max(max, f.id),
    0,
  )

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
  }
}

// ============================================================================
// Snapshot Management
// ============================================================================

export interface AddSnapshotOptions {
  manifestListPath: string
  summary?: Record<string, string>
  snapshotId?: number
}

/**
 * Add a new snapshot to the table metadata (immutable - returns new metadata).
 * Each flush of Parquet data becomes a new snapshot.
 */
export function addSnapshot(
  metadata: IcebergTableMetadata,
  options: AddSnapshotOptions,
): IcebergTableMetadata {
  const now = Date.now()
  const snapshotId = options.snapshotId ?? now
  const parentSnapshotId =
    metadata['current-snapshot-id'] !== -1 ? metadata['current-snapshot-id'] : undefined

  const snapshot: IcebergSnapshot = {
    'snapshot-id': snapshotId,
    ...(parentSnapshotId !== undefined ? { 'parent-snapshot-id': parentSnapshotId } : {}),
    'timestamp-ms': now,
    summary: options.summary ?? { operation: 'append' },
    'manifest-list': options.manifestListPath,
    'schema-id': metadata['current-schema-id'],
  }

  const logEntry: SnapshotLogEntry = {
    'timestamp-ms': now,
    'snapshot-id': snapshotId,
  }

  return {
    ...metadata,
    'last-updated-ms': now,
    snapshots: [...metadata.snapshots, snapshot],
    'current-snapshot-id': snapshotId,
    'snapshot-log': [...metadata['snapshot-log'], logEntry],
  }
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize Iceberg table metadata to JSON string.
 */
export function serializeMetadata(metadata: IcebergTableMetadata): string {
  return JSON.stringify(metadata, null, 2)
}
