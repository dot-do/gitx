/**
 * @fileoverview Tests for concurrent push conflict resolution
 *
 * These tests validate that GitX properly handles concurrent push operations
 * to the same ref, ensuring:
 * 1. Two concurrent pushes to the same ref - exactly one succeeds
 * 2. Atomic compare-and-swap behavior prevents lost updates
 * 3. Proper rejection with meaningful conflict error messages
 *
 * @module test/wire/concurrent-push-conflict
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  handleReceivePack,
  createReceiveSession,
  ZERO_SHA,
  type ReceivePackObjectStore,
  type Ref,
  type ReceivePackSession,
} from '../../src/wire/receive-pack'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Generate a valid SHA-1 hash from a single character */
const sha = (char: string) => char.repeat(40)

// Sample SHAs for testing
const SHA_A = sha('a')
const SHA_B = sha('b')
const SHA_C = sha('c')
const SHA_D = sha('d')

/**
 * Create a mock object store that supports compareAndSwapRef for testing
 * concurrent push scenarios.
 */
function createConcurrentMockStore(options?: {
  initialRefs?: Map<string, string>
  existingObjects?: Set<string>
}): ReceivePackObjectStore & {
  _refs: Map<string, string>
  _casCallLog: Array<{ name: string; expected: string | null; newTarget: string; result: boolean }>
  _seedRef: (name: string, target: string) => void
} {
  const refs = new Map<string, string>(options?.initialRefs ?? [])
  const existingObjects = new Set<string>(options?.existingObjects ?? [SHA_A, SHA_B, SHA_C, SHA_D])
  const casCallLog: Array<{ name: string; expected: string | null; newTarget: string; result: boolean }> = []

  const store: ReceivePackObjectStore = {
    async getObject(sha: string) {
      if (existingObjects.has(sha)) {
        return { type: 'commit', data: new Uint8Array([]) }
      }
      return null
    },

    async hasObject(sha: string) {
      return existingObjects.has(sha)
    },

    async getCommitParents() {
      return []
    },

    async getRefs() {
      return Array.from(refs.entries()).map(([name, sha]) => ({ name, sha }))
    },

    async getRef(name: string): Promise<Ref | null> {
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

    async isAncestor() {
      return true
    },

    /**
     * Atomic compare-and-swap implementation that properly handles concurrent access.
     * This simulates the behavior of SQLite's transaction-based CAS.
     */
    async compareAndSwapRef(
      name: string,
      expectedOldTarget: string | null,
      newTarget: string
    ): Promise<boolean> {
      const current = refs.get(name) ?? null

      // Check if current matches expected
      let matches: boolean
      if (expectedOldTarget === null || expectedOldTarget === '' || expectedOldTarget === ZERO_SHA) {
        // Create-only: ref must not exist
        matches = current === null
      } else {
        // Update: ref must exist and match expected value
        matches = current === expectedOldTarget
      }

      // Log the call for test assertions
      casCallLog.push({ name, expected: expectedOldTarget, newTarget, result: matches })

      if (!matches) {
        return false
      }

      // Apply the update
      if (newTarget === ZERO_SHA || newTarget === '') {
        refs.delete(name)
      } else {
        refs.set(name, newTarget.toLowerCase())
      }

      return true
    },
  }

  return Object.assign(store, {
    _refs: refs,
    _casCallLog: casCallLog,
    _seedRef(name: string, target: string) {
      refs.set(name, target)
    },
  })
}

/**
 * Build a receive-pack request for a single ref update.
 */
function buildPushRequest(
  oldSha: string,
  newSha: string,
  refName: string,
  capabilities: string[] = ['report-status']
): Uint8Array {
  const capsStr = capabilities.join(' ')
  const request = `${oldSha} ${newSha} ${refName}\x00${capsStr}\n0000`
  return encoder.encode(request)
}

/**
 * Parse the response to extract unpack status and ref results.
 */
function parseResponse(response: Uint8Array): {
  unpackStatus: string
  refResults: Array<{ refName: string; success: boolean; error?: string }>
} {
  const text = decoder.decode(response)
  const lines = text.split('\n')

  let unpackStatus = 'unknown'
  const refResults: Array<{ refName: string; success: boolean; error?: string }> = []

  for (const line of lines) {
    // Strip pkt-line length prefix if present
    const content = line.replace(/^[0-9a-f]{4}/, '').trim()

    if (content.startsWith('unpack ')) {
      unpackStatus = content.slice(7)
    } else if (content.startsWith('ok ')) {
      refResults.push({ refName: content.slice(3), success: true })
    } else if (content.startsWith('ng ')) {
      const parts = content.slice(3).split(' ')
      const refName = parts[0] ?? ''
      const error = parts.slice(1).join(' ')
      refResults.push({ refName, success: false, error })
    }
  }

  return { unpackStatus, refResults }
}

// ============================================================================
// Concurrent Push Conflict Resolution Tests
// ============================================================================

describe('Concurrent Push Conflict Resolution', () => {
  describe('Two concurrent pushes to the same ref', () => {
    it('exactly one succeeds when both try to create the same ref', async () => {
      const store = createConcurrentMockStore()

      // Two sessions try to create the same ref from ZERO_SHA
      const session1 = createReceiveSession('repo1')
      const session2 = createReceiveSession('repo2')

      const request1 = buildPushRequest(ZERO_SHA, SHA_A, 'refs/heads/feature')
      const request2 = buildPushRequest(ZERO_SHA, SHA_B, 'refs/heads/feature')

      // Execute both pushes concurrently
      const [response1, response2] = await Promise.all([
        handleReceivePack(session1, request1, store),
        handleReceivePack(session2, request2, store),
      ])

      const result1 = parseResponse(response1)
      const result2 = parseResponse(response2)

      // Exactly one should succeed
      const successes = [result1, result2].filter(
        (r) => r.refResults[0]?.success === true
      ).length
      expect(successes).toBe(1)

      // The ref should have exactly one value (whichever won)
      const finalValue = store._refs.get('refs/heads/feature')
      expect([SHA_A, SHA_B]).toContain(finalValue)

      // Verify CAS was called for both attempts
      expect(store._casCallLog.length).toBeGreaterThanOrEqual(2)
    })

    it('exactly one succeeds when both try to update the same ref from same base', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/main', SHA_A]]),
      })

      const session1 = createReceiveSession('repo1')
      const session2 = createReceiveSession('repo2')

      // Both think the ref is at SHA_A, both try to update to different values
      const request1 = buildPushRequest(SHA_A, SHA_B, 'refs/heads/main')
      const request2 = buildPushRequest(SHA_A, SHA_C, 'refs/heads/main')

      const [response1, response2] = await Promise.all([
        handleReceivePack(session1, request1, store),
        handleReceivePack(session2, request2, store),
      ])

      const result1 = parseResponse(response1)
      const result2 = parseResponse(response2)

      // Exactly one should succeed
      const successes = [result1, result2].filter(
        (r) => r.refResults[0]?.success === true
      ).length
      expect(successes).toBe(1)

      // Verify the ref has exactly one final value
      const finalValue = store._refs.get('refs/heads/main')
      expect(finalValue).toBeDefined()
      expect([SHA_B, SHA_C]).toContain(finalValue)
    })

    it('second push fails when first push updates ref between read and write', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/main', SHA_A]]),
      })

      // First push succeeds: A -> B
      const session1 = createReceiveSession('repo1')
      const request1 = buildPushRequest(SHA_A, SHA_B, 'refs/heads/main')
      const response1 = await handleReceivePack(session1, request1, store)
      const result1 = parseResponse(response1)

      expect(result1.refResults[0]?.success).toBe(true)
      expect(store._refs.get('refs/heads/main')).toBe(SHA_B)

      // Second push tries to update from stale value: A -> C (should fail)
      const session2 = createReceiveSession('repo2')
      const request2 = buildPushRequest(SHA_A, SHA_C, 'refs/heads/main')
      const response2 = await handleReceivePack(session2, request2, store)
      const result2 = parseResponse(response2)

      expect(result2.refResults[0]?.success).toBe(false)
      expect(result2.refResults[0]?.error).toContain('lock')

      // Ref should still be at SHA_B (first push's value)
      expect(store._refs.get('refs/heads/main')).toBe(SHA_B)
    })

    it('handles delete vs update race - one wins', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/feature', SHA_A]]),
      })

      const session1 = createReceiveSession('repo1')
      const session2 = createReceiveSession('repo2')

      // Session 1 tries to delete, Session 2 tries to update
      const request1 = buildPushRequest(SHA_A, ZERO_SHA, 'refs/heads/feature', [
        'report-status',
        'delete-refs',
      ])
      const request2 = buildPushRequest(SHA_A, SHA_B, 'refs/heads/feature')

      const [response1, response2] = await Promise.all([
        handleReceivePack(session1, request1, store),
        handleReceivePack(session2, request2, store),
      ])

      const result1 = parseResponse(response1)
      const result2 = parseResponse(response2)

      // Exactly one should succeed
      const successes = [result1, result2].filter(
        (r) => r.refResults[0]?.success === true
      ).length
      expect(successes).toBe(1)

      // If delete won, ref should not exist; if update won, ref should be SHA_B
      const finalValue = store._refs.get('refs/heads/feature')
      if (result1.refResults[0]?.success) {
        expect(finalValue).toBeUndefined()
      } else {
        expect(finalValue).toBe(SHA_B)
      }
    })
  })

  describe('Atomic compare-and-swap behavior', () => {
    it('uses compareAndSwapRef when available on store', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/main', SHA_A]]),
      })

      const session = createReceiveSession('repo')
      const request = buildPushRequest(SHA_A, SHA_B, 'refs/heads/main')

      await handleReceivePack(session, request, store)

      // Verify CAS was called
      expect(store._casCallLog.length).toBe(1)
      expect(store._casCallLog[0]).toEqual({
        name: 'refs/heads/main',
        expected: SHA_A,
        newTarget: SHA_B,
        result: true,
      })
    })

    it('CAS passes null for create operations (oldSha is ZERO_SHA)', async () => {
      const store = createConcurrentMockStore()

      const session = createReceiveSession('repo')
      const request = buildPushRequest(ZERO_SHA, SHA_A, 'refs/heads/new-branch')

      await handleReceivePack(session, request, store)

      // Verify CAS was called with null for expected (create-only semantics)
      expect(store._casCallLog.length).toBe(1)
      expect(store._casCallLog[0]?.expected).toBeNull()
    })

    it('CAS prevents ABA problem - detects intervening update', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/main', SHA_A]]),
      })

      // First update: A -> B
      const session1 = createReceiveSession('repo1')
      const request1 = buildPushRequest(SHA_A, SHA_B, 'refs/heads/main')
      await handleReceivePack(session1, request1, store)
      expect(store._refs.get('refs/heads/main')).toBe(SHA_B)

      // Second update: B -> A (reverting back)
      const session2 = createReceiveSession('repo2')
      const request2 = buildPushRequest(SHA_B, SHA_A, 'refs/heads/main')
      await handleReceivePack(session2, request2, store)
      expect(store._refs.get('refs/heads/main')).toBe(SHA_A)

      // Third update with stale value: tries B -> C (should fail - ref is now A)
      const session3 = createReceiveSession('repo3')
      const request3 = buildPushRequest(SHA_B, SHA_C, 'refs/heads/main')
      const response3 = await handleReceivePack(session3, request3, store)
      const result3 = parseResponse(response3)

      expect(result3.refResults[0]?.success).toBe(false)
      expect(store._refs.get('refs/heads/main')).toBe(SHA_A) // Unchanged
    })

    it('successful sequential updates each build on previous value', async () => {
      const store = createConcurrentMockStore()

      const shas = [ZERO_SHA, SHA_A, SHA_B, SHA_C, SHA_D]
      const results: boolean[] = []

      for (let i = 0; i < shas.length - 1; i++) {
        const session = createReceiveSession(`repo-${i}`)
        const request = buildPushRequest(shas[i]!, shas[i + 1]!, 'refs/heads/main')
        const response = await handleReceivePack(session, request, store)
        const result = parseResponse(response)
        results.push(result.refResults[0]?.success ?? false)
      }

      // All updates should succeed because each builds on the last
      expect(results).toEqual([true, true, true, true])
      expect(store._refs.get('refs/heads/main')).toBe(SHA_D)
    })
  })

  describe('Proper rejection with conflict errors', () => {
    it('returns meaningful error when ref has been updated concurrently', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/main', SHA_B]]), // Current is B, not A
      })

      const session = createReceiveSession('repo')
      const request = buildPushRequest(SHA_A, SHA_C, 'refs/heads/main') // Expects A

      const response = await handleReceivePack(session, request, store)
      const result = parseResponse(response)

      expect(result.refResults[0]?.success).toBe(false)
      expect(result.refResults[0]?.error).toBeDefined()
      // Error should indicate lock/update failure
      expect(result.refResults[0]?.error).toMatch(/lock|update|concurrent/)
    })

    it('returns meaningful error when trying to create existing ref', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/existing', SHA_A]]),
      })

      const session = createReceiveSession('repo')
      const request = buildPushRequest(ZERO_SHA, SHA_B, 'refs/heads/existing')

      const response = await handleReceivePack(session, request, store)
      const result = parseResponse(response)

      expect(result.refResults[0]?.success).toBe(false)
      expect(result.refResults[0]?.error).toBeDefined()
    })

    it('returns ng status line in report-status format', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/main', SHA_B]]),
      })

      const session = createReceiveSession('repo')
      session.capabilities = { reportStatus: true }
      const request = buildPushRequest(SHA_A, SHA_C, 'refs/heads/main')

      const response = await handleReceivePack(session, request, store)
      const text = decoder.decode(response)

      // Should contain ng line with ref name and error
      expect(text).toContain('ng refs/heads/main')
    })

    it('unpack status is ok even when ref update fails due to conflict', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/main', SHA_B]]),
      })

      const session = createReceiveSession('repo')
      const request = buildPushRequest(SHA_A, SHA_C, 'refs/heads/main')

      const response = await handleReceivePack(session, request, store)
      const result = parseResponse(response)

      // Unpack should be ok - the conflict is at ref update level, not unpack
      expect(result.unpackStatus).toBe('ok')
      expect(result.refResults[0]?.success).toBe(false)
    })
  })

  describe('Multiple refs in single push', () => {
    it('independent refs all succeed in concurrent push', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([
          ['refs/heads/alpha', SHA_A],
          ['refs/heads/beta', SHA_A],
          ['refs/heads/gamma', SHA_A],
        ]),
      })

      const session1 = createReceiveSession('repo1')
      const session2 = createReceiveSession('repo2')

      // Session 1 updates alpha, Session 2 updates beta
      const request1 = buildPushRequest(SHA_A, SHA_B, 'refs/heads/alpha')
      const request2 = buildPushRequest(SHA_A, SHA_C, 'refs/heads/beta')

      const [response1, response2] = await Promise.all([
        handleReceivePack(session1, request1, store),
        handleReceivePack(session2, request2, store),
      ])

      const result1 = parseResponse(response1)
      const result2 = parseResponse(response2)

      // Both should succeed since they update different refs
      expect(result1.refResults[0]?.success).toBe(true)
      expect(result2.refResults[0]?.success).toBe(true)
      expect(store._refs.get('refs/heads/alpha')).toBe(SHA_B)
      expect(store._refs.get('refs/heads/beta')).toBe(SHA_C)
      expect(store._refs.get('refs/heads/gamma')).toBe(SHA_A) // Unchanged
    })
  })

  describe('Retry after conflict', () => {
    it('second attempt succeeds after fetching updated ref value', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/main', SHA_A]]),
      })

      // First push succeeds: A -> B
      const session1 = createReceiveSession('repo1')
      const request1 = buildPushRequest(SHA_A, SHA_B, 'refs/heads/main')
      const response1 = await handleReceivePack(session1, request1, store)
      expect(parseResponse(response1).refResults[0]?.success).toBe(true)

      // Second push fails with stale base: A -> C
      const session2 = createReceiveSession('repo2')
      const request2 = buildPushRequest(SHA_A, SHA_C, 'refs/heads/main')
      const response2 = await handleReceivePack(session2, request2, store)
      expect(parseResponse(response2).refResults[0]?.success).toBe(false)

      // After fetching, client retries with correct base: B -> C
      const session3 = createReceiveSession('repo3')
      const request3 = buildPushRequest(SHA_B, SHA_C, 'refs/heads/main')
      const response3 = await handleReceivePack(session3, request3, store)
      expect(parseResponse(response3).refResults[0]?.success).toBe(true)

      expect(store._refs.get('refs/heads/main')).toBe(SHA_C)
    })
  })

  describe('High contention scenarios', () => {
    it('many concurrent updates to same ref - exactly one wins', async () => {
      const store = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/main', SHA_A]]),
      })

      // Generate 10 unique target SHAs
      const targets = Array.from({ length: 10 }, (_, i) =>
        (i + 1).toString(16).padStart(1, '0').repeat(40).slice(0, 40)
      )

      // Make sure all target SHAs are considered existing objects
      for (const target of targets) {
        store._refs // just accessing for side effect - objects are mocked
      }

      // Create store with all targets as existing objects
      const storeWithTargets = createConcurrentMockStore({
        initialRefs: new Map([['refs/heads/main', SHA_A]]),
        existingObjects: new Set([SHA_A, SHA_B, SHA_C, SHA_D, ...targets]),
      })

      const requests = targets.map((target, i) => {
        const session = createReceiveSession(`repo-${i}`)
        const request = buildPushRequest(SHA_A, target, 'refs/heads/main')
        return handleReceivePack(session, request, storeWithTargets)
      })

      const responses = await Promise.all(requests)
      const results = responses.map((r) => parseResponse(r))

      // Exactly one should succeed
      const successes = results.filter((r) => r.refResults[0]?.success === true).length
      expect(successes).toBe(1)

      // The ref should point to the winner's target
      const finalValue = storeWithTargets._refs.get('refs/heads/main')
      expect(targets).toContain(finalValue)
    })
  })
})
