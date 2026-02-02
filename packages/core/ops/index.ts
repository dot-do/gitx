/**
 * @fileoverview Git Operations Module
 *
 * This module provides high-level Git operations that work with the core
 * object model. All operations are platform-agnostic and can run in any
 * JavaScript runtime.
 *
 * ## Available Operations
 *
 * - **Commit Operations**: Create, amend, and validate commits
 * - **Tree Operations**: Build and diff tree objects
 * - **Traversal Operations**: Walk commit graphs, find ancestors
 * - **Merge Base Operations**: Find common ancestors for merging
 * - **Blame Operations**: Line-by-line file attribution
 * - **Branch Operations**: Create, delete, rename, checkout branches
 * - **Tag Operations**: Create and manage tags
 *
 * @module ops
 *
 * @example
 * ```typescript
 * import {
 *   createCommit,
 *   buildTreeFromIndex,
 *   diffTrees,
 *   walkCommits,
 *   findMergeBase,
 *   blame,
 *   createBranch,
 *   createAnnotatedTag
 * } from '@dotdo/gitx/ops'
 * ```
 */

// =============================================================================
// Type Aliases
// =============================================================================

// Re-export GitIdentity as Author for compatibility with ops modules
export { type GitIdentity as Author } from '../objects/types'

// Re-export core types used by operations
export type {
  TreeEntry,
  ObjectType,
  GitIdentity,
} from '../objects/types'

// =============================================================================
// Storage Types
// =============================================================================

export type {
  BasicObjectStore,
  RefObjectStore,
  ObjectStore,
  CommitProvider,
  CommitInfo,
  StorageBackend,
  StoredObjectResult,
  ValidationResult,
  OperationResult,
} from '../types'

// =============================================================================
// Commit Operations
// =============================================================================

export {
  // Author/Timestamp utilities
  getCurrentTimezone,
  formatTimestamp,
  parseTimestamp,
  createAuthor,

  // Message formatting
  formatCommitMessage,
  parseCommitMessage,
  validateCommitMessage,

  // GPG signing
  isCommitSigned,
  extractCommitSignature,
  addSignatureToCommit,

  // Empty commit detection
  isEmptyCommit,

  // Commit creation
  buildCommitObject,
  createCommit,
  amendCommit,

  // Types
  type CommitAuthor,
  type SigningOptions,
  type CommitOptions,
  type AmendOptions,
  type FormatOptions,
  type CommitResult,
} from './commit'

// =============================================================================
// Tree Builder Operations
// =============================================================================

export {
  // Tree building
  buildTreeHierarchy,
  sortTreeEntries,
  createTreeObject,
  deduplicateTrees,
  buildTreeFromIndex,

  // Types
  type IndexEntry,
  type TreeNode,
  type BuildTreeResult,
} from './tree-builder'

// =============================================================================
// Tree Diff Operations
// =============================================================================

export {
  // Diff status
  DiffStatus,
  FileMode,

  // Core diff functions
  diffTrees,
  diffTreeToIndex,
  diffTreeToWorktree,

  // Utility functions
  isBinaryContent,
  calculateSimilarity,
  parseMode,
  isModeChangeSignificant,
  filterByPathspecs,
  walkTree,

  // Detection functions
  detectRenames,
  detectCopies,

  // Types
  type DiffEntry,
  type DiffOptions,
  type DiffResult,
  type IndexEntry as DiffIndexEntry,
} from './tree-diff'

// =============================================================================
// Commit Traversal Operations
// =============================================================================

export {
  // Walker class
  CommitWalker,

  // Generator function
  walkCommits,

  // Ancestor functions
  isAncestor,
  findCommonAncestor,
  findMergeBase as findMergeBaseTraversal,

  // Revision ranges
  parseRevisionRange,
  expandRevisionRange,

  // Sorting
  topologicalSort,
  sortByDate,

  // Utility functions
  getCommitsBetween,
  countCommits,

  // Types
  type SortStrategy,
  type TraversalOptions,
  type RevisionRange,
  type TraversalCommit,
  type ExtendedCommitProvider,
} from './commit-traversal'

// =============================================================================
// Merge Base Operations
// =============================================================================

export {
  // Core merge base functions
  findMergeBase,
  findAllMergeBases,
  findForkPoint,
  isAncestor as isMergeBaseAncestor,
  checkAncestor,

  // Advanced functions
  findIndependentCommits,
  findOctopusMergeBase,
  computeThreeWayMergeBase,
  hasCommonHistory,
  computeRecursiveMergeBase,

  // Types
  type MergeBaseResult,
  type MergeBaseOptions,
  type ForkPointResult,
  type AncestorCheckResult,
} from './merge-base'

// =============================================================================
// Blame Operations
// =============================================================================

export {
  // Main blame function
  blame,
  blameFile,
  blameLine,
  blameRange,
  getBlameForCommit,

  // Rename tracking
  trackContentAcrossRenames,
  detectRenames as detectBlameRenames,

  // History building
  buildBlameHistory,

  // Formatting
  formatBlame,
  parseBlameOutput,

  // Types
  type BlameStorage,
  type BlameOptions,
  type BlameLineInfo,
  type BlameCommitInfo,
  type BlameEntry,
  type BlameResult,
  type BlameFormatOptions,
  type PathHistoryEntry,
  type BlameHistoryEntry,
  type BlameCommitObject,
  type BlameTreeObject,
} from './blame'

// =============================================================================
// Branch Operations
// =============================================================================

export {
  // Constants
  BRANCH_REF_PREFIX,
  REMOTE_REF_PREFIX,

  // Validation
  isValidBranchName,
  normalizeBranchName,

  // Branch management
  createBranch,
  deleteBranch,
  listBranches,
  renameBranch,
  checkoutBranch,
  getCurrentBranch,
  getBranchInfo,
  branchExists,

  // Tracking
  setBranchTracking,
  getBranchTracking,
  removeBranchTracking,

  // Default branch
  getDefaultBranch,
  setDefaultBranch,

  // Types
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

// =============================================================================
// Tag Operations
// =============================================================================

export {
  // Tag creation
  createLightweightTag,
  createAnnotatedTag,
  buildTagObject,

  // Tag management
  deleteTag,
  listTags,
  getTag,

  // Tag verification
  verifyTag,
  isAnnotatedTag,
  getTagTarget,
  getTagTagger,
  resolveTagToCommit,

  // Parsing and formatting
  parseTagObject,
  formatTagMessage,

  // Types
  type TagOptions,
  type SigningOptions as TagSigningOptions,
  type AnnotatedTagOptions,
  type TagResult,
  type TagListOptions,
  type TagListEntry,
  type TagVerifyOptions,
  type TagVerifyResult,
  type TagInfo,
  type DeleteTagResult,
  type DeleteTagOptions,
  type TagObjectStore,
  type TagObject,
  type Author as TaggerAuthor,
} from './tag'
