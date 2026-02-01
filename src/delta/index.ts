/**
 * @fileoverview Delta Lake Subpath Barrel
 *
 * Targeted exports for the delta transaction log layer: ref-log, branching,
 * merging, and error types.
 *
 * @module delta
 *
 * @example
 * ```typescript
 * import { RefLog, DeltaBranch, threeWayMerge } from 'gitx.do/delta'
 * ```
 */

// Errors
export {
  DeltaError,
  DeltaVersionError,
} from './errors'

// Ref Log
export {
  RefLog,
  type RefLogEntry,
  type RefState,
  type RefLogBucket,
} from './ref-log'

// Branch
export {
  DeltaBranch,
  createBranch,
  createBranchAtVersion,
  type BranchInfo,
} from './branch'

// Merge
export {
  threeWayMerge,
  computeChanges,
  findCommonAncestor,
  canFastForward,
  type MergeConflict,
  type MergeResult,
} from './merge'
