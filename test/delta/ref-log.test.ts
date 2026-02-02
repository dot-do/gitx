import { describe, it, expect, beforeEach } from 'vitest'
import { RefLog, type RefLogEntry, type RefLogBucket } from '../../src/delta/ref-log'

// ============================================================================
// Mock R2 Bucket
// ============================================================================

function createMockBucket(): RefLogBucket {
  const store = new Map<string, ArrayBuffer>()
  return {
    async put(key: string, value: ArrayBuffer | Uint8Array) {
      store.set(key, value instanceof Uint8Array ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value)
    },
    async get(key: string) {
      const data = store.get(key)
      if (!data) return null
      return { arrayBuffer: async () => data }
    },
    async list(options: { prefix: string }) {
      const keys = [...store.keys()].filter(k => k.startsWith(options.prefix))
      return { objects: keys.map(key => ({ key })) }
    },
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('RefLog', () => {
  let bucket: RefLogBucket
  let log: RefLog

  beforeEach(() => {
    bucket = createMockBucket()
    log = new RefLog(bucket, 'test-repo')
  })

  describe('append', () => {
    it('should create entries with monotonically increasing versions', () => {
      const e1 = log.append('refs/heads/main', '', 'aaa', 1000)
      const e2 = log.append('refs/heads/main', 'aaa', 'bbb', 2000)
      const e3 = log.append('refs/heads/feature', '', 'ccc', 3000)

      expect(e1.version).toBe(1)
      expect(e2.version).toBe(2)
      expect(e3.version).toBe(3)
    })

    it('should store all fields correctly', () => {
      const entry = log.append('refs/heads/main', 'old123', 'new456', 9999)

      expect(entry.ref_name).toBe('refs/heads/main')
      expect(entry.old_sha).toBe('old123')
      expect(entry.new_sha).toBe('new456')
      expect(entry.timestamp).toBe(9999)
    })

    it('should auto-assign timestamp when not provided', () => {
      const before = Date.now()
      const entry = log.append('refs/heads/main', '', 'abc')
      const after = Date.now()

      expect(entry.timestamp).toBeGreaterThanOrEqual(before)
      expect(entry.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('version', () => {
    it('should start at 0', () => {
      expect(log.version).toBe(0)
    })

    it('should increment with each append', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      expect(log.version).toBe(1)

      log.append('refs/heads/main', 'aaa', 'bbb', 2000)
      expect(log.version).toBe(2)
    })
  })

  describe('replayState', () => {
    it('should return empty map for empty log', () => {
      const state = log.replayState()
      expect(state.size).toBe(0)
    })

    it('should track ref creation', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      const state = log.replayState()

      expect(state.size).toBe(1)
      expect(state.get('refs/heads/main')?.sha).toBe('aaa')
    })

    it('should track ref update', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/main', 'aaa', 'bbb', 2000)
      const state = log.replayState()

      expect(state.get('refs/heads/main')?.sha).toBe('bbb')
    })

    it('should track ref deletion', () => {
      log.append('refs/heads/feature', '', 'aaa', 1000)
      log.append('refs/heads/feature', 'aaa', '', 2000)
      const state = log.replayState()

      expect(state.has('refs/heads/feature')).toBe(false)
    })

    it('should handle multiple refs independently', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/feature', '', 'bbb', 2000)
      log.append('refs/heads/main', 'aaa', 'ccc', 3000)

      const state = log.replayState()
      expect(state.get('refs/heads/main')?.sha).toBe('ccc')
      expect(state.get('refs/heads/feature')?.sha).toBe('bbb')
    })
  })

  describe('resolve', () => {
    it('should return undefined for unknown ref', () => {
      expect(log.resolve('refs/heads/nope')).toBeUndefined()
    })

    it('should return current SHA for known ref', () => {
      log.append('refs/heads/main', '', 'abc', 1000)
      expect(log.resolve('refs/heads/main')).toBe('abc')
    })
  })

  describe('getEntries / getEntriesFrom', () => {
    it('should return all entries', () => {
      log.append('refs/heads/main', '', 'a', 1000)
      log.append('refs/heads/main', 'a', 'b', 2000)

      expect(log.getEntries()).toHaveLength(2)
    })

    it('should filter entries from a version', () => {
      log.append('refs/heads/main', '', 'a', 1000)
      log.append('refs/heads/main', 'a', 'b', 2000)
      log.append('refs/heads/main', 'b', 'c', 3000)

      const from2 = log.getEntriesFrom(2)
      expect(from2).toHaveLength(2)
      expect(from2[0]!.version).toBe(2)
    })
  })

  describe('snapshot', () => {
    it('should return entries up to given version', () => {
      log.append('refs/heads/main', '', 'a', 1000)
      log.append('refs/heads/main', 'a', 'b', 2000)
      log.append('refs/heads/main', 'b', 'c', 3000)

      const snap = log.snapshot(2)
      expect(snap).toHaveLength(2)
      expect(snap[1]!.new_sha).toBe('b')
    })
  })

  describe('loadEntries', () => {
    it('should restore state from entries', () => {
      const entries: RefLogEntry[] = [
        { version: 1, ref_name: 'refs/heads/main', old_sha: '', new_sha: 'aaa', timestamp: 1000 },
        { version: 2, ref_name: 'refs/heads/main', old_sha: 'aaa', new_sha: 'bbb', timestamp: 2000 },
      ]

      log.loadEntries(entries)
      expect(log.version).toBe(2)
      expect(log.resolve('refs/heads/main')).toBe('bbb')
    })

    it('should continue versioning after loaded entries', () => {
      const entries: RefLogEntry[] = [
        { version: 5, ref_name: 'refs/heads/main', old_sha: '', new_sha: 'aaa', timestamp: 1000 },
      ]

      log.loadEntries(entries)
      const next = log.append('refs/heads/main', 'aaa', 'bbb', 2000)
      expect(next.version).toBe(6)
    })
  })

  describe('snapshot checkpointing', () => {
    it('replayState with snapshot skips earlier entries', () => {
      // Append some entries
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/feature', '', 'bbb', 2000)
      log.append('refs/heads/main', 'aaa', 'ccc', 3000)

      // Checkpoint at version 3
      log.checkpoint()

      // Append more entries after checkpoint
      log.append('refs/heads/main', 'ccc', 'ddd', 4000)

      const state = log.replayState()
      expect(state.get('refs/heads/main')?.sha).toBe('ddd')
      expect(state.get('refs/heads/feature')?.sha).toBe('bbb')

      // Verify snapshot exists at version 3
      const snap = log.getSnapshot()
      expect(snap).toBeDefined()
      expect(snap!.version).toBe(3)
      expect(snap!.state.get('refs/heads/main')?.sha).toBe('ccc')
    })

    it('auto-checkpoint triggers at interval', () => {
      const smallIntervalLog = new RefLog(bucket, 'test-repo', { snapshotInterval: 5 })

      // Append 5 entries to trigger auto-checkpoint
      for (let i = 1; i <= 5; i++) {
        smallIntervalLog.append('refs/heads/main', i === 1 ? '' : `sha${i - 1}`, `sha${i}`, i * 1000)
      }

      const snap = smallIntervalLog.getSnapshot()
      expect(snap).toBeDefined()
      expect(snap!.version).toBe(5)
      expect(snap!.state.get('refs/heads/main')?.sha).toBe('sha5')

      // Append more entries
      smallIntervalLog.append('refs/heads/main', 'sha5', 'sha6', 6000)
      const state = smallIntervalLog.replayState()
      expect(state.get('refs/heads/main')?.sha).toBe('sha6')
    })

    it('loadSnapshot restores state correctly', () => {
      // Pre-populate some entries
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/feature', '', 'bbb', 2000)
      log.append('refs/heads/main', 'aaa', 'ccc', 3000)

      // Load a snapshot as if restored from persistence
      const snapshotState = new Map([
        ['refs/heads/main', { ref_name: 'refs/heads/main', sha: 'ccc', version: 3 }],
        ['refs/heads/feature', { ref_name: 'refs/heads/feature', sha: 'bbb', version: 2 }],
      ])
      log.loadSnapshot(3, snapshotState)

      // Append after snapshot
      log.append('refs/heads/develop', '', 'ddd', 4000)

      const state = log.replayState()
      expect(state.get('refs/heads/main')?.sha).toBe('ccc')
      expect(state.get('refs/heads/feature')?.sha).toBe('bbb')
      expect(state.get('refs/heads/develop')?.sha).toBe('ddd')
    })

    it('replayState returns snapshot state when no entries follow', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.checkpoint()

      const state = log.replayState()
      expect(state.get('refs/heads/main')?.sha).toBe('aaa')
    })

    it('loadSnapshot does not mutate the provided state map', () => {
      const original = new Map([
        ['refs/heads/main', { ref_name: 'refs/heads/main', sha: 'aaa', version: 1 }],
      ])
      log.loadSnapshot(1, original)

      // Append an entry that modifies state during replay
      log.append('refs/heads/main', 'aaa', 'bbb', 2000)
      log.replayState()

      // Original map should be unchanged
      expect(original.get('refs/heads/main')?.sha).toBe('aaa')
    })
  })

  describe('flush', () => {
    it('should return null for empty log', async () => {
      const key = await log.flush()
      expect(key).toBeNull()
    })

    it('should write Parquet to R2 and return key', async () => {
      log.append('refs/heads/main', '', 'abc', 1000)
      log.append('refs/heads/feature', '', 'def', 2000)

      const key = await log.flush()
      expect(key).toBe('test-repo/ref-log/2.parquet')

      // Verify file exists in bucket
      const obj = await bucket.get(key!)
      expect(obj).not.toBeNull()

      // Verify it's a valid Parquet file (starts with PAR1 magic)
      const buf = await obj!.arrayBuffer()
      const bytes = new Uint8Array(buf)
      expect(bytes[0]).toBe(0x50) // P
      expect(bytes[1]).toBe(0x41) // A
      expect(bytes[2]).toBe(0x52) // R
      expect(bytes[3]).toBe(0x31) // 1
    })

    it('flush when R2 put fails should throw', async () => {
      const failingBucket: RefLogBucket = {
        async put() { throw new Error('R2 write failed') },
        async get() { return null },
        async list() { return { objects: [] } },
      }
      const failLog = new RefLog(failingBucket, 'test-repo')
      failLog.append('refs/heads/main', '', 'abc', 1000)

      await expect(failLog.flush()).rejects.toThrow('R2 write failed')
    })
  })

  describe('rollback', () => {
    it('should remove entries from the given version onwards', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/feature', '', 'bbb', 2000)
      log.append('refs/heads/main', 'aaa', 'ccc', 3000)
      log.append('refs/heads/develop', '', 'ddd', 4000)

      expect(log.getEntries()).toHaveLength(4)
      expect(log.version).toBe(4)

      // Rollback from version 3 onwards
      const removed = log.rollback(3)

      expect(removed).toBe(2) // versions 3 and 4 removed
      expect(log.getEntries()).toHaveLength(2)
      expect(log.version).toBe(2)

      // Verify remaining entries
      const entries = log.getEntries()
      expect(entries[0]!.version).toBe(1)
      expect(entries[1]!.version).toBe(2)
    })

    it('should reset nextVersion correctly after rollback', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/feature', '', 'bbb', 2000)

      log.rollback(2)

      // nextVersion should be reset so new entries continue from 2
      const newEntry = log.append('refs/heads/other', '', 'ccc', 3000)
      expect(newEntry.version).toBe(2)
    })

    it('should remove all entries when rollback from version 1', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/feature', '', 'bbb', 2000)

      const removed = log.rollback(1)

      expect(removed).toBe(2)
      expect(log.getEntries()).toHaveLength(0)
      expect(log.version).toBe(0)

      // New entries should start at version 1
      const newEntry = log.append('refs/heads/new', '', 'ccc', 3000)
      expect(newEntry.version).toBe(1)
    })

    it('should handle rollback of non-existent version gracefully', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/feature', '', 'bbb', 2000)

      // Rollback from version 10 (doesn't exist)
      const removed = log.rollback(10)

      expect(removed).toBe(0)
      expect(log.getEntries()).toHaveLength(2)
    })

    it('should invalidate snapshot when rollback reaches snapshot version', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/feature', '', 'bbb', 2000)
      log.append('refs/heads/main', 'aaa', 'ccc', 3000)

      // Create a checkpoint at version 3
      log.checkpoint()
      expect(log.getSnapshot()).toBeDefined()
      expect(log.getSnapshot()!.version).toBe(3)

      // Add more entries
      log.append('refs/heads/develop', '', 'ddd', 4000)

      // Rollback from version 3 - should invalidate snapshot
      log.rollback(3)

      expect(log.getSnapshot()).toBeUndefined()
    })

    it('should preserve snapshot when rollback does not reach snapshot version', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/feature', '', 'bbb', 2000)

      // Create a checkpoint at version 2
      log.checkpoint()
      expect(log.getSnapshot()).toBeDefined()

      // Add more entries
      log.append('refs/heads/develop', '', 'ccc', 3000)
      log.append('refs/heads/test', '', 'ddd', 4000)

      // Rollback from version 3 - should preserve snapshot at version 2
      log.rollback(3)

      expect(log.getSnapshot()).toBeDefined()
      expect(log.getSnapshot()!.version).toBe(2)
    })

    it('should correctly update state after rollback', () => {
      log.append('refs/heads/main', '', 'aaa', 1000)
      log.append('refs/heads/feature', '', 'bbb', 2000)
      log.append('refs/heads/main', 'aaa', 'ccc', 3000)

      // Rollback from version 3
      log.rollback(3)

      // State should reflect only the first two entries
      const state = log.replayState()
      expect(state.size).toBe(2)
      expect(state.get('refs/heads/main')!.sha).toBe('aaa')
      expect(state.get('refs/heads/feature')!.sha).toBe('bbb')
    })
  })
})
