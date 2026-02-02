/**
 * @fileoverview Parquet Schema for Repositories Metadata
 *
 * Defines the Parquet schema for tracking all synced repositories.
 * This is the top-level metadata table that indexes all repos in the system.
 *
 * @module export/schemas/repositories
 */
import { type ParquetSchema, type ParquetField } from '../../tiered/parquet-writer';
/**
 * Repository sync status values.
 */
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'stale';
/**
 * Repository source platforms.
 */
export type RepositorySource = 'github' | 'gitlab' | 'bitbucket' | 'gitea' | 'local';
/**
 * Fields for the repositories metadata table.
 */
export declare const REPOSITORY_FIELDS: ParquetField[];
/**
 * Parquet schema for repositories metadata.
 *
 * @description
 * Top-level metadata table for tracking all synced repositories:
 * - Repository identity and URLs
 * - Sync status and timestamps
 * - Aggregated statistics
 * - Webhook configuration
 *
 * @example
 * ```sql
 * -- Find all synced GitHub repos
 * SELECT full_name, commit_count, last_synced_at
 * FROM repositories
 * WHERE source = 'github' AND sync_status = 'synced'
 * ORDER BY commit_count DESC
 *
 * -- Find repos with failed syncs
 * SELECT full_name, last_error, last_synced_at
 * FROM repositories
 * WHERE sync_status = 'failed'
 *
 * -- Get total stats across all repos
 * SELECT
 *   COUNT(*) as repo_count,
 *   SUM(commit_count) as total_commits,
 *   SUM(contributor_count) as total_contributors
 * FROM repositories
 * WHERE sync_status = 'synced'
 * ```
 */
export declare const REPOSITORIES_SCHEMA: ParquetSchema;
/**
 * TypeScript type for a repository row.
 */
export interface RepositoryRow {
    full_name: string;
    source: RepositorySource;
    source_id?: string | null;
    clone_url: string;
    html_url?: string | null;
    default_branch: string;
    visibility: 'public' | 'private' | 'internal';
    is_fork: boolean;
    parent_full_name?: string | null;
    description?: string | null;
    owner_name: string;
    owner_type: 'user' | 'organization';
    created_at?: number | null;
    first_synced_at: number;
    last_synced_at: number;
    last_push_at?: number | null;
    sync_status: SyncStatus;
    last_error?: string | null;
    webhook_active: boolean;
    webhook_id?: string | null;
    head_sha?: string | null;
    head_ref?: string | null;
    commit_count: number;
    branch_count: number;
    tag_count: number;
    contributor_count: number;
    file_count?: number | null;
    size_bytes?: number | null;
    pack_size_bytes?: number | null;
    primary_language?: string | null;
    languages_json?: string | null;
    do_id: string;
    namespace: string;
}
/**
 * Creates a repository row from sync data.
 *
 * @param repo - Repository data from sync
 * @param stats - Aggregated statistics
 * @param doId - Durable Object ID
 * @returns RepositoryRow for Parquet writing
 */
export declare function toRepositoryRow(repo: {
    fullName: string;
    source: RepositorySource;
    sourceId?: string;
    cloneUrl: string;
    htmlUrl?: string;
    defaultBranch: string;
    visibility: 'public' | 'private' | 'internal';
    isFork?: boolean;
    parentFullName?: string;
    description?: string;
    ownerName: string;
    ownerType: 'user' | 'organization';
    createdAt?: Date | number;
    lastPushAt?: Date | number;
}, stats: {
    commitCount: number;
    branchCount: number;
    tagCount: number;
    contributorCount: number;
    fileCount?: number;
    sizeBytes?: number;
    packSizeBytes?: number;
    primaryLanguage?: string;
    languages?: Record<string, number>;
}, sync: {
    doId: string;
    namespace: string;
    firstSyncedAt: Date | number;
    lastSyncedAt: Date | number;
    status: SyncStatus;
    error?: string;
    webhookActive?: boolean;
    webhookId?: string;
    headSha?: string;
    headRef?: string;
}): RepositoryRow;
/**
 * Creates a namespace key from source and full name.
 */
export declare function toNamespace(source: RepositorySource, fullName: string): string;
/**
 * Parses a namespace key into source and full name.
 */
export declare function fromNamespace(namespace: string): {
    source: RepositorySource;
    fullName: string;
};
//# sourceMappingURL=repositories.d.ts.map