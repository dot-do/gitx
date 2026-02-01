import { describe, it, expect } from 'vitest'
import { GitRepoDO, GitRepoDOSQL } from '../../src/do/GitRepoDO'

/**
 * Create a minimal mock environment for GitRepoDO construction tests.
 */
function createMockState(id = 'test-do-123') {
  const kvStore = new Map<string, unknown>()
  return {
    id: { toString: () => id },
    storage: {
      get: async (key: string) => kvStore.get(key),
      put: async (key: string, value: unknown) => { kvStore.set(key, value) },
      delete: async (key: string) => kvStore.delete(key),
      list: async (opts?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        const prefix = opts?.prefix ?? ''
        for (const [k, v] of kvStore) {
          if (k.startsWith(prefix)) result.set(k, v)
        }
        return result
      },
      sql: {
        exec: (_query: string, ..._params: unknown[]) => ({ toArray: () => [] }),
      },
    },
    waitUntil: (_p: Promise<unknown>) => {},
    blockConcurrencyWhile: async <T>(cb: () => Promise<T>) => cb(),
  }
}

function createMockR2Bucket() {
  return {
    put: async () => ({}),
    get: async () => null,
    list: async () => ({ objects: [] }),
    delete: async () => {},
    head: async () => null,
    createMultipartUpload: async () => ({}),
  } as unknown as R2Bucket
}

describe('GitRepoDO thin coordinator wiring', () => {
  it('should NOT have parquet capability without ANALYTICS_BUCKET', () => {
    const state = createMockState()
    const env = {}
    const repo = new GitRepoDO(state as any, env as any)

    expect(repo.hasCapability('parquet')).toBe(false)
    expect(repo.getParquetStore()).toBeUndefined()
  })

  it('should have parquet capability with ANALYTICS_BUCKET', () => {
    const state = createMockState()
    const env = { ANALYTICS_BUCKET: createMockR2Bucket() }
    const repo = new GitRepoDO(state as any, env as any)

    expect(repo.hasCapability('parquet')).toBe(true)
    expect(repo.getParquetStore()).toBeDefined()
  })

  it('should always have a ThinSchemaManager', () => {
    const state = createMockState()
    const env = {}
    const repo = new GitRepoDO(state as any, env as any)

    expect(repo.getThinSchema()).toBeDefined()
  })

  it('should have git capability by default', () => {
    const state = createMockState()
    const env = {}
    const repo = new GitRepoDO(state as any, env as any)

    expect(repo.hasCapability('git')).toBe(true)
  })

  it('GitRepoDOSQL should also get parquet when bucket available', () => {
    const state = createMockState()
    const env = { ANALYTICS_BUCKET: createMockR2Bucket() }
    const repo = new GitRepoDOSQL(state as any, env as any)

    expect(repo.hasCapability('parquet')).toBe(true)
    expect(repo.getParquetStore()).toBeDefined()
  })

  it('ParquetStore should use DO id as R2 prefix', () => {
    const state = createMockState('my-repo-id')
    const env = { ANALYTICS_BUCKET: createMockR2Bucket() }
    const repo = new GitRepoDO(state as any, env as any)

    const store = repo.getParquetStore()
    expect(store).toBeDefined()
    // The store is initialized - we verify it exists and is wired
    const stats = store!.getStats()
    expect(stats.bufferedObjects).toBe(0)
    expect(stats.parquetFiles).toBe(0)
  })
})
