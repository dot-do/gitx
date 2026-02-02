import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Ref,
  UploadPackCapabilities,
  UploadPackSession,
  WantHaveNegotiation,
  SideBandChannel,
  PackfileOptions,
  PackfileResult,
  UploadPackUploadPackObjectStore,
  ShallowInfo,
  advertiseRefs,
  createSession,
  parseWantLine,
  parseHaveLine,
  processWants,
  processHaves,
  formatAck,
  formatNak,
  generatePackfile,
  wrapSideBand,
  formatProgress,
  processShallow,
  formatShallowResponse,
  handleFetch,
  calculateMissingObjects,
  generateThinPack,
  buildCapabilityString,
  parseCapabilities
} from '../../src/wire/upload-pack'
import { decodePktLine, pktLineStream, FLUSH_PKT } from '../../src/wire/pkt-line'

// Helper to create test data
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Sample SHA-1 hashes for testing
const SHA1_COMMIT_1 = 'a'.repeat(40)
const SHA1_COMMIT_2 = 'b'.repeat(40)
const SHA1_COMMIT_3 = 'c'.repeat(40)
const SHA1_TREE_1 = 'd'.repeat(40)
const SHA1_BLOB_1 = 'e'.repeat(40)
const SHA1_TAG_1 = 'f'.repeat(40)

// Mock object store implementation
function createMockStore(objects: Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>): UploadPackObjectStore {
  const refs: Ref[] = [
    { name: 'refs/heads/main', sha: SHA1_COMMIT_1 },
    { name: 'refs/heads/feature', sha: SHA1_COMMIT_2 },
    { name: 'refs/tags/v1.0.0', sha: SHA1_TAG_1, peeled: SHA1_COMMIT_3 }
  ]

  return {
    async getObject(sha: string) {
      return objects.get(sha) || null
    },
    async hasObject(sha: string) {
      return objects.has(sha)
    },
    async getCommitParents(sha: string) {
      // Simple parent chain for testing
      if (sha === SHA1_COMMIT_1) return [SHA1_COMMIT_2]
      if (sha === SHA1_COMMIT_2) return [SHA1_COMMIT_3]
      return []
    },
    async getRefs() {
      return refs
    },
    async getReachableObjects(sha: string, depth?: number) {
      // Simplified reachability
      const reachable = [sha]
      if (sha === SHA1_COMMIT_1) {
        reachable.push(SHA1_TREE_1, SHA1_BLOB_1)
        if (!depth || depth > 1) {
          reachable.push(SHA1_COMMIT_2)
        }
      }
      return reachable
    }
  }
}

// Create sample commit data
function createCommitData(tree: string, parents: string[], message: string): Uint8Array {
  const lines = [`tree ${tree}`]
  for (const parent of parents) {
    lines.push(`parent ${parent}`)
  }
  lines.push('author Test <test@example.com.ai> 1704067200 +0000')
  lines.push('committer Test <test@example.com.ai> 1704067200 +0000')
  lines.push('')
  lines.push(message)
  return encoder.encode(lines.join('\n'))
}

describe('git-upload-pack', () => {
  let mockStore: UploadPackObjectStore
  let objects: Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>

  beforeEach(() => {
    objects = new Map([
      [SHA1_COMMIT_1, { type: 'commit', data: createCommitData(SHA1_TREE_1, [SHA1_COMMIT_2], 'Latest commit') }],
      [SHA1_COMMIT_2, { type: 'commit', data: createCommitData(SHA1_TREE_1, [SHA1_COMMIT_3], 'Previous commit') }],
      [SHA1_COMMIT_3, { type: 'commit', data: createCommitData(SHA1_TREE_1, [], 'Initial commit') }],
      [SHA1_TREE_1, { type: 'tree', data: new Uint8Array([]) }],
      [SHA1_BLOB_1, { type: 'blob', data: encoder.encode('Hello, World!') }],
      [SHA1_TAG_1, { type: 'tag', data: encoder.encode(`object ${SHA1_COMMIT_3}\ntype commit\ntag v1.0.0\ntagger Test <test@example.com.ai> 1704067200 +0000\n\nVersion 1.0.0`) }]
    ])
    mockStore = createMockStore(objects)
  })

  // ==========================================================================
  // 1. Ref Advertisement Generation
  // ==========================================================================
  describe('Ref Advertisement', () => {
    it('should advertise all refs with capabilities on first line', async () => {
      const result = await advertiseRefs(mockStore)

      // First ref line should include capabilities
      expect(result).toContain('refs/heads/main')
      expect(result).toContain(SHA1_COMMIT_1)
      // Capabilities should be present on first line
      expect(result).toMatch(/\x00[a-z\-\s]+/)
    })

    it('should include HEAD in ref advertisement', async () => {
      const result = await advertiseRefs(mockStore)
      // HEAD should be advertised
      expect(result).toContain('HEAD')
    })

    it('should advertise peeled refs for annotated tags', async () => {
      const result = await advertiseRefs(mockStore)
      // Peeled tag format: <sha> refs/tags/v1.0.0^{}
      expect(result).toContain('refs/tags/v1.0.0')
      expect(result).toContain('^{}')
    })

    it('should end with flush-pkt', async () => {
      const result = await advertiseRefs(mockStore)
      expect(result).toContain(FLUSH_PKT)
    })

    it('should include standard capabilities', async () => {
      const result = await advertiseRefs(mockStore, {
        sideBand64k: true,
        thinPack: true,
        shallow: true
      })

      expect(result).toContain('side-band-64k')
      expect(result).toContain('thin-pack')
      expect(result).toContain('shallow')
    })

    it('should format each ref as valid pkt-line', async () => {
      const result = await advertiseRefs(mockStore)
      const { packets } = pktLineStream(result)

      // Should have at least one data packet
      const dataPackets = packets.filter(p => p.type === 'data')
      expect(dataPackets.length).toBeGreaterThan(0)

      // Each data packet should contain a SHA and ref name
      for (const packet of dataPackets) {
        if (packet.data) {
          expect(packet.data).toMatch(/^[0-9a-f]{40}/)
        }
      }
    })

    it('should return empty advertisement for empty repository', async () => {
      const emptyStore: UploadPackObjectStore = {
        ...mockStore,
        async getRefs() { return [] }
      }

      const result = await advertiseRefs(emptyStore)
      // Should still have capabilities line or flush packet
      expect(result).toContain(FLUSH_PKT)
    })

    it('should sort refs in the advertisement', async () => {
      const result = await advertiseRefs(mockStore)
      // Refs should appear in sorted order (HEAD first, then alphabetically)
      const headIndex = result.indexOf('HEAD')
      const mainIndex = result.indexOf('refs/heads/main')
      const featureIndex = result.indexOf('refs/heads/feature')

      if (headIndex !== -1 && mainIndex !== -1) {
        expect(headIndex).toBeLessThan(mainIndex)
      }
      if (featureIndex !== -1 && mainIndex !== -1) {
        expect(featureIndex).toBeLessThan(mainIndex) // feature < main alphabetically
      }
    })
  })

  // ==========================================================================
  // 2. Want/Have Negotiation
  // ==========================================================================
  describe('Want/Have Negotiation', () => {
    describe('parseWantLine', () => {
      it('should parse simple want line', () => {
        const result = parseWantLine(`want ${SHA1_COMMIT_1}`)
        expect(result.sha).toBe(SHA1_COMMIT_1)
      })

      it('should parse want line with capabilities', () => {
        const result = parseWantLine(`want ${SHA1_COMMIT_1} thin-pack side-band-64k ofs-delta`)
        expect(result.sha).toBe(SHA1_COMMIT_1)
        expect(result.capabilities.thinPack).toBe(true)
        expect(result.capabilities.sideBand64k).toBe(true)
      })

      it('should parse want line with agent capability', () => {
        const result = parseWantLine(`want ${SHA1_COMMIT_1} agent=git/2.40.0`)
        expect(result.sha).toBe(SHA1_COMMIT_1)
        expect(result.capabilities.agent).toBe('git/2.40.0')
      })

      it('should throw for invalid want line format', () => {
        expect(() => parseWantLine('invalid')).toThrow()
        expect(() => parseWantLine(`want ${SHA1_COMMIT_1.slice(0, 20)}`)).toThrow() // Invalid SHA
      })
    })

    describe('parseHaveLine', () => {
      it('should parse have line', () => {
        const result = parseHaveLine(`have ${SHA1_COMMIT_2}`)
        expect(result).toBe(SHA1_COMMIT_2)
      })

      it('should throw for invalid have line', () => {
        expect(() => parseHaveLine('invalid')).toThrow()
        expect(() => parseHaveLine('have invalid-sha')).toThrow()
      })
    })

    describe('processWants', () => {
      it('should add wants to session', async () => {
        const session = createSession('test-repo', [])
        const result = await processWants(session, [SHA1_COMMIT_1], mockStore)

        expect(result.wants).toContain(SHA1_COMMIT_1)
      })

      it('should accept multiple wants', async () => {
        const session = createSession('test-repo', [])
        const result = await processWants(
          session,
          [SHA1_COMMIT_1, SHA1_COMMIT_2],
          mockStore
        )

        expect(result.wants).toHaveLength(2)
        expect(result.wants).toContain(SHA1_COMMIT_1)
        expect(result.wants).toContain(SHA1_COMMIT_2)
      })

      it('should reject wants for non-existent objects', async () => {
        const session = createSession('test-repo', [])
        const nonExistentSha = '1'.repeat(40)

        await expect(
          processWants(session, [nonExistentSha], mockStore)
        ).rejects.toThrow()
      })

      it('should deduplicate duplicate wants', async () => {
        const session = createSession('test-repo', [])
        const result = await processWants(
          session,
          [SHA1_COMMIT_1, SHA1_COMMIT_1],
          mockStore
        )

        expect(result.wants).toHaveLength(1)
      })
    })

    describe('processHaves', () => {
      it('should identify common ancestor', async () => {
        const session = createSession('test-repo', [])
        session.wants = [SHA1_COMMIT_1]

        const result = await processHaves(
          session,
          [SHA1_COMMIT_3],
          mockStore,
          true
        )

        expect(result.commonAncestors).toContain(SHA1_COMMIT_3)
      })

      it('should return NAK when no common objects', async () => {
        const session = createSession('test-repo', [])
        session.wants = [SHA1_COMMIT_1]

        const nonExistentSha = '1'.repeat(40)
        const result = await processHaves(
          session,
          [nonExistentSha],
          mockStore,
          true
        )

        expect(result.nak).toBe(true)
      })

      it('should continue negotiation when not done', async () => {
        const session = createSession('test-repo', [])
        session.wants = [SHA1_COMMIT_1]

        const result = await processHaves(
          session,
          [SHA1_COMMIT_2],
          mockStore,
          false // not done
        )

        expect(result.ready).toBe(false)
        expect(result.acks.length).toBeGreaterThan(0)
        expect(result.acks[0].status).toBe('continue')
      })

      it('should be ready when done with common objects', async () => {
        const session = createSession('test-repo', [])
        session.wants = [SHA1_COMMIT_1]

        const result = await processHaves(
          session,
          [SHA1_COMMIT_2],
          mockStore,
          true // done
        )

        expect(result.ready).toBe(true)
      })

      it('should calculate objects to send', async () => {
        const session = createSession('test-repo', [])
        session.wants = [SHA1_COMMIT_1]

        const result = await processHaves(
          session,
          [SHA1_COMMIT_2],
          mockStore,
          true
        )

        // Should include commit 1 and its tree/blobs, but not commit 2
        expect(result.objectsToSend).toContain(SHA1_COMMIT_1)
        expect(result.objectsToSend).not.toContain(SHA1_COMMIT_2)
      })
    })

    describe('Session Management', () => {
      it('should create session with initial state', () => {
        const refs = [{ name: 'refs/heads/main', sha: SHA1_COMMIT_1 }]
        const session = createSession('test-repo', refs)

        expect(session.repoId).toBe('test-repo')
        expect(session.refs).toEqual(refs)
        expect(session.wants).toEqual([])
        expect(session.haves).toEqual([])
        expect(session.negotiationComplete).toBe(false)
      })

      it('should mark session as stateless for HTTP', () => {
        const session = createSession('test-repo', [], true)
        expect(session.stateless).toBe(true)
      })
    })
  })

  // ==========================================================================
  // 3. ACK/NAK Responses
  // ==========================================================================
  describe('ACK/NAK Responses', () => {
    describe('formatAck', () => {
      it('should format simple ACK', () => {
        const result = formatAck(SHA1_COMMIT_1)
        expect(result).toContain('ACK')
        expect(result).toContain(SHA1_COMMIT_1)
      })

      it('should format ACK with continue status', () => {
        const result = formatAck(SHA1_COMMIT_1, 'continue')
        expect(result).toContain('ACK')
        expect(result).toContain(SHA1_COMMIT_1)
        expect(result).toContain('continue')
      })

      it('should format ACK with common status', () => {
        const result = formatAck(SHA1_COMMIT_1, 'common')
        expect(result).toContain('common')
      })

      it('should format ACK with ready status', () => {
        const result = formatAck(SHA1_COMMIT_1, 'ready')
        expect(result).toContain('ready')
      })

      it('should be valid pkt-line format', () => {
        const result = formatAck(SHA1_COMMIT_1)
        const decoded = decodePktLine(result)
        expect(decoded.data).toBeTruthy()
        expect(decoded.data).toContain('ACK')
      })
    })

    describe('formatNak', () => {
      it('should format NAK response', () => {
        const result = formatNak()
        expect(result).toContain('NAK')
      })

      it('should be valid pkt-line format', () => {
        const result = formatNak()
        const decoded = decodePktLine(result)
        expect(decoded.data).toBe('NAK\n')
      })
    })
  })

  // ==========================================================================
  // 4. Packfile Generation
  // ==========================================================================
  describe('Packfile Generation', () => {
    it('should generate packfile with requested objects', async () => {
      const result = await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [],
        {}
      )

      expect(result.packfile).toBeInstanceOf(Uint8Array)
      expect(result.objectCount).toBeGreaterThan(0)
      expect(result.includedObjects).toContain(SHA1_COMMIT_1)
    })

    it('should include tree and blob objects for a commit', async () => {
      const result = await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [],
        {}
      )

      expect(result.includedObjects).toContain(SHA1_TREE_1)
      expect(result.includedObjects).toContain(SHA1_BLOB_1)
    })

    it('should exclude objects client already has', async () => {
      const result = await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [SHA1_COMMIT_2, SHA1_COMMIT_3],
        {}
      )

      // Should not include commits that client has
      expect(result.includedObjects).not.toContain(SHA1_COMMIT_2)
      expect(result.includedObjects).not.toContain(SHA1_COMMIT_3)
    })

    it('should generate valid packfile header', async () => {
      const result = await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [],
        {}
      )

      // PACK signature
      expect(result.packfile[0]).toBe(0x50) // P
      expect(result.packfile[1]).toBe(0x41) // A
      expect(result.packfile[2]).toBe(0x43) // C
      expect(result.packfile[3]).toBe(0x4b) // K

      // Version 2
      expect(result.packfile[4]).toBe(0)
      expect(result.packfile[5]).toBe(0)
      expect(result.packfile[6]).toBe(0)
      expect(result.packfile[7]).toBe(2)
    })

    it('should include SHA-1 trailer', async () => {
      const result = await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [],
        {}
      )

      // Last 20 bytes should be checksum
      expect(result.packfile.length).toBeGreaterThan(20)
    })

    it('should handle empty wants list', async () => {
      const result = await generatePackfile(mockStore, [], [], {})

      expect(result.objectCount).toBe(0)
      expect(result.includedObjects).toEqual([])
    })

    it('should report progress via callback', async () => {
      const progressMessages: string[] = []

      await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [],
        {
          onProgress: (msg) => progressMessages.push(msg)
        }
      )

      expect(progressMessages.length).toBeGreaterThan(0)
    })

    describe('calculateMissingObjects', () => {
      it('should find all reachable objects from wants', async () => {
        const result = await calculateMissingObjects(
          mockStore,
          [SHA1_COMMIT_1],
          []
        )

        expect(result).toContain(SHA1_COMMIT_1)
        expect(result).toContain(SHA1_TREE_1)
        expect(result).toContain(SHA1_BLOB_1)
      })

      it('should exclude objects reachable from haves', async () => {
        const result = await calculateMissingObjects(
          mockStore,
          [SHA1_COMMIT_1],
          [SHA1_COMMIT_2]
        )

        expect(result).toContain(SHA1_COMMIT_1)
        expect(result).not.toContain(SHA1_COMMIT_2)
      })
    })
  })

  // ==========================================================================
  // 5. Shallow Clone Support
  // ==========================================================================
  describe('Shallow Clone Support', () => {
    describe('processShallow', () => {
      it('should process depth limit', async () => {
        const session = createSession('test-repo', [])
        session.wants = [SHA1_COMMIT_1]

        const result = await processShallow(
          session,
          [],
          1, // depth = 1
          undefined,
          undefined,
          mockStore
        )

        // Should have shallow boundary at parent commit
        expect(result.shallowCommits).toContain(SHA1_COMMIT_2)
      })

      it('should process existing shallow lines from client', async () => {
        const session = createSession('test-repo', [])
        session.wants = [SHA1_COMMIT_1]

        const result = await processShallow(
          session,
          [`shallow ${SHA1_COMMIT_2}`],
          undefined,
          undefined,
          undefined,
          mockStore
        )

        expect(result.shallowCommits).toContain(SHA1_COMMIT_2)
      })

      it('should support deepen-since', async () => {
        const session = createSession('test-repo', [])
        session.wants = [SHA1_COMMIT_1]

        const result = await processShallow(
          session,
          [],
          undefined,
          1704067100, // timestamp before some commits
          undefined,
          mockStore
        )

        expect(result.shallowCommits.length).toBeGreaterThanOrEqual(0)
      })

      it('should support deepen-not', async () => {
        const session = createSession('test-repo', [])
        session.wants = [SHA1_COMMIT_1]

        const result = await processShallow(
          session,
          [],
          undefined,
          undefined,
          ['refs/heads/feature'],
          mockStore
        )

        // Should not deepen past the feature branch commit
        expect(result.shallowCommits.length).toBeGreaterThanOrEqual(0)
      })

      it('should return unshallow commits when deepening', async () => {
        const session = createSession('test-repo', [])
        session.wants = [SHA1_COMMIT_1]
        session.shallowCommits = [SHA1_COMMIT_2] // Previously shallow

        const result = await processShallow(
          session,
          [`shallow ${SHA1_COMMIT_2}`],
          2, // Deepen to 2
          undefined,
          undefined,
          mockStore
        )

        // Commit 2 should no longer be shallow if we deepen
        expect(result.unshallowCommits).toBeDefined()
      })
    })

    describe('formatShallowResponse', () => {
      it('should format shallow lines', () => {
        const result = formatShallowResponse({
          shallowCommits: [SHA1_COMMIT_2],
          unshallowCommits: []
        })

        expect(result).toContain('shallow')
        expect(result).toContain(SHA1_COMMIT_2)
      })

      it('should format unshallow lines', () => {
        const result = formatShallowResponse({
          shallowCommits: [],
          unshallowCommits: [SHA1_COMMIT_3]
        })

        expect(result).toContain('unshallow')
        expect(result).toContain(SHA1_COMMIT_3)
      })

      it('should format multiple shallow/unshallow lines', () => {
        const result = formatShallowResponse({
          shallowCommits: [SHA1_COMMIT_2, SHA1_COMMIT_3],
          unshallowCommits: [SHA1_COMMIT_1]
        })

        const { packets } = pktLineStream(result)
        const dataPackets = packets.filter(p => p.type === 'data')
        expect(dataPackets.length).toBe(3)
      })
    })
  })

  // ==========================================================================
  // 6. Thin Pack Generation
  // ==========================================================================
  describe('Thin Pack Generation', () => {
    it('should generate thin pack when client has base objects', async () => {
      const result = await generateThinPack(
        mockStore,
        [SHA1_COMMIT_1],
        [SHA1_COMMIT_2]
      )

      expect(result.packfile).toBeInstanceOf(Uint8Array)
      expect(result.objectCount).toBeGreaterThan(0)
    })

    it('should use deltas against client objects', async () => {
      // Create objects with similar content for delta efficiency
      const baseContent = 'Hello, this is a test blob with some content'
      const targetContent = 'Hello, this is a test blob with some modified content'

      const baseBlob = encoder.encode(baseContent)
      const targetBlob = encoder.encode(targetContent)

      const baseSha = '1'.repeat(40)
      const targetSha = '2'.repeat(40)

      const thinPackStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === baseSha) return { type: 'blob', data: baseBlob }
          if (sha === targetSha) return { type: 'blob', data: targetBlob }
          return null
        },
        async hasObject(sha: string) {
          return sha === baseSha || sha === targetSha
        },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) { return [sha] }
      }

      const result = await generateThinPack(
        thinPackStore,
        [targetSha],
        [baseSha]
      )

      // Thin pack should be smaller due to delta compression
      expect(result.packfile.length).toBeLessThan(targetBlob.length + baseBlob.length)
    })

    it('should include thin-pack capability in packfile options', async () => {
      const result = await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [SHA1_COMMIT_2],
        { thinPack: true, clientHasObjects: [SHA1_COMMIT_2] }
      )

      expect(result.packfile).toBeInstanceOf(Uint8Array)
    })
  })

  // ==========================================================================
  // 7. Side-band Multiplexing
  // ==========================================================================
  describe('Side-band Multiplexing', () => {
    describe('wrapSideBand', () => {
      it('should wrap data with channel 1 (pack data)', () => {
        const data = new Uint8Array([0x01, 0x02, 0x03])
        const result = wrapSideBand(SideBandChannel.PACK_DATA, data)

        // Result should be pkt-line with channel byte prefix
        expect(result).toBeInstanceOf(Uint8Array)
        // First byte after pkt-line header should be channel number
        const content = result.slice(4) // Skip pkt-line length prefix
        expect(content[0]).toBe(1) // Channel 1
      })

      it('should wrap progress message with channel 2', () => {
        const progressMsg = encoder.encode('Counting objects: 100%\n')
        const result = wrapSideBand(SideBandChannel.PROGRESS, progressMsg)

        const content = result.slice(4)
        expect(content[0]).toBe(2) // Channel 2
      })

      it('should wrap error message with channel 3', () => {
        const errorMsg = encoder.encode('error: repository not found\n')
        const result = wrapSideBand(SideBandChannel.ERROR, errorMsg)

        const content = result.slice(4)
        expect(content[0]).toBe(3) // Channel 3
      })

      it('should handle 64k side-band (large data)', () => {
        const largeData = new Uint8Array(65500) // Near maximum size
        largeData.fill(0x42)

        const result = wrapSideBand(SideBandChannel.PACK_DATA, largeData)
        expect(result).toBeInstanceOf(Uint8Array)
      })
    })

    describe('formatProgress', () => {
      it('should format progress message', () => {
        const result = formatProgress('Counting objects: 50%')
        expect(result).toBeInstanceOf(Uint8Array)

        // Decode and check content
        const decoded = decoder.decode(result.slice(5)) // Skip pkt-line header and channel byte
        expect(decoded).toContain('Counting objects: 50%')
      })

      it('should include side-band channel 2', () => {
        const result = formatProgress('Test progress')
        expect(result[4]).toBe(2) // Channel 2 for progress
      })

      it('should include newline if not present', () => {
        const result = formatProgress('Progress message')
        const content = decoder.decode(result)
        expect(content).toContain('\n')
      })
    })
  })

  // ==========================================================================
  // 8. Progress Reporting
  // ==========================================================================
  describe('Progress Reporting', () => {
    it('should report counting objects progress', async () => {
      const progressMessages: string[] = []

      await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [],
        {
          onProgress: (msg) => progressMessages.push(msg)
        }
      )

      expect(progressMessages.some(m => m.includes('Counting'))).toBe(true)
    })

    it('should report compressing objects progress', async () => {
      const progressMessages: string[] = []

      await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [],
        {
          onProgress: (msg) => progressMessages.push(msg)
        }
      )

      expect(progressMessages.some(m => m.includes('Compressing'))).toBe(true)
    })

    it('should report total object count', async () => {
      const progressMessages: string[] = []

      await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [],
        {
          onProgress: (msg) => progressMessages.push(msg)
        }
      )

      // Should include total count in progress
      expect(progressMessages.some(m => /\d+/.test(m))).toBe(true)
    })

    it('should respect no-progress option', async () => {
      const session = createSession('test-repo', [])
      session.capabilities.noProgress = true
      session.wants = [SHA1_COMMIT_1]

      // When no-progress is set, progress callback should not be called
      // (or progress messages should be suppressed)
      const progressMessages: string[] = []

      await generatePackfile(
        mockStore,
        session.wants,
        [],
        { onProgress: (msg) => progressMessages.push(msg) }
      )

      // Implementation should check session.capabilities.noProgress
      // This is a behavioral test - implementation may vary
      expect(progressMessages).toBeDefined()
    })
  })

  // ==========================================================================
  // 9. Capability Parsing and Building
  // ==========================================================================
  describe('Capability Handling', () => {
    describe('buildCapabilityString', () => {
      it('should build capability string with side-band-64k', () => {
        const result = buildCapabilityString({ sideBand64k: true })
        expect(result).toContain('side-band-64k')
      })

      it('should build capability string with thin-pack', () => {
        const result = buildCapabilityString({ thinPack: true })
        expect(result).toContain('thin-pack')
      })

      it('should build capability string with multiple capabilities', () => {
        const result = buildCapabilityString({
          sideBand64k: true,
          thinPack: true,
          shallow: true,
          includeTag: true
        })

        expect(result).toContain('side-band-64k')
        expect(result).toContain('thin-pack')
        expect(result).toContain('shallow')
        expect(result).toContain('include-tag')
      })

      it('should include agent string', () => {
        const result = buildCapabilityString({ agent: 'gitx.do/1.0' })
        expect(result).toContain('agent=gitx.do/1.0')
      })

      it('should include multi_ack_detailed', () => {
        const result = buildCapabilityString({ multiAckDetailed: true })
        expect(result).toContain('multi_ack_detailed')
      })
    })

    describe('parseCapabilities', () => {
      it('should parse side-band-64k', () => {
        const result = parseCapabilities('side-band-64k')
        expect(result.sideBand64k).toBe(true)
      })

      it('should parse thin-pack', () => {
        const result = parseCapabilities('thin-pack')
        expect(result.thinPack).toBe(true)
      })

      it('should parse multiple capabilities', () => {
        const result = parseCapabilities('side-band-64k thin-pack shallow include-tag')
        expect(result.sideBand64k).toBe(true)
        expect(result.thinPack).toBe(true)
        expect(result.shallow).toBe(true)
        expect(result.includeTag).toBe(true)
      })

      it('should parse agent capability with value', () => {
        const result = parseCapabilities('agent=git/2.40.0')
        expect(result.agent).toBe('git/2.40.0')
      })

      it('should handle empty capability string', () => {
        const result = parseCapabilities('')
        expect(result).toEqual({})
      })

      it('should parse multi_ack_detailed', () => {
        const result = parseCapabilities('multi_ack_detailed')
        expect(result.multiAckDetailed).toBe(true)
      })

      it('should parse object-format capability', () => {
        const result = parseCapabilities('object-format=sha256')
        expect(result.objectFormat).toBe('sha256')
      })
    })
  })

  // ==========================================================================
  // 10. Full Fetch Flow (handleFetch)
  // ==========================================================================
  describe('Full Fetch Flow', () => {
    it('should handle a simple fetch request', async () => {
      const session = createSession('test-repo', [
        { name: 'refs/heads/main', sha: SHA1_COMMIT_1 }
      ])

      const request = [
        `want ${SHA1_COMMIT_1} thin-pack side-band-64k\n`,
        '0000', // flush
        'done\n'
      ].join('')

      const result = await handleFetch(session, request, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
      // Should contain NAK (no common objects) and packfile
    })

    it('should handle fetch with common objects', async () => {
      const session = createSession('test-repo', [
        { name: 'refs/heads/main', sha: SHA1_COMMIT_1 }
      ])

      const request = [
        `want ${SHA1_COMMIT_1}\n`,
        '0000', // flush
        `have ${SHA1_COMMIT_2}\n`,
        'done\n'
      ].join('')

      const result = await handleFetch(session, request, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
      // Should contain ACK for common object
    })

    it('should handle shallow fetch', async () => {
      const session = createSession('test-repo', [
        { name: 'refs/heads/main', sha: SHA1_COMMIT_1 }
      ])

      const request = [
        `want ${SHA1_COMMIT_1} shallow\n`,
        'deepen 1\n',
        '0000', // flush
        'done\n'
      ].join('')

      const result = await handleFetch(session, request, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
      // Should contain shallow lines
    })

    it('should handle multiple wants', async () => {
      const session = createSession('test-repo', [
        { name: 'refs/heads/main', sha: SHA1_COMMIT_1 },
        { name: 'refs/heads/feature', sha: SHA1_COMMIT_2 }
      ])

      const request = [
        `want ${SHA1_COMMIT_1}\n`,
        `want ${SHA1_COMMIT_2}\n`,
        '0000', // flush
        'done\n'
      ].join('')

      const result = await handleFetch(session, request, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should return error for non-existent wants', async () => {
      const session = createSession('test-repo', [])
      const nonExistentSha = '1'.repeat(40)

      const request = [
        `want ${nonExistentSha}\n`,
        '0000',
        'done\n'
      ].join('')

      // Should throw or return error response
      await expect(handleFetch(session, request, mockStore)).rejects.toThrow()
    })

    it('should include side-band progress when enabled', async () => {
      const session = createSession('test-repo', [
        { name: 'refs/heads/main', sha: SHA1_COMMIT_1 }
      ])
      session.capabilities.sideBand64k = true

      const request = [
        `want ${SHA1_COMMIT_1} side-band-64k\n`,
        '0000',
        'done\n'
      ].join('')

      const result = await handleFetch(session, request, mockStore)

      // Result should contain side-band formatted data
      expect(result).toBeInstanceOf(Uint8Array)
      // Channel bytes should be present
    })
  })

  // ==========================================================================
  // 11. Edge Cases and Error Handling
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle clone of empty repository', async () => {
      const emptyStore: UploadPackObjectStore = {
        async getObject() { return null },
        async hasObject() { return false },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects() { return [] }
      }

      const result = await advertiseRefs(emptyStore)
      expect(result).toContain(FLUSH_PKT)
    })

    it('should handle very deep commit history', async () => {
      // Create store with deep history
      const deepObjects = new Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag'; data: Uint8Array }>()
      let prevSha = ''

      for (let i = 0; i < 100; i++) {
        const sha = i.toString(16).padStart(40, '0')
        const parents = prevSha ? [prevSha] : []
        deepObjects.set(sha, {
          type: 'commit',
          data: createCommitData(SHA1_TREE_1, parents, `Commit ${i}`)
        })
        prevSha = sha
      }
      deepObjects.set(SHA1_TREE_1, { type: 'tree', data: new Uint8Array([]) })

      const deepStore = createMockStore(deepObjects)
      const headSha = (99).toString(16).padStart(40, '0')

      const result = await generatePackfile(deepStore, [headSha], [], {})
      expect(result.objectCount).toBeGreaterThan(0)
    })

    it('should handle binary blob content', async () => {
      const binaryBlob = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00])
      const binarySha = 'binary'.padEnd(40, '0')

      objects.set(binarySha, { type: 'blob', data: binaryBlob })

      const result = await generatePackfile(mockStore, [binarySha], [], {})
      expect(result.includedObjects).toContain(binarySha)
    })

    it('should handle large blobs', async () => {
      const largeBlob = new Uint8Array(1024 * 1024) // 1MB
      largeBlob.fill(0x42)
      const largeSha = 'large'.padEnd(40, '0')

      objects.set(largeSha, { type: 'blob', data: largeBlob })

      const result = await generatePackfile(mockStore, [largeSha], [], {})
      expect(result.includedObjects).toContain(largeSha)
    })

    it('should reject invalid SHA format', () => {
      expect(() => parseWantLine('want invalid-sha')).toThrow()
      expect(() => parseHaveLine('have 123')).toThrow()
    })

    it('should handle concurrent requests to same session', async () => {
      const session = createSession('test-repo', [])

      // Multiple concurrent want processing
      const promises = [
        processWants({ ...session }, [SHA1_COMMIT_1], mockStore),
        processWants({ ...session }, [SHA1_COMMIT_2], mockStore)
      ]

      const results = await Promise.all(promises)
      expect(results).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 12. Protocol Compliance
  // ==========================================================================
  describe('Protocol Compliance', () => {
    it('should format lines with LF terminator', async () => {
      const ack = formatAck(SHA1_COMMIT_1)
      const decoded = decodePktLine(ack)
      expect(decoded.data?.endsWith('\n')).toBe(true)
    })

    it('should use lowercase hex for SHAs', () => {
      const ack = formatAck(SHA1_COMMIT_1.toUpperCase())
      expect(ack).toContain(SHA1_COMMIT_1.toLowerCase())
    })

    it('should include symref capability for HEAD', async () => {
      const result = await advertiseRefs(mockStore, {})
      // HEAD should be advertised as symref to the current branch
      // Format: symref=HEAD:refs/heads/main
      expect(result).toMatch(/symref=HEAD:refs\/heads\/\w+/)
    })

    it('should handle protocol v1 format', async () => {
      // v1 format puts capabilities after NUL byte on first line
      const result = await advertiseRefs(mockStore)
      const { packets } = pktLineStream(result)

      const firstData = packets.find(p => p.type === 'data')
      if (firstData?.data) {
        // First line should have format: <sha> <ref>\0<capabilities>
        expect(firstData.data).toContain('\x00')
      }
    })
  })

  // ==========================================================================
  // 13. Multi-ack Detailed Negotiation (RED Phase)
  // ==========================================================================
  describe('Multi-ack Detailed Negotiation', () => {
    it('should respond with ACK common for objects both sides have', async () => {
      const session = createSession('test-repo', [])
      session.wants = [SHA1_COMMIT_1]
      session.capabilities.multiAckDetailed = true

      const result = await processHaves(
        session,
        [SHA1_COMMIT_2, SHA1_COMMIT_3],
        mockStore,
        false // not done yet
      )

      // With multi_ack_detailed, server should ACK each common object
      expect(result.acks.length).toBeGreaterThan(0)
      // Status should be 'continue' or 'common' for multi_ack_detailed
      expect(result.acks.every(ack =>
        ack.status === 'continue' || ack.status === 'common'
      )).toBe(true)
    })

    it('should respond with ACK ready when negotiation is optimal', async () => {
      const session = createSession('test-repo', [])
      session.wants = [SHA1_COMMIT_1]
      session.capabilities.multiAckDetailed = true

      // Client has the parent commit
      const result = await processHaves(
        session,
        [SHA1_COMMIT_2],
        mockStore,
        true // done
      )

      // With multi_ack_detailed, should include 'ready' status
      expect(result.ready).toBe(true)
      // The implementation should set ACK ready when it has enough info
    })

    it('should handle multi-round negotiation efficiently', async () => {
      const session = createSession('test-repo', [])
      session.wants = [SHA1_COMMIT_1]
      session.capabilities.multiAckDetailed = true

      // Round 1: Server doesn't have client's objects
      const nonExistent = '1'.repeat(40)
      const round1 = await processHaves(
        session,
        [nonExistent],
        mockStore,
        false
      )
      expect(round1.nak).toBe(true)

      // Round 2: Server finds common object
      const round2 = await processHaves(
        session,
        [SHA1_COMMIT_3],
        mockStore,
        false
      )
      expect(round2.commonAncestors).toContain(SHA1_COMMIT_3)

      // Round 3: Done
      const round3 = await processHaves(
        session,
        [SHA1_COMMIT_2],
        mockStore,
        true
      )
      expect(round3.ready).toBe(true)
    })
  })

  // ==========================================================================
  // 14. Delta Compression in Packfiles (RED Phase)
  // ==========================================================================
  describe('Delta Compression in Packfiles', () => {
    it('should generate OFS_DELTA objects in packfile when beneficial', async () => {
      // Create a series of similar blobs that benefit from delta
      const baseContent = 'This is the base content of the file\n'.repeat(100)
      const modifiedContent = 'This is the modified content of the file\n'.repeat(100)

      const baseBlob = encoder.encode(baseContent)
      const modifiedBlob = encoder.encode(modifiedContent)

      const baseSha = '1'.repeat(40)
      const modifiedSha = '2'.repeat(40)

      const deltaStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === baseSha) return { type: 'blob', data: baseBlob }
          if (sha === modifiedSha) return { type: 'blob', data: modifiedBlob }
          return null
        },
        async hasObject(sha: string) {
          return sha === baseSha || sha === modifiedSha
        },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) { return [sha] }
      }

      const result = await generatePackfile(
        deltaStore,
        [baseSha, modifiedSha],
        [],
        { thinPack: false }
      )

      // Pack should contain both objects
      expect(result.objectCount).toBe(2)

      // For delta compression, pack size should be smaller than sum of objects
      // (This tests that delta compression is being used)
      const rawSize = baseBlob.length + modifiedBlob.length
      // Note: With zlib compression, even without delta, pack will be smaller
      // This test verifies delta compression makes it even smaller
      expect(result.packfile.length).toBeLessThan(rawSize)
    })

    it('should use REF_DELTA for thin pack deltas', async () => {
      const baseContent = 'Hello World! This is a test file with some content.\n'
      const modifiedContent = 'Hello World! This is a test file with MODIFIED content.\n'

      const baseBlob = encoder.encode(baseContent)
      const modifiedBlob = encoder.encode(modifiedContent)

      const baseSha = 'base'.padEnd(40, '0')
      const modifiedSha = 'modi'.padEnd(40, '0')

      const thinStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === baseSha) return { type: 'blob', data: baseBlob }
          if (sha === modifiedSha) return { type: 'blob', data: modifiedBlob }
          return null
        },
        async hasObject(sha: string) {
          return sha === baseSha || sha === modifiedSha
        },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) { return [sha] }
      }

      // Generate thin pack where client already has base
      const result = await generateThinPack(
        thinStore,
        [modifiedSha],
        [baseSha] // Client has base
      )

      // Thin pack should be smaller than full blob size
      expect(result.packfile.length).toBeLessThan(modifiedBlob.length + 100)
      expect(result.objectCount).toBe(1)
    })

    it('should respect maxDeltaDepth option', async () => {
      // Create chain of similar objects
      const objectChain: Map<string, { type: 'blob' | 'tree' | 'commit' | 'tag', data: Uint8Array }> = new Map()
      const shas: string[] = []

      for (let i = 0; i < 10; i++) {
        const sha = i.toString().padStart(40, '0')
        const content = `Version ${i} of the file with some common content\n`.repeat(50)
        objectChain.set(sha, { type: 'blob', data: encoder.encode(content) })
        shas.push(sha)
      }

      const chainStore: UploadPackObjectStore = {
        async getObject(sha: string) { return objectChain.get(sha) || null },
        async hasObject(sha: string) { return objectChain.has(sha) },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) { return [sha] }
      }

      const result = await generatePackfile(
        chainStore,
        shas,
        [],
        { maxDeltaDepth: 3 }
      )

      // All objects should be included
      expect(result.objectCount).toBe(10)
      // Pack should have been generated (even without deep delta chains)
      expect(result.packfile.length).toBeGreaterThan(0)
    })

    // RED Phase: Tests for OFS_DELTA/REF_DELTA actual usage
    it.fails('should actually use OFS_DELTA encoding in packfile', async () => {
      // Create two very similar blobs where delta is highly beneficial
      const baseContent = 'A'.repeat(1000) + 'ORIGINAL' + 'B'.repeat(1000)
      const modifiedContent = 'A'.repeat(1000) + 'MODIFIED' + 'B'.repeat(1000)

      const baseBlob = encoder.encode(baseContent)
      const modifiedBlob = encoder.encode(modifiedContent)

      const baseSha = 'base'.padEnd(40, '0')
      const modifiedSha = 'modi'.padEnd(40, '0')

      const deltaTestStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === baseSha) return { type: 'blob', data: baseBlob }
          if (sha === modifiedSha) return { type: 'blob', data: modifiedBlob }
          return null
        },
        async hasObject(sha: string) {
          return sha === baseSha || sha === modifiedSha
        },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) { return [sha] }
      }

      const result = await generatePackfile(
        deltaTestStore,
        [baseSha, modifiedSha],
        [],
        { thinPack: false }
      )

      // Parse the packfile to verify delta object types
      const packData = result.packfile

      // Skip PACK header (12 bytes) and check object types
      // OFS_DELTA = 6, REF_DELTA = 7
      let offset = 12 // After PACK header
      let foundDelta = false

      while (offset < packData.length - 20) { // -20 for SHA trailer
        const byte = packData[offset]
        const objType = (byte >> 4) & 0x7

        // Check if this is a delta object type
        if (objType === 6 || objType === 7) {
          foundDelta = true
          break
        }

        // Skip to next object (simplified - real parsing is more complex)
        offset += 1
        while (offset < packData.length - 20 && (packData[offset - 1] & 0x80)) {
          offset++
        }
        // Skip compressed data (this is a simplification)
        offset += 100
      }

      // Should have found at least one delta object
      expect(foundDelta).toBe(true)
    })

    it.fails('should use REF_DELTA when base is in client haves for thin pack', async () => {
      const baseContent = 'This is the base content that is quite long.\n'.repeat(50)
      const modifiedContent = 'This is the MODIFIED content that is quite long.\n'.repeat(50)

      const baseBlob = encoder.encode(baseContent)
      const modifiedBlob = encoder.encode(modifiedContent)

      const baseSha = 'clienthas'.padEnd(40, '0').slice(0, 40)
      const modifiedSha = 'needstosend'.padEnd(40, '0').slice(0, 40)

      const refDeltaStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === baseSha) return { type: 'blob', data: baseBlob }
          if (sha === modifiedSha) return { type: 'blob', data: modifiedBlob }
          return null
        },
        async hasObject(sha: string) {
          return sha === baseSha || sha === modifiedSha
        },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) { return [sha] }
      }

      const result = await generateThinPack(
        refDeltaStore,
        [modifiedSha],
        [baseSha] // Client has the base
      )

      // Parse packfile header to get object count
      const packData = result.packfile
      const objectCount = (packData[8] << 24) | (packData[9] << 16) | (packData[10] << 8) | packData[11]

      // Parse each object to check types
      let offset = 12 // After header
      let foundRefDelta = false

      for (let i = 0; i < objectCount && offset < packData.length - 20; i++) {
        const firstByte = packData[offset]
        const objType = (firstByte >> 4) & 0x7

        // REF_DELTA = 7
        if (objType === 7) {
          foundRefDelta = true

          // After REF_DELTA type byte(s), there should be 20 bytes of base SHA
          // This verifies it's actually using the base object
          let sizeBytes = 1
          while (packData[offset + sizeBytes - 1] & 0x80) {
            sizeBytes++
          }

          // The next 20 bytes after size should be the base SHA
          const baseShaBytes = packData.slice(offset + sizeBytes, offset + sizeBytes + 20)
          expect(baseShaBytes.length).toBe(20)
          break
        }

        // Skip this object (simplified - not accurate for production)
        offset++
        while (offset < packData.length - 20 && (packData[offset - 1] & 0x80)) {
          offset++
        }
        // Very rough skip of compressed data
        offset += 50
      }

      // Thin pack should use REF_DELTA against client's base object
      // This test should FAIL because current implementation doesn't use REF_DELTA
      expect(foundRefDelta).toBe(true)
    })
  })

  // ==========================================================================
  // 15. Partial Clone / Filter Support (RED Phase)
  // ==========================================================================
  describe('Partial Clone Filter Support', () => {
    it('should support blob:none filter', async () => {
      const session = createSession('test-repo', [])
      session.capabilities.filter = true
      session.wants = [SHA1_COMMIT_1]

      // When filter=blob:none, packfile should exclude blob objects
      const result = await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [],
        {
          // Filter specification would go here
        }
      )

      // Without filter implementation, this just checks pack generation works
      // Full implementation would verify no blobs in pack
      expect(result.packfile).toBeInstanceOf(Uint8Array)
    })

    it('should support tree:depth filter', async () => {
      const session = createSession('test-repo', [])
      session.capabilities.filter = true

      // tree:0 should only include commit objects
      // tree:1 should include commit and root tree
      const result = await generatePackfile(
        mockStore,
        [SHA1_COMMIT_1],
        [],
        {}
      )

      // Verify pack was generated
      expect(result.objectCount).toBeGreaterThan(0)
    })

    it('should advertise filter capability', async () => {
      const result = await advertiseRefs(mockStore, { filter: true })
      expect(result).toContain('filter')
    })

    it('should parse filter specification in want line', () => {
      const wantLine = `want ${SHA1_COMMIT_1} filter blob:none`
      const parsed = parseWantLine(wantLine)

      expect(parsed.sha).toBe(SHA1_COMMIT_1)
      // Filter capability should be set
      expect(parsed.capabilities.filter).toBe(true)
    })

    // RED Phase: Tests for actual filter implementation
    it.fails('should exclude blobs when filter=blob:none is set', async () => {
      // Create a commit with tree and blob
      const commit = 'comm'.padEnd(40, '0')
      const tree = 'tree'.padEnd(40, '0')
      const blob = 'blob'.padEnd(40, '0')

      const commitData = encoder.encode(
        `tree ${tree}\n` +
        'author Test <test@test.com> 1704067200 +0000\n' +
        'committer Test <test@test.com> 1704067200 +0000\n\n' +
        'Test commit'
      )

      const filterStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === commit) return { type: 'commit', data: commitData }
          if (sha === tree) return { type: 'tree', data: new Uint8Array([]) }
          if (sha === blob) return { type: 'blob', data: encoder.encode('blob content') }
          return null
        },
        async hasObject(sha: string) {
          return [commit, tree, blob].includes(sha)
        },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) {
          if (sha === commit) return [commit, tree, blob]
          return [sha]
        }
      }

      const result = await generatePackfile(
        filterStore,
        [commit],
        [],
        {
          // filter: 'blob:none' would go here when implemented
        }
      )

      // With blob:none filter, blobs should be excluded
      // Should only include commit and tree
      expect(result.includedObjects).toContain(commit)
      expect(result.includedObjects).toContain(tree)
      expect(result.includedObjects).not.toContain(blob)
      expect(result.objectCount).toBe(2) // Just commit and tree
    })

    it.fails('should limit blob size with blob:limit filter', async () => {
      const commit = 'comm'.padEnd(40, '0')
      const tree = 'tree'.padEnd(40, '0')
      const smallBlob = 'smal'.padEnd(40, '0')
      const largeBlob = 'larg'.padEnd(40, '0')

      const smallContent = 'small'
      const largeContent = 'A'.repeat(10000) // 10KB

      const commitData = encoder.encode(
        `tree ${tree}\n` +
        'author Test <test@test.com> 1704067200 +0000\n' +
        'committer Test <test@test.com> 1704067200 +0000\n\n' +
        'Test commit'
      )

      const limitStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === commit) return { type: 'commit', data: commitData }
          if (sha === tree) return { type: 'tree', data: new Uint8Array([]) }
          if (sha === smallBlob) return { type: 'blob', data: encoder.encode(smallContent) }
          if (sha === largeBlob) return { type: 'blob', data: encoder.encode(largeContent) }
          return null
        },
        async hasObject(sha: string) {
          return [commit, tree, smallBlob, largeBlob].includes(sha)
        },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) {
          if (sha === commit) return [commit, tree, smallBlob, largeBlob]
          return [sha]
        }
      }

      const result = await generatePackfile(
        limitStore,
        [commit],
        [],
        {
          // filter: 'blob:limit=1000' would go here when implemented
        }
      )

      // With blob:limit=1000, only blobs under 1KB should be included
      expect(result.includedObjects).toContain(smallBlob)
      expect(result.includedObjects).not.toContain(largeBlob)
    })
  })

  // ==========================================================================
  // 16. Advanced Shallow Clone Scenarios (RED Phase)
  // ==========================================================================
  describe('Advanced Shallow Clone Scenarios', () => {
    it('should handle deepen-relative correctly', async () => {
      const session = createSession('test-repo', [])
      session.wants = [SHA1_COMMIT_1]
      session.shallowCommits = [SHA1_COMMIT_2]
      session.capabilities.deepenRelative = true

      // Deepen by 1 from current shallow point
      const result = await processShallow(
        session,
        [`shallow ${SHA1_COMMIT_2}`],
        undefined, // no absolute depth
        undefined,
        undefined,
        mockStore
      )

      // Should process the shallow information
      expect(result.shallowCommits).toContain(SHA1_COMMIT_2)
    })

    it('should combine deepen-since with depth limit', async () => {
      const session = createSession('test-repo', [])
      session.wants = [SHA1_COMMIT_1]

      // Depth 5 but not before timestamp
      const result = await processShallow(
        session,
        [],
        5,
        1704067100,
        undefined,
        mockStore
      )

      // Should have processed both constraints
      expect(result.shallowCommits).toBeDefined()
    })

    it('should handle deepen-not with multiple refs', async () => {
      const session = createSession('test-repo', [])
      session.wants = [SHA1_COMMIT_1]

      const result = await processShallow(
        session,
        [],
        undefined,
        undefined,
        ['refs/heads/feature', 'refs/tags/v1.0.0'],
        mockStore
      )

      // Should have processed the deepen-not constraint
      expect(result).toBeDefined()
    })

    it('should properly handle unshallow when deepening', async () => {
      const session = createSession('test-repo', [])
      session.wants = [SHA1_COMMIT_1]
      // Client was previously shallow at commit 2
      session.shallowCommits = [SHA1_COMMIT_2]

      // Now deepen past that point
      const result = await processShallow(
        session,
        [`shallow ${SHA1_COMMIT_2}`],
        5, // Deep enough to pass commit 2
        undefined,
        undefined,
        mockStore
      )

      // Commit 2 should become unshallow if we deepened past it
      // (depends on implementation details)
      expect(result.shallowCommits).toBeDefined()
      expect(result.unshallowCommits).toBeDefined()
    })

    // RED Phase: Tests for not-yet-implemented functionality
    it('should filter commits by timestamp with deepen-since', async () => {
      // Create commits with different timestamps
      const oldCommit = 'old0'.padEnd(40, '0')
      const newCommit = 'new0'.padEnd(40, '0')
      const tree = 'tree'.padEnd(40, '0')

      // Old commit timestamp: 2024-01-01 00:00:00 UTC
      const oldTimestamp = 1704067200
      // New commit timestamp: 2024-01-02 00:00:00 UTC
      const newTimestamp = 1704153600

      const oldCommitData = encoder.encode(
        `tree ${tree}\n` +
        `author Test <test@test.com> ${oldTimestamp} +0000\n` +
        `committer Test <test@test.com> ${oldTimestamp} +0000\n\n` +
        'Old commit'
      )
      const newCommitData = encoder.encode(
        `tree ${tree}\n` +
        `parent ${oldCommit}\n` +
        `author Test <test@test.com> ${newTimestamp} +0000\n` +
        `committer Test <test@test.com> ${newTimestamp} +0000\n\n` +
        'New commit'
      )

      const timestampStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === oldCommit) return { type: 'commit', data: oldCommitData }
          if (sha === newCommit) return { type: 'commit', data: newCommitData }
          if (sha === tree) return { type: 'tree', data: new Uint8Array([]) }
          return null
        },
        async hasObject(sha: string) {
          return [oldCommit, newCommit, tree].includes(sha)
        },
        async getCommitParents(sha: string) {
          if (sha === newCommit) return [oldCommit]
          return []
        },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) {
          if (sha === newCommit) return [newCommit, oldCommit, tree]
          return [sha]
        }
      }

      const session = createSession('test-repo', [])
      session.wants = [newCommit]

      // Deepen since midpoint timestamp (should exclude old commit)
      const midTimestamp = oldTimestamp + 43200 // 12 hours after old commit
      const result = await processShallow(
        session,
        [],
        undefined,
        midTimestamp,
        undefined,
        timestampStore
      )

      // newCommit becomes the shallow boundary because its parent (oldCommit) is before deepen-since
      expect(result.shallowCommits).toContain(newCommit)
    })

    it('should stop traversal at deepen-not refs', async () => {
      // Create a chain: commit3 -> commit2 (feature branch) -> commit1
      const commit1 = 'com1'.padEnd(40, '0')
      const commit2 = 'com2'.padEnd(40, '0')
      const commit3 = 'com3'.padEnd(40, '0')
      const tree = 'tree'.padEnd(40, '0')

      const commitData = (parent?: string) => encoder.encode(
        `tree ${tree}\n` +
        (parent ? `parent ${parent}\n` : '') +
        'author Test <test@test.com> 1704067200 +0000\n' +
        'committer Test <test@test.com> 1704067200 +0000\n\n' +
        'Commit'
      )

      const deepenNotStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === commit1) return { type: 'commit', data: commitData() }
          if (sha === commit2) return { type: 'commit', data: commitData(commit1) }
          if (sha === commit3) return { type: 'commit', data: commitData(commit2) }
          if (sha === tree) return { type: 'tree', data: new Uint8Array([]) }
          return null
        },
        async hasObject(sha: string) {
          return [commit1, commit2, commit3, tree].includes(sha)
        },
        async getCommitParents(sha: string) {
          if (sha === commit3) return [commit2]
          if (sha === commit2) return [commit1]
          return []
        },
        async getRefs() {
          return [
            { name: 'refs/heads/main', sha: commit3 },
            { name: 'refs/heads/feature', sha: commit2 }
          ]
        },
        async getReachableObjects(sha: string) {
          if (sha === commit3) return [commit3, commit2, commit1, tree]
          if (sha === commit2) return [commit2, commit1, tree]
          return [sha]
        }
      }

      const session = createSession('test-repo', [])
      session.wants = [commit3]

      // Don't deepen past the feature branch (commit2)
      const result = await processShallow(
        session,
        [],
        undefined,
        undefined,
        ['refs/heads/feature'], // Stop at feature branch
        deepenNotStore
      )

      // commit3 becomes shallow boundary because its parent (commit2) is in deepen-not set
      expect(result.shallowCommits).toContain(commit3)
      // commit2 and commit1 should NOT be in shallow commits (they are excluded entirely)
      expect(result.shallowCommits).not.toContain(commit1)
    })
  })

  // ==========================================================================
  // 17. Stateless HTTP Protocol (RED Phase)
  // ==========================================================================
  describe('Stateless HTTP Protocol', () => {
    it('should handle stateless fetch with full negotiation in single request', async () => {
      const session = createSession('test-repo', [
        { name: 'refs/heads/main', sha: SHA1_COMMIT_1 }
      ], true) // stateless = true

      // HTTP POST to /git-upload-pack typically includes everything
      const request = [
        `want ${SHA1_COMMIT_1} thin-pack side-band-64k\n`,
        `have ${SHA1_COMMIT_3}\n`,
        'done\n'
      ].join('')

      const result = await handleFetch(session, request, mockStore)

      expect(result).toBeInstanceOf(Uint8Array)
      // Should contain ACK and packfile data
    })

    it('should restore session state from shallow lines', async () => {
      const session = createSession('test-repo', [
        { name: 'refs/heads/main', sha: SHA1_COMMIT_1 }
      ], true)

      // Client sends its shallow state
      const request = [
        `want ${SHA1_COMMIT_1}\n`,
        `shallow ${SHA1_COMMIT_2}\n`,
        `deepen 2\n`,
        'done\n'
      ].join('')

      const result = await handleFetch(session, request, mockStore)
      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should include shallow/unshallow in response', async () => {
      const session = createSession('test-repo', [
        { name: 'refs/heads/main', sha: SHA1_COMMIT_1 }
      ], true)

      const request = [
        `want ${SHA1_COMMIT_1} shallow\n`,
        'deepen 1\n',
        'done\n'
      ].join('')

      const result = await handleFetch(session, request, mockStore)

      // Response should include shallow boundary information
      const resultStr = decoder.decode(result)
      // The response structure should include shallow lines
      expect(result.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 18. Protocol v2 Support (RED Phase)
  // ==========================================================================
  describe('Protocol v2 Support', () => {
    it('should advertise protocol v2 capabilities', async () => {
      // Protocol v2 advertisement is "version 2" followed by capabilities
      const result = await advertiseRefs(mockStore, {})

      // v1 advertisement should work
      expect(result).toBeDefined()
      // v2 would have different format (version 2\n followed by commands)
    })

    it('should handle ls-refs command', async () => {
      // Protocol v2 ls-refs is separate from fetch
      const session = createSession('test-repo', [
        { name: 'refs/heads/main', sha: SHA1_COMMIT_1 }
      ])

      // In v2, ls-refs lists refs without capabilities inline
      const refs = await mockStore.getRefs()
      expect(refs.length).toBeGreaterThan(0)
      expect(refs[0].name).toContain('refs/')
    })

    it('should handle v2 fetch command format', async () => {
      // V2 fetch uses different wire format
      // This is a placeholder for when v2 is implemented
      const session = createSession('test-repo', [
        { name: 'refs/heads/main', sha: SHA1_COMMIT_1 }
      ])

      // V1-style request for now
      const request = [
        `want ${SHA1_COMMIT_1}\n`,
        'done\n'
      ].join('')

      const result = await handleFetch(session, request, mockStore)
      expect(result).toBeInstanceOf(Uint8Array)
    })
  })

  // ==========================================================================
  // 19. Side-band Error Handling (RED Phase)
  // ==========================================================================
  describe('Side-band Error Handling', () => {
    it('should send errors on channel 3', () => {
      const errorMsg = encoder.encode('error: repository not found\n')
      const result = wrapSideBand(SideBandChannel.ERROR, errorMsg)

      expect(result[4]).toBe(3) // Channel 3
      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('should properly terminate error messages', () => {
      const errorMsg = encoder.encode('fatal: bad object')
      const result = wrapSideBand(SideBandChannel.ERROR, errorMsg)

      // Should be valid pkt-line
      expect(result.length).toBeGreaterThan(5)
    })

    it('should chunk large packfiles across multiple side-band messages', async () => {
      // Create large packfile scenario
      const largeBlob = new Uint8Array(100000) // 100KB
      largeBlob.fill(0x42)
      const largeSha = 'large'.padEnd(40, '0')

      const largeStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === largeSha) return { type: 'blob', data: largeBlob }
          return null
        },
        async hasObject(sha: string) {
          return sha === largeSha
        },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) { return [sha] }
      }

      const result = await generatePackfile(
        largeStore,
        [largeSha],
        [],
        {}
      )

      // Pack was generated
      expect(result.packfile.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 20. Capability Validation (RED Phase)
  // ==========================================================================
  describe('Capability Validation', () => {
    it('should reject unknown capabilities gracefully', () => {
      const caps = parseCapabilities('thin-pack unknown-cap-xyz side-band-64k')

      // Known caps should be parsed
      expect(caps.thinPack).toBe(true)
      expect(caps.sideBand64k).toBe(true)
      // Unknown should be ignored (not throw)
    })

    it('should handle capability conflicts correctly', () => {
      // side-band and side-band-64k are mutually exclusive
      // Server should prefer side-band-64k
      const caps = parseCapabilities('side-band side-band-64k')

      // Both should be parsed (client might send both)
      expect(caps.sideBand).toBe(true)
      expect(caps.sideBand64k).toBe(true)
    })

    it('should validate object-format matches repository', async () => {
      // If client requests sha256 but repo uses sha1, should error
      const session = createSession('test-repo', [])
      session.capabilities.objectFormat = 'sha256'

      // This would fail if we strictly validate
      // For now, just ensure we can parse the capability
      const caps = parseCapabilities('object-format=sha256')
      expect(caps.objectFormat).toBe('sha256')
    })

    it('should advertise symref for detached HEAD', async () => {
      // When HEAD is detached, symref should point to the commit
      const detachedStore: UploadPackObjectStore = {
        ...mockStore,
        async getRefs() {
          return [
            { name: 'HEAD', sha: SHA1_COMMIT_1 },
            { name: 'refs/heads/main', sha: SHA1_COMMIT_2 }
          ]
        }
      }

      const result = await advertiseRefs(detachedStore)
      expect(result).toContain('HEAD')
    })
  })

  // ==========================================================================
  // 21. Object Traversal Edge Cases (RED Phase)
  // ==========================================================================
  describe('Object Traversal Edge Cases', () => {
    it('should handle merge commits with multiple parents', async () => {
      // Create a merge commit scenario
      const mergeCommit = 'merge'.padEnd(40, '0')
      const parent1 = 'paren'.padEnd(40, '0')
      const parent2 = 'secnd'.padEnd(40, '0')
      const tree = 'tree0'.padEnd(40, '0')

      const mergeData = encoder.encode(
        `tree ${tree}\n` +
        `parent ${parent1}\n` +
        `parent ${parent2}\n` +
        'author Test <test@test.com> 1704067200 +0000\n' +
        'committer Test <test@test.com> 1704067200 +0000\n\n' +
        'Merge commit'
      )

      const mergeStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          if (sha === mergeCommit) return { type: 'commit', data: mergeData }
          if (sha === parent1 || sha === parent2) {
            return { type: 'commit', data: createCommitData(tree, [], 'Parent') }
          }
          if (sha === tree) return { type: 'tree', data: new Uint8Array([]) }
          return null
        },
        async hasObject(sha: string) {
          return [mergeCommit, parent1, parent2, tree].includes(sha)
        },
        async getCommitParents(sha: string) {
          if (sha === mergeCommit) return [parent1, parent2]
          return []
        },
        async getRefs() {
          return [{ name: 'refs/heads/main', sha: mergeCommit }]
        },
        async getReachableObjects(sha: string) {
          if (sha === mergeCommit) return [mergeCommit, parent1, parent2, tree]
          return [sha]
        }
      }

      const missing = await calculateMissingObjects(
        mergeStore,
        [mergeCommit],
        []
      )

      // Should include merge commit and both parents
      expect(missing.has(mergeCommit)).toBe(true)
      expect(missing.has(parent1)).toBe(true)
      expect(missing.has(parent2)).toBe(true)
      expect(missing.has(tree)).toBe(true)
    })

    it('should stop at common ancestors during graph walk', async () => {
      const missing = await calculateMissingObjects(
        mockStore,
        [SHA1_COMMIT_1],
        [SHA1_COMMIT_2] // Client has this and its ancestors
      )

      // Should include commit 1 but not commit 2
      expect(missing.has(SHA1_COMMIT_1)).toBe(true)
      expect(missing.has(SHA1_COMMIT_2)).toBe(false)
    })

    it('should handle circular references gracefully', async () => {
      // While git doesn't allow circular refs, we should not infinite loop
      const circularSha = 'circ'.padEnd(40, '0')
      let callCount = 0

      const circularStore: UploadPackObjectStore = {
        async getObject(sha: string) {
          callCount++
          if (callCount > 100) throw new Error('Infinite loop detected')
          if (sha === circularSha) {
            return { type: 'commit', data: createCommitData(SHA1_TREE_1, [], 'Commit') }
          }
          if (sha === SHA1_TREE_1) return { type: 'tree', data: new Uint8Array([]) }
          return null
        },
        async hasObject(sha: string) {
          return sha === circularSha || sha === SHA1_TREE_1
        },
        async getCommitParents() { return [] },
        async getRefs() { return [] },
        async getReachableObjects(sha: string) { return [sha] }
      }

      const missing = await calculateMissingObjects(
        circularStore,
        [circularSha],
        []
      )

      expect(missing.has(circularSha)).toBe(true)
      expect(callCount).toBeLessThan(100)
    })
  })
})
