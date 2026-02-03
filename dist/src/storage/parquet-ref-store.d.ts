/**
 * @fileoverview Parquet Ref Store - R2 Read Replica for Git Refs
 *
 * Writes refs as a refs.parquet file to R2 on each update.
 * SQLite refs table remains authoritative; the Parquet file is a
 * read replica for external consumers (analytics, CDN edge reads).
 *
 * @module storage/parquet-ref-store
 */
import type { SQLStorage } from './types';
import type { Ref } from '../refs/storage';
/** Callback invoked after a ref is updated or deleted. */
export type RefUpdateCallback = (refName: string, oldTarget: string, newTarget: string) => void;
export interface ParquetRefStoreOptions {
    /** R2 bucket for Parquet files */
    r2: R2Bucket;
    /** SQLite storage for authoritative refs */
    sql: SQLStorage;
    /** Repository prefix in R2 */
    prefix: string;
    /** Optional callback invoked on ref changes (set or delete) */
    onRefUpdate?: RefUpdateCallback;
}
export interface RefRow extends Record<string, unknown> {
    name: string;
    target: string;
    type: string;
    updated_at: number;
}
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
export declare class ParquetRefStore {
    private r2;
    private sql;
    private prefix;
    private dirty;
    private onRefUpdate?;
    constructor(options: ParquetRefStoreOptions);
    /**
     * Ensure the refs table exists.
     */
    ensureTable(): void;
    /**
     * Get a ref by name from SQLite (authoritative).
     */
    getRef(name: string): Ref | null;
    /**
     * Set a ref in SQLite and mark as dirty for Parquet sync.
     */
    setRef(name: string, target: string, type?: 'sha' | 'symbolic'): void;
    /**
     * Delete a ref from SQLite and mark as dirty.
     */
    deleteRef(name: string): boolean;
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
    compareAndSwapRef(name: string, expectedOldTarget: string | null, newTarget: string): boolean;
    /**
     * List all refs, optionally filtered by prefix.
     */
    listRefs(prefix?: string): Ref[];
    /**
     * Sync refs to R2 as a Parquet read replica.
     * Only writes if refs have changed since last sync.
     *
     * For simplicity, writes refs as NDJSON (not Parquet) in this
     * initial implementation. A future version will use hyparquet-writer.
     */
    syncToR2(): Promise<boolean>;
    /**
     * Check if there are unsynchronized changes.
     */
    isDirty(): boolean;
    /**
     * Get the R2 key for the refs file.
     */
    getR2Key(): string;
}
//# sourceMappingURL=parquet-ref-store.d.ts.map