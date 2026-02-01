/**
 * @fileoverview Delta transaction log for ref updates.
 *
 * Each ref update creates a new log entry with version, ref_name, old_sha,
 * new_sha, and timestamp. The log is stored as append-only Parquet on R2.
 * Current state is reconstructed by replaying the log.
 *
 * @module delta/ref-log
 */

import { parquetWriteBuffer } from 'hyparquet-writer'

// ============================================================================
// Types
// ============================================================================

/** A single ref log entry. */
export interface RefLogEntry {
  /** Monotonically increasing version number */
  version: number
  /** Ref name (e.g., "refs/heads/main") */
  ref_name: string
  /** Previous SHA (empty string for creation) */
  old_sha: string
  /** New SHA (empty string for deletion) */
  new_sha: string
  /** Unix timestamp in milliseconds */
  timestamp: number
}

/** Current state of a ref after replaying the log. */
export interface RefState {
  ref_name: string
  sha: string
  version: number
}

/** R2-like bucket interface (subset used by RefLog). */
export interface RefLogBucket {
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
  list(options: { prefix: string }): Promise<{ objects: { key: string }[] }>
}

// ============================================================================
// Parquet Schema for Ref Log
// ============================================================================

const REF_LOG_SCHEMA = [
  { name: 'root', num_children: 5 },
  { name: 'version', type: 'INT64' as const, repetition_type: 'REQUIRED' as const },
  { name: 'ref_name', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  { name: 'old_sha', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  { name: 'new_sha', type: 'BYTE_ARRAY' as const, repetition_type: 'REQUIRED' as const, converted_type: 'UTF8' as const },
  { name: 'timestamp', type: 'INT64' as const, repetition_type: 'REQUIRED' as const, logical_type: { type: 'TIMESTAMP' as const, isAdjustedToUTC: true, unit: 'MILLIS' as const } },
]

// ============================================================================
// RefLog Class
// ============================================================================

export class RefLog {
  private entries: RefLogEntry[] = []
  private nextVersion: number = 1
  private bucket: RefLogBucket | null
  private prefix: string
  private snapshotInterval: number = 100
  private latestSnapshot?: { version: number; state: Map<string, RefState> }

  constructor(bucket: RefLogBucket | null, prefix: string, options?: { snapshotInterval?: number }) {
    this.bucket = bucket
    this.prefix = prefix
    if (options?.snapshotInterval !== undefined) {
      this.snapshotInterval = options.snapshotInterval
    }
  }

  /** Get the current version (number of entries). */
  get version(): number {
    return this.nextVersion - 1
  }

  /** Get all entries. */
  getEntries(): ReadonlyArray<RefLogEntry> {
    return this.entries
  }

  /** Get entries starting from a specific version (inclusive). */
  getEntriesFrom(fromVersion: number): RefLogEntry[] {
    return this.entries.filter(e => e.version >= fromVersion)
  }

  /**
   * Append a ref update to the log.
   * Returns the new entry with assigned version.
   */
  append(ref_name: string, old_sha: string, new_sha: string, timestamp?: number): RefLogEntry {
    const entry: RefLogEntry = {
      version: this.nextVersion++,
      ref_name,
      old_sha,
      new_sha,
      timestamp: timestamp ?? Date.now(),
    }
    this.entries.push(entry)

    // Auto-checkpoint every snapshotInterval entries
    if (this.entries.length % this.snapshotInterval === 0) {
      this.checkpoint()
    }

    return entry
  }

  /**
   * Replay the log to compute current ref states.
   * Applies entries in order; deletions (new_sha='') remove the ref.
   */
  replayState(): Map<string, RefState> {
    // Start from snapshot if available
    let state: Map<string, RefState>
    let startIndex: number

    if (this.latestSnapshot) {
      // Clone snapshot state so we don't mutate the cached copy
      state = new Map(this.latestSnapshot.state)
      // Find the index of the first entry after the snapshot version
      startIndex = this.entries.findIndex(e => e.version > this.latestSnapshot!.version)
      if (startIndex === -1) {
        // All entries are covered by the snapshot
        return state
      }
    } else {
      state = new Map<string, RefState>()
      startIndex = 0
    }

    for (let i = startIndex; i < this.entries.length; i++) {
      const entry = this.entries[i]!
      if (entry.new_sha === '') {
        // Deletion
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
   * Save the current replayState as a snapshot at the current version.
   * Future calls to replayState() will start from this snapshot.
   */
  checkpoint(): void {
    if (this.entries.length === 0) return
    // Compute full state without using snapshot (to get a clean checkpoint)
    const state = new Map<string, RefState>()
    for (const entry of this.entries) {
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
    this.latestSnapshot = {
      version: this.version,
      state,
    }
  }

  /**
   * Restore a snapshot from persisted storage.
   * After loading, replayState() will start from this snapshot version.
   */
  loadSnapshot(version: number, state: Map<string, RefState>): void {
    this.latestSnapshot = { version, state: new Map(state) }
  }

  /** Get the latest snapshot, if any. */
  getSnapshot(): { version: number; state: Map<string, RefState> } | undefined {
    return this.latestSnapshot
  }

  /**
   * Get the current SHA for a specific ref, or undefined if not present.
   */
  resolve(ref_name: string): string | undefined {
    const state = this.replayState()
    return state.get(ref_name)?.sha
  }

  /**
   * Flush current entries to a Parquet file on R2.
   * Returns the R2 key of the written file.
   */
  /** Get the bucket (may be null for temporary/in-memory logs). */
  getBucket(): RefLogBucket | null {
    return this.bucket
  }

  async flush(): Promise<string | null> {
    if (this.entries.length === 0) return null
    if (!this.bucket) {
      throw new Error('Cannot flush a RefLog with no bucket')
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
    })

    const key = `${this.prefix}/ref-log/${this.version}.parquet`
    await this.bucket.put(key, buffer)
    return key
  }

  /**
   * Load entries from an array (e.g., after reading back from storage).
   */
  loadEntries(entries: RefLogEntry[]): void {
    this.entries = [...entries]
    const maxVersion = entries.reduce((max, e) => Math.max(max, e.version), 0)
    this.nextVersion = maxVersion + 1
  }

  /**
   * Create a snapshot of the log at a given version.
   * Returns entries up to and including the specified version.
   */
  snapshot(atVersion: number): RefLogEntry[] {
    return this.entries.filter(e => e.version <= atVersion)
  }
}
