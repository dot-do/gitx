// CLI Entry Point for gitx
import cac from 'cac'
import { existsSync } from 'fs'
import { resolve } from 'path'

// ============================================================================
// Types
// ============================================================================

export interface CLIOptions {
  cwd?: string
  stdout?: (msg: string) => void
  stderr?: (msg: string) => void
}

export interface CLIResult {
  exitCode: number
  command?: string
  error?: Error
}

export interface ParsedArgs {
  command?: string
  args: string[]
  options: Record<string, any>
  rawArgs: string[]
  cwd: string
}

export interface CommandContext {
  cwd: string
  args: string[]
  options: Record<string, any>
  rawArgs: string[]
  stdout: (msg: string) => void
  stderr: (msg: string) => void
}

type CommandHandler = (ctx: CommandContext) => void | Promise<void>

// ============================================================================
// Constants
// ============================================================================

const SUBCOMMANDS = ['status', 'diff', 'log', 'blame', 'commit', 'branch', 'review', 'web'] as const
const VERSION = '0.0.1'
const NAME = 'gitx'

// ============================================================================
// CLI Class
// ============================================================================

export class CLI {
  public name: string
  public version: string
  private handlers: Map<string, CommandHandler> = new Map()
  private stdout: (msg: string) => void
  private stderr: (msg: string) => void

  constructor(options: { name?: string; version?: string; stdout?: (msg: string) => void; stderr?: (msg: string) => void } = {}) {
    this.name = options.name ?? NAME
    this.version = options.version ?? VERSION
    this.stdout = options.stdout ?? console.log
    this.stderr = options.stderr ?? console.error
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.handlers.set(name, handler)
  }

  async run(args: string[], options: { skipCwdCheck?: boolean } = {}): Promise<CLIResult> {
    const parsed = parseArgs(args)

    // Check for help flag
    if (parsed.options.help || parsed.options.h) {
      if (parsed.command) {
        this.stdout(this.getSubcommandHelp(parsed.command))
      } else {
        this.stdout(this.getHelp())
      }
      return { exitCode: 0, command: parsed.command }
    }

    // Check for version flag
    if (parsed.options.version || parsed.options.v) {
      this.stdout(`${this.name} ${this.version}`)
      return { exitCode: 0 }
    }

    // Check for unknown flags (flags starting with -- that aren't recognized)
    const knownFlags = ['cwd', 'C', 'help', 'h', 'version', 'v', 'short', 'branch', 'staged',
      'cached', 'n', 'oneline', 'graph', 'all', 'format', 'L', 'm', 'amend', 'a', 'd', 'list',
      'interactive', 'port', 'open']
    for (const key of Object.keys(parsed.options)) {
      if (!knownFlags.includes(key) && key !== '--') {
        this.stderr(`Unknown option: --${key}\nRun 'gitx --help' for available commands.`)
        return { exitCode: 1, error: new Error(`Unknown option: --${key}`) }
      }
    }

    // If no command, show help
    if (!parsed.command) {
      this.stdout(this.getHelp())
      return { exitCode: 0 }
    }

    // Check if command exists
    if (!SUBCOMMANDS.includes(parsed.command as any) && !this.handlers.has(parsed.command)) {
      const suggestion = this.suggestCommand(parsed.command)
      let errorMsg = `Unknown command: ${parsed.command}`
      if (suggestion) {
        errorMsg += `\nDid you mean '${suggestion}'?`
      }
      errorMsg += `\nRun 'gitx --help' for available commands.`
      this.stderr(errorMsg)
      return { exitCode: 1, command: parsed.command, error: new Error(`Unknown command: ${parsed.command}`) }
    }

    // Execute command handler if registered
    const handler = this.handlers.get(parsed.command)
    if (handler) {
      try {
        await handler({
          cwd: parsed.cwd,
          args: parsed.args,
          options: parsed.options,
          rawArgs: parsed.rawArgs,
          stdout: this.stdout,
          stderr: this.stderr
        })
        return { exitCode: 0, command: parsed.command }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.stderr(`Error: ${error.message}`)
        return { exitCode: 1, command: parsed.command, error }
      }
    }

    // Check if --cwd directory exists (only for built-in commands without handlers)
    if (parsed.cwd !== process.cwd() && !options.skipCwdCheck) {
      if (!existsSync(parsed.cwd)) {
        this.stderr(`Error: directory does not exist: ${parsed.cwd}`)
        return { exitCode: 1, command: parsed.command, error: new Error(`directory does not exist: ${parsed.cwd}`) }
      }
    }

    // Default behavior for built-in commands without handler
    return { exitCode: 0, command: parsed.command }
  }

  private getHelp(): string {
    return `${this.name} v${this.version}

Usage: ${this.name} [options] <command> [args...]

Commands:
  status    Show the working tree status
  diff      Show changes between commits
  log       Show commit logs
  blame     Show what revision and author last modified each line
  commit    Record changes to the repository
  branch    List, create, or delete branches
  review    Review pull requests
  web       Start the web interface

Options:
  -h, --help     Show help
  -v, --version  Show version
  -C, --cwd      Set the working directory`
  }

  private getSubcommandHelp(command: string): string {
    const descriptions: Record<string, string> = {
      status: 'Show the working tree status',
      diff: 'Show changes between commits',
      log: 'Show commit logs',
      blame: 'Show what revision and author last modified each line',
      commit: 'Record changes to the repository',
      branch: 'List, create, or delete branches',
      review: 'Review pull requests',
      web: 'Start the web interface'
    }

    return `${this.name} ${command}

${descriptions[command] || 'Command help'}

Usage: ${this.name} ${command} [options] [args...]`
  }

  private suggestCommand(input: string): string | null {
    // Simple Levenshtein distance for typo detection
    let minDistance = Infinity
    let suggestion: string | null = null

    for (const cmd of SUBCOMMANDS) {
      const distance = levenshteinDistance(input, cmd)
      if (distance < minDistance && distance <= 3) {
        minDistance = distance
        suggestion = cmd
      }
    }

    return suggestion
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

// ============================================================================
// Exported Functions
// ============================================================================

export function createCLI(options: { name?: string; version?: string; stdout?: (msg: string) => void; stderr?: (msg: string) => void } = {}): CLI {
  return new CLI(options)
}

export function parseArgs(args: string[]): ParsedArgs {
  const cli = cac('gitx')

  // Global options
  cli.option('-C, --cwd <path>', 'Set the working directory')
  cli.option('-h, --help', 'Show help')
  cli.option('-v, --version', 'Show version')

  // Status command options
  cli.option('--short', 'Give the output in short format')
  cli.option('--branch', 'Show the branch info')

  // Diff command options
  cli.option('--staged', 'Show staged changes')
  cli.option('--cached', 'Show cached changes (alias for staged)')

  // Log command options
  cli.option('-n <count>', 'Limit the number of commits')
  cli.option('--oneline', 'Show each commit on a single line')
  cli.option('--graph', 'Draw a text-based graph')
  cli.option('--all', 'Show all refs')
  cli.option('--format <format>', 'Pretty-print format')

  // Blame command options
  cli.option('-L <range>', 'Line range')

  // Commit command options
  cli.option('-m <message>', 'Commit message')
  cli.option('--amend', 'Amend the previous commit')
  cli.option('-a', 'Stage all modified files')

  // Branch command options
  cli.option('-d', 'Delete a branch')
  cli.option('--list', 'List branches')

  // Review command options
  cli.option('--interactive', 'Interactive review mode')

  // Web command options
  cli.option('--port <port>', 'Port number')
  cli.option('--open', 'Open in browser')

  // Parse arguments
  const parsed = cli.parse(['node', 'gitx', ...args], { run: false })

  // Extract command and args
  const positionalArgs = parsed.args.slice() // Clone to avoid mutation
  let command: string | undefined
  const commandArgs: string[] = []
  let rawArgs: string[] = []

  // Find command from positional args
  for (let i = 0; i < positionalArgs.length; i++) {
    const arg = positionalArgs[i]
    if (!command && SUBCOMMANDS.includes(arg as any)) {
      command = arg
    } else if (arg === '--') {
      rawArgs = positionalArgs.slice(i + 1)
      break
    } else if (command) {
      commandArgs.push(arg)
    } else if (!arg.startsWith('-')) {
      // This is either a command we don't recognize or a positional arg before command
      command = arg
    }
  }

  // Handle --cwd option
  let cwd = process.cwd()
  if (parsed.options.cwd) {
    cwd = resolve(process.cwd(), parsed.options.cwd)
  } else if (parsed.options.C) {
    cwd = resolve(process.cwd(), parsed.options.C)
  }

  // Get rawArgs from cac's '--' key
  if (parsed.options['--'] && Array.isArray(parsed.options['--'])) {
    rawArgs = parsed.options['--']
  }

  // Clean up options object
  const options = { ...parsed.options }
  delete options['--']

  // Convert numeric options
  if (options.n !== undefined && typeof options.n === 'string') {
    options.n = parseInt(options.n, 10)
  }
  if (options.port !== undefined && typeof options.port === 'string') {
    options.port = parseInt(options.port, 10)
  }

  return {
    command,
    args: commandArgs,
    options,
    rawArgs,
    cwd
  }
}

export async function runCLI(args: string[], options: CLIOptions = {}): Promise<CLIResult> {
  const cli = createCLI({
    stdout: options.stdout,
    stderr: options.stderr
  })

  return cli.run(args)
}
