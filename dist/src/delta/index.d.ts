/**
 * @fileoverview Delta Lake Subpath Barrel
 *
 * Targeted exports for the delta transaction log layer: ref-log, branching,
 * merging, and error types.
 *
 * NOTE: Branch and merge types are aliased to avoid conflicts with src/ops/index.ts
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
export { DeltaBranch, createBranch as createDeltaBranch, createBranchAtVersion, type BranchInfo as DeltaBranchInfo, } from './branch';
export { threeWayMerge, computeChanges, findCommonAncestor, canFastForward, type MergeConflict as DeltaMergeConflict, type MergeResult as DeltaMergeResult, } from './merge';
//# sourceMappingURL=index.d.ts.map