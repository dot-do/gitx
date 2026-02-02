/**
 * @fileoverview Core Git Operations Subpath Barrel
 *
 * Targeted exports for core git operations: merge, blame, commit, and branch.
 *
 * @module core (operations)
 *
 * @example
 * ```typescript
 * import { merge, blame, createCommit, createBranch } from 'gitx.do/core'
 * ```
 */
// Merge Operations
export { merge, findMergeBase, resolveConflict, abortMerge, continueMerge, getMergeState, isMergeInProgress, mergeContent, isBinaryFile, } from './merge';
// Blame Operations
export { blame, blameFile, blameLine, blameRange, getBlameForCommit, trackContentAcrossRenames, detectRenames, buildBlameHistory, formatBlame, parseBlameOutput, } from './blame';
// Commit Operations
export { createCommit, amendCommit, buildCommitObject, formatCommitMessage, parseCommitMessage, validateCommitMessage, isCommitSigned, extractCommitSignature, addSignatureToCommit, isEmptyCommit, getCurrentTimezone, formatTimestamp, parseTimestamp, createAuthor, } from './commit';
// Branch Operations
export { createBranch, deleteBranch, listBranches, renameBranch, checkoutBranch, getCurrentBranch, getBranchInfo, branchExists, setBranchTracking, getBranchTracking, removeBranchTracking, getDefaultBranch, setDefaultBranch, isValidBranchName, normalizeBranchName, } from './branch';
// Sparse Checkout Operations
export { SparseCheckout, compilePattern, filterEntries, filterTreeEntries, } from './sparse-checkout';
// Worktree Operations
export { addWorktree, listWorktrees, removeWorktree, lockWorktree, unlockWorktree, moveWorktree, pruneWorktrees, getWorktreeHead, setWorktreeHead, } from './worktree';
// Pull Request Operations
export { createPullRequest, getPullRequest, listPullRequests, updatePullRequestStatus, mergePullRequest, addReview, listReviews, getReviewState, dismissReview, initPullRequestSchema, PULL_REQUEST_SCHEMA_SQL, } from './pull-request';
// Mirror Operations
export { MirrorSync, pullMirror, pushMirror, matchRefPattern, filterRefs, } from './mirror';
//# sourceMappingURL=index.js.map