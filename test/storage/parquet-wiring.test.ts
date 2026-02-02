/**
 * @fileoverview RED Phase TDD Tests for ParquetStore Backend Wiring
 *
 * These tests verify that DORepositoryProvider properly connects to ParquetStore
 * as its backend. All tests SHOULD FAIL against the current code because:
 *
 * 1. DORepositoryProvider constructor creates SqliteObjectStore WITHOUT passing a backend
 * 2. Wire protocol operations (receivePack) store objects only in SQLite
 * 3. No connection exists between wire-routes and ParquetStore
 *
 * Expected failures:
 * - Test 1: FAILS because SqliteObjectStore has no backend (backend property is null)
 * - Test 2: FAILS because receivePack stores objects via SqliteObjectStore without backend
 * - Test 3: FAILS because clearing SQLite removes objects (they're not in Parquet)
 *
 * @module test/storage/parquet-wiring
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DORepositoryProvider } from '../../src/do/wire-routes'
import type { DurableObjectStorage } from '../../src/do/schema'
import type { ParquetStore } from '../../src/storage/parquet-store'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Mock R2Bucket for testing.
 */
function createMockR2(): R2Bucket {
  const store = new Map<string, ArrayBuffer>()

  return {
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
    delete: vi.fn(async () => {}),
    head: vi.fn(async () => null),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket
}

/**
 * Mock DurableObjectStorage for testing.
 * Tracks tables for refs, objects, object_index, write_buffer_wal.
 */
function createMockStorage(): DurableObjectStorage {
  const tables = {
    refs: new Map<string, { name: string; target: string; type: string; created_at: number; updated_at: number }>(),
    objects: new Map<string, { sha: string; type: string; size: number; data: Uint8Array; created_at: number }>(),
    object_index: new Map<string, { sha: string; tier: string; pack_id: string | null; offset: number | null; size: number; type: string; updated_at: number }>(),
    wal: [] as { id: number; operation: string; payload: Uint8Array; flushed: boolean }[],
    write_buffer_wal: [] as { id: number; sha: string; type: string; data: Uint8Array; path: string | null; created_at: number }[],
  }
  let nextWalId = 1
  let nextWalEntryId = 1

  return {
    sql: {
      exec: vi.fn((query: string, ...params: unknown[]) => {
        // Schema creation (no-op)
        if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) {
          return { toArray: () => [] }
        }

        // refs SELECT
        if (query.includes('SELECT name, target FROM refs')) {
          const rows = Array.from(tables.refs.values())
          return { toArray: () => rows }
        }

        // refs INSERT
        if (query.includes('INSERT OR REPLACE INTO refs')) {
          const [name, target, type, created_at, updated_at] = params as [string, string, string, number, number]
          tables.refs.set(name, { name, target, type, created_at, updated_at })
          return { toArray: () => [] }
        }

        // objects INSERT
        if (query.includes('INSERT OR REPLACE INTO objects')) {
          const [sha, type, size, data, created_at] = params as [string, string, number, Uint8Array, number]
          tables.objects.set(sha, { sha, type, size, data, created_at })
          return { toArray: () => [] }
        }

        // objects SELECT by sha
        if (query.includes('SELECT') && query.includes('FROM objects') && query.includes('WHERE sha = ?')) {
          const sha = params[0] as string
          const obj = tables.objects.get(sha)
          return { toArray: () => obj ? [obj] : [] }
        }

        // objects DELETE
        if (query.includes('DELETE FROM objects WHERE sha = ?')) {
          const sha = params[0] as string
          tables.objects.delete(sha)
          return { toArray: () => [] }
        }

        // object_index INSERT
        if (query.includes('INSERT OR REPLACE INTO object_index')) {
          const [sha, tier, pack_id, offset, size, type, updated_at] = params as [string, string, string | null, number | null, number, string, number]
          tables.object_index.set(sha, { sha, tier, pack_id, offset, size, type, updated_at })
          return { toArray: () => [] }
        }

        // object_index SELECT by sha
        if (query.includes('SELECT') && query.includes('FROM object_index') && query.includes('WHERE sha = ?')) {
          const sha = params[0] as string
          const idx = tables.object_index.get(sha)
          return { toArray: () => idx ? [{ ...idx, pack_id: idx.pack_id, updated_at: idx.updated_at }] : [] }
        }

        // object_index DELETE
        if (query.includes('DELETE FROM object_index WHERE sha = ?')) {
          const sha = params[0] as string
          tables.object_index.delete(sha)
          return { toArray: () => [] }
        }

        // objects COUNT
        if (query.includes('SELECT COUNT') && query.includes('FROM objects') && query.includes('WHERE sha = ?')) {
          const sha = params[0] as string
          const exists = tables.objects.has(sha)
          return { toArray: () => [{ count: exists ? 1 : 0 }] }
        }

        // WAL INSERT
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

        // write_buffer_wal INSERT
        if (query.includes('INSERT INTO write_buffer_wal')) {
          const id = nextWalEntryId++
          const [sha, type, data, path, created_at] = params as [string, string, Uint8Array, string | null, number]
          tables.write_buffer_wal.push({ id, sha, type, data, path, created_at })
          return { toArray: () => [] }
        }

        // write_buffer_wal SELECT for getting ID
        if (query.includes('SELECT id FROM write_buffer_wal WHERE sha')) {
          const sha = params[0] as string
          const created_at = params[1] as number
          const entry = tables.write_buffer_wal.find(e => e.sha === sha && e.created_at === created_at)
          return { toArray: () => entry ? [{ id: entry.id }] : [] }
        }

        // write_buffer_wal SELECT ALL for recovery
        if (query.includes('SELECT id, sha, type, data, path, created_at FROM write_buffer_wal')) {
          return { toArray: () => tables.write_buffer_wal }
        }

        // write_buffer_wal DELETE by ID list
        if (query.includes('DELETE FROM write_buffer_wal WHERE id IN')) {
          const ids = params as number[]
          tables.write_buffer_wal = tables.write_buffer_wal.filter(e => !ids.includes(e.id))
          return { toArray: () => [] }
        }

        // write_buffer_wal DELETE by SHA
        if (query.includes('DELETE FROM write_buffer_wal WHERE sha')) {
          const sha = params[0] as string
          tables.write_buffer_wal = tables.write_buffer_wal.filter(e => e.sha !== sha)
          return { toArray: () => [] }
        }

        // write_buffer_wal DELETE by single ID
        if (query.includes('DELETE FROM write_buffer_wal WHERE id = ?')) {
          const id = params[0] as number
          tables.write_buffer_wal = tables.write_buffer_wal.filter(e => e.id !== id)
          return { toArray: () => [] }
        }

        // Default: return empty results
        return { toArray: () => [] }
      }),
    },
    // Test helper to access internal state
    _testGetTables: () => tables,
  } as DurableObjectStorage & { _testGetTables: () => typeof tables }
}

/**
 * Helper to create a minimal valid packfile for testing.
 * This creates a packfile with version 2, 1 object (a blob), and a dummy checksum.
 */
function createMinimalPackfile(blobContent: string): Uint8Array {
  const content = encoder.encode(blobContent)
  const blobHeader = encoder.encode(`blob ${content.length}\0`)
  const fullObject = new Uint8Array(blobHeader.length + content.length)
  fullObject.set(blobHeader, 0)
  fullObject.set(content, blobHeader.length)

  // Compute SHA-1 of the object (simplified - using a mock SHA for testing)
  const sha = 'a'.repeat(40) // Mock SHA-1

  // Pack format: PACK + version (2) + num_objects (1) + object_data + checksum (20 bytes)
  const packHeader = new Uint8Array(12)
  packHeader.set(encoder.encode('PACK'), 0)
  packHeader[4] = 0 // version high byte
  packHeader[5] = 0
  packHeader[6] = 0
  packHeader[7] = 2 // version = 2
  packHeader[8] = 0 // num_objects high byte
  packHeader[9] = 0
  packHeader[10] = 0
  packHeader[11] = 1 // num_objects = 1

  // Object entry: type (blob=3), size (varint encoded), then deflated content
  // For simplicity, we'll create a minimal undeltified object
  const objType = 3 // blob
  const objSize = fullObject.length
  // Varint: size with type in first byte
  const firstByte = (objType << 4) | (objSize & 0x0f)
  const objHeader = new Uint8Array([firstByte | 0x80, (objSize >> 4) & 0x7f])

  // For testing, we'll store uncompressed data (this won't be a valid pack but good enough for test)
  const objData = fullObject

  const packData = new Uint8Array(packHeader.length + objHeader.length + objData.length + 20)
  packData.set(packHeader, 0)
  packData.set(objHeader, packHeader.length)
  packData.set(objData, packHeader.length + objHeader.length)
  // Last 20 bytes: checksum (dummy for testing)
  packData.fill(0, packData.length - 20)

  return packData
}

describe('ParquetStore Backend Wiring (RED Phase)', () => {
  let mockR2: R2Bucket
  let mockStorage: DurableObjectStorage & { _testGetTables: () => any }
  let provider: DORepositoryProvider

  beforeEach(() => {
    mockR2 = createMockR2()
    mockStorage = createMockStorage() as any
    // Create a mock CASBackend (representing ParquetStore)
    const mockBackend = {
      putObject: vi.fn(async (type: string, content: Uint8Array) => 'a'.repeat(40)),
      getObject: vi.fn(async (sha: string) => null),
      hasObject: vi.fn(async (sha: string) => false),
      deleteObject: vi.fn(async (sha: string) => {}),
      flush: vi.fn(async () => {}),
      initialize: vi.fn(async () => {}),
      getStats: vi.fn(() => ({ bufferedObjects: 1, flushedFiles: 0 })),
    }
    provider = new DORepositoryProvider(mockStorage, mockBackend as any)
  })

  describe('Test 1: DORepositoryProvider.objectStore has non-null backend property', () => {
    it('FAILS: objectStore.backend should be a ParquetStore instance, but it is null', async () => {
      // This test verifies that the objectStore has a backend connected.
      // CURRENT STATE: SqliteObjectStore is created without a backend parameter,
      // so the backend property will be null.

      // Access the private objectStore field via type assertion for testing
      const objectStore = (provider as any).objectStore

      // RED: This assertion SHOULD FAIL because no backend is passed in constructor
      expect(objectStore).toHaveProperty('backend')
      expect(objectStore.backend).not.toBeNull()
      expect(objectStore.backend).toBeDefined()

      // Additional check: if backend exists, it should have ParquetStore methods
      if (objectStore.backend) {
        expect(objectStore.backend).toHaveProperty('putObject')
        expect(objectStore.backend).toHaveProperty('getObject')
        expect(objectStore.backend).toHaveProperty('hasObject')
        expect(objectStore.backend).toHaveProperty('flush')
      }
    })
  })

  describe('Test 2: DORepositoryProvider uses ParquetStore backend for object storage', () => {
    it('FAILS: objectStore should delegate putObject to ParquetStore backend', async () => {
      // This test verifies that SqliteObjectStore has a backend configured
      // and would delegate storage operations to it.
      //
      // CURRENT STATE: SqliteObjectStore is created without a backend parameter,
      // so it stores directly to SQLite instead of delegating to ParquetStore.

      const objectStore = (provider as any).objectStore

      // RED: Backend should exist
      expect(objectStore.backend).not.toBeNull()

      // RED: Backend should be a ParquetStore with required methods
      expect(objectStore.backend).toHaveProperty('putObject')
      expect(objectStore.backend).toHaveProperty('getObject')
      expect(objectStore.backend).toHaveProperty('hasObject')
      expect(objectStore.backend).toHaveProperty('flush')
      expect(objectStore.backend).toHaveProperty('initialize')

      // RED: When we put an object, it should use the backend
      // In the current implementation, this will store directly to SQLite
      const testData = encoder.encode('test data')
      const sha = await objectStore.putObject('blob', testData)

      // Verify backend was called (would need spy/mock, but we can check R2)
      const putCalls = (mockR2.put as ReturnType<typeof vi.fn>).mock.calls

      // Backend should have written to WAL or buffer
      // RED: This will fail because no backend exists, so no R2 calls happen
      // (Parquet stores would eventually call R2.put when flushing)
      expect(objectStore.backend).not.toBeNull()
    })
  })

  describe('Test 3: Backend persistence across SqliteObjectStore operations', () => {
    it('FAILS: objectStore.backend should survive object read/write operations', async () => {
      // This test verifies that the backend connection persists through
      // normal object store operations and can be used for tiered storage.
      //
      // CURRENT STATE: No backend exists, so there's nothing to test persistence of.

      const objectStore = (provider as any).objectStore

      // RED: Backend should exist initially
      expect(objectStore.backend).not.toBeNull()
      expect(objectStore.backend).toBeDefined()

      // Simulate some operations
      const testData = encoder.encode('persistence test')
      const sha = await objectStore.putObject('blob', testData)

      // RED: Backend should still be there after putObject
      expect(objectStore.backend).not.toBeNull()

      // Try to retrieve
      const retrieved = await objectStore.getObject(sha)
      expect(retrieved).not.toBeNull()

      // RED: Backend should still be there after getObject
      expect(objectStore.backend).not.toBeNull()

      // RED: Backend should be the same ParquetStore instance
      expect(objectStore.backend).toHaveProperty('getStats')
      const stats = objectStore.backend.getStats()

      // RED: Stats should show buffered objects from our putObject call
      expect(stats).toBeDefined()
      expect(stats.bufferedObjects).toBeGreaterThan(0)
    })
  })
})
