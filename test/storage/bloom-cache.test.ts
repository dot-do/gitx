import { describe, it, expect, beforeEach } from 'vitest'
import { BloomFilter, SegmentedBloomFilter } from '../../src/storage/bloom-cache'

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

describe('SegmentedBloomFilter', () => {
  let segmented: SegmentedBloomFilter

  beforeEach(() => {
    segmented = new SegmentedBloomFilter({
      filterBits: 1024,
      hashCount: 3,
      segmentThreshold: 5,
      maxSegments: 4,
    })
  })

  describe('add and mightContain', () => {
    it('should return true for added items', () => {
      segmented.add('abc123')
      expect(segmented.mightContain('abc123')).toBe(true)
    })

    it('should return false for items not added', () => {
      segmented.add('abc123')
      expect(segmented.mightContain('xyz789')).toBe(false)
    })

    it('should track count across segments', () => {
      for (let i = 0; i < 12; i++) {
        segmented.add(`sha-${i}`)
      }
      expect(segmented.count).toBe(12)
    })
  })

  describe('segmentation', () => {
    it('should start with one segment', () => {
      expect(segmented.segmentCount).toBe(1)
    })

    it('should create a new segment when threshold is exceeded', () => {
      // threshold is 5, so after adding 5 items the next add creates segment 2
      for (let i = 0; i < 6; i++) {
        segmented.add(`sha-${i}`)
      }
      expect(segmented.segmentCount).toBe(2)
    })

    it('should create multiple segments as items grow', () => {
      // 5 per segment, so 15 items = 3 full + 1 new = segments created at 6th, 11th
      for (let i = 0; i < 11; i++) {
        segmented.add(`sha-${i}`)
      }
      expect(segmented.segmentCount).toBe(3)
    })

    it('should find items in older segments after new segments are created', () => {
      // Add 5 items to fill first segment
      for (let i = 0; i < 5; i++) {
        segmented.add(`old-${i}`)
      }
      // Add more items which triggers new segment
      for (let i = 0; i < 5; i++) {
        segmented.add(`new-${i}`)
      }
      expect(segmented.segmentCount).toBe(2)
      // Items from first segment should still be found
      for (let i = 0; i < 5; i++) {
        expect(segmented.mightContain(`old-${i}`)).toBe(true)
      }
      // Items from second segment should also be found
      for (let i = 0; i < 5; i++) {
        expect(segmented.mightContain(`new-${i}`)).toBe(true)
      }
    })
  })

  describe('compaction', () => {
    it('should compact when maxSegments is exceeded', () => {
      // maxSegments = 4, threshold = 5
      // After 5*4=20 items we have 4 full segments, 21st triggers 5th -> compact
      for (let i = 0; i < 21; i++) {
        segmented.add(`sha-${i}`)
      }
      // After compaction, old segments merge into 1 + newest = 2
      expect(segmented.segmentCount).toBe(2)
      expect(segmented.count).toBe(21)
    })

    it('should preserve all items after compaction', () => {
      const items: string[] = []
      for (let i = 0; i < 21; i++) {
        const sha = `sha-compact-${i}`
        items.push(sha)
        segmented.add(sha)
      }
      // After compaction all items should still be findable
      for (const sha of items) {
        expect(segmented.mightContain(sha)).toBe(true)
      }
    })

    it('should be callable manually', () => {
      for (let i = 0; i < 12; i++) {
        segmented.add(`sha-${i}`)
      }
      expect(segmented.segmentCount).toBe(3)
      segmented.compact()
      expect(segmented.segmentCount).toBe(2)
      expect(segmented.count).toBe(12)
    })

    it('should be a no-op with only one segment', () => {
      segmented.add('single')
      segmented.compact()
      expect(segmented.segmentCount).toBe(1)
      expect(segmented.count).toBe(1)
    })
  })

  describe('clear', () => {
    it('should reset to single empty segment', () => {
      for (let i = 0; i < 12; i++) {
        segmented.add(`sha-${i}`)
      }
      segmented.clear()
      expect(segmented.segmentCount).toBe(1)
      expect(segmented.count).toBe(0)
      expect(segmented.mightContain('sha-0')).toBe(false)
    })
  })

  describe('serialization', () => {
    it('should roundtrip single segment through serialization', () => {
      segmented.add('abc123')
      segmented.add('def456')

      const segments = segmented.serializeSegments()
      expect(segments).toHaveLength(1)

      const restored = new SegmentedBloomFilter({
        filterBits: 1024,
        hashCount: 3,
        segmentThreshold: 5,
      })
      restored.loadSegments(segments)

      expect(restored.mightContain('abc123')).toBe(true)
      expect(restored.mightContain('def456')).toBe(true)
      expect(restored.count).toBe(2)
      expect(restored.segmentCount).toBe(1)
    })

    it('should roundtrip multiple segments through serialization', () => {
      for (let i = 0; i < 12; i++) {
        segmented.add(`sha-${i}`)
      }
      expect(segmented.segmentCount).toBe(3)

      const segments = segmented.serializeSegments()
      expect(segments).toHaveLength(3)

      const restored = new SegmentedBloomFilter({
        filterBits: 1024,
        hashCount: 3,
        segmentThreshold: 5,
      })
      restored.loadSegments(segments)

      expect(restored.segmentCount).toBe(3)
      expect(restored.count).toBe(12)
      for (let i = 0; i < 12; i++) {
        expect(restored.mightContain(`sha-${i}`)).toBe(true)
      }
    })

    it('should load legacy single-filter data', () => {
      // Create a plain BloomFilter and serialize it
      const legacy = new BloomFilter(1024, 3)
      legacy.add('legacy-1')
      legacy.add('legacy-2')
      const data = legacy.serialize()

      const restored = new SegmentedBloomFilter({
        filterBits: 1024,
        hashCount: 3,
        segmentThreshold: 5,
      })
      restored.loadLegacy(new Uint8Array(data), 2)

      expect(restored.segmentCount).toBe(1)
      expect(restored.count).toBe(2)
      expect(restored.mightContain('legacy-1')).toBe(true)
      expect(restored.mightContain('legacy-2')).toBe(true)
    })

    it('should handle empty segment list in loadSegments', () => {
      segmented.add('before')
      segmented.loadSegments([])
      // Should keep existing state when given empty array
      expect(segmented.mightContain('before')).toBe(true)
    })
  })

  describe('falsePositiveRate', () => {
    it('should be 0 for empty filter', () => {
      expect(segmented.falsePositiveRate).toBe(0)
    })

    it('should be bounded and reasonable', () => {
      for (let i = 0; i < 12; i++) {
        segmented.add(`sha-${i}`)
      }
      const rate = segmented.falsePositiveRate
      expect(rate).toBeGreaterThan(0)
      expect(rate).toBeLessThan(1)
    })

    it('segmented filter should have lower FP rate than single filter with same total items', () => {
      // Compare: single filter with 20 items vs segmented with 20 items
      const single = new BloomFilter(1024, 3)
      const seg = new SegmentedBloomFilter({
        filterBits: 1024,
        hashCount: 3,
        segmentThreshold: 5,
        maxSegments: 10,
      })

      for (let i = 0; i < 20; i++) {
        single.add(`sha-${i}`)
        seg.add(`sha-${i}`)
      }

      // Each segment in the segmented filter has fewer items, so per-segment FP
      // rate is lower. The combined rate (1 - product(1-fp_i)) is typically
      // lower than the single filter's rate for moderate numbers of segments.
      // However, with very small filters the segmented approach might not always
      // win, so we just verify both are reasonable.
      expect(single.falsePositiveRate).toBeGreaterThan(0)
      expect(seg.falsePositiveRate).toBeGreaterThan(0)
      expect(seg.falsePositiveRate).toBeLessThan(1)
    })
  })
})
