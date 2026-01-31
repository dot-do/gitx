/**
 * Git MCP Tools
 *
 * MCP tool definitions for git operations.
 * Each tool follows the MCP specification with JSON Schema input validation.
 *
 * Available tools:
 * - git_status: Show repository status
 * - git_log: Show commit history
 * - git_diff: Show differences
 * - git_show: Show objects
 * - git_commit: Create commits
 * - git_branch: Manage branches
 * - git_checkout: Switch branches
 * - git_add: Stage files
 * - git_reset: Reset HEAD
 * - git_merge: Merge branches
 * - git_rebase: Rebase commits
 * - git_stash: Stash changes
 * - git_tag: Manage tags
 * - git_remote: Manage remotes
 * - git_fetch: Fetch from remotes
 * - git_push: Push to remotes
 * - git_pull: Pull from remotes
 * - git_clone: Clone repositories
 * - git_init: Initialize repositories
 * - git_blame: Show line-by-line authorship
 *
 * @module mcp/tools
 */
// =============================================================================
// Tool Schemas
// =============================================================================
/**
 * git_status - Show repository status
 */
export const gitStatusToolSchema = {
    name: 'git_status',
    description: 'Get the current status of a git repository, showing staged, unstaged, and untracked files',
    inputSchema: {
        type: 'object',
        properties: {
            short: {
                type: 'boolean',
                description: 'Show short-format output (porcelain)',
            },
            branch: {
                type: 'boolean',
                description: 'Show branch information',
            },
        },
    },
};
/**
 * git_log - Show commit history
 */
export const gitLogToolSchema = {
    name: 'git_log',
    description: 'Show the commit log history for a git repository',
    inputSchema: {
        type: 'object',
        properties: {
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
            author: {
                type: 'string',
                description: 'Filter by author',
            },
            since: {
                type: 'string',
                description: 'Show commits since date (e.g., "2024-01-01")',
            },
            until: {
                type: 'string',
                description: 'Show commits until date',
            },
            grep: {
                type: 'string',
                description: 'Filter commits by message pattern',
            },
        },
    },
};
/**
 * git_diff - Show differences
 */
export const gitDiffToolSchema = {
    name: 'git_diff',
    description: 'Show differences between commits, commit and working tree, or trees',
    inputSchema: {
        type: 'object',
        properties: {
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
            path: {
                type: 'string',
                description: 'Limit diff to specific file or directory',
            },
            stat: {
                type: 'boolean',
                description: 'Show diffstat instead of full diff',
            },
            nameOnly: {
                type: 'boolean',
                description: 'Show only file names that changed',
            },
        },
    },
};
/**
 * git_show - Show objects
 */
export const gitShowToolSchema = {
    name: 'git_show',
    description: 'Show various types of objects (commits, trees, blobs, tags)',
    inputSchema: {
        type: 'object',
        properties: {
            revision: {
                type: 'string',
                description: 'The revision to show (commit SHA, branch, tag, HEAD, or revision:path)',
            },
            path: {
                type: 'string',
                description: 'Optional file path to show at the revision',
            },
            format: {
                type: 'string',
                enum: ['commit', 'raw', 'diff'],
                description: 'Output format',
            },
            contextLines: {
                type: 'number',
                description: 'Number of context lines for diff output',
                minimum: 0,
            },
        },
        required: ['revision'],
    },
};
/**
 * git_commit - Create commits (write operation)
 */
export const gitCommitToolSchema = {
    name: 'git_commit',
    description: 'Create a new commit with the staged changes. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
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
            allowEmpty: {
                type: 'boolean',
                description: 'Allow creating a commit with no changes',
            },
        },
        required: ['message'],
    },
};
/**
 * git_branch - Manage branches
 */
export const gitBranchToolSchema = {
    name: 'git_branch',
    description: 'List, create, or delete branches. Create/delete require write access.',
    inputSchema: {
        type: 'object',
        properties: {
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
            force: {
                type: 'boolean',
                description: 'Force delete branch even if not merged',
            },
            all: {
                type: 'boolean',
                description: 'List all branches including remote branches',
            },
            remote: {
                type: 'boolean',
                description: 'List only remote branches',
            },
        },
    },
};
/**
 * git_checkout - Switch branches (write operation)
 */
export const gitCheckoutToolSchema = {
    name: 'git_checkout',
    description: 'Switch branches or restore working tree files. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
            ref: {
                type: 'string',
                description: 'Branch, tag, or commit to checkout',
            },
            createBranch: {
                type: 'boolean',
                description: 'Create a new branch with the given ref name (-b)',
            },
            path: {
                type: 'string',
                description: 'Restore a specific file path',
            },
        },
        required: ['ref'],
    },
};
/**
 * git_add - Stage files (write operation)
 */
export const gitAddToolSchema = {
    name: 'git_add',
    description: 'Add file contents to the staging area. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
            files: {
                type: 'array',
                description: 'List of files to add',
                items: { type: 'string' },
            },
            all: {
                type: 'boolean',
                description: 'Add all changes in the working tree',
            },
            update: {
                type: 'boolean',
                description: 'Update tracked files only',
            },
            force: {
                type: 'boolean',
                description: 'Allow adding otherwise ignored files',
            },
        },
    },
};
/**
 * git_reset - Reset HEAD (write operation)
 */
export const gitResetToolSchema = {
    name: 'git_reset',
    description: 'Reset current HEAD to a specified state. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['soft', 'mixed', 'hard'],
                description: 'Reset mode: soft (keep changes staged), mixed (unstage), hard (discard)',
            },
            commit: {
                type: 'string',
                description: 'Commit to reset to',
            },
            path: {
                type: 'string',
                description: 'Unstage a specific file path',
            },
        },
    },
};
/**
 * git_merge - Merge branches (write operation)
 */
export const gitMergeToolSchema = {
    name: 'git_merge',
    description: 'Merge one or more branches into the current branch. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
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
            message: {
                type: 'string',
                description: 'Custom merge commit message',
            },
            abort: {
                type: 'boolean',
                description: 'Abort an in-progress merge',
            },
        },
        required: ['branch'],
    },
};
/**
 * git_rebase - Rebase commits (write operation)
 */
export const gitRebaseToolSchema = {
    name: 'git_rebase',
    description: 'Reapply commits on top of another base tip. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
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
            skip: {
                type: 'boolean',
                description: 'Skip the current patch',
            },
        },
    },
};
/**
 * git_stash - Stash changes (write operation)
 */
export const gitStashToolSchema = {
    name: 'git_stash',
    description: 'Stash the changes in a dirty working directory away. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['push', 'pop', 'list', 'drop', 'apply', 'clear', 'show'],
                description: 'Stash action to perform',
            },
            message: {
                type: 'string',
                description: 'Message for the stash entry (push only)',
            },
            index: {
                type: 'number',
                description: 'Stash index for pop/drop/apply/show',
                minimum: 0,
            },
            includeUntracked: {
                type: 'boolean',
                description: 'Include untracked files in stash',
            },
        },
    },
};
/**
 * git_tag - Manage tags
 */
export const gitTagToolSchema = {
    name: 'git_tag',
    description: 'Create, list, or delete tags. Create/delete require write access.',
    inputSchema: {
        type: 'object',
        properties: {
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
            list: {
                type: 'boolean',
                description: 'List tags',
            },
            pattern: {
                type: 'string',
                description: 'Pattern to filter tags (with -l)',
            },
            annotate: {
                type: 'boolean',
                description: 'Create an annotated tag',
            },
        },
    },
};
/**
 * git_remote - Manage remotes
 */
export const gitRemoteToolSchema = {
    name: 'git_remote',
    description: 'Manage set of tracked repositories. Add/remove require write access.',
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['list', 'add', 'remove', 'rename', 'set-url', 'show'],
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
            newName: {
                type: 'string',
                description: 'New name for rename operation',
            },
            verbose: {
                type: 'boolean',
                description: 'Show remote URLs',
            },
        },
    },
};
/**
 * git_fetch - Fetch from remotes (write operation - updates refs)
 */
export const gitFetchToolSchema = {
    name: 'git_fetch',
    description: 'Fetch branches and tags from remote repositories. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
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
            tags: {
                type: 'boolean',
                description: 'Fetch all tags',
            },
            depth: {
                type: 'number',
                description: 'Limit fetching to specified depth',
                minimum: 1,
            },
        },
    },
};
/**
 * git_push - Push to remotes (write operation)
 */
export const gitPushToolSchema = {
    name: 'git_push',
    description: 'Upload local commits to a remote repository. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
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
                description: 'Set upstream for the current branch (-u)',
            },
            tags: {
                type: 'boolean',
                description: 'Push all tags',
            },
            delete: {
                type: 'boolean',
                description: 'Delete a remote branch',
            },
        },
    },
};
/**
 * git_pull - Pull from remotes (write operation)
 */
export const gitPullToolSchema = {
    name: 'git_pull',
    description: 'Fetch and integrate changes from a remote repository. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
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
            noCommit: {
                type: 'boolean',
                description: 'Do not automatically create a merge commit',
            },
        },
    },
};
/**
 * git_clone - Clone repositories (write operation)
 */
export const gitCloneToolSchema = {
    name: 'git_clone',
    description: 'Clone a repository from a remote URL. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'URL of the repository to clone',
            },
            branch: {
                type: 'string',
                description: 'Branch to clone',
            },
            depth: {
                type: 'number',
                description: 'Create a shallow clone with specified depth',
                minimum: 1,
            },
            bare: {
                type: 'boolean',
                description: 'Create a bare repository',
            },
            mirror: {
                type: 'boolean',
                description: 'Create a mirror clone',
            },
        },
        required: ['url'],
    },
};
/**
 * git_init - Initialize repositories (write operation)
 */
export const gitInitToolSchema = {
    name: 'git_init',
    description: 'Initialize a new git repository. Requires write access.',
    inputSchema: {
        type: 'object',
        properties: {
            bare: {
                type: 'boolean',
                description: 'Create a bare repository',
            },
            initialBranch: {
                type: 'string',
                description: 'Name for the initial branch (default: main)',
            },
        },
    },
};
/**
 * git_blame - Show line-by-line authorship
 */
export const gitBlameToolSchema = {
    name: 'git_blame',
    description: 'Show what revision and author last modified each line of a file',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'File path to blame',
            },
            startLine: {
                type: 'number',
                description: 'Start line number',
                minimum: 1,
            },
            endLine: {
                type: 'number',
                description: 'End line number',
                minimum: 1,
            },
            revision: {
                type: 'string',
                description: 'Revision to blame from',
            },
        },
        required: ['path'],
    },
};
// =============================================================================
// Tool Classification
// =============================================================================
/**
 * Tools that require write access (modify repository state)
 */
export const WRITE_TOOLS = new Set([
    'git_commit',
    'git_checkout',
    'git_add',
    'git_reset',
    'git_merge',
    'git_rebase',
    'git_stash',
    'git_fetch',
    'git_push',
    'git_pull',
    'git_clone',
    'git_init',
]);
/**
 * Tools that may require write access depending on operation
 */
export const CONDITIONAL_WRITE_TOOLS = new Set([
    'git_branch', // write for create/delete, read for list
    'git_tag', // write for create/delete, read for list
    'git_remote', // write for add/remove, read for list
]);
/**
 * Read-only tools (never modify repository state)
 */
export const READ_TOOLS = new Set([
    'git_status',
    'git_log',
    'git_diff',
    'git_show',
    'git_blame',
]);
/**
 * Check if a tool invocation requires write access
 */
export function requiresWriteAccess(toolName, params) {
    if (WRITE_TOOLS.has(toolName)) {
        return true;
    }
    if (CONDITIONAL_WRITE_TOOLS.has(toolName)) {
        // Check params to determine if write is needed
        if (toolName === 'git_branch') {
            return !!(params.name || params.delete);
        }
        if (toolName === 'git_tag') {
            return !!(params.name || params.delete) && !params.list;
        }
        if (toolName === 'git_remote') {
            return ['add', 'remove', 'rename', 'set-url'].includes(params.action);
        }
    }
    return false;
}
// =============================================================================
// Default Tool Handlers (Stubs - Real implementation in GitRepoDO)
// =============================================================================
/**
 * Create a stub handler that returns "not implemented" error
 */
function createStubHandler(toolName) {
    return async () => ({
        content: [{ type: 'text', text: `${toolName}: Not implemented. Connect to a GitRepoDO instance.` }],
        isError: true,
    });
}
// =============================================================================
// gitTools Array
// =============================================================================
/**
 * Array of all built-in git MCP tools.
 */
export const gitTools = [
    // Read operations
    { schema: gitStatusToolSchema, handler: createStubHandler('git_status') },
    { schema: gitLogToolSchema, handler: createStubHandler('git_log') },
    { schema: gitDiffToolSchema, handler: createStubHandler('git_diff') },
    { schema: gitShowToolSchema, handler: createStubHandler('git_show') },
    { schema: gitBlameToolSchema, handler: createStubHandler('git_blame') },
    // Branch/tag operations
    { schema: gitBranchToolSchema, handler: createStubHandler('git_branch') },
    { schema: gitTagToolSchema, handler: createStubHandler('git_tag') },
    // Write operations
    { schema: gitCommitToolSchema, handler: createStubHandler('git_commit') },
    { schema: gitCheckoutToolSchema, handler: createStubHandler('git_checkout') },
    { schema: gitAddToolSchema, handler: createStubHandler('git_add') },
    { schema: gitResetToolSchema, handler: createStubHandler('git_reset') },
    { schema: gitMergeToolSchema, handler: createStubHandler('git_merge') },
    { schema: gitRebaseToolSchema, handler: createStubHandler('git_rebase') },
    { schema: gitStashToolSchema, handler: createStubHandler('git_stash') },
    // Remote operations
    { schema: gitRemoteToolSchema, handler: createStubHandler('git_remote') },
    { schema: gitFetchToolSchema, handler: createStubHandler('git_fetch') },
    { schema: gitPushToolSchema, handler: createStubHandler('git_push') },
    { schema: gitPullToolSchema, handler: createStubHandler('git_pull') },
    { schema: gitCloneToolSchema, handler: createStubHandler('git_clone') },
    { schema: gitInitToolSchema, handler: createStubHandler('git_init') },
];
/**
 * Map of tool names to tools for quick lookup
 */
export const gitToolMap = new Map(gitTools.map(tool => [tool.schema.name, tool]));
//# sourceMappingURL=tools.js.map