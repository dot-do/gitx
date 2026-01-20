import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  BundleSchemaManager,
  BUNDLE_SCHEMA_VERSION,
  BUNDLE_SCHEMA_SQL,
  MIGRATIONS,
  recordBundle,
  lookupBundle,
  recordBundleObject,
  lookupBundleObject,
  getBundleObjects,
  markObjectDeleted,
  sealBundle,
  getActiveBundle,
  setActiveBundle,
  updateActiveBundle,
  clearActiveBundle,
  getBundleStats,
  listBundles,
  type BundleRecord,
  type BundleObjectRecord,
  type ActiveBundleRecord
} from '../../src/storage/bundle-schema'
import type { DurableObjectStorage } from '../../src/do/schema'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock Durable Object storage for testing.
 * Uses an in-memory SQLite-like structure.
 */
function createMockStorage(): DurableObjectStorage & { _tables: Map<string, Map<string, unknown>> } {
  const tables = new Map<string, Map<string, unknown>>()
  const migrations = new Map<number, { version: number; description: string; applied_at: number }>()

  // Track schema state
  let schemaInitialized = false

  return {
    _tables: tables,
    sql: {
      exec(query: string, ...params: unknown[]) {
        const lowerQuery = query.toLowerCase().trim()

        // Handle CREATE TABLE statements
        if (lowerQuery.startsWith('create table if not exists')) {
          const tableMatch = query.match(/create table if not exists (\w+)/i)
          if (tableMatch) {
            const tableName = tableMatch[1]
            if (!tables.has(tableName)) {
              tables.set(tableName, new Map())
            }
          }
          return { toArray: () => [] }
        }

        // Handle CREATE INDEX statements
        if (lowerQuery.startsWith('create index')) {
          return { toArray: () => [] }
        }

        // Handle DROP TABLE statements
        if (lowerQuery.startsWith('drop table if exists')) {
          const tableMatch = query.match(/drop table if exists (\w+)/i)
          if (tableMatch) {
            tables.delete(tableMatch[1])
          }
          return { toArray: () => [] }
        }

        // Handle INSERT OR REPLACE INTO schema_migrations
        if (lowerQuery.includes('insert') && lowerQuery.includes('schema_migrations')) {
          const [version, description, appliedAt] = params as [number, string, number]
          migrations.set(version, { version, description, applied_at: appliedAt })
          schemaInitialized = true
          return { toArray: () => [] }
        }

        // Handle SELECT MAX(version) FROM schema_migrations
        if (lowerQuery.includes('select max(version)') && lowerQuery.includes('schema_migrations')) {
          if (!schemaInitialized || migrations.size === 0) {
            return { toArray: () => [{ version: null }] }
          }
          const maxVersion = Math.max(...migrations.keys())
          return { toArray: () => [{ version: maxVersion }] }
        }

        // Handle SELECT from schema_migrations
        if (lowerQuery.includes('select') && lowerQuery.includes('from schema_migrations')) {
          if (lowerQuery.includes('where version =')) {
            const version = params[0] as number
            const migration = migrations.get(version)
            return { toArray: () => migration ? [migration] : [] }
          }
          if (lowerQuery.includes('order by version')) {
            return { toArray: () => Array.from(migrations.values()).sort((a, b) => a.version - b.version) }
          }
        }

        // Handle SELECT from sqlite_master
        if (lowerQuery.includes('sqlite_master')) {
          const tableList = Array.from(tables.keys()).map(name => ({ name }))
          return { toArray: () => tableList }
        }

        // Handle INSERT OR REPLACE INTO bundles
        if (lowerQuery.includes('insert') && lowerQuery.includes('bundles') && !lowerQuery.includes('bundle_objects')) {
          const [id, r2Key, entryCount, size, dataOffset, createdAt, sealed, checksum] = params as [
            string, string, number, number, number, number, number, string | null
          ]
          if (!tables.has('bundles')) tables.set('bundles', new Map())
          tables.get('bundles')!.set(id, {
            id,
            r2_key: r2Key,
            entry_count: entryCount,
            size,
            data_offset: dataOffset,
            created_at: createdAt,
            sealed,
            checksum
          })
          return { toArray: () => [] }
        }

        // Handle SELECT from bundles
        if (lowerQuery.includes('select') && lowerQuery.includes('from bundles') && !lowerQuery.includes('bundle_objects')) {
          const bundlesTable = tables.get('bundles')
          if (!bundlesTable) return { toArray: () => [] }

          if (lowerQuery.includes('where id =')) {
            const id = params[0] as string
            const bundle = bundlesTable.get(id)
            return { toArray: () => bundle ? [bundle] : [] }
          }

          if (lowerQuery.includes('count(*)')) {
            const bundles = Array.from(bundlesTable.values())
            const totalBundles = bundles.length
            const sealedBundles = bundles.filter((b: any) => b.sealed === 1).length
            const totalSize = bundles.reduce((sum: number, b: any) => sum + b.size, 0)
            return { toArray: () => [{ total_bundles: totalBundles, sealed_bundles: sealedBundles, total_size: totalSize }] }
          }

          // List bundles
          let bundles = Array.from(bundlesTable.values()) as BundleRecord[]
          if (lowerQuery.includes('where sealed = 1')) {
            bundles = bundles.filter(b => b.sealed === 1)
          }
          bundles.sort((a, b) => b.created_at - a.created_at)
          return { toArray: () => bundles }
        }

        // Handle UPDATE bundles (seal)
        if (lowerQuery.includes('update bundles')) {
          const bundlesTable = tables.get('bundles')
          if (bundlesTable && lowerQuery.includes('sealed = 1')) {
            const [checksum, bundleId] = params as [string | null, string]
            const bundle = bundlesTable.get(bundleId) as BundleRecord | undefined
            if (bundle) {
              bundle.sealed = 1
              bundle.checksum = checksum
            }
          }
          return { toArray: () => [] }
        }

        // Handle INSERT OR REPLACE INTO bundle_objects
        if (lowerQuery.includes('insert') && lowerQuery.includes('bundle_objects')) {
          const [keyHash, key, bundleId, offset, size, uncompressedSize, type, crc32, deleted, createdAt] = params as [
            string, string, string, number, number, number, string, number, number, number
          ]
          if (!tables.has('bundle_objects')) tables.set('bundle_objects', new Map())
          const objKey = `${keyHash}:${bundleId}`
          tables.get('bundle_objects')!.set(objKey, {
            key_hash: keyHash,
            key,
            bundle_id: bundleId,
            offset,
            size,
            uncompressed_size: uncompressedSize,
            type,
            crc32,
            deleted,
            created_at: createdAt
          })
          return { toArray: () => [] }
        }

        // Handle SELECT from bundle_objects
        if (lowerQuery.includes('select') && lowerQuery.includes('from bundle_objects')) {
          const objectsTable = tables.get('bundle_objects')
          if (!objectsTable) return { toArray: () => [] }

          // Count query
          if (lowerQuery.includes('count(*)')) {
            const objects = Array.from(objectsTable.values()) as BundleObjectRecord[]
            const totalObjects = objects.length
            const deletedObjects = objects.filter(o => o.deleted === 1).length
            return { toArray: () => [{ total_objects: totalObjects, deleted_objects: deletedObjects }] }
          }

          // Lookup by key
          if (lowerQuery.includes('where key =') && lowerQuery.includes('deleted = 0')) {
            const key = params[0] as string
            const objects = Array.from(objectsTable.values()) as BundleObjectRecord[]
            const found = objects
              .filter(o => o.key === key && o.deleted === 0)
              .sort((a, b) => b.created_at - a.created_at)
            return { toArray: () => found.length > 0 ? [found[0]] : [] }
          }

          // Lookup by bundle_id
          if (lowerQuery.includes('where bundle_id =') && lowerQuery.includes('deleted = 0')) {
            const bundleId = params[0] as string
            const objects = Array.from(objectsTable.values()) as BundleObjectRecord[]
            const found = objects
              .filter(o => o.bundle_id === bundleId && o.deleted === 0)
              .sort((a, b) => a.offset - b.offset)
            return { toArray: () => found }
          }
        }

        // Handle UPDATE bundle_objects (mark deleted)
        if (lowerQuery.includes('update bundle_objects') && lowerQuery.includes('deleted = 1')) {
          const objectsTable = tables.get('bundle_objects')
          if (!objectsTable) return { toArray: () => [{ changes: 0 }] }

          const key = params[0] as string
          let changes = 0
          for (const obj of objectsTable.values()) {
            if ((obj as BundleObjectRecord).key === key) {
              (obj as BundleObjectRecord).deleted = 1
              changes++
            }
          }
          return { toArray: () => [{ changes }] }
        }

        // Handle INSERT OR REPLACE INTO active_bundle
        if (lowerQuery.includes('insert') && lowerQuery.includes('active_bundle')) {
          const [id, bundleId, currentOffset, objectCount, bytesWritten, startedAt, updatedAt] = [
            1, params[0], params[1], 0, 0, params[2], params[3]
          ] as [number, string, number, number, number, number, number]

          if (!tables.has('active_bundle')) tables.set('active_bundle', new Map())
          tables.get('active_bundle')!.set(1, {
            id,
            bundle_id: bundleId,
            current_offset: currentOffset,
            object_count: objectCount,
            bytes_written: bytesWritten,
            started_at: startedAt,
            updated_at: updatedAt
          })
          return { toArray: () => [] }
        }

        // Handle SELECT from active_bundle
        if (lowerQuery.includes('select') && lowerQuery.includes('from active_bundle')) {
          const activeTable = tables.get('active_bundle')
          if (!activeTable) return { toArray: () => [] }
          const active = activeTable.get(1)
          return { toArray: () => active ? [active] : [] }
        }

        // Handle UPDATE active_bundle
        if (lowerQuery.includes('update active_bundle')) {
          const activeTable = tables.get('active_bundle')
          if (activeTable) {
            const active = activeTable.get(1) as ActiveBundleRecord | undefined
            if (active) {
              const [currentOffset, bytesWritten, objectCount, updatedAt] = params as [number, number, number, number]
              active.current_offset = currentOffset
              active.bytes_written = bytesWritten
              active.object_count = objectCount
              active.updated_at = updatedAt
            }
          }
          return { toArray: () => [] }
        }

        // Handle DELETE from active_bundle
        if (lowerQuery.includes('delete') && lowerQuery.includes('active_bundle')) {
          const activeTable = tables.get('active_bundle')
          if (activeTable) activeTable.delete(1)
          return { toArray: () => [] }
        }

        return { toArray: () => [] }
      }
    }
  }
}

/**
 * Generate a test bundle ID.
 */
function generateBundleId(seed: number): string {
  return `bundle-test-${seed.toString(16).padStart(8, '0')}`
}

/**
 * Generate a test SHA.
 */
function generateTestSha(seed: number): string {
  const seedHex = seed.toString(16).padStart(8, '0')
  return `abcd1234${seedHex}abcd1234${seedHex}56789ef0`.slice(0, 40)
}

// =============================================================================
// Tests
// =============================================================================

describe('BundleSchemaManager', () => {
  let storage: ReturnType<typeof createMockStorage>
  let manager: BundleSchemaManager

  beforeEach(() => {
    storage = createMockStorage()
    manager = new BundleSchemaManager(storage)
  })

  describe('Schema Version', () => {
    it('should export current schema version', () => {
      expect(BUNDLE_SCHEMA_VERSION).toBe(1)
    })

    it('should return 0 when schema not initialized', async () => {
      const version = await manager.getVersion()
      expect(version).toBe(0)
    })

    it('should return current version after initialization', async () => {
      await manager.ensureSchema()
      const version = await manager.getVersion()
      expect(version).toBe(BUNDLE_SCHEMA_VERSION)
    })
  })

  describe('Schema Initialization', () => {
    it('should create all required tables', async () => {
      await manager.ensureSchema()

      const isValid = await manager.validateSchema()
      expect(isValid).toBe(true)
    })

    it('should be idempotent', async () => {
      const v1 = await manager.ensureSchema()
      const v2 = await manager.ensureSchema()

      expect(v1).toBe(v2)
      expect(v1).toBe(BUNDLE_SCHEMA_VERSION)
    })

    it('should track applied migrations', async () => {
      await manager.ensureSchema()

      const migrations = await manager.getAppliedMigrations()
      expect(migrations.length).toBe(1)
      expect(migrations[0].version).toBe(1)
      expect(migrations[0].description).toContain('Initial bundle schema')
    })
  })

  describe('Schema Validation', () => {
    it('should return false when tables missing', async () => {
      const isValid = await manager.validateSchema()
      expect(isValid).toBe(false)
    })

    it('should return true when all tables exist', async () => {
      await manager.ensureSchema()
      const isValid = await manager.validateSchema()
      expect(isValid).toBe(true)
    })
  })

  describe('Version Checking', () => {
    it('should check if specific version applied', async () => {
      const hasV1Before = await manager.hasVersion(1)
      expect(hasV1Before).toBe(false)

      await manager.ensureSchema()

      const hasV1After = await manager.hasVersion(1)
      expect(hasV1After).toBe(true)

      const hasV2 = await manager.hasVersion(2)
      expect(hasV2).toBe(false)
    })
  })

  describe('Schema Reset', () => {
    it('should drop all tables on reset', async () => {
      await manager.ensureSchema()
      expect(await manager.validateSchema()).toBe(true)

      await manager.resetSchema()
      expect(await manager.validateSchema()).toBe(false)
    })
  })
})

describe('Migrations', () => {
  it('should have migrations for each version up to current', () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(1)

    for (let i = 0; i < MIGRATIONS.length; i++) {
      expect(MIGRATIONS[i].version).toBe(i + 1)
    }
  })

  it('should have descriptions for all migrations', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.description).toBeDefined()
      expect(migration.description.length).toBeGreaterThan(0)
    }
  })

  it('should have up SQL for all migrations', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.up).toBeDefined()
      expect(migration.up.length).toBeGreaterThan(0)
    }
  })
})

describe('Bundle Operations', () => {
  let storage: ReturnType<typeof createMockStorage>

  beforeEach(async () => {
    storage = createMockStorage()
    const manager = new BundleSchemaManager(storage)
    await manager.ensureSchema()
  })

  describe('recordBundle', () => {
    it('should record a new bundle', () => {
      const bundleId = generateBundleId(1)

      recordBundle(storage, {
        id: bundleId,
        r2_key: `bundles/${bundleId}.bundle`,
        entry_count: 10,
        size: 1024,
        data_offset: 64,
        sealed: 0,
        checksum: null
      })

      const bundle = lookupBundle(storage, bundleId)
      expect(bundle).not.toBeNull()
      expect(bundle!.id).toBe(bundleId)
      expect(bundle!.entry_count).toBe(10)
      expect(bundle!.size).toBe(1024)
      expect(bundle!.sealed).toBe(0)
    })

    it('should auto-generate created_at if not provided', () => {
      const bundleId = generateBundleId(2)
      const before = Date.now()

      recordBundle(storage, {
        id: bundleId,
        r2_key: `bundles/${bundleId}.bundle`,
        entry_count: 5,
        size: 512,
        data_offset: 64,
        sealed: 0,
        checksum: null
      })

      const after = Date.now()
      const bundle = lookupBundle(storage, bundleId)
      expect(bundle!.created_at).toBeGreaterThanOrEqual(before)
      expect(bundle!.created_at).toBeLessThanOrEqual(after)
    })
  })

  describe('lookupBundle', () => {
    it('should return null for non-existent bundle', () => {
      const bundle = lookupBundle(storage, 'non-existent')
      expect(bundle).toBeNull()
    })

    it('should return bundle record', () => {
      const bundleId = generateBundleId(3)
      recordBundle(storage, {
        id: bundleId,
        r2_key: `bundles/${bundleId}.bundle`,
        entry_count: 15,
        size: 2048,
        data_offset: 64,
        sealed: 1,
        checksum: 'abc123'
      })

      const bundle = lookupBundle(storage, bundleId)
      expect(bundle).not.toBeNull()
      expect(bundle!.checksum).toBe('abc123')
    })
  })

  describe('sealBundle', () => {
    it('should mark bundle as sealed', () => {
      const bundleId = generateBundleId(4)
      recordBundle(storage, {
        id: bundleId,
        r2_key: `bundles/${bundleId}.bundle`,
        entry_count: 5,
        size: 512,
        data_offset: 64,
        sealed: 0,
        checksum: null
      })

      expect(lookupBundle(storage, bundleId)!.sealed).toBe(0)

      sealBundle(storage, bundleId, 'checksum-xyz')

      const sealed = lookupBundle(storage, bundleId)
      expect(sealed!.sealed).toBe(1)
      expect(sealed!.checksum).toBe('checksum-xyz')
    })
  })

  describe('listBundles', () => {
    it('should list all bundles', () => {
      recordBundle(storage, {
        id: generateBundleId(10),
        r2_key: 'bundles/a.bundle',
        entry_count: 1,
        size: 100,
        data_offset: 64,
        sealed: 1,
        checksum: null
      })

      recordBundle(storage, {
        id: generateBundleId(11),
        r2_key: 'bundles/b.bundle',
        entry_count: 2,
        size: 200,
        data_offset: 64,
        sealed: 0,
        checksum: null
      })

      const bundles = listBundles(storage)
      expect(bundles.length).toBe(2)
    })

    it('should filter sealed bundles', () => {
      recordBundle(storage, {
        id: generateBundleId(20),
        r2_key: 'bundles/sealed.bundle',
        entry_count: 1,
        size: 100,
        data_offset: 64,
        sealed: 1,
        checksum: null
      })

      recordBundle(storage, {
        id: generateBundleId(21),
        r2_key: 'bundles/unsealed.bundle',
        entry_count: 2,
        size: 200,
        data_offset: 64,
        sealed: 0,
        checksum: null
      })

      const sealedBundles = listBundles(storage, { sealedOnly: true })
      expect(sealedBundles.length).toBe(1)
      expect(sealedBundles[0].sealed).toBe(1)
    })
  })
})

describe('Bundle Object Operations', () => {
  let storage: ReturnType<typeof createMockStorage>
  let bundleId: string

  beforeEach(async () => {
    storage = createMockStorage()
    const manager = new BundleSchemaManager(storage)
    await manager.ensureSchema()

    bundleId = generateBundleId(100)
    recordBundle(storage, {
      id: bundleId,
      r2_key: `bundles/${bundleId}.bundle`,
      entry_count: 0,
      size: 64,
      data_offset: 64,
      sealed: 0,
      checksum: null
    })
  })

  describe('recordBundleObject', () => {
    it('should record an object in a bundle', () => {
      const sha = generateTestSha(1)

      recordBundleObject(storage, {
        key_hash: sha,
        key: sha,
        bundle_id: bundleId,
        offset: 64,
        size: 100,
        uncompressed_size: 150,
        type: 'blob',
        crc32: 12345,
        deleted: 0
      })

      const obj = lookupBundleObject(storage, sha)
      expect(obj).not.toBeNull()
      expect(obj!.bundle_id).toBe(bundleId)
      expect(obj!.type).toBe('blob')
    })
  })

  describe('lookupBundleObject', () => {
    it('should return null for non-existent object', () => {
      const obj = lookupBundleObject(storage, 'non-existent')
      expect(obj).toBeNull()
    })

    it('should not return deleted objects', () => {
      const sha = generateTestSha(2)

      recordBundleObject(storage, {
        key_hash: sha,
        key: sha,
        bundle_id: bundleId,
        offset: 64,
        size: 100,
        uncompressed_size: 150,
        type: 'tree',
        crc32: 12345,
        deleted: 1
      })

      const obj = lookupBundleObject(storage, sha)
      expect(obj).toBeNull()
    })
  })

  describe('getBundleObjects', () => {
    it('should return all non-deleted objects in bundle', () => {
      const sha1 = generateTestSha(10)
      const sha2 = generateTestSha(11)
      const sha3 = generateTestSha(12)

      recordBundleObject(storage, {
        key_hash: sha1,
        key: sha1,
        bundle_id: bundleId,
        offset: 64,
        size: 100,
        uncompressed_size: 150,
        type: 'blob',
        crc32: 111,
        deleted: 0
      })

      recordBundleObject(storage, {
        key_hash: sha2,
        key: sha2,
        bundle_id: bundleId,
        offset: 164,
        size: 200,
        uncompressed_size: 250,
        type: 'tree',
        crc32: 222,
        deleted: 0
      })

      // Deleted object should not be included
      recordBundleObject(storage, {
        key_hash: sha3,
        key: sha3,
        bundle_id: bundleId,
        offset: 364,
        size: 50,
        uncompressed_size: 75,
        type: 'commit',
        crc32: 333,
        deleted: 1
      })

      const objects = getBundleObjects(storage, bundleId)
      expect(objects.length).toBe(2)
      expect(objects[0].offset).toBeLessThan(objects[1].offset) // Sorted by offset
    })
  })

  describe('markObjectDeleted', () => {
    it('should soft delete an object', () => {
      const sha = generateTestSha(20)

      recordBundleObject(storage, {
        key_hash: sha,
        key: sha,
        bundle_id: bundleId,
        offset: 64,
        size: 100,
        uncompressed_size: 150,
        type: 'blob',
        crc32: 12345,
        deleted: 0
      })

      expect(lookupBundleObject(storage, sha)).not.toBeNull()

      const changes = markObjectDeleted(storage, sha)
      expect(changes).toBe(1)

      expect(lookupBundleObject(storage, sha)).toBeNull()
    })

    it('should return 0 for non-existent object', () => {
      const changes = markObjectDeleted(storage, 'non-existent')
      expect(changes).toBe(0)
    })
  })
})

describe('Active Bundle Operations', () => {
  let storage: ReturnType<typeof createMockStorage>
  let bundleId: string

  beforeEach(async () => {
    storage = createMockStorage()
    const manager = new BundleSchemaManager(storage)
    await manager.ensureSchema()

    bundleId = generateBundleId(200)
    recordBundle(storage, {
      id: bundleId,
      r2_key: `bundles/${bundleId}.bundle`,
      entry_count: 0,
      size: 64,
      data_offset: 64,
      sealed: 0,
      checksum: null
    })
  })

  describe('setActiveBundle', () => {
    it('should set the active bundle', () => {
      setActiveBundle(storage, bundleId, 64)

      const active = getActiveBundle(storage)
      expect(active).not.toBeNull()
      expect(active!.bundle_id).toBe(bundleId)
      expect(active!.current_offset).toBe(64)
      expect(active!.object_count).toBe(0)
    })
  })

  describe('getActiveBundle', () => {
    it('should return null when no active bundle', () => {
      const active = getActiveBundle(storage)
      expect(active).toBeNull()
    })
  })

  describe('updateActiveBundle', () => {
    it('should update active bundle progress', () => {
      setActiveBundle(storage, bundleId, 64)

      updateActiveBundle(storage, 164, 100, 5)

      const active = getActiveBundle(storage)
      expect(active!.current_offset).toBe(164)
      expect(active!.bytes_written).toBe(100)
      expect(active!.object_count).toBe(5)
    })
  })

  describe('clearActiveBundle', () => {
    it('should remove active bundle', () => {
      setActiveBundle(storage, bundleId, 64)
      expect(getActiveBundle(storage)).not.toBeNull()

      clearActiveBundle(storage)
      expect(getActiveBundle(storage)).toBeNull()
    })
  })
})

describe('Bundle Statistics', () => {
  let storage: ReturnType<typeof createMockStorage>

  beforeEach(async () => {
    storage = createMockStorage()
    const manager = new BundleSchemaManager(storage)
    await manager.ensureSchema()
  })

  it('should return zeros for empty database', () => {
    const stats = getBundleStats(storage)

    expect(stats.totalBundles).toBe(0)
    expect(stats.sealedBundles).toBe(0)
    expect(stats.totalObjects).toBe(0)
    expect(stats.totalSize).toBe(0)
    expect(stats.deletedObjects).toBe(0)
  })

  it('should count bundles and objects', () => {
    // Create bundles
    const bundle1 = generateBundleId(300)
    const bundle2 = generateBundleId(301)

    recordBundle(storage, {
      id: bundle1,
      r2_key: `bundles/${bundle1}.bundle`,
      entry_count: 5,
      size: 1000,
      data_offset: 64,
      sealed: 1,
      checksum: null
    })

    recordBundle(storage, {
      id: bundle2,
      r2_key: `bundles/${bundle2}.bundle`,
      entry_count: 3,
      size: 500,
      data_offset: 64,
      sealed: 0,
      checksum: null
    })

    // Create objects
    recordBundleObject(storage, {
      key_hash: generateTestSha(1),
      key: generateTestSha(1),
      bundle_id: bundle1,
      offset: 64,
      size: 100,
      uncompressed_size: 150,
      type: 'blob',
      crc32: 111,
      deleted: 0
    })

    recordBundleObject(storage, {
      key_hash: generateTestSha(2),
      key: generateTestSha(2),
      bundle_id: bundle1,
      offset: 164,
      size: 200,
      uncompressed_size: 250,
      type: 'tree',
      crc32: 222,
      deleted: 1 // Deleted
    })

    const stats = getBundleStats(storage)

    expect(stats.totalBundles).toBe(2)
    expect(stats.sealedBundles).toBe(1)
    expect(stats.totalSize).toBe(1500) // 1000 + 500
    expect(stats.totalObjects).toBe(2)
    expect(stats.deletedObjects).toBe(1)
  })
})

describe('Schema SQL', () => {
  it('should contain all table definitions', () => {
    expect(BUNDLE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS bundles')
    expect(BUNDLE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS bundle_objects')
    expect(BUNDLE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS active_bundle')
    expect(BUNDLE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS schema_migrations')
  })

  it('should contain all indexes', () => {
    expect(BUNDLE_SCHEMA_SQL).toContain('idx_bundle_objects_key')
    expect(BUNDLE_SCHEMA_SQL).toContain('idx_bundle_objects_bundle')
    expect(BUNDLE_SCHEMA_SQL).toContain('idx_bundle_objects_deleted')
    expect(BUNDLE_SCHEMA_SQL).toContain('idx_bundles_sealed')
  })
})
