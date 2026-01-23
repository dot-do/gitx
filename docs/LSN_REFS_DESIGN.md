# LSN-Based Reference Management Design

## Overview

This document outlines the design for integrating Log Sequence Numbers (LSNs) with Git reference management in gitx. LSNs enable time-travel queries, CDC (Change Data Capture) synchronization, and efficient incremental replication by providing a monotonic ordering of all write operations in the repository.

## Motivation

### Current State

The current gitx ref management system (see `src/refs/`) provides:
- Direct refs: Point to SHA-1 hashes (branches, tags)
- Symbolic refs: Point to other refs (HEAD -> refs/heads/main)
- Packed refs: Consolidated ref storage for efficiency
- Reflog: Historical record of ref changes with timestamps

### Limitations

1. **No Total Ordering**: Commits lack a global ordering beyond DAG structure
2. **Time-Based Queries Limited**: Timestamps can be unreliable (clock skew, backfilling)
3. **Incremental Sync Complex**: CDC consumers need reliable "resume from" markers
4. **Multi-Region Coordination**: Distributed systems need consistent ordering

### LSN Benefits

- **Monotonic Ordering**: Every write operation gets a unique, sequential LSN
- **Time-Travel Queries**: "Show me the state at LSN X"
- **CDC Integration**: "Give me all changes since LSN Y"
- **Conflict Detection**: Compare LSNs to detect concurrent modifications

## Core Concepts

### LSN Definition

```typescript
/**
 * Log Sequence Number - a monotonically increasing 64-bit integer.
 *
 * Structure: [timestamp_ms:48][counter:16]
 * - High 48 bits: Unix timestamp in milliseconds (good until year 10889)
 * - Low 16 bits: Per-millisecond counter (65536 ops/ms max)
 *
 * This allows:
 * - Approximate time ordering (LSNs from similar times compare similarly)
 * - High throughput (65K ops/ms = 65M ops/second theoretical max)
 * - Reasonable conflict resolution in distributed systems
 */
type LSN = bigint

// Special values
const LSN_ZERO = 0n      // Before any operations
const LSN_MIN = 1n       // First valid LSN
const LSN_MAX = (1n << 64n) - 1n  // Maximum LSN
```

### LSN Metadata on Commits

Each commit maps to an LSN range representing when it was created and its state:

```typescript
/**
 * LSN metadata associated with a commit.
 */
interface CommitLSNMetadata {
  /** The LSN when this commit was created/written to storage */
  commitLSN: LSN

  /**
   * For merge commits: the LSN after all parent states were reconciled.
   * For regular commits: same as commitLSN.
   */
  reconcileLSN: LSN

  /**
   * The LSN range of all objects written as part of this commit.
   * startLSN: First object written (typically blobs)
   * endLSN: Last object written (the commit object itself)
   */
  objectRange: {
    startLSN: LSN
    endLSN: LSN
  }
}
```

### Ref LSN Tracking

References track their LSN state for CDC and time-travel:

```typescript
/**
 * Extended ref metadata with LSN tracking.
 */
interface RefWithLSN extends Ref {
  /** The LSN when this ref was last updated */
  updateLSN: LSN

  /** The LSN of the commit this ref points to */
  targetCommitLSN: LSN

  /** Previous ref state (for reflog correlation) */
  previousLSN?: LSN
  previousTarget?: string
}

/**
 * Ref update record for CDC.
 */
interface RefLSNUpdate {
  refName: string
  oldSha: string | null
  newSha: string | null
  lsn: LSN
  operation: 'create' | 'update' | 'delete'
  timestamp: number
}
```

## Storage Format

### LSN Index Table (SQLite)

```sql
-- Main LSN tracking table for commits
CREATE TABLE commit_lsn (
  sha TEXT PRIMARY KEY,           -- Commit SHA
  commit_lsn INTEGER NOT NULL,    -- LSN when commit was written
  reconcile_lsn INTEGER NOT NULL, -- LSN after reconciliation
  object_start_lsn INTEGER,       -- First object LSN in this commit
  object_end_lsn INTEGER,         -- Last object LSN in this commit
  parent_lsn INTEGER,             -- LSN of first parent commit (for ancestry)
  created_at INTEGER NOT NULL     -- Unix timestamp
);

CREATE INDEX idx_commit_lsn_lsn ON commit_lsn(commit_lsn);
CREATE INDEX idx_commit_lsn_range ON commit_lsn(object_start_lsn, object_end_lsn);

-- Ref LSN tracking
CREATE TABLE ref_lsn (
  ref_name TEXT PRIMARY KEY,
  current_sha TEXT,
  update_lsn INTEGER NOT NULL,
  target_commit_lsn INTEGER,
  previous_sha TEXT,
  previous_lsn INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_ref_lsn_lsn ON ref_lsn(update_lsn);

-- LSN changelog for CDC consumers
CREATE TABLE lsn_changelog (
  lsn INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,      -- 'commit', 'ref', 'object'
  entity_id TEXT NOT NULL,        -- SHA or ref name
  operation TEXT NOT NULL,        -- 'create', 'update', 'delete'
  old_value TEXT,                 -- JSON of previous state
  new_value TEXT,                 -- JSON of new state
  timestamp INTEGER NOT NULL
);

CREATE INDEX idx_changelog_entity ON lsn_changelog(entity_type, entity_id);
CREATE INDEX idx_changelog_timestamp ON lsn_changelog(timestamp);

-- LSN generator state
CREATE TABLE lsn_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_lsn INTEGER NOT NULL,
  last_timestamp_ms INTEGER NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0
);
```

### Object LSN Tracking (Optional)

For fine-grained object-level LSN tracking:

```sql
-- Per-object LSN tracking (optional, for large repos)
CREATE TABLE object_lsn (
  sha TEXT PRIMARY KEY,
  type TEXT NOT NULL,           -- 'blob', 'tree', 'commit', 'tag'
  write_lsn INTEGER NOT NULL,
  size INTEGER NOT NULL
);

CREATE INDEX idx_object_lsn_lsn ON object_lsn(write_lsn);
CREATE INDEX idx_object_lsn_type ON object_lsn(type, write_lsn);
```

## Query Algorithms

### getLSNAtCommit(sha: string): LSN

Returns the LSN when a commit was written.

```typescript
async function getLSNAtCommit(sha: string): Promise<LSN | null> {
  const result = storage.sql.exec(
    'SELECT commit_lsn FROM commit_lsn WHERE sha = ?',
    sha
  ).toArray()

  if (result.length === 0) return null
  return BigInt(result[0].commit_lsn)
}
```

**Complexity**: O(1) with index lookup

### getCommitAtLSN(lsn: LSN): string

Returns the commit SHA that was created at or immediately before the given LSN.

```typescript
async function getCommitAtLSN(lsn: LSN): Promise<string | null> {
  // Find the commit with the highest LSN <= target LSN
  const result = storage.sql.exec(`
    SELECT sha, commit_lsn
    FROM commit_lsn
    WHERE commit_lsn <= ?
    ORDER BY commit_lsn DESC
    LIMIT 1
  `, lsn.toString()).toArray()

  if (result.length === 0) return null
  return result[0].sha
}
```

**Complexity**: O(log n) with B-tree index

### getCommitsBetweenLSN(startLSN: LSN, endLSN: LSN): Commit[]

Returns all commits created within an LSN range.

```typescript
interface CommitLSNEntry {
  sha: string
  commitLSN: LSN
  reconcileLSN: LSN
}

async function getCommitsBetweenLSN(
  startLSN: LSN,
  endLSN: LSN,
  options?: { limit?: number; includeEnd?: boolean }
): Promise<CommitLSNEntry[]> {
  const op = options?.includeEnd ? '<=' : '<'
  const limit = options?.limit ?? 1000

  const result = storage.sql.exec(`
    SELECT sha, commit_lsn, reconcile_lsn
    FROM commit_lsn
    WHERE commit_lsn > ? AND commit_lsn ${op} ?
    ORDER BY commit_lsn ASC
    LIMIT ?
  `, startLSN.toString(), endLSN.toString(), limit).toArray()

  return result.map(row => ({
    sha: row.sha,
    commitLSN: BigInt(row.commit_lsn),
    reconcileLSN: BigInt(row.reconcile_lsn)
  }))
}
```

**Complexity**: O(log n + k) where k is result count

### getRefStateAtLSN(refName: string, lsn: LSN): RefState

Time-travel query to get ref state at a specific LSN.

```typescript
interface RefStateAtLSN {
  refName: string
  sha: string | null
  lsn: LSN
  exists: boolean
}

async function getRefStateAtLSN(
  refName: string,
  targetLSN: LSN
): Promise<RefStateAtLSN> {
  // Query changelog for the ref's state at the given LSN
  const result = storage.sql.exec(`
    SELECT new_value, lsn
    FROM lsn_changelog
    WHERE entity_type = 'ref'
      AND entity_id = ?
      AND lsn <= ?
    ORDER BY lsn DESC
    LIMIT 1
  `, refName, targetLSN.toString()).toArray()

  if (result.length === 0) {
    return { refName, sha: null, lsn: LSN_ZERO, exists: false }
  }

  const state = JSON.parse(result[0].new_value)
  return {
    refName,
    sha: state.sha,
    lsn: BigInt(result[0].lsn),
    exists: state.sha !== null
  }
}
```

**Complexity**: O(log n) with composite index

### getRepoStateAtLSN(lsn: LSN): RepoSnapshot

Returns a complete snapshot of all refs at a specific LSN.

```typescript
interface RepoSnapshot {
  lsn: LSN
  refs: Map<string, RefStateAtLSN>
  headRef: string | null
  headSha: string | null
}

async function getRepoStateAtLSN(targetLSN: LSN): Promise<RepoSnapshot> {
  // Get all refs that existed at this LSN
  const result = storage.sql.exec(`
    WITH latest_states AS (
      SELECT
        entity_id,
        new_value,
        lsn,
        ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY lsn DESC) as rn
      FROM lsn_changelog
      WHERE entity_type = 'ref' AND lsn <= ?
    )
    SELECT entity_id, new_value, lsn
    FROM latest_states
    WHERE rn = 1
  `, targetLSN.toString()).toArray()

  const refs = new Map<string, RefStateAtLSN>()
  let headRef: string | null = null
  let headSha: string | null = null

  for (const row of result) {
    const state = JSON.parse(row.new_value)
    if (state.sha !== null) { // Only include existing refs
      refs.set(row.entity_id, {
        refName: row.entity_id,
        sha: state.sha,
        lsn: BigInt(row.lsn),
        exists: true
      })

      if (row.entity_id === 'HEAD') {
        if (state.type === 'symbolic') {
          headRef = state.target
          // Resolve symbolic ref
          const targetState = refs.get(state.target)
          headSha = targetState?.sha ?? null
        } else {
          headSha = state.sha
        }
      }
    }
  }

  return { lsn: targetLSN, refs, headRef, headSha }
}
```

**Complexity**: O(n log n) where n is number of ref updates up to LSN

## LSN Generation

### LSN Generator

```typescript
class LSNGenerator {
  private currentLSN: bigint
  private lastTimestampMs: bigint
  private counter: number

  constructor(private storage: SqlStorage) {}

  async initialize(): Promise<void> {
    // Load state from database
    const result = this.storage.sql.exec(
      'SELECT current_lsn, last_timestamp_ms, counter FROM lsn_state WHERE id = 1'
    ).toArray()

    if (result.length > 0) {
      this.currentLSN = BigInt(result[0].current_lsn)
      this.lastTimestampMs = BigInt(result[0].last_timestamp_ms)
      this.counter = result[0].counter
    } else {
      // Initialize fresh state
      const now = BigInt(Date.now())
      this.currentLSN = now << 16n
      this.lastTimestampMs = now
      this.counter = 0

      this.storage.sql.exec(
        'INSERT INTO lsn_state (id, current_lsn, last_timestamp_ms, counter) VALUES (1, ?, ?, 0)',
        this.currentLSN.toString(),
        this.lastTimestampMs.toString()
      )
    }
  }

  /**
   * Generate the next LSN.
   * Thread-safe via SQLite transaction isolation.
   */
  next(): LSN {
    const now = BigInt(Date.now())

    if (now === this.lastTimestampMs) {
      // Same millisecond, increment counter
      this.counter++
      if (this.counter > 65535) {
        // Counter overflow, wait for next millisecond
        throw new Error('LSN counter overflow - too many operations per millisecond')
      }
    } else if (now > this.lastTimestampMs) {
      // New millisecond, reset counter
      this.lastTimestampMs = now
      this.counter = 0
    } else {
      // Clock went backwards, use previous timestamp + 1ms
      this.lastTimestampMs = this.lastTimestampMs + 1n
      this.counter = 0
    }

    this.currentLSN = (this.lastTimestampMs << 16n) | BigInt(this.counter)

    // Persist state
    this.storage.sql.exec(
      'UPDATE lsn_state SET current_lsn = ?, last_timestamp_ms = ?, counter = ? WHERE id = 1',
      this.currentLSN.toString(),
      this.lastTimestampMs.toString(),
      this.counter
    )

    return this.currentLSN
  }

  /**
   * Get the current LSN without incrementing.
   */
  current(): LSN {
    return this.currentLSN
  }
}
```

## Integration with Existing Ref System

### RefStorageWithLSN

```typescript
/**
 * Extended RefStorageBackend with LSN tracking.
 */
interface RefStorageBackendWithLSN extends RefStorageBackend {
  /** Get the current LSN */
  getCurrentLSN(): LSN

  /** Write ref with LSN tracking */
  writeRefWithLSN(ref: Ref, lsn: LSN): Promise<void>

  /** Read ref with LSN metadata */
  readRefWithLSN(name: string): Promise<RefWithLSN | null>

  /** Get ref history by LSN range */
  getRefHistory(name: string, startLSN: LSN, endLSN: LSN): Promise<RefLSNUpdate[]>

  /** Subscribe to ref changes (CDC) */
  subscribeRefChanges(
    fromLSN: LSN,
    callback: (update: RefLSNUpdate) => void
  ): () => void
}

/**
 * RefStorage with LSN support.
 */
class RefStorageWithLSN extends RefStorage {
  private lsnGenerator: LSNGenerator

  constructor(backend: RefStorageBackendWithLSN, lsnGenerator: LSNGenerator) {
    super(backend)
    this.lsnGenerator = lsnGenerator
  }

  /**
   * Update ref with LSN tracking and changelog entry.
   */
  async updateRefWithLSN(
    name: string,
    target: string,
    options?: UpdateRefOptions
  ): Promise<RefWithLSN> {
    const lsn = this.lsnGenerator.next()
    const oldRef = await this.getRef(name)

    // Update the ref
    const ref = await this.updateRef(name, target, options)

    // Record in changelog
    await this.recordChangelog({
      lsn,
      entityType: 'ref',
      entityId: name,
      operation: oldRef ? 'update' : 'create',
      oldValue: oldRef ? JSON.stringify(oldRef) : null,
      newValue: JSON.stringify(ref),
      timestamp: Date.now()
    })

    // Update ref_lsn table
    await this.updateRefLSN(name, ref.target, lsn, oldRef)

    return {
      ...ref,
      updateLSN: lsn,
      targetCommitLSN: await this.getCommitLSN(target),
      previousLSN: oldRef ? await this.getRefUpdateLSN(name) : undefined,
      previousTarget: oldRef?.target
    }
  }

  // ... additional methods
}
```

## CDC Integration

### Change Data Capture API

```typescript
interface CDCConsumer {
  /** Consumer ID for tracking position */
  consumerId: string

  /** Last processed LSN */
  lastLSN: LSN

  /** Callback for processing changes */
  onChanges: (changes: ChangeEvent[]) => Promise<void>
}

interface ChangeEvent {
  lsn: LSN
  timestamp: number
  entityType: 'commit' | 'ref' | 'object'
  entityId: string
  operation: 'create' | 'update' | 'delete'
  oldValue?: unknown
  newValue?: unknown
}

class CDCManager {
  private consumers = new Map<string, CDCConsumer>()

  /**
   * Register a CDC consumer.
   */
  async registerConsumer(
    consumerId: string,
    startLSN: LSN
  ): Promise<CDCConsumer> {
    const consumer: CDCConsumer = {
      consumerId,
      lastLSN: startLSN,
      onChanges: async () => {}
    }

    this.consumers.set(consumerId, consumer)
    return consumer
  }

  /**
   * Poll for changes since last LSN.
   */
  async pollChanges(
    consumerId: string,
    limit: number = 1000
  ): Promise<ChangeEvent[]> {
    const consumer = this.consumers.get(consumerId)
    if (!consumer) throw new Error(`Unknown consumer: ${consumerId}`)

    const result = storage.sql.exec(`
      SELECT lsn, timestamp, entity_type, entity_id, operation, old_value, new_value
      FROM lsn_changelog
      WHERE lsn > ?
      ORDER BY lsn ASC
      LIMIT ?
    `, consumer.lastLSN.toString(), limit).toArray()

    const changes: ChangeEvent[] = result.map(row => ({
      lsn: BigInt(row.lsn),
      timestamp: row.timestamp,
      entityType: row.entity_type,
      entityId: row.entity_id,
      operation: row.operation,
      oldValue: row.old_value ? JSON.parse(row.old_value) : undefined,
      newValue: row.new_value ? JSON.parse(row.new_value) : undefined
    }))

    if (changes.length > 0) {
      consumer.lastLSN = changes[changes.length - 1].lsn
    }

    return changes
  }

  /**
   * Acknowledge processed changes up to LSN.
   */
  async acknowledge(consumerId: string, lsn: LSN): Promise<void> {
    const consumer = this.consumers.get(consumerId)
    if (!consumer) throw new Error(`Unknown consumer: ${consumerId}`)

    consumer.lastLSN = lsn

    // Persist consumer position
    storage.sql.exec(`
      INSERT OR REPLACE INTO cdc_consumers (consumer_id, last_lsn, updated_at)
      VALUES (?, ?, ?)
    `, consumerId, lsn.toString(), Date.now())
  }
}
```

## Time-Travel API

```typescript
interface TimeTravelAPI {
  /**
   * Get repository state at a specific LSN.
   */
  getStateAtLSN(lsn: LSN): Promise<RepoSnapshot>

  /**
   * Get repository state at a specific timestamp.
   * Note: May be approximate due to clock skew.
   */
  getStateAtTime(timestamp: number): Promise<RepoSnapshot>

  /**
   * Get the commit graph at a specific LSN.
   */
  getCommitGraphAtLSN(lsn: LSN, options?: {
    maxDepth?: number
    includeRefs?: boolean
  }): Promise<CommitGraph>

  /**
   * Diff two LSN states.
   */
  diffLSN(fromLSN: LSN, toLSN: LSN): Promise<{
    addedCommits: string[]
    removedCommits: string[]  // From forced pushes
    refChanges: RefLSNUpdate[]
  }>
}
```

## Conflict Resolution

### Concurrent Write Handling

```typescript
interface LSNConflictResolution {
  /**
   * Detect if a ref update would conflict with concurrent writes.
   */
  detectConflict(
    refName: string,
    expectedLSN: LSN,
    currentLSN: LSN
  ): boolean

  /**
   * Resolve merge conflicts using LSN ordering.
   */
  resolveConflict(
    localLSN: LSN,
    remoteLSN: LSN,
    conflictType: 'update-update' | 'delete-update'
  ): 'local' | 'remote' | 'merge'
}

// Last-Write-Wins based on LSN
function resolveLastWriteWins(localLSN: LSN, remoteLSN: LSN): 'local' | 'remote' {
  return localLSN > remoteLSN ? 'local' : 'remote'
}
```

## Performance Considerations

### Index Strategy

1. **Primary Index**: `commit_lsn.sha` - O(1) commit to LSN lookup
2. **LSN Index**: `commit_lsn.commit_lsn` - O(log n) LSN to commit lookup
3. **Range Index**: `commit_lsn(object_start_lsn, object_end_lsn)` - Object range queries
4. **Ref Index**: `ref_lsn.update_lsn` - Ref CDC queries
5. **Changelog Index**: `lsn_changelog(lsn)` - CDC polling

### Compaction

```typescript
interface LSNCompaction {
  /**
   * Compact changelog by removing entries older than retention period.
   */
  compactChangelog(retentionLSN: LSN): Promise<number>

  /**
   * Create a checkpoint snapshot for faster time-travel queries.
   */
  createCheckpoint(lsn: LSN): Promise<void>

  /**
   * Prune old checkpoints.
   */
  pruneCheckpoints(keepCount: number): Promise<void>
}
```

### Estimated Storage

For a repository with:
- 100,000 commits
- 10 branches + 100 tags
- 5 CDC consumers

Storage overhead:
- `commit_lsn`: ~100KB (100K rows * ~100 bytes)
- `ref_lsn`: ~11KB (110 rows * ~100 bytes)
- `lsn_changelog`: Variable, depends on activity and retention
- Checkpoints: ~1KB per checkpoint (compressed ref state)

## Migration Path

### Phase 1: Add LSN Infrastructure
1. Create database tables
2. Implement LSNGenerator
3. Add LSN tracking to new commits/refs

### Phase 2: Backfill Historical Data
1. Assign synthetic LSNs to existing commits based on author timestamp
2. Populate ref_lsn from current ref state
3. Generate initial changelog entries

### Phase 3: Enable CDC
1. Implement CDC consumer registration
2. Add changelog writes to all ref operations
3. Enable polling API

### Phase 4: Time-Travel Queries
1. Implement checkpoint system
2. Enable time-travel API
3. Add conflict resolution

## Open Questions

1. **LSN Persistence Strategy**: Should LSN state be persisted per-write or batched?
2. **Checkpoint Frequency**: How often should checkpoints be created for time-travel?
3. **Changelog Retention**: How long should changelog entries be retained?
4. **Multi-Region LSNs**: How to handle LSN ordering across regions?
5. **LSN in Pack Files**: Should pack files include LSN metadata?

## References

- PostgreSQL WAL and LSN: https://www.postgresql.org/docs/current/wal-internals.html
- CockroachDB MVCC: https://www.cockroachlabs.com/docs/stable/architecture/storage-layer.html
- Git Reflog: https://git-scm.com/docs/git-reflog
- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/
