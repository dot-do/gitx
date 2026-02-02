/**
 * @fileoverview Tests for alarm-based Parquet compaction scheduling.
 *
 * Verifies that:
 * 1. ParquetStore.scheduleCompaction() marks compaction as needed
 * 2. ParquetStore.runCompactionIfNeeded() runs and clears the flag
 * 3. GitRepoDO.scheduleCompaction() sets a DO alarm
 * 4. GitRepoDO.alarm() triggers compaction when flagged
 * 5. Fallback to inline compaction when alarms are not available
 *
 * @module test/do/alarm-compaction
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GitRepoDO } from '../../src/do/git-repo-do'

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockStorage(opts?: { withAlarm?: boolean }) {
  const store = new Map<string, unknown>()
  const setAlarm = opts?.withAlarm ? vi.fn(async (_time: number | Date) => {}) : undefined
  const getAlarm = opts?.withAlarm ? vi.fn(async () => null) : undefined

  return {
    store,
    setAlarm,
    getAlarm,
    get: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
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
      exec: (_query: string, ..._params: unknown[]) => ({ toArray: () => [] }),
    },
  }
}

function createMockState(opts?: { withAlarm?: boolean }) {
  const storage = createMockStorage(opts)
  return {
    id: { toString: () => 'test-alarm-do-id' },
    storage,
    waitUntil: vi.fn((p: Promise<unknown>) => { p.catch(() => {}) }),
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
  }
}

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

function createMockEnv(opts?: { withBucket?: boolean }) {
  return {
    ...(opts?.withBucket && {
      ANALYTICS_BUCKET: createMockR2Bucket(),
    }),
  }
}

// ============================================================================
// Test Suite: ParquetStore scheduleCompaction
// ============================================================================

describe('ParquetStore alarm-based compaction', () => {
  // We test through the DO since ParquetStore is constructed internally
  // based on the ANALYTICS_BUCKET env binding.

  it('ParquetStore.scheduleCompaction returns false when no files exist', () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )
    const store = instance.getParquetStore()
    expect(store).toBeDefined()
    // No files have been flushed, so scheduleCompaction should return false
    expect(store!.scheduleCompaction()).toBe(false)
    expect(store!.compactionNeeded).toBe(false)
  })

  it('ParquetStore.compactionNeeded starts as false', () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )
    const store = instance.getParquetStore()
    expect(store!.compactionNeeded).toBe(false)
  })

  it('ParquetStore.runCompactionIfNeeded returns null when not needed', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )
    const store = instance.getParquetStore()
    const result = await store!.runCompactionIfNeeded()
    expect(result).toBeNull()
  })
})

// ============================================================================
// Test Suite: GitRepoDO.scheduleCompaction
// ============================================================================

describe('GitRepoDO.scheduleCompaction', () => {
  it('returns false when no ParquetStore is configured', () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: false }) // no bucket = no ParquetStore
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )
    expect(instance.scheduleCompaction()).toBe(false)
  })

  it('returns false when ParquetStore has nothing to compact', () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )
    expect(instance.scheduleCompaction()).toBe(false)
  })

  it('sets a DO alarm when compaction is needed and setAlarm is available', () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )

    // Manually mark compaction as needed by modifying internal state
    const store = instance.getParquetStore()!
    // Force the store to think it has files to compact
    ;(store as any).objectFileKeys = ['file1.parquet', 'file2.parquet']

    const result = instance.scheduleCompaction(5000)
    expect(result).toBe(true)

    // setAlarm should have been called via waitUntil
    expect(state.storage.setAlarm).toBeDefined()
    expect(state.waitUntil).toHaveBeenCalled()
  })

  it('falls back to inline compaction via waitUntil when setAlarm is not available', () => {
    const state = createMockState({ withAlarm: false }) // no setAlarm
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )

    const store = instance.getParquetStore()!
    ;(store as any).objectFileKeys = ['file1.parquet', 'file2.parquet']

    const result = instance.scheduleCompaction()
    expect(result).toBe(true)

    // waitUntil should have been called for fallback inline compaction
    expect(state.waitUntil).toHaveBeenCalled()
  })

  it('uses the specified delay when setting alarm', () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )

    const store = instance.getParquetStore()!
    ;(store as any).objectFileKeys = ['file1.parquet', 'file2.parquet']

    const before = Date.now()
    instance.scheduleCompaction(30_000)

    // The alarm should be set via waitUntil, verify setAlarm was called
    // with a time roughly 30s in the future
    expect(state.storage.setAlarm).toHaveBeenCalled()
    const call = (state.storage.setAlarm! as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call).toBeDefined()
    const alarmTime = call![0] as number
    expect(alarmTime).toBeGreaterThanOrEqual(before + 30_000)
    expect(alarmTime).toBeLessThanOrEqual(before + 30_100)
  })
})

// ============================================================================
// Test Suite: GitRepoDO.alarm() compaction integration
// ============================================================================

describe('GitRepoDO.alarm() compaction integration', () => {
  it('alarm() completes without error when no compaction needed', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )

    await expect(instance.alarm()).resolves.toBeUndefined()
  })

  it('alarm() calls runCompactionIfNeeded when compactionNeeded is true', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )

    const store = instance.getParquetStore()!
    // Manually set compaction needed
    ;(store as any)._compactionNeeded = true

    // Spy on runCompactionIfNeeded
    const spy = vi.spyOn(store, 'runCompactionIfNeeded')

    await instance.alarm()

    expect(spy).toHaveBeenCalled()
    // After alarm, compactionNeeded should be cleared
    expect(store.compactionNeeded).toBe(false)
  })

  it('alarm() handles compaction errors gracefully', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )

    const store = instance.getParquetStore()!
    ;(store as any)._compactionNeeded = true

    // Make runCompactionIfNeeded throw
    vi.spyOn(store, 'runCompactionIfNeeded').mockRejectedValue(new Error('R2 unavailable'))

    // alarm() should not throw, it catches errors
    await expect(instance.alarm()).resolves.toBeUndefined()
  })

  it('alarm() skips compaction when no ParquetStore configured', async () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: false })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )

    // Should complete without errors
    await expect(instance.alarm()).resolves.toBeUndefined()
  })
})

// ============================================================================
// Test Suite: GitRepoDOInstance interface (routes compatibility)
// ============================================================================

describe('GitRepoDOInstance.scheduleCompaction route compatibility', () => {
  it('instance exposes scheduleCompaction method', () => {
    const state = createMockState({ withAlarm: true })
    const env = createMockEnv({ withBucket: true })
    const instance = new GitRepoDO(
      state as unknown as DurableObjectState,
      env as any,
    )

    expect(typeof instance.scheduleCompaction).toBe('function')
  })
})

// ============================================================================
// Type declarations for test compilation
// ============================================================================

declare class DurableObjectState {
  id: { toString(): string }
  storage: unknown
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}
