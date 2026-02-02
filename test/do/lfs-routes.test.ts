import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import {
  setupLfsRoutes,
  handleLfsBatch,
  handleLfsUpload,
  handleLfsDownload,
  handleLfsVerify,
  type GitRepoDOInstance,
} from '../../src/do/routes'
import type { ParquetStore } from '../../src/storage/parquet-store'
import type { LfsBatchRequest, LfsBatchResponse } from '../../src/storage/lfs-interop'

// ============================================================================
// Mock R2 Bucket
// ============================================================================

class MockR2Bucket {
  private objects = new Map<string, { data: Uint8Array; etag: string }>()
  private counter = 0

  async put(key: string, data: ArrayBuffer | Uint8Array | string): Promise<void> {
    const bytes =
      typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data)
    this.objects.set(key, { data: bytes, etag: `etag-${++this.counter}` })
  }

  async get(
    key: string
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; body: ReadableStream } | null> {
    const obj = this.objects.get(key)
    if (!obj) return null
    const d = obj.data
    return {
      arrayBuffer: async () => d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength),
      body: new ReadableStream({
        start(c) {
          c.enqueue(d)
          c.close()
        },
      }),
    }
  }

  async head(key: string): Promise<{ size: number; etag: string } | null> {
    const obj = this.objects.get(key)
    if (!obj) return null
    return { size: obj.data.length, etag: obj.etag }
  }

  async delete(key: string | string[]): Promise<void> {
    for (const k of Array.isArray(key) ? key : [key]) this.objects.delete(k)
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }

  getData(key: string): Uint8Array | undefined {
    return this.objects.get(key)?.data
  }
}

// ============================================================================
// Helpers
// ============================================================================

const SAMPLE_OID = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const SAMPLE_SIZE = 12345

/**
 * Create a minimal mock storage.
 */
function createMockStorage() {
  return {
    get: async () => undefined,
    put: async () => {},
    delete: async () => false,
    list: async () => new Map(),
    sql: {
      exec: () => ({ toArray: () => [] }),
    },
  }
}

/**
 * Create a mock ParquetStore-like object.
 */
function createMockParquetStore(): ParquetStore {
  return {
    getStats: () => ({
      bufferedObjects: 0,
      bufferedBytes: 0,
      parquetFiles: 0,
      bloom: {
        bloomItems: 0,
        bloomFalsePositiveRate: 0,
        bloomSegments: 0,
        exactCacheSize: 0,
      },
    }),
  } as unknown as ParquetStore
}

/**
 * Create a GitRepoDOInstance mock for testing.
 */
function createMockInstance(overrides?: {
  analyticsBucket?: R2Bucket | undefined
}): GitRepoDOInstance {
  const storage = createMockStorage()
  const capabilities = new Set(['git', 'lfs'])

  return {
    $type: 'GitRepoDO',
    ns: 'github:test/repo',
    _startTime: Date.now() - 10_000,
    getCapabilities: () => capabilities,
    getStorage: () => storage as any,
    getAnalyticsBucket: () => overrides?.analyticsBucket,
    getParquetStore: () => createMockParquetStore(),
    initialize: async () => {},
    waitUntil: () => {},
    scheduleCompaction: () => false,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('LFS Routes', () => {
  let bucket: MockR2Bucket
  let instance: GitRepoDOInstance
  let router: Hono

  beforeEach(() => {
    bucket = new MockR2Bucket()
    instance = createMockInstance({ analyticsBucket: bucket as unknown as R2Bucket })
    router = new Hono()
    setupLfsRoutes(router, instance)
  })

  describe('POST /objects/batch', () => {
    it('returns 422 for invalid operation', async () => {
      const res = await router.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'invalid', objects: [] }),
      })
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.message).toContain('Invalid operation')
    })

    it('returns 422 for empty objects array', async () => {
      const res = await router.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'download', objects: [] }),
      })
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.message).toContain('Objects array is required')
    })

    it('returns 422 for invalid oid format', async () => {
      const res = await router.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'download',
          objects: [{ oid: 'invalid', size: 100 }],
        }),
      })
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.message).toContain('Invalid oid')
    })

    it('returns 422 for negative size', async () => {
      const res = await router.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'download',
          objects: [{ oid: SAMPLE_OID, size: -1 }],
        }),
      })
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.message).toContain('Invalid size')
    })

    it('returns download error for missing object', async () => {
      const res = await router.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'download',
          objects: [{ oid: SAMPLE_OID, size: SAMPLE_SIZE }],
        }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as LfsBatchResponse
      expect(body.transfer).toBe('basic')
      expect(body.objects).toHaveLength(1)
      expect(body.objects[0].error?.code).toBe(404)
      expect(body.objects[0].error?.message).toContain('not found')
    })

    it('returns download action for existing object', async () => {
      // Pre-populate the bucket with an LFS object
      const key = `lfs/${SAMPLE_OID.slice(0, 2)}/${SAMPLE_OID.slice(2)}`
      await bucket.put(key, new Uint8Array(100))

      const res = await router.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'download',
          objects: [{ oid: SAMPLE_OID, size: 100 }],
        }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as LfsBatchResponse
      expect(body.objects).toHaveLength(1)
      expect(body.objects[0].actions?.download).toBeDefined()
      expect(body.objects[0].actions?.download?.href).toContain(SAMPLE_OID)
      expect(body.objects[0].actions?.download?.expires_in).toBe(3600)
    })

    it('returns upload action for new object', async () => {
      const res = await router.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'upload',
          objects: [{ oid: SAMPLE_OID, size: SAMPLE_SIZE }],
        }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as LfsBatchResponse
      expect(body.objects).toHaveLength(1)
      expect(body.objects[0].actions?.upload).toBeDefined()
      expect(body.objects[0].actions?.upload?.href).toContain(SAMPLE_OID)
    })

    it('skips upload action for existing object', async () => {
      // Pre-populate the bucket
      const key = `lfs/${SAMPLE_OID.slice(0, 2)}/${SAMPLE_OID.slice(2)}`
      await bucket.put(key, new Uint8Array(100))

      const res = await router.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'upload',
          objects: [{ oid: SAMPLE_OID, size: 100 }],
        }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as LfsBatchResponse
      expect(body.objects).toHaveLength(1)
      expect(body.objects[0].actions?.upload).toBeUndefined()
    })
  })

  describe('PUT /lfs/objects/:oid', () => {
    it('returns 400 for invalid OID format', async () => {
      const res = await router.request('/lfs/objects/invalid', {
        method: 'PUT',
        body: new Uint8Array(10),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.message).toContain('Invalid OID')
    })

    it('uploads object to R2', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const res = await router.request(`/lfs/objects/${SAMPLE_OID}`, {
        method: 'PUT',
        body: data,
      })
      expect(res.status).toBe(200)

      // Verify object was stored
      const key = `lfs/${SAMPLE_OID.slice(0, 2)}/${SAMPLE_OID.slice(2)}`
      expect(bucket.has(key)).toBe(true)
      expect(bucket.getData(key)).toEqual(data)
    })
  })

  describe('GET /lfs/objects/:oid', () => {
    it('returns 400 for invalid OID format', async () => {
      const res = await router.request('/lfs/objects/invalid', {
        method: 'GET',
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.message).toContain('Invalid OID')
    })

    it('returns 404 for missing object', async () => {
      const res = await router.request(`/lfs/objects/${SAMPLE_OID}`, {
        method: 'GET',
      })
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.message).toContain('not found')
    })

    it('downloads object from R2', async () => {
      // Pre-populate the bucket
      const data = new Uint8Array([10, 20, 30, 40, 50])
      const key = `lfs/${SAMPLE_OID.slice(0, 2)}/${SAMPLE_OID.slice(2)}`
      await bucket.put(key, data)

      const res = await router.request(`/lfs/objects/${SAMPLE_OID}`, {
        method: 'GET',
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
      expect(res.headers.get('X-LFS-OID')).toBe(SAMPLE_OID)

      const body = new Uint8Array(await res.arrayBuffer())
      expect(body).toEqual(data)
    })
  })

  describe('POST /lfs/verify', () => {
    it('returns 400 for invalid OID format', async () => {
      const res = await router.request('/lfs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oid: 'invalid', size: 100 }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.message).toContain('Invalid OID')
    })

    it('returns 404 for missing object', async () => {
      const res = await router.request('/lfs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oid: SAMPLE_OID, size: 100 }),
      })
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.message).toContain('not found')
    })

    it('returns 200 for existing object', async () => {
      // Pre-populate the bucket
      const key = `lfs/${SAMPLE_OID.slice(0, 2)}/${SAMPLE_OID.slice(2)}`
      await bucket.put(key, new Uint8Array(100))

      const res = await router.request('/lfs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oid: SAMPLE_OID, size: 100 }),
      })
      expect(res.status).toBe(200)
    })
  })

  describe('LFS without R2 bucket', () => {
    it('returns 507 when R2 bucket is not configured', async () => {
      const noBucketInstance = createMockInstance({ analyticsBucket: undefined })
      const noBucketRouter = new Hono()
      setupLfsRoutes(noBucketRouter, noBucketInstance)

      const res = await noBucketRouter.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'download',
          objects: [{ oid: SAMPLE_OID, size: 100 }],
        }),
      })
      expect(res.status).toBe(507)
      const body = (await res.json()) as LfsBatchResponse
      expect(body.objects[0].error?.code).toBe(507)
      expect(body.objects[0].error?.message).toContain('not configured')
    })

    it('upload returns 507 when R2 bucket is not configured', async () => {
      const noBucketInstance = createMockInstance({ analyticsBucket: undefined })
      const noBucketRouter = new Hono()
      setupLfsRoutes(noBucketRouter, noBucketInstance)

      const res = await noBucketRouter.request(`/lfs/objects/${SAMPLE_OID}`, {
        method: 'PUT',
        body: new Uint8Array(10),
      })
      expect(res.status).toBe(507)
    })

    it('download returns 507 when R2 bucket is not configured', async () => {
      const noBucketInstance = createMockInstance({ analyticsBucket: undefined })
      const noBucketRouter = new Hono()
      setupLfsRoutes(noBucketRouter, noBucketInstance)

      const res = await noBucketRouter.request(`/lfs/objects/${SAMPLE_OID}`, {
        method: 'GET',
      })
      expect(res.status).toBe(507)
    })

    it('verify returns 507 when R2 bucket is not configured', async () => {
      const noBucketInstance = createMockInstance({ analyticsBucket: undefined })
      const noBucketRouter = new Hono()
      setupLfsRoutes(noBucketRouter, noBucketInstance)

      const res = await noBucketRouter.request('/lfs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oid: SAMPLE_OID, size: 100 }),
      })
      expect(res.status).toBe(507)
    })
  })

  describe('LFS round-trip', () => {
    it('uploads and downloads an object successfully', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

      // 1. Check if upload is needed via batch API
      const batchRes = await router.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'upload',
          objects: [{ oid: SAMPLE_OID, size: testData.length }],
        }),
      })
      expect(batchRes.status).toBe(200)
      const batchBody = (await batchRes.json()) as LfsBatchResponse
      expect(batchBody.objects[0].actions?.upload).toBeDefined()

      // 2. Upload the object
      const uploadRes = await router.request(`/lfs/objects/${SAMPLE_OID}`, {
        method: 'PUT',
        body: testData,
      })
      expect(uploadRes.status).toBe(200)

      // 3. Verify the upload
      const verifyRes = await router.request('/lfs/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oid: SAMPLE_OID, size: testData.length }),
      })
      expect(verifyRes.status).toBe(200)

      // 4. Check batch API for download
      const downloadBatchRes = await router.request('/objects/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'download',
          objects: [{ oid: SAMPLE_OID, size: testData.length }],
        }),
      })
      expect(downloadBatchRes.status).toBe(200)
      const downloadBatchBody = (await downloadBatchRes.json()) as LfsBatchResponse
      expect(downloadBatchBody.objects[0].actions?.download).toBeDefined()

      // 5. Download the object
      const downloadRes = await router.request(`/lfs/objects/${SAMPLE_OID}`, {
        method: 'GET',
      })
      expect(downloadRes.status).toBe(200)

      const downloadedData = new Uint8Array(await downloadRes.arrayBuffer())
      expect(downloadedData).toEqual(testData)
    })
  })
})
