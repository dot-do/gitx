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

// Import AST-based safety analysis
import {
  parseBashCommand,
  analyzeASTSafety,
  type SafetyIssue,
} from './bash-ast'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Filesystem capability interface that BashModule depends on.
 * Mirrors the FsCapability from dotdo's WorkflowContext.
 */
export interface FsCapability {
  readFile(path: string): Promise<string | Buffer>
  writeFile(path: string, content: string | Buffer): Promise<void>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}

/**
 * Result of a bash command execution.
 */
export interface BashResult {
  /**
   * The original command that was executed.
   */
  command: string

  /**
   * Standard output from the command.
   */
  stdout: string

  /**
   * Standard error from the command.
   */
  stderr: string

  /**
   * Exit code of the command. 0 typically indicates success.
   */
  exitCode: number

  /**
   * Whether the command was blocked due to safety concerns.
   */
  blocked?: boolean

  /**
   * Reason the command was blocked, if applicable.
   */
  blockReason?: string
}

/**
 * Options for executing bash commands.
 */
export interface ExecOptions {
  /**
   * Maximum execution time in milliseconds.
   * @default 30000
   */
  timeout?: number

  /**
   * Working directory for command execution.
   */
  cwd?: string

  /**
   * Environment variables to set for the command.
   */
  env?: Record<string, string>

  /**
   * Confirm execution of dangerous commands.
   * @default false
   */
  confirm?: boolean

  /**
   * Run in dry-run mode - analyze without executing.
   * @default false
   */
  dryRun?: boolean

  /**
   * Provide stdin input for the command.
   */
  stdin?: string
}

/**
 * Options for streaming command execution.
 */
export interface SpawnOptions extends ExecOptions {
  /**
   * Callback for stdout data chunks.
   */
  onStdout?: (chunk: string) => void

  /**
   * Callback for stderr data chunks.
   */
  onStderr?: (chunk: string) => void

  /**
   * Callback when the process exits.
   */
  onExit?: (exitCode: number) => void
}

/**
 * Handle for a spawned process.
 */
export interface SpawnHandle {
  /**
   * Process ID of the spawned process.
   */
  pid: number

  /**
   * Promise that resolves when the process exits.
   */
  done: Promise<BashResult>

  /**
   * Kill the spawned process.
   */
  kill(signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): void

  /**
   * Write to the process stdin.
   */
  write(data: string): void

  /**
   * Close stdin to signal end of input.
   */
  closeStdin(): void
}

/**
 * Interface for external command executors.
 * BashModule delegates actual command execution to an executor.
 */
export interface BashExecutor {
  /**
   * Execute a command and return the result.
   */
  execute(command: string, options?: ExecOptions): Promise<BashResult>

  /**
   * Spawn a command for streaming execution (optional).
   */
  spawn?(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>
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
    exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
  }
}

/**
 * Row structure for the exec table.
 * Represents an execution policy with safety settings.
 */
export interface ExecRow {
  id: number
  name: string
  blocked_commands: string | null
  require_confirmation: number
  default_timeout: number
  default_cwd: string
  allowed_patterns: string | null
  denied_patterns: string | null
  max_concurrent: number
  enabled: number
  created_at: number | null
  updated_at: number | null
}

/**
 * Execution policy configuration.
 * Used to define and persist execution safety settings.
 */
export interface ExecPolicy {
  /**
   * Unique name for this policy.
   */
  name: string

  /**
   * List of commands that are blocked from execution.
   */
  blockedCommands: string[]

  /**
   * Whether to require confirmation for dangerous commands.
   * @default true
   */
  requireConfirmation: boolean

  /**
   * Default timeout for commands in milliseconds.
   * @default 30000
   */
  defaultTimeout: number

  /**
   * Default working directory for commands.
   * @default '/'
   */
  defaultCwd: string

  /**
   * Regex patterns for allowed commands.
   * If specified, only matching commands are allowed.
   */
  allowedPatterns?: string[]

  /**
   * Regex patterns for denied commands.
   * Matching commands are blocked regardless of other settings.
   */
  deniedPatterns?: string[]

  /**
   * Maximum number of concurrent executions.
   * @default 5
   */
  maxConcurrent: number

  /**
   * Whether this policy is enabled.
   * @default true
   */
  enabled: boolean
}

/**
 * Configuration options for BashModule.
 */
export interface BashModuleOptions {
  /**
   * The executor to use for running commands.
   * Required for actual command execution.
   */
  executor?: BashExecutor

  /**
   * Filesystem capability for file operations.
   * Used for cwd management and file-based command I/O.
   */
  fs?: FsCapability

  /**
   * Default working directory for commands.
   * @default '/'
   */
  cwd?: string

  /**
   * Default timeout for commands in milliseconds.
   * @default 30000
   */
  defaultTimeout?: number

  /**
   * List of commands that are blocked from execution.
   */
  blockedCommands?: string[]

  /**
   * Whether to require confirmation for dangerous commands.
   * @default true
   */
  requireConfirmation?: boolean

  /**
   * Database storage for persistent settings.
   * When provided, BashModule will persist settings to the exec table.
   */
  storage?: BashStorage

  /**
   * Policy name to use when persisting settings.
   * @default 'default'
   */
  policyName?: string

  /**
   * Whether to use AST-based safety analysis.
   * When true, commands are parsed into an AST for more accurate safety analysis.
   * @default true
   */
  useAST?: boolean
}

/**
 * Safety analysis result for a command.
 */
export interface SafetyAnalysis {
  /**
   * Whether the command is considered dangerous.
   */
  dangerous: boolean

  /**
   * Reason for the classification.
   */
  reason?: string

  /**
   * Commands identified in the input.
   */
  commands: string[]

  /**
   * Impact level of the command.
   */
  impact: 'none' | 'low' | 'medium' | 'high' | 'critical'

  /**
   * Detailed issues found during AST analysis.
   * Only populated when useAST option is true.
   */
  issues?: SafetyIssue[]

  /**
   * Whether AST-based analysis was used.
   */
  usedAST?: boolean
}

// ============================================================================
// BashModule Class
// ============================================================================

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
export class BashModule {
  /**
   * Capability module name for identification.
   */
  readonly name = 'bash' as const

  /**
   * The executor used for running commands.
   */
  private readonly executor?: BashExecutor

  /**
   * Filesystem capability for file operations.
   */
  private readonly fs?: FsCapability

  /**
   * Default working directory.
   */
  private defaultCwd: string

  /**
   * Default timeout in milliseconds.
   */
  private defaultTimeout: number

  /**
   * List of blocked commands.
   */
  private blockedCommands: Set<string>

  /**
   * Whether to require confirmation for dangerous commands.
   */
  private requireConfirmation: boolean

  /**
   * Database storage for persistence.
   */
  private readonly storage?: BashStorage

  /**
   * Policy name for database operations.
   */
  private readonly policyName: string

  /**
   * Database row ID for this policy.
   */
  private policyId?: number

  /**
   * Allowed command patterns (regex).
   */
  private allowedPatterns: RegExp[] = []

  /**
   * Denied command patterns (regex).
   */
  private deniedPatterns: RegExp[] = []

  /**
   * Maximum concurrent executions.
   */
  private maxConcurrent: number = 5

  /**
   * Whether the policy is enabled.
   */
  private enabled: boolean = true

  /**
   * Whether to use AST-based safety analysis.
   */
  private readonly useAST: boolean

  /**
   * Commands considered dangerous and requiring confirmation.
   */
  private static readonly DANGEROUS_COMMANDS = new Set([
    'rm',
    'rmdir',
    'dd',
    'mkfs',
    'fdisk',
    'format',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'init',
    'kill',
    'killall',
    'pkill',
    'chmod',
    'chown',
    'chgrp',
    'mount',
    'umount',
    'mkswap',
    'swapon',
    'swapoff',
  ])

  /**
   * Dangerous flag patterns.
   */
  private static readonly DANGEROUS_PATTERNS = [
    /rm\s+(-[rf]+\s+)*\//,           // rm with root path
    /rm\s+(-[rf]+\s+)*\*/,           // rm with wildcard
    />\s*\/dev\//,                   // redirect to device
    /dd\s+.*of=\/dev/,               // dd to device
    /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,  // fork bomb
    /chmod\s+777/,                   // overly permissive chmod
    /curl.*\|\s*(ba)?sh/,            // pipe curl to shell
    /wget.*\|\s*(ba)?sh/,            // pipe wget to shell
  ]

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
  constructor(options: BashModuleOptions = {}) {
    this.executor = options.executor
    this.fs = options.fs
    this.defaultCwd = options.cwd ?? '/'
    this.defaultTimeout = options.defaultTimeout ?? 30000
    this.blockedCommands = new Set(options.blockedCommands ?? [])
    this.requireConfirmation = options.requireConfirmation ?? true
    this.storage = options.storage
    this.policyName = options.policyName ?? 'default'
    this.useAST = options.useAST ?? true
  }

  /**
   * Optional initialization hook.
   * Called when the module is first loaded.
   * When storage is provided, loads or creates the execution policy from the database.
   */
  async initialize(): Promise<void> {
    if (!this.storage) return

    // Try to load existing policy
    const existingRows = this.storage.sql.exec(
      'SELECT * FROM exec WHERE name = ?',
      this.policyName
    ).toArray() as ExecRow[]

    if (existingRows.length > 0) {
      // Load existing settings
      const row = existingRows[0]
      this.policyId = row.id
      this.loadFromRow(row)
    } else {
      // Create new policy with current settings
      await this.persistPolicy()
    }
  }

  /**
   * Load settings from a database row.
   */
  private loadFromRow(row: ExecRow): void {
    // Parse blocked commands from JSON string
    if (row.blocked_commands) {
      try {
        const commands = JSON.parse(row.blocked_commands) as string[]
        this.blockedCommands = new Set(commands)
      } catch {
        this.blockedCommands = new Set()
      }
    }

    this.requireConfirmation = row.require_confirmation === 1
    this.defaultTimeout = row.default_timeout
    this.defaultCwd = row.default_cwd
    this.maxConcurrent = row.max_concurrent
    this.enabled = row.enabled === 1

    // Parse allowed patterns
    if (row.allowed_patterns) {
      try {
        const patterns = JSON.parse(row.allowed_patterns) as string[]
        this.allowedPatterns = patterns.map(p => new RegExp(p))
      } catch {
        this.allowedPatterns = []
      }
    }

    // Parse denied patterns
    if (row.denied_patterns) {
      try {
        const patterns = JSON.parse(row.denied_patterns) as string[]
        this.deniedPatterns = patterns.map(p => new RegExp(p))
      } catch {
        this.deniedPatterns = []
      }
    }
  }

  /**
   * Persist current policy settings to the database.
   */
  private async persistPolicy(): Promise<void> {
    if (!this.storage) return

    const now = Date.now()
    const blockedCommandsJson = JSON.stringify(Array.from(this.blockedCommands))
    const allowedPatternsJson = this.allowedPatterns.length > 0
      ? JSON.stringify(this.allowedPatterns.map(p => p.source))
      : null
    const deniedPatternsJson = this.deniedPatterns.length > 0
      ? JSON.stringify(this.deniedPatterns.map(p => p.source))
      : null

    if (this.policyId) {
      // Update existing policy
      this.storage.sql.exec(
        `UPDATE exec SET
          blocked_commands = ?,
          require_confirmation = ?,
          default_timeout = ?,
          default_cwd = ?,
          allowed_patterns = ?,
          denied_patterns = ?,
          max_concurrent = ?,
          enabled = ?,
          updated_at = ?
        WHERE id = ?`,
        blockedCommandsJson,
        this.requireConfirmation ? 1 : 0,
        this.defaultTimeout,
        this.defaultCwd,
        allowedPatternsJson,
        deniedPatternsJson,
        this.maxConcurrent,
        this.enabled ? 1 : 0,
        now,
        this.policyId
      )
    } else {
      // Insert new policy
      this.storage.sql.exec(
        `INSERT INTO exec (
          name, blocked_commands, require_confirmation, default_timeout,
          default_cwd, allowed_patterns, denied_patterns, max_concurrent,
          enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        this.policyName,
        blockedCommandsJson,
        this.requireConfirmation ? 1 : 0,
        this.defaultTimeout,
        this.defaultCwd,
        allowedPatternsJson,
        deniedPatternsJson,
        this.maxConcurrent,
        this.enabled ? 1 : 0,
        now,
        now
      )

      // Get the inserted row ID
      const insertedRows = this.storage.sql.exec(
        'SELECT id FROM exec WHERE name = ?',
        this.policyName
      ).toArray() as Pick<ExecRow, 'id'>[]

      if (insertedRows.length > 0) {
        this.policyId = insertedRows[0].id
      }
    }
  }

  /**
   * Optional cleanup hook.
   * Called when the capability is unloaded.
   */
  async dispose(): Promise<void> {
    // Cleanup logic if needed
  }

  /**
   * Check if FsCapability is available.
   *
   * @returns True if FsCapability is configured
   */
  get hasFsCapability(): boolean {
    return this.fs !== undefined
  }

  /**
   * Check if an executor is available.
   *
   * @returns True if an executor is configured
   */
  get hasExecutor(): boolean {
    return this.executor !== undefined
  }

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
  async exec(command: string, args?: string[], options?: ExecOptions): Promise<BashResult> {
    // Build full command string
    const fullCommand = args && args.length > 0
      ? `${command} ${args.map(a => this.escapeArg(a)).join(' ')}`
      : command

    // Check if command is blocked
    const baseCommand = this.extractBaseCommand(command)
    if (this.blockedCommands.has(baseCommand)) {
      return {
        command: fullCommand,
        stdout: '',
        stderr: `Command '${baseCommand}' is blocked`,
        exitCode: 1,
        blocked: true,
        blockReason: `Command '${baseCommand}' is in the blocked list`
      }
    }

    // Check safety
    const safety = this.analyze(fullCommand)
    if (safety.dangerous && this.requireConfirmation && !options?.confirm) {
      return {
        command: fullCommand,
        stdout: '',
        stderr: safety.reason ?? 'Command requires confirmation',
        exitCode: 1,
        blocked: true,
        blockReason: safety.reason ?? 'Dangerous command requires confirmation'
      }
    }

    // Dry run mode
    if (options?.dryRun) {
      return {
        command: fullCommand,
        stdout: `[dry-run] Would execute: ${fullCommand}`,
        stderr: '',
        exitCode: 0
      }
    }

    // Check for executor
    if (!this.executor) {
      return {
        command: fullCommand,
        stdout: '',
        stderr: 'No executor configured',
        exitCode: 1
      }
    }

    // Merge options with defaults
    const execOptions: ExecOptions = {
      timeout: this.defaultTimeout,
      cwd: this.defaultCwd,
      ...options
    }

    // Execute the command
    try {
      return await this.executor.execute(fullCommand, execOptions)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        command: fullCommand,
        stdout: '',
        stderr: errorMessage,
        exitCode: 1
      }
    }
  }

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
  async spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle> {
    if (!this.executor?.spawn) {
      throw new Error('Spawn not supported by this executor')
    }

    // Check if command is blocked
    const baseCommand = this.extractBaseCommand(command)
    if (this.blockedCommands.has(baseCommand)) {
      throw new Error(`Command '${baseCommand}' is blocked`)
    }

    // Check safety
    const fullCommand = args && args.length > 0
      ? `${command} ${args.join(' ')}`
      : command
    const safety = this.analyze(fullCommand)
    if (safety.dangerous && this.requireConfirmation && !options?.confirm) {
      throw new Error(safety.reason ?? 'Dangerous command requires confirmation')
    }

    return this.executor.spawn(command, args, options)
  }

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
  async run(script: string, options?: ExecOptions): Promise<BashResult> {
    // Dry run mode
    if (options?.dryRun) {
      return {
        command: script,
        stdout: `[dry-run] Would execute script:\n${script}`,
        stderr: '',
        exitCode: 0
      }
    }

    // Check for executor
    if (!this.executor) {
      return {
        command: script,
        stdout: '',
        stderr: 'No executor configured',
        exitCode: 1
      }
    }

    // Analyze script safety
    const safety = this.analyze(script)
    if (safety.dangerous && this.requireConfirmation && !options?.confirm) {
      return {
        command: script,
        stdout: '',
        stderr: safety.reason ?? 'Script requires confirmation',
        exitCode: 1,
        blocked: true,
        blockReason: safety.reason ?? 'Dangerous script requires confirmation'
      }
    }

    // Execute the script
    const execOptions: ExecOptions = {
      timeout: this.defaultTimeout,
      cwd: this.defaultCwd,
      ...options
    }

    try {
      return await this.executor.execute(script, execOptions)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        command: script,
        stdout: '',
        stderr: errorMessage,
        exitCode: 1
      }
    }
  }

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
  analyze(input: string): SafetyAnalysis {
    // Use AST-based analysis if enabled
    if (this.useAST) {
      return this.analyzeWithAST(input)
    }

    // Fall back to regex-based analysis
    return this.analyzeWithRegex(input)
  }

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
  private analyzeWithAST(input: string): SafetyAnalysis {
    try {
      const ast = parseBashCommand(input)
      const astAnalysis = analyzeASTSafety(ast, this.blockedCommands, input)

      return {
        dangerous: astAnalysis.dangerous,
        reason: astAnalysis.reason,
        commands: astAnalysis.commands,
        impact: astAnalysis.impact,
        issues: astAnalysis.issues,
        usedAST: true,
      }
    } catch {
      // If AST parsing fails, fall back to regex analysis
      return this.analyzeWithRegex(input)
    }
  }

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
  private analyzeWithRegex(input: string): SafetyAnalysis {
    const commands = this.extractCommands(input)
    let dangerous = false
    let reason: string | undefined
    let impact: SafetyAnalysis['impact'] = 'none'

    // Check for blocked commands (highest priority)
    for (const cmd of commands) {
      if (this.blockedCommands.has(cmd)) {
        dangerous = true
        reason = `Command '${cmd}' is blocked`
        impact = 'critical'
        break
      }
    }

    // Check for dangerous patterns (critical impact - check before DANGEROUS_COMMANDS)
    if (!dangerous) {
      for (const pattern of BashModule.DANGEROUS_PATTERNS) {
        if (pattern.test(input)) {
          dangerous = true
          reason = `Command matches dangerous pattern: ${pattern.source}`
          impact = 'critical'
          break
        }
      }
    }

    // Check for dangerous commands (high impact)
    if (!dangerous) {
      for (const cmd of commands) {
        if (BashModule.DANGEROUS_COMMANDS.has(cmd)) {
          dangerous = true
          reason = `Command '${cmd}' is potentially dangerous`
          impact = 'high'
          break
        }
      }
    }

    // Determine impact based on commands
    if (!dangerous) {
      if (commands.some(c => ['cat', 'ls', 'pwd', 'echo', 'head', 'tail', 'wc'].includes(c))) {
        impact = 'none'
      } else if (commands.some(c => ['touch', 'mkdir', 'cp'].includes(c))) {
        impact = 'low'
      } else if (commands.some(c => ['mv', 'sed', 'awk'].includes(c))) {
        impact = 'medium'
      }
    }

    return {
      dangerous,
      reason,
      commands,
      impact,
      usedAST: false,
    }
  }

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
  isDangerous(input: string): { dangerous: boolean; reason?: string } {
    const analysis = this.analyze(input)
    return {
      dangerous: analysis.dangerous,
      reason: analysis.reason
    }
  }

  /**
   * Add a command to the blocked list.
   * Persists the change to the database if storage is configured.
   *
   * @param command - Command to block
   */
  block(command: string): void {
    this.blockedCommands.add(command)
    // Persist to database asynchronously
    this.persistPolicy().catch(() => {
      // Silently ignore persistence errors
    })
  }

  /**
   * Remove a command from the blocked list.
   * Persists the change to the database if storage is configured.
   *
   * @param command - Command to unblock
   */
  unblock(command: string): void {
    this.blockedCommands.delete(command)
    // Persist to database asynchronously
    this.persistPolicy().catch(() => {
      // Silently ignore persistence errors
    })
  }

  /**
   * Get the list of blocked commands.
   *
   * @returns Array of blocked command names
   */
  getBlockedCommands(): string[] {
    return Array.from(this.blockedCommands)
  }

  /**
   * Get the current execution policy.
   *
   * @returns Current policy configuration
   */
  getPolicy(): ExecPolicy {
    return {
      name: this.policyName,
      blockedCommands: Array.from(this.blockedCommands),
      requireConfirmation: this.requireConfirmation,
      defaultTimeout: this.defaultTimeout,
      defaultCwd: this.defaultCwd,
      allowedPatterns: this.allowedPatterns.map(p => p.source),
      deniedPatterns: this.deniedPatterns.map(p => p.source),
      maxConcurrent: this.maxConcurrent,
      enabled: this.enabled
    }
  }

  /**
   * Update the execution policy.
   * Persists the changes to the database if storage is configured.
   *
   * @param policy - Partial policy configuration to update
   */
  async updatePolicy(policy: Partial<Omit<ExecPolicy, 'name'>>): Promise<void> {
    if (policy.blockedCommands !== undefined) {
      this.blockedCommands = new Set(policy.blockedCommands)
    }
    if (policy.requireConfirmation !== undefined) {
      this.requireConfirmation = policy.requireConfirmation
    }
    if (policy.defaultTimeout !== undefined) {
      this.defaultTimeout = policy.defaultTimeout
    }
    if (policy.defaultCwd !== undefined) {
      this.defaultCwd = policy.defaultCwd
    }
    if (policy.allowedPatterns !== undefined) {
      this.allowedPatterns = policy.allowedPatterns.map(p => new RegExp(p))
    }
    if (policy.deniedPatterns !== undefined) {
      this.deniedPatterns = policy.deniedPatterns.map(p => new RegExp(p))
    }
    if (policy.maxConcurrent !== undefined) {
      this.maxConcurrent = policy.maxConcurrent
    }
    if (policy.enabled !== undefined) {
      this.enabled = policy.enabled
    }

    await this.persistPolicy()
  }

  /**
   * Check if the policy is enabled.
   *
   * @returns True if the policy is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Check if database storage is available.
   *
   * @returns True if storage is configured
   */
  hasStorage(): boolean {
    return this.storage !== undefined
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Extract the base command name from a command string.
   */
  private extractBaseCommand(command: string): string {
    const parts = command.trim().split(/\s+/)
    const first = parts[0] ?? ''
    // Handle paths like /usr/bin/rm
    const name = first.split('/').pop() ?? first
    return name
  }

  /**
   * Extract all command names from a script.
   */
  private extractCommands(input: string): string[] {
    const commands: string[] = []

    // Split by common separators
    const segments = input.split(/[;&|]+/)

    for (const segment of segments) {
      const trimmed = segment.trim()
      if (!trimmed) continue

      // Skip comments
      if (trimmed.startsWith('#')) continue

      // Get the first word
      const match = trimmed.match(/^(\S+)/)
      if (match) {
        const cmd = match[1]
        // Handle paths
        const name = cmd.split('/').pop() ?? cmd
        // Skip shell keywords
        if (!['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'function'].includes(name)) {
          commands.push(name)
        }
      }
    }

    return commands
  }

  /**
   * Escape an argument for safe shell use.
   */
  private escapeArg(arg: string): string {
    // If the argument contains no special characters, return as-is
    if (/^[a-zA-Z0-9._\-/=]+$/.test(arg)) {
      return arg
    }
    // Otherwise, single-quote escape
    return `'${arg.replace(/'/g, "'\\''")}'`
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tagged Template Literal Support
  // ═══════════════════════════════════════════════════════════════════════════

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
  tag(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<BashResult> {
    const command = this.buildCommandFromTemplate(strings, values)
    return this.run(command)
  }

  /**
   * Build a command string from template literal parts with safe escaping.
   *
   * @param strings - Template literal string parts
   * @param values - Interpolated values
   * @returns The constructed command string with escaped values
   * @internal
   */
  private buildCommandFromTemplate(
    strings: TemplateStringsArray,
    values: unknown[]
  ): string {
    let result = ''

    for (let i = 0; i < strings.length; i++) {
      result += strings[i]

      if (i < values.length) {
        const value = values[i]
        result += this.escapeTemplateValue(value)
      }
    }

    return result
  }

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
  private escapeTemplateValue(value: unknown): string {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return ''
    }

    // Handle numbers and booleans - safe to use directly
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }

    // Handle arrays - escape each element and join
    if (Array.isArray(value)) {
      return value.map(v => this.escapeTemplateValue(v)).join(' ')
    }

    // Handle objects (except arrays) - JSON stringify and escape
    if (typeof value === 'object') {
      return this.escapeShellString(JSON.stringify(value))
    }

    // Handle strings
    return this.escapeShellString(String(value))
  }

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
  private escapeShellString(str: string): string {
    // If the string is empty, return empty quoted string
    if (str === '') {
      return "''"
    }

    // If the string contains no special characters, return as-is
    // This is more readable for simple cases like file paths without spaces
    if (/^[a-zA-Z0-9._\-/=@:]+$/.test(str)) {
      return str
    }

    // Otherwise, use single-quote escaping
    // Single quotes prevent all interpretation except ' itself
    // To include a single quote, we end the quoted string, add an escaped quote, and start a new quoted string
    // 'It'\''s' -> It's
    return `'${str.replace(/'/g, "'\\''")}'`
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

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
export function createBashModule(options: BashModuleOptions = {}): BashModule {
  return new BashModule(options)
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a BashModule instance.
 *
 * @param value - Value to check
 * @returns True if value is a BashModule
 */
export function isBashModule(value: unknown): value is BashModule {
  return value instanceof BashModule
}
