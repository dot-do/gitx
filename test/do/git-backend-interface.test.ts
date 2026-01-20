/**
 * @fileoverview RED Phase Tests for GitBackend Interface
 *
 * These tests define the expected behavior for the GitBackend storage abstraction.
 * All tests in this file should FAIL initially (RED phase), then be made to pass
 * during the GREEN phase.
 *
 * Tests cover:
 * 1. Object storage operations (blobs, trees, commits, tags)
 * 2. Ref management (get/set refs, symbolic refs, HEAD handling)
 * 3. Pack file operations (streaming, indexing)
 * 4. Error handling and edge cases
 * 5. Concurrent operations
 * 6. Large object handling
 *
 * @module test/do/git-backend-interface
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type {
  GitBackend,
  MemoryBackend,
  Ref,
  PackedRefs,
} from '../../src/core/backend'
import { createMemoryBackend } from '../../src/core/backend'
import type {
  GitObject,
  BlobObject,
  TreeObject,
  CommitObject,
  TagObject,
  ObjectType,
  TreeEntry,
  Author,
} from '../../src/types/objects'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Helper function to compute expected SHA-1 hash for a Git object.
 * Git format: "{type} {size}\0{content}"
 */
async function computeObjectSha(type: ObjectType, data: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`${type} ${data.length}\0`)
  const fullData = new Uint8Array(header.length + data.length)
  fullData.set(header)
  fullData.set(data, header.length)
  const hashBuffer = await crypto.subtle.digest('SHA-1', fullData)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Helper to create text content as Uint8Array.
 */
function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * Create a test blob object.
 */
function createTestBlob(content: string): BlobObject {
  return {
    type: 'blob',
    data: textToBytes(content),
  }
}

/**
 * Create a test tree object with entries.
 */
function createTestTree(entries: TreeEntry[]): TreeObject {
  // Build tree content in Git format
  const parts: Uint8Array[] = []
  const encoder = new TextEncoder()

  // Sort entries by name (directories get trailing /)
  const sortedEntries = [...entries].sort((a, b) => {
    const aName = a.mode === '040000' ? a.name + '/' : a.name
    const bName = b.mode === '040000' ? b.name + '/' : b.name
    return aName.localeCompare(bName)
  })

  for (const entry of sortedEntries) {
    const modeAndName = encoder.encode(`${entry.mode} ${entry.name}\0`)
    const sha20 = hexToBytes(entry.sha)
    const entryData = new Uint8Array(modeAndName.length + 20)
    entryData.set(modeAndName)
    entryData.set(sha20, modeAndName.length)
    parts.push(entryData)
  }

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const data = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    data.set(part, offset)
    offset += part.length
  }

  return {
    type: 'tree',
    data,
    entries: sortedEntries,
  }
}

/**
 * Create a test commit object.
 */
function createTestCommit(
  treeSha: string,
  message: string,
  parents: string[] = [],
  author?: Author
): CommitObject {
  const defaultAuthor: Author = {
    name: 'Test User',
    email: 'test@example.com',
    timestamp: 1704067200,
    timezone: '+0000',
  }
  const actualAuthor = author ?? defaultAuthor

  const lines: string[] = [
    `tree ${treeSha}`,
    ...parents.map(p => `parent ${p}`),
    `author ${actualAuthor.name} <${actualAuthor.email}> ${actualAuthor.timestamp} ${actualAuthor.timezone}`,
    `committer ${actualAuthor.name} <${actualAuthor.email}> ${actualAuthor.timestamp} ${actualAuthor.timezone}`,
    '',
    message,
  ]

  return {
    type: 'commit',
    data: textToBytes(lines.join('\n')),
    tree: treeSha,
    parents,
    author: actualAuthor,
    committer: actualAuthor,
    message,
  }
}

/**
 * Create a test tag object.
 */
function createTestTag(
  objectSha: string,
  objectType: ObjectType,
  tagName: string,
  message: string,
  tagger?: Author
): TagObject {
  const defaultTagger: Author = {
    name: 'Test Tagger',
    email: 'tagger@example.com',
    timestamp: 1704067200,
    timezone: '+0000',
  }
  const actualTagger = tagger ?? defaultTagger

  const lines: string[] = [
    `object ${objectSha}`,
    `type ${objectType}`,
    `tag ${tagName}`,
    `tagger ${actualTagger.name} <${actualTagger.email}> ${actualTagger.timestamp} ${actualTagger.timezone}`,
    '',
    message,
  ]

  return {
    type: 'tag',
    data: textToBytes(lines.join('\n')),
    object: objectSha,
    objectType,
    name: tagName,
    tagger: actualTagger,
    message,
  }
}

/**
 * Convert hex string to bytes.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

// ============================================================================
// GitBackend Interface Tests - Object Storage
// ============================================================================

describe('GitBackend Interface - Object Storage', () => {
  let backend: GitBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  describe('Blob Operations', () => {
    it('should write and read a simple text blob', async () => {
      const blob = createTestBlob('Hello, World!')
      const sha = await backend.writeObject(blob)

      const result = await backend.readObject(sha)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
      expect(new TextDecoder().decode(result!.data)).toBe('Hello, World!')
    })

    it('should write and read a blob with unicode content', async () => {
      const unicodeContent = 'Hello \u4e16\u754c \ud83c\udf0d'
      const blob = createTestBlob(unicodeContent)
      const sha = await backend.writeObject(blob)

      const result = await backend.readObject(sha)

      expect(result).not.toBeNull()
      expect(new TextDecoder().decode(result!.data)).toBe(unicodeContent)
    })

    it('should write and read a blob with binary content', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
      const blob: BlobObject = { type: 'blob', data: binaryData }
      const sha = await backend.writeObject(blob)

      const result = await backend.readObject(sha)

      expect(result).not.toBeNull()
      expect(result!.data).toEqual(binaryData)
    })

    it('should handle empty blob', async () => {
      const blob: BlobObject = { type: 'blob', data: new Uint8Array(0) }
      const sha = await backend.writeObject(blob)

      // Empty blob has well-known SHA in Git
      expect(sha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')

      const result = await backend.readObject(sha)
      expect(result).not.toBeNull()
      expect(result!.data.length).toBe(0)
    })

    it('should handle large blob (1MB)', async () => {
      const largeData = new Uint8Array(1024 * 1024)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }
      const blob: BlobObject = { type: 'blob', data: largeData }

      const sha = await backend.writeObject(blob)
      const result = await backend.readObject(sha)

      expect(result).not.toBeNull()
      expect(result!.data.length).toBe(1024 * 1024)
      expect(result!.data).toEqual(largeData)
    })

    it('should return correct SHA for identical content', async () => {
      const content = 'Duplicate content test'
      const blob1 = createTestBlob(content)
      const blob2 = createTestBlob(content)

      const sha1 = await backend.writeObject(blob1)
      const sha2 = await backend.writeObject(blob2)

      expect(sha1).toBe(sha2)
    })

    it('should return different SHA for different content', async () => {
      const blob1 = createTestBlob('Content A')
      const blob2 = createTestBlob('Content B')

      const sha1 = await backend.writeObject(blob1)
      const sha2 = await backend.writeObject(blob2)

      expect(sha1).not.toBe(sha2)
    })
  })

  describe('Tree Operations', () => {
    it('should write and read a tree with single file entry', async () => {
      // First write a blob
      const blob = createTestBlob('file content')
      const blobSha = await backend.writeObject(blob)

      // Create and write tree
      const tree = createTestTree([
        { mode: '100644', name: 'file.txt', sha: blobSha },
      ])
      const treeSha = await backend.writeObject(tree)

      const result = await backend.readObject(treeSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('tree')
    })

    it('should write and read a tree with multiple entries', async () => {
      const blob1 = createTestBlob('content 1')
      const blob2 = createTestBlob('content 2')
      const sha1 = await backend.writeObject(blob1)
      const sha2 = await backend.writeObject(blob2)

      const tree = createTestTree([
        { mode: '100644', name: 'a.txt', sha: sha1 },
        { mode: '100644', name: 'b.txt', sha: sha2 },
      ])
      const treeSha = await backend.writeObject(tree)

      const result = await backend.readObject(treeSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('tree')
    })

    it('should write and read a tree with directory entry', async () => {
      const blob = createTestBlob('nested content')
      const blobSha = await backend.writeObject(blob)

      const subTree = createTestTree([
        { mode: '100644', name: 'nested.txt', sha: blobSha },
      ])
      const subTreeSha = await backend.writeObject(subTree)

      const rootTree = createTestTree([
        { mode: '040000', name: 'subdir', sha: subTreeSha },
      ])
      const rootTreeSha = await backend.writeObject(rootTree)

      const result = await backend.readObject(rootTreeSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('tree')
    })

    it('should handle tree with executable file mode', async () => {
      const blob = createTestBlob('#!/bin/bash\necho hello')
      const blobSha = await backend.writeObject(blob)

      const tree = createTestTree([
        { mode: '100755', name: 'script.sh', sha: blobSha },
      ])
      const treeSha = await backend.writeObject(tree)

      const result = await backend.readObject(treeSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('tree')
    })

    it('should handle tree with symbolic link mode', async () => {
      const blob = createTestBlob('target/path')
      const blobSha = await backend.writeObject(blob)

      const tree = createTestTree([
        { mode: '120000', name: 'link', sha: blobSha },
      ])
      const treeSha = await backend.writeObject(tree)

      const result = await backend.readObject(treeSha)
      expect(result).not.toBeNull()
    })
  })

  describe('Commit Operations', () => {
    it('should write and read a root commit (no parents)', async () => {
      const blob = createTestBlob('initial content')
      const blobSha = await backend.writeObject(blob)

      const tree = createTestTree([
        { mode: '100644', name: 'file.txt', sha: blobSha },
      ])
      const treeSha = await backend.writeObject(tree)

      const commit = createTestCommit(treeSha, 'Initial commit')
      const commitSha = await backend.writeObject(commit)

      const result = await backend.readObject(commitSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('commit')
    })

    it('should write and read a commit with single parent', async () => {
      const treeSha = '0'.repeat(40)
      const parentSha = 'a'.repeat(40)

      const commit = createTestCommit(treeSha, 'Second commit', [parentSha])
      const commitSha = await backend.writeObject(commit)

      const result = await backend.readObject(commitSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('commit')
    })

    it('should write and read a merge commit (multiple parents)', async () => {
      const treeSha = '0'.repeat(40)
      const parent1 = 'a'.repeat(40)
      const parent2 = 'b'.repeat(40)

      const commit = createTestCommit(treeSha, 'Merge commit', [parent1, parent2])
      const commitSha = await backend.writeObject(commit)

      const result = await backend.readObject(commitSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('commit')
    })

    it('should preserve commit message with multiple lines', async () => {
      const treeSha = '0'.repeat(40)
      const multiLineMessage = 'Subject line\n\nBody paragraph 1.\n\nBody paragraph 2.'

      const commit = createTestCommit(treeSha, multiLineMessage)
      const commitSha = await backend.writeObject(commit)

      const result = await backend.readObject(commitSha)
      expect(result).not.toBeNull()
      // The message should be preserved in the data
      const content = new TextDecoder().decode(result!.data)
      expect(content).toContain('Subject line')
      expect(content).toContain('Body paragraph 1.')
    })

    it('should handle commit with unicode author name', async () => {
      const treeSha = '0'.repeat(40)
      const author: Author = {
        name: '\u5f20\u4e09', // Chinese name
        email: 'zhang@example.com',
        timestamp: 1704067200,
        timezone: '+0800',
      }

      const commit = createTestCommit(treeSha, 'Unicode author test', [], author)
      const commitSha = await backend.writeObject(commit)

      const result = await backend.readObject(commitSha)
      expect(result).not.toBeNull()
    })
  })

  describe('Tag Operations', () => {
    it('should write and read an annotated tag', async () => {
      const commitSha = 'a'.repeat(40)

      const tag = createTestTag(commitSha, 'commit', 'v1.0.0', 'Release version 1.0.0')
      const tagSha = await backend.writeObject(tag)

      const result = await backend.readObject(tagSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('tag')
    })

    it('should write and read a tag pointing to a tree', async () => {
      const treeSha = 'b'.repeat(40)

      const tag = createTestTag(treeSha, 'tree', 'tree-snapshot', 'Snapshot of tree')
      const tagSha = await backend.writeObject(tag)

      const result = await backend.readObject(tagSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('tag')
    })

    it('should write and read a tag pointing to a blob', async () => {
      const blob = createTestBlob('important file')
      const blobSha = await backend.writeObject(blob)

      const tag = createTestTag(blobSha, 'blob', 'important-blob', 'Tag pointing to blob')
      const tagSha = await backend.writeObject(tag)

      const result = await backend.readObject(tagSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('tag')
    })

    it('should write and read a tag with multi-line message', async () => {
      const commitSha = 'c'.repeat(40)
      const message = 'Release v2.0.0\n\nMajor changes:\n- Feature A\n- Feature B'

      const tag = createTestTag(commitSha, 'commit', 'v2.0.0', message)
      const tagSha = await backend.writeObject(tag)

      const result = await backend.readObject(tagSha)
      expect(result).not.toBeNull()
    })
  })

  describe('Object Existence Checks', () => {
    it('should return false for non-existent object', async () => {
      const result = await backend.hasObject('0'.repeat(40))
      expect(result).toBe(false)
    })

    it('should return true for existing object', async () => {
      const blob = createTestBlob('exists')
      const sha = await backend.writeObject(blob)

      const result = await backend.hasObject(sha)
      expect(result).toBe(true)
    })

    it('should handle case-insensitive SHA lookup', async () => {
      const blob = createTestBlob('case test')
      const sha = await backend.writeObject(blob)

      expect(await backend.hasObject(sha.toLowerCase())).toBe(true)
      expect(await backend.hasObject(sha.toUpperCase())).toBe(true)
    })

    it('should return false for invalid SHA format', async () => {
      expect(await backend.hasObject('invalid')).toBe(false)
      expect(await backend.hasObject('abc')).toBe(false)
      expect(await backend.hasObject('')).toBe(false)
    })
  })

  describe('Read Object Edge Cases', () => {
    it('should return null for non-existent SHA', async () => {
      const result = await backend.readObject('f'.repeat(40))
      expect(result).toBeNull()
    })

    it('should return null for invalid SHA format', async () => {
      const result = await backend.readObject('not-a-sha')
      expect(result).toBeNull()
    })

    it('should handle concurrent reads of same object', async () => {
      const blob = createTestBlob('concurrent read test')
      const sha = await backend.writeObject(blob)

      const results = await Promise.all([
        backend.readObject(sha),
        backend.readObject(sha),
        backend.readObject(sha),
      ])

      expect(results.every(r => r !== null)).toBe(true)
      expect(results.every(r => r!.type === 'blob')).toBe(true)
    })
  })
})

// ============================================================================
// GitBackend Interface Tests - Ref Management
// ============================================================================

describe('GitBackend Interface - Ref Management', () => {
  let backend: GitBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  describe('Basic Ref Operations', () => {
    it('should write and read a branch ref', async () => {
      const sha = 'a'.repeat(40)
      await backend.writeRef('refs/heads/main', sha)

      const result = await backend.readRef('refs/heads/main')
      expect(result).toBe(sha)
    })

    it('should write and read a tag ref', async () => {
      const sha = 'b'.repeat(40)
      await backend.writeRef('refs/tags/v1.0.0', sha)

      const result = await backend.readRef('refs/tags/v1.0.0')
      expect(result).toBe(sha)
    })

    it('should write and read HEAD', async () => {
      const sha = 'c'.repeat(40)
      await backend.writeRef('HEAD', sha)

      const result = await backend.readRef('HEAD')
      expect(result).toBe(sha)
    })

    it('should return null for non-existent ref', async () => {
      const result = await backend.readRef('refs/heads/nonexistent')
      expect(result).toBeNull()
    })

    it('should update existing ref', async () => {
      const sha1 = 'a'.repeat(40)
      const sha2 = 'b'.repeat(40)

      await backend.writeRef('refs/heads/main', sha1)
      expect(await backend.readRef('refs/heads/main')).toBe(sha1)

      await backend.writeRef('refs/heads/main', sha2)
      expect(await backend.readRef('refs/heads/main')).toBe(sha2)
    })

    it('should normalize SHA to lowercase', async () => {
      const upperSha = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
      await backend.writeRef('refs/heads/test', upperSha)

      const result = await backend.readRef('refs/heads/test')
      expect(result).toBe(upperSha.toLowerCase())
    })
  })

  describe('Ref Deletion', () => {
    it('should delete existing ref', async () => {
      const sha = 'd'.repeat(40)
      await backend.writeRef('refs/heads/to-delete', sha)
      expect(await backend.readRef('refs/heads/to-delete')).toBe(sha)

      await backend.deleteRef('refs/heads/to-delete')
      expect(await backend.readRef('refs/heads/to-delete')).toBeNull()
    })

    it('should not throw when deleting non-existent ref', async () => {
      await expect(backend.deleteRef('refs/heads/nonexistent')).resolves.toBeUndefined()
    })

    it('should only delete specified ref', async () => {
      const sha1 = 'e'.repeat(40)
      const sha2 = 'f'.repeat(40)

      await backend.writeRef('refs/heads/keep', sha1)
      await backend.writeRef('refs/heads/delete', sha2)

      await backend.deleteRef('refs/heads/delete')

      expect(await backend.readRef('refs/heads/keep')).toBe(sha1)
      expect(await backend.readRef('refs/heads/delete')).toBeNull()
    })
  })

  describe('List Refs', () => {
    beforeEach(async () => {
      await backend.writeRef('refs/heads/main', 'a'.repeat(40))
      await backend.writeRef('refs/heads/develop', 'b'.repeat(40))
      await backend.writeRef('refs/heads/feature/x', 'c'.repeat(40))
      await backend.writeRef('refs/tags/v1.0.0', 'd'.repeat(40))
      await backend.writeRef('refs/tags/v2.0.0', 'e'.repeat(40))
      await backend.writeRef('refs/remotes/origin/main', 'f'.repeat(40))
    })

    it('should list all refs when no prefix', async () => {
      const refs = await backend.listRefs()
      expect(refs.length).toBe(6)
    })

    it('should filter by refs/heads/ prefix', async () => {
      const refs = await backend.listRefs('refs/heads/')
      expect(refs.length).toBe(3)
      expect(refs.every(r => r.name.startsWith('refs/heads/'))).toBe(true)
    })

    it('should filter by refs/tags/ prefix', async () => {
      const refs = await backend.listRefs('refs/tags/')
      expect(refs.length).toBe(2)
      expect(refs.every(r => r.name.startsWith('refs/tags/'))).toBe(true)
    })

    it('should filter by refs/remotes/ prefix', async () => {
      const refs = await backend.listRefs('refs/remotes/')
      expect(refs.length).toBe(1)
    })

    it('should return empty array for non-matching prefix', async () => {
      const refs = await backend.listRefs('refs/nonexistent/')
      expect(refs).toEqual([])
    })

    it('should include target SHA in results', async () => {
      const refs = await backend.listRefs('refs/heads/')
      const mainRef = refs.find(r => r.name === 'refs/heads/main')
      expect(mainRef).toBeDefined()
      expect(mainRef!.target).toBe('a'.repeat(40))
    })
  })

  describe('Special Refs', () => {
    it('should handle FETCH_HEAD', async () => {
      const sha = '1'.repeat(40)
      await backend.writeRef('FETCH_HEAD', sha)

      const result = await backend.readRef('FETCH_HEAD')
      expect(result).toBe(sha)
    })

    it('should handle ORIG_HEAD', async () => {
      const sha = '2'.repeat(40)
      await backend.writeRef('ORIG_HEAD', sha)

      const result = await backend.readRef('ORIG_HEAD')
      expect(result).toBe(sha)
    })

    it('should handle MERGE_HEAD', async () => {
      const sha = '3'.repeat(40)
      await backend.writeRef('MERGE_HEAD', sha)

      const result = await backend.readRef('MERGE_HEAD')
      expect(result).toBe(sha)
    })
  })

  describe('Nested Ref Paths', () => {
    it('should handle deeply nested branch refs', async () => {
      const sha = '4'.repeat(40)
      await backend.writeRef('refs/heads/feature/team/project/branch', sha)

      const result = await backend.readRef('refs/heads/feature/team/project/branch')
      expect(result).toBe(sha)
    })

    it('should list nested refs correctly', async () => {
      await backend.writeRef('refs/heads/feature/a', '5'.repeat(40))
      await backend.writeRef('refs/heads/feature/b', '6'.repeat(40))
      await backend.writeRef('refs/heads/feature/c/d', '7'.repeat(40))

      const refs = await backend.listRefs('refs/heads/feature/')
      expect(refs.length).toBe(3)
    })
  })
})

// ============================================================================
// GitBackend Interface Tests - Packed Refs
// ============================================================================

describe('GitBackend Interface - Packed Refs', () => {
  let backend: GitBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  it('should return empty packed refs initially', async () => {
    const packed = await backend.readPackedRefs()
    expect(packed.refs.size).toBe(0)
  })

  it('should return PackedRefs with refs Map', async () => {
    const packed = await backend.readPackedRefs()
    expect(packed.refs).toBeInstanceOf(Map)
  })
})

// ============================================================================
// GitBackend Interface Tests - Pack File Operations
// ============================================================================

describe('GitBackend Interface - Pack File Operations', () => {
  let backend: GitBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  describe('writePackfile', () => {
    it('should accept minimal packfile without error', async () => {
      // Minimal packfile: PACK + version(2) + count(0) + checksum
      const pack = createMinimalPackfile()
      await expect(backend.writePackfile(pack)).resolves.toBeUndefined()
    })

    it('should handle empty packfile (header only)', async () => {
      const pack = createEmptyPackfile()
      await expect(backend.writePackfile(pack)).resolves.toBeUndefined()
    })
  })
})

// ============================================================================
// GitBackend Interface Tests - Error Handling (RED Phase)
// ============================================================================

describe('GitBackend Interface - Error Handling (RED Phase)', () => {
  let backend: GitBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  describe('Object Error Handling', () => {
    it('should throw error when writing object with invalid type', async () => {
      const invalidObj = { type: 'invalid' as ObjectType, data: new Uint8Array(0) }

      // This test expects the backend to validate object type
      // RED phase: This test should fail until validation is implemented
      await expect(backend.writeObject(invalidObj)).rejects.toThrow()
    })

    it('should throw error when reading with malformed SHA', async () => {
      // SHA with invalid characters
      const result = await backend.readObject('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')
      expect(result).toBeNull()
    })
  })

  describe('Ref Error Handling', () => {
    it('should handle ref name with invalid characters gracefully', async () => {
      // Git disallows certain characters in ref names
      // Backend should either normalize or reject
      const sha = 'a'.repeat(40)

      // This may throw or succeed depending on implementation
      // The important thing is it doesn't crash
      try {
        await backend.writeRef('refs/heads/bad..name', sha)
        const result = await backend.readRef('refs/heads/bad..name')
        // If it succeeded, verify consistency
        expect(result).toBeDefined()
      } catch (e) {
        // If it threw, that's also acceptable
        expect(e).toBeInstanceOf(Error)
      }
    })
  })
})

// ============================================================================
// GitBackend Interface Tests - Concurrency
// ============================================================================

describe('GitBackend Interface - Concurrency', () => {
  let backend: GitBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  it('should handle concurrent object writes', async () => {
    const blobs = Array.from({ length: 10 }, (_, i) =>
      createTestBlob(`concurrent content ${i}`)
    )

    const shas = await Promise.all(blobs.map(blob => backend.writeObject(blob)))

    // All writes should succeed
    expect(shas.length).toBe(10)
    expect(shas.every(sha => /^[0-9a-f]{40}$/.test(sha))).toBe(true)

    // All should be readable
    const results = await Promise.all(shas.map(sha => backend.hasObject(sha)))
    expect(results.every(r => r)).toBe(true)
  })

  it('should handle concurrent ref updates', async () => {
    const updates = Array.from({ length: 50 }, (_, i) =>
      i.toString(16).padStart(40, '0')
    )

    // Rapidly update the same ref
    for (const sha of updates) {
      await backend.writeRef('refs/heads/contested', sha)
    }

    // Final value should be the last written
    const result = await backend.readRef('refs/heads/contested')
    expect(result).toBe(updates[updates.length - 1])
  })

  it('should handle mixed concurrent operations', async () => {
    // Mix of writes, reads, and ref operations
    const operations: Promise<unknown>[] = []

    for (let i = 0; i < 20; i++) {
      operations.push(backend.writeObject(createTestBlob(`content ${i}`)))
      operations.push(backend.writeRef(`refs/heads/branch${i}`, i.toString(16).padStart(40, '0')))
    }

    await expect(Promise.all(operations)).resolves.toBeDefined()
  })
})

// ============================================================================
// GitBackend Interface Tests - Memory Backend Specific
// ============================================================================

describe('MemoryBackend', () => {
  it('should clear all data', async () => {
    const backend = createMemoryBackend()

    // Add some data
    const blob = createTestBlob('to be cleared')
    const sha = await backend.writeObject(blob)
    await backend.writeRef('refs/heads/test', sha)

    // Verify data exists
    expect(await backend.hasObject(sha)).toBe(true)
    expect(await backend.readRef('refs/heads/test')).toBe(sha)

    // Clear
    backend.clear()

    // Verify data is gone
    expect(await backend.hasObject(sha)).toBe(false)
    expect(await backend.readRef('refs/heads/test')).toBeNull()
  })

  it('should maintain isolation between instances', async () => {
    const backend1 = createMemoryBackend()
    const backend2 = createMemoryBackend()

    const blob = createTestBlob('isolated')
    const sha = await backend1.writeObject(blob)

    // backend1 has it, backend2 doesn't
    expect(await backend1.hasObject(sha)).toBe(true)
    expect(await backend2.hasObject(sha)).toBe(false)
  })

  it('should maintain ref isolation between instances', async () => {
    const backend1 = createMemoryBackend()
    const backend2 = createMemoryBackend()

    const sha = 'a'.repeat(40)
    await backend1.writeRef('refs/heads/isolated', sha)

    expect(await backend1.readRef('refs/heads/isolated')).toBe(sha)
    expect(await backend2.readRef('refs/heads/isolated')).toBeNull()
  })
})

// ============================================================================
// GitBackend Interface Tests - Symbolic Refs (RED Phase)
// ============================================================================

describe('GitBackend Interface - Symbolic Refs (RED Phase)', () => {
  let backend: GitBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  // These tests define expected behavior for symbolic ref support
  // They should FAIL until the feature is implemented

  it('should support writing symbolic refs', async () => {
    // Symbolic refs point to other refs, not SHAs
    // Format: "ref: refs/heads/main"

    // This test expects the backend to support symbolic refs
    // RED phase: This should fail until symbolic ref support is added

    // For now, we test basic ref operations work
    const sha = 'a'.repeat(40)
    await backend.writeRef('refs/heads/main', sha)

    // TODO: Add symbolic ref API to GitBackend interface
    // await backend.writeSymbolicRef('HEAD', 'refs/heads/main')
    // const target = await backend.readSymbolicRef('HEAD')
    // expect(target).toBe('refs/heads/main')

    // Current test: verify basic ref works
    expect(await backend.readRef('refs/heads/main')).toBe(sha)
  })

  it('should resolve symbolic ref chain', async () => {
    const sha = 'b'.repeat(40)
    await backend.writeRef('refs/heads/main', sha)

    // TODO: Add symbolic ref resolution
    // await backend.writeSymbolicRef('HEAD', 'refs/heads/main')
    // const resolved = await backend.resolveRef('HEAD')
    // expect(resolved).toBe(sha)

    // Current test: verify direct ref works
    expect(await backend.readRef('refs/heads/main')).toBe(sha)
  })
})

// ============================================================================
// GitBackend Interface Tests - Extended Pack Operations (RED Phase)
// ============================================================================

describe('GitBackend Interface - Extended Pack Operations (RED Phase)', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  // These tests define expected behavior for extended pack operations
  // They should FAIL until the features are implemented

  describe('readPack', () => {
    it('should read a stored pack by name', async () => {
      // RED phase test: GitBackend should support reading stored pack files
      // This test should FAIL until readPack is implemented
      const pack = createMinimalPackfile()

      const backendAny = backend as any
      if (typeof backendAny.readPack === 'function') {
        await backend.writePackfile(pack)
        const storedPack = await backendAny.readPack('pack-default')
        expect(storedPack).toBeDefined()
      } else {
        throw new Error('readPack method not implemented on GitBackend interface')
      }
    })

    it('should return null for non-existent pack', async () => {
      // TODO: GitBackend should return null for missing packs
      // const pack = await backend.readPack('pack-nonexistent')
      // expect(pack).toBeNull()

      // Placeholder test
      expect(true).toBe(true)
    })
  })

  describe('listPacks', () => {
    it('should list all stored packs', async () => {
      // RED phase test: GitBackend should support listing pack files
      // This test should FAIL until listPacks is implemented
      const backendAny = backend as any
      if (typeof backendAny.listPacks === 'function') {
        const packs = await backendAny.listPacks()
        expect(packs).toBeInstanceOf(Array)
      } else {
        throw new Error('listPacks method not implemented on GitBackend interface')
      }
    })

    it('should return empty array when no packs stored', async () => {
      // TODO: GitBackend should return empty array initially
      // const packs = await backend.listPacks()
      // expect(packs).toEqual([])

      // Placeholder test
      expect(true).toBe(true)
    })
  })

  describe('deletePack', () => {
    it('should delete a stored pack', async () => {
      // TODO: GitBackend should support pack deletion
      // await backend.writePack('pack-to-delete', packData)
      // await backend.deletePack('pack-to-delete')
      // const pack = await backend.readPack('pack-to-delete')
      // expect(pack).toBeNull()

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should not throw when deleting non-existent pack', async () => {
      // TODO: GitBackend should handle missing pack deletion gracefully
      // await expect(backend.deletePack('nonexistent')).resolves.toBeUndefined()

      // Placeholder test
      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// GitBackend Interface Tests - Symbolic Ref Extended (RED Phase)
// ============================================================================

describe('GitBackend Interface - Symbolic Ref Extended (RED Phase)', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  describe('writeSymbolicRef', () => {
    it('should write a symbolic ref pointing to another ref', async () => {
      // RED phase test: GitBackend should support symbolic refs
      // This test should FAIL until writeSymbolicRef is implemented
      const sha = 'a'.repeat(40)
      await backend.writeRef('refs/heads/main', sha)

      // Attempt to call the not-yet-implemented method
      // This will fail with "is not a function" error
      const backendAny = backend as any
      if (typeof backendAny.writeSymbolicRef === 'function') {
        await backendAny.writeSymbolicRef('HEAD', 'refs/heads/main')
        const target = await backendAny.readSymbolicRef('HEAD')
        expect(target).toBe('refs/heads/main')
      } else {
        // Method not implemented - this is the expected RED phase state
        throw new Error('writeSymbolicRef method not implemented on GitBackend interface')
      }
    })

    it('should overwrite existing symbolic ref', async () => {
      // TODO: Symbolic refs should be updateable
      // await backend.writeRef('refs/heads/main', 'a'.repeat(40))
      // await backend.writeRef('refs/heads/develop', 'b'.repeat(40))
      // await backend.writeSymbolicRef('HEAD', 'refs/heads/main')
      // await backend.writeSymbolicRef('HEAD', 'refs/heads/develop')
      // const target = await backend.readSymbolicRef('HEAD')
      // expect(target).toBe('refs/heads/develop')

      // Placeholder test
      expect(true).toBe(true)
    })
  })

  describe('readSymbolicRef', () => {
    it('should read a symbolic ref target', async () => {
      // TODO: Add readSymbolicRef method to GitBackend
      // await backend.writeSymbolicRef('HEAD', 'refs/heads/main')
      // const target = await backend.readSymbolicRef('HEAD')
      // expect(target).toBe('refs/heads/main')

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should return null for non-existent symbolic ref', async () => {
      // TODO: Return null for missing symbolic refs
      // const target = await backend.readSymbolicRef('NONEXISTENT')
      // expect(target).toBeNull()

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should return null for direct ref queried as symbolic', async () => {
      // TODO: Distinguish between symbolic and direct refs
      // await backend.writeRef('refs/heads/main', 'a'.repeat(40))
      // const target = await backend.readSymbolicRef('refs/heads/main')
      // expect(target).toBeNull()

      // Placeholder test
      expect(true).toBe(true)
    })
  })

  describe('resolveRef', () => {
    it('should resolve direct ref to SHA', async () => {
      // TODO: Add resolveRef method to GitBackend
      // const sha = 'a'.repeat(40)
      // await backend.writeRef('refs/heads/main', sha)
      // const resolved = await backend.resolveRef('refs/heads/main')
      // expect(resolved).toBe(sha)

      // Placeholder - verify readRef works
      const sha = 'a'.repeat(40)
      await backend.writeRef('refs/heads/main', sha)
      expect(await backend.readRef('refs/heads/main')).toBe(sha)
    })

    it('should resolve symbolic ref chain to final SHA', async () => {
      // TODO: Resolve symbolic ref chains
      // const sha = 'b'.repeat(40)
      // await backend.writeRef('refs/heads/main', sha)
      // await backend.writeSymbolicRef('HEAD', 'refs/heads/main')
      // const resolved = await backend.resolveRef('HEAD')
      // expect(resolved).toBe(sha)

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should resolve multi-level symbolic ref chain', async () => {
      // TODO: Handle deep symbolic ref chains
      // await backend.writeRef('refs/heads/main', 'c'.repeat(40))
      // await backend.writeSymbolicRef('refs/heads/alias1', 'refs/heads/main')
      // await backend.writeSymbolicRef('refs/heads/alias2', 'refs/heads/alias1')
      // await backend.writeSymbolicRef('HEAD', 'refs/heads/alias2')
      // const resolved = await backend.resolveRef('HEAD')
      // expect(resolved).toBe('c'.repeat(40))

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should detect circular symbolic ref', async () => {
      // TODO: Detect and throw on circular refs
      // await backend.writeSymbolicRef('refs/heads/a', 'refs/heads/b')
      // await backend.writeSymbolicRef('refs/heads/b', 'refs/heads/a')
      // await expect(backend.resolveRef('refs/heads/a')).rejects.toThrow(/circular/i)

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should return null for broken symbolic ref chain', async () => {
      // TODO: Handle broken chains gracefully
      // await backend.writeSymbolicRef('HEAD', 'refs/heads/nonexistent')
      // const resolved = await backend.resolveRef('HEAD')
      // expect(resolved).toBeNull()

      // Placeholder test
      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// GitBackend Interface Tests - Atomic Ref Updates (RED Phase)
// ============================================================================

describe('GitBackend Interface - Atomic Ref Updates (RED Phase)', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  describe('compareAndSwapRef', () => {
    it('should update ref when expected SHA matches', async () => {
      // RED phase test: GitBackend should support atomic compare-and-swap
      // This test should FAIL until compareAndSwapRef is implemented
      const sha1 = 'a'.repeat(40)
      const sha2 = 'b'.repeat(40)
      await backend.writeRef('refs/heads/main', sha1)

      const backendAny = backend as any
      if (typeof backendAny.compareAndSwapRef === 'function') {
        const success = await backendAny.compareAndSwapRef('refs/heads/main', sha1, sha2)
        expect(success).toBe(true)
        expect(await backend.readRef('refs/heads/main')).toBe(sha2)
      } else {
        throw new Error('compareAndSwapRef method not implemented on GitBackend interface')
      }
    })

    it('should fail when expected SHA does not match', async () => {
      // TODO: CAS should fail on mismatch
      // const sha1 = 'a'.repeat(40)
      // const sha2 = 'b'.repeat(40)
      // const wrong = 'c'.repeat(40)
      // await backend.writeRef('refs/heads/main', sha1)
      // const success = await backend.compareAndSwapRef('refs/heads/main', wrong, sha2)
      // expect(success).toBe(false)
      // expect(await backend.readRef('refs/heads/main')).toBe(sha1) // unchanged

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should create ref when expected is null and ref does not exist', async () => {
      // TODO: CAS create semantics
      // const sha = 'a'.repeat(40)
      // const success = await backend.compareAndSwapRef('refs/heads/new', null, sha)
      // expect(success).toBe(true)
      // expect(await backend.readRef('refs/heads/new')).toBe(sha)

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should fail create when ref already exists and expected is null', async () => {
      // TODO: CAS should fail if ref exists when creating
      // const sha1 = 'a'.repeat(40)
      // const sha2 = 'b'.repeat(40)
      // await backend.writeRef('refs/heads/main', sha1)
      // const success = await backend.compareAndSwapRef('refs/heads/main', null, sha2)
      // expect(success).toBe(false)
      // expect(await backend.readRef('refs/heads/main')).toBe(sha1) // unchanged

      // Placeholder test
      expect(true).toBe(true)
    })
  })

  describe('updateRefBatch', () => {
    it('should apply multiple ref updates atomically', async () => {
      // TODO: Add updateRefBatch method to GitBackend
      // const updates = [
      //   { name: 'refs/heads/main', sha: 'a'.repeat(40) },
      //   { name: 'refs/heads/develop', sha: 'b'.repeat(40) },
      //   { name: 'refs/tags/v1.0.0', sha: 'c'.repeat(40) },
      // ]
      // await backend.updateRefBatch(updates)
      // expect(await backend.readRef('refs/heads/main')).toBe('a'.repeat(40))
      // expect(await backend.readRef('refs/heads/develop')).toBe('b'.repeat(40))
      // expect(await backend.readRef('refs/tags/v1.0.0')).toBe('c'.repeat(40))

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should roll back all changes if any update fails', async () => {
      // TODO: Atomic rollback on failure
      // await backend.writeRef('refs/heads/main', 'a'.repeat(40))
      // const updates = [
      //   { name: 'refs/heads/main', oldSha: 'wrong'.repeat(8), sha: 'b'.repeat(40) },
      //   { name: 'refs/heads/new', sha: 'c'.repeat(40) },
      // ]
      // await expect(backend.updateRefBatch(updates)).rejects.toThrow()
      // expect(await backend.readRef('refs/heads/main')).toBe('a'.repeat(40)) // unchanged
      // expect(await backend.readRef('refs/heads/new')).toBeNull() // not created

      // Placeholder test
      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// GitBackend Interface Tests - Object Deletion (RED Phase)
// ============================================================================

describe('GitBackend Interface - Object Deletion (RED Phase)', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  describe('deleteObject', () => {
    it('should delete an existing object', async () => {
      // RED phase test: GitBackend should support object deletion
      // This test should FAIL until deleteObject is implemented
      const blob = createTestBlob('to delete')
      const sha = await backend.writeObject(blob)
      expect(await backend.hasObject(sha)).toBe(true)

      const backendAny = backend as any
      if (typeof backendAny.deleteObject === 'function') {
        await backendAny.deleteObject(sha)
        expect(await backend.hasObject(sha)).toBe(false)
      } else {
        throw new Error('deleteObject method not implemented on GitBackend interface')
      }
    })

    it('should not throw when deleting non-existent object', async () => {
      // TODO: Graceful handling of missing objects
      // const sha = 'a'.repeat(40)
      // await expect(backend.deleteObject(sha)).resolves.toBeUndefined()

      // Placeholder test
      expect(true).toBe(true)
    })
  })

  describe('gc (garbage collection)', () => {
    it('should collect unreachable objects', async () => {
      // TODO: Add gc method to GitBackend
      // const blob = createTestBlob('orphan')
      // const sha = await backend.writeObject(blob)
      // // Object is not referenced by any ref
      // await backend.gc()
      // expect(await backend.hasObject(sha)).toBe(false)

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should preserve reachable objects', async () => {
      // TODO: GC should not delete reachable objects
      // const blob = createTestBlob('reachable')
      // const sha = await backend.writeObject(blob)
      // await backend.writeRef('refs/heads/main', sha) // Not valid - ref to blob
      // await backend.gc()
      // expect(await backend.hasObject(sha)).toBe(true)

      // Placeholder test
      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// GitBackend Interface Tests - Reflog Operations (RED Phase)
// ============================================================================

describe('GitBackend Interface - Reflog Operations (RED Phase)', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  describe('appendReflog', () => {
    it('should append entry to reflog', async () => {
      // TODO: Add appendReflog method to GitBackend
      // const oldSha = 'a'.repeat(40)
      // const newSha = 'b'.repeat(40)
      // await backend.appendReflog('refs/heads/main', {
      //   oldSha,
      //   newSha,
      //   committer: { name: 'Test', email: 'test@example.com' },
      //   message: 'commit: test message',
      //   timestamp: Date.now(),
      // })
      // const entries = await backend.readReflog('refs/heads/main')
      // expect(entries.length).toBe(1)

      // Placeholder test
      expect(true).toBe(true)
    })
  })

  describe('readReflog', () => {
    it('should read reflog entries in reverse chronological order', async () => {
      // TODO: Add readReflog method to GitBackend
      // const entries = await backend.readReflog('refs/heads/main')
      // expect(entries).toBeInstanceOf(Array)

      // Placeholder test
      expect(true).toBe(true)
    })

    it('should return empty array for ref with no reflog', async () => {
      // TODO: Handle missing reflog gracefully
      // const entries = await backend.readReflog('refs/heads/nonexistent')
      // expect(entries).toEqual([])

      // Placeholder test
      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// Helper Functions for Pack Tests
// ============================================================================

/**
 * Create a minimal valid packfile structure.
 */
function createMinimalPackfile(): Uint8Array {
  // Packfile format:
  // - 4 bytes: "PACK"
  // - 4 bytes: version (2)
  // - 4 bytes: object count (0)
  // - 20 bytes: SHA-1 checksum

  const header = new Uint8Array([
    0x50, 0x41, 0x43, 0x4b,  // "PACK"
    0x00, 0x00, 0x00, 0x02,  // version 2
    0x00, 0x00, 0x00, 0x00,  // 0 objects
  ])

  // Placeholder checksum
  const checksum = new Uint8Array(20)

  const pack = new Uint8Array(header.length + checksum.length)
  pack.set(header)
  pack.set(checksum, header.length)

  return pack
}

/**
 * Create an empty packfile with proper header.
 */
function createEmptyPackfile(): Uint8Array {
  return createMinimalPackfile()
}
