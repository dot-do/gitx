import { describe, it, expect } from 'vitest'
import {
  PackObjectType,
  encodeVarint,
  decodeVarint,
  encodeTypeAndSize,
  decodeTypeAndSize,
} from '../../src/pack/format'

// ============================================================================
// Helpers: seeded pseudo-random number generation
// ============================================================================

/** Simple mulberry32 PRNG for reproducible tests */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(42)

/** Generate a random integer in [min, max) */
function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min)) + min
}

// ============================================================================
// Valid pack object types (3-bit field, only certain values are valid)
// ============================================================================

const VALID_TYPES: PackObjectType[] = [
  PackObjectType.OBJ_COMMIT,     // 1
  PackObjectType.OBJ_TREE,       // 2
  PackObjectType.OBJ_BLOB,       // 3
  PackObjectType.OBJ_TAG,        // 4
  PackObjectType.OBJ_OFS_DELTA,  // 6
  PackObjectType.OBJ_REF_DELTA,  // 7
]

// ============================================================================
// Property-based tests for encodeVarint / decodeVarint
// ============================================================================

describe('encodeVarint / decodeVarint round-trip properties', () => {
  it('round-trips for 200 random values in [0, 2^28)', () => {
    const upperBound = 2 ** 28
    for (let i = 0; i < 200; i++) {
      const original = randInt(0, upperBound)
      const encoded = encodeVarint(original)
      const { value, bytesRead } = decodeVarint(encoded, 0)
      expect(value).toBe(original)
      expect(bytesRead).toBe(encoded.length)
    }
  })

  it('round-trips for edge-case values', () => {
    const edgeCases = [
      0,
      1,
      127,         // max single-byte varint
      128,         // min two-byte varint
      16383,       // max two-byte varint (2^14 - 1)
      16384,       // min three-byte varint (2^14)
      2097151,     // max three-byte varint (2^21 - 1)
      2097152,     // min four-byte varint (2^21)
      268435455,   // max four-byte varint (2^28 - 1)
    ]
    for (const original of edgeCases) {
      const encoded = encodeVarint(original)
      const { value, bytesRead } = decodeVarint(encoded, 0)
      expect(value).toBe(original)
      expect(bytesRead).toBe(encoded.length)
    }
  })

  it('encoding length matches expected byte count', () => {
    // 1 byte: [0, 128)
    expect(encodeVarint(0).length).toBe(1)
    expect(encodeVarint(127).length).toBe(1)
    // 2 bytes: [128, 16384)
    expect(encodeVarint(128).length).toBe(2)
    expect(encodeVarint(16383).length).toBe(2)
    // 3 bytes: [16384, 2097152)
    expect(encodeVarint(16384).length).toBe(3)
    expect(encodeVarint(2097151).length).toBe(3)
    // 4 bytes: [2097152, 268435456)
    expect(encodeVarint(2097152).length).toBe(4)
    expect(encodeVarint(268435455).length).toBe(4)
  })

  it('decodes correctly at non-zero offsets', () => {
    for (let i = 0; i < 100; i++) {
      const original = randInt(0, 2 ** 28)
      const encoded = encodeVarint(original)

      // Prepend random prefix bytes (with MSB clear so they look like valid single-byte varints)
      const prefixLen = randInt(1, 10)
      const buffer = new Uint8Array(prefixLen + encoded.length)
      for (let j = 0; j < prefixLen; j++) {
        buffer[j] = randInt(0, 128) // MSB clear
      }
      buffer.set(encoded, prefixLen)

      const { value, bytesRead } = decodeVarint(buffer, prefixLen)
      expect(value).toBe(original)
      expect(bytesRead).toBe(encoded.length)
    }
  })
})

// ============================================================================
// Property-based tests for encodeTypeAndSize / decodeTypeAndSize
// ============================================================================

describe('encodeTypeAndSize / decodeTypeAndSize round-trip properties', () => {
  it('round-trips for all valid types with 200 random sizes in [0, 2^25)', () => {
    const upperBound = 2 ** 25
    for (let i = 0; i < 200; i++) {
      const type = VALID_TYPES[randInt(0, VALID_TYPES.length)]!
      const size = randInt(0, upperBound)
      const encoded = encodeTypeAndSize(type, size)
      const { type: decodedType, size: decodedSize, bytesRead } = decodeTypeAndSize(encoded, 0)
      expect(decodedType).toBe(type)
      expect(decodedSize).toBe(size)
      expect(bytesRead).toBe(encoded.length)
    }
  })

  it('round-trips for every valid type with edge-case sizes', () => {
    const edgeSizes = [
      0,
      1,
      15,        // max size in first byte (4-bit field)
      16,        // min size requiring continuation
      2047,      // max size fitting in 2 bytes (4 + 7 = 11 bits)
      2048,      // min size requiring 3 bytes
      262143,    // max size in 3 bytes (4 + 7 + 7 = 18 bits)
      262144,    // min size requiring 4 bytes
      33554431,  // max size in 4 bytes (4 + 7 + 7 + 7 = 25 bits)
    ]
    for (const type of VALID_TYPES) {
      for (const size of edgeSizes) {
        const encoded = encodeTypeAndSize(type, size)
        const { type: decodedType, size: decodedSize, bytesRead } = decodeTypeAndSize(encoded, 0)
        expect(decodedType).toBe(type)
        expect(decodedSize).toBe(size)
        expect(bytesRead).toBe(encoded.length)
      }
    }
  })

  it('type field occupies exactly bits 4-6 of the first byte', () => {
    for (const type of VALID_TYPES) {
      const encoded = encodeTypeAndSize(type, 0)
      const firstByte = encoded[0]!
      const extractedType = (firstByte >> 4) & 0x07
      expect(extractedType).toBe(type)
    }
  })

  it('decodes correctly at non-zero offsets', () => {
    for (let i = 0; i < 100; i++) {
      const type = VALID_TYPES[randInt(0, VALID_TYPES.length)]!
      const size = randInt(0, 2 ** 25)
      const encoded = encodeTypeAndSize(type, size)

      const prefixLen = randInt(1, 10)
      const buffer = new Uint8Array(prefixLen + encoded.length)
      for (let j = 0; j < prefixLen; j++) {
        buffer[j] = 0 // padding bytes
      }
      buffer.set(encoded, prefixLen)

      const { type: decodedType, size: decodedSize, bytesRead } = decodeTypeAndSize(buffer, prefixLen)
      expect(decodedType).toBe(type)
      expect(decodedSize).toBe(size)
      expect(bytesRead).toBe(encoded.length)
    }
  })

  it('size=0 produces a single byte for all types (no continuation needed)', () => {
    for (const type of VALID_TYPES) {
      const encoded = encodeTypeAndSize(type, 0)
      expect(encoded.length).toBe(1)
      // MSB should be 0 (no continuation)
      expect(encoded[0]! & 0x80).toBe(0)
    }
  })

  it('size=16 always requires continuation (cannot fit in 4-bit field)', () => {
    for (const type of VALID_TYPES) {
      const encoded = encodeTypeAndSize(type, 16)
      expect(encoded.length).toBeGreaterThanOrEqual(2)
      // First byte MSB should be 1 (continuation)
      expect(encoded[0]! & 0x80).toBe(0x80)
    }
  })
})
