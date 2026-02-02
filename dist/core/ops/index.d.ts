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
export { type GitIdentity as Author } from '../objects/types';
export type { TreeEntry, ObjectType, GitIdentity, } from '../objects/types';
export type { BasicObjectStore, RefObjectStore, ObjectStore, CommitProvider, CommitInfo, StorageBackend, StoredObjectResult, ValidationResult, OperationResult, } from '../types';
export { getCurrentTimezone, formatTimestamp, parseTimestamp, createAuthor, formatCommitMessage, parseCommitMessage, validateCommitMessage, isCommitSigned, extractCommitSignature, addSignatureToCommit, isEmptyCommit, buildCommitObject, createCommit, amendCommit, type CommitAuthor, type SigningOptions, type CommitOptions, type AmendOptions, type FormatOptions, type CommitResult, } from './commit';
export { buildTreeHierarchy, sortTreeEntries, createTreeObject, deduplicateTrees, buildTreeFromIndex, type IndexEntry, type TreeNode, type BuildTreeResult, } from './tree-builder';
export { DiffStatus, FileMode, diffTrees, diffTreeToIndex, diffTreeToWorktree, isBinaryContent, calculateSimilarity, parseMode, isModeChangeSignificant, filterByPathspecs, walkTree, detectRenames, detectCopies, type DiffEntry, type DiffOptions, type DiffResult, type IndexEntry as DiffIndexEntry, } from './tree-diff';
export { CommitWalker, walkCommits, isAncestor, findCommonAncestor, findMergeBase as findMergeBaseTraversal, parseRevisionRange, expandRevisionRange, topologicalSort, sortByDate, getCommitsBetween, countCommits, type SortStrategy, type TraversalOptions, type RevisionRange, type TraversalCommit, type ExtendedCommitProvider, } from './commit-traversal';
export { findMergeBase, findAllMergeBases, findForkPoint, isAncestor as isMergeBaseAncestor, checkAncestor, findIndependentCommits, findOctopusMergeBase, computeThreeWayMergeBase, hasCommonHistory, computeRecursiveMergeBase, type MergeBaseResult, type MergeBaseOptions, type ForkPointResult, type AncestorCheckResult, } from './merge-base';
export { blame, blameFile, blameLine, blameRange, getBlameForCommit, trackContentAcrossRenames, detectRenames as detectBlameRenames, buildBlameHistory, formatBlame, parseBlameOutput, type BlameStorage, type BlameOptions, type BlameLineInfo, type BlameCommitInfo, type BlameEntry, type BlameResult, type BlameFormatOptions, type PathHistoryEntry, type BlameHistoryEntry, type BlameCommitObject, type BlameTreeObject, } from './blame';
export { BRANCH_REF_PREFIX, REMOTE_REF_PREFIX, isValidBranchName, normalizeBranchName, createBranch, deleteBranch, listBranches, renameBranch, checkoutBranch, getCurrentBranch, getBranchInfo, branchExists, setBranchTracking, getBranchTracking, removeBranchTracking, getDefaultBranch, setDefaultBranch, type RefStore, type BranchOptions, type BranchCreateResult, type BranchDeleteOptions, type BranchDeleteResult, type BranchListOptions, type BranchInfo, type TrackingInfo, type BranchRenameOptions, type BranchRenameResult, type CheckoutOptions, type CheckoutResult, type SetTrackingResult, type RemoveTrackingResult, } from './branch';
export { createLightweightTag, createAnnotatedTag, buildTagObject, deleteTag, listTags, getTag, verifyTag, isAnnotatedTag, getTagTarget, getTagTagger, resolveTagToCommit, parseTagObject, formatTagMessage, type TagOptions, type SigningOptions as TagSigningOptions, type AnnotatedTagOptions, type TagResult, type TagListOptions, type TagListEntry, type TagVerifyOptions, type TagVerifyResult, type TagInfo, type DeleteTagResult, type DeleteTagOptions, type TagObjectStore, type TagObject, type Author as TaggerAuthor, } from './tag';
//# sourceMappingURL=index.d.ts.map