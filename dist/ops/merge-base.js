/**
 * Merge Base Finding Operations
 *
 * Provides functionality for finding merge bases between commits,
 * which is essential for merge operations, rebasing, and understanding
 * branch relationships in the commit graph.
 *
 * A merge base is the best common ancestor(s) of two or more commits.
 * The "best" common ancestor is one that is not an ancestor of any
 * other common ancestor (i.e., a maximal common ancestor).
 */
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Get all ancestors of a commit (including itself)
 * Uses iterative BFS to avoid stack overflow with deep histories
 */
async function getAncestors(provider, sha) {
    const visited = new Set();
    const queue = [sha];
    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) {
            continue;
        }
        const commit = await provider.getCommit(current);
        if (!commit) {
            continue;
        }
        visited.add(current);
        for (const parent of commit.parents) {
            if (!visited.has(parent)) {
                queue.push(parent);
            }
        }
    }
    return visited;
}
/**
 * Find all common ancestors of two commits
 */
async function findCommonAncestors(provider, sha1, sha2) {
    const ancestors1 = await getAncestors(provider, sha1);
    const ancestors2 = await getAncestors(provider, sha2);
    const common = new Set();
    for (const sha of ancestors1) {
        if (ancestors2.has(sha)) {
            common.add(sha);
        }
    }
    return common;
}
/**
 * Filter common ancestors to only keep maximal ones
 * (those that are not ancestors of any other common ancestor)
 */
async function filterToMaximalAncestors(provider, commonAncestors) {
    const ancestorsList = Array.from(commonAncestors);
    if (ancestorsList.length === 0) {
        return [];
    }
    if (ancestorsList.length === 1) {
        return ancestorsList;
    }
    // For each ancestor, check if it's an ancestor of any other ancestor
    const isAncestorOfAnother = new Map();
    for (const sha of ancestorsList) {
        isAncestorOfAnother.set(sha, false);
    }
    // Build ancestor sets for each common ancestor
    const ancestorSets = new Map();
    for (const sha of ancestorsList) {
        const ancestors = await getAncestors(provider, sha);
        // Remove the sha itself from its ancestors for comparison
        ancestors.delete(sha);
        ancestorSets.set(sha, ancestors);
    }
    // Check which ones are ancestors of others
    for (const sha of ancestorsList) {
        for (const otherSha of ancestorsList) {
            if (sha !== otherSha) {
                const otherAncestors = ancestorSets.get(otherSha);
                if (otherAncestors.has(sha)) {
                    isAncestorOfAnother.set(sha, true);
                    break;
                }
            }
        }
    }
    // Return only maximal ancestors
    return ancestorsList.filter(sha => !isAncestorOfAnother.get(sha));
}
// ============================================================================
// Core Functions
// ============================================================================
/**
 * Find the merge base of two or more commits
 *
 * Given two commits, finds the best common ancestor (merge base).
 * Given multiple commits, finds the merge base of all of them.
 *
 * This is equivalent to `git merge-base`.
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - Two or more commit SHAs
 * @param options - Options for the merge base search
 * @returns The merge base result
 *
 * @example
 * ```ts
 * const result = await findMergeBase(provider, ['abc123', 'def456'])
 * if (result.hasCommonHistory) {
 *   console.log('Merge base:', result.bases[0])
 * }
 * ```
 */
export async function findMergeBase(provider, commits, options = {}) {
    // Handle edge cases
    if (commits.length === 0) {
        return {
            bases: [],
            isUnique: false,
            hasCommonHistory: false,
            count: 0
        };
    }
    if (commits.length === 1) {
        const commit = await provider.getCommit(commits[0]);
        if (!commit) {
            return {
                bases: [],
                isUnique: false,
                hasCommonHistory: false,
                count: 0
            };
        }
        return {
            bases: [commits[0]],
            isUnique: true,
            hasCommonHistory: true,
            count: 1
        };
    }
    // Handle independent option
    if (options.independent) {
        const independent = await findIndependentCommits(provider, commits);
        return {
            bases: independent,
            isUnique: independent.length === 1,
            hasCommonHistory: independent.length > 0,
            count: independent.length
        };
    }
    // Handle octopus option
    if (options.octopus || commits.length > 2) {
        const bases = await findOctopusMergeBase(provider, commits);
        return {
            bases,
            isUnique: bases.length === 1,
            hasCommonHistory: bases.length > 0,
            count: bases.length
        };
    }
    // Handle fork point option
    if (options.forkPoint && commits.length === 2) {
        const result = await findForkPoint(provider, commits[0], commits[1]);
        if (result.found && result.forkPoint) {
            return {
                bases: [result.forkPoint],
                isUnique: true,
                hasCommonHistory: true,
                count: 1
            };
        }
    }
    // Standard two-commit merge base
    const [sha1, sha2] = commits;
    // Check if either commit doesn't exist
    const commit1 = await provider.getCommit(sha1);
    const commit2 = await provider.getCommit(sha2);
    if (!commit1 || !commit2) {
        return {
            bases: [],
            isUnique: false,
            hasCommonHistory: false,
            count: 0
        };
    }
    // Find all common ancestors
    const commonAncestors = await findCommonAncestors(provider, sha1, sha2);
    if (commonAncestors.size === 0) {
        return {
            bases: [],
            isUnique: false,
            hasCommonHistory: false,
            count: 0
        };
    }
    // Filter to maximal ancestors
    const maximalBases = await filterToMaximalAncestors(provider, commonAncestors);
    if (options.all) {
        return {
            bases: maximalBases,
            isUnique: maximalBases.length === 1,
            hasCommonHistory: true,
            count: maximalBases.length
        };
    }
    // Default: return just one merge base
    return {
        bases: maximalBases.length > 0 ? [maximalBases[0]] : [],
        isUnique: maximalBases.length === 1,
        hasCommonHistory: maximalBases.length > 0,
        count: 1
    };
}
/**
 * Find all merge bases between two commits
 *
 * Unlike findMergeBase with all=true, this specifically finds
 * all maximal common ancestors, which is useful for criss-cross
 * merge situations.
 *
 * This is equivalent to `git merge-base --all`.
 *
 * @param provider - The commit provider for fetching commits
 * @param commit1 - First commit SHA
 * @param commit2 - Second commit SHA
 * @returns Array of all merge base SHAs
 *
 * @example
 * ```ts
 * const bases = await findAllMergeBases(provider, 'abc123', 'def456')
 * if (bases.length > 1) {
 *   console.log('Multiple merge bases (criss-cross merge):', bases)
 * }
 * ```
 */
export async function findAllMergeBases(provider, commit1, commit2) {
    const result = await findMergeBase(provider, [commit1, commit2], { all: true });
    return result.bases;
}
/**
 * Find the fork point of a branch relative to another ref
 *
 * Calculates where a branch forked off from another branch,
 * taking into account any rebases that may have occurred.
 * This uses reflog information when available.
 *
 * This is equivalent to `git merge-base --fork-point`.
 *
 * @param provider - The commit provider for fetching commits
 * @param ref - The branch ref to analyze
 * @param baseRef - The base ref to compare against
 * @param reflog - Optional reflog entries for more accurate detection
 * @returns The fork point result
 *
 * @example
 * ```ts
 * const result = await findForkPoint(provider, 'feature-branch', 'main')
 * if (result.found) {
 *   console.log('Forked from:', result.forkPoint)
 * }
 * ```
 */
export async function findForkPoint(provider, ref, baseRef, reflog) {
    // If reflog is provided, use it for better detection
    if (reflog && reflog.length > 0) {
        // Get ancestors of ref
        const refAncestors = await getAncestors(provider, ref);
        // Check each reflog entry to find the fork point
        for (const entry of reflog) {
            if (refAncestors.has(entry)) {
                // Found a common point in the reflog
                // Calculate commits since fork
                let commitsSinceFork = 0;
                let current = ref;
                while (current !== entry) {
                    const commit = await provider.getCommit(current);
                    if (!commit || commit.parents.length === 0)
                        break;
                    commitsSinceFork++;
                    current = commit.parents[0];
                }
                return {
                    forkPoint: entry,
                    ref,
                    found: true,
                    commitsSinceFork
                };
            }
        }
    }
    // Standard fork point detection: find merge base
    const result = await findMergeBase(provider, [ref, baseRef]);
    if (!result.hasCommonHistory || result.bases.length === 0) {
        return {
            forkPoint: null,
            ref,
            found: false,
            commitsSinceFork: 0
        };
    }
    const forkPoint = result.bases[0];
    // Calculate commits since fork
    let commitsSinceFork = 0;
    let current = ref;
    const visited = new Set();
    while (current !== forkPoint && !visited.has(current)) {
        visited.add(current);
        const commit = await provider.getCommit(current);
        if (!commit)
            break;
        if (current === forkPoint)
            break;
        commitsSinceFork++;
        if (commit.parents.length === 0)
            break;
        current = commit.parents[0];
    }
    return {
        forkPoint,
        ref,
        found: true,
        commitsSinceFork
    };
}
/**
 * Check if one commit is an ancestor of another
 *
 * Returns true if the first commit is reachable from the second
 * commit by following parent links.
 *
 * This is equivalent to `git merge-base --is-ancestor`.
 *
 * @param provider - The commit provider for fetching commits
 * @param potentialAncestor - The commit to check as potential ancestor
 * @param commit - The commit to start walking from
 * @returns True if potentialAncestor is an ancestor of commit
 *
 * @example
 * ```ts
 * if (await isAncestor(provider, 'oldcommit', 'newcommit')) {
 *   console.log('oldcommit is an ancestor of newcommit')
 * }
 * ```
 */
export async function isAncestor(provider, potentialAncestor, commit) {
    // Same commit is considered its own ancestor
    if (potentialAncestor === commit) {
        return true;
    }
    const ancestors = await getAncestors(provider, commit);
    return ancestors.has(potentialAncestor);
}
/**
 * Check ancestor relationship and return additional information
 *
 * @param provider - The commit provider for fetching commits
 * @param potentialAncestor - The commit to check as potential ancestor
 * @param commit - The commit to start walking from
 * @returns Detailed ancestor check result
 */
export async function checkAncestor(provider, potentialAncestor, commit) {
    // Same commit
    if (potentialAncestor === commit) {
        return {
            isAncestor: true,
            distance: 0
        };
    }
    // BFS to find the shortest path
    const queue = [{ sha: commit, distance: 0 }];
    const visited = new Set();
    while (queue.length > 0) {
        const { sha, distance } = queue.shift();
        if (visited.has(sha))
            continue;
        visited.add(sha);
        if (sha === potentialAncestor) {
            return {
                isAncestor: true,
                distance
            };
        }
        const commitObj = await provider.getCommit(sha);
        if (!commitObj)
            continue;
        for (const parent of commitObj.parents) {
            if (!visited.has(parent)) {
                queue.push({ sha: parent, distance: distance + 1 });
            }
        }
    }
    return {
        isAncestor: false,
        distance: -1
    };
}
// ============================================================================
// Advanced Functions
// ============================================================================
/**
 * Find independent commits from a list
 *
 * Returns the subset of commits that are not reachable from
 * any other commit in the list.
 *
 * This is equivalent to `git merge-base --independent`.
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - List of commit SHAs to analyze
 * @returns Array of independent commit SHAs
 *
 * @example
 * ```ts
 * const independent = await findIndependentCommits(provider, [a, b, c])
 * // Returns commits that are not ancestors of others
 * ```
 */
export async function findIndependentCommits(provider, commits) {
    if (commits.length <= 1) {
        return [...commits];
    }
    // Build ancestor sets for each commit
    const ancestorSets = new Map();
    for (const sha of commits) {
        const ancestors = await getAncestors(provider, sha);
        // Remove the commit itself from its ancestor set
        ancestors.delete(sha);
        ancestorSets.set(sha, ancestors);
    }
    // A commit is independent if it's not an ancestor of any other commit in the list
    const independent = [];
    for (const sha of commits) {
        let isAncestorOfAnother = false;
        for (const otherSha of commits) {
            if (sha !== otherSha) {
                const otherAncestors = ancestorSets.get(otherSha);
                if (otherAncestors.has(sha)) {
                    isAncestorOfAnother = true;
                    break;
                }
            }
        }
        if (!isAncestorOfAnother) {
            independent.push(sha);
        }
    }
    return independent;
}
/**
 * Find the octopus merge base
 *
 * For merging more than two branches, finds a suitable merge base
 * that works for all branches.
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - List of commit SHAs (3 or more)
 * @returns The octopus merge base SHA(s)
 */
export async function findOctopusMergeBase(provider, commits) {
    if (commits.length === 0) {
        return [];
    }
    if (commits.length === 1) {
        const commit = await provider.getCommit(commits[0]);
        return commit ? [commits[0]] : [];
    }
    if (commits.length === 2) {
        return findAllMergeBases(provider, commits[0], commits[1]);
    }
    // For 3+ commits, iteratively find the merge base
    // Start with the first two commits
    let currentBases = await findAllMergeBases(provider, commits[0], commits[1]);
    if (currentBases.length === 0) {
        return [];
    }
    // For each additional commit, find the merge base with current bases
    for (let i = 2; i < commits.length; i++) {
        const nextCommit = commits[i];
        const newBases = [];
        for (const base of currentBases) {
            const bases = await findAllMergeBases(provider, base, nextCommit);
            for (const b of bases) {
                if (!newBases.includes(b)) {
                    newBases.push(b);
                }
            }
        }
        if (newBases.length === 0) {
            return [];
        }
        currentBases = newBases;
    }
    return currentBases;
}
/**
 * Compute the three-way merge base for a merge operation
 *
 * Given the current HEAD, merge target, and optionally a common ancestor,
 * returns the appropriate base for a three-way merge.
 *
 * @param provider - The commit provider for fetching commits
 * @param ours - Our commit (HEAD)
 * @param theirs - Their commit (merge target)
 * @returns The merge base for three-way merge
 */
export async function computeThreeWayMergeBase(provider, ours, theirs) {
    return findMergeBase(provider, [ours, theirs]);
}
/**
 * Check if commits have any common history
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - List of commit SHAs to check
 * @returns True if all commits share common history
 */
export async function hasCommonHistory(provider, commits) {
    if (commits.length <= 1) {
        return true;
    }
    // Check pairwise - for common history, all pairs must have a common ancestor
    for (let i = 0; i < commits.length; i++) {
        for (let j = i + 1; j < commits.length; j++) {
            const common = await findCommonAncestors(provider, commits[i], commits[j]);
            if (common.size === 0) {
                return false;
            }
        }
    }
    return true;
}
/**
 * Calculate merge base for a recursive merge
 *
 * When there are multiple merge bases (criss-cross merge situation),
 * this creates a virtual merge base by merging the merge bases.
 *
 * @param provider - The commit provider for fetching commits
 * @param commit1 - First commit SHA
 * @param commit2 - Second commit SHA
 * @returns The recursive merge base
 */
export async function computeRecursiveMergeBase(provider, commit1, commit2) {
    const allBases = await findAllMergeBases(provider, commit1, commit2);
    if (allBases.length === 0) {
        return {
            bases: [],
            isUnique: false,
            hasCommonHistory: false,
            count: 0
        };
    }
    if (allBases.length === 1) {
        return {
            bases: allBases,
            isUnique: true,
            hasCommonHistory: true,
            count: 1
        };
    }
    // Multiple merge bases - recursively merge them
    // In a real implementation, this would create virtual merge commits
    // For now, we return the result of recursively finding merge bases of the bases
    let currentBase = allBases[0];
    for (let i = 1; i < allBases.length; i++) {
        const result = await findMergeBase(provider, [currentBase, allBases[i]]);
        if (result.bases.length > 0) {
            currentBase = result.bases[0];
        }
    }
    return {
        bases: [currentBase],
        isUnique: true,
        hasCommonHistory: true,
        count: 1
    };
}
//# sourceMappingURL=merge-base.js.map