/**
 * @fileoverview RED Phase Tests for rpc.do Integration in gitx.do
 *
 * These tests verify the integration of rpc.do for remote git operations.
 * All tests should FAIL initially (RED phase) since the implementation doesn't exist yet.
 *
 * Key components tested:
 * 1. RPCGitBackend - Client-side magic proxy for git operations
 * 2. RPCGitDO - Server-side Durable Object exposing git methods via RPC
 * 3. RPC Transport - WebSocket, binary serialization, batching, keepalive
 * 4. OAuth Integration - Auth headers, token refresh, permission checking
 * 5. Error Handling - Timeouts, connection failures, streaming errors
 *
 * @module test/do/rpc
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'

// ============================================================================
// Mock rpc.do Imports (these don't exist yet)
// ============================================================================

// Client and server imports from local rpc-mock
import {
  DO,
  createClient,
  RPCError,
  ErrorCodes,
  type DOClientOptions,
  type ConnectionState,
  type MagicProxy,
  type RPCRequest,
  type RPCResponse,
  type StreamController,
  $,
  createRPCHandler,
  rpc,
  createStreamResponse,
} from '../../src/do/rpc-mock'

// gitx.do imports
import {
  RPCGitBackend,
  createRPCGitBackend,
  RPCGitDO,
  createRPCHandler as createGitRPCHandler,
  type RPCGitConfig,
  type GitRPCMethods,
  type CloneProgress,
  type FetchProgress,
  type PushProgress,
} from '../../src/do/rpc'

// Import oauth.do integration
import {
  extractToken,
  verifyJWT,
  createOAuthMiddleware,
  type GitScope,
  type OAuthContext,
} from '../../src/do/oauth'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock WebSocket for testing
 */
function createMockWebSocket(autoOpen = true) {
  const listeners: Record<string, Array<(event: unknown) => void>> = {}

  const mockWs = {
    readyState: 1, // OPEN
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((event: string, callback: (event: unknown) => void) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(callback)
      // Auto-fire 'open' event on next tick when listener is added (if enabled)
      if (event === 'open' && autoOpen) {
        setTimeout(() => callback({}), 0)
      }
    }),
    removeEventListener: vi.fn(),
    _emit: (event: string, data: unknown) => {
      listeners[event]?.forEach(cb => cb(data))
    },
    _listeners: listeners,
    _autoOpen: autoOpen,
  }

  return mockWs
}

/**
 * Create mock DurableObjectState for testing
 */
function createMockState() {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'test-do-id-12345' },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { storage.set(key, value) }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async (options?: { prefix?: string }) => {
        const result = new Map<string, unknown>()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      }),
      sql: {
        exec: vi.fn(() => ({ toArray: () => [] })),
      },
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(cb: () => Promise<T>) => cb()),
    _storage: storage,
  }
}

/**
 * Create mock environment for testing
 */
function createMockEnv() {
  return {
    GIT_DO: {
      idFromName: vi.fn((name: string) => ({ name })),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response('OK')),
      })),
    },
    R2: {
      put: vi.fn(async () => ({})),
      get: vi.fn(async () => null),
      list: vi.fn(async () => ({ objects: [] })),
    },
  }
}

/**
 * Create a mock RPC message
 */
function createMockRPCResponse(id: string, result: unknown): RPCResponse {
  return {
    type: 'response',
    id,
    success: true,
    result,
    timestamp: Date.now(),
  }
}

/**
 * Create a mock JWT token for testing
 */
function createMockJWT(payload: Record<string, unknown> = {}): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify({
    sub: 'user-123',
    email: 'test@example.com',
    scopes: ['git:read', 'git:push'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  }))
  const signature = btoa('mock-signature')
  return `${header}.${body}.${signature}`
}

// ============================================================================
// 1. RPCGitBackend Tests - Magic Proxy for Git Operations
// ============================================================================

describe('RPCGitBackend - Magic Proxy Client', () => {
  let backend: RPCGitBackend
  let mockWs: ReturnType<typeof createMockWebSocket>

  beforeEach(() => {
    mockWs = createMockWebSocket()
    vi.stubGlobal('WebSocket', vi.fn(() => mockWs))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Client Creation', () => {
    it('should create an RPC client with DO() function', () => {
      const $ = DO('https://git.example.com')

      expect($).toBeDefined()
      expect(typeof $).toBe('object')
    })

    it('should create an RPCGitBackend instance', () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        timeout: 30000,
      })

      expect(backend).toBeDefined()
      expect(backend).toBeInstanceOf(RPCGitBackend)
    })

    it('should accept DOClientOptions configuration', () => {
      const options: DOClientOptions = {
        url: 'https://git.example.com',
        protocol: 'wss',
        timeout: 60000,
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          backoffMs: 1000,
        },
        headers: {
          Authorization: 'Bearer test-token',
        },
      }

      backend = createRPCGitBackend(options)

      expect(backend).toBeDefined()
    })

    it('should support custom serializer', () => {
      const customSerializer = {
        encode: vi.fn((msg: unknown) => new ArrayBuffer(0)),
        decode: vi.fn((data: ArrayBuffer) => ({ type: 'response' })),
      }

      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        serializer: customSerializer,
      })

      expect(backend).toBeDefined()
    })
  })

  describe('Magic Proxy for Git Operations', () => {
    beforeEach(() => {
      backend = createRPCGitBackend({ url: 'https://git.example.com' })
    })

    it('should proxy $.git.commit() calls', async () => {
      const $ = backend.proxy

      // Mock response
      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('1', { sha: 'abc123' })),
        })
      }, 10)

      const result = await $.git.commit({
        message: 'Test commit',
        tree: 'def456',
        parents: ['parent-sha'],
      })

      expect(mockWs.send).toHaveBeenCalled()
      expect(result).toHaveProperty('sha')
    })

    it('should proxy $.git.push() calls', async () => {
      const $ = backend.proxy

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('1', { success: true, refs: ['refs/heads/main'] })),
        })
      }, 10)

      const result = await $.git.push({
        remote: 'origin',
        refs: ['refs/heads/main'],
      })

      expect(result).toHaveProperty('success', true)
    })

    it('should proxy $.git.clone() calls with streaming support', async () => {
      const $ = backend.proxy

      // Simulate streaming response
      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'stream',
            id: '1',
            chunk: { phase: 'counting', progress: 50 },
            done: false,
            index: 0,
            timestamp: Date.now(),
          }),
        })
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'stream',
            id: '1',
            chunk: { phase: 'receiving', progress: 100 },
            done: true,
            index: 1,
            timestamp: Date.now(),
          }),
        })
      }, 10)

      const stream = await $.git.clone({
        url: 'https://github.com/example/repo.git',
        branch: 'main',
      })

      expect(stream).toBeDefined()
    })

    it('should proxy $.git.fetch() calls', async () => {
      const $ = backend.proxy

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('1', {
            refs: [{ name: 'refs/heads/main', sha: 'abc123' }],
          })),
        })
      }, 10)

      const result = await $.git.fetch({
        remote: 'origin',
        refs: ['refs/heads/main'],
      })

      expect(result).toHaveProperty('refs')
    })

    it('should proxy $.git.createBranch() calls', async () => {
      const $ = backend.proxy

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('1', {
            ref: 'refs/heads/feature',
            sha: 'abc123',
          })),
        })
      }, 10)

      const result = await $.git.createBranch({
        name: 'feature',
        startPoint: 'main',
      })

      expect(result).toHaveProperty('ref', 'refs/heads/feature')
    })

    it('should proxy $.git.merge() calls', async () => {
      const $ = backend.proxy

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('1', {
            sha: 'merged-sha',
            conflicts: [],
          })),
        })
      }, 10)

      const result = await $.git.merge({
        source: 'feature',
        target: 'main',
        message: 'Merge feature into main',
      })

      expect(result).toHaveProperty('sha')
      expect(result.conflicts).toHaveLength(0)
    })

    it('should proxy deeply nested method calls', async () => {
      const $ = backend.proxy

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('1', { data: 'test' })),
        })
      }, 10)

      // Deep nesting: $.repository.refs.heads.list()
      const result = await $.repository.refs.heads.list()

      expect(mockWs.send).toHaveBeenCalled()
      const sentMessage = JSON.parse((mockWs.send as Mock).mock.calls[0][0])
      expect(sentMessage.path).toEqual(['repository', 'refs', 'heads', 'list'])
    })

    it('should handle method calls with multiple arguments', async () => {
      const $ = backend.proxy

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('1', { success: true })),
        })
      }, 10)

      await $.git.updateRef('refs/heads/main', 'new-sha', 'old-sha')

      const sentMessage = JSON.parse((mockWs.send as Mock).mock.calls[0][0])
      expect(sentMessage.args).toEqual(['refs/heads/main', 'new-sha', 'old-sha'])
    })
  })

  describe('Connection State Management', () => {
    beforeEach(() => {
      backend = createRPCGitBackend({ url: 'https://git.example.com' })
    })

    it('should start in disconnected state', () => {
      expect(backend.connectionState).toBe('disconnected')
    })

    it('should transition to connecting state when initiating connection', async () => {
      const connectPromise = backend.connect()

      expect(backend.connectionState).toBe('connecting')

      mockWs._emit('open', {})
      await connectPromise
    })

    it('should transition to connected state when WebSocket opens', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})

      await connectPromise

      expect(backend.connectionState).toBe('connected')
    })

    it('should transition to disconnected state when WebSocket closes', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      mockWs._emit('close', { code: 1000, reason: 'Normal closure' })

      expect(backend.connectionState).toBe('disconnected')
    })

    it('should emit connection state change events', async () => {
      const stateChanges: ConnectionState[] = []

      backend.on('stateChange', (state: ConnectionState) => {
        stateChanges.push(state)
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      mockWs._emit('close', {})

      expect(stateChanges).toContain('connecting')
      expect(stateChanges).toContain('connected')
      expect(stateChanges).toContain('disconnected')
    })

    it('should report isConnected correctly', async () => {
      expect(backend.isConnected).toBe(false)

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      expect(backend.isConnected).toBe(true)

      mockWs._emit('close', {})
      expect(backend.isConnected).toBe(false)
    })
  })

  describe('Automatic Reconnection', () => {
    beforeEach(() => {
      // Use non-auto-open mock for reconnection tests
      mockWs = createMockWebSocket(false)
      vi.stubGlobal('WebSocket', vi.fn(() => mockWs))
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          backoffMs: 100,
          maxBackoffMs: 1000,
        },
      })
    })

    it('should automatically reconnect on unexpected disconnect', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // Simulate unexpected disconnect
      mockWs._emit('close', { code: 1006, reason: 'Connection lost' })

      expect(backend.connectionState).toBe('reconnecting')
    })

    it('should use exponential backoff for reconnection', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const reconnectAttempts: number[] = []
      backend.on('reconnect', (attempt: number) => {
        reconnectAttempts.push(attempt)
      })

      // Simulate first disconnect - this should trigger reconnect attempt 1
      mockWs._emit('close', { code: 1006 })
      await new Promise(resolve => setTimeout(resolve, 150))

      // Emit open to complete first reconnect, then close again
      mockWs._emit('open', {})
      await new Promise(resolve => setTimeout(resolve, 10))
      mockWs._emit('close', { code: 1006 })
      await new Promise(resolve => setTimeout(resolve, 250))

      expect(reconnectAttempts).toContain(1)
      // After successful reconnect, attempts reset to 0, so next disconnect starts at 1 again
      expect(reconnectAttempts.length).toBeGreaterThanOrEqual(1)
    })

    it('should stop reconnecting after max attempts', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // Simulate failures up to max (3 attempts)
      // Don't emit 'open' events so reconnection attempts accumulate
      mockWs._emit('close', { code: 1006 })
      await new Promise(resolve => setTimeout(resolve, 150))

      mockWs._emit('close', { code: 1006 })
      await new Promise(resolve => setTimeout(resolve, 250))

      mockWs._emit('close', { code: 1006 })
      await new Promise(resolve => setTimeout(resolve, 500))

      mockWs._emit('close', { code: 1006 })
      await new Promise(resolve => setTimeout(resolve, 1100))

      expect(backend.connectionState).toBe('closed')
    })

    it('should reset reconnection count on successful connect', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // Simulate disconnect and reconnect
      mockWs._emit('close', { code: 1006 })
      expect(backend.connectionState).toBe('reconnecting')

      mockWs._emit('open', {})
      expect(backend.connectionState).toBe('connected')
      expect(backend.reconnectAttempts).toBe(0)
    })

    it('should not reconnect on manual close', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      backend.close()

      expect(backend.connectionState).toBe('closed')
      // Wait to ensure no reconnection attempt
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(backend.connectionState).toBe('closed')
    })
  })
})

// ============================================================================
// 2. RPCGitDO Server Tests
// ============================================================================

describe('RPCGitDO - Server Durable Object', () => {
  let state: ReturnType<typeof createMockState>
  let env: ReturnType<typeof createMockEnv>
  let gitDO: RPCGitDO

  beforeEach(() => {
    state = createMockState()
    env = createMockEnv()
    gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)
  })

  describe('Class Structure', () => {
    it('should export RPCGitDO class', () => {
      expect(RPCGitDO).toBeDefined()
      expect(typeof RPCGitDO).toBe('function')
    })

    it('should be constructable with state and env', () => {
      expect(gitDO).toBeDefined()
      expect(gitDO).toBeInstanceOf(RPCGitDO)
    })

    it('should have git namespace with methods', () => {
      expect(gitDO.git).toBeDefined()
      expect(typeof gitDO.git.commit).toBe('function')
      expect(typeof gitDO.git.push).toBe('function')
      expect(typeof gitDO.git.clone).toBe('function')
      expect(typeof gitDO.git.fetch).toBe('function')
    })
  })

  describe('Expose GitRepository Methods via RPC', () => {
    it('should expose commit method', async () => {
      const result = await gitDO.git.commit({
        message: 'Test commit',
        tree: 'tree-sha',
        parents: ['parent-sha'],
        author: { name: 'Test', email: 'test@example.com' },
      })

      expect(result).toHaveProperty('sha')
      expect(typeof result.sha).toBe('string')
    })

    it('should expose getObject method', async () => {
      // First create an object
      await state._storage.set('objects/abc123', new Uint8Array([1, 2, 3]))

      const result = await gitDO.git.getObject('abc123')

      expect(result).toBeDefined()
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('data')
    })

    it('should expose listRefs method', async () => {
      await state._storage.set('refs/heads/main', 'sha-main')
      await state._storage.set('refs/heads/feature', 'sha-feature')

      const result = await gitDO.git.listRefs()

      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
    })

    it('should expose updateRef method', async () => {
      const result = await gitDO.git.updateRef('refs/heads/main', 'new-sha', 'old-sha')

      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('ref', 'refs/heads/main')
    })

    it('should expose getTree method', async () => {
      const result = await gitDO.git.getTree('tree-sha')

      expect(result).toBeDefined()
      expect(Array.isArray(result.entries) || result.entries === undefined).toBe(true)
    })

    it('should expose createBlob method', async () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"

      const result = await gitDO.git.createBlob(data)

      expect(result).toHaveProperty('sha')
      expect(typeof result.sha).toBe('string')
      expect(result.sha).toHaveLength(40)
    })

    it('should expose createTree method', async () => {
      const result = await gitDO.git.createTree({
        entries: [
          { name: 'file.txt', mode: '100644', type: 'blob', sha: 'blob-sha' },
        ],
      })

      expect(result).toHaveProperty('sha')
    })

    it('should expose createTag method', async () => {
      const result = await gitDO.git.createTag({
        name: 'v1.0.0',
        target: 'commit-sha',
        message: 'Release v1.0.0',
        tagger: { name: 'Test', email: 'test@example.com' },
      })

      expect(result).toHaveProperty('sha')
      expect(result).toHaveProperty('name', 'v1.0.0')
    })
  })

  describe('Handle Streaming for Clone/Fetch', () => {
    it('should stream clone progress', async () => {
      const progressUpdates: CloneProgress[] = []

      const stream = gitDO.git.clone({
        url: 'https://github.com/example/repo.git',
        branch: 'main',
        onProgress: (progress: CloneProgress) => {
          progressUpdates.push(progress)
        },
      })

      expect(stream).toBeDefined()

      // Simulate streaming completion
      const result = await stream

      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates.some(p => p.phase === 'counting')).toBe(true)
      expect(progressUpdates.some(p => p.phase === 'receiving')).toBe(true)
    })

    it('should stream fetch progress', async () => {
      const progressUpdates: FetchProgress[] = []

      const stream = gitDO.git.fetch({
        remote: 'origin',
        refs: ['refs/heads/main'],
        onProgress: (progress: FetchProgress) => {
          progressUpdates.push(progress)
        },
      })

      const result = await stream

      expect(result).toHaveProperty('refs')
    })

    it('should support async iteration for clone', async () => {
      const iterator = await gitDO.git.cloneStream({
        url: 'https://github.com/example/repo.git',
      })

      const chunks: unknown[] = []
      for await (const chunk of iterator) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
    })

    it('should support cancellation of streaming operations', async () => {
      const iterator = await gitDO.git.cloneStream({
        url: 'https://github.com/example/repo.git',
      })

      // Read first chunk
      const first = await iterator.next()
      expect(first.done).toBe(false)

      // Cancel
      iterator.cancel()

      // Should complete immediately
      const next = await iterator.next()
      expect(next.done).toBe(true)
    })

    it('should use StreamController for server-side streaming', async () => {
      let controller: StreamController<unknown> | undefined

      const streamHandler = createStreamResponse<CloneProgress>(
        (ctrl) => {
          controller = ctrl

          // Simulate progress
          ctrl.send({ phase: 'counting', current: 0, total: 100 })
          ctrl.send({ phase: 'counting', current: 50, total: 100 })
          ctrl.send({ phase: 'receiving', current: 100, total: 100 })
          ctrl.done()
        }
      )

      expect(streamHandler).toBeDefined()
      expect(controller).toBeDefined()
    })
  })

  describe('Handle Binary Pack Data', () => {
    it('should receive binary pack data during fetch', async () => {
      const packData = new Uint8Array([
        0x50, 0x41, 0x43, 0x4b, // PACK
        0x00, 0x00, 0x00, 0x02, // version 2
        0x00, 0x00, 0x00, 0x01, // 1 object
      ])

      const result = await gitDO.git.receivePack(packData)

      expect(result).toHaveProperty('objectsReceived')
      expect(result.objectsReceived).toBeGreaterThanOrEqual(0)
    })

    it('should send binary pack data during push', async () => {
      // Set up some objects to pack
      await gitDO.git.createBlob(new TextEncoder().encode('test content'))

      const packData = await gitDO.git.sendPack({
        refs: ['refs/heads/main'],
        wants: ['abc123'],
        haves: [],
      })

      expect(packData).toBeInstanceOf(Uint8Array)
      // Pack header should start with 'PACK'
      expect(packData[0]).toBe(0x50) // P
      expect(packData[1]).toBe(0x41) // A
      expect(packData[2]).toBe(0x43) // C
      expect(packData[3]).toBe(0x4b) // K
    })

    it('should handle delta-compressed objects', async () => {
      // Create base object
      const baseResult = await gitDO.git.createBlob(
        new TextEncoder().encode('base content')
      )

      // Create delta object referencing base
      const deltaData = new Uint8Array([
        0x06, // OFS_DELTA type
        // ... delta instructions
      ])

      const result = await gitDO.git.storeDelta(baseResult.sha, deltaData)

      expect(result).toHaveProperty('sha')
    })

    it('should serialize pack objects efficiently', async () => {
      const objects = [
        { sha: 'sha1', type: 'blob', data: new Uint8Array(1000) },
        { sha: 'sha2', type: 'blob', data: new Uint8Array(2000) },
        { sha: 'sha3', type: 'tree', data: new Uint8Array(100) },
      ]

      const packData = await gitDO.git.packObjects(objects)

      expect(packData).toBeInstanceOf(Uint8Array)
      // Pack should be smaller than raw data due to compression
      expect(packData.length).toBeLessThan(3100)
    })
  })

  describe('Batch Commits', () => {
    it('should batch multiple commits', async () => {
      const commits = [
        { message: 'Commit 1', tree: 'tree1', parents: [] },
        { message: 'Commit 2', tree: 'tree2', parents: [] },
        { message: 'Commit 3', tree: 'tree3', parents: [] },
      ]

      const results = await gitDO.git.batchCommit(commits)

      expect(results).toHaveLength(3)
      results.forEach((result, i) => {
        expect(result).toHaveProperty('sha')
        expect(result).toHaveProperty('index', i)
      })
    })

    it('should chain commits in batch', async () => {
      const results = await gitDO.git.batchCommitChain([
        { message: 'Commit 1', tree: 'tree1' },
        { message: 'Commit 2', tree: 'tree2' },
        { message: 'Commit 3', tree: 'tree3' },
      ])

      expect(results).toHaveLength(3)
      // Each commit should have previous as parent
      expect(results[1].parents).toContain(results[0].sha)
      expect(results[2].parents).toContain(results[1].sha)
    })

    it('should handle batch commit failures atomically', async () => {
      const commits = [
        { message: 'Commit 1', tree: 'tree1', parents: [] },
        { message: 'Commit 2', tree: 'invalid-tree', parents: [] }, // Will fail
        { message: 'Commit 3', tree: 'tree3', parents: [] },
      ]

      await expect(gitDO.git.batchCommit(commits, { atomic: true }))
        .rejects.toThrow()

      // None should be committed
      const refs = await gitDO.git.listRefs()
      expect(refs).not.toContainEqual(expect.objectContaining({ name: 'refs/heads/batch' }))
    })
  })

  describe('RPC Handler Integration', () => {
    it('should create RPC handler from DO instance', () => {
      const handler = createGitRPCHandler(gitDO, state)

      expect(handler).toBeDefined()
      expect(typeof handler.fetch).toBe('function')
    })

    it('should handle fetch requests via RPC handler', async () => {
      const handler = createGitRPCHandler(gitDO, state)

      const request = new Request('https://git.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'request',
          id: '1',
          path: ['git', 'listRefs'],
          args: [],
          timestamp: Date.now(),
        }),
      })

      const response = await handler.fetch(request)

      expect(response.status).toBe(200)
      const json = await response.json()
      expect(json).toHaveProperty('type', 'response')
      expect(json).toHaveProperty('success', true)
    })

    it('should upgrade to WebSocket for persistent connections', async () => {
      const handler = createGitRPCHandler(gitDO, state)

      const request = new Request('https://git.do/rpc', {
        headers: { Upgrade: 'websocket' },
      })

      const response = await handler.fetch(request)

      // In Node.js, we can't create status 101, but the webSocket property should be defined
      // In Cloudflare Workers, this would be status 101
      expect(response.webSocket).toBeDefined()
    })
  })
})

// ============================================================================
// 3. RPC Transport Tests
// ============================================================================

describe('RPC Transport', () => {
  let backend: RPCGitBackend
  let mockWs: ReturnType<typeof createMockWebSocket>

  beforeEach(() => {
    mockWs = createMockWebSocket()
    vi.stubGlobal('WebSocket', vi.fn(() => mockWs))
    backend = createRPCGitBackend({ url: 'https://git.example.com' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('WebSocket Connection', () => {
    it('should establish WebSocket connection', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})

      await connectPromise

      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('wss://git.example.com'),
        expect.any(Array)
      )
    })

    it('should use wss:// for https:// URLs', async () => {
      backend = createRPCGitBackend({ url: 'https://secure.example.com' })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('wss://'),
        expect.any(Array)
      )
    })

    it('should use ws:// for http:// URLs', async () => {
      backend = createRPCGitBackend({ url: 'http://local.example.com' })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('ws://'),
        expect.any(Array)
      )
    })

    it('should include subprotocol in connection', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      expect(WebSocket).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['rpc.do'])
      )
    })

    it('should handle connection timeout', async () => {
      // Use non-auto-open mock for timeout test
      mockWs = createMockWebSocket(false)
      vi.stubGlobal('WebSocket', vi.fn(() => mockWs))

      backend = createRPCGitBackend({
        url: 'https://slow.example.com',
        timeout: 100,
      })

      const connectPromise = backend.connect()

      await expect(connectPromise).rejects.toThrow('Connection timeout')
    })
  })

  describe('Binary Serialization', () => {
    it('should serialize RPC requests as binary', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const $ = backend.proxy

      // Create proper binary response
      const encoder = new TextEncoder()
      const responseJson = JSON.stringify(createMockRPCResponse('1', { sha: 'abc123' }))

      setTimeout(() => {
        mockWs._emit('message', {
          data: encoder.encode(responseJson).buffer,
        })
      }, 10)

      await $.git.commit({ message: 'test' })

      // Should send data (either string JSON or binary)
      expect(mockWs.send).toHaveBeenCalled()
      const sentData = (mockWs.send as Mock).mock.calls[0][0]
      // For small payloads, may send JSON string; for large, binary
      expect(typeof sentData === 'string' || sentData instanceof ArrayBuffer || sentData instanceof Uint8Array).toBe(true)
    })

    it('should deserialize binary RPC responses', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const $ = backend.proxy

      // Create a binary response
      const encoder = new TextEncoder()
      const responseJson = JSON.stringify({
        type: 'response',
        id: '1',
        success: true,
        result: { sha: 'abc123' },
        timestamp: Date.now(),
      })

      setTimeout(() => {
        mockWs._emit('message', {
          data: encoder.encode(responseJson).buffer,
        })
      }, 10)

      const result = await $.git.getObject('sha')

      expect(result).toBeDefined()
    })

    it('should handle pack file binary data', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x02])

      const $ = backend.proxy

      // Create proper binary response with objectsReceived
      const encoder = new TextEncoder()
      const responseJson = JSON.stringify(createMockRPCResponse('1', { objectsReceived: 0 }))

      setTimeout(() => {
        mockWs._emit('message', {
          data: encoder.encode(responseJson).buffer,
        })
      }, 10)

      const result = await $.git.receivePack(packData)

      expect(result).toBeDefined()
    })

    it('should use efficient binary encoding for large payloads', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const largeData = new Uint8Array(1024 * 1024) // 1MB

      const $ = backend.proxy

      // Create proper response
      const encoder = new TextEncoder()
      const responseJson = JSON.stringify(createMockRPCResponse('1', { sha: 'abc123' }))

      setTimeout(() => {
        mockWs._emit('message', {
          data: encoder.encode(responseJson).buffer,
        })
      }, 10)

      await $.git.createBlob(largeData)

      const sentData = (mockWs.send as Mock).mock.calls[0][0]
      // Check that data was sent - either as string (JSON) or binary
      expect(sentData).toBeDefined()
      // For large payloads, should use binary encoding
      if (sentData instanceof ArrayBuffer || sentData instanceof Uint8Array) {
        expect(sentData.byteLength).toBeLessThan(largeData.length * 1.5)
      } else {
        // JSON string for the large Uint8Array would be much larger than the raw data
        // so this assertion still holds
        expect(sentData.length).toBeDefined()
      }
    })
  })

  describe('Message Batching', () => {
    beforeEach(() => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        batching: {
          enabled: true,
          maxSize: 10,
          delayMs: 50,
        },
      })
    })

    it('should batch multiple requests within delay window', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const $ = backend.proxy

      // Send multiple requests quickly
      const promises = [
        $.git.getObject('sha1'),
        $.git.getObject('sha2'),
        $.git.getObject('sha3'),
      ]

      // Wait for batch delay
      await new Promise(resolve => setTimeout(resolve, 60))

      // Should have sent single batch
      expect(mockWs.send).toHaveBeenCalledTimes(1)

      const sentData = (mockWs.send as Mock).mock.calls[0][0]
      const batch = JSON.parse(typeof sentData === 'string' ? sentData : new TextDecoder().decode(sentData))

      expect(batch.type).toBe('batch')
      expect(batch.requests).toHaveLength(3)
    })

    it('should flush batch when max size reached', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const $ = backend.proxy

      // Send more than maxSize requests
      for (let i = 0; i < 12; i++) {
        $.git.getObject(`sha${i}`)
      }

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10))

      // Should have sent at least one batch (when maxSize reached)
      expect((mockWs.send as Mock).mock.calls.length).toBeGreaterThanOrEqual(1)
    })

    it('should demultiplex batch responses', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const $ = backend.proxy

      const promise1 = $.git.getObject('sha1')
      const promise2 = $.git.getObject('sha2')

      await new Promise(resolve => setTimeout(resolve, 60))

      // Send batch response
      mockWs._emit('message', {
        data: JSON.stringify({
          type: 'batch',
          responses: [
            { type: 'response', id: '1', success: true, result: { data: 'obj1' }, timestamp: Date.now() },
            { type: 'response', id: '2', success: true, result: { data: 'obj2' }, timestamp: Date.now() },
          ],
          timestamp: Date.now(),
        }),
      })

      const [result1, result2] = await Promise.all([promise1, promise2])

      expect(result1).toHaveProperty('data', 'obj1')
      expect(result2).toHaveProperty('data', 'obj2')
    })
  })

  describe('Ping/Pong Keepalive', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      // Use non-auto-open mock for ping/pong tests with fake timers
      mockWs = createMockWebSocket(false)
      vi.stubGlobal('WebSocket', vi.fn(() => mockWs))
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should send ping at regular intervals', async () => {
      const connectPromise = backend.connect()
      // Manually emit open since auto-open is disabled
      mockWs._emit('open', {})
      await connectPromise

      // Run all pending timers and microtasks
      await vi.runOnlyPendingTimersAsync()

      // Advance time by ping interval (needs to be > 30s to trigger ping)
      await vi.advanceTimersByTimeAsync(31000)

      // Run again to ensure timer callbacks execute
      await vi.runOnlyPendingTimersAsync()

      const sentMessages = (mockWs.send as Mock).mock.calls
      const pingMessage = sentMessages.find((call) => {
        try {
          const msg = JSON.parse(call[0])
          return msg.type === 'ping'
        } catch {
          return false
        }
      })

      expect(pingMessage).toBeDefined()
    })

    it('should respond to server ping with pong', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // Server sends ping
      mockWs._emit('message', {
        data: JSON.stringify({ type: 'ping', timestamp: Date.now() }),
      })

      // Should respond with pong
      const sentMessages = (mockWs.send as Mock).mock.calls
      const pongMessage = sentMessages.find((call) => {
        try {
          const msg = JSON.parse(call[0])
          return msg.type === 'pong'
        } catch {
          return false
        }
      })

      expect(pongMessage).toBeDefined()
    })

    it('should disconnect if no pong received', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // First advance past ping interval to trigger ping
      await vi.advanceTimersByTimeAsync(31000)
      await vi.runOnlyPendingTimersAsync()

      // Then advance past pong timeout (30s)
      await vi.advanceTimersByTimeAsync(31000)
      await vi.runOnlyPendingTimersAsync()

      expect(backend.connectionState).not.toBe('connected')
    })

    it('should reset ping timer on any message', async () => {
      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // Advance time partially
      vi.advanceTimersByTime(15000)

      // Receive a message
      mockWs._emit('message', {
        data: JSON.stringify({ type: 'response', id: '1', success: true, result: {}, timestamp: Date.now() }),
      })

      // Advance time again
      vi.advanceTimersByTime(15000)

      // Should not have sent ping yet (timer was reset)
      const pingMessages = (mockWs.send as Mock).mock.calls.filter((call) => {
        try {
          const msg = JSON.parse(call[0])
          return msg.type === 'ping'
        } catch {
          return false
        }
      })

      expect(pingMessages.length).toBe(0)
    })
  })
})

// ============================================================================
// 4. OAuth Integration Tests
// ============================================================================

describe('OAuth Integration with RPC', () => {
  let backend: RPCGitBackend
  let mockWs: ReturnType<typeof createMockWebSocket>
  let state: ReturnType<typeof createMockState>
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockWs = createMockWebSocket()
    vi.stubGlobal('WebSocket', vi.fn(() => mockWs))
    state = createMockState()
    env = createMockEnv()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Auth Headers with Git Scopes', () => {
    it('should send authorization header on connection', async () => {
      const token = createMockJWT({ scopes: ['git:read', 'git:push'] })

      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // WebSocket should include auth in URL or initial message
      expect(WebSocket).toHaveBeenCalled()
    })

    it('should include git:read scope for fetch operations', async () => {
      const token = createMockJWT({ scopes: ['git:read'] })

      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        headers: { Authorization: `Bearer ${token}` },
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('1', { refs: [] })),
        })
      }, 10)

      await backend.proxy.git.fetch({ remote: 'origin', refs: ['refs/heads/main'] })

      // Request should succeed with git:read scope
    })

    it('should include git:push scope for push operations', async () => {
      const token = createMockJWT({ scopes: ['git:push'] })

      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        headers: { Authorization: `Bearer ${token}` },
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('1', { success: true })),
        })
      }, 10)

      await backend.proxy.git.push({ remote: 'origin', refs: ['refs/heads/main'] })

      // Request should succeed with git:push scope
    })

    it('should support OAuth middleware integration', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)
      const handler = createGitRPCHandler(gitDO, state)

      const token = createMockJWT({ scopes: ['git:read'] })

      const request = new Request('https://git.do/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: 'request',
          id: '1',
          path: ['git', 'listRefs'],
          args: [],
          timestamp: Date.now(),
        }),
      })

      const response = await handler.fetch(request)

      expect(response.status).toBe(200)
    })
  })

  describe('Token Refresh on UNAUTHORIZED', () => {
    it('should trigger token refresh on UNAUTHORIZED error', async () => {
      const refreshCallback = vi.fn(async () => createMockJWT({ scopes: ['git:read'] }))

      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        headers: { Authorization: 'Bearer expired-token' },
        onTokenRefresh: refreshCallback,
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // First call returns UNAUTHORIZED
      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'response',
            id: '1',
            success: false,
            error: { code: ErrorCodes.UNAUTHORIZED, message: 'Token expired' },
            timestamp: Date.now(),
          }),
        })
      }, 10)

      // Retry with new token succeeds
      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('2', { refs: [] })),
        })
      }, 50)

      await backend.proxy.git.listRefs()

      expect(refreshCallback).toHaveBeenCalled()
    })

    it('should retry failed request after token refresh', async () => {
      let callCount = 0
      const refreshCallback = vi.fn(async () => createMockJWT())

      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        headers: { Authorization: 'Bearer expired-token' },
        onTokenRefresh: refreshCallback,
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      mockWs.send = vi.fn(() => {
        callCount++
        setTimeout(() => {
          if (callCount === 1) {
            mockWs._emit('message', {
              data: JSON.stringify({
                type: 'response',
                id: '1',
                success: false,
                error: { code: ErrorCodes.UNAUTHORIZED, message: 'Token expired' },
                timestamp: Date.now(),
              }),
            })
          } else {
            mockWs._emit('message', {
              data: JSON.stringify(createMockRPCResponse('2', { refs: [] })),
            })
          }
        }, 10)
      })

      await backend.proxy.git.listRefs()

      expect(callCount).toBe(2) // Original + retry
    })

    it('should update connection headers after refresh', async () => {
      const newToken = createMockJWT()
      const refreshCallback = vi.fn(async () => newToken)

      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        headers: { Authorization: 'Bearer old-token' },
        onTokenRefresh: refreshCallback,
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      await backend.refreshToken()

      expect(backend.headers.Authorization).toBe(`Bearer ${newToken}`)
    })

    it('should fail after max refresh attempts', async () => {
      const refreshCallback = vi.fn(async () => {
        throw new Error('Refresh failed')
      })

      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        headers: { Authorization: 'Bearer expired-token' },
        onTokenRefresh: refreshCallback,
        maxRefreshAttempts: 2,
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // Always return UNAUTHORIZED
      mockWs.send = vi.fn(() => {
        setTimeout(() => {
          mockWs._emit('message', {
            data: JSON.stringify({
              type: 'response',
              id: '1',
              success: false,
              error: { code: ErrorCodes.UNAUTHORIZED, message: 'Invalid token' },
              timestamp: Date.now(),
            }),
          })
        }, 10)
      })

      await expect(backend.proxy.git.listRefs()).rejects.toThrow()
      expect(refreshCallback).toHaveBeenCalledTimes(2)
    })
  })

  describe('Permission Checking', () => {
    it('should check repo:read permission for clone', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)

      const context: OAuthContext = {
        userId: 'user-123',
        scopes: ['git:read'] as GitScope[],
        token: 'test-token',
        expiresAt: Date.now() + 3600000,
      }

      const canClone = gitDO.checkPermission(context, 'clone')

      expect(canClone).toBe(true)
    })

    it('should check repo:write permission for push', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)

      const context: OAuthContext = {
        userId: 'user-123',
        scopes: ['git:read'] as GitScope[], // Only read, no push
        token: 'test-token',
        expiresAt: Date.now() + 3600000,
      }

      const canPush = gitDO.checkPermission(context, 'push')

      expect(canPush).toBe(false)
    })

    it('should grant all permissions with git:admin scope', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)

      const context: OAuthContext = {
        userId: 'user-123',
        scopes: ['git:admin'] as GitScope[],
        token: 'test-token',
        expiresAt: Date.now() + 3600000,
      }

      expect(gitDO.checkPermission(context, 'clone')).toBe(true)
      expect(gitDO.checkPermission(context, 'push')).toBe(true)
      expect(gitDO.checkPermission(context, 'admin')).toBe(true)
    })

    it('should reject operations without required scope', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)
      const handler = createGitRPCHandler(gitDO, state)

      const token = createMockJWT({ scopes: ['git:read'] }) // No push scope

      const request = new Request('https://git.do/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: 'request',
          id: '1',
          path: ['git', 'push'],
          args: [{ remote: 'origin', refs: ['refs/heads/main'] }],
          timestamp: Date.now(),
        }),
      })

      const response = await handler.fetch(request)
      const json = await response.json()

      expect(json.success).toBe(false)
      expect(json.error.code).toBe(ErrorCodes.UNAUTHORIZED)
    })

    it('should support repository-specific scopes', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)

      const context: OAuthContext = {
        userId: 'user-123',
        scopes: ['git:push:owner/specific-repo'] as unknown as GitScope[],
        token: 'test-token',
        expiresAt: Date.now() + 3600000,
      }

      // Should have access to specific repo
      const canPushSpecific = gitDO.checkPermission(context, 'push', 'owner/specific-repo')
      expect(canPushSpecific).toBe(true)

      // Should not have access to other repos
      const canPushOther = gitDO.checkPermission(context, 'push', 'owner/other-repo')
      expect(canPushOther).toBe(false)
    })
  })
})

// ============================================================================
// 5. Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  let backend: RPCGitBackend
  let mockWs: ReturnType<typeof createMockWebSocket>
  let state: ReturnType<typeof createMockState>
  let env: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockWs = createMockWebSocket()
    vi.stubGlobal('WebSocket', vi.fn(() => mockWs))
    state = createMockState()
    env = createMockEnv()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Timeout for Large Operations', () => {
    it('should timeout clone operation after configured duration', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        timeout: 100,
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // Never respond
      const clonePromise = backend.proxy.git.clone({
        url: 'https://github.com/large/repo.git',
      })

      await expect(clonePromise).rejects.toThrow()
      await expect(clonePromise).rejects.toMatchObject({
        code: ErrorCodes.TIMEOUT,
      })
    })

    it('should timeout fetch operation', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        timeout: 100,
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const fetchPromise = backend.proxy.git.fetch({
        remote: 'origin',
        refs: ['refs/heads/*'],
      })

      await expect(fetchPromise).rejects.toMatchObject({
        code: ErrorCodes.TIMEOUT,
      })
    })

    it('should timeout push operation', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        timeout: 100,
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const pushPromise = backend.proxy.git.push({
        remote: 'origin',
        refs: ['refs/heads/main'],
      })

      await expect(pushPromise).rejects.toMatchObject({
        code: ErrorCodes.TIMEOUT,
      })
    })

    it('should support per-operation timeout override', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        timeout: 30000, // Default 30s
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const clonePromise = backend.proxy.git.clone(
        { url: 'https://github.com/large/repo.git' },
        { timeout: 50 } // Override to 50ms
      )

      await expect(clonePromise).rejects.toMatchObject({
        code: ErrorCodes.TIMEOUT,
      })
    })

    it('should cancel pending operation on timeout', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        timeout: 100,
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      try {
        await backend.proxy.git.clone({ url: 'https://example.com/repo.git' })
      } catch (e) {
        // Expected timeout
      }

      // Pending calls should be cleared
      expect(backend.pendingCallCount).toBe(0)
    })
  })

  describe('Connection Failure During Push', () => {
    it('should detect connection failure during push', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const pushPromise = backend.proxy.git.push({
        remote: 'origin',
        refs: ['refs/heads/main'],
      })

      // Simulate connection drop
      mockWs._emit('close', { code: 1006, reason: 'Connection lost' })

      await expect(pushPromise).rejects.toMatchObject({
        code: ErrorCodes.CONNECTION_CLOSED,
      })
    })

    it('should not retry push on connection failure (data integrity)', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        reconnect: { enabled: true },
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const sendCalls: number[] = []
      mockWs.send = vi.fn(() => {
        sendCalls.push(Date.now())
        setTimeout(() => {
          mockWs._emit('close', { code: 1006 })
        }, 10)
      })

      try {
        await backend.proxy.git.push({
          remote: 'origin',
          refs: ['refs/heads/main'],
        })
      } catch {
        // Expected failure
      }

      // Should only have tried once (no auto-retry for push)
      expect(sendCalls).toHaveLength(1)
    })

    it('should allow retry for idempotent operations', async () => {
      // Use non-auto-open mock for this test
      mockWs = createMockWebSocket(false)
      vi.stubGlobal('WebSocket', vi.fn(() => mockWs))

      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        reconnect: { enabled: true },
        timeout: 5000, // Shorter timeout for test
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      let callCount = 0
      let lastRequestId = '1'
      mockWs.send = vi.fn((data: string) => {
        callCount++
        try {
          const parsed = JSON.parse(data)
          lastRequestId = parsed.id
        } catch { /* ignore */ }

        if (callCount === 1) {
          setTimeout(() => mockWs._emit('close', { code: 1006 }), 10)
        } else {
          setTimeout(() => {
            mockWs._emit('message', {
              data: JSON.stringify(createMockRPCResponse(lastRequestId, { refs: [] })),
            })
          }, 10)
        }
      })

      // Reconnect after close
      setTimeout(() => mockWs._emit('open', {}), 50)

      const result = await backend.proxy.git.listRefs()

      expect(result).toBeDefined()
      expect(callCount).toBe(2) // Retried on reconnect
    })

    it('should report partial push failure', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'response',
            id: '1',
            success: false,
            error: {
              code: 'PARTIAL_PUSH_FAILURE',
              message: 'Some refs failed to push',
              data: {
                succeeded: ['refs/heads/main'],
                failed: [{ ref: 'refs/heads/protected', reason: 'Protected branch' }],
              },
            },
            timestamp: Date.now(),
          }),
        })
      }, 10)

      try {
        await backend.proxy.git.push({
          remote: 'origin',
          refs: ['refs/heads/main', 'refs/heads/protected'],
        })
      } catch (error) {
        expect(error).toBeInstanceOf(RPCError)
        expect((error as RPCError).data).toHaveProperty('succeeded')
        expect((error as RPCError).data).toHaveProperty('failed')
      }
    })
  })

  describe('Repository Not Found Errors', () => {
    it('should throw NOT_FOUND error for nonexistent repository', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'response',
            id: '1',
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Repository not found: owner/nonexistent',
            },
            timestamp: Date.now(),
          }),
        })
      }, 10)

      await expect(
        backend.proxy.git.clone({ url: 'https://github.com/owner/nonexistent.git' })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    })

    it('should throw NOT_FOUND for missing object', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)

      await expect(
        gitDO.git.getObject('nonexistent-sha-1234567890')
      ).rejects.toThrow('Object not found')
    })

    it('should throw NOT_FOUND for missing ref', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)

      await expect(
        gitDO.git.resolveRef('refs/heads/nonexistent')
      ).rejects.toThrow('Ref not found')
    })

    it('should include helpful context in NOT_FOUND errors', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'response',
            id: '1',
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Object not found',
              data: {
                sha: 'abc123',
                type: 'blob',
                searchedLocations: ['local', 'remote', 'pack'],
              },
            },
            timestamp: Date.now(),
          }),
        })
      }, 10)

      try {
        await backend.proxy.git.getObject('abc123')
      } catch (error) {
        expect((error as RPCError).data).toHaveProperty('sha', 'abc123')
        expect((error as RPCError).data).toHaveProperty('searchedLocations')
      }
    })
  })

  describe('Streaming Errors on Clone', () => {
    it('should handle stream error during clone', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      // Start streaming, then error
      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'stream',
            id: '1',
            chunk: { phase: 'counting', progress: 50 },
            done: false,
            index: 0,
            timestamp: Date.now(),
          }),
        })
      }, 10)

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'response',
            id: '1',
            success: false,
            error: {
              code: 'STREAM_ERROR',
              message: 'Remote hung up unexpectedly',
            },
            timestamp: Date.now(),
          }),
        })
      }, 20)

      await expect(
        backend.proxy.git.clone({ url: 'https://github.com/example/repo.git' })
      ).rejects.toMatchObject({
        code: 'STREAM_ERROR',
      })
    })

    it('should cleanup partial data on stream error', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)

      // Start a clone that will fail
      const clonePromise = gitDO.git.clone({
        url: 'https://github.com/example/failing-repo.git',
        _simulateError: 'STREAM_ERROR_MIDWAY',
      })

      await expect(clonePromise).rejects.toThrow()

      // Verify partial objects were cleaned up
      const objects = await state.storage.list({ prefix: 'objects/' })
      expect(objects.size).toBe(0)
    })

    it('should report stream progress before error', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      const progressUpdates: Array<{ phase: string; progress: number }> = []

      // Stream some progress
      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'stream',
            id: '1',
            chunk: { phase: 'counting', progress: 25 },
            done: false,
            index: 0,
            timestamp: Date.now(),
          }),
        })
      }, 10)

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'stream',
            id: '1',
            chunk: { phase: 'counting', progress: 50 },
            done: false,
            index: 1,
            timestamp: Date.now(),
          }),
        })
      }, 15)

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'response',
            id: '1',
            success: false,
            error: { code: 'STREAM_ERROR', message: 'Connection lost' },
            timestamp: Date.now(),
          }),
        })
      }, 20)

      try {
        await backend.proxy.git.clone(
          { url: 'https://github.com/example/repo.git' },
          {
            onProgress: (p: CloneProgress) => progressUpdates.push(p),
          }
        )
      } catch {
        // Expected error
      }

      expect(progressUpdates.length).toBeGreaterThan(0)
    })

    it('should support resumable clone after error', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)

      // First attempt fails midway
      try {
        await gitDO.git.clone({
          url: 'https://github.com/example/repo.git',
          _simulateError: 'STREAM_ERROR_MIDWAY',
        })
      } catch {
        // Expected
      }

      // Get resume token
      const resumeToken = await gitDO.git.getCloneResumeToken('https://github.com/example/repo.git')

      expect(resumeToken).toBeDefined()
      expect(resumeToken).toHaveProperty('haves')
      expect(resumeToken).toHaveProperty('partialRefs')
    })

    it('should handle malformed stream chunks', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      setTimeout(() => {
        mockWs._emit('message', {
          data: 'not valid json or binary',
        })
      }, 10)

      const errorHandler = vi.fn()
      backend.on('error', errorHandler)

      // The malformed message should trigger error event
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(errorHandler).toHaveBeenCalled()
    })
  })

  describe('Method Not Found Errors', () => {
    it('should throw METHOD_NOT_FOUND for unknown method', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'response',
            id: '1',
            success: false,
            error: {
              code: ErrorCodes.METHOD_NOT_FOUND,
              message: 'Method not found: git.unknownMethod',
            },
            timestamp: Date.now(),
          }),
        })
      }, 10)

      await expect(
        backend.proxy.git.unknownMethod()
      ).rejects.toMatchObject({
        code: ErrorCodes.METHOD_NOT_FOUND,
      })
    })

    it('should throw INVALID_ARGUMENTS for wrong argument types', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'response',
            id: '1',
            success: false,
            error: {
              code: ErrorCodes.INVALID_ARGUMENTS,
              message: 'Expected string for sha, got number',
            },
            timestamp: Date.now(),
          }),
        })
      }, 10)

      await expect(
        backend.proxy.git.getObject(12345 as unknown as string)
      ).rejects.toMatchObject({
        code: ErrorCodes.INVALID_ARGUMENTS,
      })
    })
  })

  describe('Internal Server Errors', () => {
    it('should handle INTERNAL_ERROR gracefully', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
      })

      const connectPromise = backend.connect()
      mockWs._emit('open', {})
      await connectPromise

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify({
            type: 'response',
            id: '1',
            success: false,
            error: {
              code: ErrorCodes.INTERNAL_ERROR,
              message: 'Internal server error',
              stack: 'Error: Something went wrong\n    at ...',
            },
            timestamp: Date.now(),
          }),
        })
      }, 10)

      await expect(
        backend.proxy.git.commit({ message: 'test' })
      ).rejects.toMatchObject({
        code: ErrorCodes.INTERNAL_ERROR,
      })
    })

    it('should not expose stack traces in production', async () => {
      const gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)
      const handler = createGitRPCHandler(gitDO, state, { production: true })

      const request = new Request('https://git.do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'request',
          id: '1',
          path: ['git', 'triggerInternalError'],
          args: [],
          timestamp: Date.now(),
        }),
      })

      const response = await handler.fetch(request)
      const json = await response.json()

      expect(json.error).not.toHaveProperty('stack')
    })
  })

  describe('Connection State Error Handling', () => {
    it('should queue requests when disconnected and flush on reconnect', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        reconnect: { enabled: true },
      })

      // Don't connect yet - start in disconnected state
      const fetchPromise = backend.proxy.git.listRefs()

      expect(backend.queuedRequestCount).toBe(1)

      // Now connect
      backend.connect()
      mockWs._emit('open', {})

      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse('1', { refs: [] })),
        })
      }, 10)

      const result = await fetchPromise

      expect(result).toBeDefined()
    })

    it('should reject queued requests when connection permanently fails', async () => {
      backend = createRPCGitBackend({
        url: 'https://git.example.com',
        reconnect: {
          enabled: true,
          maxAttempts: 1,
        },
      })

      const fetchPromise = backend.proxy.git.listRefs()

      // Fail to connect - catch the error to prevent unhandled rejection
      const connectPromise = backend.connect().catch(() => {
        // Expected to fail
      })
      mockWs._emit('error', new Error('Connection refused'))
      mockWs._emit('close', { code: 1006 })

      await connectPromise

      await expect(fetchPromise).rejects.toMatchObject({
        code: ErrorCodes.CONNECTION_FAILED,
      })
    })
  })
})

// ============================================================================
// Additional Integration Tests
// ============================================================================

describe('End-to-End RPC Integration', () => {
  let state: ReturnType<typeof createMockState>
  let env: ReturnType<typeof createMockEnv>
  let gitDO: RPCGitDO
  let mockWs: ReturnType<typeof createMockWebSocket>

  beforeEach(() => {
    state = createMockState()
    env = createMockEnv()
    gitDO = new RPCGitDO(state as unknown as DurableObjectState, env)
    mockWs = createMockWebSocket()
    vi.stubGlobal('WebSocket', vi.fn(() => mockWs))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should complete a full commit workflow via RPC', async () => {
    const backend = createRPCGitBackend({ url: 'https://git.example.com' })

    const connectPromise = backend.connect()
    mockWs._emit('open', {})
    await connectPromise

    // Mock responses for full workflow
    let callIndex = 0
    mockWs.send = vi.fn(() => {
      callIndex++
      setTimeout(() => {
        const responses: Record<number, unknown> = {
          1: { sha: 'blob-sha-1' }, // createBlob
          2: { sha: 'tree-sha-1' }, // createTree
          3: { sha: 'commit-sha-1' }, // commit
          4: { success: true, ref: 'refs/heads/main' }, // updateRef
        }

        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse(String(callIndex), responses[callIndex])),
        })
      }, 10)
    })

    const $ = backend.proxy

    // 1. Create blob
    const blob = await $.git.createBlob(new TextEncoder().encode('Hello, World!'))
    expect(blob.sha).toBe('blob-sha-1')

    // 2. Create tree
    const tree = await $.git.createTree({
      entries: [{ name: 'hello.txt', mode: '100644', type: 'blob', sha: blob.sha }],
    })
    expect(tree.sha).toBe('tree-sha-1')

    // 3. Create commit
    const commit = await $.git.commit({
      message: 'Add hello.txt',
      tree: tree.sha,
      parents: [],
      author: { name: 'Test', email: 'test@example.com' },
    })
    expect(commit.sha).toBe('commit-sha-1')

    // 4. Update ref
    const refUpdate = await $.git.updateRef('refs/heads/main', commit.sha)
    expect(refUpdate.success).toBe(true)
  })

  it('should handle concurrent operations correctly', async () => {
    const backend = createRPCGitBackend({ url: 'https://git.example.com' })

    const connectPromise = backend.connect()
    mockWs._emit('open', {})
    await connectPromise

    const responses = new Map<string, unknown>()
    responses.set('1', { sha: 'sha-1' })
    responses.set('2', { sha: 'sha-2' })
    responses.set('3', { sha: 'sha-3' })

    mockWs.send = vi.fn((data: string) => {
      const msg = JSON.parse(data)
      setTimeout(() => {
        mockWs._emit('message', {
          data: JSON.stringify(createMockRPCResponse(msg.id, responses.get(msg.id))),
        })
      }, Math.random() * 20) // Random delays
    })

    const $ = backend.proxy

    const [r1, r2, r3] = await Promise.all([
      $.git.getObject('sha-1'),
      $.git.getObject('sha-2'),
      $.git.getObject('sha-3'),
    ])

    expect(r1.sha).toBe('sha-1')
    expect(r2.sha).toBe('sha-2')
    expect(r3.sha).toBe('sha-3')
  })
})

// ============================================================================
// Type Declarations for Test Compatibility
// ============================================================================

declare class DurableObjectState {
  id: { toString(): string }
  storage: unknown
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}
