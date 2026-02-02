/**
 * @fileoverview Delta transaction log for ref updates.
 *
 * Each ref update creates a new log entry with version, ref_name, old_sha,
 * new_sha, and timestamp. The log is stored as append-only Parquet on R2.
 * Current state is reconstructed by replaying the log.
 *
 * @module delta/ref-log
 */
/** A single ref log entry. */
export interface RefLogEntry {
    /** Monotonically increasing version number */
    version: number;
    /** Ref name (e.g., "refs/heads/main") */
    ref_name: string;
    /** Previous SHA (empty string for creation) */
    old_sha: string;
    /** New SHA (empty string for deletion) */
    new_sha: string;
    /** Unix timestamp in milliseconds */
    timestamp: number;
}
/** Current state of a ref after replaying the log. */
export interface RefState {
    ref_name: string;
    sha: string;
    version: number;
}
/** R2-like bucket interface (subset used by RefLog). */
export interface RefLogBucket {
    put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>;
    get(key: string): Promise<{
        arrayBuffer(): Promise<ArrayBuffer>;
    } | null>;
    list(options: {
        prefix: string;
    }): Promise<{
        objects: {
            key: string;
        }[];
    }>;
}
export declare class RefLog {
    private entries;
    private nextVersion;
    private bucket;
    private prefix;
    private snapshotInterval;
    private latestSnapshot?;
    constructor(bucket: RefLogBucket | null, prefix: string, options?: {
        snapshotInterval?: number;
    });
    /** Get the current version (number of entries). */
    get version(): number;
    /** Get all entries. */
    getEntries(): ReadonlyArray<RefLogEntry>;
    /** Get entries starting from a specific version (inclusive). */
    getEntriesFrom(fromVersion: number): RefLogEntry[];
    /**
     * Append a ref update to the log.
     * Returns the new entry with assigned version.
     */
    append(ref_name: string, old_sha: string, new_sha: string, timestamp?: number): RefLogEntry;
    /**
     * Replay the log to compute current ref states.
     * Applies entries in order; deletions (new_sha='') remove the ref.
     */
    replayState(): Map<string, RefState>;
    /**
     * Save the current replayState as a snapshot at the current version.
     * Future calls to replayState() will start from this snapshot.
     */
    checkpoint(): void;
    /**
     * Restore a snapshot from persisted storage.
     * After loading, replayState() will start from this snapshot version.
     */
    loadSnapshot(version: number, state: Map<string, RefState>): void;
    /** Get the latest snapshot, if any. */
    getSnapshot(): {
        version: number;
        state: Map<string, RefState>;
    } | undefined;
    /**
     * Get the current SHA for a specific ref, or undefined if not present.
     */
    resolve(ref_name: string): string | undefined;
    /**
     * Flush current entries to a Parquet file on R2.
     * Returns the R2 key of the written file.
     */
    /** Get the bucket (may be null for temporary/in-memory logs). */
    getBucket(): RefLogBucket | null;
    flush(): Promise<string | null>;
    /**
     * Load entries from an array (e.g., after reading back from storage).
     */
    loadEntries(entries: RefLogEntry[]): void;
    /**
     * Create a snapshot of the log at a given version.
     * Returns entries up to and including the specified version.
     */
    snapshot(atVersion: number): RefLogEntry[];
    /**
     * Rollback entries from the given version onwards.
     * Used by PushTransaction to undo RefLog entries when SQLite transaction fails.
     *
     * @param fromVersion - The version to rollback from (inclusive). All entries
     *                      with version >= fromVersion will be removed.
     * @returns The number of entries removed.
     */
    rollback(fromVersion: number): number;
}
//# sourceMappingURL=ref-log.d.ts.map