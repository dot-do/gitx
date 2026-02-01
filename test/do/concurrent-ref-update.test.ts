/**
 * @fileoverview Tests for concurrent ref update conflict detection
 *
 * Validates that compareAndSwapRef provides correct serialization
 * guarantees within the single-threaded Durable Object model.
 * Uses Promise.all to simulate concurrent operations that interleave
 * on the microtask queue.
 *
 * @module test/do/concurrent-ref-update
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GitBackendAdapter } from '../../src/do/git-backend-adapter'
import type { DurableObjectStorage } from '../../src/do/schema'

// ============================================================================
// Helpers
// ============================================================================

const sha = (char: string) => char.repeat(40)

const SHA_A = sha('a')
const SHA_B = sha('b')
const SHA_C = sha('c')
const SHA_D = sha('d')
const SHA_E = sha('e')
const ZERO_SHA = sha('0')

/**
 * Minimal mock that supports the refs table, transactions, and schema init
 * needed by GitBackendAdapter. Mirrors the mock in compare-and-swap-ref.test.ts.
 */
function createMockDOStorage(): DurableObjectStorage & {
  _refs: Map<string, string>
  _seedRef(name: string, target: string): void
} {
  const refs = new Map<string, string>()

  const storage: DurableObjectStorage = {
    sql: {
      exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
        const q = query.trim()

        // Transaction control
        if (q === 'BEGIN TRANSACTION' || q === 'COMMIT' || q === 'ROLLBACK') {
          return { toArray: () => [] }
        }

        // Schema creation (silently succeed)
        if (q.startsWith('CREATE TABLE') || q.startsWith('CREATE INDEX') || q.startsWith('PRAGMA')) {
          return { toArray: () => [] }
        }

        // Schema version
        if (q.includes('schema_version')) {
          return { toArray: () => [{ version: 5 }] }
        }

        // SELECT target FROM refs WHERE name = ?
        if (q.includes('SELECT') && q.includes('FROM refs') && q.includes('WHERE name')) {
          const name = params[0] as string
          const target = refs.get(name)
          return { toArray: () => target !== undefined ? [{ target, name, type: 'sha' }] : [] }
        }

        // SELECT name, target FROM refs (list all)
        if (q.includes('SELECT') && q.includes('FROM refs') && !q.includes('WHERE')) {
          const rows: { name: string; target: string }[] = []
          for (const [name, target] of refs) {
            rows.push({ name, target })
          }
          return { toArray: () => rows }
        }

        // INSERT OR REPLACE INTO refs
        if (q.includes('INSERT OR REPLACE INTO refs')) {
          const name = params[0] as string
          const target = params[1] as string
          refs.set(name, target)
          return { toArray: () => [] }
        }

        // DELETE FROM refs WHERE name = ?
        if (q.includes('DELETE FROM refs') && q.includes('WHERE name')) {
          const name = params[0] as string
          refs.delete(name)
          return { toArray: () => [] }
        }

        return { toArray: () => [] }
      },
    },
  }

  return Object.assign(storage, {
    _refs: refs,
    _seedRef(name: string, target: string) {
      refs.set(name, target)
    },
  })
}

// ============================================================================
// Concurrent Ref Update Tests
// ============================================================================

describe('Concurrent ref update conflicts', () => {
  let storage: ReturnType<typeof createMockDOStorage>
  let adapter: GitBackendAdapter

  beforeEach(() => {
    storage = createMockDOStorage()
    adapter = new GitBackendAdapter(storage)
  })

  // --------------------------------------------------------------------------
  // Two concurrent CAS updates to the same ref
  // --------------------------------------------------------------------------

  it('two concurrent CAS updates to the same ref — exactly one succeeds', async () => {
    storage._seedRef('refs/heads/main', SHA_A)

    // Both callers read SHA_A as the current value, then race to update
    const [result1, result2] = await Promise.all([
      adapter.compareAndSwapRef('refs/heads/main', SHA_A, SHA_B),
      adapter.compareAndSwapRef('refs/heads/main', SHA_A, SHA_C),
    ])

    // Exactly one should succeed, one should fail
    expect([result1, result2]).toContain(true)
    expect([result1, result2]).toContain(false)
    const successes = [result1, result2].filter(Boolean).length
    expect(successes).toBe(1)

    // The ref should point to whichever update won
    const finalValue = storage._refs.get('refs/heads/main')
    if (result1) {
      expect(finalValue).toBe(SHA_B)
    } else {
      expect(finalValue).toBe(SHA_C)
    }
  })

  // --------------------------------------------------------------------------
  // Rapid sequential updates — each builds on the previous value
  // --------------------------------------------------------------------------

  it('rapid sequential updates — each builds on the previous value', async () => {
    storage._seedRef('refs/heads/main', SHA_A)

    const shas = [SHA_A, SHA_B, SHA_C, SHA_D, SHA_E]
    const results: boolean[] = []

    // Each update uses the previous SHA as the expected old target
    for (let i = 0; i < shas.length - 1; i++) {
      const result = await adapter.compareAndSwapRef(
        'refs/heads/main',
        shas[i]!,
        shas[i + 1]!,
      )
      results.push(result)
    }

    // Every update should succeed because each one builds on the last
    expect(results).toEqual([true, true, true, true])
    expect(storage._refs.get('refs/heads/main')).toBe(SHA_E)
  })

  // --------------------------------------------------------------------------
  // Create + update race — one tries to create, another tries to update from old value
  // --------------------------------------------------------------------------

  it('create + update race — one creates, another updates from stale value', async () => {
    // Ref does not exist yet
    const [createResult, updateResult] = await Promise.all([
      adapter.compareAndSwapRef('refs/heads/feature', null, SHA_A),
      adapter.compareAndSwapRef('refs/heads/feature', SHA_B, SHA_C),
    ])

    // The create should succeed (ref did not exist)
    // The update should fail (ref was not at SHA_B — it either did not exist or was just created)
    expect(createResult).toBe(true)
    expect(updateResult).toBe(false)
    expect(storage._refs.get('refs/heads/feature')).toBe(SHA_A)
  })

  it('two concurrent creates — exactly one succeeds', async () => {
    // Ref does not exist yet; both try to create it
    const [result1, result2] = await Promise.all([
      adapter.compareAndSwapRef('refs/heads/feature', null, SHA_A),
      adapter.compareAndSwapRef('refs/heads/feature', null, SHA_B),
    ])

    // Exactly one should succeed
    expect([result1, result2]).toContain(true)
    expect([result1, result2]).toContain(false)
    const successes = [result1, result2].filter(Boolean).length
    expect(successes).toBe(1)

    const finalValue = storage._refs.get('refs/heads/feature')
    if (result1) {
      expect(finalValue).toBe(SHA_A)
    } else {
      expect(finalValue).toBe(SHA_B)
    }
  })

  // --------------------------------------------------------------------------
  // Delete + update race — one deletes, another tries to update
  // --------------------------------------------------------------------------

  it('delete + update race — one deletes, another tries to update', async () => {
    storage._seedRef('refs/heads/doomed', SHA_A)

    const [deleteResult, updateResult] = await Promise.all([
      adapter.compareAndSwapRef('refs/heads/doomed', SHA_A, ZERO_SHA),
      adapter.compareAndSwapRef('refs/heads/doomed', SHA_A, SHA_B),
    ])

    // Exactly one should succeed
    expect([deleteResult, updateResult]).toContain(true)
    expect([deleteResult, updateResult]).toContain(false)
    const successes = [deleteResult, updateResult].filter(Boolean).length
    expect(successes).toBe(1)

    if (deleteResult) {
      // Delete won — ref should be gone
      expect(storage._refs.has('refs/heads/doomed')).toBe(false)
    } else {
      // Update won — ref should point to SHA_B
      expect(storage._refs.get('refs/heads/doomed')).toBe(SHA_B)
    }
  })

  it('update after delete fails — ref no longer exists', async () => {
    storage._seedRef('refs/heads/doomed', SHA_A)

    // Delete first, then try to update
    const deleteResult = await adapter.compareAndSwapRef('refs/heads/doomed', SHA_A, ZERO_SHA)
    expect(deleteResult).toBe(true)
    expect(storage._refs.has('refs/heads/doomed')).toBe(false)

    // Now try to update from SHA_A — should fail because ref is gone
    const updateResult = await adapter.compareAndSwapRef('refs/heads/doomed', SHA_A, SHA_B)
    expect(updateResult).toBe(false)
    expect(storage._refs.has('refs/heads/doomed')).toBe(false)
  })

  // --------------------------------------------------------------------------
  // Multiple refs updated concurrently — independent refs should all succeed
  // --------------------------------------------------------------------------

  it('multiple independent refs updated concurrently — all succeed', async () => {
    storage._seedRef('refs/heads/alpha', SHA_A)
    storage._seedRef('refs/heads/beta', SHA_A)
    storage._seedRef('refs/heads/gamma', SHA_A)

    const results = await Promise.all([
      adapter.compareAndSwapRef('refs/heads/alpha', SHA_A, SHA_B),
      adapter.compareAndSwapRef('refs/heads/beta', SHA_A, SHA_C),
      adapter.compareAndSwapRef('refs/heads/gamma', SHA_A, SHA_D),
    ])

    // All should succeed since they target different refs
    expect(results).toEqual([true, true, true])
    expect(storage._refs.get('refs/heads/alpha')).toBe(SHA_B)
    expect(storage._refs.get('refs/heads/beta')).toBe(SHA_C)
    expect(storage._refs.get('refs/heads/gamma')).toBe(SHA_D)
  })

  it('mix of independent and conflicting concurrent updates', async () => {
    storage._seedRef('refs/heads/shared', SHA_A)
    storage._seedRef('refs/heads/independent', SHA_A)

    const results = await Promise.all([
      adapter.compareAndSwapRef('refs/heads/shared', SHA_A, SHA_B),
      adapter.compareAndSwapRef('refs/heads/shared', SHA_A, SHA_C),
      adapter.compareAndSwapRef('refs/heads/independent', SHA_A, SHA_D),
    ])

    // The independent ref should always succeed
    expect(results[2]).toBe(true)
    expect(storage._refs.get('refs/heads/independent')).toBe(SHA_D)

    // Exactly one of the shared ref updates should succeed
    const sharedResults = [results[0], results[1]]
    expect(sharedResults).toContain(true)
    expect(sharedResults).toContain(false)
  })

  // --------------------------------------------------------------------------
  // Verify ref history is linear (no lost updates)
  // --------------------------------------------------------------------------

  it('verify ref history is linear — no lost updates under sequential CAS', async () => {
    // Simulate a series of updates where each one must see the result of the previous
    storage._seedRef('refs/heads/main', SHA_A)

    const history: string[] = [SHA_A]
    const updateChain = [SHA_B, SHA_C, SHA_D, SHA_E]

    for (const nextSha of updateChain) {
      const currentSha = history[history.length - 1]!
      const result = await adapter.compareAndSwapRef('refs/heads/main', currentSha, nextSha)
      expect(result).toBe(true)
      history.push(nextSha)
    }

    // History should be a complete linear chain with no gaps
    expect(history).toEqual([SHA_A, SHA_B, SHA_C, SHA_D, SHA_E])
    expect(storage._refs.get('refs/heads/main')).toBe(SHA_E)
  })

  it('lost update detection — stale CAS after intervening write fails', async () => {
    storage._seedRef('refs/heads/main', SHA_A)

    // First writer succeeds: A -> B
    const result1 = await adapter.compareAndSwapRef('refs/heads/main', SHA_A, SHA_B)
    expect(result1).toBe(true)

    // Second writer is stale (still thinks ref is at A): A -> C should fail
    const result2 = await adapter.compareAndSwapRef('refs/heads/main', SHA_A, SHA_C)
    expect(result2).toBe(false)

    // Ref should be at B, not C — no lost update
    expect(storage._refs.get('refs/heads/main')).toBe(SHA_B)

    // Second writer retries with correct base: B -> C should succeed
    const result3 = await adapter.compareAndSwapRef('refs/heads/main', SHA_B, SHA_C)
    expect(result3).toBe(true)
    expect(storage._refs.get('refs/heads/main')).toBe(SHA_C)
  })

  it('many concurrent updates to same ref — exactly one wins', async () => {
    storage._seedRef('refs/heads/main', SHA_A)

    // Generate 10 unique target SHAs
    const targets = Array.from({ length: 10 }, (_, i) =>
      (i + 1).toString(16).padStart(1, '0').repeat(40).slice(0, 40)
    )

    const results = await Promise.all(
      targets.map((target) =>
        adapter.compareAndSwapRef('refs/heads/main', SHA_A, target)
      )
    )

    // Exactly one should succeed
    const successes = results.filter(Boolean).length
    expect(successes).toBe(1)

    // The ref should point to the winner's target
    const winnerIndex = results.indexOf(true)
    expect(storage._refs.get('refs/heads/main')).toBe(targets[winnerIndex])
  })
})
