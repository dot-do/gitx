/**
 * @fileoverview Delta merge: three-way log merge.
 *
 * Finds the common ancestor version between two branches,
 * computes both sets of changes, detects conflicts,
 * and produces a merged log.
 *
 * @module delta/merge
 */
import { RefLog } from './ref-log';
// ============================================================================
// Merge Logic
// ============================================================================
/**
 * Compute changes made by a set of log entries relative to a base state.
 * Returns a map of ref_name -> final new_sha (or '' for deletion).
 */
export function computeChanges(entries) {
    const changes = new Map();
    for (const entry of entries) {
        changes.set(entry.ref_name, entry.new_sha);
    }
    return changes;
}
/**
 * Find the common ancestor version between two branches.
 * Both branches must share the same parent log.
 * The common ancestor is the minimum of both base versions.
 */
export function findCommonAncestor(ours, theirs) {
    return Math.min(ours.info.baseVersion, theirs.info.baseVersion);
}
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
export function threeWayMerge(parentLog, ours, theirs) {
    const baseVersion = findCommonAncestor(ours, theirs);
    // Compute base state at ancestor
    const baseEntries = parentLog.snapshot(baseVersion);
    const tempLog = new RefLog(null, '__merge_temp__');
    tempLog.loadEntries(baseEntries);
    const baseState = tempLog.replayState();
    // Compute changes from each branch
    const oursChanges = computeChanges([...ours.getBranchEntries()]);
    const theirsChanges = computeChanges([...theirs.getBranchEntries()]);
    // Start with base state
    const merged = new Map(baseState);
    const conflicts = [];
    // All refs touched by either branch
    const allRefs = new Set([...oursChanges.keys(), ...theirsChanges.keys()]);
    for (const ref of allRefs) {
        const oursChanged = oursChanges.has(ref);
        const theirsChanged = theirsChanges.has(ref);
        const baseSha = baseState.get(ref)?.sha;
        if (oursChanged && theirsChanged) {
            const oursSha = oursChanges.get(ref);
            const theirsSha = theirsChanges.get(ref);
            if (oursSha === theirsSha) {
                // Both made same change - no conflict
                if (oursSha === '') {
                    merged.delete(ref);
                }
                else {
                    merged.set(ref, { ref_name: ref, sha: oursSha, version: 0 });
                }
            }
            else if (oursSha === '' || theirsSha === '') {
                // One side deleted, the other updated → delete-update conflict
                conflicts.push({
                    kind: 'delete-update',
                    ref_name: ref,
                    base_sha: baseSha,
                    deleted_by: oursSha === '' ? 'ours' : 'theirs',
                    kept_sha: oursSha === '' ? theirsSha : oursSha,
                });
            }
            else {
                // Both sides modified to different values → divergent conflict
                conflicts.push({
                    kind: 'divergent',
                    ref_name: ref,
                    base_sha: baseSha,
                    ours_sha: oursSha,
                    theirs_sha: theirsSha,
                });
            }
        }
        else if (oursChanged) {
            const oursSha = oursChanges.get(ref);
            if (oursSha === '') {
                merged.delete(ref);
            }
            else {
                merged.set(ref, { ref_name: ref, sha: oursSha, version: 0 });
            }
        }
        else if (theirsChanged) {
            const theirsSha = theirsChanges.get(ref);
            if (theirsSha === '') {
                merged.delete(ref);
            }
            else {
                merged.set(ref, { ref_name: ref, sha: theirsSha, version: 0 });
            }
        }
    }
    return {
        success: conflicts.length === 0,
        merged,
        conflicts,
        baseVersion,
    };
}
/**
 * Fast-forward merge: when one branch has no changes,
 * just adopt the other branch's state.
 */
export function canFastForward(ours, theirs) {
    if (ours.getBranchEntries().length === 0)
        return 'theirs';
    if (theirs.getBranchEntries().length === 0)
        return 'ours';
    return false;
}
//# sourceMappingURL=merge.js.map