import { describe, it, expect, beforeEach } from 'vitest'
import {
  R2DataCatalog,
  CatalogError,
  IcebergTableManager,
  createDataFile,
  createManifestBuilder,
  createSnapshot,
  serializeManifest,
  serializeManifestList,
  generateManifestName,
  generateManifestListName,
} from '../../src/export/iceberg'
import { COMMITS_SCHEMA, REFS_SCHEMA, FILES_SCHEMA } from '../../src/export/schemas'
import type { DataFile, ManifestFile } from '../../src/export/iceberg/types'

// =============================================================================
// Mock R2 Bucket
// =============================================================================

class MockR2Bucket {
  private objects: Map<string, { data: string; metadata?: Record<string, string> }> = new Map()

  async put(key: string, data: string | ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data instanceof Uint8Array ? data : new Uint8Array(data))
    this.objects.set(key, { data: text })
  }

  async get(key: string): Promise<{ json<T>(): Promise<T>; text(): Promise<string> } | null> {
    const obj = this.objects.get(key)
    if (!obj) return null
    return {
      json: async <T>() => JSON.parse(obj.data) as T,
      text: async () => obj.data,
    }
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key]
    for (const k of keys) {
      this.objects.delete(k)
    }
  }

  async list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }> {
    const prefix = options?.prefix ?? ''
    const matching = Array.from(this.objects.keys())
      .filter(k => k.startsWith(prefix))
      .map(k => ({ key: k }))
    return { objects: matching }
  }

  // Test helpers
  has(key: string): boolean {
    return this.objects.has(key)
  }

  getData(key: string): string | undefined {
    return this.objects.get(key)?.data
  }

  clear(): void {
    this.objects.clear()
  }
}

// =============================================================================
// R2DataCatalog
// =============================================================================

describe('R2DataCatalog', () => {
  let bucket: MockR2Bucket
  let catalog: R2DataCatalog

  beforeEach(() => {
    bucket = new MockR2Bucket()
    catalog = new R2DataCatalog({
      bucket: bucket as unknown as R2Bucket,
      warehouseLocation: 'r2://gitx-analytics',
    })
  })

  describe('namespace operations', () => {
    it('should list namespaces as empty initially', async () => {
      const namespaces = await catalog.listNamespaces()
      expect(namespaces).toEqual([])
    })

    it('should create and list namespaces', async () => {
      await catalog.createNamespace(['gitx'])
      const namespaces = await catalog.listNamespaces()
      expect(namespaces).toEqual([['gitx']])
    })

    it('should reject duplicate namespaces', async () => {
      await catalog.createNamespace(['gitx'])
      await expect(catalog.createNamespace(['gitx'])).rejects.toThrow(CatalogError)
    })

    it('should store namespace properties', async () => {
      await catalog.createNamespace(['gitx'], { owner: 'test-org' })

      // Verify properties were stored
      const propsData = bucket.getData('catalog/namespaces/gitx/properties.json')
      expect(propsData).toBeDefined()
      expect(JSON.parse(propsData!)).toEqual({ owner: 'test-org' })
    })
  })

  describe('table operations', () => {
    it('should register a new table', async () => {
      const metadata = await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      expect(metadata.format_version).toBe(2)
      expect(metadata.table_uuid).toBeDefined()
      expect(metadata.location).toBe('r2://gitx-analytics/commits')
    })

    it('should auto-create namespace when registering table', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      const namespaces = await catalog.listNamespaces()
      expect(namespaces).toEqual([['gitx']])
    })

    it('should reject duplicate table registration', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')
      await expect(
        catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')
      ).rejects.toThrow(CatalogError)
    })

    it('should list tables in a namespace', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')
      await catalog.registerTable('gitx', 'refs', 'r2://gitx-analytics/refs')

      const tables = await catalog.listTables('gitx')
      expect(tables).toHaveLength(2)
      expect(tables.map(t => t.name)).toContain('commits')
      expect(tables.map(t => t.name)).toContain('refs')
    })

    it('should return empty list for non-existent namespace', async () => {
      const tables = await catalog.listTables('nonexistent')
      expect(tables).toEqual([])
    })

    it('should get table metadata', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      const metadata = await catalog.getTable('gitx', 'commits')
      expect(metadata.format_version).toBe(2)
      expect(metadata.location).toBe('r2://gitx-analytics/commits')
    })

    it('should throw NOT_FOUND for non-existent table', async () => {
      try {
        await catalog.getTable('gitx', 'nonexistent')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(CatalogError)
        expect((e as CatalogError).code).toBe('NOT_FOUND')
      }
    })
  })

  describe('table updates', () => {
    it('should add a snapshot to a table', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      const snapshot = {
        snapshot_id: 12345,
        sequence_number: 1,
        timestamp_ms: Date.now(),
        manifest_list: 'r2://gitx-analytics/commits/metadata/snap-12345.avro',
        summary: { operation: 'append' as const },
      }

      const updated = await catalog.updateTable('gitx', 'commits', [
        { action: 'add-snapshot', snapshot },
        { action: 'set-snapshot-ref', ref_name: 'main', type: 'branch', snapshot_id: 12345 },
      ])

      expect(updated.snapshots).toHaveLength(1)
      expect(updated.current_snapshot_id).toBe(12345)
    })

    it('should set table properties', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      const updated = await catalog.updateTable('gitx', 'commits', [
        { action: 'set-properties', updates: { 'write.format.default': 'parquet' } },
      ])

      expect(updated.properties?.['write.format.default']).toBe('parquet')
    })

    it('should validate requirements', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      await expect(
        catalog.updateTable('gitx', 'commits', [], [
          { type: 'assert-create' },
        ])
      ).rejects.toThrow(CatalogError)
    })
  })

  describe('table drop', () => {
    it('should drop an existing table', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')
      await catalog.dropTable('gitx', 'commits')

      const tables = await catalog.listTables('gitx')
      expect(tables).toHaveLength(0)
    })

    it('should throw NOT_FOUND when dropping non-existent table', async () => {
      try {
        await catalog.dropTable('gitx', 'nonexistent')
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(CatalogError)
        expect((e as CatalogError).code).toBe('NOT_FOUND')
      }
    })
  })

  describe('R2 key generation', () => {
    it('should generate catalog paths without prefix', async () => {
      // Verify through side effects: namespace file is written at correct path
      await catalog.createNamespace(['test'])
      expect(bucket.has('catalog/namespaces.json')).toBe(true)
    })

    it('should generate catalog paths with prefix', async () => {
      const prefixedCatalog = new R2DataCatalog({
        bucket: bucket as unknown as R2Bucket,
        prefix: 'analytics',
        warehouseLocation: 'r2://gitx-analytics',
      })
      await prefixedCatalog.createNamespace(['test'])
      expect(bucket.has('analytics/catalog/namespaces.json')).toBe(true)
    })
  })
})

// =============================================================================
// CatalogError
// =============================================================================

describe('CatalogError', () => {
  it('should create error with code', () => {
    const error = new CatalogError('Not found', 'NOT_FOUND')
    expect(error.message).toBe('Not found')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.name).toBe('CatalogError')
  })

  it('should support all error codes', () => {
    expect(new CatalogError('a', 'NOT_FOUND').code).toBe('NOT_FOUND')
    expect(new CatalogError('b', 'ALREADY_EXISTS').code).toBe('ALREADY_EXISTS')
    expect(new CatalogError('c', 'CONFLICT').code).toBe('CONFLICT')
    expect(new CatalogError('d', 'INTERNAL').code).toBe('INTERNAL')
  })

  it('should accept details', () => {
    const error = new CatalogError('Conflict', 'CONFLICT', { table: 'commits' })
    expect(error.details).toEqual({ table: 'commits' })
  })
})

// =============================================================================
// IcebergTableManager
// =============================================================================

describe('IcebergTableManager', () => {
  let bucket: MockR2Bucket
  let catalog: R2DataCatalog
  let manager: IcebergTableManager

  beforeEach(() => {
    bucket = new MockR2Bucket()
    catalog = new R2DataCatalog({
      bucket: bucket as unknown as R2Bucket,
      warehouseLocation: 'r2://gitx-analytics',
    })
    manager = new IcebergTableManager({
      catalog,
      bucket: bucket as unknown as R2Bucket,
    })
  })

  describe('createTable', () => {
    it('should create a commits table from Parquet schema', async () => {
      const metadata = await manager.createTable('gitx', 'commits', {
        schema: COMMITS_SCHEMA,
      })

      expect(metadata.format_version).toBe(2)
      expect(metadata.schemas).toHaveLength(1)
      expect(metadata.schemas[0].fields.length).toBe(COMMITS_SCHEMA.fields.length)
    })

    it('should create a refs table from Parquet schema', async () => {
      const metadata = await manager.createTable('gitx', 'refs', {
        schema: REFS_SCHEMA,
      })

      expect(metadata.schemas[0].fields.length).toBe(REFS_SCHEMA.fields.length)
    })

    it('should create a files table from Parquet schema', async () => {
      const metadata = await manager.createTable('gitx', 'files', {
        schema: FILES_SCHEMA,
      })

      expect(metadata.schemas[0].fields.length).toBe(FILES_SCHEMA.fields.length)
    })

    it('should convert Parquet field types to Iceberg types', async () => {
      const metadata = await manager.createTable('gitx', 'commits', {
        schema: COMMITS_SCHEMA,
      })

      const icebergSchema = metadata.schemas[0]
      // sha is STRING -> should map to 'string'
      const shaField = icebergSchema.fields.find(f => f.name === 'sha')
      expect(shaField?.type).toBe('string')

      // is_merge is BOOLEAN -> should map to 'boolean'
      const mergeField = icebergSchema.fields.find(f => f.name === 'is_merge')
      expect(mergeField?.type).toBe('boolean')

      // author_date is TIMESTAMP_MILLIS -> should map to 'timestamptz'
      const dateField = icebergSchema.fields.find(f => f.name === 'author_date')
      expect(dateField?.type).toBe('timestamptz')
    })

    it('should accept table properties', async () => {
      const metadata = await manager.createTable('gitx', 'commits', {
        schema: COMMITS_SCHEMA,
        properties: { 'write.format.default': 'parquet' },
      })

      expect(metadata.properties?.['write.format.default']).toBe('parquet')
    })
  })

  describe('appendFiles', () => {
    it('should append data files and create a snapshot', async () => {
      await manager.createTable('gitx', 'commits', { schema: COMMITS_SCHEMA })

      const dataFile = createDataFile(
        'r2://bucket/gitx/commits/data/part-0001.parquet',
        100,
        50000
      )

      const snapshot = await manager.appendFiles('gitx', 'commits', {
        files: [dataFile],
      })

      expect(snapshot.snapshot_id).toBeGreaterThan(0)
      expect(snapshot.summary.operation).toBe('append')
      expect(snapshot.summary['added-data-files']).toBe('1')
      expect(snapshot.summary['added-records']).toBe('100')
    })

    it('should append multiple data files', async () => {
      await manager.createTable('gitx', 'commits', { schema: COMMITS_SCHEMA })

      const files = [
        createDataFile('r2://bucket/gitx/commits/data/part-0001.parquet', 100, 50000),
        createDataFile('r2://bucket/gitx/commits/data/part-0002.parquet', 200, 80000),
      ]

      const snapshot = await manager.appendFiles('gitx', 'commits', { files })

      expect(snapshot.summary['added-data-files']).toBe('2')
      expect(snapshot.summary['added-records']).toBe('300')
      expect(snapshot.summary['added-files-size']).toBe('130000')
    })
  })

  describe('getMetadata', () => {
    it('should retrieve table metadata', async () => {
      await manager.createTable('gitx', 'commits', { schema: COMMITS_SCHEMA })

      const metadata = await manager.getMetadata('gitx', 'commits')
      expect(metadata.format_version).toBe(2)
    })
  })
})

// =============================================================================
// createDataFile
// =============================================================================

describe('createDataFile', () => {
  it('should create a data file entry with defaults', () => {
    const df = createDataFile('r2://bucket/data/part-0001.parquet', 100, 50000)

    expect(df.content).toBe(0) // data
    expect(df.file_path).toBe('r2://bucket/data/part-0001.parquet')
    expect(df.file_format).toBe('PARQUET')
    expect(df.partition).toEqual({})
    expect(df.record_count).toBe(100)
    expect(df.file_size_in_bytes).toBe(50000)
  })

  it('should accept partition values', () => {
    const df = createDataFile(
      'r2://bucket/data/part-0001.parquet',
      100,
      50000,
      { repository: 'owner/repo' }
    )

    expect(df.partition).toEqual({ repository: 'owner/repo' })
  })
})

// =============================================================================
// Manifest Builder
// =============================================================================

describe('createManifestBuilder', () => {
  it('should create a manifest builder', () => {
    const builder = createManifestBuilder({ snapshotId: 12345, sequenceNumber: 1 })
    expect(builder).toBeDefined()
  })

  it('should accumulate data files', () => {
    const builder = createManifestBuilder({ snapshotId: 12345, sequenceNumber: 1 })

    const df1 = createDataFile('path/part-0001.parquet', 100, 50000)
    const df2 = createDataFile('path/part-0002.parquet', 200, 80000)

    builder.addFile(df1)
    builder.addFile(df2)

    const entries = builder.getEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0].status).toBe(1) // added
    expect(entries[0].snapshot_id).toBe(12345)
    expect(entries[0].data_file).toBe(df1)
  })

  it('should build manifest file metadata', () => {
    const builder = createManifestBuilder({ snapshotId: 12345, sequenceNumber: 1 })

    builder.addFile(createDataFile('path/part-0001.parquet', 100, 50000))
    builder.addFile(createDataFile('path/part-0002.parquet', 200, 80000))

    const manifest = builder.build()
    expect(manifest.added_data_files_count).toBe(2)
    expect(manifest.added_rows_count).toBe(300)
    expect(manifest.existing_data_files_count).toBe(0)
    expect(manifest.deleted_data_files_count).toBe(0)
    expect(manifest.sequence_number).toBe(1)
    expect(manifest.min_sequence_number).toBe(1)
    expect(manifest.added_snapshot_id).toBe(12345)
    expect(manifest.content).toBe(0) // data manifest
  })

  it('should use custom partition spec ID', () => {
    const builder = createManifestBuilder({
      snapshotId: 12345,
      sequenceNumber: 1,
      partitionSpecId: 5,
    })
    const manifest = builder.build()
    expect(manifest.partition_spec_id).toBe(5)
  })
})

// =============================================================================
// createSnapshot
// =============================================================================

describe('createSnapshot', () => {
  it('should create a snapshot from manifests', () => {
    const manifest: ManifestFile = {
      manifest_path: 'path/manifest.json',
      manifest_length: 1024,
      partition_spec_id: 0,
      content: 0,
      sequence_number: 1,
      min_sequence_number: 1,
      added_snapshot_id: 12345,
      added_data_files_count: 2,
      existing_data_files_count: 0,
      deleted_data_files_count: 0,
      added_rows_count: 300,
      existing_rows_count: 0,
      deleted_rows_count: 0,
    }

    const snapshot = createSnapshot('path/manifest-list.json', [manifest])

    expect(snapshot.snapshot_id).toBeGreaterThan(0)
    expect(snapshot.manifest_list).toBe('path/manifest-list.json')
    expect(snapshot.summary.operation).toBe('append')
    expect(snapshot.summary['added-data-files']).toBe('2')
    expect(snapshot.summary['added-records']).toBe('300')
  })

  it('should set parent snapshot ID when provided', () => {
    const snapshot = createSnapshot('path/manifest-list.json', [], {
      parentSnapshotId: 999,
    })
    expect(snapshot.parent_snapshot_id).toBe(999)
  })

  it('should set schema ID when provided', () => {
    const snapshot = createSnapshot('path/manifest-list.json', [], {
      schemaId: 0,
    })
    expect(snapshot.schema_id).toBe(0)
  })

  it('should use custom operation type', () => {
    const snapshot = createSnapshot('path/manifest-list.json', [], {
      operation: 'overwrite',
    })
    expect(snapshot.summary.operation).toBe('overwrite')
  })

  it('should calculate delete summary from manifests', () => {
    const manifest: ManifestFile = {
      manifest_path: 'path/manifest.json',
      manifest_length: 512,
      partition_spec_id: 0,
      content: 0,
      sequence_number: 2,
      min_sequence_number: 1,
      added_snapshot_id: 12345,
      added_data_files_count: 0,
      existing_data_files_count: 1,
      deleted_data_files_count: 1,
      added_rows_count: 0,
      existing_rows_count: 50,
      deleted_rows_count: 25,
    }

    const snapshot = createSnapshot('path/ml.json', [manifest], { operation: 'delete' })
    expect(snapshot.summary['deleted-data-files']).toBe('1')
    expect(snapshot.summary['deleted-records']).toBe('25')
  })
})

// =============================================================================
// Serialization
// =============================================================================

describe('serializeManifest', () => {
  it('should serialize manifest entries to JSON', () => {
    const df = createDataFile('path/part-0001.parquet', 100, 50000)
    const entries = [{
      status: 1 as const,
      snapshot_id: 12345,
      sequence_number: 1,
      data_file: df,
    }]

    const json = serializeManifest(entries)
    const parsed = JSON.parse(json)

    expect(parsed.format_version).toBe(2)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0].data_file.file_path).toBe('path/part-0001.parquet')
    expect(parsed.entries[0].data_file.record_count).toBe(100)
  })
})

describe('serializeManifestList', () => {
  it('should serialize manifest list to JSON', () => {
    const manifests: ManifestFile[] = [{
      manifest_path: 'path/manifest.json',
      manifest_length: 1024,
      partition_spec_id: 0,
      content: 0,
      sequence_number: 1,
      min_sequence_number: 1,
      added_snapshot_id: 12345,
      added_data_files_count: 2,
      existing_data_files_count: 0,
      deleted_data_files_count: 0,
      added_rows_count: 300,
      existing_rows_count: 0,
      deleted_rows_count: 0,
    }]

    const json = serializeManifestList(manifests)
    const parsed = JSON.parse(json)

    expect(parsed.format_version).toBe(2)
    expect(parsed.manifests).toHaveLength(1)
    expect(parsed.manifests[0].manifest_path).toBe('path/manifest.json')
    expect(parsed.manifests[0].added_data_files_count).toBe(2)
  })
})

// =============================================================================
// Name Generators
// =============================================================================

describe('generateManifestName', () => {
  it('should generate a manifest filename', () => {
    const name = generateManifestName(12345)
    expect(name).toBe('snap-12345-0-manifest.json')
  })

  it('should include index for multiple manifests', () => {
    const name = generateManifestName(12345, 3)
    expect(name).toBe('snap-12345-3-manifest.json')
  })
})

describe('generateManifestListName', () => {
  it('should generate a manifest list filename', () => {
    const name = generateManifestListName(12345)
    expect(name).toBe('snap-12345.json')
  })
})
