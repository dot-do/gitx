/**
 * @fileoverview Do Tool
 *
 * MCP tool for executing code in a sandboxed environment with access to git bindings.
 * Uses @dotdo/mcp's createDoHandler with ai-evaluate for secure V8 sandbox execution.
 *
 * @module mcp/tools/do
 */

import type { DoScope, DoPermissions, ToolResponse } from '@dotdo/mcp'
import { createDoHandler as createBaseDoHandler } from '@dotdo/mcp'

/**
 * Sandbox environment type for Cloudflare Workers.
 * This type is used when evaluating code in a sandboxed environment.
 */
type SandboxEnv = { LOADER?: unknown }
import { validateUserCode } from '../sandbox/template'
import { evaluateWithMiniflare } from '../sandbox/miniflare-evaluator'
import { ObjectStoreProxy } from '../sandbox/object-store-proxy'

// Import git binding types from the canonical location
import {
  type GitStatusOptions,
  type GitStatusResult,
  type GitLogOptions,
  type GitLogResult,
  type GitDiffOptions,
  type GitShowOptions,
  type GitCommitOptions,
  type GitAddOptions,
  type GitCheckoutOptions,
  type GitBranchOptions,
  type GitBranchResult,
  type GitMergeOptions,
  type GitPushOptions,
  type GitPullOptions,
  type GitFetchOptions,
  type GitCloneOptions,
  type GitInitOptions,
  type McpGitBinding,
  GIT_BINDING_TYPES,
} from '../../types/git-binding'

// Re-export types for consumers
export type {
  GitStatusOptions,
  GitStatusResult,
  GitLogOptions,
  GitLogResult,
  GitDiffOptions,
  GitShowOptions,
  GitCommitOptions,
  GitAddOptions,
  GitCheckoutOptions,
  GitBranchOptions,
  GitBranchResult,
  GitMergeOptions,
  GitPushOptions,
  GitPullOptions,
  GitFetchOptions,
  GitCloneOptions,
  GitInitOptions,
}

/**
 * Git binding interface exposing git operations
 *
 * @deprecated Use McpGitBinding from types/git-binding instead
 */
export type GitBinding = McpGitBinding

// =============================================================================
// DoScope Types (extends @dotdo/mcp DoScope with git-specific bindings)
// =============================================================================

// DoPermissions is imported from @dotdo/mcp
export type { DoPermissions }

/**
 * Git-specific DoScope configuration (extends DoScope with typed git binding)
 */
export interface GitScope extends DoScope {
  bindings: {
    git: GitBinding
    [key: string]: unknown
  }
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

// ToolResponse is imported from @dotdo/mcp
export type { ToolResponse }

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
  const scope: GitScope = {
    bindings: { git },
    types: GIT_BINDING_TYPES,
    timeout: options?.timeout ?? DEFAULT_TIMEOUT
  }
  if (options?.permissions !== undefined) {
    scope.permissions = options.permissions
  }
  return scope
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
    const errorResult: DoToolOutput = {
      success: false,
      logs: [],
      duration: performance.now() - startTime
    }
    if (validation.error) {
      errorResult.error = `Security: ${validation.error}`
    }
    return errorResult
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
    const syntaxResult: DoToolOutput = {
      success: false,
      logs: [],
      duration: performance.now() - startTime
    }
    if (syntaxCheck.error) {
      syntaxResult.error = syntaxCheck.error
    }
    return syntaxResult
  }

  // Execute using miniflare evaluator - git binding is injected via the evaluator
  const result = await evaluateWithMiniflare(input.code, {
    timeout,
    objectStore
  })

  const output: DoToolOutput = {
    success: result.success,
    result: result.value,
    logs: result.logs,
    duration: result.duration
  }
  if (result.error) {
    output.error = result.error
  }
  return output
}

/**
 * Create a do handler that uses the git scope
 *
 * Uses @dotdo/mcp's createDoHandler which leverages ai-evaluate for secure
 * V8 sandbox execution. In Cloudflare Workers, pass env with LOADER binding.
 * In Node.js/testing, ai-evaluate falls back to Miniflare automatically.
 *
 * @param scope - The GitScope with git binding and configuration
 * @param env - Optional worker environment with LOADER binding (from cloudflare:workers)
 * @returns Handler function for the do tool
 */
export function createDoHandler(
  scope: GitScope,
  _env?: SandboxEnv
): (input: DoToolInput) => Promise<ToolResponse> {
  // Use @dotdo/mcp's createDoHandler which uses ai-evaluate internally
  // The git binding is passed through scope.bindings and made available via RPC
  const baseHandler = createBaseDoHandler(scope)

  // Wrap to handle timeout parameter in DoToolInput
  return async (input: DoToolInput): Promise<ToolResponse> => {
    // If a custom timeout is specified, create a new scope with that timeout
    if (input.timeout !== undefined && input.timeout !== scope.timeout) {
      const scopeWithTimeout: GitScope = {
        ...scope,
        timeout: input.timeout
      }
      const handlerWithTimeout = createBaseDoHandler(scopeWithTimeout)
      return handlerWithTimeout({ code: input.code })
    }

    return baseHandler({ code: input.code })
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
