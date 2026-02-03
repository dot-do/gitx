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
/**
 * Options for git.status()
 */
export interface GitStatusOptions {
    short?: boolean;
    branch?: boolean;
}
/**
 * Git status result
 */
export interface GitStatusResult {
    branch: string;
    staged: string[];
    unstaged: string[];
    untracked?: string[];
    clean: boolean;
}
/**
 * Options for git.log()
 */
export interface GitLogOptions {
    maxCount?: number;
    oneline?: boolean;
    ref?: string;
    author?: string;
    since?: string;
    until?: string;
    grep?: string;
}
/**
 * Git log result
 */
export interface GitLogResult {
    commits?: Array<{
        sha: string;
        message: string;
        author?: string;
        date?: string;
    }>;
}
/**
 * Options for git.diff()
 */
export interface GitDiffOptions {
    staged?: boolean;
    commit1?: string;
    commit2?: string;
    path?: string;
    stat?: boolean;
    nameOnly?: boolean;
}
/**
 * Options for git.show()
 */
export interface GitShowOptions {
    path?: string;
    format?: 'commit' | 'raw' | 'diff';
    contextLines?: number;
}
/**
 * Options for git.commit()
 */
export interface GitCommitOptions {
    message: string;
    author?: string;
    email?: string;
    amend?: boolean;
    allowEmpty?: boolean;
}
/**
 * Options for git.add()
 */
export interface GitAddOptions {
    all?: boolean;
    update?: boolean;
    force?: boolean;
}
/**
 * Options for git.checkout()
 */
export interface GitCheckoutOptions {
    createBranch?: boolean;
    path?: string;
}
/**
 * Options for git.branch()
 */
export interface GitBranchOptions {
    list?: boolean;
    name?: string;
    delete?: boolean;
    force?: boolean;
    all?: boolean;
    remote?: boolean;
}
/**
 * Git branch result
 */
export interface GitBranchResult {
    current?: string;
    branches?: Array<{
        name: string;
        sha?: string;
        remote?: boolean;
    }>;
}
/**
 * Options for git.merge()
 */
export interface GitMergeOptions {
    noFf?: boolean;
    squash?: boolean;
    message?: string;
    abort?: boolean;
}
/**
 * Options for git.push()
 */
export interface GitPushOptions {
    remote?: string;
    branch?: string;
    force?: boolean;
    setUpstream?: boolean;
    tags?: boolean;
    delete?: boolean;
}
/**
 * Options for git.pull()
 */
export interface GitPullOptions {
    remote?: string;
    branch?: string;
    rebase?: boolean;
    noCommit?: boolean;
}
/**
 * Options for git.fetch()
 */
export interface GitFetchOptions {
    remote?: string;
    all?: boolean;
    prune?: boolean;
    tags?: boolean;
    depth?: number;
}
/**
 * Options for git.clone()
 */
export interface GitCloneOptions {
    branch?: string;
    depth?: number;
    bare?: boolean;
    mirror?: boolean;
}
/**
 * Options for git.init()
 */
export interface GitInitOptions {
    bare?: boolean;
    initialBranch?: string;
}
/**
 * Git binding interface exposing git operations for MCP sandbox execution.
 *
 * This is the primary interface for interacting with git repositories
 * through the MCP 'do' tool. All methods return promises and support
 * both read and write operations.
 */
export interface McpGitBinding {
    /** Get repository status */
    status(options?: GitStatusOptions): Promise<GitStatusResult>;
    /** Get commit history */
    log(options?: GitLogOptions): Promise<GitLogResult>;
    /** Show differences */
    diff(options?: GitDiffOptions): Promise<string | Record<string, unknown>>;
    /** Show a git object (commit, tree, blob, tag) */
    show(revision: string, options?: GitShowOptions): Promise<Record<string, unknown>>;
    /** Create a commit */
    commit(options: GitCommitOptions): Promise<{
        sha: string;
    }>;
    /** Stage files */
    add(files: string | string[], options?: GitAddOptions): Promise<void>;
    /** Checkout a branch or restore files */
    checkout(ref: string, options?: GitCheckoutOptions): Promise<void>;
    /** List, create, or delete branches */
    branch(options?: GitBranchOptions): Promise<GitBranchResult>;
    /** Merge branches */
    merge(branch: string, options?: GitMergeOptions): Promise<{
        merged: boolean;
        conflicts?: string[];
    }>;
    /** Push to remote */
    push(options?: GitPushOptions): Promise<{
        pushed: boolean;
        remote?: string;
        branch?: string;
    }>;
    /** Pull from remote */
    pull(options?: GitPullOptions): Promise<{
        pulled: boolean;
        commits?: number;
    }>;
    /** Fetch from remote */
    fetch(options?: GitFetchOptions): Promise<{
        fetched: boolean;
        refs?: string[];
    }>;
    /** Clone a repository */
    clone(url: string, options?: GitCloneOptions): Promise<{
        cloned: boolean;
        path?: string;
    }>;
    /** Initialize a new repository */
    init(options?: GitInitOptions): Promise<{
        initialized: boolean;
        path?: string;
    }>;
}
/**
 * Type definitions as a string for LLM context.
 *
 * This string provides the same type information as the interfaces above,
 * formatted for inclusion in LLM prompts. It describes the `git` object
 * available in the MCP sandbox.
 *
 * IMPORTANT: Keep this in sync with the TypeScript interfaces above.
 */
export declare const GIT_BINDING_TYPES = "\ninterface GitStatusOptions {\n  short?: boolean\n  branch?: boolean\n}\n\ninterface GitStatusResult {\n  branch: string\n  staged: string[]\n  unstaged: string[]\n  untracked?: string[]\n  clean: boolean\n}\n\ninterface GitLogOptions {\n  maxCount?: number\n  oneline?: boolean\n  ref?: string\n  author?: string\n  since?: string\n  until?: string\n  grep?: string\n}\n\ninterface GitLogResult {\n  commits?: Array<{\n    sha: string\n    message: string\n    author?: string\n    date?: string\n  }>\n}\n\ninterface GitDiffOptions {\n  staged?: boolean\n  commit1?: string\n  commit2?: string\n  path?: string\n  stat?: boolean\n  nameOnly?: boolean\n}\n\ninterface GitShowOptions {\n  path?: string\n  format?: 'commit' | 'raw' | 'diff'\n  contextLines?: number\n}\n\ninterface GitCommitOptions {\n  message: string\n  author?: string\n  email?: string\n  amend?: boolean\n  allowEmpty?: boolean\n}\n\ninterface GitAddOptions {\n  all?: boolean\n  update?: boolean\n  force?: boolean\n}\n\ninterface GitCheckoutOptions {\n  createBranch?: boolean\n  path?: string\n}\n\ninterface GitBranchOptions {\n  list?: boolean\n  name?: string\n  delete?: boolean\n  force?: boolean\n  all?: boolean\n  remote?: boolean\n}\n\ninterface GitBranchResult {\n  current?: string\n  branches?: Array<{\n    name: string\n    sha?: string\n    remote?: boolean\n  }>\n}\n\ninterface GitMergeOptions {\n  noFf?: boolean\n  squash?: boolean\n  message?: string\n  abort?: boolean\n}\n\ninterface GitPushOptions {\n  remote?: string\n  branch?: string\n  force?: boolean\n  setUpstream?: boolean\n  tags?: boolean\n  delete?: boolean\n}\n\ninterface GitPullOptions {\n  remote?: string\n  branch?: string\n  rebase?: boolean\n  noCommit?: boolean\n}\n\ninterface GitFetchOptions {\n  remote?: string\n  all?: boolean\n  prune?: boolean\n  tags?: boolean\n  depth?: number\n}\n\ninterface GitCloneOptions {\n  branch?: string\n  depth?: number\n  bare?: boolean\n  mirror?: boolean\n}\n\ninterface GitInitOptions {\n  bare?: boolean\n  initialBranch?: string\n}\n\n/**\n * Git binding - available as `git` in the sandbox\n */\ndeclare const git: {\n  status(options?: GitStatusOptions): Promise<GitStatusResult>\n  log(options?: GitLogOptions): Promise<GitLogResult>\n  diff(options?: GitDiffOptions): Promise<string | Record<string, unknown>>\n  show(revision: string, options?: GitShowOptions): Promise<Record<string, unknown>>\n  commit(options: GitCommitOptions): Promise<{ sha: string }>\n  add(files: string | string[], options?: GitAddOptions): Promise<void>\n  checkout(ref: string, options?: GitCheckoutOptions): Promise<void>\n  branch(options?: GitBranchOptions): Promise<GitBranchResult>\n  merge(branch: string, options?: GitMergeOptions): Promise<{ merged: boolean; conflicts?: string[] }>\n  push(options?: GitPushOptions): Promise<{ pushed: boolean; remote?: string; branch?: string }>\n  pull(options?: GitPullOptions): Promise<{ pulled: boolean; commits?: number }>\n  fetch(options?: GitFetchOptions): Promise<{ fetched: boolean; refs?: string[] }>\n  clone(url: string, options?: GitCloneOptions): Promise<{ cloned: boolean; path?: string }>\n  init(options?: GitInitOptions): Promise<{ initialized: boolean; path?: string }>\n}\n";
//# sourceMappingURL=git-binding.d.ts.map