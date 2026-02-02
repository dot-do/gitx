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
/**
 * Result of a bash command execution.
 */
export interface BashResult {
    /**
     * The command that was executed.
     */
    command: string;
    /**
     * Standard output from the command.
     */
    stdout: string;
    /**
     * Standard error from the command.
     */
    stderr: string;
    /**
     * Exit code from the command.
     */
    exitCode: number;
}
/**
 * Options for executing a command.
 */
export interface ExecOptions {
    /**
     * Working directory for command execution.
     */
    cwd?: string;
    /**
     * Environment variables.
     */
    env?: Record<string, string>;
    /**
     * Timeout in milliseconds.
     */
    timeout?: number;
    /**
     * Input to provide to stdin.
     */
    stdin?: string;
}
/**
 * Options for spawning a command with streaming output.
 */
export interface SpawnOptions extends ExecOptions {
    /**
     * Callback for stdout data.
     */
    onStdout?: (data: string) => void;
    /**
     * Callback for stderr data.
     */
    onStderr?: (data: string) => void;
    /**
     * Callback for process exit.
     */
    onExit?: (code: number) => void;
}
/**
 * Handle for a spawned process.
 */
export interface SpawnHandle {
    /**
     * Process ID.
     */
    pid: number;
    /**
     * Promise that resolves when the process completes.
     */
    done: Promise<BashResult>;
    /**
     * Send a signal to the process.
     */
    kill: (signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT') => void;
    /**
     * Write data to the process stdin.
     */
    write: (data: string) => void;
    /**
     * Close the process stdin.
     */
    closeStdin: () => void;
}
/**
 * Interface for bash command execution.
 * Compatible with bashx.do's BashExecutor interface.
 */
export interface BashExecutor {
    /**
     * Execute a command and return the result.
     */
    execute(command: string, options?: ExecOptions): Promise<BashResult>;
    /**
     * Spawn a command for streaming execution.
     */
    spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>;
}
/**
 * Cloudflare Sandbox interface.
 * Matches the Sandbox SDK API from @cloudflare/sandbox.
 */
export interface CloudflareSandbox {
    /**
     * Execute a command and wait for completion.
     * Returns stdout, stderr, exitCode, and success flag.
     */
    exec(command: string, options?: SandboxExecOptions): Promise<SandboxExecResult>;
    /**
     * Execute a command with streaming output.
     * Returns a readable stream of output chunks.
     */
    execStream?(command: string, options?: SandboxExecOptions): Promise<SandboxStreamResult>;
    /**
     * Start a background process.
     * Returns a handle for managing the process.
     */
    startProcess?(command: string, options?: SandboxExecOptions): Promise<SandboxProcessHandle>;
    /**
     * Write a file to the sandbox filesystem.
     */
    writeFile?(path: string, content: string | Uint8Array): Promise<void>;
    /**
     * Read a file from the sandbox filesystem.
     */
    readFile?(path: string): Promise<string | Uint8Array>;
}
/**
 * Options for sandbox execution.
 */
export interface SandboxExecOptions {
    /**
     * Working directory for command execution.
     */
    cwd?: string;
    /**
     * Environment variables.
     */
    env?: Record<string, string>;
    /**
     * Timeout in milliseconds.
     */
    timeout?: number;
    /**
     * Input to provide to stdin.
     */
    stdin?: string;
}
/**
 * Result from sandbox command execution.
 */
export interface SandboxExecResult {
    /**
     * Standard output from the command.
     */
    stdout: string;
    /**
     * Standard error from the command.
     */
    stderr: string;
    /**
     * Exit code of the command.
     */
    exitCode: number;
    /**
     * Whether the command succeeded (exitCode === 0).
     */
    success: boolean;
}
/**
 * Result from streaming command execution.
 */
export interface SandboxStreamResult {
    /**
     * Readable stream of output.
     */
    stream: ReadableStream<SandboxStreamChunk>;
    /**
     * Promise that resolves when command completes.
     */
    done: Promise<SandboxExecResult>;
    /**
     * Abort the streaming execution.
     */
    abort(): void;
}
/**
 * Chunk from streaming output.
 */
export interface SandboxStreamChunk {
    /**
     * Type of output: 'stdout', 'stderr', or 'exit'.
     */
    type: 'stdout' | 'stderr' | 'exit';
    /**
     * Data content for stdout/stderr, exit code for exit.
     */
    data: string | number;
}
/**
 * Handle for managing a background process.
 */
export interface SandboxProcessHandle {
    /**
     * Process ID.
     */
    pid: number;
    /**
     * Send signal to the process.
     */
    kill(signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): Promise<void>;
    /**
     * Write to process stdin.
     */
    write(data: string): Promise<void>;
    /**
     * Close stdin.
     */
    closeStdin(): Promise<void>;
    /**
     * Promise that resolves when process exits.
     */
    exited: Promise<SandboxExecResult>;
}
/**
 * Cloudflare Container binding interface.
 * For use with native Cloudflare Containers (when exec becomes available).
 */
export interface CloudflareContainer {
    /**
     * Fetch method for HTTP requests to the container.
     */
    fetch(request: Request): Promise<Response>;
    /**
     * Get a container instance.
     */
    get(id: DurableObjectId): CloudflareContainerInstance;
}
/**
 * Container instance interface.
 */
export interface CloudflareContainerInstance {
    /**
     * Fetch method for HTTP requests.
     */
    fetch(request: Request): Promise<Response>;
    /**
     * Start the container.
     */
    start?(options?: ContainerStartOptions): Promise<void>;
    /**
     * Stop the container.
     */
    stop?(): Promise<void>;
}
/**
 * Options for starting a container.
 */
export interface ContainerStartOptions {
    /**
     * Override the entrypoint command.
     */
    entrypoint?: string[];
    /**
     * Environment variables.
     */
    env?: Record<string, string>;
}
/**
 * DurableObjectId type (simplified).
 */
export interface DurableObjectId {
    toString(): string;
}
/**
 * Configuration options for CloudflareContainerExecutor.
 */
export interface ContainerExecutorOptions {
    /**
     * Cloudflare Sandbox binding.
     * Use this for Sandbox SDK-based execution.
     */
    sandbox?: CloudflareSandbox;
    /**
     * Cloudflare Container binding.
     * Use this for native container-based execution.
     */
    container?: CloudflareContainer | CloudflareContainerInstance;
    /**
     * Session ID for isolation.
     * Each session gets its own sandbox/container instance.
     */
    sessionId?: string;
    /**
     * Default working directory.
     * @default '/'
     */
    cwd?: string;
    /**
     * Default timeout in milliseconds.
     * @default 30000
     */
    timeout?: number;
    /**
     * Default environment variables.
     */
    env?: Record<string, string>;
    /**
     * WebSocket endpoint for streaming execution.
     * Used when connecting to a container with WebSocket support.
     */
    wsEndpoint?: string;
    /**
     * HTTP exec endpoint for command execution.
     * Used when connecting to a container with HTTP exec API.
     */
    httpExecEndpoint?: string;
    /**
     * Custom fetch function for HTTP requests.
     * Useful for testing or custom transport layers.
     */
    fetch?: typeof fetch;
}
/**
 * Internal session state.
 */
interface SessionState {
    /**
     * Session ID.
     */
    id: string;
    /**
     * Working directory.
     */
    cwd: string;
    /**
     * Environment variables.
     */
    env: Record<string, string>;
    /**
     * Active processes.
     */
    processes: Map<number, SandboxProcessHandle>;
    /**
     * Last activity timestamp.
     */
    lastActivity: number;
}
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
export declare class CloudflareContainerExecutor implements BashExecutor {
    private readonly sandbox?;
    private readonly container?;
    private readonly sessionId;
    private readonly defaultCwd;
    private readonly defaultTimeout;
    private readonly defaultEnv;
    private readonly wsEndpoint?;
    private readonly httpExecEndpoint?;
    private readonly fetchFn;
    /**
     * Session state for isolation.
     */
    private session;
    /**
     * Process ID counter for spawn handles.
     */
    private pidCounter;
    /**
     * Create a new CloudflareContainerExecutor.
     *
     * @param options - Configuration options
     */
    constructor(options?: ContainerExecutorOptions);
    /**
     * Execute a command and return the result.
     *
     * @param command - The command to execute
     * @param options - Execution options
     * @returns Promise resolving to the execution result
     */
    execute(command: string, options?: ExecOptions): Promise<BashResult>;
    /**
     * Spawn a command for streaming execution.
     *
     * @param command - The command to spawn
     * @param args - Command arguments
     * @param options - Spawn options
     * @returns Promise resolving to a spawn handle
     */
    spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>;
    /**
     * Execute a command using the Sandbox SDK.
     */
    private executeViaSandbox;
    /**
     * Spawn a command using Sandbox SDK streaming.
     */
    private spawnViaSandbox;
    /**
     * Spawn a command using Sandbox SDK startProcess.
     */
    private spawnViaProcess;
    /**
     * Execute a command via HTTP exec endpoint.
     */
    private executeViaHttp;
    /**
     * Execute a command via container fetch.
     */
    private executeViaContainer;
    /**
     * Spawn a command via WebSocket connection.
     */
    private spawnViaWebSocket;
    /**
     * Spawn a command by executing and simulating streaming output.
     */
    private spawnViaExec;
    /**
     * Get the current session ID.
     *
     * @returns The session ID
     */
    getSessionId(): string;
    /**
     * Get the current session state.
     *
     * @returns Copy of the session state
     */
    getSessionState(): Omit<SessionState, 'processes'> & {
        processCount: number;
    };
    /**
     * Update the session working directory.
     *
     * @param cwd - New working directory
     */
    setCwd(cwd: string): void;
    /**
     * Update session environment variables.
     *
     * @param env - Environment variables to set
     */
    setEnv(env: Record<string, string>): void;
    /**
     * Unset session environment variables.
     *
     * @param keys - Environment variable keys to unset
     */
    unsetEnv(keys: string[]): void;
    /**
     * Get the number of active processes.
     *
     * @returns Number of active processes
     */
    getActiveProcessCount(): number;
    /**
     * Kill all active processes.
     *
     * @param signal - Signal to send (default: SIGTERM)
     */
    killAll(signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): Promise<void>;
    /**
     * Write a file to the container filesystem.
     *
     * @param path - File path
     * @param content - File content
     */
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
    /**
     * Read a file from the container filesystem.
     *
     * @param path - File path
     * @returns File content
     */
    readFile(path: string): Promise<string | Uint8Array>;
}
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
export declare function createContainerExecutor(options?: ContainerExecutorOptions): CloudflareContainerExecutor;
/**
 * Create an executor from a Sandbox binding.
 *
 * @param sandbox - Cloudflare Sandbox binding
 * @param sessionId - Optional session ID for isolation
 * @returns A new CloudflareContainerExecutor instance
 */
export declare function createSandboxExecutor(sandbox: CloudflareSandbox, sessionId?: string): CloudflareContainerExecutor;
/**
 * Create an executor from an HTTP exec endpoint.
 *
 * @param endpoint - HTTP exec endpoint URL
 * @param sessionId - Optional session ID for isolation
 * @returns A new CloudflareContainerExecutor instance
 */
export declare function createHttpExecutor(endpoint: string, sessionId?: string): CloudflareContainerExecutor;
/**
 * Create an executor from a WebSocket endpoint.
 *
 * @param endpoint - WebSocket endpoint URL
 * @param sessionId - Optional session ID for isolation
 * @returns A new CloudflareContainerExecutor instance
 */
export declare function createWebSocketExecutor(endpoint: string, sessionId?: string): CloudflareContainerExecutor;
/**
 * Check if a value is a CloudflareContainerExecutor instance.
 *
 * @param value - Value to check
 * @returns True if value is a CloudflareContainerExecutor
 */
export declare function isContainerExecutor(value: unknown): value is CloudflareContainerExecutor;
export {};
//# sourceMappingURL=container-executor.d.ts.map