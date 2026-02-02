/**
 * @fileoverview Parquet Schema for Git Refs
 *
 * Defines the Parquet schema for storing git reference data
 * (branches, tags) in columnar format for analytics.
 *
 * @module export/schemas/refs
 */
import { type ParquetSchema, type ParquetField } from '../../tiered/parquet-writer';
/**
 * Fields for the refs table.
 */
export declare const REF_FIELDS: ParquetField[];
/**
 * Parquet schema for git refs (branches and tags).
 *
 * @description
 * Schema optimized for analytics queries on repository structure:
 * - Branch inventory and activity
 * - Tag history and releases
 * - Upstream tracking status
 * - Default branch analysis
 *
 * @example
 * ```sql
 * -- Find branches that are behind upstream
 * SELECT short_name, upstream, behind
 * FROM refs
 * WHERE ref_type = 'branch'
 *   AND behind > 0
 * ORDER BY behind DESC
 *
 * -- List all release tags
 * SELECT short_name, target_sha, tag_message
 * FROM refs
 * WHERE ref_type = 'tag'
 *   AND short_name LIKE 'v%'
 * ORDER BY tagger_date DESC
 * ```
 */
export declare const REFS_SCHEMA: ParquetSchema;
/**
 * TypeScript type for a ref row.
 */
export interface RefRow {
    name: string;
    short_name: string;
    target_sha: string;
    ref_type: 'branch' | 'tag' | 'remote' | 'other';
    is_head: boolean;
    is_default: boolean;
    upstream?: string | null;
    ahead?: number | null;
    behind?: number | null;
    tag_message?: string | null;
    tagger_name?: string | null;
    tagger_email?: string | null;
    tagger_date?: number | null;
    repository: string;
    snapshot_time: number;
}
/**
 * Creates a ref row from git ref data.
 *
 * @param ref - Git reference data
 * @param repository - Repository identifier
 * @param options - Additional options
 * @returns RefRow for Parquet writing
 */
export declare function toRefRow(ref: {
    name: string;
    targetSha: string;
    upstream?: string;
    ahead?: number;
    behind?: number;
    tagMessage?: string;
    tagger?: {
        name: string;
        email: string;
        date: Date | number;
    };
}, repository: string, options?: {
    isHead?: boolean;
    isDefault?: boolean;
    snapshotTime?: number;
}): RefRow;
//# sourceMappingURL=refs.d.ts.map