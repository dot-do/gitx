/**
 * @fileoverview Do Tool
 *
 * MCP tool for executing code in a sandboxed environment with access to git bindings.
 * Uses @dotdo/mcp's createDoHandler with ai-evaluate for secure V8 sandbox execution.
 *
 * @module mcp/tools/do
 */
import type { DoScope, DoPermissions, ToolResponse } from '@dotdo/mcp';
/**
 * Sandbox environment type for Cloudflare Workers.
 * This type is used when evaluating code in a sandboxed environment.
 */
type SandboxEnv = {
    LOADER?: unknown;
};
import { ObjectStoreProxy } from '../sandbox/object-store-proxy';
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
 * Git binding interface exposing git operations
 *
 * This is the primary interface for interacting with git repositories.
 * All methods return promises and support both read and write operations.
 */
export interface GitBinding {
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
export type { DoPermissions };
/**
 * Git-specific DoScope configuration (extends DoScope with typed git binding)
 */
export interface GitScope extends DoScope {
    bindings: {
        git: GitBinding;
        [key: string]: unknown;
    };
}
export interface DoToolInput {
    code: string;
    timeout?: number;
}
export interface DoToolOutput {
    success: boolean;
    result?: unknown;
    error?: string;
    logs: string[];
    duration: number;
}
export type { ToolResponse };
/**
 * Create a GitScope with the provided git binding
 */
export declare function createGitScope(git: GitBinding, options?: {
    timeout?: number;
    permissions?: DoPermissions;
}): GitScope;
/**
 * Execute code with git binding available
 *
 * @param input - The code to execute and optional timeout
 * @param objectStore - Object store proxy for advanced operations
 * @returns Execution result
 */
export declare function executeDo(input: DoToolInput, objectStore: ObjectStoreProxy): Promise<DoToolOutput>;
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
export declare function createDoHandler(scope: GitScope, _env?: SandboxEnv): (input: DoToolInput) => Promise<ToolResponse>;
/**
 * Do tool definition
 */
export declare const doToolDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            code: {
                type: string;
                description: string;
            };
            timeout: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
//# sourceMappingURL=do.d.ts.map