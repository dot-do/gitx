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
export { DeltaError, DeltaVersionError, } from './errors';
export { RefLog, type RefLogEntry, type RefState, type RefLogBucket, } from './ref-log';
export { DeltaBranch, createBranch, createBranchAtVersion, type BranchInfo, } from './branch';
export { threeWayMerge, computeChanges, findCommonAncestor, canFastForward, type MergeConflict, type MergeResult, } from './merge';
//# sourceMappingURL=index.d.ts.map