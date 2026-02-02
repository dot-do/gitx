/**
 * @fileoverview Delta branch: fork transaction log at a version.
 *
 * A branch is a fork of the ref log at a specific base version.
 * Branch state = base version entries + branch-specific entries.
 *
 * @module delta/branch
 */
import { RefLog, type RefLogEntry, type RefLogBucket, type RefState } from './ref-log';
export interface BranchInfo {
    /** Branch name */
    name: string;
    /** Version of the parent log where this branch was forked */
    baseVersion: number;
    /** When the branch was created */
    createdAt: number;
}
/**
 * A branch is a fork of a RefLog at a specific version.
 *
 * It maintains its own RefLog for branch-specific changes,
 * and merges those with the parent log up to baseVersion
 * to produce the full branch state.
 */
export declare class DeltaBranch {
    readonly info: BranchInfo;
    private parentLog;
    private branchLog;
    constructor(name: string, parentLog: RefLog, baseVersion: number, bucket: RefLogBucket, prefix: string);
    /** Get the branch-specific log. */
    getBranchLog(): RefLog;
    /** Get the parent log. */
    getParentLog(): RefLog;
    /**
     * Append a ref update to the branch-specific log.
     */
    append(ref_name: string, old_sha: string, new_sha: string, timestamp?: number): RefLogEntry;
    /**
     * Compute the full branch state by:
     * 1. Replaying parent log up to baseVersion
     * 2. Applying branch-specific entries on top
     */
    replayState(): Map<string, RefState>;
    /**
     * Resolve a ref in the branch context.
     */
    resolve(ref_name: string): string | undefined;
    /**
     * Get all branch-specific entries (changes since fork).
     */
    getBranchEntries(): ReadonlyArray<RefLogEntry>;
    /**
     * Flush branch-specific log to R2.
     */
    flush(): Promise<string | null>;
}
/**
 * Create a branch by forking a RefLog at its current version.
 */
export declare function createBranch(name: string, parentLog: RefLog, bucket: RefLogBucket, prefix: string): DeltaBranch;
/**
 * Create a branch at a specific version of the parent log.
 */
export declare function createBranchAtVersion(name: string, parentLog: RefLog, atVersion: number, bucket: RefLogBucket, prefix: string): DeltaBranch;
//# sourceMappingURL=branch.d.ts.map