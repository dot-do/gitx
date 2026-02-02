import { describe, it, expect } from 'vitest'
import {
  GitXError,
  StorageError,
  WireError,
  IcebergError,
  RefError,
  ObjectError,
  RPCError,
  MigrationError,
  isGitXError,
  isStorageError,
  isWireError,
  isIcebergError,
  isRefError,
  isObjectError,
  isRPCError,
  isMigrationError,
  hasErrorCode,
} from '../src/errors'

describe('GitXError', () => {
  describe('base class', () => {
    it('should create error with message and code', () => {
      const error = new GitXError('Something went wrong', 'INTERNAL')
      expect(error.message).toBe('Something went wrong')
      expect(error.code).toBe('INTERNAL')
      expect(error.name).toBe('GitXError')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(GitXError)
    })

    it('should default to UNKNOWN code', () => {
      const error = new GitXError('Unknown error')
      expect(error.code).toBe('UNKNOWN')
    })

    it('should support cause chaining', () => {
      const cause = new Error('Root cause')
      const error = new GitXError('Wrapper error', 'INTERNAL', { cause })
      expect(error.cause).toBe(cause)
    })

    it('should serialize to JSON', () => {
      const cause = new Error('Root cause')
      const error = new GitXError('Test error', 'NOT_FOUND', { cause })
      const json = error.toJSON()
      expect(json.name).toBe('GitXError')
      expect(json.message).toBe('Test error')
      expect(json.code).toBe('NOT_FOUND')
      expect(json.cause).toBe('Root cause')
      expect(json.stack).toBeDefined()
    })

    it('should create wrapped errors with static wrap()', () => {
      const cause = new Error('Original error')
      const wrapped = GitXError.wrap(cause, 'Wrapped message')
      expect(wrapped.message).toBe('Wrapped message')
      expect(wrapped.code).toBe('INTERNAL')
      expect(wrapped.cause).toBe(cause)
    })

    it('should wrap non-Error values', () => {
      const wrapped = GitXError.wrap('string error')
      expect(wrapped.message).toBe('string error')
      expect(wrapped.cause).toBe('string error')
    })

    it('should create copy with withMessage()', () => {
      const error = new GitXError('Original', 'NOT_FOUND')
      const copy = error.withMessage('New message')
      expect(copy.message).toBe('New message')
      expect(copy.code).toBe('NOT_FOUND')
      expect(copy).not.toBe(error)
    })
  })
})

describe('StorageError', () => {
  it('should create error with storage-specific properties', () => {
    const error = new StorageError('Object not found', 'NOT_FOUND', {
      sha: 'abc123',
      path: '/objects/ab/c123',
      operation: 'read',
    })
    expect(error.message).toBe('Object not found')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.sha).toBe('abc123')
    expect(error.path).toBe('/objects/ab/c123')
    expect(error.operation).toBe('read')
    expect(error.name).toBe('StorageError')
    expect(error).toBeInstanceOf(GitXError)
  })

  it('should serialize storage properties to JSON', () => {
    const error = new StorageError('Test', 'CORRUPTED', { sha: 'abc' })
    const json = error.toJSON()
    expect(json.sha).toBe('abc')
    expect(json.path).toBeUndefined()
    expect(json.operation).toBeUndefined()
  })

  it('should create NOT_FOUND error with factory', () => {
    const error = StorageError.notFound('abc123')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.sha).toBe('abc123')
    expect(error.message).toContain('abc123')
  })

  it('should create CORRUPTED error with factory', () => {
    const error = StorageError.corrupted('abc123', 'checksum mismatch')
    expect(error.code).toBe('CORRUPTED')
    expect(error.sha).toBe('abc123')
    expect(error.message).toContain('checksum mismatch')
  })
})

describe('WireError', () => {
  it('should create error with wire-specific properties', () => {
    const packet = new Uint8Array([0x00, 0x01, 0x02])
    const error = new WireError('Malformed packet', 'MALFORMED_PACKET', { packet })
    expect(error.message).toBe('Malformed packet')
    expect(error.code).toBe('MALFORMED_PACKET')
    expect(error.packet).toBe(packet)
    expect(error.name).toBe('WireError')
    expect(error).toBeInstanceOf(GitXError)
  })

  it('should default to PROTOCOL_ERROR code', () => {
    const error = new WireError('Protocol error')
    expect(error.code).toBe('PROTOCOL_ERROR')
  })

  it('should create MALFORMED_PACKET error with factory', () => {
    const packet = new Uint8Array([0xff])
    const error = WireError.malformedPacket('Invalid packet', packet)
    expect(error.code).toBe('MALFORMED_PACKET')
    expect(error.packet).toBe(packet)
  })

  it('should create NEGOTIATION_TIMEOUT error with factory', () => {
    const error = WireError.timeout(5000, 3000)
    expect(error.code).toBe('NEGOTIATION_TIMEOUT')
    expect(error.message).toContain('5000')
    expect(error.message).toContain('3000')
  })
})

describe('IcebergError', () => {
  it('should create error with details', () => {
    const error = new IcebergError('Table not found', 'NOT_FOUND', {
      details: { namespace: 'db', table: 'users' },
    })
    expect(error.message).toBe('Table not found')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.details).toEqual({ namespace: 'db', table: 'users' })
    expect(error.name).toBe('IcebergError')
    expect(error).toBeInstanceOf(GitXError)
  })

  it('should serialize details to JSON', () => {
    const error = new IcebergError('Test', 'CONFLICT', {
      details: { version: 1 },
    })
    const json = error.toJSON()
    expect(json.details).toEqual({ version: 1 })
  })
})

describe('RefError', () => {
  it('should create error with ref-specific properties', () => {
    const error = new RefError('Branch not found', 'NOT_FOUND', {
      refName: 'refs/heads/feature',
      sha: 'abc123',
    })
    expect(error.message).toBe('Branch not found')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.refName).toBe('refs/heads/feature')
    expect(error.sha).toBe('abc123')
    expect(error.name).toBe('RefError')
    expect(error).toBeInstanceOf(GitXError)
  })

  it('should create NOT_FOUND error with factory', () => {
    const error = RefError.notFound('refs/heads/main')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.refName).toBe('refs/heads/main')
  })

  it('should create ALREADY_EXISTS error with factory', () => {
    const error = RefError.alreadyExists('refs/heads/feature')
    expect(error.code).toBe('ALREADY_EXISTS')
    expect(error.refName).toBe('refs/heads/feature')
  })

  it('should create INVALID_NAME error with factory', () => {
    const error = RefError.invalidName('refs/heads/..', 'contains ..')
    expect(error.code).toBe('INVALID_NAME')
    expect(error.refName).toBe('refs/heads/..')
    expect(error.message).toContain('contains ..')
  })
})

describe('ObjectError', () => {
  it('should create error with object-specific properties', () => {
    const error = new ObjectError('Invalid object type', 'INVALID_TYPE', {
      sha: 'abc123',
      expectedType: 'commit',
      actualType: 'blob',
    })
    expect(error.message).toBe('Invalid object type')
    expect(error.code).toBe('INVALID_TYPE')
    expect(error.sha).toBe('abc123')
    expect(error.expectedType).toBe('commit')
    expect(error.actualType).toBe('blob')
    expect(error.name).toBe('ObjectError')
    expect(error).toBeInstanceOf(GitXError)
  })

  it('should create NOT_FOUND error with factory', () => {
    const error = ObjectError.notFound('abc123')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.sha).toBe('abc123')
  })

  it('should create CORRUPTED error with factory', () => {
    const error = ObjectError.corrupted('abc123', 'bad header')
    expect(error.code).toBe('CORRUPTED')
    expect(error.message).toContain('bad header')
  })

  it('should create INVALID_TYPE error with factory', () => {
    const error = ObjectError.invalidType('abc123', 'tree', 'blob')
    expect(error.code).toBe('INVALID_TYPE')
    expect(error.expectedType).toBe('tree')
    expect(error.actualType).toBe('blob')
  })
})

describe('RPCError', () => {
  it('should create error with RPC-specific properties', () => {
    const error = new RPCError('Method not found', 'METHOD_NOT_FOUND', {
      data: { method: 'unknown.method' },
    })
    expect(error.message).toBe('Method not found')
    expect(error.code).toBe('METHOD_NOT_FOUND')
    expect(error.data).toEqual({ method: 'unknown.method' })
    expect(error.name).toBe('RPCError')
    expect(error).toBeInstanceOf(GitXError)
  })

  it('should convert to JSON-RPC error format', () => {
    const error = new RPCError('Invalid params', 'INVALID_PARAMS', {
      data: { param: 'missing' },
    })
    const jsonrpc = error.toJSONRPC()
    expect(jsonrpc.code).toBe(-32602)
    expect(jsonrpc.message).toBe('Invalid params')
    expect(jsonrpc.data).toEqual({ param: 'missing' })
  })

  it('should map all error codes to JSON-RPC codes', () => {
    const codeMap: [string, number][] = [
      ['PARSE_ERROR', -32700],
      ['INVALID_REQUEST', -32600],
      ['METHOD_NOT_FOUND', -32601],
      ['INVALID_PARAMS', -32602],
      ['INTERNAL_ERROR', -32603],
      ['TIMEOUT', -32000],
      ['CANCELLED', -32001],
    ]
    for (const [code, expected] of codeMap) {
      const error = new RPCError('Test', code as any)
      expect(error.toJSONRPC().code).toBe(expected)
    }
  })
})

describe('MigrationError', () => {
  it('should create error with migration-specific properties', () => {
    const error = new MigrationError('Migration failed', 'ROLLBACK_FAILED', {
      sourceTier: 'hot',
      targetTier: 'warm',
      rolledBack: false,
    })
    expect(error.message).toBe('Migration failed')
    expect(error.code).toBe('ROLLBACK_FAILED')
    expect(error.sourceTier).toBe('hot')
    expect(error.targetTier).toBe('warm')
    expect(error.rolledBack).toBe(false)
    expect(error.name).toBe('MigrationError')
    expect(error).toBeInstanceOf(GitXError)
  })

  it('should serialize migration properties to JSON', () => {
    const error = new MigrationError('Test', 'ALREADY_RUNNING', {
      sourceTier: 'v1',
      targetTier: 'v2',
    })
    const json = error.toJSON()
    expect(json.sourceTier).toBe('v1')
    expect(json.targetTier).toBe('v2')
  })
})

describe('Type Guards', () => {
  const gitxError = new GitXError('base', 'UNKNOWN')
  const storageError = new StorageError('storage', 'NOT_FOUND')
  const wireError = new WireError('wire', 'PROTOCOL_ERROR')
  const icebergError = new IcebergError('iceberg', 'CONFLICT')
  const refError = new RefError('ref', 'INVALID_NAME')
  const objectError = new ObjectError('object', 'CORRUPTED')
  const rpcError = new RPCError('rpc', 'INVALID_PARAMS')
  const migrationError = new MigrationError('migration', 'ALREADY_RUNNING')
  const regularError = new Error('regular')

  describe('isGitXError', () => {
    it('should return true for GitXError instances', () => {
      expect(isGitXError(gitxError)).toBe(true)
      expect(isGitXError(storageError)).toBe(true)
      expect(isGitXError(wireError)).toBe(true)
      expect(isGitXError(icebergError)).toBe(true)
      expect(isGitXError(refError)).toBe(true)
      expect(isGitXError(objectError)).toBe(true)
      expect(isGitXError(rpcError)).toBe(true)
      expect(isGitXError(migrationError)).toBe(true)
    })

    it('should return false for non-GitXError instances', () => {
      expect(isGitXError(regularError)).toBe(false)
      expect(isGitXError(null)).toBe(false)
      expect(isGitXError(undefined)).toBe(false)
      expect(isGitXError('error')).toBe(false)
    })
  })

  describe('domain-specific type guards', () => {
    it('should correctly identify StorageError', () => {
      expect(isStorageError(storageError)).toBe(true)
      expect(isStorageError(gitxError)).toBe(false)
    })

    it('should correctly identify WireError', () => {
      expect(isWireError(wireError)).toBe(true)
      expect(isWireError(gitxError)).toBe(false)
    })

    it('should correctly identify IcebergError', () => {
      expect(isIcebergError(icebergError)).toBe(true)
      expect(isIcebergError(gitxError)).toBe(false)
    })

    it('should correctly identify RefError', () => {
      expect(isRefError(refError)).toBe(true)
      expect(isRefError(gitxError)).toBe(false)
    })

    it('should correctly identify ObjectError', () => {
      expect(isObjectError(objectError)).toBe(true)
      expect(isObjectError(gitxError)).toBe(false)
    })

    it('should correctly identify RPCError', () => {
      expect(isRPCError(rpcError)).toBe(true)
      expect(isRPCError(gitxError)).toBe(false)
    })

    it('should correctly identify MigrationError', () => {
      expect(isMigrationError(migrationError)).toBe(true)
      expect(isMigrationError(gitxError)).toBe(false)
    })
  })

  describe('hasErrorCode', () => {
    it('should return true for matching error code', () => {
      expect(hasErrorCode(storageError, 'NOT_FOUND')).toBe(true)
      expect(hasErrorCode(wireError, 'PROTOCOL_ERROR')).toBe(true)
    })

    it('should return false for non-matching error code', () => {
      expect(hasErrorCode(storageError, 'CORRUPTED')).toBe(false)
      expect(hasErrorCode(wireError, 'MALFORMED_PACKET')).toBe(false)
    })

    it('should return false for non-GitXError', () => {
      expect(hasErrorCode(regularError, 'NOT_FOUND')).toBe(false)
    })
  })
})

describe('Inheritance Chain', () => {
  it('should maintain proper inheritance chain', () => {
    const storage = new StorageError('test', 'NOT_FOUND')
    expect(storage instanceof Error).toBe(true)
    expect(storage instanceof GitXError).toBe(true)
    expect(storage instanceof StorageError).toBe(true)

    const wire = new WireError('test', 'PROTOCOL_ERROR')
    expect(wire instanceof Error).toBe(true)
    expect(wire instanceof GitXError).toBe(true)
    expect(wire instanceof WireError).toBe(true)
  })

  it('should have proper name property for stack traces', () => {
    const errors = [
      new GitXError('test'),
      new StorageError('test', 'NOT_FOUND'),
      new WireError('test', 'PROTOCOL_ERROR'),
      new IcebergError('test', 'CONFLICT'),
      new RefError('test', 'INVALID_NAME'),
      new ObjectError('test', 'CORRUPTED'),
      new RPCError('test', 'INVALID_PARAMS'),
      new MigrationError('test', 'ALREADY_RUNNING'),
    ]

    for (const error of errors) {
      expect(error.name).toBeDefined()
      expect(error.stack).toContain(error.name)
    }
  })
})

describe('Error Cause Chaining', () => {
  it('should preserve full cause chain', () => {
    const root = new Error('Root cause')
    const middle = new StorageError('Storage failed', 'READ_ERROR', { cause: root })
    const top = new GitXError('Operation failed', 'INTERNAL', { cause: middle })

    expect(top.cause).toBe(middle)
    expect((top.cause as StorageError).cause).toBe(root)
  })

  it('should work with catch/rethrow pattern', () => {
    function innerOperation(): never {
      throw new StorageError('File not found', 'NOT_FOUND', { path: '/test' })
    }

    function outerOperation(): never {
      try {
        innerOperation()
      } catch (cause) {
        throw new GitXError('Failed to load config', 'INTERNAL', { cause })
      }
      // This line should never be reached
      throw new Error('Unreachable')
    }

    expect(() => outerOperation()).toThrow(GitXError)
    try {
      outerOperation()
    } catch (error) {
      expect(error).toBeInstanceOf(GitXError)
      expect((error as GitXError).cause).toBeInstanceOf(StorageError)
    }
  })
})
