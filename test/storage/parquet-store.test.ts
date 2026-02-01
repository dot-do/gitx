import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ParquetStore } from '../../src/storage/parquet-store'
import type { DurableObjectStorage } from '../../src/do/schema'

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
 */
function createMockStorage(): DurableObjectStorage {
  const tables = new Map<string, Map<string, Record<string, unknown>>>()

  return {
    sql: {
      exec: vi.fn((query: string, ...params: unknown[]) => {
        // Simple mock - just return empty results
        return { toArray: () => [] }
      }),
    },
  }
}

describe('ParquetStore', () => {
  let store: ParquetStore
  let mockR2: R2Bucket
  let mockStorage: DurableObjectStorage
  const encoder = new TextEncoder()

  beforeEach(() => {
    mockR2 = createMockR2()
    mockStorage = createMockStorage()
    store = new ParquetStore({
      r2: mockR2,
      sql: mockStorage,
      prefix: 'test-repo',
    })
  })

  describe('putObject', () => {
    it('should return a SHA for a blob', async () => {
      const data = encoder.encode('hello world')
      const sha = await store.putObject('blob', data)

      expect(sha).toBeDefined()
      expect(sha).toHaveLength(40)
      expect(/^[0-9a-f]{40}$/.test(sha)).toBe(true)
    })

    it('should buffer small objects', async () => {
      const data = encoder.encode('test content')
      await store.putObject('blob', data)

      const stats = store.getStats()
      expect(stats.bufferedObjects).toBe(1)
    })

    it('should upload large objects to R2 directly', async () => {
      const data = new Uint8Array(2 * 1024 * 1024) // 2MB
      await store.putObject('blob', data)

      // Should have been uploaded to R2 raw storage
      expect(mockR2.put).toHaveBeenCalled()
    })
  })

  describe('hasObject', () => {
    it('should find buffered objects', async () => {
      const data = encoder.encode('hello')
      const sha = await store.putObject('blob', data)

      const exists = await store.hasObject(sha)
      expect(exists).toBe(true)
    })

    it('should return false for unknown SHA', async () => {
      const exists = await store.hasObject('0'.repeat(40))
      expect(exists).toBe(false)
    })
  })

  describe('getObject', () => {
    it('should retrieve buffered objects', async () => {
      const data = encoder.encode('hello world')
      const sha = await store.putObject('blob', data)

      const result = await store.getObject(sha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
      expect(new TextDecoder().decode(result!.content)).toBe('hello world')
    })

    it('should return null for unknown SHA', async () => {
      const result = await store.getObject('0'.repeat(40))
      expect(result).toBeNull()
    })
  })

  describe('flush', () => {
    it('should write buffered objects to Parquet on R2', async () => {
      const data = encoder.encode('test')
      await store.putObject('blob', data)

      const key = await store.flush()
      expect(key).not.toBeNull()
      expect(key).toContain('test-repo/objects/')
      expect(key).toContain('.parquet')

      const stats = store.getStats()
      expect(stats.bufferedObjects).toBe(0)
      expect(stats.parquetFiles).toBe(1)
    })

    it('should return null when buffer is empty', async () => {
      const key = await store.flush()
      expect(key).toBeNull()
    })
  })

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stats = store.getStats()
      expect(stats.bufferedObjects).toBe(0)
      expect(stats.bufferedBytes).toBe(0)
      expect(stats.parquetFiles).toBe(0)
    })
  })
})
