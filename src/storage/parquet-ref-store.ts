/**
 * @fileoverview Parquet Ref Store - R2 Read Replica for Git Refs
 *
 * Writes refs as a refs.parquet file to R2 on each update.
 * SQLite refs table remains authoritative; the Parquet file is a
 * read replica for external consumers (analytics, CDN edge reads).
 *
 * @module storage/parquet-ref-store
 */

import type { DurableObjectStorage } from '../do/schema'
import type { Ref } from '../refs/storage'

// ============================================================================
// Types
// ============================================================================

/** Callback invoked after a ref is updated or deleted. */
export type RefUpdateCallback = (refName: string, oldTarget: string, newTarget: string) => void

export interface ParquetRefStoreOptions {
  /** R2 bucket for Parquet files */
  r2: R2Bucket
  /** SQLite storage for authoritative refs */
  sql: DurableObjectStorage
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
  private sql: DurableObjectStorage
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
    const rows = result.toArray() as RefRow[]
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

    const rows = result.toArray() as RefRow[]
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
