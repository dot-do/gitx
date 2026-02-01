import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { handleHealthCheck, setupRoutes, type GitRepoDOInstance } from '../../src/do/routes'
import type { HealthCheckResponse } from '../../src/do/types'
import type { ParquetStore } from '../../src/storage/parquet-store'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a minimal mock storage that satisfies DurableObjectStorage.
 * By default, `SELECT 1` returns `[{ ok: 1 }]`.
 */
function createMockStorage(overrides?: {
  sqlExec?: (query: string, ...params: unknown[]) => { toArray(): unknown[] }
}) {
  return {
    get: async () => undefined,
    put: async () => {},
    delete: async () => false,
    list: async () => new Map(),
    sql: {
      exec: overrides?.sqlExec ?? ((query: string) => {
        if (query.trim() === 'SELECT 1 AS ok') {
          return { toArray: () => [{ ok: 1 }] }
        }
        return { toArray: () => [] }
      }),
    },
  }
}

/**
 * Create a mock ParquetStore-like object that exposes getStats().
 */
function createMockParquetStore(overrides?: {
  getStats?: () => ReturnType<ParquetStore['getStats']>
}): ParquetStore {
  const defaultStats = {
    bufferedObjects: 5,
    bufferedBytes: 2048,
    parquetFiles: 3,
    bloom: {
      bloomItems: 100,
      bloomFalsePositiveRate: 0.001,
      bloomSegments: 2,
      exactCacheSize: 50,
    },
  }
  return {
    getStats: overrides?.getStats ?? (() => defaultStats),
  } as unknown as ParquetStore
}

/**
 * Create a GitRepoDOInstance mock for testing.
 */
function createMockInstance(overrides?: {
  storage?: ReturnType<typeof createMockStorage>
  parquetStore?: ParquetStore | undefined
  ns?: string
  capabilities?: string[]
}): GitRepoDOInstance {
  const storage = overrides?.storage ?? createMockStorage()
  const parquetStore = overrides && 'parquetStore' in overrides
    ? overrides.parquetStore
    : createMockParquetStore()
  const capabilities = new Set(overrides?.capabilities ?? ['git', 'parquet'])

  return {
    $type: 'GitRepoDO',
    ns: overrides?.ns ?? 'github:test/repo',
    _startTime: Date.now() - 10_000,
    getCapabilities: () => capabilities,
    getStorage: () => storage as any,
    getAnalyticsBucket: () => undefined,
    getParquetStore: () => parquetStore ?? undefined,
    initialize: async () => {},
    waitUntil: () => {},
    scheduleCompaction: () => false,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('handleHealthCheck', () => {
  it('returns ok when all components are healthy', async () => {
    const router = new Hono()
    const instance = createMockInstance()
    setupRoutes(router, instance)

    const res = await router.request('/health')
    expect(res.status).toBe(200)

    const body = await res.json() as HealthCheckResponse
    expect(body.status).toBe('ok')
    expect(body.$type).toBe('GitRepoDO')
    expect(body.ns).toBe('github:test/repo')
    expect(body.capabilities).toContain('git')
    expect(body.uptime).toBeGreaterThanOrEqual(0)

    // SQLite component
    expect(body.components?.sqlite?.status).toBe('ok')

    // Bloom component
    expect(body.components?.bloom?.status).toBe('ok')
    expect(body.components?.bloom?.segments).toBe(2)
    expect(body.components?.bloom?.items).toBe(100)

    // Parquet component
    expect(body.components?.parquet?.status).toBe('ok')
    expect(body.components?.parquet?.parquetFiles).toBe(3)
    expect(body.components?.parquet?.bufferedObjects).toBe(5)
  })

  it('returns unhealthy with 503 when SQLite fails', async () => {
    const brokenStorage = createMockStorage({
      sqlExec: () => { throw new Error('disk I/O error') },
    })
    const instance = createMockInstance({ storage: brokenStorage })
    const router = new Hono()
    setupRoutes(router, instance)

    const res = await router.request('/health')
    expect(res.status).toBe(503)

    const body = await res.json() as HealthCheckResponse
    expect(body.status).toBe('unhealthy')
    expect(body.components?.sqlite?.status).toBe('unhealthy')
    expect(body.components?.sqlite?.message).toBe('disk I/O error')
  })

  it('returns unhealthy when SELECT 1 returns unexpected result', async () => {
    const badStorage = createMockStorage({
      sqlExec: () => ({ toArray: () => [] }),
    })
    const instance = createMockInstance({ storage: badStorage })
    const router = new Hono()
    setupRoutes(router, instance)

    const res = await router.request('/health')
    expect(res.status).toBe(503)

    const body = await res.json() as HealthCheckResponse
    expect(body.status).toBe('unhealthy')
    expect(body.components?.sqlite?.status).toBe('unhealthy')
    expect(body.components?.sqlite?.message).toContain('Unexpected')
  })

  it('returns degraded when bloom filter check throws', async () => {
    const brokenParquet = {
      getStats: (() => {
        let called = false
        return () => {
          if (!called) {
            // First call is for bloom - throw
            called = true
            throw new Error('bloom corrupted')
          }
          // Second call is for parquet stats
          return {
            bufferedObjects: 0,
            bufferedBytes: 0,
            parquetFiles: 1,
            bloom: { bloomItems: 0, bloomFalsePositiveRate: 0, bloomSegments: 0, exactCacheSize: 0 },
          }
        }
      })(),
    } as unknown as ParquetStore

    const instance = createMockInstance({ parquetStore: brokenParquet })
    const router = new Hono()
    setupRoutes(router, instance)

    const res = await router.request('/health')
    expect(res.status).toBe(200)

    const body = await res.json() as HealthCheckResponse
    expect(body.status).toBe('degraded')
    expect(body.components?.bloom?.status).toBe('degraded')
    expect(body.components?.bloom?.message).toBe('bloom corrupted')
  })

  it('omits bloom and parquet sections when ParquetStore is not configured', async () => {
    const instance = createMockInstance({
      parquetStore: undefined,
      capabilities: ['git'],
    })
    const router = new Hono()
    setupRoutes(router, instance)

    const res = await router.request('/health')
    expect(res.status).toBe(200)

    const body = await res.json() as HealthCheckResponse
    expect(body.status).toBe('ok')
    expect(body.components?.sqlite?.status).toBe('ok')
    expect(body.components?.bloom).toBeUndefined()
    expect(body.components?.parquet).toBeUndefined()
  })

  it('returns degraded when parquet getStats throws', async () => {
    let callCount = 0
    const brokenParquet = {
      getStats: () => {
        callCount++
        if (callCount === 1) {
          // First call (bloom check) succeeds
          return {
            bufferedObjects: 0,
            bufferedBytes: 0,
            parquetFiles: 0,
            bloom: { bloomItems: 0, bloomFalsePositiveRate: 0, bloomSegments: 1, exactCacheSize: 0 },
          }
        }
        // Second call (parquet check) throws
        throw new Error('R2 unavailable')
      },
    } as unknown as ParquetStore

    const instance = createMockInstance({ parquetStore: brokenParquet })
    const router = new Hono()
    setupRoutes(router, instance)

    const res = await router.request('/health')
    expect(res.status).toBe(200)

    const body = await res.json() as HealthCheckResponse
    expect(body.status).toBe('degraded')
    expect(body.components?.bloom?.status).toBe('ok')
    expect(body.components?.parquet?.status).toBe('degraded')
    expect(body.components?.parquet?.message).toBe('R2 unavailable')
  })

  it('includes uptime in the response', async () => {
    const instance = createMockInstance()
    const router = new Hono()
    setupRoutes(router, instance)

    const res = await router.request('/health')
    const body = await res.json() as HealthCheckResponse
    // Instance was created with _startTime = Date.now() - 10_000
    expect(body.uptime).toBeGreaterThanOrEqual(9_000)
    expect(body.uptime).toBeLessThan(20_000)
  })

  it('SQLite unhealthy overrides bloom/parquet degraded to produce unhealthy', async () => {
    const brokenStorage = createMockStorage({
      sqlExec: () => { throw new Error('readonly') },
    })
    // Even though parquet is fine, if SQLite is down it's unhealthy
    const instance = createMockInstance({ storage: brokenStorage })
    const router = new Hono()
    setupRoutes(router, instance)

    const res = await router.request('/health')
    expect(res.status).toBe(503)

    const body = await res.json() as HealthCheckResponse
    expect(body.status).toBe('unhealthy')
  })
})
