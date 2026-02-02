/**
 * @fileoverview Delta branch: fork transaction log at a version.
 *
 * A branch is a fork of the ref log at a specific base version.
 * Branch state = base version entries + branch-specific entries.
 *
 * @module delta/branch
 */
import { RefLog } from './ref-log';
import { DeltaVersionError } from './errors';
// ============================================================================
// DeltaBranch Class
// ============================================================================
/**
 * A branch is a fork of a RefLog at a specific version.
 *
 * It maintains its own RefLog for branch-specific changes,
 * and merges those with the parent log up to baseVersion
 * to produce the full branch state.
 */
export class DeltaBranch {
    info;
    parentLog;
    branchLog;
    constructor(name, parentLog, baseVersion, bucket, prefix) {
        this.info = {
            name,
            baseVersion,
            createdAt: Date.now(),
        };
        this.parentLog = parentLog;
        this.branchLog = new RefLog(bucket, `${prefix}/branches/${name}`);
    }
    /** Get the branch-specific log. */
    getBranchLog() {
        return this.branchLog;
    }
    /** Get the parent log. */
    getParentLog() {
        return this.parentLog;
    }
    /**
     * Append a ref update to the branch-specific log.
     */
    append(ref_name, old_sha, new_sha, timestamp) {
        return this.branchLog.append(ref_name, old_sha, new_sha, timestamp);
    }
    /**
     * Compute the full branch state by:
     * 1. Replaying parent log up to baseVersion
     * 2. Applying branch-specific entries on top
     */
    replayState() {
        // Start with parent state at fork point
        const parentEntries = this.parentLog.snapshot(this.info.baseVersion);
        const tempLog = new RefLog(this.branchLog.getBucket(), '__temp__');
        tempLog.loadEntries(parentEntries);
        const state = tempLog.replayState();
        // Apply branch-specific entries
        for (const entry of this.branchLog.getEntries()) {
            if (entry.new_sha === '') {
                state.delete(entry.ref_name);
            }
            else {
                state.set(entry.ref_name, {
                    ref_name: entry.ref_name,
                    sha: entry.new_sha,
                    version: entry.version,
                });
            }
        }
        return state;
    }
    /**
     * Resolve a ref in the branch context.
     */
    resolve(ref_name) {
        return this.replayState().get(ref_name)?.sha;
    }
    /**
     * Get all branch-specific entries (changes since fork).
     */
    getBranchEntries() {
        return this.branchLog.getEntries();
    }
    /**
     * Flush branch-specific log to R2.
     */
    async flush() {
        return this.branchLog.flush();
    }
}
/**
 * Create a branch by forking a RefLog at its current version.
 */
export function createBranch(name, parentLog, bucket, prefix) {
    return new DeltaBranch(name, parentLog, parentLog.version, bucket, prefix);
}
/**
 * Create a branch at a specific version of the parent log.
 */
export function createBranchAtVersion(name, parentLog, atVersion, bucket, prefix) {
    if (atVersion < 0)
        throw new DeltaVersionError(atVersion, parentLog.version);
    if (atVersion > parentLog.version) {
        throw new DeltaVersionError(atVersion, parentLog.version);
    }
    return new DeltaBranch(name, parentLog, atVersion, bucket, prefix);
}
//# sourceMappingURL=branch.js.map