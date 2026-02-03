/**
 * @fileoverview Cloudflare Container Executor Integration
 *
 * This module provides executor implementations for running bash commands
 * in Cloudflare Containers. It supports multiple execution modes:
 *
 * - HTTP-based execution with the Sandbox SDK (exec/execStream)
 * - WebSocket streaming for interactive sessions
 * - Session isolation for multi-tenant environments
 *
 * @module do/container-executor
 *
 * @example
 * ```typescript
 * import { CloudflareContainerExecutor } from 'gitx.do/do'
 *
 * const executor = new CloudflareContainerExecutor({
 *   sandbox: env.Sandbox,
 *   sessionId: 'user-123',
 * })
 *
 * const result = await executor.execute('ls -la')
 * console.log(result.stdout)
 * ```
 */
// ============================================================================
// CloudflareContainerExecutor Class
// ============================================================================
/**
 * CloudflareContainerExecutor - Execute bash commands in Cloudflare Containers.
 *
 * This executor implements the BashExecutor interface and supports multiple
 * execution backends:
 *
 * 1. **Sandbox SDK**: Uses `exec()` and `execStream()` from @cloudflare/sandbox
 * 2. **HTTP Exec**: Sends commands to an HTTP endpoint in the container
 * 3. **WebSocket Streaming**: Connects to container via WebSocket for streaming
 *
 * @example
 * ```typescript
 * // Using Sandbox SDK
 * const executor = new CloudflareContainerExecutor({
 *   sandbox: env.Sandbox,
 *   sessionId: 'session-123',
 * })
 *
 * // Execute a command
 * const result = await executor.execute('npm install')
 *
 * // Spawn for streaming
 * const handle = await executor.spawn('npm', ['run', 'dev'], {
 *   onStdout: (chunk) => console.log(chunk),
 *   onStderr: (chunk) => console.error(chunk),
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Using HTTP exec endpoint
 * const executor = new CloudflareContainerExecutor({
 *   httpExecEndpoint: 'https://container.example.com.ai/exec',
 *   sessionId: 'session-456',
 * })
 *
 * const result = await executor.execute('ls -la')
 * ```
 */
export class CloudflareContainerExecutor {
    sandbox;
    container;
    sessionId;
    defaultCwd;
    defaultTimeout;
    defaultEnv;
    wsEndpoint;
    httpExecEndpoint;
    fetchFn;
    /**
     * Session state for isolation.
     */
    session;
    /**
     * Process ID counter for spawn handles.
     */
    pidCounter = 1000;
    /**
     * Create a new CloudflareContainerExecutor.
     *
     * @param options - Configuration options
     */
    constructor(options = {}) {
        if (options.sandbox !== undefined)
            this.sandbox = options.sandbox;
        if (options.container !== undefined)
            this.container = options.container;
        this.sessionId = options.sessionId ?? crypto.randomUUID();
        this.defaultCwd = options.cwd ?? '/';
        this.defaultTimeout = options.timeout ?? 30000;
        this.defaultEnv = options.env ?? {};
        if (options.wsEndpoint !== undefined)
            this.wsEndpoint = options.wsEndpoint;
        if (options.httpExecEndpoint !== undefined)
            this.httpExecEndpoint = options.httpExecEndpoint;
        this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
        // Initialize session state
        this.session = {
            id: this.sessionId,
            cwd: this.defaultCwd,
            env: { ...this.defaultEnv },
            processes: new Map(),
            lastActivity: Date.now(),
        };
    }
    // ===========================================================================
    // BashExecutor Interface
    // ===========================================================================
    /**
     * Execute a command and return the result.
     *
     * @param command - The command to execute
     * @param options - Execution options
     * @returns Promise resolving to the execution result
     */
    async execute(command, options) {
        this.session.lastActivity = Date.now();
        const cwd = options?.cwd ?? this.session.cwd;
        const timeout = options?.timeout ?? this.defaultTimeout;
        const env = { ...this.session.env, ...options?.env };
        // Try sandbox SDK first
        if (this.sandbox) {
            const sandboxOpts = { cwd, timeout, env };
            if (options?.stdin !== undefined)
                sandboxOpts.stdin = options.stdin;
            return this.executeViaSandbox(command, sandboxOpts);
        }
        // Try HTTP exec endpoint
        if (this.httpExecEndpoint) {
            const httpOpts = { cwd, timeout, env };
            if (options?.stdin !== undefined)
                httpOpts.stdin = options.stdin;
            return this.executeViaHttp(command, httpOpts);
        }
        // Try container fetch with custom exec endpoint
        if (this.container) {
            const containerOpts = { cwd, timeout, env };
            if (options?.stdin !== undefined)
                containerOpts.stdin = options.stdin;
            return this.executeViaContainer(command, containerOpts);
        }
        // No execution backend available
        return {
            command,
            stdout: '',
            stderr: 'No execution backend configured (sandbox, httpExecEndpoint, or container required)',
            exitCode: 1,
        };
    }
    /**
     * Spawn a command for streaming execution.
     *
     * @param command - The command to spawn
     * @param args - Command arguments
     * @param options - Spawn options
     * @returns Promise resolving to a spawn handle
     */
    async spawn(command, args, options) {
        this.session.lastActivity = Date.now();
        const fullCommand = args?.length ? `${command} ${args.join(' ')}` : command;
        const cwd = options?.cwd ?? this.session.cwd;
        const timeout = options?.timeout ?? this.defaultTimeout;
        const env = { ...this.session.env, ...options?.env };
        // Try sandbox SDK streaming
        if (this.sandbox?.execStream) {
            return this.spawnViaSandbox(fullCommand, { cwd, timeout, env }, options);
        }
        // Try WebSocket streaming
        if (this.wsEndpoint) {
            return this.spawnViaWebSocket(fullCommand, { cwd, timeout, env }, options);
        }
        // Try sandbox startProcess
        if (this.sandbox?.startProcess) {
            return this.spawnViaProcess(fullCommand, { cwd, timeout, env }, options);
        }
        // Fallback: execute and simulate streaming
        return this.spawnViaExec(fullCommand, { cwd, timeout, env }, options);
    }
    // ===========================================================================
    // Sandbox SDK Execution
    // ===========================================================================
    /**
     * Execute a command using the Sandbox SDK.
     */
    async executeViaSandbox(command, options) {
        try {
            const result = await this.sandbox.exec(command, options);
            return {
                command,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
            };
        }
        catch (error) {
            return {
                command,
                stdout: '',
                stderr: error instanceof Error ? error.message : String(error),
                exitCode: 1,
            };
        }
    }
    /**
     * Spawn a command using Sandbox SDK streaming.
     */
    async spawnViaSandbox(command, execOptions, spawnOptions) {
        const pid = this.pidCounter++;
        let abortController = null;
        const streamResult = await this.sandbox.execStream(command, execOptions);
        abortController = { abort: streamResult.abort };
        // Process the stream
        const reader = streamResult.stream.getReader();
        const processStream = async () => {
            let stdout = '';
            let stderr = '';
            let exitCode = 0;
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    if (value.type === 'stdout') {
                        const data = String(value.data);
                        stdout += data;
                        spawnOptions?.onStdout?.(data);
                    }
                    else if (value.type === 'stderr') {
                        const data = String(value.data);
                        stderr += data;
                        spawnOptions?.onStderr?.(data);
                    }
                    else if (value.type === 'exit') {
                        exitCode = Number(value.data);
                    }
                }
            }
            catch (error) {
                stderr += error instanceof Error ? error.message : String(error);
                exitCode = 1;
            }
            spawnOptions?.onExit?.(exitCode);
            return { command, stdout, stderr, exitCode };
        };
        const donePromise = processStream();
        const handle = {
            pid,
            done: donePromise,
            kill: (_signal) => {
                abortController?.abort();
            },
            write: (_data) => {
                // Sandbox stream doesn't support stdin writing
            },
            closeStdin: () => {
                // No-op for sandbox stream
            },
        };
        return handle;
    }
    /**
     * Spawn a command using Sandbox SDK startProcess.
     */
    async spawnViaProcess(command, execOptions, spawnOptions) {
        const processHandle = await this.sandbox.startProcess(command, execOptions);
        const pid = processHandle.pid;
        // Track the process
        this.session.processes.set(pid, processHandle);
        // Set up exit handling
        const donePromise = processHandle.exited.then(result => {
            this.session.processes.delete(pid);
            spawnOptions?.onExit?.(result.exitCode);
            return {
                command,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
            };
        });
        const handle = {
            pid,
            done: donePromise,
            kill: (signal) => {
                processHandle.kill(signal);
            },
            write: (data) => {
                processHandle.write(data);
            },
            closeStdin: () => {
                processHandle.closeStdin();
            },
        };
        return handle;
    }
    // ===========================================================================
    // HTTP Exec Execution
    // ===========================================================================
    /**
     * Execute a command via HTTP exec endpoint.
     */
    async executeViaHttp(command, options) {
        try {
            const response = await this.fetchFn(this.httpExecEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId,
                },
                body: JSON.stringify({
                    command,
                    cwd: options.cwd,
                    env: options.env,
                    timeout: options.timeout,
                    stdin: options.stdin,
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                return {
                    command,
                    stdout: '',
                    stderr: `HTTP exec failed: ${response.status} ${errorText}`,
                    exitCode: 1,
                };
            }
            const result = await response.json();
            return {
                command,
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? '',
                exitCode: result.exitCode ?? (result.success ? 0 : 1),
            };
        }
        catch (error) {
            return {
                command,
                stdout: '',
                stderr: error instanceof Error ? error.message : String(error),
                exitCode: 1,
            };
        }
    }
    // ===========================================================================
    // Container Fetch Execution
    // ===========================================================================
    /**
     * Execute a command via container fetch.
     */
    async executeViaContainer(command, options) {
        try {
            // Build the request to the container's exec endpoint
            const container = this.container;
            const request = new Request('http://container/exec', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId,
                },
                body: JSON.stringify({
                    command,
                    cwd: options.cwd,
                    env: options.env,
                    timeout: options.timeout,
                    stdin: options.stdin,
                }),
            });
            const response = await container.fetch(request);
            if (!response.ok) {
                const errorText = await response.text();
                return {
                    command,
                    stdout: '',
                    stderr: `Container exec failed: ${response.status} ${errorText}`,
                    exitCode: 1,
                };
            }
            const result = await response.json();
            return {
                command,
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? '',
                exitCode: result.exitCode ?? (result.success ? 0 : 1),
            };
        }
        catch (error) {
            return {
                command,
                stdout: '',
                stderr: error instanceof Error ? error.message : String(error),
                exitCode: 1,
            };
        }
    }
    // ===========================================================================
    // WebSocket Streaming
    // ===========================================================================
    /**
     * Spawn a command via WebSocket connection.
     */
    async spawnViaWebSocket(command, execOptions, spawnOptions) {
        const pid = this.pidCounter++;
        let ws = null;
        const { promise: donePromise, resolve: resolveDone } = withResolvers();
        let stdout = '';
        let stderr = '';
        let exitCode = 0;
        try {
            // Build WebSocket URL with session and command info
            const wsUrl = new URL(this.wsEndpoint);
            wsUrl.searchParams.set('session', this.sessionId);
            wsUrl.searchParams.set('command', command);
            if (execOptions.cwd)
                wsUrl.searchParams.set('cwd', execOptions.cwd);
            // Create WebSocket connection
            ws = new WebSocket(wsUrl.toString());
            ws.addEventListener('open', () => {
                // Send initial configuration
                ws.send(JSON.stringify({
                    type: 'init',
                    env: execOptions.env,
                    timeout: execOptions.timeout,
                }));
            });
            ws.addEventListener('message', (event) => {
                try {
                    const message = JSON.parse(String(event.data));
                    switch (message.type) {
                        case 'stdout': {
                            const outData = String(message.data ?? '');
                            stdout += outData;
                            spawnOptions?.onStdout?.(outData);
                            break;
                        }
                        case 'stderr': {
                            const errData = String(message.data ?? '');
                            stderr += errData;
                            spawnOptions?.onStderr?.(errData);
                            break;
                        }
                        case 'exit':
                            exitCode = Number(message.data ?? 0);
                            ws?.close();
                            break;
                        case 'error':
                            stderr += String(message.data ?? '');
                            exitCode = 1;
                            ws?.close();
                            break;
                    }
                }
                catch {
                    // Handle non-JSON messages as stdout
                    const data = String(event.data);
                    stdout += data;
                    spawnOptions?.onStdout?.(data);
                }
            });
            ws.addEventListener('close', () => {
                spawnOptions?.onExit?.(exitCode);
                resolveDone({ command, stdout, stderr, exitCode });
            });
            ws.addEventListener('error', (event) => {
                stderr += `WebSocket error: ${event}`;
                exitCode = 1;
            });
        }
        catch (error) {
            stderr = error instanceof Error ? error.message : String(error);
            exitCode = 1;
            resolveDone({ command, stdout, stderr, exitCode });
        }
        const handle = {
            pid,
            done: donePromise,
            kill: (signal) => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'signal', signal: signal ?? 'SIGTERM' }));
                    ws.close();
                }
            },
            write: (data) => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'stdin', data }));
                }
            },
            closeStdin: () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'stdin_close' }));
                }
            },
        };
        return handle;
    }
    /**
     * Spawn a command by executing and simulating streaming output.
     */
    async spawnViaExec(command, execOptions, spawnOptions) {
        const pid = this.pidCounter++;
        const executeAndStream = async () => {
            const opts = {};
            if (execOptions.cwd !== undefined)
                opts.cwd = execOptions.cwd;
            if (execOptions.timeout !== undefined)
                opts.timeout = execOptions.timeout;
            if (execOptions.env !== undefined)
                opts.env = execOptions.env;
            if (execOptions.stdin !== undefined)
                opts.stdin = execOptions.stdin;
            const result = await this.execute(command, opts);
            // Simulate streaming by emitting all output at once
            if (result.stdout) {
                spawnOptions?.onStdout?.(result.stdout);
            }
            if (result.stderr) {
                spawnOptions?.onStderr?.(result.stderr);
            }
            spawnOptions?.onExit?.(result.exitCode);
            return result;
        };
        const handle = {
            pid,
            done: executeAndStream(),
            kill: () => {
                // Cannot kill a non-streaming execution
            },
            write: () => {
                // Cannot write to a non-streaming execution
            },
            closeStdin: () => {
                // No-op
            },
        };
        return handle;
    }
    // ===========================================================================
    // Session Management
    // ===========================================================================
    /**
     * Get the current session ID.
     *
     * @returns The session ID
     */
    getSessionId() {
        return this.sessionId;
    }
    /**
     * Get the current session state.
     *
     * @returns Copy of the session state
     */
    getSessionState() {
        return {
            id: this.session.id,
            cwd: this.session.cwd,
            env: { ...this.session.env },
            lastActivity: this.session.lastActivity,
            processCount: this.session.processes.size,
        };
    }
    /**
     * Update the session working directory.
     *
     * @param cwd - New working directory
     */
    setCwd(cwd) {
        this.session.cwd = cwd;
    }
    /**
     * Update session environment variables.
     *
     * @param env - Environment variables to set
     */
    setEnv(env) {
        Object.assign(this.session.env, env);
    }
    /**
     * Unset session environment variables.
     *
     * @param keys - Environment variable keys to unset
     */
    unsetEnv(keys) {
        for (const key of keys) {
            delete this.session.env[key];
        }
    }
    /**
     * Get the number of active processes.
     *
     * @returns Number of active processes
     */
    getActiveProcessCount() {
        return this.session.processes.size;
    }
    /**
     * Kill all active processes.
     *
     * @param signal - Signal to send (default: SIGTERM)
     */
    async killAll(signal = 'SIGTERM') {
        const kills = Array.from(this.session.processes.values()).map(handle => handle.kill(signal));
        await Promise.all(kills);
        this.session.processes.clear();
    }
    // ===========================================================================
    // File Operations (when sandbox supports it)
    // ===========================================================================
    /**
     * Write a file to the container filesystem.
     *
     * @param path - File path
     * @param content - File content
     */
    async writeFile(path, content) {
        if (this.sandbox?.writeFile) {
            await this.sandbox.writeFile(path, content);
        }
        else if (this.httpExecEndpoint) {
            // Use HTTP endpoint for file writing
            const bodyContent = typeof content === 'string' ? content : new Uint8Array(content).buffer;
            await this.fetchFn(this.httpExecEndpoint.replace('/exec', '/file'), {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Session-Id': this.sessionId,
                    'X-File-Path': path,
                },
                body: bodyContent,
            });
        }
        else {
            throw new Error('File operations not supported by this executor');
        }
    }
    /**
     * Read a file from the container filesystem.
     *
     * @param path - File path
     * @returns File content
     */
    async readFile(path) {
        if (this.sandbox?.readFile) {
            return await this.sandbox.readFile(path);
        }
        else if (this.httpExecEndpoint) {
            // Use HTTP endpoint for file reading
            const response = await this.fetchFn(this.httpExecEndpoint.replace('/exec', '/file'), {
                method: 'GET',
                headers: {
                    'X-Session-Id': this.sessionId,
                    'X-File-Path': path,
                },
            });
            if (!response.ok) {
                throw new Error(`File read failed: ${response.status}`);
            }
            return await response.text();
        }
        else {
            throw new Error('File operations not supported by this executor');
        }
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a CloudflareContainerExecutor instance.
 *
 * @param options - Configuration options
 * @returns A new CloudflareContainerExecutor instance
 *
 * @example
 * ```typescript
 * const executor = createContainerExecutor({
 *   sandbox: env.Sandbox,
 *   sessionId: 'user-123',
 * })
 * ```
 */
export function createContainerExecutor(options = {}) {
    return new CloudflareContainerExecutor(options);
}
/**
 * Create an executor from a Sandbox binding.
 *
 * @param sandbox - Cloudflare Sandbox binding
 * @param sessionId - Optional session ID for isolation
 * @returns A new CloudflareContainerExecutor instance
 */
export function createSandboxExecutor(sandbox, sessionId) {
    const opts = { sandbox };
    if (sessionId !== undefined)
        opts.sessionId = sessionId;
    return new CloudflareContainerExecutor(opts);
}
/**
 * Create an executor from an HTTP exec endpoint.
 *
 * @param endpoint - HTTP exec endpoint URL
 * @param sessionId - Optional session ID for isolation
 * @returns A new CloudflareContainerExecutor instance
 */
export function createHttpExecutor(endpoint, sessionId) {
    const opts = { httpExecEndpoint: endpoint };
    if (sessionId !== undefined)
        opts.sessionId = sessionId;
    return new CloudflareContainerExecutor(opts);
}
/**
 * Create an executor from a WebSocket endpoint.
 *
 * @param endpoint - WebSocket endpoint URL
 * @param sessionId - Optional session ID for isolation
 * @returns A new CloudflareContainerExecutor instance
 */
export function createWebSocketExecutor(endpoint, sessionId) {
    const opts = { wsEndpoint: endpoint };
    if (sessionId !== undefined)
        opts.sessionId = sessionId;
    return new CloudflareContainerExecutor(opts);
}
// ============================================================================
// Type Guards
// ============================================================================
/**
 * Check if a value is a CloudflareContainerExecutor instance.
 *
 * @param value - Value to check
 * @returns True if value is a CloudflareContainerExecutor
 */
export function isContainerExecutor(value) {
    return value instanceof CloudflareContainerExecutor;
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Promise.withResolvers polyfill for older environments.
 */
function withResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve: resolve, reject: reject };
}
//# sourceMappingURL=container-executor.js.map