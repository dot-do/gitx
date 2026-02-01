/**
 * @fileoverview Tests for atomic compare-and-swap ref updates
 *
 * Covers:
 * - GitBackendAdapter.compareAndSwapRef
 * - ParquetRefStore.compareAndSwapRef
 * - ReceivePackObjectStore.compareAndSwapRef integration via handleReceivePack
 *
 * @module test/do/compare-and-swap-ref
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GitBackendAdapter } from '../../src/do/git-backend-adapter'
import { ParquetRefStore } from '../../src/storage/parquet-ref-store'
import type { DurableObjectStorage } from '../../src/do/schema'
import type { SQLStorage } from '../../src/storage/types'
import {
  handleReceivePack,
  createReceiveSession,
  parseReceivePackRequest,
  ZERO_SHA,
  type ReceivePackObjectStore,
  type Ref,
} from '../../src/wire/receive-pack'
import type { ObjectType } from '../../src/types/objects'

// ============================================================================
// Mock SQLite Storage
// ============================================================================

/**
 * Minimal mock that supports the refs table, transactions, and schema init
 * needed by GitBackendAdapter.
 */
function createMockDOStorage(): DurableObjectStorage {
  const refs = new Map<string, string>()
  let inTransaction = false

  const storage: DurableObjectStorage = {
    sql: {
      exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
        const q = query.trim()

        // Transaction control
        if (q === 'BEGIN TRANSACTION') {
          inTransaction = true
          return { toArray: () => [] }
        }
        if (q === 'COMMIT') {
          inTransaction = false
          return { toArray: () => [] }
        }
        if (q === 'ROLLBACK') {
          inTransaction = false
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

        // WAL, objects, object_index (no-ops for ref tests)
        if (q.includes('INSERT INTO wal') || q.includes('INSERT') || q.includes('DELETE')) {
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

type MockStorage = DurableObjectStorage & {
  _refs: Map<string, string>
  _seedRef(name: string, target: string): void
}

// ============================================================================
// GitBackendAdapter.compareAndSwapRef Tests
// ============================================================================

describe('GitBackendAdapter.compareAndSwapRef', () => {
  let storage: MockStorage
  let adapter: GitBackendAdapter

  beforeEach(() => {
    storage = createMockDOStorage() as MockStorage
    adapter = new GitBackendAdapter(storage)
  })

  it('should succeed when expectedOldTarget matches current value', async () => {
    const sha1 = 'a'.repeat(40)
    const sha2 = 'b'.repeat(40)
    storage._seedRef('refs/heads/main', sha1)

    const result = await adapter.compareAndSwapRef('refs/heads/main', sha1, sha2)

    expect(result).toBe(true)
    expect(storage._refs.get('refs/heads/main')).toBe(sha2)
  })

  it('should fail when expectedOldTarget does not match current value (stale)', async () => {
    const sha1 = 'a'.repeat(40)
    const sha2 = 'b'.repeat(40)
    const sha3 = 'c'.repeat(40)
    storage._seedRef('refs/heads/main', sha3) // actual is sha3, not sha1

    const result = await adapter.compareAndSwapRef('refs/heads/main', sha1, sha2)

    expect(result).toBe(false)
    // Ref should remain unchanged
    expect(storage._refs.get('refs/heads/main')).toBe(sha3)
  })

  it('should create ref when expectedOldTarget is null and ref does not exist', async () => {
    const sha1 = 'a'.repeat(40)

    const result = await adapter.compareAndSwapRef('refs/heads/new-branch', null, sha1)

    expect(result).toBe(true)
    expect(storage._refs.get('refs/heads/new-branch')).toBe(sha1)
  })

  it('should fail create when expectedOldTarget is null but ref already exists', async () => {
    const sha1 = 'a'.repeat(40)
    const sha2 = 'b'.repeat(40)
    storage._seedRef('refs/heads/existing', sha1)

    const result = await adapter.compareAndSwapRef('refs/heads/existing', null, sha2)

    expect(result).toBe(false)
    // Ref should remain unchanged
    expect(storage._refs.get('refs/heads/existing')).toBe(sha1)
  })

  it('should treat empty string expectedOldTarget as create-only (must not exist)', async () => {
    const sha1 = 'a'.repeat(40)

    const result = await adapter.compareAndSwapRef('refs/heads/brand-new', '', sha1)

    expect(result).toBe(true)
    expect(storage._refs.get('refs/heads/brand-new')).toBe(sha1)
  })

  it('should fail when empty string expectedOldTarget but ref exists', async () => {
    const sha1 = 'a'.repeat(40)
    const sha2 = 'b'.repeat(40)
    storage._seedRef('refs/heads/existing', sha1)

    const result = await adapter.compareAndSwapRef('refs/heads/existing', '', sha2)

    expect(result).toBe(false)
  })

  it('should treat ZERO_SHA expectedOldTarget as create-only', async () => {
    const sha1 = 'a'.repeat(40)

    const result = await adapter.compareAndSwapRef('refs/heads/zero-test', ZERO_SHA, sha1)

    expect(result).toBe(true)
    expect(storage._refs.get('refs/heads/zero-test')).toBe(sha1)
  })

  it('should delete ref when newTarget is ZERO_SHA and old matches', async () => {
    const sha1 = 'a'.repeat(40)
    storage._seedRef('refs/heads/to-delete', sha1)

    const result = await adapter.compareAndSwapRef('refs/heads/to-delete', sha1, ZERO_SHA)

    expect(result).toBe(true)
    expect(storage._refs.has('refs/heads/to-delete')).toBe(false)
  })

  it('should normalize target to lowercase', async () => {
    const sha1 = 'A'.repeat(40)
    const sha2Upper = 'B'.repeat(40)

    const result = await adapter.compareAndSwapRef('refs/heads/case-test', null, sha2Upper)

    expect(result).toBe(true)
    expect(storage._refs.get('refs/heads/case-test')).toBe(sha2Upper.toLowerCase())
  })
})

// ============================================================================
// ParquetRefStore.compareAndSwapRef Tests
// ============================================================================

describe('ParquetRefStore.compareAndSwapRef', () => {
  let refs: Map<string, string>
  let store: ParquetRefStore

  beforeEach(() => {
    refs = new Map<string, string>()

    const mockSql: SQLStorage = {
      sql: {
        exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
          const q = query.trim()

          if (q === 'BEGIN TRANSACTION' || q === 'COMMIT' || q === 'ROLLBACK') {
            return { toArray: () => [] }
          }

          if (q.startsWith('CREATE TABLE')) {
            return { toArray: () => [] }
          }

          if (q.includes('SELECT') && q.includes('FROM refs') && q.includes('WHERE name')) {
            const name = params[0] as string
            const target = refs.get(name)
            return { toArray: () => target !== undefined ? [{ name, target, type: 'sha', updated_at: Date.now() }] : [] }
          }

          if (q.includes('INSERT OR REPLACE INTO refs')) {
            refs.set(params[0] as string, params[1] as string)
            return { toArray: () => [] }
          }

          if (q.includes('DELETE FROM refs')) {
            refs.delete(params[0] as string)
            return { toArray: () => [] }
          }

          if (q.includes('SELECT') && q.includes('FROM refs')) {
            const rows: { name: string; target: string; type: string }[] = []
            for (const [name, target] of refs) {
              rows.push({ name, target, type: 'sha' })
            }
            return { toArray: () => rows }
          }

          return { toArray: () => [] }
        },
      },
    }

    // Mock R2 bucket
    const mockR2 = {
      put: async () => ({}),
      get: async () => null,
      delete: async () => {},
      list: async () => ({ objects: [], truncated: false }),
    } as unknown as R2Bucket

    store = new ParquetRefStore({
      r2: mockR2,
      sql: mockSql,
      prefix: 'test-repo',
    })
    store.ensureTable()
  })

  it('should succeed when expectedOldTarget matches current value', () => {
    refs.set('refs/heads/main', 'a'.repeat(40))

    const result = store.compareAndSwapRef('refs/heads/main', 'a'.repeat(40), 'b'.repeat(40))

    expect(result).toBe(true)
    expect(refs.get('refs/heads/main')).toBe('b'.repeat(40))
  })

  it('should fail when expectedOldTarget is stale', () => {
    refs.set('refs/heads/main', 'c'.repeat(40))

    const result = store.compareAndSwapRef('refs/heads/main', 'a'.repeat(40), 'b'.repeat(40))

    expect(result).toBe(false)
    expect(refs.get('refs/heads/main')).toBe('c'.repeat(40))
  })

  it('should create ref when expectedOldTarget is null and ref missing', () => {
    const result = store.compareAndSwapRef('refs/heads/new', null, 'a'.repeat(40))

    expect(result).toBe(true)
    expect(refs.get('refs/heads/new')).toBe('a'.repeat(40))
  })

  it('should fail create when ref already exists and expectedOldTarget is null', () => {
    refs.set('refs/heads/existing', 'a'.repeat(40))

    const result = store.compareAndSwapRef('refs/heads/existing', null, 'b'.repeat(40))

    expect(result).toBe(false)
    expect(refs.get('refs/heads/existing')).toBe('a'.repeat(40))
  })

  it('should mark store as dirty after successful CAS', () => {
    const result = store.compareAndSwapRef('refs/heads/new', null, 'a'.repeat(40))

    expect(result).toBe(true)
    expect(store.isDirty()).toBe(true)
  })

  it('should not mark store as dirty after failed CAS', () => {
    refs.set('refs/heads/main', 'c'.repeat(40))

    const result = store.compareAndSwapRef('refs/heads/main', 'a'.repeat(40), 'b'.repeat(40))

    expect(result).toBe(false)
    expect(store.isDirty()).toBe(false)
  })
})

// ============================================================================
// handleReceivePack with CAS Tests
// ============================================================================

describe('handleReceivePack with compareAndSwapRef', () => {
  const SHA1_A = 'a'.repeat(40)
  const SHA1_B = 'b'.repeat(40)
  const SHA1_C = 'c'.repeat(40)

  function createCASMockStore(initialRefs: Map<string, string>): ReceivePackObjectStore {
    const refs = new Map(initialRefs)
    const casCallLog: { name: string; expected: string | null; newTarget: string }[] = []

    return {
      async getObject() { return null },
      async hasObject() { return false },
      async getCommitParents() { return [] },
      async getRefs() {
        return Array.from(refs.entries()).map(([name, sha]) => ({ name, sha }))
      },
      async getRef(name: string) {
        const sha = refs.get(name)
        return sha ? { name, sha } : null
      },
      async setRef(name: string, sha: string) {
        refs.set(name, sha)
      },
      async deleteRef(name: string) {
        refs.delete(name)
      },
      async storeObject() {},
      async isAncestor() { return true },

      // CAS implementation that simulates real behavior
      async compareAndSwapRef(name: string, expectedOldTarget: string | null, newTarget: string): Promise<boolean> {
        casCallLog.push({ name, expected: expectedOldTarget, newTarget })

        const current = refs.get(name) ?? null

        // Check expectation
        if (expectedOldTarget === null) {
          // Create only - must not exist
          if (current !== null) return false
        } else {
          if (current !== expectedOldTarget) return false
        }

        // Apply
        const zeroSha = '0'.repeat(40)
        if (!newTarget || newTarget === zeroSha) {
          refs.delete(name)
        } else {
          refs.set(name, newTarget)
        }
        return true
      },

      // Expose internals for assertions
      _refs: refs,
      _casCallLog: casCallLog,
    } as ReceivePackObjectStore & { _refs: Map<string, string>; _casCallLog: typeof casCallLog }
  }

  it('should use compareAndSwapRef for successful update', async () => {
    const store = createCASMockStore(new Map([['refs/heads/main', SHA1_A]]))
    const session = createReceiveSession('test-repo')
    session.capabilities = { reportStatus: true, deleteRefs: true }

    // Build a receive-pack request: update refs/heads/main from SHA1_A to SHA1_B
    const encoder = new TextEncoder()
    const requestStr = `${SHA1_A} ${SHA1_B} refs/heads/main\x00report-status\n0000`
    const request = encoder.encode(requestStr)

    const response = await handleReceivePack(session, request, store)
    const responseStr = new TextDecoder().decode(response)

    expect(responseStr).toContain('unpack ok')
    expect(responseStr).toContain('ok refs/heads/main')

    // Verify CAS was called
    const casLog = (store as any)._casCallLog
    expect(casLog.length).toBe(1)
    expect(casLog[0].name).toBe('refs/heads/main')
    expect(casLog[0].expected).toBe(SHA1_A)
    expect(casLog[0].newTarget).toBe(SHA1_B)
  })

  it('should report failure when CAS detects concurrent update', async () => {
    // Simulate: store says ref is at SHA1_C, but client thinks it's at SHA1_A
    const store = createCASMockStore(new Map([['refs/heads/main', SHA1_C]]))
    const session = createReceiveSession('test-repo')
    session.capabilities = { reportStatus: true, deleteRefs: true }

    const encoder = new TextEncoder()
    const requestStr = `${SHA1_A} ${SHA1_B} refs/heads/main\x00report-status\n0000`
    const request = encoder.encode(requestStr)

    const response = await handleReceivePack(session, request, store)
    const responseStr = new TextDecoder().decode(response)

    expect(responseStr).toContain('unpack ok')
    // The validation step catches this before CAS is even called
    expect(responseStr).toContain('ng refs/heads/main')
    expect(responseStr).toContain('lock failed')
  })

  it('should use CAS for create operations with null expected', async () => {
    const store = createCASMockStore(new Map())
    const session = createReceiveSession('test-repo')
    session.capabilities = { reportStatus: true, deleteRefs: true }

    const encoder = new TextEncoder()
    const requestStr = `${ZERO_SHA} ${SHA1_A} refs/heads/new-branch\x00report-status\n0000`
    const request = encoder.encode(requestStr)

    const response = await handleReceivePack(session, request, store)
    const responseStr = new TextDecoder().decode(response)

    expect(responseStr).toContain('unpack ok')
    expect(responseStr).toContain('ok refs/heads/new-branch')

    // CAS was called with null expected (create-only)
    const casLog = (store as any)._casCallLog
    expect(casLog.length).toBe(1)
    expect(casLog[0].expected).toBe(null)
    expect(casLog[0].newTarget).toBe(SHA1_A)
  })

  it('should fall back to non-CAS path when compareAndSwapRef is absent', async () => {
    // Create a store without compareAndSwapRef
    const refs = new Map([['refs/heads/main', SHA1_A]])
    const storeWithoutCAS: ReceivePackObjectStore = {
      async getObject() { return null },
      async hasObject() { return false },
      async getCommitParents() { return [] },
      async getRefs() { return Array.from(refs.entries()).map(([name, sha]) => ({ name, sha })) },
      async getRef(name: string) { const sha = refs.get(name); return sha ? { name, sha } : null },
      async setRef(name: string, sha: string) { refs.set(name, sha) },
      async deleteRef(name: string) { refs.delete(name) },
      async storeObject() {},
      async isAncestor() { return true },
    }

    const session = createReceiveSession('test-repo')
    session.capabilities = { reportStatus: true }

    const encoder = new TextEncoder()
    const requestStr = `${SHA1_A} ${SHA1_B} refs/heads/main\x00report-status\n0000`
    const request = encoder.encode(requestStr)

    const response = await handleReceivePack(session, request, storeWithoutCAS)
    const responseStr = new TextDecoder().decode(response)

    expect(responseStr).toContain('unpack ok')
    expect(responseStr).toContain('ok refs/heads/main')
    expect(refs.get('refs/heads/main')).toBe(SHA1_B)
  })
})
