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
import { EventEmitter } from 'events';
/**
 * Sandbox error codes
 */
export declare enum SandboxErrorCode {
    TIMEOUT = "TIMEOUT",
    MEMORY_LIMIT_EXCEEDED = "MEMORY_LIMIT_EXCEEDED",
    CPU_LIMIT_EXCEEDED = "CPU_LIMIT_EXCEEDED",
    PERMISSION_DENIED = "PERMISSION_DENIED",
    EXECUTION_ERROR = "EXECUTION_ERROR",
    FILE_DESCRIPTOR_LIMIT = "FILE_DESCRIPTOR_LIMIT",
    PROCESS_LIMIT_EXCEEDED = "PROCESS_LIMIT_EXCEEDED",
    BANDWIDTH_LIMIT_EXCEEDED = "BANDWIDTH_LIMIT_EXCEEDED",
    DISK_LIMIT_EXCEEDED = "DISK_LIMIT_EXCEEDED",
    SANDBOX_CRASHED = "SANDBOX_CRASHED",
    SANDBOX_PAUSED = "SANDBOX_PAUSED"
}
/**
 * Sandbox error class
 */
export declare class SandboxError extends Error {
    code: SandboxErrorCode;
    data?: Record<string, unknown>;
    stack?: string;
    constructor(code: SandboxErrorCode, message: string, data?: Record<string, unknown>);
    toJSON(): {
        code: SandboxErrorCode;
        message: string;
        data?: Record<string, unknown>;
    };
}
/**
 * Sandbox state enum
 */
export declare enum SandboxState {
    IDLE = "IDLE",
    RUNNING = "RUNNING",
    PAUSED = "PAUSED",
    DESTROYED = "DESTROYED"
}
/**
 * Isolation level for sandbox
 */
export type IsolationLevel = 'strict' | 'normal' | 'lax';
/**
 * Resource limits configuration
 */
export interface ResourceLimits {
    memoryLimit?: number;
    cpuTimeLimit?: number;
    maxOpenFiles?: number;
    maxProcesses?: number;
    networkBandwidthLimit?: number;
    diskWriteLimit?: number;
}
/**
 * Permission set for sandbox
 */
export interface PermissionSet {
    fileRead?: boolean;
    fileWrite?: boolean;
    network?: boolean;
    spawn?: boolean;
    env?: boolean;
    nativeModules?: boolean;
    allowedPaths?: string[];
    envWhitelist?: string[];
}
/**
 * Permission preset types
 */
export type PermissionPreset = 'readonly' | 'full' | 'network-only';
/**
 * Sandbox configuration
 */
export interface SandboxConfig {
    timeout?: number;
    memoryLimit?: number;
    cpuTimeLimit?: number;
    maxOpenFiles?: number;
    maxProcesses?: number;
    networkBandwidthLimit?: number;
    diskWriteLimit?: number;
    isolationLevel?: IsolationLevel;
    env?: Record<string, string>;
    workingDirectory?: string;
    permissions?: PermissionSet;
    permissionPreset?: PermissionPreset;
    resourceLimits?: ResourceLimits;
    queueOnPause?: boolean;
    maxConcurrentExecutions?: number;
}
/**
 * Execution options
 */
export interface ExecutionOptions {
    timeout?: number;
    context?: Record<string, unknown>;
}
/**
 * Resource usage statistics
 */
export interface ResourceStats {
    memoryUsed: number;
    cpuTimeUsed: number;
    executionCount: number;
    activeHandles: number;
}
/**
 * Resource usage in result
 */
export interface ResourceUsage {
    memoryUsed: number;
    cpuTimeUsed?: number;
}
/**
 * Result metadata
 */
export interface ResultMetadata {
    startTime: number;
    endTime: number;
    elapsedMs: number;
}
/**
 * Permission violation record
 */
export interface PermissionViolation {
    permission: string;
    timestamp: number;
    details?: string;
}
/**
 * Sandbox execution result
 */
export interface SandboxResult<T = unknown> {
    value?: T;
    error?: SandboxError;
    sandboxId: string;
    metadata?: ResultMetadata;
    resourceUsage?: ResourceUsage;
}
/**
 * MCP Sandbox class for isolated execution
 *
 * SECURITY: This implementation uses Node.js vm module with proper context
 * isolation and runtime permission checks instead of string analysis.
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
    constructor(config?: SandboxConfig);
    getId(): string;
    getConfig(): SandboxConfig;
    getState(): SandboxState;
    getPermissions(): PermissionSet;
    getResourceStats(): ResourceStats;
    getResourceLimits(): ResourceLimits;
    getPermissionViolations(): PermissionViolation[];
    start(): Promise<void>;
    stop(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    cleanup(): Promise<void>;
    destroy(): Promise<void>;
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
 * Create a new sandbox instance
 */
export declare function createSandbox(config?: SandboxConfig): MCPSandbox;
/**
 * Sandbox pool configuration
 */
export interface SandboxPoolConfig {
    size: number;
    acquireTimeout?: number;
    sandboxConfig?: SandboxConfig;
}
/**
 * Sandbox pool for managing multiple sandbox instances
 */
export declare class SandboxPool {
    private sandboxes;
    private availableSandboxes;
    private acquireTimeout;
    private waiters;
    private isShutdown;
    constructor(config: SandboxPoolConfig);
    size(): number;
    available(): number;
    acquire(): Promise<MCPSandbox>;
    release(sandbox: MCPSandbox): Promise<void>;
    shutdown(): Promise<void>;
}
/**
 * Create a sandbox pool
 */
export declare function createSandboxPool(config: SandboxPoolConfig): SandboxPool;
//# sourceMappingURL=sandbox.d.ts.map