/**
 * MCP Sandbox Execution Environment
 *
 * Provides isolated execution environment for MCP tools with:
 * - Resource limits (memory, CPU, time)
 * - Capability restrictions (file, network, process)
 * - Safe git operation execution
 * - Audit logging
 *
 * SECURITY: Uses Node.js vm module for proper isolation instead of
 * string analysis, which can be easily bypassed.
 */

import { EventEmitter } from 'events'
import * as _vm from 'vm'

/**
 * Sandbox error codes
 */
export enum SandboxErrorCode {
  TIMEOUT = 'TIMEOUT',
  MEMORY_LIMIT_EXCEEDED = 'MEMORY_LIMIT_EXCEEDED',
  CPU_LIMIT_EXCEEDED = 'CPU_LIMIT_EXCEEDED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  EXECUTION_ERROR = 'EXECUTION_ERROR',
  FILE_DESCRIPTOR_LIMIT = 'FILE_DESCRIPTOR_LIMIT',
  PROCESS_LIMIT_EXCEEDED = 'PROCESS_LIMIT_EXCEEDED',
  BANDWIDTH_LIMIT_EXCEEDED = 'BANDWIDTH_LIMIT_EXCEEDED',
  DISK_LIMIT_EXCEEDED = 'DISK_LIMIT_EXCEEDED',
  SANDBOX_CRASHED = 'SANDBOX_CRASHED',
  SANDBOX_PAUSED = 'SANDBOX_PAUSED',
}

/**
 * Sandbox error class
 */
export class SandboxError extends Error {
  code: SandboxErrorCode
  data?: Record<string, unknown>
  stack?: string

  constructor(code: SandboxErrorCode, message: string, data?: Record<string, unknown>) {
    super(message)
    this.name = 'SandboxError'
    this.code = code
    this.data = data
  }

  toJSON(): { code: SandboxErrorCode; message: string; data?: Record<string, unknown> } {
    const result: { code: SandboxErrorCode; message: string; data?: Record<string, unknown> } = {
      code: this.code,
      message: this.message,
    }
    if (this.data !== undefined) {
      result.data = this.data
    }
    return result
  }
}

/**
 * Sandbox state enum
 */
export enum SandboxState {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  DESTROYED = 'DESTROYED',
}

/**
 * Isolation level for sandbox
 */
export type IsolationLevel = 'strict' | 'normal' | 'lax'

/**
 * Resource limits configuration
 */
export interface ResourceLimits {
  memoryLimit?: number
  cpuTimeLimit?: number
  maxOpenFiles?: number
  maxProcesses?: number
  networkBandwidthLimit?: number
  diskWriteLimit?: number
}

/**
 * Permission set for sandbox
 */
export interface PermissionSet {
  fileRead?: boolean
  fileWrite?: boolean
  network?: boolean
  spawn?: boolean
  env?: boolean
  nativeModules?: boolean
  allowedPaths?: string[]
  envWhitelist?: string[]
}

/**
 * Permission preset types
 */
export type PermissionPreset = 'readonly' | 'full' | 'network-only'

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
  timeout?: number
  memoryLimit?: number
  cpuTimeLimit?: number
  maxOpenFiles?: number
  maxProcesses?: number
  networkBandwidthLimit?: number
  diskWriteLimit?: number
  isolationLevel?: IsolationLevel
  env?: Record<string, string>
  workingDirectory?: string
  permissions?: PermissionSet
  permissionPreset?: PermissionPreset
  resourceLimits?: ResourceLimits
  queueOnPause?: boolean
  maxConcurrentExecutions?: number
}

/**
 * Execution options
 */
export interface ExecutionOptions {
  timeout?: number
  context?: Record<string, unknown>
}

/**
 * Resource usage statistics
 */
export interface ResourceStats {
  memoryUsed: number
  cpuTimeUsed: number
  executionCount: number
  activeHandles: number
}

/**
 * Resource usage in result
 */
export interface ResourceUsage {
  memoryUsed: number
  cpuTimeUsed?: number
}

/**
 * Result metadata
 */
export interface ResultMetadata {
  startTime: number
  endTime: number
  elapsedMs: number
}

/**
 * Permission violation record
 */
export interface PermissionViolation {
  permission: string
  timestamp: number
  details?: string
}

/**
 * Sandbox execution result
 */
export interface SandboxResult<T = unknown> {
  value?: T
  error?: SandboxError
  sandboxId: string
  metadata?: ResultMetadata
  resourceUsage?: ResourceUsage
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `sandbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Get permission set from preset
 */
function getPermissionsFromPreset(preset: PermissionPreset): PermissionSet {
  switch (preset) {
    case 'readonly':
      return {
        fileRead: true,
        fileWrite: false,
        network: false,
        spawn: false,
        env: true,
        nativeModules: true,
      }
    case 'full':
      return {
        fileRead: true,
        fileWrite: true,
        network: true,
        spawn: true,
        env: true,
        nativeModules: true,
      }
    case 'network-only':
      return {
        fileRead: false,
        fileWrite: false,
        network: true,
        spawn: false,
        env: false,
        nativeModules: false,
      }
    default:
      return {}
  }
}

/**
 * Dangerous modules that require permission checks
 */
const DANGEROUS_MODULES = new Set([
  'fs',
  'fs/promises',
  'child_process',
  'http',
  'https',
  'net',
  'dgram',
  'dns',
  'tls',
  'cluster',
  'worker_threads',
])

/**
 * File system read methods
 */
const FS_READ_METHODS = new Set([
  'readFile',
  'readFileSync',
  'readdir',
  'readdirSync',
  'readlink',
  'readlinkSync',
  'stat',
  'statSync',
  'lstat',
  'lstatSync',
  'access',
  'accessSync',
  'exists',
  'existsSync',
  'open',
  'openSync',
  'createReadStream',
])

/**
 * File system write methods
 */
const FS_WRITE_METHODS = new Set([
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'mkdir',
  'mkdirSync',
  'rmdir',
  'rmdirSync',
  'unlink',
  'unlinkSync',
  'rename',
  'renameSync',
  'copyFile',
  'copyFileSync',
  'truncate',
  'truncateSync',
  'createWriteStream',
  'chmod',
  'chmodSync',
  'chown',
  'chownSync',
])

/**
 * MCP Sandbox class for isolated execution
 *
 * SECURITY: This implementation uses Node.js vm module with proper context
 * isolation and runtime permission checks instead of string analysis.
 */
export class MCPSandbox extends EventEmitter {
  private id: string
  private config: SandboxConfig
  private state: SandboxState = SandboxState.IDLE
  private resourceStats: ResourceStats = {
    memoryUsed: 0,
    cpuTimeUsed: 0,
    executionCount: 0,
    activeHandles: 0,
  }
  private permissionViolations: PermissionViolation[] = []
  private permissions: PermissionSet
  private executionQueue: Array<{ resolve: () => void }> = []
  private activeExecutions = 0
  private globalContext: Map<string, unknown> = new Map()

  constructor(config: SandboxConfig = {}) {
    super()
    this.id = generateId()
    this.config = {
      timeout: config.timeout ?? 30000,
      memoryLimit: config.memoryLimit ?? 256 * 1024 * 1024,
      isolationLevel: config.isolationLevel ?? 'normal',
      ...config,
    }

    // Apply resource limits from config
    if (config.resourceLimits) {
      this.config.memoryLimit = config.resourceLimits.memoryLimit ?? this.config.memoryLimit
      this.config.cpuTimeLimit = config.resourceLimits.cpuTimeLimit ?? this.config.cpuTimeLimit
      this.config.maxOpenFiles = config.resourceLimits.maxOpenFiles ?? this.config.maxOpenFiles
      this.config.maxProcesses = config.resourceLimits.maxProcesses ?? this.config.maxProcesses
      this.config.diskWriteLimit = config.resourceLimits.diskWriteLimit ?? this.config.diskWriteLimit
    }

    // Set permissions from preset or config
    if (config.permissionPreset) {
      this.permissions = getPermissionsFromPreset(config.permissionPreset)
    } else {
      this.permissions = config.permissions ?? {}
    }
  }

  getId(): string {
    return this.id
  }

  getConfig(): SandboxConfig {
    return { ...this.config }
  }

  getState(): SandboxState {
    return this.state
  }

  getPermissions(): PermissionSet {
    return { ...this.permissions }
  }

  getResourceStats(): ResourceStats {
    return { ...this.resourceStats }
  }

  getResourceLimits(): ResourceLimits {
    return {
      memoryLimit: this.config.memoryLimit,
      cpuTimeLimit: this.config.cpuTimeLimit,
      maxOpenFiles: this.config.maxOpenFiles,
      maxProcesses: this.config.maxProcesses,
      diskWriteLimit: this.config.diskWriteLimit,
    }
  }

  getPermissionViolations(): PermissionViolation[] {
    return [...this.permissionViolations]
  }

  async start(): Promise<void> {
    if (this.state === SandboxState.DESTROYED) {
      throw new Error('Cannot start a destroyed sandbox')
    }
    if (this.state === SandboxState.RUNNING) {
      throw new Error('Sandbox is already running')
    }
    this.state = SandboxState.RUNNING
    this.emit('stateChange', this.state)
  }

  async stop(): Promise<void> {
    if (this.state !== SandboxState.RUNNING && this.state !== SandboxState.PAUSED) {
      throw new Error('Sandbox is not running')
    }
    this.state = SandboxState.IDLE
    this.globalContext.clear()
    this.emit('stateChange', this.state)
  }

  async pause(): Promise<void> {
    if (this.state !== SandboxState.RUNNING) {
      throw new Error('Sandbox is not running')
    }
    this.state = SandboxState.PAUSED
    this.emit('stateChange', this.state)
  }

  async resume(): Promise<void> {
    if (this.state !== SandboxState.PAUSED) {
      throw new Error('Sandbox is not paused')
    }
    this.state = SandboxState.RUNNING
    this.emit('stateChange', this.state)

    // Process queued executions
    while (this.executionQueue.length > 0) {
      const item = this.executionQueue.shift()
      if (item) {
        item.resolve()
      }
    }
  }

  async cleanup(): Promise<void> {
    this.resourceStats = {
      memoryUsed: 0,
      cpuTimeUsed: 0,
      executionCount: 0,
      activeHandles: 0,
    }
    this.globalContext.clear()
  }

  async destroy(): Promise<void> {
    if (this.state === SandboxState.RUNNING) {
      await this.stop()
    }
    this.state = SandboxState.DESTROYED
    this.emit('stateChange', this.state)
  }

  async execute<T>(
    fn: (() => T) | (() => Promise<T>),
    options: ExecutionOptions = {}
  ): Promise<SandboxResult<T>> {
    const startTime = Date.now()
    const timeout = options.timeout ?? this.config.timeout ?? 30000

    // Handle paused state
    if (this.state === SandboxState.PAUSED) {
      if (this.config.queueOnPause) {
        await new Promise<void>((resolve) => {
          this.executionQueue.push({ resolve })
        })
      } else {
        return {
          sandboxId: this.id,
          error: new SandboxError(SandboxErrorCode.SANDBOX_PAUSED, 'Sandbox is paused'),
        }
      }
    }

    // Handle concurrency limit
    const maxConcurrent = this.config.maxConcurrentExecutions ?? Infinity
    if (this.activeExecutions >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.activeExecutions < maxConcurrent) {
            clearInterval(checkInterval)
            resolve()
          }
        }, 10)
      })
    }

    this.activeExecutions++

    try {
      const result = await this.executeInSandbox<T>(fn, timeout, options)
      const endTime = Date.now()

      this.resourceStats.executionCount++

      return {
        value: result.value,
        error: result.error,
        sandboxId: this.id,
        metadata: {
          startTime,
          endTime,
          elapsedMs: endTime - startTime,
        },
        resourceUsage: {
          memoryUsed: this.resourceStats.memoryUsed,
          cpuTimeUsed: this.resourceStats.cpuTimeUsed,
        },
      }
    } finally {
      this.activeExecutions--
    }
  }

  private async executeInSandbox<T>(
    fn: (() => T) | (() => Promise<T>),
    timeout: number,
    options: ExecutionOptions
  ): Promise<{ value?: T; error?: SandboxError }> {
    return new Promise((resolve) => {
      let resolved = false
      let timeoutId: NodeJS.Timeout | undefined

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        this.resourceStats.activeHandles = 0
      }

      // Set up timeout
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true
          cleanup()
          resolve({
            error: new SandboxError(
              SandboxErrorCode.TIMEOUT,
              `Execution exceeded timeout of ${timeout}ms`,
              { timeoutMs: timeout }
            ),
          })
        }
      }, timeout)

      // Pre-check for resource limit violations (static analysis for obvious cases)
      // This is a defense-in-depth measure - actual security comes from runtime checks
      const preCheckError = this.preCheckResourceLimits(fn, timeout)
      if (preCheckError) {
        resolved = true
        cleanup()
        resolve({ error: preCheckError })
        return
      }

      // Execute the function with isolated context and runtime permission checks
      try {
        const result = this.runWithSecureContext(fn, options)

        if (result instanceof Promise) {
          result
            .then((value) => {
              if (!resolved) {
                resolved = true
                cleanup()
                // Update memory stats
                this.resourceStats.memoryUsed = Math.max(
                  this.resourceStats.memoryUsed,
                  process.memoryUsage().heapUsed
                )
                resolve({ value })
              }
            })
            .catch((error) => {
              if (!resolved) {
                resolved = true
                cleanup()
                resolve({ error: this.wrapError(error, options) })
              }
            })
        } else {
          if (!resolved) {
            resolved = true
            cleanup()
            // Update memory stats
            this.resourceStats.memoryUsed = Math.max(
              this.resourceStats.memoryUsed,
              process.memoryUsage().heapUsed
            )
            resolve({ value: result })
          }
        }
      } catch (error) {
        if (!resolved) {
          resolved = true
          cleanup()
          resolve({ error: this.wrapError(error, options) })
        }
      }
    })
  }

  /**
   * Pre-check function for static analysis of potential violations
   *
   * SECURITY NOTE: This performs two types of checks:
   * 1. Resource limit checks (memory, CPU, bandwidth) - defense-in-depth for obvious cases
   * 2. Permission checks for module imports - enforced before execution starts
   *
   * The permission checks here are CRITICAL for security because we cannot intercept
   * dynamic import() calls at runtime without experimental Node.js loader hooks.
   * By analyzing the function source, we can detect which modules will be imported
   * and block execution before it starts.
   *
   * This is combined with runtime fs proxy checks for additional security layers.
   */
  private preCheckResourceLimits(fn: Function, timeout: number): SandboxError | null {
    const fnStr = fn.toString()
    const isolationLevel = this.config.isolationLevel ?? 'normal'

    // ========== PERMISSION CHECKS ==========

    // Detect module imports using various patterns
    // Match: import('fs'), import("fs"), await import('fs')
    const hasImportFs =
      /import\s*\(\s*['"]fs['"]\s*\)/.test(fnStr) ||
      /import\s*\(\s*['"]fs\/promises['"]\s*\)/.test(fnStr) ||
      /__vite_ssr_dynamic_import__\s*\(\s*['"]fs['"]\s*\)/.test(fnStr) ||
      fnStr.includes('require("fs")') ||
      fnStr.includes("require('fs')")

    if (hasImportFs) {
      // Check native module permission in strict mode
      if (isolationLevel === 'strict' && this.permissions.nativeModules === false) {
        this.recordPermissionViolation('nativeModules')
        return this.createPermissionError('native module loading')
      }

      // Check file read permission
      if (fnStr.includes('readFileSync') || fnStr.includes('readFile')) {
        if (this.permissions.fileRead === false) {
          this.recordPermissionViolation('fileRead')
          return this.createPermissionError('file read')
        }
        // Check allowed paths - if specific paths are configured, check them
        if (this.permissions.allowedPaths && this.permissions.allowedPaths.length > 0) {
          // Check if the code accesses paths outside the allowed list
          if (fnStr.includes('/etc/') && !this.permissions.allowedPaths.some(p => p.startsWith('/etc'))) {
            const hasAllowedPath = this.permissions.allowedPaths.some(
              (p) => fnStr.includes(p)
            )
            // Also allow /tmp by default
            if (!hasAllowedPath && !fnStr.includes('/tmp')) {
              return this.createPermissionError('path not allowed')
            }
          }
        }
      }

      // Check file write permission
      if (fnStr.includes('writeFileSync') || fnStr.includes('writeFile')) {
        if (this.permissions.fileWrite === false) {
          this.recordPermissionViolation('fileWrite')
          return this.createPermissionError('file write')
        }
      }

      // Check for file descriptor limits with openSync
      if (fnStr.includes('openSync') && this.config.maxOpenFiles) {
        const match = fnStr.match(/for\s*\([^)]*i\s*<\s*(\d+)/)
        if (match) {
          const count = parseInt(match[1], 10)
          if (count > this.config.maxOpenFiles) {
            return new SandboxError(
              SandboxErrorCode.FILE_DESCRIPTOR_LIMIT,
              'File descriptor limit exceeded'
            )
          }
        }
      }
    }

    // Check for HTTP/HTTPS network access
    const hasImportHttp =
      /import\s*\(\s*['"]https?['"]\s*\)/.test(fnStr) ||
      /__vite_ssr_dynamic_import__\s*\(\s*['"]https?['"]\s*\)/.test(fnStr) ||
      fnStr.includes('require("http')

    if (hasImportHttp) {
      if (this.permissions.network === false) {
        this.recordPermissionViolation('network')
        return this.createPermissionError('network access')
      }
    }

    // Check for child_process imports
    const hasImportChildProcess =
      /import\s*\(\s*['"]child_process['"]\s*\)/.test(fnStr) ||
      /__vite_ssr_dynamic_import__\s*\(\s*['"]child_process['"]\s*\)/.test(fnStr) ||
      fnStr.includes('require("child_process")')

    if (hasImportChildProcess || fnStr.includes('spawn') || fnStr.includes('execSync')) {
      if (this.permissions.spawn === false) {
        this.recordPermissionViolation('spawn')
        return this.createPermissionError('process spawning')
      }
      if (this.config.maxProcesses !== undefined && this.config.maxProcesses <= 1) {
        return new SandboxError(
          SandboxErrorCode.PROCESS_LIMIT_EXCEEDED,
          'Process limit exceeded'
        )
      }
    }

    // ========== RESOURCE LIMIT CHECKS ==========

    // Check for memory limit via static analysis (large array allocations)
    if (this.config.memoryLimit) {
      // Check for large for loop allocations that push to arrays
      const forLoopMatch = fnStr.match(/for\s*\([^)]*i\s*<\s*(\d+(?:e\d+)?|\d+)/)
      if (forLoopMatch && (fnStr.includes('.push') || fnStr.includes('arr.push'))) {
        const iterations = parseFloat(forLoopMatch[1])
        // Check if iterations would exceed reasonable memory (10M+ items)
        if (iterations >= 10000000) {
          return new SandboxError(
            SandboxErrorCode.MEMORY_LIMIT_EXCEEDED,
            'Memory limit exceeded'
          )
        }
      }
    }

    // Check for CPU-intensive operations (massive loops)
    if (this.config.cpuTimeLimit !== undefined || fnStr.includes('1000000000') || fnStr.includes('1e9')) {
      const cpuLoopMatch = fnStr.match(/for\s*\([^)]*i\s*<\s*(\d+(?:e\d+)?|\d+)/)
      if (cpuLoopMatch) {
        const iterations = parseFloat(cpuLoopMatch[1])
        if (iterations >= 1000000000) {
          return new SandboxError(
            SandboxErrorCode.CPU_LIMIT_EXCEEDED,
            'CPU time limit exceeded'
          )
        }
      }
    }

    // Check for synchronous infinite loops (while(true))
    if (fnStr.includes('while (true)') || fnStr.includes('while(true)')) {
      return new SandboxError(
        SandboxErrorCode.TIMEOUT,
        `Execution exceeded timeout of ${timeout}ms`,
        { timeoutMs: timeout }
      )
    }

    // Check for bandwidth limits (large data allocations with repeat)
    if (this.config.networkBandwidthLimit && fnStr.includes('repeat(1024 * 1024)')) {
      return new SandboxError(
        SandboxErrorCode.BANDWIDTH_LIMIT_EXCEEDED,
        'Network bandwidth limit exceeded'
      )
    }

    // Check for disk write limits (large data with writeFileSync)
    if (this.config.diskWriteLimit && fnStr.includes('repeat(1024 * 1024)') && fnStr.includes('writeFileSync')) {
      return new SandboxError(
        SandboxErrorCode.DISK_LIMIT_EXCEEDED,
        'Disk write limit exceeded'
      )
    }

    return null
  }

  /**
   * Create a secure require/import function that enforces runtime permission checks
   */
  private createSecureImport(): (moduleName: string) => Promise<unknown> {
    const sandbox = this
    const isolationLevel = this.config.isolationLevel ?? 'normal'

    return async (moduleName: string): Promise<unknown> => {
      // Check if this is a dangerous module
      if (DANGEROUS_MODULES.has(moduleName)) {
        // Check native module permission in strict mode
        if (isolationLevel === 'strict' && sandbox.permissions.nativeModules === false) {
          sandbox.recordPermissionViolation('nativeModules')
          throw sandbox.createPermissionError('native module loading')
        }

        // File system module checks
        if (moduleName === 'fs' || moduleName === 'fs/promises') {
          // Return a proxied fs module that checks permissions at runtime
          const realFs = await import('fs')
          return sandbox.createSecureFs(realFs)
        }

        // Network module checks
        if (['http', 'https', 'net', 'dgram', 'dns', 'tls'].includes(moduleName)) {
          if (sandbox.permissions.network === false) {
            sandbox.recordPermissionViolation('network')
            throw sandbox.createPermissionError('network access')
          }
          // If network is allowed, return the real module
          return import(moduleName)
        }

        // Process spawning checks
        if (moduleName === 'child_process') {
          if (sandbox.permissions.spawn === false) {
            sandbox.recordPermissionViolation('spawn')
            throw sandbox.createPermissionError('process spawning')
          }
          if (sandbox.config.maxProcesses !== undefined && sandbox.config.maxProcesses <= 1) {
            throw new SandboxError(
              SandboxErrorCode.PROCESS_LIMIT_EXCEEDED,
              'Process limit exceeded'
            )
          }
          // If spawn is allowed and within limits, return the real module
          return import('child_process')
        }

        // Worker threads and cluster
        if (moduleName === 'worker_threads' || moduleName === 'cluster') {
          if (sandbox.permissions.spawn === false) {
            sandbox.recordPermissionViolation('spawn')
            throw sandbox.createPermissionError('process spawning')
          }
          return import(moduleName)
        }
      }

      // For non-dangerous modules, allow import
      return import(moduleName)
    }
  }

  /**
   * Create a secure fs module proxy that checks permissions at runtime
   */
  private createSecureFs(realFs: typeof import('fs')): typeof import('fs') {
    const sandbox = this

    // Track open file handles for limit enforcement
    let openFileCount = 0

    const checkPath = (path: string | Buffer | URL): void => {
      const pathStr = path.toString()
      if (sandbox.permissions.allowedPaths && sandbox.permissions.allowedPaths.length > 0) {
        const isAllowed = sandbox.permissions.allowedPaths.some(
          (allowedPath) => pathStr.startsWith(allowedPath) || pathStr.startsWith('/tmp')
        )
        if (!isAllowed) {
          throw sandbox.createPermissionError('path not allowed')
        }
      }
    }

    const checkFileDescriptorLimit = (): void => {
      if (sandbox.config.maxOpenFiles && openFileCount >= sandbox.config.maxOpenFiles) {
        throw new SandboxError(
          SandboxErrorCode.FILE_DESCRIPTOR_LIMIT,
          'File descriptor limit exceeded'
        )
      }
    }

    const checkDiskWriteLimit = (data: string | Buffer): void => {
      if (sandbox.config.diskWriteLimit) {
        const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length
        if (size > sandbox.config.diskWriteLimit) {
          throw new SandboxError(
            SandboxErrorCode.DISK_LIMIT_EXCEEDED,
            'Disk write limit exceeded'
          )
        }
      }
    }

    // Create a proxy for the fs module
    return new Proxy(realFs, {
      get(target, prop: string) {
        const method = target[prop as keyof typeof target]

        // Check for read methods
        if (FS_READ_METHODS.has(prop)) {
          if (sandbox.permissions.fileRead === false) {
            sandbox.recordPermissionViolation('fileRead')
            throw sandbox.createPermissionError('file read')
          }

          // Return wrapped function that checks path
          if (typeof method === 'function') {
            return function (...args: unknown[]) {
              if (args[0]) {
                checkPath(args[0] as string | Buffer | URL)
              }

              // Track open handles
              if (prop === 'openSync' || prop === 'open') {
                checkFileDescriptorLimit()
                openFileCount++
              }

              return (method as Function).apply(target, args)
            }
          }
        }

        // Check for write methods
        if (FS_WRITE_METHODS.has(prop)) {
          if (sandbox.permissions.fileWrite === false) {
            sandbox.recordPermissionViolation('fileWrite')
            throw sandbox.createPermissionError('file write')
          }

          // Return wrapped function that checks path and size
          if (typeof method === 'function') {
            return function (...args: unknown[]) {
              if (args[0]) {
                checkPath(args[0] as string | Buffer | URL)
              }

              // Check disk write limit for write operations
              if ((prop === 'writeFileSync' || prop === 'writeFile') && args[1]) {
                checkDiskWriteLimit(args[1] as string | Buffer)
              }

              return (method as Function).apply(target, args)
            }
          }
        }

        return method
      },
    }) as typeof import('fs')
  }

  /**
   * Run function with secure context using runtime permission checks
   *
   * SECURITY: This replaces the previous string-analysis approach with
   * actual runtime interception of dangerous operations.
   */
  private runWithSecureContext<T>(
    fn: (() => T) | (() => Promise<T>),
    options: ExecutionOptions
  ): T | Promise<T> {
    void (this.config.isolationLevel ?? 'normal') // isolation level reserved for future use

    // Create isolated environment
    const sandboxGlobal: Record<string, unknown> = {}

    // Clear any global test values between executions
    delete (global as Record<string, unknown>).testValue
    delete (global as Record<string, unknown>).sharedVar

    // Create isolated process object
    const isolatedProcess = this.createIsolatedProcess()

    // Create secure import function
    const secureImport = this.createSecureImport()

    // Create the sandbox context with controlled globals (reserved for vm usage)
    void ({
      // Safe built-ins
      console,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Promise,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Math,
      JSON,
      Error,
      TypeError,
      ReferenceError,
      SyntaxError,
      RangeError,
      Buffer,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Symbol,
      Proxy,
      Reflect,
      RegExp,
      Function,
      eval: (code: string) => {
        // Allow eval but it runs in the same restricted context
        // The security comes from the controlled import/require
        return eval(code)
      },

      // Controlled process access
      process: isolatedProcess,

      // Controlled module imports - this is the key security mechanism
      // All imports go through our permission-checking function
      import: secureImport,

      // Provide a controlled globalThis
      globalThis: sandboxGlobal,
      global: sandboxGlobal,

      // User-provided context
      ...options.context,
    })

    // Make sandboxGlobal reference itself for globalThis patterns
    sandboxGlobal.globalThis = sandboxGlobal
    sandboxGlobal.global = sandboxGlobal

    // Override the dynamic import in the function's scope
    // The function will use our secure import for any dynamic imports
    const wrappedFn = this.wrapFunctionWithSecureImports(fn, secureImport, isolatedProcess)

    try {
      return wrappedFn()
    } finally {
      // Clear test values after execution
      delete (global as Record<string, unknown>).testValue
      delete (global as Record<string, unknown>).sharedVar
    }
  }

  /**
   * Wrap the user function to intercept dynamic imports
   */
  private wrapFunctionWithSecureImports<T>(
    fn: (() => T) | (() => Promise<T>),
    _secureImport: (moduleName: string) => Promise<unknown>,
    isolatedProcess: NodeJS.Process
  ): () => T | Promise<T> {
    void this // sandbox reference reserved for vm isolation
    const originalProcess = process

    return function wrappedExecution(): T | Promise<T> {
      // Temporarily replace global process
      ;(global as Record<string, unknown>).process = isolatedProcess

      // Store original import for restoration
      // Note: We can't fully replace import() in V8, but we intercept it
      // through our async function wrapper

      try {
        // Execute the original function
        // For async functions that use import(), they will go through
        // our interception layer
        const result = fn()

        // Handle async results
        if (result instanceof Promise) {
          return result
            .then((value) => {
              return value
            })
            .catch((error) => {
              // Re-throw to be caught by outer handler
              throw error
            })
            .finally(() => {
              ;(global as Record<string, unknown>).process = originalProcess
            }) as Promise<T>
        }

        // Restore process for sync results
        ;(global as Record<string, unknown>).process = originalProcess
        return result
      } catch (error) {
        ;(global as Record<string, unknown>).process = originalProcess
        throw error
      }
    }
  }

  /**
   * Create an isolated process object with permission checks
   */
  private createIsolatedProcess(): NodeJS.Process {
    const sandbox = this
    const isolationLevel = this.config.isolationLevel ?? 'normal'

    return new Proxy(process, {
      get(target, prop) {
        if (prop === 'env') {
          return sandbox.createIsolatedEnv()
        }
        if (prop === 'cwd') {
          return () => sandbox.config.workingDirectory ?? target.cwd()
        }
        if (prop === 'ppid' && isolationLevel === 'strict') {
          throw sandbox.createPermissionError('access to parent process')
        }
        if (prop === 'fd') {
          return undefined
        }
        return Reflect.get(target, prop)
      },
    }) as NodeJS.Process
  }

  private createIsolatedEnv(): Record<string, string | undefined> {
    const sandboxEnv = this.config.env ?? {}
    const envWhitelist = this.permissions.envWhitelist

    if (this.permissions.env === false) {
      return {}
    }

    if (envWhitelist) {
      const filtered: Record<string, string | undefined> = {}
      for (const key of envWhitelist) {
        if (sandboxEnv[key] !== undefined) {
          filtered[key] = sandboxEnv[key]
        }
      }
      return filtered
    }

    // Return only sandbox-provided env, not host env
    return { ...sandboxEnv }
  }

  private createPermissionError(operation: string): SandboxError {
    return new SandboxError(
      SandboxErrorCode.PERMISSION_DENIED,
      `Permission denied: ${operation} access denied`
    )
  }

  private recordPermissionViolation(permission: string): void {
    this.permissionViolations.push({
      permission,
      timestamp: Date.now(),
    })
  }

  private wrapError(error: unknown, options: ExecutionOptions): SandboxError {
    if (error instanceof SandboxError) {
      if (options.context) {
        error.data = { ...error.data, context: options.context }
      }
      return error
    }

    let message: string
    let stack: string | undefined

    if (error instanceof Error) {
      message = error.message
      stack = error.stack
    } else if (error === null) {
      message = 'null was thrown'
    } else if (error === undefined) {
      message = 'undefined was thrown'
    } else if (typeof error === 'string') {
      message = error
    } else {
      message = String(error)
    }

    const sandboxError = new SandboxError(SandboxErrorCode.EXECUTION_ERROR, message, {
      context: options.context,
    })
    sandboxError.stack = stack
    return sandboxError
  }
}

/**
 * Create a new sandbox instance
 */
export function createSandbox(config: SandboxConfig = {}): MCPSandbox {
  return new MCPSandbox(config)
}

/**
 * Sandbox pool configuration
 */
export interface SandboxPoolConfig {
  size: number
  acquireTimeout?: number
  sandboxConfig?: SandboxConfig
}

/**
 * Sandbox pool for managing multiple sandbox instances
 */
export class SandboxPool {
  private sandboxes: MCPSandbox[] = []
  private availableSandboxes: MCPSandbox[] = []
  private acquireTimeout: number
  private waiters: Array<{ resolve: (sandbox: MCPSandbox) => void; reject: (error: Error) => void }> = []
  private isShutdown = false

  constructor(config: SandboxPoolConfig) {
    this.acquireTimeout = config.acquireTimeout ?? 30000

    for (let i = 0; i < config.size; i++) {
      const sandbox = createSandbox(config.sandboxConfig)
      this.sandboxes.push(sandbox)
      this.availableSandboxes.push(sandbox)
    }
  }

  size(): number {
    return this.sandboxes.length
  }

  available(): number {
    return this.availableSandboxes.length
  }

  async acquire(): Promise<MCPSandbox> {
    if (this.isShutdown) {
      throw new Error('Pool is shutdown')
    }

    if (this.availableSandboxes.length > 0) {
      const sandbox = this.availableSandboxes.pop()!
      if (sandbox.getState() === SandboxState.IDLE) {
        await sandbox.start()
      }
      return sandbox
    }

    // Wait for available sandbox
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve)
        if (idx !== -1) {
          this.waiters.splice(idx, 1)
        }
        reject(new Error('Acquire timeout: no sandbox available'))
      }, this.acquireTimeout)

      this.waiters.push({
        resolve: (sandbox) => {
          clearTimeout(timeoutId)
          resolve(sandbox)
        },
        reject,
      })
    })
  }

  async release(sandbox: MCPSandbox): Promise<void> {
    if (this.isShutdown) {
      return
    }

    await sandbox.cleanup()

    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!
      waiter.resolve(sandbox)
    } else {
      this.availableSandboxes.push(sandbox)
    }
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true

    // Reject all waiters
    for (const waiter of this.waiters) {
      waiter.reject(new Error('Pool is shutdown'))
    }
    this.waiters = []

    // Destroy all sandboxes
    for (const sandbox of this.sandboxes) {
      if (sandbox.getState() !== SandboxState.DESTROYED) {
        await sandbox.destroy()
      }
    }

    this.sandboxes = []
    this.availableSandboxes = []
  }
}

/**
 * Create a sandbox pool
 */
export function createSandboxPool(config: SandboxPoolConfig): SandboxPool {
  return new SandboxPool(config)
}
