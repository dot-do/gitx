import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PushTransaction,
  type ObjectStorageDelegate,
  type OrphanCleanupDelegate,
  type RefUpdateCommand,
} from '../../src/storage/push-transaction'
import type { DurableObjectStorage } from '../../src/do/schema'
import type { ObjectType } from '../../src/types/objects'

// ============================================================================
// Mock Helpers
// ============================================================================

/** In-memory ref store simulating SQLite refs table. */
class MockRefStore {
  refs = new Map<string, string>()

  set(name: string, target: string): void {
    this.refs.set(name, target)
  }

  get(name: string): string | undefined {
    return this.refs.get(name)
  }

  delete(name: string): void {
    this.refs.delete(name)
  }
}

/**
 * Create a mock DurableObjectStorage that simulates SQLite transactions
 * and refs table operations.
 */
function createMockStorage(refStore: MockRefStore): DurableObjectStorage {
  let inTransaction = false

  return {
    sql: {
      exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
        const q = query.trim().toUpperCase()

        if (q === 'BEGIN TRANSACTION') {
          if (inTransaction) throw new Error('Already in a transaction')
          inTransaction = true
          return { toArray: () => [] }
        }

        if (q === 'COMMIT') {
          if (!inTransaction) throw new Error('No active transaction')
          inTransaction = false
          return { toArray: () => [] }
        }

        if (q === 'ROLLBACK') {
          inTransaction = false
          return { toArray: () => [] }
        }

        if (q.startsWith('SELECT TARGET FROM REFS WHERE NAME')) {
          const name = params[0] as string
          const target = refStore.get(name)
          if (target) {
            return { toArray: () => [{ target }] }
          }
          return { toArray: () => [] }
        }

        if (q.startsWith('INSERT OR REPLACE INTO REFS')) {
          const name = params[0] as string
          const target = params[1] as string
          refStore.set(name, target)
          return { toArray: () => [] }
        }

        if (q.startsWith('DELETE FROM REFS WHERE NAME')) {
          const name = params[0] as string
          refStore.delete(name)
          return { toArray: () => [] }
        }

        return { toArray: () => [] }
      },
    },
  }
}

/** Create a mock object store that tracks put/has calls. */
function createMockObjectStore(options?: {
  failOnPut?: boolean
  existingShas?: Set<string>
}): ObjectStorageDelegate & { putCalls: Array<{ type: ObjectType; data: Uint8Array }> } {
  const storedShas = new Set<string>(options?.existingShas ?? [])
  const putCalls: Array<{ type: ObjectType; data: Uint8Array }> = []

  return {
    putCalls,
    async putObject(type: ObjectType, data: Uint8Array): Promise<string> {
      if (options?.failOnPut) {
        throw new Error('R2 write failed: simulated network error')
      }
      // Generate a deterministic fake SHA from the data
      const sha = Array.from(data.slice(0, 20))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .padEnd(40, '0')
      storedShas.add(sha)
      putCalls.push({ type, data })
      return sha
    },
    async hasObject(sha: string): Promise<boolean> {
      return storedShas.has(sha)
    },
  }
}

const ZERO_SHA = '0000000000000000000000000000000000000000'

// ============================================================================
// Tests
// ============================================================================

describe('PushTransaction', () => {
  let refStore: MockRefStore
  let storage: DurableObjectStorage

  beforeEach(() => {
    refStore = new MockRefStore()
    storage = createMockStorage(refStore)
  })

  describe('buffering phase', () => {
    it('should buffer objects without writing to storage', () => {
      const objectStore = createMockObjectStore()
      const tx = new PushTransaction(storage, objectStore)

      const data = new Uint8Array([1, 2, 3, 4])
      tx.bufferObject('abc123'.padEnd(40, '0'), 'blob', data)

      expect(tx.bufferedCount).toBe(1)
      expect(tx.bufferedBytes).toBe(4)
      expect(tx.phase).toBe('buffering')
      // Nothing written to storage yet
      expect(objectStore.putCalls.length).toBe(0)
    })

    it('should deduplicate buffered objects by SHA', () => {
      const objectStore = createMockObjectStore()
      const tx = new PushTransaction(storage, objectStore)

      const sha = 'abc123'.padEnd(40, '0')
      const data = new Uint8Array([1, 2, 3])
      tx.bufferObject(sha, 'blob', data)
      tx.bufferObject(sha, 'blob', data)

      expect(tx.bufferedCount).toBe(1)
    })

    it('should reject buffering after execution starts', async () => {
      const objectStore = createMockObjectStore()
      const tx = new PushTransaction(storage, objectStore)

      // Execute with no commands to advance past buffering phase
      await tx.execute([])

      expect(() => {
        tx.bufferObject('abc'.padEnd(40, '0'), 'blob', new Uint8Array([1]))
      }).toThrow(/Cannot buffer objects/)
    })
  })

  describe('successful push', () => {
    it('should flush objects and update refs on success', async () => {
      const sha = 'aabbccdd'.padEnd(40, '0')
      const objectStore = createMockObjectStore({ existingShas: new Set([sha]) })
      const tx = new PushTransaction(storage, objectStore)

      const data = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])
      tx.bufferObject(sha, 'commit', data)

      const result = await tx.execute([
        { refName: 'refs/heads/main', oldSha: ZERO_SHA, newSha: sha },
      ])

      expect(result.success).toBe(true)
      expect(result.refResults).toHaveLength(1)
      expect(result.refResults[0]!.success).toBe(true)
      expect(result.orphanedShas).toHaveLength(0)
      expect(tx.phase).toBe('completed')

      // Ref should be updated
      expect(refStore.get('refs/heads/main')).toBe(sha)
    })

    it('should handle multiple ref updates', async () => {
      const sha1 = 'aaaa'.padEnd(40, '0')
      const sha2 = 'bbbb'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha1, sha2]),
      })
      const tx = new PushTransaction(storage, objectStore)

      tx.bufferObject(sha1, 'commit', new Uint8Array([0xaa]))
      tx.bufferObject(sha2, 'commit', new Uint8Array([0xbb]))

      const result = await tx.execute([
        { refName: 'refs/heads/main', oldSha: ZERO_SHA, newSha: sha1 },
        { refName: 'refs/heads/feature', oldSha: ZERO_SHA, newSha: sha2 },
      ])

      expect(result.success).toBe(true)
      expect(result.refResults.every((r) => r.success)).toBe(true)
      expect(refStore.get('refs/heads/main')).toBe(sha1)
      expect(refStore.get('refs/heads/feature')).toBe(sha2)
    })

    it('should handle ref deletion', async () => {
      refStore.set('refs/heads/old-branch', 'deadbeef'.padEnd(40, '0'))

      const objectStore = createMockObjectStore()
      const tx = new PushTransaction(storage, objectStore)

      const result = await tx.execute([
        {
          refName: 'refs/heads/old-branch',
          oldSha: 'deadbeef'.padEnd(40, '0'),
          newSha: ZERO_SHA,
        },
      ])

      expect(result.success).toBe(true)
      expect(refStore.get('refs/heads/old-branch')).toBeUndefined()
    })

    it('should skip flushing objects that already exist', async () => {
      const sha = 'existing1'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha]),
      })
      const tx = new PushTransaction(storage, objectStore)

      tx.bufferObject(sha, 'blob', new Uint8Array([1, 2, 3]))

      await tx.execute([
        { refName: 'refs/heads/main', oldSha: ZERO_SHA, newSha: sha },
      ])

      // Object already existed, so putObject should not have been called
      expect(objectStore.putCalls.length).toBe(0)
    })
  })

  describe('object flush failure', () => {
    it('should fail all ref updates if object flush fails', async () => {
      const objectStore = createMockObjectStore({ failOnPut: true })
      const tx = new PushTransaction(storage, objectStore)

      const sha = 'new123'.padEnd(40, '0')
      tx.bufferObject(sha, 'blob', new Uint8Array([1, 2, 3]))

      const result = await tx.execute([
        { refName: 'refs/heads/main', oldSha: ZERO_SHA, newSha: sha },
        { refName: 'refs/heads/feature', oldSha: ZERO_SHA, newSha: sha },
      ])

      expect(result.success).toBe(false)
      expect(result.refResults).toHaveLength(2)
      expect(result.refResults[0]!.success).toBe(false)
      expect(result.refResults[0]!.error).toContain('object flush failed')
      expect(result.refResults[1]!.success).toBe(false)
      expect(tx.phase).toBe('failed')

      // No refs should have been updated
      expect(refStore.get('refs/heads/main')).toBeUndefined()
      expect(refStore.get('refs/heads/feature')).toBeUndefined()

      // No orphaned SHAs since nothing was flushed
      expect(result.orphanedShas).toHaveLength(0)
    })
  })

  describe('ref update failure (compare-and-swap)', () => {
    it('should fail ref update when old SHA does not match', async () => {
      const sha = 'newsha'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha]),
      })
      const tx = new PushTransaction(storage, objectStore)

      // Ref already exists with a different SHA
      refStore.set('refs/heads/main', 'othershavalue'.padEnd(40, '0'))

      tx.bufferObject(sha, 'commit', new Uint8Array([1]))

      const result = await tx.execute([
        {
          refName: 'refs/heads/main',
          oldSha: 'wrongoldsha'.padEnd(40, '0'),
          newSha: sha,
        },
      ])

      expect(result.success).toBe(false)
      expect(result.refResults[0]!.success).toBe(false)
      expect(result.refResults[0]!.error).toContain('lock failed')

      // Ref should retain its original value
      expect(refStore.get('refs/heads/main')).toBe('othershavalue'.padEnd(40, '0'))
    })

    it('should fail create when ref already exists', async () => {
      const sha = 'newsha'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha]),
      })
      const tx = new PushTransaction(storage, objectStore)

      // Ref already exists
      refStore.set('refs/heads/main', 'existingsha'.padEnd(40, '0'))

      tx.bufferObject(sha, 'commit', new Uint8Array([1]))

      const result = await tx.execute([
        { refName: 'refs/heads/main', oldSha: ZERO_SHA, newSha: sha },
      ])

      expect(result.success).toBe(false)
      expect(result.refResults[0]!.error).toContain('ref already exists')
    })

    it('should fail all ref updates atomically when one fails', async () => {
      const sha1 = 'sha1val'.padEnd(40, '0')
      const sha2 = 'sha2val'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha1, sha2]),
      })
      const tx = new PushTransaction(storage, objectStore)

      // Set up: refs/heads/main exists, refs/heads/feature does not
      refStore.set('refs/heads/main', 'existingsha'.padEnd(40, '0'))

      tx.bufferObject(sha1, 'commit', new Uint8Array([1]))
      tx.bufferObject(sha2, 'commit', new Uint8Array([2]))

      const result = await tx.execute([
        // This will fail: oldSha doesn't match
        { refName: 'refs/heads/main', oldSha: ZERO_SHA, newSha: sha1 },
        // This would succeed in isolation, but atomic push fails all refs
        { refName: 'refs/heads/feature', oldSha: ZERO_SHA, newSha: sha2 },
      ])

      // With atomic push, both refs should fail
      expect(result.success).toBe(false)
      expect(result.refResults[0]!.success).toBe(false)
      expect(result.refResults[1]!.success).toBe(false)
      // The second ref should NOT have been created due to atomic rollback
      expect(refStore.get('refs/heads/feature')).toBeUndefined()
    })
  })

  describe('orphan identification', () => {
    it('should identify orphaned SHAs from failed ref updates', async () => {
      const sha = 'orphansha1'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha]),
      })
      const tx = new PushTransaction(storage, objectStore)

      // Set up: ref already exists, so CAS will fail
      refStore.set('refs/heads/main', 'currentsha'.padEnd(40, '0'))

      tx.bufferObject(sha, 'commit', new Uint8Array([1]))

      const result = await tx.execute([
        {
          refName: 'refs/heads/main',
          oldSha: ZERO_SHA,
          newSha: sha,
        },
      ])

      expect(result.success).toBe(false)
      expect(result.orphanedShas).toContain(sha)
    })

    it('should mark SHA as orphaned when atomic push fails', async () => {
      const sha = 'sharedsha1'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha]),
      })
      const tx = new PushTransaction(storage, objectStore)

      // refs/heads/main exists (CAS will fail), refs/heads/feature doesn't
      // With atomic push, if any ref fails, all fail and objects become orphaned
      refStore.set('refs/heads/main', 'currentsha'.padEnd(40, '0'))

      tx.bufferObject(sha, 'commit', new Uint8Array([1]))

      const result = await tx.execute([
        // Fails: ref exists
        { refName: 'refs/heads/main', oldSha: ZERO_SHA, newSha: sha },
        // Would succeed in isolation, but atomic push fails all refs
        { refName: 'refs/heads/feature', oldSha: ZERO_SHA, newSha: sha },
      ])

      // With atomic push, both refs fail, so the SHA is orphaned
      expect(result.success).toBe(false)
      expect(result.orphanedShas).toContain(sha)
    })
  })

  describe('orphan cleanup delegate', () => {
    it('should call cleanup delegate with orphaned SHAs when atomic push fails', async () => {
      const sha = 'orphansha2'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha]),
      })
      const cleanupDelegate: OrphanCleanupDelegate = {
        scheduleOrphanCleanup: vi.fn(),
      }
      const tx = new PushTransaction(storage, objectStore, cleanupDelegate)

      refStore.set('refs/heads/main', 'currentsha'.padEnd(40, '0'))
      tx.bufferObject(sha, 'commit', new Uint8Array([1]))

      const result = await tx.execute([
        { refName: 'refs/heads/main', oldSha: ZERO_SHA, newSha: sha },
      ])

      // Verify the push failed and orphan cleanup was scheduled
      expect(result.success).toBe(false)
      expect(result.orphanedShas).toContain(sha)
      expect(cleanupDelegate.scheduleOrphanCleanup).toHaveBeenCalledWith([sha])
    })

    it('should not call cleanup delegate when there are no orphans', async () => {
      const sha = 'goodsha123'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha]),
      })
      const cleanupDelegate: OrphanCleanupDelegate = {
        scheduleOrphanCleanup: vi.fn(),
      }
      const tx = new PushTransaction(storage, objectStore, cleanupDelegate)

      tx.bufferObject(sha, 'commit', new Uint8Array([1]))

      await tx.execute([
        { refName: 'refs/heads/main', oldSha: ZERO_SHA, newSha: sha },
      ])

      expect(cleanupDelegate.scheduleOrphanCleanup).not.toHaveBeenCalled()
    })
  })

  describe('target object validation', () => {
    it('should fail ref update when target object does not exist', async () => {
      const sha = 'missing123'.padEnd(40, '0')
      // Object store does NOT have this SHA
      const objectStore = createMockObjectStore({ existingShas: new Set() })
      const tx = new PushTransaction(storage, objectStore)

      // Don't buffer anything - simulating a scenario where flush
      // succeeded but the SHA referenced by the command isn't present

      const result = await tx.execute([
        { refName: 'refs/heads/main', oldSha: ZERO_SHA, newSha: sha },
      ])

      expect(result.success).toBe(false)
      expect(result.refResults[0]!.error).toContain('target object')
      expect(result.refResults[0]!.error).toContain('not found')
    })
  })

  describe('empty transaction', () => {
    it('should handle execute with no buffered objects and no commands', async () => {
      const objectStore = createMockObjectStore()
      const tx = new PushTransaction(storage, objectStore)

      const result = await tx.execute([])

      expect(result.success).toBe(true)
      expect(result.refResults).toHaveLength(0)
      expect(result.orphanedShas).toHaveLength(0)
      expect(tx.phase).toBe('completed')
    })
  })

  describe('atomic rollback behavior', () => {
    it('should rollback all refs when one ref validation fails', async () => {
      const sha1 = 'aaaa'.padEnd(40, '0')
      const sha2 = 'bbbb'.padEnd(40, '0')
      const sha3 = 'cccc'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha1, sha2, sha3]),
      })
      const tx = new PushTransaction(storage, objectStore)

      // Set up: refs/heads/conflict exists with a different value
      refStore.set('refs/heads/conflict', 'existing'.padEnd(40, '0'))

      tx.bufferObject(sha1, 'commit', new Uint8Array([1]))
      tx.bufferObject(sha2, 'commit', new Uint8Array([2]))
      tx.bufferObject(sha3, 'commit', new Uint8Array([3]))

      const result = await tx.execute([
        // First two would succeed in isolation
        { refName: 'refs/heads/feature1', oldSha: ZERO_SHA, newSha: sha1 },
        { refName: 'refs/heads/feature2', oldSha: ZERO_SHA, newSha: sha2 },
        // This one fails: wrong oldSha
        { refName: 'refs/heads/conflict', oldSha: ZERO_SHA, newSha: sha3 },
      ])

      // All should fail due to atomic rollback
      expect(result.success).toBe(false)
      expect(result.refResults.every((r) => !r.success)).toBe(true)

      // None of the refs should have been created
      expect(refStore.get('refs/heads/feature1')).toBeUndefined()
      expect(refStore.get('refs/heads/feature2')).toBeUndefined()
      expect(refStore.get('refs/heads/conflict')).toBe('existing'.padEnd(40, '0'))
    })

    it('should succeed atomically when all refs pass validation', async () => {
      const sha1 = 'aaaa'.padEnd(40, '0')
      const sha2 = 'bbbb'.padEnd(40, '0')
      const sha3 = 'cccc'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha1, sha2, sha3]),
      })
      const tx = new PushTransaction(storage, objectStore)

      tx.bufferObject(sha1, 'commit', new Uint8Array([1]))
      tx.bufferObject(sha2, 'commit', new Uint8Array([2]))
      tx.bufferObject(sha3, 'commit', new Uint8Array([3]))

      const result = await tx.execute([
        { refName: 'refs/heads/feature1', oldSha: ZERO_SHA, newSha: sha1 },
        { refName: 'refs/heads/feature2', oldSha: ZERO_SHA, newSha: sha2 },
        { refName: 'refs/heads/feature3', oldSha: ZERO_SHA, newSha: sha3 },
      ])

      // All should succeed
      expect(result.success).toBe(true)
      expect(result.refResults.every((r) => r.success)).toBe(true)

      // All refs should be created
      expect(refStore.get('refs/heads/feature1')).toBe(sha1)
      expect(refStore.get('refs/heads/feature2')).toBe(sha2)
      expect(refStore.get('refs/heads/feature3')).toBe(sha3)
    })

    it('should fail all refs when target object validation fails', async () => {
      const sha1 = 'aaaa'.padEnd(40, '0')
      const sha2 = 'missing'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha1]), // sha2 is missing
      })
      const tx = new PushTransaction(storage, objectStore)

      tx.bufferObject(sha1, 'commit', new Uint8Array([1]))
      // sha2 is not buffered and doesn't exist in the store

      const result = await tx.execute([
        { refName: 'refs/heads/feature1', oldSha: ZERO_SHA, newSha: sha1 },
        { refName: 'refs/heads/feature2', oldSha: ZERO_SHA, newSha: sha2 },
      ])

      // All should fail due to atomic rollback
      expect(result.success).toBe(false)
      expect(result.refResults.every((r) => !r.success)).toBe(true)

      // Neither ref should be created
      expect(refStore.get('refs/heads/feature1')).toBeUndefined()
      expect(refStore.get('refs/heads/feature2')).toBeUndefined()
    })

    it('should rollback mixed operations (create, update, delete)', async () => {
      const sha1 = 'aaaa'.padEnd(40, '0')
      const sha2 = 'bbbb'.padEnd(40, '0')
      const sha3 = 'cccc'.padEnd(40, '0')
      const objectStore = createMockObjectStore({
        existingShas: new Set([sha1, sha2, sha3]),
      })
      const tx = new PushTransaction(storage, objectStore)

      // Set up existing refs
      refStore.set('refs/heads/to-update', sha1)
      refStore.set('refs/heads/to-delete', sha2)
      refStore.set('refs/heads/conflict', sha3)

      tx.bufferObject(sha2, 'commit', new Uint8Array([2]))
      tx.bufferObject(sha3, 'commit', new Uint8Array([3]))

      const result = await tx.execute([
        // Create
        { refName: 'refs/heads/new-branch', oldSha: ZERO_SHA, newSha: sha1 },
        // Update
        { refName: 'refs/heads/to-update', oldSha: sha1, newSha: sha2 },
        // Delete
        { refName: 'refs/heads/to-delete', oldSha: sha2, newSha: ZERO_SHA },
        // This one fails: wrong oldSha
        { refName: 'refs/heads/conflict', oldSha: sha1, newSha: sha2 },
      ])

      // All should fail
      expect(result.success).toBe(false)
      expect(result.refResults.every((r) => !r.success)).toBe(true)

      // Nothing should have changed
      expect(refStore.get('refs/heads/new-branch')).toBeUndefined()
      expect(refStore.get('refs/heads/to-update')).toBe(sha1)
      expect(refStore.get('refs/heads/to-delete')).toBe(sha2)
      expect(refStore.get('refs/heads/conflict')).toBe(sha3)
    })
  })
})
