import { describe, it, expect } from 'vitest'
import {
  createManifestEntry,
  createManifest,
  createManifestList,
  serializeManifest,
  serializeManifestList,
  type ManifestEntry,
  type Manifest,
} from '../../src/iceberg'

describe('Iceberg Manifest', () => {
  const sampleDataFile = {
    filePath: 's3://bucket/repo/objects/abc123.parquet',
    fileSizeBytes: 1024 * 50,
    recordCount: 500,
    columnStats: {
      sha: { minValue: '0000abcd', maxValue: 'ffffabcd', nullCount: 0 },
      type: { minValue: 'blob', maxValue: 'tree', nullCount: 0 },
      size: { minValue: 0, maxValue: 1048576, nullCount: 0 },
    },
  }

  describe('createManifestEntry', () => {
    it('should create an entry with status ADDED', () => {
      const entry = createManifestEntry(sampleDataFile)
      expect(entry.status).toBe(1) // 1 = ADDED in Iceberg
    })

    it('should set content type to DATA (0)', () => {
      const entry = createManifestEntry(sampleDataFile)
      expect(entry.content).toBe(0) // 0 = DATA
    })

    it('should include file path', () => {
      const entry = createManifestEntry(sampleDataFile)
      expect(entry['data-file']['file-path']).toBe(sampleDataFile.filePath)
    })

    it('should include file format as Parquet', () => {
      const entry = createManifestEntry(sampleDataFile)
      expect(entry['data-file']['file-format']).toBe('PARQUET')
    })

    it('should include record count', () => {
      const entry = createManifestEntry(sampleDataFile)
      expect(entry['data-file']['record-count']).toBe(500)
    })

    it('should include file size', () => {
      const entry = createManifestEntry(sampleDataFile)
      expect(entry['data-file']['file-size-in-bytes']).toBe(1024 * 50)
    })

    it('should include column stats when provided', () => {
      const entry = createManifestEntry(sampleDataFile)
      const stats = entry['data-file']['column-sizes']
      // column-sizes is optional but lower-bounds/upper-bounds should be present
      expect(entry['data-file']['lower-bounds']).toBeDefined()
      expect(entry['data-file']['upper-bounds']).toBeDefined()
      expect(entry['data-file']['null-value-counts']).toBeDefined()
    })

    it('should set partition to empty (unpartitioned)', () => {
      const entry = createManifestEntry(sampleDataFile)
      expect(entry['data-file'].partition).toEqual({})
    })

    it('should accept custom status', () => {
      const entry = createManifestEntry(sampleDataFile, { status: 2 }) // DELETED
      expect(entry.status).toBe(2)
    })
  })

  describe('createManifest', () => {
    it('should create a manifest with entries', () => {
      const entry = createManifestEntry(sampleDataFile)
      const manifest = createManifest({
        entries: [entry],
        schemaId: 0,
        manifestPath: 's3://bucket/repo/metadata/manifest-1.json',
      })

      expect(manifest.entries).toHaveLength(1)
      expect(manifest['manifest-path']).toBe('s3://bucket/repo/metadata/manifest-1.json')
      expect(manifest['schema-id']).toBe(0)
    })

    it('should include added-files-count', () => {
      const e1 = createManifestEntry(sampleDataFile)
      const e2 = createManifestEntry({
        ...sampleDataFile,
        filePath: 's3://bucket/repo/objects/def456.parquet',
      })
      const manifest = createManifest({
        entries: [e1, e2],
        schemaId: 0,
        manifestPath: 's3://bucket/repo/metadata/manifest-1.json',
      })

      expect(manifest['added-files-count']).toBe(2)
      expect(manifest['added-rows-count']).toBe(1000) // 500 + 500
    })

    it('should include partition-spec-id', () => {
      const entry = createManifestEntry(sampleDataFile)
      const manifest = createManifest({
        entries: [entry],
        schemaId: 0,
        manifestPath: 's3://bucket/repo/metadata/manifest-1.json',
        partitionSpecId: 0,
      })

      expect(manifest['partition-spec-id']).toBe(0)
    })

    it('should track content type DATA', () => {
      const entry = createManifestEntry(sampleDataFile)
      const manifest = createManifest({
        entries: [entry],
        schemaId: 0,
        manifestPath: 's3://bucket/repo/metadata/manifest-1.json',
      })

      expect(manifest.content).toBe(0) // DATA
    })
  })

  describe('createManifestList', () => {
    it('should create a manifest list referencing manifests', () => {
      const entry = createManifestEntry(sampleDataFile)
      const manifest = createManifest({
        entries: [entry],
        schemaId: 0,
        manifestPath: 's3://bucket/repo/metadata/manifest-1.json',
      })

      const manifestList = createManifestList({
        manifests: [manifest],
        snapshotId: 12345,
      })

      expect(manifestList.entries).toHaveLength(1)
      expect(manifestList.entries[0]['manifest-path']).toBe(
        's3://bucket/repo/metadata/manifest-1.json',
      )
      expect(manifestList.entries[0]['added-data-files-count']).toBe(1)
      expect(manifestList.entries[0]['added-rows-count']).toBe(500)
      expect(manifestList.entries[0]['snapshot-id']).toBe(12345)
    })

    it('should list multiple manifests', () => {
      const e1 = createManifestEntry(sampleDataFile)
      const m1 = createManifest({
        entries: [e1],
        schemaId: 0,
        manifestPath: 's3://bucket/repo/metadata/manifest-1.json',
      })
      const e2 = createManifestEntry({
        ...sampleDataFile,
        filePath: 's3://bucket/repo/objects/other.parquet',
      })
      const m2 = createManifest({
        entries: [e2],
        schemaId: 0,
        manifestPath: 's3://bucket/repo/metadata/manifest-2.json',
      })

      const list = createManifestList({ manifests: [m1, m2], snapshotId: 999 })
      expect(list.entries).toHaveLength(2)
    })
  })

  describe('serialization', () => {
    it('should serialize manifest to valid JSON', () => {
      const entry = createManifestEntry(sampleDataFile)
      const manifest = createManifest({
        entries: [entry],
        schemaId: 0,
        manifestPath: 's3://bucket/repo/metadata/manifest-1.json',
      })

      const json = serializeManifest(manifest)
      const parsed = JSON.parse(json) as Manifest
      expect(parsed.entries).toHaveLength(1)
      expect(parsed['manifest-path']).toBe('s3://bucket/repo/metadata/manifest-1.json')
    })

    it('should serialize manifest list to valid JSON', () => {
      const entry = createManifestEntry(sampleDataFile)
      const manifest = createManifest({
        entries: [entry],
        schemaId: 0,
        manifestPath: 's3://bucket/repo/metadata/manifest-1.json',
      })
      const list = createManifestList({ manifests: [manifest], snapshotId: 1 })

      const json = serializeManifestList(list)
      const parsed = JSON.parse(json)
      expect(parsed.entries).toHaveLength(1)
    })
  })
})
