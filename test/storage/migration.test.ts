import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  LooseToBundleMigrator,
  MigrationConfig,
  MigrationResult,
  MigrationProgress,
  MigrationObjectError,
  MigrationError,
  MigrationErrorCode,
  MigrationR2Storage,
  runMigrationCLI,
  DEFAULT_MAX_BUNDLE_SIZE,
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONCURRENCY
} from '../../src/storage/migration'
import type { DurableObjectStorage } from '../../src/do/schema'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a mock Durable Object storage for testing.
 */
function createMockStorage(): DurableObjectStorage {
  const tables = new Map<string, Map<string, unknown>>()

  // Initialize tables
  tables.set('object_index', new Map())
  tables.set('migration_checkpoints', new Map())

  return {
    sql: {
      exec(query: string, ...params: unknown[]) {
        // Simple mock SQL implementation
        const lowerQuery = query.toLowerCase()

        if (lowerQuery.includes('insert or replace into object_index')) {
          const [sha, tier, packId, offset, size, type, updatedAt] = params as [string, string, string | null, number | null, number, string | null, number]
          tables.get('object_index')!.set(sha, {
            sha,
            tier,
            pack_id: packId,
            offset,
            size,
            type,
            updated_at: updatedAt
          })
          return { toArray: () => [] }
        }

        if (lowerQuery.includes('insert or replace into migration_checkpoints')) {
          const [id, data, createdAt] = params as [string, string, number]
          tables.get('migration_checkpoints')!.set(id, { id, data, created_at: createdAt })
          return { toArray: () => [] }
        }

        if (lowerQuery.includes('select') && lowerQuery.includes('from object_index where sha =')) {
          const sha = params[0] as string
          const obj = tables.get('object_index')!.get(sha)
          return { toArray: () => obj ? [obj] : [] }
        }

        if (lowerQuery.includes('select') && lowerQuery.includes('from object_index where tier =')) {
          const tier = params[0] as string
          const results: unknown[] = []
          for (const obj of tables.get('object_index')!.values()) {
            if ((obj as any).tier === tier) {
              results.push(obj)
            }
          }
          return { toArray: () => results }
        }

        if (lowerQuery.includes('select') && lowerQuery.includes('from object_index where sha in')) {
          const results: unknown[] = []
          for (const sha of params) {
            const obj = tables.get('object_index')!.get(sha as string)
            if (obj) results.push(obj)
          }
          return { toArray: () => results }
        }

        if (lowerQuery.includes('select') && lowerQuery.includes('from migration_checkpoints')) {
          const id = params[0] as string
          const checkpoint = tables.get('migration_checkpoints')!.get(id)
          return { toArray: () => checkpoint ? [checkpoint] : [] }
        }

        if (lowerQuery.includes('update object_index')) {
          // Not implemented in mock
          return { toArray: () => [] }
        }

        if (lowerQuery.includes('delete from object_index')) {
          const sha = params[0] as string
          const deleted = tables.get('object_index')!.delete(sha)
          return { toArray: () => [{ changes: deleted ? 1 : 0 }] }
        }

        return { toArray: () => [] }
      }
    }
  }
}

/**
 * Create a mock R2 storage for testing.
 */
function createMockR2Storage(): MigrationR2Storage & {
  objects: Map<string, Uint8Array>
  addLooseObject(sha: string, type: string, content: string): void
} {
  const objects = new Map<string, Uint8Array>()

  return {
    objects,

    addLooseObject(sha: string, type: string, content: string) {
      // Create a loose object in Git format: "type size\0content"
      const contentBytes = new TextEncoder().encode(content)
      const header = new TextEncoder().encode(`${type} ${contentBytes.length}\0`)
      const data = new Uint8Array(header.length + contentBytes.length)
      data.set(header)
      data.set(contentBytes, header.length)

      // Store at loose object path
      const key = `objects/${sha.slice(0, 2)}/${sha.slice(2)}`
      objects.set(key, data)
    },

    async get(key: string) {
      const data = objects.get(key)
      if (!data) return null
      return {
        arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      }
    },

    async put(key: string, data: ArrayBuffer | Uint8Array) {
      objects.set(key, new Uint8Array(data))
    },

    async delete(key: string) {
      objects.delete(key)
    },

    async list(options?: { prefix?: string; cursor?: string }) {
      const prefix = options?.prefix ?? ''
      const result: Array<{ key: string; size: number }> = []

      for (const [key, data] of objects.entries()) {
        if (key.startsWith(prefix)) {
          result.push({ key, size: data.length })
        }
      }

      return {
        objects: result,
        truncated: false,
        cursor: undefined
      }
    }
  }
}

/**
 * Generate a test SHA-1 hash (not cryptographically valid but passes validation).
 */
function generateTestSha(seed: number): string {
  // Generate a valid-looking SHA that passes validation
  // (not all same character, 40 hex chars)
  const seedHex = seed.toString(16).padStart(8, '0')
  const prefix = 'abcd1234'
  const suffix = '56789ef0'
  return `${prefix}${seedHex}${prefix}${seedHex}${suffix}`.slice(0, 40)
}

// =============================================================================
// Tests
// =============================================================================

describe('LooseToBundleMigrator', () => {
  let storage: DurableObjectStorage
  let r2: ReturnType<typeof createMockR2Storage>
  let migrator: LooseToBundleMigrator

  beforeEach(() => {
    storage = createMockStorage()
    r2 = createMockR2Storage()
  })

  describe('Configuration', () => {
    it('should use default configuration values', () => {
      migrator = new LooseToBundleMigrator(storage, r2)
      // Verify migrator was created without error
      expect(migrator.getStatus()).toBe('pending')
    })

    it('should accept custom configuration', () => {
      const config: MigrationConfig = {
        maxBundleSize: 1024 * 1024,
        batchSize: 50,
        looseObjectPrefix: 'git/objects/',
        bundlePrefix: 'git/bundles/',
        dryRun: true,
        verify: false,
        cleanup: true,
        concurrency: 10
      }

      migrator = new LooseToBundleMigrator(storage, r2, config)
      expect(migrator.getStatus()).toBe('pending')
    })
  })

  describe('Preview Mode', () => {
    it('should return preview without modifying storage', async () => {
      // Add some loose objects
      r2.addLooseObject(generateTestSha(1), 'blob', 'content1')
      r2.addLooseObject(generateTestSha(2), 'blob', 'content2')
      r2.addLooseObject(generateTestSha(3), 'tree', 'tree-content')

      migrator = new LooseToBundleMigrator(storage, r2)
      const preview = await migrator.preview()

      expect(preview.totalObjects).toBe(3)
      expect(preview.totalSize).toBeGreaterThan(0)
      expect(preview.estimatedBundles).toBeGreaterThan(0)
      expect(preview.objects).toHaveLength(3)

      // Verify R2 was not modified
      expect(r2.objects.size).toBe(3)
    })

    it('should return empty preview for empty storage', async () => {
      migrator = new LooseToBundleMigrator(storage, r2)
      const preview = await migrator.preview()

      expect(preview.totalObjects).toBe(0)
      expect(preview.totalSize).toBe(0)
      expect(preview.estimatedBundles).toBe(0)
      expect(preview.objects).toHaveLength(0)
    })
  })

  describe('Dry Run Mode', () => {
    it('should not modify storage in dry-run mode', async () => {
      r2.addLooseObject(generateTestSha(1), 'blob', 'content1')
      r2.addLooseObject(generateTestSha(2), 'blob', 'content2')

      migrator = new LooseToBundleMigrator(storage, r2, { dryRun: true })
      const result = await migrator.migrate()

      expect(result.dryRun).toBe(true)
      expect(result.objectsMigrated).toBe(2)

      // Verify no bundles were actually written
      const bundles = Array.from(r2.objects.keys()).filter(k => k.startsWith('bundles/'))
      expect(bundles).toHaveLength(0)

      // Verify loose objects still exist
      expect(r2.objects.size).toBe(2)
    })

    it('should report accurate statistics in dry-run mode', async () => {
      for (let i = 0; i < 10; i++) {
        r2.addLooseObject(generateTestSha(i), 'blob', `content-${i}`)
      }

      migrator = new LooseToBundleMigrator(storage, r2, { dryRun: true })
      const result = await migrator.migrate()

      expect(result.totalObjectsFound).toBe(10)
      expect(result.objectsMigrated).toBe(10)
      expect(result.objectsFailed).toBe(0)
      expect(result.bundlesCreated).toBeGreaterThan(0)
    })
  })

  describe('Migration Execution', () => {
    it('should migrate loose objects to bundles', async () => {
      r2.addLooseObject(generateTestSha(1), 'blob', 'content1')
      r2.addLooseObject(generateTestSha(2), 'tree', 'tree-content')
      r2.addLooseObject(generateTestSha(3), 'commit', 'commit-content')

      migrator = new LooseToBundleMigrator(storage, r2)
      const result = await migrator.migrate()

      expect(result.success).toBe(true)
      expect(result.objectsMigrated).toBe(3)
      expect(result.bundlesCreated).toBeGreaterThan(0)
      expect(result.bytesMigrated).toBeGreaterThan(0)
    })

    it('should handle empty storage gracefully', async () => {
      migrator = new LooseToBundleMigrator(storage, r2)
      const result = await migrator.migrate()

      expect(result.success).toBe(true)
      expect(result.totalObjectsFound).toBe(0)
      expect(result.objectsMigrated).toBe(0)
      expect(result.bundlesCreated).toBe(0)
    })

    it('should respect maxBundleSize limit', async () => {
      // Add objects that would exceed a small bundle size
      for (let i = 0; i < 5; i++) {
        r2.addLooseObject(generateTestSha(i), 'blob', 'x'.repeat(1000))
      }

      migrator = new LooseToBundleMigrator(storage, r2, {
        maxBundleSize: 2000 // Very small to force multiple bundles
      })
      const result = await migrator.migrate()

      expect(result.success).toBe(true)
      // Should create multiple bundles due to size limit
      expect(result.bundlesCreated).toBeGreaterThan(1)
    })

    it('should update object index after migration', async () => {
      const sha = generateTestSha(1)
      r2.addLooseObject(sha, 'blob', 'content')

      migrator = new LooseToBundleMigrator(storage, r2)
      await migrator.migrate()

      // Check object index was updated
      const result = storage.sql.exec(
        'SELECT * FROM object_index WHERE sha = ?',
        sha
      )
      const rows = result.toArray() as any[]
      expect(rows.length).toBe(1)
      expect(rows[0].tier).toBe('r2')
      expect(rows[0].pack_id).toBeDefined()
    })

    it('should track migration status', async () => {
      r2.addLooseObject(generateTestSha(1), 'blob', 'content')

      migrator = new LooseToBundleMigrator(storage, r2)

      expect(migrator.getStatus()).toBe('pending')

      const resultPromise = migrator.migrate()

      // Note: Status might be 'running' during execution or 'completed' after
      const result = await resultPromise
      expect(migrator.getStatus()).toBe('completed')
      expect(result.success).toBe(true)
    })
  })

  describe('Progress Tracking', () => {
    it('should call onProgress callback during migration', async () => {
      const progressUpdates: MigrationProgress[] = []

      for (let i = 0; i < 5; i++) {
        r2.addLooseObject(generateTestSha(i), 'blob', `content-${i}`)
      }

      migrator = new LooseToBundleMigrator(storage, r2, {
        onProgress: (progress) => progressUpdates.push({ ...progress })
      })

      await migrator.migrate()

      expect(progressUpdates.length).toBeGreaterThan(0)

      // Should have scanning phase
      expect(progressUpdates.some(p => p.phase === 'scanning')).toBe(true)

      // Should have migrating phase
      expect(progressUpdates.some(p => p.phase === 'migrating')).toBe(true)
    })

    it('should include phase information in progress updates', async () => {
      const phases = new Set<string>()

      r2.addLooseObject(generateTestSha(1), 'blob', 'content')

      migrator = new LooseToBundleMigrator(storage, r2, {
        verify: true,
        onProgress: (progress) => phases.add(progress.phase)
      })

      await migrator.migrate()

      expect(phases.has('scanning')).toBe(true)
      expect(phases.has('migrating')).toBe(true)
      expect(phases.has('verifying')).toBe(true)
    })

    it('should track processed objects count', async () => {
      let lastProgress: MigrationProgress | null = null

      for (let i = 0; i < 10; i++) {
        r2.addLooseObject(generateTestSha(i), 'blob', `content-${i}`)
      }

      migrator = new LooseToBundleMigrator(storage, r2, {
        onProgress: (progress) => { lastProgress = { ...progress } }
      })

      await migrator.migrate()

      expect(lastProgress).not.toBeNull()
      expect(lastProgress!.totalObjects).toBe(10)
      expect(lastProgress!.processedObjects).toBe(10)
    })
  })

  describe('Error Handling', () => {
    it('should call onError callback for failed objects', async () => {
      const errors: MigrationObjectError[] = []

      r2.addLooseObject(generateTestSha(1), 'blob', 'content')

      // Add an invalid object
      const badSha = generateTestSha(999)
      const badKey = `objects/${badSha.slice(0, 2)}/${badSha.slice(2)}`
      r2.objects.set(badKey, new Uint8Array([1, 2, 3])) // Invalid format

      migrator = new LooseToBundleMigrator(storage, r2, {
        onError: (error) => errors.push(error)
      })

      const result = await migrator.migrate()

      expect(result.objectsFailed).toBe(1)
      expect(errors.length).toBe(1)
      expect(errors[0].sha).toBe(badSha)
    })

    it('should continue migration after non-fatal errors', async () => {
      r2.addLooseObject(generateTestSha(1), 'blob', 'content1')
      r2.addLooseObject(generateTestSha(2), 'blob', 'content2')

      // Add an invalid object between valid ones
      const badSha = generateTestSha(999)
      const badKey = `objects/${badSha.slice(0, 2)}/${badSha.slice(2)}`
      r2.objects.set(badKey, new Uint8Array([1, 2, 3]))

      migrator = new LooseToBundleMigrator(storage, r2)
      const result = await migrator.migrate()

      // Should have migrated the valid objects
      expect(result.objectsMigrated).toBe(2)
      expect(result.objectsFailed).toBe(1)
    })

    it('should include error details in result', async () => {
      const badSha = generateTestSha(999)
      const badKey = `objects/${badSha.slice(0, 2)}/${badSha.slice(2)}`
      r2.objects.set(badKey, new Uint8Array([1, 2, 3]))

      migrator = new LooseToBundleMigrator(storage, r2)
      const result = await migrator.migrate()

      expect(result.errors.length).toBe(1)
      expect(result.errors[0].sha).toBe(badSha)
      expect(result.errors[0].message).toBeDefined()
    })
  })

  describe('Cleanup Mode', () => {
    it('should delete loose objects when cleanup is enabled', async () => {
      const sha1 = generateTestSha(1)
      const sha2 = generateTestSha(2)

      r2.addLooseObject(sha1, 'blob', 'content1')
      r2.addLooseObject(sha2, 'blob', 'content2')

      const initialCount = r2.objects.size
      expect(initialCount).toBe(2)

      migrator = new LooseToBundleMigrator(storage, r2, { cleanup: true })
      const result = await migrator.migrate()

      expect(result.objectsCleaned).toBe(2)

      // Check loose objects were deleted
      const looseObjects = Array.from(r2.objects.keys()).filter(k => k.startsWith('objects/'))
      expect(looseObjects.length).toBe(0)
    })

    it('should not delete loose objects when cleanup is disabled', async () => {
      r2.addLooseObject(generateTestSha(1), 'blob', 'content')

      migrator = new LooseToBundleMigrator(storage, r2, { cleanup: false })
      await migrator.migrate()

      // Loose object should still exist
      const looseObjects = Array.from(r2.objects.keys()).filter(k => k.startsWith('objects/'))
      expect(looseObjects.length).toBe(1)
    })

    it('should not delete failed objects during cleanup', async () => {
      r2.addLooseObject(generateTestSha(1), 'blob', 'valid-content')

      // Add invalid object
      const badSha = generateTestSha(999)
      const badKey = `objects/${badSha.slice(0, 2)}/${badSha.slice(2)}`
      r2.objects.set(badKey, new Uint8Array([1, 2, 3]))

      migrator = new LooseToBundleMigrator(storage, r2, { cleanup: true })
      const result = await migrator.migrate()

      expect(result.objectsCleaned).toBe(1) // Only valid object cleaned

      // Invalid object should still exist
      expect(r2.objects.has(badKey)).toBe(true)
    })
  })

  describe('Verification', () => {
    it('should verify migrated objects when verify is enabled', async () => {
      const sha = generateTestSha(1)
      r2.addLooseObject(sha, 'blob', 'content')

      let verificationPhase = false
      migrator = new LooseToBundleMigrator(storage, r2, {
        verify: true,
        onProgress: (p) => {
          if (p.phase === 'verifying') verificationPhase = true
        }
      })

      await migrator.migrate()

      expect(verificationPhase).toBe(true)
    })

    it('should skip verification when verify is disabled', async () => {
      r2.addLooseObject(generateTestSha(1), 'blob', 'content')

      let verificationPhase = false
      migrator = new LooseToBundleMigrator(storage, r2, {
        verify: false,
        onProgress: (p) => {
          if (p.phase === 'verifying') verificationPhase = true
        }
      })

      await migrator.migrate()

      expect(verificationPhase).toBe(false)
    })

    it('should report verification errors', async () => {
      const sha = generateTestSha(1)
      r2.addLooseObject(sha, 'blob', 'content')

      migrator = new LooseToBundleMigrator(storage, r2, { verify: true })
      const result = await migrator.migrate()

      // Should complete successfully (verification should pass for properly migrated objects)
      expect(result.success).toBe(true)
    })
  })

  describe('Batch Processing', () => {
    it('should process objects in batches', async () => {
      // Add many objects
      for (let i = 0; i < 25; i++) {
        r2.addLooseObject(generateTestSha(i), 'blob', `content-${i}`)
      }

      migrator = new LooseToBundleMigrator(storage, r2, {
        batchSize: 10 // Process 10 at a time
      })

      const result = await migrator.migrate()

      expect(result.objectsMigrated).toBe(25)
    })

    it('should respect batch size configuration', async () => {
      const batchSizes: number[] = []

      for (let i = 0; i < 15; i++) {
        r2.addLooseObject(generateTestSha(i), 'blob', `content-${i}`)
      }

      let lastProcessed = 0
      migrator = new LooseToBundleMigrator(storage, r2, {
        batchSize: 5,
        onProgress: (p) => {
          if (p.phase === 'migrating' && p.processedObjects !== lastProcessed) {
            batchSizes.push(p.processedObjects - lastProcessed)
            lastProcessed = p.processedObjects
          }
        }
      })

      await migrator.migrate()

      // Most batches should be of size 5 or less
      expect(batchSizes.every(size => size <= 5)).toBe(true)
    })
  })

  describe('Result Statistics', () => {
    it('should include duration in result', async () => {
      r2.addLooseObject(generateTestSha(1), 'blob', 'content')

      migrator = new LooseToBundleMigrator(storage, r2)
      const result = await migrator.migrate()

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should track bytes migrated', async () => {
      r2.addLooseObject(generateTestSha(1), 'blob', 'content1')
      r2.addLooseObject(generateTestSha(2), 'blob', 'longer-content-2')

      migrator = new LooseToBundleMigrator(storage, r2)
      const result = await migrator.migrate()

      expect(result.bytesMigrated).toBeGreaterThan(0)
    })

    it('should list created bundle IDs', async () => {
      r2.addLooseObject(generateTestSha(1), 'blob', 'content')

      migrator = new LooseToBundleMigrator(storage, r2)
      const result = await migrator.migrate()

      expect(result.bundleIds.length).toBe(result.bundlesCreated)
      expect(result.bundleIds.every(id => id.startsWith('bundle-'))).toBe(true)
    })
  })
})

describe('Migration Error Classes', () => {
  it('should create MigrationError with code', () => {
    const error = new MigrationError(
      'Object not found',
      MigrationErrorCode.OBJECT_NOT_FOUND
    )

    expect(error.name).toBe('MigrationError')
    expect(error.message).toBe('Object not found')
    expect(error.code).toBe(MigrationErrorCode.OBJECT_NOT_FOUND)
  })

  it('should chain cause error', () => {
    const cause = new Error('Original error')
    const error = new MigrationError(
      'Wrapper error',
      MigrationErrorCode.READ_FAILED,
      cause
    )

    expect(error.cause).toBe(cause)
  })
})

describe('Migration Constants', () => {
  it('should export default configuration values', () => {
    expect(DEFAULT_MAX_BUNDLE_SIZE).toBe(4 * 1024 * 1024) // 4MB
    expect(DEFAULT_BATCH_SIZE).toBe(100)
    expect(DEFAULT_CONCURRENCY).toBe(5)
  })
})

describe('runMigrationCLI', () => {
  let storage: DurableObjectStorage
  let r2: ReturnType<typeof createMockR2Storage>
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    storage = createMockStorage()
    r2 = createMockR2Storage()

    // Mock console methods
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('should run migration with CLI options', async () => {
    r2.addLooseObject(generateTestSha(1), 'blob', 'content')

    const result = await runMigrationCLI(storage, r2, {
      dryRun: true,
      verbose: false
    })

    expect(result.dryRun).toBe(true)
    expect(result.success).toBe(true)
  })

  it('should output summary in verbose mode', async () => {
    r2.addLooseObject(generateTestSha(1), 'blob', 'content')

    await runMigrationCLI(storage, r2, { verbose: true })

    expect(consoleSpy).toHaveBeenCalled()
  })
})
