/**
 * @fileoverview Tests for RPC Type Guards
 *
 * Tests runtime validation type guards for RPC operations and parameters.
 *
 * @module test/rpc/type-guards.test
 */

import { describe, it, expect } from 'vitest'
import {
  isRPCOperation,
  isCloneParams,
  isFetchParams,
  isPushParams,
  validateOperationParams,
  OperationType,
  OperationState,
} from '../../src/rpc/git-rpc-service'

// ============================================================================
// isCloneParams
// ============================================================================

describe('isCloneParams', () => {
  it('accepts valid clone params with required fields', () => {
    expect(isCloneParams({ remote: 'https://github.com/a/b.git', branch: 'main' })).toBe(true)
  })

  it('accepts clone params with optional fields', () => {
    expect(
      isCloneParams({
        remote: 'https://github.com/a/b.git',
        branch: 'main',
        depth: 1,
        path: '/some/path',
      })
    ).toBe(true)
  })

  it('rejects null', () => {
    expect(isCloneParams(null)).toBe(false)
  })

  it('rejects non-object', () => {
    expect(isCloneParams('string')).toBe(false)
    expect(isCloneParams(42)).toBe(false)
  })

  it('rejects missing remote', () => {
    expect(isCloneParams({ branch: 'main' })).toBe(false)
  })

  it('rejects missing branch', () => {
    expect(isCloneParams({ remote: 'https://github.com/a/b.git' })).toBe(false)
  })

  it('rejects wrong types for optional fields', () => {
    expect(isCloneParams({ remote: 'url', branch: 'main', depth: 'not-a-number' })).toBe(false)
    expect(isCloneParams({ remote: 'url', branch: 'main', path: 123 })).toBe(false)
  })
})

// ============================================================================
// isFetchParams
// ============================================================================

describe('isFetchParams', () => {
  it('accepts valid fetch params', () => {
    expect(isFetchParams({ remote: 'https://github.com/a/b.git', refs: ['refs/heads/main'] })).toBe(true)
  })

  it('accepts fetch params with optional fields', () => {
    expect(
      isFetchParams({
        remote: 'https://github.com/a/b.git',
        refs: ['refs/heads/main'],
        depth: 10,
        prune: true,
      })
    ).toBe(true)
  })

  it('rejects missing remote', () => {
    expect(isFetchParams({ refs: ['refs/heads/main'] })).toBe(false)
  })

  it('rejects missing refs', () => {
    expect(isFetchParams({ remote: 'url' })).toBe(false)
  })

  it('rejects non-array refs', () => {
    expect(isFetchParams({ remote: 'url', refs: 'not-an-array' })).toBe(false)
  })

  it('rejects refs with non-string elements', () => {
    expect(isFetchParams({ remote: 'url', refs: [123] })).toBe(false)
  })

  it('rejects wrong type for depth', () => {
    expect(isFetchParams({ remote: 'url', refs: ['ref'], depth: 'deep' })).toBe(false)
  })

  it('rejects wrong type for prune', () => {
    expect(isFetchParams({ remote: 'url', refs: ['ref'], prune: 'yes' })).toBe(false)
  })
})

// ============================================================================
// isPushParams
// ============================================================================

describe('isPushParams', () => {
  it('accepts valid push params', () => {
    expect(isPushParams({ remote: 'url', refs: ['refs/heads/main:refs/heads/main'] })).toBe(true)
  })

  it('accepts push params with optional fields', () => {
    expect(
      isPushParams({
        remote: 'url',
        refs: ['main:main'],
        force: true,
        delete: false,
      })
    ).toBe(true)
  })

  it('rejects missing remote', () => {
    expect(isPushParams({ refs: ['main:main'] })).toBe(false)
  })

  it('rejects missing refs', () => {
    expect(isPushParams({ remote: 'url' })).toBe(false)
  })

  it('rejects wrong type for force', () => {
    expect(isPushParams({ remote: 'url', refs: ['r'], force: 'yes' })).toBe(false)
  })

  it('rejects wrong type for delete', () => {
    expect(isPushParams({ remote: 'url', refs: ['r'], delete: 1 })).toBe(false)
  })
})

// ============================================================================
// isRPCOperation
// ============================================================================

describe('isRPCOperation', () => {
  const validOperation = {
    operationId: 'op_123',
    type: OperationType.CLONE,
    state: OperationState.PENDING,
    createdAt: Date.now(),
    params: { remote: 'https://github.com/a/b.git', branch: 'main' },
  }

  it('accepts a valid operation', () => {
    expect(isRPCOperation(validOperation)).toBe(true)
  })

  it('accepts operation with optional fields', () => {
    expect(
      isRPCOperation({
        ...validOperation,
        startedAt: Date.now(),
        completedAt: Date.now(),
        result: { success: true },
        progressHistory: [],
        cancellationRequested: false,
      })
    ).toBe(true)
  })

  it('rejects null', () => {
    expect(isRPCOperation(null)).toBe(false)
  })

  it('rejects non-object', () => {
    expect(isRPCOperation('string')).toBe(false)
  })

  it('rejects missing operationId', () => {
    const { operationId, ...rest } = validOperation
    expect(isRPCOperation(rest)).toBe(false)
  })

  it('rejects invalid type', () => {
    expect(isRPCOperation({ ...validOperation, type: 'invalid' })).toBe(false)
  })

  it('rejects invalid state', () => {
    expect(isRPCOperation({ ...validOperation, state: 'bogus' })).toBe(false)
  })

  it('rejects missing createdAt', () => {
    const { createdAt, ...rest } = validOperation
    expect(isRPCOperation(rest)).toBe(false)
  })

  it('rejects null params', () => {
    expect(isRPCOperation({ ...validOperation, params: null })).toBe(false)
  })

  it('rejects missing params', () => {
    const { params, ...rest } = validOperation
    expect(isRPCOperation(rest)).toBe(false)
  })
})

// ============================================================================
// validateOperationParams
// ============================================================================

describe('validateOperationParams', () => {
  it('returns CloneParams for valid clone params', () => {
    const params = { remote: 'url', branch: 'main' }
    const result = validateOperationParams(OperationType.CLONE, params)
    expect(result).toEqual(params)
  })

  it('returns FetchParams for valid fetch params', () => {
    const params = { remote: 'url', refs: ['ref'] }
    const result = validateOperationParams(OperationType.FETCH, params)
    expect(result).toEqual(params)
  })

  it('returns PushParams for valid push params', () => {
    const params = { remote: 'url', refs: ['main:main'] }
    const result = validateOperationParams(OperationType.PUSH, params)
    expect(result).toEqual(params)
  })

  it('returns null for clone with wrong params', () => {
    expect(validateOperationParams(OperationType.CLONE, { remote: 'url' })).toBeNull()
  })

  it('returns null for fetch with wrong params', () => {
    expect(validateOperationParams(OperationType.FETCH, { remote: 'url' })).toBeNull()
  })

  it('returns null for push with wrong params', () => {
    expect(validateOperationParams(OperationType.PUSH, { remote: 'url' })).toBeNull()
  })

  it('returns null for null params', () => {
    expect(validateOperationParams(OperationType.CLONE, null)).toBeNull()
  })
})
