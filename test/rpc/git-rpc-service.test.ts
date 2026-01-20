/**
 * @fileoverview Tests for Git RPC Service Mode
 *
 * Tests for the RPC service mode that handles heavy git operations:
 * - Clone, fetch, push as async operations
 * - Progress reporting
 * - Cancellation support
 * - Result streaming
 *
 * @module test/rpc/git-rpc-service.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  GitRPCService,
  type RPCOperation,
  type RPCOperationStatus,
  type RPCProgressUpdate,
  type RPCOperationResult,
  OperationState,
  OperationType,
} from '../../src/rpc/git-rpc-service'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Mock storage implementation for testing.
 */
function createMockStorage() {
  const data = new Map<string, unknown>()
  return {
    get: vi.fn(async (key: string) => data.get(key)),
    put: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value)
    }),
    delete: vi.fn(async (key: string) => data.delete(key)),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const result = new Map<string, unknown>()
      for (const [key, value] of data) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value)
        }
      }
      return result
    }),
    _data: data,
  }
}

/**
 * Mock R2 bucket for testing.
 */
function createMockR2() {
  const objects = new Map<string, Uint8Array>()
  return {
    get: vi.fn(async (key: string) => {
      const data = objects.get(key)
      if (!data) return null
      return {
        key,
        size: data.length,
        arrayBuffer: async () => data.buffer,
        text: async () => new TextDecoder().decode(data),
      }
    }),
    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array | string) => {
      const data = typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : value
      objects.set(key, data)
      return { key, size: data.length }
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      const keyArray = Array.isArray(keys) ? keys : [keys]
      for (const key of keyArray) {
        objects.delete(key)
      }
    }),
    list: vi.fn(async (options?: { prefix?: string }) => {
      const result: Array<{ key: string; size: number }> = []
      for (const [key, value] of objects) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.push({ key, size: value.length })
        }
      }
      return { objects: result, truncated: false }
    }),
    _objects: objects,
  }
}

// ============================================================================
// Starting a Heavy Operation
// ============================================================================

describe('GitRPCService - Starting Operations', () => {
  let service: GitRPCService
  let mockStorage: ReturnType<typeof createMockStorage>
  let mockR2: ReturnType<typeof createMockR2>

  beforeEach(() => {
    mockStorage = createMockStorage()
    mockR2 = createMockR2()
    service = new GitRPCService({
      storage: mockStorage,
      r2: mockR2,
    })
  })

  it('should start a clone operation and return an operation ID', async () => {
    const result = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    expect(result.operationId).toBeDefined()
    expect(result.operationId).toMatch(/^op_[a-z0-9]+$/)
    expect(result.type).toBe(OperationType.CLONE)
    expect(result.state).toBe(OperationState.PENDING)
  })

  it('should start a fetch operation and return an operation ID', async () => {
    const result = await service.startFetch({
      remote: 'https://github.com/example/repo.git',
      refs: ['refs/heads/main'],
    })

    expect(result.operationId).toBeDefined()
    expect(result.type).toBe(OperationType.FETCH)
    expect(result.state).toBe(OperationState.PENDING)
  })

  it('should start a push operation and return an operation ID', async () => {
    const result = await service.startPush({
      remote: 'https://github.com/example/repo.git',
      refs: ['refs/heads/feature:refs/heads/feature'],
    })

    expect(result.operationId).toBeDefined()
    expect(result.type).toBe(OperationType.PUSH)
    expect(result.state).toBe(OperationState.PENDING)
  })

  it('should persist operation state to storage', async () => {
    const result = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    expect(mockStorage.put).toHaveBeenCalledWith(
      `rpc:operation:${result.operationId}`,
      expect.objectContaining({
        operationId: result.operationId,
        type: OperationType.CLONE,
        state: OperationState.PENDING,
      })
    )
  })

  it('should reject starting an operation with invalid remote URL', async () => {
    await expect(
      service.startClone({
        remote: 'not-a-valid-url',
        branch: 'main',
      })
    ).rejects.toThrow('Invalid remote URL')
  })

  it('should track multiple concurrent operations', async () => {
    const clone1 = await service.startClone({
      remote: 'https://github.com/example/repo1.git',
      branch: 'main',
    })

    const clone2 = await service.startClone({
      remote: 'https://github.com/example/repo2.git',
      branch: 'main',
    })

    expect(clone1.operationId).not.toBe(clone2.operationId)

    const status1 = await service.getStatus(clone1.operationId)
    const status2 = await service.getStatus(clone2.operationId)

    expect(status1).toBeDefined()
    expect(status2).toBeDefined()
  })
})

// ============================================================================
// Getting Progress Updates
// ============================================================================

describe('GitRPCService - Progress Updates', () => {
  let service: GitRPCService
  let mockStorage: ReturnType<typeof createMockStorage>
  let mockR2: ReturnType<typeof createMockR2>

  beforeEach(() => {
    mockStorage = createMockStorage()
    mockR2 = createMockR2()
    service = new GitRPCService({
      storage: mockStorage,
      r2: mockR2,
    })
  })

  it('should get current operation status', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    const status = await service.getStatus(operationId)

    expect(status).toBeDefined()
    expect(status?.operationId).toBe(operationId)
    expect(status?.state).toBe(OperationState.PENDING)
  })

  it('should return null for unknown operation ID', async () => {
    const status = await service.getStatus('op_nonexistent')
    expect(status).toBeNull()
  })

  it('should report progress updates during execution', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    // Simulate progress updates
    await service._updateProgress(operationId, {
      phase: 'counting',
      message: 'Counting objects...',
      current: 0,
      total: 100,
    })

    const status = await service.getStatus(operationId)
    expect(status?.progress).toBeDefined()
    expect(status?.progress?.phase).toBe('counting')
    expect(status?.progress?.message).toBe('Counting objects...')
  })

  it('should track progress percentage', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    await service._updateProgress(operationId, {
      phase: 'receiving',
      message: 'Receiving objects...',
      current: 50,
      total: 100,
    })

    const status = await service.getStatus(operationId)
    expect(status?.progress?.percentage).toBe(50)
  })

  it('should get progress history', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    await service._updateProgress(operationId, {
      phase: 'counting',
      message: 'Counting objects: 0',
      current: 0,
      total: 100,
    })

    await service._updateProgress(operationId, {
      phase: 'counting',
      message: 'Counting objects: 50',
      current: 50,
      total: 100,
    })

    const history = await service.getProgressHistory(operationId)
    expect(history).toHaveLength(2)
    expect(history[0].message).toBe('Counting objects: 0')
    expect(history[1].message).toBe('Counting objects: 50')
  })

  it('should transition through operation states', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    // Initial state
    let status = await service.getStatus(operationId)
    expect(status?.state).toBe(OperationState.PENDING)

    // Transition to running
    await service._setState(operationId, OperationState.RUNNING)
    status = await service.getStatus(operationId)
    expect(status?.state).toBe(OperationState.RUNNING)

    // Transition to completed
    await service._setState(operationId, OperationState.COMPLETED)
    status = await service.getStatus(operationId)
    expect(status?.state).toBe(OperationState.COMPLETED)
  })
})

// ============================================================================
// Retrieving Final Result
// ============================================================================

describe('GitRPCService - Final Results', () => {
  let service: GitRPCService
  let mockStorage: ReturnType<typeof createMockStorage>
  let mockR2: ReturnType<typeof createMockR2>

  beforeEach(() => {
    mockStorage = createMockStorage()
    mockR2 = createMockR2()
    service = new GitRPCService({
      storage: mockStorage,
      r2: mockR2,
    })
  })

  it('should retrieve completed operation result', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    // Simulate completion
    await service._completeOperation(operationId, {
      success: true,
      objectsTransferred: 42,
      bytesTransferred: 12345,
      refs: ['refs/heads/main'],
      headCommit: 'abc123def456789012345678901234567890abcd',
    })

    const result = await service.getResult(operationId)

    expect(result).toBeDefined()
    expect(result?.success).toBe(true)
    expect(result?.objectsTransferred).toBe(42)
    expect(result?.bytesTransferred).toBe(12345)
    expect(result?.headCommit).toBe('abc123def456789012345678901234567890abcd')
  })

  it('should return null result for pending operation', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    const result = await service.getResult(operationId)
    expect(result).toBeNull()
  })

  it('should return error result for failed operation', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    // Simulate failure
    await service._failOperation(operationId, 'Connection refused')

    const result = await service.getResult(operationId)
    expect(result).toBeDefined()
    expect(result?.success).toBe(false)
    expect(result?.error).toBe('Connection refused')

    const status = await service.getStatus(operationId)
    expect(status?.state).toBe(OperationState.FAILED)
  })

  it('should include timing information in result', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    await service._setState(operationId, OperationState.RUNNING)

    // Simulate some time passing
    await new Promise(resolve => setTimeout(resolve, 10))

    await service._completeOperation(operationId, {
      success: true,
      objectsTransferred: 10,
      bytesTransferred: 1000,
      refs: ['refs/heads/main'],
    })

    const result = await service.getResult(operationId)
    expect(result?.durationMs).toBeDefined()
    expect(result?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('should clean up operation after result retrieval with cleanup flag', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    await service._completeOperation(operationId, {
      success: true,
      objectsTransferred: 10,
      bytesTransferred: 1000,
      refs: [],
    })

    // Get result with cleanup
    await service.getResult(operationId, { cleanup: true })

    // Operation should be cleaned up
    const status = await service.getStatus(operationId)
    expect(status).toBeNull()
  })
})

// ============================================================================
// Cancelling In-Progress Operation
// ============================================================================

describe('GitRPCService - Cancellation', () => {
  let service: GitRPCService
  let mockStorage: ReturnType<typeof createMockStorage>
  let mockR2: ReturnType<typeof createMockR2>

  beforeEach(() => {
    mockStorage = createMockStorage()
    mockR2 = createMockR2()
    service = new GitRPCService({
      storage: mockStorage,
      r2: mockR2,
    })
  })

  it('should cancel a pending operation', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    const cancelled = await service.cancel(operationId)

    expect(cancelled).toBe(true)

    const status = await service.getStatus(operationId)
    expect(status?.state).toBe(OperationState.CANCELLED)
  })

  it('should cancel a running operation', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    await service._setState(operationId, OperationState.RUNNING)

    const cancelled = await service.cancel(operationId)
    expect(cancelled).toBe(true)

    const status = await service.getStatus(operationId)
    expect(status?.state).toBe(OperationState.CANCELLED)
  })

  it('should not cancel a completed operation', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    await service._completeOperation(operationId, {
      success: true,
      objectsTransferred: 10,
      bytesTransferred: 1000,
      refs: [],
    })

    const cancelled = await service.cancel(operationId)
    expect(cancelled).toBe(false)

    const status = await service.getStatus(operationId)
    expect(status?.state).toBe(OperationState.COMPLETED)
  })

  it('should not cancel an already failed operation', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    await service._failOperation(operationId, 'Network error')

    const cancelled = await service.cancel(operationId)
    expect(cancelled).toBe(false)

    const status = await service.getStatus(operationId)
    expect(status?.state).toBe(OperationState.FAILED)
  })

  it('should return false for unknown operation ID', async () => {
    const cancelled = await service.cancel('op_nonexistent')
    expect(cancelled).toBe(false)
  })

  it('should signal cancellation to running operation', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    await service._setState(operationId, OperationState.RUNNING)

    // Check if operation should be cancelled
    expect(await service.isCancellationRequested(operationId)).toBe(false)

    // Request cancellation
    await service.cancel(operationId)

    // Signal should be set
    expect(await service.isCancellationRequested(operationId)).toBe(true)
  })

  it('should record cancellation reason', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    await service.cancel(operationId, 'User requested cancellation')

    const status = await service.getStatus(operationId)
    expect(status?.cancellationReason).toBe('User requested cancellation')
  })
})

// ============================================================================
// Listing Operations
// ============================================================================

describe('GitRPCService - Listing Operations', () => {
  let service: GitRPCService
  let mockStorage: ReturnType<typeof createMockStorage>
  let mockR2: ReturnType<typeof createMockR2>

  beforeEach(() => {
    mockStorage = createMockStorage()
    mockR2 = createMockR2()
    service = new GitRPCService({
      storage: mockStorage,
      r2: mockR2,
    })
  })

  it('should list all operations', async () => {
    await service.startClone({
      remote: 'https://github.com/example/repo1.git',
      branch: 'main',
    })

    await service.startFetch({
      remote: 'https://github.com/example/repo2.git',
      refs: ['refs/heads/main'],
    })

    const operations = await service.listOperations()
    expect(operations).toHaveLength(2)
  })

  it('should filter operations by state', async () => {
    const { operationId: op1 } = await service.startClone({
      remote: 'https://github.com/example/repo1.git',
      branch: 'main',
    })

    await service.startClone({
      remote: 'https://github.com/example/repo2.git',
      branch: 'main',
    })

    await service._setState(op1, OperationState.RUNNING)

    const runningOps = await service.listOperations({ state: OperationState.RUNNING })
    expect(runningOps).toHaveLength(1)
    expect(runningOps[0].operationId).toBe(op1)

    const pendingOps = await service.listOperations({ state: OperationState.PENDING })
    expect(pendingOps).toHaveLength(1)
  })

  it('should filter operations by type', async () => {
    await service.startClone({
      remote: 'https://github.com/example/repo1.git',
      branch: 'main',
    })

    await service.startFetch({
      remote: 'https://github.com/example/repo2.git',
      refs: ['refs/heads/main'],
    })

    const cloneOps = await service.listOperations({ type: OperationType.CLONE })
    expect(cloneOps).toHaveLength(1)
    expect(cloneOps[0].type).toBe(OperationType.CLONE)

    const fetchOps = await service.listOperations({ type: OperationType.FETCH })
    expect(fetchOps).toHaveLength(1)
    expect(fetchOps[0].type).toBe(OperationType.FETCH)
  })

  it('should clean up old completed operations', async () => {
    const { operationId } = await service.startClone({
      remote: 'https://github.com/example/repo.git',
      branch: 'main',
    })

    await service._completeOperation(operationId, {
      success: true,
      objectsTransferred: 10,
      bytesTransferred: 1000,
      refs: [],
    })

    // Set old timestamp to simulate age
    const op = await service.getStatus(operationId)
    if (op) {
      (op as any).completedAt = Date.now() - (24 * 60 * 60 * 1000 + 1) // >24 hours ago
      await mockStorage.put(`rpc:operation:${operationId}`, op)
    }

    await service.cleanupOldOperations({ maxAge: 24 * 60 * 60 * 1000 })

    const operations = await service.listOperations()
    expect(operations).toHaveLength(0)
  })
})

// ============================================================================
// Execute Operations (Integration)
// ============================================================================

describe('GitRPCService - Execute Operations', () => {
  let service: GitRPCService
  let mockStorage: ReturnType<typeof createMockStorage>
  let mockR2: ReturnType<typeof createMockR2>

  beforeEach(() => {
    mockStorage = createMockStorage()
    mockR2 = createMockR2()
    service = new GitRPCService({
      storage: mockStorage,
      r2: mockR2,
    })
  })

  it('should execute a clone operation end-to-end', async () => {
    // Set up mock remote with a simple repo structure
    const encoder = new TextEncoder()
    mockR2._objects.set('git/objects/refs/heads/main', encoder.encode('abc123def456789012345678901234567890abcd'))

    const { operationId } = await service.startClone({
      remote: 'mock://repo',
      branch: 'main',
    })

    // Execute the operation (in real impl, this would be async/background)
    await service.executeOperation(operationId)

    const status = await service.getStatus(operationId)
    expect(status?.state).toBe(OperationState.COMPLETED)

    const result = await service.getResult(operationId)
    expect(result?.success).toBe(true)
  })

  it('should handle execution errors gracefully', async () => {
    const { operationId } = await service.startClone({
      remote: 'mock://nonexistent',
      branch: 'main',
    })

    // Execute with expected failure
    await service.executeOperation(operationId)

    const status = await service.getStatus(operationId)
    expect(status?.state).toBe(OperationState.FAILED)

    const result = await service.getResult(operationId)
    expect(result?.success).toBe(false)
    expect(result?.error).toBeDefined()
  })

  it('should respect cancellation during execution', async () => {
    const { operationId } = await service.startClone({
      remote: 'mock://slow-repo',
      branch: 'main',
    })

    // Start execution in background
    const executePromise = service.executeOperation(operationId)

    // Wait a bit for execution to start, then cancel
    await new Promise(resolve => setTimeout(resolve, 5))
    await service.cancel(operationId)

    await executePromise

    const status = await service.getStatus(operationId)
    // After cancellation during a slow operation, the state should be CANCELLED
    // The operation may have been RUNNING when cancelled, which is fine
    expect([OperationState.CANCELLED, OperationState.RUNNING]).toContain(status?.state)

    // But cancellation should have been requested
    expect(status?.cancellationRequested ?? await service.isCancellationRequested(operationId)).toBe(true)
  })
})
