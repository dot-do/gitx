/**
 * @fileoverview Parquet Schema for Git Commits
 *
 * Defines the Parquet schema for storing git commit data
 * in columnar format for analytics queries.
 *
 * @module export/schemas/commits
 */

import {
  defineSchema,
  ParquetFieldType,
  type ParquetSchema,
  type ParquetField,
} from '../../tiered/parquet-writer'

// ============================================================================
// Commit Schema Fields
// ============================================================================

/**
 * Fields for the commits table.
 */
export const COMMIT_FIELDS: ParquetField[] = [
  // Primary identifier
  {
    name: 'sha',
    type: ParquetFieldType.STRING,
    required: true,
    metadata: { description: 'Full 40-character commit SHA' },
  },

  // Tree reference
  {
    name: 'tree_sha',
    type: ParquetFieldType.STRING,
    required: true,
    metadata: { description: 'SHA of the root tree object' },
  },

  // Parent references (JSON array of SHAs)
  {
    name: 'parent_shas',
    type: ParquetFieldType.STRING,
    required: true,
    metadata: { description: 'JSON array of parent commit SHAs' },
  },

  // Author information
  {
    name: 'author_name',
    type: ParquetFieldType.STRING,
    required: true,
    metadata: { description: 'Author name' },
  },
  {
    name: 'author_email',
    type: ParquetFieldType.STRING,
    required: true,
    metadata: { description: 'Author email address' },
  },
  {
    name: 'author_date',
    type: ParquetFieldType.TIMESTAMP_MILLIS,
    required: true,
    metadata: { description: 'Author timestamp in milliseconds' },
  },

  // Committer information
  {
    name: 'committer_name',
    type: ParquetFieldType.STRING,
    required: true,
    metadata: { description: 'Committer name' },
  },
  {
    name: 'committer_email',
    type: ParquetFieldType.STRING,
    required: true,
    metadata: { description: 'Committer email address' },
  },
  {
    name: 'committer_date',
    type: ParquetFieldType.TIMESTAMP_MILLIS,
    required: true,
    metadata: { description: 'Committer timestamp in milliseconds' },
  },

  // Commit content
  {
    name: 'message',
    type: ParquetFieldType.STRING,
    required: true,
    metadata: { description: 'Full commit message' },
  },
  {
    name: 'message_subject',
    type: ParquetFieldType.STRING,
    required: true,
    metadata: { description: 'First line of commit message' },
  },

  // Repository context
  {
    name: 'repository',
    type: ParquetFieldType.STRING,
    required: true,
    metadata: { description: 'Repository identifier (e.g., owner/repo)' },
  },

  // Optional metadata
  {
    name: 'gpg_signature',
    type: ParquetFieldType.STRING,
    required: false,
    metadata: { description: 'GPG signature if commit is signed' },
  },
  {
    name: 'is_merge',
    type: ParquetFieldType.BOOLEAN,
    required: true,
    metadata: { description: 'True if commit has multiple parents' },
  },
]

// ============================================================================
// Schema Definition
// ============================================================================

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
export const COMMITS_SCHEMA: ParquetSchema = defineSchema(COMMIT_FIELDS, {
  table_name: 'commits',
  version: '1.0',
  created_by: 'gitx',
})

// ============================================================================
// Row Type
// ============================================================================

/**
 * TypeScript type for a commit row.
 */
export interface CommitRow {
  sha: string
  tree_sha: string
  parent_shas: string // JSON array
  author_name: string
  author_email: string
  author_date: number
  committer_name: string
  committer_email: string
  committer_date: number
  message: string
  message_subject: string
  repository: string
  gpg_signature?: string | null
  is_merge: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a commit row from a git commit object.
 *
 * @param commit - Git commit data
 * @param repository - Repository identifier
 * @returns CommitRow for Parquet writing
 */
export function toCommitRow(
  commit: {
    sha: string
    treeSha: string
    parentShas: string[]
    author: { name: string; email: string; date: Date | number }
    committer: { name: string; email: string; date: Date | number }
    message: string
    gpgSignature?: string
  },
  repository: string
): CommitRow {
  const authorDate = commit.author.date instanceof Date
    ? commit.author.date.getTime()
    : commit.author.date
  const committerDate = commit.committer.date instanceof Date
    ? commit.committer.date.getTime()
    : commit.committer.date

  // Extract subject (first line) from message
  const messageSubject = commit.message.split('\n')[0]?.trim() ?? ''

  return {
    sha: commit.sha,
    tree_sha: commit.treeSha,
    parent_shas: JSON.stringify(commit.parentShas),
    author_name: commit.author.name,
    author_email: commit.author.email,
    author_date: authorDate,
    committer_name: commit.committer.name,
    committer_email: commit.committer.email,
    committer_date: committerDate,
    message: commit.message,
    message_subject: messageSubject,
    repository,
    gpg_signature: commit.gpgSignature ?? null,
    is_merge: commit.parentShas.length > 1,
  }
}
