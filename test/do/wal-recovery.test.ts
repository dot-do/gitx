import { describe, it, expect, beforeEach } from 'vitest'
import {
  WALManager,
  WALEntry,
  WALOperationType,
  Transaction,
  TransactionState,
  Checkpoint
} from '../../src/do/wal'
import { DurableObjectStorage } from '../../src/do/schema'

/**
 * Mock DurableObjectStorage for WAL crash recovery testing.
 *
 * Extends the base mock with crash simulation capabilities:
 * - Ability to "crash" mid-operation by stopping writes
 * - Selective flushing to simulate partial checkpoints
 * - State snapshot/restore for simulating restart cycles
 */
class CrashableWALStorage implements DurableObjectStorage {
  private walEntries: Map<number, WALEntry> = new Map()
  private checkpoints: Map<number, Checkpoint> = new Map()
  private transactions: Map<string, Transaction> = new Map()
  private nextWalId = 1
  private nextCheckpointId = 1

  /** When true, simulates a crash by throwing on write operations */
  crashOnNextWrite = false
  /** Count of writes before crashing (0 = crash immediately on next write) */
  crashAfterNWrites = -1
  private writeCount = 0

  sql = {
    exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
      const isWrite = query.includes('INSERT') || query.includes('UPDATE') || query.includes('DELETE')

      // Simulate crash on write operations
      if (isWrite) {
        if (this.crashOnNextWrite) {
          this.crashOnNextWrite = false
          throw new Error('SIMULATED CRASH: storage unavailable')
        }
        if (this.crashAfterNWrites >= 0) {
          this.writeCount++
          if (this.writeCount > this.crashAfterNWrites) {
            this.crashAfterNWrites = -1
            this.writeCount = 0
            throw new Error('SIMULATED CRASH: storage unavailable mid-batch')
          }
        }
      }

      // Handle WAL inserts
      if (query.includes('INSERT INTO wal')) {
        const id = this.nextWalId++
        const entry: WALEntry = {
          id,
          operation: params[0] as WALOperationType,
          payload: params[1] as Uint8Array,
          transactionId: params[2] as string | null,
          createdAt: Date.now(),
          flushed: false
        }
        this.walEntries.set(id, entry)
        return { toArray: () => [{ id }] }
      }

      // Handle COUNT queries
      if (query.includes('COUNT(*)') && query.includes('FROM wal')) {
        const count = Array.from(this.walEntries.values()).filter(e => !e.flushed).length
        return { toArray: () => [{ count }] }
      }

      // Handle MAX(id) query for checkpoint position
      if (query.includes('MAX(id)') && query.includes('FROM wal')) {
        const entries = Array.from(this.walEntries.values())
        const maxId = entries.length > 0 ? Math.max(...entries.map(e => e.id)) : 0
        return { toArray: () => [{ max_id: maxId }] }
      }

      // Handle WAL SELECT for unflushed entries
      if (query.includes('SELECT') && query.includes('FROM wal') && query.includes('flushed = 0')) {
        const entries = Array.from(this.walEntries.values())
          .filter(e => !e.flushed)
          .sort((a, b) => a.id - b.id)
        return { toArray: () => entries }
      }

      // Handle WAL SELECT for transaction entries
      if (query.includes('SELECT') && query.includes('FROM wal') && query.includes('transaction_id')) {
        const txId = params[0] as string
        const entries = Array.from(this.walEntries.values())
          .filter(e => e.transactionId === txId)
          .sort((a, b) => a.id - b.id)
        return { toArray: () => entries }
      }

      // Handle WAL SELECT all unflushed
      if (query.includes('SELECT') && query.includes('FROM wal') && !query.includes('transaction_id')) {
        const entries = Array.from(this.walEntries.values())
          .filter(e => !e.flushed)
          .sort((a, b) => a.id - b.id)
        return { toArray: () => entries }
      }

      // Handle flush (UPDATE) - with selective flushing support
      if (query.includes('UPDATE wal') && query.includes('flushed = 1')) {
        if (query.includes('transaction_id')) {
          const txId = params[0] as string
          for (const entry of this.walEntries.values()) {
            if (entry.transactionId === txId) {
              entry.flushed = true
            }
          }
        } else if (query.includes('id <=')) {
          const upToId = params[0] as number
          for (const entry of this.walEntries.values()) {
            if (entry.id <= upToId) {
              entry.flushed = true
            }
          }
        } else {
          for (const entry of this.walEntries.values()) {
            entry.flushed = true
          }
        }
        return { toArray: () => [] }
      }

      // Handle DELETE for flushed entries
      if (query.includes('DELETE FROM wal') && query.includes('flushed = 1')) {
        for (const [id, entry] of this.walEntries.entries()) {
          if (entry.flushed) {
            this.walEntries.delete(id)
          }
        }
        return { toArray: () => [] }
      }

      // Handle DELETE for checkpoint truncation (id <= ? AND flushed = 1)
      if (query.includes('DELETE FROM wal') && query.includes('id <=') && query.includes('flushed = 1')) {
        const upToId = params[0] as number
        for (const [id, entry] of this.walEntries.entries()) {
          if (entry.id <= upToId && entry.flushed) {
            this.walEntries.delete(id)
          }
        }
        return { toArray: () => [] }
      }

      // Handle DELETE for transaction rollback
      if (query.includes('DELETE FROM wal') && query.includes('transaction_id')) {
        const txId = params[0] as string
        for (const [id, entry] of this.walEntries.entries()) {
          if (entry.transactionId === txId) {
            this.walEntries.delete(id)
          }
        }
        return { toArray: () => [] }
      }

      // Handle checkpoint inserts
      if (query.includes('INSERT INTO checkpoints')) {
        const id = this.nextCheckpointId++
        const checkpoint: Checkpoint = {
          id,
          walPosition: params[0] as number,
          createdAt: Date.now(),
          metadata: params[1] as string | null
        }
        this.checkpoints.set(id, checkpoint)
        return { toArray: () => [{ id }] }
      }

      // Handle checkpoint SELECT
      if (query.includes('SELECT') && query.includes('FROM checkpoints') && query.includes('ORDER BY')) {
        const checkpointArr = Array.from(this.checkpoints.values())
          .sort((a, b) => b.id - a.id)
        return { toArray: () => checkpointArr.length > 0 ? [checkpointArr[0]] : [] }
      }

      // Handle transaction state queries
      if (query.includes('INSERT INTO transactions')) {
        const tx: Transaction = {
          id: params[0] as string,
          state: params[1] as TransactionState,
          startedAt: Date.now(),
          operations: []
        }
        this.transactions.set(tx.id, tx)
        return { toArray: () => [] }
      }

      if (query.includes('UPDATE transactions') && query.includes('state')) {
        const txId = params[1] as string
        const state = params[0] as TransactionState
        const tx = this.transactions.get(txId)
        if (tx) {
          tx.state = state
        }
        return { toArray: () => [] }
      }

      if (query.includes('SELECT') && query.includes('FROM transactions')) {
        const txId = params[0] as string
        const tx = this.transactions.get(txId)
        return { toArray: () => tx ? [tx] : [] }
      }

      return { toArray: () => [] }
    }
  }

  // Test helpers
  getWALEntries(): WALEntry[] {
    return Array.from(this.walEntries.values()).sort((a, b) => a.id - b.id)
  }

  getUnflushedEntries(): WALEntry[] {
    return Array.from(this.walEntries.values())
      .filter(e => !e.flushed)
      .sort((a, b) => a.id - b.id)
  }

  getFlushedEntries(): WALEntry[] {
    return Array.from(this.walEntries.values())
      .filter(e => e.flushed)
      .sort((a, b) => a.id - b.id)
  }

  getCheckpoints(): Checkpoint[] {
    return Array.from(this.checkpoints.values())
  }

  /** Inject a WAL entry directly (simulates pre-crash state) */
  injectWALEntry(entry: WALEntry): void {
    this.walEntries.set(entry.id, entry)
    if (entry.id >= this.nextWalId) {
      this.nextWalId = entry.id + 1
    }
  }

  /** Inject a checkpoint directly */
  injectCheckpoint(checkpoint: Checkpoint): void {
    this.checkpoints.set(checkpoint.id, checkpoint)
    if (checkpoint.id >= this.nextCheckpointId) {
      this.nextCheckpointId = checkpoint.id + 1
    }
  }

  /** Manually mark specific entries as flushed (simulate partial checkpoint) */
  markFlushed(entryIds: number[]): void {
    for (const id of entryIds) {
      const entry = this.walEntries.get(id)
      if (entry) {
        entry.flushed = true
      }
    }
  }

  /** Reset crash simulation state */
  resetCrashState(): void {
    this.crashOnNextWrite = false
    this.crashAfterNWrites = -1
    this.writeCount = 0
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function makePayload(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(JSON.stringify(data))
}

function decodePayload(payload: Uint8Array): Record<string, unknown> {
  return JSON.parse(decoder.decode(payload))
}

// ============================================================================
// Tests
// ============================================================================

describe('WAL Crash Recovery', () => {
  let storage: CrashableWALStorage
  let walManager: WALManager

  beforeEach(() => {
    storage = new CrashableWALStorage()
    walManager = new WALManager(storage)
  })

  describe('crash before checkpoint (no flush)', () => {
    it('should recover all unflushed entries after simulated crash and restart', async () => {
      // Phase 1: Write entries, then "crash" (no checkpoint/flush)
      const payload1 = makePayload({ sha: 'aaa111', type: 'blob' })
      const payload2 = makePayload({ sha: 'bbb222', type: 'tree' })
      const payload3 = makePayload({ sha: 'ccc333', type: 'commit' })

      await walManager.append('PUT', payload1)
      await walManager.append('PUT', payload2)
      await walManager.append('DELETE', payload3)

      // Verify entries are unflushed (pre-crash state)
      const preCrashEntries = storage.getUnflushedEntries()
      expect(preCrashEntries.length).toBe(3)

      // Phase 2: Simulate restart - create new WALManager on same storage
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // All three entries should be recoverable
      expect(recovered.length).toBe(3)
      expect(recovered[0].operation).toBe('PUT')
      expect(recovered[1].operation).toBe('PUT')
      expect(recovered[2].operation).toBe('DELETE')

      // Verify payload integrity
      const data1 = decodePayload(recovered[0].payload)
      expect(data1.sha).toBe('aaa111')
      const data2 = decodePayload(recovered[1].payload)
      expect(data2.sha).toBe('bbb222')
      const data3 = decodePayload(recovered[2].payload)
      expect(data3.sha).toBe('ccc333')
    })

    it('should recover entries in correct order by ID after restart', async () => {
      // Write entries in a specific order
      await walManager.append('PUT', makePayload({ seq: 1 }))
      await walManager.append('DELETE', makePayload({ seq: 2 }))
      await walManager.append('PUT', makePayload({ seq: 3 }))
      await walManager.append('UPDATE', makePayload({ seq: 4 }))

      // Simulate restart
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      expect(recovered.length).toBe(4)
      for (let i = 0; i < recovered.length - 1; i++) {
        expect(recovered[i].id).toBeLessThan(recovered[i + 1].id)
      }

      // Verify sequence
      expect(decodePayload(recovered[0].payload).seq).toBe(1)
      expect(decodePayload(recovered[1].payload).seq).toBe(2)
      expect(decodePayload(recovered[2].payload).seq).toBe(3)
      expect(decodePayload(recovered[3].payload).seq).toBe(4)
    })

    it('should handle empty WAL on recovery (clean shutdown)', async () => {
      // No writes at all - simulates clean state
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()
      expect(recovered).toEqual([])
    })

    it('should recover entries written by different operation types', async () => {
      await walManager.append('PUT', makePayload({ op: 'put' }))
      await walManager.append('DELETE', makePayload({ op: 'delete' }))
      await walManager.append('UPDATE', makePayload({ op: 'update' }))
      await walManager.append('BATCH', makePayload({ op: 'batch' }))

      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      expect(recovered.map(e => e.operation)).toEqual(['PUT', 'DELETE', 'UPDATE', 'BATCH'])
    })
  })

  describe('partial checkpoint recovery', () => {
    it('should recover unflushed entries when some entries were flushed before crash', async () => {
      // Write 5 entries
      await walManager.append('PUT', makePayload({ sha: 'obj1' }))
      await walManager.append('PUT', makePayload({ sha: 'obj2' }))
      await walManager.append('PUT', makePayload({ sha: 'obj3' }))
      await walManager.append('PUT', makePayload({ sha: 'obj4' }))
      await walManager.append('DELETE', makePayload({ sha: 'obj5' }))

      // Simulate partial checkpoint: only first 2 entries were flushed
      storage.markFlushed([1, 2])

      // Simulate restart
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // Only entries 3, 4, 5 should be recovered (unflushed)
      expect(recovered.length).toBe(3)
      expect(decodePayload(recovered[0].payload).sha).toBe('obj3')
      expect(decodePayload(recovered[1].payload).sha).toBe('obj4')
      expect(decodePayload(recovered[2].payload).sha).toBe('obj5')
    })

    it('should not recover fully flushed entries', async () => {
      await walManager.append('PUT', makePayload({ sha: 'obj1' }))
      await walManager.append('PUT', makePayload({ sha: 'obj2' }))

      // Flush all entries (successful checkpoint before crash)
      await walManager.flush()

      // Write new entry after flush
      await walManager.append('PUT', makePayload({ sha: 'obj3' }))

      // Simulate restart
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // Only the post-flush entry should be recovered
      expect(recovered.length).toBe(1)
      expect(decodePayload(recovered[0].payload).sha).toBe('obj3')
    })

    it('should handle alternating flushed/unflushed entries', async () => {
      // Write entries
      await walManager.append('PUT', makePayload({ sha: 'a' }))   // id=1
      await walManager.append('PUT', makePayload({ sha: 'b' }))   // id=2
      await walManager.append('PUT', makePayload({ sha: 'c' }))   // id=3
      await walManager.append('PUT', makePayload({ sha: 'd' }))   // id=4
      await walManager.append('PUT', makePayload({ sha: 'e' }))   // id=5

      // Simulate partial flush: only odd-numbered entries flushed
      storage.markFlushed([1, 3, 5])

      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // Only entries 2 and 4 should be recovered
      expect(recovered.length).toBe(2)
      expect(decodePayload(recovered[0].payload).sha).toBe('b')
      expect(decodePayload(recovered[1].payload).sha).toBe('d')
    })

    it('should recover correctly after checkpoint with subsequent unflushed writes', async () => {
      // Phase 1: Write and checkpoint
      await walManager.append('PUT', makePayload({ sha: 'pre1' }))
      await walManager.append('PUT', makePayload({ sha: 'pre2' }))
      const checkpoint = await walManager.createCheckpoint()

      // Phase 2: Write more entries after checkpoint (not flushed)
      await walManager.append('PUT', makePayload({ sha: 'post1' }))
      await walManager.append('PUT', makePayload({ sha: 'post2' }))
      await walManager.append('DELETE', makePayload({ sha: 'post3' }))

      // Phase 3: Truncate before checkpoint (cleanup old entries)
      await walManager.truncateBeforeCheckpoint(checkpoint)

      // Phase 4: "Crash" and restart
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // Only post-checkpoint unflushed entries should remain
      expect(recovered.length).toBe(3)
      expect(decodePayload(recovered[0].payload).sha).toBe('post1')
      expect(decodePayload(recovered[1].payload).sha).toBe('post2')
      expect(decodePayload(recovered[2].payload).sha).toBe('post3')
    })
  })

  describe('concurrent WAL writes during checkpoint', () => {
    it('should preserve entries written after flush but before checkpoint completes', async () => {
      // Write initial entries
      await walManager.append('PUT', makePayload({ sha: 'initial1' }))
      await walManager.append('PUT', makePayload({ sha: 'initial2' }))

      // Flush (part of checkpoint process)
      await walManager.flush()

      // Simulate "concurrent" writes arriving after flush but before checkpoint record
      await walManager.append('PUT', makePayload({ sha: 'concurrent1' }))
      await walManager.append('PUT', makePayload({ sha: 'concurrent2' }))

      // Now create the checkpoint
      const checkpoint = await walManager.createCheckpoint()

      // The checkpoint should capture the position including concurrent writes
      // But the concurrent writes that were flushed in the second flush should be safe
      expect(checkpoint.walPosition).toBeGreaterThanOrEqual(4)

      // Simulate restart and recovery
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // All entries should be flushed (checkpoint flushes everything)
      // so nothing to recover
      expect(recovered.length).toBe(0)
    })

    it('should recover concurrent writes that were not flushed', async () => {
      // Write initial entries
      await walManager.append('PUT', makePayload({ sha: 'initial1' }))
      await walManager.append('PUT', makePayload({ sha: 'initial2' }))

      // Manually flush only the first two (simulating flush in progress)
      storage.markFlushed([1, 2])

      // These arrived "concurrently" and were NOT flushed
      await walManager.append('PUT', makePayload({ sha: 'concurrent1' }))
      await walManager.append('PUT', makePayload({ sha: 'concurrent2' }))

      // Crash before checkpoint completes
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // Concurrent writes should be recoverable
      expect(recovered.length).toBe(2)
      expect(decodePayload(recovered[0].payload).sha).toBe('concurrent1')
      expect(decodePayload(recovered[1].payload).sha).toBe('concurrent2')
    })

    it('should handle interleaved transaction and non-transaction writes', async () => {
      // Non-transactional write
      await walManager.append('PUT', makePayload({ sha: 'standalone1' }))

      // Start a transaction
      const txId = await walManager.beginTransaction()
      await walManager.append('PUT', makePayload({ sha: 'tx-obj1' }), txId)

      // Another non-transactional write interleaved
      await walManager.append('PUT', makePayload({ sha: 'standalone2' }))

      // More transaction writes
      await walManager.append('PUT', makePayload({ sha: 'tx-obj2' }), txId)
      await walManager.commitTransaction(txId)

      // One more standalone
      await walManager.append('DELETE', makePayload({ sha: 'standalone3' }))

      // Simulate crash (no flush)
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // All entries should be recoverable (none were flushed)
      // Entries: standalone1, TX_BEGIN, tx-obj1, standalone2, tx-obj2, TX_COMMIT, standalone3
      expect(recovered.length).toBe(7)

      // Verify ordering is maintained
      const operations = recovered.map(e => e.operation)
      expect(operations).toEqual(['PUT', 'TX_BEGIN', 'PUT', 'PUT', 'PUT', 'TX_COMMIT', 'DELETE'])
    })
  })

  describe('WAL truncation after successful flush', () => {
    it('should truncate only flushed entries', async () => {
      await walManager.append('PUT', makePayload({ sha: 'obj1' }))
      await walManager.append('PUT', makePayload({ sha: 'obj2' }))

      // Create checkpoint (flushes all entries)
      const checkpoint = await walManager.createCheckpoint()

      // Write more entries after checkpoint
      await walManager.append('PUT', makePayload({ sha: 'obj3' }))

      // Truncate entries before checkpoint
      await walManager.truncateBeforeCheckpoint(checkpoint)

      // Only the post-checkpoint entry should remain
      const allEntries = storage.getWALEntries()
      expect(allEntries.length).toBe(1)
      expect(decodePayload(allEntries[0].payload).sha).toBe('obj3')
    })

    it('should not truncate unflushed entries even with truncation call', async () => {
      await walManager.append('PUT', makePayload({ sha: 'obj1' }))
      await walManager.append('PUT', makePayload({ sha: 'obj2' }))
      await walManager.append('PUT', makePayload({ sha: 'obj3' }))

      // Only flush first two
      storage.markFlushed([1, 2])

      // Create checkpoint manually at position 2
      storage.injectCheckpoint({
        id: 1,
        walPosition: 3,
        createdAt: Date.now(),
        metadata: null
      })

      // Truncate before checkpoint - should only remove flushed entries
      await walManager.truncateBeforeCheckpoint({
        id: 1,
        walPosition: 3,
        createdAt: Date.now(),
        metadata: null
      })

      // Entry 3 (unflushed) should survive even though it's <= checkpoint position
      const remaining = storage.getWALEntries()
      expect(remaining.length).toBe(1)
      expect(remaining[0].id).toBe(3)
      expect(remaining[0].flushed).toBe(false)
    })

    it('should handle multiple checkpoint-truncate cycles', async () => {
      // Cycle 1: write, checkpoint, truncate
      await walManager.append('PUT', makePayload({ cycle: 1, sha: 'c1-obj1' }))
      await walManager.append('PUT', makePayload({ cycle: 1, sha: 'c1-obj2' }))
      const cp1 = await walManager.createCheckpoint()
      await walManager.truncateBeforeCheckpoint(cp1)

      let remaining = storage.getWALEntries()
      expect(remaining.length).toBe(0)

      // Cycle 2: write more, checkpoint, truncate
      await walManager.append('PUT', makePayload({ cycle: 2, sha: 'c2-obj1' }))
      await walManager.append('DELETE', makePayload({ cycle: 2, sha: 'c2-obj2' }))
      const cp2 = await walManager.createCheckpoint()
      await walManager.truncateBeforeCheckpoint(cp2)

      remaining = storage.getWALEntries()
      expect(remaining.length).toBe(0)

      // Cycle 3: write but don't checkpoint - simulate crash
      await walManager.append('PUT', makePayload({ cycle: 3, sha: 'c3-obj1' }))

      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // Only the last unflushed entry should be present
      expect(recovered.length).toBe(1)
      const data = decodePayload(recovered[0].payload)
      expect(data.cycle).toBe(3)
      expect(data.sha).toBe('c3-obj1')
    })

    it('should handle truncation when WAL is empty', async () => {
      const checkpoint: Checkpoint = {
        id: 1,
        walPosition: 0,
        createdAt: Date.now(),
        metadata: null
      }

      // Should not throw
      await walManager.truncateBeforeCheckpoint(checkpoint)

      const remaining = storage.getWALEntries()
      expect(remaining.length).toBe(0)
    })
  })

  describe('recovery with crashed writes', () => {
    it('should recover successfully after a crash during write', async () => {
      // Write two entries successfully
      await walManager.append('PUT', makePayload({ sha: 'ok1' }))
      await walManager.append('PUT', makePayload({ sha: 'ok2' }))

      // Next write will crash
      storage.crashOnNextWrite = true

      try {
        await walManager.append('PUT', makePayload({ sha: 'crash' }))
      } catch (e) {
        // Expected: SIMULATED CRASH
      }

      // Reset crash state and recover
      storage.resetCrashState()

      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // Only the two successful writes should be recoverable
      expect(recovered.length).toBe(2)
      expect(decodePayload(recovered[0].payload).sha).toBe('ok1')
      expect(decodePayload(recovered[1].payload).sha).toBe('ok2')
    })

    it('should handle crash during batch writes (partial batch committed)', async () => {
      // Successfully write some entries
      await walManager.append('PUT', makePayload({ sha: 'batch-1' }))
      await walManager.append('PUT', makePayload({ sha: 'batch-2' }))

      // Crash after 1 more write (simulates partial batch)
      storage.crashAfterNWrites = 1

      try {
        // This one succeeds (the 1st write)
        await walManager.append('PUT', makePayload({ sha: 'batch-3' }))
        // This one should crash (the 2nd write)
        await walManager.append('PUT', makePayload({ sha: 'batch-4-lost' }))
      } catch (e) {
        // Expected crash
      }

      storage.resetCrashState()

      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // First three should be recoverable, the crashed one is lost
      expect(recovered.length).toBe(3)
      expect(decodePayload(recovered[0].payload).sha).toBe('batch-1')
      expect(decodePayload(recovered[1].payload).sha).toBe('batch-2')
      expect(decodePayload(recovered[2].payload).sha).toBe('batch-3')
    })

    it('should recover after crash during flush', async () => {
      // Write entries
      await walManager.append('PUT', makePayload({ sha: 'f1' }))
      await walManager.append('PUT', makePayload({ sha: 'f2' }))
      await walManager.append('PUT', makePayload({ sha: 'f3' }))

      // Crash during flush (the UPDATE query)
      storage.crashOnNextWrite = true

      try {
        await walManager.flush()
      } catch (e) {
        // Expected crash during flush
      }

      storage.resetCrashState()

      // All entries should still be unflushed and recoverable
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      expect(recovered.length).toBe(3)
      expect(decodePayload(recovered[0].payload).sha).toBe('f1')
      expect(decodePayload(recovered[1].payload).sha).toBe('f2')
      expect(decodePayload(recovered[2].payload).sha).toBe('f3')
    })
  })

  describe('transaction recovery after crash', () => {
    it('should recover committed transaction entries after crash', async () => {
      const txId = await walManager.beginTransaction()
      await walManager.append('PUT', makePayload({ sha: 'tx-1' }), txId)
      await walManager.append('PUT', makePayload({ sha: 'tx-2' }), txId)
      await walManager.commitTransaction(txId)

      // Crash before flush
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // All transaction entries (TX_BEGIN + 2 PUTs + TX_COMMIT) should be recoverable
      expect(recovered.length).toBe(4)

      const ops = recovered.map(e => e.operation)
      expect(ops).toContain('TX_BEGIN')
      expect(ops).toContain('TX_COMMIT')
      expect(ops.filter(o => o === 'PUT').length).toBe(2)
    })

    it('should recover uncommitted transaction entries for potential rollback', async () => {
      const txId = await walManager.beginTransaction()
      await walManager.append('PUT', makePayload({ sha: 'uncommitted-1' }), txId)
      await walManager.append('PUT', makePayload({ sha: 'uncommitted-2' }), txId)

      // Crash before commit - transaction is in-flight
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // All entries should be present for the recovery logic to decide
      // (TX_BEGIN + 2 PUTs, but no TX_COMMIT)
      expect(recovered.length).toBe(3)

      const ops = recovered.map(e => e.operation)
      expect(ops).toContain('TX_BEGIN')
      expect(ops).not.toContain('TX_COMMIT')
      expect(ops).not.toContain('TX_ROLLBACK')

      // Recovery logic can detect the incomplete transaction
      const txEntries = recovered.filter(e => e.transactionId === txId)
      expect(txEntries.length).toBe(3)
    })

    it('should distinguish between committed and uncommitted transactions during recovery', async () => {
      // Transaction 1: committed
      const tx1 = await walManager.beginTransaction()
      await walManager.append('PUT', makePayload({ sha: 'committed-1' }), tx1)
      await walManager.commitTransaction(tx1)

      // Transaction 2: not committed (in-flight at crash)
      const tx2 = await walManager.beginTransaction()
      await walManager.append('PUT', makePayload({ sha: 'inflight-1' }), tx2)

      // Standalone entry
      await walManager.append('PUT', makePayload({ sha: 'standalone' }))

      // Crash and recover
      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      // Separate committed vs uncommitted
      const tx1Entries = recovered.filter(e => e.transactionId === tx1)
      const tx2Entries = recovered.filter(e => e.transactionId === tx2)
      const standaloneEntries = recovered.filter(e => e.transactionId === null)

      // tx1 has TX_BEGIN, PUT, TX_COMMIT
      const tx1Ops = tx1Entries.map(e => e.operation)
      expect(tx1Ops).toContain('TX_BEGIN')
      expect(tx1Ops).toContain('TX_COMMIT')

      // tx2 has TX_BEGIN, PUT but NO TX_COMMIT
      const tx2Ops = tx2Entries.map(e => e.operation)
      expect(tx2Ops).toContain('TX_BEGIN')
      expect(tx2Ops).not.toContain('TX_COMMIT')

      // Standalone entry is also present
      expect(standaloneEntries.length).toBe(1)
      expect(standaloneEntries[0].operation).toBe('PUT')
    })
  })

  describe('recovery with pre-existing WAL state (simulated restart)', () => {
    it('should recover from injected pre-crash WAL state', async () => {
      // Directly inject entries as if they were written before a crash
      const now = Date.now()

      storage.injectWALEntry({
        id: 1,
        operation: 'PUT',
        payload: makePayload({ sha: 'pre-crash-1', type: 'blob' }),
        transactionId: null,
        createdAt: now - 1000,
        flushed: false
      })
      storage.injectWALEntry({
        id: 2,
        operation: 'PUT',
        payload: makePayload({ sha: 'pre-crash-2', type: 'tree' }),
        transactionId: null,
        createdAt: now - 500,
        flushed: false
      })
      storage.injectWALEntry({
        id: 3,
        operation: 'DELETE',
        payload: makePayload({ sha: 'pre-crash-3' }),
        transactionId: null,
        createdAt: now - 100,
        flushed: false
      })

      // Create fresh WALManager (simulates DO restart)
      const freshManager = new WALManager(storage)
      const recovered = await freshManager.recover()

      expect(recovered.length).toBe(3)
      expect(recovered[0].id).toBe(1)
      expect(recovered[1].id).toBe(2)
      expect(recovered[2].id).toBe(3)
    })

    it('should skip flushed entries from pre-crash state', async () => {
      const now = Date.now()

      storage.injectWALEntry({
        id: 1,
        operation: 'PUT',
        payload: makePayload({ sha: 'flushed-1' }),
        transactionId: null,
        createdAt: now - 1000,
        flushed: true // Already flushed
      })
      storage.injectWALEntry({
        id: 2,
        operation: 'PUT',
        payload: makePayload({ sha: 'unflushed-1' }),
        transactionId: null,
        createdAt: now - 500,
        flushed: false
      })
      storage.injectWALEntry({
        id: 3,
        operation: 'PUT',
        payload: makePayload({ sha: 'flushed-2' }),
        transactionId: null,
        createdAt: now - 100,
        flushed: true // Already flushed
      })

      const freshManager = new WALManager(storage)
      const recovered = await freshManager.recover()

      expect(recovered.length).toBe(1)
      expect(decodePayload(recovered[0].payload).sha).toBe('unflushed-1')
    })

    it('should continue appending after recovery without ID conflicts', async () => {
      // Inject pre-crash state with IDs up to 5
      for (let i = 1; i <= 5; i++) {
        storage.injectWALEntry({
          id: i,
          operation: 'PUT',
          payload: makePayload({ sha: `pre-${i}` }),
          transactionId: null,
          createdAt: Date.now(),
          flushed: false
        })
      }

      // Create fresh WALManager and recover
      const freshManager = new WALManager(storage)
      const recovered = await freshManager.recover()
      expect(recovered.length).toBe(5)

      // Append new entries after recovery
      const newId = await freshManager.append('PUT', makePayload({ sha: 'post-recovery' }))

      // New entry ID should be > 5
      expect(newId).toBeGreaterThan(5)

      // Total entries should now be 6
      const allEntries = storage.getWALEntries()
      expect(allEntries.length).toBe(6)
    })
  })

  describe('edge cases', () => {
    it('should handle recovery with binary payload data', async () => {
      const binaryPayload = new Uint8Array([0x00, 0x01, 0xFF, 0xFE, 0x80, 0x7F])
      await walManager.append('PUT', binaryPayload)

      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      expect(recovered.length).toBe(1)
      expect(recovered[0].payload).toEqual(binaryPayload)
    })

    it('should handle recovery with empty payload', async () => {
      await walManager.append('DELETE', new Uint8Array(0))

      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      expect(recovered.length).toBe(1)
      expect(recovered[0].payload.length).toBe(0)
    })

    it('should handle recovery with very large number of entries', async () => {
      const entryCount = 1000
      for (let i = 0; i < entryCount; i++) {
        await walManager.append('PUT', makePayload({ index: i }))
      }

      const recoveredManager = new WALManager(storage)
      const recovered = await recoveredManager.recover()

      expect(recovered.length).toBe(entryCount)

      // Verify ordering
      for (let i = 0; i < recovered.length - 1; i++) {
        expect(recovered[i].id).toBeLessThan(recovered[i + 1].id)
      }
    })

    it('should handle multiple sequential crash-recovery cycles', async () => {
      // Cycle 1: write, crash, recover
      await walManager.append('PUT', makePayload({ cycle: 1 }))

      let manager2 = new WALManager(storage)
      let recovered = await manager2.recover()
      expect(recovered.length).toBe(1)

      // Flush to acknowledge recovery
      await manager2.flush()

      // Cycle 2: write more, crash, recover
      await manager2.append('PUT', makePayload({ cycle: 2 }))
      await manager2.append('PUT', makePayload({ cycle: 2.5 }))

      let manager3 = new WALManager(storage)
      recovered = await manager3.recover()
      expect(recovered.length).toBe(2)

      await manager3.flush()

      // Cycle 3: write, checkpoint, write more, crash
      await manager3.append('PUT', makePayload({ cycle: 3 }))
      const cp = await manager3.createCheckpoint()
      await manager3.truncateBeforeCheckpoint(cp)

      await manager3.append('PUT', makePayload({ cycle: 3, post: true }))

      let manager4 = new WALManager(storage)
      recovered = await manager4.recover()

      // Only the post-checkpoint unflushed entry
      expect(recovered.length).toBe(1)
      expect(decodePayload(recovered[0].payload).post).toBe(true)
    })
  })
})
