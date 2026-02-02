/**
 * @fileoverview Fetch Tool
 *
 * MCP tool for retrieving git resources by reference (commit, file, diff).
 *
 * @module mcp/tools/fetch
 */

import type { ToolResponse } from '@dotdo/mcp'
import type { GitBinding } from './do'

// Re-export ToolResponse for consumers
export type { ToolResponse }

/**
 * Resource types that can be fetched (git-specific)
 */
export type ResourceType = 'commit' | 'file' | 'diff' | 'tree' | 'blob'

/**
 * Fetch input parameters (git-specific, extends beyond @dotdo/mcp's generic FetchInput)
 */
export interface FetchInput {
  resource: string
  format?: 'json' | 'text' | 'raw'
}

/**
 * Fetch options (git-specific)
 */
export interface FetchOptions {
  format?: 'json' | 'text' | 'raw'
}

/**
 * Fetch result (git-specific, different from @dotdo/mcp's generic FetchResult)
 */
export interface FetchResult {
  type: ResourceType
  content: string
  metadata?: Record<string, unknown>
}

/**
 * Fetch tool definition
 */
export const fetchToolDefinition = {
  name: 'fetch',
  description: 'Retrieve a git resource by reference (commit SHA, branch:path, or diff specifier)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      resource: {
        type: 'string',
        description: 'Resource identifier. Formats: SHA (commit), ref:path (file content), ref1..ref2 (diff)'
      },
      format: {
        type: 'string',
        enum: ['json', 'text', 'raw'],
        description: 'Output format (default: json for structured data, text for content)'
      }
    },
    required: ['resource']
  }
}

/**
 * Parse resource identifier to determine type and components
 */
function parseResourceId(resource: string): {
  type: ResourceType
  ref?: string
  path?: string
  ref2?: string
} {
  // Diff format: ref1..ref2 or ref1...ref2
  if (resource.includes('..')) {
    const parts = resource.split(/\.{2,3}/)
    const result: { type: ResourceType; ref?: string; path?: string; ref2?: string } = {
      type: 'diff'
    }
    if (parts[0]) {
      result.ref = parts[0]
    }
    if (parts[1]) {
      result.ref2 = parts[1]
    }
    return result
  }

  // File format: ref:path
  if (resource.includes(':')) {
    const colonIndex = resource.indexOf(':')
    return {
      type: 'file',
      ref: resource.slice(0, colonIndex),
      path: resource.slice(colonIndex + 1)
    }
  }

  // Just a ref (commit SHA, branch name, tag)
  // Try to detect if it's a SHA (40 hex chars) or ref name
  if (/^[a-f0-9]{40}$/i.test(resource) || /^[a-f0-9]{7,}$/i.test(resource)) {
    return { type: 'commit', ref: resource }
  }

  // Treat as a ref that needs resolution
  return { type: 'commit', ref: resource }
}

/**
 * Fetch a commit by SHA or ref
 */
async function fetchCommit(
  git: GitBinding,
  ref: string
): Promise<FetchResult> {
  const result = await git.show(ref, { format: 'commit' })

  return {
    type: 'commit',
    content: JSON.stringify(result, null, 2),
    metadata: {
      sha: (result as Record<string, unknown>)['sha'],
      ref
    }
  }
}

/**
 * Fetch file content at a specific revision
 */
async function fetchFile(
  git: GitBinding,
  ref: string,
  path: string
): Promise<FetchResult> {
  const result = await git.show(`${ref}:${path}`)

  return {
    type: 'file',
    content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    metadata: {
      ref,
      path
    }
  }
}

/**
 * Fetch diff between two refs
 */
async function fetchDiff(
  git: GitBinding,
  ref1: string,
  ref2: string
): Promise<FetchResult> {
  const result = await git.diff({
    commit1: ref1,
    commit2: ref2
  })

  return {
    type: 'diff',
    content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    metadata: {
      from: ref1,
      to: ref2
    }
  }
}

/**
 * Create a fetch handler that uses the git binding
 */
export function createFetchHandler(
  git: GitBinding
): (input: FetchInput) => Promise<ToolResponse> {
  return async (input: FetchInput): Promise<ToolResponse> => {
    try {
      const parsed = parseResourceId(input.resource)
      let result: FetchResult

      switch (parsed.type) {
        case 'diff':
          result = await fetchDiff(git, parsed.ref!, parsed.ref2!)
          break
        case 'file':
          result = await fetchFile(git, parsed.ref!, parsed.path!)
          break
        case 'commit':
        default:
          result = await fetchCommit(git, parsed.ref!)
      }

      // Format output based on request
      if (input.format === 'raw' || input.format === 'text') {
        return {
          content: [{
            type: 'text',
            text: result.content
          }]
        }
      }

      // JSON format (default)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            type: result.type,
            content: result.content,
            metadata: result.metadata
          }, null, 2)
        }]
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: errorMessage })
        }],
        isError: true
      }
    }
  }
}

/**
 * Fetch tool instance (requires git binding to be set)
 */
export const fetchTool = fetchToolDefinition
