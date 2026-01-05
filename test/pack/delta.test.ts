import { describe, it, expect } from 'vitest'
import {
  applyDelta,
  createDelta,
  parseDeltaHeader,
  DeltaInstruction,
  COPY_INSTRUCTION,
  INSERT_INSTRUCTION
} from '../../src/pack/delta'

describe('Git Pack Delta Encoding', () => {
  describe('parseDeltaHeader', () => {
    it('should parse a single-byte size header', () => {
      // Size 10 (0x0a) fits in 7 bits, no continuation
      const data = new Uint8Array([0x0a])
      const result = parseDeltaHeader(data, 0)
      expect(result.size).toBe(10)
      expect(result.bytesRead).toBe(1)
    })

    it('should parse a two-byte size header with continuation', () => {
      // Size 200 = 0xc8 = 11001000
      // First byte: 0b11001000 -> lower 7 bits = 0b1001000 = 72, MSB=1 (continue)
      // Second byte: 0b00000001 -> 1 << 7 = 128
      // Total: 72 + 128 = 200
      const data = new Uint8Array([0xc8, 0x01])
      const result = parseDeltaHeader(data, 0)
      expect(result.size).toBe(200)
      expect(result.bytesRead).toBe(2)
    })

    it('should parse a three-byte size header', () => {
      // Size 20000 = 0x4e20
      // Encoding: lower 7 bits each with MSB continuation
      // 20000 = 0b100111000100000
      // First byte: 0b10100000 (0xa0) - lower 7 bits (32) + continue
      // Second byte: 0b11001110 (0xce) - next 7 bits (78 << 7 = 9984) + continue
      // Third byte: 0b00000001 (0x01) - final bits (1 << 14 = 16384)
      // Actually: 32 + 78*128 + 1*16384 = 32 + 9984 + 16384 = 26400 (wrong)
      // Let me recalculate: 20000 in variable-length encoding
      // 20000 = 0b100111000100000
      // Byte 1: lower 7 bits = 0b0100000 = 32, more=1 -> 0xa0
      // Byte 2: next 7 bits = 0b1110001 = 113, more=0 -> 0x71
      // Wait, let's be more careful:
      // 20000 in binary: 100111000100000
      // Split into 7-bit groups from LSB: 0100000 (32), 1110001 (113), 0 (0)
      // But that's only 14 bits, 20000 needs 15 bits
      // 20000 = 16384 + 3616 = 2^14 + 3616
      // Split: bits 0-6, bits 7-13, bits 14-20
      // 20000 = 0b100111000100000
      // Groups: 0100000 (32), 0011100 (28), 0000001 (1)
      // Encoded: 0xA0 (32 | 0x80), 0x9C (28 | 0x80)...
      // Actually git uses: byte1 = (n & 0x7f) | 0x80, n >>= 7, repeat
      // Let me just test with known values
      const data = new Uint8Array([0xa0, 0x9c, 0x01])
      const result = parseDeltaHeader(data, 0)
      expect(result.size).toBe(20000)
      expect(result.bytesRead).toBe(3)
    })

    it('should parse header starting from offset', () => {
      const data = new Uint8Array([0xff, 0xff, 0x0a])
      const result = parseDeltaHeader(data, 2)
      expect(result.size).toBe(10)
      expect(result.bytesRead).toBe(1)
    })

    it('should handle zero size', () => {
      const data = new Uint8Array([0x00])
      const result = parseDeltaHeader(data, 0)
      expect(result.size).toBe(0)
      expect(result.bytesRead).toBe(1)
    })

    it('should handle maximum single-byte value (127)', () => {
      const data = new Uint8Array([0x7f])
      const result = parseDeltaHeader(data, 0)
      expect(result.size).toBe(127)
      expect(result.bytesRead).toBe(1)
    })

    it('should handle minimum two-byte value (128)', () => {
      // 128 = 0b10000000
      // First byte: 0 | 0x80 = 0x80 (continue)
      // Second byte: 1 (128 >> 7 = 1)
      const data = new Uint8Array([0x80, 0x01])
      const result = parseDeltaHeader(data, 0)
      expect(result.size).toBe(128)
      expect(result.bytesRead).toBe(2)
    })
  })

  describe('DeltaInstruction types', () => {
    it('should have correct instruction type constants', () => {
      expect(COPY_INSTRUCTION).toBe(0x80)
      expect(INSERT_INSTRUCTION).toBe(0x00)
    })
  })

  describe('applyDelta', () => {
    it('should apply a simple insert-only delta', () => {
      // Delta: source size 0, target size 5, insert "hello"
      // Format: [source_size] [target_size] [insert_cmd + data]
      const base = new Uint8Array(0)
      const delta = new Uint8Array([
        0x00,       // source size = 0
        0x05,       // target size = 5
        0x05,       // insert 5 bytes (cmd byte < 0x80, value = length)
        0x68, 0x65, 0x6c, 0x6c, 0x6f  // "hello"
      ])
      const result = applyDelta(base, delta)
      expect(result).toEqual(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]))
    })

    it('should apply a simple copy-only delta', () => {
      // Copy the entire base object
      const base = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f])  // "hello"
      const delta = new Uint8Array([
        0x05,       // source size = 5
        0x05,       // target size = 5
        0x90,       // copy: offset=0 (no offset bytes), size from 1 byte (0x90 = 0x80 | 0x10)
        0x05        // size = 5
      ])
      const result = applyDelta(base, delta)
      expect(result).toEqual(base)
    })

    it('should apply a delta with copy at non-zero offset', () => {
      // Base: "hello world"
      // Copy "world" (offset 6, length 5)
      const encoder = new TextEncoder()
      const base = encoder.encode('hello world')
      const delta = new Uint8Array([
        0x0b,       // source size = 11
        0x05,       // target size = 5
        0x91,       // copy: offset 1 byte (0x01), size 1 byte (0x10) -> 0x80 | 0x01 | 0x10 = 0x91
        0x06,       // offset = 6
        0x05        // size = 5
      ])
      const result = applyDelta(base, delta)
      expect(result).toEqual(encoder.encode('world'))
    })

    it('should apply a delta with multiple instructions', () => {
      // Base: "hello"
      // Target: "hi hello there"
      // Instructions: insert "hi ", copy "hello", insert " there"
      const encoder = new TextEncoder()
      const base = encoder.encode('hello')
      const delta = new Uint8Array([
        0x05,       // source size = 5
        0x0e,       // target size = 14 ("hi hello there")
        0x03,       // insert 3 bytes
        0x68, 0x69, 0x20,  // "hi "
        0x90,       // copy: offset=0, size from 1 byte
        0x05,       // copy 5 bytes from offset 0
        0x06,       // insert 6 bytes
        0x20, 0x74, 0x68, 0x65, 0x72, 0x65  // " there"
      ])
      const result = applyDelta(base, delta)
      expect(result).toEqual(encoder.encode('hi hello there'))
    })

    it('should handle copy with 2-byte offset', () => {
      // Create a base object large enough to need 2-byte offset
      const base = new Uint8Array(300)
      base.fill(0x41)  // Fill with 'A'
      base[256] = 0x42  // Put 'B' at offset 256
      base[257] = 0x43  // Put 'C' at offset 257

      const delta = new Uint8Array([
        0xac, 0x02,  // source size = 300 (variable length: 300 = 0x12c -> 0xac, 0x02)
        0x02,        // target size = 2
        0x93,        // copy: offset 2 bytes (0x01 | 0x02), size 1 byte (0x10) -> 0x80 | 0x03 | 0x10 = 0x93
        0x00, 0x01,  // offset = 256 (little-endian)
        0x02         // size = 2
      ])
      const result = applyDelta(base, delta)
      expect(result).toEqual(new Uint8Array([0x42, 0x43]))
    })

    it('should handle copy with implicit size of 0x10000', () => {
      // When size bytes are all zero in copy instruction, size defaults to 0x10000
      const base = new Uint8Array(0x10000)
      base.fill(0x41)

      // Copy all 0x10000 bytes with no size bytes (size defaults to 0x10000)
      const delta = new Uint8Array([
        0x80, 0x80, 0x04,  // source size = 65536 (0x10000)
        0x80, 0x80, 0x04,  // target size = 65536
        0x80               // copy: no offset bytes (offset=0), no size bytes (size=0x10000)
      ])
      const result = applyDelta(base, delta)
      expect(result.length).toBe(0x10000)
      expect(result).toEqual(base)
    })

    it('should reject delta with mismatched source size', () => {
      const base = new Uint8Array([0x01, 0x02, 0x03])
      const delta = new Uint8Array([
        0x05,       // source size = 5 (but base is only 3 bytes)
        0x03,       // target size = 3
        0x90, 0x03  // copy 3 bytes
      ])
      expect(() => applyDelta(base, delta)).toThrow()
    })

    it('should reject delta with invalid target size', () => {
      const base = new Uint8Array([0x01, 0x02, 0x03])
      const delta = new Uint8Array([
        0x03,       // source size = 3
        0x05,       // target size = 5
        0x90, 0x03  // copy 3 bytes (result is 3, not 5)
      ])
      expect(() => applyDelta(base, delta)).toThrow()
    })

    it('should handle copy with 3-byte size', () => {
      // Size requires 3 bytes: 0x10203
      const baseSize = 0x10300
      const base = new Uint8Array(baseSize)
      base.fill(0x41)

      const copySize = 0x10203  // 66051
      const delta = new Uint8Array([
        // source size = 0x10300 (66304)
        0x80, 0x86, 0x04,
        // target size = 0x10203 (66051)
        0x83, 0x84, 0x04,
        // copy instruction: offset=0, size=0x10203
        // 0x80 | 0x10 | 0x20 | 0x40 = 0xF0 for size bytes 1,2,3
        0xf0,
        0x03, 0x02, 0x01  // size in little-endian: 0x010203 = 66051
      ])
      const result = applyDelta(base, delta)
      expect(result.length).toBe(copySize)
    })

    it('should handle copy with 4-byte offset', () => {
      // This is a conceptual test - we encode a 4-byte offset
      // In practice, offsets this large are rare
      const base = new Uint8Array(10)
      base.fill(0x41)

      const delta = new Uint8Array([
        0x0a,       // source size = 10
        0x05,       // target size = 5
        // Copy with all 4 offset bytes
        0x9f,       // 0x80 | 0x0f (all offset bytes) | 0x10 (size byte 1)
        0x00, 0x00, 0x00, 0x00,  // offset = 0
        0x05        // size = 5
      ])
      const result = applyDelta(base, delta)
      expect(result.length).toBe(5)
    })

    it('should apply delta to create exact target', () => {
      const encoder = new TextEncoder()
      const base = encoder.encode('The quick brown fox')
      const target = encoder.encode('The quick brown dog')

      // Create a delta manually
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)

      expect(result).toEqual(target)
    })
  })

  describe('createDelta', () => {
    it('should create delta for identical objects', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const delta = createDelta(data, data)
      const result = applyDelta(data, delta)
      expect(result).toEqual(data)
    })

    it('should create delta for completely different objects', () => {
      const base = new Uint8Array([1, 2, 3])
      const target = new Uint8Array([4, 5, 6, 7])
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should create delta for appending data', () => {
      const encoder = new TextEncoder()
      const base = encoder.encode('hello')
      const target = encoder.encode('hello world')
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should create delta for prepending data', () => {
      const encoder = new TextEncoder()
      const base = encoder.encode('world')
      const target = encoder.encode('hello world')
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should create delta for replacing data in middle', () => {
      const encoder = new TextEncoder()
      const base = encoder.encode('hello world')
      const target = encoder.encode('hello there')
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should create delta for empty base', () => {
      const base = new Uint8Array(0)
      const target = new Uint8Array([1, 2, 3])
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should create delta for empty target', () => {
      const base = new Uint8Array([1, 2, 3])
      const target = new Uint8Array(0)
      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should create delta for large objects', () => {
      // Create objects large enough to test chunking
      const base = new Uint8Array(10000)
      for (let i = 0; i < base.length; i++) {
        base[i] = i % 256
      }

      const target = new Uint8Array(10000)
      target.set(base)
      // Modify some bytes
      target[5000] = 0xff
      target[5001] = 0xfe

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should create efficient delta for similar objects', () => {
      const encoder = new TextEncoder()
      const base = encoder.encode('The quick brown fox jumps over the lazy dog')
      const target = encoder.encode('The quick brown cat jumps over the lazy dog')

      const delta = createDelta(base, target)

      // Delta should be smaller than target for similar content
      expect(delta.length).toBeLessThan(target.length)

      // And it should still produce correct output
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should round-trip binary data', () => {
      const base = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x01, 0xfe])
      const target = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x02, 0xfd, 0xaa])

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle repeated patterns in base', () => {
      const encoder = new TextEncoder()
      const base = encoder.encode('abcabcabcabc')
      const target = encoder.encode('abcXYZabcabc')

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })
  })

  describe('delta encoding edge cases', () => {
    it('should handle maximum insert size (127 bytes)', () => {
      const base = new Uint8Array(0)
      const target = new Uint8Array(127)
      target.fill(0x42)

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle insert larger than 127 bytes (multiple inserts)', () => {
      const base = new Uint8Array(0)
      const target = new Uint8Array(200)
      target.fill(0x42)

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle single byte difference', () => {
      const base = new Uint8Array([0x01])
      const target = new Uint8Array([0x02])

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle single byte objects', () => {
      const base = new Uint8Array([0x41])
      const target = new Uint8Array([0x41])

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })
  })

  describe('real-world delta scenarios', () => {
    it('should handle typical source code change (added line)', () => {
      const encoder = new TextEncoder()
      const base = encoder.encode(
        'function hello() {\n' +
        '  console.log("hello");\n' +
        '}\n'
      )
      const target = encoder.encode(
        'function hello() {\n' +
        '  console.log("hello");\n' +
        '  console.log("world");\n' +
        '}\n'
      )

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle typical source code change (removed line)', () => {
      const encoder = new TextEncoder()
      const base = encoder.encode(
        'line 1\n' +
        'line 2\n' +
        'line 3\n' +
        'line 4\n'
      )
      const target = encoder.encode(
        'line 1\n' +
        'line 3\n' +
        'line 4\n'
      )

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })

    it('should handle typical source code change (modified line)', () => {
      const encoder = new TextEncoder()
      const base = encoder.encode(
        'const x = 1;\n' +
        'const y = 2;\n' +
        'const z = 3;\n'
      )
      const target = encoder.encode(
        'const x = 1;\n' +
        'const y = 42;\n' +
        'const z = 3;\n'
      )

      const delta = createDelta(base, target)
      const result = applyDelta(base, delta)
      expect(result).toEqual(target)
    })
  })
})
