/**
 * @fileoverview Merge Base Finding Operations
 *
 * Provides functionality for finding merge bases between commits,
 * which is essential for merge operations, rebasing, and understanding
 * branch relationships in the commit graph.
 *
 * ## What is a Merge Base?
 *
 * A merge base is the best common ancestor(s) of two or more commits.
 * The "best" common ancestor is one that is not an ancestor of any
 * other common ancestor (i.e., a maximal common ancestor).
 *
 * ## Features
 *
 * - Find merge base(s) between two commits
 * - Find merge bases for multiple commits (octopus merge)
 * - Fork point detection
 * - Ancestor relationship checking
 * - Independent commit detection
 * - Recursive merge base computation
 *
 * ## Usage Example
 *
 * ```typescript
 * import { findMergeBase, isAncestor } from './ops/merge-base'
 *
 * // Find the merge base between two branches
 * const result = await findMergeBase(provider, [branchA, branchB])
 * if (result.hasCommonHistory) {
 *   console.log('Merge base:', result.bases[0])
 * }
 *
 * // Check if one commit is an ancestor of another
 * const isOld = await isAncestor(provider, oldCommit, newCommit)
 * ```
 *
 * @module ops/merge-base
 */
import type { BasicCommitProvider as CommitProvider } from '../types/storage';
/**
 * CommitProvider interface for merge base operations.
 * Re-exported from storage types for convenience.
 */
export type { CommitProvider };
/**
 * Result of a merge base operation.
 *
 * Contains the merge base SHA(s) and metadata about the result.
 *
 * @interface MergeBaseResult
 *
 * @example
 * ```typescript
 * const result = await findMergeBase(provider, [commitA, commitB])
 *
 * if (result.hasCommonHistory) {
 *   if (result.isUnique) {
 *     console.log('Single merge base:', result.bases[0])
 *   } else {
 *     console.log('Multiple merge bases (criss-cross):', result.bases)
 *   }
 * } else {
 *   console.log('No common history (unrelated branches)')
 * }
 * ```
 */
export interface MergeBaseResult {
    /**
     * The merge base commit SHA(s).
     * Empty if no common history exists.
     */
    bases: string[];
    /**
     * Whether a unique merge base was found.
     * False if multiple merge bases exist (criss-cross merge situation).
     */
    isUnique: boolean;
    /**
     * Whether the commits share any common history.
     * False for unrelated branches (e.g., different repos merged together).
     */
    hasCommonHistory: boolean;
    /** The number of merge bases found */
    count: number;
}
/**
 * Options for merge base finding.
 *
 * @interface MergeBaseOptions
 *
 * @example
 * ```typescript
 * // Find all merge bases (for criss-cross detection)
 * const result = await findMergeBase(provider, [a, b], { all: true })
 *
 * // Find independent commits from a list
 * const independent = await findMergeBase(provider, commits, { independent: true })
 * ```
 */
export interface MergeBaseOptions {
    /**
     * Return all merge bases instead of just one.
     * Useful for detecting criss-cross merge situations.
     * @default false
     */
    all?: boolean;
    /**
     * Use octopus merge strategy (for >2 commits).
     * Finds a merge base suitable for merging multiple branches.
     * @default false (auto-enabled when >2 commits provided)
     */
    octopus?: boolean;
    /**
     * Return independent refs (refs that cannot be reached from each other).
     * Filters the input to only commits that are not ancestors of any other.
     * @default false
     */
    independent?: boolean;
    /**
     * Include fork point calculation.
     * Uses reflog information when available for more accurate detection.
     * @default false
     */
    forkPoint?: boolean;
}
/**
 * Result of fork point detection.
 *
 * A fork point is where a branch diverged from another branch,
 * taking into account any rebases that may have occurred.
 *
 * @interface ForkPointResult
 *
 * @example
 * ```typescript
 * const result = await findForkPoint(provider, 'feature', 'main')
 * if (result.found) {
 *   console.log(`Feature forked from main at ${result.forkPoint}`)
 *   console.log(`${result.commitsSinceFork} commits since then`)
 * }
 * ```
 */
export interface ForkPointResult {
    /**
     * The fork point commit SHA.
     * Null if no fork point could be determined.
     */
    forkPoint: string | null;
    /** The branch ref that was analyzed */
    ref: string;
    /** Whether the fork point could be determined */
    found: boolean;
    /** Number of commits on the branch since the fork point */
    commitsSinceFork: number;
}
/**
 * Result of an ancestor check operation.
 *
 * @interface AncestorCheckResult
 *
 * @example
 * ```typescript
 * const result = await checkAncestor(provider, oldCommit, newCommit)
 * if (result.isAncestor) {
 *   console.log(`${oldCommit} is ${result.distance} commits behind ${newCommit}`)
 * }
 * ```
 */
export interface AncestorCheckResult {
    /** Whether the first commit is an ancestor of the second */
    isAncestor: boolean;
    /**
     * The distance (number of commits) if ancestor, -1 otherwise.
     * A distance of 0 means the commits are the same.
     */
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
 * Checks ancestor relationship and returns additional information.
 *
 * Unlike `isAncestor`, this function also computes the distance
 * (number of commits) between the two commits if they are related.
 *
 * @description
 * Uses BFS to find the shortest path from `commit` to `potentialAncestor`,
 * which gives the minimum distance between them.
 *
 * @param provider - The commit provider for fetching commits
 * @param potentialAncestor - The commit to check as potential ancestor
 * @param commit - The commit to start walking from
 * @returns Detailed ancestor check result with distance information
 *
 * @example
 * ```typescript
 * const result = await checkAncestor(provider, 'abc123', 'def456')
 *
 * if (result.isAncestor) {
 *   if (result.distance === 0) {
 *     console.log('Same commit')
 *   } else {
 *     console.log(`abc123 is ${result.distance} commits behind def456`)
 *   }
 * } else {
 *   console.log('Not an ancestor')
 * }
 * ```
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
 * Checks if commits have any common history.
 *
 * For multiple commits to share common history, every pair of commits
 * must have at least one common ancestor.
 *
 * @description
 * This is useful for detecting if branches can be merged without
 * creating unrelated histories.
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - List of commit SHAs to check
 * @returns True if all commits share common history
 *
 * @example
 * ```typescript
 * const canMerge = await hasCommonHistory(provider, [branchA, branchB, branchC])
 * if (!canMerge) {
 *   console.log('Warning: branches have unrelated histories')
 * }
 * ```
 */
export declare function hasCommonHistory(provider: CommitProvider, commits: string[]): Promise<boolean>;
/**
 * Calculates merge base for a recursive merge.
 *
 * When there are multiple merge bases (criss-cross merge situation),
 * this creates a virtual merge base by recursively merging the merge bases.
 *
 * @description
 * In a criss-cross merge situation, there can be multiple merge bases.
 * The recursive strategy handles this by first finding the merge base
 * of the merge bases, creating a "virtual" common ancestor.
 *
 * This is similar to Git's recursive merge strategy.
 *
 * @param provider - The commit provider for fetching commits
 * @param commit1 - First commit SHA
 * @param commit2 - Second commit SHA
 * @returns The recursive merge base result
 *
 * @example
 * ```typescript
 * // For a criss-cross merge situation:
 * //     A---B---C (branch1)
 * //    / \ / \
 * //   O   X   (merge)
 * //    \ / \ /
 * //     D---E---F (branch2)
 *
 * const result = await computeRecursiveMergeBase(provider, 'C', 'F')
 * // Returns a single merge base by recursively merging B and E's common ancestor
 * ```
 */
export declare function computeRecursiveMergeBase(provider: CommitProvider, commit1: string, commit2: string): Promise<MergeBaseResult>;
//# sourceMappingURL=merge-base.d.ts.map