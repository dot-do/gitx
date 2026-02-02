/**
 * @fileoverview Delta merge: three-way log merge.
 *
 * Finds the common ancestor version between two branches,
 * computes both sets of changes, detects conflicts,
 * and produces a merged log.
 *
 * @module delta/merge
 */
import type { RefLogEntry, RefState } from './ref-log';
import { RefLog } from './ref-log';
import type { DeltaBranch } from './branch';
/** A conflict where both branches modified the same ref differently. */
export type MergeConflict = {
    kind: 'divergent';
    ref_name: string;
    base_sha: string | undefined;
    ours_sha: string;
    theirs_sha: string;
} | {
    kind: 'delete-update';
    ref_name: string;
    base_sha: string;
    deleted_by: 'ours' | 'theirs';
    kept_sha: string;
};
/** Result of a three-way merge. */
export interface MergeResult {
    /** Whether the merge completed without conflicts */
    success: boolean;
    /** Merged state (only refs without conflicts) */
    merged: Map<string, RefState>;
    /** Conflicts that need manual resolution */
    conflicts: MergeConflict[];
    /** The common ancestor version */
    baseVersion: number;
}
/**
 * Compute changes made by a set of log entries relative to a base state.
 * Returns a map of ref_name -> final new_sha (or '' for deletion).
 */
export declare function computeChanges(entries: RefLogEntry[]): Map<string, string>;
/**
 * Find the common ancestor version between two branches.
 * Both branches must share the same parent log.
 * The common ancestor is the minimum of both base versions.
 */
export declare function findCommonAncestor(ours: DeltaBranch, theirs: DeltaBranch): number;
/**
 * Perform a three-way merge of two branches.
 *
 * Algorithm:
 * 1. Find common ancestor version
 * 2. Get base state at ancestor
 * 3. Compute changes from each branch
 * 4. For each changed ref:
 *    - If only one branch changed it: accept that change
 *    - If both changed it to the same value: accept (no conflict)
 *    - If both changed it to different values: conflict
 */
export declare function threeWayMerge(parentLog: RefLog, ours: DeltaBranch, theirs: DeltaBranch): MergeResult;
/**
 * Fast-forward merge: when one branch has no changes,
 * just adopt the other branch's state.
 */
export declare function canFastForward(ours: DeltaBranch, theirs: DeltaBranch): 'ours' | 'theirs' | false;
//# sourceMappingURL=merge.d.ts.map