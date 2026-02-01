import { describe, it, expect } from 'vitest'
import {
  detectStorageMode,
  parseLfsPointer,
  buildR2Key,
  encodeGitObject,
  extractCommitFields,
  encodeObjectBatch,
  INLINE_THRESHOLD,
} from '../../src/storage/variant-codec'

const encoder = new TextEncoder()

describe('variant-codec', () => {
  describe('detectStorageMode', () => {
    it('should return inline for small blobs', () => {
      const data = encoder.encode('hello world')
      expect(detectStorageMode('blob', data)).toBe('inline')
    })

    it('should return inline for commits', () => {
      const data = encoder.encode('tree abc\nauthor A <a@b> 1 +0000\n\nmsg')
      expect(detectStorageMode('commit', data)).toBe('inline')
    })

    it('should return r2 for large blobs', () => {
      const data = new Uint8Array(INLINE_THRESHOLD + 1)
      expect(detectStorageMode('blob', data)).toBe('r2')
    })

    it('should return lfs for LFS pointer blobs', () => {
      const pointer = `version https://git-lfs.github.com/spec/v1
oid sha256:${'a'.repeat(64)}
size 12345
`
      const data = encoder.encode(pointer)
      expect(detectStorageMode('blob', data)).toBe('lfs')
    })

    it('should not detect LFS for non-blob types', () => {
      const pointer = `version https://git-lfs.github.com/spec/v1
oid sha256:${'a'.repeat(64)}
size 12345
`
      const data = encoder.encode(pointer)
      expect(detectStorageMode('commit', data)).toBe('inline')
    })
  })

  describe('parseLfsPointer', () => {
    it('should parse a valid LFS pointer', () => {
      const oid = 'a'.repeat(64)
      const pointer = `version https://git-lfs.github.com/spec/v1
oid sha256:${oid}
size 12345
`
      const result = parseLfsPointer(encoder.encode(pointer))
      expect(result).toEqual({ oid, size: 12345 })
    })

    it('should return null for non-LFS content', () => {
      const result = parseLfsPointer(encoder.encode('hello world'))
      expect(result).toBeNull()
    })

    it('should return null for malformed LFS pointer', () => {
      const pointer = 'version https://git-lfs.github.com/spec/v1\nno oid here'
      const result = parseLfsPointer(encoder.encode(pointer))
      expect(result).toBeNull()
    })
  })

  describe('buildR2Key', () => {
    it('should build default key with 2-char prefix', () => {
      const sha = 'abc123def456789012345678901234567890abcd'
      expect(buildR2Key(sha)).toBe('objects/ab/c123def456789012345678901234567890abcd')
    })

    it('should use custom prefix', () => {
      const sha = 'abc123def456789012345678901234567890abcd'
      expect(buildR2Key(sha, 'myrepo/raw')).toBe('myrepo/raw/ab/c123def456789012345678901234567890abcd')
    })
  })

  describe('encodeGitObject', () => {
    it('should encode a small blob as inline', () => {
      const data = encoder.encode('hello world')
      const result = encodeGitObject('abc123' + '0'.repeat(34), 'blob', data)

      expect(result.storage).toBe('inline')
      expect(result.type).toBe('blob')
      expect(result.size).toBe(data.length)
      expect(result.path).toBeNull()
      expect(result.data.metadata).toBeInstanceOf(Uint8Array)
      expect(result.data.value).toBeInstanceOf(Uint8Array)
    })

    it('should encode with path', () => {
      const data = encoder.encode('content')
      const result = encodeGitObject('abc123' + '0'.repeat(34), 'blob', data, { path: 'src/index.ts' })
      expect(result.path).toBe('src/index.ts')
    })

    it('should encode a large blob as r2', () => {
      const data = new Uint8Array(INLINE_THRESHOLD + 1)
      const result = encodeGitObject('abc123' + '0'.repeat(34), 'blob', data)
      expect(result.storage).toBe('r2')
    })
  })

  describe('extractCommitFields', () => {
    it('should extract commit fields', () => {
      const commit = `tree ${'a'.repeat(40)}
parent ${'b'.repeat(40)}
author Alice <alice@x.com> 1704067200 +0000
committer Bob <bob@x.com> 1704067200 +0000

Initial commit`

      const result = extractCommitFields(encoder.encode(commit))
      expect(result).not.toBeNull()
      expect(result!.tree_sha).toBe('a'.repeat(40))
      expect(result!.parent_shas).toEqual(['b'.repeat(40)])
      expect(result!.author_name).toBe('Alice')
      expect(result!.author_date).toBe(1704067200000)
      expect(result!.message).toBe('Initial commit')
    })

    it('should handle root commit (no parents)', () => {
      const commit = `tree ${'a'.repeat(40)}
author Alice <alice@x.com> 1704067200 +0000
committer Bob <bob@x.com> 1704067200 +0000

Root commit`

      const result = extractCommitFields(encoder.encode(commit))
      expect(result).not.toBeNull()
      expect(result!.parent_shas).toBeUndefined()
    })

    it('should return null for non-commit data', () => {
      const result = extractCommitFields(encoder.encode(''))
      expect(result).toBeNull()
    })
  })

  describe('encodeObjectBatch', () => {
    it('should encode a batch of objects into column arrays', () => {
      const sha1 = 'a'.repeat(40)
      const sha2 = 'b'.repeat(40)
      const objects = [
        { sha: sha1, type: 'blob' as const, data: encoder.encode('hello') },
        { sha: sha2, type: 'blob' as const, data: encoder.encode('world'), path: 'test.txt' },
      ]

      const result = encodeObjectBatch(objects)

      expect(result.shas).toEqual([sha1, sha2])
      expect(result.types).toEqual(['blob', 'blob'])
      expect(result.sizes).toEqual([BigInt(5), BigInt(5)])
      expect(result.paths).toEqual([null, 'test.txt'])
      expect(result.storages).toEqual(['inline', 'inline'])
      expect(result.variantData).toHaveLength(2)
      expect(result.commitFields).toEqual([null, null])
    })
  })
})
