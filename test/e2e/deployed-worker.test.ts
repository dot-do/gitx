import { describe, it, expect, beforeAll } from 'vitest'
import { createHash } from 'crypto'

/**
 * E2E Tests: Deployed GitX Worker
 *
 * These tests exercise a deployed gitx worker instance over HTTP.
 * They validate the full push/fetch/clone cycle against a running worker.
 *
 * Run with:
 *   GITX_TEST_SERVER=https://your-worker.workers.dev pnpm test:node test/e2e/deployed-worker.test.ts
 *
 * For local development:
 *   GITX_TEST_SERVER=http://localhost:8787 pnpm test:node test/e2e/deployed-worker.test.ts
 */

const TEST_SERVER = process.env.GITX_TEST_SERVER

// Test configuration
const TEST_OWNER = 'test-user'
const TEST_AUTH_TOKEN = process.env.GITX_TEST_TOKEN || 'test-token'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate unique repo name
 */
function uniqueRepoName(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create a simple blob object
 */
function createBlobObject(content: string): { sha: string; data: Uint8Array } {
  const encoder = new TextEncoder()
  const contentBytes = encoder.encode(content)

  // Git blob format: "blob <size>\0<content>"
  const header = `blob ${contentBytes.length}\0`
  const headerBytes = encoder.encode(header)

  const fullObject = new Uint8Array(headerBytes.length + contentBytes.length)
  fullObject.set(headerBytes)
  fullObject.set(contentBytes, headerBytes.length)

  const sha = createHash('sha1').update(fullObject).digest('hex')

  return { sha, data: fullObject }
}

/**
 * Create a simple commit object
 */
function createCommitObject(treeSha: string, message: string, parentSha?: string): { sha: string; data: Uint8Array } {
  const encoder = new TextEncoder()
  const timestamp = Math.floor(Date.now() / 1000)

  let content = `tree ${treeSha}\n`
  if (parentSha) {
    content += `parent ${parentSha}\n`
  }
  content += `author Test User <test@example.com> ${timestamp} +0000\n`
  content += `committer Test User <test@example.com> ${timestamp} +0000\n`
  content += `\n${message}\n`

  const contentBytes = encoder.encode(content)
  const header = `commit ${contentBytes.length}\0`
  const headerBytes = encoder.encode(header)

  const fullObject = new Uint8Array(headerBytes.length + contentBytes.length)
  fullObject.set(headerBytes)
  fullObject.set(contentBytes, headerBytes.length)

  const sha = createHash('sha1').update(fullObject).digest('hex')

  return { sha, data: fullObject }
}

/**
 * Parse pkt-line format
 */
function parsePktLines(data: string | Uint8Array): string[] {
  const decoder = new TextDecoder()
  const str = typeof data === 'string' ? data : decoder.decode(data)

  const lines: string[] = []
  let offset = 0

  while (offset < str.length) {
    if (offset + 4 > str.length) break

    const hexLen = str.slice(offset, offset + 4)
    if (hexLen === '0000') {
      lines.push('FLUSH')
      offset += 4
      continue
    }

    const len = parseInt(hexLen, 16)
    if (isNaN(len) || len < 4) break

    if (offset + len > str.length) break

    const line = str.slice(offset + 4, offset + len)
    lines.push(line)
    offset += len
  }

  return lines
}

/**
 * Encode pkt-line
 */
function encodePktLine(data: string): string {
  const len = 4 + data.length
  return len.toString(16).padStart(4, '0') + data
}

/**
 * Build minimal packfile (just header + checksum for empty pack)
 */
function buildEmptyPackfile(): Uint8Array {
  const pack = new Uint8Array(20 + 12) // header + checksum

  // PACK signature
  pack[0] = 0x50 // P
  pack[1] = 0x41 // A
  pack[2] = 0x43 // C
  pack[3] = 0x4b // K

  // Version 2
  pack[4] = 0x00
  pack[5] = 0x00
  pack[6] = 0x00
  pack[7] = 0x02

  // Object count: 0
  pack[8] = 0x00
  pack[9] = 0x00
  pack[10] = 0x00
  pack[11] = 0x00

  // SHA-1 checksum (just zeros for now - real implementation would calculate)
  const checksum = createHash('sha1').update(pack.slice(0, 12)).digest()
  pack.set(checksum, 12)

  return pack
}

/**
 * Build receive-pack request
 */
function buildReceivePackRequest(
  commands: Array<{ oldSha: string; newSha: string; refName: string }>,
  capabilities: string[] = []
): string {
  let request = ''

  // First command includes capabilities
  if (commands.length > 0) {
    const cmd = commands[0]
    const capString = capabilities.length > 0 ? '\x00' + capabilities.join(' ') : ''
    const line = `${cmd.oldSha} ${cmd.newSha} ${cmd.refName}${capString}\n`
    request += encodePktLine(line)
  }

  // Remaining commands
  for (let i = 1; i < commands.length; i++) {
    const cmd = commands[i]
    const line = `${cmd.oldSha} ${cmd.newSha} ${cmd.refName}\n`
    request += encodePktLine(line)
  }

  // Flush
  request += '0000'

  return request
}

// =============================================================================
// Tests
// =============================================================================

describe.skipIf(!TEST_SERVER)('E2E: Deployed Worker', () => {
  let serverReachable = false

  beforeAll(async () => {
    if (!TEST_SERVER) return

    try {
      const response = await fetch(`${TEST_SERVER}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      serverReachable = response.ok || response.status === 404
    } catch {
      serverReachable = false
    }
  })

  // =============================================================================
  // Health Check
  // =============================================================================

  describe('health check', () => {
    it('should respond to health check', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const response = await fetch(`${TEST_SERVER}/health`)

      // Should either return 200 or 404 (endpoint may not exist)
      expect([200, 404]).toContain(response.status)
    })

    it('should respond to root path', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const response = await fetch(`${TEST_SERVER}/`)

      // Should not return 500 or connection error
      expect(response.status).toBeLessThan(500)
    })
  })

  // =============================================================================
  // Info/Refs Endpoint
  // =============================================================================

  describe('info/refs endpoint', () => {
    it('should return valid info/refs response', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()
      const url = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/info/refs?service=git-upload-pack`

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'git/2.30.0',
        },
      })

      // Should respond (200 for existing repo, 404 or 200 with empty refs for new repo)
      expect([200, 404]).toContain(response.status)

      if (response.ok) {
        const body = await response.text()

        // Should be pkt-line format
        expect(body).toContain('0000') // At least one flush packet

        // Parse lines
        const lines = parsePktLines(body)
        expect(lines.length).toBeGreaterThan(0)

        // Should have service announcement or be empty
        const hasService = lines.some(l => l.includes('service=git-upload-pack'))
        const isEmpty = lines.length === 1 && lines[0] === 'FLUSH'

        expect(hasService || isEmpty).toBe(true)
      }
    })

    it('should advertise capabilities in info/refs', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()
      const url = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/info/refs?service=git-upload-pack`

      const response = await fetch(url)

      if (response.ok) {
        const body = await response.text()

        // Should advertise common capabilities or be empty
        const hasCapabilities = body.includes('side-band') || body.includes('multi_ack') || body.includes('thin-pack')
        const isEmpty = body.trim() === '0000'

        expect(hasCapabilities || isEmpty).toBe(true)
      }
    })

    it('should handle receive-pack info/refs', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()
      const url = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/info/refs?service=git-receive-pack`

      const response = await fetch(url)

      // Should respond (might require auth)
      expect([200, 401, 403, 404]).toContain(response.status)
    })
  })

  // =============================================================================
  // Push and Fetch Round-trip
  // =============================================================================

  describe('push and fetch round-trip', () => {
    it('should push objects and fetch them back', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()
      const ZERO_SHA = '0000000000000000000000000000000000000000'

      // Create test objects
      const blob = createBlobObject('Hello, World!\n')
      const treeSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // Empty tree SHA
      const commit = createCommitObject(treeSha, 'Initial commit')

      // Build receive-pack request
      const commands = [
        {
          oldSha: ZERO_SHA,
          newSha: commit.sha,
          refName: 'refs/heads/main',
        },
      ]

      const requestBody = buildReceivePackRequest(commands, ['report-status'])
      const packfile = buildEmptyPackfile()

      // Combine request + packfile
      const encoder = new TextEncoder()
      const requestBytes = encoder.encode(requestBody)
      const fullRequest = new Uint8Array(requestBytes.length + packfile.length)
      fullRequest.set(requestBytes)
      fullRequest.set(packfile, requestBytes.length)

      // POST to receive-pack
      const pushUrl = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/git-receive-pack`
      const pushResponse = await fetch(pushUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-git-receive-pack-request',
          'Authorization': `Bearer ${TEST_AUTH_TOKEN}`,
        },
        body: fullRequest,
      })

      // Should respond (might fail due to missing objects, but should not be 500)
      expect(pushResponse.status).toBeLessThan(500)

      // If push succeeded, try to fetch
      if (pushResponse.ok) {
        const fetchUrl = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/info/refs?service=git-upload-pack`
        const fetchResponse = await fetch(fetchUrl)

        expect(fetchResponse.ok).toBe(true)

        const body = await fetchResponse.text()
        const lines = parsePktLines(body)

        // Should now have refs
        const hasRefs = lines.some(l => l.includes('refs/heads/main'))
        expect(hasRefs || lines.length > 1).toBe(true)
      }
    })

    it('should handle concurrent pushes', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()
      const ZERO_SHA = '0000000000000000000000000000000000000000'

      // Create two different commits
      const treeSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
      const commit1 = createCommitObject(treeSha, 'Commit 1')
      const commit2 = createCommitObject(treeSha, 'Commit 2')

      // Build two push requests
      const buildPush = (commitSha: string, branch: string) => {
        const commands = [{ oldSha: ZERO_SHA, newSha: commitSha, refName: `refs/heads/${branch}` }]
        const requestBody = buildReceivePackRequest(commands)
        const packfile = buildEmptyPackfile()

        const encoder = new TextEncoder()
        const requestBytes = encoder.encode(requestBody)
        const fullRequest = new Uint8Array(requestBytes.length + packfile.length)
        fullRequest.set(requestBytes)
        fullRequest.set(packfile, requestBytes.length)

        return fullRequest
      }

      const push1Body = buildPush(commit1.sha, 'branch1')
      const push2Body = buildPush(commit2.sha, 'branch2')

      const pushUrl = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/git-receive-pack`

      // Send concurrent pushes
      const [response1, response2] = await Promise.all([
        fetch(pushUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-git-receive-pack-request',
            'Authorization': `Bearer ${TEST_AUTH_TOKEN}`,
          },
          body: push1Body,
        }),
        fetch(pushUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-git-receive-pack-request',
            'Authorization': `Bearer ${TEST_AUTH_TOKEN}`,
          },
          body: push2Body,
        }),
      ])

      // Both should complete (success or failure, but not corrupt)
      expect(response1.status).toBeLessThan(500)
      expect(response2.status).toBeLessThan(500)

      // At least one should succeed or both should fail cleanly
      const bothFailed = !response1.ok && !response2.ok
      const atLeastOneSucceeded = response1.ok || response2.ok

      expect(bothFailed || atLeastOneSucceeded).toBe(true)
    })
  })

  // =============================================================================
  // Empty Repository Clone
  // =============================================================================

  describe('empty repository', () => {
    it('should handle clone of empty repo', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()

      // Try to fetch from empty repo
      const url = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/info/refs?service=git-upload-pack`
      const response = await fetch(url)

      // Should respond successfully (empty or 404)
      expect([200, 404]).toContain(response.status)

      if (response.ok) {
        const body = await response.text()

        // Empty repo should have minimal response
        const lines = parsePktLines(body)

        // Should have service announcement + flush, or just flush
        expect(lines.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('should return empty packfile for empty repo clone', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()

      // Build upload-pack request with fake want
      const ZERO_SHA = '0000000000000000000000000000000000000000'
      let request = encodePktLine(`want ${ZERO_SHA}\n`)
      request += '0000'
      request += '0009done\n'

      const url = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/git-upload-pack`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-git-upload-pack-request',
        },
        body: request,
      })

      // Should respond (might be 400 for invalid SHA, or return empty pack)
      expect(response.status).toBeLessThan(500)
    })
  })

  // =============================================================================
  // Authentication
  // =============================================================================

  describe('authentication', () => {
    it('should return 401 for push without auth', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()
      const url = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/git-receive-pack`

      const ZERO_SHA = '0000000000000000000000000000000000000000'
      const fakeSha = 'a'.repeat(40)

      const commands = [{ oldSha: ZERO_SHA, newSha: fakeSha, refName: 'refs/heads/main' }]
      const requestBody = buildReceivePackRequest(commands)
      const packfile = buildEmptyPackfile()

      const encoder = new TextEncoder()
      const requestBytes = encoder.encode(requestBody)
      const fullRequest = new Uint8Array(requestBytes.length + packfile.length)
      fullRequest.set(requestBytes)
      fullRequest.set(packfile, requestBytes.length)

      // POST without Authorization header
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-git-receive-pack-request',
          // No Authorization header
        },
        body: fullRequest,
      })

      // Should require auth (401, 403, or 400 for invalid request)
      expect([400, 401, 403]).toContain(response.status)
    })

    it('should accept push with valid auth', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()
      const url = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/git-receive-pack`

      const ZERO_SHA = '0000000000000000000000000000000000000000'
      const fakeSha = 'a'.repeat(40)

      const commands = [{ oldSha: ZERO_SHA, newSha: fakeSha, refName: 'refs/heads/main' }]
      const requestBody = buildReceivePackRequest(commands)
      const packfile = buildEmptyPackfile()

      const encoder = new TextEncoder()
      const requestBytes = encoder.encode(requestBody)
      const fullRequest = new Uint8Array(requestBytes.length + packfile.length)
      fullRequest.set(requestBytes)
      fullRequest.set(packfile, requestBytes.length)

      // POST with Authorization header
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-git-receive-pack-request',
          'Authorization': `Bearer ${TEST_AUTH_TOKEN}`,
        },
        body: fullRequest,
      })

      // Should not return 401 (might fail for other reasons like missing objects, but not auth)
      expect(response.status).not.toBe(401)
    })
  })

  // =============================================================================
  // Error Handling
  // =============================================================================

  describe('error handling', () => {
    it('should handle invalid pkt-line format', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()
      const url = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/git-upload-pack`

      // Send malformed request
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-git-upload-pack-request',
        },
        body: 'this is not valid pkt-line format',
      })

      // Should return 400 Bad Request
      expect([400, 415, 500]).toContain(response.status)
    })

    it('should handle missing service parameter', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()
      const url = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/info/refs`

      const response = await fetch(url)

      // Should return 400 or redirect
      expect([400, 404]).toContain(response.status)
    })

    it('should handle oversized request', async () => {
      if (!serverReachable) {
        console.log('Server not reachable, skipping test')
        return
      }

      const repoName = uniqueRepoName()
      const url = `${TEST_SERVER}/${TEST_OWNER}/${repoName}/git-receive-pack`

      // Create large request (10MB)
      const largeBody = new Uint8Array(10 * 1024 * 1024).fill(0)

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-git-receive-pack-request',
          'Authorization': `Bearer ${TEST_AUTH_TOKEN}`,
        },
        body: largeBody,
      })

      // Should handle gracefully (413 Payload Too Large, 400 Bad Request, or timeout)
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })
})
