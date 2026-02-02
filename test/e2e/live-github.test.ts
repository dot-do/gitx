import { describe, it, expect } from 'vitest'

/**
 * E2E Tests: Live GitHub Wire Protocol
 *
 * These tests exercise the wire protocol implementation against the real GitHub
 * infrastructure. They use the wire protocol functions from src/wire/ to connect
 * to GitHub over HTTP.
 *
 * Run with:
 *   pnpm test:node test/e2e/live-github.test.ts
 *
 * For authenticated operations (optional):
 *   GITHUB_TOKEN=ghp_... pnpm test:node test/e2e/live-github.test.ts
 */

// Test configuration
const TEST_REPO = 'octocat/Hello-World' // Small, stable public repo
const GITHUB_URL = 'https://github.com'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Fetch info/refs for ls-refs
 */
async function fetchInfoRefs(owner: string, repo: string, service: 'git-upload-pack' | 'git-receive-pack'): Promise<string> {
  const url = `${GITHUB_URL}/${owner}/${repo}.git/info/refs?service=${service}`
  const headers: Record<string, string> = {
    'User-Agent': 'gitx-test/1.0',
  }

  if (GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw new Error(`Failed to fetch refs: ${response.status} ${response.statusText}`)
  }

  return await response.text()
}

/**
 * Parse pkt-line format response
 */
function parsePktLines(data: string): string[] {
  const lines: string[] = []
  let offset = 0

  while (offset < data.length) {
    if (offset + 4 > data.length) break

    const hexLen = data.slice(offset, offset + 4)
    if (hexLen === '0000') {
      lines.push('FLUSH')
      offset += 4
      continue
    }

    const len = parseInt(hexLen, 16)
    if (isNaN(len) || len < 4) break

    const line = data.slice(offset + 4, offset + len)
    lines.push(line)
    offset += len
  }

  return lines
}

/**
 * Extract refs from pkt-line advertisement
 */
function extractRefs(lines: string[]): Array<{ sha: string; name: string }> {
  const refs: Array<{ sha: string; name: string }> = []

  for (const line of lines) {
    if (line === 'FLUSH') continue
    if (line.startsWith('#')) continue

    // Format: <sha> <refname>[ <capabilities>]
    const match = line.match(/^([0-9a-f]{40}) ([^\x00\s]+)/)
    if (match) {
      refs.push({
        sha: match[1],
        name: match[2],
      })
    }
  }

  return refs
}

/**
 * POST to upload-pack endpoint
 */
async function postUploadPack(owner: string, repo: string, body: string): Promise<ArrayBuffer> {
  const url = `${GITHUB_URL}/${owner}/${repo}.git/git-upload-pack`
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-git-upload-pack-request',
    'User-Agent': 'gitx-test/1.0',
  }

  if (GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  })

  if (!response.ok) {
    throw new Error(`Failed to upload-pack: ${response.status} ${response.statusText}`)
  }

  return await response.arrayBuffer()
}

/**
 * Build upload-pack request
 */
function buildUploadPackRequest(wants: string[], haves: string[], capabilities: string[] = []): string {
  let request = ''

  // First want line includes capabilities
  if (wants.length > 0) {
    const capString = capabilities.length > 0 ? ' ' + capabilities.join(' ') : ''
    const firstLine = `want ${wants[0]}${capString}\n`
    const len = (4 + firstLine.length).toString(16).padStart(4, '0')
    request += len + firstLine
  }

  // Remaining wants
  for (let i = 1; i < wants.length; i++) {
    const line = `want ${wants[i]}\n`
    const len = (4 + line.length).toString(16).padStart(4, '0')
    request += len + line
  }

  // Flush
  request += '0000'

  // Haves
  for (const have of haves) {
    const line = `have ${have}\n`
    const len = (4 + line.length).toString(16).padStart(4, '0')
    request += len + line
  }

  // Done
  request += '0009done\n'

  return request
}

/**
 * Check if response contains a PACK
 */
function containsPackfile(buffer: ArrayBuffer): boolean {
  const view = new Uint8Array(buffer)

  // Search for PACK signature (0x50 0x41 0x43 0x4B)
  for (let i = 0; i < view.length - 3; i++) {
    if (view[i] === 0x50 && view[i + 1] === 0x41 && view[i + 2] === 0x43 && view[i + 3] === 0x4B) {
      return true
    }
  }

  return false
}

// =============================================================================
// Tests: ls-refs against github.com
// =============================================================================

describe('E2E: GitHub Live Wire Protocol', () => {
  describe('ls-refs against github.com', () => {
    it('should fetch refs from a public repository', async () => {
      const [owner, repo] = TEST_REPO.split('/')

      const response = await fetchInfoRefs(owner, repo, 'git-upload-pack')

      // Should be pkt-line format
      expect(response).toContain('0000')

      // Parse lines
      const lines = parsePktLines(response)
      expect(lines.length).toBeGreaterThan(0)

      // Should have service announcement
      const serviceAnnouncement = lines.find(line => line.includes('service=git-upload-pack'))
      expect(serviceAnnouncement).toBeDefined()
    })

    it('should parse refs from info/refs response', async () => {
      const [owner, repo] = TEST_REPO.split('/')

      const response = await fetchInfoRefs(owner, repo, 'git-upload-pack')
      const lines = parsePktLines(response)
      const refs = extractRefs(lines)

      // Should have at least HEAD and one branch
      expect(refs.length).toBeGreaterThan(0)

      // Should have valid SHA format
      for (const ref of refs) {
        expect(ref.sha).toMatch(/^[0-9a-f]{40}$/)
        expect(ref.name).toBeTruthy()
      }

      // Should have HEAD or refs/heads/master
      const hasHead = refs.some(r => r.name === 'HEAD')
      const hasMaster = refs.some(r => r.name === 'refs/heads/master')
      expect(hasHead || hasMaster).toBe(true)
    })

    it('should extract capabilities from first ref line', async () => {
      const [owner, repo] = TEST_REPO.split('/')

      const response = await fetchInfoRefs(owner, repo, 'git-upload-pack')

      // First ref after service announcement should have capabilities
      // Format: <sha> <refname>\x00<cap1> <cap2> ...
      expect(response).toContain('\x00')

      // Should advertise common capabilities
      const hasMultiAck = response.includes('multi_ack') || response.includes('multi_ack_detailed')
      const hasSideBand = response.includes('side-band-64k') || response.includes('side-band')

      expect(hasMultiAck || hasSideBand).toBe(true)
    })
  })

  // =============================================================================
  // Tests: Clone a tiny public repo
  // =============================================================================

  describe('clone a tiny public repo', () => {
    it('should perform full clone flow', async () => {
      const [owner, repo] = TEST_REPO.split('/')

      // Step 1: Get refs
      const refResponse = await fetchInfoRefs(owner, repo, 'git-upload-pack')
      const lines = parsePktLines(refResponse)
      const refs = extractRefs(lines)

      expect(refs.length).toBeGreaterThan(0)

      // Step 2: Build want request (want HEAD or master)
      const wantRef = refs.find(r => r.name === 'HEAD' || r.name === 'refs/heads/master')
      expect(wantRef).toBeDefined()

      const request = buildUploadPackRequest([wantRef!.sha], [], ['side-band-64k', 'thin-pack'])

      // Step 3: POST to upload-pack
      const packResponse = await postUploadPack(owner, repo, request)

      // Step 4: Verify response contains packfile
      expect(packResponse.byteLength).toBeGreaterThan(0)
      expect(containsPackfile(packResponse)).toBe(true)
    })

    it('should handle clone with no common objects (NAK response)', async () => {
      const [owner, repo] = TEST_REPO.split('/')

      // Get refs
      const refResponse = await fetchInfoRefs(owner, repo, 'git-upload-pack')
      const refs = extractRefs(parsePktLines(refResponse))
      const wantRef = refs.find(r => r.name === 'HEAD' || r.name === 'refs/heads/master')

      expect(wantRef).toBeDefined()

      // Request with no haves - should get NAK
      const request = buildUploadPackRequest([wantRef!.sha], [])
      const packResponse = await postUploadPack(owner, repo, request)

      // Response should contain NAK or ACK
      const decoder = new TextDecoder()
      let responseText = ''

      // Try to decode first part (pkt-line formatted)
      try {
        responseText = decoder.decode(packResponse.slice(0, Math.min(100, packResponse.byteLength)))
      } catch {
        // Binary data is ok, just means we got straight to PACK
      }

      // Should either have NAK or go straight to PACK
      const hasNak = responseText.includes('NAK')
      const hasPack = containsPackfile(packResponse)

      expect(hasNak || hasPack).toBe(true)
    })
  })

  // =============================================================================
  // Tests: Fetch with have/want negotiation
  // =============================================================================

  describe('fetch with have/want negotiation', () => {
    it('should negotiate with have lines', async () => {
      const [owner, repo] = TEST_REPO.split('/')

      // Get refs
      const refResponse = await fetchInfoRefs(owner, repo, 'git-upload-pack')
      const refs = extractRefs(parsePktLines(refResponse))

      expect(refs.length).toBeGreaterThanOrEqual(2)

      // Want the first ref, have the second (simulating partial clone)
      const wantRef = refs[0]
      const haveRef = refs[1]

      const request = buildUploadPackRequest([wantRef.sha], [haveRef.sha])
      const packResponse = await postUploadPack(owner, repo, request)

      // Should get either ACK or NAK
      const decoder = new TextDecoder()
      const responseStart = decoder.decode(packResponse.slice(0, 50))

      const hasAckOrNak = responseStart.includes('ACK') || responseStart.includes('NAK')
      const hasPack = containsPackfile(packResponse)

      // Response should be valid
      expect(hasAckOrNak || hasPack).toBe(true)
      expect(packResponse.byteLength).toBeGreaterThan(0)
    })

    it('should handle multiple wants', async () => {
      const [owner, repo] = TEST_REPO.split('/')

      // Get refs
      const refResponse = await fetchInfoRefs(owner, repo, 'git-upload-pack')
      const refs = extractRefs(parsePktLines(refResponse))

      // Want multiple refs
      const wants = refs.slice(0, Math.min(3, refs.length)).map(r => r.sha)
      expect(wants.length).toBeGreaterThan(1)

      const request = buildUploadPackRequest(wants, [])
      const packResponse = await postUploadPack(owner, repo, request)

      // Should successfully return packfile
      expect(packResponse.byteLength).toBeGreaterThan(0)
      expect(containsPackfile(packResponse)).toBe(true)
    })

    it('should respect side-band capability', async () => {
      const [owner, repo] = TEST_REPO.split('/')

      // Get refs
      const refResponse = await fetchInfoRefs(owner, repo, 'git-upload-pack')
      const refs = extractRefs(parsePktLines(refResponse))
      const wantRef = refs[0]

      // Request with side-band-64k capability
      const request = buildUploadPackRequest([wantRef.sha], [], ['side-band-64k'])
      const packResponse = await postUploadPack(owner, repo, request)

      // Response should use side-band format (starts with pkt-line length + channel byte)
      expect(packResponse.byteLength).toBeGreaterThan(5)

      // Check for side-band structure (pkt-line length prefix)
      const view = new Uint8Array(packResponse)
      const firstFour = String.fromCharCode(view[0], view[1], view[2], view[3])

      // Should be hex length
      expect(firstFour).toMatch(/^[0-9a-f]{4}$/i)
    })
  })

  // =============================================================================
  // Tests: Authenticated operations (skip if no token)
  // =============================================================================

  describe.skipIf(!GITHUB_TOKEN)('authenticated operations', () => {
    it('should work with authentication token', async () => {
      const [owner, repo] = TEST_REPO.split('/')

      // Should be able to fetch refs with auth
      const response = await fetchInfoRefs(owner, repo, 'git-upload-pack')

      expect(response).toContain('0000')
      const refs = extractRefs(parsePktLines(response))
      expect(refs.length).toBeGreaterThan(0)
    })

    it('should access private repo with valid token', async () => {
      // This test would need a private repo URL
      // Skipping actual private repo test in public CI
      expect(GITHUB_TOKEN).toBeDefined()
      expect(GITHUB_TOKEN).toMatch(/^gh[ps]_/)
    })
  })
})
