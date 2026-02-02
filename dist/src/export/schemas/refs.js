/**
 * @fileoverview Parquet Schema for Git Refs
 *
 * Defines the Parquet schema for storing git reference data
 * (branches, tags) in columnar format for analytics.
 *
 * @module export/schemas/refs
 */
import { defineSchema, ParquetFieldType, } from '../../tiered/parquet-writer';
// ============================================================================
// Ref Schema Fields
// ============================================================================
/**
 * Fields for the refs table.
 */
export const REF_FIELDS = [
    // Reference identity
    {
        name: 'name',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Full ref name (e.g., refs/heads/main)' },
    },
    {
        name: 'short_name',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Short name (e.g., main)' },
    },
    // Target
    {
        name: 'target_sha',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'SHA of the commit this ref points to' },
    },
    // Classification
    {
        name: 'ref_type',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Type: branch, tag, remote, or other' },
    },
    {
        name: 'is_head',
        type: ParquetFieldType.BOOLEAN,
        required: true,
        metadata: { description: 'True if this is the current HEAD' },
    },
    {
        name: 'is_default',
        type: ParquetFieldType.BOOLEAN,
        required: true,
        metadata: { description: 'True if this is the default branch' },
    },
    // Upstream tracking (for branches)
    {
        name: 'upstream',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Upstream ref name if tracking' },
    },
    {
        name: 'ahead',
        type: ParquetFieldType.INT32,
        required: false,
        metadata: { description: 'Commits ahead of upstream' },
    },
    {
        name: 'behind',
        type: ParquetFieldType.INT32,
        required: false,
        metadata: { description: 'Commits behind upstream' },
    },
    // Tag-specific fields
    {
        name: 'tag_message',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Annotated tag message' },
    },
    {
        name: 'tagger_name',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Tagger name for annotated tags' },
    },
    {
        name: 'tagger_email',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Tagger email for annotated tags' },
    },
    {
        name: 'tagger_date',
        type: ParquetFieldType.TIMESTAMP_MILLIS,
        required: false,
        metadata: { description: 'Tag date for annotated tags' },
    },
    // Repository context
    {
        name: 'repository',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Repository identifier (e.g., owner/repo)' },
    },
    // Snapshot timestamp
    {
        name: 'snapshot_time',
        type: ParquetFieldType.TIMESTAMP_MILLIS,
        required: true,
        metadata: { description: 'When this ref snapshot was taken' },
    },
];
// ============================================================================
// Schema Definition
// ============================================================================
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
export const REFS_SCHEMA = defineSchema(REF_FIELDS, {
    table_name: 'refs',
    version: '1.0',
    created_by: 'gitx',
});
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Determines ref type from ref name.
 */
function getRefType(name) {
    if (name.startsWith('refs/heads/'))
        return 'branch';
    if (name.startsWith('refs/tags/'))
        return 'tag';
    if (name.startsWith('refs/remotes/'))
        return 'remote';
    return 'other';
}
/**
 * Extracts short name from full ref name.
 */
function getShortName(name) {
    if (name.startsWith('refs/heads/'))
        return name.slice(11);
    if (name.startsWith('refs/tags/'))
        return name.slice(10);
    if (name.startsWith('refs/remotes/'))
        return name.slice(13);
    return name;
}
/**
 * Creates a ref row from git ref data.
 *
 * @param ref - Git reference data
 * @param repository - Repository identifier
 * @param options - Additional options
 * @returns RefRow for Parquet writing
 */
export function toRefRow(ref, repository, options = {}) {
    const refType = getRefType(ref.name);
    return {
        name: ref.name,
        short_name: getShortName(ref.name),
        target_sha: ref.targetSha,
        ref_type: refType,
        is_head: options.isHead ?? false,
        is_default: options.isDefault ?? false,
        upstream: ref.upstream ?? null,
        ahead: ref.ahead ?? null,
        behind: ref.behind ?? null,
        tag_message: ref.tagMessage ?? null,
        tagger_name: ref.tagger?.name ?? null,
        tagger_email: ref.tagger?.email ?? null,
        tagger_date: ref.tagger
            ? (ref.tagger.date instanceof Date ? ref.tagger.date.getTime() : ref.tagger.date)
            : null,
        repository,
        snapshot_time: options.snapshotTime ?? Date.now(),
    };
}
//# sourceMappingURL=refs.js.map