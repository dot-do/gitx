/**
 * @fileoverview BashModule for Durable Object Integration
 *
 * This module provides a BashModule class that integrates with dotdo's $ WorkflowContext,
 * providing $.bash.exec(), $.bash.run(), and bash execution functionality.
 *
 * The module depends on FsModule for file system operations during command execution,
 * enabling sandboxed bash operations within the DO's virtual filesystem.
 *
 * Features:
 * - AST-based safety analysis for command parsing
 * - Configurable command blocking and confirmation requirements
 * - Support for database-backed execution policies
 *
 * @module do/BashModule
 *
 * @example
 * ```typescript
 * import { BashModule } from 'gitx.do/do'
 *
 * class MyDO extends DO {
 *   bash = new BashModule({
 *     executor: myExecutor,
 *     fs: this.$.fs
 *   })
 *
 *   async buildProject() {
 *     const result = await this.bash.exec('npm', ['run', 'build'])
 *     if (result.exitCode !== 0) {
 *       throw new Error(`Build failed: ${result.stderr}`)
 *     }
 *   }
 * }
 * ```
 */
import { type SafetyIssue } from './bash-ast';
/**
 * Filesystem capability interface that BashModule depends on.
 * Mirrors the FsCapability from dotdo's WorkflowContext.
 */
export interface FsCapability {
    readFile(path: string): Promise<string | Buffer>;
    writeFile(path: string, content: string | Buffer): Promise<void>;
    readDir(path: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    rm(path: string, options?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<void>;
}
/**
 * Result of a bash command execution.
 */
export interface BashResult {
    /**
     * The original command that was executed.
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
     * Exit code of the command. 0 typically indicates success.
     */
    exitCode: number;
    /**
     * Whether the command was blocked due to safety concerns.
     */
    blocked?: boolean;
    /**
     * Reason the command was blocked, if applicable.
     */
    blockReason?: string;
}
/**
 * Options for executing bash commands.
 */
export interface ExecOptions {
    /**
     * Maximum execution time in milliseconds.
     * @default 30000
     */
    timeout?: number;
    /**
     * Working directory for command execution.
     */
    cwd?: string;
    /**
     * Environment variables to set for the command.
     */
    env?: Record<string, string>;
    /**
     * Confirm execution of dangerous commands.
     * @default false
     */
    confirm?: boolean;
    /**
     * Run in dry-run mode - analyze without executing.
     * @default false
     */
    dryRun?: boolean;
    /**
     * Provide stdin input for the command.
     */
    stdin?: string;
}
/**
 * Options for streaming command execution.
 */
export interface SpawnOptions extends ExecOptions {
    /**
     * Callback for stdout data chunks.
     */
    onStdout?: (chunk: string) => void;
    /**
     * Callback for stderr data chunks.
     */
    onStderr?: (chunk: string) => void;
    /**
     * Callback when the process exits.
     */
    onExit?: (exitCode: number) => void;
}
/**
 * Handle for a spawned process.
 */
export interface SpawnHandle {
    /**
     * Process ID of the spawned process.
     */
    pid: number;
    /**
     * Promise that resolves when the process exits.
     */
    done: Promise<BashResult>;
    /**
     * Kill the spawned process.
     */
    kill(signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): void;
    /**
     * Write to the process stdin.
     */
    write(data: string): void;
    /**
     * Close stdin to signal end of input.
     */
    closeStdin(): void;
}
/**
 * Interface for external command executors.
 * BashModule delegates actual command execution to an executor.
 */
export interface BashExecutor {
    /**
     * Execute a command and return the result.
     */
    execute(command: string, options?: ExecOptions): Promise<BashResult>;
    /**
     * Spawn a command for streaming execution (optional).
     */
    spawn?(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>;
}
/**
 * Database storage interface for BashModule persistence.
 * Provides access to the exec table for safety settings and policies.
 */
export interface BashStorage {
    /**
     * SQL execution interface.
     */
    sql: {
        /**
         * Execute a SQL query with optional parameters.
         * @param query - SQL query string (can use ? placeholders)
         * @param params - Parameter values for placeholders
         * @returns Result object with toArray() method for reading rows
         */
        exec(query: string, ...params: unknown[]): {
            toArray(): unknown[];
        };
    };
}
/**
 * Row structure for the exec table.
 * Represents an execution policy with safety settings.
 */
export interface ExecRow {
    id: number;
    name: string;
    blocked_commands: string | null;
    require_confirmation: number;
    default_timeout: number;
    default_cwd: string;
    allowed_patterns: string | null;
    denied_patterns: string | null;
    max_concurrent: number;
    enabled: number;
    created_at: number | null;
    updated_at: number | null;
}
/**
 * Execution policy configuration.
 * Used to define and persist execution safety settings.
 */
export interface ExecPolicy {
    /**
     * Unique name for this policy.
     */
    name: string;
    /**
     * List of commands that are blocked from execution.
     */
    blockedCommands: string[];
    /**
     * Whether to require confirmation for dangerous commands.
     * @default true
     */
    requireConfirmation: boolean;
    /**
     * Default timeout for commands in milliseconds.
     * @default 30000
     */
    defaultTimeout: number;
    /**
     * Default working directory for commands.
     * @default '/'
     */
    defaultCwd: string;
    /**
     * Regex patterns for allowed commands.
     * If specified, only matching commands are allowed.
     */
    allowedPatterns?: string[];
    /**
     * Regex patterns for denied commands.
     * Matching commands are blocked regardless of other settings.
     */
    deniedPatterns?: string[];
    /**
     * Maximum number of concurrent executions.
     * @default 5
     */
    maxConcurrent: number;
    /**
     * Whether this policy is enabled.
     * @default true
     */
    enabled: boolean;
}
/**
 * Configuration options for BashModule.
 */
export interface BashModuleOptions {
    /**
     * The executor to use for running commands.
     * Required for actual command execution.
     */
    executor?: BashExecutor;
    /**
     * Filesystem capability for file operations.
     * Used for cwd management and file-based command I/O.
     */
    fs?: FsCapability;
    /**
     * Default working directory for commands.
     * @default '/'
     */
    cwd?: string;
    /**
     * Default timeout for commands in milliseconds.
     * @default 30000
     */
    defaultTimeout?: number;
    /**
     * List of commands that are blocked from execution.
     */
    blockedCommands?: string[];
    /**
     * Whether to require confirmation for dangerous commands.
     * @default true
     */
    requireConfirmation?: boolean;
    /**
     * Database storage for persistent settings.
     * When provided, BashModule will persist settings to the exec table.
     */
    storage?: BashStorage;
    /**
     * Policy name to use when persisting settings.
     * @default 'default'
     */
    policyName?: string;
    /**
     * Whether to use AST-based safety analysis.
     * When true, commands are parsed into an AST for more accurate safety analysis.
     * @default true
     */
    useAST?: boolean;
}
/**
 * Safety level classification for commands.
 * - 'safe': Command can be executed without confirmation
 * - 'dangerous': Command requires confirmation but can be executed with confirm flag
 * - 'critical': Command is ALWAYS blocked regardless of confirmation
 */
export type SafetyLevel = 'safe' | 'dangerous' | 'critical';
/**
 * Safety analysis result for a command.
 */
export interface SafetyAnalysis {
    /**
     * Whether the command is considered dangerous.
     */
    dangerous: boolean;
    /**
     * Safety level classification.
     * - 'safe': Can execute without confirmation
     * - 'dangerous': Requires confirmation (confirm flag allows execution)
     * - 'critical': Always blocked, cannot be executed even with confirmation
     */
    safetyLevel?: SafetyLevel;
    /**
     * Reason for the classification.
     */
    reason?: string;
    /**
     * Commands identified in the input.
     */
    commands: string[];
    /**
     * Impact level of the command.
     */
    impact: 'none' | 'low' | 'medium' | 'high' | 'critical';
    /**
     * Detailed issues found during AST analysis.
     * Only populated when useAST option is true.
     */
    issues?: SafetyIssue[];
    /**
     * Whether AST-based analysis was used.
     */
    usedAST?: boolean;
}
/**
 * BashModule class for integration with dotdo's $ WorkflowContext.
 *
 * @description
 * Provides bash execution functionality as a capability module that integrates
 * with dotdo's Durable Object framework. The module:
 *
 * - Depends on FsModule for file system operations during execution
 * - Delegates actual command execution to a configurable executor
 * - Provides safety analysis and command blocking
 * - Supports both exec (wait for completion) and spawn (streaming) modes
 *
 * @example
 * ```typescript
 * // In a Durable Object
 * class MyDO extends DO {
 *   private bash: BashModule
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *     this.bash = new BashModule({
 *       executor: containerExecutor,
 *       fs: this.$.fs,
 *       cwd: '/app'
 *     })
 *   }
 *
 *   async fetch(request: Request) {
 *     // Execute a command
 *     const result = await this.bash.exec('npm', ['install'])
 *
 *     // Run a script
 *     await this.bash.run(`
 *       set -e
 *       npm run build
 *       npm run test
 *     `)
 *
 *     return new Response('OK')
 *   }
 * }
 * ```
 */
export declare class BashModule {
    /**
     * Capability module name for identification.
     */
    readonly name: "bash";
    /**
     * The executor used for running commands.
     */
    private readonly executor?;
    /**
     * Filesystem capability for file operations.
     */
    private readonly fs?;
    /**
     * Default working directory.
     */
    private defaultCwd;
    /**
     * Default timeout in milliseconds.
     */
    private defaultTimeout;
    /**
     * List of blocked commands.
     */
    private blockedCommands;
    /**
     * Whether to require confirmation for dangerous commands.
     */
    private requireConfirmation;
    /**
     * Database storage for persistence.
     */
    private readonly storage?;
    /**
     * Policy name for database operations.
     */
    private readonly policyName;
    /**
     * Database row ID for this policy.
     */
    private policyId?;
    /**
     * Allowed command patterns (regex).
     */
    private allowedPatterns;
    /**
     * Denied command patterns (regex).
     */
    private deniedPatterns;
    /**
     * Maximum concurrent executions.
     */
    private maxConcurrent;
    /**
     * Whether the policy is enabled.
     */
    private enabled;
    /**
     * Whether to use AST-based safety analysis.
     */
    private readonly useAST;
    /**
     * Commands considered dangerous and requiring confirmation.
     */
    private static readonly DANGEROUS_COMMANDS;
    /**
     * Critical patterns that should ALWAYS be blocked, regardless of confirmation.
     * These patterns represent commands that could cause catastrophic, irreversible damage.
     */
    private static readonly CRITICAL_PATTERNS;
    /**
     * Dangerous flag patterns (require confirmation but can be executed with confirm).
     */
    private static readonly DANGEROUS_PATTERNS;
    /**
     * Create a new BashModule instance.
     *
     * @param options - Configuration options
     *
     * @example
     * ```typescript
     * const bash = new BashModule({
     *   executor: containerExecutor,
     *   fs: workflowContext.fs,
     *   cwd: '/app'
     * })
     * ```
     */
    constructor(options?: BashModuleOptions);
    /**
     * Optional initialization hook.
     * Called when the module is first loaded.
     * When storage is provided, loads or creates the execution policy from the database.
     */
    initialize(): Promise<void>;
    /**
     * Load settings from a database row.
     */
    private loadFromRow;
    /**
     * Persist current policy settings to the database.
     */
    private persistPolicy;
    /**
     * Optional cleanup hook.
     * Called when the capability is unloaded.
     */
    dispose(): Promise<void>;
    /**
     * Check if FsCapability is available.
     *
     * @returns True if FsCapability is configured
     */
    get hasFsCapability(): boolean;
    /**
     * Check if an executor is available.
     *
     * @returns True if an executor is configured
     */
    get hasExecutor(): boolean;
    /**
     * Execute a command and wait for completion.
     *
     * @param command - The command to execute (e.g., 'git', 'npm', 'ls')
     * @param args - Optional array of command arguments
     * @param options - Optional execution options
     * @returns Promise resolving to the execution result
     *
     * @example
     * ```typescript
     * // Simple command
     * const result = await bash.exec('ls')
     *
     * // With arguments
     * const result = await bash.exec('git', ['status', '--short'])
     *
     * // With options
     * const result = await bash.exec('npm', ['install'], {
     *   cwd: '/app',
     *   timeout: 60000
     * })
     * ```
     */
    exec(command: string, args?: string[], options?: ExecOptions): Promise<BashResult>;
    /**
     * Spawn a command for streaming execution.
     *
     * @param command - The command to spawn
     * @param args - Optional array of command arguments
     * @param options - Optional spawn options including stream callbacks
     * @returns Promise resolving to a spawn handle
     *
     * @example
     * ```typescript
     * const handle = await bash.spawn('tail', ['-f', '/var/log/app.log'], {
     *   onStdout: (chunk) => console.log(chunk),
     *   onStderr: (chunk) => console.error(chunk)
     * })
     *
     * // Later, stop the process
     * handle.kill()
     *
     * // Wait for it to finish
     * const result = await handle.done
     * ```
     */
    spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>;
    /**
     * Run a shell script.
     *
     * @param script - The bash script to execute
     * @param options - Optional execution options
     * @returns Promise resolving to the execution result
     *
     * @example
     * ```typescript
     * const result = await bash.run(`
     *   set -e
     *   cd /app
     *   npm install
     *   npm run build
     * `)
     * ```
     */
    run(script: string, options?: ExecOptions): Promise<BashResult>;
    /**
     * Analyze a command for safety.
     *
     * Uses AST-based analysis by default for more accurate command parsing
     * and safety classification. Falls back to regex-based analysis if
     * useAST is disabled.
     *
     * @param input - The command or script to analyze
     * @returns Safety analysis result
     *
     * @example
     * ```typescript
     * const analysis = bash.analyze('rm -rf /')
     * if (analysis.dangerous) {
     *   console.warn(analysis.reason)
     * }
     * ```
     */
    analyze(input: string): SafetyAnalysis;
    /**
     * Analyze a command using AST-based parsing.
     *
     * Parses the command into an AST and inspects nodes for safety issues.
     * This provides more accurate analysis than regex patterns because it
     * understands command structure, arguments, and pipelines.
     *
     * @param input - The command or script to analyze
     * @returns Safety analysis result with AST details
     * @internal
     */
    private analyzeWithAST;
    /**
     * Analyze a command using regex patterns.
     *
     * This is the fallback analysis method when AST parsing is disabled
     * or fails. It uses simple pattern matching.
     *
     * @param input - The command or script to analyze
     * @returns Safety analysis result
     * @internal
     */
    private analyzeWithRegex;
    /**
     * Check if a command is dangerous.
     *
     * @param input - The command to check
     * @returns Object indicating if dangerous and why
     *
     * @example
     * ```typescript
     * const check = bash.isDangerous('rm -rf /')
     * if (check.dangerous) {
     *   console.warn(check.reason)
     * }
     * ```
     */
    isDangerous(input: string): {
        dangerous: boolean;
        reason?: string;
    };
    /**
     * Add a command to the blocked list.
     * Persists the change to the database if storage is configured.
     *
     * @param command - Command to block
     */
    block(command: string): void;
    /**
     * Remove a command from the blocked list.
     * Persists the change to the database if storage is configured.
     *
     * @param command - Command to unblock
     */
    unblock(command: string): void;
    /**
     * Get the list of blocked commands.
     *
     * @returns Array of blocked command names
     */
    getBlockedCommands(): string[];
    /**
     * Get the current execution policy.
     *
     * @returns Current policy configuration
     */
    getPolicy(): ExecPolicy;
    /**
     * Update the execution policy.
     * Persists the changes to the database if storage is configured.
     *
     * @param policy - Partial policy configuration to update
     */
    updatePolicy(policy: Partial<Omit<ExecPolicy, 'name'>>): Promise<void>;
    /**
     * Check if the policy is enabled.
     *
     * @returns True if the policy is enabled
     */
    isEnabled(): boolean;
    /**
     * Check if database storage is available.
     *
     * @returns True if storage is configured
     */
    hasStorage(): boolean;
    /**
     * Extract the base command name from a command string.
     */
    private extractBaseCommand;
    /**
     * Extract all command names from a script.
     */
    private extractCommands;
    /**
     * Escape an argument for safe shell use.
     */
    private escapeArg;
    /**
     * Tagged template literal for safe bash command execution.
     *
     * This method allows using template literal syntax for bash commands with
     * automatic variable interpolation and escaping. Variables are safely
     * escaped to prevent shell injection attacks.
     *
     * @param strings - Template literal string parts
     * @param values - Interpolated values
     * @returns Promise resolving to the execution result
     *
     * @example
     * ```typescript
     * // Simple usage
     * const result = await this.$.bash`ls -la`
     *
     * // With interpolation
     * const dir = '/tmp/my folder'
     * const result = await this.$.bash`ls -la ${dir}`
     *
     * // With multiple variables
     * const src = 'file.txt'
     * const dest = 'backup/file.txt'
     * const result = await this.$.bash`cp ${src} ${dest}`
     * ```
     */
    tag(strings: TemplateStringsArray, ...values: unknown[]): Promise<BashResult>;
    /**
     * Build a command string from template literal parts with safe escaping.
     *
     * @param strings - Template literal string parts
     * @param values - Interpolated values
     * @returns The constructed command string with escaped values
     * @internal
     */
    private buildCommandFromTemplate;
    /**
     * Escape a template literal value for safe shell interpolation.
     *
     * Handles various types of values:
     * - null/undefined: empty string
     * - string: escaped with single quotes if needed
     * - number/boolean: converted to string directly
     * - array: each element escaped and joined with spaces
     * - object: JSON stringified and escaped
     *
     * @param value - The value to escape
     * @returns The escaped string representation
     * @internal
     */
    private escapeTemplateValue;
    /**
     * Escape a string for safe shell use.
     *
     * Uses single-quote escaping which is the safest form of escaping
     * for bash. Single quotes prevent all special character interpretation
     * except for the single quote itself.
     *
     * @param str - The string to escape
     * @returns The escaped string
     * @internal
     */
    private escapeShellString;
}
/**
 * Create a BashModule instance with the given options.
 *
 * @param options - Configuration options for the module
 * @returns A new BashModule instance
 *
 * @example
 * ```typescript
 * import { createBashModule } from 'gitx.do/do'
 *
 * const bash = createBashModule({
 *   executor: containerExecutor,
 *   fs: workflowContext.fs,
 *   cwd: '/app'
 * })
 * ```
 */
export declare function createBashModule(options?: BashModuleOptions): BashModule;
/**
 * Tagged template function signature for bash commands.
 *
 * @example
 * ```typescript
 * const result = await bash`ls -la ${dir}`
 * ```
 */
export interface BashTagFunction {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<BashResult>;
}
/**
 * A BashModule that can also be called directly as a tagged template literal.
 *
 * This type represents a BashModule instance that has been wrapped with
 * a Proxy to enable both direct method calls and tagged template syntax.
 *
 * @example
 * ```typescript
 * // Create a callable bash module
 * const bash = createCallableBashModule({ executor })
 *
 * // Use as tagged template
 * const result = await bash`ls -la ${dir}`
 *
 * // Use as regular module
 * const result2 = await bash.exec('git', ['status'])
 * ```
 */
export type CallableBashModule = BashModule & BashTagFunction;
/**
 * Create a callable BashModule instance that supports tagged template literals.
 *
 * This factory creates a BashModule wrapped in a Proxy that allows both:
 * - Standard method calls: `bash.exec('ls', ['-la'])`
 * - Tagged template syntax: `bash\`ls -la ${dir}\``
 *
 * The tagged template syntax automatically escapes interpolated values
 * to prevent shell injection attacks.
 *
 * @param options - Configuration options for the module
 * @returns A callable BashModule instance
 *
 * @example
 * ```typescript
 * import { createCallableBashModule } from 'gitx.do/do'
 *
 * // In a Durable Object
 * class MyDO extends DO {
 *   bash = createCallableBashModule({
 *     executor: containerExecutor,
 *     fs: this.$.fs,
 *     cwd: '/app'
 *   })
 *
 *   async listFiles(dir: string) {
 *     // Use tagged template syntax
 *     const result = await this.bash`ls -la ${dir}`
 *     return result.stdout
 *   }
 *
 *   async runWithArgs() {
 *     // Or use regular methods
 *     const result = await this.bash.exec('npm', ['install'])
 *     return result
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Handle special characters safely
 * const filename = "file with 'quotes' and spaces"
 * const result = await bash`cat ${filename}`
 * // Executes: cat 'file with '\''quotes'\'' and spaces'
 * ```
 */
export declare function createCallableBashModule(options?: BashModuleOptions): CallableBashModule;
/**
 * Check if a value is a BashModule instance.
 *
 * @param value - Value to check
 * @returns True if value is a BashModule
 */
export declare function isBashModule(value: unknown): value is BashModule;
/**
 * Check if a value is a CallableBashModule.
 *
 * @param value - Value to check
 * @returns True if value is a CallableBashModule
 */
export declare function isCallableBashModule(value: unknown): value is CallableBashModule;
//# sourceMappingURL=BashModule.d.ts.map