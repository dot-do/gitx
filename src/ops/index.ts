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
export {
  merge,
  findMergeBase,
  resolveConflict,
  abortMerge,
  continueMerge,
  getMergeState,
  isMergeInProgress,
  mergeContent,
  isBinaryFile,
  type ConflictType,
  type MergeStrategy,
  type MergeStatus,
  type ConflictMarker,
  type MergeConflict,
  type MergeOptions,
  type MergeStats,
  type MergeResult,
  type MergeState,
  type ResolveOptions,
  type ResolveResult,
  type MergeOperationResult,
  type MergeStorage,
} from './merge'

// Blame Operations
export {
  blame,
  blameFile,
  blameLine,
  blameRange,
  getBlameForCommit,
  trackContentAcrossRenames,
  detectRenames,
  buildBlameHistory,
  formatBlame,
  parseBlameOutput,
  type BlameStorage,
  type BlameOptions,
  type BlameLineInfo,
  type BlameCommitInfo,
  type BlameEntry,
  type BlameResult,
  type BlameFormatOptions,
  type PathHistoryEntry,
  type BlameHistoryEntry,
} from './blame'

// Commit Operations
export {
  createCommit,
  amendCommit,
  buildCommitObject,
  formatCommitMessage,
  parseCommitMessage,
  validateCommitMessage,
  isCommitSigned,
  extractCommitSignature,
  addSignatureToCommit,
  isEmptyCommit,
  getCurrentTimezone,
  formatTimestamp,
  parseTimestamp,
  createAuthor,
  type CommitAuthor,
  type SigningOptions,
  type CommitOptions,
  type AmendOptions,
  type FormatOptions,
  type CommitResult,
  type ObjectStore,
} from './commit'

// Branch Operations
export {
  createBranch,
  deleteBranch,
  listBranches,
  renameBranch,
  checkoutBranch,
  getCurrentBranch,
  getBranchInfo,
  branchExists,
  setBranchTracking,
  getBranchTracking,
  removeBranchTracking,
  getDefaultBranch,
  setDefaultBranch,
  isValidBranchName,
  normalizeBranchName,
  type RefStore,
  type BranchOptions,
  type BranchCreateResult,
  type BranchDeleteOptions,
  type BranchDeleteResult,
  type BranchListOptions,
  type BranchInfo,
  type TrackingInfo,
  type BranchRenameOptions,
  type BranchRenameResult,
  type CheckoutOptions,
  type CheckoutResult,
  type SetTrackingResult,
  type RemoveTrackingResult,
} from './branch'
