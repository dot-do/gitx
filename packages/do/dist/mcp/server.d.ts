/**
 * Git MCP Server Factory
 *
 * Creates MCP server instances for git operations.
 * Provides a high-level API compatible with the MCP specification.
 *
 * ## Architecture
 *
 * The MCP server exposes git operations through three primitives:
 *
 * 1. **search** - Search git history, branches, tags
 * 2. **fetch** - Fetch specific commits, files, or refs
 * 3. **do** - Execute git operations via sandboxed TypeScript
 *
 * Plus individual git tools (git_status, git_commit, etc.) for direct access.
 *
 * ## Usage
 *
 * ```typescript
 * import { createGitMCPServer } from 'gitx.do/mcp'
 *
 * const server = createGitMCPServer({
 *   name: 'my-git-server',
 *   auth: {
 *     introspectionUrl: 'https://oauth.do/introspect',
 *     clientId: env.OAUTH_CLIENT_ID,
 *     clientSecret: env.OAUTH_CLIENT_SECRET,
 *   },
 *   repository: gitRepo, // GitRepoDO instance or context
 * })
 *
 * // Start server with transport
 * await server.connect(transport)
 * ```
 *
 * @module mcp/server
 */
import { Hono } from 'hono';
import { type GitAuthConfig, type GitAuthContext } from './auth';
import { type McpToolResult } from './tool-registry';
/**
 * Options for creating a Git MCP server
 */
export interface GitMCPServerOptions {
    /** Server name (default: 'gitx.do') */
    name?: string;
    /** Server version (default: '1.0.0') */
    version?: string;
    /** Authentication configuration */
    auth?: GitAuthConfig;
    /** Repository context for operations */
    repository?: GitRepositoryContext;
}
/**
 * Repository context interface
 */
export interface GitRepositoryContext {
    /** Get status of the repository */
    status(options?: StatusOptions): Promise<StatusResult>;
    /** Get commit log */
    log(options?: LogOptions): Promise<LogResult>;
    /** Get diff between commits */
    diff(options?: DiffOptions): Promise<DiffResult>;
    /** Show a git object */
    show(revision: string, options?: ShowOptions): Promise<ShowResult>;
    /** Create a commit */
    commit(message: string, options?: CommitOptions): Promise<CommitResult>;
    /** List/create/delete branches */
    branch(options?: BranchOptions): Promise<BranchResult>;
    /** Checkout a ref */
    checkout(ref: string, options?: CheckoutOptions): Promise<void>;
    /** Add files to index */
    add(options?: AddOptions): Promise<void>;
    /** Reset to a state */
    reset(options?: ResetOptions): Promise<void>;
    /** Merge branches */
    merge(branch: string, options?: MergeOptions): Promise<MergeResult>;
    /** Get blame information */
    blame(path: string, options?: BlameOptions): Promise<BlameResult>;
}
interface StatusOptions {
    short?: boolean;
    branch?: boolean;
}
interface StatusResult {
    staged: string[];
    modified: string[];
    untracked: string[];
    branch?: string;
}
interface LogOptions {
    maxCount?: number;
    oneline?: boolean;
    ref?: string;
    author?: string;
}
interface LogResult {
    commits: Array<{
        hash: string;
        author: string;
        date: Date;
        message: string;
    }>;
}
interface DiffOptions {
    staged?: boolean;
    commit1?: string;
    commit2?: string;
    path?: string;
}
interface DiffResult {
    files: Array<{
        path: string;
        status: string;
        additions: number;
        deletions: number;
    }>;
}
interface ShowOptions {
    format?: string;
    path?: string;
}
interface ShowResult {
    content: string;
    metadata?: Record<string, unknown>;
}
interface CommitOptions {
    author?: string;
    email?: string;
    amend?: boolean;
}
interface CommitResult {
    hash: string;
    message: string;
}
interface BranchOptions {
    name?: string;
    delete?: boolean;
    list?: boolean;
    all?: boolean;
}
interface BranchResult {
    branches?: string[];
    current?: string;
    created?: boolean;
    deleted?: boolean;
}
interface CheckoutOptions {
    createBranch?: boolean;
}
interface AddOptions {
    files?: string[];
    all?: boolean;
}
interface ResetOptions {
    mode?: 'soft' | 'mixed' | 'hard';
    commit?: string;
}
interface MergeOptions {
    noFf?: boolean;
    squash?: boolean;
}
interface MergeResult {
    success: boolean;
    conflicts?: string[];
}
interface BlameOptions {
    startLine?: number;
    endLine?: number;
}
interface BlameResult {
    lines: Array<{
        line: number;
        commit: string;
        author: string;
        content: string;
    }>;
}
/**
 * MCP Server wrapper
 */
export interface GitMCPServer {
    /** The Hono app instance */
    app: Hono;
    /** Server info */
    info: {
        name: string;
        version: string;
    };
    /** Get registered tool names */
    getTools(): string[];
    /** Invoke a tool directly */
    invokeTool(name: string, params: Record<string, unknown>, auth?: GitAuthContext): Promise<McpToolResult>;
}
/**
 * Create a Git MCP server
 */
export declare function createGitMCPServer(options?: GitMCPServerOptions): GitMCPServer;
export {};
//# sourceMappingURL=server.d.ts.map