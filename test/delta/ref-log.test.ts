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
  })
})
