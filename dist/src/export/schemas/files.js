/**
 * @fileoverview Parquet Schema for Git File Changes
 *
 * Defines the Parquet schema for storing file-level changes
 * from git commits in columnar format for analytics.
 *
 * @module export/schemas/files
 */
import { defineSchema, ParquetFieldType, } from '../../tiered/parquet-writer';
/**
 * Descriptions for file change types.
 */
export const FILE_CHANGE_DESCRIPTIONS = {
    A: 'Added',
    M: 'Modified',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    T: 'Type changed',
    U: 'Unmerged',
    X: 'Unknown',
};
// ============================================================================
// File Schema Fields
// ============================================================================
/**
 * Fields for the files (file changes) table.
 */
export const FILE_FIELDS = [
    // Commit reference
    {
        name: 'commit_sha',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'SHA of the commit containing this change' },
    },
    // File identification
    {
        name: 'path',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'File path relative to repository root' },
    },
    {
        name: 'old_path',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Previous path for renames/copies' },
    },
    // Change classification
    {
        name: 'change_type',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Change type: A(dd), M(odify), D(elete), R(ename), C(opy)' },
    },
    // Binary detection
    {
        name: 'is_binary',
        type: ParquetFieldType.BOOLEAN,
        required: true,
        metadata: { description: 'True if file is detected as binary' },
    },
    // Diff statistics
    {
        name: 'lines_added',
        type: ParquetFieldType.INT32,
        required: false,
        metadata: { description: 'Lines added (null for binary files)' },
    },
    {
        name: 'lines_removed',
        type: ParquetFieldType.INT32,
        required: false,
        metadata: { description: 'Lines removed (null for binary files)' },
    },
    // Size information
    {
        name: 'old_size',
        type: ParquetFieldType.INT64,
        required: false,
        metadata: { description: 'Previous file size in bytes' },
    },
    {
        name: 'new_size',
        type: ParquetFieldType.INT64,
        required: false,
        metadata: { description: 'New file size in bytes' },
    },
    // Blob references
    {
        name: 'old_blob_sha',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'SHA of the blob before change' },
    },
    {
        name: 'new_blob_sha',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'SHA of the blob after change' },
    },
    // File mode
    {
        name: 'old_mode',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'Previous file mode (e.g., 100644)' },
    },
    {
        name: 'new_mode',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'New file mode (e.g., 100755)' },
    },
    // Similarity for renames/copies
    {
        name: 'similarity',
        type: ParquetFieldType.INT32,
        required: false,
        metadata: { description: 'Similarity percentage for renames/copies (0-100)' },
    },
    // File extension for analytics
    {
        name: 'extension',
        type: ParquetFieldType.STRING,
        required: false,
        metadata: { description: 'File extension (e.g., .ts, .js)' },
    },
    // Directory path for grouping
    {
        name: 'directory',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Parent directory path' },
    },
    // Repository context
    {
        name: 'repository',
        type: ParquetFieldType.STRING,
        required: true,
        metadata: { description: 'Repository identifier (e.g., owner/repo)' },
    },
    // Timestamp from parent commit
    {
        name: 'commit_date',
        type: ParquetFieldType.TIMESTAMP_MILLIS,
        required: true,
        metadata: { description: 'Timestamp of the parent commit' },
    },
];
// ============================================================================
// Schema Definition
// ============================================================================
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
export const FILES_SCHEMA = defineSchema(FILE_FIELDS, {
    table_name: 'files',
    version: '1.0',
    created_by: 'gitx',
});
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Extracts file extension from path.
 */
function getExtension(path) {
    const lastDot = path.lastIndexOf('.');
    const lastSlash = path.lastIndexOf('/');
    if (lastDot === -1 || lastDot < lastSlash)
        return null;
    return path.slice(lastDot);
}
/**
 * Extracts directory path from file path.
 */
function getDirectory(path) {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1)
        return '.';
    return path.slice(0, lastSlash);
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
export function toFileRow(file, commitSha, repository, commitDate) {
    return {
        commit_sha: commitSha,
        path: file.path,
        old_path: file.oldPath ?? null,
        change_type: file.changeType,
        is_binary: file.isBinary ?? false,
        lines_added: file.isBinary ? null : (file.linesAdded ?? null),
        lines_removed: file.isBinary ? null : (file.linesRemoved ?? null),
        old_size: file.oldSize ?? null,
        new_size: file.newSize ?? null,
        old_blob_sha: file.oldBlobSha ?? null,
        new_blob_sha: file.newBlobSha ?? null,
        old_mode: file.oldMode ?? null,
        new_mode: file.newMode ?? null,
        similarity: file.similarity ?? null,
        extension: getExtension(file.path),
        directory: getDirectory(file.path),
        repository,
        commit_date: commitDate instanceof Date ? commitDate.getTime() : commitDate,
    };
}
//# sourceMappingURL=files.js.map