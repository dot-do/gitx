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
import type { BasicCommitProvider as CommitProvider } from '../types/storage';
export type { CommitProvider };
/**
 * Result of a merge base operation
 */
export interface MergeBaseResult {
    /** The merge base commit SHA(s) */
    bases: string[];
    /** Whether a unique merge base was found */
    isUnique: boolean;
    /** Whether the commits share any common history */
    hasCommonHistory: boolean;
    /** The number of merge bases found */
    count: number;
}
/**
 * Options for merge base finding
 */
export interface MergeBaseOptions {
    /** Return all merge bases instead of just one */
    all?: boolean;
    /** Use octopus merge strategy (for >2 commits) */
    octopus?: boolean;
    /** Return independent refs (refs that cannot be reached from each other) */
    independent?: boolean;
    /** Include fork point calculation */
    forkPoint?: boolean;
}
/**
 * Result of fork point detection
 */
export interface ForkPointResult {
    /** The fork point commit SHA, or null if not found */
    forkPoint: string | null;
    /** The branch ref that was analyzed */
    ref: string;
    /** Whether the fork point could be determined */
    found: boolean;
    /** Commits on the branch since the fork point */
    commitsSinceFork: number;
}
/**
 * Result of ancestor check
 */
export interface AncestorCheckResult {
    /** Whether the first commit is an ancestor of the second */
    isAncestor: boolean;
    /** The distance (number of commits) if ancestor, -1 otherwise */
    distance: number;
}
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
export declare function findMergeBase(provider: CommitProvider, commits: string[], options?: MergeBaseOptions): Promise<MergeBaseResult>;
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
export declare function findAllMergeBases(provider: CommitProvider, commit1: string, commit2: string): Promise<string[]>;
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
export declare function findForkPoint(provider: CommitProvider, ref: string, baseRef: string, reflog?: string[]): Promise<ForkPointResult>;
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
export declare function isAncestor(provider: CommitProvider, potentialAncestor: string, commit: string): Promise<boolean>;
/**
 * Check ancestor relationship and return additional information
 *
 * @param provider - The commit provider for fetching commits
 * @param potentialAncestor - The commit to check as potential ancestor
 * @param commit - The commit to start walking from
 * @returns Detailed ancestor check result
 */
export declare function checkAncestor(provider: CommitProvider, potentialAncestor: string, commit: string): Promise<AncestorCheckResult>;
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
export declare function findIndependentCommits(provider: CommitProvider, commits: string[]): Promise<string[]>;
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
export declare function findOctopusMergeBase(provider: CommitProvider, commits: string[]): Promise<string[]>;
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
export declare function computeThreeWayMergeBase(provider: CommitProvider, ours: string, theirs: string): Promise<MergeBaseResult>;
/**
 * Check if commits have any common history
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - List of commit SHAs to check
 * @returns True if all commits share common history
 */
export declare function hasCommonHistory(provider: CommitProvider, commits: string[]): Promise<boolean>;
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
export declare function computeRecursiveMergeBase(provider: CommitProvider, commit1: string, commit2: string): Promise<MergeBaseResult>;
//# sourceMappingURL=merge-base.d.ts.map