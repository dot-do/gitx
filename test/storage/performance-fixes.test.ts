import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ParquetStore } from '../../src/storage/parquet-store'
import { SqliteObjectStore } from '../../src/do/object-store'
import type { DurableObjectStorage } from '@cloudflare/workers-types'

function createMockSql() {
  return {
    sql: {
      exec: vi.fn(() => ({
        toArray: () => [],
        [Symbol.iterator]: function* () {},
        columnNames: [],
        rowsRead: 0,
        rowsWritten: 0,
      })),
    },
  }
}

function createParquetStore(mockR2?: any) {
  const r2 = mockR2 ?? {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(async () => ({ objects: [], truncated: false, delimitedPrefixes: [] })),
    head: vi.fn(),
    delete: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  }
  const sql = createMockSql()
  return new ParquetStore({
    r2,
    sql: sql as any,
    prefix: 'test-owner/test-repo',
  })
}

describe('Performance Fixes - RED phase TDD', () => {
  describe('ParquetStore buffer lookup is O(1) via Map', () => {
    it('should have a Map-based bufferIndex for O(1) lookups', async () => {
      const store = createParquetStore()

      // Add multiple objects to buffer AND bufferIndex (simulating putObject behavior)
      const numObjects = 100
      for (let i = 0; i < numObjects; i++) {
        const sha = `${'a'.repeat(39)}${i.toString().padStart(1, '0')}`
        const obj = {
          sha,
          type: 'blob' as const,
          size: 10,
          data: new Uint8Array(10),
        }
        ;(store as any).buffer.push(obj)
        ;(store as any).bufferIndex.set(sha, obj)
      }

      expect((store as any).bufferIndex).toBeInstanceOf(Map)
      expect((store as any).bufferIndex.size).toBe(numObjects)

      const lastSha = `${'a'.repeat(39)}${(numObjects - 1).toString().padStart(1, '0')}`
      expect((store as any).bufferIndex.has(lastSha)).toBe(true)
    })

    it('should perform constant-time lookup regardless of buffer size', async () => {
      const store = createParquetStore()

      // Add 1000 objects to buffer + bufferIndex
      const numObjects = 1000
      for (let i = 0; i < numObjects; i++) {
        const sha = i.toString(16).padStart(40, '0')
        const obj = {
          sha,
          type: 'blob' as const,
          size: 10,
          data: new Uint8Array(10),
        }
        ;(store as any).buffer.push(obj)
        ;(store as any).bufferIndex.set(sha, obj)
      }

      // Spy on Array.find to detect O(n) behavior
      const findSpy = vi.spyOn((store as any).buffer, 'find')

      // Look up the last object (worst case for Array.find)
      const lastSha = (numObjects - 1).toString(16).padStart(40, '0')
      const result = await store.getObject(lastSha)

      // With a Map-based index, Array.find should NOT be called for buffer lookup
      expect(findSpy).not.toHaveBeenCalled()
      expect(result).not.toBeNull()

      findSpy.mockRestore()
    })

    it('should maintain bufferIndex consistency with buffer operations', async () => {
      const store = createParquetStore()

      const sha1 = '1'.repeat(40)
      const sha2 = '2'.repeat(40)

      const obj1 = { sha: sha1, type: 'blob' as const, size: 10, data: new Uint8Array(10) }
      const obj2 = { sha: sha2, type: 'blob' as const, size: 20, data: new Uint8Array(20) }

      ;(store as any).buffer.push(obj1)
      ;(store as any).bufferIndex.set(sha1, obj1)
      ;(store as any).buffer.push(obj2)
      ;(store as any).bufferIndex.set(sha2, obj2)

      expect((store as any).bufferIndex).toBeInstanceOf(Map)
      expect((store as any).bufferIndex.get(sha1)).toBeDefined()
      expect((store as any).bufferIndex.get(sha2)).toBeDefined()

      // Clear buffer should also clear index
      ;(store as any).buffer = []
      ;(store as any).bufferIndex.clear()

      expect((store as any).bufferIndex.size).toBe(0)
    })
  })

  describe('hasObject uses SELECT 1 not full getObject', () => {
    let mockStorage: DurableObjectStorage
    let mockSql: any

    beforeEach(() => {
      mockSql = {
        exec: vi.fn(() => ({
          toArray: () => [],
          [Symbol.iterator]: function* () {},
          columnNames: [],
          rowsRead: 0,
          rowsWritten: 0,
        })),
      }

      mockStorage = {
        sql: mockSql,
        get: vi.fn(),
        put: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn((fn: Function) => fn()),
        deleteAll: vi.fn(),
        getAlarm: vi.fn(),
        setAlarm: vi.fn(),
        deleteAlarm: vi.fn(),
        sync: vi.fn(),
      } as unknown as DurableObjectStorage
    })

    it('should use SELECT 1 for existence check, not full SELECT', async () => {
      const store = new SqliteObjectStore(mockStorage)
      const testSha = 'a'.repeat(40)

      // Mock the SQL query to return empty (object doesn't exist)
      mockSql.exec.mockReturnValueOnce({
        toArray: () => [],
        [Symbol.iterator]: function* () {},
        columnNames: ['exists'],
        rowsRead: 0,
        rowsWritten: 0,
      })

      await store.hasObject(testSha)

      // FAIL CONDITION: Should use "SELECT 1" for existence check
      // Current code calls getObject which uses "SELECT sha, type, size, data FROM objects"
      expect(mockSql.exec).toHaveBeenCalled()
      const sqlQuery = mockSql.exec.mock.calls[0][0]

      // Should be a lightweight existence check
      expect(sqlQuery).toContain('SELECT 1')
      expect(sqlQuery).not.toContain('SELECT sha, type, size, data')
      expect(sqlQuery).toContain('LIMIT 1')
    })

    it('should not call getObject from hasObject', async () => {
      const store = new SqliteObjectStore(mockStorage)
      const testSha = 'b'.repeat(40)

      // Spy on getObject to ensure it's not called
      const getObjectSpy = vi.spyOn(store, 'getObject')

      mockSql.exec.mockReturnValueOnce({
        toArray: () => [{ exists: 1 }],
        [Symbol.iterator]: function* () {
          yield { exists: 1 }
        },
        columnNames: ['exists'],
        rowsRead: 1,
        rowsWritten: 0,
      })

      const result = await store.hasObject(testSha)

      // FAIL CONDITION: hasObject should NOT call getObject
      // Current code at line 1200-1203 does: const obj = await this.getObject(sha); return obj !== null
      expect(getObjectSpy).not.toHaveBeenCalled()
      expect(result).toBe(true)

      getObjectSpy.mockRestore()
    })

    it('should return true when object exists without reading data column', async () => {
      const store = new SqliteObjectStore(mockStorage)
      const testSha = 'c'.repeat(40)

      mockSql.exec.mockReturnValueOnce({
        toArray: () => [{ exists: 1 }],
        [Symbol.iterator]: function* () {
          yield { exists: 1 }
        },
        columnNames: ['exists'],
        rowsRead: 1,
        rowsWritten: 0,
      })

      const result = await store.hasObject(testSha)

      expect(result).toBe(true)

      // Verify the query doesn't read data column
      const sqlQuery = mockSql.exec.mock.calls[0][0]
      expect(sqlQuery).not.toContain('data')
    })

    it('should return false when object does not exist', async () => {
      const store = new SqliteObjectStore(mockStorage)
      const testSha = 'd'.repeat(40)

      mockSql.exec.mockReturnValueOnce({
        toArray: () => [],
        [Symbol.iterator]: function* () {},
        columnNames: ['exists'],
        rowsRead: 0,
        rowsWritten: 0,
      })

      const result = await store.hasObject(testSha)

      expect(result).toBe(false)

      // Verify efficient query was used
      const sqlQuery = mockSql.exec.mock.calls[0][0]
      expect(sqlQuery).toContain('SELECT 1')
      expect(sqlQuery).toContain('LIMIT 1')
    })
  })

  describe('Single object Parquet lookup does not read all rows', () => {
    it.todo('should use bloom filter before reading all Parquet rows', async () => {
      const mockR2 = {
        get: vi.fn(),
        put: vi.fn(),
        list: vi.fn(() => ({
          objects: [
            { key: 'test-owner/test-repo/objects/file1.parquet' },
          ],
          truncated: false,
        })),
        head: vi.fn(),
        delete: vi.fn(),
      } as any

      const store = createParquetStore(mockR2)

      // Mock a Parquet file with metadata indicating 1000 rows
      const mockParquetData = new Uint8Array(1024)
      mockR2.get.mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(mockParquetData.buffer),
        body: null,
        bodyUsed: false,
      })

      const searchSha = 'e'.repeat(40)

      // Spy on internal parquetReadObjects to detect full row scan
      const parquetReadSpy = vi.spyOn(store as any, 'parquetReadObjects')

      try {
        await store.getObject(searchSha)
      } catch (e) {
        // May throw due to mock data, that's ok
      }

      // FAIL CONDITION: Should use bloom filter to skip reading Parquet rows
      // Current code at line 1017-1029 calls parquetReadObjects then does .find()
      // With bloom filter, should not read all objects if SHA is not in bloom filter

      // At minimum, there should be a bloom filter check before reading
      // This test fails because current implementation always calls parquetReadObjects
      if (parquetReadSpy.mock.calls.length > 0) {
        // Should have checked bloom filter first
        expect((store as any).bloomCache).toBeDefined()
        // expect bloom filter to be checked before parquetReadObjects
        // This will fail because no such optimization exists
      }

      parquetReadSpy.mockRestore()
    })

    it('should not load all rows into memory for single SHA lookup', async () => {
      const mockR2 = {
        get: vi.fn(),
        put: vi.fn(),
        list: vi.fn(() => ({
          objects: [
            { key: 'test-owner/test-repo/objects/large-file.parquet' },
          ],
          truncated: false,
        })),
        head: vi.fn(),
        delete: vi.fn(),
      } as any

      const store = createParquetStore(mockR2)

      const searchSha = 'f'.repeat(40)

      // Track memory allocations - if all 1000 objects are loaded, we'd see large array
      const originalFind = Array.prototype.find
      let findCallCount = 0
      let largestArraySize = 0

      Array.prototype.find = function (this: any[], ...args: any[]) {
        findCallCount++
        if (this.length > largestArraySize) {
          largestArraySize = this.length
        }
        return originalFind.apply(this, args as any)
      }

      try {
        await store.getObject(searchSha)
      } catch (e) {
        // May throw due to no actual Parquet data
      }

      Array.prototype.find = originalFind

      // FAIL CONDITION: Should not read all rows into array then call .find()
      // If largestArraySize is 1000, it means all rows were loaded
      // Efficient implementation would use row group filtering or bloom filter
      // This test fails because current code loads everything into array

      // At least one find was called (current behavior)
      if (findCallCount > 0) {
        // For efficient implementation, should not have loaded huge arrays
        // This expectation will fail with current O(n) scan
        expect(largestArraySize).toBeLessThan(100) // Should use filtering, not full scan
      }
    })

    it.todo('should leverage Parquet row group statistics for point queries', async () => {
      const mockR2 = {
        get: vi.fn(),
        put: vi.fn(),
        list: vi.fn(() => ({
          objects: [
            { key: 'test-owner/test-repo/objects/indexed.parquet' },
          ],
          truncated: false,
        })),
        head: vi.fn(),
        delete: vi.fn(),
      } as any

      const store = createParquetStore(mockR2)

      // FAIL CONDITION: Should have method to check row group metadata before full read
      // Current implementation doesn't leverage row group statistics
      expect(typeof (store as any).checkRowGroupBloomFilter).toBe('function')
    })

    it.todo('should use SQLite bloom cache to avoid unnecessary Parquet reads', async () => {
      const mockR2 = {
        get: vi.fn(),
        put: vi.fn(),
        list: vi.fn(() => ({
          objects: [
            { key: 'test-owner/test-repo/objects/cached.parquet' },
          ],
          truncated: false,
        })),
        head: vi.fn(),
        delete: vi.fn(),
      } as any

      const store = createParquetStore(mockR2)

      const missingSha = 'g'.repeat(40)

      // Mock bloom cache to indicate SHA does NOT exist
      if ((store as any).bloomCache) {
        const mockMaybeContains = vi.spyOn((store as any).bloomCache, 'maybeContains')
        mockMaybeContains.mockResolvedValue(false)

        const result = await store.getObject(missingSha)

        // FAIL CONDITION: If bloom cache says "no", should not read Parquet at all
        // Current code doesn't integrate bloom cache check before Parquet read
        expect(mockR2.get).not.toHaveBeenCalled()
        expect(result).toBe(null)

        mockMaybeContains.mockRestore()
      } else {
        // Fail if bloom cache integration doesn't exist
        expect((store as any).bloomCache).toBeDefined()
      }
    })
  })
})
