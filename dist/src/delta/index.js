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
// Errors
export { DeltaError, DeltaVersionError, } from './errors';
// Ref Log
export { RefLog, } from './ref-log';
// Branch - aliased to avoid conflicts with ops/branch
export { DeltaBranch, createBranch as createDeltaBranch, createBranchAtVersion, } from './branch';
// Merge - aliased to avoid conflicts with ops/merge
export { threeWayMerge, computeChanges, findCommonAncestor, canFastForward, } from './merge';
//# sourceMappingURL=index.js.map