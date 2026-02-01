import { describe, it, expect, beforeEach } from 'vitest'
import { ParquetRefStore } from '../../src/storage/parquet-ref-store'
import type { DurableObjectStorage } from '../../src/do/schema'

/**
 * In-memory SQLite mock that actually stores rows.
 */
class MockSQL implements DurableObjectStorage {
  private tables = new Map<string, Map<string, Record<string, unknown>>>()

  sql = {
    exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
      // CREATE TABLE
      if (query.toUpperCase().startsWith('CREATE TABLE')) {
        const match = query.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)
        if (match && !this.tables.has(match[1])) {
          this.tables.set(match[1], new Map())
        }
        return { toArray: () => [] }
      }

      // INSERT OR REPLACE INTO refs
      if (query.toUpperCase().includes('INSERT OR REPLACE INTO REFS')) {
        const table = this.tables.get('refs') ?? new Map()
        this.tables.set('refs', table)
        const [name, target, type, updated_at] = params as [string, string, string, number]
        table.set(name, { name, target, type, updated_at })
        return { toArray: () => [] }
      }

      // DELETE FROM refs WHERE name = ?
      if (query.toUpperCase().includes('DELETE FROM REFS WHERE NAME =')) {
        const table = this.tables.get('refs')
        if (table) table.delete(params[0] as string)
        return { toArray: () => [] }
      }

      // SELECT ... FROM refs WHERE name = ?
      if (query.toUpperCase().includes('SELECT') && query.toUpperCase().includes('FROM REFS WHERE NAME =')) {
        const table = this.tables.get('refs')
        if (!table) return { toArray: () => [] }
        const name = params[0] as string
        const row = table.get(name)
        return { toArray: () => row ? [row] : [] }
      }

      // SELECT ... FROM refs WHERE name LIKE ?
      if (query.toUpperCase().includes('FROM REFS WHERE NAME LIKE')) {
        const table = this.tables.get('refs')
        if (!table) return { toArray: () => [] }
        const prefix = (params[0] as string).replace('%', '')
        const rows = Array.from(table.values()).filter(r =>
          (r.name as string).startsWith(prefix)
        )
        return { toArray: () => rows }
      }

      // SELECT ... FROM refs (list all)
      if (query.toUpperCase().includes('SELECT') && query.toUpperCase().includes('FROM REFS') && !query.toUpperCase().includes('WHERE')) {
        const table = this.tables.get('refs')
        if (!table) return { toArray: () => [] }
        return { toArray: () => Array.from(table.values()) }
      }

      return { toArray: () => [] }
    }
  }
}

/**
 * Mock R2 bucket that records puts.
 */
class MockR2 {
  puts: Map<string, string> = new Map()

  async put(key: string, data: string | ArrayBuffer | ReadableStream): Promise<unknown> {
    this.puts.set(key, typeof data === 'string' ? data : '[binary]')
    return {}
  }

  async get(_key: string) { return null }
  async list(_opts?: unknown) { return { objects: [] } }
}

describe('ParquetRefStore', () => {
  let sql: MockSQL
  let r2: MockR2
  let store: ParquetRefStore

  beforeEach(() => {
    sql = new MockSQL()
    r2 = new MockR2()
    store = new ParquetRefStore({
      r2: r2 as unknown as R2Bucket,
      sql,
      prefix: 'owner/repo',
    })
    store.ensureTable()
  })

  describe('getRef / setRef', () => {
    it('should return null for non-existent ref', () => {
      expect(store.getRef('refs/heads/main')).toBeNull()
    })

    it('should store and retrieve a direct ref', () => {
      store.setRef('refs/heads/main', 'abc123')

      const ref = store.getRef('refs/heads/main')
      expect(ref).not.toBeNull()
      expect(ref!.name).toBe('refs/heads/main')
      expect(ref!.target).toBe('abc123')
      expect(ref!.type).toBe('direct')
    })

    it('should store and retrieve a symbolic ref', () => {
      store.setRef('HEAD', 'refs/heads/main', 'symbolic')

      const ref = store.getRef('HEAD')
      expect(ref).not.toBeNull()
      expect(ref!.name).toBe('HEAD')
      expect(ref!.target).toBe('refs/heads/main')
      expect(ref!.type).toBe('symbolic')
    })

    it('should update an existing ref', () => {
      store.setRef('refs/heads/main', 'abc123')
      store.setRef('refs/heads/main', 'def456')

      const ref = store.getRef('refs/heads/main')
      expect(ref!.target).toBe('def456')
    })
  })

  describe('deleteRef', () => {
    it('should return false for non-existent ref', () => {
      expect(store.deleteRef('refs/heads/nope')).toBe(false)
    })

    it('should delete an existing ref', () => {
      store.setRef('refs/heads/main', 'abc123')
      expect(store.deleteRef('refs/heads/main')).toBe(true)
      expect(store.getRef('refs/heads/main')).toBeNull()
    })
  })

  describe('listRefs', () => {
    it('should return empty array when no refs', () => {
      expect(store.listRefs()).toEqual([])
    })

    it('should list all refs', () => {
      store.setRef('refs/heads/main', 'abc123')
      store.setRef('refs/heads/feature', 'def456')
      store.setRef('refs/tags/v1.0', 'ghi789')

      const refs = store.listRefs()
      expect(refs).toHaveLength(3)
    })

    it('should filter refs by prefix', () => {
      store.setRef('refs/heads/main', 'abc123')
      store.setRef('refs/heads/feature', 'def456')
      store.setRef('refs/tags/v1.0', 'ghi789')

      const branches = store.listRefs('refs/heads/')
      expect(branches).toHaveLength(2)
      expect(branches.every(r => r.name.startsWith('refs/heads/'))).toBe(true)

      const tags = store.listRefs('refs/tags/')
      expect(tags).toHaveLength(1)
    })
  })

  describe('syncToR2', () => {
    it('should not sync when not dirty', async () => {
      expect(await store.syncToR2()).toBe(false)
      expect(r2.puts.size).toBe(0)
    })

    it('should sync refs as NDJSON to R2', async () => {
      store.setRef('refs/heads/main', 'abc123')
      store.setRef('HEAD', 'refs/heads/main', 'symbolic')

      expect(store.isDirty()).toBe(true)
      expect(await store.syncToR2()).toBe(true)
      expect(store.isDirty()).toBe(false)

      const key = 'owner/repo/refs.ndjson'
      expect(r2.puts.has(key)).toBe(true)

      const content = r2.puts.get(key)!
      const lines = content.split('\n')
      expect(lines).toHaveLength(2)

      const parsed = lines.map(l => JSON.parse(l))
      const mainRef = parsed.find((r: any) => r.name === 'refs/heads/main')
      expect(mainRef).toBeDefined()
      expect(mainRef.target).toBe('abc123')
      expect(mainRef.type).toBe('direct')

      const headRef = parsed.find((r: any) => r.name === 'HEAD')
      expect(headRef).toBeDefined()
      expect(headRef.target).toBe('refs/heads/main')
      expect(headRef.type).toBe('symbolic')
    })

    it('should not re-sync when already clean', async () => {
      store.setRef('refs/heads/main', 'abc123')
      await store.syncToR2()
      r2.puts.clear()

      expect(await store.syncToR2()).toBe(false)
      expect(r2.puts.size).toBe(0)
    })

    it('should sync again after new mutation', async () => {
      store.setRef('refs/heads/main', 'abc123')
      await store.syncToR2()

      store.setRef('refs/heads/main', 'def456')
      expect(store.isDirty()).toBe(true)
      expect(await store.syncToR2()).toBe(true)
    })
  })

  describe('getR2Key', () => {
    it('should return correct R2 key', () => {
      expect(store.getR2Key()).toBe('owner/repo/refs.ndjson')
    })
  })

  describe('SQLite remains authoritative', () => {
    it('reads always come from SQLite, not R2', () => {
      store.setRef('refs/heads/main', 'abc123')

      // Even without syncing to R2, reads work
      const ref = store.getRef('refs/heads/main')
      expect(ref!.target).toBe('abc123')
    })

    it('delete marks dirty for R2 sync', () => {
      store.setRef('refs/heads/main', 'abc123')
      store.deleteRef('refs/heads/main')
      expect(store.isDirty()).toBe(true)
    })
  })
})
