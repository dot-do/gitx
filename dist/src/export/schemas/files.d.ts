/**
 * @fileoverview Parquet Schema for Git File Changes
 *
 * Defines the Parquet schema for storing file-level changes
 * from git commits in columnar format for analytics.
 *
 * @module export/schemas/files
 */
import { type ParquetSchema, type ParquetField } from '../../tiered/parquet-writer';
/**
 * Git file change types.
 */
export type FileChangeType = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';
/**
 * Descriptions for file change types.
 */
export declare const FILE_CHANGE_DESCRIPTIONS: Record<FileChangeType, string>;
/**
 * Fields for the files (file changes) table.
 */
export declare const FILE_FIELDS: ParquetField[];
/**
 * Parquet schema for git file changes.
 *
 * @description
 * Schema optimized for analytics queries on file-level changes:
 * - Hotspot detection (frequently changed files)
 * - Churn analysis (lines added/removed over time)
 * - File type distribution
 * - Directory-level aggregation
 *
 * @example
 * ```sql
 * -- Find most frequently changed files
 * SELECT path, COUNT(*) as change_count
 * FROM files
 * WHERE repository = 'owner/repo'
 * GROUP BY path
 * ORDER BY change_count DESC
 * LIMIT 20
 *
 * -- Calculate code churn by extension
 * SELECT extension,
 *        SUM(lines_added) as total_added,
 *        SUM(lines_removed) as total_removed
 * FROM files
 * WHERE is_binary = false
 * GROUP BY extension
 * ORDER BY total_added + total_removed DESC
 *
 * -- Find large file additions
 * SELECT path, new_size, commit_sha
 * FROM files
 * WHERE change_type = 'A'
 *   AND new_size > 1000000
 * ORDER BY new_size DESC
 * ```
 */
export declare const FILES_SCHEMA: ParquetSchema;
/**
 * TypeScript type for a file change row.
 */
export interface FileRow {
    commit_sha: string;
    path: string;
    old_path?: string | null;
    change_type: FileChangeType;
    is_binary: boolean;
    lines_added?: number | null;
    lines_removed?: number | null;
    old_size?: number | null;
    new_size?: number | null;
    old_blob_sha?: string | null;
    new_blob_sha?: string | null;
    old_mode?: string | null;
    new_mode?: string | null;
    similarity?: number | null;
    extension?: string | null;
    directory: string;
    repository: string;
    commit_date: number;
}
/**
 * Creates a file row from git diff data.
 *
 * @param file - Git file change data
 * @param commitSha - SHA of the parent commit
 * @param repository - Repository identifier
 * @param commitDate - Timestamp of the commit
 * @returns FileRow for Parquet writing
 */
export declare function toFileRow(file: {
    path: string;
    oldPath?: string;
    changeType: FileChangeType;
    isBinary?: boolean;
    linesAdded?: number;
    linesRemoved?: number;
    oldSize?: number;
    newSize?: number;
    oldBlobSha?: string;
    newBlobSha?: string;
    oldMode?: string;
    newMode?: string;
    similarity?: number;
}, commitSha: string, repository: string, commitDate: Date | number): FileRow;
//# sourceMappingURL=files.d.ts.map