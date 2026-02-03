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
`;
//# sourceMappingURL=git-binding.js.map