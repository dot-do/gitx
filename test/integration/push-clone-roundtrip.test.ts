import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SqliteObjectStore } from '../../src/do/object-store'
import { SchemaManager, type DurableObjectStorage } from '../../src/do/schema'
import {
  handleInfoRefs,
  handleUploadPack,
  handleReceivePack,
  type RepositoryProvider,
  type SmartHTTPRequest,
  type GitRef,
  type RefUpdateCommand,
  type ReceivePackResult,
  type ServerCapabilities,
  ZERO_SHA,
  CONTENT_TYPE_UPLOAD_PACK_REQUEST,
  CONTENT_TYPE_RECEIVE_PACK_REQUEST,
} from '../../src/wire/smart-http'
import { generatePackfile, type ObjectStore as UploadPackObjectStore } from '../../src/wire/upload-pack'
import { encodePktLine, FLUSH_PKT, pktLineStream } from '../../src/wire/pkt-line'
import type { ObjectType } from '../../src/types/objects'

// ============================================================================
// Mock SQLite Storage (in-memory, table-aware)
// ============================================================================

/**
 * A functional in-memory mock of DurableObjectStorage that supports
 * the full SQL operations needed by SqliteObjectStore and
 * DORepositoryProvider (refs, objects, WAL, object_index).
 */
function createMockSqliteStorage(): DurableObjectStorage {
  // Simple in-memory tables
  const objects = new Map<string, { sha: string; type: string; size: number; data: Uint8Array; created_at: number }>()
  const objectIndex = new Map<string, { sha: string; tier: string; pack_id: string | null; offset: number | null; size: number; type: string; updated_at: number; chunked: number; chunk_count: number }>()
  const refs = new Map<string, { name: string; target: string; type: string; updated_at: number }>()
  const wal: Array<{ id: number; operation: string; payload: Uint8Array; created_at: number; flushed: number }> = []
  let walId = 0
  let inTransaction = false

  // Track which tables exist
  const tables = new Set<string>()

  return {
    sql: {
      exec: (query: string, ...params: unknown[]): { toArray(): unknown[] } => {
        const q = query.trim()

        // Schema creation: parse CREATE TABLE / INDEX statements
        if (q.startsWith('CREATE TABLE') || q.startsWith('CREATE INDEX') || q.includes('CREATE TABLE') || q.includes('CREATE INDEX')) {
          const tableRegex = /CREATE TABLE IF NOT EXISTS (\w+)/gi
          let m: RegExpExecArray | null
          while ((m = tableRegex.exec(q)) !== null) {
            tables.add(m[1])
          }
          return { toArray: () => [] }
        }

        // Transaction management
        if (q === 'BEGIN TRANSACTION' || q === 'BEGIN') {
          inTransaction = true
          return { toArray: () => [] }
        }
        if (q === 'COMMIT') {
          inTransaction = false
          return { toArray: () => [] }
        }
        if (q === 'ROLLBACK') {
          inTransaction = false
          return { toArray: () => [] }
        }

        // sqlite_master query (for schema validation)
        if (q.includes('sqlite_master') && q.includes("type='table'")) {
          return { toArray: () => Array.from(tables).map(name => ({ name })) }
        }

        // changes() function
        if (q.includes('changes()')) {
          return { toArray: () => [{ count: 0 }] }
        }

        // === WAL operations ===
        if (q.startsWith('INSERT INTO wal')) {
          walId++
          wal.push({
            id: walId,
            operation: params[0] as string,
            payload: params[1] as Uint8Array,
            created_at: params[2] as number,
            flushed: 0,
          })
          return { toArray: () => [] }
        }
        if (q.startsWith('DELETE FROM wal')) {
          return { toArray: () => [] }
        }

        // === Objects operations ===
        if (q.startsWith('INSERT OR REPLACE INTO objects')) {
          const sha = params[0] as string
          const type = params[1] as string
          const size = params[2] as number
          const data = params[3] as Uint8Array
          const created_at = params[4] as number
          objects.set(sha, { sha, type, size, data, created_at })
          return { toArray: () => [] }
        }

        if (q.startsWith('SELECT sha, type, size, data, created_at') && q.includes('FROM objects WHERE sha = ?')) {
          const sha = params[0] as string
          const obj = objects.get(sha)
          return { toArray: () => obj ? [obj] : [] }
        }

        if (q.startsWith('SELECT data FROM objects WHERE sha = ?')) {
          const sha = params[0] as string
          const obj = objects.get(sha)
          return { toArray: () => obj ? [{ data: obj.data }] : [] }
        }

        if (q.startsWith('SELECT sha, type, size, data') && q.includes('WHERE sha IN')) {
          const results: unknown[] = []
          for (const p of params) {
            const obj = objects.get(p as string)
            if (obj) results.push(obj)
          }
          return { toArray: () => results }
        }

        if (q.startsWith('DELETE FROM objects WHERE sha = ?')) {
          objects.delete(params[0] as string)
          return { toArray: () => [] }
        }

        if (q.startsWith('SELECT type, data FROM objects WHERE sha = ?')) {
          const sha = params[0] as string
          const obj = objects.get(sha)
          return { toArray: () => obj ? [{ type: obj.type, data: obj.data }] : [] }
        }

        // === Object Index operations ===
        if (q.startsWith('INSERT OR REPLACE INTO object_index')) {
          const sha = params[0] as string
          objectIndex.set(sha, {
            sha,
            tier: params[1] as string,
            pack_id: params[2] as string | null,
            offset: params[3] as number | null,
            size: params[4] as number,
            type: params[5] as string,
            updated_at: params[6] as number,
            chunked: (params[7] as number) ?? 0,
            chunk_count: (params[8] as number) ?? 0,
          })
          return { toArray: () => [] }
        }

        if (q.startsWith('SELECT sha, tier, size, type, chunked, chunk_count FROM object_index WHERE sha = ?')) {
          const sha = params[0] as string
          const idx = objectIndex.get(sha)
          return { toArray: () => idx ? [idx] : [] }
        }

        if (q.startsWith('SELECT chunked, chunk_count FROM object_index WHERE sha = ?')) {
          const sha = params[0] as string
          const idx = objectIndex.get(sha)
          return { toArray: () => idx ? [{ chunked: idx.chunked, chunk_count: idx.chunk_count }] : [] }
        }

        if (q.startsWith('DELETE FROM object_index WHERE sha = ?')) {
          objectIndex.delete(params[0] as string)
          return { toArray: () => [] }
        }

        // === Refs operations ===
        if (q.startsWith('INSERT OR REPLACE INTO refs')) {
          const name = params[0] as string
          const target = params[1] as string
          const type = params[2] as string
          const updated_at = params[3] as number
          refs.set(name, { name, target, type, updated_at })
          return { toArray: () => [] }
        }

        if (q.startsWith('SELECT name, target FROM refs ORDER BY name')) {
          const rows = Array.from(refs.values()).sort((a, b) => a.name.localeCompare(b.name))
          return { toArray: () => rows }
        }

        if (q.startsWith('SELECT target FROM refs WHERE name = ?')) {
          const name = params[0] as string
          const ref = refs.get(name)
          return { toArray: () => ref ? [{ target: ref.target }] : [] }
        }

        if (q.startsWith('DELETE FROM refs WHERE name = ?')) {
          refs.delete(params[0] as string)
          return { toArray: () => [] }
        }

        // Default: return empty
        return { toArray: () => [] }
      },
    },
  }
}

// ============================================================================
// DORepositoryProvider (extracted from wire-routes.ts for direct use)
// ============================================================================

const DEFAULT_SERVER_CAPABILITIES: ServerCapabilities = {
  sideBand64k: true,
  thinPack: true,
  ofsDelta: false,
  shallow: true,
  noProgress: true,
  includeTag: true,
  reportStatus: true,
  deleteRefs: true,
  atomic: true,
  agent: 'gitx.do/1.0',
}

/**
 * Minimal RepositoryProvider backed by mock storage,
 * matching the DORepositoryProvider from wire-routes.ts.
 */
function createRepositoryProvider(storage: DurableObjectStorage): RepositoryProvider {
  const schemaManager = new SchemaManager(storage)
  const objectStore = new SqliteObjectStore(storage)
  let schemaInitialized = false

  async function ensureSchema() {
    if (!schemaInitialized) {
      await schemaManager.initializeSchema()
      schemaInitialized = true
    }
  }

  function parseTreeData(data: Uint8Array): { mode: string; name: string; sha: string }[] {
    const entries: { mode: string; name: string; sha: string }[] = []
    let offset = 0
    while (offset < data.length) {
      const spaceIdx = data.indexOf(0x20, offset)
      if (spaceIdx === -1) break
      const mode = new TextDecoder().decode(data.slice(offset, spaceIdx))
      const nullIdx = data.indexOf(0x00, spaceIdx + 1)
      if (nullIdx === -1) break
      const name = new TextDecoder().decode(data.slice(spaceIdx + 1, nullIdx))
      const shaBytes = data.slice(nullIdx + 1, nullIdx + 21)
      if (shaBytes.length < 20) break
      const sha = Array.from(shaBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      entries.push({ mode, name, sha })
      offset = nullIdx + 21
    }
    return entries
  }

  function createUploadPackStore(): UploadPackObjectStore {
    return {
      async getObject(sha: string) {
        const obj = await objectStore.getObject(sha)
        if (!obj) return null
        return { type: obj.type, data: obj.data }
      },
      async hasObject(sha: string) {
        return objectStore.hasObject(sha)
      },
      async getCommitParents(sha: string) {
        const obj = await objectStore.getObject(sha)
        if (!obj || obj.type !== 'commit') return []
        const text = new TextDecoder().decode(obj.data)
        const parents: string[] = []
        const regex = /^parent ([0-9a-f]{40})/gm
        let match
        while ((match = regex.exec(text)) !== null) {
          parents.push(match[1]!)
        }
        return parents
      },
      async getRefs() {
        try {
          const result = storage.sql.exec('SELECT name, target FROM refs ORDER BY name')
          const rows = result.toArray() as { name: string; target: string }[]
          return rows.map(row => ({ name: row.name, sha: row.target }))
        } catch {
          return []
        }
      },
      async getReachableObjects(sha: string) {
        const visited = new Set<string>()
        const queue = [sha]
        while (queue.length > 0) {
          const current = queue.shift()!
          if (visited.has(current)) continue
          visited.add(current)
          const obj = await objectStore.getObject(current)
          if (!obj) continue
          if (obj.type === 'commit') {
            const text = new TextDecoder().decode(obj.data)
            const treeMatch = text.match(/^tree ([0-9a-f]{40})/m)
            if (treeMatch) queue.push(treeMatch[1]!)
            const parentRegex = /^parent ([0-9a-f]{40})/gm
            let parentMatch
            while ((parentMatch = parentRegex.exec(text)) !== null) {
              queue.push(parentMatch[1]!)
            }
          } else if (obj.type === 'tree') {
            const entries = parseTreeData(obj.data)
            for (const entry of entries) queue.push(entry.sha)
          } else if (obj.type === 'tag') {
            const text = new TextDecoder().decode(obj.data)
            const objMatch = text.match(/^object ([0-9a-f]{40})/m)
            if (objMatch) queue.push(objMatch[1]!)
          }
        }
        return Array.from(visited)
      },
    }
  }

  return {
    async getRefs(): Promise<GitRef[]> {
      await ensureSchema()
      try {
        const result = storage.sql.exec('SELECT name, target FROM refs ORDER BY name')
        const rows = result.toArray() as { name: string; target: string }[]
        return rows.map(row => ({ sha: row.target, name: row.name }))
      } catch {
        return []
      }
    },
    async exists(): Promise<boolean> {
      await ensureSchema()
      return true
    },
    async hasPermission(): Promise<boolean> {
      return true
    },
    async uploadPack(wants: string[], haves: string[]): Promise<Uint8Array> {
      await ensureSchema()
      const store = createUploadPackStore()
      const result = await generatePackfile(store, wants, haves)
      return result.packfile
    },
    async receivePack(packData: Uint8Array, commands: RefUpdateCommand[]): Promise<ReceivePackResult> {
      await ensureSchema()
      const refResults: ReceivePackResult['refResults'] = []
      for (const cmd of commands) {
        try {
          const ZERO = '0000000000000000000000000000000000000000'
          const isDelete = cmd.newSha === ZERO
          const existing = storage.sql.exec('SELECT target FROM refs WHERE name = ?', cmd.refName).toArray() as { target: string }[]
          const currentSha = existing.length > 0 ? existing[0]!.target : ZERO

          if (currentSha !== cmd.oldSha) {
            refResults.push({ refName: cmd.refName, success: false, error: 'lock failed' })
            continue
          }

          if (isDelete) {
            storage.sql.exec('DELETE FROM refs WHERE name = ?', cmd.refName)
          } else {
            storage.sql.exec(
              'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
              cmd.refName, cmd.newSha.toLowerCase(), 'sha', Date.now()
            )
          }
          refResults.push({ refName: cmd.refName, success: true })
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'ref update failed'
          refResults.push({ refName: cmd.refName, success: false, error: msg })
        }
      }
      const allSuccess = refResults.every(r => r.success)
      return { success: allSuccess, refResults }
    },
  }
}

// ============================================================================
// Helpers
// ============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function createSmartHTTPRequest(
  method: 'GET' | 'POST',
  path: string,
  options: Partial<SmartHTTPRequest> = {}
): SmartHTTPRequest {
  return {
    method,
    path,
    query: {},
    headers: {},
    repository: 'test-repo',
    ...options,
  }
}

// ============================================================================
// Integration Tests: Push-Clone Round-Trip
// ============================================================================

describe('Integration: Push-Clone Round-Trip', () => {
  let storage: DurableObjectStorage
  let objectStore: SqliteObjectStore
  let provider: RepositoryProvider
  let schemaManager: SchemaManager

  beforeEach(async () => {
    storage = createMockSqliteStorage()
    schemaManager = new SchemaManager(storage)
    await schemaManager.initializeSchema()
    objectStore = new SqliteObjectStore(storage)
    provider = createRepositoryProvider(storage)
  })

  // --------------------------------------------------------------------------
  // Create objects manually and store them
  // --------------------------------------------------------------------------

  describe('Manual object creation and storage', () => {
    it('should create a blob, tree, and commit, then retrieve them by SHA', async () => {
      // 1. Create blob
      const blobContent = encoder.encode('hello world\n')
      const blobSha = await objectStore.putObject('blob', blobContent)
      expect(blobSha).toMatch(/^[0-9a-f]{40}$/)

      // 2. Create tree referencing the blob
      const treeSha = await objectStore.putTreeObject([
        { mode: '100644', name: 'hello.txt', sha: blobSha },
      ])
      expect(treeSha).toMatch(/^[0-9a-f]{40}$/)

      // 3. Create commit referencing the tree
      const now = Math.floor(Date.now() / 1000)
      const commitSha = await objectStore.putCommitObject({
        tree: treeSha,
        parents: [],
        author: { name: 'Test User', email: 'test@example.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'Test User', email: 'test@example.com', timestamp: now, timezone: '+0000' },
        message: 'Initial commit',
      })
      expect(commitSha).toMatch(/^[0-9a-f]{40}$/)

      // 4. Verify all objects exist and can be retrieved
      const blob = await objectStore.getObject(blobSha)
      expect(blob).not.toBeNull()
      expect(blob!.type).toBe('blob')
      expect(decoder.decode(blob!.data)).toBe('hello world\n')

      const tree = await objectStore.getTreeObject(treeSha)
      expect(tree).not.toBeNull()
      expect(tree!.entries).toHaveLength(1)
      expect(tree!.entries[0].name).toBe('hello.txt')
      expect(tree!.entries[0].sha).toBe(blobSha)

      const commit = await objectStore.getCommitObject(commitSha)
      expect(commit).not.toBeNull()
      expect(commit!.tree).toBe(treeSha)
      expect(commit!.parents).toHaveLength(0)
      expect(commit!.message).toBe('Initial commit')
    })
  })

  // --------------------------------------------------------------------------
  // Store objects + set refs, then verify info/refs
  // --------------------------------------------------------------------------

  describe('Ref advertisement via info/refs', () => {
    it('should advertise refs after storing objects and setting refs', async () => {
      // Create objects
      const blobSha = await objectStore.putObject('blob', encoder.encode('content'))
      const treeSha = await objectStore.putTreeObject([
        { mode: '100644', name: 'file.txt', sha: blobSha },
      ])
      const now = Math.floor(Date.now() / 1000)
      const commitSha = await objectStore.putCommitObject({
        tree: treeSha,
        parents: [],
        author: { name: 'Test', email: 'test@test.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'Test', email: 'test@test.com', timestamp: now, timezone: '+0000' },
        message: 'init',
      })

      // Set refs
      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'HEAD', commitSha, 'sha', Date.now()
      )
      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/main', commitSha, 'sha', Date.now()
      )

      // Call info/refs for upload-pack
      const request = createSmartHTTPRequest('GET', '/info/refs', {
        query: { service: 'git-upload-pack' },
      })
      const response = await handleInfoRefs(request, provider, DEFAULT_SERVER_CAPABILITIES)

      expect(response.status).toBe(200)
      expect(response.headers['Content-Type']).toBe('application/x-git-upload-pack-advertisement')

      const body = decoder.decode(response.body)

      // Verify the service announcement
      expect(body).toContain('# service=git-upload-pack')

      // Verify the commit SHA is advertised
      expect(body).toContain(commitSha)

      // Verify ref names appear
      expect(body).toContain('refs/heads/main')

      // Verify capabilities are present
      expect(body).toContain('side-band-64k')
      expect(body).toContain('report-status')
    })

    it('should advertise refs for receive-pack service', async () => {
      const blobSha = await objectStore.putObject('blob', encoder.encode('data'))
      const treeSha = await objectStore.putTreeObject([
        { mode: '100644', name: 'f.txt', sha: blobSha },
      ])
      const now = Math.floor(Date.now() / 1000)
      const commitSha = await objectStore.putCommitObject({
        tree: treeSha,
        parents: [],
        author: { name: 'A', email: 'a@a.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'A', email: 'a@a.com', timestamp: now, timezone: '+0000' },
        message: 'first',
      })

      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/main', commitSha, 'sha', Date.now()
      )

      const request = createSmartHTTPRequest('GET', '/info/refs', {
        query: { service: 'git-receive-pack' },
      })
      const response = await handleInfoRefs(request, provider, DEFAULT_SERVER_CAPABILITIES)

      expect(response.status).toBe(200)
      expect(response.headers['Content-Type']).toBe('application/x-git-receive-pack-advertisement')

      const body = decoder.decode(response.body)
      expect(body).toContain(commitSha)
      expect(body).toContain('refs/heads/main')
    })

    it('should handle empty repository (no refs)', async () => {
      const request = createSmartHTTPRequest('GET', '/info/refs', {
        query: { service: 'git-upload-pack' },
      })
      const response = await handleInfoRefs(request, provider, DEFAULT_SERVER_CAPABILITIES)

      expect(response.status).toBe(200)
      const body = decoder.decode(response.body)
      // Empty repo still sends capabilities with zero SHA
      expect(body).toContain(ZERO_SHA)
    })
  })

  // --------------------------------------------------------------------------
  // Upload-pack: fetch objects via packfile
  // --------------------------------------------------------------------------

  describe('Upload-pack fetch flow', () => {
    it('should return a valid packfile containing all reachable objects', async () => {
      // Build a small repo: blob -> tree -> commit
      const blobContent = encoder.encode('hello from packfile test\n')
      const blobSha = await objectStore.putObject('blob', blobContent)

      const treeSha = await objectStore.putTreeObject([
        { mode: '100644', name: 'readme.txt', sha: blobSha },
      ])

      const now = Math.floor(Date.now() / 1000)
      const commitSha = await objectStore.putCommitObject({
        tree: treeSha,
        parents: [],
        author: { name: 'Alice', email: 'alice@test.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'Alice', email: 'alice@test.com', timestamp: now, timezone: '+0000' },
        message: 'Initial commit for packfile test',
      })

      // Set refs
      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/main', commitSha, 'sha', Date.now()
      )

      // Build upload-pack request body
      // Format: want <sha> <capabilities>\n ... flush ... done\n
      const wantLine = `want ${commitSha} no-progress\n`
      const requestBody = encoder.encode(
        (encodePktLine(wantLine) as string) +
        FLUSH_PKT +
        (encodePktLine('done\n') as string)
      )

      const request = createSmartHTTPRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: requestBody,
      })

      const response = await handleUploadPack(request, provider)

      expect(response.status).toBe(200)
      expect(response.headers['Content-Type']).toBe('application/x-git-upload-pack-result')

      // The response body should contain NAK followed by packfile data
      const body = response.body
      expect(body.length).toBeGreaterThan(0)

      // Decode the response to find NAK and packfile
      const bodyText = decoder.decode(body)
      expect(bodyText).toContain('NAK')

      // Find PACK signature in the response body (binary)
      const packSignature = new Uint8Array([0x50, 0x41, 0x43, 0x4b]) // "PACK"
      let packOffset = -1
      for (let i = 0; i < body.length - 3; i++) {
        if (body[i] === 0x50 && body[i + 1] === 0x41 && body[i + 2] === 0x43 && body[i + 3] === 0x4b) {
          packOffset = i
          break
        }
      }
      expect(packOffset).toBeGreaterThanOrEqual(0)

      // Verify packfile header
      const packData = body.slice(packOffset)
      // Version should be 2
      const version = (packData[4] << 24) | (packData[5] << 16) | (packData[6] << 8) | packData[7]
      expect(version).toBe(2)

      // Object count should be >= 3 (blob + tree + commit)
      const objCount = (packData[8] << 24) | (packData[9] << 16) | (packData[10] << 8) | packData[11]
      expect(objCount).toBeGreaterThanOrEqual(3)
    })

    it('should return minimal pack for already-known objects (incremental fetch)', async () => {
      // Create first commit
      const blob1Sha = await objectStore.putObject('blob', encoder.encode('first'))
      const tree1Sha = await objectStore.putTreeObject([
        { mode: '100644', name: 'a.txt', sha: blob1Sha },
      ])
      const now = Math.floor(Date.now() / 1000)
      const commit1Sha = await objectStore.putCommitObject({
        tree: tree1Sha,
        parents: [],
        author: { name: 'X', email: 'x@x.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'X', email: 'x@x.com', timestamp: now, timezone: '+0000' },
        message: 'first',
      })

      // Create second commit (child of first)
      const blob2Sha = await objectStore.putObject('blob', encoder.encode('second'))
      const tree2Sha = await objectStore.putTreeObject([
        { mode: '100644', name: 'a.txt', sha: blob1Sha },
        { mode: '100644', name: 'b.txt', sha: blob2Sha },
      ])
      const commit2Sha = await objectStore.putCommitObject({
        tree: tree2Sha,
        parents: [commit1Sha],
        author: { name: 'X', email: 'x@x.com', timestamp: now + 1, timezone: '+0000' },
        committer: { name: 'X', email: 'x@x.com', timestamp: now + 1, timezone: '+0000' },
        message: 'second',
      })

      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/main', commit2Sha, 'sha', Date.now()
      )

      // Client wants commit2 and has commit1
      const requestBody = encoder.encode(
        (encodePktLine(`want ${commit2Sha}\n`) as string) +
        FLUSH_PKT +
        (encodePktLine(`have ${commit1Sha}\n`) as string) +
        (encodePktLine('done\n') as string)
      )

      const request = createSmartHTTPRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: requestBody,
      })

      const response = await handleUploadPack(request, provider)
      expect(response.status).toBe(200)

      // Response should contain ACK for the have
      const bodyText = decoder.decode(response.body)
      expect(bodyText).toContain('ACK')
    })
  })

  // --------------------------------------------------------------------------
  // Receive-pack: push new objects and update refs
  // --------------------------------------------------------------------------

  describe('Receive-pack push flow', () => {
    it('should accept a push with ref update commands and update refs', async () => {
      // Set up initial state: an existing commit on main
      const blob1Sha = await objectStore.putObject('blob', encoder.encode('v1'))
      const tree1Sha = await objectStore.putTreeObject([
        { mode: '100644', name: 'file.txt', sha: blob1Sha },
      ])
      const now = Math.floor(Date.now() / 1000)
      const commit1Sha = await objectStore.putCommitObject({
        tree: tree1Sha,
        parents: [],
        author: { name: 'A', email: 'a@a.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'A', email: 'a@a.com', timestamp: now, timezone: '+0000' },
        message: 'v1',
      })

      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/main', commit1Sha, 'sha', Date.now()
      )

      // Create a new commit locally (simulating what a client would push)
      const blob2Sha = await objectStore.putObject('blob', encoder.encode('v2'))
      const tree2Sha = await objectStore.putTreeObject([
        { mode: '100644', name: 'file.txt', sha: blob2Sha },
      ])
      const commit2Sha = await objectStore.putCommitObject({
        tree: tree2Sha,
        parents: [commit1Sha],
        author: { name: 'B', email: 'b@b.com', timestamp: now + 1, timezone: '+0000' },
        committer: { name: 'B', email: 'b@b.com', timestamp: now + 1, timezone: '+0000' },
        message: 'v2',
      })

      // Build receive-pack request
      // Format: <old-sha> <new-sha> <refname>\0<capabilities>\n followed by flush + packfile
      const cmdLine = `${commit1Sha} ${commit2Sha} refs/heads/main\x00report-status\n`
      const requestBody = encoder.encode(
        (encodePktLine(cmdLine) as string) +
        FLUSH_PKT
        // No actual packfile data since objects are already stored
      )

      const request = createSmartHTTPRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: requestBody,
      })

      const response = await handleReceivePack(request, provider)

      expect(response.status).toBe(200)

      const body = decoder.decode(response.body)
      expect(body).toContain('unpack ok')
      expect(body).toContain('ok refs/heads/main')

      // Verify the ref was updated
      const refsResult = storage.sql.exec('SELECT target FROM refs WHERE name = ?', 'refs/heads/main')
      const rows = refsResult.toArray() as { target: string }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].target).toBe(commit2Sha)
    })

    it('should create a new branch via push', async () => {
      // Create initial objects
      const blobSha = await objectStore.putObject('blob', encoder.encode('branch test'))
      const treeSha = await objectStore.putTreeObject([
        { mode: '100644', name: 'test.txt', sha: blobSha },
      ])
      const now = Math.floor(Date.now() / 1000)
      const commitSha = await objectStore.putCommitObject({
        tree: treeSha,
        parents: [],
        author: { name: 'Dev', email: 'd@d.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'Dev', email: 'd@d.com', timestamp: now, timezone: '+0000' },
        message: 'branch commit',
      })

      // Push to create refs/heads/feature (oldSha = ZERO_SHA means create)
      const cmdLine = `${ZERO_SHA} ${commitSha} refs/heads/feature\x00report-status\n`
      const requestBody = encoder.encode(
        (encodePktLine(cmdLine) as string) +
        FLUSH_PKT
      )

      const request = createSmartHTTPRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: requestBody,
      })

      const response = await handleReceivePack(request, provider)
      expect(response.status).toBe(200)

      const body = decoder.decode(response.body)
      expect(body).toContain('unpack ok')
      expect(body).toContain('ok refs/heads/feature')

      // Verify the new branch ref exists
      const refsResult = storage.sql.exec('SELECT target FROM refs WHERE name = ?', 'refs/heads/feature')
      const rows = refsResult.toArray() as { target: string }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].target).toBe(commitSha)
    })

    it('should reject a push with incorrect oldSha (optimistic locking)', async () => {
      // Set up a ref pointing to commit1
      const blob1Sha = await objectStore.putObject('blob', encoder.encode('orig'))
      const tree1Sha = await objectStore.putTreeObject([
        { mode: '100644', name: 'x.txt', sha: blob1Sha },
      ])
      const now = Math.floor(Date.now() / 1000)
      const commit1Sha = await objectStore.putCommitObject({
        tree: tree1Sha,
        parents: [],
        author: { name: 'A', email: 'a@a.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'A', email: 'a@a.com', timestamp: now, timezone: '+0000' },
        message: 'orig',
      })

      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/main', commit1Sha, 'sha', Date.now()
      )

      // Try to push with wrong old SHA
      const wrongOldSha = 'f'.repeat(40)
      const newSha = 'e'.repeat(40)
      const cmdLine = `${wrongOldSha} ${newSha} refs/heads/main\x00report-status\n`
      const requestBody = encoder.encode(
        (encodePktLine(cmdLine) as string) +
        FLUSH_PKT
      )

      const request = createSmartHTTPRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: requestBody,
      })

      const response = await handleReceivePack(request, provider)
      expect(response.status).toBe(200)

      const body = decoder.decode(response.body)
      // The ref update should fail due to lock check
      expect(body).toContain('ng refs/heads/main')

      // Ref should still point to original commit
      const refsResult = storage.sql.exec('SELECT target FROM refs WHERE name = ?', 'refs/heads/main')
      const rows = refsResult.toArray() as { target: string }[]
      expect(rows[0].target).toBe(commit1Sha)
    })
  })

  // --------------------------------------------------------------------------
  // Full round-trip: create -> push -> clone (info/refs + upload-pack)
  // --------------------------------------------------------------------------

  describe('Full push-clone round-trip', () => {
    it('should store objects, set refs, then fetch them back via upload-pack with byte integrity', async () => {
      // === PUSH PHASE: create and store objects ===

      const blobContent = encoder.encode('round-trip integrity test content\n')
      const blobSha = await objectStore.putObject('blob', blobContent)

      const treeSha = await objectStore.putTreeObject([
        { mode: '100644', name: 'integrity.txt', sha: blobSha },
      ])

      const now = Math.floor(Date.now() / 1000)
      const commitSha = await objectStore.putCommitObject({
        tree: treeSha,
        parents: [],
        author: { name: 'Roundtrip', email: 'rt@test.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'Roundtrip', email: 'rt@test.com', timestamp: now, timezone: '+0000' },
        message: 'Round-trip test commit',
      })

      // Set refs (simulating a push)
      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/main', commitSha, 'sha', Date.now()
      )

      // === CLONE PHASE: info/refs -> upload-pack ===

      // Step 1: info/refs
      const infoRefsRequest = createSmartHTTPRequest('GET', '/info/refs', {
        query: { service: 'git-upload-pack' },
      })
      const infoRefsResponse = await handleInfoRefs(infoRefsRequest, provider, DEFAULT_SERVER_CAPABILITIES)
      expect(infoRefsResponse.status).toBe(200)

      const advert = decoder.decode(infoRefsResponse.body)
      expect(advert).toContain(commitSha)
      expect(advert).toContain('refs/heads/main')

      // Step 2: upload-pack to fetch objects
      const uploadPackBody = encoder.encode(
        (encodePktLine(`want ${commitSha} no-progress\n`) as string) +
        FLUSH_PKT +
        (encodePktLine('done\n') as string)
      )

      const uploadPackRequest = createSmartHTTPRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: uploadPackBody,
      })
      const uploadPackResponse = await handleUploadPack(uploadPackRequest, provider)
      expect(uploadPackResponse.status).toBe(200)

      // Verify packfile is present in response
      const responseBody = uploadPackResponse.body
      let packOffset = -1
      for (let i = 0; i < responseBody.length - 3; i++) {
        if (responseBody[i] === 0x50 && responseBody[i + 1] === 0x41 &&
            responseBody[i + 2] === 0x43 && responseBody[i + 3] === 0x4b) {
          packOffset = i
          break
        }
      }
      expect(packOffset).toBeGreaterThanOrEqual(0)

      // Verify packfile structure
      const packfileData = responseBody.slice(packOffset)
      const sig = decoder.decode(packfileData.slice(0, 4))
      expect(sig).toBe('PACK')

      const packVersion = (packfileData[4] << 24) | (packfileData[5] << 16) | (packfileData[6] << 8) | packfileData[7]
      expect(packVersion).toBe(2)

      const objectCount = (packfileData[8] << 24) | (packfileData[9] << 16) | (packfileData[10] << 8) | packfileData[11]
      expect(objectCount).toBe(3) // blob + tree + commit

      // Step 3: Verify stored objects match original data byte-for-byte
      const retrievedBlob = await objectStore.getObject(blobSha)
      expect(retrievedBlob).not.toBeNull()
      expect(retrievedBlob!.type).toBe('blob')
      expect(new Uint8Array(retrievedBlob!.data)).toEqual(blobContent)

      const retrievedTree = await objectStore.getObject(treeSha)
      expect(retrievedTree).not.toBeNull()
      expect(retrievedTree!.type).toBe('tree')

      const retrievedCommit = await objectStore.getCommitObject(commitSha)
      expect(retrievedCommit).not.toBeNull()
      expect(retrievedCommit!.tree).toBe(treeSha)
      expect(retrievedCommit!.message).toBe('Round-trip test commit')
      expect(retrievedCommit!.author.name).toBe('Roundtrip')

      // Step 4: Verify SHA integrity (content-addressable check)
      const verified = await objectStore.verifyObject(blobSha)
      expect(verified).toBe(true)
    })

    it('should handle multi-commit history in a round-trip', async () => {
      // Create a chain: commit1 -> commit2 -> commit3
      const now = Math.floor(Date.now() / 1000)
      const author = { name: 'Chain', email: 'chain@test.com', timestamp: now, timezone: '+0000' }

      // Commit 1
      const blob1 = await objectStore.putObject('blob', encoder.encode('v1'))
      const tree1 = await objectStore.putTreeObject([{ mode: '100644', name: 'f.txt', sha: blob1 }])
      const commit1 = await objectStore.putCommitObject({
        tree: tree1, parents: [], author, committer: author, message: 'commit 1',
      })

      // Commit 2
      const blob2 = await objectStore.putObject('blob', encoder.encode('v2'))
      const tree2 = await objectStore.putTreeObject([{ mode: '100644', name: 'f.txt', sha: blob2 }])
      const commit2 = await objectStore.putCommitObject({
        tree: tree2, parents: [commit1], author: { ...author, timestamp: now + 1 },
        committer: { ...author, timestamp: now + 1 }, message: 'commit 2',
      })

      // Commit 3
      const blob3 = await objectStore.putObject('blob', encoder.encode('v3'))
      const tree3 = await objectStore.putTreeObject([{ mode: '100644', name: 'f.txt', sha: blob3 }])
      const commit3 = await objectStore.putCommitObject({
        tree: tree3, parents: [commit2], author: { ...author, timestamp: now + 2 },
        committer: { ...author, timestamp: now + 2 }, message: 'commit 3',
      })

      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/main', commit3, 'sha', Date.now()
      )

      // Clone: request all objects
      const uploadPackBody = encoder.encode(
        (encodePktLine(`want ${commit3}\n`) as string) +
        FLUSH_PKT +
        (encodePktLine('done\n') as string)
      )

      const request = createSmartHTTPRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: uploadPackBody,
      })

      const response = await handleUploadPack(request, provider)
      expect(response.status).toBe(200)

      // Find PACK in response
      let packOffset = -1
      for (let i = 0; i < response.body.length - 3; i++) {
        if (response.body[i] === 0x50 && response.body[i + 1] === 0x41 &&
            response.body[i + 2] === 0x43 && response.body[i + 3] === 0x4b) {
          packOffset = i
          break
        }
      }
      expect(packOffset).toBeGreaterThanOrEqual(0)

      const packData = response.body.slice(packOffset)
      const objCount = (packData[8] << 24) | (packData[9] << 16) | (packData[10] << 8) | packData[11]
      // 3 blobs + 3 trees + 3 commits = 9 objects
      expect(objCount).toBe(9)

      // Verify the commit chain is intact
      const c3 = await objectStore.getCommitObject(commit3)
      expect(c3!.parents).toEqual([commit2])
      const c2 = await objectStore.getCommitObject(commit2)
      expect(c2!.parents).toEqual([commit1])
      const c1 = await objectStore.getCommitObject(commit1)
      expect(c1!.parents).toEqual([])
    })

    it('should handle push-then-clone for a new branch on existing repo', async () => {
      // Setup: main branch with one commit
      const blobA = await objectStore.putObject('blob', encoder.encode('main content'))
      const treeA = await objectStore.putTreeObject([{ mode: '100644', name: 'main.txt', sha: blobA }])
      const now = Math.floor(Date.now() / 1000)
      const commitA = await objectStore.putCommitObject({
        tree: treeA, parents: [],
        author: { name: 'M', email: 'm@m.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'M', email: 'm@m.com', timestamp: now, timezone: '+0000' },
        message: 'main commit',
      })
      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/main', commitA, 'sha', Date.now()
      )

      // Push: create feature branch with a new commit
      const blobB = await objectStore.putObject('blob', encoder.encode('feature content'))
      const treeB = await objectStore.putTreeObject([
        { mode: '100644', name: 'main.txt', sha: blobA },
        { mode: '100644', name: 'feature.txt', sha: blobB },
      ])
      const commitB = await objectStore.putCommitObject({
        tree: treeB, parents: [commitA],
        author: { name: 'F', email: 'f@f.com', timestamp: now + 1, timezone: '+0000' },
        committer: { name: 'F', email: 'f@f.com', timestamp: now + 1, timezone: '+0000' },
        message: 'feature commit',
      })

      // Push the feature branch
      const pushCmd = `${ZERO_SHA} ${commitB} refs/heads/feature\x00report-status\n`
      const pushBody = encoder.encode(
        (encodePktLine(pushCmd) as string) + FLUSH_PKT
      )
      const pushRequest = createSmartHTTPRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: pushBody,
      })
      const pushResponse = await handleReceivePack(pushRequest, provider)
      expect(pushResponse.status).toBe(200)
      expect(decoder.decode(pushResponse.body)).toContain('ok refs/heads/feature')

      // Clone: info/refs should now show both branches
      const infoRequest = createSmartHTTPRequest('GET', '/info/refs', {
        query: { service: 'git-upload-pack' },
      })
      const infoResponse = await handleInfoRefs(infoRequest, provider, DEFAULT_SERVER_CAPABILITIES)
      const advert = decoder.decode(infoResponse.body)
      expect(advert).toContain('refs/heads/main')
      expect(advert).toContain('refs/heads/feature')
      expect(advert).toContain(commitA)
      expect(advert).toContain(commitB)

      // Fetch the feature branch specifically
      const fetchBody = encoder.encode(
        (encodePktLine(`want ${commitB}\n`) as string) +
        FLUSH_PKT +
        (encodePktLine(`have ${commitA}\n`) as string) +
        (encodePktLine('done\n') as string)
      )
      const fetchRequest = createSmartHTTPRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: fetchBody,
      })
      const fetchResponse = await handleUploadPack(fetchRequest, provider)
      expect(fetchResponse.status).toBe(200)

      // Verify fetch response is valid
      const fetchText = decoder.decode(fetchResponse.body)
      expect(fetchText).toContain('ACK')
    })
  })

  // --------------------------------------------------------------------------
  // Ref deletion via receive-pack
  // --------------------------------------------------------------------------

  describe('Ref deletion via push', () => {
    it('should delete a branch ref when newSha is ZERO_SHA', async () => {
      // Setup: two branches
      const blobSha = await objectStore.putObject('blob', encoder.encode('del test'))
      const treeSha = await objectStore.putTreeObject([{ mode: '100644', name: 't.txt', sha: blobSha }])
      const now = Math.floor(Date.now() / 1000)
      const commitSha = await objectStore.putCommitObject({
        tree: treeSha, parents: [],
        author: { name: 'D', email: 'd@d.com', timestamp: now, timezone: '+0000' },
        committer: { name: 'D', email: 'd@d.com', timestamp: now, timezone: '+0000' },
        message: 'del commit',
      })

      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/main', commitSha, 'sha', Date.now()
      )
      storage.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        'refs/heads/to-delete', commitSha, 'sha', Date.now()
      )

      // Push to delete the branch
      const cmdLine = `${commitSha} ${ZERO_SHA} refs/heads/to-delete\x00report-status delete-refs\n`
      const requestBody = encoder.encode(
        (encodePktLine(cmdLine) as string) + FLUSH_PKT
      )

      const request = createSmartHTTPRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: requestBody,
      })

      const response = await handleReceivePack(request, provider)
      expect(response.status).toBe(200)
      expect(decoder.decode(response.body)).toContain('ok refs/heads/to-delete')

      // Verify the ref is gone
      const refsResult = storage.sql.exec('SELECT target FROM refs WHERE name = ?', 'refs/heads/to-delete')
      expect(refsResult.toArray()).toHaveLength(0)

      // Main branch should still exist
      const mainResult = storage.sql.exec('SELECT target FROM refs WHERE name = ?', 'refs/heads/main')
      expect(mainResult.toArray()).toHaveLength(1)
    })
  })
})
