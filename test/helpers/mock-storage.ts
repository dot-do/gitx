/**
 * @fileoverview Shared mock implementations for GitX test infrastructure.
 *
 * Provides reusable mock factories for DurableObjectStorage, R2Bucket, and
 * SQLStorage (the `sql` property) so that individual test files do not need
 * to duplicate these patterns.
 *
 * Based on the most complete implementations found in:
 * - test/storage/parquet-wiring.test.ts
 * - test/storage/parquet-store.test.ts
 * - test/do/object-store.test.ts
 * - test/wire/security-fixes.test.ts
 *
 * @module test/helpers/mock-storage
 */

import { vi } from 'vitest'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Row shape stored in the mock `refs` table. */
export interface MockRefRow {
  name: string
  target: string
  type: string
  created_at: number
  updated_at: number
}

/** Row shape stored in the mock `objects` table. */
export interface MockObjectRow {
  sha: string
  type: string
  size: number
  data: Uint8Array
  created_at: number
}

/** Row shape stored in the mock `object_index` table. */
export interface MockObjectIndexRow {
  sha: string
  tier: string
  pack_id: string | null
  offset: number | null
  size: number
  type: string
  updated_at: number
}

/** Row shape stored in the mock `wal` table (legacy WAL). */
export interface MockWalRow {
  id: number
  operation: string
  payload: Uint8Array
  flushed: boolean
}

/** Row shape stored in the mock `write_buffer_wal` table. */
export interface MockWriteBufferWalRow {
  id: number
  sha: string
  type: string
  data: Uint8Array
  path: string | null
  created_at: number
}

/** Internal table state exposed via `_tables` for test assertions. */
export interface MockTables {
  refs: Map<string, MockRefRow>
  objects: Map<string, MockObjectRow>
  object_index: Map<string, MockObjectIndexRow>
  wal: MockWalRow[]
  write_buffer_wal: MockWriteBufferWalRow[]
}

/** Return type of {@link createMockSqlStorage}. */
export interface MockSqlStorage {
  exec: ReturnType<typeof vi.fn>
}

/** Extended DurableObjectStorage mock with test-only accessors. */
export interface MockDurableObjectStorage {
  sql: MockSqlStorage
  /**
   * Provides direct access to the in-memory table state so tests can
   * inspect or pre-populate data without going through SQL.
   */
  _tables: MockTables
}

/** Extended R2Bucket mock with access to the backing Map. */
export interface MockR2Bucket extends R2Bucket {
  /**
   * The underlying Map that backs all put/get operations.
   * Useful for test assertions about stored data.
   */
  _store: Map<string, ArrayBuffer>
}

// ---------------------------------------------------------------------------
// createMockDurableObjectStorage
// ---------------------------------------------------------------------------

/**
 * Creates a mock `DurableObjectStorage` with a `sql.exec` implementation that
 * understands the common query patterns used by GitX's SQLite-backed stores.
 *
 * Tracked tables:
 * - `refs` — branch/tag references (name -> target SHA)
 * - `objects` — raw git objects (sha -> type + data)
 * - `object_index` — tiered storage index (sha -> tier + location)
 * - `wal` — legacy write-ahead log entries
 * - `write_buffer_wal` — ParquetStore write-buffer WAL entries
 *
 * The returned object exposes a `_tables` property for direct access to the
 * in-memory state during tests.
 *
 * @example
 * ```ts
 * const storage = createMockDurableObjectStorage()
 * const provider = new DORepositoryProvider(storage as any)
 * // inspect internal state:
 * expect(storage._tables.refs.size).toBe(0)
 * ```
 */
export function createMockDurableObjectStorage(): MockDurableObjectStorage {
  const tables: MockTables = {
    refs: new Map(),
    objects: new Map(),
    object_index: new Map(),
    wal: [],
    write_buffer_wal: [],
  }
  let nextWalId = 1
  let nextWriteBufferWalId = 1

  const exec = vi.fn((query: string, ...params: unknown[]) => {
    // ----- Schema creation (no-op) -----
    if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) {
      return { toArray: () => [] }
    }

    // =====================================================================
    // refs
    // =====================================================================

    if (query.includes('SELECT name, target FROM refs')) {
      const rows = Array.from(tables.refs.values())
      return { toArray: () => rows }
    }

    if (query.includes('INSERT OR REPLACE INTO refs')) {
      const [name, target, type, created_at, updated_at] = params as [string, string, string, number, number]
      tables.refs.set(name, { name, target, type, created_at, updated_at })
      return { toArray: () => [] }
    }

    // =====================================================================
    // objects
    // =====================================================================

    // COUNT
    if (query.includes('SELECT COUNT') && query.includes('FROM objects') && query.includes('WHERE sha = ?')) {
      const sha = params[0] as string
      return { toArray: () => [{ count: tables.objects.has(sha) ? 1 : 0 }] }
    }

    // INSERT
    if (query.includes('INSERT') && query.includes('INTO objects') && !query.includes('object_index')) {
      const [sha, type, size, data, created_at] = params as [string, string, number, Uint8Array, number]
      tables.objects.set(sha, { sha, type, size, data, created_at })
      return { toArray: () => [] }
    }

    // SELECT by sha
    if (query.includes('SELECT') && query.includes('FROM objects') && query.includes('WHERE sha = ?')) {
      const sha = params[0] as string
      const obj = tables.objects.get(sha)
      return { toArray: () => (obj ? [obj] : []) }
    }

    // SELECT by IN clause (batch getObjects)
    if (query.includes('SELECT') && query.includes('FROM objects') && query.includes('WHERE sha IN')) {
      const shas = params as string[]
      const rows = shas.map(sha => tables.objects.get(sha)).filter(Boolean)
      return { toArray: () => rows }
    }

    // DELETE
    if (query.includes('DELETE FROM objects') && query.includes('WHERE sha = ?')) {
      const sha = params[0] as string
      tables.objects.delete(sha)
      return { toArray: () => [] }
    }

    // =====================================================================
    // object_index
    // =====================================================================

    if (query.includes('INSERT') && query.includes('INTO object_index')) {
      const [sha, tier, pack_id, offset, size, type, updated_at] = params as [string, string, string | null, number | null, number, string, number]
      tables.object_index.set(sha, { sha, tier, pack_id, offset, size, type, updated_at })
      return { toArray: () => [] }
    }

    if (query.includes('SELECT') && query.includes('FROM object_index') && query.includes('WHERE sha = ?')) {
      const sha = params[0] as string
      const idx = tables.object_index.get(sha)
      return { toArray: () => (idx ? [idx] : []) }
    }

    if (query.includes('DELETE FROM object_index') && query.includes('WHERE sha = ?')) {
      const sha = params[0] as string
      tables.object_index.delete(sha)
      return { toArray: () => [] }
    }

    // =====================================================================
    // wal (legacy)
    // =====================================================================

    if (query.includes('INSERT INTO wal')) {
      const id = nextWalId++
      tables.wal.push({
        id,
        operation: params[0] as string,
        payload: params[1] as Uint8Array,
        flushed: false,
      })
      return { toArray: () => [{ id }] }
    }

    if (query.includes('UPDATE wal') && query.includes('flushed = 1')) {
      for (const entry of tables.wal) {
        entry.flushed = true
      }
      return { toArray: () => [] }
    }

    if (query.includes('SELECT COUNT') && query.includes('FROM wal')) {
      const count = tables.wal.filter(e => !e.flushed).length
      return { toArray: () => [{ count }] }
    }

    // =====================================================================
    // write_buffer_wal
    // =====================================================================

    if (query.includes('INSERT INTO write_buffer_wal')) {
      const id = nextWriteBufferWalId++
      const [sha, type, data, path, created_at] = params as [string, string, Uint8Array, string | null, number]
      tables.write_buffer_wal.push({ id, sha, type, data, path, created_at })
      return { toArray: () => [] }
    }

    // SELECT by sha + created_at (get ID after insert)
    if (query.includes('SELECT id FROM write_buffer_wal WHERE sha')) {
      const sha = params[0] as string
      const created_at = params[1] as number
      const entry = tables.write_buffer_wal.find(e => e.sha === sha && e.created_at === created_at)
      return { toArray: () => (entry ? [{ id: entry.id }] : []) }
    }

    // SELECT ALL for recovery
    if (query.includes('SELECT id, sha, type, data, path, created_at FROM write_buffer_wal')) {
      return { toArray: () => [...tables.write_buffer_wal] }
    }

    // DELETE by ID list (IN clause)
    if (query.includes('DELETE FROM write_buffer_wal WHERE id IN')) {
      const ids = params as number[]
      tables.write_buffer_wal = tables.write_buffer_wal.filter(e => !ids.includes(e.id))
      return { toArray: () => [] }
    }

    // DELETE by SHA
    if (query.includes('DELETE FROM write_buffer_wal WHERE sha')) {
      const sha = params[0] as string
      tables.write_buffer_wal = tables.write_buffer_wal.filter(e => e.sha !== sha)
      return { toArray: () => [] }
    }

    // DELETE by single ID
    if (query.includes('DELETE FROM write_buffer_wal WHERE id = ?')) {
      const id = params[0] as number
      tables.write_buffer_wal = tables.write_buffer_wal.filter(e => e.id !== id)
      return { toArray: () => [] }
    }

    // =====================================================================
    // Transaction control
    // =====================================================================

    if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
      return { toArray: () => [] }
    }

    // =====================================================================
    // Default: return empty results
    // =====================================================================
    return { toArray: () => [] }
  })

  return {
    sql: { exec },
    _tables: tables,
  }
}

// ---------------------------------------------------------------------------
// createMockR2Bucket
// ---------------------------------------------------------------------------

/**
 * Creates a mock `R2Bucket` backed by an in-memory `Map<string, ArrayBuffer>`.
 *
 * Supports:
 * - `put` — stores `ArrayBuffer`, `Uint8Array`, or `string` values
 * - `get` — returns a mock `R2ObjectBody` with `arrayBuffer()` support
 * - `list` — returns empty results by default (override via `vi.fn` if needed)
 * - `delete` — removes from the backing map
 * - `head` — returns null by default
 * - `createMultipartUpload` / `resumeMultipartUpload` — no-op stubs
 *
 * The returned object exposes a `_store` property for direct access to the
 * backing Map during tests.
 *
 * @example
 * ```ts
 * const r2 = createMockR2Bucket()
 * await r2.put('key', new Uint8Array([1, 2, 3]))
 * const obj = await r2.get('key')
 * const buf = await obj!.arrayBuffer()
 * ```
 */
export function createMockR2Bucket(): MockR2Bucket {
  const store = new Map<string, ArrayBuffer>()

  const bucket = {
    _store: store,

    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string) => {
      if (value instanceof Uint8Array) {
        store.set(key, value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
      } else if (value instanceof ArrayBuffer) {
        store.set(key, value)
      } else if (typeof value === 'string') {
        const encoded = new TextEncoder().encode(value)
        store.set(key, encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength))
      }
      return {} as R2Object
    }),

    get: vi.fn(async (key: string) => {
      const data = store.get(key)
      if (!data) return null
      return {
        arrayBuffer: async () => data,
        body: new ReadableStream(),
        bodyUsed: false,
        key,
        version: '1',
        size: data.byteLength,
        etag: 'test',
        httpEtag: '"test"',
        checksums: {},
        uploaded: new Date(),
        httpMetadata: {},
        customMetadata: {},
        writeHttpMetadata: vi.fn(),
        storageClass: 'Standard' as const,
        range: undefined,
        blob: vi.fn(),
        text: vi.fn(),
        json: vi.fn(),
      } as unknown as R2ObjectBody
    }),

    list: vi.fn(async () => ({
      objects: [] as R2Object[],
      truncated: false,
      cursor: undefined,
      delimitedPrefixes: [],
    })),

    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),

    head: vi.fn(async () => null),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as MockR2Bucket

  // Ensure _store is accessible (cast above loses it)
  ;(bucket as any)._store = store

  return bucket
}

// ---------------------------------------------------------------------------
// createMockSqlStorage
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock for the `sql` property of DurableObjectStorage.
 *
 * Unlike {@link createMockDurableObjectStorage}, this provides only the raw
 * `exec` function without any query-pattern matching. Every call returns
 * `{ toArray: () => [] }` by default.
 *
 * Use this when you need a lightweight SQL mock and plan to override specific
 * behaviour via `vi.fn().mockImplementation(...)` or when the code under test
 * only needs schema creation to succeed.
 *
 * @example
 * ```ts
 * const sql = createMockSqlStorage()
 * // Override for a specific query:
 * sql.exec.mockImplementation((query: string, ...params: unknown[]) => {
 *   if (query.includes('SELECT')) return { toArray: () => [{ count: 42 }] }
 *   return { toArray: () => [] }
 * })
 * ```
 */
export function createMockSqlStorage(): MockSqlStorage {
  return {
    exec: vi.fn((_query: string, ..._params: unknown[]) => {
      return { toArray: () => [] }
    }),
  }
}
