/**
 * @fileoverview Tests for Background Tier Migration with DO Alarms
 *
 * Tests the TierMigrationScheduler class which provides background tier
 * migration using Durable Object alarms.
 *
 * @module test/tiered/background-migration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  TierMigrationScheduler,
  createMigrationScheduler,
  DEFAULT_MIGRATION_CONFIG,
  type MigrationCandidate,
  type MigrationResult,
  type BackgroundMigrationConfig,
  type MigrationDOStorage,
  type TieredStorageBackend,
} from '../../src/tiered/background-migration'
import type { StorageTier } from '../../src/storage/object-index'

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockSqlStorage() {
  const tables = new Map<string, Map<number, Record<string, unknown>>>()
  let autoIncrement = 1

  return {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      // Parse simple SQL queries for testing
      const queryLower = query.toLowerCase().trim()

      if (queryLower.startsWith('create table')) {
        // Extract table name
        const match = query.match(/create\s+table\s+if\s+not\s+exists\s+(\w+)/i)
        if (match) {
          tables.set(match[1], new Map())
        }
        return { toArray: () => [] }
      }

      if (queryLower.startsWith('create index')) {
        return { toArray: () => [] }
      }

      if (queryLower.startsWith('insert')) {
        const match = query.match(/insert\s+(?:or\s+replace\s+)?into\s+(\w+)/i)
        if (match) {
          const tableName = match[1]
          const table = tables.get(tableName) ?? new Map()
          const id = autoIncrement++
          const row: Record<string, unknown> = { id }

          // Parse column values from params
          if (tableName === 'tier_migration_state') {
            // INSERT INTO tier_migration_state (id, updated_at) VALUES (1, ?)
            row.id = 1
            row.consecutive_failures = 0
            row.last_migration_at = null
            row.next_migration_at = null
            row.total_migrated = 0
            row.total_bytes_migrated = 0
            row.paused = 0
            row.pause_reason = null
            row.updated_at = params[0] ?? Date.now()
            // Use id 1 for state table
            table.set(1, row)
          } else if (tableName === 'tier_migration_history') {
            row.sha = params[0]
            row.from_tier = params[1]
            row.to_tier = params[2]
            row.success = params[3]
            row.error = params[4]
            row.size = params[5]
            row.created_at = params[6]
            table.set(id, row)
          }

          tables.set(tableName, table)
        }
        return { toArray: () => [] }
      }

      if (queryLower.startsWith('update')) {
        const match = query.match(/update\s+(\w+)\s+set/i)
        if (match) {
          const tableName = match[1]
          const table = tables.get(tableName)
          if (table && table.size > 0) {
            const row = table.get(1)
            if (row) {
              // Parse the SET clause to understand which fields to update
              // UPDATE tier_migration_state SET next_migration_at = ?, updated_at = ? WHERE id = 1
              if (query.includes('next_migration_at = ?') && query.includes('updated_at = ?') && params.length === 2) {
                row.next_migration_at = params[0]
                row.updated_at = params[1]
              }
              // UPDATE tier_migration_state SET consecutive_failures = ?, updated_at = ? WHERE id = 1
              else if (query.includes('consecutive_failures = ?') && !query.includes('paused')) {
                row.consecutive_failures = params[0]
                row.updated_at = params[1]
              }
              // UPDATE tier_migration_state SET consecutive_failures = ?, paused = 1, pause_reason = ?, updated_at = ? WHERE id = 1
              // (This must come BEFORE the simpler 'paused = 1' check below)
              else if (query.includes('consecutive_failures = ?') && query.includes('paused = 1')) {
                row.consecutive_failures = params[0]
                row.paused = 1
                row.pause_reason = params[1]
                row.updated_at = params[2]
              }
              // UPDATE tier_migration_state SET paused = 1, pause_reason = ?, updated_at = ? WHERE id = 1
              else if (query.includes('paused = 1')) {
                row.paused = 1
                row.pause_reason = params[0]
                row.updated_at = params[1]
              }
              // UPDATE tier_migration_state SET paused = 0, pause_reason = NULL, consecutive_failures = 0, updated_at = ? WHERE id = 1
              else if (query.includes('paused = 0')) {
                row.paused = 0
                row.pause_reason = null
                row.consecutive_failures = 0
                row.updated_at = params[0]
              }
              // UPDATE tier_migration_state SET consecutive_failures = 0, last_migration_at = ?, total_migrated = total_migrated + ?, total_bytes_migrated = total_bytes_migrated + ?, updated_at = ? WHERE id = 1
              else if (query.includes('last_migration_at = ?') && query.includes('total_migrated = total_migrated +')) {
                row.consecutive_failures = 0
                row.last_migration_at = params[0]
                row.total_migrated = (row.total_migrated as number) + (params[1] as number)
                row.total_bytes_migrated = (row.total_bytes_migrated as number) + (params[2] as number)
                row.updated_at = params[3]
              }
            }
          }
        }
        return { toArray: () => [] }
      }

      if (queryLower.startsWith('select')) {
        const match = query.match(/from\s+(\w+)/i)
        if (match) {
          const tableName = match[1]
          const table = tables.get(tableName)
          if (table) {
            return { toArray: () => Array.from(table.values()) }
          }
        }
        return { toArray: () => [] }
      }

      return { toArray: () => [] }
    }),
    // Expose tables for testing
    _tables: tables,
  }
}

function createMockDOStorage(opts?: { withAlarm?: boolean }): MigrationDOStorage {
  const sql = createMockSqlStorage()
  const setAlarm = opts?.withAlarm ? vi.fn(async (_time: number | Date) => {}) : undefined
  const getAlarm = opts?.withAlarm ? vi.fn(async () => null) : undefined
  const deleteAlarm = opts?.withAlarm ? vi.fn(async () => {}) : undefined

  return {
    sql,
    setAlarm,
    getAlarm,
    deleteAlarm,
  }
}

function createMockTieredStorage(opts?: {
  hotObjects?: MigrationCandidate[]
  warmObjects?: MigrationCandidate[]
  hotBytes?: number
}): TieredStorageBackend {
  const hotObjects = opts?.hotObjects ?? []
  const warmObjects = opts?.warmObjects ?? []
  const hotBytes = opts?.hotBytes ?? hotObjects.reduce((sum, o) => sum + o.size, 0)

  return {
    getObjectsByTier: vi.fn(async (tier: StorageTier) => {
      if (tier === 'hot') return hotObjects
      if (tier === 'r2') return warmObjects
      return []
    }),
    getTierBytes: vi.fn(async (tier: StorageTier) => {
      if (tier === 'hot') return hotBytes
      return 0
    }),
    migrateObject: vi.fn(async (sha: string, _fromTier: StorageTier, toTier: StorageTier): Promise<MigrationResult> => {
      return {
        sha,
        success: true,
        fromTier: _fromTier,
        toTier,
      }
    }),
    recordAccess: vi.fn(async () => {}),
  }
}

// Sample SHA-1 hashes for testing
const sampleSha = 'a'.repeat(40)
const sampleSha2 = 'b'.repeat(40)
const sampleSha3 = 'c'.repeat(40)

// ============================================================================
// Test Suite: TierMigrationScheduler Initialization
// ============================================================================

describe('TierMigrationScheduler', () => {
  let storage: MigrationDOStorage
  let tieredStorage: TieredStorageBackend
  let scheduler: TierMigrationScheduler

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    storage = createMockDOStorage({ withAlarm: true })
    tieredStorage = createMockTieredStorage()
    scheduler = new TierMigrationScheduler(storage, tieredStorage)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Initialization', () => {
    it('should create tables on initialize', async () => {
      await scheduler.initialize()

      // Check that CREATE TABLE was called
      expect(storage.sql.exec).toHaveBeenCalled()
      const calls = (storage.sql.exec as ReturnType<typeof vi.fn>).mock.calls
      const createCalls = calls.filter((c: string[]) => c[0].toLowerCase().includes('create table'))
      expect(createCalls.length).toBeGreaterThanOrEqual(2)
    })

    it('should initialize with default config', async () => {
      const config = scheduler.getConfig()

      expect(config.hotToWarmAgeMs).toBe(DEFAULT_MIGRATION_CONFIG.hotToWarmAgeMs)
      expect(config.warmToColdAgeMs).toBe(DEFAULT_MIGRATION_CONFIG.warmToColdAgeMs)
      expect(config.batchSize).toBe(DEFAULT_MIGRATION_CONFIG.batchSize)
    })

    it('should merge custom config with defaults', () => {
      const customScheduler = new TierMigrationScheduler(storage, tieredStorage, {
        batchSize: 100,
        hotToWarmAgeMs: 1000,
      })

      const config = customScheduler.getConfig()
      expect(config.batchSize).toBe(100)
      expect(config.hotToWarmAgeMs).toBe(1000)
      expect(config.warmToColdAgeMs).toBe(DEFAULT_MIGRATION_CONFIG.warmToColdAgeMs)
    })
  })

  describe('Scheduling', () => {
    it('should schedule migration via DO alarm', async () => {
      const result = await scheduler.scheduleBackgroundMigration()

      expect(result).toBe(true)
      expect(storage.setAlarm).toHaveBeenCalled()
    })

    it('should not schedule if already scheduled', async () => {
      await scheduler.scheduleBackgroundMigration()
      const result = await scheduler.scheduleBackgroundMigration()

      expect(result).toBe(false)
    })

    it('should force reschedule when force=true', async () => {
      await scheduler.scheduleBackgroundMigration()
      const result = await scheduler.scheduleBackgroundMigration(undefined, true)

      expect(result).toBe(true)
      expect(storage.setAlarm).toHaveBeenCalledTimes(2)
    })

    it('should use custom delay when provided', async () => {
      const customDelay = 5000
      await scheduler.scheduleBackgroundMigration(customDelay)

      expect(storage.setAlarm).toHaveBeenCalledWith(Date.now() + customDelay)
    })

    it('should not schedule when paused', async () => {
      await scheduler.pauseMigration('Test pause')
      const result = await scheduler.scheduleBackgroundMigration()

      expect(result).toBe(false)
    })

    it('should return false when setAlarm is not available', async () => {
      const storageWithoutAlarm = createMockDOStorage({ withAlarm: false })
      const schedulerNoAlarm = new TierMigrationScheduler(storageWithoutAlarm, tieredStorage)

      const result = await schedulerNoAlarm.scheduleBackgroundMigration()

      expect(result).toBe(false)
    })
  })

  describe('Migration Cycle', () => {
    it('should migrate hot objects to warm based on age', async () => {
      const now = Date.now()
      const oldObject: MigrationCandidate = {
        sha: sampleSha,
        type: 'blob',
        size: 1024,
        tier: 'hot',
        accessCount: 1, // Low access
        lastAccessedAt: now - 48 * 60 * 60 * 1000, // 48 hours ago
        createdAt: now - 72 * 60 * 60 * 1000,
      }

      tieredStorage = createMockTieredStorage({ hotObjects: [oldObject] })
      scheduler = new TierMigrationScheduler(storage, tieredStorage)

      const result = await scheduler.runMigrationCycle()

      expect(result.migrated).toBe(1)
      expect(result.hotToWarm).toBe(1)
      expect(result.bytesMigrated).toBe(1024)
      expect(tieredStorage.migrateObject).toHaveBeenCalledWith(sampleSha, 'hot', 'r2')
    })

    it('should not migrate recently accessed hot objects', async () => {
      const now = Date.now()
      const recentObject: MigrationCandidate = {
        sha: sampleSha,
        type: 'blob',
        size: 1024,
        tier: 'hot',
        accessCount: 10, // High access
        lastAccessedAt: now - 1000, // 1 second ago
        createdAt: now - 1000,
      }

      tieredStorage = createMockTieredStorage({ hotObjects: [recentObject] })
      scheduler = new TierMigrationScheduler(storage, tieredStorage)

      const result = await scheduler.runMigrationCycle()

      expect(result.migrated).toBe(0)
      expect(tieredStorage.migrateObject).not.toHaveBeenCalled()
    })

    it('should migrate warm objects to cold based on age', async () => {
      const now = Date.now()
      const oldWarmObject: MigrationCandidate = {
        sha: sampleSha,
        type: 'blob',
        size: 2048,
        tier: 'r2',
        accessCount: 5,
        lastAccessedAt: now - 14 * 24 * 60 * 60 * 1000, // 14 days ago
        createdAt: now - 14 * 24 * 60 * 60 * 1000,
      }

      tieredStorage = createMockTieredStorage({ warmObjects: [oldWarmObject] })
      scheduler = new TierMigrationScheduler(storage, tieredStorage)

      const result = await scheduler.runMigrationCycle()

      expect(result.migrated).toBe(1)
      expect(result.warmToCold).toBe(1)
      expect(tieredStorage.migrateObject).toHaveBeenCalledWith(sampleSha, 'r2', 'parquet')
    })

    it('should respect batch size limit', async () => {
      const now = Date.now()
      const objects: MigrationCandidate[] = Array.from({ length: 100 }, (_, i) => ({
        sha: `${'a'.repeat(39)}${i.toString(16).padStart(1, '0')}`,
        type: 'blob',
        size: 100,
        tier: 'hot' as StorageTier,
        accessCount: 1,
        lastAccessedAt: now - 48 * 60 * 60 * 1000,
        createdAt: now - 72 * 60 * 60 * 1000,
      }))

      tieredStorage = createMockTieredStorage({ hotObjects: objects })
      scheduler = new TierMigrationScheduler(storage, tieredStorage, { batchSize: 10 })

      const result = await scheduler.runMigrationCycle()

      expect(result.migrated).toBe(10)
      expect(result.moreToMigrate).toBe(true)
    })

    it('should prioritize oldest objects for migration', async () => {
      const now = Date.now()
      const objects: MigrationCandidate[] = [
        {
          sha: sampleSha,
          type: 'blob',
          size: 100,
          tier: 'hot',
          accessCount: 1,
          lastAccessedAt: now - 72 * 60 * 60 * 1000, // Oldest
          createdAt: now - 96 * 60 * 60 * 1000,
        },
        {
          sha: sampleSha2,
          type: 'blob',
          size: 100,
          tier: 'hot',
          accessCount: 1,
          lastAccessedAt: now - 48 * 60 * 60 * 1000, // Middle
          createdAt: now - 72 * 60 * 60 * 1000,
        },
        {
          sha: sampleSha3,
          type: 'blob',
          size: 100,
          tier: 'hot',
          accessCount: 1,
          lastAccessedAt: now - 36 * 60 * 60 * 1000, // Newest (but still old enough)
          createdAt: now - 48 * 60 * 60 * 1000,
        },
      ]

      tieredStorage = createMockTieredStorage({ hotObjects: objects })
      scheduler = new TierMigrationScheduler(storage, tieredStorage, { batchSize: 1 })

      const result = await scheduler.runMigrationCycle()

      // Should migrate the oldest first
      expect(tieredStorage.migrateObject).toHaveBeenCalledWith(sampleSha, 'hot', 'r2')
    })

    it('should migrate when hot tier exceeds size limit', async () => {
      const now = Date.now()
      const recentObject: MigrationCandidate = {
        sha: sampleSha,
        type: 'blob',
        size: 30 * 1024 * 1024, // 30MB
        tier: 'hot',
        accessCount: 10, // High access
        lastAccessedAt: now - 1000, // Recent
        createdAt: now - 1000,
      }

      tieredStorage = createMockTieredStorage({
        hotObjects: [recentObject],
        hotBytes: 60 * 1024 * 1024, // 60MB (over 50MB limit)
      })
      scheduler = new TierMigrationScheduler(storage, tieredStorage)

      const result = await scheduler.runMigrationCycle()

      // Should migrate even though recently accessed (due to size limit)
      expect(result.migrated).toBe(1)
    })

    it('should handle migration failures gracefully', async () => {
      const now = Date.now()
      const object: MigrationCandidate = {
        sha: sampleSha,
        type: 'blob',
        size: 1024,
        tier: 'hot',
        accessCount: 1,
        lastAccessedAt: now - 48 * 60 * 60 * 1000,
        createdAt: now - 72 * 60 * 60 * 1000,
      }

      tieredStorage = createMockTieredStorage({ hotObjects: [object] })
      vi.mocked(tieredStorage.migrateObject).mockResolvedValue({
        sha: sampleSha,
        success: false,
        fromTier: 'hot',
        toTier: 'r2',
        error: 'Storage unavailable',
      })

      scheduler = new TierMigrationScheduler(storage, tieredStorage)

      const result = await scheduler.runMigrationCycle()

      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].error).toBe('Storage unavailable')
    })

    it('should record migration duration', async () => {
      const result = await scheduler.runMigrationCycle()

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should reschedule after cycle completes', async () => {
      await scheduler.runMigrationCycle()

      expect(storage.setAlarm).toHaveBeenCalled()
    })
  })

  describe('Error Handling and Backoff', () => {
    it('should increment failure count on cycle failure', async () => {
      const cycleFn = vi.fn().mockRejectedValue(new Error('Cycle failed'))
      tieredStorage.getObjectsByTier = cycleFn

      scheduler = new TierMigrationScheduler(storage, tieredStorage)
      await scheduler.runMigrationCycle()

      const state = await scheduler.getState()
      expect(state.consecutiveFailures).toBe(1)
    })

    it('should apply exponential backoff on failures', async () => {
      const cycleFn = vi.fn().mockRejectedValue(new Error('Cycle failed'))
      tieredStorage.getObjectsByTier = cycleFn

      scheduler = new TierMigrationScheduler(storage, tieredStorage, {
        backoffBaseDelayMs: 1000,
        backoffMultiplier: 2,
      })

      // First failure
      await scheduler.runMigrationCycle()

      // Check alarm was set with backoff
      expect(storage.setAlarm).toHaveBeenCalledWith(expect.any(Number))
    })

    it('should pause after max consecutive failures', async () => {
      const cycleFn = vi.fn().mockRejectedValue(new Error('Cycle failed'))
      tieredStorage.getObjectsByTier = cycleFn

      scheduler = new TierMigrationScheduler(storage, tieredStorage, {
        maxConsecutiveFailures: 3,
      })

      // Run cycles until paused
      for (let i = 0; i < 3; i++) {
        await scheduler.runMigrationCycle()
      }

      const state = await scheduler.getState()
      expect(state.paused).toBe(true)
      expect(state.pauseReason).toBeDefined()
      expect(typeof state.pauseReason).toBe('string')
      expect(state.pauseReason!.toLowerCase()).toContain('failure')
    })

    it('should reset failure count on successful cycle', async () => {
      const now = Date.now()
      const object: MigrationCandidate = {
        sha: sampleSha,
        type: 'blob',
        size: 1024,
        tier: 'hot',
        accessCount: 1,
        lastAccessedAt: now - 48 * 60 * 60 * 1000,
        createdAt: now - 72 * 60 * 60 * 1000,
      }

      tieredStorage = createMockTieredStorage({ hotObjects: [object] })
      scheduler = new TierMigrationScheduler(storage, tieredStorage)

      await scheduler.runMigrationCycle()

      const state = await scheduler.getState()
      expect(state.consecutiveFailures).toBe(0)
    })
  })

  describe('Pause and Resume', () => {
    it('should pause migration with reason', async () => {
      await scheduler.pauseMigration('Maintenance')

      const state = await scheduler.getState()
      expect(state.paused).toBe(true)
      expect(state.pauseReason).toBe('Maintenance')
    })

    it('should delete alarm when paused', async () => {
      await scheduler.pauseMigration('Maintenance')

      expect(storage.deleteAlarm).toHaveBeenCalled()
    })

    it('should not run cycle when paused', async () => {
      await scheduler.pauseMigration('Maintenance')
      const result = await scheduler.runMigrationCycle()

      expect(result.migrated).toBe(0)
      expect(tieredStorage.migrateObject).not.toHaveBeenCalled()
    })

    it('should resume migration', async () => {
      await scheduler.pauseMigration('Maintenance')
      await scheduler.resumeMigration()

      const state = await scheduler.getState()
      expect(state.paused).toBe(false)
      expect(state.consecutiveFailures).toBe(0)
    })

    it('should reschedule migration on resume', async () => {
      await scheduler.pauseMigration('Maintenance')
      vi.mocked(storage.setAlarm!).mockClear()

      await scheduler.resumeMigration()

      expect(storage.setAlarm).toHaveBeenCalled()
    })
  })

  describe('State Management', () => {
    it('should track total migrated objects', async () => {
      const now = Date.now()
      const objects: MigrationCandidate[] = [
        {
          sha: sampleSha,
          type: 'blob',
          size: 1024,
          tier: 'hot',
          accessCount: 1,
          lastAccessedAt: now - 48 * 60 * 60 * 1000,
          createdAt: now - 72 * 60 * 60 * 1000,
        },
        {
          sha: sampleSha2,
          type: 'blob',
          size: 2048,
          tier: 'hot',
          accessCount: 1,
          lastAccessedAt: now - 48 * 60 * 60 * 1000,
          createdAt: now - 72 * 60 * 60 * 1000,
        },
      ]

      tieredStorage = createMockTieredStorage({ hotObjects: objects })
      scheduler = new TierMigrationScheduler(storage, tieredStorage)

      await scheduler.runMigrationCycle()

      const state = await scheduler.getState()
      expect(state.totalMigrated).toBe(2)
      expect(state.totalBytesMigrated).toBe(3072)
    })

    it('should record last migration timestamp', async () => {
      const now = Date.now()
      const object: MigrationCandidate = {
        sha: sampleSha,
        type: 'blob',
        size: 1024,
        tier: 'hot',
        accessCount: 1,
        lastAccessedAt: now - 48 * 60 * 60 * 1000,
        createdAt: now - 72 * 60 * 60 * 1000,
      }

      tieredStorage = createMockTieredStorage({ hotObjects: [object] })
      scheduler = new TierMigrationScheduler(storage, tieredStorage)

      await scheduler.runMigrationCycle()

      const state = await scheduler.getState()
      expect(state.lastMigrationAt).toBeDefined()
      expect(state.lastMigrationAt).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('Migration History', () => {
    it('should record migration history', async () => {
      const now = Date.now()
      const object: MigrationCandidate = {
        sha: sampleSha,
        type: 'blob',
        size: 1024,
        tier: 'hot',
        accessCount: 1,
        lastAccessedAt: now - 48 * 60 * 60 * 1000,
        createdAt: now - 72 * 60 * 60 * 1000,
      }

      tieredStorage = createMockTieredStorage({ hotObjects: [object] })
      scheduler = new TierMigrationScheduler(storage, tieredStorage)

      await scheduler.runMigrationCycle()

      const history = await scheduler.getHistory()
      expect(history.length).toBeGreaterThan(0)
    })
  })

  describe('Configuration Updates', () => {
    it('should allow runtime config updates', () => {
      scheduler.updateConfig({ batchSize: 200 })

      const config = scheduler.getConfig()
      expect(config.batchSize).toBe(200)
    })

    it('should preserve other config values on update', () => {
      const originalAge = scheduler.getConfig().hotToWarmAgeMs
      scheduler.updateConfig({ batchSize: 200 })

      const config = scheduler.getConfig()
      expect(config.hotToWarmAgeMs).toBe(originalAge)
    })
  })

  describe('Factory Function', () => {
    it('should create scheduler with createMigrationScheduler', () => {
      const newScheduler = createMigrationScheduler(storage, tieredStorage, {
        batchSize: 25,
      })

      expect(newScheduler).toBeInstanceOf(TierMigrationScheduler)
      expect(newScheduler.getConfig().batchSize).toBe(25)
    })
  })
})
