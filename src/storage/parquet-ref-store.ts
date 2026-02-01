/**
 * @fileoverview Parquet Ref Store - R2 Read Replica for Git Refs
 *
 * Writes refs as a refs.parquet file to R2 on each update.
 * SQLite refs table remains authoritative; the Parquet file is a
 * read replica for external consumers (analytics, CDN edge reads).
 *
 * @module storage/parquet-ref-store
 */

import type { SQLStorage } from './types'
import type { Ref } from '../refs/storage'
import { typedQuery, validateRow } from '../utils/sql-validate'

// ============================================================================
// Types
// ============================================================================

/** Callback invoked after a ref is updated or deleted. */
export type RefUpdateCallback = (refName: string, oldTarget: string, newTarget: string) => void

export interface ParquetRefStoreOptions {
  /** R2 bucket for Parquet files */
  r2: R2Bucket
  /** SQLite storage for authoritative refs */
  sql: SQLStorage
  /** Repository prefix in R2 */
  prefix: string
  /** Optional callback invoked on ref changes (set or delete) */
  onRefUpdate?: RefUpdateCallback
}

export interface RefRow {
  name: string
  target: string
  type: string
  updated_at: number
}

// ============================================================================
// ParquetRefStore Class
// ============================================================================

/**
 * Manages Git refs with SQLite as authoritative store and
 * R2 Parquet as a read replica.
 *
 * Write path:
 * 1. Write to SQLite refs table (authoritative)
 * 2. Rewrite refs.parquet to R2 (async read replica)
 *
 * Read path:
 * 1. Always read from SQLite (authoritative)
 */
export class ParquetRefStore {
  private r2: R2Bucket
  private sql: SQLStorage
  private prefix: string
  private dirty = false
  private onRefUpdate?: RefUpdateCallback

  constructor(options: ParquetRefStoreOptions) {
    this.r2 = options.r2
    this.sql = options.sql
    this.prefix = options.prefix
    this.onRefUpdate = options.onRefUpdate
  }

  /**
   * Ensure the refs table exists.
   */
  ensureTable(): void {
    this.sql.sql.exec(
      'CREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NOT NULL, type TEXT DEFAULT \'sha\', updated_at INTEGER)'
    )
  }

  /**
   * Get a ref by name from SQLite (authoritative).
   */
  getRef(name: string): Ref | null {
    const result = this.sql.sql.exec(
      'SELECT name, target, type FROM refs WHERE name = ?',
      name
    )
    const rows = typedQuery<RefRow>(result, validateRow(['name', 'target', 'type']))
    if (rows.length === 0) return null

    const row = rows[0]
    if (!row) return null
    return {
      name: row.name,
      target: row.target,
      type: row.type === 'symbolic' ? 'symbolic' : 'direct',
    }
  }

  /**
   * Set a ref in SQLite and mark as dirty for Parquet sync.
   */
  setRef(name: string, target: string, type: 'sha' | 'symbolic' = 'sha'): void {
    const now = Date.now()
    this.sql.sql.exec(
      'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
      name, target, type, now
    )
    this.dirty = true
  }

  /**
   * Delete a ref from SQLite and mark as dirty.
   */
  deleteRef(name: string): boolean {
    const existing = this.getRef(name)
    if (!existing) return false

    this.sql.sql.exec('DELETE FROM refs WHERE name = ?', name)
    this.dirty = true
    return true
  }

  /**
   * Atomically update a ref using compare-and-swap semantics.
   *
   * Reads the current ref value inside a SQLite transaction and only
   * writes the new value if the current value matches `expectedOldTarget`.
   *
   * @param name - Full ref name (e.g., 'refs/heads/main')
   * @param expectedOldTarget - Expected current value:
   *   - A SHA string means "ref must currently point to this SHA"
   *   - `null` or empty string means "ref must not exist" (create-only)
   * @param newTarget - New SHA to set the ref to
   * @returns `true` if the swap succeeded, `false` if the current value didn't match
   */
  compareAndSwapRef(
    name: string,
    expectedOldTarget: string | null,
    newTarget: string
  ): boolean {
    const expectMissing = expectedOldTarget === null || expectedOldTarget === ''

    this.sql.sql.exec('BEGIN TRANSACTION')
    try {
      // Read current value within the transaction
      const result = this.sql.sql.exec(
        'SELECT target FROM refs WHERE name = ?',
        name
      )
      const rows = typedQuery<RefRow>(result, validateRow(['name', 'target', 'type']))
      const currentTarget = rows.length > 0 ? rows[0]!.target : null

      // Check if current state matches expectation
      if (expectMissing) {
        if (currentTarget !== null) {
          this.sql.sql.exec('ROLLBACK')
          return false
        }
      } else {
        if (currentTarget === null || currentTarget !== expectedOldTarget) {
          this.sql.sql.exec('ROLLBACK')
          return false
        }
      }

      // Apply the update
      const now = Date.now()
      this.sql.sql.exec(
        'INSERT OR REPLACE INTO refs (name, target, type, updated_at) VALUES (?, ?, ?, ?)',
        name, newTarget, 'sha', now
      )

      this.sql.sql.exec('COMMIT')
      this.dirty = true

      // Fire callback if registered
      if (this.onRefUpdate) {
        this.onRefUpdate(name, expectedOldTarget ?? '', newTarget)
      }

      return true
    } catch (error) {
      this.sql.sql.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * List all refs, optionally filtered by prefix.
   */
  listRefs(prefix?: string): Ref[] {
    let result
    if (prefix) {
      result = this.sql.sql.exec(
        'SELECT name, target, type FROM refs WHERE name LIKE ?',
        `${prefix}%`
      )
    } else {
      result = this.sql.sql.exec('SELECT name, target, type FROM refs')
    }

    const rows = typedQuery<RefRow>(result, validateRow(['name', 'target', 'type']))
    return rows.map(row => ({
      name: row.name,
      target: row.target,
      type: row.type === 'symbolic' ? 'symbolic' as const : 'direct' as const,
    }))
  }

  /**
   * Sync refs to R2 as a Parquet read replica.
   * Only writes if refs have changed since last sync.
   *
   * For simplicity, writes refs as NDJSON (not Parquet) in this
   * initial implementation. A future version will use hyparquet-writer.
   */
  async syncToR2(): Promise<boolean> {
    if (!this.dirty) return false

    const refs = this.listRefs()
    const ndjson = refs.map(r => JSON.stringify({
      name: r.name,
      target: r.target,
      type: r.type,
      synced_at: Date.now(),
    })).join('\n')

    const key = `${this.prefix}/refs.ndjson`
    await this.r2.put(key, ndjson)
    this.dirty = false
    return true
  }

  /**
   * Check if there are unsynchronized changes.
   */
  isDirty(): boolean {
    return this.dirty
  }

  /**
   * Get the R2 key for the refs file.
   */
  getR2Key(): string {
    return `${this.prefix}/refs.ndjson`
  }
}
