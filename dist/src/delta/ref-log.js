/**
 * @fileoverview Delta transaction log for ref updates.
 *
 * Each ref update creates a new log entry with version, ref_name, old_sha,
 * new_sha, and timestamp. The log is stored as append-only Parquet on R2.
 * Current state is reconstructed by replaying the log.
 *
 * @module delta/ref-log
 */
import { parquetWriteBuffer } from 'hyparquet-writer';
// ============================================================================
// Parquet Schema for Ref Log
// ============================================================================
const REF_LOG_SCHEMA = [
    { name: 'root', num_children: 5 },
    { name: 'version', type: 'INT64', repetition_type: 'REQUIRED' },
    { name: 'ref_name', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
    { name: 'old_sha', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
    { name: 'new_sha', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED', converted_type: 'UTF8' },
    { name: 'timestamp', type: 'INT64', repetition_type: 'REQUIRED', logical_type: { type: 'TIMESTAMP', isAdjustedToUTC: true, unit: 'MILLIS' } },
];
// ============================================================================
// RefLog Class
// ============================================================================
export class RefLog {
    entries = [];
    nextVersion = 1;
    bucket;
    prefix;
    snapshotInterval = 100;
    latestSnapshot;
    constructor(bucket, prefix, options) {
        this.bucket = bucket;
        this.prefix = prefix;
        if (options?.snapshotInterval !== undefined) {
            this.snapshotInterval = options.snapshotInterval;
        }
    }
    /** Get the current version (number of entries). */
    get version() {
        return this.nextVersion - 1;
    }
    /** Get all entries. */
    getEntries() {
        return this.entries;
    }
    /** Get entries starting from a specific version (inclusive). */
    getEntriesFrom(fromVersion) {
        return this.entries.filter(e => e.version >= fromVersion);
    }
    /**
     * Append a ref update to the log.
     * Returns the new entry with assigned version.
     */
    append(ref_name, old_sha, new_sha, timestamp) {
        const entry = {
            version: this.nextVersion++,
            ref_name,
            old_sha,
            new_sha,
            timestamp: timestamp ?? Date.now(),
        };
        this.entries.push(entry);
        // Auto-checkpoint every snapshotInterval entries
        if (this.entries.length % this.snapshotInterval === 0) {
            this.checkpoint();
        }
        return entry;
    }
    /**
     * Replay the log to compute current ref states.
     * Applies entries in order; deletions (new_sha='') remove the ref.
     */
    replayState() {
        // Start from snapshot if available
        let state;
        let startIndex;
        if (this.latestSnapshot) {
            // Clone snapshot state so we don't mutate the cached copy
            state = new Map(this.latestSnapshot.state);
            // Find the index of the first entry after the snapshot version
            startIndex = this.entries.findIndex(e => e.version > this.latestSnapshot.version);
            if (startIndex === -1) {
                // All entries are covered by the snapshot
                return state;
            }
        }
        else {
            state = new Map();
            startIndex = 0;
        }
        for (let i = startIndex; i < this.entries.length; i++) {
            const entry = this.entries[i];
            if (entry.new_sha === '') {
                // Deletion
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
     * Save the current replayState as a snapshot at the current version.
     * Future calls to replayState() will start from this snapshot.
     */
    checkpoint() {
        if (this.entries.length === 0)
            return;
        // Compute full state without using snapshot (to get a clean checkpoint)
        const state = new Map();
        for (const entry of this.entries) {
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
        this.latestSnapshot = {
            version: this.version,
            state,
        };
    }
    /**
     * Restore a snapshot from persisted storage.
     * After loading, replayState() will start from this snapshot version.
     */
    loadSnapshot(version, state) {
        this.latestSnapshot = { version, state: new Map(state) };
    }
    /** Get the latest snapshot, if any. */
    getSnapshot() {
        return this.latestSnapshot;
    }
    /**
     * Get the current SHA for a specific ref, or undefined if not present.
     */
    resolve(ref_name) {
        const state = this.replayState();
        return state.get(ref_name)?.sha;
    }
    /**
     * Flush current entries to a Parquet file on R2.
     * Returns the R2 key of the written file.
     */
    /** Get the bucket (may be null for temporary/in-memory logs). */
    getBucket() {
        return this.bucket;
    }
    async flush() {
        if (this.entries.length === 0)
            return null;
        if (!this.bucket) {
            throw new Error('Cannot flush a RefLog with no bucket');
        }
        const buffer = parquetWriteBuffer({
            schema: REF_LOG_SCHEMA,
            columnData: [
                { name: 'version', data: this.entries.map(e => BigInt(e.version)) },
                { name: 'ref_name', data: this.entries.map(e => e.ref_name) },
                { name: 'old_sha', data: this.entries.map(e => e.old_sha) },
                { name: 'new_sha', data: this.entries.map(e => e.new_sha) },
                { name: 'timestamp', data: this.entries.map(e => BigInt(e.timestamp)) },
            ],
        });
        const key = `${this.prefix}/ref-log/${this.version}.parquet`;
        await this.bucket.put(key, buffer);
        return key;
    }
    /**
     * Load entries from an array (e.g., after reading back from storage).
     */
    loadEntries(entries) {
        this.entries = [...entries];
        const maxVersion = entries.reduce((max, e) => Math.max(max, e.version), 0);
        this.nextVersion = maxVersion + 1;
    }
    /**
     * Create a snapshot of the log at a given version.
     * Returns entries up to and including the specified version.
     */
    snapshot(atVersion) {
        return this.entries.filter(e => e.version <= atVersion);
    }
    /**
     * Rollback entries from the given version onwards.
     * Used by PushTransaction to undo RefLog entries when SQLite transaction fails.
     *
     * @param fromVersion - The version to rollback from (inclusive). All entries
     *                      with version >= fromVersion will be removed.
     * @returns The number of entries removed.
     */
    rollback(fromVersion) {
        const originalLength = this.entries.length;
        this.entries = this.entries.filter(e => e.version < fromVersion);
        const removed = originalLength - this.entries.length;
        // Reset nextVersion to continue from where we rolled back to
        if (this.entries.length > 0) {
            const maxVersion = this.entries.reduce((max, e) => Math.max(max, e.version), 0);
            this.nextVersion = maxVersion + 1;
        }
        else {
            this.nextVersion = 1;
        }
        // Invalidate snapshot if it's beyond the rollback point
        if (this.latestSnapshot && this.latestSnapshot.version >= fromVersion) {
            this.latestSnapshot = undefined;
        }
        return removed;
    }
}
//# sourceMappingURL=ref-log.js.map