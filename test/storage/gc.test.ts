import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  GarbageCollector,
  GCObjectStore,
  GCRefStore,
  GCOptions,
  GCResult,
  ParquetStoreGCAdapter,
  createGCForParquetStore
} from '../../src/storage/gc'
import type { ObjectType } from '../../src/types/objects'
import type { Ref } from '../../src/refs/storage'

/**
 * Mock object store for testing GC.
 */
function createMockObjectStore(): GCObjectStore & {
  objects: Map<string, { type: ObjectType; content: Uint8Array; size: number; createdAt: number }>
  addObject(sha: string, type: ObjectType, content: Uint8Array, createdAt?: number): void
} {
  const objects = new Map<string, { type: ObjectType; content: Uint8Array; size: number; createdAt: number }>()

  return {
    objects,

    addObject(sha: string, type: ObjectType, content: Uint8Array, createdAt = Date.now()) {
      objects.set(sha, { type, content, size: content.length, createdAt })
    },

    async getObject(sha: string) {
      const obj = objects.get(sha)
      if (!obj) return null
      return { type: obj.type, content: obj.content }
    },

    async hasObject(sha: string) {
      return objects.has(sha)
    },

    async deleteObject(sha: string) {
      objects.delete(sha)
    },

    async listAllObjects() {
      return Array.from(objects.entries()).map(([sha, obj]) => ({
        sha,
        type: obj.type,
        size: obj.size,
        createdAt: obj.createdAt,
      }))
    }
  }
}

/**
 * Mock ref store for testing GC.
 */
function createMockRefStore(): GCRefStore & {
  refs: Map<string, Ref>
  addRef(name: string, target: string, type?: 'direct' | 'symbolic'): void
} {
  const refs = new Map<string, Ref>()

  return {
    refs,

    addRef(name: string, target: string, type: 'direct' | 'symbolic' = 'direct') {
      refs.set(name, { name, target, type })
    },

    listRefs(prefix?: string) {
      const allRefs = Array.from(refs.values())
      if (prefix) {
        return allRefs.filter(ref => ref.name.startsWith(prefix))
      }
      return allRefs
    }
  }
}

const encoder = new TextEncoder()

/**
 * Create a mock commit object with tree and parent references.
 */
function createCommitContent(treeSha: string, parents: string[], message: string): Uint8Array {
  const lines: string[] = []
  lines.push(`tree ${treeSha}`)
  for (const parent of parents) {
    lines.push(`parent ${parent}`)
  }
  lines.push('author Test User <test@test.com> 1704067200 +0000')
  lines.push('committer Test User <test@test.com> 1704067200 +0000')
  lines.push('')
  lines.push(message)
  return encoder.encode(lines.join('\n'))
}

/**
 * Create a mock tree object with entries.
 */
function createTreeContent(entries: Array<{ mode: string; name: string; sha: string }>): Uint8Array {
  const parts: Uint8Array[] = []
  for (const entry of entries) {
    const modeAndName = encoder.encode(`${entry.mode} ${entry.name}\0`)
    // Convert hex SHA to 20 bytes
    const shaBytes = new Uint8Array(20)
    for (let i = 0; i < 40; i += 2) {
      shaBytes[i / 2] = parseInt(entry.sha.slice(i, i + 2), 16)
    }
    const entryData = new Uint8Array(modeAndName.length + 20)
    entryData.set(modeAndName)
    entryData.set(shaBytes, modeAndName.length)
    parts.push(entryData)
  }
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

/**
 * Create a mock tag object.
 */
function createTagContent(objectSha: string, objectType: ObjectType, tagName: string, message: string): Uint8Array {
  const lines: string[] = []
  lines.push(`object ${objectSha}`)
  lines.push(`type ${objectType}`)
  lines.push(`tag ${tagName}`)
  lines.push('tagger Test User <test@test.com> 1704067200 +0000')
  lines.push('')
  lines.push(message)
  return encoder.encode(lines.join('\n'))
}

describe('GarbageCollector', () => {
  let objectStore: ReturnType<typeof createMockObjectStore>
  let refStore: ReturnType<typeof createMockRefStore>
  let gc: GarbageCollector

  // Generate valid-looking SHAs for testing
  const sha = (n: number) => n.toString(16).padStart(40, '0')

  beforeEach(() => {
    objectStore = createMockObjectStore()
    refStore = createMockRefStore()
    gc = new GarbageCollector(objectStore, refStore)
  })

  describe('markReachable', () => {
    it('should mark commit, tree, and blob as reachable from ref', async () => {
      // Create a simple commit -> tree -> blob chain
      const blobSha = sha(1)
      const treeSha = sha(2)
      const commitSha = sha(3)

      objectStore.addObject(blobSha, 'blob', encoder.encode('hello world'))
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: blobSha }
      ]))
      objectStore.addObject(commitSha, 'commit', createCommitContent(treeSha, [], 'Initial commit'))

      refStore.addRef('refs/heads/main', commitSha)

      const result = await gc.preview()

      expect(result.reachableCount).toBe(3)
      expect(result.unreferencedCount).toBe(0)
    })

    it('should mark parent commits as reachable', async () => {
      const blobSha = sha(1)
      const treeSha = sha(2)
      const parentCommitSha = sha(3)
      const childCommitSha = sha(4)

      objectStore.addObject(blobSha, 'blob', encoder.encode('hello'))
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: blobSha }
      ]))
      objectStore.addObject(parentCommitSha, 'commit', createCommitContent(treeSha, [], 'Parent'))
      objectStore.addObject(childCommitSha, 'commit', createCommitContent(treeSha, [parentCommitSha], 'Child'))

      refStore.addRef('refs/heads/main', childCommitSha)

      const result = await gc.preview()

      // blob, tree, parent commit, child commit = 4 reachable
      expect(result.reachableCount).toBe(4)
      expect(result.unreferencedCount).toBe(0)
    })

    it('should mark tagged objects as reachable', async () => {
      const blobSha = sha(1)
      const treeSha = sha(2)
      const commitSha = sha(3)
      const tagSha = sha(4)

      objectStore.addObject(blobSha, 'blob', encoder.encode('hello'))
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: blobSha }
      ]))
      objectStore.addObject(commitSha, 'commit', createCommitContent(treeSha, [], 'Commit'))
      objectStore.addObject(tagSha, 'tag', createTagContent(commitSha, 'commit', 'v1.0.0', 'Release'))

      refStore.addRef('refs/tags/v1.0.0', tagSha)

      const result = await gc.preview()

      // tag, commit, tree, blob = 4 reachable
      expect(result.reachableCount).toBe(4)
      expect(result.unreferencedCount).toBe(0)
    })

    it('should handle multiple refs', async () => {
      // Create two separate branches with some shared history
      const blobSha = sha(1)
      const treeSha = sha(2)
      const sharedCommitSha = sha(3)
      const mainCommitSha = sha(4)
      const featureCommitSha = sha(5)

      objectStore.addObject(blobSha, 'blob', encoder.encode('hello'))
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: blobSha }
      ]))
      objectStore.addObject(sharedCommitSha, 'commit', createCommitContent(treeSha, [], 'Shared'))
      objectStore.addObject(mainCommitSha, 'commit', createCommitContent(treeSha, [sharedCommitSha], 'Main'))
      objectStore.addObject(featureCommitSha, 'commit', createCommitContent(treeSha, [sharedCommitSha], 'Feature'))

      refStore.addRef('refs/heads/main', mainCommitSha)
      refStore.addRef('refs/heads/feature', featureCommitSha)

      const result = await gc.preview()

      // blob, tree, shared commit, main commit, feature commit = 5 reachable
      expect(result.reachableCount).toBe(5)
    })

    it('should skip symbolic refs', async () => {
      const blobSha = sha(1)
      const treeSha = sha(2)
      const commitSha = sha(3)

      objectStore.addObject(blobSha, 'blob', encoder.encode('hello'))
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: blobSha }
      ]))
      objectStore.addObject(commitSha, 'commit', createCommitContent(treeSha, [], 'Commit'))

      refStore.addRef('refs/heads/main', commitSha)
      refStore.addRef('HEAD', 'refs/heads/main', 'symbolic')

      const result = await gc.preview()

      // blob, tree, commit = 3 reachable (HEAD doesn't count as it's symbolic)
      expect(result.reachableCount).toBe(3)
    })
  })

  describe('collect - unreferenced objects', () => {
    it('should identify unreferenced objects', async () => {
      const referencedBlobSha = sha(1)
      const unreferencedBlobSha = sha(2)
      const treeSha = sha(3)
      const commitSha = sha(4)

      // Add objects - one blob is not in the tree
      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days ago
      objectStore.addObject(referencedBlobSha, 'blob', encoder.encode('referenced'), oldTime)
      objectStore.addObject(unreferencedBlobSha, 'blob', encoder.encode('unreferenced'), oldTime)
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: referencedBlobSha }
      ]), oldTime)
      objectStore.addObject(commitSha, 'commit', createCommitContent(treeSha, [], 'Commit'), oldTime)

      refStore.addRef('refs/heads/main', commitSha)

      const result = await gc.preview()

      expect(result.reachableCount).toBe(3) // commit, tree, referenced blob
      expect(result.unreferencedCount).toBe(1) // unreferenced blob
    })

    it('should delete unreferenced objects outside grace period', async () => {
      const referencedBlobSha = sha(1)
      const unreferencedBlobSha = sha(2)
      const treeSha = sha(3)
      const commitSha = sha(4)

      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days ago
      objectStore.addObject(referencedBlobSha, 'blob', encoder.encode('referenced'), oldTime)
      objectStore.addObject(unreferencedBlobSha, 'blob', encoder.encode('unreferenced'), oldTime)
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: referencedBlobSha }
      ]), oldTime)
      objectStore.addObject(commitSha, 'commit', createCommitContent(treeSha, [], 'Commit'), oldTime)

      refStore.addRef('refs/heads/main', commitSha)

      const result = await gc.collect()

      expect(result.deletedCount).toBe(1)
      expect(objectStore.objects.has(unreferencedBlobSha)).toBe(false)
      expect(objectStore.objects.has(referencedBlobSha)).toBe(true)
    })

    it('should skip objects within grace period', async () => {
      const recentBlobSha = sha(1)
      const oldBlobSha = sha(2)
      const treeSha = sha(3)
      const commitSha = sha(4)

      const recentTime = Date.now() - 1000 // 1 second ago
      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days ago

      // Tree only references the old blob, so recent blob is unreferenced
      objectStore.addObject(oldBlobSha, 'blob', encoder.encode('old referenced'), oldTime)
      objectStore.addObject(recentBlobSha, 'blob', encoder.encode('recent unreferenced'), recentTime)
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: oldBlobSha }
      ]), oldTime)
      objectStore.addObject(commitSha, 'commit', createCommitContent(treeSha, [], 'Commit'), oldTime)

      refStore.addRef('refs/heads/main', commitSha)

      const result = await gc.collect()

      expect(result.unreferencedCount).toBe(1)
      expect(result.skippedGracePeriod).toBe(1)
      expect(result.deletedCount).toBe(0)
      expect(objectStore.objects.has(recentBlobSha)).toBe(true) // Not deleted due to grace period
    })

    it('should respect custom grace period', async () => {
      const unreferencedBlobSha = sha(1)
      const treeSha = sha(2)
      const commitSha = sha(3)

      // Object is 2 days old
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000
      objectStore.addObject(unreferencedBlobSha, 'blob', encoder.encode('unreferenced'), twoDaysAgo)
      objectStore.addObject(treeSha, 'tree', createTreeContent([]), twoDaysAgo)
      objectStore.addObject(commitSha, 'commit', createCommitContent(treeSha, [], 'Empty'), twoDaysAgo)

      refStore.addRef('refs/heads/main', commitSha)

      // With default 14-day grace period, it should be skipped
      const result1 = await gc.collect()
      expect(result1.skippedGracePeriod).toBe(1)
      expect(result1.deletedCount).toBe(0)

      // With 1-day grace period, it should be deleted
      const result2 = await gc.collect({ gracePeriodMs: 1 * 24 * 60 * 60 * 1000 })
      expect(result2.deletedCount).toBe(1)
    })
  })

  describe('collect - dry run', () => {
    it('should not delete objects in dry run mode', async () => {
      const unreferencedBlobSha = sha(1)

      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000
      objectStore.addObject(unreferencedBlobSha, 'blob', encoder.encode('unreferenced'), oldTime)

      // No refs, so blob is unreferenced

      const result = await gc.collect({ dryRun: true })

      expect(result.dryRun).toBe(true)
      expect(result.deletedCount).toBe(1) // Reports it would be deleted
      expect(objectStore.objects.has(unreferencedBlobSha)).toBe(true) // But object still exists
    })
  })

  describe('collect - max delete limit', () => {
    it('should respect maxDeleteCount limit', async () => {
      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000

      // Create 5 unreferenced blobs
      for (let i = 1; i <= 5; i++) {
        objectStore.addObject(sha(i), 'blob', encoder.encode(`blob ${i}`), oldTime)
      }

      // No refs, so all blobs are unreferenced

      const result = await gc.collect({ maxDeleteCount: 2 })

      expect(result.unreferencedCount).toBe(5)
      expect(result.deletedCount).toBe(2)
      expect(result.skippedMaxLimit).toBe(3)
      expect(objectStore.objects.size).toBe(3) // 5 - 2 = 3 remaining
    })
  })

  describe('collect - edge cases', () => {
    it('should handle empty repository', async () => {
      const result = await gc.collect()

      expect(result.totalScanned).toBe(0)
      expect(result.reachableCount).toBe(0)
      expect(result.unreferencedCount).toBe(0)
      expect(result.deletedCount).toBe(0)
    })

    it('should handle refs pointing to missing objects', async () => {
      refStore.addRef('refs/heads/main', sha(1)) // Points to non-existent object

      // Should not throw
      const result = await gc.collect()

      expect(result.reachableCount).toBe(0)
    })

    it('should handle cyclic tree structures (defensive)', async () => {
      // This shouldn't happen in valid Git repos, but test defensive handling
      const treeSha = sha(1)
      const commitSha = sha(2)

      // Tree that references itself (invalid but defensive)
      // Note: Our walker uses visited set to prevent infinite loops
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '040000', name: 'self', sha: treeSha }
      ]))
      objectStore.addObject(commitSha, 'commit', createCommitContent(treeSha, [], 'Cyclic'))

      refStore.addRef('refs/heads/main', commitSha)

      // Should not hang or throw
      const result = await gc.collect()

      expect(result.reachableCount).toBe(2)
    })

    it('should handle deep commit history', async () => {
      const blobSha = sha(1)
      const treeSha = sha(2)
      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000

      objectStore.addObject(blobSha, 'blob', encoder.encode('content'), oldTime)
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: blobSha }
      ]), oldTime)

      // Create a chain of 100 commits
      let parentSha: string | undefined
      for (let i = 0; i < 100; i++) {
        const commitSha = sha(100 + i)
        const parents = parentSha ? [parentSha] : []
        objectStore.addObject(commitSha, 'commit', createCommitContent(treeSha, parents, `Commit ${i}`), oldTime)
        parentSha = commitSha
      }

      refStore.addRef('refs/heads/main', parentSha!)

      const result = await gc.preview()

      // blob + tree + 100 commits = 102 reachable
      expect(result.reachableCount).toBe(102)
    })

    it('should handle nested tree structures', async () => {
      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000

      // Create nested tree: root -> subdir -> file
      const blobSha = sha(1)
      const subdirTreeSha = sha(2)
      const rootTreeSha = sha(3)
      const commitSha = sha(4)

      objectStore.addObject(blobSha, 'blob', encoder.encode('nested'), oldTime)
      objectStore.addObject(subdirTreeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: blobSha }
      ]), oldTime)
      objectStore.addObject(rootTreeSha, 'tree', createTreeContent([
        { mode: '040000', name: 'subdir', sha: subdirTreeSha }
      ]), oldTime)
      objectStore.addObject(commitSha, 'commit', createCommitContent(rootTreeSha, [], 'Nested'), oldTime)

      refStore.addRef('refs/heads/main', commitSha)

      const result = await gc.preview()

      expect(result.reachableCount).toBe(4)
    })
  })

  describe('collect - statistics', () => {
    it('should return accurate statistics', async () => {
      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000
      const recentTime = Date.now() - 1000

      const referencedBlobSha = sha(1)
      const oldUnreferencedSha = sha(2)
      const recentUnreferencedSha = sha(3)
      const treeSha = sha(4)
      const commitSha = sha(5)

      objectStore.addObject(referencedBlobSha, 'blob', encoder.encode('ref'), oldTime)
      objectStore.addObject(oldUnreferencedSha, 'blob', encoder.encode('old unref'), oldTime)
      objectStore.addObject(recentUnreferencedSha, 'blob', encoder.encode('recent unref'), recentTime)
      objectStore.addObject(treeSha, 'tree', createTreeContent([
        { mode: '100644', name: 'file.txt', sha: referencedBlobSha }
      ]), oldTime)
      objectStore.addObject(commitSha, 'commit', createCommitContent(treeSha, [], 'Commit'), oldTime)

      refStore.addRef('refs/heads/main', commitSha)

      const result = await gc.collect()

      expect(result.totalScanned).toBe(5)
      expect(result.reachableCount).toBe(3) // commit, tree, referenced blob
      expect(result.unreferencedCount).toBe(2) // old unreferenced, recent unreferenced
      expect(result.skippedGracePeriod).toBe(1) // recent unreferenced
      expect(result.deletedCount).toBe(1) // old unreferenced
      expect(result.freedBytes).toBe('old unref'.length)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('logging', () => {
    it('should log operations when logger is provided', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }

      const gcWithLogger = new GarbageCollector(objectStore, refStore, { logger })

      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000
      objectStore.addObject(sha(1), 'blob', encoder.encode('test'), oldTime)

      await gcWithLogger.collect()

      expect(logger.info).toHaveBeenCalled()
    })
  })
})

describe('ParquetStoreGCAdapter', () => {
  it('should delegate getObject to store', async () => {
    const mockStore = {
      getObject: vi.fn().mockResolvedValue({ type: 'blob' as ObjectType, content: new Uint8Array([1, 2, 3]) }),
      hasObject: vi.fn(),
      deleteObject: vi.fn(),
    }
    const mockR2 = { list: vi.fn().mockResolvedValue({ objects: [] }) } as unknown as R2Bucket
    const mockSql = { sql: { exec: vi.fn().mockReturnValue({ toArray: () => [] }) } }

    const adapter = new ParquetStoreGCAdapter(mockStore, mockR2, mockSql, 'test')

    await adapter.getObject('test-sha')

    expect(mockStore.getObject).toHaveBeenCalledWith('test-sha')
  })

  it('should delegate hasObject to store', async () => {
    const mockStore = {
      getObject: vi.fn(),
      hasObject: vi.fn().mockResolvedValue(true),
      deleteObject: vi.fn(),
    }
    const mockR2 = { list: vi.fn().mockResolvedValue({ objects: [] }) } as unknown as R2Bucket
    const mockSql = { sql: { exec: vi.fn().mockReturnValue({ toArray: () => [] }) } }

    const adapter = new ParquetStoreGCAdapter(mockStore, mockR2, mockSql, 'test')

    const result = await adapter.hasObject('test-sha')

    expect(result).toBe(true)
    expect(mockStore.hasObject).toHaveBeenCalledWith('test-sha')
  })

  it('should delegate deleteObject to store', async () => {
    const mockStore = {
      getObject: vi.fn(),
      hasObject: vi.fn(),
      deleteObject: vi.fn(),
    }
    const mockR2 = { list: vi.fn().mockResolvedValue({ objects: [] }) } as unknown as R2Bucket
    const mockSql = { sql: { exec: vi.fn().mockReturnValue({ toArray: () => [] }) } }

    const adapter = new ParquetStoreGCAdapter(mockStore, mockR2, mockSql, 'test')

    await adapter.deleteObject('test-sha')

    expect(mockStore.deleteObject).toHaveBeenCalledWith('test-sha')
  })

  it('should list objects from exact_cache table', async () => {
    const mockStore = {
      getObject: vi.fn(),
      hasObject: vi.fn(),
      deleteObject: vi.fn(),
    }
    const mockR2 = { list: vi.fn().mockResolvedValue({ objects: [] }) } as unknown as R2Bucket
    const mockSql = {
      sql: {
        exec: vi.fn().mockReturnValue({
          toArray: () => [
            { sha: 'abc123', type: 'blob', size: 100, createdAt: 1000 },
            { sha: 'def456', type: 'commit', size: 200, createdAt: 2000 },
          ]
        })
      }
    }

    const adapter = new ParquetStoreGCAdapter(mockStore, mockR2, mockSql, 'test')

    const objects = await adapter.listAllObjects()

    expect(objects).toHaveLength(2)
    expect(objects[0]).toEqual({ sha: 'abc123', type: 'blob', size: 100, createdAt: 1000 })
    expect(objects[1]).toEqual({ sha: 'def456', type: 'commit', size: 200, createdAt: 2000 })
  })
})

describe('createGCForParquetStore', () => {
  it('should create a configured GarbageCollector', () => {
    const mockStore = {
      getObject: vi.fn(),
      hasObject: vi.fn(),
      deleteObject: vi.fn(),
    }
    const mockRefStore = {
      listRefs: vi.fn().mockReturnValue([]),
    }
    const mockR2 = { list: vi.fn() } as unknown as R2Bucket
    const mockSql = { sql: { exec: vi.fn().mockReturnValue({ toArray: () => [] }) } }

    const gc = createGCForParquetStore(
      mockStore,
      mockRefStore,
      mockR2,
      mockSql,
      'owner/repo',
      { gracePeriodMs: 7 * 24 * 60 * 60 * 1000 }
    )

    expect(gc).toBeInstanceOf(GarbageCollector)
  })
})
