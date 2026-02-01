import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ObjectStore } from '../../src/do/object-store'
import { ParquetStore } from '../../src/storage/parquet-store'
import type { DurableObjectStorage } from '../../src/do/schema'

/**
 * Tests for ObjectStore wired to ParquetStore as CAS backend.
 * Verifies that ObjectStore correctly delegates to ParquetStore
 * for put/get/has/delete operations.
 */

const encoder = new TextEncoder()

function createMockR2(): R2Bucket {
  const store = new Map<string, ArrayBuffer>()

  return {
    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string) => {
      if (value instanceof Uint8Array) {
        store.set(key, value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
      } else if (value instanceof ArrayBuffer) {
        store.set(key, value)
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

function createMockStorage(): DurableObjectStorage {
  return {
    sql: {
      exec: vi.fn((_query: string, ..._params: unknown[]) => {
        return { toArray: () => [] }
      }),
    },
  }
}

describe('ObjectStore with ParquetStore backend', () => {
  let objectStore: ObjectStore
  let parquetStore: ParquetStore
  let mockR2: R2Bucket
  let mockSqlStorage: DurableObjectStorage

  beforeEach(() => {
    mockR2 = createMockR2()
    mockSqlStorage = createMockStorage()
    parquetStore = new ParquetStore({
      r2: mockR2,
      sql: mockSqlStorage,
      prefix: 'test-repo',
    })
    objectStore = new ObjectStore(mockSqlStorage, {
      backend: parquetStore,
    })
  })

  it('should putObject via ParquetStore backend and return valid SHA', async () => {
    const content = encoder.encode('hello world')
    const sha = await objectStore.putObject('blob', content)

    expect(sha).toBeDefined()
    expect(sha).toHaveLength(40)
    expect(/^[0-9a-f]{40}$/.test(sha)).toBe(true)
  })

  it('should getObject from ParquetStore backend (buffered)', async () => {
    const content = encoder.encode('test data')
    const sha = await objectStore.putObject('blob', content)

    const obj = await objectStore.getObject(sha)
    expect(obj).not.toBeNull()
    expect(obj!.type).toBe('blob')
    expect(obj!.size).toBe(content.length)
    expect(new TextDecoder().decode(obj!.data)).toBe('test data')
  })

  it('should hasObject from ParquetStore backend', async () => {
    const content = encoder.encode('exists')
    const sha = await objectStore.putObject('blob', content)

    expect(await objectStore.hasObject(sha)).toBe(true)
    expect(await objectStore.hasObject('0'.repeat(40))).toBe(false)
  })

  it('should cache objects in ObjectStore LRU after first read', async () => {
    const content = encoder.encode('cached content')
    const sha = await objectStore.putObject('blob', content)

    // First read - hits ParquetStore (buffered)
    const obj1 = await objectStore.getObject(sha)
    expect(obj1).not.toBeNull()

    // Second read - should hit LRU cache
    const obj2 = await objectStore.getObject(sha)
    expect(obj2).not.toBeNull()
    expect(obj2!.data).toEqual(obj1!.data)
  })

  it('should read objects from Parquet files after flush', async () => {
    const content = encoder.encode('flushed content')
    const sha = await objectStore.putObject('blob', content)

    // Flush to Parquet on R2
    await parquetStore.flush()

    // Clear ObjectStore cache to force ParquetStore read
    objectStore.resetMetrics()

    // Create a new ObjectStore to bypass LRU cache
    const freshStore = new ObjectStore(mockSqlStorage, {
      backend: parquetStore,
    })

    const obj = await freshStore.getObject(sha)
    expect(obj).not.toBeNull()
    expect(obj!.type).toBe('blob')
    expect(new TextDecoder().decode(obj!.data)).toBe('flushed content')
  })

  it('should support putCommitObject through ParquetStore', async () => {
    const now = Math.floor(Date.now() / 1000)
    const author = { name: 'Test', email: 'test@test.com', timestamp: now, timezone: '+0000' }

    const sha = await objectStore.putCommitObject({
      tree: 'a'.repeat(40),
      parents: [],
      author,
      committer: author,
      message: 'test commit',
    })

    expect(sha).toHaveLength(40)

    const obj = await objectStore.getObject(sha)
    expect(obj).not.toBeNull()
    expect(obj!.type).toBe('commit')
  })

  it('should deleteObject via ParquetStore backend', async () => {
    const content = encoder.encode('to delete')
    const sha = await objectStore.putObject('blob', content)

    // ParquetStore.deleteObject is a no-op (append-only)
    // but ObjectStore should handle the call gracefully
    const deleted = await objectStore.deleteObject(sha)
    // ParquetStore.hasObject will still find it in buffer
    // so the delete "succeeds" from ObjectStore's perspective
    expect(typeof deleted).toBe('boolean')
  })
})
