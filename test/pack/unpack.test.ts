import { describe, it, expect } from 'vitest'
import {
  unpackPackfile,
  iteratePackfile,
  computeObjectSha,
  bytesToHex,
  packTypeToObjectType,
  type UnpackedObject,
  type UnpackOptions,
} from '../../src/pack/unpack'
import { createPackfile, PackObjectType, encodeTypeAndSize } from '../../src/pack/format'
import { createDelta } from '../../src/pack/delta'
import { sha1 } from '../../src/utils/sha1'
import pako from 'pako'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a test packfile with the given objects.
 */
function createTestPackfile(
  objects: Array<{ type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>
): Uint8Array {
  return createPackfile(
    objects.map((obj) => ({
      type: obj.type,
      data: obj.data,
    }))
  )
}

/**
 * Creates a packfile with OFS_DELTA objects.
 */
function createPackfileWithOfsDelta(
  baseObject: { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array },
  deltaTarget: Uint8Array
): Uint8Array {
  const parts: Uint8Array[] = []

  // Header: PACK, version 2, 2 objects
  const header = new Uint8Array(12)
  header[0] = 0x50 // P
  header[1] = 0x41 // A
  header[2] = 0x43 // C
  header[3] = 0x4b // K
  header[4] = 0
  header[5] = 0
  header[6] = 0
  header[7] = 2
  header[8] = 0
  header[9] = 0
  header[10] = 0
  header[11] = 2 // 2 objects
  parts.push(header)

  // First object: base (full object)
  const baseType =
    baseObject.type === 'blob'
      ? PackObjectType.OBJ_BLOB
      : baseObject.type === 'tree'
      ? PackObjectType.OBJ_TREE
      : baseObject.type === 'commit'
      ? PackObjectType.OBJ_COMMIT
      : PackObjectType.OBJ_TAG

  const baseTypeAndSize = encodeTypeAndSize(baseType, baseObject.data.length)
  const baseCompressed = pako.deflate(baseObject.data)
  parts.push(baseTypeAndSize)
  parts.push(baseCompressed)

  // Calculate base object's position
  const baseStart = 12 // After header
  const deltaStart = 12 + baseTypeAndSize.length + baseCompressed.length

  // Second object: OFS_DELTA referencing the base
  const deltaData = createDelta(baseObject.data, deltaTarget)
  const deltaTypeAndSize = encodeTypeAndSize(
    PackObjectType.OBJ_OFS_DELTA,
    deltaData.length
  )

  // Encode relative offset (delta position - base position)
  const relativeOffset = deltaStart - baseStart
  const offsetEncoded = encodeOfsOffset(relativeOffset)

  const deltaCompressed = pako.deflate(deltaData)
  parts.push(deltaTypeAndSize)
  parts.push(offsetEncoded)
  parts.push(deltaCompressed)

  // Combine parts
  let totalLength = 0
  for (const part of parts) {
    totalLength += part.length
  }
  const packContent = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    packContent.set(part, offset)
    offset += part.length
  }

  // Add checksum
  const checksum = sha1(packContent)
  const finalPack = new Uint8Array(packContent.length + 20)
  finalPack.set(packContent, 0)
  finalPack.set(checksum, packContent.length)

  return finalPack
}

/**
 * Encodes an offset for OFS_DELTA.
 */
function encodeOfsOffset(offset: number): Uint8Array {
  const bytes: number[] = []

  // First byte: 7 bits of offset (no continuation)
  bytes.push(offset & 0x7f)
  offset >>>= 7

  // Subsequent bytes: continuation bit + 7 bits
  // Subtract 1 to avoid ambiguity in encoding
  while (offset > 0) {
    offset -= 1
    bytes.unshift((offset & 0x7f) | 0x80)
    offset >>>= 7
  }

  return new Uint8Array(bytes)
}

/**
 * Computes the expected SHA for an object.
 */
function expectedSha(
  type: 'blob' | 'tree' | 'commit' | 'tag',
  data: Uint8Array
): string {
  return computeObjectSha(type, data)
}

// ============================================================================
// Tests
// ============================================================================

describe('Packfile Unpacking', () => {
  describe('computeObjectSha', () => {
    it('should compute correct SHA for blob', () => {
      const data = new TextEncoder().encode('hello world')
      const sha = computeObjectSha('blob', data)
      // Git: echo -n "hello world" | git hash-object --stdin
      // Should be: 95d09f2b10159347eece71399a7e2e907ea3df4f
      expect(sha).toBe('95d09f2b10159347eece71399a7e2e907ea3df4f')
    })

    it('should compute correct SHA for empty blob', () => {
      const sha = computeObjectSha('blob', new Uint8Array(0))
      // Git: git hash-object -t blob /dev/null
      // Empty blob: e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
      expect(sha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    })
  })

  describe('bytesToHex', () => {
    it('should convert bytes to hex', () => {
      const bytes = new Uint8Array([0x00, 0xff, 0xab, 0xcd])
      expect(bytesToHex(bytes)).toBe('00ffabcd')
    })

    it('should handle empty array', () => {
      expect(bytesToHex(new Uint8Array(0))).toBe('')
    })
  })

  describe('packTypeToObjectType', () => {
    it('should convert commit type', () => {
      expect(packTypeToObjectType(PackObjectType.OBJ_COMMIT)).toBe('commit')
    })

    it('should convert tree type', () => {
      expect(packTypeToObjectType(PackObjectType.OBJ_TREE)).toBe('tree')
    })

    it('should convert blob type', () => {
      expect(packTypeToObjectType(PackObjectType.OBJ_BLOB)).toBe('blob')
    })

    it('should convert tag type', () => {
      expect(packTypeToObjectType(PackObjectType.OBJ_TAG)).toBe('tag')
    })

    it('should throw for delta types', () => {
      expect(() =>
        packTypeToObjectType(PackObjectType.OBJ_OFS_DELTA)
      ).toThrow()
      expect(() =>
        packTypeToObjectType(PackObjectType.OBJ_REF_DELTA)
      ).toThrow()
    })
  })

  describe('unpackPackfile - basic objects', () => {
    it('should unpack a single blob', async () => {
      const blobData = new TextEncoder().encode('hello world')
      const packfile = createTestPackfile([{ type: 'blob', data: blobData }])

      const result = await unpackPackfile(packfile)

      expect(result.objectCount).toBe(1)
      expect(result.version).toBe(2)
      expect(result.checksumValid).toBe(true)
      expect(result.objects).toHaveLength(1)

      const obj = result.objects[0]!
      expect(obj.type).toBe('blob')
      expect(obj.data).toEqual(blobData)
      expect(obj.sha).toBe(expectedSha('blob', blobData))
    })

    it('should unpack multiple blobs', async () => {
      const blob1 = new TextEncoder().encode('first blob')
      const blob2 = new TextEncoder().encode('second blob')
      const blob3 = new TextEncoder().encode('third blob')

      const packfile = createTestPackfile([
        { type: 'blob', data: blob1 },
        { type: 'blob', data: blob2 },
        { type: 'blob', data: blob3 },
      ])

      const result = await unpackPackfile(packfile)

      expect(result.objectCount).toBe(3)
      expect(result.objects).toHaveLength(3)

      expect(result.objects[0]!.data).toEqual(blob1)
      expect(result.objects[1]!.data).toEqual(blob2)
      expect(result.objects[2]!.data).toEqual(blob3)
    })

    it('should unpack different object types', async () => {
      const blobData = new TextEncoder().encode('file content')
      // Simplified tree entry: mode SP name NUL sha (20 bytes)
      const treeData = new Uint8Array([
        ...new TextEncoder().encode('100644 file.txt\0'),
        ...new Uint8Array(20), // placeholder SHA
      ])
      const commitData = new TextEncoder().encode(
        'tree 0000000000000000000000000000000000000000\n' +
          'author Test <test@test.com> 1234567890 +0000\n' +
          'committer Test <test@test.com> 1234567890 +0000\n\n' +
          'Test commit'
      )

      const packfile = createTestPackfile([
        { type: 'blob', data: blobData },
        { type: 'tree', data: treeData },
        { type: 'commit', data: commitData },
      ])

      const result = await unpackPackfile(packfile)

      expect(result.objectCount).toBe(3)
      expect(result.objects[0]!.type).toBe('blob')
      expect(result.objects[1]!.type).toBe('tree')
      expect(result.objects[2]!.type).toBe('commit')
    })

    it('should unpack empty blob', async () => {
      const packfile = createTestPackfile([
        { type: 'blob', data: new Uint8Array(0) },
      ])

      const result = await unpackPackfile(packfile)

      expect(result.objects[0]!.data).toEqual(new Uint8Array(0))
      expect(result.objects[0]!.sha).toBe(
        'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
      )
    })

    it('should unpack large blob', async () => {
      const largeBlob = new Uint8Array(100000)
      for (let i = 0; i < largeBlob.length; i++) {
        largeBlob[i] = i % 256
      }

      const packfile = createTestPackfile([{ type: 'blob', data: largeBlob }])

      const result = await unpackPackfile(packfile)

      expect(result.objects[0]!.data).toEqual(largeBlob)
    })
  })

  describe('unpackPackfile - OFS_DELTA', () => {
    it('should unpack OFS_DELTA with appended data', async () => {
      const baseData = new TextEncoder().encode('hello')
      const targetData = new TextEncoder().encode('hello world')

      const packfile = createPackfileWithOfsDelta(
        { type: 'blob', data: baseData },
        targetData
      )

      const result = await unpackPackfile(packfile)

      expect(result.objectCount).toBe(2)
      expect(result.objects).toHaveLength(2)

      // First object is the base
      expect(result.objects[0]!.data).toEqual(baseData)
      expect(result.objects[0]!.type).toBe('blob')

      // Second object is the resolved delta
      expect(result.objects[1]!.data).toEqual(targetData)
      expect(result.objects[1]!.type).toBe('blob')
      expect(result.objects[1]!.sha).toBe(expectedSha('blob', targetData))
    })

    it('should unpack OFS_DELTA with modified data', async () => {
      const baseData = new TextEncoder().encode('The quick brown fox')
      const targetData = new TextEncoder().encode('The quick brown dog')

      const packfile = createPackfileWithOfsDelta(
        { type: 'blob', data: baseData },
        targetData
      )

      const result = await unpackPackfile(packfile)

      expect(result.objects[1]!.data).toEqual(targetData)
    })

    it('should unpack OFS_DELTA with prepended data', async () => {
      const baseData = new TextEncoder().encode('world')
      const targetData = new TextEncoder().encode('hello world')

      const packfile = createPackfileWithOfsDelta(
        { type: 'blob', data: baseData },
        targetData
      )

      const result = await unpackPackfile(packfile)

      expect(result.objects[1]!.data).toEqual(targetData)
    })

    it('should preserve base object type in delta result', async () => {
      const commitBase = new TextEncoder().encode(
        'tree 0000000000000000000000000000000000000000\n' +
          'author A <a@a.com> 1 +0000\n' +
          'committer A <a@a.com> 1 +0000\n\n' +
          'Initial'
      )
      const commitTarget = new TextEncoder().encode(
        'tree 0000000000000000000000000000000000000000\n' +
          'author A <a@a.com> 1 +0000\n' +
          'committer A <a@a.com> 1 +0000\n\n' +
          'Initial commit'
      )

      const packfile = createPackfileWithOfsDelta(
        { type: 'commit', data: commitBase },
        commitTarget
      )

      const result = await unpackPackfile(packfile)

      expect(result.objects[0]!.type).toBe('commit')
      expect(result.objects[1]!.type).toBe('commit')
    })
  })

  describe('unpackPackfile - validation', () => {
    it('should reject packfile that is too short', async () => {
      const shortData = new Uint8Array(20)
      await expect(unpackPackfile(shortData)).rejects.toThrow('too short')
    })

    it('should reject packfile with invalid signature', async () => {
      const invalidPack = new Uint8Array(100)
      invalidPack[0] = 0x00 // Not 'P'

      await expect(unpackPackfile(invalidPack)).rejects.toThrow('signature')
    })

    it('should reject packfile with invalid checksum', async () => {
      const blobData = new TextEncoder().encode('test')
      const packfile = createTestPackfile([{ type: 'blob', data: blobData }])

      // Corrupt the checksum
      packfile[packfile.length - 1] ^= 0xff

      await expect(unpackPackfile(packfile)).rejects.toThrow('checksum')
    })

    it('should allow skipping checksum verification', async () => {
      const blobData = new TextEncoder().encode('test')
      const packfile = createTestPackfile([{ type: 'blob', data: blobData }])

      // Corrupt the checksum
      packfile[packfile.length - 1] ^= 0xff

      // Should not throw with verification disabled
      const result = await unpackPackfile(packfile, { verifyChecksum: false })
      expect(result.objects).toHaveLength(1)
    })
  })

  describe('iteratePackfile', () => {
    it('should iterate through objects', async () => {
      const blob1 = new TextEncoder().encode('first')
      const blob2 = new TextEncoder().encode('second')

      const packfile = createTestPackfile([
        { type: 'blob', data: blob1 },
        { type: 'blob', data: blob2 },
      ])

      const objects: UnpackedObject[] = []
      for await (const obj of iteratePackfile(packfile)) {
        objects.push(obj)
      }

      expect(objects).toHaveLength(2)
      expect(objects[0]!.data).toEqual(blob1)
      expect(objects[1]!.data).toEqual(blob2)
    })

    it('should handle empty packfile (0 objects)', async () => {
      // Create a pack with 0 objects
      const header = new Uint8Array(12)
      header[0] = 0x50 // P
      header[1] = 0x41 // A
      header[2] = 0x43 // C
      header[3] = 0x4b // K
      header[4] = 0
      header[5] = 0
      header[6] = 0
      header[7] = 2
      header[8] = 0
      header[9] = 0
      header[10] = 0
      header[11] = 0 // 0 objects

      const checksum = sha1(header)
      const packfile = new Uint8Array(header.length + 20)
      packfile.set(header, 0)
      packfile.set(checksum, header.length)

      const objects: UnpackedObject[] = []
      for await (const obj of iteratePackfile(packfile)) {
        objects.push(obj)
      }

      expect(objects).toHaveLength(0)
    })
  })

  describe('delta chain depth limit', () => {
    it('should respect maxDeltaDepth option', async () => {
      // Create a pack with a deep delta chain would require
      // more complex setup. For now, test that the option is accepted.
      const blobData = new TextEncoder().encode('test')
      const packfile = createTestPackfile([{ type: 'blob', data: blobData }])

      const result = await unpackPackfile(packfile, { maxDeltaDepth: 10 })
      expect(result.objects).toHaveLength(1)
    })
  })

  describe('round-trip with createPackfile', () => {
    it('should round-trip single object', async () => {
      const original = new TextEncoder().encode('original content')
      const packfile = createTestPackfile([{ type: 'blob', data: original }])
      const result = await unpackPackfile(packfile)

      expect(result.objects[0]!.data).toEqual(original)
    })

    it('should round-trip multiple objects preserving order', async () => {
      const objects = [
        { type: 'blob' as const, data: new TextEncoder().encode('blob 1') },
        { type: 'blob' as const, data: new TextEncoder().encode('blob 2') },
        { type: 'blob' as const, data: new TextEncoder().encode('blob 3') },
      ]

      const packfile = createTestPackfile(objects)
      const result = await unpackPackfile(packfile)

      expect(result.objects).toHaveLength(3)
      for (let i = 0; i < objects.length; i++) {
        expect(result.objects[i]!.data).toEqual(objects[i]!.data)
        expect(result.objects[i]!.type).toBe(objects[i]!.type)
      }
    })

    it('should round-trip binary data', async () => {
      const binaryData = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        binaryData[i] = i
      }

      const packfile = createTestPackfile([{ type: 'blob', data: binaryData }])
      const result = await unpackPackfile(packfile)

      expect(result.objects[0]!.data).toEqual(binaryData)
    })
  })

  describe('SHA computation correctness', () => {
    it('should compute correct SHA for known blobs', async () => {
      const testCases = [
        {
          content: 'hello world',
          expectedSha: '95d09f2b10159347eece71399a7e2e907ea3df4f',
        },
        {
          content: '',
          expectedSha: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
        },
        {
          content: 'test content\n',
          expectedSha: 'd670460b4b4aece5915caf5c68d12f560a9fe3e4',
        },
      ]

      for (const { content, expectedSha: sha } of testCases) {
        const data = new TextEncoder().encode(content)
        const packfile = createTestPackfile([{ type: 'blob', data }])
        const result = await unpackPackfile(packfile)

        expect(result.objects[0]!.sha).toBe(sha)
      }
    })
  })
})
