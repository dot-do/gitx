/**
 * @fileoverview Git Error Classes (Platform Agnostic)
 *
 * This module defines error classes for Git operations. All errors
 * are platform-agnostic and can be used in any JavaScript runtime.
 *
 * @module @dotdo/gitx/errors
 */

/**
 * Base class for all Git-related errors.
 */
export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
    // Maintains proper stack trace for where the error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

/**
 * Error thrown when a Git object is not found.
 */
export class ObjectNotFoundError extends GitError {
  public readonly sha: string

  constructor(sha: string) {
    super(`Object not found: ${sha}`)
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
    super(message)
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
    super(`Reference not found: ${refName}`)
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
    super(message)
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
    super(`Invalid SHA-1 hash: ${sha}`)
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
    super(offset !== undefined ? `${message} at offset ${offset}` : message)
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
    super(message)
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
  public readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ProtocolError'
    this.code = code
  }
}

/**
 * Error thrown when an operation is not supported.
 */
export class NotSupportedError extends GitError {
  public readonly operation: string

  constructor(operation: string, message?: string) {
    super(message || `Operation not supported: ${operation}`)
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
    super(message)
    this.name = 'ConflictError'
    this.path = path
    this.conflictType = conflictType
  }
}

/**
 * Error thrown when storage operations fail.
 */
export class StorageError extends GitError {
  public readonly operation?: string
  public readonly path?: string

  constructor(message: string, operation?: string, path?: string) {
    super(message)
    this.name = 'StorageError'
    this.operation = operation
    this.path = path
  }
}
