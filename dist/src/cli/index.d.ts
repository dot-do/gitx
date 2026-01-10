/**
 * @fileoverview CLI Entry Point for gitx
 *
 * This module provides the main command-line interface for gitx, a git-compatible
 * version control system. It handles argument parsing, command routing, and
 * provides the foundation for all CLI subcommands.
 *
 * @module cli/index
 *
 * @example
 * // Create and run CLI programmatically
 * import { createCLI, runCLI } from './cli'
 *
 * const cli = createCLI({ name: 'gitx', version: '1.0.0' })
 * cli.registerCommand('status', statusHandler)
 * await cli.run(['status', '--short'])
 *
 * @example
 * // Parse arguments without running
 * import { parseArgs } from './cli'
 *
 * const parsed = parseArgs(['status', '--short', '--branch'])
 * console.log(parsed.command) // 'status'
 * console.log(parsed.options) // { short: true, branch: true }
 */
/**
 * Options for configuring CLI behavior.
 *
 * @description Allows customization of CLI execution including working directory,
 * and output streams for testing or embedding scenarios.
 *
 * @property cwd - Working directory for command execution. Defaults to process.cwd().
 * @property stdout - Custom function for standard output. Defaults to console.log.
 * @property stderr - Custom function for error output. Defaults to console.error.
 *
 * @example
 * const options: CLIOptions = {
 *   cwd: '/path/to/repo',
 *   stdout: (msg) => output.push(msg),
 *   stderr: (msg) => errors.push(msg)
 * }
 */
export interface CLIOptions {
    /** Working directory for command execution */
    cwd?: string;
    /** Custom function for standard output */
    stdout?: (msg: string) => void;
    /** Custom function for error output */
    stderr?: (msg: string) => void;
}
/**
 * Result returned from CLI command execution.
 *
 * @description Contains the exit code, executed command name, and any error
 * that occurred during execution. Used to determine success/failure of CLI operations.
 *
 * @property exitCode - Exit code (0 for success, non-zero for failure)
 * @property command - The command that was executed, if any
 * @property error - Error object if command failed
 *
 * @example
 * const result = await cli.run(['status'])
 * if (result.exitCode !== 0) {
 *   console.error(`Command ${result.command} failed:`, result.error?.message)
 * }
 */
export interface CLIResult {
    /** Exit code (0 for success, non-zero for failure) */
    exitCode: number;
    /** The command that was executed, if any */
    command?: string;
    /** Error object if command failed */
    error?: Error;
}
/**
 * Parsed command-line arguments structure.
 *
 * @description Contains the parsed representation of CLI arguments including
 * the command name, positional arguments, options/flags, and working directory.
 *
 * @property command - The subcommand to execute (e.g., 'status', 'diff')
 * @property args - Positional arguments after the command
 * @property options - Key-value pairs of parsed options/flags
 * @property rawArgs - Arguments after '--' separator (passed through unchanged)
 * @property cwd - Working directory for command execution
 *
 * @example
 * // Parsing 'gitx status --short file.txt'
 * const parsed: ParsedArgs = {
 *   command: 'status',
 *   args: ['file.txt'],
 *   options: { short: true },
 *   rawArgs: [],
 *   cwd: '/path/to/repo'
 * }
 */
export interface ParsedArgs {
    /** The subcommand to execute (e.g., 'status', 'diff') */
    command?: string;
    /** Positional arguments after the command */
    args: string[];
    /** Key-value pairs of parsed options/flags */
    options: Record<string, any>;
    /** Arguments after '--' separator (passed through unchanged) */
    rawArgs: string[];
    /** Working directory for command execution */
    cwd: string;
}
/**
 * Context object passed to command handlers.
 *
 * @description Provides command handlers with all necessary context including
 * the working directory, arguments, options, and I/O functions.
 *
 * @property cwd - Current working directory for the command
 * @property args - Positional arguments passed to the command
 * @property options - Parsed options/flags for the command
 * @property rawArgs - Raw arguments after '--' separator
 * @property stdout - Function to write to standard output
 * @property stderr - Function to write to standard error
 *
 * @example
 * async function statusHandler(ctx: CommandContext): Promise<void> {
 *   const { cwd, options, stdout } = ctx
 *   const status = await getStatus(cwd)
 *   if (options.short) {
 *     stdout(formatShort(status))
 *   } else {
 *     stdout(formatLong(status))
 *   }
 * }
 */
export interface CommandContext {
    /** Current working directory for the command */
    cwd: string;
    /** Positional arguments passed to the command */
    args: string[];
    /** Parsed options/flags for the command */
    options: Record<string, any>;
    /** Raw arguments after '--' separator */
    rawArgs: string[];
    /** Function to write to standard output */
    stdout: (msg: string) => void;
    /** Function to write to standard error */
    stderr: (msg: string) => void;
}
/**
 * Function type for command handlers.
 *
 * @description Command handlers receive a CommandContext and may return
 * void or a Promise for async operations. Errors should be thrown
 * to indicate failure.
 *
 * @param ctx - The command context with args, options, and I/O
 * @returns void or Promise<void>
 *
 * @example
 * const myHandler: CommandHandler = async (ctx) => {
 *   ctx.stdout('Hello from command!')
 * }
 */
type CommandHandler = (ctx: CommandContext) => void | Promise<void>;
/**
 * Main CLI class for gitx command-line interface.
 *
 * @description Provides command registration, argument parsing, help generation,
 * and command execution. Supports custom output streams for testing.
 *
 * @example
 * const cli = new CLI({ name: 'gitx', version: '1.0.0' })
 * cli.registerCommand('status', statusHandler)
 * const result = await cli.run(['status', '--short'])
 *
 * @example
 * // With custom output streams for testing
 * const output: string[] = []
 * const cli = new CLI({
 *   stdout: (msg) => output.push(msg),
 *   stderr: (msg) => output.push(`ERROR: ${msg}`)
 * })
 */
export declare class CLI {
    /** The name of the CLI tool */
    name: string;
    /** The version of the CLI tool */
    version: string;
    /** Registered command handlers */
    private handlers;
    /** Function for standard output */
    private stdout;
    /** Function for error output */
    private stderr;
    /**
     * Creates a new CLI instance.
     *
     * @description Initializes the CLI with optional name, version, and I/O functions.
     * Defaults are provided for all options.
     *
     * @param options - Configuration options
     * @param options.name - CLI name (default: 'gitx')
     * @param options.version - CLI version (default: '0.0.1')
     * @param options.stdout - Standard output function (default: console.log)
     * @param options.stderr - Error output function (default: console.error)
     *
     * @example
     * const cli = new CLI({ name: 'my-tool', version: '2.0.0' })
     */
    constructor(options?: {
        name?: string;
        version?: string;
        stdout?: (msg: string) => void;
        stderr?: (msg: string) => void;
    });
    /**
     * Registers a command handler for a subcommand.
     *
     * @description Associates a handler function with a command name. The handler
     * will be invoked when that command is executed.
     *
     * @param name - The command name (e.g., 'status', 'diff')
     * @param handler - The function to handle the command
     *
     * @example
     * cli.registerCommand('status', async (ctx) => {
     *   const status = await getStatus(ctx.cwd)
     *   ctx.stdout(formatStatus(status))
     * })
     */
    registerCommand(name: string, handler: CommandHandler): void;
    /**
     * Runs the CLI with the provided arguments.
     *
     * @description Parses arguments, handles help/version flags, validates commands,
     * and executes the appropriate handler. Returns a result object with exit code.
     *
     * @param args - Command-line arguments (excluding 'node' and script name)
     * @param options - Run options
     * @param options.skipCwdCheck - Skip validation of --cwd directory existence
     * @returns Promise<CLIResult> with exitCode, command, and potential error
     *
     * @throws Never throws directly - errors are captured in CLIResult.error
     *
     * @example
     * const result = await cli.run(['status', '--short'])
     * if (result.exitCode === 0) {
     *   console.log('Success!')
     * } else {
     *   console.error('Failed:', result.error?.message)
     * }
     *
     * @example
     * // Skip cwd validation for testing
     * const result = await cli.run(['status'], { skipCwdCheck: true })
     */
    run(args: string[], options?: {
        skipCwdCheck?: boolean;
    }): Promise<CLIResult>;
    /**
     * Generates the main help text for the CLI.
     *
     * @description Creates formatted help output showing available commands,
     * options, and usage information.
     *
     * @returns Formatted help string
     */
    private getHelp;
    /**
     * Generates help text for a specific subcommand.
     *
     * @description Creates formatted help output for a specific command
     * including its description and usage pattern.
     *
     * @param command - The command name to get help for
     * @returns Formatted help string for the command
     */
    private getSubcommandHelp;
    /**
     * Suggests a command based on a misspelled input.
     *
     * @description Uses Levenshtein distance to find the closest matching
     * command when the user enters an unknown command. Only suggests
     * commands within a distance of 3 edits.
     *
     * @param input - The misspelled command input
     * @returns The suggested command name, or null if no close match
     */
    private suggestCommand;
}
/**
 * Creates a new CLI instance with the provided options.
 *
 * @description Factory function for creating CLI instances. Provides a
 * convenient way to instantiate the CLI with custom configuration.
 *
 * @param options - Configuration options for the CLI
 * @param options.name - CLI name (default: 'gitx')
 * @param options.version - CLI version (default: '0.0.1')
 * @param options.stdout - Standard output function (default: console.log)
 * @param options.stderr - Error output function (default: console.error)
 * @returns A new CLI instance
 *
 * @example
 * const cli = createCLI({ name: 'my-git', version: '1.0.0' })
 * cli.registerCommand('status', statusHandler)
 * await cli.run(['status'])
 *
 * @example
 * // For testing with captured output
 * const output: string[] = []
 * const cli = createCLI({
 *   stdout: (msg) => output.push(msg)
 * })
 */
export declare function createCLI(options?: {
    name?: string;
    version?: string;
    stdout?: (msg: string) => void;
    stderr?: (msg: string) => void;
}): CLI;
/**
 * Parses command-line arguments into a structured format.
 *
 * @description Uses the cac library to parse arguments, extracting the command,
 * positional arguments, options/flags, and handling special cases like --cwd
 * and the '--' separator for raw arguments.
 *
 * @param args - Array of command-line arguments (excluding 'node' and script name)
 * @returns ParsedArgs object with command, args, options, rawArgs, and cwd
 *
 * @example
 * const parsed = parseArgs(['status', '--short', '--branch'])
 * // Returns: {
 * //   command: 'status',
 * //   args: [],
 * //   options: { short: true, branch: true },
 * //   rawArgs: [],
 * //   cwd: process.cwd()
 * // }
 *
 * @example
 * const parsed = parseArgs(['--cwd', '/repo', 'diff', '--staged'])
 * // Returns: {
 * //   command: 'diff',
 * //   args: [],
 * //   options: { staged: true, cwd: '/repo' },
 * //   rawArgs: [],
 * //   cwd: '/repo'
 * // }
 *
 * @example
 * // With raw args after '--'
 * const parsed = parseArgs(['commit', '-m', 'msg', '--', 'file.txt'])
 * // Returns: {
 * //   command: 'commit',
 * //   args: [],
 * //   options: { m: 'msg' },
 * //   rawArgs: ['file.txt'],
 * //   cwd: process.cwd()
 * // }
 */
export declare function parseArgs(args: string[]): ParsedArgs;
/**
 * Convenience function to create a CLI and run it with the provided arguments.
 *
 * @description Creates a new CLI instance with the provided options and
 * immediately runs it with the given arguments. Useful for simple one-off
 * CLI executions.
 *
 * @param args - Command-line arguments to run
 * @param options - CLI options including output streams
 * @returns Promise<CLIResult> with exitCode, command, and potential error
 *
 * @example
 * const result = await runCLI(['status', '--short'])
 * console.log(result.exitCode) // 0 or 1
 *
 * @example
 * // With custom output handling
 * const output: string[] = []
 * const result = await runCLI(['status'], {
 *   stdout: (msg) => output.push(msg),
 *   stderr: (msg) => console.error(msg)
 * })
 */
export declare function runCLI(args: string[], options?: CLIOptions): Promise<CLIResult>;
export {};
//# sourceMappingURL=index.d.ts.map