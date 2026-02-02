/**
 * @fileoverview Parquet Schema for Repositories Metadata
 *
 * Defines the Parquet schema for tracking all synced repositories.
 * This is the top-level metadata table that indexes all repos in the system.
 *
 * @module export/schemas/repositories
 */
import { defineSchema, ParquetFieldType, } from '../../tiered/parquet-writer';
// ============================================================================
// Repository Schema Fields
// ============================================================================
/**
 * Fields for the repositories metadata table.
 */
export const REPOSITORY_FIELDS = [
    // -------------------------------------------------------------------------
    // Identity
    // -------------------------------------------------------------------------
    {
        name: 'full_name',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Full repository name (e.g., owner/repo)' },
    },
    {
        name: 'source',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Source platform: github, gitlab, bitbucket, etc.' },
    },
    {
        name: 'source_id',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Platform-specific repository ID' },
    },
    // -------------------------------------------------------------------------
    // URLs
    // -------------------------------------------------------------------------
    {
        name: 'clone_url',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'HTTPS clone URL' },
    },
    {
        name: 'html_url',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Web URL for the repository' },
    },
    // -------------------------------------------------------------------------
    // Repository metadata
    // -------------------------------------------------------------------------
    {
        name: 'default_branch',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Default branch name (e.g., main)' },
    },
    {
        name: 'visibility',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Visibility: public, private, internal' },
    },
    {
        name: 'is_fork',
        type: ParquetFieldType.BOOLEAN,
        required: true,
        metadata: { description: 'True if this is a forked repository' },
    },
    {
        name: 'parent_full_name',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Parent repository full_name if forked' },
    },
    {
        name: 'description',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Repository description' },
    },
    // -------------------------------------------------------------------------
    // Owner information
    // -------------------------------------------------------------------------
    {
        name: 'owner_name',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Owner username or organization name' },
    },
    {
        name: 'owner_type',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Owner type: user or organization' },
    },
    // -------------------------------------------------------------------------
    // Sync timestamps
    // -------------------------------------------------------------------------
    {
        name: 'created_at',
        type: ParquetFieldType.TIMESTAMP_MILLIS,
        required: false,
        metadata: { description: 'When the repository was created on the platform' },
    },
    {
        name: 'first_synced_at',
        type: ParquetFieldType.TIMESTAMP_MILLIS,
        required: true,
        metadata: { description: 'When GitX first synced this repository' },
    },
    {
        name: 'last_synced_at',
        type: ParquetFieldType.TIMESTAMP_MILLIS,
        required: true,
        metadata: { description: 'When GitX last successfully synced' },
    },
    {
        name: 'last_push_at',
        type: ParquetFieldType.TIMESTAMP_MILLIS,
        required: false,
        metadata: { description: 'Last push timestamp from the platform' },
    },
    // -------------------------------------------------------------------------
    // Sync state
    // -------------------------------------------------------------------------
    {
        name: 'sync_status',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Sync status: pending, syncing, synced, failed, stale' },
    },
    {
        name: 'last_error',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Last sync error message if failed' },
    },
    {
        name: 'webhook_active',
        type: ParquetFieldType.BOOLEAN,
        required: true,
        metadata: { description: 'True if webhook is configured and active' },
    },
    {
        name: 'webhook_id',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Platform webhook ID if configured' },
    },
    // -------------------------------------------------------------------------
    // Git state
    // -------------------------------------------------------------------------
    {
        name: 'head_sha',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Current HEAD commit SHA' },
    },
    {
        name: 'head_ref',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Current HEAD ref (branch name)' },
    },
    // -------------------------------------------------------------------------
    // Statistics (aggregated)
    // -------------------------------------------------------------------------
    {
        name: 'commit_count',
        type: ParquetFieldType.INT64,
        required: true,
        metadata: { description: 'Total number of commits' },
    },
    {
        name: 'branch_count',
        type: ParquetFieldType.INT32,
        required: true,
        metadata: { description: 'Number of branches' },
    },
    {
        name: 'tag_count',
        type: ParquetFieldType.INT32,
        required: true,
        metadata: { description: 'Number of tags' },
    },
    {
        name: 'contributor_count',
        type: ParquetFieldType.INT32,
        required: true,
        metadata: { description: 'Number of unique contributors' },
    },
    {
        name: 'file_count',
        type: ParquetFieldType.INT32,
        required: false,
        metadata: { description: 'Number of files in HEAD' },
    },
    // -------------------------------------------------------------------------
    // Size metrics
    // -------------------------------------------------------------------------
    {
        name: 'size_bytes',
        type: ParquetFieldType.INT64,
        required: false,
        metadata: { description: 'Repository size in bytes (from platform)' },
    },
    {
        name: 'pack_size_bytes',
        type: ParquetFieldType.INT64,
        required: false,
        metadata: { description: 'Size of git packfiles in R2' },
    },
    // -------------------------------------------------------------------------
    // Language stats
    // -------------------------------------------------------------------------
    {
        name: 'primary_language',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Primary programming language' },
    },
    {
        name: 'languages_json',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'JSON object of language -> bytes mapping' },
    },
    // -------------------------------------------------------------------------
    // GitX internal
    // -------------------------------------------------------------------------
    {
        name: 'do_id',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Durable Object ID for this repository' },
    },
    {
        name: 'namespace',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'GitX namespace key (e.g., github:owner/repo)' },
    },
];
// ============================================================================
// Schema Definition
// ============================================================================
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
export const REPOSITORIES_SCHEMA = defineSchema(REPOSITORY_FIELDS, {
    table_name: 'repositories',
    version: '1.0',
    created_by: 'gitx',
});
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Creates a repository row from sync data.
 *
 * @param repo - Repository data from sync
 * @param stats - Aggregated statistics
 * @param doId - Durable Object ID
 * @returns RepositoryRow for Parquet writing
 */
export function toRepositoryRow(repo, stats, sync) {
    const toTimestamp = (d) => {
        if (d === undefined)
            return null;
        return d instanceof Date ? d.getTime() : d;
    };
    return {
        // Identity
        full_name: repo.fullName,
        source: repo.source,
        source_id: repo.sourceId ?? null,
        // URLs
        clone_url: repo.cloneUrl,
        html_url: repo.htmlUrl ?? null,
        // Repository metadata
        default_branch: repo.defaultBranch,
        visibility: repo.visibility,
        is_fork: repo.isFork ?? false,
        parent_full_name: repo.parentFullName ?? null,
        description: repo.description ?? null,
        // Owner
        owner_name: repo.ownerName,
        owner_type: repo.ownerType,
        // Timestamps
        created_at: toTimestamp(repo.createdAt),
        first_synced_at: toTimestamp(sync.firstSyncedAt) ?? Date.now(),
        last_synced_at: toTimestamp(sync.lastSyncedAt) ?? Date.now(),
        last_push_at: toTimestamp(repo.lastPushAt),
        // Sync state
        sync_status: sync.status,
        last_error: sync.error ?? null,
        webhook_active: sync.webhookActive ?? false,
        webhook_id: sync.webhookId ?? null,
        // Git state
        head_sha: sync.headSha ?? null,
        head_ref: sync.headRef ?? null,
        // Statistics
        commit_count: stats.commitCount,
        branch_count: stats.branchCount,
        tag_count: stats.tagCount,
        contributor_count: stats.contributorCount,
        file_count: stats.fileCount ?? null,
        // Size
        size_bytes: stats.sizeBytes ?? null,
        pack_size_bytes: stats.packSizeBytes ?? null,
        // Languages
        primary_language: stats.primaryLanguage ?? null,
        languages_json: stats.languages ? JSON.stringify(stats.languages) : null,
        // GitX internal
        do_id: sync.doId,
        namespace: sync.namespace,
    };
}
/**
 * Creates a namespace key from source and full name.
 */
export function toNamespace(source, fullName) {
    return `${source}:${fullName}`;
}
/**
 * Parses a namespace key into source and full name.
 */
export function fromNamespace(namespace) {
    const colonIndex = namespace.indexOf(':');
    if (colonIndex === -1) {
        return { source: 'github', fullName: namespace };
    }
    return {
        source: namespace.slice(0, colonIndex),
        fullName: namespace.slice(colonIndex + 1),
    };
}
//# sourceMappingURL=repositories.js.map