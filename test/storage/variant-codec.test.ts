import { describe, it, expect } from 'vitest'
import {
  detectStorageMode,
  parseLfsPointer,
  buildR2Key,
  encodeGitObject,
  decodeGitObject,
  decodeVariant,
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

  describe('decodeVariant', () => {
    it('should round-trip a blob through encode → decode', () => {
      const sha = 'a'.repeat(40)
      const data = encoder.encode('hello world')
      const encoded = encodeGitObject(sha, 'blob', data)

      const decoded = decodeGitObject(
        encoded.sha,
        encoded.type,
        encoded.size,
        encoded.path,
        encoded.storage,
        encoded.data.metadata,
        encoded.data.value,
      )

      expect(decoded.sha).toBe(sha)
      expect(decoded.type).toBe('blob')
      expect(decoded.size).toBe(data.length)
      expect(decoded.storage).toBe('inline')
      expect(decoded.path).toBeNull()
      expect(decoded.content).toBeInstanceOf(Uint8Array)
      expect(decoded.content).toEqual(data)
    })

    it('should round-trip a commit with shredded fields', () => {
      const sha = 'c'.repeat(40)
      const commitText = `tree ${'a'.repeat(40)}
parent ${'b'.repeat(40)}
author Alice <alice@x.com> 1704067200 +0000
committer Bob <bob@x.com> 1704067200 +0000

Initial commit`
      const data = encoder.encode(commitText)
      const encoded = encodeGitObject(sha, 'commit', data)

      const decoded = decodeGitObject(
        encoded.sha,
        encoded.type,
        encoded.size,
        encoded.path,
        encoded.storage,
        encoded.data.metadata,
        encoded.data.value,
      )

      expect(decoded.sha).toBe(sha)
      expect(decoded.type).toBe('commit')
      expect(decoded.size).toBe(data.length)
      expect(decoded.storage).toBe('inline')
      expect(decoded.content).toBeInstanceOf(Uint8Array)
      expect(decoded.content).toEqual(data)

      // Verify shredded fields can still be extracted from decoded content
      const fields = extractCommitFields(decoded.content as Uint8Array)
      expect(fields).not.toBeNull()
      expect(fields!.tree_sha).toBe('a'.repeat(40))
      expect(fields!.parent_shas).toEqual(['b'.repeat(40)])
      expect(fields!.author_name).toBe('Alice')
      expect(fields!.message).toBe('Initial commit')
    })

    it('should round-trip an LFS pointer', () => {
      const sha = 'd'.repeat(40)
      const oid = 'e'.repeat(64)
      const pointer = `version https://git-lfs.github.com/spec/v1
oid sha256:${oid}
size 12345
`
      const data = encoder.encode(pointer)
      const encoded = encodeGitObject(sha, 'blob', data)

      expect(encoded.storage).toBe('lfs')

      const decoded = decodeGitObject(
        encoded.sha,
        encoded.type,
        encoded.size,
        encoded.path,
        encoded.storage,
        encoded.data.metadata,
        encoded.data.value,
      )

      expect(decoded.sha).toBe(sha)
      expect(decoded.type).toBe('blob')
      expect(decoded.storage).toBe('lfs')
      // LFS stores an R2 key reference
      expect(typeof decoded.content).toBe('string')
      expect(decoded.content).toBe(`lfs/${oid.slice(0, 2)}/${oid.slice(2)}`)
    })

    it('should round-trip an R2 large blob', () => {
      const sha = 'f'.repeat(40)
      const data = new Uint8Array(INLINE_THRESHOLD + 1)
      data.fill(0x42)
      const encoded = encodeGitObject(sha, 'blob', data)

      expect(encoded.storage).toBe('r2')

      const decoded = decodeGitObject(
        encoded.sha,
        encoded.type,
        encoded.size,
        encoded.path,
        encoded.storage,
        encoded.data.metadata,
        encoded.data.value,
      )

      expect(decoded.sha).toBe(sha)
      expect(decoded.storage).toBe('r2')
      expect(typeof decoded.content).toBe('string')
      expect(decoded.content).toBe(`objects/${sha.slice(0, 2)}/${sha.slice(2)}`)
    })

    it('should decode VARIANT primitives correctly', () => {
      const { encodeVariant } = require('hyparquet-writer')

      // String
      const strEnc = encodeVariant('hello')
      expect(decodeVariant(strEnc.metadata, strEnc.value)).toBe('hello')

      // Number
      const numEnc = encodeVariant(42)
      expect(decodeVariant(numEnc.metadata, numEnc.value)).toBe(42)

      // Boolean
      const boolEnc = encodeVariant(true)
      expect(decodeVariant(boolEnc.metadata, boolEnc.value)).toBe(true)

      // Null
      const nullEnc = encodeVariant(null)
      expect(decodeVariant(nullEnc.metadata, nullEnc.value)).toBeNull()

      // Object
      const objEnc = encodeVariant({ key: 'value', num: 123 })
      const objDec = decodeVariant(objEnc.metadata, objEnc.value)
      expect(objDec).toEqual({ key: 'value', num: 123 })
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
