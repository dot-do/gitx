import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseCloneUrl,
  discoverRefs,
  fetchPack,
  extractPackData,
  unpackObjects,
  clone,
  type ParsedCloneUrl,
  type RefAdvertisement,
  type CloneResult,
  type CloneOptions
} from '../../src/ops/clone'
import { createMemoryBackend } from '../../src/core/backend'
import { createPackfile } from '../../src/pack/format'

// ============================================================================
// Test Helpers
// ============================================================================

const encoder = new TextEncoder()

/**
 * Create a mock fetch function for testing
 */
function createMockFetch(handlers: Record<string, {
  status: number
  headers?: Record<string, string>
  body?: string | Uint8Array
}>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const handler = handlers[url]
    if (!handler) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        text: async () => 'Not Found',
        arrayBuffer: async () => new ArrayBuffer(0)
      }
    }

    const headers = new Headers(handler.headers ?? {})
    return {
      ok: handler.status >= 200 && handler.status < 300,
      status: handler.status,
      statusText: handler.status === 200 ? 'OK' : 'Error',
      headers,
      text: async () => typeof handler.body === 'string' ? handler.body : '',
      arrayBuffer: async () => {
        if (handler.body instanceof Uint8Array) {
          return handler.body.buffer
        }
        return encoder.encode(handler.body ?? '').buffer
      }
    }
  }) as unknown as typeof fetch
}

/**
 * Build a mock ref advertisement response
 */
function buildRefAdvertisement(refs: Array<{ sha: string; name: string }>, capabilities: string[] = []): string {
  const lines: string[] = []

  // Service announcement
  lines.push('001e# service=git-upload-pack')
  lines.push('0000')

  // Refs
  const defaultCaps = ['multi_ack', 'thin-pack', 'side-band', 'side-band-64k', 'ofs-delta', 'agent=git/2.30.0']
  const allCaps = [...defaultCaps, ...capabilities]

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!
    let line = `${ref.sha} ${ref.name}`
    if (i === 0) {
      line += '\x00' + allCaps.join(' ')
    }
    const len = (line.length + 5).toString(16).padStart(4, '0')
    lines.push(`${len}${line}\n`)
  }

  lines.push('0000')
  return lines.join('')
}

/**
 * Create a simple packfile for testing
 */
function createTestPackfile(objects: Array<{ type: 'blob' | 'tree' | 'commit' | 'tag'; data: string }>): Uint8Array {
  const packableObjects = objects.map(obj => ({
    type: obj.type,
    data: encoder.encode(obj.data)
  }))
  return createPackfile(packableObjects)
}

/**
 * Create a mock upload-pack response with pack data
 */
function createUploadPackResponse(packData: Uint8Array, useSideBand = false): Uint8Array {
  const nakLine = encoder.encode('0008NAK\n')

  if (!useSideBand) {
    // Simple response: NAK + pack data
    const result = new Uint8Array(nakLine.length + packData.length)
    result.set(nakLine)
    result.set(packData, nakLine.length)
    return result
  }

  // Side-band response
  const parts: Uint8Array[] = [nakLine]

  // Split pack data into side-band packets
  const CHUNK_SIZE = 65515 // Max side-band packet size
  let offset = 0

  while (offset < packData.length) {
    const chunk = packData.slice(offset, offset + CHUNK_SIZE)
    const packetLen = chunk.length + 5 // 4 bytes length + 1 byte channel
    const lenHex = packetLen.toString(16).padStart(4, '0')

    const packet = new Uint8Array(packetLen)
    packet.set(encoder.encode(lenHex))
    packet[4] = 1 // Channel 1 = pack data
    packet.set(chunk, 5)

    parts.push(packet)
    offset += CHUNK_SIZE
  }

  // Flush packet
  parts.push(encoder.encode('0000'))

  // Concatenate all parts
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLen)
  let resultOffset = 0
  for (const part of parts) {
    result.set(part, resultOffset)
    resultOffset += part.length
  }

  return result
}

// ============================================================================
// URL Parsing Tests
// ============================================================================

describe('parseCloneUrl', () => {
  describe('HTTPS URLs', () => {
    it('should parse standard GitHub HTTPS URL', () => {
      const result = parseCloneUrl('https://github.com/user/repo.git')

      expect(result.protocol).toBe('https')
      expect(result.host).toBe('github.com')
      expect(result.port).toBeNull()
      expect(result.path).toBe('/user/repo.git')
      expect(result.baseUrl).toBe('https://github.com/user/repo.git')
    })

    it('should parse HTTPS URL without .git suffix', () => {
      const result = parseCloneUrl('https://github.com/user/repo')

      expect(result.protocol).toBe('https')
      expect(result.path).toBe('/user/repo')
    })

    it('should parse HTTPS URL with port', () => {
      const result = parseCloneUrl('https://github.com:443/user/repo.git')

      expect(result.host).toBe('github.com')
      expect(result.port).toBe(443)
    })

    it('should parse HTTPS URL with authentication credentials', () => {
      const result = parseCloneUrl('https://username:password@github.com/user/repo.git')

      expect(result.username).toBe('username')
      expect(result.password).toBe('password')
      expect(result.baseUrl).toBe('https://github.com/user/repo.git')
    })

    it('should parse HTTPS URL with token as password', () => {
      const result = parseCloneUrl('https://x-access-token:ghp_xxxx@github.com/user/repo.git')

      expect(result.username).toBe('x-access-token')
      expect(result.password).toBe('ghp_xxxx')
    })

    it('should handle GitLab HTTPS URLs', () => {
      const result = parseCloneUrl('https://gitlab.com/group/subgroup/repo.git')

      expect(result.host).toBe('gitlab.com')
      expect(result.path).toBe('/group/subgroup/repo.git')
    })

    it('should handle self-hosted Git server URLs', () => {
      const result = parseCloneUrl('https://git.example.com:8443/repos/myrepo.git')

      expect(result.host).toBe('git.example.com')
      expect(result.port).toBe(8443)
      expect(result.path).toBe('/repos/myrepo.git')
    })

    it('should upgrade http to https in protocol field', () => {
      const result = parseCloneUrl('http://github.com/user/repo.git')

      expect(result.protocol).toBe('https')
    })
  })

  describe('SSH URLs', () => {
    it('should parse SSH shorthand URL (git@host:path)', () => {
      const result = parseCloneUrl('git@github.com:user/repo.git')

      expect(result.protocol).toBe('ssh')
      expect(result.host).toBe('github.com')
      expect(result.username).toBe('git')
      expect(result.path).toBe('/user/repo.git')
    })

    it('should parse SSH shorthand with nested path', () => {
      const result = parseCloneUrl('git@gitlab.com:group/subgroup/repo.git')

      expect(result.path).toBe('/group/subgroup/repo.git')
    })

    it('should parse SSH URL format (ssh://)', () => {
      const result = parseCloneUrl('ssh://git@github.com/user/repo.git')

      expect(result.protocol).toBe('ssh')
      expect(result.host).toBe('github.com')
    })
  })

  describe('Invalid URLs', () => {
    it('should throw error for invalid URL format', () => {
      expect(() => parseCloneUrl('not-a-valid-url')).toThrow('Invalid URL')
    })

    it('should throw error for unsupported protocol', () => {
      expect(() => parseCloneUrl('ftp://example.com/repo.git')).toThrow('Unsupported protocol')
    })

    it('should throw error for file:// protocol', () => {
      expect(() => parseCloneUrl('file:///path/to/repo')).toThrow('Unsupported protocol')
    })
  })
})

// ============================================================================
// Ref Discovery Tests
// ============================================================================

describe('discoverRefs', () => {
  it('should discover refs from a remote repository', async () => {
    const refs = [
      { sha: 'a'.repeat(40), name: 'HEAD' },
      { sha: 'a'.repeat(40), name: 'refs/heads/main' },
      { sha: 'b'.repeat(40), name: 'refs/heads/feature' }
    ]

    const mockFetch = createMockFetch({
      'https://github.com/user/repo.git/info/refs?service=git-upload-pack': {
        status: 200,
        headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        body: buildRefAdvertisement(refs, ['symref=HEAD:refs/heads/main'])
      }
    })

    const result = await discoverRefs('https://github.com/user/repo.git', { fetch: mockFetch })

    expect(result.refs).toHaveLength(3)
    expect(result.refs.find(r => r.name === 'refs/heads/main')?.sha).toBe('a'.repeat(40))
    expect(result.head).toBe('a'.repeat(40))
  })

  it('should parse symref for default branch', async () => {
    const refs = [
      { sha: 'a'.repeat(40), name: 'HEAD' },
      { sha: 'a'.repeat(40), name: 'refs/heads/main' }
    ]

    const mockFetch = createMockFetch({
      'https://github.com/user/repo.git/info/refs?service=git-upload-pack': {
        status: 200,
        headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        body: buildRefAdvertisement(refs, ['symref=HEAD:refs/heads/main'])
      }
    })

    const result = await discoverRefs('https://github.com/user/repo.git', { fetch: mockFetch })

    expect(result.symrefs.get('HEAD')).toBe('refs/heads/main')
  })

  it('should include authentication header when credentials provided', async () => {
    const refs = [{ sha: 'a'.repeat(40), name: 'refs/heads/main' }]

    const mockFetch = createMockFetch({
      'https://github.com/user/repo.git/info/refs?service=git-upload-pack': {
        status: 200,
        headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        body: buildRefAdvertisement(refs)
      }
    })

    await discoverRefs('https://github.com/user/repo.git', {
      fetch: mockFetch,
      auth: { username: 'user', password: 'token' }
    })

    expect(mockFetch).toHaveBeenCalled()
    const callArgs = (mockFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    const headers = callArgs[1].headers as Record<string, string>
    expect(headers['Authorization']).toContain('Basic')
  })

  it('should throw error for non-Smart HTTP server', async () => {
    const mockFetch = createMockFetch({
      'https://github.com/user/repo.git/info/refs?service=git-upload-pack': {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: 'some plain text'
      }
    })

    await expect(discoverRefs('https://github.com/user/repo.git', { fetch: mockFetch }))
      .rejects.toThrow('Invalid content type')
  })

  it('should throw error for HTTP failure', async () => {
    const mockFetch = createMockFetch({
      'https://github.com/user/repo.git/info/refs?service=git-upload-pack': {
        status: 404,
        body: 'Not Found'
      }
    })

    await expect(discoverRefs('https://github.com/user/repo.git', { fetch: mockFetch }))
      .rejects.toThrow('Failed to discover refs: 404')
  })

  it('should throw error for SSH URLs', async () => {
    await expect(discoverRefs('git@github.com:user/repo.git'))
      .rejects.toThrow('SSH protocol is not yet supported')
  })
})

// ============================================================================
// Pack Data Extraction Tests
// ============================================================================

describe('extractPackData', () => {
  it('should extract pack data from simple response (no side-band)', () => {
    const packData = createTestPackfile([
      { type: 'blob', data: 'Hello, World!' }
    ])

    // Simple response: NAK + pack data
    const nak = encoder.encode('0008NAK\n')
    const response = new Uint8Array(nak.length + packData.length)
    response.set(nak)
    response.set(packData, nak.length)

    const result = extractPackData(response)

    // Verify PACK signature
    expect(String.fromCharCode(result[0]!, result[1]!, result[2]!, result[3]!)).toBe('PACK')
  })

  it('should extract pack data starting directly with PACK signature', () => {
    const packData = createTestPackfile([
      { type: 'blob', data: 'Hello, World!' }
    ])

    const result = extractPackData(packData)

    expect(String.fromCharCode(result[0]!, result[1]!, result[2]!, result[3]!)).toBe('PACK')
  })

  it('should throw error when no pack data is found', () => {
    const response = encoder.encode('0008NAK\n0000')

    expect(() => extractPackData(response)).toThrow('No pack data found')
  })
})

// ============================================================================
// Unpack Objects Tests
// ============================================================================

describe('unpackObjects', () => {
  it('should unpack a simple packfile with blob objects', async () => {
    const backend = createMemoryBackend()
    const packData = createTestPackfile([
      { type: 'blob', data: 'Hello, World!' },
      { type: 'blob', data: 'Another file' }
    ])

    const count = await unpackObjects(backend, packData)

    expect(count).toBe(2)
  })

  it('should unpack commit and tree objects', async () => {
    const backend = createMemoryBackend()

    // Create a minimal tree and commit
    const packData = createTestPackfile([
      { type: 'blob', data: 'file content' },
      { type: 'tree', data: '100644 file.txt\x00' + '\x00'.repeat(20) }, // Minimal tree entry
      { type: 'commit', data: 'tree ' + 'a'.repeat(40) + '\nauthor Test <test@test.com> 1704067200 +0000\ncommitter Test <test@test.com> 1704067200 +0000\n\nInitial commit' }
    ])

    const count = await unpackObjects(backend, packData)

    expect(count).toBe(3)
  })

  it('should call progress callback during unpacking', async () => {
    const backend = createMemoryBackend()
    const packData = createTestPackfile([
      { type: 'blob', data: 'Hello' }
    ])

    const progressMessages: string[] = []
    await unpackObjects(backend, packData, (msg) => progressMessages.push(msg))

    expect(progressMessages.length).toBeGreaterThan(0)
    expect(progressMessages.some(m => m.includes('Unpacking'))).toBe(true)
  })

  it('should throw error for invalid pack signature', async () => {
    const backend = createMemoryBackend()
    const invalidPack = encoder.encode('NOTPACK_SIGNATURE')

    await expect(unpackObjects(backend, invalidPack)).rejects.toThrow()
  })
})

// ============================================================================
// Full Clone Tests
// ============================================================================

describe('clone', () => {
  it('should clone an empty repository', async () => {
    const backend = createMemoryBackend()

    const mockFetch = createMockFetch({
      'https://github.com/user/empty-repo.git/info/refs?service=git-upload-pack': {
        status: 200,
        headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        body: buildRefAdvertisement([])
      }
    })

    const result = await clone('https://github.com/user/empty-repo.git', backend, { fetch: mockFetch })

    expect(result.success).toBe(true)
    expect(result.refs).toHaveLength(0)
    expect(result.objectCount).toBe(0)
  })

  it('should return error result for SSH URLs', async () => {
    const backend = createMemoryBackend()

    const result = await clone('git@github.com:user/repo.git', backend)

    expect(result.success).toBe(false)
    expect(result.error).toContain('SSH protocol is not yet supported')
  })

  it('should report branch not found when specified branch does not exist', async () => {
    const backend = createMemoryBackend()
    const refs = [
      { sha: 'a'.repeat(40), name: 'refs/heads/main' }
    ]

    const mockFetch = createMockFetch({
      'https://github.com/user/repo.git/info/refs?service=git-upload-pack': {
        status: 200,
        headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        body: buildRefAdvertisement(refs)
      }
    })

    const result = await clone('https://github.com/user/repo.git', backend, {
      fetch: mockFetch,
      branch: 'nonexistent'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Branch not found')
  })

  it('should call progress callback during clone', async () => {
    const backend = createMemoryBackend()

    const mockFetch = createMockFetch({
      'https://github.com/user/repo.git/info/refs?service=git-upload-pack': {
        status: 200,
        headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' },
        body: buildRefAdvertisement([])
      }
    })

    const progressMessages: string[] = []
    await clone('https://github.com/user/repo.git', backend, {
      fetch: mockFetch,
      onProgress: (msg) => progressMessages.push(msg)
    })

    expect(progressMessages.length).toBeGreaterThan(0)
    expect(progressMessages.some(m => m.includes('Cloning'))).toBe(true)
  })

  it('should return error result on network failure', async () => {
    const backend = createMemoryBackend()

    const mockFetch = createMockFetch({
      'https://github.com/user/repo.git/info/refs?service=git-upload-pack': {
        status: 500,
        body: 'Internal Server Error'
      }
    })

    const result = await clone('https://github.com/user/repo.git', backend, { fetch: mockFetch })

    expect(result.success).toBe(false)
    expect(result.error).toContain('500')
  })
})

// ============================================================================
// Integration-style Tests (with mock server)
// ============================================================================

describe('clone integration', () => {
  it('should parse URL and build correct endpoints', () => {
    const parsed = parseCloneUrl('https://github.com/user/repo.git')

    // Verify the URL can be used to construct endpoints
    expect(parsed.baseUrl + '/info/refs?service=git-upload-pack').toBe(
      'https://github.com/user/repo.git/info/refs?service=git-upload-pack'
    )
    expect(parsed.baseUrl + '/git-upload-pack').toBe(
      'https://github.com/user/repo.git/git-upload-pack'
    )
  })

  it('should handle various GitHub URL formats', () => {
    const formats = [
      'https://github.com/user/repo.git',
      'https://github.com/user/repo',
      'https://github.com/org/repo-name.git',
      'https://github.com/user/repo-with-dashes.git'
    ]

    for (const url of formats) {
      expect(() => parseCloneUrl(url)).not.toThrow()
    }
  })

  it('should preserve authentication credentials across operations', async () => {
    const refs = [{ sha: 'a'.repeat(40), name: 'refs/heads/main' }]

    let infoRefsAuthHeader: string | undefined
    let uploadPackAuthHeader: string | undefined

    const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
      const headers = options?.headers as Record<string, string> | undefined

      if (url.includes('/info/refs')) {
        infoRefsAuthHeader = headers?.['Authorization']
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/x-git-upload-pack-advertisement' }),
          text: async () => buildRefAdvertisement(refs),
          arrayBuffer: async () => new ArrayBuffer(0)
        }
      }

      if (url.includes('/git-upload-pack')) {
        uploadPackAuthHeader = headers?.['Authorization']
        // Return a simple NAK response (no pack data - will cause error but that's fine for this test)
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/x-git-upload-pack-result' }),
          text: async () => '0008NAK\n0000',
          arrayBuffer: async () => encoder.encode('0008NAK\n0000').buffer
        }
      }

      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        text: async () => 'Not Found',
        arrayBuffer: async () => new ArrayBuffer(0)
      }
    }) as unknown as typeof fetch

    const backend = createMemoryBackend()

    // Clone will fail at pack extraction but we can still verify auth headers
    await clone('https://github.com/user/repo.git', backend, {
      fetch: mockFetch,
      auth: { username: 'testuser', password: 'testtoken' }
    })

    // Both requests should have the same auth header
    expect(infoRefsAuthHeader).toBeDefined()
    expect(uploadPackAuthHeader).toBeDefined()
    expect(infoRefsAuthHeader).toBe(uploadPackAuthHeader)

    // Verify it's Basic auth with correct encoding
    const expectedAuth = 'Basic ' + btoa('testuser:testtoken')
    expect(infoRefsAuthHeader).toBe(expectedAuth)
  })
})
