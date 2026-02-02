/**
 * @fileoverview Git Error Classes (Platform Agnostic)
 *
 * This module defines error classes for Git operations. All errors
 * are platform-agnostic and can be used in any JavaScript runtime.
 *
 * These errors extend from GitXError for unified error handling across
 * the gitx.do library while maintaining backward compatibility.
 *
 * @module @dotdo/gitx/errors
 */

import { GitXError } from '../errors'

/**
 * Base class for all Git-related errors.
 *
 * @description
 * Extends GitXError to integrate with the unified error hierarchy
 * while maintaining backward compatibility with existing code.
 */
export class GitError extends GitXError {
  constructor(message: string, code: string = 'GIT_ERROR') {
    super(message, code)
    this.name = 'GitError'
  }
}

/**
 * Error thrown when a Git object is not found.
 */
export class ObjectNotFoundError extends GitError {
  public readonly sha: string

  constructor(sha: string) {
    super(`Object not found: ${sha}`, 'OBJECT_NOT_FOUND')
    this.name = 'ObjectNotFoundError'
    this.sha = sha
  }
}

/**
 * Error thrown when a Git object is corrupted or invalid.
 */
export class CorruptObjectError extends GitError {
  public readonly sha?: string
  public readonly objectType?: string

  constructor(message: string, sha?: string, objectType?: string) {
    super(message, 'CORRUPT_OBJECT')
    this.name = 'CorruptObjectError'
    this.sha = sha
    this.objectType = objectType
  }
}

/**
 * Error thrown when a reference is not found.
 */
export class RefNotFoundError extends GitError {
  public readonly refName: string

  constructor(refName: string) {
    super(`Reference not found: ${refName}`, 'REF_NOT_FOUND')
    this.name = 'RefNotFoundError'
    this.refName = refName
  }
}

/**
 * Error thrown when a reference name is invalid.
 */
export class InvalidRefNameError extends GitError {
  public readonly refName: string
  public readonly reason?: string

  constructor(refName: string, reason?: string) {
    const message = reason
      ? `Invalid reference name "${refName}": ${reason}`
      : `Invalid reference name: ${refName}`
    super(message, 'INVALID_REF_NAME')
    this.name = 'InvalidRefNameError'
    this.refName = refName
    this.reason = reason
  }
}

/**
 * Error thrown when a SHA-1 hash is invalid.
 */
export class InvalidShaError extends GitError {
  public readonly sha: string

  constructor(sha: string) {
    super(`Invalid SHA-1 hash: ${sha}`, 'INVALID_SHA')
    this.name = 'InvalidShaError'
    this.sha = sha
  }
}

/**
 * Error thrown when a pack file is corrupted or invalid.
 */
export class PackFormatError extends GitError {
  public readonly offset?: number

  constructor(message: string, offset?: number) {
    super(offset !== undefined ? `${message} at offset ${offset}` : message, 'PACK_FORMAT_ERROR')
    this.name = 'PackFormatError'
    this.offset = offset
  }
}

/**
 * Error thrown when delta application fails.
 */
export class DeltaError extends GitError {
  public readonly baseSize?: number
  public readonly expectedSize?: number
  public readonly actualSize?: number

  constructor(message: string, options?: { baseSize?: number; expectedSize?: number; actualSize?: number }) {
    super(message, 'DELTA_ERROR')
    this.name = 'DeltaError'
    this.baseSize = options?.baseSize
    this.expectedSize = options?.expectedSize
    this.actualSize = options?.actualSize
  }
}

/**
 * Error thrown when a wire protocol message is invalid.
 */
export class ProtocolError extends GitError {
  public readonly protocolCode?: string

  constructor(message: string, protocolCode?: string) {
    super(message, 'PROTOCOL_ERROR')
    this.name = 'ProtocolError'
    this.protocolCode = protocolCode
  }
}

/**
 * Error thrown when an operation is not supported.
 */
export class NotSupportedError extends GitError {
  public readonly operation: string

  constructor(operation: string, message?: string) {
    super(message || `Operation not supported: ${operation}`, 'NOT_SUPPORTED')
    this.name = 'NotSupportedError'
    this.operation = operation
  }
}

/**
 * Error thrown when there's a conflict (e.g., merge conflict).
 */
export class ConflictError extends GitError {
  public readonly path?: string
  public readonly conflictType?: 'merge' | 'rebase' | 'cherry-pick' | 'update'

  constructor(message: string, path?: string, conflictType?: 'merge' | 'rebase' | 'cherry-pick' | 'update') {
    super(message, 'CONFLICT')
    this.name = 'ConflictError'
    this.path = path
    this.conflictType = conflictType
  }
}

/**
 * Error thrown when storage operations fail.
 */
export class CoreStorageError extends GitError {
  public readonly operation?: string
  public readonly path?: string

  constructor(message: string, operation?: string, path?: string) {
    super(message, 'STORAGE_ERROR')
    this.name = 'CoreStorageError'
    this.operation = operation
    this.path = path
  }
}

// Backward compatibility alias
export { CoreStorageError as StorageError }

// Re-export GitXError for convenience
export { GitXError } from '../errors'
