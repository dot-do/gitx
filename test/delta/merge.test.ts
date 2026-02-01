import { describe, it, expect, beforeEach } from 'vitest'
import { RefLog, type RefLogBucket } from '../../src/delta/ref-log'
import { createBranch } from '../../src/delta/branch'
import {
  threeWayMerge,
  findCommonAncestor,
  computeChanges,
  canFastForward,
} from '../../src/delta/merge'

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

describe('Delta Merge', () => {
  let bucket: RefLogBucket
  let parentLog: RefLog

  beforeEach(() => {
    bucket = createMockBucket()
    parentLog = new RefLog(bucket, 'repo')
  })

  describe('computeChanges', () => {
    it('should return empty map for no entries', () => {
      expect(computeChanges([]).size).toBe(0)
    })

    it('should compute final state per ref', () => {
      const changes = computeChanges([
        { version: 1, ref_name: 'refs/heads/main', old_sha: '', new_sha: 'aaa', timestamp: 1000 },
        { version: 2, ref_name: 'refs/heads/main', old_sha: 'aaa', new_sha: 'bbb', timestamp: 2000 },
      ])
      expect(changes.get('refs/heads/main')).toBe('bbb')
    })
  })

  describe('findCommonAncestor', () => {
    it('should return min of both base versions', () => {
      parentLog.append('refs/heads/main', '', 'a', 1000)
      parentLog.append('refs/heads/main', 'a', 'b', 2000)
      parentLog.append('refs/heads/main', 'b', 'c', 3000)

      const ours = createBranch('ours', parentLog, bucket, 'repo') // version 3
      // Simulate theirs forked earlier by using createBranchAtVersion
      // but both have same parent, so common ancestor = min(3, 3) = 3
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')

      expect(findCommonAncestor(ours, theirs)).toBe(3)
    })
  })

  describe('canFastForward', () => {
    it('should detect fast-forward when ours has no changes', () => {
      parentLog.append('refs/heads/main', '', 'a', 1000)

      const ours = createBranch('ours', parentLog, bucket, 'repo')
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')
      theirs.append('refs/heads/main', 'a', 'b', 2000)

      expect(canFastForward(ours, theirs)).toBe('theirs')
    })

    it('should detect fast-forward when theirs has no changes', () => {
      parentLog.append('refs/heads/main', '', 'a', 1000)

      const ours = createBranch('ours', parentLog, bucket, 'repo')
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')
      ours.append('refs/heads/main', 'a', 'b', 2000)

      expect(canFastForward(ours, theirs)).toBe('ours')
    })

    it('should return false when both have changes', () => {
      parentLog.append('refs/heads/main', '', 'a', 1000)

      const ours = createBranch('ours', parentLog, bucket, 'repo')
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')
      ours.append('refs/heads/main', 'a', 'b', 2000)
      theirs.append('refs/heads/main', 'a', 'c', 3000)

      expect(canFastForward(ours, theirs)).toBe(false)
    })
  })

  describe('threeWayMerge', () => {
    it('should merge cleanly when branches touch different refs', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)

      const ours = createBranch('ours', parentLog, bucket, 'repo')
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')

      ours.append('refs/heads/feature-a', '', 'bbb', 2000)
      theirs.append('refs/heads/feature-b', '', 'ccc', 3000)

      const result = threeWayMerge(parentLog, ours, theirs)

      expect(result.success).toBe(true)
      expect(result.conflicts).toHaveLength(0)
      expect(result.merged.get('refs/heads/main')?.sha).toBe('aaa')
      expect(result.merged.get('refs/heads/feature-a')?.sha).toBe('bbb')
      expect(result.merged.get('refs/heads/feature-b')?.sha).toBe('ccc')
    })

    it('should merge cleanly when both branches make same change', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)

      const ours = createBranch('ours', parentLog, bucket, 'repo')
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')

      ours.append('refs/heads/main', 'aaa', 'bbb', 2000)
      theirs.append('refs/heads/main', 'aaa', 'bbb', 3000)

      const result = threeWayMerge(parentLog, ours, theirs)

      expect(result.success).toBe(true)
      expect(result.merged.get('refs/heads/main')?.sha).toBe('bbb')
    })

    it('should detect conflict when both branches change same ref differently', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)

      const ours = createBranch('ours', parentLog, bucket, 'repo')
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')

      ours.append('refs/heads/main', 'aaa', 'bbb', 2000)
      theirs.append('refs/heads/main', 'aaa', 'ccc', 3000)

      const result = threeWayMerge(parentLog, ours, theirs)

      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.ref_name).toBe('refs/heads/main')
      expect(result.conflicts[0]!.base_sha).toBe('aaa')
      expect(result.conflicts[0]!.ours_sha).toBe('bbb')
      expect(result.conflicts[0]!.theirs_sha).toBe('ccc')
    })

    it('should detect conflict: update vs delete', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)

      const ours = createBranch('ours', parentLog, bucket, 'repo')
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')

      ours.append('refs/heads/main', 'aaa', 'bbb', 2000)
      theirs.append('refs/heads/main', 'aaa', '', 3000) // delete

      const result = threeWayMerge(parentLog, ours, theirs)

      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.ours_sha).toBe('bbb')
      expect(result.conflicts[0]!.theirs_sha).toBeUndefined()
    })

    it('should handle one-sided deletion cleanly', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)
      parentLog.append('refs/tags/v1', '', 'bbb', 2000)

      const ours = createBranch('ours', parentLog, bucket, 'repo')
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')

      ours.append('refs/tags/v1', 'bbb', '', 3000) // delete tag
      // theirs doesn't touch v1

      const result = threeWayMerge(parentLog, ours, theirs)

      expect(result.success).toBe(true)
      expect(result.merged.has('refs/tags/v1')).toBe(false)
      expect(result.merged.get('refs/heads/main')?.sha).toBe('aaa')
    })

    it('should handle empty branches', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)

      const ours = createBranch('ours', parentLog, bucket, 'repo')
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')

      const result = threeWayMerge(parentLog, ours, theirs)

      expect(result.success).toBe(true)
      expect(result.conflicts).toHaveLength(0)
      expect(result.merged.get('refs/heads/main')?.sha).toBe('aaa')
    })

    it('should report baseVersion', () => {
      parentLog.append('refs/heads/main', '', 'aaa', 1000)

      const ours = createBranch('ours', parentLog, bucket, 'repo')
      const theirs = createBranch('theirs', parentLog, bucket, 'repo')

      const result = threeWayMerge(parentLog, ours, theirs)
      expect(result.baseVersion).toBe(1)
    })
  })
})
