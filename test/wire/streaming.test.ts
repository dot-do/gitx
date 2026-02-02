/**
 * @fileoverview Tests for Wire Protocol Streaming Support
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createBlobReadStream,
  createSideBandTransform,
  createSideBandExtractTransform,
  createPktLineTransform,
  createStreamingPackWriter,
  createProgressTransform,
  concatStreams,
  teeStream,
  isLargeBlob,
  StreamChannel,
  DEFAULT_CHUNK_SIZE,
  LARGE_BLOB_THRESHOLD,
  StreamingPackWriter,
} from '../../src/wire/streaming'

// Helper to collect a ReadableStream into a Uint8Array
async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

// Helper to create test data
function createTestData(size: number): Uint8Array {
  const data = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    data[i] = i % 256
  }
  return data
}

describe('Blob Streaming', () => {
  describe('createBlobReadStream', () => {
    it('should stream data in chunks', async () => {
      const data = createTestData(10000)
      const chunkSize = 2000 // Use value > MIN_CHUNK_SIZE (1024)
      const stream = createBlobReadStream(data, { chunkSize })

      const chunks: Uint8Array[] = []
      const reader = stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      // Should have multiple chunks
      expect(chunks.length).toBe(5)

      // Each chunk except last should be chunkSize
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i]!.length).toBe(chunkSize)
      }

      // Verify all data is present
      const collected = await collectStream(createBlobReadStream(data))
      expect(collected).toEqual(data)
    })

    it('should handle data smaller than chunk size', async () => {
      const data = createTestData(100)
      const stream = createBlobReadStream(data, { chunkSize: 1000 })

      const collected = await collectStream(stream)
      expect(collected).toEqual(data)
    })

    it('should use default chunk size when not specified', async () => {
      const data = createTestData(DEFAULT_CHUNK_SIZE * 2)
      const stream = createBlobReadStream(data)

      const chunks: Uint8Array[] = []
      const reader = stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      expect(chunks.length).toBe(2)
      expect(chunks[0]!.length).toBe(DEFAULT_CHUNK_SIZE)
    })

    it('should handle empty data', async () => {
      const data = new Uint8Array(0)
      const stream = createBlobReadStream(data)
      const collected = await collectStream(stream)
      expect(collected.length).toBe(0)
    })
  })

  describe('isLargeBlob', () => {
    it('should return true for large blobs', () => {
      expect(isLargeBlob(LARGE_BLOB_THRESHOLD + 1)).toBe(true)
      expect(isLargeBlob(LARGE_BLOB_THRESHOLD * 2)).toBe(true)
    })

    it('should return false for small blobs', () => {
      expect(isLargeBlob(LARGE_BLOB_THRESHOLD)).toBe(false)
      expect(isLargeBlob(LARGE_BLOB_THRESHOLD - 1)).toBe(false)
      expect(isLargeBlob(1000)).toBe(false)
    })
  })
})

describe('Side-band Streaming', () => {
  describe('createSideBandTransform', () => {
    it('should wrap data in side-band format', async () => {
      const data = new Uint8Array([0x01, 0x02, 0x03, 0x04])
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data)
          controller.close()
        },
      })

      const transform = createSideBandTransform(StreamChannel.PACK_DATA)
      const result = await collectStream(stream.pipeThrough(transform))

      // Check format: 4-byte hex length + 1-byte channel + data
      // Total: 4 + 1 + 4 = 9 = "0009"
      const decoder = new TextDecoder()
      const lengthHex = decoder.decode(result.subarray(0, 4))
      expect(lengthHex).toBe('0009')

      // Channel byte
      expect(result[4]).toBe(StreamChannel.PACK_DATA)

      // Payload
      expect(result.subarray(5)).toEqual(data)
    })

    it('should split large data into multiple packets', async () => {
      // Create data larger than max sideband payload
      const data = createTestData(70000)
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data)
          controller.close()
        },
      })

      const transform = createSideBandTransform(StreamChannel.PACK_DATA)
      const result = await collectStream(stream.pipeThrough(transform))

      // Should have produced multiple packets
      expect(result.length).toBeGreaterThan(data.length)

      // Parse the packets
      let offset = 0
      let packetCount = 0
      const decoder = new TextDecoder()

      while (offset < result.length) {
        const lengthHex = decoder.decode(result.subarray(offset, offset + 4))
        const length = parseInt(lengthHex, 16)
        expect(result[offset + 4]).toBe(StreamChannel.PACK_DATA)
        offset += length
        packetCount++
      }

      expect(packetCount).toBeGreaterThan(1)
    })

    it('should use the specified channel', async () => {
      const data = new Uint8Array([0x01])
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data)
          controller.close()
        },
      })

      const transform = createSideBandTransform(StreamChannel.PROGRESS)
      const result = await collectStream(stream.pipeThrough(transform))

      expect(result[4]).toBe(StreamChannel.PROGRESS)
    })
  })

  describe('createSideBandExtractTransform', () => {
    it('should extract pack data from side-band format', async () => {
      const originalData = new Uint8Array([0x01, 0x02, 0x03, 0x04])

      // Create side-band packet
      const encoder = new TextEncoder()
      const length = 4 + 1 + originalData.length
      const packet = new Uint8Array(length)
      packet.set(encoder.encode(length.toString(16).padStart(4, '0')), 0)
      packet[4] = StreamChannel.PACK_DATA
      packet.set(originalData, 5)

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(packet)
          controller.close()
        },
      })

      const transform = createSideBandExtractTransform()
      const result = await collectStream(stream.pipeThrough(transform))

      expect(result).toEqual(originalData)
    })

    it('should invoke progress callback for channel 2', async () => {
      const progressMessages: string[] = []
      const encoder = new TextEncoder()

      // Create progress message packet
      const message = 'Counting objects: 100%'
      const messageBytes = encoder.encode(message)
      const length = 4 + 1 + messageBytes.length
      const packet = new Uint8Array(length)
      packet.set(encoder.encode(length.toString(16).padStart(4, '0')), 0)
      packet[4] = StreamChannel.PROGRESS
      packet.set(messageBytes, 5)

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(packet)
          controller.close()
        },
      })

      const transform = createSideBandExtractTransform({
        onProgress: (msg) => progressMessages.push(msg),
      })

      await collectStream(stream.pipeThrough(transform))

      expect(progressMessages).toContain(message)
    })

    it('should invoke error callback for channel 3', async () => {
      const errorMessages: string[] = []
      const encoder = new TextEncoder()

      // Create error message packet
      const errorMsg = 'Error: repository not found'
      const errorBytes = encoder.encode(errorMsg)
      const length = 4 + 1 + errorBytes.length
      const packet = new Uint8Array(length)
      packet.set(encoder.encode(length.toString(16).padStart(4, '0')), 0)
      packet[4] = StreamChannel.ERROR
      packet.set(errorBytes, 5)

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(packet)
          controller.close()
        },
      })

      const transform = createSideBandExtractTransform({
        onError: (msg) => errorMessages.push(msg),
      })

      await collectStream(stream.pipeThrough(transform))

      expect(errorMessages).toContain(errorMsg)
    })
  })
})

describe('Pkt-line Streaming', () => {
  describe('createPktLineTransform', () => {
    it('should wrap data in pkt-line format', async () => {
      const data = new TextEncoder().encode('hello\n')
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data)
          controller.close()
        },
      })

      const transform = createPktLineTransform()
      const result = await collectStream(stream.pipeThrough(transform))

      const decoder = new TextDecoder()
      // Length should be 4 + 6 = 10 = "000a"
      const lengthHex = decoder.decode(result.subarray(0, 4))
      expect(lengthHex).toBe('000a')

      const payload = decoder.decode(result.subarray(4))
      expect(payload).toBe('hello\n')
    })
  })
})

describe('Streaming Pack Writer', () => {
  describe('StreamingPackWriter', () => {
    it('should create a valid pack header', async () => {
      const writer = createStreamingPackWriter(2)
      const decoder = new TextDecoder()

      await writer.writeObject({
        sha: 'a'.repeat(40),
        type: 'blob',
        data: new Uint8Array([0x01, 0x02]),
        size: 2,
      })

      await writer.writeObject({
        sha: 'b'.repeat(40),
        type: 'blob',
        data: new Uint8Array([0x03, 0x04]),
        size: 2,
      })

      const packData = await writer.finalizeToBuffer()

      // Check PACK signature
      expect(decoder.decode(packData.subarray(0, 4))).toBe('PACK')

      // Check version (should be 2)
      const view = new DataView(packData.buffer, packData.byteOffset)
      expect(view.getUint32(4, false)).toBe(2)

      // Check object count
      expect(view.getUint32(8, false)).toBe(2)
    })

    it('should track object count', async () => {
      const writer = createStreamingPackWriter(3)

      expect(writer.currentObjectCount).toBe(0)

      await writer.writeObject({
        sha: 'a'.repeat(40),
        type: 'blob',
        data: new Uint8Array([0x01]),
        size: 1,
      })

      expect(writer.currentObjectCount).toBe(1)
    })

    it('should throw when writing after finalization', async () => {
      const writer = createStreamingPackWriter(1)

      await writer.writeObject({
        sha: 'a'.repeat(40),
        type: 'blob',
        data: new Uint8Array([0x01]),
        size: 1,
      })

      await writer.finalize()

      await expect(
        writer.writeObject({
          sha: 'b'.repeat(40),
          type: 'blob',
          data: new Uint8Array([0x02]),
          size: 1,
        })
      ).rejects.toThrow('finalized')
    })

    it('should throw when object count exceeds declared count', async () => {
      const writer = createStreamingPackWriter(1)

      await writer.writeObject({
        sha: 'a'.repeat(40),
        type: 'blob',
        data: new Uint8Array([0x01]),
        size: 1,
      })

      await expect(
        writer.writeObject({
          sha: 'b'.repeat(40),
          type: 'blob',
          data: new Uint8Array([0x02]),
          size: 1,
        })
      ).rejects.toThrow('exceeded')
    })

    it('should throw when finalizing with wrong object count', async () => {
      const writer = createStreamingPackWriter(2)

      await writer.writeObject({
        sha: 'a'.repeat(40),
        type: 'blob',
        data: new Uint8Array([0x01]),
        size: 1,
      })

      await expect(writer.finalize()).rejects.toThrow('Expected 2 objects')
    })

    it('should handle streaming data', async () => {
      const writer = createStreamingPackWriter(1)
      const data = new Uint8Array([0x01, 0x02, 0x03])

      const dataStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data)
          controller.close()
        },
      })

      await writer.writeObject({
        sha: 'a'.repeat(40),
        type: 'blob',
        data: dataStream,
        size: 3,
      })

      const packData = await writer.finalizeToBuffer()

      // Should produce valid pack
      const decoder = new TextDecoder()
      expect(decoder.decode(packData.subarray(0, 4))).toBe('PACK')
    })

    it('should support different object types', async () => {
      const writer = createStreamingPackWriter(4)

      await writer.writeObject({
        sha: 'a'.repeat(40),
        type: 'commit',
        data: new Uint8Array([0x01]),
        size: 1,
      })

      await writer.writeObject({
        sha: 'b'.repeat(40),
        type: 'tree',
        data: new Uint8Array([0x02]),
        size: 1,
      })

      await writer.writeObject({
        sha: 'c'.repeat(40),
        type: 'blob',
        data: new Uint8Array([0x03]),
        size: 1,
      })

      await writer.writeObject({
        sha: 'd'.repeat(40),
        type: 'tag',
        data: new Uint8Array([0x04]),
        size: 1,
      })

      const packData = await writer.finalizeToBuffer()

      // Check object count
      const view = new DataView(packData.buffer, packData.byteOffset)
      expect(view.getUint32(8, false)).toBe(4)
    })

    it('should return stream from finalize()', async () => {
      const writer = createStreamingPackWriter(1)

      await writer.writeObject({
        sha: 'a'.repeat(40),
        type: 'blob',
        data: new Uint8Array([0x01]),
        size: 1,
      })

      const stream = await writer.finalize()
      expect(stream).toBeInstanceOf(ReadableStream)

      const data = await collectStream(stream)
      expect(data.length).toBeGreaterThan(12 + 20) // Header + checksum
    })
  })
})

describe('Utility Functions', () => {
  describe('createProgressTransform', () => {
    it('should invoke progress callback', async () => {
      const progressCalls: number[] = []
      const data = createTestData(10000)

      const source = createBlobReadStream(data, { chunkSize: 2000 }) // Use value > MIN_CHUNK_SIZE (1024)
      const transform = createProgressTransform((bytes) => {
        progressCalls.push(bytes)
      })

      await collectStream(source.pipeThrough(transform))

      expect(progressCalls.length).toBe(5)
      expect(progressCalls[progressCalls.length - 1]).toBe(10000)
    })

    it('should pass total size to callback', async () => {
      const progressCalls: [number, number | undefined][] = []
      const data = createTestData(500)

      const source = createBlobReadStream(data, { chunkSize: 100 })
      const transform = createProgressTransform(
        (bytes, total) => progressCalls.push([bytes, total]),
        500
      )

      await collectStream(source.pipeThrough(transform))

      for (const [, total] of progressCalls) {
        expect(total).toBe(500)
      }
    })
  })

  describe('concatStreams', () => {
    it('should concatenate multiple streams', async () => {
      const data1 = new Uint8Array([1, 2, 3])
      const data2 = new Uint8Array([4, 5, 6])
      const data3 = new Uint8Array([7, 8, 9])

      const stream1 = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data1)
          controller.close()
        },
      })

      const stream2 = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data2)
          controller.close()
        },
      })

      const stream3 = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data3)
          controller.close()
        },
      })

      const combined = concatStreams([stream1, stream2, stream3])
      const result = await collectStream(combined)

      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))
    })

    it('should handle empty streams array', async () => {
      const combined = concatStreams([])
      const result = await collectStream(combined)
      expect(result.length).toBe(0)
    })
  })

  describe('teeStream', () => {
    it('should create two streams with same data', async () => {
      const data = createTestData(100)
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data)
          controller.close()
        },
      })

      const [stream1, stream2] = teeStream(source)

      const result1 = await collectStream(stream1)
      const result2 = await collectStream(stream2)

      expect(result1).toEqual(data)
      expect(result2).toEqual(data)
    })
  })
})
