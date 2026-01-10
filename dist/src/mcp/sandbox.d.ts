/**
 * @fileoverview MCP Sandbox Execution Environment
 *
 * Provides an isolated execution environment for MCP tools with:
 * - Resource limits (memory, CPU, time, file descriptors, disk)
 * - Capability restrictions (file read/write, network, process spawning)
 * - Safe git operation execution with permission checks
 * - Audit logging for security violations
 *
 * SECURITY: Uses Node.js vm module concepts for proper isolation. The sandbox
 * implements multi-layer security through:
 * 1. Pre-execution static analysis to detect dangerous patterns
 * 2. Runtime permission checks via Proxy-based module interception
 * 3. Resource limit enforcement during execution
 * 4. Permission violation recording for audit trails
 *
 * @module mcp/sandbox
 *
 * @example
 * // Create a sandbox with limited permissions
 * import { createSandbox, SandboxState } from './sandbox'
 *
 * const sandbox = createSandbox({
 *   timeout: 5000,
 *   memoryLimit: 128 * 1024 * 1024,
 *   permissions: {
 *     fileRead: true,
 *     fileWrite: false,
 *     network: false,
 *     spawn: false
 *   }
 * })
 *
 * await sandbox.start()
 * const result = await sandbox.execute(() => {
 *   return 'Hello from sandbox!'
 * })
 *
 * if (result.error) {
 *   console.error('Execution failed:', result.error.message)
 * } else {
 *   console.log('Result:', result.value)
 * }
 *
 * await sandbox.destroy()
 *
 * @example
 * // Using a sandbox pool for concurrent execution
 * import { createSandboxPool } from './sandbox'
 *
 * const pool = createSandboxPool({ size: 4 })
 * const sandbox = await pool.acquire()
 *
 * try {
 *   const result = await sandbox.execute(myFunction)
 * } finally {
 *   await pool.release(sandbox)
 * }
 *
 * await pool.shutdown()
 */
import { EventEmitter } from 'events';
/**
 * Sandbox error codes.
 *
 * @description
 * Enumeration of all possible error codes that can be returned by sandbox
 * operations. These codes indicate the specific reason for execution failure.
 *
 * @enum {string}
 */
export declare enum SandboxErrorCode {
    /** Execution exceeded the configured timeout */
    TIMEOUT = "TIMEOUT",
    /** Memory usage exceeded the configured limit */
    MEMORY_LIMIT_EXCEEDED = "MEMORY_LIMIT_EXCEEDED",
    /** CPU time exceeded the configured limit */
    CPU_LIMIT_EXCEEDED = "CPU_LIMIT_EXCEEDED",
    /** Operation was denied due to insufficient permissions */
    PERMISSION_DENIED = "PERMISSION_DENIED",
    /** General execution error occurred */
    EXECUTION_ERROR = "EXECUTION_ERROR",
    /** Too many file descriptors opened */
    FILE_DESCRIPTOR_LIMIT = "FILE_DESCRIPTOR_LIMIT",
    /** Too many processes spawned */
    PROCESS_LIMIT_EXCEEDED = "PROCESS_LIMIT_EXCEEDED",
    /** Network bandwidth limit exceeded */
    BANDWIDTH_LIMIT_EXCEEDED = "BANDWIDTH_LIMIT_EXCEEDED",
    /** Disk write limit exceeded */
    DISK_LIMIT_EXCEEDED = "DISK_LIMIT_EXCEEDED",
    /** Sandbox crashed unexpectedly */
    SANDBOX_CRASHED = "SANDBOX_CRASHED",
    /** Sandbox is paused and not accepting executions */
    SANDBOX_PAUSED = "SANDBOX_PAUSED"
}
/**
 * Sandbox error class.
 *
 * @description
 * Custom error class for sandbox-specific errors. Includes an error code
 * for programmatic handling and optional additional data.
 *
 * @class SandboxError
 * @extends Error
 *
 * @example
 * try {
 *   await sandbox.execute(fn)
 * } catch (error) {
 *   if (error instanceof SandboxError) {
 *     console.log('Error code:', error.code)
 *     console.log('Error data:', error.data)
 *   }
 * }
 */
export declare class SandboxError extends Error {
    /** The error code identifying the type of error */
    code: SandboxErrorCode;
    /** Optional additional error data */
    data?: Record<string, unknown>;
    /** Stack trace (inherited from Error) */
    stack?: string;
    /**
     * Create a new sandbox error.
     * @param code - The error code
     * @param message - Human-readable error message
     * @param data - Optional additional error data
     */
    constructor(code: SandboxErrorCode, message: string, data?: Record<string, unknown>);
    /**
     * Convert error to JSON representation.
     * @returns JSON-serializable error object
     */
    toJSON(): {
        code: SandboxErrorCode;
        message: string;
        data?: Record<string, unknown>;
    };
}
/**
 * Sandbox state enum.
 *
 * @description
 * Represents the lifecycle state of a sandbox instance.
 *
 * @enum {string}
 */
export declare enum SandboxState {
    /** Sandbox is idle and ready for use */
    IDLE = "IDLE",
    /** Sandbox is currently executing code */
    RUNNING = "RUNNING",
    /** Sandbox is paused (can be resumed) */
    PAUSED = "PAUSED",
    /** Sandbox has been destroyed and cannot be reused */
    DESTROYED = "DESTROYED"
}
/**
 * Isolation level for sandbox.
 *
 * @description
 * Determines how strictly the sandbox enforces isolation:
 * - 'strict': Most restrictive, blocks native modules
 * - 'normal': Default, balanced security
 * - 'lax': Least restrictive
 *
 * @typedef {'strict' | 'normal' | 'lax'} IsolationLevel
 */
export type IsolationLevel = 'strict' | 'normal' | 'lax';
/**
 * Resource limits configuration.
 *
 * @description
 * Defines limits on system resources that the sandbox can consume.
 *
 * @interface ResourceLimits
 */
export interface ResourceLimits {
    /** Maximum memory usage in bytes */
    memoryLimit?: number;
    /** Maximum CPU time in milliseconds */
    cpuTimeLimit?: number;
    /** Maximum number of open file handles */
    maxOpenFiles?: number;
    /** Maximum number of spawned processes */
    maxProcesses?: number;
    /** Maximum network bandwidth in bytes/second */
    networkBandwidthLimit?: number;
    /** Maximum disk write in bytes */
    diskWriteLimit?: number;
}
/**
 * Permission set for sandbox.
 *
 * @description
 * Defines what operations are allowed within the sandbox.
 *
 * @interface PermissionSet
 *
 * @example
 * const permissions: PermissionSet = {
 *   fileRead: true,
 *   fileWrite: false,
 *   network: false,
 *   spawn: false,
 *   allowedPaths: ['/tmp', '/app/data']
 * }
 */
export interface PermissionSet {
    /** Allow file read operations */
    fileRead?: boolean;
    /** Allow file write operations */
    fileWrite?: boolean;
    /** Allow network access */
    network?: boolean;
    /** Allow spawning child processes */
    spawn?: boolean;
    /** Allow access to environment variables */
    env?: boolean;
    /** Allow loading native modules */
    nativeModules?: boolean;
    /** List of allowed file paths (whitelist) */
    allowedPaths?: string[];
    /** List of allowed environment variable names */
    envWhitelist?: string[];
}
/**
 * Permission preset types.
 *
 * @description
 * Pre-configured permission sets for common use cases:
 * - 'readonly': File read only, no write/network/spawn
 * - 'full': All permissions enabled
 * - 'network-only': Network access only, no file access
 *
 * @typedef {'readonly' | 'full' | 'network-only'} PermissionPreset
 */
export type PermissionPreset = 'readonly' | 'full' | 'network-only';
/**
 * Sandbox configuration.
 *
 * @description
 * Complete configuration options for creating a sandbox instance.
 *
 * @interface SandboxConfig
 *
 * @example
 * const config: SandboxConfig = {
 *   timeout: 30000,
 *   memoryLimit: 256 * 1024 * 1024,
 *   isolationLevel: 'strict',
 *   permissionPreset: 'readonly'
 * }
 */
export interface SandboxConfig {
    /** Execution timeout in milliseconds (default: 30000) */
    timeout?: number;
    /** Memory limit in bytes (default: 256MB) */
    memoryLimit?: number;
    /** CPU time limit in milliseconds */
    cpuTimeLimit?: number;
    /** Maximum open file handles */
    maxOpenFiles?: number;
    /** Maximum spawned processes */
    maxProcesses?: number;
    /** Network bandwidth limit in bytes/second */
    networkBandwidthLimit?: number;
    /** Disk write limit in bytes */
    diskWriteLimit?: number;
    /** Isolation level (default: 'normal') */
    isolationLevel?: IsolationLevel;
    /** Environment variables to expose */
    env?: Record<string, string>;
    /** Working directory for file operations */
    workingDirectory?: string;
    /** Custom permission set */
    permissions?: PermissionSet;
    /** Use a preset permission configuration */
    permissionPreset?: PermissionPreset;
    /** Resource limits (alternative to individual limit fields) */
    resourceLimits?: ResourceLimits;
    /** If true, queue executions when paused instead of rejecting */
    queueOnPause?: boolean;
    /** Maximum concurrent executions */
    maxConcurrentExecutions?: number;
}
/**
 * Execution options.
 *
 * @description
 * Options for a single execution within a sandbox.
 *
 * @interface ExecutionOptions
 */
export interface ExecutionOptions {
    /** Override default timeout for this execution */
    timeout?: number;
    /** Additional context data passed to the execution */
    context?: Record<string, unknown>;
}
/**
 * Resource usage statistics.
 *
 * @description
 * Statistics about resource usage accumulated across sandbox executions.
 *
 * @interface ResourceStats
 */
export interface ResourceStats {
    /** Current memory usage in bytes */
    memoryUsed: number;
    /** Total CPU time used in milliseconds */
    cpuTimeUsed: number;
    /** Number of executions performed */
    executionCount: number;
    /** Number of active handles/resources */
    activeHandles: number;
}
/**
 * Resource usage in result.
 *
 * @description
 * Resource usage information for a specific execution.
 *
 * @interface ResourceUsage
 */
export interface ResourceUsage {
    /** Memory used during execution */
    memoryUsed: number;
    /** CPU time used during execution */
    cpuTimeUsed?: number;
}
/**
 * Result metadata.
 *
 * @description
 * Timing information for a sandbox execution.
 *
 * @interface ResultMetadata
 */
export interface ResultMetadata {
    /** Execution start timestamp (ms since epoch) */
    startTime: number;
    /** Execution end timestamp (ms since epoch) */
    endTime: number;
    /** Total elapsed time in milliseconds */
    elapsedMs: number;
}
/**
 * Permission violation record.
 *
 * @description
 * Records a permission violation attempt for audit purposes.
 *
 * @interface PermissionViolation
 */
export interface PermissionViolation {
    /** The permission that was violated */
    permission: string;
    /** When the violation occurred (ms since epoch) */
    timestamp: number;
    /** Additional details about the violation */
    details?: string;
}
/**
 * Sandbox execution result.
 *
 * @description
 * The result of executing code within a sandbox. Contains either
 * a value (on success) or an error (on failure), plus metadata.
 *
 * @interface SandboxResult
 * @template T - Type of the return value
 *
 * @example
 * const result = await sandbox.execute<number>(() => 42)
 * if (result.error) {
 *   console.error('Failed:', result.error.message)
 * } else {
 *   console.log('Success:', result.value) // 42
 * }
 */
export interface SandboxResult<T = unknown> {
    /** The execution result value (on success) */
    value?: T;
    /** The error (on failure) */
    error?: SandboxError;
    /** ID of the sandbox that executed the code */
    sandboxId: string;
    /** Timing metadata */
    metadata?: ResultMetadata;
    /** Resource usage during execution */
    resourceUsage?: ResourceUsage;
}
/**
 * MCP Sandbox class for isolated execution.
 *
 * @description
 * Provides an isolated execution environment with resource limits and
 * permission controls. Uses multi-layer security including static analysis,
 * runtime permission checks, and resource limit enforcement.
 *
 * SECURITY: This implementation uses Node.js vm module concepts with proper
 * context isolation and runtime permission checks instead of string analysis.
 *
 * Lifecycle:
 * 1. Create sandbox with createSandbox() or new MCPSandbox()
 * 2. Start the sandbox with start()
 * 3. Execute code with execute()
 * 4. Optionally pause()/resume()
 * 5. Cleanup with cleanup() or destroy()
 *
 * @class MCPSandbox
 * @extends EventEmitter
 *
 * @fires stateChange - When sandbox state changes
 *
 * @example
 * const sandbox = new MCPSandbox({
 *   timeout: 5000,
 *   permissions: { fileRead: true, fileWrite: false }
 * })
 *
 * await sandbox.start()
 *
 * const result = await sandbox.execute(() => {
 *   return 'Hello from sandbox!'
 * })
 *
 * console.log(result.value) // 'Hello from sandbox!'
 *
 * await sandbox.destroy()
 */
export declare class MCPSandbox extends EventEmitter {
    private id;
    private config;
    private state;
    private resourceStats;
    private permissionViolations;
    private permissions;
    private executionQueue;
    private activeExecutions;
    private globalContext;
    /**
     * Create a new sandbox instance.
     * @param config - Configuration options
     */
    constructor(config?: SandboxConfig);
    /**
     * Get the sandbox ID.
     * @returns Unique sandbox identifier
     */
    getId(): string;
    /**
     * Get the sandbox configuration.
     * @returns Copy of the configuration
     */
    getConfig(): SandboxConfig;
    /**
     * Get the current sandbox state.
     * @returns Current SandboxState
     */
    getState(): SandboxState;
    /**
     * Get the current permission set.
     * @returns Copy of permissions
     */
    getPermissions(): PermissionSet;
    /**
     * Get resource usage statistics.
     * @returns Copy of resource stats
     */
    getResourceStats(): ResourceStats;
    /**
     * Get configured resource limits.
     * @returns Copy of resource limits
     */
    getResourceLimits(): ResourceLimits;
    /**
     * Get list of permission violations.
     * @returns Array of recorded violations
     */
    getPermissionViolations(): PermissionViolation[];
    /**
     * Start the sandbox.
     *
     * @description
     * Transitions the sandbox to RUNNING state. Must be called before execute().
     *
     * @returns Promise that resolves when started
     * @throws {Error} If sandbox is destroyed or already running
     */
    start(): Promise<void>;
    /**
     * Stop the sandbox.
     *
     * @description
     * Transitions from RUNNING or PAUSED to IDLE state. Clears global context.
     *
     * @returns Promise that resolves when stopped
     * @throws {Error} If sandbox is not running
     */
    stop(): Promise<void>;
    /**
     * Pause the sandbox.
     *
     * @description
     * Temporarily pauses execution. New execute() calls will be queued if
     * queueOnPause is enabled, otherwise they return immediately with an error.
     *
     * @returns Promise that resolves when paused
     * @throws {Error} If sandbox is not running
     */
    pause(): Promise<void>;
    /**
     * Resume the sandbox.
     *
     * @description
     * Resumes execution after pause. Processes any queued executions.
     *
     * @returns Promise that resolves when resumed
     * @throws {Error} If sandbox is not paused
     */
    resume(): Promise<void>;
    /**
     * Cleanup sandbox resources.
     *
     * @description
     * Resets resource statistics and clears global context. Sandbox remains
     * usable after cleanup.
     *
     * @returns Promise that resolves when cleanup is complete
     */
    cleanup(): Promise<void>;
    /**
     * Destroy the sandbox.
     *
     * @description
     * Permanently destroys the sandbox. It cannot be reused after destruction.
     *
     * @returns Promise that resolves when destroyed
     */
    destroy(): Promise<void>;
    /**
     * Execute a function in the sandbox.
     *
     * @description
     * Executes the provided function within the sandbox's isolated environment.
     * The function is subject to configured timeout, resource limits, and
     * permission restrictions.
     *
     * @template T - Return type of the function
     * @param fn - Function to execute (sync or async)
     * @param options - Execution options (timeout, context)
     * @returns Promise resolving to SandboxResult with value or error
     *
     * @example
     * const result = await sandbox.execute<number>(() => {
     *   return 42
     * })
     *
     * if (result.error) {
     *   console.error('Failed:', result.error.code)
     * } else {
     *   console.log('Result:', result.value) // 42
     * }
     */
    execute<T>(fn: (() => T) | (() => Promise<T>), options?: ExecutionOptions): Promise<SandboxResult<T>>;
    private executeInSandbox;
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
    private preCheckResourceLimits;
    /**
     * Create a secure require/import function that enforces runtime permission checks
     */
    private createSecureImport;
    /**
     * Create a secure fs module proxy that checks permissions at runtime
     */
    private createSecureFs;
    /**
     * Run function with secure context using runtime permission checks
     *
     * SECURITY: This replaces the previous string-analysis approach with
     * actual runtime interception of dangerous operations.
     */
    private runWithSecureContext;
    /**
     * Wrap the user function to intercept dynamic imports
     */
    private wrapFunctionWithSecureImports;
    /**
     * Create an isolated process object with permission checks
     */
    private createIsolatedProcess;
    private createIsolatedEnv;
    private createPermissionError;
    private recordPermissionViolation;
    private wrapError;
}
/**
 * Create a new sandbox instance.
 *
 * @description
 * Factory function for creating a new MCPSandbox instance.
 * Equivalent to using `new MCPSandbox(config)`.
 *
 * @param config - Sandbox configuration options
 * @returns A new MCPSandbox instance
 *
 * @example
 * import { createSandbox } from './sandbox'
 *
 * const sandbox = createSandbox({
 *   timeout: 5000,
 *   permissions: { fileRead: true, network: false }
 * })
 *
 * await sandbox.start()
 * const result = await sandbox.execute(() => 'Hello!')
 */
export declare function createSandbox(config?: SandboxConfig): MCPSandbox;
/**
 * Sandbox pool configuration.
 *
 * @description
 * Configuration for creating a pool of sandbox instances.
 *
 * @interface SandboxPoolConfig
 */
export interface SandboxPoolConfig {
    /** Number of sandboxes in the pool */
    size: number;
    /** Timeout for acquiring a sandbox (ms, default: 30000) */
    acquireTimeout?: number;
    /** Configuration applied to all sandboxes in the pool */
    sandboxConfig?: SandboxConfig;
}
/**
 * Sandbox pool for managing multiple sandbox instances.
 *
 * @description
 * Manages a fixed-size pool of sandbox instances for concurrent execution.
 * Provides acquire/release semantics with automatic waiting and timeout.
 *
 * @class SandboxPool
 *
 * @example
 * const pool = new SandboxPool({
 *   size: 4,
 *   acquireTimeout: 10000,
 *   sandboxConfig: { timeout: 5000 }
 * })
 *
 * // Acquire a sandbox
 * const sandbox = await pool.acquire()
 *
 * try {
 *   const result = await sandbox.execute(() => 'Hello')
 * } finally {
 *   await pool.release(sandbox)
 * }
 *
 * // Shutdown when done
 * await pool.shutdown()
 */
export declare class SandboxPool {
    /** @internal */
    private sandboxes;
    /** @internal */
    private availableSandboxes;
    /** @internal */
    private acquireTimeout;
    /** @internal */
    private waiters;
    /** @internal */
    private isShutdown;
    /**
     * Create a new sandbox pool.
     * @param config - Pool configuration
     */
    constructor(config: SandboxPoolConfig);
    /**
     * Get total number of sandboxes in the pool.
     * @returns Pool size
     */
    size(): number;
    /**
     * Get number of available (not in use) sandboxes.
     * @returns Number of available sandboxes
     */
    available(): number;
    /**
     * Acquire a sandbox from the pool.
     *
     * @description
     * Returns an available sandbox or waits until one becomes available.
     * The sandbox is started if in IDLE state.
     *
     * @returns Promise resolving to an acquired sandbox
     * @throws {Error} If pool is shutdown or acquire times out
     */
    acquire(): Promise<MCPSandbox>;
    /**
     * Release a sandbox back to the pool.
     *
     * @description
     * Returns a sandbox to the pool after use. The sandbox is cleaned up
     * before being made available again. If waiters are present, the sandbox
     * is given to the next waiter instead of being added to the available pool.
     *
     * @param sandbox - The sandbox to release
     * @returns Promise that resolves when the sandbox is released
     */
    release(sandbox: MCPSandbox): Promise<void>;
    /**
     * Shutdown the pool.
     *
     * @description
     * Rejects all pending waiters, destroys all sandboxes, and prevents
     * further acquire operations. This is a permanent operation.
     *
     * @returns Promise that resolves when shutdown is complete
     */
    shutdown(): Promise<void>;
}
/**
 * Create a sandbox pool.
 *
 * @description
 * Factory function for creating a new SandboxPool instance.
 * Equivalent to using `new SandboxPool(config)`.
 *
 * @param config - Pool configuration
 * @returns A new SandboxPool instance
 *
 * @example
 * import { createSandboxPool } from './sandbox'
 *
 * const pool = createSandboxPool({
 *   size: 4,
 *   sandboxConfig: { timeout: 10000 }
 * })
 *
 * const sandbox = await pool.acquire()
 * // ... use sandbox ...
 * await pool.release(sandbox)
 *
 * await pool.shutdown()
 */
export declare function createSandboxPool(config: SandboxPoolConfig): SandboxPool;
//# sourceMappingURL=sandbox.d.ts.map