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
import { parseBashCommand, analyzeASTSafety, } from './bash-ast';
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
    name = 'bash';
    /**
     * The executor used for running commands.
     */
    executor;
    /**
     * Filesystem capability for file operations.
     */
    fs;
    /**
     * Default working directory.
     */
    defaultCwd;
    /**
     * Default timeout in milliseconds.
     */
    defaultTimeout;
    /**
     * List of blocked commands.
     */
    blockedCommands;
    /**
     * Whether to require confirmation for dangerous commands.
     */
    requireConfirmation;
    /**
     * Database storage for persistence.
     */
    storage;
    /**
     * Policy name for database operations.
     */
    policyName;
    /**
     * Database row ID for this policy.
     */
    policyId;
    /**
     * Allowed command patterns (regex).
     */
    allowedPatterns = [];
    /**
     * Denied command patterns (regex).
     */
    deniedPatterns = [];
    /**
     * Maximum concurrent executions.
     */
    maxConcurrent = 5;
    /**
     * Whether the policy is enabled.
     */
    enabled = true;
    /**
     * Whether to use AST-based safety analysis.
     */
    useAST;
    /**
     * Commands considered dangerous and requiring confirmation.
     */
    static DANGEROUS_COMMANDS = new Set([
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
    ]);
    /**
     * Critical patterns that should ALWAYS be blocked, regardless of confirmation.
     * These patterns represent commands that could cause catastrophic, irreversible damage.
     */
    static CRITICAL_PATTERNS = [
        /\brm\s+(-[rfvI]+\s+)*\/\s*$/, // rm -rf /
        /\brm\s+(-[rfvI]+\s+)*\/\*/, // rm -rf /*
        /\brm\s+.*--no-preserve-root/, // rm with --no-preserve-root
        /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
        /\.\(\)\s*\{\s*\.\s*\|\s*\.\s*&\s*\}\s*;\s*\./, // fork bomb variant
        /\bdd\s+.*if=\/dev\/(u?random|zero)\s+.*of=\/dev\/[hs]d[a-z]/, // dd to disk
        /\bdd\s+.*of=\/dev\/[hs]d[a-z].*if=\/dev\/(u?random|zero)/, // dd to disk (reversed)
        /\bmkfs(\.\w+)?\s+(-[a-zA-Z]+\s+)*\/dev\/[hs]d[a-z]/, // mkfs on disk
        />\s*\/dev\/[hs]d[a-z]/, // redirect to disk device
        /echo\s+[cso]\s*>\s*\/proc\/sysrq-trigger/, // kernel panic trigger
        /\bcurl\s+.*\|\s*(ba)?sh\b/, // curl piped to shell
        /\bwget\s+.*\|\s*(ba)?sh\b/, // wget piped to shell
    ];
    /**
     * Dangerous flag patterns (require confirmation but can be executed with confirm).
     */
    static DANGEROUS_PATTERNS = [
        /rm\s+(-[rf]+\s+)*\/\w/, // rm with path starting from root (but not root itself)
        /rm\s+(-[rf]+\s+)*\*/, // rm with wildcard
        />\s*\/dev\//, // redirect to device
        /dd\s+.*of=\/dev/, // dd to device
        /chmod\s+777/, // overly permissive chmod
    ];
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
    constructor(options = {}) {
        this.executor = options.executor;
        this.fs = options.fs;
        this.defaultCwd = options.cwd ?? '/';
        this.defaultTimeout = options.defaultTimeout ?? 30000;
        this.blockedCommands = new Set(options.blockedCommands ?? []);
        this.requireConfirmation = options.requireConfirmation ?? true;
        this.storage = options.storage;
        this.policyName = options.policyName ?? 'default';
        this.useAST = options.useAST ?? true;
    }
    /**
     * Optional initialization hook.
     * Called when the module is first loaded.
     * When storage is provided, loads or creates the execution policy from the database.
     */
    async initialize() {
        if (!this.storage)
            return;
        // Try to load existing policy
        const existingRows = this.storage.sql.exec('SELECT * FROM exec WHERE name = ?', this.policyName).toArray();
        if (existingRows.length > 0) {
            // Load existing settings
            const row = existingRows[0];
            this.policyId = row.id;
            this.loadFromRow(row);
        }
        else {
            // Create new policy with current settings
            await this.persistPolicy();
        }
    }
    /**
     * Load settings from a database row.
     */
    loadFromRow(row) {
        // Parse blocked commands from JSON string
        if (row.blocked_commands) {
            try {
                const commands = JSON.parse(row.blocked_commands);
                this.blockedCommands = new Set(commands);
            }
            catch {
                this.blockedCommands = new Set();
            }
        }
        this.requireConfirmation = row.require_confirmation === 1;
        this.defaultTimeout = row.default_timeout;
        this.defaultCwd = row.default_cwd;
        this.maxConcurrent = row.max_concurrent;
        this.enabled = row.enabled === 1;
        // Parse allowed patterns
        if (row.allowed_patterns) {
            try {
                const patterns = JSON.parse(row.allowed_patterns);
                this.allowedPatterns = patterns.map(p => new RegExp(p));
            }
            catch {
                this.allowedPatterns = [];
            }
        }
        // Parse denied patterns
        if (row.denied_patterns) {
            try {
                const patterns = JSON.parse(row.denied_patterns);
                this.deniedPatterns = patterns.map(p => new RegExp(p));
            }
            catch {
                this.deniedPatterns = [];
            }
        }
    }
    /**
     * Persist current policy settings to the database.
     */
    async persistPolicy() {
        if (!this.storage)
            return;
        const now = Date.now();
        const blockedCommandsJson = JSON.stringify(Array.from(this.blockedCommands));
        const allowedPatternsJson = this.allowedPatterns.length > 0
            ? JSON.stringify(this.allowedPatterns.map(p => p.source))
            : null;
        const deniedPatternsJson = this.deniedPatterns.length > 0
            ? JSON.stringify(this.deniedPatterns.map(p => p.source))
            : null;
        if (this.policyId) {
            // Update existing policy
            this.storage.sql.exec(`UPDATE exec SET
          blocked_commands = ?,
          require_confirmation = ?,
          default_timeout = ?,
          default_cwd = ?,
          allowed_patterns = ?,
          denied_patterns = ?,
          max_concurrent = ?,
          enabled = ?,
          updated_at = ?
        WHERE id = ?`, blockedCommandsJson, this.requireConfirmation ? 1 : 0, this.defaultTimeout, this.defaultCwd, allowedPatternsJson, deniedPatternsJson, this.maxConcurrent, this.enabled ? 1 : 0, now, this.policyId);
        }
        else {
            // Insert new policy
            this.storage.sql.exec(`INSERT INTO exec (
          name, blocked_commands, require_confirmation, default_timeout,
          default_cwd, allowed_patterns, denied_patterns, max_concurrent,
          enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, this.policyName, blockedCommandsJson, this.requireConfirmation ? 1 : 0, this.defaultTimeout, this.defaultCwd, allowedPatternsJson, deniedPatternsJson, this.maxConcurrent, this.enabled ? 1 : 0, now, now);
            // Get the inserted row ID
            const insertedRows = this.storage.sql.exec('SELECT id FROM exec WHERE name = ?', this.policyName).toArray();
            if (insertedRows.length > 0) {
                this.policyId = insertedRows[0].id;
            }
        }
    }
    /**
     * Optional cleanup hook.
     * Called when the capability is unloaded.
     */
    async dispose() {
        // Cleanup logic if needed
    }
    /**
     * Check if FsCapability is available.
     *
     * @returns True if FsCapability is configured
     */
    get hasFsCapability() {
        return this.fs !== undefined;
    }
    /**
     * Check if an executor is available.
     *
     * @returns True if an executor is configured
     */
    get hasExecutor() {
        return this.executor !== undefined;
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
    async exec(command, args, options) {
        // Build full command string
        const fullCommand = args && args.length > 0
            ? `${command} ${args.map(a => this.escapeArg(a)).join(' ')}`
            : command;
        // Check if command is blocked
        const baseCommand = this.extractBaseCommand(command);
        if (this.blockedCommands.has(baseCommand)) {
            return {
                command: fullCommand,
                stdout: '',
                stderr: `Command '${baseCommand}' is blocked`,
                exitCode: 1,
                blocked: true,
                blockReason: `Command '${baseCommand}' is in the blocked list`
            };
        }
        // Check safety
        const safety = this.analyze(fullCommand);
        // Critical commands are ALWAYS blocked, regardless of confirmation
        if (safety.safetyLevel === 'critical') {
            return {
                command: fullCommand,
                stdout: '',
                stderr: safety.reason ?? 'Critical command is always blocked',
                exitCode: 1,
                blocked: true,
                blockReason: safety.reason ?? 'Critical command cannot be executed even with confirmation'
            };
        }
        // Dangerous commands require confirmation
        if (safety.dangerous && this.requireConfirmation && !options?.confirm) {
            return {
                command: fullCommand,
                stdout: '',
                stderr: safety.reason ?? 'Command requires confirmation',
                exitCode: 1,
                blocked: true,
                blockReason: safety.reason ?? 'Dangerous command requires confirmation'
            };
        }
        // Dry run mode
        if (options?.dryRun) {
            return {
                command: fullCommand,
                stdout: `[dry-run] Would execute: ${fullCommand}`,
                stderr: '',
                exitCode: 0
            };
        }
        // Check for executor
        if (!this.executor) {
            return {
                command: fullCommand,
                stdout: '',
                stderr: 'No executor configured',
                exitCode: 1
            };
        }
        // Merge options with defaults
        const execOptions = {
            timeout: this.defaultTimeout,
            cwd: this.defaultCwd,
            ...options
        };
        // Execute the command
        try {
            return await this.executor.execute(fullCommand, execOptions);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                command: fullCommand,
                stdout: '',
                stderr: errorMessage,
                exitCode: 1
            };
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
    async spawn(command, args, options) {
        if (!this.executor?.spawn) {
            throw new Error('Spawn not supported by this executor');
        }
        // Check if command is blocked
        const baseCommand = this.extractBaseCommand(command);
        if (this.blockedCommands.has(baseCommand)) {
            throw new Error(`Command '${baseCommand}' is blocked`);
        }
        // Check safety
        const fullCommand = args && args.length > 0
            ? `${command} ${args.join(' ')}`
            : command;
        const safety = this.analyze(fullCommand);
        // Critical commands are ALWAYS blocked, regardless of confirmation
        if (safety.safetyLevel === 'critical') {
            throw new Error(safety.reason ?? 'Critical command cannot be executed even with confirmation');
        }
        // Dangerous commands require confirmation
        if (safety.dangerous && this.requireConfirmation && !options?.confirm) {
            throw new Error(safety.reason ?? 'Dangerous command requires confirmation');
        }
        return this.executor.spawn(command, args, options);
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
    async run(script, options) {
        // Analyze script safety first (before dry-run check)
        const safety = this.analyze(script);
        // Critical commands are ALWAYS blocked, regardless of confirmation or dry-run
        if (safety.safetyLevel === 'critical') {
            return {
                command: script,
                stdout: '',
                stderr: safety.reason ?? 'Critical command is always blocked',
                exitCode: 1,
                blocked: true,
                blockReason: safety.reason ?? 'Critical command cannot be executed even with confirmation'
            };
        }
        // Dry run mode
        if (options?.dryRun) {
            return {
                command: script,
                stdout: `[dry-run] Would execute script:\n${script}`,
                stderr: '',
                exitCode: 0
            };
        }
        // Check for executor
        if (!this.executor) {
            return {
                command: script,
                stdout: '',
                stderr: 'No executor configured',
                exitCode: 1
            };
        }
        // Dangerous commands require confirmation
        if (safety.dangerous && this.requireConfirmation && !options?.confirm) {
            return {
                command: script,
                stdout: '',
                stderr: safety.reason ?? 'Script requires confirmation',
                exitCode: 1,
                blocked: true,
                blockReason: safety.reason ?? 'Dangerous script requires confirmation'
            };
        }
        // Execute the script
        const execOptions = {
            timeout: this.defaultTimeout,
            cwd: this.defaultCwd,
            ...options
        };
        try {
            return await this.executor.execute(script, execOptions);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                command: script,
                stdout: '',
                stderr: errorMessage,
                exitCode: 1
            };
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
    analyze(input) {
        // Use AST-based analysis if enabled
        if (this.useAST) {
            return this.analyzeWithAST(input);
        }
        // Fall back to regex-based analysis
        return this.analyzeWithRegex(input);
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
    analyzeWithAST(input) {
        try {
            const ast = parseBashCommand(input);
            const astAnalysis = analyzeASTSafety(ast, this.blockedCommands, input);
            return {
                dangerous: astAnalysis.dangerous,
                safetyLevel: astAnalysis.safetyLevel,
                reason: astAnalysis.reason,
                commands: astAnalysis.commands,
                impact: astAnalysis.impact,
                issues: astAnalysis.issues,
                usedAST: true,
            };
        }
        catch {
            // If AST parsing fails, fall back to regex analysis
            return this.analyzeWithRegex(input);
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
    analyzeWithRegex(input) {
        const commands = this.extractCommands(input);
        let dangerous = false;
        let reason;
        let impact = 'none';
        let safetyLevel = 'safe';
        // Check for critical patterns first (these are ALWAYS blocked)
        for (const pattern of BashModule.CRITICAL_PATTERNS) {
            if (pattern.test(input)) {
                dangerous = true;
                reason = `Critical command pattern detected - cannot be executed`;
                impact = 'critical';
                safetyLevel = 'critical';
                break;
            }
        }
        // Check for blocked commands (highest priority after critical)
        if (!dangerous) {
            for (const cmd of commands) {
                if (this.blockedCommands.has(cmd)) {
                    dangerous = true;
                    reason = `Command '${cmd}' is blocked`;
                    impact = 'critical';
                    safetyLevel = 'dangerous';
                    break;
                }
            }
        }
        // Check for dangerous patterns (critical impact - check before DANGEROUS_COMMANDS)
        if (!dangerous) {
            for (const pattern of BashModule.DANGEROUS_PATTERNS) {
                if (pattern.test(input)) {
                    dangerous = true;
                    reason = `Command matches dangerous pattern: ${pattern.source}`;
                    impact = 'critical';
                    safetyLevel = 'dangerous';
                    break;
                }
            }
        }
        // Check for dangerous commands (high impact)
        if (!dangerous) {
            for (const cmd of commands) {
                if (BashModule.DANGEROUS_COMMANDS.has(cmd)) {
                    dangerous = true;
                    reason = `Command '${cmd}' is potentially dangerous`;
                    impact = 'high';
                    safetyLevel = 'dangerous';
                    break;
                }
            }
        }
        // Determine impact based on commands
        if (!dangerous) {
            if (commands.some(c => ['cat', 'ls', 'pwd', 'echo', 'head', 'tail', 'wc'].includes(c))) {
                impact = 'none';
            }
            else if (commands.some(c => ['touch', 'mkdir', 'cp'].includes(c))) {
                impact = 'low';
            }
            else if (commands.some(c => ['mv', 'sed', 'awk'].includes(c))) {
                impact = 'medium';
            }
        }
        return {
            dangerous,
            safetyLevel,
            reason,
            commands,
            impact,
            usedAST: false,
        };
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
    isDangerous(input) {
        const analysis = this.analyze(input);
        return {
            dangerous: analysis.dangerous,
            reason: analysis.reason
        };
    }
    /**
     * Add a command to the blocked list.
     * Persists the change to the database if storage is configured.
     *
     * @param command - Command to block
     */
    block(command) {
        this.blockedCommands.add(command);
        // Persist to database asynchronously
        this.persistPolicy().catch(() => {
            // Silently ignore persistence errors
        });
    }
    /**
     * Remove a command from the blocked list.
     * Persists the change to the database if storage is configured.
     *
     * @param command - Command to unblock
     */
    unblock(command) {
        this.blockedCommands.delete(command);
        // Persist to database asynchronously
        this.persistPolicy().catch(() => {
            // Silently ignore persistence errors
        });
    }
    /**
     * Get the list of blocked commands.
     *
     * @returns Array of blocked command names
     */
    getBlockedCommands() {
        return Array.from(this.blockedCommands);
    }
    /**
     * Get the current execution policy.
     *
     * @returns Current policy configuration
     */
    getPolicy() {
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
        };
    }
    /**
     * Update the execution policy.
     * Persists the changes to the database if storage is configured.
     *
     * @param policy - Partial policy configuration to update
     */
    async updatePolicy(policy) {
        if (policy.blockedCommands !== undefined) {
            this.blockedCommands = new Set(policy.blockedCommands);
        }
        if (policy.requireConfirmation !== undefined) {
            this.requireConfirmation = policy.requireConfirmation;
        }
        if (policy.defaultTimeout !== undefined) {
            this.defaultTimeout = policy.defaultTimeout;
        }
        if (policy.defaultCwd !== undefined) {
            this.defaultCwd = policy.defaultCwd;
        }
        if (policy.allowedPatterns !== undefined) {
            this.allowedPatterns = policy.allowedPatterns.map(p => new RegExp(p));
        }
        if (policy.deniedPatterns !== undefined) {
            this.deniedPatterns = policy.deniedPatterns.map(p => new RegExp(p));
        }
        if (policy.maxConcurrent !== undefined) {
            this.maxConcurrent = policy.maxConcurrent;
        }
        if (policy.enabled !== undefined) {
            this.enabled = policy.enabled;
        }
        await this.persistPolicy();
    }
    /**
     * Check if the policy is enabled.
     *
     * @returns True if the policy is enabled
     */
    isEnabled() {
        return this.enabled;
    }
    /**
     * Check if database storage is available.
     *
     * @returns True if storage is configured
     */
    hasStorage() {
        return this.storage !== undefined;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // Private Helper Methods
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Extract the base command name from a command string.
     */
    extractBaseCommand(command) {
        const parts = command.trim().split(/\s+/);
        const first = parts[0] ?? '';
        // Handle paths like /usr/bin/rm
        const name = first.split('/').pop() ?? first;
        return name;
    }
    /**
     * Extract all command names from a script.
     */
    extractCommands(input) {
        const commands = [];
        // Split by common separators
        const segments = input.split(/[;&|]+/);
        for (const segment of segments) {
            const trimmed = segment.trim();
            if (!trimmed)
                continue;
            // Skip comments
            if (trimmed.startsWith('#'))
                continue;
            // Get the first word
            const match = trimmed.match(/^(\S+)/);
            if (match) {
                const cmd = match[1];
                // Handle paths
                const name = cmd.split('/').pop() ?? cmd;
                // Skip shell keywords
                if (!['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'function'].includes(name)) {
                    commands.push(name);
                }
            }
        }
        return commands;
    }
    /**
     * Escape an argument for safe shell use.
     */
    escapeArg(arg) {
        // If the argument contains no special characters, return as-is
        if (/^[a-zA-Z0-9._\-/=]+$/.test(arg)) {
            return arg;
        }
        // Otherwise, single-quote escape
        return `'${arg.replace(/'/g, "'\\''")}'`;
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
    tag(strings, ...values) {
        const command = this.buildCommandFromTemplate(strings, values);
        return this.run(command);
    }
    /**
     * Build a command string from template literal parts with safe escaping.
     *
     * @param strings - Template literal string parts
     * @param values - Interpolated values
     * @returns The constructed command string with escaped values
     * @internal
     */
    buildCommandFromTemplate(strings, values) {
        let result = '';
        for (let i = 0; i < strings.length; i++) {
            result += strings[i];
            if (i < values.length) {
                const value = values[i];
                result += this.escapeTemplateValue(value);
            }
        }
        return result;
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
    escapeTemplateValue(value) {
        // Handle null/undefined
        if (value === null || value === undefined) {
            return '';
        }
        // Handle numbers and booleans - safe to use directly
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        // Handle arrays - escape each element and join
        if (Array.isArray(value)) {
            return value.map(v => this.escapeTemplateValue(v)).join(' ');
        }
        // Handle objects (except arrays) - JSON stringify and escape
        if (typeof value === 'object') {
            return this.escapeShellString(JSON.stringify(value));
        }
        // Handle strings
        return this.escapeShellString(String(value));
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
    escapeShellString(str) {
        // If the string is empty, return empty quoted string
        if (str === '') {
            return "''";
        }
        // If the string contains no special characters, return as-is
        // This is more readable for simple cases like file paths without spaces
        if (/^[a-zA-Z0-9._\-/=@:]+$/.test(str)) {
            return str;
        }
        // Otherwise, use single-quote escaping
        // Single quotes prevent all interpretation except ' itself
        // To include a single quote, we end the quoted string, add an escaped quote, and start a new quoted string
        // 'It'\''s' -> It's
        return `'${str.replace(/'/g, "'\\''")}'`;
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
export function createBashModule(options = {}) {
    return new BashModule(options);
}
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
export function createCallableBashModule(options = {}) {
    const module = new BashModule(options);
    // Create a function that calls the tag method
    const tagFn = (strings, ...values) => {
        return module.tag(strings, ...values);
    };
    // Create a Proxy that makes the module callable
    return new Proxy(tagFn, {
        // Forward property access to the module
        get(target, prop, receiver) {
            if (prop in module) {
                const value = module[prop];
                // Bind methods to the module
                if (typeof value === 'function') {
                    return value.bind(module);
                }
                return value;
            }
            return Reflect.get(target, prop, receiver);
        },
        // Forward property setting to the module
        set(target, prop, value) {
            if (prop in module) {
                module[prop] = value;
                return true;
            }
            return Reflect.set(target, prop, value);
        },
        // Forward has checks to the module
        has(target, prop) {
            return prop in module || Reflect.has(target, prop);
        },
        // Make instanceof work
        getPrototypeOf() {
            return BashModule.prototype;
        },
        // Forward apply to the tag function
        apply(target, _thisArg, args) {
            return target(...args);
        },
    });
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
export function isBashModule(value) {
    return value instanceof BashModule;
}
/**
 * Check if a value is a CallableBashModule.
 *
 * @param value - Value to check
 * @returns True if value is a CallableBashModule
 */
export function isCallableBashModule(value) {
    if (typeof value !== 'function')
        return false;
    if (!('name' in value))
        return false;
    const maybeBash = value;
    return maybeBash.name === 'bash' && 'exec' in value && typeof maybeBash.exec === 'function';
}
//# sourceMappingURL=BashModule.js.map