import { describe, it, expect } from 'vitest'
import {
  encodePktLine,
  decodePktLine,
  encodeFlushPkt,
  encodeDelimPkt,
  encodeResponseEndPkt,
  pktLineStream,
  FLUSH_PKT,
  DELIM_PKT,
  RESPONSE_END_PKT,
  MAX_PKT_LINE_DATA,
  MAX_PKT_LINE_SIZE,
  PKT_LINE_LENGTH_SIZE,
} from '../../src/wire/pkt-line'

describe('pkt-line', () => {
  describe('encodePktLine', () => {
    it('should encode a simple string', () => {
      const result = encodePktLine('hello')
      // 4 bytes for length + 5 bytes for 'hello' = 9 = 0009
      expect(result).toBe('0009hello')
    })

    it('should encode a string with newline', () => {
      const result = encodePktLine('hello\n')
      // 4 bytes for length + 6 bytes = 10 = 000a
      expect(result).toBe('000ahello\n')
    })

    it('should encode an empty string', () => {
      const result = encodePktLine('')
      // 4 bytes for length + 0 bytes = 4 = 0004
      expect(result).toBe('0004')
    })

    it('should handle longer strings', () => {
      const data = 'a'.repeat(100)
      const result = encodePktLine(data)
      // 4 + 100 = 104 = 0x68
      expect(result).toBe('0068' + data)
    })

    it('should encode Uint8Array data', () => {
      const data = new TextEncoder().encode('test')
      const result = encodePktLine(data)
      // 4 + 4 = 8 = 0008
      expect(result).toBe('0008test')
    })

    it('should handle binary data with Uint8Array', () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0xff])
      const result = encodePktLine(data)
      // Returns Uint8Array for binary data
      expect(result).toBeInstanceOf(Uint8Array)
      // 4 hex chars + 4 bytes = check first 4 bytes are '0008'
      const decoded = new TextDecoder().decode((result as Uint8Array).slice(0, 4))
      expect(decoded).toBe('0008')
    })

    it('should use lowercase hex digits', () => {
      // Per git protocol spec, hex should be lowercase
      const data = 'a'.repeat(12) // 4 + 12 = 16 = 0x10
      const result = encodePktLine(data)
      expect(result).toBe('0010' + data)
      expect(result).not.toMatch(/[A-F]/) // No uppercase hex
    })

    it('should handle data at boundary lengths requiring different hex digits', () => {
      // Test various lengths that exercise different hex positions
      // 255 bytes total = 0x00ff
      const data251 = 'x'.repeat(251)
      expect(encodePktLine(data251)).toBe('00ff' + data251)

      // 256 bytes total = 0x0100
      const data252 = 'x'.repeat(252)
      expect(encodePktLine(data252)).toBe('0100' + data252)

      // 4096 bytes total = 0x1000
      const data4092 = 'x'.repeat(4092)
      expect(encodePktLine(data4092)).toBe('1000' + data4092)
    })

    it('should preserve null bytes in Uint8Array encoding', () => {
      const data = new Uint8Array([0x00, 0x00, 0x00])
      const result = encodePktLine(data)
      expect(result).toBeInstanceOf(Uint8Array)
      expect((result as Uint8Array).length).toBe(7) // 4 hex + 3 data
    })

    it('should handle mixed printable and non-printable bytes', () => {
      // "hi" + null byte
      const data = new Uint8Array([0x68, 0x69, 0x00])
      const result = encodePktLine(data)
      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should encode carriage return and line feed correctly', () => {
      const result = encodePktLine('line\r\n')
      expect(result).toBe('000aline\r\n')
    })
  })

  describe('decodePktLine', () => {
    it('should decode a simple pkt-line', () => {
      const result = decodePktLine('0009hello')
      expect(result).toEqual({ data: 'hello', bytesRead: 9 })
    })

    it('should decode a pkt-line with newline', () => {
      const result = decodePktLine('000ahello\n')
      expect(result).toEqual({ data: 'hello\n', bytesRead: 10 })
    })

    it('should decode an empty data pkt-line', () => {
      const result = decodePktLine('0004')
      expect(result).toEqual({ data: '', bytesRead: 4 })
    })

    it('should detect flush-pkt', () => {
      const result = decodePktLine('0000')
      expect(result).toEqual({ data: null, type: 'flush', bytesRead: 4 })
    })

    it('should detect delim-pkt', () => {
      const result = decodePktLine('0001')
      expect(result).toEqual({ data: null, type: 'delim', bytesRead: 4 })
    })

    it('should decode from Uint8Array', () => {
      const input = new TextEncoder().encode('0009hello')
      const result = decodePktLine(input)
      expect(result.data).toBe('hello')
      expect(result.bytesRead).toBe(9)
    })

    it('should handle incomplete data', () => {
      const result = decodePktLine('000')
      expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
    })

    it('should handle data shorter than declared length', () => {
      const result = decodePktLine('0009hel')
      expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
    })

    it('should throw error for oversized packets', () => {
      // Create a hex length that exceeds MAX_PKT_LINE_SIZE (65520)
      // ffff = 65535 which exceeds the maximum
      const oversizedPacket = 'ffff' + 'x'.repeat(65535 - PKT_LINE_LENGTH_SIZE)
      expect(() => decodePktLine(oversizedPacket)).toThrow(
        `Packet too large: 65535 bytes exceeds maximum ${MAX_PKT_LINE_SIZE}`
      )
    })

    it('should accept packets at maximum allowed size', () => {
      // MAX_PKT_LINE_SIZE = 65520, which in hex is fff0
      const hexLength = MAX_PKT_LINE_SIZE.toString(16).padStart(PKT_LINE_LENGTH_SIZE, '0')
      // We don't need the full data, just check it doesn't throw
      // It will return incomplete since we don't have enough data
      const packet = hexLength + 'x'.repeat(10)
      const result = decodePktLine(packet)
      expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
    })

    it('should handle invalid hex length gracefully', () => {
      // 'ZZZZ' is not valid hex
      const result = decodePktLine('ZZZZdata')
      expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
    })

    it('should handle length less than 4 as incomplete', () => {
      // Length of 3 (0003) would mean negative data, treat as invalid
      const result = decodePktLine('0003')
      expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
    })

    it('should decode uppercase hex length', () => {
      // Git clients may send uppercase hex
      const result = decodePktLine('000Ahello\n')
      expect(result).toEqual({ data: 'hello\n', bytesRead: 10 })
    })

    it('should decode mixed case hex length', () => {
      const result = decodePktLine('000aHELLO\n')
      expect(result).toEqual({ data: 'HELLO\n', bytesRead: 10 })
    })

    it('should handle response-end packet (0002)', () => {
      // 0002 is response-end in protocol v2, currently treated as data length 2
      // which is < 4, so invalid
      const result = decodePktLine('0002')
      expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
    })

    it('should handle multiple packets with offset data', () => {
      const input = '0009hello0009world'
      const result1 = decodePktLine(input)
      expect(result1.data).toBe('hello')
      expect(result1.bytesRead).toBe(9)

      // Decode from offset
      const result2 = decodePktLine(input.slice(9))
      expect(result2.data).toBe('world')
      expect(result2.bytesRead).toBe(9)
    })

    it('should handle git protocol capability line format', () => {
      // Real git format: SHA + space + ref + null + capabilities
      const capLine = '003fab123456789012345678901234567890123456 refs/heads/main\x00side-band'
      const result = decodePktLine(capLine)
      expect(result.data).toContain('refs/heads/main')
      expect(result.data).toContain('\x00')
      expect(result.bytesRead).toBe(63)
    })
  })

  describe('encodeFlushPkt', () => {
    it('should return flush packet constant', () => {
      expect(encodeFlushPkt()).toBe('0000')
    })

    it('should equal FLUSH_PKT constant', () => {
      expect(encodeFlushPkt()).toBe(FLUSH_PKT)
    })
  })

  describe('encodeDelimPkt', () => {
    it('should return delim packet constant', () => {
      expect(encodeDelimPkt()).toBe('0001')
    })

    it('should equal DELIM_PKT constant', () => {
      expect(encodeDelimPkt()).toBe(DELIM_PKT)
    })
  })

  describe('encodeResponseEndPkt', () => {
    it('should return response-end packet constant', () => {
      expect(encodeResponseEndPkt()).toBe('0002')
    })

    it('should equal RESPONSE_END_PKT constant', () => {
      expect(encodeResponseEndPkt()).toBe(RESPONSE_END_PKT)
    })
  })

  describe('pktLineStream', () => {
    it('should parse multiple pkt-lines', () => {
      const input = '0009hello0009world0000'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: 'hello', type: 'data' },
        { data: 'world', type: 'data' },
        { data: null, type: 'flush' },
      ])
      expect(result.remaining).toBe('')
    })

    it('should handle incomplete trailing data', () => {
      const input = '0009hello0009wor'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([{ data: 'hello', type: 'data' }])
      expect(result.remaining).toBe('0009wor')
    })

    it('should handle empty input', () => {
      const result = pktLineStream('')
      expect(result.packets).toEqual([])
      expect(result.remaining).toBe('')
    })

    it('should parse from Uint8Array', () => {
      const input = new TextEncoder().encode('0009hello0000')
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: 'hello', type: 'data' },
        { data: null, type: 'flush' },
      ])
    })

    it('should handle delim packets in stream', () => {
      const input = '0009hello00010009world0000'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: 'hello', type: 'data' },
        { data: null, type: 'delim' },
        { data: 'world', type: 'data' },
        { data: null, type: 'flush' },
      ])
    })

    it('should handle real git protocol example', () => {
      // Example: git capabilities advertisement
      const input = '000eversion 2\n0000'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: 'version 2\n', type: 'data' },
        { data: null, type: 'flush' },
      ])
    })

    it('should handle consecutive flush packets', () => {
      const input = '00000000'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: null, type: 'flush' },
        { data: null, type: 'flush' },
      ])
    })

    it('should handle consecutive delim packets', () => {
      const input = '00010001'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: null, type: 'delim' },
        { data: null, type: 'delim' },
      ])
    })

    it('should handle real ls-refs command response', () => {
      // Simulated ls-refs response format
      // "ab12cd34 refs/HEAD\n" = 19 chars + 4 = 23 = 0x17
      // "ab12cd34 refs/heads/main\n" = 25 chars + 4 = 29 = 0x1d
      const input =
        '0017ab12cd34 refs/HEAD\n' +
        '001dab12cd34 refs/heads/main\n' +
        '0000'
      const result = pktLineStream(input)
      expect(result.packets.length).toBe(3)
      expect(result.packets[0].data).toBe('ab12cd34 refs/HEAD\n')
      expect(result.packets[1].data).toBe('ab12cd34 refs/heads/main\n')
      expect(result.packets[2].type).toBe('flush')
    })

    it('should handle protocol v2 fetch command structure', () => {
      // Protocol v2 command: metadata, delim, arguments, flush
      // "command=fetch" = 13 chars + 4 = 17 = 0x11
      // "want abc123" = 11 chars + 4 = 15 = 0x0f
      const input =
        '0011command=fetch' +
        '0001' + // delim
        '000fwant abc123' +
        '0000' // flush
      const result = pktLineStream(input)
      expect(result.packets).toEqual([
        { data: 'command=fetch', type: 'data' },
        { data: null, type: 'delim' },
        { data: 'want abc123', type: 'data' },
        { data: null, type: 'flush' },
      ])
    })

    it('should accumulate remaining data across multiple calls', () => {
      // Simulate streaming: first chunk
      const chunk1 = '0009hello000'
      const result1 = pktLineStream(chunk1)
      expect(result1.packets).toEqual([{ data: 'hello', type: 'data' }])
      expect(result1.remaining).toBe('000')

      // Second chunk completes the packet
      const chunk2 = result1.remaining + '9world0000'
      const result2 = pktLineStream(chunk2)
      expect(result2.packets).toEqual([
        { data: 'world', type: 'data' },
        { data: null, type: 'flush' },
      ])
      expect(result2.remaining).toBe('')
    })

    it('should handle only flush packets', () => {
      const input = '0000'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([{ data: null, type: 'flush' }])
      expect(result.remaining).toBe('')
    })

    it('should handle only delim packets', () => {
      const input = '0001'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([{ data: null, type: 'delim' }])
      expect(result.remaining).toBe('')
    })

    it('should handle incomplete length prefix', () => {
      const input = '00'
      const result = pktLineStream(input)
      expect(result.packets).toEqual([])
      expect(result.remaining).toBe('00')
    })

    it('should handle exactly 4 bytes that is incomplete data', () => {
      const input = '0005' // Length 5, but no data after prefix
      const result = pktLineStream(input)
      expect(result.packets).toEqual([])
      expect(result.remaining).toBe('0005')
    })

    it('should process large number of packets', () => {
      // Create 100 packets
      let input = ''
      for (let i = 0; i < 100; i++) {
        input += '0008test'
      }
      input += '0000'

      const result = pktLineStream(input)
      expect(result.packets.length).toBe(101) // 100 data + 1 flush
      expect(result.packets[100]).toEqual({ data: null, type: 'flush' })
    })
  })

  describe('round-trip encoding/decoding', () => {
    it('should round-trip simple strings', () => {
      const original = 'hello world'
      const encoded = encodePktLine(original)
      const decoded = decodePktLine(encoded as string)
      expect(decoded.data).toBe(original)
    })

    it('should round-trip strings with special characters', () => {
      const original = 'refs/heads/feature/test-branch\n'
      const encoded = encodePktLine(original)
      const decoded = decodePktLine(encoded as string)
      expect(decoded.data).toBe(original)
    })

    it('should round-trip strings with null bytes', () => {
      const original = 'data\x00capability'
      const encoded = encodePktLine(original)
      const decoded = decodePktLine(encoded as string)
      expect(decoded.data).toBe(original)
    })

    it('should round-trip empty string', () => {
      const original = ''
      const encoded = encodePktLine(original)
      const decoded = decodePktLine(encoded as string)
      expect(decoded.data).toBe(original)
    })
  })

  describe('size validation security', () => {
    describe('decodePktLine size validation', () => {
      it('should reject packets exceeding MAX_PKT_LINE_SIZE early', () => {
        // fff1 = 65521 which is just 1 byte over the maximum
        const oversizedPacket = 'fff1' + 'x'.repeat(100)
        expect(() => decodePktLine(oversizedPacket)).toThrow(
          `Packet too large: 65521 bytes exceeds maximum ${MAX_PKT_LINE_SIZE}`
        )
      })

      it('should reject packets at ffff (65535 bytes)', () => {
        const maxHexPacket = 'ffff' + 'x'.repeat(100)
        expect(() => decodePktLine(maxHexPacket)).toThrow(
          `Packet too large: 65535 bytes exceeds maximum ${MAX_PKT_LINE_SIZE}`
        )
      })

      it('should accept packets at exactly MAX_PKT_LINE_SIZE (65520 bytes)', () => {
        // fff0 = 65520 which is exactly the maximum
        const maxAllowedData = 'x'.repeat(MAX_PKT_LINE_SIZE - PKT_LINE_LENGTH_SIZE)
        const packet = 'fff0' + maxAllowedData
        const result = decodePktLine(packet)
        expect(result.data).toBe(maxAllowedData)
        expect(result.bytesRead).toBe(MAX_PKT_LINE_SIZE)
      })

      it('should handle length prefix with minimum valid size (4 = 0004)', () => {
        // 0004 is the minimum valid length (just the prefix, no data)
        const result = decodePktLine('0004')
        expect(result).toEqual({ data: '', bytesRead: 4 })
      })

      it('should reject length 0003 as invalid (less than prefix size)', () => {
        const result = decodePktLine('0003')
        expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
      })

      it('should reject length 0002 as invalid (reserved for response-end)', () => {
        const result = decodePktLine('0002')
        expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
      })

      it('should handle invalid hex characters in length prefix', () => {
        const invalidHexCases = ['gggg', 'GGGG', '00g0', '000g', ' 000', '000 ', '00-1']
        for (const hex of invalidHexCases) {
          const result = decodePktLine(hex + 'data')
          expect(result).toEqual({ data: null, type: 'incomplete', bytesRead: 0 })
        }
      })

      it('should validate size before attempting data extraction', () => {
        // This test ensures the size check happens BEFORE trying to slice data
        // If we had a huge length like fff1 and tried to slice first, we'd waste resources
        const oversizedLength = 'fff1' // 65521 bytes
        expect(() => decodePktLine(oversizedLength)).toThrow(/Packet too large/)
      })
    })

    describe('encodePktLine size validation', () => {
      it('should reject data exceeding MAX_PKT_LINE_DATA (65516 bytes)', () => {
        const oversizedData = 'x'.repeat(MAX_PKT_LINE_DATA + 1)
        expect(() => encodePktLine(oversizedData)).toThrow(
          `Data too large: ${MAX_PKT_LINE_DATA + 1} bytes exceeds maximum ${MAX_PKT_LINE_DATA}`
        )
      })

      it('should accept data at exactly MAX_PKT_LINE_DATA (65516 bytes)', () => {
        const maxData = 'x'.repeat(MAX_PKT_LINE_DATA)
        const result = encodePktLine(maxData)
        expect(typeof result).toBe('string')
        expect((result as string).startsWith('fff0')).toBe(true) // 65520 in hex
      })

      it('should reject Uint8Array data exceeding MAX_PKT_LINE_DATA', () => {
        const oversizedData = new Uint8Array(MAX_PKT_LINE_DATA + 1).fill(0x41) // 'A'
        expect(() => encodePktLine(oversizedData)).toThrow(
          `Data too large: ${MAX_PKT_LINE_DATA + 1} bytes exceeds maximum ${MAX_PKT_LINE_DATA}`
        )
      })

      it('should accept Uint8Array data at exactly MAX_PKT_LINE_DATA', () => {
        const maxData = new Uint8Array(MAX_PKT_LINE_DATA).fill(0x41) // 'A'
        const result = encodePktLine(maxData)
        // Should not throw
        expect(result).toBeDefined()
      })

      it('should validate size before processing data', () => {
        // Ensure the size check happens early, before any encoding work
        const oversizedData = 'x'.repeat(MAX_PKT_LINE_DATA + 100)
        expect(() => encodePktLine(oversizedData)).toThrow(/Data too large/)
      })
    })

    describe('pktLineStream size validation', () => {
      it('should throw on oversized packet in stream', () => {
        const validPacket = '0009hello'
        const oversizedPacket = 'ffff' + 'x'.repeat(100)
        const stream = validPacket + oversizedPacket
        expect(() => pktLineStream(stream)).toThrow(/Packet too large/)
      })

      it('should process valid packets before failing on oversized one', () => {
        // The stream function processes sequentially, so it should process
        // valid packets but then throw when hitting the oversized one
        const stream = '0009hello' + 'fff1' + 'x'.repeat(100)
        expect(() => pktLineStream(stream)).toThrow(/Packet too large/)
      })
    })
  })

  describe('constants', () => {
    it('should have correct FLUSH_PKT value', () => {
      expect(FLUSH_PKT).toBe('0000')
    })

    it('should have correct DELIM_PKT value', () => {
      expect(DELIM_PKT).toBe('0001')
    })

    it('should have correct RESPONSE_END_PKT value', () => {
      expect(RESPONSE_END_PKT).toBe('0002')
    })

    it('should have correct PKT_LINE_LENGTH_SIZE value', () => {
      expect(PKT_LINE_LENGTH_SIZE).toBe(4)
    })

    it('should have correct MAX_PKT_LINE_SIZE value', () => {
      expect(MAX_PKT_LINE_SIZE).toBe(65520)
    })

    it('should have correct MAX_PKT_LINE_DATA value', () => {
      // MAX_PKT_LINE_SIZE - PKT_LINE_LENGTH_SIZE = 65520 - 4 = 65516
      expect(MAX_PKT_LINE_DATA).toBe(65516)
      expect(MAX_PKT_LINE_DATA).toBe(MAX_PKT_LINE_SIZE - PKT_LINE_LENGTH_SIZE)
    })
  })
})
