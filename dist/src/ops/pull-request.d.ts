/**
 * @fileoverview Pull Request / Merge Request Workflows
 *
 * Implements PR creation, listing, merging (fast-forward, 3-way, squash),
 * status tracking, and review state. PR state is stored in SQLite.
 * Merge operations delegate to the existing merge infrastructure in ./merge.ts.
 *
 * @module ops/pull-request
 */
import type { MergeStorage, MergeResult } from './merge';
/** Pull request status lifecycle */
export type PullRequestStatus = 'open' | 'closed' | 'merged' | 'draft';
/** Review verdict for a single review */
export type ReviewState = 'pending' | 'approved' | 'changes_requested' | 'commented' | 'dismissed';
/** Merge strategy for completing a PR */
export type PullRequestMergeMethod = 'merge' | 'squash' | 'fast-forward';
/**
 * Author identity used in PR metadata.
 */
export interface PullRequestAuthor {
    name: string;
    email: string;
}
/**
 * Options for creating a pull request.
 */
export interface CreatePullRequestOptions {
    /** Title of the pull request */
    title: string;
    /** Detailed description / body (markdown) */
    description?: string;
    /** Source branch name (e.g. 'feature/foo') */
    sourceBranch: string;
    /** Target branch name (e.g. 'main') */
    targetBranch: string;
    /** Author of the pull request */
    author: PullRequestAuthor;
    /** Open as draft */
    draft?: boolean;
    /** Labels / tags */
    labels?: string[];
}
/**
 * A single code-review entry.
 */
export interface PullRequestReview {
    /** Unique review id */
    id: number;
    /** PR number this review belongs to */
    prNumber: number;
    /** Reviewer identity */
    reviewer: PullRequestAuthor;
    /** Review verdict */
    state: ReviewState;
    /** Optional review body */
    body?: string;
    /** Unix ms timestamp */
    createdAt: number;
}
/**
 * Full pull request record.
 */
export interface PullRequest {
    /** Auto-incrementing PR number */
    number: number;
    /** Title */
    title: string;
    /** Body / description */
    description: string;
    /** Current status */
    status: PullRequestStatus;
    /** Source (head) branch */
    sourceBranch: string;
    /** Target (base) branch */
    targetBranch: string;
    /** Author */
    author: PullRequestAuthor;
    /** Labels */
    labels: string[];
    /** SHA of the source branch head at time of creation */
    sourceSha: string;
    /** SHA of the target branch head at time of creation */
    targetSha: string;
    /** Merge commit SHA if merged */
    mergeCommitSha?: string;
    /** Merge method used */
    mergeMethod?: PullRequestMergeMethod;
    /** Created timestamp (unix ms) */
    createdAt: number;
    /** Last updated timestamp (unix ms) */
    updatedAt: number;
    /** Closed / merged timestamp */
    closedAt?: number;
}
/**
 * Options for listing pull requests.
 */
export interface ListPullRequestOptions {
    /** Filter by status (default: 'open') */
    status?: PullRequestStatus | 'all';
    /** Filter by target branch */
    targetBranch?: string;
    /** Filter by source branch */
    sourceBranch?: string;
    /** Filter by author email */
    authorEmail?: string;
    /** Max results */
    limit?: number;
    /** Offset for pagination */
    offset?: number;
}
/**
 * Options for merging a pull request.
 */
export interface MergePullRequestOptions {
    /** Merge method (default: 'merge') */
    method?: PullRequestMergeMethod;
    /** Custom merge commit message */
    message?: string;
    /** Who is performing the merge */
    mergedBy: PullRequestAuthor;
}
/**
 * Result of a PR merge attempt.
 */
export interface MergePullRequestResult {
    success: boolean;
    error?: string;
    mergeResult?: MergeResult;
    mergeCommitSha?: string;
}
/**
 * SQL statements to create pull_requests and pull_request_reviews tables.
 * Designed to be executed alongside the existing schema in do/schema.ts.
 */
export declare const PULL_REQUEST_SCHEMA_SQL = "\nCREATE TABLE IF NOT EXISTS pull_requests (\n  number INTEGER PRIMARY KEY AUTOINCREMENT,\n  title TEXT NOT NULL,\n  description TEXT NOT NULL DEFAULT '',\n  status TEXT NOT NULL DEFAULT 'open',\n  source_branch TEXT NOT NULL,\n  target_branch TEXT NOT NULL,\n  author_name TEXT NOT NULL,\n  author_email TEXT NOT NULL,\n  labels TEXT NOT NULL DEFAULT '[]',\n  source_sha TEXT NOT NULL,\n  target_sha TEXT NOT NULL,\n  merge_commit_sha TEXT,\n  merge_method TEXT,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL,\n  closed_at INTEGER\n);\nCREATE INDEX IF NOT EXISTS idx_pr_status ON pull_requests(status);\nCREATE INDEX IF NOT EXISTS idx_pr_source_branch ON pull_requests(source_branch);\nCREATE INDEX IF NOT EXISTS idx_pr_target_branch ON pull_requests(target_branch);\nCREATE INDEX IF NOT EXISTS idx_pr_author ON pull_requests(author_email);\n\nCREATE TABLE IF NOT EXISTS pull_request_reviews (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  pr_number INTEGER NOT NULL REFERENCES pull_requests(number) ON DELETE CASCADE,\n  reviewer_name TEXT NOT NULL,\n  reviewer_email TEXT NOT NULL,\n  state TEXT NOT NULL DEFAULT 'pending',\n  body TEXT NOT NULL DEFAULT '',\n  created_at INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS idx_pr_reviews_pr ON pull_request_reviews(pr_number);\nCREATE INDEX IF NOT EXISTS idx_pr_reviews_state ON pull_request_reviews(state);\n";
/**
 * Storage abstraction for pull request operations.
 *
 * Extends MergeStorage with SQL access for PR state and ref resolution.
 */
export interface PullRequestStorage extends MergeStorage {
    /** Execute raw SQL and return rows */
    sqlExec(query: string, ...params: unknown[]): {
        rows: Record<string, unknown>[];
    };
    /** Read a ref by name, returning its SHA */
    readRef(ref: string): Promise<string | null>;
    /** Write / update a ref */
    writeRef(ref: string, sha: string): Promise<void>;
}
/**
 * Initialise the pull request schema tables. Idempotent.
 */
export declare function initPullRequestSchema(storage: PullRequestStorage): void;
/**
 * Create a new pull request.
 */
export declare function createPullRequest(storage: PullRequestStorage, options: CreatePullRequestOptions): Promise<PullRequest>;
/**
 * Get a single pull request by number.
 */
export declare function getPullRequest(storage: PullRequestStorage, prNumber: number): PullRequest | null;
/**
 * List pull requests with optional filters.
 */
export declare function listPullRequests(storage: PullRequestStorage, options?: ListPullRequestOptions): PullRequest[];
/**
 * Update pull request status (open, closed, draft).
 * Use {@link mergePullRequest} to transition to 'merged'.
 */
export declare function updatePullRequestStatus(storage: PullRequestStorage, prNumber: number, status: 'open' | 'closed' | 'draft'): PullRequest;
/**
 * Merge a pull request using the specified method.
 *
 * Delegates to the merge infrastructure in ./merge.ts for the actual
 * three-way merge / fast-forward / squash logic, then updates PR state.
 */
export declare function mergePullRequest(storage: PullRequestStorage, prNumber: number, options: MergePullRequestOptions): Promise<MergePullRequestResult>;
/**
 * Add a review to a pull request.
 */
export declare function addReview(storage: PullRequestStorage, prNumber: number, reviewer: PullRequestAuthor, state: ReviewState, body?: string): PullRequestReview;
/**
 * List reviews for a pull request.
 */
export declare function listReviews(storage: PullRequestStorage, prNumber: number): PullRequestReview[];
/**
 * Get the current aggregate review state for a PR.
 *
 * Returns 'approved' only if at least one approval exists and no
 * outstanding 'changes_requested' reviews remain (latest per reviewer wins).
 */
export declare function getReviewState(storage: PullRequestStorage, prNumber: number): ReviewState;
/**
 * Dismiss a specific review by id.
 */
export declare function dismissReview(storage: PullRequestStorage, reviewId: number): void;
//# sourceMappingURL=pull-request.d.ts.map