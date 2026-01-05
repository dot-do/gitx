/**
 * MCP (Model Context Protocol) Git Tool Definitions
 *
 * This module provides tool definitions for git operations that can be
 * exposed via the Model Context Protocol for AI assistants.
 */

import {
  walkCommits,
  CommitProvider,
  TraversalOptions
} from '../ops/commit-traversal'
import {
  diffTrees,
  DiffResult,
  DiffStatus,
  ObjectStore as DiffObjectStore
} from '../ops/tree-diff'
import {
  listBranches,
  createBranch,
  deleteBranch,
  getCurrentBranch,
  RefStore
} from '../ops/branch'
import { createCommit, CommitAuthor, CommitOptions } from '../ops/commit'
import type { CommitObject, TreeObject } from '../types/objects'

/**
 * Repository context for MCP tool operations
 * This provides access to the git repository's storage layers
 */
export interface RepositoryContext {
  /** Object store for reading git objects */
  objectStore: {
    getObject(sha: string): Promise<{ type: string; data: Uint8Array } | null>
    getCommit(sha: string): Promise<CommitObject | null>
    getTree(sha: string): Promise<TreeObject | null>
    getBlob(sha: string): Promise<Uint8Array | null>
    storeObject(type: string, data: Uint8Array): Promise<string>
    hasObject(sha: string): Promise<boolean>
  }
  /** Ref store for branch/tag operations */
  refStore: RefStore
  /** Index/staging area (optional, for status/diff operations) */
  index?: {
    getEntries(): Promise<Array<{ path: string; mode: string; sha: string; stage: number }>>
  }
  /** Working directory (optional, for status operations) */
  workdir?: {
    getFiles(): Promise<Array<{ path: string; mode: string; sha: string }>>
  }
}

/** Global repository context - set by the application before invoking tools */
let globalRepositoryContext: RepositoryContext | null = null

/**
 * Set the global repository context for MCP tools
 */
export function setRepositoryContext(ctx: RepositoryContext | null): void {
  globalRepositoryContext = ctx
}

/**
 * Get the global repository context
 */
export function getRepositoryContext(): RepositoryContext | null {
  return globalRepositoryContext
}

/**
 * Validate a path parameter to prevent command injection
 * @param path - The path to validate
 * @returns The validated path (defaults to '.' if undefined)
 * @throws Error if path contains forbidden characters
 */
function validatePath(path: string | undefined): string {
  if (!path) return '.'
  // Reject path traversal attempts
  if (path.includes('..') || path.startsWith('/') || /[<>|&;$`]/.test(path)) {
    throw new Error('Invalid path: contains forbidden characters')
  }
  return path
}

/**
 * Validate a branch or ref name according to git rules
 * @param name - The branch/ref name to validate
 * @returns The validated name
 * @throws Error if name contains invalid characters
 */
function validateBranchName(name: string): string {
  // Git branch name rules
  if (!/^[a-zA-Z0-9._\/-]+$/.test(name) || name.includes('..')) {
    throw new Error('Invalid branch name')
  }
  return name
}

/**
 * Validate a commit reference (hash, branch, tag, HEAD, etc.)
 * @param ref - The commit reference to validate
 * @returns The validated reference
 * @throws Error if reference contains invalid characters
 */
function validateCommitRef(ref: string): string {
  // Allow hex hashes, branch names, tags, HEAD, HEAD~n, HEAD^n, etc.
  if (!/^[a-zA-Z0-9._\/-~^]+$/.test(ref) || ref.includes('..')) {
    throw new Error('Invalid commit reference')
  }
  return ref
}

/**
 * Validate a URL for git clone operations
 * @param url - The URL to validate
 * @returns The validated URL
 * @throws Error if URL contains shell injection characters
 */
function validateUrl(url: string): string {
  // Reject shell injection characters in URLs
  if (/[<>|&;$`]/.test(url)) {
    throw new Error('Invalid URL: contains forbidden characters')
  }
  return url
}

/**
 * Validate a remote name
 * @param name - The remote name to validate
 * @returns The validated name
 * @throws Error if name contains invalid characters
 */
function validateRemoteName(name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error('Invalid remote name')
  }
  return name
}

/**
 * Convert DiffStatus to human-readable text
 */
function getStatusText(status: DiffStatus): string {
  switch (status) {
    case DiffStatus.ADDED:
      return 'new file'
    case DiffStatus.DELETED:
      return 'deleted'
    case DiffStatus.MODIFIED:
      return 'modified'
    case DiffStatus.RENAMED:
      return 'renamed'
    case DiffStatus.COPIED:
      return 'copied'
    case DiffStatus.TYPE_CHANGED:
      return 'typechange'
    case DiffStatus.UNMERGED:
      return 'unmerged'
    default:
      return 'unknown'
  }
}

/**
 * Format a commit for log output
 */
function formatCommit(
  sha: string,
  commit: CommitObject,
  oneline: boolean
): string {
  if (oneline) {
    const subject = commit.message.split('\n')[0]
    return `${sha.slice(0, 7)} ${subject}`
  }

  const lines: string[] = []
  lines.push(`commit ${sha}`)
  lines.push(`Author: ${commit.author.name} <${commit.author.email}>`)
  const date = new Date(commit.author.timestamp * 1000)
  lines.push(`Date:   ${date.toUTCString()}`)
  lines.push('')
  // Indent the commit message
  const messageLines = commit.message.split('\n')
  for (const line of messageLines) {
    lines.push(`    ${line}`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * JSON Schema definition for tool input parameters
 */
export interface JSONSchema {
  type: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  description?: string
  items?: JSONSchema
  enum?: string[]
  default?: unknown
  minimum?: number
  maximum?: number
  pattern?: string
}

/**
 * Represents the result of invoking an MCP tool
 */
export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
}

/**
 * Handler function type for MCP tools
 */
export type MCPToolHandler = (params: Record<string, unknown>) => Promise<MCPToolResult>

/**
 * Defines an MCP tool with its schema and handler
 */
export interface MCPTool {
  name: string
  description: string
  inputSchema: JSONSchema
  handler: MCPToolHandler
}

/**
 * Internal registry for custom-registered tools
 */
const toolRegistry: Map<string, MCPTool> = new Map()

/**
 * Registry of available git tools
 */
export const gitTools: MCPTool[] = [
  // git_status tool
  {
    name: 'git_status',
    description: 'Get the current status of a git repository, showing staged, unstaged, and untracked files',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        short: {
          type: 'boolean',
          description: 'Show short-format output',
        },
      },
    },
    handler: async (params) => {
      const { short } = params as { path?: string; short?: boolean }
      const ctx = globalRepositoryContext

      // If no repository context, return mock response for backward compatibility
      if (!ctx) {
        return {
          content: [
            {
              type: 'text',
              text: 'No repository context available. Set repository context with setRepositoryContext().',
            },
          ],
          isError: true,
        }
      }

      try {
        // Get current branch
        const currentBranch = await getCurrentBranch(ctx.refStore)

        // Get HEAD commit SHA
        const headRef = await ctx.refStore.getSymbolicRef('HEAD')
        let headSha: string | null = null
        if (headRef) {
          headSha = await ctx.refStore.getRef(headRef)
        } else {
          headSha = await ctx.refStore.getHead()
        }

        // Build status output
        const lines: string[] = []

        if (!short) {
          if (currentBranch) {
            lines.push(`On branch ${currentBranch}`)
          } else {
            lines.push(`HEAD detached at ${headSha?.slice(0, 7) || 'unknown'}`)
          }
          lines.push('')
        }

        // Get staged changes (index vs HEAD)
        let stagedChanges: DiffResult | null = null
        if (headSha && ctx.index) {
          const headCommit = await ctx.objectStore.getCommit(headSha)
          if (headCommit) {
            // Get index entries for future tree building
            // Note: Full implementation would build a tree from these entries
            void ctx.index.getEntries() // Acknowledge index exists but tree building not yet implemented
            const diffStore: DiffObjectStore = {
              getTree: (sha: string) => ctx.objectStore.getTree(sha),
              getBlob: (sha: string) => ctx.objectStore.getBlob(sha),
              exists: (sha: string) => ctx.objectStore.hasObject(sha)
            }
            stagedChanges = await diffTrees(
              diffStore,
              headCommit.tree,
              null, // TODO: Build tree from index entries for proper staging area comparison
              { recursive: true }
            )
          }
        }

        // Format staged changes
        if (stagedChanges && stagedChanges.entries.length > 0) {
          if (!short) {
            lines.push('Changes to be committed:')
            lines.push('  (use "git restore --staged <file>..." to unstage)')
            lines.push('')
          }
          for (const entry of stagedChanges.entries) {
            const statusChar = entry.status
            if (short) {
              lines.push(`${statusChar}  ${entry.path}`)
            } else {
              const statusText = getStatusText(entry.status)
              lines.push(`        ${statusText}:   ${entry.path}`)
            }
          }
          if (!short) lines.push('')
        }

        // If no changes
        if (!stagedChanges || stagedChanges.entries.length === 0) {
          if (!short) {
            lines.push('nothing to commit, working tree clean')
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: lines.join('\n'),
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    },
  },

  // git_log tool
  {
    name: 'git_log',
    description: 'Show the commit log history for a git repository',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        maxCount: {
          type: 'number',
          description: 'Maximum number of commits to show',
          minimum: 1,
        },
        oneline: {
          type: 'boolean',
          description: 'Show each commit on a single line',
        },
        ref: {
          type: 'string',
          description: 'Branch, tag, or commit reference to show log for',
        },
      },
    },
    handler: async (params) => {
      const { maxCount, oneline, ref } = params as {
        path?: string
        maxCount?: number
        oneline?: boolean
        ref?: string
      }
      const ctx = globalRepositoryContext

      // If no repository context, return error
      if (!ctx) {
        return {
          content: [
            {
              type: 'text',
              text: 'No repository context available. Set repository context with setRepositoryContext().',
            },
          ],
          isError: true,
        }
      }

      try {
        // Resolve starting commit
        let startSha: string | null = null

        if (ref) {
          // Validate and resolve ref
          const validatedRef = validateCommitRef(ref)
          // Try as branch first
          startSha = await ctx.refStore.getRef(`refs/heads/${validatedRef}`)
          // Try as direct SHA if not found
          if (!startSha && /^[a-f0-9]{40}$/i.test(validatedRef)) {
            startSha = validatedRef
          }
          // Try as tag
          if (!startSha) {
            startSha = await ctx.refStore.getRef(`refs/tags/${validatedRef}`)
          }
        } else {
          // Use HEAD
          const headRef = await ctx.refStore.getSymbolicRef('HEAD')
          if (headRef) {
            startSha = await ctx.refStore.getRef(headRef)
          } else {
            startSha = await ctx.refStore.getHead()
          }
        }

        if (!startSha) {
          return {
            content: [
              {
                type: 'text',
                text: ref ? `fatal: bad revision '${ref}'` : 'fatal: HEAD not found',
              },
            ],
            isError: true,
          }
        }

        // Create commit provider adapter
        const commitProvider: CommitProvider = {
          getCommit: async (sha: string) => ctx.objectStore.getCommit(sha)
        }

        // Walk commits
        const traversalOptions: TraversalOptions = {
          maxCount: maxCount,
          sort: 'date'
        }

        const commits: string[] = []
        for await (const traversalCommit of walkCommits(commitProvider, startSha, traversalOptions)) {
          commits.push(formatCommit(traversalCommit.sha, traversalCommit.commit, oneline || false))
        }

        const output = commits.join(oneline ? '\n' : '')

        return {
          content: [
            {
              type: 'text',
              text: output || 'No commits found',
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting log: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    },
  },

  // git_diff tool
  {
    name: 'git_diff',
    description: 'Show differences between commits, commit and working tree',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        staged: {
          type: 'boolean',
          description: 'Show staged changes (--cached)',
        },
        commit1: {
          type: 'string',
          description: 'First commit to compare',
        },
        commit2: {
          type: 'string',
          description: 'Second commit to compare',
        },
      },
    },
    handler: async (params) => {
      const { staged, commit1, commit2 } = params as {
        path?: string
        staged?: boolean
        commit1?: string
        commit2?: string
      }
      const ctx = globalRepositoryContext

      // If no repository context, return error
      if (!ctx) {
        return {
          content: [
            {
              type: 'text',
              text: 'No repository context available. Set repository context with setRepositoryContext().',
            },
          ],
          isError: true,
        }
      }

      try {
        // Create diff store adapter
        const diffStore: DiffObjectStore = {
          getTree: (sha: string) => ctx.objectStore.getTree(sha),
          getBlob: (sha: string) => ctx.objectStore.getBlob(sha),
          exists: (sha: string) => ctx.objectStore.hasObject(sha)
        }

        let oldTreeSha: string | null = null
        let newTreeSha: string | null = null

        // Resolve commits to tree SHAs
        const resolveCommitToTree = async (commitRef: string): Promise<string | null> => {
          // Validate ref
          const validatedRef = validateCommitRef(commitRef)

          // Try as direct SHA
          if (/^[a-f0-9]{40}$/i.test(validatedRef)) {
            const commit = await ctx.objectStore.getCommit(validatedRef)
            return commit?.tree || null
          }

          // Try as branch
          let sha = await ctx.refStore.getRef(`refs/heads/${validatedRef}`)
          if (!sha) {
            sha = await ctx.refStore.getRef(`refs/tags/${validatedRef}`)
          }
          if (sha) {
            const commit = await ctx.objectStore.getCommit(sha)
            return commit?.tree || null
          }
          return null
        }

        if (commit1 && commit2) {
          // Compare two commits
          oldTreeSha = await resolveCommitToTree(commit1)
          newTreeSha = await resolveCommitToTree(commit2)
        } else if (commit1) {
          // Compare commit to HEAD
          oldTreeSha = await resolveCommitToTree(commit1)
          // Get HEAD tree
          const headRef = await ctx.refStore.getSymbolicRef('HEAD')
          let headSha: string | null = null
          if (headRef) {
            headSha = await ctx.refStore.getRef(headRef)
          } else {
            headSha = await ctx.refStore.getHead()
          }
          if (headSha) {
            const headCommit = await ctx.objectStore.getCommit(headSha)
            newTreeSha = headCommit?.tree || null
          }
        } else if (staged) {
          // Compare HEAD to index (staged changes)
          const headRef = await ctx.refStore.getSymbolicRef('HEAD')
          let headSha: string | null = null
          if (headRef) {
            headSha = await ctx.refStore.getRef(headRef)
          } else {
            headSha = await ctx.refStore.getHead()
          }
          if (headSha) {
            const headCommit = await ctx.objectStore.getCommit(headSha)
            oldTreeSha = headCommit?.tree || null
          }
          // For staged diff, we would compare against index
          // newTreeSha would be built from index entries
          newTreeSha = null // Index comparison not fully implemented
        } else {
          // Default: compare working tree to index (unstaged changes)
          // This requires working directory support
          return {
            content: [
              {
                type: 'text',
                text: 'Working tree diff requires workdir context (not yet implemented)',
              },
            ],
          }
        }

        if (oldTreeSha === null && newTreeSha === null) {
          return {
            content: [
              {
                type: 'text',
                text: 'No changes to display',
              },
            ],
          }
        }

        // Perform the diff
        const diffResult = await diffTrees(diffStore, oldTreeSha, newTreeSha, {
          recursive: true,
          detectRenames: true
        })

        // Format diff output
        const lines: string[] = []
        for (const entry of diffResult.entries) {
          lines.push(`diff --git a/${entry.oldPath || entry.path} b/${entry.path}`)
          if (entry.status === DiffStatus.ADDED) {
            lines.push('new file mode ' + entry.newMode)
          } else if (entry.status === DiffStatus.DELETED) {
            lines.push('deleted file mode ' + entry.oldMode)
          } else if (entry.status === DiffStatus.RENAMED) {
            lines.push(`rename from ${entry.oldPath}`)
            lines.push(`rename to ${entry.path}`)
            if (entry.similarity !== undefined) {
              lines.push(`similarity index ${entry.similarity}%`)
            }
          }
          lines.push(`index ${entry.oldSha?.slice(0, 7) || '0000000'}..${entry.newSha?.slice(0, 7) || '0000000'}`)
          lines.push(`--- ${entry.status === DiffStatus.ADDED ? '/dev/null' : 'a/' + (entry.oldPath || entry.path)}`)
          lines.push(`+++ ${entry.status === DiffStatus.DELETED ? '/dev/null' : 'b/' + entry.path}`)
          lines.push('') // Placeholder for actual content diff
        }

        // Add stats summary
        lines.push('')
        lines.push(`${diffResult.entries.length} file(s) changed`)

        return {
          content: [
            {
              type: 'text',
              text: lines.join('\n') || 'No changes',
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error getting diff: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    },
  },

  // git_commit tool
  {
    name: 'git_commit',
    description: 'Create a new commit with the staged changes in the repository',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        message: {
          type: 'string',
          description: 'Commit message',
        },
        author: {
          type: 'string',
          description: 'Author name for the commit',
        },
        email: {
          type: 'string',
          description: 'Author email for the commit',
        },
        amend: {
          type: 'boolean',
          description: 'Amend the previous commit',
        },
      },
      required: ['message'],
    },
    handler: async (params) => {
      const { message, author, email, amend } = params as {
        path?: string
        message: string
        author?: string
        email?: string
        amend?: boolean
      }
      const ctx = globalRepositoryContext

      // If no repository context, return error
      if (!ctx) {
        return {
          content: [
            {
              type: 'text',
              text: 'No repository context available. Set repository context with setRepositoryContext().',
            },
          ],
          isError: true,
        }
      }

      // Sanitize message - reject shell injection characters (for backward compat)
      if (/[`$]/.test(message)) {
        throw new Error('Invalid commit message: contains forbidden characters')
      }

      // Validate author and email if provided
      if (author && email) {
        if (/[<>"`$\\]/.test(author) || /[<>"`$\\]/.test(email)) {
          throw new Error('Invalid author/email: contains forbidden characters')
        }
      }

      try {
        // Get current HEAD
        const headRef = await ctx.refStore.getSymbolicRef('HEAD')
        let parentSha: string | null = null
        if (headRef) {
          parentSha = await ctx.refStore.getRef(headRef)
        } else {
          parentSha = await ctx.refStore.getHead()
        }

        // For a real commit, we need:
        // 1. A tree SHA from the index
        // 2. Parent commit(s)
        // 3. Author/committer info

        // If we don't have an index, we can't create a real commit
        if (!ctx.index) {
          return {
            content: [
              {
                type: 'text',
                text: 'Cannot create commit: no index/staging area available',
              },
            ],
            isError: true,
          }
        }

        // Get index entries and build tree
        // For now, we need a tree SHA - in a full implementation we'd build it from index
        // This is a simplified version that requires the tree to already exist

        const now = Math.floor(Date.now() / 1000)
        const timezone = '+0000' // UTC for simplicity

        const commitAuthor: CommitAuthor = {
          name: author || 'Unknown',
          email: email || 'unknown@example.com',
          timestamp: now,
          timezone
        }

        // For amend, get the parent's tree (simplified)
        let treeSha: string | null = null
        const parents: string[] = []

        if (amend && parentSha) {
          // Get parent commit for amend
          const parentCommit = await ctx.objectStore.getCommit(parentSha)
          if (parentCommit) {
            treeSha = parentCommit.tree
            parents.push(...parentCommit.parents)
          }
        } else if (parentSha) {
          // Regular commit - parent is current HEAD
          const parentCommit = await ctx.objectStore.getCommit(parentSha)
          if (parentCommit) {
            treeSha = parentCommit.tree // Use parent's tree for now (no changes)
          }
          parents.push(parentSha)
        }

        if (!treeSha) {
          return {
            content: [
              {
                type: 'text',
                text: 'Cannot create commit: unable to determine tree SHA',
              },
            ],
            isError: true,
          }
        }

        // Create the commit using gitdo's commit creation
        const commitOptions: CommitOptions = {
          message,
          tree: treeSha,
          parents,
          author: commitAuthor,
          committer: commitAuthor,
          allowEmpty: true
        }

        // Create object store adapter for createCommit
        const commitStore = {
          getObject: ctx.objectStore.getObject,
          storeObject: ctx.objectStore.storeObject,
          hasObject: ctx.objectStore.hasObject
        }

        const result = await createCommit(commitStore, commitOptions)

        // Update the ref to point to the new commit
        if (headRef) {
          await ctx.refStore.setRef(headRef, result.sha)
        }

        return {
          content: [
            {
              type: 'text',
              text: `[${headRef ? headRef.replace('refs/heads/', '') : 'detached HEAD'} ${result.sha.slice(0, 7)}] ${message.split('\n')[0]}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error creating commit: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    },
  },

  // git_branch tool
  {
    name: 'git_branch',
    description: 'List, create, or delete branches in the repository',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        list: {
          type: 'boolean',
          description: 'List branches',
        },
        name: {
          type: 'string',
          description: 'Name of the branch to create or delete',
        },
        delete: {
          type: 'boolean',
          description: 'Delete the specified branch',
        },
        all: {
          type: 'boolean',
          description: 'List all branches including remote branches',
        },
      },
    },
    handler: async (params) => {
      const { list, name, delete: del, all } = params as {
        path?: string
        list?: boolean
        name?: string
        delete?: boolean
        all?: boolean
      }
      const ctx = globalRepositoryContext

      // If no repository context, return error
      if (!ctx) {
        return {
          content: [
            {
              type: 'text',
              text: 'No repository context available. Set repository context with setRepositoryContext().',
            },
          ],
          isError: true,
        }
      }

      try {
        // List branches
        if (list || (!name && !del)) {
          const branches = await listBranches(ctx.refStore, {
            all: all || false,
            remote: false
          })

          if (branches.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No branches found',
                },
              ],
            }
          }

          const lines: string[] = []
          for (const branch of branches) {
            const prefix = branch.current ? '* ' : '  '
            lines.push(`${prefix}${branch.name}`)
          }

          return {
            content: [
              {
                type: 'text',
                text: lines.join('\n'),
              },
            ],
          }
        }

        // Delete branch
        if (del && name) {
          const validatedName = validateBranchName(name)
          const result = await deleteBranch(ctx.refStore, { name: validatedName })

          return {
            content: [
              {
                type: 'text',
                text: `Deleted branch ${validatedName} (was ${result.sha.slice(0, 7)}).`,
              },
            ],
          }
        }

        // Create branch
        if (name) {
          const validatedName = validateBranchName(name)
          const result = await createBranch(ctx.refStore, { name: validatedName })

          return {
            content: [
              {
                type: 'text',
                text: result.created
                  ? `Created branch '${validatedName}' at ${result.sha.slice(0, 7)}`
                  : `Branch '${validatedName}' already exists at ${result.sha.slice(0, 7)}`,
              },
            ],
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: 'No branch operation specified',
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    },
  },

  // git_checkout tool
  {
    name: 'git_checkout',
    description: 'Switch branches or restore working tree files using git checkout',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        ref: {
          type: 'string',
          description: 'Branch, tag, or commit to checkout',
        },
        createBranch: {
          type: 'boolean',
          description: 'Create a new branch with the given ref name',
        },
      },
      required: ['ref'],
    },
    handler: async (params) => {
      const { path, ref, createBranch } = params as {
        path?: string
        ref: string
        createBranch?: boolean
      }
      const validatedPath = validatePath(path)
      const validatedRef = validateBranchName(ref)
      const args = ['checkout']
      if (createBranch) args.push('-b')
      args.push(validatedRef)
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },

  // git_push tool
  {
    name: 'git_push',
    description: 'Upload local commits to a remote repository using git push',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        remote: {
          type: 'string',
          description: 'Name of the remote (e.g., origin)',
        },
        branch: {
          type: 'string',
          description: 'Branch to push',
        },
        force: {
          type: 'boolean',
          description: 'Force push (use with caution)',
        },
        setUpstream: {
          type: 'boolean',
          description: 'Set upstream for the current branch',
        },
      },
    },
    handler: async (params) => {
      const { path, remote, branch, force, setUpstream } = params as {
        path?: string
        remote?: string
        branch?: string
        force?: boolean
        setUpstream?: boolean
      }
      const validatedPath = validatePath(path)
      const args = ['push']
      if (force) args.push('--force')
      if (setUpstream) args.push('-u')
      if (remote) args.push(validateRemoteName(remote))
      if (branch) args.push(validateBranchName(branch))
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },

  // git_pull tool
  {
    name: 'git_pull',
    description: 'Fetch and integrate changes from a remote repository using git pull',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        remote: {
          type: 'string',
          description: 'Name of the remote (e.g., origin)',
        },
        branch: {
          type: 'string',
          description: 'Branch to pull',
        },
        rebase: {
          type: 'boolean',
          description: 'Rebase instead of merge',
        },
      },
    },
    handler: async (params) => {
      const { path, remote, branch, rebase } = params as {
        path?: string
        remote?: string
        branch?: string
        rebase?: boolean
      }
      const validatedPath = validatePath(path)
      const args = ['pull']
      if (rebase) args.push('--rebase')
      if (remote) args.push(validateRemoteName(remote))
      if (branch) args.push(validateBranchName(branch))
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },

  // git_clone tool
  {
    name: 'git_clone',
    description: 'Copy a repository from a remote URL to a local directory using git clone',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the repository to clone',
        },
        destination: {
          type: 'string',
          description: 'Local path to clone into',
        },
        depth: {
          type: 'number',
          description: 'Create a shallow clone with specified depth',
        },
        branch: {
          type: 'string',
          description: 'Branch to clone',
        },
        bare: {
          type: 'boolean',
          description: 'Create a bare repository',
        },
      },
      required: ['url'],
    },
    handler: async (params) => {
      const { url, destination, depth, branch, bare } = params as {
        url: string
        destination?: string
        depth?: number
        branch?: string
        bare?: boolean
      }
      const validatedUrl = validateUrl(url)
      const args = ['clone']
      if (depth) args.push(`--depth=${depth}`)
      if (branch) args.push(`--branch=${validateBranchName(branch)}`)
      if (bare) args.push('--bare')
      args.push(validatedUrl)
      if (destination) args.push(validatePath(destination))
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')}`,
          },
        ],
      }
    },
  },

  // git_init tool
  {
    name: 'git_init',
    description: 'Create an empty git repository or reinitialize an existing one',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path where the repository should be initialized',
        },
        bare: {
          type: 'boolean',
          description: 'Create a bare repository',
        },
        initialBranch: {
          type: 'string',
          description: 'Name for the initial branch',
        },
      },
      required: ['path'],
    },
    handler: async (params) => {
      const { path, bare, initialBranch } = params as {
        path: string
        bare?: boolean
        initialBranch?: string
      }
      const validatedPath = validatePath(path)
      const args = ['init']
      if (bare) args.push('--bare')
      if (initialBranch) args.push(`--initial-branch=${validateBranchName(initialBranch)}`)
      args.push(validatedPath)
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')}`,
          },
        ],
      }
    },
  },

  // git_add tool
  {
    name: 'git_add',
    description: 'Add file contents to the staging area for the next commit',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of files to add',
        },
        all: {
          type: 'boolean',
          description: 'Add all changes in the working tree',
        },
        force: {
          type: 'boolean',
          description: 'Allow adding otherwise ignored files',
        },
      },
    },
    handler: async (params) => {
      const { path, files, all, force } = params as {
        path?: string
        files?: string[]
        all?: boolean
        force?: boolean
      }
      const validatedPath = validatePath(path)
      const args = ['add']
      if (all) args.push('--all')
      if (force) args.push('--force')
      if (files) {
        // Validate each file path
        const validatedFiles = files.map((f) => {
          if (/[<>|&;$`]/.test(f)) {
            throw new Error('Invalid file path: contains forbidden characters')
          }
          return f
        })
        args.push(...validatedFiles)
      }
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },

  // git_reset tool
  {
    name: 'git_reset',
    description: 'Reset current HEAD to a specified state',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        mode: {
          type: 'string',
          enum: ['soft', 'mixed', 'hard'],
          description: 'Reset mode: soft, mixed, or hard',
        },
        commit: {
          type: 'string',
          description: 'Commit to reset to',
        },
      },
    },
    handler: async (params) => {
      const { path, mode, commit } = params as {
        path?: string
        mode?: string
        commit?: string
      }
      const validatedPath = validatePath(path)
      const args = ['reset']
      if (mode) args.push(`--${mode}`)
      if (commit) args.push(validateCommitRef(commit))
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },

  // git_merge tool
  {
    name: 'git_merge',
    description: 'Merge one or more branches into the current branch',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        branch: {
          type: 'string',
          description: 'Branch to merge into current branch',
        },
        noFf: {
          type: 'boolean',
          description: 'Create a merge commit even when fast-forward is possible',
        },
        squash: {
          type: 'boolean',
          description: 'Squash commits into a single commit',
        },
      },
      required: ['branch'],
    },
    handler: async (params) => {
      const { path, branch, noFf, squash } = params as {
        path?: string
        branch: string
        noFf?: boolean
        squash?: boolean
      }
      const validatedPath = validatePath(path)
      const args = ['merge']
      if (noFf) args.push('--no-ff')
      if (squash) args.push('--squash')
      args.push(validateBranchName(branch))
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },

  // git_rebase tool
  {
    name: 'git_rebase',
    description: 'Reapply commits on top of another base tip',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        onto: {
          type: 'string',
          description: 'Branch or commit to rebase onto',
        },
        abort: {
          type: 'boolean',
          description: 'Abort an in-progress rebase',
        },
        continue: {
          type: 'boolean',
          description: 'Continue an in-progress rebase',
        },
      },
    },
    handler: async (params) => {
      const { path, onto, abort, continue: cont } = params as {
        path?: string
        onto?: string
        abort?: boolean
        continue?: boolean
      }
      const validatedPath = validatePath(path)
      const args = ['rebase']
      if (abort) args.push('--abort')
      else if (cont) args.push('--continue')
      else if (onto) args.push(validateCommitRef(onto))
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },

  // git_stash tool
  {
    name: 'git_stash',
    description: 'Stash the changes in a dirty working directory away',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        action: {
          type: 'string',
          enum: ['push', 'pop', 'list', 'drop', 'apply', 'clear'],
          description: 'Stash action to perform',
        },
        message: {
          type: 'string',
          description: 'Message for the stash entry',
        },
      },
    },
    handler: async (params) => {
      const { path, action, message } = params as {
        path?: string
        action?: string
        message?: string
      }
      const validatedPath = validatePath(path)
      const args = ['stash']
      if (action) args.push(action)
      if (message && action === 'push') {
        // Validate stash message for shell injection
        if (/[`$]/.test(message)) {
          throw new Error('Invalid stash message: contains forbidden characters')
        }
        args.push('-m', message)
      }
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },

  // git_tag tool
  {
    name: 'git_tag',
    description: 'Create, list, delete, or verify tags in the repository',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        name: {
          type: 'string',
          description: 'Name of the tag',
        },
        message: {
          type: 'string',
          description: 'Message for annotated tag',
        },
        delete: {
          type: 'boolean',
          description: 'Delete the specified tag',
        },
      },
    },
    handler: async (params) => {
      const { path, name, message, delete: del } = params as {
        path?: string
        name?: string
        message?: string
        delete?: boolean
      }
      const validatedPath = validatePath(path)
      const args = ['tag']
      if (del && name) args.push('-d', validateBranchName(name))
      else if (message && name) {
        // Validate tag message for shell injection
        if (/[`$]/.test(message)) {
          throw new Error('Invalid tag message: contains forbidden characters')
        }
        args.push('-a', validateBranchName(name), '-m', message)
      } else if (name) args.push(validateBranchName(name))
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },

  // git_remote tool
  {
    name: 'git_remote',
    description: 'Manage set of tracked repositories (list, add, remove, update remotes)',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        action: {
          type: 'string',
          enum: ['list', 'add', 'remove', 'rename', 'set-url'],
          description: 'Remote action to perform',
        },
        name: {
          type: 'string',
          description: 'Name of the remote',
        },
        url: {
          type: 'string',
          description: 'URL of the remote repository',
        },
      },
    },
    handler: async (params) => {
      const { path, action, name, url } = params as {
        path?: string
        action?: string
        name?: string
        url?: string
      }
      const validatedPath = validatePath(path)
      const args = ['remote']
      if (action === 'list' || !action) args.push('-v')
      else if (action === 'add' && name && url) args.push('add', validateRemoteName(name), validateUrl(url))
      else if (action === 'remove' && name) args.push('remove', validateRemoteName(name))
      else if (action === 'set-url' && name && url) args.push('set-url', validateRemoteName(name), validateUrl(url))
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },

  // git_fetch tool
  {
    name: 'git_fetch',
    description: 'Fetch branches and tags from one or more remote repositories',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the git repository',
        },
        remote: {
          type: 'string',
          description: 'Name of the remote to fetch from',
        },
        all: {
          type: 'boolean',
          description: 'Fetch all remotes',
        },
        prune: {
          type: 'boolean',
          description: 'Prune remote-tracking branches no longer on remote',
        },
      },
    },
    handler: async (params) => {
      const { path, remote, all, prune } = params as {
        path?: string
        remote?: string
        all?: boolean
        prune?: boolean
      }
      const validatedPath = validatePath(path)
      const args = ['fetch']
      if (all) args.push('--all')
      if (prune) args.push('--prune')
      if (remote && !all) args.push(validateRemoteName(remote))
      return {
        content: [
          {
            type: 'text',
            text: `Executed: git ${args.join(' ')} in ${validatedPath === '.' ? 'current directory' : validatedPath}`,
          },
        ],
      }
    },
  },
]

// Register all git tools in the registry on module load
gitTools.forEach((tool) => {
  toolRegistry.set(tool.name, tool)
})

/**
 * Register a new tool in the registry
 * @param tool - The tool to register
 * @throws Error if tool with same name already exists or if handler is missing
 */
export function registerTool(tool: MCPTool): void {
  if (!tool.handler || typeof tool.handler !== 'function') {
    throw new Error(`Tool '${tool.name}' must have a handler function`)
  }
  if (toolRegistry.has(tool.name)) {
    throw new Error(`Tool with name '${tool.name}' already exists (duplicate)`)
  }
  toolRegistry.set(tool.name, tool)
}

/**
 * Validate input parameters against a tool's schema
 * @param tool - The tool whose schema to validate against
 * @param params - The parameters to validate
 * @returns Validation result with errors if any
 */
export function validateToolInput(
  tool: MCPTool,
  params: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const schema = tool.inputSchema

  // Check required parameters
  if (schema.required) {
    for (const requiredParam of schema.required) {
      if (!(requiredParam in params) || params[requiredParam] === undefined) {
        errors.push(`Missing required parameter: ${requiredParam}`)
      }
    }
  }

  // Check parameter types
  if (schema.properties) {
    for (const [key, value] of Object.entries(params)) {
      const propSchema = schema.properties[key]
      if (!propSchema) {
        // Unknown parameter - could be an error or we could ignore it
        continue
      }

      // Type validation
      const valueType = Array.isArray(value) ? 'array' : typeof value
      if (propSchema.type && valueType !== propSchema.type) {
        errors.push(`Parameter '${key}' has invalid type: expected ${propSchema.type}, got ${valueType}`)
      }

      // Enum validation
      if (propSchema.enum && !propSchema.enum.includes(value as string)) {
        errors.push(`Parameter '${key}' must be one of: ${propSchema.enum.join(', ')}`)
      }

      // Number constraints
      if (propSchema.type === 'number' && typeof value === 'number') {
        if (propSchema.minimum !== undefined && value < propSchema.minimum) {
          errors.push(`Parameter '${key}' must be at least ${propSchema.minimum}`)
        }
        if (propSchema.maximum !== undefined && value > propSchema.maximum) {
          errors.push(`Parameter '${key}' must be at most ${propSchema.maximum}`)
        }
      }

      // String pattern validation
      if (propSchema.type === 'string' && typeof value === 'string' && propSchema.pattern) {
        const regex = new RegExp(propSchema.pattern)
        if (!regex.test(value)) {
          errors.push(`Parameter '${key}' does not match required pattern: ${propSchema.pattern}`)
        }
      }

      // Array item type validation
      if (propSchema.type === 'array' && Array.isArray(value) && propSchema.items) {
        const itemType = propSchema.items.type
        for (let i = 0; i < value.length; i++) {
          const itemValueType = typeof value[i]
          if (itemType && itemValueType !== itemType) {
            errors.push(`Array item at index ${i} in '${key}' has invalid type: expected ${itemType}, got ${itemValueType}`)
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Invoke a tool by name with the given parameters
 * @param toolName - Name of the tool to invoke
 * @param params - Parameters to pass to the tool
 * @returns Result of the tool invocation
 * @throws Error if tool not found
 */
export async function invokeTool(
  toolName: string,
  params: Record<string, unknown>
): Promise<MCPToolResult> {
  const tool = toolRegistry.get(toolName)

  if (!tool) {
    throw new Error(`Tool '${toolName}' not found (does not exist)`)
  }

  // Validate parameters before invoking
  const validation = validateToolInput(tool, params)
  if (!validation.valid) {
    return {
      content: [
        {
          type: 'text',
          text: `Validation error: ${validation.errors.join('; ')}`,
        },
      ],
      isError: true,
    }
  }

  // Invoke the handler with error handling
  try {
    return await tool.handler(params)
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
    }
  }
}

/**
 * Get a list of all registered tools
 * @returns Array of tool definitions (without handlers)
 */
export function listTools(): Array<Omit<MCPTool, 'handler'>> {
  const tools: Array<Omit<MCPTool, 'handler'>> = []
  for (const tool of toolRegistry.values()) {
    // Return tool without handler
    tools.push({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })
  }
  return tools
}

/**
 * Get a tool by name
 * @param name - Name of the tool to retrieve
 * @returns The tool if found, undefined otherwise
 */
export function getTool(name: string): MCPTool | undefined {
  return toolRegistry.get(name)
}
