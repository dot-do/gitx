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
import { CommitObject } from '../types/objects';
import type { CommitProvider } from '../types/storage';
/**
 * CommitProvider interface for traversal operations.
 * Re-exported from storage types for convenience.
 */
export type { CommitProvider };
/**
 * Sorting strategy for commit traversal.
 *
 * - `topological`: Children before parents, with timestamp tie-breaking
 * - `date`: Sort by committer date, newest first
 * - `author-date`: Sort by author date, newest first
 * - `none`: No sorting, BFS order
 *
 * @typedef {'topological' | 'date' | 'author-date' | 'none'} SortStrategy
 */
export type SortStrategy = 'topological' | 'date' | 'author-date' | 'none';
/**
 * Options for commit traversal.
 *
 * @interface TraversalOptions
 *
 * @example
 * ```typescript
 * // Walk the last 50 commits, excluding merges
 * const options: TraversalOptions = {
 *   maxCount: 50,
 *   includeMerges: false,
 *   sort: 'date'
 * }
 *
 * // Walk commits touching a specific file
 * const options: TraversalOptions = {
 *   paths: ['src/main.ts'],
 *   firstParentOnly: true
 * }
 * ```
 */
export interface TraversalOptions {
    /**
     * Maximum number of commits to return.
     * @default Infinity
     */
    maxCount?: number;
    /**
     * Skip the first N commits before returning.
     * @default 0
     */
    skip?: number;
    /**
     * Only include commits that modify these paths.
     * Requires provider to support `getCommitsForPath`.
     */
    paths?: string[];
    /**
     * Sorting strategy for returned commits.
     * @default 'none'
     */
    sort?: SortStrategy;
    /**
     * Whether to reverse the output order.
     * @default false
     */
    reverse?: boolean;
    /** Starting commit SHA(s). Alternative to walker.push(). */
    start?: string | string[];
    /** Commits to exclude (and their ancestors). Alternative to walker.hide(). */
    exclude?: string[];
    /**
     * Include merge commits in output.
     * @default true
     */
    includeMerges?: boolean;
    /**
     * Only follow first parent (follow mainline).
     * Useful for simplified history view.
     * @default false
     */
    firstParentOnly?: boolean;
    /** Filter by author name */
    author?: string;
    /** Filter by committer name */
    committer?: string;
    /** Only include commits after this date */
    after?: Date;
    /** Only include commits before this date */
    before?: Date;
    /** Filter by commit message (string or regex pattern) */
    grep?: string | RegExp;
}
/**
 * Result of parsing a revision range.
 *
 * Git revision range syntax:
 * - `A..B` (two-dot): Commits reachable from B but not from A
 * - `A...B` (three-dot): Symmetric difference (commits in either but not both)
 * - `A` (single): All commits reachable from A
 *
 * @interface RevisionRange
 *
 * @example
 * ```typescript
 * parseRevisionRange('main..feature')
 * // { type: 'two-dot', left: 'main', right: 'feature' }
 *
 * parseRevisionRange('v1.0.0...v2.0.0')
 * // { type: 'three-dot', left: 'v1.0.0', right: 'v2.0.0' }
 * ```
 */
export interface RevisionRange {
    /**
     * Type of range.
     * - `two-dot`: A..B syntax
     * - `three-dot`: A...B syntax
     * - `single`: Single ref
     */
    type: 'two-dot' | 'three-dot' | 'single';
    /** Left side of range (or single commit) */
    left: string;
    /** Right side of range (undefined for single) */
    right?: string;
}
/**
 * Commit with additional traversal metadata.
 *
 * @interface TraversalCommit
 */
export interface TraversalCommit {
    /** The commit object with full data */
    commit: CommitObject;
    /** SHA of this commit */
    sha: string;
    /** Depth from starting commit(s) in the traversal */
    depth: number;
    /** Whether this is a merge commit (has multiple parents) */
    isMerge: boolean;
}
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
export declare class CommitWalker {
    private provider;
    private options;
    private visited;
    private hidden;
    private queue;
    private hiddenExpanded;
    constructor(provider: CommitProvider, options?: TraversalOptions);
    /**
     * Reset the walker state
     */
    reset(): void;
    /**
     * Add a starting commit to the walker
     */
    push(sha: string): void;
    /**
     * Hide a commit and its ancestors from the walk
     */
    hide(sha: string): void;
    /**
     * Expand hidden commits to include all ancestors
     */
    private expandHidden;
    /**
     * Get the next commit in the walk
     */
    next(): Promise<TraversalCommit | null>;
    /**
     * Check if there are more commits to walk
     */
    hasNext(): boolean;
    /**
     * Iterate over all commits matching the options
     */
    [Symbol.asyncIterator](): AsyncIterableIterator<TraversalCommit>;
}
/**
 * Walk commits starting from the given SHA(s)
 *
 * @param provider - The commit provider for fetching commits
 * @param start - Starting commit SHA or array of SHAs
 * @param options - Traversal options
 * @yields TraversalCommit objects in the requested order
 */
export declare function walkCommits(provider: CommitProvider, start: string | string[], options?: TraversalOptions): AsyncGenerator<TraversalCommit, void, unknown>;
/**
 * Check if commit A is an ancestor of commit B
 *
 * @param provider - The commit provider for fetching commits
 * @param ancestor - Potential ancestor commit SHA
 * @param descendant - Potential descendant commit SHA
 * @returns true if ancestor is reachable from descendant
 */
export declare function isAncestor(provider: CommitProvider, ancestor: string, descendant: string): Promise<boolean>;
/**
 * Find the common ancestor(s) of two commits
 *
 * @param provider - The commit provider for fetching commits
 * @param commit1 - First commit SHA
 * @param commit2 - Second commit SHA
 * @param all - If true, return all common ancestors; if false, return only the best one
 * @returns The common ancestor SHA(s), or null if none found
 */
export declare function findCommonAncestor(provider: CommitProvider, commit1: string, commit2: string, all?: boolean): Promise<string | string[] | null>;
/**
 * Find the merge base(s) of multiple commits
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - Array of commit SHAs
 * @returns The merge base SHA(s)
 */
export declare function findMergeBase(provider: CommitProvider, commits: string[]): Promise<string[]>;
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
export declare function parseRevisionRange(spec: string): RevisionRange;
/**
 * Expand a revision range into include/exclude commit sets
 *
 * @param provider - The commit provider for fetching commits
 * @param range - The parsed revision range
 * @returns Object with include and exclude commit arrays
 */
export declare function expandRevisionRange(provider: CommitProvider, range: RevisionRange): Promise<{
    include: string[];
    exclude: string[];
}>;
/**
 * Sort commits topologically (children before parents)
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - Array of commit SHAs to sort
 * @returns Sorted array of commit SHAs
 */
export declare function topologicalSort(provider: CommitProvider, commits: string[]): Promise<string[]>;
/**
 * Sort commits by date
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - Array of commit SHAs to sort
 * @param useAuthorDate - If true, use author date; otherwise use committer date
 * @returns Sorted array of commit SHAs (newest first)
 */
export declare function sortByDate(provider: CommitProvider, commits: string[], useAuthorDate?: boolean): Promise<string[]>;
/**
 * Get all commits between two commits (exclusive of start, inclusive of end)
 *
 * @param provider - The commit provider for fetching commits
 * @param start - Starting commit SHA (exclusive)
 * @param end - Ending commit SHA (inclusive)
 * @returns Array of commit SHAs
 */
export declare function getCommitsBetween(provider: CommitProvider, start: string, end: string): Promise<string[]>;
/**
 * Count the number of commits reachable from a commit
 *
 * @param provider - The commit provider for fetching commits
 * @param sha - Starting commit SHA
 * @param maxDepth - Maximum depth to count
 * @returns Number of reachable commits
 */
export declare function countCommits(provider: CommitProvider, sha: string, maxDepth?: number): Promise<number>;
//# sourceMappingURL=commit-traversal.d.ts.map