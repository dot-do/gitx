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
// Commit Operations
// =============================================================================
export { 
// Author/Timestamp utilities
getCurrentTimezone, formatTimestamp, parseTimestamp, createAuthor, 
// Message formatting
formatCommitMessage, parseCommitMessage, validateCommitMessage, 
// GPG signing
isCommitSigned, extractCommitSignature, addSignatureToCommit, 
// Empty commit detection
isEmptyCommit, 
// Commit creation
buildCommitObject, createCommit, amendCommit, } from './commit';
// =============================================================================
// Tree Builder Operations
// =============================================================================
export { 
// Tree building
buildTreeHierarchy, sortTreeEntries, createTreeObject, deduplicateTrees, buildTreeFromIndex, } from './tree-builder';
// =============================================================================
// Tree Diff Operations
// =============================================================================
export { 
// Diff status
DiffStatus, FileMode, 
// Core diff functions
diffTrees, diffTreeToIndex, diffTreeToWorktree, 
// Utility functions
isBinaryContent, calculateSimilarity, parseMode, isModeChangeSignificant, filterByPathspecs, walkTree, 
// Detection functions
detectRenames, detectCopies, } from './tree-diff';
// =============================================================================
// Commit Traversal Operations
// =============================================================================
export { 
// Walker class
CommitWalker, 
// Generator function
walkCommits, 
// Ancestor functions
isAncestor, findCommonAncestor, findMergeBase as findMergeBaseTraversal, 
// Revision ranges
parseRevisionRange, expandRevisionRange, 
// Sorting
topologicalSort, sortByDate, 
// Utility functions
getCommitsBetween, countCommits, } from './commit-traversal';
// =============================================================================
// Merge Base Operations
// =============================================================================
export { 
// Core merge base functions
findMergeBase, findAllMergeBases, findForkPoint, isAncestor as isMergeBaseAncestor, checkAncestor, 
// Advanced functions
findIndependentCommits, findOctopusMergeBase, computeThreeWayMergeBase, hasCommonHistory, computeRecursiveMergeBase, } from './merge-base';
// =============================================================================
// Blame Operations
// =============================================================================
export { 
// Main blame function
blame, blameFile, blameLine, blameRange, getBlameForCommit, 
// Rename tracking
trackContentAcrossRenames, detectRenames as detectBlameRenames, 
// History building
buildBlameHistory, 
// Formatting
formatBlame, parseBlameOutput, } from './blame';
// =============================================================================
// Branch Operations
// =============================================================================
export { 
// Constants
BRANCH_REF_PREFIX, REMOTE_REF_PREFIX, 
// Validation
isValidBranchName, normalizeBranchName, 
// Branch management
createBranch, deleteBranch, listBranches, renameBranch, checkoutBranch, getCurrentBranch, getBranchInfo, branchExists, 
// Tracking
setBranchTracking, getBranchTracking, removeBranchTracking, 
// Default branch
getDefaultBranch, setDefaultBranch, } from './branch';
// =============================================================================
// Tag Operations
// =============================================================================
export { 
// Tag creation
createLightweightTag, createAnnotatedTag, buildTagObject, 
// Tag management
deleteTag, listTags, getTag, 
// Tag verification
verifyTag, isAnnotatedTag, getTagTarget, getTagTagger, resolveTagToCommit, 
// Parsing and formatting
parseTagObject, formatTagMessage, } from './tag';
//# sourceMappingURL=index.js.map