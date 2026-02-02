import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  cloneFromUrl,
  parseRefAdvertisement,
  buildUploadPackRequest,
  extractPackfile,
  type CloneStorage,
} from '../../src/clone/http-clone'
import { encodePktLine, FLUSH_PKT } from '../../src/wire/pkt-line'
import { createPackfile, PackObjectType, encodeTypeAndSize } from '../../src/pack/format'
import pako from 'pako'
import { sha1Hex } from '../../src/utils/sha1'

// Helper encoders/decoders
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Sample SHA-1 hashes for testing
const SHA1_COMMIT_1 = 'a'.repeat(40)
const SHA1_COMMIT_2 = 'b'.repeat(40)
const SHA1_TREE_1 = 'c'.repeat(40)
const SHA1_BLOB_1 = 'd'.repeat(40)

// Helper to concatenate Uint8Arrays
function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// ============================================================================
// Mock Storage
// ============================================================================

function createMockStorage(): CloneStorage & {
  objects: Map<string, { type: string; data: Uint8Array }>
} {
  const objects = new Map<string, { type: string; data: Uint8Array }>()

  return {
    objects,
    async storeObject(type: string, data: Uint8Array): Promise<string> {
      // Compute SHA using Git's object format (type size\0data)
      const header = encoder.encode(`${type} ${data.length}\0`)
      const fullData = concatUint8Arrays(header, data)
      const sha = sha1Hex(fullData)
      objects.set(sha, { type, data: new Uint8Array(data) })
      return sha
    },
  }
}

// ============================================================================
// parseRefAdvertisement Tests
// ============================================================================

describe('parseRefAdvertisement', () => {
  it('should parse simple ref advertisement', () => {
    const advertisement =
      encodePktLine('# service=git-upload-pack\n') +
      FLUSH_PKT +
      encodePktLine(`${SHA1_COMMIT_1} refs/heads/main\0side-band-64k thin-pack\n`) +
      encodePktLine(`${SHA1_COMMIT_2} refs/heads/feature\n`) +
      FLUSH_PKT

    const { refs, capabilities } = parseRefAdvertisement(encoder.encode(advertisement))

    expect(refs).toHaveLength(2)
    expect(refs[0]).toEqual({
      sha: SHA1_COMMIT_1,
      name: 'refs/heads/main',
      capabilities: ['side-band-64k', 'thin-pack'],
    })
    expect(refs[1]).toEqual({
      sha: SHA1_COMMIT_2,
      name: 'refs/heads/feature',
    })
    expect(capabilities).toContain('side-band-64k')
    expect(capabilities).toContain('thin-pack')
  })

  it('should handle HEAD ref', () => {
    const advertisement =
      encodePktLine('# service=git-upload-pack\n') +
      FLUSH_PKT +
      encodePktLine(`${SHA1_COMMIT_1} HEAD\0ofs-delta\n`) +
      encodePktLine(`${SHA1_COMMIT_1} refs/heads/main\n`) +
      FLUSH_PKT

    const { refs } = parseRefAdvertisement(encoder.encode(advertisement))

    expect(refs).toHaveLength(2)
    expect(refs[0].name).toBe('HEAD')
    expect(refs[1].name).toBe('refs/heads/main')
  })

  it('should skip peeled refs', () => {
    const advertisement =
      encodePktLine('# service=git-upload-pack\n') +
      FLUSH_PKT +
      encodePktLine(`${SHA1_COMMIT_1} refs/tags/v1.0\0thin-pack\n`) +
      encodePktLine(`${SHA1_COMMIT_2} refs/tags/v1.0^{}\n`) +
      FLUSH_PKT

    const { refs } = parseRefAdvertisement(encoder.encode(advertisement))

    // Should only have the tag, not the peeled ref
    expect(refs).toHaveLength(1)
    expect(refs[0].name).toBe('refs/tags/v1.0')
  })

  it('should handle empty repository', () => {
    const advertisement =
      encodePktLine('# service=git-upload-pack\n') +
      FLUSH_PKT +
      FLUSH_PKT

    const { refs, capabilities } = parseRefAdvertisement(encoder.encode(advertisement))

    expect(refs).toHaveLength(0)
    expect(capabilities).toHaveLength(0)
  })

  it('should parse multiple capabilities', () => {
    const advertisement =
      encodePktLine('# service=git-upload-pack\n') +
      FLUSH_PKT +
      encodePktLine(
        `${SHA1_COMMIT_1} refs/heads/main\0` +
          'multi_ack_detailed side-band-64k thin-pack ofs-delta shallow no-progress\n'
      ) +
      FLUSH_PKT

    const { capabilities } = parseRefAdvertisement(encoder.encode(advertisement))

    expect(capabilities).toContain('multi_ack_detailed')
    expect(capabilities).toContain('side-band-64k')
    expect(capabilities).toContain('thin-pack')
    expect(capabilities).toContain('ofs-delta')
    expect(capabilities).toContain('shallow')
    expect(capabilities).toContain('no-progress')
  })

  it('should handle symref capability on ref line', () => {
    const advertisement =
      encodePktLine('# service=git-upload-pack\n') +
      FLUSH_PKT +
      encodePktLine(`${SHA1_COMMIT_1} HEAD\0thin-pack\n`) +
      encodePktLine(`${SHA1_COMMIT_1} refs/heads/main symref=HEAD:refs/heads/main\n`) +
      FLUSH_PKT

    const { refs } = parseRefAdvertisement(encoder.encode(advertisement))

    expect(refs).toHaveLength(2)
    // The symref info should be stripped from the ref name
    expect(refs[1].name).toBe('refs/heads/main')
  })
})

// ============================================================================
// buildUploadPackRequest Tests
// ============================================================================

describe('buildUploadPackRequest', () => {
  it('should build request with single want', () => {
    const refs = [{ sha: SHA1_COMMIT_1, name: 'refs/heads/main' }]
    const capabilities = ['no-progress', 'ofs-delta', 'thin-pack']

    const request = buildUploadPackRequest(refs, capabilities)
    const text = decoder.decode(request)

    expect(text).toContain(`want ${SHA1_COMMIT_1}`)
    expect(text).toContain('no-progress')
    expect(text).toContain('ofs-delta')
    expect(text).toContain(FLUSH_PKT)
    expect(text).toContain('done')
  })

  it('should deduplicate refs pointing to same SHA', () => {
    const refs = [
      { sha: SHA1_COMMIT_1, name: 'HEAD' },
      { sha: SHA1_COMMIT_1, name: 'refs/heads/main' },
      { sha: SHA1_COMMIT_2, name: 'refs/heads/feature' },
    ]
    const capabilities = ['no-progress']

    const request = buildUploadPackRequest(refs, capabilities)
    const text = decoder.decode(request)

    // Count occurrences of 'want'
    const wantMatches = text.match(/want /g)
    expect(wantMatches).toHaveLength(2) // Only 2 unique SHAs
  })

  it('should include capabilities only on first want', () => {
    const refs = [
      { sha: SHA1_COMMIT_1, name: 'refs/heads/main' },
      { sha: SHA1_COMMIT_2, name: 'refs/heads/feature' },
    ]
    const capabilities = ['no-progress', 'ofs-delta']

    const request = buildUploadPackRequest(refs, capabilities)
    const text = decoder.decode(request)

    // First want should have capabilities
    expect(text).toMatch(new RegExp(`want ${SHA1_COMMIT_1} .*no-progress`))

    // Second want should not have capabilities
    const lines = text.split('\n')
    const secondWantLine = lines.find((l) =>
      l.includes(`want ${SHA1_COMMIT_2}`) && !l.includes('no-progress')
    )
    expect(secondWantLine).toBeDefined()
  })

  it('should only request capabilities server supports', () => {
    const refs = [{ sha: SHA1_COMMIT_1, name: 'refs/heads/main' }]
    // Server only supports thin-pack, not the ones we want
    const capabilities = ['thin-pack', 'side-band-64k']

    const request = buildUploadPackRequest(refs, capabilities)
    const text = decoder.decode(request)

    // Should not include no-progress or ofs-delta since server doesn't support them
    expect(text).not.toContain('no-progress')
    expect(text).not.toContain('ofs-delta')
  })
})

// ============================================================================
// extractPackfile Tests
// ============================================================================

describe('extractPackfile', () => {
  it('should extract packfile starting with NAK', () => {
    // Create a minimal packfile
    const packHeader = new Uint8Array([
      0x50, 0x41, 0x43, 0x4b, // PACK
      0x00, 0x00, 0x00, 0x02, // Version 2
      0x00, 0x00, 0x00, 0x00, // 0 objects
    ])
    // Add 20-byte checksum (zeros for test)
    const packfile = concatUint8Arrays(packHeader, new Uint8Array(20))

    // Build response with NAK followed by packfile
    const nakLine = encodePktLine('NAK\n')
    const response = concatUint8Arrays(encoder.encode(nakLine), packfile)

    const extracted = extractPackfile(response)

    expect(extracted[0]).toBe(0x50) // P
    expect(extracted[1]).toBe(0x41) // A
    expect(extracted[2]).toBe(0x43) // C
    expect(extracted[3]).toBe(0x4b) // K
  })

  it('should extract packfile from side-band response', () => {
    // Create a minimal packfile
    const packHeader = new Uint8Array([
      0x50, 0x41, 0x43, 0x4b, // PACK
      0x00, 0x00, 0x00, 0x02, // Version 2
      0x00, 0x00, 0x00, 0x00, // 0 objects
    ])
    // Add 20-byte checksum
    const packfile = concatUint8Arrays(packHeader, new Uint8Array(20))

    // Wrap in side-band format (channel 1)
    const sideBandData = concatUint8Arrays(new Uint8Array([0x01]), packfile)
    const sideBandLength = (4 + sideBandData.length).toString(16).padStart(4, '0')
    const sideBandPacket = concatUint8Arrays(
      encoder.encode(sideBandLength),
      sideBandData
    )

    // Build response: NAK + side-band packet + flush
    const nakLine = encodePktLine('NAK\n')
    const response = concatUint8Arrays(
      encoder.encode(nakLine),
      sideBandPacket,
      encoder.encode(FLUSH_PKT)
    )

    const extracted = extractPackfile(response)

    expect(extracted[0]).toBe(0x50) // P
    expect(extracted[1]).toBe(0x41) // A
    expect(extracted[2]).toBe(0x43) // C
    expect(extracted[3]).toBe(0x4b) // K
  })

  it('should throw error for response without PACK', () => {
    const response = encoder.encode(
      encodePktLine('NAK\n') + FLUSH_PKT
    )

    expect(() => extractPackfile(response)).toThrow('No PACK signature found')
  })
})

// ============================================================================
// Integration Tests with Mocked Fetch
// ============================================================================

describe('cloneFromUrl integration', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should handle empty repository', async () => {
    const mockStorage = createMockStorage()

    // Mock empty ref advertisement
    const refAdvertisement =
      encodePktLine('# service=git-upload-pack\n') +
      FLUSH_PKT +
      FLUSH_PKT

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'Content-Type': 'application/x-git-upload-pack-advertisement',
      }),
      arrayBuffer: () => Promise.resolve(encoder.encode(refAdvertisement).buffer),
    })

    const result = await cloneFromUrl('https://github.com/test/empty.git', mockStorage)

    expect(result.refs.size).toBe(0)
    expect(mockStorage.objects.size).toBe(0)
  })

  it('should clone repository with single blob', async () => {
    const mockStorage = createMockStorage()

    // Create blob content
    const blobContent = encoder.encode('Hello, World!')
    // Compute blob SHA: hash of "blob <size>\0<content>"
    const blobHeader = encoder.encode(`blob ${blobContent.length}\0`)
    const blobWithHeader = concatUint8Arrays(blobHeader, blobContent)
    const blobSha = sha1Hex(blobWithHeader)

    // Create packfile with single blob
    const compressedBlob = pako.deflate(blobContent)
    const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_BLOB, blobContent.length)

    const packHeader = new Uint8Array([
      0x50, 0x41, 0x43, 0x4b, // PACK
      0x00, 0x00, 0x00, 0x02, // Version 2
      0x00, 0x00, 0x00, 0x01, // 1 object
    ])

    const packBody = concatUint8Arrays(typeAndSize, compressedBlob)
    const packWithoutChecksum = concatUint8Arrays(packHeader, packBody)

    // Compute checksum
    const checksum = new Uint8Array(20) // Simplified - real impl would compute SHA-1
    const packfile = concatUint8Arrays(packWithoutChecksum, checksum)

    // Mock ref advertisement
    const refAdvertisement =
      encodePktLine('# service=git-upload-pack\n') +
      FLUSH_PKT +
      encodePktLine(`${blobSha} refs/heads/main\0no-progress\n`) +
      FLUSH_PKT

    // Build upload-pack response
    const nakLine = encodePktLine('NAK\n')
    const uploadPackResponse = concatUint8Arrays(
      encoder.encode(nakLine),
      packfile
    )

    let fetchCallCount = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      fetchCallCount++
      if (fetchCallCount === 1) {
        // Ref discovery
        return Promise.resolve({
          ok: true,
          headers: new Headers({
            'Content-Type': 'application/x-git-upload-pack-advertisement',
          }),
          arrayBuffer: () => Promise.resolve(encoder.encode(refAdvertisement).buffer),
        })
      } else {
        // Upload pack
        return Promise.resolve({
          ok: true,
          headers: new Headers({
            'Content-Type': 'application/x-git-upload-pack-result',
          }),
          arrayBuffer: () => Promise.resolve(uploadPackResponse.buffer),
        })
      }
    })

    const result = await cloneFromUrl('https://github.com/test/repo.git', mockStorage)

    expect(result.refs.get('refs/heads/main')).toBe(blobSha)
    expect(mockStorage.objects.size).toBeGreaterThan(0)
  })

  it('should handle HTTP errors on ref discovery', async () => {
    const mockStorage = createMockStorage()

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })

    await expect(
      cloneFromUrl('https://github.com/test/nonexistent.git', mockStorage)
    ).rejects.toThrow('Failed to fetch refs: 404 Not Found')
  })

  it('should handle HTTP errors on packfile fetch', async () => {
    const mockStorage = createMockStorage()

    // Mock successful ref discovery
    const refAdvertisement =
      encodePktLine('# service=git-upload-pack\n') +
      FLUSH_PKT +
      encodePktLine(`${SHA1_COMMIT_1} refs/heads/main\0no-progress\n`) +
      FLUSH_PKT

    let fetchCallCount = 0
    globalThis.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++
      if (fetchCallCount === 1) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({
            'Content-Type': 'application/x-git-upload-pack-advertisement',
          }),
          arrayBuffer: () => Promise.resolve(encoder.encode(refAdvertisement).buffer),
        })
      } else {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
      }
    })

    await expect(
      cloneFromUrl('https://github.com/test/repo.git', mockStorage)
    ).rejects.toThrow('Failed to fetch packfile: 500 Internal Server Error')
  })

  it('should normalize URL with trailing slash', async () => {
    const mockStorage = createMockStorage()

    const refAdvertisement =
      encodePktLine('# service=git-upload-pack\n') +
      FLUSH_PKT +
      FLUSH_PKT

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        'Content-Type': 'application/x-git-upload-pack-advertisement',
      }),
      arrayBuffer: () => Promise.resolve(encoder.encode(refAdvertisement).buffer),
    })

    await cloneFromUrl('https://github.com/test/repo.git/', mockStorage)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://github.com/test/repo.git/info/refs?service=git-upload-pack',
      expect.any(Object)
    )
  })
})

// ============================================================================
// Packfile Parsing Edge Cases
// ============================================================================

describe('packfile parsing edge cases', () => {
  it('should handle packfile with only header and checksum', () => {
    const packHeader = new Uint8Array([
      0x50, 0x41, 0x43, 0x4b, // PACK
      0x00, 0x00, 0x00, 0x02, // Version 2
      0x00, 0x00, 0x00, 0x00, // 0 objects
    ])
    const checksum = new Uint8Array(20)
    const packfile = concatUint8Arrays(packHeader, checksum)

    // Build response
    const nakLine = encodePktLine('NAK\n')
    const response = concatUint8Arrays(encoder.encode(nakLine), packfile)

    const extracted = extractPackfile(response)

    expect(extracted.length).toBe(32) // 12 header + 20 checksum
  })
})
