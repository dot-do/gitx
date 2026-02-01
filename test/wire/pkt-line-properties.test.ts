import { describe, it, expect } from 'vitest'
import {
  encodePktLine,
  decodePktLine,
  pktLineStream,
  PKT_LINE_LENGTH_SIZE,
  MAX_PKT_LINE_DATA,
} from '../../src/wire/pkt-line'

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

const rng = mulberry32(99)

/** Generate a random integer in [min, max) */
function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min)) + min
}

/** Generate a random printable ASCII string of given length */
function randPrintableString(len: number): string {
  const chars: string[] = []
  for (let i = 0; i < len; i++) {
    // printable ASCII range 0x20 - 0x7e
    chars.push(String.fromCharCode(randInt(0x20, 0x7f)))
  }
  return chars.join('')
}

/** Generate a random Uint8Array with arbitrary byte values */
function randBytes(len: number): Uint8Array {
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = randInt(0, 256)
  }
  return bytes
}

// ============================================================================
// Property-based tests for encodePktLine / decodePktLine (string round-trip)
// ============================================================================

describe('encodePktLine / decodePktLine string round-trip properties', () => {
  it('round-trips for 200 random printable ASCII strings', () => {
    for (let i = 0; i < 200; i++) {
      const len = randInt(1, 500)
      const original = randPrintableString(len)
      const encoded = encodePktLine(original)

      // For string input, encodePktLine returns a string
      expect(typeof encoded).toBe('string')

      const decoded = decodePktLine(encoded as string)
      expect(decoded.data).toBe(original)
      expect(decoded.bytesRead).toBe(PKT_LINE_LENGTH_SIZE + original.length)
      expect(decoded.type).toBeUndefined()
    }
  })

  it('round-trips for edge-case string lengths', () => {
    const edgeLengths = [
      1,      // single character
      4,      // same as prefix length
      100,    // moderate
      1000,   // larger
    ]
    for (const len of edgeLengths) {
      const original = randPrintableString(len)
      const encoded = encodePktLine(original) as string
      const decoded = decodePktLine(encoded)
      expect(decoded.data).toBe(original)
      expect(decoded.bytesRead).toBe(PKT_LINE_LENGTH_SIZE + original.length)
    }
  })

  it('length prefix is correct hex value', () => {
    for (let i = 0; i < 100; i++) {
      const len = randInt(1, 300)
      const original = randPrintableString(len)
      const encoded = encodePktLine(original) as string
      const hexPrefix = encoded.slice(0, 4)
      const expectedLength = PKT_LINE_LENGTH_SIZE + original.length
      expect(hexPrefix).toBe(expectedLength.toString(16).padStart(4, '0'))
    }
  })
})

// ============================================================================
// Property-based tests for binary Uint8Array round-trip
// ============================================================================

describe('encodePktLine / decodePktLine binary round-trip properties', () => {
  it('encodes binary payloads with null bytes as Uint8Array', () => {
    for (let i = 0; i < 100; i++) {
      const len = randInt(1, 300)
      const original = randBytes(len)

      // Force at least one null byte to test binary handling
      original[randInt(0, len)] = 0x00

      const encoded = encodePktLine(original)

      // Binary data with null bytes returns Uint8Array
      expect(encoded).toBeInstanceOf(Uint8Array)

      const encodedBytes = encoded as Uint8Array
      // Verify length prefix is correct
      const hexPrefix = new TextDecoder().decode(encodedBytes.slice(0, 4))
      const expectedLen = PKT_LINE_LENGTH_SIZE + original.length
      expect(hexPrefix).toBe(expectedLen.toString(16).padStart(4, '0'))

      // Verify payload bytes match
      const payloadBytes = encodedBytes.slice(4)
      expect(payloadBytes.length).toBe(original.length)
      expect(Array.from(payloadBytes)).toEqual(Array.from(original))
    }
  })

  it('note: decodePktLine uses TextDecoder so binary data with nulls may not fully round-trip', () => {
    // This documents the known limitation: decodePktLine converts input to
    // string via TextDecoder, so binary data containing bytes that produce
    // invalid UTF-8 or null bytes will not round-trip through decode.
    // The encode side correctly produces binary Uint8Array output.
    const data = new Uint8Array([0x00, 0x01, 0x02])
    const encoded = encodePktLine(data) as Uint8Array
    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBe(PKT_LINE_LENGTH_SIZE + 3)
  })

  it('round-trips printable Uint8Array data as string', () => {
    for (let i = 0; i < 100; i++) {
      const text = randPrintableString(randInt(1, 200))
      const originalBytes = new TextEncoder().encode(text)

      const encoded = encodePktLine(originalBytes)

      // Printable content is returned as string
      expect(typeof encoded).toBe('string')

      const decoded = decodePktLine(encoded as string)
      expect(decoded.data).toBe(text)
    }
  })
})

// ============================================================================
// Property-based tests for pktLineStream
// ============================================================================

describe('pktLineStream round-trip properties', () => {
  it('concatenated encoded strings are fully parsed by pktLineStream', () => {
    for (let trial = 0; trial < 50; trial++) {
      const count = randInt(1, 10)
      const originals: string[] = []
      let concatenated = ''

      for (let i = 0; i < count; i++) {
        const s = randPrintableString(randInt(1, 100))
        originals.push(s)
        concatenated += encodePktLine(s) as string
      }

      const { packets, remaining } = pktLineStream(concatenated)
      expect(remaining).toBe('')
      expect(packets.length).toBe(count)

      for (let i = 0; i < count; i++) {
        expect(packets[i]!.type).toBe('data')
        expect(packets[i]!.data).toBe(originals[i])
      }
    }
  })

  it('stream with flush packets parses correctly', () => {
    for (let trial = 0; trial < 50; trial++) {
      const s1 = randPrintableString(randInt(1, 50))
      const s2 = randPrintableString(randInt(1, 50))
      const stream = (encodePktLine(s1) as string) + '0000' + (encodePktLine(s2) as string) + '0000'

      const { packets, remaining } = pktLineStream(stream)
      expect(remaining).toBe('')
      expect(packets.length).toBe(4)
      expect(packets[0]!.data).toBe(s1)
      expect(packets[0]!.type).toBe('data')
      expect(packets[1]!.type).toBe('flush')
      expect(packets[2]!.data).toBe(s2)
      expect(packets[2]!.type).toBe('data')
      expect(packets[3]!.type).toBe('flush')
    }
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('pkt-line edge cases', () => {
  it('encodes and decodes single-byte payload', () => {
    const encoded = encodePktLine('x') as string
    expect(encoded).toBe('0005x')
    const decoded = decodePktLine(encoded)
    expect(decoded.data).toBe('x')
    expect(decoded.bytesRead).toBe(5)
  })

  it('rejects data exceeding MAX_PKT_LINE_DATA', () => {
    const tooLarge = 'a'.repeat(MAX_PKT_LINE_DATA + 1)
    expect(() => encodePktLine(tooLarge)).toThrow(/too large/i)
  })

  it('encodes max-size payload without error', () => {
    const maxPayload = 'a'.repeat(MAX_PKT_LINE_DATA)
    const encoded = encodePktLine(maxPayload) as string
    const decoded = decodePktLine(encoded)
    expect(decoded.data).toBe(maxPayload)
    expect(decoded.bytesRead).toBe(PKT_LINE_LENGTH_SIZE + MAX_PKT_LINE_DATA)
  })

  it('handles Uint8Array with all zero bytes', () => {
    const zeros = new Uint8Array(10)
    const encoded = encodePktLine(zeros)
    expect(encoded).toBeInstanceOf(Uint8Array)
    const decoded = decodePktLine(encoded as Uint8Array)
    expect(decoded.data).not.toBeNull()
    expect(decoded.bytesRead).toBe(PKT_LINE_LENGTH_SIZE + 10)
  })

  it('handles Uint8Array with bytes 0x00 through 0xFF', () => {
    const allBytes = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      allBytes[i] = i
    }
    const encoded = encodePktLine(allBytes)
    expect(encoded).toBeInstanceOf(Uint8Array)
    const decoded = decodePktLine(encoded as Uint8Array)
    expect(decoded.data).not.toBeNull()
    expect(decoded.bytesRead).toBe(PKT_LINE_LENGTH_SIZE + 256)
  })
})
