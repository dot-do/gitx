/**
 * @fileoverview Parquet Schema for Git Commits
 *
 * Defines the Parquet schema for storing git commit data
 * in columnar format for analytics queries.
 *
 * @module export/schemas/commits
 */
import { type ParquetSchema, type ParquetField } from '../../tiered/parquet-writer';
/**
 * Fields for the commits table.
 */
export declare const COMMIT_FIELDS: ParquetField[];
/**
 * Parquet schema for git commits.
 *
 * @description
 * Schema optimized for analytics queries on commit history:
 * - Author/committer analysis
 * - Commit frequency over time
 * - Message pattern analysis
 * - Merge commit identification
 *
 * @example
 * ```sql
 * -- Query commits by author
 * SELECT author_name, COUNT(*) as commit_count
 * FROM commits
 * WHERE repository = 'owner/repo'
 * GROUP BY author_name
 * ORDER BY commit_count DESC
 *
 * -- Find merge commits
 * SELECT sha, message_subject
 * FROM commits
 * WHERE is_merge = true
 * ```
 */
export declare const COMMITS_SCHEMA: ParquetSchema;
/**
 * TypeScript type for a commit row.
 */
export interface CommitRow {
    sha: string;
    tree_sha: string;
    parent_shas: string;
    author_name: string;
    author_email: string;
    author_date: number;
    committer_name: string;
    committer_email: string;
    committer_date: number;
    message: string;
    message_subject: string;
    repository: string;
    gpg_signature?: string | null;
    is_merge: boolean;
}
/**
 * Creates a commit row from a git commit object.
 *
 * @param commit - Git commit data
 * @param repository - Repository identifier
 * @returns CommitRow for Parquet writing
 */
export declare function toCommitRow(commit: {
    sha: string;
    treeSha: string;
    parentShas: string[];
    author: {
        name: string;
        email: string;
        date: Date | number;
    };
    committer: {
        name: string;
        email: string;
        date: Date | number;
    };
    message: string;
    gpgSignature?: string;
}, repository: string): CommitRow;
//# sourceMappingURL=commits.d.ts.map