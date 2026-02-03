/**
 * @fileoverview Git Binding Types for MCP Context
 *
 * This module provides the canonical type definitions for git operations
 * available through the MCP 'do' tool. These types are used both at compile
 * time (as TypeScript interfaces) and at runtime (as a string for LLM context).
 *
 * IMPORTANT: When updating these interfaces, also update the GIT_BINDING_TYPES
 * string constant to keep them in sync.
 *
 * @module types/git-binding
 */

// =============================================================================
// Git Operation Options
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

// =============================================================================
// Git Binding Interface
// =============================================================================

/**
 * Git binding interface exposing git operations for MCP sandbox execution.
 *
 * This is the primary interface for interacting with git repositories
 * through the MCP 'do' tool. All methods return promises and support
 * both read and write operations.
 */
export interface McpGitBinding {
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
// LLM Context String
// =============================================================================

/**
 * Type definitions as a string for LLM context.
 *
 * This string provides the same type information as the interfaces above,
 * formatted for inclusion in LLM prompts. It describes the `git` object
 * available in the MCP sandbox.
 *
 * IMPORTANT: Keep this in sync with the TypeScript interfaces above.
 */
export const GIT_BINDING_TYPES = `
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
