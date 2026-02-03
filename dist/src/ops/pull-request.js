/**
 * @fileoverview Pull Request / Merge Request Workflows
 *
 * Implements PR creation, listing, merging (fast-forward, 3-way, squash),
 * status tracking, and review state. PR state is stored in SQLite.
 * Merge operations delegate to the existing merge infrastructure in ./merge.ts.
 *
 * @module ops/pull-request
 */
import { merge } from './merge';
// ============================================================================
// SQL Schema
// ============================================================================
/**
 * SQL statements to create pull_requests and pull_request_reviews tables.
 * Designed to be executed alongside the existing schema in do/schema.ts.
 */
export const PULL_REQUEST_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pull_requests (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  labels TEXT NOT NULL DEFAULT '[]',
  source_sha TEXT NOT NULL,
  target_sha TEXT NOT NULL,
  merge_commit_sha TEXT,
  merge_method TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pr_status ON pull_requests(status);
CREATE INDEX IF NOT EXISTS idx_pr_source_branch ON pull_requests(source_branch);
CREATE INDEX IF NOT EXISTS idx_pr_target_branch ON pull_requests(target_branch);
CREATE INDEX IF NOT EXISTS idx_pr_author ON pull_requests(author_email);

CREATE TABLE IF NOT EXISTS pull_request_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_number INTEGER NOT NULL REFERENCES pull_requests(number) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  reviewer_email TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_pr ON pull_request_reviews(pr_number);
CREATE INDEX IF NOT EXISTS idx_pr_reviews_state ON pull_request_reviews(state);
`;
// ============================================================================
// Row helpers
// ============================================================================
function rowToPullRequest(row) {
    const mergeCommitSha = row['merge_commit_sha'];
    const mergeMethod = row['merge_method'];
    const closedAt = row['closed_at'];
    return {
        number: row['number'],
        title: row['title'],
        description: row['description'],
        status: row['status'],
        sourceBranch: row['source_branch'],
        targetBranch: row['target_branch'],
        author: {
            name: row['author_name'],
            email: row['author_email'],
        },
        labels: JSON.parse(row['labels'] || '[]'),
        sourceSha: row['source_sha'],
        targetSha: row['target_sha'],
        createdAt: row['created_at'],
        updatedAt: row['updated_at'],
        ...(mergeCommitSha != null && { mergeCommitSha }),
        ...(mergeMethod != null && { mergeMethod }),
        ...(closedAt != null && { closedAt }),
    };
}
function rowToReview(row) {
    const body = row['body'];
    return {
        id: row['id'],
        prNumber: row['pr_number'],
        reviewer: {
            name: row['reviewer_name'],
            email: row['reviewer_email'],
        },
        state: row['state'],
        createdAt: row['created_at'],
        ...(body != null && body !== '' && { body }),
    };
}
// ============================================================================
// Core Operations
// ============================================================================
/**
 * Initialise the pull request schema tables. Idempotent.
 */
export function initPullRequestSchema(storage) {
    storage.sqlExec(PULL_REQUEST_SCHEMA_SQL);
}
/**
 * Create a new pull request.
 */
export async function createPullRequest(storage, options) {
    const sourceSha = await storage.readRef(`refs/heads/${options.sourceBranch}`);
    if (!sourceSha) {
        throw new Error(`Source branch not found: ${options.sourceBranch}`);
    }
    const targetSha = await storage.readRef(`refs/heads/${options.targetBranch}`);
    if (!targetSha) {
        throw new Error(`Target branch not found: ${options.targetBranch}`);
    }
    const now = Date.now();
    const status = options.draft ? 'draft' : 'open';
    const labels = JSON.stringify(options.labels ?? []);
    storage.sqlExec(`INSERT INTO pull_requests (title, description, status, source_branch, target_branch, author_name, author_email, labels, source_sha, target_sha, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, options.title, options.description ?? '', status, options.sourceBranch, options.targetBranch, options.author.name, options.author.email, labels, sourceSha, targetSha, now, now);
    // Fetch the just-inserted row (last_insert_rowid)
    const rows = storage.sqlExec('SELECT * FROM pull_requests WHERE number = last_insert_rowid()').rows;
    if (rows.length === 0) {
        // Fallback: fetch by unique fields
        const fallback = storage.sqlExec('SELECT * FROM pull_requests WHERE source_branch = ? AND target_branch = ? AND created_at = ? ORDER BY number DESC LIMIT 1', options.sourceBranch, options.targetBranch, now).rows;
        const fallbackRow = fallback[0];
        if (!fallbackRow)
            throw new Error('Failed to create pull request');
        return rowToPullRequest(fallbackRow);
    }
    const row = rows[0];
    if (!row)
        throw new Error('Failed to create pull request');
    return rowToPullRequest(row);
}
/**
 * Get a single pull request by number.
 */
export function getPullRequest(storage, prNumber) {
    const rows = storage.sqlExec('SELECT * FROM pull_requests WHERE number = ?', prNumber).rows;
    const row = rows[0];
    return row ? rowToPullRequest(row) : null;
}
/**
 * List pull requests with optional filters.
 */
export function listPullRequests(storage, options = {}) {
    const conditions = [];
    const params = [];
    if (options.status && options.status !== 'all') {
        conditions.push('status = ?');
        params.push(options.status);
    }
    if (options.targetBranch) {
        conditions.push('target_branch = ?');
        params.push(options.targetBranch);
    }
    if (options.sourceBranch) {
        conditions.push('source_branch = ?');
        params.push(options.sourceBranch);
    }
    if (options.authorEmail) {
        conditions.push('author_email = ?');
        params.push(options.authorEmail);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const rows = storage.sqlExec(`SELECT * FROM pull_requests ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset).rows;
    return rows.map(rowToPullRequest);
}
/**
 * Update pull request status (open, closed, draft).
 * Use {@link mergePullRequest} to transition to 'merged'.
 */
export function updatePullRequestStatus(storage, prNumber, status) {
    const pr = getPullRequest(storage, prNumber);
    if (!pr)
        throw new Error(`Pull request #${prNumber} not found`);
    if (pr.status === 'merged')
        throw new Error(`Pull request #${prNumber} is already merged`);
    const now = Date.now();
    const closedAt = status === 'closed' ? now : null;
    storage.sqlExec('UPDATE pull_requests SET status = ?, updated_at = ?, closed_at = ? WHERE number = ?', status, now, closedAt, prNumber);
    return { ...pr, status, updatedAt: now, ...(closedAt != null && { closedAt }) };
}
/**
 * Merge a pull request using the specified method.
 *
 * Delegates to the merge infrastructure in ./merge.ts for the actual
 * three-way merge / fast-forward / squash logic, then updates PR state.
 */
export async function mergePullRequest(storage, prNumber, options) {
    const pr = getPullRequest(storage, prNumber);
    if (!pr) {
        return { success: false, error: `Pull request #${prNumber} not found` };
    }
    if (pr.status === 'merged') {
        return { success: false, error: `Pull request #${prNumber} is already merged` };
    }
    if (pr.status === 'closed') {
        return { success: false, error: `Pull request #${prNumber} is closed` };
    }
    // Resolve current SHAs (branches may have moved since PR creation)
    const sourceSha = await storage.readRef(`refs/heads/${pr.sourceBranch}`);
    if (!sourceSha) {
        return { success: false, error: `Source branch not found: ${pr.sourceBranch}` };
    }
    const targetSha = await storage.readRef(`refs/heads/${pr.targetBranch}`);
    if (!targetSha) {
        return { success: false, error: `Target branch not found: ${pr.targetBranch}` };
    }
    const method = options.method ?? 'merge';
    const defaultMessage = `Merge pull request #${prNumber} from ${pr.sourceBranch}\n\n${pr.title}`;
    const message = options.message ?? defaultMessage;
    // Build MergeOptions based on method
    const mergeOpts = {
        message,
        author: {
            name: options.mergedBy.name,
            email: options.mergedBy.email,
            timestamp: Math.floor(Date.now() / 1000),
        },
    };
    switch (method) {
        case 'fast-forward':
            mergeOpts.fastForwardOnly = true;
            break;
        case 'squash':
            mergeOpts.squash = true;
            mergeOpts.allowFastForward = false;
            break;
        case 'merge':
        default:
            mergeOpts.allowFastForward = false;
            break;
    }
    // Perform the merge: target is "ours", source is "theirs"
    let mergeResult;
    try {
        mergeResult = await merge(storage, targetSha, sourceSha, mergeOpts);
    }
    catch (err) {
        return {
            success: false,
            error: `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    if (mergeResult.status === 'conflicted') {
        return {
            success: false,
            error: `Merge has ${mergeResult.conflicts?.length ?? 0} conflict(s) that must be resolved`,
            mergeResult,
        };
    }
    if (mergeResult.status === 'up-to-date') {
        return {
            success: false,
            error: 'Already up to date, nothing to merge',
            mergeResult,
        };
    }
    // Determine the final SHA
    const finalSha = mergeResult.commitSha ?? mergeResult.treeSha ?? sourceSha;
    // Update the target branch ref
    await storage.writeRef(`refs/heads/${pr.targetBranch}`, finalSha);
    // Update PR record
    const now = Date.now();
    storage.sqlExec(`UPDATE pull_requests SET status = 'merged', merge_commit_sha = ?, merge_method = ?, updated_at = ?, closed_at = ?, source_sha = ?, target_sha = ? WHERE number = ?`, finalSha, method, now, now, sourceSha, targetSha, prNumber);
    return {
        success: true,
        mergeResult,
        mergeCommitSha: finalSha,
    };
}
// ============================================================================
// Reviews
// ============================================================================
/**
 * Add a review to a pull request.
 */
export function addReview(storage, prNumber, reviewer, state, body) {
    const pr = getPullRequest(storage, prNumber);
    if (!pr)
        throw new Error(`Pull request #${prNumber} not found`);
    const now = Date.now();
    storage.sqlExec(`INSERT INTO pull_request_reviews (pr_number, reviewer_name, reviewer_email, state, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`, prNumber, reviewer.name, reviewer.email, state, body ?? '', now);
    // Update PR updated_at
    storage.sqlExec('UPDATE pull_requests SET updated_at = ? WHERE number = ?', now, prNumber);
    const rows = storage.sqlExec('SELECT * FROM pull_request_reviews WHERE pr_number = ? ORDER BY id DESC LIMIT 1', prNumber).rows;
    const row = rows[0];
    if (!row)
        throw new Error('Failed to create review');
    return rowToReview(row);
}
/**
 * List reviews for a pull request.
 */
export function listReviews(storage, prNumber) {
    const rows = storage.sqlExec('SELECT * FROM pull_request_reviews WHERE pr_number = ? ORDER BY created_at ASC', prNumber).rows;
    return rows.map(rowToReview);
}
/**
 * Get the current aggregate review state for a PR.
 *
 * Returns 'approved' only if at least one approval exists and no
 * outstanding 'changes_requested' reviews remain (latest per reviewer wins).
 */
export function getReviewState(storage, prNumber) {
    const reviews = listReviews(storage, prNumber);
    if (reviews.length === 0)
        return 'pending';
    // Deduplicate: keep only the latest review per reviewer email
    const latestByReviewer = new Map();
    for (const review of reviews) {
        latestByReviewer.set(review.reviewer.email, review);
    }
    let hasApproval = false;
    for (const review of latestByReviewer.values()) {
        if (review.state === 'changes_requested')
            return 'changes_requested';
        if (review.state === 'approved')
            hasApproval = true;
    }
    return hasApproval ? 'approved' : 'pending';
}
/**
 * Dismiss a specific review by id.
 */
export function dismissReview(storage, reviewId) {
    storage.sqlExec("UPDATE pull_request_reviews SET state = 'dismissed' WHERE id = ?", reviewId);
}
//# sourceMappingURL=pull-request.js.map