/**
 * @fileoverview Bash AST Parser and Safety Analyzer
 *
 * This module provides a bash command parser that produces an Abstract Syntax Tree (AST)
 * for shell commands, along with safety analysis based on AST node inspection.
 *
 * The parser handles:
 * - Simple commands (ls, cat, etc.)
 * - Pipelines (cmd1 | cmd2)
 * - Command lists (cmd1 && cmd2, cmd1 || cmd2, cmd1 ; cmd2)
 * - Subshells ($(...) and `...`)
 * - Redirections (>, >>, <, 2>&1)
 * - Variable expansion ($VAR, ${VAR})
 * - Quoting (single, double, and escape)
 *
 * @module do/bash-ast
 *
 * @example
 * ```typescript
 * import { parseBashCommand, analyzeASTSafety } from './bash-ast'
 *
 * const ast = parseBashCommand('rm -rf /')
 * const safety = analyzeASTSafety(ast)
 * if (safety.dangerous) {
 *   console.log(`Command blocked: ${safety.reason}`)
 * }
 * ```
 */

// ============================================================================
// AST Node Types
// ============================================================================

/**
 * Type of AST node.
 */
export type ASTNodeType =
  | 'command'
  | 'pipeline'
  | 'list'
  | 'subshell'
  | 'function'
  | 'word'
  | 'redirect'
  | 'assignment'

/**
 * Operator types for command lists.
 */
export type ListOperator = '&&' | '||' | ';' | '&'

/**
 * Redirection type.
 */
export type RedirectType =
  | '>'    // output
  | '>>'   // append
  | '<'    // input
  | '2>'   // stderr
  | '2>>'  // stderr append
  | '&>'   // stdout+stderr
  | '>&'   // duplicate fd
  | '<<'   // here-doc
  | '<<<'  // here-string

/**
 * Base AST node interface.
 */
export interface ASTNodeBase {
  type: ASTNodeType
  raw: string
  start: number
  end: number
}

/**
 * Word node - represents a simple word or argument.
 */
export interface WordNode extends ASTNodeBase {
  type: 'word'
  value: string
  quoted: 'none' | 'single' | 'double' | 'escaped'
  expandable: boolean
}

/**
 * Redirect node - represents I/O redirection.
 */
export interface RedirectNode extends ASTNodeBase {
  type: 'redirect'
  operator: RedirectType
  target: WordNode
  fd?: number
}

/**
 * Assignment node - represents variable assignment.
 */
export interface AssignmentNode extends ASTNodeBase {
  type: 'assignment'
  name: string
  value: WordNode
}

/**
 * Command node - represents a simple command.
 */
export interface CommandNode extends ASTNodeBase {
  type: 'command'
  name: WordNode
  args: WordNode[]
  redirects: RedirectNode[]
  assignments: AssignmentNode[]
  background: boolean
}

/**
 * Pipeline node - represents a pipeline of commands.
 */
export interface PipelineNode extends ASTNodeBase {
  type: 'pipeline'
  commands: (CommandNode | SubshellNode)[]
  negated: boolean
}

/**
 * List node - represents a list of pipelines.
 */
export interface ListNode extends ASTNodeBase {
  type: 'list'
  pipelines: PipelineNode[]
  operators: ListOperator[]
}

/**
 * Subshell node - represents a subshell.
 */
export interface SubshellNode extends ASTNodeBase {
  type: 'subshell'
  body: ListNode
  style: '$()' | '``' | '()'
}

/**
 * Function definition node.
 */
export interface FunctionNode extends ASTNodeBase {
  type: 'function'
  name: string
  body: ListNode
}

/**
 * Union of all AST node types.
 */
export type ASTNode =
  | WordNode
  | RedirectNode
  | AssignmentNode
  | CommandNode
  | PipelineNode
  | ListNode
  | SubshellNode
  | FunctionNode

// ============================================================================
// Safety Analysis Types
// ============================================================================

/**
 * Impact level of a command.
 */
export type ImpactLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'

/**
 * Safety level classification for commands.
 * - 'safe': Command can be executed without confirmation
 * - 'dangerous': Command requires confirmation but can be executed with confirm flag
 * - 'critical': Command is ALWAYS blocked regardless of confirmation (destructive/irreversible)
 */
export type SafetyLevel = 'safe' | 'dangerous' | 'critical'

/**
 * Safety classification result from AST analysis.
 */
export interface ASTSafetyAnalysis {
  /**
   * Whether the command is considered dangerous.
   */
  dangerous: boolean

  /**
   * Safety classification level.
   * - 'safe': Can execute without confirmation
   * - 'dangerous': Requires confirmation (confirm flag allows execution)
   * - 'critical': Always blocked, cannot be executed even with confirmation
   */
  safetyLevel: SafetyLevel

  /**
   * Reason for the classification.
   */
  reason?: string

  /**
   * All command names found in the AST.
   */
  commands: string[]

  /**
   * Impact level of the command.
   */
  impact: ImpactLevel

  /**
   * Detailed issues found during analysis.
   */
  issues: SafetyIssue[]

  /**
   * The parsed AST (for debugging/inspection).
   */
  ast?: ASTNode
}

/**
 * A single safety issue found during analysis.
 */
export interface SafetyIssue {
  /**
   * Type of safety issue.
   */
  type: 'dangerous_command' | 'dangerous_pattern' | 'blocked_command' | 'privilege_escalation' | 'data_destruction' | 'network_exfil' | 'code_injection' | 'critical_pattern'

  /**
   * Description of the issue.
   */
  message: string

  /**
   * Severity of the issue.
   */
  severity: ImpactLevel

  /**
   * Whether this issue represents a critical command that cannot be executed even with confirmation.
   * When true, the command will be blocked regardless of the confirm flag.
   */
  critical?: boolean

  /**
   * Location in the original command.
   */
  start?: number
  end?: number
}

// ============================================================================
// Tokenizer
// ============================================================================

/**
 * Token types for the lexer.
 */
type TokenType =
  | 'word'
  | 'operator'
  | 'redirect'
  | 'newline'
  | 'eof'

interface Token {
  type: TokenType
  value: string
  start: number
  end: number
}

/**
 * Tokenize a bash command string.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let pos = 0

  const operators = ['&&', '||', ';;', ';&', ';;&', '|&', '|', ';', '&', '(', ')']
  const redirectOps = ['>>>', '>>', '>&', '&>>', '&>', '<<-', '<<<', '<<', '<>', '<&', '<', '>|', '>']

  while (pos < input.length) {
    // Skip whitespace
    if (/\s/.test(input[pos]) && input[pos] !== '\n') {
      pos++
      continue
    }

    // Newline
    if (input[pos] === '\n') {
      tokens.push({ type: 'newline', value: '\n', start: pos, end: pos + 1 })
      pos++
      continue
    }

    // Comments
    if (input[pos] === '#') {
      while (pos < input.length && input[pos] !== '\n') {
        pos++
      }
      continue
    }

    // Check for redirect operators (before general operators)
    let foundRedirect = false
    for (const op of redirectOps) {
      if (input.slice(pos, pos + op.length) === op) {
        // Check for number prefix (like 2>)
        let actualStart = pos
        if (pos > 0 && /\d/.test(input[pos - 1])) {
          // Check if previous char was actually a number redirect prefix
          const prevToken = tokens[tokens.length - 1]
          if (prevToken && prevToken.type === 'word' && /^\d+$/.test(prevToken.value)) {
            tokens.pop()
            actualStart = prevToken.start
          }
        }
        tokens.push({ type: 'redirect', value: input.slice(actualStart, pos + op.length), start: actualStart, end: pos + op.length })
        pos += op.length
        foundRedirect = true
        break
      }
    }
    if (foundRedirect) continue

    // Check for operators
    let foundOp = false
    for (const op of operators) {
      if (input.slice(pos, pos + op.length) === op) {
        tokens.push({ type: 'operator', value: op, start: pos, end: pos + op.length })
        pos += op.length
        foundOp = true
        break
      }
    }
    if (foundOp) continue

    // Word (including quoted strings)
    const wordStart = pos
    let word = ''

    while (pos < input.length) {
      const ch = input[pos]

      // End of word
      if (/\s/.test(ch) || operators.some(op => input.slice(pos, pos + op.length) === op) ||
          redirectOps.some(op => input.slice(pos, pos + op.length) === op)) {
        break
      }

      // Single quoted string
      if (ch === "'") {
        pos++
        while (pos < input.length && input[pos] !== "'") {
          word += input[pos]
          pos++
        }
        if (pos < input.length) pos++ // Skip closing quote
        continue
      }

      // Double quoted string
      if (ch === '"') {
        pos++
        while (pos < input.length && input[pos] !== '"') {
          if (input[pos] === '\\' && pos + 1 < input.length) {
            word += input[pos + 1]
            pos += 2
          } else {
            word += input[pos]
            pos++
          }
        }
        if (pos < input.length) pos++ // Skip closing quote
        continue
      }

      // Backslash escape
      if (ch === '\\' && pos + 1 < input.length) {
        word += input[pos + 1]
        pos += 2
        continue
      }

      // Command substitution $()
      if (ch === '$' && pos + 1 < input.length && input[pos + 1] === '(') {
        let depth = 1
        word += '$('
        pos += 2
        while (pos < input.length && depth > 0) {
          if (input[pos] === '(') depth++
          else if (input[pos] === ')') depth--
          if (depth > 0) word += input[pos]
          pos++
        }
        word += ')'
        continue
      }

      // Backtick substitution
      if (ch === '`') {
        word += ch
        pos++
        while (pos < input.length && input[pos] !== '`') {
          if (input[pos] === '\\' && pos + 1 < input.length) {
            word += input[pos] + input[pos + 1]
            pos += 2
          } else {
            word += input[pos]
            pos++
          }
        }
        if (pos < input.length) {
          word += '`'
          pos++
        }
        continue
      }

      // Variable expansion
      if (ch === '$') {
        word += ch
        pos++
        if (pos < input.length && input[pos] === '{') {
          word += '{'
          pos++
          while (pos < input.length && input[pos] !== '}') {
            word += input[pos]
            pos++
          }
          if (pos < input.length) {
            word += '}'
            pos++
          }
        } else {
          while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) {
            word += input[pos]
            pos++
          }
        }
        continue
      }

      // Regular character
      word += ch
      pos++
    }

    if (word.length > 0) {
      tokens.push({ type: 'word', value: word, start: wordStart, end: pos })
    }
  }

  tokens.push({ type: 'eof', value: '', start: pos, end: pos })
  return tokens
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parser state.
 */
interface ParserState {
  tokens: Token[]
  pos: number
  input: string
}

/**
 * Peek at the current token.
 */
function peek(state: ParserState): Token {
  return state.tokens[state.pos] ?? { type: 'eof', value: '', start: state.input.length, end: state.input.length }
}

/**
 * Consume the current token.
 */
function consume(state: ParserState): Token {
  return state.tokens[state.pos++] ?? { type: 'eof', value: '', start: state.input.length, end: state.input.length }
}

/**
 * Check if current token matches.
 */
function match(state: ParserState, type: TokenType, value?: string): boolean {
  const token = peek(state)
  if (token.type !== type) return false
  if (value !== undefined && token.value !== value) return false
  return true
}

/**
 * Parse a word token into a WordNode.
 */
function parseWord(state: ParserState): WordNode {
  const token = consume(state)
  let quoted: WordNode['quoted'] = 'none'
  let expandable = false

  // Check for quoting and expansion
  if (token.value.includes('$')) expandable = true
  if (token.value.startsWith("'")) quoted = 'single'
  else if (token.value.startsWith('"')) quoted = 'double'
  else if (token.value.includes('\\')) quoted = 'escaped'

  return {
    type: 'word',
    raw: state.input.slice(token.start, token.end),
    value: token.value,
    quoted,
    expandable,
    start: token.start,
    end: token.end,
  }
}

/**
 * Parse a redirection.
 */
function parseRedirect(state: ParserState): RedirectNode | null {
  if (!match(state, 'redirect')) return null

  const redirectToken = consume(state)
  const operator = redirectToken.value.replace(/^\d+/, '') as RedirectType
  const fd = /^\d+/.test(redirectToken.value) ? parseInt(redirectToken.value.match(/^\d+/)![0]) : undefined

  // Get target
  if (!match(state, 'word')) {
    // Missing redirect target
    return null
  }
  const target = parseWord(state)

  return {
    type: 'redirect',
    raw: state.input.slice(redirectToken.start, target.end),
    operator,
    target,
    fd,
    start: redirectToken.start,
    end: target.end,
  }
}

/**
 * Parse a simple command.
 */
function parseCommand(state: ParserState): CommandNode | SubshellNode | null {
  // Check for subshell
  if (match(state, 'operator', '(')) {
    const startToken = consume(state)
    const body = parseList(state)
    if (match(state, 'operator', ')')) {
      consume(state)
    }
    return {
      type: 'subshell',
      raw: state.input.slice(startToken.start, peek(state).start),
      body,
      style: '()',
      start: startToken.start,
      end: peek(state).start,
    }
  }

  // Skip newlines
  while (match(state, 'newline')) consume(state)

  if (!match(state, 'word')) return null

  const startPos = peek(state).start
  const assignments: AssignmentNode[] = []
  const args: WordNode[] = []
  const redirects: RedirectNode[] = []

  // Check for assignments at the start
  while (match(state, 'word') && /^[a-zA-Z_][a-zA-Z0-9_]*=/.test(peek(state).value)) {
    const token = consume(state)
    const eqPos = token.value.indexOf('=')
    assignments.push({
      type: 'assignment',
      raw: token.value,
      name: token.value.slice(0, eqPos),
      value: {
        type: 'word',
        raw: token.value.slice(eqPos + 1),
        value: token.value.slice(eqPos + 1),
        quoted: 'none',
        expandable: token.value.slice(eqPos + 1).includes('$'),
        start: token.start + eqPos + 1,
        end: token.end,
      },
      start: token.start,
      end: token.end,
    })
  }

  // Get command name
  if (!match(state, 'word')) {
    // Assignment-only command
    if (assignments.length > 0) {
      const lastAssign = assignments[assignments.length - 1]
      return {
        type: 'command',
        raw: state.input.slice(startPos, lastAssign.end),
        name: { type: 'word', raw: '', value: '', quoted: 'none', expandable: false, start: startPos, end: startPos },
        args: [],
        redirects: [],
        assignments,
        background: false,
        start: startPos,
        end: lastAssign.end,
      }
    }
    return null
  }

  const name = parseWord(state)

  // Parse arguments and redirects
  while (true) {
    const redirect = parseRedirect(state)
    if (redirect) {
      redirects.push(redirect)
      continue
    }

    if (match(state, 'word')) {
      args.push(parseWord(state))
      continue
    }

    break
  }

  const endPos = args.length > 0 ? args[args.length - 1].end :
                 redirects.length > 0 ? redirects[redirects.length - 1].end :
                 name.end

  return {
    type: 'command',
    raw: state.input.slice(startPos, endPos),
    name,
    args,
    redirects,
    assignments,
    background: false,
    start: startPos,
    end: endPos,
  }
}

/**
 * Parse a pipeline.
 */
function parsePipeline(state: ParserState): PipelineNode | null {
  // Check for negation
  const negated = match(state, 'word') && peek(state).value === '!'
  if (negated) consume(state)

  const commands: (CommandNode | SubshellNode)[] = []

  const first = parseCommand(state)
  if (!first) return null
  commands.push(first)

  // Parse pipe chain
  while (match(state, 'operator', '|') || match(state, 'operator', '|&')) {
    consume(state)
    while (match(state, 'newline')) consume(state)
    const next = parseCommand(state)
    if (!next) break
    commands.push(next)
  }

  const startPos = commands[0].start
  const endPos = commands[commands.length - 1].end

  return {
    type: 'pipeline',
    raw: state.input.slice(startPos, endPos),
    commands,
    negated,
    start: startPos,
    end: endPos,
  }
}

/**
 * Parse a command list.
 */
function parseList(state: ParserState): ListNode {
  const pipelines: PipelineNode[] = []
  const operators: ListOperator[] = []

  // Skip initial newlines
  while (match(state, 'newline')) consume(state)

  const first = parsePipeline(state)
  if (first) {
    pipelines.push(first)

    while (true) {
      // Check for list operators
      if (match(state, 'operator', '&&') || match(state, 'operator', '||') ||
          match(state, 'operator', ';') || match(state, 'operator', '&')) {
        const op = consume(state).value as ListOperator
        operators.push(op)

        // Mark previous command as background if &
        if (op === '&' && pipelines.length > 0) {
          const lastPipeline = pipelines[pipelines.length - 1]
          if (lastPipeline.commands.length > 0) {
            const lastCmd = lastPipeline.commands[lastPipeline.commands.length - 1]
            if (lastCmd.type === 'command') {
              lastCmd.background = true
            }
          }
        }

        // Skip newlines after operator
        while (match(state, 'newline')) consume(state)

        const next = parsePipeline(state)
        if (next) {
          pipelines.push(next)
        } else {
          break
        }
      } else if (match(state, 'newline')) {
        consume(state)
        while (match(state, 'newline')) consume(state)

        // Check if there's more
        const next = parsePipeline(state)
        if (next) {
          operators.push(';')
          pipelines.push(next)
        } else {
          break
        }
      } else {
        break
      }
    }
  }

  const startPos = pipelines.length > 0 ? pipelines[0].start : 0
  const endPos = pipelines.length > 0 ? pipelines[pipelines.length - 1].end : 0

  return {
    type: 'list',
    raw: state.input.slice(startPos, endPos),
    pipelines,
    operators,
    start: startPos,
    end: endPos,
  }
}

/**
 * Parse a bash command string into an AST.
 *
 * @param input - The bash command string to parse
 * @returns The parsed AST (ListNode at the top level)
 *
 * @example
 * ```typescript
 * const ast = parseBashCommand('ls -la | grep foo && echo done')
 * // Returns a ListNode with two pipelines
 * ```
 */
export function parseBashCommand(input: string): ListNode {
  const tokens = tokenize(input)
  const state: ParserState = { tokens, pos: 0, input }
  return parseList(state)
}

// ============================================================================
// Safety Analyzer
// ============================================================================

/**
 * Commands considered dangerous by default.
 */
const DANGEROUS_COMMANDS = new Set([
  'rm', 'rmdir', 'dd', 'mkfs', 'fdisk', 'format',
  'shutdown', 'reboot', 'halt', 'poweroff', 'init',
  'kill', 'killall', 'pkill',
  'chmod', 'chown', 'chgrp',
  'mount', 'umount', 'mkswap', 'swapon', 'swapoff',
])

/**
 * Commands that are considered safe (read-only).
 */
const SAFE_COMMANDS = new Set([
  'cat', 'ls', 'pwd', 'echo', 'head', 'tail', 'wc',
  'grep', 'find', 'which', 'whereis', 'type', 'file',
  'date', 'whoami', 'hostname', 'uname', 'env', 'printenv',
  'basename', 'dirname', 'realpath', 'readlink',
])

/**
 * Commands with low impact (create files/dirs).
 */
const LOW_IMPACT_COMMANDS = new Set([
  'touch', 'mkdir', 'cp', 'tee',
])

/**
 * Commands with medium impact (modify files).
 */
const MEDIUM_IMPACT_COMMANDS = new Set([
  'mv', 'sed', 'awk', 'sort', 'uniq', 'cut', 'paste',
  'tr', 'patch', 'diff',
])

/**
 * Critical patterns that should ALWAYS be blocked, regardless of confirmation.
 * These patterns represent commands that could cause catastrophic, irreversible damage.
 */
const CRITICAL_PATTERNS: Array<{
  pattern: RegExp
  message: string
}> = [
  // rm -rf / or rm -rf /* (delete entire filesystem)
  { pattern: /\brm\s+(-[rfvI]+\s+)*\/\s*$/, message: 'Cannot execute rm targeting root filesystem' },
  { pattern: /\brm\s+(-[rfvI]+\s+)*\/\*/, message: 'Cannot execute rm with wildcard on root' },
  // rm -rf with --no-preserve-root (explicit bypass of safety)
  { pattern: /\brm\s+.*--no-preserve-root/, message: 'Cannot execute rm with --no-preserve-root' },
  // Fork bomb patterns
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, message: 'Fork bomb detected' },
  { pattern: /\.\(\)\s*\{\s*\.\s*\|\s*\.\s*&\s*\}\s*;\s*\./, message: 'Fork bomb variant detected' },
  // Writing random data to block devices
  { pattern: /\bdd\s+.*if=\/dev\/(u?random|zero)\s+.*of=\/dev\/[hs]d[a-z]/, message: 'Cannot write to disk device' },
  { pattern: /\bdd\s+.*of=\/dev\/[hs]d[a-z].*if=\/dev\/(u?random|zero)/, message: 'Cannot write to disk device' },
  // Overwriting MBR
  { pattern: /\bdd\s+.*of=\/dev\/[hs]d[a-z]\s+.*bs=\d+\s+.*count=1/, message: 'Cannot overwrite disk boot sector' },
  // mkfs on system devices without confirmation
  { pattern: /\bmkfs(\.\w+)?\s+(-[a-zA-Z]+\s+)*\/dev\/[hs]d[a-z]\d*/, message: 'Cannot format disk device' },
  // Direct writes to /dev/sda, /dev/hda, /dev/nvme, etc.
  { pattern: />\s*\/dev\/[hs]d[a-z]/, message: 'Cannot redirect output to disk device' },
  { pattern: />\s*\/dev\/nvme\d+n\d+/, message: 'Cannot redirect output to NVMe device' },
  // Kernel panic triggers
  { pattern: /echo\s+[cso]\s*>\s*\/proc\/sysrq-trigger/, message: 'Cannot trigger kernel sysrq' },
  // Memory bomb / consuming all memory
  { pattern: /\bwhile\s*\(\s*true\s*\)\s*;\s*do\s+\w+\s*=\s*\$\w+\$\w+/, message: 'Potential memory bomb detected' },
  // Overwriting critical boot files
  { pattern: />\s*\/boot\//, message: 'Cannot write to /boot' },
  { pattern: /\brm\s+(-[rfvI]+\s+)*\/boot/, message: 'Cannot delete /boot' },
  // System destruction via mv
  { pattern: /\bmv\s+\/\s+/, message: 'Cannot move root filesystem' },
  { pattern: /\bmv\s+(-[a-zA-Z]+\s+)*\/\s+/, message: 'Cannot move root filesystem' },
]

/**
 * Check if a command matches any critical pattern.
 * Returns the matching pattern info if found, null otherwise.
 */
function matchesCriticalPattern(input: string): { pattern: RegExp; message: string } | null {
  for (const { pattern, message } of CRITICAL_PATTERNS) {
    if (pattern.test(input)) {
      return { pattern, message }
    }
  }
  return null
}

/**
 * Check if a command argument represents a dangerous path.
 */
function isDangerousPath(arg: string): boolean {
  // Root path
  if (arg === '/' || arg === '/*') return true

  // Device paths
  if (arg.startsWith('/dev/')) return true

  // System directories
  const systemPaths = ['/etc', '/bin', '/sbin', '/usr', '/boot', '/lib', '/lib64', '/var', '/sys', '/proc']
  for (const path of systemPaths) {
    if (arg === path || arg.startsWith(path + '/')) return true
  }

  // Home directory
  if (arg === '~' || arg === '$HOME') return true

  return false
}

/**
 * Check if a redirect targets a dangerous path.
 */
function isDangerousRedirect(redirect: RedirectNode): boolean {
  const target = redirect.target.value

  // Device redirects
  if (target.startsWith('/dev/')) return true

  // System file redirects
  if (target.startsWith('/etc/')) return true

  return false
}

/**
 * Extract all commands from an AST.
 */
function extractCommands(ast: ASTNode): string[] {
  const commands: string[] = []

  function visit(node: ASTNode) {
    switch (node.type) {
      case 'command':
        if (node.name.value) {
          // Handle paths like /usr/bin/rm
          const name = node.name.value.split('/').pop() ?? node.name.value
          commands.push(name)
        }
        break
      case 'pipeline':
        node.commands.forEach(visit)
        break
      case 'list':
        node.pipelines.forEach(visit)
        break
      case 'subshell':
        visit(node.body)
        break
    }
  }

  visit(ast)
  return commands
}

/**
 * Analyze AST for safety issues.
 */
function findSafetyIssues(ast: ASTNode, blockedCommands: Set<string> = new Set(), originalInput?: string): SafetyIssue[] {
  const issues: SafetyIssue[] = []

  function visit(node: ASTNode) {
    switch (node.type) {
      case 'command': {
        const cmdName = node.name.value.split('/').pop() ?? node.name.value

        // Check blocked commands
        if (blockedCommands.has(cmdName)) {
          issues.push({
            type: 'blocked_command',
            message: `Command '${cmdName}' is blocked`,
            severity: 'critical',
            start: node.start,
            end: node.end,
          })
        }

        // Check dangerous commands
        if (DANGEROUS_COMMANDS.has(cmdName)) {
          issues.push({
            type: 'dangerous_command',
            message: `Command '${cmdName}' is potentially dangerous`,
            severity: 'high',
            start: node.start,
            end: node.end,
          })
        }

        // Check rm with dangerous flags/paths
        if (cmdName === 'rm') {
          const hasForceFlags = node.args.some(arg =>
            arg.value === '-rf' || arg.value === '-fr' ||
            arg.value.includes('r') && arg.value.includes('f') && arg.value.startsWith('-'))
          const hasDangerousPath = node.args.some(arg => isDangerousPath(arg.value))
          const hasWildcard = node.args.some(arg => arg.value.includes('*'))
          const hasRootPath = node.args.some(arg => arg.value === '/' || arg.value === '/*')
          const hasNoPreserveRoot = node.args.some(arg => arg.value === '--no-preserve-root')

          // Critical: rm targeting root or with --no-preserve-root
          if ((hasForceFlags && hasRootPath) || hasNoPreserveRoot) {
            issues.push({
              type: 'critical_pattern',
              message: `rm targeting root filesystem is always blocked`,
              severity: 'critical',
              critical: true,
              start: node.start,
              end: node.end,
            })
          } else if ((hasForceFlags && hasDangerousPath) || (hasForceFlags && hasWildcard)) {
            issues.push({
              type: 'data_destruction',
              message: `rm with recursive/force flags targeting dangerous path`,
              severity: 'critical',
              start: node.start,
              end: node.end,
            })
          }
        }

        // Check dd to device
        if (cmdName === 'dd') {
          const ofArg = node.args.find(arg => arg.value.startsWith('of='))
          if (ofArg && ofArg.value.includes('/dev/')) {
            // Check if it's writing to a block device (critical) vs a safe device like /dev/null
            const isSafeDevice = ['/dev/null', '/dev/zero', '/dev/random', '/dev/urandom'].some(d => ofArg.value.includes(d))
            if (!isSafeDevice) {
              issues.push({
                type: 'critical_pattern',
                message: `dd writing to device is always blocked`,
                severity: 'critical',
                critical: true,
                start: node.start,
                end: node.end,
              })
            }
          }
        }

        // Check chmod 777
        if (cmdName === 'chmod') {
          if (node.args.some(arg => arg.value === '777')) {
            issues.push({
              type: 'dangerous_pattern',
              message: `chmod 777 makes files world-writable`,
              severity: 'high',
              start: node.start,
              end: node.end,
            })
          }
        }

        // Check dangerous redirects
        for (const redirect of node.redirects) {
          if (isDangerousRedirect(redirect)) {
            issues.push({
              type: 'data_destruction',
              message: `Redirect to dangerous path: ${redirect.target.value}`,
              severity: 'high',
              start: redirect.start,
              end: redirect.end,
            })
          }
        }

        break
      }

      case 'pipeline': {
        // Check for curl/wget piped to shell (critical - remote code execution)
        const cmds = node.commands
        for (let i = 0; i < cmds.length - 1; i++) {
          const current = cmds[i]
          const next = cmds[i + 1]
          if (current.type === 'command' && next.type === 'command') {
            const currentName = current.name.value.split('/').pop()
            const nextName = next.name.value.split('/').pop()
            if ((currentName === 'curl' || currentName === 'wget') &&
                (nextName === 'bash' || nextName === 'sh' || nextName === 'zsh')) {
              issues.push({
                type: 'critical_pattern',
                message: `Piping ${currentName} output to shell is always blocked`,
                severity: 'critical',
                critical: true,
                start: node.start,
                end: node.end,
              })
            }
          }
        }
        node.commands.forEach(visit)
        break
      }

      case 'list':
        node.pipelines.forEach(visit)
        break

      case 'subshell':
        visit(node.body)
        break
    }
  }

  visit(ast)

  // Check for critical patterns in the original input
  const textToCheck = originalInput ?? ast.raw
  const criticalMatch = matchesCriticalPattern(textToCheck)
  if (criticalMatch) {
    issues.push({
      type: 'critical_pattern',
      message: criticalMatch.message,
      severity: 'critical',
      critical: true,
      start: 0,
      end: textToCheck.length,
    })
  }

  return issues
}

/**
 * Determine impact level from issues.
 */
function determineImpact(issues: SafetyIssue[], commands: string[]): ImpactLevel {
  // Check issues first
  if (issues.some(i => i.severity === 'critical')) return 'critical'
  if (issues.some(i => i.severity === 'high')) return 'high'
  if (issues.some(i => i.severity === 'medium')) return 'medium'
  if (issues.some(i => i.severity === 'low')) return 'low'

  // Check command types
  for (const cmd of commands) {
    if (DANGEROUS_COMMANDS.has(cmd)) return 'high'
    if (MEDIUM_IMPACT_COMMANDS.has(cmd)) return 'medium'
    if (LOW_IMPACT_COMMANDS.has(cmd)) return 'low'
  }

  // All safe commands
  if (commands.every(cmd => SAFE_COMMANDS.has(cmd))) return 'none'

  return 'none'
}

/**
 * Determine safety level from issues.
 * - 'critical': Has issues marked as critical (cannot be executed even with confirm)
 * - 'dangerous': Has issues but none are critical (can be executed with confirm)
 * - 'safe': No issues found
 */
function determineSafetyLevel(issues: SafetyIssue[]): SafetyLevel {
  if (issues.some(i => i.critical === true)) {
    return 'critical'
  }
  if (issues.length > 0) {
    return 'dangerous'
  }
  return 'safe'
}

/**
 * Analyze a bash command AST for safety.
 *
 * @param ast - The parsed AST to analyze
 * @param blockedCommands - Set of commands that are blocked
 * @param originalInput - Original input string for pattern matching
 * @returns Safety analysis result
 *
 * @example
 * ```typescript
 * const ast = parseBashCommand('rm -rf /')
 * const safety = analyzeASTSafety(ast)
 * if (safety.dangerous) {
 *   console.log(`Blocked: ${safety.reason}`)
 * }
 * ```
 */
export function analyzeASTSafety(
  ast: ListNode,
  blockedCommands: Set<string> = new Set(),
  originalInput?: string
): ASTSafetyAnalysis {
  const commands = extractCommands(ast)
  const issues = findSafetyIssues(ast, blockedCommands, originalInput)
  const impact = determineImpact(issues, commands)
  const safetyLevel = determineSafetyLevel(issues)
  const dangerous = issues.length > 0

  return {
    dangerous,
    safetyLevel,
    reason: issues.length > 0 ? issues[0].message : undefined,
    commands,
    impact,
    issues,
    ast,
  }
}

/**
 * Parse and analyze a bash command string for safety.
 *
 * This is a convenience function that combines parsing and analysis.
 *
 * @param input - The bash command string to analyze
 * @param blockedCommands - Set of commands that are blocked
 * @returns Safety analysis result
 *
 * @example
 * ```typescript
 * const result = parseAndAnalyze('rm -rf /')
 * if (result.dangerous) {
 *   console.log(`Command blocked: ${result.reason}`)
 * }
 * ```
 */
export function parseAndAnalyze(
  input: string,
  blockedCommands: Set<string> = new Set()
): ASTSafetyAnalysis {
  const ast = parseBashCommand(input)
  return analyzeASTSafety(ast, blockedCommands, input)
}
