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
 *   findMergeBase
 * } from '@dotdo/gitx/ops'
 * ```
 */
export { type GitIdentity as Author } from '../objects/types';
export type { TreeEntry, ObjectType, GitIdentity, } from '../objects/types';
export type { BasicObjectStore, RefObjectStore, ObjectStore, CommitProvider, CommitInfo, StorageBackend, StoredObjectResult, ValidationResult, OperationResult, } from '../types';
export { getCurrentTimezone, formatTimestamp, parseTimestamp, createAuthor, formatCommitMessage, parseCommitMessage, validateCommitMessage, isCommitSigned, extractCommitSignature, addSignatureToCommit, isEmptyCommit, buildCommitObject, createCommit, amendCommit, type CommitAuthor, type SigningOptions, type CommitOptions, type AmendOptions, type FormatOptions, type CommitResult, } from './commit';
export { buildTreeHierarchy, sortTreeEntries, createTreeObject, deduplicateTrees, buildTreeFromIndex, type IndexEntry, type TreeNode, type BuildTreeResult, } from './tree-builder';
export { DiffStatus, FileMode, diffTrees, diffTreeToIndex, diffTreeToWorktree, isBinaryContent, calculateSimilarity, parseMode, isModeChangeSignificant, filterByPathspecs, walkTree, detectRenames, detectCopies, type DiffEntry, type DiffOptions, type DiffResult, type IndexEntry as DiffIndexEntry, } from './tree-diff';
export { CommitWalker, walkCommits, isAncestor, findCommonAncestor, findMergeBase as findMergeBaseTraversal, parseRevisionRange, expandRevisionRange, topologicalSort, sortByDate, getCommitsBetween, countCommits, type SortStrategy, type TraversalOptions, type RevisionRange, type TraversalCommit, } from './commit-traversal';
export { findMergeBase, findAllMergeBases, findForkPoint, isAncestor as isMergeBaseAncestor, checkAncestor, findIndependentCommits, findOctopusMergeBase, computeThreeWayMergeBase, hasCommonHistory, computeRecursiveMergeBase, type MergeBaseResult, type MergeBaseOptions, type ForkPointResult, type AncestorCheckResult, } from './merge-base';
//# sourceMappingURL=index.d.ts.map