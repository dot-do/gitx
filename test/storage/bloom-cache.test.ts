import { describe, it, expect, beforeEach } from 'vitest'
import { BloomFilter } from '../../src/storage/bloom-cache'

describe('BloomFilter', () => {
  let filter: BloomFilter

  beforeEach(() => {
    filter = new BloomFilter(1024, 3)
  })

  describe('add and mightContain', () => {
    it('should return true for added items', () => {
      filter.add('abc123')
      expect(filter.mightContain('abc123')).toBe(true)
    })

    it('should return false for items not added (with high probability)', () => {
      filter.add('abc123')
      // With a small filter and few items, false positives are unlikely
      expect(filter.mightContain('xyz789')).toBe(false)
    })

    it('should handle multiple items', () => {
      const shas = Array.from({ length: 10 }, (_, i) => 'a'.repeat(i + 1).padEnd(40, '0'))
      for (const sha of shas) {
        filter.add(sha)
      }
      for (const sha of shas) {
        expect(filter.mightContain(sha)).toBe(true)
      }
    })

    it('should track count', () => {
      expect(filter.count).toBe(0)
      filter.add('abc')
      expect(filter.count).toBe(1)
      filter.add('def')
      expect(filter.count).toBe(2)
    })
  })

  describe('clear', () => {
    it('should clear all data', () => {
      filter.add('abc123')
      filter.clear()
      expect(filter.mightContain('abc123')).toBe(false)
      expect(filter.count).toBe(0)
    })
  })

  describe('serialize and load', () => {
    it('should roundtrip through serialization', () => {
      filter.add('abc123')
      filter.add('def456')

      const serialized = filter.serialize()
      const count = filter.count

      const filter2 = new BloomFilter(1024, 3)
      filter2.load(serialized, count)

      expect(filter2.mightContain('abc123')).toBe(true)
      expect(filter2.mightContain('def456')).toBe(true)
      expect(filter2.count).toBe(2)
    })
  })

  describe('falsePositiveRate', () => {
    it('should be 0 for empty filter', () => {
      expect(filter.falsePositiveRate).toBe(0)
    })

    it('should increase with more items', () => {
      for (let i = 0; i < 50; i++) {
        filter.add(`sha-${i}`)
      }
      const rate = filter.falsePositiveRate
      expect(rate).toBeGreaterThan(0)
      expect(rate).toBeLessThan(1)
    })
  })
})
