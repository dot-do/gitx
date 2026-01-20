import { describe, it, expect } from 'vitest'
import {
  // Header parsing
  BUNDLE_MAGIC,
  BUNDLE_VERSION,
  BUNDLE_HEADER_SIZE,
  parseBundleHeader,
  createBundleHeader,
  BundleHeader,

  // Index structure
  BundleIndexEntry,
  parseBundleIndex,
  createBundleIndex,
  lookupEntryByOid,

  // Bundle operations
  Bundle,
  createBundle,
  parseBundle,
  BundleReader,
  BundleWriter,

  // Object types
  BundleObjectType,

  // Error handling
  BundleFormatError,
  BundleCorruptedError,
  BundleIndexError
} from '../../src/storage/bundle-format'

/**
 * R2 Bundle Format Tests
 *
 * Bundle format for storing multiple git objects in a single R2 object
 * for cost optimization (similar to fsx 2MB blob approach).
 *
 * Format:
 * +----------------+
 * | Header (64B)   |  - Magic, version, entry count, index offset
 * +----------------+
 * | Entry 1        |  - Object data (variable size)
 * +----------------+
 * | Entry 2        |
 * +----------------+
 * | ...            |
 * +----------------+
 * | Index          |  - Array of {oid, offset, size, type}
 * +----------------+
 *
 * This is RED phase TDD - all tests should FAIL until implementation is done.
 */

// Test helpers
const encoder = new TextEncoder()

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function createTestOid(prefix: string = 'a'): string {
  return prefix.repeat(40).slice(0, 40)
}

function createTestObject(content: string): { oid: string; type: BundleObjectType; data: Uint8Array } {
  const data = encoder.encode(content)
  // Simple mock OID based on content (not a real SHA-1)
  const oid = createTestOid(content.charAt(0) || 'x')
  return { oid, type: BundleObjectType.BLOB, data }
}

describe('Bundle Format', () => {
  describe('Constants', () => {
    it('should have correct BUNDLE_MAGIC bytes', () => {
      // Magic bytes to identify a bundle file: "BNDL"
      expect(BUNDLE_MAGIC).toBe('BNDL')
    })

    it('should have correct BUNDLE_VERSION', () => {
      expect(BUNDLE_VERSION).toBe(1)
    })

    it('should have correct BUNDLE_HEADER_SIZE', () => {
      // Header should be exactly 64 bytes for alignment
      expect(BUNDLE_HEADER_SIZE).toBe(64)
    })
  })

  describe('BundleObjectType', () => {
    it('should have correct object type values', () => {
      expect(BundleObjectType.BLOB).toBe(1)
      expect(BundleObjectType.TREE).toBe(2)
      expect(BundleObjectType.COMMIT).toBe(3)
      expect(BundleObjectType.TAG).toBe(4)
    })
  })

  describe('Header Parsing', () => {
    describe('parseBundleHeader', () => {
      it('should parse valid bundle header', () => {
        // Create a valid 64-byte header
        // Bytes 0-3: Magic "BNDL"
        // Bytes 4-7: Version (uint32 BE)
        // Bytes 8-11: Entry count (uint32 BE)
        // Bytes 12-19: Index offset (uint64 BE)
        // Bytes 20-27: Total size (uint64 BE)
        // Bytes 28-47: Reserved (20 bytes)
        // Bytes 48-63: Checksum (16 bytes)
        const header = new Uint8Array(64)
        // Magic: "BNDL"
        header[0] = 0x42 // B
        header[1] = 0x4e // N
        header[2] = 0x44 // D
        header[3] = 0x4c // L
        // Version: 1
        header[7] = 0x01
        // Entry count: 5
        header[11] = 0x05
        // Index offset: 1024 (0x400)
        header[18] = 0x04
        header[19] = 0x00
        // Total size: 2048 (0x800)
        header[26] = 0x08
        header[27] = 0x00

        const result = parseBundleHeader(header)

        expect(result.magic).toBe('BNDL')
        expect(result.version).toBe(1)
        expect(result.entryCount).toBe(5)
        expect(result.indexOffset).toBe(1024)
        expect(result.totalSize).toBe(2048)
      })

      it('should parse header with large entry count', () => {
        const header = new Uint8Array(64)
        header[0] = 0x42; header[1] = 0x4e; header[2] = 0x44; header[3] = 0x4c
        header[7] = 0x01
        // Entry count: 100000 (0x186A0)
        header[8] = 0x00; header[9] = 0x01; header[10] = 0x86; header[11] = 0xa0

        const result = parseBundleHeader(header)

        expect(result.entryCount).toBe(100000)
      })

      it('should parse header with large index offset', () => {
        const header = new Uint8Array(64)
        header[0] = 0x42; header[1] = 0x4e; header[2] = 0x44; header[3] = 0x4c
        header[7] = 0x01
        header[11] = 0x01
        // Index offset: 2MB (0x200000)
        header[16] = 0x00; header[17] = 0x20; header[18] = 0x00; header[19] = 0x00

        const result = parseBundleHeader(header)

        expect(result.indexOffset).toBe(0x200000)
      })

      it('should extract checksum from header', () => {
        const header = new Uint8Array(64)
        header[0] = 0x42; header[1] = 0x4e; header[2] = 0x44; header[3] = 0x4c
        header[7] = 0x01
        header[11] = 0x01
        // Set checksum bytes (48-63)
        for (let i = 48; i < 64; i++) {
          header[i] = i - 48
        }

        const result = parseBundleHeader(header)

        expect(result.checksum).toBeDefined()
        expect(result.checksum.length).toBe(16)
        expect(result.checksum[0]).toBe(0)
        expect(result.checksum[15]).toBe(15)
      })
    })

    describe('parseBundleHeader error handling', () => {
      it('should throw BundleFormatError for invalid magic bytes', () => {
        const header = new Uint8Array(64)
        header[0] = 0x00; header[1] = 0x00; header[2] = 0x00; header[3] = 0x00

        expect(() => parseBundleHeader(header)).toThrow(BundleFormatError)
        expect(() => parseBundleHeader(header)).toThrow(/magic/i)
      })

      it('should throw BundleFormatError for unsupported version', () => {
        const header = new Uint8Array(64)
        header[0] = 0x42; header[1] = 0x4e; header[2] = 0x44; header[3] = 0x4c
        header[7] = 0x99 // Unsupported version 153

        expect(() => parseBundleHeader(header)).toThrow(BundleFormatError)
        expect(() => parseBundleHeader(header)).toThrow(/version/i)
      })

      it('should throw BundleFormatError for truncated header', () => {
        const header = new Uint8Array(32) // Too short
        header[0] = 0x42; header[1] = 0x4e; header[2] = 0x44; header[3] = 0x4c

        expect(() => parseBundleHeader(header)).toThrow(BundleFormatError)
        expect(() => parseBundleHeader(header)).toThrow(/truncated|size/i)
      })

      it('should throw BundleFormatError for empty data', () => {
        const header = new Uint8Array(0)

        expect(() => parseBundleHeader(header)).toThrow(BundleFormatError)
      })

      it('should throw BundleCorruptedError for invalid checksum', () => {
        const header = new Uint8Array(64)
        header[0] = 0x42; header[1] = 0x4e; header[2] = 0x44; header[3] = 0x4c
        header[7] = 0x01
        header[11] = 0x01
        // Invalid checksum (all zeros when it should match header content)

        expect(() => parseBundleHeader(header, { verifyChecksum: true })).toThrow(BundleCorruptedError)
      })

      it('should throw BundleFormatError when index offset exceeds total size', () => {
        const header = new Uint8Array(64)
        header[0] = 0x42; header[1] = 0x4e; header[2] = 0x44; header[3] = 0x4c
        header[7] = 0x01
        header[11] = 0x01
        // Index offset: 1000
        header[18] = 0x03; header[19] = 0xe8
        // Total size: 500 (less than index offset - invalid)
        header[26] = 0x01; header[27] = 0xf4

        expect(() => parseBundleHeader(header)).toThrow(BundleFormatError)
        expect(() => parseBundleHeader(header)).toThrow(/index.*offset|invalid/i)
      })
    })

    describe('createBundleHeader', () => {
      it('should create valid bundle header', () => {
        const header = createBundleHeader({
          entryCount: 10,
          indexOffset: 512,
          totalSize: 1024
        })

        expect(header.length).toBe(64)
        expect(header[0]).toBe(0x42) // B
        expect(header[1]).toBe(0x4e) // N
        expect(header[2]).toBe(0x44) // D
        expect(header[3]).toBe(0x4c) // L
      })

      it('should set version correctly', () => {
        const header = createBundleHeader({
          entryCount: 1,
          indexOffset: 64,
          totalSize: 128
        })

        // Version at bytes 4-7 (big endian)
        const version = (header[4] << 24) | (header[5] << 16) | (header[6] << 8) | header[7]
        expect(version).toBe(1)
      })

      it('should set entry count correctly', () => {
        const header = createBundleHeader({
          entryCount: 12345,
          indexOffset: 1000,
          totalSize: 2000
        })

        const entryCount = (header[8] << 24) | (header[9] << 16) | (header[10] << 8) | header[11]
        expect(entryCount).toBe(12345)
      })

      it('should set index offset correctly', () => {
        const header = createBundleHeader({
          entryCount: 1,
          indexOffset: 0x123456,
          totalSize: 0x200000
        })

        // Index offset at bytes 12-19 (uint64 big endian)
        const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
        const indexOffset = Number(view.getBigUint64(12, false))
        expect(indexOffset).toBe(0x123456)
      })

      it('should compute and include checksum', () => {
        const header = createBundleHeader({
          entryCount: 5,
          indexOffset: 500,
          totalSize: 1000
        })

        // Checksum at bytes 48-63
        const checksum = header.slice(48, 64)
        // Checksum should not be all zeros
        expect(checksum.some(b => b !== 0)).toBe(true)
      })

      it('should round-trip header correctly', () => {
        const original = {
          entryCount: 42,
          indexOffset: 2048,
          totalSize: 4096
        }

        const headerBytes = createBundleHeader(original)
        const parsed = parseBundleHeader(headerBytes)

        expect(parsed.magic).toBe('BNDL')
        expect(parsed.version).toBe(1)
        expect(parsed.entryCount).toBe(42)
        expect(parsed.indexOffset).toBe(2048)
        expect(parsed.totalSize).toBe(4096)
      })
    })
  })

  describe('Index Structure', () => {
    describe('BundleIndexEntry', () => {
      it('should have correct structure', () => {
        const entry: BundleIndexEntry = {
          oid: createTestOid('a'),
          offset: 64,
          size: 100,
          type: BundleObjectType.BLOB
        }

        expect(entry.oid).toHaveLength(40)
        expect(entry.offset).toBeGreaterThanOrEqual(0)
        expect(entry.size).toBeGreaterThan(0)
        expect(entry.type).toBe(BundleObjectType.BLOB)
      })
    })

    describe('parseBundleIndex', () => {
      it('should parse valid index with single entry', () => {
        // Index format per entry:
        // - 20 bytes: OID (SHA-1 binary)
        // - 8 bytes: offset (uint64 BE)
        // - 4 bytes: size (uint32 BE)
        // - 1 byte: type
        // Total: 33 bytes per entry

        const indexData = new Uint8Array(33)
        // OID (20 bytes of 0xaa)
        for (let i = 0; i < 20; i++) indexData[i] = 0xaa
        // Offset: 64 (at byte 20)
        indexData[27] = 64
        // Size: 100 (at byte 28)
        indexData[31] = 100
        // Type: BLOB (1) (at byte 32)
        indexData[32] = BundleObjectType.BLOB

        const entries = parseBundleIndex(indexData, 1)

        expect(entries.length).toBe(1)
        expect(entries[0].oid).toBe('aa'.repeat(20))
        expect(entries[0].offset).toBe(64)
        expect(entries[0].size).toBe(100)
        expect(entries[0].type).toBe(BundleObjectType.BLOB)
      })

      it('should parse valid index with multiple entries', () => {
        const entrySize = 33
        const entryCount = 3
        const indexData = new Uint8Array(entrySize * entryCount)

        for (let i = 0; i < entryCount; i++) {
          const base = i * entrySize
          // OID
          for (let j = 0; j < 20; j++) {
            indexData[base + j] = 0x10 + i
          }
          // Offset
          indexData[base + 27] = 64 + i * 50
          // Size
          indexData[base + 31] = 50
          // Type
          indexData[base + 32] = BundleObjectType.BLOB
        }

        const entries = parseBundleIndex(indexData, 3)

        expect(entries.length).toBe(3)
        expect(entries[0].oid).toBe('10'.repeat(20))
        expect(entries[1].oid).toBe('11'.repeat(20))
        expect(entries[2].oid).toBe('12'.repeat(20))
      })

      it('should parse entries with different object types', () => {
        const entrySize = 33
        const indexData = new Uint8Array(entrySize * 4)

        const types = [
          BundleObjectType.BLOB,
          BundleObjectType.TREE,
          BundleObjectType.COMMIT,
          BundleObjectType.TAG
        ]

        for (let i = 0; i < 4; i++) {
          const base = i * entrySize
          for (let j = 0; j < 20; j++) indexData[base + j] = i + 1
          indexData[base + 27] = 64 + i * 100
          indexData[base + 31] = 100
          indexData[base + 32] = types[i]
        }

        const entries = parseBundleIndex(indexData, 4)

        expect(entries[0].type).toBe(BundleObjectType.BLOB)
        expect(entries[1].type).toBe(BundleObjectType.TREE)
        expect(entries[2].type).toBe(BundleObjectType.COMMIT)
        expect(entries[3].type).toBe(BundleObjectType.TAG)
      })

      it('should handle large offsets', () => {
        const indexData = new Uint8Array(33)
        for (let i = 0; i < 20; i++) indexData[i] = 0xbb
        // Large offset: 0x7FFFFFFF (max int32)
        const view = new DataView(indexData.buffer)
        view.setBigUint64(20, BigInt(0x7fffffff), false)
        indexData[31] = 100
        indexData[32] = BundleObjectType.BLOB

        const entries = parseBundleIndex(indexData, 1)

        expect(entries[0].offset).toBe(0x7fffffff)
      })

      it('should sort entries by OID', () => {
        const entrySize = 33
        const indexData = new Uint8Array(entrySize * 3)

        // Add entries in reverse OID order
        const oids = ['cc', 'bb', 'aa']
        for (let i = 0; i < 3; i++) {
          const base = i * entrySize
          const oidByte = parseInt(oids[i], 16)
          for (let j = 0; j < 20; j++) indexData[base + j] = oidByte
          indexData[base + 27] = 64 + i * 50
          indexData[base + 31] = 50
          indexData[base + 32] = BundleObjectType.BLOB
        }

        const entries = parseBundleIndex(indexData, 3)

        // Entries should be sorted by OID
        expect(entries[0].oid).toBe('aa'.repeat(20))
        expect(entries[1].oid).toBe('bb'.repeat(20))
        expect(entries[2].oid).toBe('cc'.repeat(20))
      })
    })

    describe('parseBundleIndex error handling', () => {
      it('should throw BundleIndexError for truncated index data', () => {
        const indexData = new Uint8Array(20) // Too short for even one entry

        expect(() => parseBundleIndex(indexData, 1)).toThrow(BundleIndexError)
      })

      it('should throw BundleIndexError for invalid entry count', () => {
        const indexData = new Uint8Array(33 * 2) // Only 2 entries worth of data

        expect(() => parseBundleIndex(indexData, 5)).toThrow(BundleIndexError)
        expect(() => parseBundleIndex(indexData, 5)).toThrow(/entry count|mismatch/i)
      })

      it('should throw BundleIndexError for invalid object type', () => {
        const indexData = new Uint8Array(33)
        for (let i = 0; i < 20; i++) indexData[i] = 0xaa
        indexData[27] = 64
        indexData[31] = 100
        indexData[32] = 99 // Invalid type

        expect(() => parseBundleIndex(indexData, 1)).toThrow(BundleIndexError)
        expect(() => parseBundleIndex(indexData, 1)).toThrow(/type|invalid/i)
      })

      it('should throw BundleIndexError for duplicate OIDs', () => {
        const entrySize = 33
        const indexData = new Uint8Array(entrySize * 2)

        // Two entries with same OID
        for (let i = 0; i < 2; i++) {
          const base = i * entrySize
          for (let j = 0; j < 20; j++) indexData[base + j] = 0xaa
          indexData[base + 27] = 64 + i * 50
          indexData[base + 31] = 50
          indexData[base + 32] = BundleObjectType.BLOB
        }

        expect(() => parseBundleIndex(indexData, 2)).toThrow(BundleIndexError)
        expect(() => parseBundleIndex(indexData, 2)).toThrow(/duplicate/i)
      })
    })

    describe('createBundleIndex', () => {
      it('should create valid index from entries', () => {
        const entries: BundleIndexEntry[] = [
          { oid: 'aa'.repeat(20), offset: 64, size: 100, type: BundleObjectType.BLOB }
        ]

        const indexData = createBundleIndex(entries)

        expect(indexData.length).toBe(33)
        // Verify OID
        const oid = bytesToHex(indexData.slice(0, 20))
        expect(oid).toBe('aa'.repeat(20))
      })

      it('should create index with multiple entries', () => {
        const entries: BundleIndexEntry[] = [
          { oid: 'aa'.repeat(20), offset: 64, size: 100, type: BundleObjectType.BLOB },
          { oid: 'bb'.repeat(20), offset: 164, size: 200, type: BundleObjectType.TREE },
          { oid: 'cc'.repeat(20), offset: 364, size: 150, type: BundleObjectType.COMMIT }
        ]

        const indexData = createBundleIndex(entries)

        expect(indexData.length).toBe(33 * 3)

        // Parse it back
        const parsed = parseBundleIndex(indexData, 3)
        expect(parsed.length).toBe(3)
      })

      it('should sort entries by OID when creating index', () => {
        const entries: BundleIndexEntry[] = [
          { oid: 'cc'.repeat(20), offset: 64, size: 100, type: BundleObjectType.BLOB },
          { oid: 'aa'.repeat(20), offset: 164, size: 100, type: BundleObjectType.BLOB },
          { oid: 'bb'.repeat(20), offset: 264, size: 100, type: BundleObjectType.BLOB }
        ]

        const indexData = createBundleIndex(entries)
        const parsed = parseBundleIndex(indexData, 3)

        expect(parsed[0].oid).toBe('aa'.repeat(20))
        expect(parsed[1].oid).toBe('bb'.repeat(20))
        expect(parsed[2].oid).toBe('cc'.repeat(20))
      })

      it('should create empty index for empty entries', () => {
        const entries: BundleIndexEntry[] = []

        const indexData = createBundleIndex(entries)

        expect(indexData.length).toBe(0)
      })

      it('should round-trip entries correctly', () => {
        const original: BundleIndexEntry[] = [
          { oid: 'ab'.repeat(20), offset: 1024, size: 512, type: BundleObjectType.BLOB },
          { oid: 'cd'.repeat(20), offset: 2048, size: 256, type: BundleObjectType.TREE }
        ]

        const indexData = createBundleIndex(original)
        const parsed = parseBundleIndex(indexData, 2)

        // After sorting
        expect(parsed[0].oid).toBe('ab'.repeat(20))
        expect(parsed[0].offset).toBe(1024)
        expect(parsed[0].size).toBe(512)
        expect(parsed[0].type).toBe(BundleObjectType.BLOB)

        expect(parsed[1].oid).toBe('cd'.repeat(20))
        expect(parsed[1].offset).toBe(2048)
        expect(parsed[1].size).toBe(256)
        expect(parsed[1].type).toBe(BundleObjectType.TREE)
      })
    })

    describe('lookupEntryByOid', () => {
      it('should find entry by OID using binary search', () => {
        const entries: BundleIndexEntry[] = [
          { oid: 'aa'.repeat(20), offset: 64, size: 100, type: BundleObjectType.BLOB },
          { oid: 'bb'.repeat(20), offset: 164, size: 100, type: BundleObjectType.BLOB },
          { oid: 'cc'.repeat(20), offset: 264, size: 100, type: BundleObjectType.BLOB }
        ]

        const result = lookupEntryByOid(entries, 'bb'.repeat(20))

        expect(result).toBeDefined()
        expect(result!.oid).toBe('bb'.repeat(20))
        expect(result!.offset).toBe(164)
      })

      it('should return null for non-existent OID', () => {
        const entries: BundleIndexEntry[] = [
          { oid: 'aa'.repeat(20), offset: 64, size: 100, type: BundleObjectType.BLOB },
          { oid: 'cc'.repeat(20), offset: 264, size: 100, type: BundleObjectType.BLOB }
        ]

        const result = lookupEntryByOid(entries, 'bb'.repeat(20))

        expect(result).toBeNull()
      })

      it('should find first entry', () => {
        const entries: BundleIndexEntry[] = [
          { oid: 'aa'.repeat(20), offset: 64, size: 100, type: BundleObjectType.BLOB },
          { oid: 'bb'.repeat(20), offset: 164, size: 100, type: BundleObjectType.BLOB },
          { oid: 'cc'.repeat(20), offset: 264, size: 100, type: BundleObjectType.BLOB }
        ]

        const result = lookupEntryByOid(entries, 'aa'.repeat(20))

        expect(result).toBeDefined()
        expect(result!.oid).toBe('aa'.repeat(20))
      })

      it('should find last entry', () => {
        const entries: BundleIndexEntry[] = [
          { oid: 'aa'.repeat(20), offset: 64, size: 100, type: BundleObjectType.BLOB },
          { oid: 'bb'.repeat(20), offset: 164, size: 100, type: BundleObjectType.BLOB },
          { oid: 'cc'.repeat(20), offset: 264, size: 100, type: BundleObjectType.BLOB }
        ]

        const result = lookupEntryByOid(entries, 'cc'.repeat(20))

        expect(result).toBeDefined()
        expect(result!.oid).toBe('cc'.repeat(20))
      })

      it('should return null for empty entries array', () => {
        const entries: BundleIndexEntry[] = []

        const result = lookupEntryByOid(entries, 'aa'.repeat(20))

        expect(result).toBeNull()
      })

      it('should handle single entry', () => {
        const entries: BundleIndexEntry[] = [
          { oid: 'bb'.repeat(20), offset: 64, size: 100, type: BundleObjectType.BLOB }
        ]

        expect(lookupEntryByOid(entries, 'bb'.repeat(20))).toBeDefined()
        expect(lookupEntryByOid(entries, 'aa'.repeat(20))).toBeNull()
        expect(lookupEntryByOid(entries, 'cc'.repeat(20))).toBeNull()
      })

      it('should be efficient for large entry arrays (O(log n))', () => {
        // Create 10000 sorted entries
        const entries: BundleIndexEntry[] = []
        for (let i = 0; i < 10000; i++) {
          const hex = i.toString(16).padStart(40, '0')
          entries.push({ oid: hex, offset: 64 + i * 100, size: 100, type: BundleObjectType.BLOB })
        }

        const start = performance.now()
        for (let i = 0; i < 10000; i++) {
          const targetOid = (i * 7 % 10000).toString(16).padStart(40, '0')
          lookupEntryByOid(entries, targetOid)
        }
        const elapsed = performance.now() - start

        // 10000 binary searches should complete in < 50ms
        expect(elapsed).toBeLessThan(50)
      })
    })
  })

  describe('Bundle Creation', () => {
    describe('createBundle', () => {
      it('should create bundle from single object', () => {
        const objects = [createTestObject('hello')]

        const bundle = createBundle(objects)

        expect(bundle).toBeInstanceOf(Uint8Array)
        expect(bundle.length).toBeGreaterThan(64) // At least header size
      })

      it('should create bundle from multiple objects', () => {
        const objects = [
          createTestObject('hello'),
          createTestObject('world'),
          createTestObject('test content')
        ]

        const bundle = createBundle(objects)

        // Parse header to verify
        const header = parseBundleHeader(bundle)
        expect(header.entryCount).toBe(3)
      })

      it('should include all object data in bundle', () => {
        const content1 = 'object one'
        const content2 = 'object two'
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode(content1) },
          { oid: 'bb'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode(content2) }
        ]

        const bundle = createBundle(objects)
        const header = parseBundleHeader(bundle)

        expect(header.entryCount).toBe(2)
        expect(bundle.length).toBeGreaterThan(64 + content1.length + content2.length)
      })

      it('should create valid index at correct offset', () => {
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('hello') }
        ]

        const bundle = createBundle(objects)
        const header = parseBundleHeader(bundle)

        // Index should be at the specified offset
        const indexData = bundle.slice(header.indexOffset)
        const entries = parseBundleIndex(indexData, header.entryCount)

        expect(entries.length).toBe(1)
        expect(entries[0].oid).toBe('aa'.repeat(20))
      })

      it('should set correct total size in header', () => {
        const objects = [createTestObject('test')]

        const bundle = createBundle(objects)
        const header = parseBundleHeader(bundle)

        expect(header.totalSize).toBe(bundle.length)
      })

      it('should handle different object types', () => {
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('blob') },
          { oid: 'bb'.repeat(20), type: BundleObjectType.TREE, data: new Uint8Array([1, 2, 3]) },
          { oid: 'cc'.repeat(20), type: BundleObjectType.COMMIT, data: encoder.encode('commit') },
          { oid: 'dd'.repeat(20), type: BundleObjectType.TAG, data: encoder.encode('tag') }
        ]

        const bundle = createBundle(objects)
        const header = parseBundleHeader(bundle)
        const indexData = bundle.slice(header.indexOffset)
        const entries = parseBundleIndex(indexData, header.entryCount)

        const types = entries.map(e => e.type)
        expect(types).toContain(BundleObjectType.BLOB)
        expect(types).toContain(BundleObjectType.TREE)
        expect(types).toContain(BundleObjectType.COMMIT)
        expect(types).toContain(BundleObjectType.TAG)
      })

      it('should handle large objects', () => {
        const largeData = new Uint8Array(100000)
        for (let i = 0; i < largeData.length; i++) {
          largeData[i] = i % 256
        }
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: largeData }
        ]

        const bundle = createBundle(objects)
        const header = parseBundleHeader(bundle)

        expect(header.entryCount).toBe(1)
        expect(bundle.length).toBeGreaterThan(largeData.length)
      })

      it('should handle many objects', () => {
        const objects = []
        for (let i = 0; i < 1000; i++) {
          objects.push({
            oid: i.toString(16).padStart(40, '0'),
            type: BundleObjectType.BLOB,
            data: encoder.encode(`object ${i}`)
          })
        }

        const bundle = createBundle(objects)
        const header = parseBundleHeader(bundle)

        expect(header.entryCount).toBe(1000)
      })
    })

    describe('createBundle edge cases', () => {
      it('should handle empty bundle (no objects)', () => {
        const objects: { oid: string; type: BundleObjectType; data: Uint8Array }[] = []

        const bundle = createBundle(objects)
        const header = parseBundleHeader(bundle)

        expect(header.entryCount).toBe(0)
        expect(header.indexOffset).toBe(64) // Right after header
      })

      it('should handle objects with empty data', () => {
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: new Uint8Array(0) }
        ]

        const bundle = createBundle(objects)
        const header = parseBundleHeader(bundle)
        const indexData = bundle.slice(header.indexOffset)
        const entries = parseBundleIndex(indexData, header.entryCount)

        expect(entries[0].size).toBe(0)
      })

      it('should handle binary data with null bytes', () => {
        const binaryData = new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00])
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: binaryData }
        ]

        const bundle = createBundle(objects)
        const header = parseBundleHeader(bundle)
        const indexData = bundle.slice(header.indexOffset)
        const entries = parseBundleIndex(indexData, header.entryCount)

        expect(entries[0].size).toBe(5)
      })
    })
  })

  describe('Bundle Reading', () => {
    describe('parseBundle', () => {
      it('should parse valid bundle', () => {
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('hello') }
        ]
        const bundleData = createBundle(objects)

        const bundle = parseBundle(bundleData)

        expect(bundle.header.entryCount).toBe(1)
        expect(bundle.entries.length).toBe(1)
      })

      it('should parse bundle and provide access to objects', () => {
        const originalData = encoder.encode('test content')
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: originalData }
        ]
        const bundleData = createBundle(objects)

        const bundle = parseBundle(bundleData)
        const entry = bundle.entries[0]

        expect(entry.oid).toBe('aa'.repeat(20))
        expect(entry.type).toBe(BundleObjectType.BLOB)
        expect(entry.size).toBe(originalData.length)
      })

      it('should parse bundle with multiple objects', () => {
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('one') },
          { oid: 'bb'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('two') },
          { oid: 'cc'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('three') }
        ]
        const bundleData = createBundle(objects)

        const bundle = parseBundle(bundleData)

        expect(bundle.entries.length).toBe(3)
      })
    })

    describe('parseBundle error handling', () => {
      it('should throw BundleFormatError for invalid magic', () => {
        const invalidBundle = new Uint8Array(100)

        expect(() => parseBundle(invalidBundle)).toThrow(BundleFormatError)
      })

      it('should throw BundleCorruptedError for truncated bundle', () => {
        const objects = [createTestObject('hello')]
        const bundleData = createBundle(objects)
        // Truncate the bundle
        const truncated = bundleData.slice(0, bundleData.length - 50)

        expect(() => parseBundle(truncated)).toThrow(BundleCorruptedError)
      })

      it('should throw BundleCorruptedError for corrupted data', () => {
        const objects = [createTestObject('hello')]
        const bundleData = createBundle(objects)
        // Corrupt some bytes in the middle
        bundleData[100] = 0xff
        bundleData[101] = 0xff

        // Depending on where corruption is, this might throw different errors
        expect(() => parseBundle(bundleData, { verify: true })).toThrow()
      })
    })

    describe('BundleReader', () => {
      it('should create reader from bundle data', () => {
        const objects = [createTestObject('hello')]
        const bundleData = createBundle(objects)

        const reader = new BundleReader(bundleData)

        expect(reader.entryCount).toBe(1)
      })

      it('should read object by OID', () => {
        const content = 'hello world'
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode(content) }
        ]
        const bundleData = createBundle(objects)

        const reader = new BundleReader(bundleData)
        const object = reader.readObject('aa'.repeat(20))

        expect(object).toBeDefined()
        expect(object!.type).toBe(BundleObjectType.BLOB)
        expect(new TextDecoder().decode(object!.data)).toBe(content)
      })

      it('should return null for non-existent OID', () => {
        const objects = [createTestObject('hello')]
        const bundleData = createBundle(objects)

        const reader = new BundleReader(bundleData)
        const object = reader.readObject('ff'.repeat(20))

        expect(object).toBeNull()
      })

      it('should iterate over all objects', () => {
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('one') },
          { oid: 'bb'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('two') },
          { oid: 'cc'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('three') }
        ]
        const bundleData = createBundle(objects)

        const reader = new BundleReader(bundleData)
        const readObjects: { oid: string; data: Uint8Array }[] = []

        for (const obj of reader) {
          readObjects.push({ oid: obj.oid, data: obj.data })
        }

        expect(readObjects.length).toBe(3)
      })

      it('should check if OID exists', () => {
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('test') }
        ]
        const bundleData = createBundle(objects)

        const reader = new BundleReader(bundleData)

        expect(reader.hasObject('aa'.repeat(20))).toBe(true)
        expect(reader.hasObject('bb'.repeat(20))).toBe(false)
      })

      it('should list all OIDs', () => {
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('one') },
          { oid: 'bb'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('two') }
        ]
        const bundleData = createBundle(objects)

        const reader = new BundleReader(bundleData)
        const oids = reader.listOids()

        expect(oids.length).toBe(2)
        expect(oids).toContain('aa'.repeat(20))
        expect(oids).toContain('bb'.repeat(20))
      })

      it('should get entry metadata without reading data', () => {
        const objects = [
          { oid: 'aa'.repeat(20), type: BundleObjectType.COMMIT, data: encoder.encode('commit data') }
        ]
        const bundleData = createBundle(objects)

        const reader = new BundleReader(bundleData)
        const entry = reader.getEntry('aa'.repeat(20))

        expect(entry).toBeDefined()
        expect(entry!.type).toBe(BundleObjectType.COMMIT)
        expect(entry!.size).toBe(11) // 'commit data'.length
      })
    })

    describe('Bundle iteration', () => {
      it('should iterate in index order (sorted by OID)', () => {
        // Create objects in non-sorted order
        const objects = [
          { oid: 'cc'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('c') },
          { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('a') },
          { oid: 'bb'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('b') }
        ]
        const bundleData = createBundle(objects)

        const reader = new BundleReader(bundleData)
        const oids: string[] = []

        for (const obj of reader) {
          oids.push(obj.oid)
        }

        // Should be in sorted order
        expect(oids[0]).toBe('aa'.repeat(20))
        expect(oids[1]).toBe('bb'.repeat(20))
        expect(oids[2]).toBe('cc'.repeat(20))
      })

      it('should handle iteration of empty bundle', () => {
        const bundleData = createBundle([])

        const reader = new BundleReader(bundleData)
        const objects: { oid: string }[] = []

        for (const obj of reader) {
          objects.push({ oid: obj.oid })
        }

        expect(objects.length).toBe(0)
      })
    })
  })

  describe('BundleWriter', () => {
    it('should create writer', () => {
      const writer = new BundleWriter()

      expect(writer).toBeDefined()
    })

    it('should add object to writer', () => {
      const writer = new BundleWriter()

      writer.addObject('aa'.repeat(20), BundleObjectType.BLOB, encoder.encode('hello'))

      expect(writer.objectCount).toBe(1)
    })

    it('should add multiple objects', () => {
      const writer = new BundleWriter()

      writer.addObject('aa'.repeat(20), BundleObjectType.BLOB, encoder.encode('one'))
      writer.addObject('bb'.repeat(20), BundleObjectType.BLOB, encoder.encode('two'))
      writer.addObject('cc'.repeat(20), BundleObjectType.BLOB, encoder.encode('three'))

      expect(writer.objectCount).toBe(3)
    })

    it('should build bundle from writer', () => {
      const writer = new BundleWriter()
      writer.addObject('aa'.repeat(20), BundleObjectType.BLOB, encoder.encode('hello'))

      const bundle = writer.build()

      expect(bundle).toBeInstanceOf(Uint8Array)
      const header = parseBundleHeader(bundle)
      expect(header.entryCount).toBe(1)
    })

    it('should throw on duplicate OID', () => {
      const writer = new BundleWriter()
      writer.addObject('aa'.repeat(20), BundleObjectType.BLOB, encoder.encode('one'))

      expect(() => {
        writer.addObject('aa'.repeat(20), BundleObjectType.BLOB, encoder.encode('two'))
      }).toThrow(/duplicate/i)
    })

    it('should track total size before building', () => {
      const writer = new BundleWriter()
      const data = encoder.encode('hello')
      writer.addObject('aa'.repeat(20), BundleObjectType.BLOB, data)

      // Estimated size should be at least header + data + index entry
      expect(writer.estimatedSize).toBeGreaterThan(64 + data.length)
    })

    it('should allow setting max bundle size', () => {
      const writer = new BundleWriter({ maxSize: 1000 })
      const largeData = new Uint8Array(500)

      writer.addObject('aa'.repeat(20), BundleObjectType.BLOB, largeData)

      // Second large object should fail
      expect(() => {
        writer.addObject('bb'.repeat(20), BundleObjectType.BLOB, largeData)
      }).toThrow(/size|limit/i)
    })

    it('should check if bundle is full', () => {
      const writer = new BundleWriter({ maxSize: 200 })
      writer.addObject('aa'.repeat(20), BundleObjectType.BLOB, encoder.encode('small'))

      expect(writer.isFull(100)).toBe(true) // Adding 100 more bytes would exceed
      expect(writer.isFull(10)).toBe(false) // Adding 10 bytes would fit
    })

    it('should build empty bundle', () => {
      const writer = new BundleWriter()

      const bundle = writer.build()
      const header = parseBundleHeader(bundle)

      expect(header.entryCount).toBe(0)
    })

    it('should round-trip through writer and reader', () => {
      const writer = new BundleWriter()
      const content = 'test content'
      writer.addObject('aa'.repeat(20), BundleObjectType.BLOB, encoder.encode(content))

      const bundle = writer.build()
      const reader = new BundleReader(bundle)
      const object = reader.readObject('aa'.repeat(20))

      expect(object).toBeDefined()
      expect(new TextDecoder().decode(object!.data)).toBe(content)
    })
  })

  describe('Corrupted Header Detection', () => {
    it('should detect corrupted magic bytes', () => {
      const objects = [createTestObject('hello')]
      const bundleData = createBundle(objects)
      // Corrupt magic
      bundleData[0] = 0xff

      expect(() => parseBundle(bundleData)).toThrow(BundleFormatError)
    })

    it('should detect corrupted version', () => {
      const objects = [createTestObject('hello')]
      const bundleData = createBundle(objects)
      // Corrupt version to invalid value
      bundleData[4] = 0xff
      bundleData[5] = 0xff
      bundleData[6] = 0xff
      bundleData[7] = 0xff

      expect(() => parseBundle(bundleData)).toThrow(BundleFormatError)
    })

    it('should detect corrupted entry count', () => {
      const objects = [createTestObject('hello')]
      const bundleData = createBundle(objects)
      // Set entry count to huge value
      bundleData[8] = 0xff
      bundleData[9] = 0xff
      bundleData[10] = 0xff
      bundleData[11] = 0xff

      expect(() => parseBundle(bundleData)).toThrow()
    })

    it('should detect corrupted index offset', () => {
      const objects = [createTestObject('hello')]
      const bundleData = createBundle(objects)
      // Set index offset beyond bundle size
      const view = new DataView(bundleData.buffer, bundleData.byteOffset, bundleData.byteLength)
      view.setBigUint64(12, BigInt(0xffffffff), false)

      expect(() => parseBundle(bundleData)).toThrow()
    })

    it('should detect checksum mismatch when verification enabled', () => {
      const objects = [createTestObject('hello')]
      const bundleData = createBundle(objects)
      // Corrupt data but leave header intact
      if (bundleData.length > 100) {
        bundleData[80] = bundleData[80] ^ 0xff
      }

      expect(() => parseBundle(bundleData, { verify: true })).toThrow(BundleCorruptedError)
    })
  })

  describe('Invalid Index Handling', () => {
    it('should detect index with invalid entry', () => {
      const objects = [createTestObject('hello')]
      const bundleData = createBundle(objects)
      const header = parseBundleHeader(bundleData)

      // Corrupt the object type in index
      const indexTypeOffset = header.indexOffset + 32 // After OID (20) + offset (8) + size (4)
      bundleData[indexTypeOffset] = 255 // Invalid type

      expect(() => parseBundle(bundleData)).toThrow(BundleIndexError)
    })

    it('should detect index with offset out of bounds', () => {
      const objects = [createTestObject('hello')]
      const bundleData = createBundle(objects)
      const header = parseBundleHeader(bundleData)

      // Corrupt the offset in index to point beyond bundle
      const indexOffsetPos = header.indexOffset + 20 // After OID
      const view = new DataView(bundleData.buffer, bundleData.byteOffset, bundleData.byteLength)
      view.setBigUint64(indexOffsetPos, BigInt(0xffffffff), false)

      expect(() => parseBundle(bundleData, { verify: true })).toThrow()
    })

    it('should detect mismatched entry count', () => {
      const objects = [createTestObject('hello')]
      const bundleData = createBundle(objects)

      // Modify entry count in header but not index
      bundleData[11] = 5 // Say there are 5 entries when there's only 1

      expect(() => parseBundle(bundleData)).toThrow()
    })
  })

  describe('Empty Bundle Edge Case', () => {
    it('should create and parse empty bundle', () => {
      const bundle = createBundle([])

      const parsed = parseBundle(bundle)

      expect(parsed.header.entryCount).toBe(0)
      expect(parsed.entries.length).toBe(0)
    })

    it('should have correct size for empty bundle', () => {
      const bundle = createBundle([])
      const header = parseBundleHeader(bundle)

      // Empty bundle should be just header (64 bytes) + empty index
      expect(bundle.length).toBe(64)
      expect(header.indexOffset).toBe(64)
      expect(header.totalSize).toBe(64)
    })

    it('should iterate empty bundle without error', () => {
      const bundle = createBundle([])
      const reader = new BundleReader(bundle)

      const objects: unknown[] = []
      for (const obj of reader) {
        objects.push(obj)
      }

      expect(objects.length).toBe(0)
    })

    it('should return null for any OID lookup in empty bundle', () => {
      const bundle = createBundle([])
      const reader = new BundleReader(bundle)

      expect(reader.readObject('aa'.repeat(20))).toBeNull()
      expect(reader.hasObject('aa'.repeat(20))).toBe(false)
    })

    it('should have empty OID list for empty bundle', () => {
      const bundle = createBundle([])
      const reader = new BundleReader(bundle)

      expect(reader.listOids()).toEqual([])
    })
  })

  describe('Integration Tests', () => {
    it('should create bundle, parse it, and read all objects correctly', () => {
      const originalObjects = [
        { oid: 'aa'.repeat(20), type: BundleObjectType.BLOB, data: encoder.encode('blob content') },
        { oid: 'bb'.repeat(20), type: BundleObjectType.TREE, data: new Uint8Array([1, 2, 3, 4, 5]) },
        { oid: 'cc'.repeat(20), type: BundleObjectType.COMMIT, data: encoder.encode('commit msg') }
      ]

      const bundle = createBundle(originalObjects)
      const reader = new BundleReader(bundle)

      for (const orig of originalObjects) {
        const read = reader.readObject(orig.oid)
        expect(read).toBeDefined()
        expect(read!.type).toBe(orig.type)
        expect(read!.data).toEqual(orig.data)
      }
    })

    it('should handle bundle with 2MB of data (R2 optimization target)', () => {
      const objects: { oid: string; type: BundleObjectType; data: Uint8Array }[] = []
      let totalSize = 0
      const targetSize = 2 * 1024 * 1024 // 2MB
      let i = 0

      while (totalSize < targetSize) {
        const data = new Uint8Array(1000 + (i % 500))
        for (let j = 0; j < data.length; j++) {
          data[j] = (i + j) % 256
        }
        objects.push({
          oid: i.toString(16).padStart(40, '0'),
          type: BundleObjectType.BLOB,
          data
        })
        totalSize += data.length
        i++
      }

      const bundle = createBundle(objects)
      const reader = new BundleReader(bundle)

      expect(reader.entryCount).toBe(objects.length)

      // Verify we can read any random object
      const randomIndex = Math.floor(objects.length / 2)
      const randomOid = objects[randomIndex].oid
      const read = reader.readObject(randomOid)
      expect(read).toBeDefined()
      expect(read!.data).toEqual(objects[randomIndex].data)
    })

    it('should handle round-trip with BundleWriter and BundleReader', () => {
      const writer = new BundleWriter()

      // Add various objects
      writer.addObject('11'.repeat(20), BundleObjectType.BLOB, encoder.encode('file1.txt'))
      writer.addObject('22'.repeat(20), BundleObjectType.BLOB, encoder.encode('file2.txt'))
      writer.addObject('33'.repeat(20), BundleObjectType.TREE, new Uint8Array([0, 1, 2]))
      writer.addObject('44'.repeat(20), BundleObjectType.COMMIT, encoder.encode('Initial commit'))

      const bundle = writer.build()
      const reader = new BundleReader(bundle)

      expect(reader.entryCount).toBe(4)
      expect(reader.hasObject('11'.repeat(20))).toBe(true)
      expect(reader.hasObject('22'.repeat(20))).toBe(true)
      expect(reader.hasObject('33'.repeat(20))).toBe(true)
      expect(reader.hasObject('44'.repeat(20))).toBe(true)
      expect(reader.hasObject('55'.repeat(20))).toBe(false)
    })
  })
})
