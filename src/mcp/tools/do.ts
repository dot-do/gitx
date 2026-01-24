/**
 * @fileoverview Do Tool
 *
 * MCP tool for executing code in a sandboxed environment with access to git bindings.
 *
 * @module mcp/tools/do
 */

import { validateUserCode } from '../sandbox/template'
import { evaluateWithMiniflare } from '../sandbox/miniflare-evaluator'
import { ObjectStoreProxy } from '../sandbox/object-store-proxy'

// =============================================================================
// Git Binding Types
// =============================================================================

/**
 * Options for git.status()
 */
export interface GitStatusOptions {
  short?: boolean
  branch?: boolean
}

/**
 * Git status result
 */
export interface GitStatusResult {
  branch: string
  staged: string[]
  unstaged: string[]
  untracked?: string[]
  clean: boolean
}

/**
 * Options for git.log()
 */
export interface GitLogOptions {
  maxCount?: number
  oneline?: boolean
  ref?: string
  author?: string
  since?: string
  until?: string
  grep?: string
}

/**
 * Git log result
 */
export interface GitLogResult {
  commits?: Array<{
    sha: string
    message: string
    author?: string
    date?: string
  }>
}

/**
 * Options for git.diff()
 */
export interface GitDiffOptions {
  staged?: boolean
  commit1?: string
  commit2?: string
  path?: string
  stat?: boolean
  nameOnly?: boolean
}

/**
 * Options for git.show()
 */
export interface GitShowOptions {
  path?: string
  format?: 'commit' | 'raw' | 'diff'
  contextLines?: number
}

/**
 * Options for git.commit()
 */
export interface GitCommitOptions {
  message: string
  author?: string
  email?: string
  amend?: boolean
  allowEmpty?: boolean
}

/**
 * Options for git.add()
 */
export interface GitAddOptions {
  all?: boolean
  update?: boolean
  force?: boolean
}

/**
 * Options for git.checkout()
 */
export interface GitCheckoutOptions {
  createBranch?: boolean
  path?: string
}

/**
 * Options for git.branch()
 */
export interface GitBranchOptions {
  list?: boolean
  name?: string
  delete?: boolean
  force?: boolean
  all?: boolean
  remote?: boolean
}

/**
 * Git branch result
 */
export interface GitBranchResult {
  current?: string
  branches?: Array<{
    name: string
    sha?: string
    remote?: boolean
  }>
}

/**
 * Options for git.merge()
 */
export interface GitMergeOptions {
  noFf?: boolean
  squash?: boolean
  message?: string
  abort?: boolean
}

/**
 * Options for git.push()
 */
export interface GitPushOptions {
  remote?: string
  branch?: string
  force?: boolean
  setUpstream?: boolean
  tags?: boolean
  delete?: boolean
}

/**
 * Options for git.pull()
 */
export interface GitPullOptions {
  remote?: string
  branch?: string
  rebase?: boolean
  noCommit?: boolean
}

/**
 * Options for git.fetch()
 */
export interface GitFetchOptions {
  remote?: string
  all?: boolean
  prune?: boolean
  tags?: boolean
  depth?: number
}

/**
 * Options for git.clone()
 */
export interface GitCloneOptions {
  branch?: string
  depth?: number
  bare?: boolean
  mirror?: boolean
}

/**
 * Options for git.init()
 */
export interface GitInitOptions {
  bare?: boolean
  initialBranch?: string
}

/**
 * Git binding interface exposing git operations
 *
 * This is the primary interface for interacting with git repositories.
 * All methods return promises and support both read and write operations.
 */
export interface GitBinding {
  /** Get repository status */
  status(options?: GitStatusOptions): Promise<GitStatusResult>

  /** Get commit history */
  log(options?: GitLogOptions): Promise<GitLogResult>

  /** Show differences */
  diff(options?: GitDiffOptions): Promise<string | Record<string, unknown>>

  /** Show a git object (commit, tree, blob, tag) */
  show(revision: string, options?: GitShowOptions): Promise<Record<string, unknown>>

  /** Create a commit */
  commit(options: GitCommitOptions): Promise<{ sha: string }>

  /** Stage files */
  add(files: string | string[], options?: GitAddOptions): Promise<void>

  /** Checkout a branch or restore files */
  checkout(ref: string, options?: GitCheckoutOptions): Promise<void>

  /** List, create, or delete branches */
  branch(options?: GitBranchOptions): Promise<GitBranchResult>

  /** Merge branches */
  merge(branch: string, options?: GitMergeOptions): Promise<{ merged: boolean; conflicts?: string[] }>

  /** Push to remote */
  push(options?: GitPushOptions): Promise<{ pushed: boolean; remote?: string; branch?: string }>

  /** Pull from remote */
  pull(options?: GitPullOptions): Promise<{ pulled: boolean; commits?: number }>

  /** Fetch from remote */
  fetch(options?: GitFetchOptions): Promise<{ fetched: boolean; refs?: string[] }>

  /** Clone a repository */
  clone(url: string, options?: GitCloneOptions): Promise<{ cloned: boolean; path?: string }>

  /** Initialize a new repository */
  init(options?: GitInitOptions): Promise<{ initialized: boolean; path?: string }>
}

// =============================================================================
// DoScope Types
// =============================================================================

/**
 * Permissions for the sandbox environment
 */
export interface DoPermissions {
  allowNetwork?: boolean
  allowedHosts?: string[]
}

/**
 * DoScope configuration
 */
export interface GitScope {
  bindings: {
    git: GitBinding
    [key: string]: unknown
  }
  types: string
  timeout?: number
  permissions?: DoPermissions
}

// =============================================================================
// Tool Types
// =============================================================================

export interface DoToolInput {
  code: string
  timeout?: number
}

export interface DoToolOutput {
  success: boolean
  result?: unknown
  error?: string
  logs: string[]
  duration: number
}

/**
 * MCP Tool result format
 */
export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

// =============================================================================
// Type Definitions for LLM Context
// =============================================================================

const GIT_BINDING_TYPES = `
interface GitStatusOptions {
  short?: boolean
  branch?: boolean
}

interface GitStatusResult {
  branch: string
  staged: string[]
  unstaged: string[]
  untracked?: string[]
  clean: boolean
}

interface GitLogOptions {
  maxCount?: number
  oneline?: boolean
  ref?: string
  author?: string
  since?: string
  until?: string
  grep?: string
}

interface GitLogResult {
  commits?: Array<{
    sha: string
    message: string
    author?: string
    date?: string
  }>
}

interface GitDiffOptions {
  staged?: boolean
  commit1?: string
  commit2?: string
  path?: string
  stat?: boolean
  nameOnly?: boolean
}

interface GitShowOptions {
  path?: string
  format?: 'commit' | 'raw' | 'diff'
  contextLines?: number
}

interface GitCommitOptions {
  message: string
  author?: string
  email?: string
  amend?: boolean
  allowEmpty?: boolean
}

interface GitAddOptions {
  all?: boolean
  update?: boolean
  force?: boolean
}

interface GitCheckoutOptions {
  createBranch?: boolean
  path?: string
}

interface GitBranchOptions {
  list?: boolean
  name?: string
  delete?: boolean
  force?: boolean
  all?: boolean
  remote?: boolean
}

interface GitBranchResult {
  current?: string
  branches?: Array<{
    name: string
    sha?: string
    remote?: boolean
  }>
}

interface GitMergeOptions {
  noFf?: boolean
  squash?: boolean
  message?: string
  abort?: boolean
}

interface GitPushOptions {
  remote?: string
  branch?: string
  force?: boolean
  setUpstream?: boolean
  tags?: boolean
  delete?: boolean
}

interface GitPullOptions {
  remote?: string
  branch?: string
  rebase?: boolean
  noCommit?: boolean
}

interface GitFetchOptions {
  remote?: string
  all?: boolean
  prune?: boolean
  tags?: boolean
  depth?: number
}

interface GitCloneOptions {
  branch?: string
  depth?: number
  bare?: boolean
  mirror?: boolean
}

interface GitInitOptions {
  bare?: boolean
  initialBranch?: string
}

/**
 * Git binding - available as \`git\` in the sandbox
 */
declare const git: {
  status(options?: GitStatusOptions): Promise<GitStatusResult>
  log(options?: GitLogOptions): Promise<GitLogResult>
  diff(options?: GitDiffOptions): Promise<string | Record<string, unknown>>
  show(revision: string, options?: GitShowOptions): Promise<Record<string, unknown>>
  commit(options: GitCommitOptions): Promise<{ sha: string }>
  add(files: string | string[], options?: GitAddOptions): Promise<void>
  checkout(ref: string, options?: GitCheckoutOptions): Promise<void>
  branch(options?: GitBranchOptions): Promise<GitBranchResult>
  merge(branch: string, options?: GitMergeOptions): Promise<{ merged: boolean; conflicts?: string[] }>
  push(options?: GitPushOptions): Promise<{ pushed: boolean; remote?: string; branch?: string }>
  pull(options?: GitPullOptions): Promise<{ pulled: boolean; commits?: number }>
  fetch(options?: GitFetchOptions): Promise<{ fetched: boolean; refs?: string[] }>
  clone(url: string, options?: GitCloneOptions): Promise<{ cloned: boolean; path?: string }>
  init(options?: GitInitOptions): Promise<{ initialized: boolean; path?: string }>
}
`

// =============================================================================
// DoScope Factory
// =============================================================================

const DEFAULT_TIMEOUT = 5000

/**
 * Create a GitScope with the provided git binding
 */
export function createGitScope(git: GitBinding, options?: {
  timeout?: number
  permissions?: DoPermissions
}): GitScope {
  return {
    bindings: { git },
    types: GIT_BINDING_TYPES,
    timeout: options?.timeout ?? DEFAULT_TIMEOUT,
    permissions: options?.permissions
  }
}

// =============================================================================
// Security Validation
// =============================================================================

/**
 * Additional security validations beyond validateUserCode
 */
function validateSecurity(code: string): { valid: boolean; error?: string } {
  // Check for globalThis manipulation
  if (/\bglobalThis\b/.test(code)) {
    return { valid: false, error: 'globalThis access is forbidden' }
  }

  return { valid: true }
}

/**
 * Check for syntax errors in code
 */
function checkSyntax(code: string): { valid: boolean; error?: string } {
  try {
    // Try to parse the code as an async function body to support await
    new Function(`return (async () => { ${code} })()`)
    return { valid: true }
  } catch (e) {
    const error = e as Error
    return { valid: false, error: `Syntax error: ${error.message}` }
  }
}

// =============================================================================
// Tool Implementation
// =============================================================================

/**
 * Execute code with git binding available
 *
 * @param input - The code to execute and optional timeout
 * @param objectStore - Object store proxy for advanced operations
 * @returns Execution result
 */
export async function executeDo(
  input: DoToolInput,
  objectStore: ObjectStoreProxy
): Promise<DoToolOutput> {
  const startTime = performance.now()
  const timeout = input.timeout ?? DEFAULT_TIMEOUT

  // Validate empty code
  if (!input.code || input.code.trim() === '') {
    return {
      success: false,
      error: 'Code is required and cannot be empty',
      logs: [],
      duration: performance.now() - startTime
    }
  }

  // Validate code for dangerous patterns using the sandbox template validation
  const validation = validateUserCode(input.code)
  if (!validation.valid) {
    return {
      success: false,
      error: `Security: ${validation.error}`,
      logs: [],
      duration: performance.now() - startTime
    }
  }

  // Additional security checks
  const securityCheck = validateSecurity(input.code)
  if (!securityCheck.valid) {
    return {
      success: false,
      error: `Security: ${securityCheck.error}`,
      logs: [],
      duration: performance.now() - startTime
    }
  }

  // Check for syntax errors
  const syntaxCheck = checkSyntax(input.code)
  if (!syntaxCheck.valid) {
    return {
      success: false,
      error: syntaxCheck.error,
      logs: [],
      duration: performance.now() - startTime
    }
  }

  // Execute using miniflare evaluator - git binding is injected via the evaluator
  const result = await evaluateWithMiniflare(input.code, {
    timeout,
    objectStore
  })

  return {
    success: result.success,
    result: result.value,
    error: result.error,
    logs: result.logs,
    duration: result.duration
  }
}

/**
 * Create a do handler that uses the git scope
 */
export function createDoHandler(
  scope: GitScope
): (input: DoToolInput) => Promise<ToolResponse> {
  return async (input: DoToolInput): Promise<ToolResponse> => {
    const startTime = performance.now()
    const timeout = input.timeout ?? scope.timeout ?? DEFAULT_TIMEOUT

    // Validate empty code
    if (!input.code || input.code.trim() === '') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Code is required and cannot be empty',
            logs: [],
            duration: performance.now() - startTime
          }, null, 2)
        }],
        isError: true
      }
    }

    // Validate code for dangerous patterns
    const validation = validateUserCode(input.code)
    if (!validation.valid) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Security: ${validation.error}`,
            logs: [],
            duration: performance.now() - startTime
          }, null, 2)
        }],
        isError: true
      }
    }

    // Additional security checks
    const securityCheck = validateSecurity(input.code)
    if (!securityCheck.valid) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Security: ${securityCheck.error}`,
            logs: [],
            duration: performance.now() - startTime
          }, null, 2)
        }],
        isError: true
      }
    }

    // Check for syntax errors
    const syntaxCheck = checkSyntax(input.code)
    if (!syntaxCheck.valid) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: syntaxCheck.error,
            logs: [],
            duration: performance.now() - startTime
          }, null, 2)
        }],
        isError: true
      }
    }

    try {
      // Execute using the git binding from scope
      const git = scope.bindings.git
      const logs: string[] = []

      // Create sandbox with git binding
      const sandbox = {
        git,
        console: {
          log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
          error: (...args: unknown[]) => logs.push(`[ERROR] ${args.map(String).join(' ')}`),
          warn: (...args: unknown[]) => logs.push(`[WARN] ${args.map(String).join(' ')}`),
          info: (...args: unknown[]) => logs.push(`[INFO] ${args.map(String).join(' ')}`)
        }
      }

      // Wrap code in async function to support top-level await
      // The user code can use 'return' to return a value
      const wrappedCode = `(async () => { return (async () => { ${input.code} })() })()`

      // Execute with timeout
      const fn = new Function(...Object.keys(sandbox), `return ${wrappedCode}`)

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Execution timeout exceeded')), timeout)
      })

      const result = await Promise.race([
        fn(...Object.values(sandbox)),
        timeoutPromise
      ])

      const duration = performance.now() - startTime

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            result,
            logs,
            duration
          }, null, 2)
        }]
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const duration = performance.now() - startTime

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            logs: [],
            duration
          }, null, 2)
        }],
        isError: true
      }
    }
  }
}

/**
 * Do tool definition
 */
export const doToolDefinition = {
  name: 'do',
  description: 'Execute JavaScript code with access to the git binding. The `git` object is available with methods: status(), log(), diff(), show(), commit(), add(), checkout(), branch(), merge(), push(), pull(), fetch(), clone(), init()',
  inputSchema: {
    type: 'object' as const,
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute. The `git` binding is available for git operations.'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 5000)'
      }
    },
    required: ['code']
  }
}
