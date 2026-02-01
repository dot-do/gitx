import { describe, it, expect, beforeEach } from 'vitest'
import {
  LargeObjectStorage,
  type LargeObjectRef,
} from '../../src/storage/large-object'
import { buildR2Key, INLINE_THRESHOLD } from '../../src/storage/variant-codec'

// --- Mock R2 Bucket (reused pattern from r2-pack.test.ts) ---
class MockR2Bucket {
  private objects = new Map<string, { data: Uint8Array; etag: string }>()
  private counter = 0

  async put(key: string, data: ArrayBuffer | Uint8Array | ReadableStream | string): Promise<void> {
    let bytes: Uint8Array
    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data)
    } else if (data instanceof Uint8Array) {
      bytes = data
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data)
    } else {
      // ReadableStream
      const reader = (data as ReadableStream<Uint8Array>).getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      const total = chunks.reduce((s, c) => s + c.length, 0)
      bytes = new Uint8Array(total)
      let offset = 0
      for (const c of chunks) {
        bytes.set(c, offset)
        offset += c.length
      }
    }
    this.objects.set(key, { data: bytes, etag: `etag-${++this.counter}` })
  }

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; body: ReadableStream } | null> {
    const obj = this.objects.get(key)
    if (!obj) return null
    const data = obj.data
    return {
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(data)
          controller.close()
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
    for (const k of Array.isArray(key) ? key : [key]) {
      this.objects.delete(k)
    }
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }

  getData(key: string): Uint8Array | undefined {
    return this.objects.get(key)?.data
  }
}

// --- Helpers ---
function makeLargeBlob(size: number): Uint8Array {
  const buf = new Uint8Array(size)
  for (let i = 0; i < size; i++) buf[i] = i & 0xff
  return buf
}

async function sha256hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('LargeObjectStorage', () => {
  let bucket: MockR2Bucket
  let store: LargeObjectStorage

  beforeEach(() => {
    bucket = new MockR2Bucket()
    store = new LargeObjectStorage(bucket as unknown as R2Bucket)
  })

  // ---- upload ----

  describe('upload', () => {
    it('should upload a large object and return a ref', async () => {
      const data = makeLargeBlob(INLINE_THRESHOLD + 1)
      const sha = 'a'.repeat(40)

      const ref = await store.upload(sha, data)

      expect(ref).toBeDefined()
      expect(ref.r2Key).toBe(buildR2Key(sha))
      expect(ref.size).toBe(data.length)
    })

    it('should store the raw bytes in R2 at content-addressable key', async () => {
      const data = makeLargeBlob(2 * 1024 * 1024)
      const sha = 'ab' + 'c'.repeat(38)

      await store.upload(sha, data)

      const key = buildR2Key(sha)
      expect(bucket.has(key)).toBe(true)
      expect(bucket.getData(key)).toEqual(data)
    })

    it('should deduplicate: skip upload if key already exists', async () => {
      const data = makeLargeBlob(INLINE_THRESHOLD + 1)
      const sha = 'dd' + '0'.repeat(38)

      // first upload
      await store.upload(sha, data)
      // second upload -- should not throw, should return same ref
      const ref = await store.upload(sha, data)

      expect(ref.r2Key).toBe(buildR2Key(sha))
    })

    it('should accept a custom prefix', async () => {
      const prefixed = new LargeObjectStorage(bucket as unknown as R2Bucket, { prefix: 'repo/abc' })
      const data = makeLargeBlob(INLINE_THRESHOLD + 1)
      const sha = 'ff' + '0'.repeat(38)

      const ref = await prefixed.upload(sha, data)

      expect(ref.r2Key).toBe(buildR2Key(sha, 'repo/abc'))
      expect(bucket.has(ref.r2Key)).toBe(true)
    })
  })

  // ---- download ----

  describe('download', () => {
    it('should download previously uploaded bytes', async () => {
      const data = makeLargeBlob(INLINE_THRESHOLD + 10)
      const sha = 'bb' + '1'.repeat(38)
      const ref = await store.upload(sha, data)

      const downloaded = await store.download(ref.r2Key)

      expect(downloaded).toEqual(data)
    })

    it('should return null for missing key', async () => {
      const result = await store.download('objects/00/nonexistent')

      expect(result).toBeNull()
    })
  })

  // ---- downloadStream ----

  describe('downloadStream', () => {
    it('should return a ReadableStream of the object', async () => {
      const data = makeLargeBlob(INLINE_THRESHOLD + 1)
      const sha = 'cc' + '2'.repeat(38)
      await store.upload(sha, data)

      const stream = await store.downloadStream(buildR2Key(sha))

      expect(stream).toBeInstanceOf(ReadableStream)
      // consume
      const reader = stream!.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      const total = chunks.reduce((s, c) => s + c.length, 0)
      expect(total).toBe(data.length)
    })

    it('should return null for missing key', async () => {
      const stream = await store.downloadStream('objects/zz/missing')

      expect(stream).toBeNull()
    })
  })

  // ---- exists ----

  describe('exists', () => {
    it('should return true for uploaded object', async () => {
      const data = makeLargeBlob(INLINE_THRESHOLD + 1)
      const sha = 'ee' + '3'.repeat(38)
      await store.upload(sha, data)

      expect(await store.exists(buildR2Key(sha))).toBe(true)
    })

    it('should return false for missing object', async () => {
      expect(await store.exists('objects/zz/nope')).toBe(false)
    })
  })

  // ---- delete ----

  describe('delete', () => {
    it('should remove the object from R2', async () => {
      const data = makeLargeBlob(INLINE_THRESHOLD + 1)
      const sha = 'de' + '4'.repeat(38)
      const ref = await store.upload(sha, data)

      await store.delete(ref.r2Key)

      expect(await store.exists(ref.r2Key)).toBe(false)
    })
  })

  // ---- error handling ----

  describe('error handling', () => {
    class FailingPutR2Bucket extends MockR2Bucket {
      async put(): Promise<void> { throw new Error('R2 write failed') }
    }

    class FailingGetR2Bucket extends MockR2Bucket {
      async get(): Promise<null> { throw new Error('R2 read failed') }
    }

    it('upload when R2 put fails should throw', async () => {
      const failBucket = new FailingPutR2Bucket()
      const failStore = new LargeObjectStorage(failBucket as unknown as R2Bucket)
      const data = makeLargeBlob(INLINE_THRESHOLD + 1)
      const sha = 'fa' + '0'.repeat(38)

      await expect(failStore.upload(sha, data)).rejects.toThrow('R2 write failed')
    })

    it('download when R2 get fails should throw', async () => {
      const failBucket = new FailingGetR2Bucket()
      const failStore = new LargeObjectStorage(failBucket as unknown as R2Bucket)

      await expect(failStore.download('objects/00/missing')).rejects.toThrow('R2 read failed')
    })
  })
})
