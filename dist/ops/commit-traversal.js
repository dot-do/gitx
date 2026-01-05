/**
 * @fileoverview Commit Graph Traversal
 *
 * Provides functionality for walking commit graphs, finding ancestors,
 * topological sorting, and revision range parsing.
 *
 * ## Features
 *
 * - Commit graph walking with various traversal strategies
 * - Topological and date-based sorting
 * - Revision range parsing (A..B, A...B syntax)
 * - Ancestor and merge base finding
 * - Path-based commit filtering
 * - Author/date/message filtering
 *
 * ## Usage Example
 *
 * ```typescript
 * import { walkCommits, CommitWalker } from './ops/commit-traversal'
 *
 * // Walk commits from HEAD
 * for await (const commit of walkCommits(provider, headSha, {
 *   maxCount: 10,
 *   sort: 'topological'
 * })) {
 *   console.log(commit.sha, commit.commit.message)
 * }
 *
 * // Use CommitWalker for more control
 * const walker = new CommitWalker(provider)
 * walker.push(startSha)
 * walker.hide(excludeSha) // Exclude this commit and its ancestors
 *
 * while (walker.hasNext()) {
 *   const commit = await walker.next()
 *   // Process commit...
 * }
 * ```
 *
 * @module ops/commit-traversal
 */
// ============================================================================
// CommitWalker Class
// ============================================================================
/**
 * Walker for traversing commit graphs.
 *
 * Supports various traversal strategies including topological sorting,
 * date-based sorting, path filtering, and revision ranges.
 *
 * The walker maintains state and can be used for incremental traversal,
 * making it suitable for large repositories where you want to process
 * commits in batches.
 *
 * @class CommitWalker
 *
 * @example
 * ```typescript
 * // Create walker
 * const walker = new CommitWalker(provider, { firstParentOnly: true })
 *
 * // Add starting points
 * walker.push('abc123')
 * walker.push('def456')
 *
 * // Exclude certain commits
 * walker.hide('old-base-sha')
 *
 * // Iterate
 * let commit = await walker.next()
 * while (commit) {
 *   console.log(commit.sha)
 *   commit = await walker.next()
 * }
 *
 * // Or use async iteration
 * for await (const commit of walker) {
 *   console.log(commit.sha)
 * }
 * ```
 */
export class CommitWalker {
    provider;
    options;
    visited = new Set();
    hidden = new Set();
    queue = [];
    hiddenExpanded = false;
    constructor(provider, options = {}) {
        this.provider = provider;
        this.options = options;
    }
    /**
     * Reset the walker state
     */
    reset() {
        this.visited = new Set();
        this.hidden = new Set();
        this.queue = [];
        this.hiddenExpanded = false;
    }
    /**
     * Add a starting commit to the walker
     */
    push(sha) {
        if (!this.visited.has(sha) && !this.hidden.has(sha)) {
            this.queue.push({ sha, depth: 0 });
        }
    }
    /**
     * Hide a commit and its ancestors from the walk
     */
    hide(sha) {
        this.hidden.add(sha);
    }
    /**
     * Expand hidden commits to include all ancestors
     */
    async expandHidden() {
        if (this.hiddenExpanded)
            return;
        this.hiddenExpanded = true;
        const toExpand = [...this.hidden];
        const expanded = new Set(this.hidden);
        while (toExpand.length > 0) {
            const sha = toExpand.pop();
            const commit = await this.provider.getCommit(sha);
            if (!commit)
                continue;
            for (const parent of commit.parents) {
                if (!expanded.has(parent)) {
                    expanded.add(parent);
                    toExpand.push(parent);
                }
            }
        }
        this.hidden = expanded;
    }
    /**
     * Get the next commit in the walk
     */
    async next() {
        // Expand hidden commits on first call
        await this.expandHidden();
        while (this.queue.length > 0) {
            const { sha, depth } = this.queue.shift();
            // Skip if visited or hidden
            if (this.visited.has(sha) || this.hidden.has(sha)) {
                continue;
            }
            const commit = await this.provider.getCommit(sha);
            if (!commit)
                continue;
            this.visited.add(sha);
            // Add parents to queue
            const parentsToAdd = this.options.firstParentOnly
                ? commit.parents.slice(0, 1)
                : commit.parents;
            for (const parent of parentsToAdd) {
                if (!this.visited.has(parent) && !this.hidden.has(parent)) {
                    this.queue.push({ sha: parent, depth: depth + 1 });
                }
            }
            return {
                sha,
                commit,
                depth,
                isMerge: commit.parents.length > 1
            };
        }
        return null;
    }
    /**
     * Check if there are more commits to walk
     */
    hasNext() {
        // Check if there are any unvisited, non-hidden commits in the queue
        return this.queue.some(({ sha }) => !this.visited.has(sha) && !this.hidden.has(sha));
    }
    /**
     * Iterate over all commits matching the options
     */
    async *[Symbol.asyncIterator]() {
        let commit = await this.next();
        while (commit !== null) {
            yield commit;
            commit = await this.next();
        }
    }
}
// ============================================================================
// Generator Function
// ============================================================================
/**
 * Walk commits starting from the given SHA(s)
 *
 * @param provider - The commit provider for fetching commits
 * @param start - Starting commit SHA or array of SHAs
 * @param options - Traversal options
 * @yields TraversalCommit objects in the requested order
 */
export async function* walkCommits(provider, start, options = {}) {
    const startShas = Array.isArray(start) ? start : [start];
    const { maxCount, skip = 0, paths, sort = 'none', reverse = false, exclude, includeMerges = true, firstParentOnly = false, author, committer, after, before, grep } = options;
    // If maxCount is 0, return immediately
    if (maxCount === 0) {
        return;
    }
    // Get commits that match path filters
    let pathMatchingCommits = null;
    if (paths && paths.length > 0 && provider.getCommitsForPath) {
        pathMatchingCommits = new Set();
        for (const path of paths) {
            const commits = await provider.getCommitsForPath(path);
            for (const sha of commits) {
                pathMatchingCommits.add(sha);
            }
        }
        // If no commits match paths, return empty
        if (pathMatchingCommits.size === 0) {
            return;
        }
    }
    // Build set of hidden commits (exclude and their ancestors)
    const hidden = new Set();
    if (exclude && exclude.length > 0) {
        const toExpand = [...exclude];
        while (toExpand.length > 0) {
            const sha = toExpand.pop();
            if (hidden.has(sha))
                continue;
            hidden.add(sha);
            const commit = await provider.getCommit(sha);
            if (commit) {
                for (const parent of commit.parents) {
                    toExpand.push(parent);
                }
            }
        }
    }
    // Collect all commits first for sorting
    const allCommits = [];
    const visited = new Set();
    const queue = startShas.map(sha => ({
        sha,
        depth: 0
    }));
    while (queue.length > 0) {
        // For date-based sorting, we need to process in date order
        if (sort === 'date' || sort === 'author-date') {
            // Sort queue by date (most recent first)
            queue.sort((_a, _b) => {
                // We need to fetch commits to sort - use simple queue position for now
                return 0;
            });
        }
        const { sha, depth } = queue.shift();
        if (visited.has(sha) || hidden.has(sha)) {
            continue;
        }
        const commit = await provider.getCommit(sha);
        if (!commit)
            continue;
        visited.add(sha);
        // Add parents to queue
        const parentsToAdd = firstParentOnly
            ? commit.parents.slice(0, 1)
            : commit.parents;
        for (const parent of parentsToAdd) {
            if (!visited.has(parent) && !hidden.has(parent)) {
                queue.push({ sha: parent, depth: depth + 1 });
            }
        }
        const traversalCommit = {
            sha,
            commit,
            depth,
            isMerge: commit.parents.length > 1
        };
        allCommits.push(traversalCommit);
    }
    // Apply sorting
    let sortedCommits = [...allCommits];
    if (sort === 'topological') {
        // Topological sort - children before parents
        const shas = sortedCommits.map(c => c.sha);
        const sortedShas = await topologicalSort(provider, shas);
        const shaToCommit = new Map(sortedCommits.map(c => [c.sha, c]));
        sortedCommits = sortedShas.map(sha => shaToCommit.get(sha)).filter(Boolean);
    }
    else if (sort === 'date') {
        // Sort by committer date (newest first)
        sortedCommits.sort((a, b) => b.commit.committer.timestamp - a.commit.committer.timestamp);
    }
    else if (sort === 'author-date') {
        // Sort by author date (newest first)
        sortedCommits.sort((a, b) => b.commit.author.timestamp - a.commit.author.timestamp);
    }
    // Reverse if requested
    if (reverse) {
        sortedCommits.reverse();
    }
    // Apply filters and yield commits
    let skipped = 0;
    let yielded = 0;
    for (const traversalCommit of sortedCommits) {
        const { commit, sha } = traversalCommit;
        // Path filter
        if (pathMatchingCommits && !pathMatchingCommits.has(sha)) {
            continue;
        }
        // Merge filter
        if (!includeMerges && commit.parents.length > 1) {
            continue;
        }
        // Author filter
        if (author && commit.author.name !== author) {
            continue;
        }
        // Committer filter
        if (committer && commit.committer.name !== committer) {
            continue;
        }
        // Date filters
        const commitTimestamp = commit.committer.timestamp * 1000;
        if (after && commitTimestamp <= after.getTime()) {
            continue;
        }
        if (before && commitTimestamp >= before.getTime()) {
            continue;
        }
        // Grep filter
        if (grep) {
            const pattern = typeof grep === 'string' ? new RegExp(grep) : grep;
            if (!pattern.test(commit.message)) {
                continue;
            }
        }
        // Skip handling
        if (skipped < skip) {
            skipped++;
            continue;
        }
        // MaxCount handling
        if (maxCount !== undefined && yielded >= maxCount) {
            return;
        }
        yield traversalCommit;
        yielded++;
    }
}
// ============================================================================
// Ancestor Functions
// ============================================================================
/**
 * Check if commit A is an ancestor of commit B
 *
 * @param provider - The commit provider for fetching commits
 * @param ancestor - Potential ancestor commit SHA
 * @param descendant - Potential descendant commit SHA
 * @returns true if ancestor is reachable from descendant
 */
export async function isAncestor(provider, ancestor, descendant) {
    // Same commit is considered its own ancestor
    if (ancestor === descendant) {
        return true;
    }
    const visited = new Set();
    const queue = [descendant];
    while (queue.length > 0) {
        const sha = queue.shift();
        if (visited.has(sha))
            continue;
        visited.add(sha);
        if (sha === ancestor) {
            return true;
        }
        const commit = await provider.getCommit(sha);
        if (!commit)
            continue;
        for (const parent of commit.parents) {
            if (!visited.has(parent)) {
                queue.push(parent);
            }
        }
    }
    return false;
}
/**
 * Find the common ancestor(s) of two commits
 *
 * @param provider - The commit provider for fetching commits
 * @param commit1 - First commit SHA
 * @param commit2 - Second commit SHA
 * @param all - If true, return all common ancestors; if false, return only the best one
 * @returns The common ancestor SHA(s), or null if none found
 */
export async function findCommonAncestor(provider, commit1, commit2, all) {
    // Get all ancestors of commit1
    const ancestors1 = new Set();
    const queue1 = [commit1];
    while (queue1.length > 0) {
        const sha = queue1.shift();
        if (ancestors1.has(sha))
            continue;
        ancestors1.add(sha);
        const commit = await provider.getCommit(sha);
        if (commit) {
            for (const parent of commit.parents) {
                queue1.push(parent);
            }
        }
    }
    // Find common ancestors by walking from commit2
    const commonAncestors = [];
    const visited2 = new Set();
    const queue2 = [commit2];
    while (queue2.length > 0) {
        const sha = queue2.shift();
        if (visited2.has(sha))
            continue;
        visited2.add(sha);
        if (ancestors1.has(sha)) {
            commonAncestors.push(sha);
            if (!all) {
                // For single result, return the first common ancestor (best merge base)
                return sha;
            }
            // Don't explore further ancestors of common ancestors
            continue;
        }
        const commit = await provider.getCommit(sha);
        if (commit) {
            for (const parent of commit.parents) {
                queue2.push(parent);
            }
        }
    }
    if (commonAncestors.length === 0) {
        return null;
    }
    if (all) {
        return commonAncestors;
    }
    return commonAncestors[0] || null;
}
/**
 * Find the merge base(s) of multiple commits
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - Array of commit SHAs
 * @returns The merge base SHA(s)
 */
export async function findMergeBase(provider, commits) {
    if (commits.length === 0) {
        return [];
    }
    if (commits.length === 1) {
        return [commits[0]];
    }
    // Find common ancestor of first two commits
    let result = await findCommonAncestor(provider, commits[0], commits[1], true);
    if (result === null) {
        return [];
    }
    let bases = Array.isArray(result) ? result : [result];
    // For each additional commit, find common ancestor with current bases
    for (let i = 2; i < commits.length; i++) {
        const newBases = [];
        for (const base of bases) {
            const ancestor = await findCommonAncestor(provider, base, commits[i], true);
            if (ancestor !== null) {
                const ancestors = Array.isArray(ancestor) ? ancestor : [ancestor];
                for (const a of ancestors) {
                    if (!newBases.includes(a)) {
                        newBases.push(a);
                    }
                }
            }
        }
        if (newBases.length === 0) {
            return [];
        }
        bases = newBases;
    }
    return bases;
}
// ============================================================================
// Revision Range Parsing
// ============================================================================
/**
 * Parse a revision range specification
 *
 * Supports:
 * - Single commit: "abc123"
 * - Two-dot range: "A..B" (commits reachable from B but not from A)
 * - Three-dot range: "A...B" (symmetric difference)
 * - Caret exclusion: "^A B" (B excluding A)
 *
 * @param spec - The revision specification string
 * @returns Parsed revision range
 */
export function parseRevisionRange(spec) {
    // Check for three-dot range first (to avoid matching .. before ...)
    if (spec.includes('...')) {
        const [left, right] = spec.split('...');
        return {
            type: 'three-dot',
            left,
            right
        };
    }
    // Check for two-dot range
    if (spec.includes('..')) {
        const [left, right] = spec.split('..');
        return {
            type: 'two-dot',
            left,
            right
        };
    }
    // Single commit reference
    return {
        type: 'single',
        left: spec
    };
}
/**
 * Expand a revision range into include/exclude commit sets
 *
 * @param provider - The commit provider for fetching commits
 * @param range - The parsed revision range
 * @returns Object with include and exclude commit arrays
 */
export async function expandRevisionRange(provider, range) {
    if (range.type === 'single') {
        return {
            include: [range.left],
            exclude: []
        };
    }
    if (range.type === 'two-dot') {
        // A..B means commits reachable from B but not from A
        // Include: all commits reachable from B
        // Exclude: all commits reachable from A (including A)
        const include = [];
        const exclude = [];
        // Get commits reachable from right (B)
        const visited = new Set();
        const queue = [range.right];
        while (queue.length > 0) {
            const sha = queue.shift();
            if (visited.has(sha))
                continue;
            visited.add(sha);
            include.push(sha);
            const commit = await provider.getCommit(sha);
            if (commit) {
                for (const parent of commit.parents) {
                    queue.push(parent);
                }
            }
        }
        // Get commits reachable from left (A) to exclude
        const excludeVisited = new Set();
        const excludeQueue = [range.left];
        while (excludeQueue.length > 0) {
            const sha = excludeQueue.shift();
            if (excludeVisited.has(sha))
                continue;
            excludeVisited.add(sha);
            exclude.push(sha);
            const commit = await provider.getCommit(sha);
            if (commit) {
                for (const parent of commit.parents) {
                    excludeQueue.push(parent);
                }
            }
        }
        return { include, exclude };
    }
    if (range.type === 'three-dot') {
        // A...B means symmetric difference (commits in either A or B but not both)
        // Find merge base and include commits from both sides up to merge base
        const mergeBase = await findCommonAncestor(provider, range.left, range.right);
        const exclude = [];
        if (mergeBase) {
            // Exclude merge base and its ancestors
            const baseCommits = Array.isArray(mergeBase) ? mergeBase : [mergeBase];
            for (const base of baseCommits) {
                exclude.push(base);
                const visited = new Set();
                const queue = [base];
                while (queue.length > 0) {
                    const sha = queue.shift();
                    if (visited.has(sha))
                        continue;
                    visited.add(sha);
                    const commit = await provider.getCommit(sha);
                    if (commit) {
                        for (const parent of commit.parents) {
                            if (!visited.has(parent)) {
                                exclude.push(parent);
                                queue.push(parent);
                            }
                        }
                    }
                }
            }
        }
        return {
            include: [range.left, range.right],
            exclude
        };
    }
    return { include: [], exclude: [] };
}
// ============================================================================
// Sorting Functions
// ============================================================================
/**
 * Sort commits topologically (children before parents)
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - Array of commit SHAs to sort
 * @returns Sorted array of commit SHAs
 */
export async function topologicalSort(provider, commits) {
    if (commits.length === 0) {
        return [];
    }
    const commitSet = new Set(commits);
    const commitData = new Map();
    // Fetch all commit data
    for (const sha of commits) {
        const commit = await provider.getCommit(sha);
        if (commit) {
            commitData.set(sha, commit);
        }
    }
    // Build in-degree map (count of children within the set)
    const inDegree = new Map();
    for (const sha of commits) {
        inDegree.set(sha, 0);
    }
    // Calculate in-degrees: for each parent, increment its in-degree
    for (const sha of commits) {
        const commit = commitData.get(sha);
        if (commit) {
            for (const parent of commit.parents) {
                if (commitSet.has(parent)) {
                    inDegree.set(parent, (inDegree.get(parent) || 0) + 1);
                }
            }
        }
    }
    // Find all commits with no children (in-degree 0) - these are the starting points
    const queue = [];
    for (const [sha, degree] of inDegree) {
        if (degree === 0) {
            queue.push(sha);
        }
    }
    // Sort queue by timestamp (newest first) for consistent ordering
    queue.sort((a, b) => {
        const commitA = commitData.get(a);
        const commitB = commitData.get(b);
        if (!commitA || !commitB)
            return 0;
        return commitB.committer.timestamp - commitA.committer.timestamp;
    });
    const result = [];
    while (queue.length > 0) {
        // Take the first from queue (sorted by timestamp)
        const sha = queue.shift();
        result.push(sha);
        const commit = commitData.get(sha);
        if (commit) {
            for (const parent of commit.parents) {
                if (commitSet.has(parent)) {
                    const newDegree = (inDegree.get(parent) || 0) - 1;
                    inDegree.set(parent, newDegree);
                    if (newDegree === 0) {
                        // Insert in sorted order by timestamp
                        const parentCommit = commitData.get(parent);
                        if (parentCommit) {
                            let insertIndex = 0;
                            for (let i = 0; i < queue.length; i++) {
                                const queueCommit = commitData.get(queue[i]);
                                if (queueCommit &&
                                    parentCommit.committer.timestamp <=
                                        queueCommit.committer.timestamp) {
                                    insertIndex = i + 1;
                                }
                                else {
                                    break;
                                }
                            }
                            queue.splice(insertIndex, 0, parent);
                        }
                        else {
                            queue.push(parent);
                        }
                    }
                }
            }
        }
    }
    return result;
}
/**
 * Sort commits by date
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - Array of commit SHAs to sort
 * @param useAuthorDate - If true, use author date; otherwise use committer date
 * @returns Sorted array of commit SHAs (newest first)
 */
export async function sortByDate(provider, commits, useAuthorDate) {
    const commitData = [];
    for (const sha of commits) {
        const commit = await provider.getCommit(sha);
        if (commit) {
            const timestamp = useAuthorDate
                ? commit.author.timestamp
                : commit.committer.timestamp;
            commitData.push({ sha, timestamp });
        }
    }
    // Sort by timestamp (newest first)
    commitData.sort((a, b) => b.timestamp - a.timestamp);
    return commitData.map(c => c.sha);
}
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Get all commits between two commits (exclusive of start, inclusive of end)
 *
 * @param provider - The commit provider for fetching commits
 * @param start - Starting commit SHA (exclusive)
 * @param end - Ending commit SHA (inclusive)
 * @returns Array of commit SHAs
 */
export async function getCommitsBetween(provider, start, end) {
    // If start equals end, return empty
    if (start === end) {
        return [];
    }
    // Check if end is an ancestor of start (wrong direction)
    if (await isAncestor(provider, end, start)) {
        // end is ancestor of start, so there are no commits "between" them in this direction
        // Actually we need to check if start is NOT an ancestor of end
        if (!(await isAncestor(provider, start, end))) {
            return [];
        }
    }
    // Walk from end back to start, collecting commits
    const result = [];
    const visited = new Set();
    const queue = [end];
    // First check if start is reachable from end
    const startReachable = await isAncestor(provider, start, end);
    if (!startReachable) {
        return [];
    }
    while (queue.length > 0) {
        const sha = queue.shift();
        if (visited.has(sha))
            continue;
        visited.add(sha);
        // Stop at start (exclusive)
        if (sha === start) {
            continue;
        }
        result.push(sha);
        const commit = await provider.getCommit(sha);
        if (commit) {
            for (const parent of commit.parents) {
                if (!visited.has(parent)) {
                    queue.push(parent);
                }
            }
        }
    }
    return result;
}
/**
 * Count the number of commits reachable from a commit
 *
 * @param provider - The commit provider for fetching commits
 * @param sha - Starting commit SHA
 * @param maxDepth - Maximum depth to count
 * @returns Number of reachable commits
 */
export async function countCommits(provider, sha, maxDepth) {
    const visited = new Set();
    const queue = [{ sha, depth: 0 }];
    let count = 0;
    while (queue.length > 0) {
        const { sha: currentSha, depth } = queue.shift();
        if (visited.has(currentSha))
            continue;
        const commit = await provider.getCommit(currentSha);
        if (!commit)
            continue;
        visited.add(currentSha);
        count++;
        // Check depth limit
        if (maxDepth !== undefined && depth >= maxDepth) {
            continue;
        }
        for (const parent of commit.parents) {
            if (!visited.has(parent)) {
                queue.push({ sha: parent, depth: depth + 1 });
            }
        }
    }
    return count;
}
//# sourceMappingURL=commit-traversal.js.map