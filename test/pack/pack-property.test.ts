/**
 * @fileoverview Property-Based Testing for Git Pack Format
 *
 * This test suite uses fast-check to perform property-based testing on the
 * pack format implementation. Property-based testing generates random inputs
 * and verifies that certain invariants hold for all inputs.
 *
 * Tests cover:
 * - Variable-length integer (varint) encoding/decoding round-trips
 * - Pack object header type+size encoding/decoding round-trips
 * - Delta encoding/decoding with random data
 * - Pack format edge cases and boundary conditions
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  encodeVarint,
  decodeVarint,
  encodeTypeAndSize,
  decodeTypeAndSize,
  PackObjectType,
  PACK_SIGNATURE,
  PACK_VERSION,
  parsePackHeader,
  createPackfile
} from '../../src/pack/format'
import {
  applyDelta,
  createDelta,
  parseDeltaHeader,
  COPY_INSTRUCTION,
  INSERT_INSTRUCTION
} from '../../src/pack/delta'

// =============================================================================
// Arbitrary Generators
// =============================================================================

/**
 * Arbitrary generator for valid pack object types (excluding reserved type 5).
 */
const packObjectTypeArb = fc.constantFrom(
  PackObjectType.OBJ_COMMIT,
  PackObjectType.OBJ_TREE,
  PackObjectType.OBJ_BLOB,
  PackObjectType.OBJ_TAG,
  PackObjectType.OBJ_OFS_DELTA,
  PackObjectType.OBJ_REF_DELTA
)

/**
 * Arbitrary generator for base pack object types only (not delta types).
 */
const basePackObjectTypeArb = fc.constantFrom(
  PackObjectType.OBJ_COMMIT,
  PackObjectType.OBJ_TREE,
  PackObjectType.OBJ_BLOB,
  PackObjectType.OBJ_TAG
)

/**
 * Arbitrary generator for valid pack object type strings.
 */
const packObjectTypeStringArb = fc.constantFrom('blob', 'tree', 'commit', 'tag') as fc.Arbitrary<'blob' | 'tree' | 'commit' | 'tag'>

/**
 * Arbitrary generator for object sizes.
 * Covers edge cases: 0, small (1 byte), boundary (15, 16), and larger values.
 */
const objectSizeArb = fc.oneof(
  fc.constant(0),                          // Empty
  fc.integer({ min: 1, max: 15 }),         // Single byte size (4 bits)
  fc.constant(15),                         // Boundary: max single byte
  fc.constant(16),                         // Boundary: min two bytes
  fc.integer({ min: 16, max: 2047 }),      // Two byte sizes
  fc.constant(2047),                       // Boundary: max two bytes (4 + 7 = 11 bits)
  fc.constant(2048),                       // Boundary: min three bytes
  fc.integer({ min: 2048, max: 262143 }), // Three byte sizes
  fc.integer({ min: 262144, max: 1000000 }) // Larger sizes
)

/**
 * Arbitrary generator for varint values (non-negative integers).
 */
const varintValueArb = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 1, max: 127 }),        // Single byte
  fc.constant(127),                        // Boundary: max single byte
  fc.constant(128),                        // Boundary: min two bytes
  fc.integer({ min: 128, max: 16383 }),    // Two bytes
  fc.constant(16383),                      // Boundary: max two bytes
  fc.constant(16384),                      // Boundary: min three bytes
  fc.integer({ min: 16384, max: 2097151 }), // Three bytes
  fc.constant(2097151),                    // Boundary: max three bytes
  fc.constant(2097152),                    // Boundary: min four bytes
  fc.integer({ min: 2097152, max: 10000000 }) // Larger values
)

/**
 * Arbitrary generator for binary data of various sizes.
 */
const binaryDataArb = (maxSize: number = 1000) => fc.uint8Array({ minLength: 0, maxLength: maxSize })

/**
 * Arbitrary generator for similar binary data pairs (for delta testing).
 * Creates a base and a modified version with some random changes.
 */
const similarDataPairArb = (baseSize: number = 500) => fc.tuple(
  fc.uint8Array({ minLength: 4, maxLength: baseSize }),
  fc.float({ min: 0, max: Math.fround(0.3) }) // Change percentage (0-30%)
).map(([base, changeRatio]) => {
  const target = new Uint8Array(base)
  const numChanges = Math.floor(base.length * changeRatio)
  for (let i = 0; i < numChanges; i++) {
    const pos = Math.floor(Math.random() * base.length)
    target[pos] = (target[pos] + 1) & 0xff
  }
  return { base, target }
})

/**
 * Arbitrary generator for source-code-like data (with repeating patterns).
 */
const sourceCodeLikeDataArb = (maxSize: number = 1000) => {
  const patterns = [
    'function foo() {\n',
    '  const x = 1;\n',
    '  return x;\n',
    '}\n',
    '\n',
    'const a = 1;\n',
    'const b = 2;\n',
    'export { a, b };\n'
  ]

  return fc.integer({ min: 1, max: maxSize / 10 }).map(lineCount => {
    const encoder = new TextEncoder()
    let result = ''
    for (let i = 0; i < lineCount; i++) {
      result += patterns[i % patterns.length]
    }
    return encoder.encode(result.slice(0, maxSize))
  })
}

// =============================================================================
// Varint Encoding/Decoding Property Tests
// =============================================================================

describe('Pack Format Property-Based Tests', () => {
  describe('Varint Encoding/Decoding', () => {
    it('should round-trip any non-negative integer', () => {
      fc.assert(
        fc.property(varintValueArb, (value) => {
          const encoded = encodeVarint(value)
          const { value: decoded, bytesRead } = decodeVarint(encoded, 0)

          expect(decoded).toBe(value)
          expect(bytesRead).toBe(encoded.length)
        }),
        { numRuns: 1000 }
      )
    })

    it('should produce minimal encoding for boundary values', () => {
      fc.assert(
        fc.property(fc.constant(127), (value) => {
          const encoded = encodeVarint(value)
          expect(encoded.length).toBe(1) // Should fit in single byte
        })
      )

      fc.assert(
        fc.property(fc.constant(128), (value) => {
          const encoded = encodeVarint(value)
          expect(encoded.length).toBe(2) // Requires two bytes
        })
      )
    })

    it('should decode varint from arbitrary offset in buffer', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.uint8Array({ minLength: 0, maxLength: 10 }), // Prefix padding
            varintValueArb,
            fc.uint8Array({ minLength: 0, maxLength: 10 })  // Suffix padding
          ),
          ([prefix, value, suffix]) => {
            const encoded = encodeVarint(value)
            const buffer = new Uint8Array(prefix.length + encoded.length + suffix.length)
            buffer.set(prefix, 0)
            buffer.set(encoded, prefix.length)
            buffer.set(suffix, prefix.length + encoded.length)

            const { value: decoded, bytesRead } = decodeVarint(buffer, prefix.length)

            expect(decoded).toBe(value)
            expect(bytesRead).toBe(encoded.length)
          }
        ),
        { numRuns: 500 }
      )
    })

    it('should maintain monotonicity: larger values have >= encoding length', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.integer({ min: 0, max: 10000000 }),
            fc.integer({ min: 1, max: 1000 })
          ),
          ([base, delta]) => {
            const smallerEncoded = encodeVarint(base)
            const largerEncoded = encodeVarint(base + delta)

            expect(largerEncoded.length).toBeGreaterThanOrEqual(smallerEncoded.length)
          }
        ),
        { numRuns: 500 }
      )
    })

    it('should always set continuation bit correctly', () => {
      fc.assert(
        fc.property(varintValueArb, (value) => {
          const encoded = encodeVarint(value)

          // All bytes except the last should have MSB set
          for (let i = 0; i < encoded.length - 1; i++) {
            expect(encoded[i] & 0x80).toBe(0x80)
          }
          // Last byte should NOT have MSB set
          expect(encoded[encoded.length - 1] & 0x80).toBe(0)
        }),
        { numRuns: 1000 }
      )
    })
  })

  // =============================================================================
  // Type+Size Encoding/Decoding Property Tests
  // =============================================================================

  describe('Type+Size Encoding/Decoding', () => {
    it('should round-trip any valid type and size combination', () => {
      fc.assert(
        fc.property(
          fc.tuple(packObjectTypeArb, objectSizeArb),
          ([type, size]) => {
            const encoded = encodeTypeAndSize(type, size)
            const { type: decodedType, size: decodedSize, bytesRead } = decodeTypeAndSize(encoded, 0)

            expect(decodedType).toBe(type)
            expect(decodedSize).toBe(size)
            expect(bytesRead).toBe(encoded.length)
          }
        ),
        { numRuns: 1000 }
      )
    })

    it('should encode type in bits 4-6 of first byte', () => {
      fc.assert(
        fc.property(
          fc.tuple(packObjectTypeArb, objectSizeArb),
          ([type, size]) => {
            const encoded = encodeTypeAndSize(type, size)
            const extractedType = (encoded[0] >> 4) & 0x07

            expect(extractedType).toBe(type)
          }
        ),
        { numRuns: 500 }
      )
    })

    it('should encode size bits 0-3 in first byte', () => {
      fc.assert(
        fc.property(
          fc.tuple(packObjectTypeArb, fc.integer({ min: 0, max: 15 })),
          ([type, size]) => {
            const encoded = encodeTypeAndSize(type, size)
            const extractedSizeBits = encoded[0] & 0x0f

            expect(extractedSizeBits).toBe(size)
            // For sizes 0-15, should be single byte (no continuation)
            expect(encoded.length).toBe(1)
            expect(encoded[0] & 0x80).toBe(0)
          }
        ),
        { numRuns: 500 }
      )
    })

    it('should use continuation bits for sizes > 15', () => {
      fc.assert(
        fc.property(
          fc.tuple(packObjectTypeArb, fc.integer({ min: 16, max: 1000000 })),
          ([type, size]) => {
            const encoded = encodeTypeAndSize(type, size)

            // First byte should have continuation bit set
            expect(encoded[0] & 0x80).toBe(0x80)
            // Should require more than one byte
            expect(encoded.length).toBeGreaterThan(1)
          }
        ),
        { numRuns: 500 }
      )
    })

    it('should decode from arbitrary offset in buffer', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.uint8Array({ minLength: 0, maxLength: 10 }),
            packObjectTypeArb,
            objectSizeArb,
            fc.uint8Array({ minLength: 0, maxLength: 10 })
          ),
          ([prefix, type, size, suffix]) => {
            const encoded = encodeTypeAndSize(type, size)
            const buffer = new Uint8Array(prefix.length + encoded.length + suffix.length)
            buffer.set(prefix, 0)
            buffer.set(encoded, prefix.length)
            buffer.set(suffix, prefix.length + encoded.length)

            const { type: decodedType, size: decodedSize, bytesRead } = decodeTypeAndSize(buffer, prefix.length)

            expect(decodedType).toBe(type)
            expect(decodedSize).toBe(size)
            expect(bytesRead).toBe(encoded.length)
          }
        ),
        { numRuns: 500 }
      )
    })
  })

  // =============================================================================
  // Delta Encoding/Decoding Property Tests
  // =============================================================================

  describe('Delta Encoding/Decoding', () => {
    it('should round-trip identical data', () => {
      fc.assert(
        fc.property(binaryDataArb(500), (data) => {
          const delta = createDelta(data, data)
          const reconstructed = applyDelta(data, delta)

          expect(reconstructed).toEqual(data)
        }),
        { numRuns: 200 }
      )
    })

    it('should round-trip completely different data', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.uint8Array({ minLength: 0, maxLength: 200 }),
            fc.uint8Array({ minLength: 0, maxLength: 200 })
          ),
          ([base, target]) => {
            const delta = createDelta(base, target)
            const reconstructed = applyDelta(base, delta)

            expect(reconstructed).toEqual(target)
          }
        ),
        { numRuns: 200 }
      )
    })

    it('should round-trip similar data (simulated edits)', () => {
      fc.assert(
        fc.property(similarDataPairArb(500), ({ base, target }) => {
          const delta = createDelta(base, target)
          const reconstructed = applyDelta(base, delta)

          expect(reconstructed).toEqual(target)
        }),
        { numRuns: 200 }
      )
    })

    it('should round-trip source-code-like data', () => {
      fc.assert(
        fc.property(
          fc.tuple(sourceCodeLikeDataArb(1000), sourceCodeLikeDataArb(1000)),
          ([base, target]) => {
            const delta = createDelta(base, target)
            const reconstructed = applyDelta(base, delta)

            expect(reconstructed).toEqual(target)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should handle empty base with non-empty target', () => {
      fc.assert(
        fc.property(binaryDataArb(200), (target) => {
          const base = new Uint8Array(0)
          const delta = createDelta(base, target)
          const reconstructed = applyDelta(base, delta)

          expect(reconstructed).toEqual(target)
        }),
        { numRuns: 200 }
      )
    })

    it('should handle non-empty base with empty target', () => {
      fc.assert(
        fc.property(binaryDataArb(200), (base) => {
          const target = new Uint8Array(0)
          const delta = createDelta(base, target)
          const reconstructed = applyDelta(base, delta)

          expect(reconstructed).toEqual(target)
        }),
        { numRuns: 200 }
      )
    })

    it('should handle both empty base and target', () => {
      const base = new Uint8Array(0)
      const target = new Uint8Array(0)
      const delta = createDelta(base, target)
      const reconstructed = applyDelta(base, delta)

      expect(reconstructed).toEqual(target)
    })

    it('should produce delta with correct source and target sizes', () => {
      fc.assert(
        fc.property(
          fc.tuple(binaryDataArb(300), binaryDataArb(300)),
          ([base, target]) => {
            const delta = createDelta(base, target)

            // Parse the delta header
            const sourceHeader = parseDeltaHeader(delta, 0)
            const targetHeader = parseDeltaHeader(delta, sourceHeader.bytesRead)

            expect(sourceHeader.size).toBe(base.length)
            expect(targetHeader.size).toBe(target.length)
          }
        ),
        { numRuns: 200 }
      )
    })

    it('should create smaller delta for similar data vs completely different', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 100, maxLength: 500 }),
          (base) => {
            // Create similar target (small modification)
            const similarTarget = new Uint8Array(base)
            if (similarTarget.length > 0) {
              similarTarget[0] = (similarTarget[0] + 1) & 0xff
            }

            // Create completely different target
            const differentTarget = new Uint8Array(base.length)
            for (let i = 0; i < differentTarget.length; i++) {
              differentTarget[i] = (base[i] ^ 0xff) & 0xff
            }

            const similarDelta = createDelta(base, similarTarget)
            const differentDelta = createDelta(base, differentTarget)

            // Similar data should produce smaller or equal delta
            // (There's some overhead, so we use a reasonable tolerance)
            expect(similarDelta.length).toBeLessThanOrEqual(differentDelta.length + 10)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should handle data with repeating patterns', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.uint8Array({ minLength: 1, maxLength: 10 }), // Pattern
            fc.integer({ min: 2, max: 50 })                  // Repetitions
          ),
          ([pattern, repetitions]) => {
            // Create base with repeated pattern
            const base = new Uint8Array(pattern.length * repetitions)
            for (let i = 0; i < repetitions; i++) {
              base.set(pattern, i * pattern.length)
            }

            // Create target with same pattern but one extra repetition
            const target = new Uint8Array(pattern.length * (repetitions + 1))
            for (let i = 0; i < repetitions + 1; i++) {
              target.set(pattern, i * pattern.length)
            }

            const delta = createDelta(base, target)
            const reconstructed = applyDelta(base, delta)

            expect(reconstructed).toEqual(target)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should handle inserting data at various positions', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.uint8Array({ minLength: 10, maxLength: 200 }),
            fc.uint8Array({ minLength: 1, maxLength: 50 }),
            fc.nat()
          ),
          ([base, insertion, positionSeed]) => {
            // Calculate insertion position
            const insertPos = base.length > 0 ? positionSeed % (base.length + 1) : 0

            // Create target with insertion
            const target = new Uint8Array(base.length + insertion.length)
            target.set(base.slice(0, insertPos), 0)
            target.set(insertion, insertPos)
            target.set(base.slice(insertPos), insertPos + insertion.length)

            const delta = createDelta(base, target)
            const reconstructed = applyDelta(base, delta)

            expect(reconstructed).toEqual(target)
          }
        ),
        { numRuns: 200 }
      )
    })

    it('should handle deleting data from various positions', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.uint8Array({ minLength: 10, maxLength: 200 }),
            fc.nat(),
            fc.nat()
          ),
          ([base, startSeed, lengthSeed]) => {
            if (base.length === 0) return

            // Calculate deletion range
            const deleteStart = startSeed % base.length
            const maxDeleteLen = base.length - deleteStart
            const deleteLen = maxDeleteLen > 0 ? (lengthSeed % maxDeleteLen) + 1 : 0

            if (deleteLen === 0) return

            // Create target with deletion
            const target = new Uint8Array(base.length - deleteLen)
            target.set(base.slice(0, deleteStart), 0)
            target.set(base.slice(deleteStart + deleteLen), deleteStart)

            const delta = createDelta(base, target)
            const reconstructed = applyDelta(base, delta)

            expect(reconstructed).toEqual(target)
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  // =============================================================================
  // Delta Header Parsing Property Tests
  // =============================================================================

  describe('Delta Header Parsing', () => {
    it('should round-trip delta header values', () => {
      fc.assert(
        fc.property(varintValueArb, (size) => {
          // Create a minimal delta-like structure with source and target sizes
          const sourceSize = encodeVarintForDelta(size)
          const targetSize = encodeVarintForDelta(size + 1)
          const delta = new Uint8Array(sourceSize.length + targetSize.length)
          delta.set(sourceSize, 0)
          delta.set(targetSize, sourceSize.length)

          const sourceHeader = parseDeltaHeader(delta, 0)
          const targetHeader = parseDeltaHeader(delta, sourceHeader.bytesRead)

          expect(sourceHeader.size).toBe(size)
          expect(targetHeader.size).toBe(size + 1)
        }),
        { numRuns: 500 }
      )
    })

    it('should handle boundary values correctly', () => {
      const boundaryValues = [0, 127, 128, 16383, 16384, 2097151, 2097152]

      for (const value of boundaryValues) {
        const encoded = encodeVarintForDelta(value)
        const { size, bytesRead } = parseDeltaHeader(encoded, 0)

        expect(size).toBe(value)
        expect(bytesRead).toBe(encoded.length)
      }
    })
  })

  // =============================================================================
  // Pack File Property Tests
  // =============================================================================

  describe('Pack File Creation', () => {
    it('should create valid packfiles for any set of objects', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(packObjectTypeStringArb, binaryDataArb(200)),
            { minLength: 1, maxLength: 10 }
          ),
          (objects) => {
            const packableObjects = objects.map(([type, data]) => ({ type, data }))
            const packfile = createPackfile(packableObjects)

            // Verify header
            const header = parsePackHeader(packfile)
            expect(header.signature).toBe(PACK_SIGNATURE)
            expect(header.version).toBe(PACK_VERSION)
            expect(header.objectCount).toBe(objects.length)

            // Verify checksum exists (20 bytes at end)
            expect(packfile.length).toBeGreaterThan(12 + 20)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should create packfile with correct signature', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(packObjectTypeStringArb, binaryDataArb(100)),
            { minLength: 1, maxLength: 5 }
          ),
          (objects) => {
            const packableObjects = objects.map(([type, data]) => ({ type, data }))
            const packfile = createPackfile(packableObjects)

            // Check signature bytes
            expect(packfile[0]).toBe(0x50) // P
            expect(packfile[1]).toBe(0x41) // A
            expect(packfile[2]).toBe(0x43) // C
            expect(packfile[3]).toBe(0x4b) // K
          }
        ),
        { numRuns: 50 }
      )
    })

    it('should create packfile with correct version', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(packObjectTypeStringArb, binaryDataArb(100)),
            { minLength: 1, maxLength: 5 }
          ),
          (objects) => {
            const packableObjects = objects.map(([type, data]) => ({ type, data }))
            const packfile = createPackfile(packableObjects)

            // Check version bytes (big-endian 2)
            expect(packfile[4]).toBe(0)
            expect(packfile[5]).toBe(0)
            expect(packfile[6]).toBe(0)
            expect(packfile[7]).toBe(2)
          }
        ),
        { numRuns: 50 }
      )
    })

    it('should create packfile with correct object count', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (count) => {
            const objects = Array.from({ length: count }, () => ({
              type: 'blob' as const,
              data: new Uint8Array([0x41])
            }))
            const packfile = createPackfile(objects)

            // Check object count bytes (big-endian)
            const objectCount =
              (packfile[8] << 24) |
              (packfile[9] << 16) |
              (packfile[10] << 8) |
              packfile[11]

            expect(objectCount).toBe(count)
          }
        ),
        { numRuns: 50 }
      )
    })
  })

  // =============================================================================
  // Edge Case Tests
  // =============================================================================

  describe('Edge Cases', () => {
    it('should handle single-byte data', () => {
      fc.assert(
        fc.property(fc.uint8Array({ minLength: 1, maxLength: 1 }), (base) => {
          const target = new Uint8Array([base[0] ^ 0xff])
          const delta = createDelta(base, target)
          const reconstructed = applyDelta(base, delta)

          expect(reconstructed).toEqual(target)
        }),
        { numRuns: 100 }
      )
    })

    it('should handle data with all zeros', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 500 }), (size) => {
          const base = new Uint8Array(size)
          const target = new Uint8Array(size + 10)

          const delta = createDelta(base, target)
          const reconstructed = applyDelta(base, delta)

          expect(reconstructed).toEqual(target)
        }),
        { numRuns: 100 }
      )
    })

    it('should handle data with all 0xFF bytes', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 500 }), (size) => {
          const base = new Uint8Array(size).fill(0xff)
          const target = new Uint8Array(size + 10).fill(0xff)

          const delta = createDelta(base, target)
          const reconstructed = applyDelta(base, delta)

          expect(reconstructed).toEqual(target)
        }),
        { numRuns: 100 }
      )
    })

    it('should handle maximum insert size (127 bytes) boundary', () => {
      const base = new Uint8Array(0)

      // Exactly 127 bytes (max single insert)
      const target127 = new Uint8Array(127).fill(0x42)
      const delta127 = createDelta(base, target127)
      const reconstructed127 = applyDelta(base, delta127)
      expect(reconstructed127).toEqual(target127)

      // 128 bytes (requires multiple inserts)
      const target128 = new Uint8Array(128).fill(0x42)
      const delta128 = createDelta(base, target128)
      const reconstructed128 = applyDelta(base, delta128)
      expect(reconstructed128).toEqual(target128)
    })

    it('should handle copy size of exactly 0x10000 (special encoding)', () => {
      // This is a specific edge case in the delta format
      const size = 0x10000 // 65536
      const base = new Uint8Array(size)
      for (let i = 0; i < size; i++) {
        base[i] = i & 0xff
      }

      const target = new Uint8Array(base) // Same content

      const delta = createDelta(base, target)
      const reconstructed = applyDelta(base, delta)

      expect(reconstructed.length).toBe(size)
      expect(reconstructed).toEqual(target)
    })

    it('should handle alternating data patterns', () => {
      fc.assert(
        fc.property(fc.integer({ min: 10, max: 500 }), (size) => {
          const base = new Uint8Array(size)
          for (let i = 0; i < size; i++) {
            base[i] = i % 2 === 0 ? 0xaa : 0x55
          }

          const target = new Uint8Array(size)
          for (let i = 0; i < size; i++) {
            target[i] = i % 2 === 0 ? 0x55 : 0xaa // Inverted pattern
          }

          const delta = createDelta(base, target)
          const reconstructed = applyDelta(base, delta)

          expect(reconstructed).toEqual(target)
        }),
        { numRuns: 100 }
      )
    })
  })
})

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Encodes a size value for delta header format (varint encoding).
 */
function encodeVarintForDelta(size: number): Uint8Array {
  const bytes: number[] = []
  let value = size

  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value > 0) {
      byte |= 0x80
    }
    bytes.push(byte)
  } while (value > 0)

  return new Uint8Array(bytes)
}
