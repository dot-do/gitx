import { describe, it, expect, beforeEach } from 'vitest'
import { RefLog, type RefLogBucket } from '../../src/delta/ref-log'
import { DeltaBranch, createBranch, createBranchAtVersion } from '../../src/delta/branch'
import { DeltaVersionError } from '../../src/delta/errors'

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

describe('DeltaBranch', () => {
  let bucket: RefLogBucket
  let parentLog: RefLog

  beforeEach(() => {
    bucket = createMockBucket()
    parentLog = new RefLog(bucket, 'repo')
  })

  describe('createBranch', () => {
    it('should fork at the current parent version', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)
      parentLog.append('refs/heads/main', 'aaa', 'bbb', 2000)

      const branch = createBranch('feature', parentLog, bucket, 'repo')
      expect(branch.info.name).toBe('feature')
      expect(branch.info.baseVersion).toBe(2)
    })

    it('should fork empty log at version 0', () => {
      const branch = createBranch('feature', parentLog, bucket, 'repo')
      expect(branch.info.baseVersion).toBe(0)
    })
  })

  describe('createBranchAtVersion', () => {
    it('should fork at the specified version', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)
      parentLog.append('refs/heads/main', 'aaa', 'bbb', 2000)
      parentLog.append('refs/heads/main', 'bbb', 'ccc', 3000)

      const branch = createBranchAtVersion('feature', parentLog, 2, bucket, 'repo')
      expect(branch.info.baseVersion).toBe(2)
    })

    it('should throw DeltaVersionError if version is negative', () => {
      expect(() => createBranchAtVersion('test', parentLog, -1, bucket, 'repo')).toThrow(DeltaVersionError)
    })

    it('should throw DeltaVersionError if version exceeds parent', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)

      expect(() => createBranchAtVersion('feature', parentLog, 5, bucket, 'repo'))
        .toThrow(DeltaVersionError)
    })
  })

  describe('branch state', () => {
    it('should inherit parent state at fork point', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)
      parentLog.append('refs/tags/v1', '', 'bbb', 2000)

      const branch = createBranch('feature', parentLog, bucket, 'repo')
      const state = branch.replayState()

      expect(state.get('refs/heads/main')?.sha).toBe('aaa')
      expect(state.get('refs/tags/v1')?.sha).toBe('bbb')
    })

    it('should NOT include parent entries after fork point', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)
      const branch = createBranch('feature', parentLog, bucket, 'repo')

      // Parent advances after fork
      parentLog.append('refs/heads/main', 'aaa', 'bbb', 2000)

      // Branch should still see 'aaa'
      expect(branch.resolve('refs/heads/main')).toBe('aaa')
    })

    it('should apply branch-specific changes on top', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)
      const branch = createBranch('feature', parentLog, bucket, 'repo')

      branch.append('refs/heads/main', 'aaa', 'xxx', 3000)

      expect(branch.resolve('refs/heads/main')).toBe('xxx')
    })

    it('should support branch-only refs', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)
      const branch = createBranch('feature', parentLog, bucket, 'repo')

      branch.append('refs/heads/feature', '', 'fff', 3000)

      expect(branch.resolve('refs/heads/feature')).toBe('fff')
      // Parent still doesn't have it
      expect(parentLog.resolve('refs/heads/feature')).toBeUndefined()
    })

    it('should support deletion in branch', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)
      parentLog.append('refs/tags/v1', '', 'bbb', 2000)
      const branch = createBranch('feature', parentLog, bucket, 'repo')

      branch.append('refs/tags/v1', 'bbb', '', 3000)

      expect(branch.resolve('refs/tags/v1')).toBeUndefined()
      // Parent still has it
      expect(parentLog.resolve('refs/tags/v1')).toBe('bbb')
    })
  })

  describe('getBranchEntries', () => {
    it('should return only branch-specific entries', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)
      const branch = createBranch('feature', parentLog, bucket, 'repo')

      branch.append('refs/heads/feature', '', 'bbb', 2000)
      branch.append('refs/heads/feature', 'bbb', 'ccc', 3000)

      expect(branch.getBranchEntries()).toHaveLength(2)
    })
  })

  describe('flush', () => {
    it('should write branch log to R2', async () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)
      const branch = createBranch('feature', parentLog, bucket, 'repo')
      branch.append('refs/heads/feature', '', 'bbb', 2000)

      const key = await branch.flush()
      expect(key).toContain('branches/feature')

      const obj = await bucket.get(key!)
      expect(obj).not.toBeNull()
    })
  })
})
