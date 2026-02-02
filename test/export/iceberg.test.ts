import { describe, it, expect, beforeEach } from 'vitest'
import {
  R2DataCatalog,
  CatalogError,
  InvalidRefNameError,
  validateRefName,
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
import type { DataFile, ManifestFile, TableUpdate } from '../../src/export/iceberg/types'

// =============================================================================
// Mock R2 Bucket
// =============================================================================

interface MockR2Object {
  data: string
  etag: string
  metadata?: Record<string, string>
}

class PreconditionFailedError extends Error {
  status = 412
  code = 'PreconditionFailed'
  constructor() {
    super('Precondition Failed: etag mismatch')
  }
}

class MockR2Bucket {
  private objects: Map<string, MockR2Object> = new Map()
  private etagCounter = 0

  private generateEtag(): string {
    return `"etag-${++this.etagCounter}"`
  }

  async put(
    key: string,
    data: string | ArrayBuffer | Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string }
      onlyIf?: { etagMatches?: string }
    }
  ): Promise<void> {
    // Check conditional put (optimistic concurrency)
    if (options?.onlyIf?.etagMatches) {
      const existing = this.objects.get(key)
      if (!existing || existing.etag !== options.onlyIf.etagMatches) {
        throw new PreconditionFailedError()
      }
    }

    const text = typeof data === 'string' ? data : new TextDecoder().decode(data instanceof Uint8Array ? data : new Uint8Array(data))
    this.objects.set(key, { data: text, etag: this.generateEtag() })
  }

  async get(key: string): Promise<{ json<T>(): Promise<T>; text(): Promise<string>; etag: string } | null> {
    const obj = this.objects.get(key)
    if (!obj) return null
    return {
      json: async <T>() => JSON.parse(obj.data) as T,
      text: async () => obj.data,
      etag: obj.etag,
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

  getEtag(key: string): string | undefined {
    return this.objects.get(key)?.etag
  }

  clear(): void {
    this.objects.clear()
    this.etagCounter = 0
  }

  // Simulate external modification (for testing concurrency)
  simulateExternalModification(key: string): void {
    const obj = this.objects.get(key)
    if (obj) {
      this.objects.set(key, { ...obj, etag: this.generateEtag() })
    }
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

    it('should write versioned metadata files', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // First update creates v2
      await catalog.updateTable('gitx', 'commits', [
        { action: 'set-properties', updates: { key1: 'value1' } },
      ])
      expect(bucket.has('commits/metadata/v2.metadata.json')).toBe(true)

      // Second update creates v3
      await catalog.updateTable('gitx', 'commits', [
        { action: 'set-properties', updates: { key2: 'value2' } },
      ])
      expect(bucket.has('commits/metadata/v3.metadata.json')).toBe(true)
    })

    it('should track metadata version in location pointer', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // Check initial version
      const locationData1 = JSON.parse(bucket.getData('catalog/namespaces/gitx/commits/location.json')!)
      expect(locationData1.metadata_version).toBe(1)

      // Update and check version incremented
      await catalog.updateTable('gitx', 'commits', [
        { action: 'set-properties', updates: { key: 'value' } },
      ])
      const locationData2 = JSON.parse(bucket.getData('catalog/namespaces/gitx/commits/location.json')!)
      expect(locationData2.metadata_version).toBe(2)
      expect(locationData2.current_metadata).toContain('v2.metadata.json')
    })
  })

  describe('optimistic concurrency control', () => {
    it('should detect concurrent modification and retry', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // Get the initial state
      const initialLocationPath = 'catalog/namespaces/gitx/commits/location.json'
      const initialEtag = bucket.getEtag(initialLocationPath)
      expect(initialEtag).toBeDefined()

      // Simulate another process modifying the location pointer during our update
      // We do this by intercepting the first get and then modifying the file
      let getCount = 0
      const originalGet = bucket.get.bind(bucket)
      bucket.get = async (key: string) => {
        const result = await originalGet(key)
        getCount++
        // After reading location.json for the first time, simulate external modification
        if (key === initialLocationPath && getCount === 2) {
          bucket.simulateExternalModification(key)
        }
        return result
      }

      // The update should succeed after retry
      const updated = await catalog.updateTable('gitx', 'commits', [
        { action: 'set-properties', updates: { test: 'value' } },
      ])

      expect(updated.properties?.['test']).toBe('value')

      // Restore original get
      bucket.get = originalGet
    })

    it('should fail after max retries exceeded', async () => {
      // Create catalog with only 1 retry attempt
      const strictCatalog = new R2DataCatalog({
        bucket: bucket as unknown as R2Bucket,
        warehouseLocation: 'r2://gitx-analytics',
        maxRetries: 1,
      })

      await strictCatalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // Always simulate external modification to force continuous failures
      const locationPath = 'catalog/namespaces/gitx/commits/location.json'
      const originalGet = bucket.get.bind(bucket)
      bucket.get = async (key: string) => {
        const result = await originalGet(key)
        // Always modify the location file after reading it
        if (key === locationPath) {
          bucket.simulateExternalModification(key)
        }
        return result
      }

      // Should fail with CONFLICT after exhausting retries
      await expect(
        strictCatalog.updateTable('gitx', 'commits', [
          { action: 'set-properties', updates: { test: 'value' } },
        ])
      ).rejects.toThrow(CatalogError)

      try {
        await strictCatalog.updateTable('gitx', 'commits', [
          { action: 'set-properties', updates: { test: 'value' } },
        ])
      } catch (e) {
        expect((e as CatalogError).code).toBe('CONFLICT')
        expect((e as CatalogError).details?.attempts).toBe(1)
      }

      // Restore original get
      bucket.get = originalGet
    })

    it('should clean up orphaned metadata files on conflict', async () => {
      // Create catalog with only 1 retry attempt
      const strictCatalog = new R2DataCatalog({
        bucket: bucket as unknown as R2Bucket,
        warehouseLocation: 'r2://gitx-analytics',
        maxRetries: 1,
      })

      await strictCatalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // Track metadata files created
      const metadataFiles: string[] = []
      const originalPut = bucket.put.bind(bucket)
      bucket.put = async (key: string, data: string | ArrayBuffer | Uint8Array, options?: unknown) => {
        if (key.includes('metadata.json') && key.includes('v2')) {
          metadataFiles.push(key)
        }
        return originalPut(key, data, options as Parameters<typeof originalPut>[2])
      }

      // Always simulate external modification to force conflict
      const locationPath = 'catalog/namespaces/gitx/commits/location.json'
      const originalGet = bucket.get.bind(bucket)
      bucket.get = async (key: string) => {
        const result = await originalGet(key)
        if (key === locationPath) {
          bucket.simulateExternalModification(key)
        }
        return result
      }

      // Try to update (should fail)
      await expect(
        strictCatalog.updateTable('gitx', 'commits', [
          { action: 'set-properties', updates: { test: 'value' } },
        ])
      ).rejects.toThrow(CatalogError)

      // Verify orphaned metadata file was cleaned up
      for (const file of metadataFiles) {
        expect(bucket.has(file)).toBe(false)
      }

      // Restore
      bucket.put = originalPut
      bucket.get = originalGet
    })

    it('should handle sequential updates correctly', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // First update
      const result1 = await catalog.updateTable('gitx', 'commits', [
        { action: 'set-properties', updates: { key1: 'value1' } },
      ])
      expect(result1.properties?.['key1']).toBe('value1')

      // Second update builds on first
      const result2 = await catalog.updateTable('gitx', 'commits', [
        { action: 'set-properties', updates: { key2: 'value2' } },
      ])
      expect(result2.properties?.['key1']).toBe('value1')
      expect(result2.properties?.['key2']).toBe('value2')

      // Final state should have both keys
      const finalMetadata = await catalog.getTable('gitx', 'commits')
      expect(finalMetadata.properties?.['key1']).toBe('value1')
      expect(finalMetadata.properties?.['key2']).toBe('value2')
    })

    it('should include conflict details in error', async () => {
      // Create catalog with only 1 retry attempt
      const strictCatalog = new R2DataCatalog({
        bucket: bucket as unknown as R2Bucket,
        warehouseLocation: 'r2://gitx-analytics',
        maxRetries: 1,
      })

      await strictCatalog.registerTable('gitx', 'test', 'r2://gitx-analytics/test')

      // Always simulate external modification to force conflict
      const locationPath = 'catalog/namespaces/gitx/test/location.json'
      const originalGet = bucket.get.bind(bucket)
      bucket.get = async (key: string) => {
        const result = await originalGet(key)
        if (key === locationPath) {
          bucket.simulateExternalModification(key)
        }
        return result
      }

      try {
        await strictCatalog.updateTable('gitx', 'test', [
          { action: 'set-properties', updates: { test: 'value' } },
        ])
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(CatalogError)
        expect((e as CatalogError).code).toBe('CONFLICT')
        expect((e as CatalogError).details).toBeDefined()
        expect((e as CatalogError).details?.attempts).toBe(1)
      }

      // Restore original get
      bucket.get = originalGet
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

    it('should drop table with purge=true and delete data files', async () => {
      // Register a table
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // Add some data files to simulate table data (under the table location)
      await bucket.put('commits/data/part-0001.parquet', 'fake parquet data 1')
      await bucket.put('commits/data/part-0002.parquet', 'fake parquet data 2')

      // Verify data files exist
      expect(bucket.has('commits/data/part-0001.parquet')).toBe(true)
      expect(bucket.has('commits/data/part-0002.parquet')).toBe(true)
      // Verify metadata file exists (created by registerTable)
      expect(bucket.has('commits/metadata/v1.metadata.json')).toBe(true)

      // Drop with purge - this should NOT error (bug fix: reads metadata before deleting location)
      await catalog.dropTable('gitx', 'commits', true)

      // Verify table is removed from catalog
      const tables = await catalog.listTables('gitx')
      expect(tables).toHaveLength(0)

      // Verify data files were deleted
      expect(bucket.has('commits/data/part-0001.parquet')).toBe(false)
      expect(bucket.has('commits/data/part-0002.parquet')).toBe(false)
      // Verify metadata file was also deleted
      expect(bucket.has('commits/metadata/v1.metadata.json')).toBe(false)
    })

    it('should drop table with purge=true even when metadata retrieval fails', async () => {
      // Register a table
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // Manually delete the metadata file to simulate corruption
      await bucket.delete('commits/metadata/v1.metadata.json')

      // Drop with purge should not throw - metadata read failure should be caught
      await catalog.dropTable('gitx', 'commits', true)

      // Verify table is removed from catalog
      const tables = await catalog.listTables('gitx')
      expect(tables).toHaveLength(0)
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

  describe('update validation', () => {
    it('should reject update with missing action', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { notAction: 'invalid' } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject update with unknown action', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'unknown-action' } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject add-schema with invalid schema', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // Missing fields array
      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'add-schema', schema: { type: 'struct', schema_id: 1 } } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)

      // Missing type
      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'add-schema', schema: { schema_id: 1, fields: [] } } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)

      // schema is null
      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'add-schema', schema: null } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject set-current-schema with non-number schema_id', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'set-current-schema', schema_id: '1' } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'set-current-schema' } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject add-partition-spec with invalid spec', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // Missing spec_id
      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'add-partition-spec', spec: { fields: [] } } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)

      // Missing fields
      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'add-partition-spec', spec: { spec_id: 1 } } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject add-snapshot with invalid snapshot', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      // Missing required fields
      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'add-snapshot', snapshot: { snapshot_id: 1 } } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)

      // snapshot is null
      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'add-snapshot', snapshot: null } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject set-snapshot-ref with invalid type', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'set-snapshot-ref', ref_name: 'main', type: 'invalid', snapshot_id: 1 } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject set-snapshot-ref with empty ref_name', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'set-snapshot-ref', ref_name: '', type: 'branch', snapshot_id: 1 } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject remove-snapshots with non-array snapshot_ids', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'remove-snapshots', snapshot_ids: '1,2,3' } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'remove-snapshots', snapshot_ids: [1, '2', 3] } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject set-properties with non-object updates', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'set-properties', updates: 'invalid' } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'set-properties', updates: ['key', 'value'] } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject remove-properties with non-array removals', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'remove-properties', removals: 'key' } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should reject set-location with empty location', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'set-location', location: '' } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)

      await expect(
        catalog.updateTable('gitx', 'commits', [
          { action: 'set-location', location: 123 } as unknown as TableUpdate,
        ])
      ).rejects.toThrow(CatalogError)
    })

    it('should validate update error includes details', async () => {
      await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

      try {
        await catalog.updateTable('gitx', 'commits', [
          { action: 'add-schema', schema: null } as unknown as TableUpdate,
        ])
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(CatalogError)
        expect((e as CatalogError).code).toBe('INTERNAL')
        expect((e as CatalogError).details).toBeDefined()
        expect((e as CatalogError).details?.update).toBeDefined()
      }
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
// Ref Name Validation
// =============================================================================

describe('validateRefName', () => {
  it('should accept valid ref names', () => {
    expect(() => validateRefName('main')).not.toThrow()
    expect(() => validateRefName('feature/my-branch')).not.toThrow()
    expect(() => validateRefName('refs/heads/main')).not.toThrow()
    expect(() => validateRefName('v1.0.0')).not.toThrow()
    expect(() => validateRefName('release-2024-01')).not.toThrow()
    expect(() => validateRefName('a')).not.toThrow()
  })

  it('should reject empty ref names', () => {
    expect(() => validateRefName('')).toThrow(InvalidRefNameError)
    expect(() => validateRefName('')).toThrow(/cannot be empty/)
  })

  it('should reject ref names starting with a dot', () => {
    expect(() => validateRefName('.hidden')).toThrow(InvalidRefNameError)
    expect(() => validateRefName('.hidden')).toThrow(/cannot start with a dot/)
  })

  it('should reject ref names ending with .lock', () => {
    expect(() => validateRefName('main.lock')).toThrow(InvalidRefNameError)
    expect(() => validateRefName('main.lock')).toThrow(/cannot end with .lock/)
    expect(() => validateRefName('feature.lock')).toThrow(InvalidRefNameError)
  })

  it('should reject ref names containing ..', () => {
    expect(() => validateRefName('main..branch')).toThrow(InvalidRefNameError)
    expect(() => validateRefName('main..branch')).toThrow(/cannot contain "\.\."/)
    expect(() => validateRefName('a..b..c')).toThrow(InvalidRefNameError)
  })

  it('should reject ref names with control characters', () => {
    expect(() => validateRefName('main\x00branch')).toThrow(InvalidRefNameError)
    expect(() => validateRefName('main\x00branch')).toThrow(/cannot contain control characters/)
    expect(() => validateRefName('main\x1Fbranch')).toThrow(InvalidRefNameError)
    expect(() => validateRefName('main\tbranch')).toThrow(InvalidRefNameError)
  })

  it('should reject ref names with tilde', () => {
    expect(() => validateRefName('main~1')).toThrow(InvalidRefNameError)
    expect(() => validateRefName('main~1')).toThrow(/cannot contain ~ \^ : \\ \? \* or \[/)
  })

  it('should reject ref names with caret', () => {
    expect(() => validateRefName('main^1')).toThrow(InvalidRefNameError)
  })

  it('should reject ref names with colon', () => {
    expect(() => validateRefName('local:remote')).toThrow(InvalidRefNameError)
  })

  it('should reject ref names with backslash', () => {
    expect(() => validateRefName('main\\branch')).toThrow(InvalidRefNameError)
  })

  it('should reject ref names with question mark', () => {
    expect(() => validateRefName('feature?')).toThrow(InvalidRefNameError)
  })

  it('should reject ref names with asterisk', () => {
    expect(() => validateRefName('feature*')).toThrow(InvalidRefNameError)
  })

  it('should reject ref names with open bracket', () => {
    expect(() => validateRefName('feature[1]')).toThrow(InvalidRefNameError)
  })

  it('should reject ref names containing @{', () => {
    expect(() => validateRefName('main@{1}')).toThrow(InvalidRefNameError)
    expect(() => validateRefName('main@{1}')).toThrow(/cannot contain "@{"/)
  })
})

describe('InvalidRefNameError', () => {
  it('should include ref name and reason', () => {
    const error = new InvalidRefNameError('bad..ref', 'cannot contain ".."')
    expect(error.refName).toBe('bad..ref')
    expect(error.reason).toBe('cannot contain ".."')
    expect(error.message).toBe('Invalid ref name "bad..ref": cannot contain ".."')
    expect(error.name).toBe('InvalidRefNameError')
  })
})

describe('R2DataCatalog ref validation integration', () => {
  let bucket: MockR2Bucket
  let catalog: R2DataCatalog

  beforeEach(() => {
    bucket = new MockR2Bucket()
    catalog = new R2DataCatalog({
      bucket: bucket as unknown as R2Bucket,
      warehouseLocation: 'r2://gitx-analytics',
    })
  })

  it('should reject invalid ref name in set-snapshot-ref update', async () => {
    await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

    const snapshot = {
      snapshot_id: 12345,
      sequence_number: 1,
      timestamp_ms: Date.now(),
      manifest_list: 'r2://gitx-analytics/commits/metadata/snap-12345.avro',
      summary: { operation: 'append' as const },
    }

    await expect(
      catalog.updateTable('gitx', 'commits', [
        { action: 'add-snapshot', snapshot },
        { action: 'set-snapshot-ref', ref_name: 'bad..ref', type: 'branch', snapshot_id: 12345 },
      ])
    ).rejects.toThrow(InvalidRefNameError)
  })

  it('should reject invalid ref name in assert-ref-snapshot-id requirement', async () => {
    await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')

    await expect(
      catalog.updateTable('gitx', 'commits', [], [
        { type: 'assert-ref-snapshot-id', ref: '.hidden', snapshot_id: null },
      ])
    ).rejects.toThrow(InvalidRefNameError)
  })

  it('should allow valid ref names in updates', async () => {
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
      { action: 'set-snapshot-ref', ref_name: 'feature/my-branch', type: 'branch', snapshot_id: 12345 },
    ])

    expect(updated.refs?.['feature/my-branch']).toBeDefined()
    expect(updated.refs?.['feature/my-branch'].snapshot_id).toBe(12345)
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
