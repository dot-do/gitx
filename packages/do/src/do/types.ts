/**
 * @fileoverview Type definitions for GitRepoDO and related classes.
 *
 * This module contains all TypeScript interfaces and types used by GitRepoDO,
 * extracted for better code organization and reusability.
 *
 * @module do/types
 */

// ============================================================================
// Core Durable Object Types
// ============================================================================

/**
 * Durable Object state interface.
 * Represents the state passed to a Durable Object constructor.
 */
export interface DOState {
  id: { toString(): string }
  storage: DOStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

/**
 * Durable Object storage interface.
 */
export interface DOStorage {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
  sql: {
    exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
  }
}

// ============================================================================
// Service Binding Types
// ============================================================================

/**
 * Service binding interface for cross-worker communication.
 */
export interface ServiceBinding {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>
}

/**
 * Durable Object namespace binding.
 */
export interface DONamespaceBinding {
  idFromName(name: string): unknown
  idFromString(id: string): unknown
  newUniqueId(options?: { locationHint?: string }): unknown
  get(id: unknown): DOStub
}

/**
 * Durable Object stub for RPC calls.
 */
export interface DOStub {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>
}

/**
 * R2 bucket binding interface.
 */
export interface R2Binding {
  put(key: string, data: string | ArrayBuffer): Promise<unknown>
  get(key: string): Promise<R2Object | null>
  list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string }> }>
}

/**
 * R2 object interface.
 */
export interface R2Object {
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * KV namespace binding interface.
 */
export interface KVBinding {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

/**
 * Pipeline binding interface.
 */
export interface PipelineBinding {
  send(events: unknown[]): Promise<void>
}

// ============================================================================
// Environment Types
// ============================================================================

/**
 * Base environment interface for all DOs.
 */
export interface BaseEnv {
  DO?: DONamespaceBinding
  R2?: R2Binding
  KV?: KVBinding
  PIPELINE?: PipelineBinding
}

/**
 * Environment interface for GitRepoDO.
 * Extends BaseEnv with FSX and BASHX service bindings.
 */
export interface GitRepoDOEnv extends BaseEnv {
  /**
   * FSX service binding for filesystem operations.
   * Bound via wrangler.toml [[services]] configuration.
   */
  FSX?: ServiceBinding
  /**
   * BASHX service binding for shell command execution.
   * Bound via wrangler.toml [[services]] configuration.
   */
  BASHX?: ServiceBinding
}

// ============================================================================
// Lifecycle Types
// ============================================================================

/**
 * Initialize options for GitRepoDO.
 */
export interface InitializeOptions {
  ns: string
  parent?: string
}

/**
 * Fork options for GitRepoDO.
 */
export interface ForkOptions {
  to: string
  branch?: string
}

/**
 * Fork result.
 */
export interface ForkResult {
  ns: string
  doId: string
}

/**
 * Compact result.
 */
export interface CompactResult {
  thingsCompacted: number
  actionsArchived: number
  eventsArchived: number
}

// ============================================================================
// Workflow Context Types
// ============================================================================

/**
 * Workflow context interface (the $ API).
 * Provides durable execution primitives and git operations.
 */
export interface WorkflowContext {
  /** Fire-and-forget event emission */
  send(event: string, data?: unknown): void
  /** Single attempt execution (blocking, non-durable) */
  try<T>(action: string, data?: unknown): Promise<T>
  /** Durable execution with retries */
  do<T>(action: string, data?: unknown): Promise<T>
  /** Event handler registration proxy */
  on: Record<string, Record<string, (handler: unknown) => void>>
  /** Scheduling proxy */
  every: Record<string, { at: (time: string) => (handler: unknown) => void }>
  /** Create a new git branch */
  branch(name: string): Promise<void>
  /** Checkout a git ref */
  checkout(ref: string): Promise<void>
  /** Merge a branch into current */
  merge(branch: string): Promise<void>
  /** Allow extension */
  [key: string]: unknown
}

// ============================================================================
// Store Types
// ============================================================================

/**
 * Store accessor interface.
 * Provides CRUD operations for a storage prefix.
 */
export interface StoreAccessor {
  get(id: string): Promise<unknown>
  set(id: string, value: unknown): Promise<void>
  delete(id: string): Promise<boolean>
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>
}

/**
 * Typed collection accessor interface.
 * Extends StoreAccessor with type information.
 */
export interface TypedStoreAccessor extends StoreAccessor {
  type: string
}

// ============================================================================
// Filesystem Capability Types
// ============================================================================

/**
 * Filesystem capability interface for FSX service binding integration.
 * Wraps the FSX service binding to provide filesystem operations.
 */
export interface FsCapability {
  readFile(path: string): Promise<string | Uint8Array>
  writeFile(path: string, content: string | Uint8Array): Promise<void>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  getFileId?(path: string): Promise<number | null>
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for GitRepoDO operations.
 */
export enum GitRepoDOErrorCode {
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  INVALID_NAMESPACE = 'INVALID_NAMESPACE',
  NOTHING_TO_COMPACT = 'NOTHING_TO_COMPACT',
  FORK_FAILED = 'FORK_FAILED',
  STORAGE_ERROR = 'STORAGE_ERROR',
}

/**
 * Custom error class for GitRepoDO operations.
 */
export class GitRepoDOError extends Error {
  readonly code: GitRepoDOErrorCode
  readonly context?: Record<string, unknown>

  constructor(
    message: string,
    code: GitRepoDOErrorCode,
    context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'GitRepoDOError'
    this.code = code
    this.context = context
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    const ErrorWithCapture = Error as typeof Error & { captureStackTrace?: (err: Error, ctor: Function) => void }
    if (ErrorWithCapture.captureStackTrace) {
      ErrorWithCapture.captureStackTrace(this, GitRepoDOError)
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
    }
  }
}

// ============================================================================
// Logging Types
// ============================================================================

/**
 * Log levels for GitRepoDO logging.
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Log entry interface.
 */
export interface LogEntry {
  level: LogLevel
  message: string
  timestamp: number
  context?: Record<string, unknown>
}

/**
 * Logger interface for GitRepoDO.
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

// ============================================================================
// Health Check Types
// ============================================================================

/**
 * Health check response.
 */
export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'unhealthy'
  ns?: string
  $type: string
  uptime?: number
  capabilities?: string[]
}
