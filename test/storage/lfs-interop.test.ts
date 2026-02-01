import { describe, it, expect, beforeEach } from 'vitest'
import {
  LfsInterop,
  generateLfsPointerFile,
  mapLfsOidToR2Key,
  type LfsBatchRequestObject,
  type LfsBatchResponse,
} from '../../src/storage/lfs-interop'
import { parseLfsPointer } from '../../src/storage/variant-codec'

// --- Mock R2 Bucket ---
class MockR2Bucket {
  private objects = new Map<string, { data: Uint8Array; etag: string }>()
  private counter = 0

  async put(key: string, data: ArrayBuffer | Uint8Array | string): Promise<void> {
    const bytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array ? data : new Uint8Array(data)
    this.objects.set(key, { data: bytes, etag: `etag-${++this.counter}` })
  }

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; body: ReadableStream } | null> {
    const obj = this.objects.get(key)
    if (!obj) return null
    const d = obj.data
    return {
      arrayBuffer: async () => d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength),
      body: new ReadableStream({ start(c) { c.enqueue(d); c.close() } }),
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

  has(key: string): boolean { return this.objects.has(key) }
  getData(key: string): Uint8Array | undefined { return this.objects.get(key)?.data }
}

// --- Helpers ---
const SAMPLE_OID = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // sha256 of empty
const SAMPLE_SIZE = 12345

function makeLfsPointerText(oid: string, size: number): string {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`
}

describe('LFS Interop', () => {
  let bucket: MockR2Bucket
  let interop: LfsInterop

  beforeEach(() => {
    bucket = new MockR2Bucket()
    interop = new LfsInterop(bucket as unknown as R2Bucket)
  })

  // ---- mapLfsOidToR2Key ----

  describe('mapLfsOidToR2Key', () => {
    it('should produce content-addressable R2 key from OID', () => {
      const key = mapLfsOidToR2Key(SAMPLE_OID)
      expect(key).toBe(`lfs/${SAMPLE_OID.slice(0, 2)}/${SAMPLE_OID.slice(2)}`)
    })

    it('should accept custom prefix', () => {
      const key = mapLfsOidToR2Key(SAMPLE_OID, 'custom-lfs')
      expect(key).toBe(`custom-lfs/${SAMPLE_OID.slice(0, 2)}/${SAMPLE_OID.slice(2)}`)
    })
  })

  // ---- generateLfsPointerFile ----

  describe('generateLfsPointerFile', () => {
    it('should produce a valid LFS pointer file', () => {
      const pointer = generateLfsPointerFile(SAMPLE_OID, SAMPLE_SIZE)
      const text = new TextDecoder().decode(pointer)

      expect(text).toContain('version https://git-lfs.github.com/spec/v1')
      expect(text).toContain(`oid sha256:${SAMPLE_OID}`)
      expect(text).toContain(`size ${SAMPLE_SIZE}`)
    })

    it('should round-trip through parseLfsPointer', () => {
      const pointer = generateLfsPointerFile(SAMPLE_OID, SAMPLE_SIZE)
      const parsed = parseLfsPointer(pointer)

      expect(parsed).not.toBeNull()
      expect(parsed!.oid).toBe(SAMPLE_OID)
      expect(parsed!.size).toBe(SAMPLE_SIZE)
    })
  })

  // ---- upload / download LFS object ----

  describe('uploadLfsObject', () => {
    it('should store raw data in R2 at LFS OID key', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])

      await interop.uploadLfsObject(SAMPLE_OID, data)

      const key = mapLfsOidToR2Key(SAMPLE_OID)
      expect(bucket.has(key)).toBe(true)
      expect(bucket.getData(key)).toEqual(data)
    })

    it('should deduplicate by OID', async () => {
      const data = new Uint8Array([10, 20, 30])

      await interop.uploadLfsObject(SAMPLE_OID, data)
      // second upload should not throw
      await interop.uploadLfsObject(SAMPLE_OID, data)

      expect(bucket.has(mapLfsOidToR2Key(SAMPLE_OID))).toBe(true)
    })
  })

  describe('downloadLfsObject', () => {
    it('should retrieve previously uploaded LFS data', async () => {
      const data = new Uint8Array([99, 100, 101])
      await interop.uploadLfsObject(SAMPLE_OID, data)

      const downloaded = await interop.downloadLfsObject(SAMPLE_OID)

      expect(downloaded).toEqual(data)
    })

    it('should return null for missing OID', async () => {
      const result = await interop.downloadLfsObject('0'.repeat(64))
      expect(result).toBeNull()
    })
  })

  // ---- LFS Batch API handler ----

  describe('handleBatchRequest (download)', () => {
    it('should return download actions for existing objects', async () => {
      const data = new Uint8Array(100).fill(0xab)
      await interop.uploadLfsObject(SAMPLE_OID, data)

      const response = await interop.handleBatchRequest({
        operation: 'download',
        objects: [{ oid: SAMPLE_OID, size: 100 }],
      })

      expect(response.objects).toHaveLength(1)
      expect(response.objects[0].oid).toBe(SAMPLE_OID)
      expect(response.objects[0].actions?.download).toBeDefined()
      expect(response.objects[0].actions?.download?.href).toContain(SAMPLE_OID)
    })

    it('should return error for missing objects', async () => {
      const response = await interop.handleBatchRequest({
        operation: 'download',
        objects: [{ oid: '0'.repeat(64), size: 100 }],
      })

      expect(response.objects[0].error).toBeDefined()
      expect(response.objects[0].error?.code).toBe(404)
    })
  })

  describe('handleBatchRequest (upload)', () => {
    it('should return upload actions for new objects', async () => {
      const response = await interop.handleBatchRequest({
        operation: 'upload',
        objects: [{ oid: SAMPLE_OID, size: 500 }],
      })

      expect(response.objects).toHaveLength(1)
      expect(response.objects[0].actions?.upload).toBeDefined()
      expect(response.objects[0].actions?.upload?.href).toContain(SAMPLE_OID)
    })

    it('should skip upload action for already-existing objects', async () => {
      const data = new Uint8Array(500).fill(0xcd)
      await interop.uploadLfsObject(SAMPLE_OID, data)

      const response = await interop.handleBatchRequest({
        operation: 'upload',
        objects: [{ oid: SAMPLE_OID, size: 500 }],
      })

      // No upload action needed -- object already stored
      expect(response.objects[0].actions?.upload).toBeUndefined()
    })
  })

  // ---- exists ----

  describe('existsLfsObject', () => {
    it('should return true when object exists', async () => {
      await interop.uploadLfsObject(SAMPLE_OID, new Uint8Array(10))
      expect(await interop.existsLfsObject(SAMPLE_OID)).toBe(true)
    })

    it('should return false when object missing', async () => {
      expect(await interop.existsLfsObject('f'.repeat(64))).toBe(false)
    })
  })
})
