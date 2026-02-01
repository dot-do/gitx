import { describe, it, expect, beforeEach } from 'vitest'
import {
  ThinSchemaManager,
  DurableObjectStorage,
  THIN_SCHEMA_SQL,
  SCHEMA_VERSION,
  LEGACY_TABLES,
} from '../../src/do/schema'

/**
 * Mock DurableObjectStorage for testing thin schema operations
 */
class MockDurableObjectStorage implements DurableObjectStorage {
  private tables: Map<string, { columns: string[]; rows: unknown[][] }> = new Map()
  private indexes: Set<string> = new Set()

  sql = {
    exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
      // Parse CREATE TABLE statements
      const tableRegex = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(/gi
      let match
      while ((match = tableRegex.exec(query)) !== null) {
        const tableName = match[1]
        const startIdx = match.index + match[0].length
        let depth = 1
        let endIdx = startIdx
        while (endIdx < query.length && depth > 0) {
          if (query[endIdx] === '(') depth++
          else if (query[endIdx] === ')') depth--
          endIdx++
        }
        const columnsStr = query.slice(startIdx, endIdx - 1)
        const columns = columnsStr
          .split(',')
          .map(col => col.trim().split(/\s+/)[0])
          .filter(col =>
            col &&
            !col.toUpperCase().startsWith('PRIMARY') &&
            !col.toUpperCase().startsWith('FOREIGN') &&
            !col.toUpperCase().startsWith('UNIQUE') &&
            !col.toUpperCase().startsWith('CHECK') &&
            !col.toUpperCase().startsWith('CONSTRAINT')
          )
        this.tables.set(tableName, { columns, rows: [] })
      }

      // Parse CREATE INDEX statements
      const createIndexMatch = query.match(/CREATE INDEX IF NOT EXISTS (\w+)/gi)
      if (createIndexMatch) {
        for (const m of createIndexMatch) {
          const indexMatch = m.match(/CREATE INDEX IF NOT EXISTS (\w+)/i)
          if (indexMatch) this.indexes.add(indexMatch[1])
        }
      }

      // Handle sqlite_master queries
      if (query.includes('sqlite_master') && query.includes("type='table'")) {
        const tableNames = Array.from(this.tables.keys())
        return { toArray: () => tableNames.map(name => ({ name })) }
      }

      return { toArray: () => [] }
    }
  }

  getTables(): string[] {
    return Array.from(this.tables.keys())
  }

  getTableColumns(tableName: string): string[] | undefined {
    return this.tables.get(tableName)?.columns
  }

  getIndexes(): string[] {
    return Array.from(this.indexes)
  }

  hasTable(tableName: string): boolean {
    return this.tables.has(tableName)
  }

  removeTable(tableName: string): void {
    this.tables.delete(tableName)
  }
}

describe('ThinSchemaManager', () => {
  let storage: MockDurableObjectStorage
  let schemaManager: ThinSchemaManager

  beforeEach(() => {
    storage = new MockDurableObjectStorage()
    schemaManager = new ThinSchemaManager(storage)
  })

  describe('initializeSchema', () => {
    it('should create only refs, bloom_filter, and sha_cache tables', async () => {
      await schemaManager.initializeSchema()

      const tables = storage.getTables()
      expect(tables).toContain('refs')
      expect(tables).toContain('bloom_filter')
      expect(tables).toContain('sha_cache')
    })

    it('should NOT create legacy object storage tables', async () => {
      await schemaManager.initializeSchema()

      const tables = storage.getTables()
      expect(tables).not.toContain('objects')
      expect(tables).not.toContain('object_index')
      expect(tables).not.toContain('hot_objects')
      expect(tables).not.toContain('wal')
      expect(tables).not.toContain('git')
      expect(tables).not.toContain('git_branches')
      expect(tables).not.toContain('git_content')
      expect(tables).not.toContain('exec')
    })

    it('should create refs table with name->target columns', async () => {
      await schemaManager.initializeSchema()

      const columns = storage.getTableColumns('refs')
      expect(columns).toContain('name')
      expect(columns).toContain('target')
      expect(columns).toContain('type')
      expect(columns).toContain('updated_at')
    })

    it('should create bloom_filter table with filter_data blob', async () => {
      await schemaManager.initializeSchema()

      const columns = storage.getTableColumns('bloom_filter')
      expect(columns).toContain('id')
      expect(columns).toContain('filter_data')
      expect(columns).toContain('item_count')
      expect(columns).toContain('updated_at')
    })

    it('should create sha_cache table', async () => {
      await schemaManager.initializeSchema()

      const columns = storage.getTableColumns('sha_cache')
      expect(columns).toContain('sha')
      expect(columns).toContain('type')
      expect(columns).toContain('size')
      expect(columns).toContain('added_at')
    })

    it('should create sha_cache index', async () => {
      await schemaManager.initializeSchema()

      const indexes = storage.getIndexes()
      expect(indexes).toContain('idx_sha_cache_added')
    })

    it('should be idempotent', async () => {
      await schemaManager.initializeSchema()
      await expect(schemaManager.initializeSchema()).resolves.not.toThrow()
    })
  })

  describe('validateSchema', () => {
    it('should return true when all thin tables exist', async () => {
      await schemaManager.initializeSchema()
      expect(await schemaManager.validateSchema()).toBe(true)
    })

    it('should return false when refs is missing', async () => {
      await schemaManager.initializeSchema()
      storage.removeTable('refs')
      expect(await schemaManager.validateSchema()).toBe(false)
    })

    it('should return false when bloom_filter is missing', async () => {
      await schemaManager.initializeSchema()
      storage.removeTable('bloom_filter')
      expect(await schemaManager.validateSchema()).toBe(false)
    })

    it('should return false when sha_cache is missing', async () => {
      await schemaManager.initializeSchema()
      storage.removeTable('sha_cache')
      expect(await schemaManager.validateSchema()).toBe(false)
    })

    it('should return false on empty storage', async () => {
      expect(await schemaManager.validateSchema()).toBe(false)
    })
  })

  describe('getSchemaVersion', () => {
    it('should return 2 for thin schema', async () => {
      await schemaManager.initializeSchema()
      expect(await schemaManager.getSchemaVersion()).toBe(SCHEMA_VERSION)
    })

    it('should return 1 for legacy schema', async () => {
      await schemaManager.initializeLegacySchema()
      expect(await schemaManager.getSchemaVersion()).toBe(1)
    })

    it('should return 0 for empty storage', async () => {
      expect(await schemaManager.getSchemaVersion()).toBe(0)
    })
  })

  describe('hasLegacyTables', () => {
    it('should return false for thin-only schema', async () => {
      await schemaManager.initializeSchema()
      expect(await schemaManager.hasLegacyTables()).toBe(false)
    })

    it('should return true when legacy tables exist', async () => {
      await schemaManager.initializeLegacySchema()
      expect(await schemaManager.hasLegacyTables()).toBe(true)
    })
  })

  describe('THIN_SCHEMA_SQL constant', () => {
    it('should contain only refs, bloom_filter, and sha_cache tables', () => {
      expect(THIN_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS refs')
      expect(THIN_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS bloom_filter')
      expect(THIN_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS sha_cache')
      expect(THIN_SCHEMA_SQL).not.toContain('CREATE TABLE IF NOT EXISTS objects')
      expect(THIN_SCHEMA_SQL).not.toContain('CREATE TABLE IF NOT EXISTS wal')
    })
  })

  describe('LEGACY_TABLES constant', () => {
    it('should list all legacy tables', () => {
      expect(LEGACY_TABLES).toContain('objects')
      expect(LEGACY_TABLES).toContain('object_index')
      expect(LEGACY_TABLES).toContain('hot_objects')
      expect(LEGACY_TABLES).toContain('wal')
    })
  })

  // ==========================================================================
  // Schema Migration v1 → v2 Tests
  // ==========================================================================

  describe('schema migration v1 → v2', () => {
    it('should detect legacy schema (v1) when full tables exist', async () => {
      // Initialize legacy (v1) schema with all tables
      await schemaManager.initializeLegacySchema()

      // Legacy schema includes objects, object_index, etc. but also refs
      // hasLegacyTables checks for any of the LEGACY_TABLES
      expect(await schemaManager.hasLegacyTables()).toBe(true)

      // getSchemaVersion returns 1 because legacy tables are present
      // but thin tables (bloom_filter, sha_cache) are NOT present
      const version = await schemaManager.getSchemaVersion()
      expect(version).toBe(1)
    })

    it('should detect thin schema (v2) when only refs + bloom_filter + sha_cache exist', async () => {
      // Initialize only thin schema (v2)
      await schemaManager.initializeSchema()

      const tables = storage.getTables()
      expect(tables).toContain('refs')
      expect(tables).toContain('bloom_filter')
      expect(tables).toContain('sha_cache')

      // No legacy tables should exist
      expect(tables).not.toContain('objects')
      expect(tables).not.toContain('object_index')
      expect(tables).not.toContain('hot_objects')
      expect(tables).not.toContain('wal')

      const version = await schemaManager.getSchemaVersion()
      expect(version).toBe(2)
    })

    it('should return correct version for each schema state', async () => {
      // Empty DB → version 0
      expect(await schemaManager.getSchemaVersion()).toBe(0)

      // After legacy init → version 1
      await schemaManager.initializeLegacySchema()
      expect(await schemaManager.getSchemaVersion()).toBe(1)

      // Create a fresh storage + manager for thin-only test
      const thinStorage = new MockDurableObjectStorage()
      const thinManager = new ThinSchemaManager(thinStorage)

      await thinManager.initializeSchema()
      expect(await thinManager.getSchemaVersion()).toBe(2)
    })

    it('should initializeSchema on empty DB and create v2 schema', async () => {
      // Verify DB is empty
      expect(storage.getTables()).toHaveLength(0)
      expect(await schemaManager.getSchemaVersion()).toBe(0)

      // Initialize thin schema
      await schemaManager.initializeSchema()

      // Should now have exactly the v2 tables
      const tables = storage.getTables()
      expect(tables).toContain('refs')
      expect(tables).toContain('bloom_filter')
      expect(tables).toContain('sha_cache')
      expect(tables).toContain('compaction_journal')
      expect(tables).toContain('compaction_retries')
      expect(tables).toHaveLength(5)

      // Version should be 2
      expect(await schemaManager.getSchemaVersion()).toBe(SCHEMA_VERSION)
      expect(await schemaManager.getSchemaVersion()).toBe(2)
    })

    it('should report hasLegacyTables false after thin-only init', async () => {
      await schemaManager.initializeSchema()
      expect(await schemaManager.hasLegacyTables()).toBe(false)
    })

    it('should report hasLegacyTables true when legacy and thin coexist', async () => {
      // Simulate a migration scenario: legacy schema exists, then thin schema added
      await schemaManager.initializeLegacySchema()
      await schemaManager.initializeSchema()

      // Both legacy and thin tables exist
      expect(await schemaManager.hasLegacyTables()).toBe(true)
      // validateSchema should pass because thin tables exist
      expect(await schemaManager.validateSchema()).toBe(true)
      // Version should be 2 since thin tables are present
      expect(await schemaManager.getSchemaVersion()).toBe(2)
    })
  })
})
