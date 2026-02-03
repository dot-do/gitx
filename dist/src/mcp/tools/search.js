/**
 * @fileoverview Search Tool
 *
 * MCP tool for searching git repository content including commits, branches, and tags.
 *
 * @module mcp/tools/search
 */
/**
 * Search tool definition
 */
export const searchToolDefinition = {
    name: 'search',
    description: 'Search git repository for commits, branches, or tags matching a query',
    inputSchema: {
        type: 'object',
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
};
/**
 * Create a SearchResult for a branch
 */
function createBranchResult(branch) {
    const result = {
        // Base SearchResult fields
        id: branch.sha ?? branch.name,
        title: branch.name,
        description: `Branch: ${branch.name}${branch.sha ? ` @ ${branch.sha.slice(0, 7)}` : ''}`,
        // Git-specific extensions
        gitType: 'branch',
        ref: branch.name
    };
    if (branch.sha !== undefined) {
        result.sha = branch.sha;
    }
    return result;
}
/**
 * Create a SearchResult for a commit
 */
function createCommitResult(commit) {
    const summary = commit.message?.split('\n')[0] ?? commit.sha.slice(0, 7);
    const result = {
        // Base SearchResult fields
        id: commit.sha,
        title: summary,
        description: commit.message ?? `Commit ${commit.sha.slice(0, 7)}`,
        // Git-specific extensions
        gitType: 'commit',
        ref: commit.sha,
        sha: commit.sha
    };
    if (commit.author !== undefined) {
        result.author = commit.author;
    }
    if (commit.date !== undefined) {
        result.date = commit.date;
    }
    return result;
}
/**
 * Search across commits, branches, and tags
 */
async function searchAll(git, query, limit) {
    const results = [];
    const queryLower = query.toLowerCase();
    // Search branches
    const branches = await git.branch({ all: true });
    if (branches.branches) {
        for (const branch of branches.branches) {
            if (branch.name.toLowerCase().includes(queryLower)) {
                results.push(createBranchResult(branch));
            }
            if (results.length >= limit)
                break;
        }
    }
    // Search commits (if we have room for more results)
    if (results.length < limit) {
        const log = await git.log({ maxCount: limit * 2, grep: query });
        if (log.commits) {
            for (const commit of log.commits) {
                if (results.length >= limit)
                    break;
                results.push(createCommitResult(commit));
            }
        }
    }
    return results.slice(0, limit);
}
/**
 * Search commits only
 */
async function searchCommits(git, query, limit) {
    const log = await git.log({ maxCount: limit, grep: query });
    if (!log.commits)
        return [];
    return log.commits.map(commit => createCommitResult(commit));
}
/**
 * Search branches only
 */
async function searchBranches(git, query, limit) {
    const queryLower = query.toLowerCase();
    const branches = await git.branch({ all: true });
    if (!branches.branches)
        return [];
    return branches.branches
        .filter(b => b.name.toLowerCase().includes(queryLower))
        .slice(0, limit)
        .map(branch => createBranchResult(branch));
}
/**
 * Create a search handler that uses the git binding
 */
export function createSearchHandler(git) {
    return async (input) => {
        try {
            const limit = input.limit ?? 20;
            const searchType = input.type ?? 'all';
            let results;
            switch (searchType) {
                case 'commits':
                    results = await searchCommits(git, input.query, limit);
                    break;
                case 'branches':
                    results = await searchBranches(git, input.query, limit);
                    break;
                case 'tags':
                    // Tags search - similar to branches
                    results = []; // TODO: Implement tag search when git.tag() is available
                    break;
                case 'all':
                default:
                    results = await searchAll(git, input.query, limit);
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(results, null, 2)
                    }]
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ error: errorMessage })
                    }],
                isError: true
            };
        }
    };
}
/**
 * Search tool instance (requires git binding to be set)
 */
export const searchTool = searchToolDefinition;
//# sourceMappingURL=search.js.map