/**
 * @fileoverview Delta branch: fork transaction log at a version.
 *
 * A branch is a fork of the ref log at a specific base version.
 * Branch state = base version entries + branch-specific entries.
 *
 * @module delta/branch
 */

import { RefLog, type RefLogEntry, type RefLogBucket, type RefState } from './ref-log'

// ============================================================================
// Types
// ============================================================================

export interface BranchInfo {
  /** Branch name */
  name: string
  /** Version of the parent log where this branch was forked */
  baseVersion: number
  /** When the branch was created */
  createdAt: number
}

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
  readonly info: BranchInfo
  private parentLog: RefLog
  private branchLog: RefLog

  constructor(
    name: string,
    parentLog: RefLog,
    baseVersion: number,
    bucket: RefLogBucket,
    prefix: string,
  ) {
    this.info = {
      name,
      baseVersion,
      createdAt: Date.now(),
    }
    this.parentLog = parentLog
    this.branchLog = new RefLog(bucket, `${prefix}/branches/${name}`)
  }

  /** Get the branch-specific log. */
  getBranchLog(): RefLog {
    return this.branchLog
  }

  /** Get the parent log. */
  getParentLog(): RefLog {
    return this.parentLog
  }

  /**
   * Append a ref update to the branch-specific log.
   */
  append(ref_name: string, old_sha: string, new_sha: string, timestamp?: number): RefLogEntry {
    return this.branchLog.append(ref_name, old_sha, new_sha, timestamp)
  }

  /**
   * Compute the full branch state by:
   * 1. Replaying parent log up to baseVersion
   * 2. Applying branch-specific entries on top
   */
  replayState(): Map<string, RefState> {
    // Start with parent state at fork point
    const parentEntries = this.parentLog.snapshot(this.info.baseVersion)
    const tempLog = new RefLog(this.branchLog.getBucket(), '__temp__')
    tempLog.loadEntries(parentEntries)
    const state = tempLog.replayState()

    // Apply branch-specific entries
    for (const entry of this.branchLog.getEntries()) {
      if (entry.new_sha === '') {
        state.delete(entry.ref_name)
      } else {
        state.set(entry.ref_name, {
          ref_name: entry.ref_name,
          sha: entry.new_sha,
          version: entry.version,
        })
      }
    }

    return state
  }

  /**
   * Resolve a ref in the branch context.
   */
  resolve(ref_name: string): string | undefined {
    return this.replayState().get(ref_name)?.sha
  }

  /**
   * Get all branch-specific entries (changes since fork).
   */
  getBranchEntries(): ReadonlyArray<RefLogEntry> {
    return this.branchLog.getEntries()
  }

  /**
   * Flush branch-specific log to R2.
   */
  async flush(): Promise<string | null> {
    return this.branchLog.flush()
  }
}

/**
 * Create a branch by forking a RefLog at its current version.
 */
export function createBranch(
  name: string,
  parentLog: RefLog,
  bucket: RefLogBucket,
  prefix: string,
): DeltaBranch {
  return new DeltaBranch(name, parentLog, parentLog.version, bucket, prefix)
}

/**
 * Create a branch at a specific version of the parent log.
 */
export function createBranchAtVersion(
  name: string,
  parentLog: RefLog,
  atVersion: number,
  bucket: RefLogBucket,
  prefix: string,
): DeltaBranch {
  if (atVersion > parentLog.version) {
    throw new Error(`Cannot fork at version ${atVersion}: parent log only has ${parentLog.version} entries`)
  }
  return new DeltaBranch(name, parentLog, atVersion, bucket, prefix)
}
