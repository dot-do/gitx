import { describe, it, expect } from 'vitest'
import {
  createTableMetadata,
  addSnapshot,
  serializeMetadata,
  GIT_OBJECTS_ICEBERG_SCHEMA,
  generateSnapshotId,
  type IcebergTableMetadata,
} from '../../src/iceberg'

describe('Iceberg Metadata', () => {
  describe('generateSnapshotId', () => {
    it('should return a positive integer', () => {
      const id = generateSnapshotId()
      expect(typeof id).toBe('number')
      expect(Number.isInteger(id)).toBe(true)
      expect(id).toBeGreaterThan(0)
    })

    it('should generate unique IDs on consecutive calls', () => {
      const ids = new Set<number>()
      // Generate 100 IDs rapidly to test collision resistance
      // With 1000 possibilities per ms, 100 calls should rarely collide
      for (let i = 0; i < 100; i++) {
        ids.add(generateSnapshotId())
      }
      // At least 95% should be unique (allowing for rare collisions)
      expect(ids.size).toBeGreaterThanOrEqual(95)
    })

    it('should be within safe integer range', () => {
      const id = generateSnapshotId()
      expect(id).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
    })

    it('should include timestamp component (IDs increase over time)', async () => {
      const id1 = generateSnapshotId()
      // Wait 5ms to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 5))
      const id2 = generateSnapshotId()
      // id2 should be larger due to timestamp component
      // (with very high probability - the random component is < 1000, 5ms = 5000 difference)
      expect(id2).toBeGreaterThan(id1)
    })

    it('should have high uniqueness rate in rapid generation', () => {
      // Generate IDs rapidly and measure collision rate
      const ids: number[] = []
      for (let i = 0; i < 50; i++) {
        ids.push(generateSnapshotId())
      }
      const uniqueIds = new Set(ids)
      // With 1000 random values per ms, 50 rapid calls should have very few collisions
      // Using birthday paradox: ~1.2 expected collisions for 50 draws from 1000
      // So we expect at least 48 unique (allowing for some collisions)
      expect(uniqueIds.size).toBeGreaterThanOrEqual(48)
    })

    it('should not equal Date.now() alone (has random component)', () => {
      const id = generateSnapshotId()
      const now = Date.now()
      // The ID should be larger than now * 1000 due to random component
      // It should be in the range [now*1000, (now+1)*1000)
      expect(id).toBeGreaterThanOrEqual(now * 1000 - 1000) // Allow for timing variance
      expect(id).toBeLessThan((now + 2) * 1000) // Allow for timing variance
    })
  })

  describe('GIT_OBJECTS_ICEBERG_SCHEMA', () => {
    it('should define schema with field IDs for all git object columns', () => {
      const schema = GIT_OBJECTS_ICEBERG_SCHEMA
      expect(schema.fields).toHaveLength(12)

      const fieldNames = schema.fields.map(f => f.name)
      expect(fieldNames).toContain('sha')
      expect(fieldNames).toContain('type')
      expect(fieldNames).toContain('size')
      expect(fieldNames).toContain('storage')
      expect(fieldNames).toContain('path')
      expect(fieldNames).toContain('variant_metadata')
      expect(fieldNames).toContain('variant_value')
      expect(fieldNames).toContain('raw_data')
      expect(fieldNames).toContain('author_name')
      expect(fieldNames).toContain('author_date')
      expect(fieldNames).toContain('message')

      // Each field must have a unique field-id
      const ids = schema.fields.map(f => f.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) {
        expect(typeof id).toBe('number')
        expect(id).toBeGreaterThan(0)
      }
    })
  })

  describe('createTableMetadata', () => {
    it('should return format-version 2', () => {
      const meta = createTableMetadata({ location: 's3://bucket/warehouse/git_objects' })
      expect(meta['format-version']).toBe(2)
    })

    it('should include a table-uuid', () => {
      const meta = createTableMetadata({ location: 's3://bucket/warehouse/git_objects' })
      expect(meta['table-uuid']).toBeDefined()
      expect(typeof meta['table-uuid']).toBe('string')
      expect(meta['table-uuid'].length).toBeGreaterThan(0)
    })

    it('should set location', () => {
      const meta = createTableMetadata({ location: 's3://bucket/warehouse/git_objects' })
      expect(meta.location).toBe('s3://bucket/warehouse/git_objects')
    })

    it('should include schemas array with git objects schema', () => {
      const meta = createTableMetadata({ location: 's3://bucket/test' })
      expect(meta.schemas).toHaveLength(1)
      expect(meta.schemas[0]['schema-id']).toBe(0)
      expect(meta.schemas[0].fields).toHaveLength(12)
      expect(meta['current-schema-id']).toBe(0)
    })

    it('should include default partition spec (unpartitioned)', () => {
      const meta = createTableMetadata({ location: 's3://bucket/test' })
      expect(meta['partition-specs']).toHaveLength(1)
      expect(meta['partition-specs'][0]['spec-id']).toBe(0)
      expect(meta['partition-specs'][0].fields).toEqual([])
      expect(meta['default-spec-id']).toBe(0)
    })

    it('should include sort-orders', () => {
      const meta = createTableMetadata({ location: 's3://bucket/test' })
      expect(meta['sort-orders']).toHaveLength(1)
      expect(meta['sort-orders'][0]['order-id']).toBe(0)
      expect(meta['sort-orders'][0].fields).toEqual([])
      expect(meta['default-sort-order-id']).toBe(0)
    })

    it('should start with no snapshots', () => {
      const meta = createTableMetadata({ location: 's3://bucket/test' })
      expect(meta.snapshots).toEqual([])
      expect(meta['current-snapshot-id']).toBe(-1)
    })

    it('should include last-updated-ms', () => {
      const before = Date.now()
      const meta = createTableMetadata({ location: 's3://bucket/test' })
      const after = Date.now()
      expect(meta['last-updated-ms']).toBeGreaterThanOrEqual(before)
      expect(meta['last-updated-ms']).toBeLessThanOrEqual(after)
    })

    it('should accept optional table-uuid', () => {
      const meta = createTableMetadata({
        location: 's3://bucket/test',
        tableUuid: 'custom-uuid-1234',
      })
      expect(meta['table-uuid']).toBe('custom-uuid-1234')
    })
  })

  describe('addSnapshot', () => {
    it('should add a snapshot and update current-snapshot-id', () => {
      const meta = createTableMetadata({ location: 's3://bucket/test' })
      const updated = addSnapshot(meta, {
        manifestListPath: 's3://bucket/test/metadata/snap-1-manifest-list.json',
        summary: { operation: 'append', 'added-data-files': '1' },
      })

      expect(updated.snapshots).toHaveLength(1)
      expect(updated['current-snapshot-id']).toBe(updated.snapshots[0]['snapshot-id'])
      expect(updated.snapshots[0]['manifest-list']).toBe(
        's3://bucket/test/metadata/snap-1-manifest-list.json',
      )
      expect(updated.snapshots[0].summary.operation).toBe('append')
    })

    it('should auto-generate snapshot-id', () => {
      const meta = createTableMetadata({ location: 's3://bucket/test' })
      const updated = addSnapshot(meta, {
        manifestListPath: 's3://bucket/test/metadata/snap-1.json',
      })
      expect(typeof updated.snapshots[0]['snapshot-id']).toBe('number')
      expect(updated.snapshots[0]['snapshot-id']).toBeGreaterThan(0)
    })

    it('should chain multiple snapshots', () => {
      let meta = createTableMetadata({ location: 's3://bucket/test' })
      meta = addSnapshot(meta, { manifestListPath: 's3://bucket/test/snap-1.json', snapshotId: 100 })
      meta = addSnapshot(meta, { manifestListPath: 's3://bucket/test/snap-2.json', snapshotId: 200 })

      expect(meta.snapshots).toHaveLength(2)
      expect(meta['current-snapshot-id']).toBe(meta.snapshots[1]['snapshot-id'])
      // Second snapshot should reference first as parent
      expect(meta.snapshots[1]['parent-snapshot-id']).toBe(meta.snapshots[0]['snapshot-id'])
    })

    it('should set timestamp-ms on each snapshot', () => {
      const meta = createTableMetadata({ location: 's3://bucket/test' })
      const before = Date.now()
      const updated = addSnapshot(meta, { manifestListPath: 's3://bucket/test/snap.json' })
      const after = Date.now()

      expect(updated.snapshots[0]['timestamp-ms']).toBeGreaterThanOrEqual(before)
      expect(updated.snapshots[0]['timestamp-ms']).toBeLessThanOrEqual(after)
    })

    it('should update last-updated-ms', () => {
      const meta = createTableMetadata({ location: 's3://bucket/test' })
      const updated = addSnapshot(meta, { manifestListPath: 's3://bucket/test/snap.json' })
      expect(updated['last-updated-ms']).toBeGreaterThanOrEqual(meta['last-updated-ms'])
    })

    it('should throw on duplicate snapshot ID', () => {
      let meta = createTableMetadata({ location: 's3://bucket/test' })
      meta = addSnapshot(meta, {
        manifestListPath: 's3://bucket/test/snap-1.json',
        snapshotId: 42,
      })
      expect(() =>
        addSnapshot(meta, {
          manifestListPath: 's3://bucket/test/snap-2.json',
          snapshotId: 42,
        }),
      ).toThrow('Duplicate snapshot ID: 42')
    })

    it('should include snapshot-log', () => {
      let meta = createTableMetadata({ location: 's3://bucket/test' })
      meta = addSnapshot(meta, { manifestListPath: 's3://bucket/test/snap-1.json', snapshotId: 300 })
      meta = addSnapshot(meta, { manifestListPath: 's3://bucket/test/snap-2.json', snapshotId: 400 })

      expect(meta['snapshot-log']).toHaveLength(2)
      expect(meta['snapshot-log'][0]['snapshot-id']).toBe(meta.snapshots[0]['snapshot-id'])
      expect(meta['snapshot-log'][1]['snapshot-id']).toBe(meta.snapshots[1]['snapshot-id'])
    })
  })

  describe('serializeMetadata', () => {
    it('should produce valid JSON', () => {
      const meta = createTableMetadata({ location: 's3://bucket/test' })
      const json = serializeMetadata(meta)
      const parsed = JSON.parse(json)
      expect(parsed['format-version']).toBe(2)
    })

    it('should roundtrip through JSON', () => {
      let meta = createTableMetadata({ location: 's3://bucket/test' })
      meta = addSnapshot(meta, { manifestListPath: 's3://bucket/test/snap.json' })
      const json = serializeMetadata(meta)
      const parsed = JSON.parse(json) as IcebergTableMetadata
      expect(parsed.snapshots).toHaveLength(1)
      expect(parsed['current-snapshot-id']).toBe(meta['current-snapshot-id'])
    })
  })
})
