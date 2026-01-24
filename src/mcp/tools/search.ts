/**
 * @fileoverview Search Tool
 *
 * MCP tool for searching git repository content including commits, branches, and tags.
 *
 * @module mcp/tools/search
 */

import type { GitBinding } from './do'

/**
 * Search input parameters
 */
export interface SearchInput {
  query: string
  type?: 'commits' | 'branches' | 'tags' | 'all'
  limit?: number
}

/**
 * Search options
 */
export interface SearchOptions {
  type?: 'commits' | 'branches' | 'tags' | 'all'
  limit?: number
}

/**
 * Search result item
 */
export interface SearchResult {
  type: 'commit' | 'branch' | 'tag'
  ref: string
  message?: string
  author?: string
  date?: string
  sha?: string
}

/**
 * MCP Tool result format
 */
export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/**
 * Search tool definition
 */
export const searchToolDefinition = {
  name: 'search',
  description: 'Search git repository for commits, branches, or tags matching a query',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query (matches commit messages, branch names, tag names)'
      },
      type: {
        type: 'string',
        enum: ['commits', 'branches', 'tags', 'all'],
        description: 'Type of objects to search (default: all)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 20)',
        minimum: 1,
        maximum: 100
      }
    },
    required: ['query']
  }
}

/**
 * Search across commits, branches, and tags
 */
async function searchAll(
  git: GitBinding,
  query: string,
  limit: number
): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const queryLower = query.toLowerCase()

  // Search branches
  const branches = await git.branch({ all: true })
  if (branches.branches) {
    for (const branch of branches.branches) {
      if (branch.name.toLowerCase().includes(queryLower)) {
        results.push({
          type: 'branch',
          ref: branch.name,
          sha: branch.sha
        })
      }
      if (results.length >= limit) break
    }
  }

  // Search commits (if we have room for more results)
  if (results.length < limit) {
    const log = await git.log({ maxCount: limit * 2, grep: query })
    if (log.commits) {
      for (const commit of log.commits) {
        if (results.length >= limit) break
        results.push({
          type: 'commit',
          ref: commit.sha,
          sha: commit.sha,
          message: commit.message,
          author: commit.author,
          date: commit.date
        })
      }
    }
  }

  return results.slice(0, limit)
}

/**
 * Search commits only
 */
async function searchCommits(
  git: GitBinding,
  query: string,
  limit: number
): Promise<SearchResult[]> {
  const log = await git.log({ maxCount: limit, grep: query })
  if (!log.commits) return []

  return log.commits.map(commit => ({
    type: 'commit' as const,
    ref: commit.sha,
    sha: commit.sha,
    message: commit.message,
    author: commit.author,
    date: commit.date
  }))
}

/**
 * Search branches only
 */
async function searchBranches(
  git: GitBinding,
  query: string,
  limit: number
): Promise<SearchResult[]> {
  const queryLower = query.toLowerCase()
  const branches = await git.branch({ all: true })
  if (!branches.branches) return []

  return branches.branches
    .filter(b => b.name.toLowerCase().includes(queryLower))
    .slice(0, limit)
    .map(branch => ({
      type: 'branch' as const,
      ref: branch.name,
      sha: branch.sha
    }))
}

/**
 * Create a search handler that uses the git binding
 */
export function createSearchHandler(
  git: GitBinding
): (input: SearchInput) => Promise<ToolResponse> {
  return async (input: SearchInput): Promise<ToolResponse> => {
    try {
      const limit = input.limit ?? 20
      const searchType = input.type ?? 'all'

      let results: SearchResult[]

      switch (searchType) {
        case 'commits':
          results = await searchCommits(git, input.query, limit)
          break
        case 'branches':
          results = await searchBranches(git, input.query, limit)
          break
        case 'tags':
          // Tags search - similar to branches
          results = [] // TODO: Implement tag search when git.tag() is available
          break
        case 'all':
        default:
          results = await searchAll(git, input.query, limit)
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(results, null, 2)
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
 * Search tool instance (requires git binding to be set)
 */
export const searchTool = searchToolDefinition
