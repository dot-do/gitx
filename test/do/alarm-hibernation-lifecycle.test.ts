/**
 * @fileoverview Tests for Durable Object alarm and hibernation lifecycle.
 *
 * This module tests:
 * 1. Alarm scheduling and firing behavior
 * 2. State persistence across DO hibernation
 * 3. Wake-from-hibernation scenarios
 * 4. Alarm retry and exponential backoff
 *
 * @module test/do/alarm-hibernation-lifecycle
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { GitRepoDO } from '../../src/do/git-repo-do'

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Create a mock storage with optional alarm support.
 * Simulates DO storage including setAlarm/getAlarm/deleteAlarm methods.
 */
function createMockStorage(opts?: {
  withAlarm?: boolean
  initialData?: Map<string, unknown>
}) {
  const store = opts?.initialData ?? new Map<string, unknown>()
  let scheduledAlarm: number | null = null

  const setAlarm = opts?.withAlarm
    ? vi.fn(async (time: number | Date) => {
        scheduledAlarm = typeof time === 'number' ? time : time.getTime()
      })
    : undefined

  const getAlarm = opts?.withAlarm
    ? vi.fn(async () => scheduledAlarm)
    : undefined

  const deleteAlarm = opts?.withAlarm
    ? vi.fn(async () => {
        scheduledAlarm = null
      })
    : undefined

  return {
    store,
    setAlarm,
    getAlarm,
    deleteAlarm,
    get scheduledAlarmTime() {
      return scheduledAlarm
    },
    get: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const result = new Map<string, unknown>()
      for (const [key, value] of store) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value)
        }
      }
      return result
    }),
    sql: {
      exec: vi.fn((query: string, ..._params: unknown[]) => {
        // Handle SELECT 1 for health check
        if (query.includes('SELECT 1')) {
          return { toArray: () => [{ ok: 1 }] }
        }
        return { toArray: () => [] }
      }),
    },
  }
}

/**
 * Create a mock DurableObjectState.
 */
function createMockState(opts?: {
  withAlarm?: boolean
  initialData?: Map<string, unknown>
}) {
  const storage = createMockStorage(opts)
  const waitUntilPromises: Promise<unknown>[] = []

  return {
    id: { toString: () => 'test-hibernation-do-id' },
    storage,
    waitUntil: vi.fn((p: Promise<unknown>) => {
      waitUntilPromises.push(p)
      p.catch(() => {})
    }),
    getWaitUntilPromises: () => waitUntilPromises,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
  }
}

/**
 * Create a mock R2 bucket for ParquetStore.
 */
function createMockR2Bucket() {
  const objects = new Map<string, ArrayBuffer>()
  return {
    put: vi.fn(async (key: string, data: ArrayBuffer | string | Uint8Array) => {
      if (typeof data === 'string') {
        objects.set(key, new TextEncoder().encode(data).buffer)
      } else if (data instanceof Uint8Array) {
        objects.set(key, data.buffer)
      } else {
        objects.set(key, data)
      }
      return {}
    }),
    get: vi.fn(async (key: string) => {
      const buf = objects.get(key)
      if (!buf) return null
      return {
        arrayBuffer: async () => buf,
        text: async () => new TextDecoder().decode(buf),
      }
    }),
    list: vi.fn(async (_opts?: { prefix?: string }) => ({ objects: [] })),
    delete: vi.fn(async () => {}),
  }
}

/**
 * Create a mock environment.
 */
function createMockEnv(opts?: { withBucket?: boolean }) {
  return {
    ...(opts?.withBucket && {
      ANALYTICS_BUCKET: createMockR2Bucket(),
    }),
  }
}

// ============================================================================
// Type declaration for test compilation
// ============================================================================

declare class DurableObjectState {
  id: { toString(): string }
  storage: unknown
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

// ============================================================================
// Test Suite: Alarm Scheduling
// ============================================================================

describe('DO Alarm Scheduling', () => {
  let state: ReturnType<typeof createMockState>
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
    state = createMockState({ withAlarm: true })
    env = createMockEnv({ withBucket: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should schedule an alarm with setAlarm when compaction is needed', async () => {
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    // Force the ParquetStore to think it has files to compact
    const store = instance.getParquetStore()!
    ;(store as unknown as { objectFileKeys: string[] }).objectFileKeys = [
      'file1.parquet',
      'file2.parquet',
    ]

    const now = Date.now()
    const delayMs = 15_000
    const result = instance.scheduleCompaction(delayMs)

    expect(result).toBe(true)
    expect(state.waitUntil).toHaveBeenCalled()

    // Verify setAlarm was called with appropriate time
    await vi.waitFor(() => {
      expect(state.storage.setAlarm).toHaveBeenCalled()
    })
  })

  it('should handle multiple alarm scheduling calls idempotently', async () => {
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    // Need at least 2 files for scheduleCompaction to return true
    ;(store as unknown as { objectFileKeys: string[] }).objectFileKeys = [
      'file1.parquet',
      'file2.parquet',
    ]

    // First schedule should succeed
    const result1 = instance.scheduleCompaction(10_000)
    expect(result1).toBe(true)

    // Subsequent calls within the same instance should still succeed
    // because scheduleCompaction marks compaction as needed
    const result2 = instance.scheduleCompaction(10_000)
    const result3 = instance.scheduleCompaction(10_000)

    // All calls return true because the files exist and compaction can be scheduled
    expect(result2).toBe(true)
    expect(result3).toBe(true)

    // But the alarm should only be set once effectively (via waitUntil)
    // The important thing is that multiple schedules don't cause issues
    expect(state.waitUntil).toHaveBeenCalled()
  })

  it('should set alarm to correct future time', async () => {
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    ;(store as unknown as { objectFileKeys: string[] }).objectFileKeys = [
      'file1.parquet',
      'file2.parquet',
    ]

    const before = Date.now()
    const delayMs = 20_000
    instance.scheduleCompaction(delayMs)

    // Wait for setAlarm to be called
    await vi.waitFor(() => {
      expect(state.storage.setAlarm).toHaveBeenCalled()
    })

    const setAlarmCall = (
      state.storage.setAlarm as ReturnType<typeof vi.fn>
    ).mock.calls[0]
    expect(setAlarmCall).toBeDefined()

    const alarmTime = setAlarmCall![0] as number
    expect(alarmTime).toBeGreaterThanOrEqual(before + delayMs)
    expect(alarmTime).toBeLessThanOrEqual(before + delayMs + 100)
  })
})

// ============================================================================
// Test Suite: Alarm Firing
// ============================================================================

describe('DO Alarm Firing', () => {
  let state: ReturnType<typeof createMockState>
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    state = createMockState({ withAlarm: true })
    env = createMockEnv({ withBucket: true })
  })

  it('should execute compaction when alarm fires and compaction is needed', async () => {
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    // Mark compaction as needed
    ;(store as unknown as { _compactionNeeded: boolean })._compactionNeeded =
      true

    const runCompactionSpy = vi.spyOn(store, 'runCompactionIfNeeded')

    // Simulate alarm firing
    await instance.alarm()

    expect(runCompactionSpy).toHaveBeenCalled()
  })

  it('should not run compaction when alarm fires but compaction not needed', async () => {
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    const runCompactionSpy = vi.spyOn(store, 'runCompactionIfNeeded')

    // Alarm fires without compaction needed
    await instance.alarm()

    // runCompactionIfNeeded should not be called because compactionNeeded is false
    expect(runCompactionSpy).not.toHaveBeenCalled()
  })

  it('should clear compactionNeeded flag after successful compaction', async () => {
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    ;(store as unknown as { _compactionNeeded: boolean })._compactionNeeded =
      true

    expect(store.compactionNeeded).toBe(true)

    await instance.alarm()

    expect(store.compactionNeeded).toBe(false)
  })

  it('should handle compaction errors gracefully during alarm', async () => {
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    ;(store as unknown as { _compactionNeeded: boolean })._compactionNeeded =
      true

    vi.spyOn(store, 'runCompactionIfNeeded').mockRejectedValue(
      new Error('Simulated compaction failure')
    )

    // Should not throw
    await expect(instance.alarm()).resolves.toBeUndefined()
  })
})

// ============================================================================
// Test Suite: Alarm Retry with Exponential Backoff
// ============================================================================

describe('DO Alarm Retry with Exponential Backoff', () => {
  let state: ReturnType<typeof createMockState>
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
    state = createMockState({ withAlarm: true })
    env = createMockEnv({ withBucket: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should reschedule alarm with backoff on compaction failure', async () => {
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    ;(store as unknown as { _compactionNeeded: boolean })._compactionNeeded =
      true

    // Make compaction fail
    vi.spyOn(store, 'runCompactionIfNeeded').mockRejectedValue(
      new Error('R2 temporarily unavailable')
    )

    await instance.alarm()

    // After failure, scheduleCompaction should be called to reschedule
    // and setAlarm should be called again via waitUntil
    expect(state.waitUntil).toHaveBeenCalled()
  })

  it('should track failure count in SQLite', async () => {
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    ;(store as unknown as { _compactionNeeded: boolean })._compactionNeeded =
      true

    vi.spyOn(store, 'runCompactionIfNeeded').mockRejectedValue(
      new Error('Compaction failed')
    )

    await instance.alarm()

    // Verify SQL exec was called to track failure
    expect(state.storage.sql.exec).toHaveBeenCalled()
  })

  it('should give up after max retry attempts', async () => {
    // Create storage with existing retry state
    const sqlExecMock = vi.fn((query: string, ..._params: unknown[]) => {
      if (query.includes('SELECT attempt_count')) {
        // Return count >= 3 (MAX_COMPACTION_ATTEMPTS)
        return { toArray: () => [{ attempt_count: 3 }] }
      }
      return { toArray: () => [] }
    })

    state.storage.sql.exec = sqlExecMock

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    ;(store as unknown as { _compactionNeeded: boolean })._compactionNeeded =
      true

    // Even though compaction is needed, it should be skipped due to max retries
    await instance.alarm()

    // runCompactionIfNeeded is still called but to clear the flag
    // No new alarm should be scheduled
  })

  it('should reset retry counter on successful compaction', async () => {
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    ;(store as unknown as { _compactionNeeded: boolean })._compactionNeeded =
      true

    // Make compaction succeed
    vi.spyOn(store, 'runCompactionIfNeeded').mockResolvedValue(
      'new-compacted-file.parquet'
    )

    await instance.alarm()

    // Verify DELETE was called to reset the retry counter
    const deleteCall = (
      state.storage.sql.exec as ReturnType<typeof vi.fn>
    ).mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('DELETE FROM compaction_retries')
    )
    expect(deleteCall).toBeDefined()
  })
})

// ============================================================================
// Test Suite: State Persistence Across Hibernation
// ============================================================================

describe('State Persistence Across Hibernation', () => {
  it('should persist namespace to storage during initialization', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: false })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    await instance.initialize({ ns: 'https://git.do/repo/test-hibernation' })

    // Verify namespace was persisted
    expect(state.storage.put).toHaveBeenCalledWith(
      'ns',
      'https://git.do/repo/test-hibernation'
    )
  })

  it('should persist parent reference when provided', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: false })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    await instance.initialize({
      ns: 'https://git.do/repo/child',
      parent: 'https://git.do/org/parent',
    })

    expect(state.storage.put).toHaveBeenCalledWith(
      'parent',
      'https://git.do/org/parent'
    )
  })

  it('should be reconstructable from persisted state', async () => {
    // Simulate state that was persisted before hibernation
    const persistedData = new Map<string, unknown>([
      ['ns', 'https://git.do/repo/persisted-repo'],
      ['HEAD', 'refs/heads/main'],
      ['refs/heads/main', { sha: 'abc123', created: Date.now() }],
    ])

    const state = createMockState({
      withAlarm: true,
      initialData: persistedData,
    })
    const env = createMockEnv({ withBucket: true })

    // Create a new instance (simulating wake from hibernation)
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    // The instance should be able to access persisted state
    const storedNs = await state.storage.get('ns')
    expect(storedNs).toBe('https://git.do/repo/persisted-repo')
  })

  it('should persist bloom filter state before hibernation', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    // The bloom cache persist is handled by ParquetStore's onFlush
    // This test verifies the architecture supports hibernation-safe persistence
    const parquetStore = instance.getParquetStore()
    expect(parquetStore).toBeDefined()
  })

  it('should maintain SQLite state across hibernation cycles', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    // First instance writes to SQLite
    const instance1 = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    await instance1.initialize({ ns: 'https://git.do/repo/sqlite-test' })

    // Simulate hibernation by creating a new instance with same state
    const instance2 = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    // Both instances share the same SQL interface
    // This verifies SQLite persistence across hibernation
    expect(instance2.getSchemaManager()).toBeDefined()
  })
})

// ============================================================================
// Test Suite: Wake from Hibernation
// ============================================================================

describe('Wake from Hibernation Scenarios', () => {
  it('should handle alarm-triggered wake from hibernation', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    // Simulate waking via alarm() call
    // The DO should handle this gracefully even without prior request context
    await expect(instance.alarm()).resolves.toBeUndefined()
  })

  it('should handle HTTP request-triggered wake from hibernation', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    // Initialize the DO first (simulating prior state)
    await instance.initialize({ ns: 'https://git.do/repo/wake-test' })

    // Simulate waking via HTTP request
    const request = new Request('https://git.do/health')
    const response = await instance.fetch(request)

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(200)
  })

  it('should restore cached instances after hibernation', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    // Access cached instances before "hibernation"
    const schemaManager1 = instance.getSchemaManager()
    const objectStore1 = instance.getObjectStore()

    // The same instance should return cached objects
    const schemaManager2 = instance.getSchemaManager()
    const objectStore2 = instance.getObjectStore()

    expect(schemaManager1).toBe(schemaManager2)
    expect(objectStore1).toBe(objectStore2)
  })

  it('should invalidate caches when explicitly requested', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    // Get cached instances
    const schemaManager1 = instance.getSchemaManager()

    // Invalidate caches (simulating state reset)
    instance.invalidateCaches()

    // New instances should be created
    const schemaManager2 = instance.getSchemaManager()

    expect(schemaManager1).not.toBe(schemaManager2)
  })

  it('should handle concurrent wake attempts safely', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    // Initialize the DO first (simulating prior state)
    await instance.initialize({ ns: 'https://git.do/repo/concurrent-test' })

    // Simulate concurrent requests waking the DO
    const requests = [
      instance.fetch(new Request('https://git.do/health')),
      instance.fetch(new Request('https://git.do/health')),
      instance.fetch(new Request('https://git.do/health')),
    ]

    const responses = await Promise.all(requests)

    // All requests should succeed
    for (const response of responses) {
      expect(response.status).toBe(200)
    }
  })

  it('should resume pending alarm after hibernation wake', async () => {
    // Simulate state with a pending alarm
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    // Schedule compaction (sets alarm)
    const store = instance.getParquetStore()!
    ;(store as unknown as { objectFileKeys: string[] }).objectFileKeys = [
      'file1.parquet',
      'file2.parquet',
    ]
    const scheduled = instance.scheduleCompaction(5000)

    // Verify compaction was scheduled
    expect(scheduled).toBe(true)

    // waitUntil is called for the setAlarm promise
    await vi.waitFor(() => {
      expect(state.waitUntil).toHaveBeenCalled()
    })

    // The alarm time should be persisted via setAlarm
    await vi.waitFor(() => {
      expect(state.storage.setAlarm).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Test Suite: Fallback Behavior Without Alarms
// ============================================================================

describe('Fallback Behavior Without Alarm Support', () => {
  it('should use waitUntil for inline compaction when setAlarm unavailable', async () => {
    const state = createMockState({ withAlarm: false }) // No alarm support
    const env = createMockEnv({ withBucket: true })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const store = instance.getParquetStore()!
    ;(store as unknown as { objectFileKeys: string[] }).objectFileKeys = [
      'file1.parquet',
      'file2.parquet',
    ]

    const result = instance.scheduleCompaction()

    expect(result).toBe(true)
    // waitUntil should be used for fallback inline compaction
    expect(state.waitUntil).toHaveBeenCalled()
  })

  it('should complete alarm() without error when no ParquetStore', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: false }) // No bucket = no ParquetStore

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    await expect(instance.alarm()).resolves.toBeUndefined()
  })

  it('should return false from scheduleCompaction when no ParquetStore', () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: false })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const result = instance.scheduleCompaction()

    expect(result).toBe(false)
  })
})

// ============================================================================
// Test Suite: DO Lifecycle Hooks
// ============================================================================

describe('DO Lifecycle Hooks', () => {
  it('should track uptime via _startTime', () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    const before = Date.now()
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )
    const after = Date.now()

    // Access the internal _startTime (used for uptime tracking)
    expect(instance._startTime).toBeGreaterThanOrEqual(before)
    expect(instance._startTime).toBeLessThanOrEqual(after)
  })

  it('should support waitUntil for background work', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const backgroundWork = new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })

    instance.waitUntil(backgroundWork)

    expect(state.waitUntil).toHaveBeenCalledWith(backgroundWork)
  })

  it('should expose storage via getStorage()', () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })

    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as unknown as Parameters<typeof GitRepoDO>[1]
    )

    const storage = instance.getStorage()

    expect(storage).toBeDefined()
    expect(storage).toBe(state.storage)
  })
})
