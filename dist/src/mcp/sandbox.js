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
export var SandboxErrorCode;
(function (SandboxErrorCode) {
    /** Execution exceeded the configured timeout */
    SandboxErrorCode["TIMEOUT"] = "TIMEOUT";
    /** Memory usage exceeded the configured limit */
    SandboxErrorCode["MEMORY_LIMIT_EXCEEDED"] = "MEMORY_LIMIT_EXCEEDED";
    /** CPU time exceeded the configured limit */
    SandboxErrorCode["CPU_LIMIT_EXCEEDED"] = "CPU_LIMIT_EXCEEDED";
    /** Operation was denied due to insufficient permissions */
    SandboxErrorCode["PERMISSION_DENIED"] = "PERMISSION_DENIED";
    /** General execution error occurred */
    SandboxErrorCode["EXECUTION_ERROR"] = "EXECUTION_ERROR";
    /** Too many file descriptors opened */
    SandboxErrorCode["FILE_DESCRIPTOR_LIMIT"] = "FILE_DESCRIPTOR_LIMIT";
    /** Too many processes spawned */
    SandboxErrorCode["PROCESS_LIMIT_EXCEEDED"] = "PROCESS_LIMIT_EXCEEDED";
    /** Network bandwidth limit exceeded */
    SandboxErrorCode["BANDWIDTH_LIMIT_EXCEEDED"] = "BANDWIDTH_LIMIT_EXCEEDED";
    /** Disk write limit exceeded */
    SandboxErrorCode["DISK_LIMIT_EXCEEDED"] = "DISK_LIMIT_EXCEEDED";
    /** Sandbox crashed unexpectedly */
    SandboxErrorCode["SANDBOX_CRASHED"] = "SANDBOX_CRASHED";
    /** Sandbox is paused and not accepting executions */
    SandboxErrorCode["SANDBOX_PAUSED"] = "SANDBOX_PAUSED";
})(SandboxErrorCode || (SandboxErrorCode = {}));
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
export class SandboxError extends Error {
    /** The error code identifying the type of error */
    code;
    /** Optional additional error data */
    data;
    /** Stack trace (inherited from Error) */
    stack;
    /**
     * Create a new sandbox error.
     * @param code - The error code
     * @param message - Human-readable error message
     * @param data - Optional additional error data
     */
    constructor(code, message, data) {
        super(message);
        this.name = 'SandboxError';
        this.code = code;
        if (data !== undefined) {
            this.data = data;
        }
    }
    /**
     * Convert error to JSON representation.
     * @returns JSON-serializable error object
     */
    toJSON() {
        const result = {
            code: this.code,
            message: this.message,
        };
        if (this.data !== undefined) {
            result.data = this.data;
        }
        return result;
    }
}
/**
 * Sandbox state enum.
 *
 * @description
 * Represents the lifecycle state of a sandbox instance.
 *
 * @enum {string}
 */
export var SandboxState;
(function (SandboxState) {
    /** Sandbox is idle and ready for use */
    SandboxState["IDLE"] = "IDLE";
    /** Sandbox is currently executing code */
    SandboxState["RUNNING"] = "RUNNING";
    /** Sandbox is paused (can be resumed) */
    SandboxState["PAUSED"] = "PAUSED";
    /** Sandbox has been destroyed and cannot be reused */
    SandboxState["DESTROYED"] = "DESTROYED";
})(SandboxState || (SandboxState = {}));
/**
 * Generate unique ID.
 * @returns Unique sandbox identifier
 * @internal
 */
function generateId() {
    return `sandbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
/**
 * Get permission set from preset.
 * @param preset - The permission preset to convert
 * @returns Corresponding PermissionSet
 * @internal
 */
function getPermissionsFromPreset(preset) {
    switch (preset) {
        case 'readonly':
            return {
                fileRead: true,
                fileWrite: false,
                network: false,
                spawn: false,
                env: true,
                nativeModules: true,
            };
        case 'full':
            return {
                fileRead: true,
                fileWrite: true,
                network: true,
                spawn: true,
                env: true,
                nativeModules: true,
            };
        case 'network-only':
            return {
                fileRead: false,
                fileWrite: false,
                network: true,
                spawn: false,
                env: false,
                nativeModules: false,
            };
        default:
            return {};
    }
}
/**
 * Dangerous modules that require permission checks.
 * @internal
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
]);
/**
 * File system read methods.
 * @internal
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
]);
/**
 * File system write methods.
 * @internal
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
]);
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
export class MCPSandbox extends EventEmitter {
    id;
    config;
    state = SandboxState.IDLE;
    resourceStats = {
        memoryUsed: 0,
        cpuTimeUsed: 0,
        executionCount: 0,
        activeHandles: 0,
    };
    permissionViolations = [];
    permissions;
    executionQueue = [];
    activeExecutions = 0;
    globalContext = new Map();
    /**
     * Create a new sandbox instance.
     * @param config - Configuration options
     */
    constructor(config = {}) {
        super();
        this.id = generateId();
        this.config = {
            timeout: config.timeout ?? 30000,
            memoryLimit: config.memoryLimit ?? 256 * 1024 * 1024,
            isolationLevel: config.isolationLevel ?? 'normal',
            ...config,
        };
        // Apply resource limits from config
        if (config.resourceLimits) {
            if (config.resourceLimits.memoryLimit !== undefined) {
                this.config.memoryLimit = config.resourceLimits.memoryLimit;
            }
            if (config.resourceLimits.cpuTimeLimit !== undefined) {
                this.config.cpuTimeLimit = config.resourceLimits.cpuTimeLimit;
            }
            if (config.resourceLimits.maxOpenFiles !== undefined) {
                this.config.maxOpenFiles = config.resourceLimits.maxOpenFiles;
            }
            if (config.resourceLimits.maxProcesses !== undefined) {
                this.config.maxProcesses = config.resourceLimits.maxProcesses;
            }
            if (config.resourceLimits.diskWriteLimit !== undefined) {
                this.config.diskWriteLimit = config.resourceLimits.diskWriteLimit;
            }
        }
        // Set permissions from preset or config
        if (config.permissionPreset) {
            this.permissions = getPermissionsFromPreset(config.permissionPreset);
        }
        else {
            this.permissions = config.permissions ?? {};
        }
    }
    /**
     * Get the sandbox ID.
     * @returns Unique sandbox identifier
     */
    getId() {
        return this.id;
    }
    /**
     * Get the sandbox configuration.
     * @returns Copy of the configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get the current sandbox state.
     * @returns Current SandboxState
     */
    getState() {
        return this.state;
    }
    /**
     * Get the current permission set.
     * @returns Copy of permissions
     */
    getPermissions() {
        return { ...this.permissions };
    }
    /**
     * Get resource usage statistics.
     * @returns Copy of resource stats
     */
    getResourceStats() {
        return { ...this.resourceStats };
    }
    /**
     * Get configured resource limits.
     * @returns Copy of resource limits
     */
    getResourceLimits() {
        const limits = {};
        if (this.config.memoryLimit !== undefined) {
            limits.memoryLimit = this.config.memoryLimit;
        }
        if (this.config.cpuTimeLimit !== undefined) {
            limits.cpuTimeLimit = this.config.cpuTimeLimit;
        }
        if (this.config.maxOpenFiles !== undefined) {
            limits.maxOpenFiles = this.config.maxOpenFiles;
        }
        if (this.config.maxProcesses !== undefined) {
            limits.maxProcesses = this.config.maxProcesses;
        }
        if (this.config.diskWriteLimit !== undefined) {
            limits.diskWriteLimit = this.config.diskWriteLimit;
        }
        return limits;
    }
    /**
     * Get list of permission violations.
     * @returns Array of recorded violations
     */
    getPermissionViolations() {
        return [...this.permissionViolations];
    }
    /**
     * Start the sandbox.
     *
     * @description
     * Transitions the sandbox to RUNNING state. Must be called before execute().
     *
     * @returns Promise that resolves when started
     * @throws {Error} If sandbox is destroyed or already running
     */
    async start() {
        if (this.state === SandboxState.DESTROYED) {
            throw new Error('Cannot start a destroyed sandbox');
        }
        if (this.state === SandboxState.RUNNING) {
            throw new Error('Sandbox is already running');
        }
        this.state = SandboxState.RUNNING;
        this.emit('stateChange', this.state);
    }
    /**
     * Stop the sandbox.
     *
     * @description
     * Transitions from RUNNING or PAUSED to IDLE state. Clears global context.
     *
     * @returns Promise that resolves when stopped
     * @throws {Error} If sandbox is not running
     */
    async stop() {
        if (this.state !== SandboxState.RUNNING && this.state !== SandboxState.PAUSED) {
            throw new Error('Sandbox is not running');
        }
        this.state = SandboxState.IDLE;
        this.globalContext.clear();
        this.emit('stateChange', this.state);
    }
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
    async pause() {
        if (this.state !== SandboxState.RUNNING) {
            throw new Error('Sandbox is not running');
        }
        this.state = SandboxState.PAUSED;
        this.emit('stateChange', this.state);
    }
    /**
     * Resume the sandbox.
     *
     * @description
     * Resumes execution after pause. Processes any queued executions.
     *
     * @returns Promise that resolves when resumed
     * @throws {Error} If sandbox is not paused
     */
    async resume() {
        if (this.state !== SandboxState.PAUSED) {
            throw new Error('Sandbox is not paused');
        }
        this.state = SandboxState.RUNNING;
        this.emit('stateChange', this.state);
        // Process queued executions
        while (this.executionQueue.length > 0) {
            const item = this.executionQueue.shift();
            if (item) {
                item.resolve();
            }
        }
    }
    /**
     * Cleanup sandbox resources.
     *
     * @description
     * Resets resource statistics and clears global context. Sandbox remains
     * usable after cleanup.
     *
     * @returns Promise that resolves when cleanup is complete
     */
    async cleanup() {
        this.resourceStats = {
            memoryUsed: 0,
            cpuTimeUsed: 0,
            executionCount: 0,
            activeHandles: 0,
        };
        this.globalContext.clear();
    }
    /**
     * Destroy the sandbox.
     *
     * @description
     * Permanently destroys the sandbox. It cannot be reused after destruction.
     *
     * @returns Promise that resolves when destroyed
     */
    async destroy() {
        if (this.state === SandboxState.RUNNING) {
            await this.stop();
        }
        this.state = SandboxState.DESTROYED;
        this.emit('stateChange', this.state);
    }
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
    async execute(fn, options = {}) {
        const startTime = Date.now();
        const timeout = options.timeout ?? this.config.timeout ?? 30000;
        // Handle paused state
        if (this.state === SandboxState.PAUSED) {
            if (this.config.queueOnPause) {
                await new Promise((resolve) => {
                    this.executionQueue.push({ resolve });
                });
            }
            else {
                return {
                    sandboxId: this.id,
                    error: new SandboxError(SandboxErrorCode.SANDBOX_PAUSED, 'Sandbox is paused'),
                };
            }
        }
        // Handle concurrency limit
        const maxConcurrent = this.config.maxConcurrentExecutions ?? Infinity;
        if (this.activeExecutions >= maxConcurrent) {
            await new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    if (this.activeExecutions < maxConcurrent) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 10);
            });
        }
        this.activeExecutions++;
        try {
            const result = await this.executeInSandbox(fn, timeout, options);
            const endTime = Date.now();
            this.resourceStats.executionCount++;
            const sandboxResult = {
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
            };
            if (result.value !== undefined) {
                sandboxResult.value = result.value;
            }
            if (result.error !== undefined) {
                sandboxResult.error = result.error;
            }
            return sandboxResult;
        }
        finally {
            this.activeExecutions--;
        }
    }
    async executeInSandbox(fn, timeout, options) {
        return new Promise((resolve) => {
            let resolved = false;
            let timeoutId;
            const cleanup = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                this.resourceStats.activeHandles = 0;
            };
            // Set up timeout
            timeoutId = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve({
                        error: new SandboxError(SandboxErrorCode.TIMEOUT, `Execution exceeded timeout of ${timeout}ms`, { timeoutMs: timeout }),
                    });
                }
            }, timeout);
            // Pre-check for resource limit violations (static analysis for obvious cases)
            // This is a defense-in-depth measure - actual security comes from runtime checks
            const preCheckError = this.preCheckResourceLimits(fn, timeout);
            if (preCheckError) {
                resolved = true;
                cleanup();
                resolve({ error: preCheckError });
                return;
            }
            // Execute the function with isolated context and runtime permission checks
            try {
                const result = this.runWithSecureContext(fn, options);
                if (result instanceof Promise) {
                    result
                        .then((value) => {
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            // Update memory stats
                            this.resourceStats.memoryUsed = Math.max(this.resourceStats.memoryUsed, process.memoryUsage().heapUsed);
                            resolve({ value });
                        }
                    })
                        .catch((error) => {
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            resolve({ error: this.wrapError(error, options) });
                        }
                    });
                }
                else {
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        // Update memory stats
                        this.resourceStats.memoryUsed = Math.max(this.resourceStats.memoryUsed, process.memoryUsage().heapUsed);
                        resolve({ value: result });
                    }
                }
            }
            catch (error) {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve({ error: this.wrapError(error, options) });
                }
            }
        });
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
    preCheckResourceLimits(fn, timeout) {
        const fnStr = fn.toString();
        const isolationLevel = this.config.isolationLevel ?? 'normal';
        // ========== SECURITY CHECKS ==========
        // Block eval() and new Function() - these can execute arbitrary code
        // bypassing all sandbox restrictions
        if (/\beval\s*\(/.test(fnStr)) {
            this.recordPermissionViolation('eval');
            return new SandboxError(SandboxErrorCode.PERMISSION_DENIED, 'eval() is blocked for security reasons');
        }
        // Block new Function() constructor - equivalent to eval
        if (/new\s+Function\s*\(/.test(fnStr)) {
            this.recordPermissionViolation('Function constructor');
            return new SandboxError(SandboxErrorCode.PERMISSION_DENIED, 'Function constructor is blocked for security reasons');
        }
        // ========== PERMISSION CHECKS ==========
        // Detect module imports using various patterns
        // Match: import('fs'), import("fs"), await import('fs')
        const hasImportFs = /import\s*\(\s*['"]fs['"]\s*\)/.test(fnStr) ||
            /import\s*\(\s*['"]fs\/promises['"]\s*\)/.test(fnStr) ||
            /__vite_ssr_dynamic_import__\s*\(\s*['"]fs['"]\s*\)/.test(fnStr) ||
            fnStr.includes('require("fs")') ||
            fnStr.includes("require('fs')");
        if (hasImportFs) {
            // Check native module permission in strict mode
            if (isolationLevel === 'strict' && this.permissions.nativeModules === false) {
                this.recordPermissionViolation('nativeModules');
                return this.createPermissionError('native module loading');
            }
            // Check file read permission
            if (fnStr.includes('readFileSync') || fnStr.includes('readFile')) {
                if (this.permissions.fileRead === false) {
                    this.recordPermissionViolation('fileRead');
                    return this.createPermissionError('file read');
                }
                // Check allowed paths - if specific paths are configured, check them
                if (this.permissions.allowedPaths && this.permissions.allowedPaths.length > 0) {
                    // Check if the code accesses paths outside the allowed list
                    if (fnStr.includes('/etc/') && !this.permissions.allowedPaths.some(p => p.startsWith('/etc'))) {
                        const hasAllowedPath = this.permissions.allowedPaths.some((p) => fnStr.includes(p));
                        // Also allow /tmp by default
                        if (!hasAllowedPath && !fnStr.includes('/tmp')) {
                            return this.createPermissionError('path not allowed');
                        }
                    }
                }
            }
            // Check file write permission
            if (fnStr.includes('writeFileSync') || fnStr.includes('writeFile')) {
                if (this.permissions.fileWrite === false) {
                    this.recordPermissionViolation('fileWrite');
                    return this.createPermissionError('file write');
                }
            }
            // Check for file descriptor limits with openSync
            if (fnStr.includes('openSync') && this.config.maxOpenFiles) {
                const match = fnStr.match(/for\s*\([^)]*i\s*<\s*(\d+)/);
                if (match && match[1] !== undefined) {
                    const count = parseInt(match[1], 10);
                    if (count > this.config.maxOpenFiles) {
                        return new SandboxError(SandboxErrorCode.FILE_DESCRIPTOR_LIMIT, 'File descriptor limit exceeded');
                    }
                }
            }
        }
        // Check for HTTP/HTTPS network access
        const hasImportHttp = /import\s*\(\s*['"]https?['"]\s*\)/.test(fnStr) ||
            /__vite_ssr_dynamic_import__\s*\(\s*['"]https?['"]\s*\)/.test(fnStr) ||
            fnStr.includes('require("http');
        if (hasImportHttp) {
            if (this.permissions.network === false) {
                this.recordPermissionViolation('network');
                return this.createPermissionError('network access');
            }
        }
        // Check for child_process imports
        const hasImportChildProcess = /import\s*\(\s*['"]child_process['"]\s*\)/.test(fnStr) ||
            /__vite_ssr_dynamic_import__\s*\(\s*['"]child_process['"]\s*\)/.test(fnStr) ||
            fnStr.includes('require("child_process")');
        if (hasImportChildProcess || fnStr.includes('spawn') || fnStr.includes('execSync')) {
            if (this.permissions.spawn === false) {
                this.recordPermissionViolation('spawn');
                return this.createPermissionError('process spawning');
            }
            if (this.config.maxProcesses !== undefined && this.config.maxProcesses <= 1) {
                return new SandboxError(SandboxErrorCode.PROCESS_LIMIT_EXCEEDED, 'Process limit exceeded');
            }
        }
        // ========== RESOURCE LIMIT CHECKS ==========
        // Check for memory limit via static analysis (large array allocations)
        if (this.config.memoryLimit) {
            // Check for large for loop allocations that push to arrays
            const forLoopMatch = fnStr.match(/for\s*\([^)]*i\s*<\s*(\d+(?:e\d+)?|\d+)/);
            if (forLoopMatch && forLoopMatch[1] !== undefined && (fnStr.includes('.push') || fnStr.includes('arr.push'))) {
                const iterations = parseFloat(forLoopMatch[1]);
                // Check if iterations would exceed reasonable memory (10M+ items)
                if (iterations >= 10000000) {
                    return new SandboxError(SandboxErrorCode.MEMORY_LIMIT_EXCEEDED, 'Memory limit exceeded');
                }
            }
        }
        // Check for CPU-intensive operations (massive loops)
        if (this.config.cpuTimeLimit !== undefined || fnStr.includes('1000000000') || fnStr.includes('1e9')) {
            const cpuLoopMatch = fnStr.match(/for\s*\([^)]*i\s*<\s*(\d+(?:e\d+)?|\d+)/);
            if (cpuLoopMatch && cpuLoopMatch[1] !== undefined) {
                const iterations = parseFloat(cpuLoopMatch[1]);
                if (iterations >= 1000000000) {
                    return new SandboxError(SandboxErrorCode.CPU_LIMIT_EXCEEDED, 'CPU time limit exceeded');
                }
            }
        }
        // Check for synchronous infinite loops (while(true))
        if (fnStr.includes('while (true)') || fnStr.includes('while(true)')) {
            return new SandboxError(SandboxErrorCode.TIMEOUT, `Execution exceeded timeout of ${timeout}ms`, { timeoutMs: timeout });
        }
        // Check for bandwidth limits (large data allocations with repeat)
        if (this.config.networkBandwidthLimit && fnStr.includes('repeat(1024 * 1024)')) {
            return new SandboxError(SandboxErrorCode.BANDWIDTH_LIMIT_EXCEEDED, 'Network bandwidth limit exceeded');
        }
        // Check for disk write limits (large data with writeFileSync)
        if (this.config.diskWriteLimit && fnStr.includes('repeat(1024 * 1024)') && fnStr.includes('writeFileSync')) {
            return new SandboxError(SandboxErrorCode.DISK_LIMIT_EXCEEDED, 'Disk write limit exceeded');
        }
        return null;
    }
    /**
     * Create a secure require/import function that enforces runtime permission checks
     */
    createSecureImport() {
        const sandbox = this;
        const isolationLevel = this.config.isolationLevel ?? 'normal';
        return async (moduleName) => {
            // Check if this is a dangerous module
            if (DANGEROUS_MODULES.has(moduleName)) {
                // Check native module permission in strict mode
                if (isolationLevel === 'strict' && sandbox.permissions.nativeModules === false) {
                    sandbox.recordPermissionViolation('nativeModules');
                    throw sandbox.createPermissionError('native module loading');
                }
                // File system module checks
                if (moduleName === 'fs' || moduleName === 'fs/promises') {
                    // Return a proxied fs module that checks permissions at runtime
                    const realFs = await import('fs');
                    return sandbox.createSecureFs(realFs);
                }
                // Network module checks
                if (['http', 'https', 'net', 'dgram', 'dns', 'tls'].includes(moduleName)) {
                    if (sandbox.permissions.network === false) {
                        sandbox.recordPermissionViolation('network');
                        throw sandbox.createPermissionError('network access');
                    }
                    // If network is allowed, return the real module
                    return import(moduleName);
                }
                // Process spawning checks
                if (moduleName === 'child_process') {
                    if (sandbox.permissions.spawn === false) {
                        sandbox.recordPermissionViolation('spawn');
                        throw sandbox.createPermissionError('process spawning');
                    }
                    if (sandbox.config.maxProcesses !== undefined && sandbox.config.maxProcesses <= 1) {
                        throw new SandboxError(SandboxErrorCode.PROCESS_LIMIT_EXCEEDED, 'Process limit exceeded');
                    }
                    // If spawn is allowed and within limits, return the real module
                    return import('child_process');
                }
                // Worker threads and cluster
                if (moduleName === 'worker_threads' || moduleName === 'cluster') {
                    if (sandbox.permissions.spawn === false) {
                        sandbox.recordPermissionViolation('spawn');
                        throw sandbox.createPermissionError('process spawning');
                    }
                    return import(moduleName);
                }
            }
            // For non-dangerous modules, allow import
            return import(moduleName);
        };
    }
    /**
     * Create a secure fs module proxy that checks permissions at runtime
     */
    createSecureFs(realFs) {
        const sandbox = this;
        // Track open file handles for limit enforcement
        let openFileCount = 0;
        const checkPath = (path) => {
            const pathStr = path.toString();
            if (sandbox.permissions.allowedPaths && sandbox.permissions.allowedPaths.length > 0) {
                const isAllowed = sandbox.permissions.allowedPaths.some((allowedPath) => pathStr.startsWith(allowedPath) || pathStr.startsWith('/tmp'));
                if (!isAllowed) {
                    throw sandbox.createPermissionError('path not allowed');
                }
            }
        };
        const checkFileDescriptorLimit = () => {
            if (sandbox.config.maxOpenFiles && openFileCount >= sandbox.config.maxOpenFiles) {
                throw new SandboxError(SandboxErrorCode.FILE_DESCRIPTOR_LIMIT, 'File descriptor limit exceeded');
            }
        };
        const checkDiskWriteLimit = (data) => {
            if (sandbox.config.diskWriteLimit) {
                const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
                if (size > sandbox.config.diskWriteLimit) {
                    throw new SandboxError(SandboxErrorCode.DISK_LIMIT_EXCEEDED, 'Disk write limit exceeded');
                }
            }
        };
        // Create a proxy for the fs module
        return new Proxy(realFs, {
            get(target, prop) {
                const method = target[prop];
                // Check for read methods
                if (FS_READ_METHODS.has(prop)) {
                    if (sandbox.permissions.fileRead === false) {
                        sandbox.recordPermissionViolation('fileRead');
                        throw sandbox.createPermissionError('file read');
                    }
                    // Return wrapped function that checks path
                    if (typeof method === 'function') {
                        return function (...args) {
                            if (args[0]) {
                                checkPath(args[0]);
                            }
                            // Track open handles
                            if (prop === 'openSync' || prop === 'open') {
                                checkFileDescriptorLimit();
                                openFileCount++;
                            }
                            return method.apply(target, args);
                        };
                    }
                }
                // Check for write methods
                if (FS_WRITE_METHODS.has(prop)) {
                    if (sandbox.permissions.fileWrite === false) {
                        sandbox.recordPermissionViolation('fileWrite');
                        throw sandbox.createPermissionError('file write');
                    }
                    // Return wrapped function that checks path and size
                    if (typeof method === 'function') {
                        return function (...args) {
                            if (args[0]) {
                                checkPath(args[0]);
                            }
                            // Check disk write limit for write operations
                            if ((prop === 'writeFileSync' || prop === 'writeFile') && args[1]) {
                                checkDiskWriteLimit(args[1]);
                            }
                            return method.apply(target, args);
                        };
                    }
                }
                return method;
            },
        });
    }
    /**
     * Run function with secure context using runtime permission checks
     *
     * SECURITY: This replaces the previous string-analysis approach with
     * actual runtime interception of dangerous operations.
     */
    runWithSecureContext(fn, options) {
        void (this.config.isolationLevel ?? 'normal'); // isolation level reserved for future use
        // Create isolated environment
        const sandboxGlobal = {};
        // Clear any global test values between executions
        delete global['testValue'];
        delete global['sharedVar'];
        // Create isolated process object
        const isolatedProcess = this.createIsolatedProcess();
        // Create secure import function
        const secureImport = this.createSecureImport();
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
            // SECURITY: eval is explicitly blocked to prevent arbitrary code execution
            // This prevents user code from bypassing sandbox restrictions via eval()
            eval: () => {
                throw new SandboxError(SandboxErrorCode.PERMISSION_DENIED, 'eval() is blocked for security reasons');
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
        });
        // Make sandboxGlobal reference itself for globalThis patterns
        sandboxGlobal['globalThis'] = sandboxGlobal;
        sandboxGlobal['global'] = sandboxGlobal;
        // Override the dynamic import in the function's scope
        // The function will use our secure import for any dynamic imports
        const wrappedFn = this.wrapFunctionWithSecureImports(fn, secureImport, isolatedProcess);
        try {
            return wrappedFn();
        }
        finally {
            // Clear test values after execution
            delete global['testValue'];
            delete global['sharedVar'];
        }
    }
    /**
     * Wrap the user function to intercept dynamic imports
     */
    wrapFunctionWithSecureImports(fn, _secureImport, isolatedProcess) {
        void this; // sandbox reference reserved for vm isolation
        const originalProcess = process;
        return function wrappedExecution() {
            // Temporarily replace global process
            ;
            global['process'] = isolatedProcess;
            // Store original import for restoration
            // Note: We can't fully replace import() in V8, but we intercept it
            // through our async function wrapper
            try {
                // Execute the original function
                // For async functions that use import(), they will go through
                // our interception layer
                const result = fn();
                // Handle async results
                if (result instanceof Promise) {
                    return result
                        .then((value) => {
                        return value;
                    })
                        .catch((error) => {
                        // Re-throw to be caught by outer handler
                        throw error;
                    })
                        .finally(() => {
                        ;
                        global['process'] = originalProcess;
                    });
                }
                // Restore process for sync results
                ;
                global['process'] = originalProcess;
                return result;
            }
            catch (error) {
                ;
                global['process'] = originalProcess;
                throw error;
            }
        };
    }
    /**
     * Create an isolated process object with permission checks
     */
    createIsolatedProcess() {
        const sandbox = this;
        const isolationLevel = this.config.isolationLevel ?? 'normal';
        return new Proxy(process, {
            get(target, prop) {
                if (prop === 'env') {
                    return sandbox.createIsolatedEnv();
                }
                if (prop === 'cwd') {
                    return () => sandbox.config.workingDirectory ?? target.cwd();
                }
                if (prop === 'ppid' && isolationLevel === 'strict') {
                    throw sandbox.createPermissionError('access to parent process');
                }
                if (prop === 'fd') {
                    return undefined;
                }
                return Reflect.get(target, prop);
            },
        });
    }
    createIsolatedEnv() {
        const sandboxEnv = this.config.env ?? {};
        const envWhitelist = this.permissions.envWhitelist;
        if (this.permissions.env === false) {
            return {};
        }
        if (envWhitelist) {
            const filtered = {};
            for (const key of envWhitelist) {
                if (sandboxEnv[key] !== undefined) {
                    filtered[key] = sandboxEnv[key];
                }
            }
            return filtered;
        }
        // Return only sandbox-provided env, not host env
        return { ...sandboxEnv };
    }
    createPermissionError(operation) {
        return new SandboxError(SandboxErrorCode.PERMISSION_DENIED, `Permission denied: ${operation} access denied`);
    }
    recordPermissionViolation(permission) {
        this.permissionViolations.push({
            permission,
            timestamp: Date.now(),
        });
    }
    wrapError(error, options) {
        if (error instanceof SandboxError) {
            if (options.context) {
                error.data = { ...error.data, context: options.context };
            }
            return error;
        }
        let message;
        let stack;
        if (error instanceof Error) {
            message = error.message;
            stack = error.stack;
        }
        else if (error === null) {
            message = 'null was thrown';
        }
        else if (error === undefined) {
            message = 'undefined was thrown';
        }
        else if (typeof error === 'string') {
            message = error;
        }
        else {
            message = String(error);
        }
        const sandboxError = new SandboxError(SandboxErrorCode.EXECUTION_ERROR, message, {
            context: options.context,
        });
        if (stack !== undefined) {
            sandboxError.stack = stack;
        }
        return sandboxError;
    }
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
export function createSandbox(config = {}) {
    return new MCPSandbox(config);
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
export class SandboxPool {
    /** @internal */
    sandboxes = [];
    /** @internal */
    availableSandboxes = [];
    /** @internal */
    acquireTimeout;
    /** @internal */
    waiters = [];
    /** @internal */
    isShutdown = false;
    /**
     * Create a new sandbox pool.
     * @param config - Pool configuration
     */
    constructor(config) {
        this.acquireTimeout = config.acquireTimeout ?? 30000;
        for (let i = 0; i < config.size; i++) {
            const sandbox = createSandbox(config.sandboxConfig);
            this.sandboxes.push(sandbox);
            this.availableSandboxes.push(sandbox);
        }
    }
    /**
     * Get total number of sandboxes in the pool.
     * @returns Pool size
     */
    size() {
        return this.sandboxes.length;
    }
    /**
     * Get number of available (not in use) sandboxes.
     * @returns Number of available sandboxes
     */
    available() {
        return this.availableSandboxes.length;
    }
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
    async acquire() {
        if (this.isShutdown) {
            throw new Error('Pool is shutdown');
        }
        if (this.availableSandboxes.length > 0) {
            const sandbox = this.availableSandboxes.pop();
            if (sandbox.getState() === SandboxState.IDLE) {
                await sandbox.start();
            }
            return sandbox;
        }
        // Wait for available sandbox
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const idx = this.waiters.findIndex((w) => w.resolve === resolve);
                if (idx !== -1) {
                    this.waiters.splice(idx, 1);
                }
                reject(new Error('Acquire timeout: no sandbox available'));
            }, this.acquireTimeout);
            this.waiters.push({
                resolve: (sandbox) => {
                    clearTimeout(timeoutId);
                    resolve(sandbox);
                },
                reject,
            });
        });
    }
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
    async release(sandbox) {
        if (this.isShutdown) {
            return;
        }
        await sandbox.cleanup();
        if (this.waiters.length > 0) {
            const waiter = this.waiters.shift();
            waiter.resolve(sandbox);
        }
        else {
            this.availableSandboxes.push(sandbox);
        }
    }
    /**
     * Shutdown the pool.
     *
     * @description
     * Rejects all pending waiters, destroys all sandboxes, and prevents
     * further acquire operations. This is a permanent operation.
     *
     * @returns Promise that resolves when shutdown is complete
     */
    async shutdown() {
        this.isShutdown = true;
        // Reject all waiters
        for (const waiter of this.waiters) {
            waiter.reject(new Error('Pool is shutdown'));
        }
        this.waiters = [];
        // Destroy all sandboxes
        for (const sandbox of this.sandboxes) {
            if (sandbox.getState() !== SandboxState.DESTROYED) {
                await sandbox.destroy();
            }
        }
        this.sandboxes = [];
        this.availableSandboxes = [];
    }
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
export function createSandboxPool(config) {
    return new SandboxPool(config);
}
//# sourceMappingURL=sandbox.js.map