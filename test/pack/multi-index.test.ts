import { describe, it, expect, beforeEach } from 'vitest'
import {
  MultiIndexManager,
  createMultiIndexManager,
  addPackIndexFromData,
  batchLookupAcrossManagers,
  type PackObjectLocation,
  type MultiIndexEntry,
  type MultiIndexConfig,
} from '../../src/pack/multi-index'
import type { PackIndexEntry } from '../../src/pack/index'

// Test SHA generation
function generateSha(prefix: string, index: number): string {
  const suffix = index.toString(16).padStart(32, '0')
  return (prefix + suffix).slice(0, 40)
}

// Generate test entries
function generateTestEntries(
  packId: string,
  count: number,
  shaPrefix: string = ''
): PackIndexEntry[] {
  const entries: PackIndexEntry[] = []
  for (let i = 0; i < count; i++) {
    const sha = shaPrefix
      ? generateSha(shaPrefix, i)
      : generateSha(i.toString(16).padStart(8, '0'), i)
    entries.push({
      objectId: sha,
      offset: i * 100,
      crc32: 0x12345678 + i
    })
  }
  return entries
}

describe('MultiIndexManager', () => {
  let manager: MultiIndexManager

  beforeEach(() => {
    manager = new MultiIndexManager({ shardCount: 16 })
  })

  describe('initialization', () => {
    it('should create manager with default config', () => {
      const m = new MultiIndexManager()
      expect(m).toBeDefined()
      const stats = m.getStats()
      expect(stats.shardCount).toBe(16)
      expect(stats.totalObjects).toBe(0)
    })

    it('should create manager with custom shard count', () => {
      const m = new MultiIndexManager({ shardCount: 256 })
      const stats = m.getStats()
      expect(stats.shardCount).toBe(256)
    })

    it('should create manager with single shard', () => {
      const m = new MultiIndexManager({ shardCount: 1 })
      const stats = m.getStats()
      expect(stats.shardCount).toBe(1)
    })
  })

  describe('addPackIndex', () => {
    it('should add entries from a pack', () => {
      const entries = generateTestEntries('pack-001', 10)
      manager.addPackIndex('pack-001', entries)

      const stats = manager.getStats()
      expect(stats.totalObjects).toBe(10)
      expect(stats.packCount).toBe(1)
    })

    it('should add entries from multiple packs', () => {
      const entries1 = generateTestEntries('pack-001', 10, 'a')
      const entries2 = generateTestEntries('pack-002', 15, 'b')

      manager.addPackIndex('pack-001', entries1)
      manager.addPackIndex('pack-002', entries2)

      const stats = manager.getStats()
      expect(stats.totalObjects).toBe(25)
      expect(stats.packCount).toBe(2)
    })

    it('should update pack index if re-added', () => {
      const entries1 = generateTestEntries('pack-001', 10)
      const entries2 = generateTestEntries('pack-001', 5)

      manager.addPackIndex('pack-001', entries1)
      manager.addPackIndex('pack-001', entries2)

      const stats = manager.getStats()
      expect(stats.totalObjects).toBe(5)
      expect(stats.packCount).toBe(1)
    })

    it('should distribute entries across shards', () => {
      // Add entries with different SHA prefixes to hit multiple shards
      const allEntries: PackIndexEntry[] = []
      for (let i = 0; i < 16; i++) {
        const prefix = i.toString(16)
        for (let j = 0; j < 5; j++) {
          allEntries.push({
            objectId: generateSha(prefix, j),
            offset: (i * 5 + j) * 100,
            crc32: 0
          })
        }
      }

      manager.addPackIndex('pack-001', allEntries)

      const stats = manager.getStats()
      expect(stats.totalObjects).toBe(80)
      expect(stats.loadedShards).toBeGreaterThan(1)
    })
  })

  describe('lookupObject', () => {
    beforeEach(() => {
      const entries = generateTestEntries('pack-001', 100, 'a1b2')
      manager.addPackIndex('pack-001', entries)
    })

    it('should find an existing object', () => {
      const sha = generateSha('a1b2', 50)
      const result = manager.lookupObject(sha)

      expect(result).not.toBeNull()
      expect(result?.packId).toBe('pack-001')
      expect(result?.offset).toBe(50 * 100)
    })

    it('should return null for non-existent object', () => {
      const result = manager.lookupObject('ffffffffffffffffffffffffffffffffffffffff')
      expect(result).toBeNull()
    })

    it('should find object regardless of case', () => {
      const sha = generateSha('a1b2', 25)
      const result = manager.lookupObject(sha.toUpperCase())

      expect(result).not.toBeNull()
      expect(result?.packId).toBe('pack-001')
    })

    it('should find objects across multiple packs', () => {
      // Add another pack
      const entries2 = generateTestEntries('pack-002', 50, 'cdEf')
      manager.addPackIndex('pack-002', entries2)

      // Find from first pack
      const result1 = manager.lookupObject(generateSha('a1b2', 10))
      expect(result1?.packId).toBe('pack-001')

      // Find from second pack
      const result2 = manager.lookupObject(generateSha('cdef', 10))
      expect(result2?.packId).toBe('pack-002')
    })
  })

  describe('batchLookup', () => {
    beforeEach(() => {
      const entries1 = generateTestEntries('pack-001', 50, 'aa')
      const entries2 = generateTestEntries('pack-002', 50, 'bb')
      manager.addPackIndex('pack-001', entries1)
      manager.addPackIndex('pack-002', entries2)
    })

    it('should find multiple objects in batch', () => {
      const shas = [
        generateSha('aa', 10),
        generateSha('aa', 20),
        generateSha('bb', 30)
      ]

      const result = manager.batchLookup(shas)

      expect(result.found.size).toBe(3)
      expect(result.missing.length).toBe(0)
    })

    it('should separate found and missing objects', () => {
      const shas = [
        generateSha('aa', 10),
        'ffffffffffffffffffffffffffffffffffffffff',
        generateSha('bb', 10)
      ]

      const result = manager.batchLookup(shas)

      expect(result.found.size).toBe(2)
      expect(result.missing.length).toBe(1)
      expect(result.missing[0]).toBe('ffffffffffffffffffffffffffffffffffffffff')
    })

    it('should handle empty input', () => {
      const result = manager.batchLookup([])

      expect(result.found.size).toBe(0)
      expect(result.missing.length).toBe(0)
    })
  })

  describe('hasObject', () => {
    beforeEach(() => {
      const entries = generateTestEntries('pack-001', 10, 'abcd')
      manager.addPackIndex('pack-001', entries)
    })

    it('should return true for existing object', () => {
      const sha = generateSha('abcd', 5)
      expect(manager.hasObject(sha)).toBe(true)
    })

    it('should return false for non-existent object', () => {
      expect(manager.hasObject('ffffffffffffffffffffffffffffffffffffffff')).toBe(false)
    })
  })

  describe('removePackIndex', () => {
    it('should remove pack entries', () => {
      const entries1 = generateTestEntries('pack-001', 10, 'aa')
      const entries2 = generateTestEntries('pack-002', 10, 'bb')
      manager.addPackIndex('pack-001', entries1)
      manager.addPackIndex('pack-002', entries2)

      const removed = manager.removePackIndex('pack-001')

      expect(removed).toBe(true)
      const stats = manager.getStats()
      expect(stats.totalObjects).toBe(10)
      expect(stats.packCount).toBe(1)
    })

    it('should return false for non-existent pack', () => {
      const removed = manager.removePackIndex('non-existent')
      expect(removed).toBe(false)
    })

    it('should make objects from removed pack not findable', () => {
      const entries = generateTestEntries('pack-001', 10, 'aa')
      manager.addPackIndex('pack-001', entries)

      const sha = generateSha('aa', 5)
      expect(manager.hasObject(sha)).toBe(true)

      manager.removePackIndex('pack-001')
      expect(manager.hasObject(sha)).toBe(false)
    })
  })

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      const entries = generateTestEntries('pack-001', 100)
      manager.addPackIndex('pack-001', entries)

      const stats = manager.getStats()

      expect(stats.totalObjects).toBe(100)
      expect(stats.packCount).toBe(1)
      expect(stats.shardCount).toBe(16)
      expect(stats.memoryUsageBytes).toBeGreaterThan(0)
      expect(stats.avgObjectsPerShard).toBeCloseTo(100 / 16, 1)
    })
  })

  describe('getRegistry', () => {
    it('should return pack registry', () => {
      const entries = generateTestEntries('pack-001', 10)
      manager.addPackIndex('pack-001', entries)

      const registry = manager.getRegistry()

      expect(registry.packs.size).toBe(1)
      expect(registry.packs.get('pack-001')?.objectCount).toBe(10)
      expect(registry.totalObjects).toBe(10)
    })
  })

  describe('needsCompaction', () => {
    it('should return false when under threshold', () => {
      const entries = generateTestEntries('pack-001', 10)
      manager.addPackIndex('pack-001', entries)

      expect(manager.needsCompaction()).toBe(false)
    })

    it('should return true when over threshold', () => {
      const m = new MultiIndexManager({ maxPacksBeforeCompaction: 3 })

      for (let i = 0; i < 3; i++) {
        m.addPackIndex(`pack-${i}`, generateTestEntries(`pack-${i}`, 5))
      }

      expect(m.needsCompaction()).toBe(true)
    })
  })

  describe('getEntriesForPack', () => {
    it('should return entries for a specific pack', () => {
      const entries1 = generateTestEntries('pack-001', 10, 'aa')
      const entries2 = generateTestEntries('pack-002', 10, 'bb')
      manager.addPackIndex('pack-001', entries1)
      manager.addPackIndex('pack-002', entries2)

      const packEntries = manager.getEntriesForPack('pack-001')

      expect(packEntries.length).toBe(10)
      for (const entry of packEntries) {
        expect(entry.packId).toBe('pack-001')
      }
    })

    it('should return empty array for non-existent pack', () => {
      const entries = manager.getEntriesForPack('non-existent')
      expect(entries.length).toBe(0)
    })
  })

  describe('clear', () => {
    it('should remove all indexed data', () => {
      const entries = generateTestEntries('pack-001', 100)
      manager.addPackIndex('pack-001', entries)

      manager.clear()

      const stats = manager.getStats()
      expect(stats.totalObjects).toBe(0)
      expect(stats.packCount).toBe(0)
    })
  })

  describe('serialization', () => {
    it('should serialize and deserialize correctly', () => {
      const entries1 = generateTestEntries('pack-001', 20, 'aa')
      const entries2 = generateTestEntries('pack-002', 30, 'bb')
      manager.addPackIndex('pack-001', entries1)
      manager.addPackIndex('pack-002', entries2)

      const serialized = manager.serialize()
      expect(serialized).toBeInstanceOf(Uint8Array)
      expect(serialized.length).toBeGreaterThan(0)

      // Verify signature
      expect(serialized[0]).toBe(0x4d) // M
      expect(serialized[1]).toBe(0x49) // I
      expect(serialized[2]).toBe(0x44) // D
      expect(serialized[3]).toBe(0x58) // X

      const restored = MultiIndexManager.deserialize(serialized)
      const stats = restored.getStats()

      expect(stats.totalObjects).toBe(50)
      expect(stats.packCount).toBe(2)
    })

    it('should preserve lookup capability after deserialization', () => {
      const entries = generateTestEntries('pack-001', 10, 'abcd')
      manager.addPackIndex('pack-001', entries)

      const sha = generateSha('abcd', 5)
      const originalResult = manager.lookupObject(sha)

      const serialized = manager.serialize()
      const restored = MultiIndexManager.deserialize(serialized)
      const restoredResult = restored.lookupObject(sha)

      expect(restoredResult).not.toBeNull()
      expect(restoredResult?.packId).toBe(originalResult?.packId)
      expect(restoredResult?.offset).toBe(originalResult?.offset)
    })
  })
})

describe('createMultiIndexManager', () => {
  it('should create manager with defaults', () => {
    const manager = createMultiIndexManager()
    expect(manager).toBeInstanceOf(MultiIndexManager)
  })

  it('should create manager with config', () => {
    const manager = createMultiIndexManager({
      shardCount: 256,
      maxPacksBeforeCompaction: 50
    })
    expect(manager.getStats().shardCount).toBe(256)
  })
})

describe('batchLookupAcrossManagers', () => {
  it('should lookup across multiple managers', () => {
    const manager1 = new MultiIndexManager()
    const manager2 = new MultiIndexManager()

    const entries1 = generateTestEntries('pack-001', 10, 'aa')
    const entries2 = generateTestEntries('pack-002', 10, 'bb')

    manager1.addPackIndex('pack-001', entries1)
    manager2.addPackIndex('pack-002', entries2)

    const shas = [
      generateSha('aa', 5),
      generateSha('bb', 5),
      'ffffffffffffffffffffffffffffffffffffffff'
    ]

    const result = batchLookupAcrossManagers([manager1, manager2], shas)

    expect(result.found.size).toBe(2)
    expect(result.missing.length).toBe(1)
  })

  it('should stop searching once all objects found', () => {
    const manager1 = new MultiIndexManager()
    const manager2 = new MultiIndexManager()

    const entries1 = generateTestEntries('pack-001', 10, 'aa')
    const entries2 = generateTestEntries('pack-001', 10, 'aa') // Same entries

    manager1.addPackIndex('pack-001', entries1)
    manager2.addPackIndex('pack-002', entries2)

    const shas = [generateSha('aa', 5)]
    const result = batchLookupAcrossManagers([manager1, manager2], shas)

    // Should find from first manager
    expect(result.found.size).toBe(1)
    expect(result.found.get(shas[0])?.packId).toBe('pack-001')
  })
})

describe('256-shard configuration', () => {
  it('should work with 256 shards', () => {
    const manager = new MultiIndexManager({ shardCount: 256 })

    // Add entries with various prefixes
    const entries: PackIndexEntry[] = []
    for (let i = 0; i < 256; i++) {
      const prefix = i.toString(16).padStart(2, '0')
      entries.push({
        objectId: generateSha(prefix, i),
        offset: i * 100,
        crc32: 0
      })
    }

    manager.addPackIndex('pack-001', entries)

    const stats = manager.getStats()
    expect(stats.totalObjects).toBe(256)
    expect(stats.shardCount).toBe(256)

    // Verify lookup works
    const sha = generateSha('ff', 255)
    const result = manager.lookupObject(sha)
    expect(result).not.toBeNull()
  })
})

describe('fanout table optimization', () => {
  it('should use fanout for faster lookups', () => {
    const manager = new MultiIndexManager({ useFanoutTables: true })

    // Add many entries to same shard
    const entries: PackIndexEntry[] = []
    for (let i = 0; i < 1000; i++) {
      entries.push({
        objectId: 'a' + i.toString(16).padStart(39, '0'),
        offset: i * 100,
        crc32: 0
      })
    }

    manager.addPackIndex('pack-001', entries)

    // Lookups should still work correctly - use an actual objectId from entries
    const sha = 'a' + (500).toString(16).padStart(39, '0')
    const result = manager.lookupObject(sha)
    expect(result).not.toBeNull()
  })

  it('should work without fanout tables', () => {
    const manager = new MultiIndexManager({ useFanoutTables: false })

    const entries: PackIndexEntry[] = []
    for (let i = 0; i < 100; i++) {
      entries.push({
        objectId: generateSha('ab', i),
        offset: i * 100,
        crc32: 0
      })
    }

    manager.addPackIndex('pack-001', entries)

    const sha = generateSha('ab', 50)
    const result = manager.lookupObject(sha)
    expect(result).not.toBeNull()
  })
})

describe('edge cases', () => {
  it('should handle empty pack', () => {
    const manager = new MultiIndexManager()
    manager.addPackIndex('pack-001', [])

    const stats = manager.getStats()
    expect(stats.totalObjects).toBe(0)
    expect(stats.packCount).toBe(1)
  })

  it('should handle entries without objectId', () => {
    const manager = new MultiIndexManager()
    const entries: PackIndexEntry[] = [
      { offset: 100, crc32: 0 } as PackIndexEntry, // No objectId
      { objectId: 'a'.repeat(40), offset: 200, crc32: 0 }
    ]

    manager.addPackIndex('pack-001', entries)

    // Registry counts what we added (2 entries), but only valid ones are indexed
    // The entry without objectId is skipped during lookup, but registry doesn't validate
    const sha = 'a'.repeat(40)
    const result = manager.lookupObject(sha)
    expect(result).not.toBeNull()
    expect(result?.offset).toBe(200)
  })

  it('should handle duplicate objects in same pack', () => {
    const manager = new MultiIndexManager()
    const sha = 'a'.repeat(40)
    const entries: PackIndexEntry[] = [
      { objectId: sha, offset: 100, crc32: 0 },
      { objectId: sha, offset: 200, crc32: 0 }
    ]

    manager.addPackIndex('pack-001', entries)

    // Should keep one (last one in merge)
    const result = manager.lookupObject(sha)
    expect(result).not.toBeNull()
  })
})
