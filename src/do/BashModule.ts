/**
 * @fileoverview BashModule for Durable Object Integration
 *
 * This module provides a BashModule class that integrates with dotdo's $ WorkflowContext,
 * providing $.bash.exec(), $.bash.run(), and bash execution functionality.
 *
 * The module depends on FsModule for file system operations during command execution,
 * enabling sandboxed bash operations within the DO's virtual filesystem.
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
  private readonly defaultCwd: string

  /**
   * Default timeout in milliseconds.
   */
  private readonly defaultTimeout: number

  /**
   * List of blocked commands.
   */
  private readonly blockedCommands: Set<string>

  /**
   * Whether to require confirmation for dangerous commands.
   */
  private readonly requireConfirmation: boolean

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
  }

  /**
   * Optional initialization hook.
   * Called when the module is first loaded.
   */
  async initialize(): Promise<void> {
    // Initialization logic if needed
    // For example, verify executor connectivity
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
      impact
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
   *
   * @param command - Command to block
   */
  block(command: string): void {
    this.blockedCommands.add(command)
  }

  /**
   * Remove a command from the blocked list.
   *
   * @param command - Command to unblock
   */
  unblock(command: string): void {
    this.blockedCommands.delete(command)
  }

  /**
   * Get the list of blocked commands.
   *
   * @returns Array of blocked command names
   */
  getBlockedCommands(): string[] {
    return Array.from(this.blockedCommands)
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
