import { describe, it, expect } from 'vitest'
import {
  COMMITS_SCHEMA,
  COMMIT_FIELDS,
  toCommitRow,
  REFS_SCHEMA,
  REF_FIELDS,
  toRefRow,
  FILES_SCHEMA,
  FILE_FIELDS,
  toFileRow,
  FILE_CHANGE_DESCRIPTIONS,
  REPOSITORIES_SCHEMA,
  REPOSITORY_FIELDS,
  toRepositoryRow,
  toNamespace,
  fromNamespace,
} from '../../src/export/schemas'
import { ParquetFieldType } from '../../src/tiered/parquet-writer'

// =============================================================================
// Test Data Helpers
// =============================================================================

function makeCommit(overrides: Partial<Parameters<typeof toCommitRow>[0]> = {}) {
  return {
    sha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    parentShas: ['c'.repeat(40)],
    author: { name: 'Alice', email: 'alice@example.com', date: 1700000000000 },
    committer: { name: 'Bob', email: 'bob@example.com', date: 1700000001000 },
    message: 'fix: resolve edge case\n\nDetailed body here.',
    ...overrides,
  }
}

function makeRef(overrides: Partial<Parameters<typeof toRefRow>[0]> = {}) {
  return {
    name: 'refs/heads/main',
    targetSha: 'a'.repeat(40),
    ...overrides,
  }
}

function makeFile(overrides: Partial<Parameters<typeof toFileRow>[0]> = {}) {
  return {
    path: 'src/index.ts',
    changeType: 'M' as const,
    ...overrides,
  }
}

// =============================================================================
// Commits Schema
// =============================================================================

describe('Commits Schema', () => {
  describe('COMMITS_SCHEMA', () => {
    it('should define all expected fields', () => {
      const fieldNames = COMMITS_SCHEMA.fields.map(f => f.name)
      expect(fieldNames).toContain('sha')
      expect(fieldNames).toContain('tree_sha')
      expect(fieldNames).toContain('parent_shas')
      expect(fieldNames).toContain('author_name')
      expect(fieldNames).toContain('author_email')
      expect(fieldNames).toContain('author_date')
      expect(fieldNames).toContain('committer_name')
      expect(fieldNames).toContain('committer_email')
      expect(fieldNames).toContain('committer_date')
      expect(fieldNames).toContain('message')
      expect(fieldNames).toContain('message_subject')
      expect(fieldNames).toContain('repository')
      expect(fieldNames).toContain('gpg_signature')
      expect(fieldNames).toContain('is_merge')
    })

    it('should have correct field count matching COMMIT_FIELDS', () => {
      expect(COMMITS_SCHEMA.fields.length).toBe(COMMIT_FIELDS.length)
    })

    it('should use TIMESTAMP_MILLIS for date fields', () => {
      const authorDate = COMMITS_SCHEMA.fields.find(f => f.name === 'author_date')
      const committerDate = COMMITS_SCHEMA.fields.find(f => f.name === 'committer_date')
      expect(authorDate?.type).toBe(ParquetFieldType.TIMESTAMP_MILLIS)
      expect(committerDate?.type).toBe(ParquetFieldType.TIMESTAMP_MILLIS)
    })

    it('should mark gpg_signature as optional', () => {
      const gpg = COMMITS_SCHEMA.fields.find(f => f.name === 'gpg_signature')
      expect(gpg?.required).toBe(false)
    })

    it('should mark primary fields as required', () => {
      const required = ['sha', 'tree_sha', 'parent_shas', 'author_name', 'author_email',
        'author_date', 'committer_name', 'committer_email', 'committer_date',
        'message', 'message_subject', 'repository', 'is_merge']
      for (const name of required) {
        const field = COMMITS_SCHEMA.fields.find(f => f.name === name)
        expect(field?.required, `${name} should be required`).toBe(true)
      }
    })

    it('should include table metadata', () => {
      expect(COMMITS_SCHEMA.metadata?.table_name).toBe('commits')
      expect(COMMITS_SCHEMA.metadata?.created_by).toBe('gitx')
    })
  })

  describe('toCommitRow', () => {
    it('should convert a basic commit to a row', () => {
      const row = toCommitRow(makeCommit(), 'owner/repo')
      expect(row.sha).toBe('a'.repeat(40))
      expect(row.tree_sha).toBe('b'.repeat(40))
      expect(row.parent_shas).toBe(JSON.stringify(['c'.repeat(40)]))
      expect(row.author_name).toBe('Alice')
      expect(row.author_email).toBe('alice@example.com')
      expect(row.committer_name).toBe('Bob')
      expect(row.committer_email).toBe('bob@example.com')
      expect(row.repository).toBe('owner/repo')
    })

    it('should extract message subject from first line', () => {
      const row = toCommitRow(makeCommit(), 'owner/repo')
      expect(row.message_subject).toBe('fix: resolve edge case')
      expect(row.message).toContain('Detailed body here.')
    })

    it('should handle single-line messages', () => {
      const row = toCommitRow(makeCommit({ message: 'chore: bump version' }), 'r')
      expect(row.message_subject).toBe('chore: bump version')
    })

    it('should detect merge commits (multiple parents)', () => {
      const row = toCommitRow(makeCommit({
        parentShas: ['c'.repeat(40), 'd'.repeat(40)],
      }), 'r')
      expect(row.is_merge).toBe(true)
    })

    it('should detect non-merge commits (single parent)', () => {
      const row = toCommitRow(makeCommit({ parentShas: ['c'.repeat(40)] }), 'r')
      expect(row.is_merge).toBe(false)
    })

    it('should detect root commits (no parents) as non-merge', () => {
      const row = toCommitRow(makeCommit({ parentShas: [] }), 'r')
      expect(row.is_merge).toBe(false)
    })

    it('should handle Date objects for timestamps', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const row = toCommitRow(makeCommit({
        author: { name: 'A', email: 'a@a.com', date },
        committer: { name: 'B', email: 'b@b.com', date },
      }), 'r')
      expect(row.author_date).toBe(date.getTime())
      expect(row.committer_date).toBe(date.getTime())
    })

    it('should handle numeric timestamps (BigInt-safe range)', () => {
      // Timestamp for 2024-01-15 in milliseconds - well within safe integer range
      const ts = 1705312000000
      const row = toCommitRow(makeCommit({
        author: { name: 'A', email: 'a@a.com', date: ts },
        committer: { name: 'B', email: 'b@b.com', date: ts },
      }), 'r')
      expect(row.author_date).toBe(ts)
      expect(row.committer_date).toBe(ts)
    })

    it('should handle very large timestamps without precision loss', () => {
      // Year ~2100 timestamp in milliseconds
      const farFuture = 4102444800000
      const row = toCommitRow(makeCommit({
        author: { name: 'A', email: 'a@a.com', date: farFuture },
        committer: { name: 'B', email: 'b@b.com', date: farFuture },
      }), 'r')
      expect(row.author_date).toBe(farFuture)
      expect(row.committer_date).toBe(farFuture)
    })

    it('should set gpg_signature to null when not provided', () => {
      const row = toCommitRow(makeCommit(), 'r')
      expect(row.gpg_signature).toBeNull()
    })

    it('should preserve gpg_signature when provided', () => {
      const row = toCommitRow(makeCommit({ gpgSignature: '-----BEGIN PGP SIGNATURE-----' }), 'r')
      expect(row.gpg_signature).toBe('-----BEGIN PGP SIGNATURE-----')
    })
  })
})

// =============================================================================
// Refs Schema
// =============================================================================

describe('Refs Schema', () => {
  describe('REFS_SCHEMA', () => {
    it('should define all expected fields', () => {
      const fieldNames = REFS_SCHEMA.fields.map(f => f.name)
      expect(fieldNames).toContain('name')
      expect(fieldNames).toContain('short_name')
      expect(fieldNames).toContain('target_sha')
      expect(fieldNames).toContain('ref_type')
      expect(fieldNames).toContain('is_head')
      expect(fieldNames).toContain('is_default')
      expect(fieldNames).toContain('upstream')
      expect(fieldNames).toContain('ahead')
      expect(fieldNames).toContain('behind')
      expect(fieldNames).toContain('tag_message')
      expect(fieldNames).toContain('tagger_name')
      expect(fieldNames).toContain('tagger_email')
      expect(fieldNames).toContain('tagger_date')
      expect(fieldNames).toContain('repository')
      expect(fieldNames).toContain('snapshot_time')
    })

    it('should have correct field count matching REF_FIELDS', () => {
      expect(REFS_SCHEMA.fields.length).toBe(REF_FIELDS.length)
    })

    it('should use TIMESTAMP_MILLIS for tagger_date and snapshot_time', () => {
      const taggerDate = REFS_SCHEMA.fields.find(f => f.name === 'tagger_date')
      const snapshotTime = REFS_SCHEMA.fields.find(f => f.name === 'snapshot_time')
      expect(taggerDate?.type).toBe(ParquetFieldType.TIMESTAMP_MILLIS)
      expect(snapshotTime?.type).toBe(ParquetFieldType.TIMESTAMP_MILLIS)
    })

    it('should include table metadata', () => {
      expect(REFS_SCHEMA.metadata?.table_name).toBe('refs')
    })
  })

  describe('toRefRow', () => {
    it('should classify branch refs', () => {
      const row = toRefRow(makeRef({ name: 'refs/heads/main' }), 'r')
      expect(row.ref_type).toBe('branch')
      expect(row.short_name).toBe('main')
    })

    it('should classify tag refs', () => {
      const row = toRefRow(makeRef({ name: 'refs/tags/v1.0.0' }), 'r')
      expect(row.ref_type).toBe('tag')
      expect(row.short_name).toBe('v1.0.0')
    })

    it('should classify remote refs', () => {
      const row = toRefRow(makeRef({ name: 'refs/remotes/origin/main' }), 'r')
      expect(row.ref_type).toBe('remote')
      expect(row.short_name).toBe('origin/main')
    })

    it('should classify other refs', () => {
      const row = toRefRow(makeRef({ name: 'refs/stash' }), 'r')
      expect(row.ref_type).toBe('other')
      expect(row.short_name).toBe('refs/stash')
    })

    it('should set is_head and is_default from options', () => {
      const row = toRefRow(makeRef(), 'r', { isHead: true, isDefault: true })
      expect(row.is_head).toBe(true)
      expect(row.is_default).toBe(true)
    })

    it('should default is_head and is_default to false', () => {
      const row = toRefRow(makeRef(), 'r')
      expect(row.is_head).toBe(false)
      expect(row.is_default).toBe(false)
    })

    it('should use provided snapshot time', () => {
      const row = toRefRow(makeRef(), 'r', { snapshotTime: 1700000000000 })
      expect(row.snapshot_time).toBe(1700000000000)
    })

    it('should handle upstream tracking info', () => {
      const row = toRefRow(makeRef({
        upstream: 'refs/remotes/origin/main',
        ahead: 3,
        behind: 1,
      }), 'r')
      expect(row.upstream).toBe('refs/remotes/origin/main')
      expect(row.ahead).toBe(3)
      expect(row.behind).toBe(1)
    })

    it('should handle annotated tag data', () => {
      const row = toRefRow(makeRef({
        name: 'refs/tags/v2.0.0',
        tagMessage: 'Release 2.0',
        tagger: { name: 'Tagger', email: 'tag@example.com', date: 1700000000000 },
      }), 'r')
      expect(row.tag_message).toBe('Release 2.0')
      expect(row.tagger_name).toBe('Tagger')
      expect(row.tagger_email).toBe('tag@example.com')
      expect(row.tagger_date).toBe(1700000000000)
    })

    it('should handle tagger with Date object', () => {
      const date = new Date('2024-06-15T00:00:00Z')
      const row = toRefRow(makeRef({
        name: 'refs/tags/v1.0',
        tagger: { name: 'T', email: 't@t.com', date },
      }), 'r')
      expect(row.tagger_date).toBe(date.getTime())
    })

    it('should set optional fields to null when absent', () => {
      const row = toRefRow(makeRef(), 'r')
      expect(row.upstream).toBeNull()
      expect(row.ahead).toBeNull()
      expect(row.behind).toBeNull()
      expect(row.tag_message).toBeNull()
      expect(row.tagger_name).toBeNull()
      expect(row.tagger_email).toBeNull()
      expect(row.tagger_date).toBeNull()
    })
  })
})

// =============================================================================
// Files Schema
// =============================================================================

describe('Files Schema', () => {
  describe('FILES_SCHEMA', () => {
    it('should define all expected fields', () => {
      const fieldNames = FILES_SCHEMA.fields.map(f => f.name)
      expect(fieldNames).toContain('commit_sha')
      expect(fieldNames).toContain('path')
      expect(fieldNames).toContain('old_path')
      expect(fieldNames).toContain('change_type')
      expect(fieldNames).toContain('is_binary')
      expect(fieldNames).toContain('lines_added')
      expect(fieldNames).toContain('lines_removed')
      expect(fieldNames).toContain('old_size')
      expect(fieldNames).toContain('new_size')
      expect(fieldNames).toContain('extension')
      expect(fieldNames).toContain('directory')
      expect(fieldNames).toContain('repository')
      expect(fieldNames).toContain('commit_date')
    })

    it('should have correct field count matching FILE_FIELDS', () => {
      expect(FILES_SCHEMA.fields.length).toBe(FILE_FIELDS.length)
    })

    it('should use INT64 for size fields (large files)', () => {
      const oldSize = FILES_SCHEMA.fields.find(f => f.name === 'old_size')
      const newSize = FILES_SCHEMA.fields.find(f => f.name === 'new_size')
      expect(oldSize?.type).toBe(ParquetFieldType.INT64)
      expect(newSize?.type).toBe(ParquetFieldType.INT64)
    })

    it('should include table metadata', () => {
      expect(FILES_SCHEMA.metadata?.table_name).toBe('files')
    })
  })

  describe('FILE_CHANGE_DESCRIPTIONS', () => {
    it('should have descriptions for all change types', () => {
      expect(FILE_CHANGE_DESCRIPTIONS.A).toBe('Added')
      expect(FILE_CHANGE_DESCRIPTIONS.M).toBe('Modified')
      expect(FILE_CHANGE_DESCRIPTIONS.D).toBe('Deleted')
      expect(FILE_CHANGE_DESCRIPTIONS.R).toBe('Renamed')
      expect(FILE_CHANGE_DESCRIPTIONS.C).toBe('Copied')
      expect(FILE_CHANGE_DESCRIPTIONS.T).toBe('Type changed')
      expect(FILE_CHANGE_DESCRIPTIONS.U).toBe('Unmerged')
      expect(FILE_CHANGE_DESCRIPTIONS.X).toBe('Unknown')
    })
  })

  describe('toFileRow', () => {
    it('should convert a basic file change', () => {
      const row = toFileRow(makeFile(), 'a'.repeat(40), 'owner/repo', 1700000000000)
      expect(row.commit_sha).toBe('a'.repeat(40))
      expect(row.path).toBe('src/index.ts')
      expect(row.change_type).toBe('M')
      expect(row.repository).toBe('owner/repo')
      expect(row.commit_date).toBe(1700000000000)
    })

    it('should extract file extension', () => {
      const row = toFileRow(makeFile({ path: 'lib/utils.js' }), 'a'.repeat(40), 'r', 0)
      expect(row.extension).toBe('.js')
    })

    it('should extract nested file extension', () => {
      const row = toFileRow(makeFile({ path: 'src/types/foo.d.ts' }), 'a'.repeat(40), 'r', 0)
      expect(row.extension).toBe('.ts')
    })

    it('should return null extension for extensionless files', () => {
      const row = toFileRow(makeFile({ path: 'Makefile' }), 'a'.repeat(40), 'r', 0)
      expect(row.extension).toBeNull()
    })

    it('should extract directory path', () => {
      const row = toFileRow(makeFile({ path: 'src/utils/helpers.ts' }), 'a'.repeat(40), 'r', 0)
      expect(row.directory).toBe('src/utils')
    })

    it('should use dot for root-level files', () => {
      const row = toFileRow(makeFile({ path: 'README.md' }), 'a'.repeat(40), 'r', 0)
      expect(row.directory).toBe('.')
    })

    it('should handle renamed files with old_path', () => {
      const row = toFileRow(makeFile({
        path: 'src/new-name.ts',
        oldPath: 'src/old-name.ts',
        changeType: 'R',
        similarity: 95,
      }), 'a'.repeat(40), 'r', 0)
      expect(row.old_path).toBe('src/old-name.ts')
      expect(row.change_type).toBe('R')
      expect(row.similarity).toBe(95)
    })

    it('should null lines_added/removed for binary files', () => {
      const row = toFileRow(makeFile({
        isBinary: true,
        linesAdded: 10,
        linesRemoved: 5,
      }), 'a'.repeat(40), 'r', 0)
      expect(row.is_binary).toBe(true)
      expect(row.lines_added).toBeNull()
      expect(row.lines_removed).toBeNull()
    })

    it('should include lines_added/removed for text files', () => {
      const row = toFileRow(makeFile({
        linesAdded: 42,
        linesRemoved: 7,
      }), 'a'.repeat(40), 'r', 0)
      expect(row.is_binary).toBe(false)
      expect(row.lines_added).toBe(42)
      expect(row.lines_removed).toBe(7)
    })

    it('should handle Date object for commit date', () => {
      const date = new Date('2024-03-10T08:00:00Z')
      const row = toFileRow(makeFile(), 'a'.repeat(40), 'r', date)
      expect(row.commit_date).toBe(date.getTime())
    })

    it('should set optional fields to null when absent', () => {
      const row = toFileRow(makeFile(), 'a'.repeat(40), 'r', 0)
      expect(row.old_path).toBeNull()
      expect(row.old_size).toBeNull()
      expect(row.new_size).toBeNull()
      expect(row.old_blob_sha).toBeNull()
      expect(row.new_blob_sha).toBeNull()
      expect(row.old_mode).toBeNull()
      expect(row.new_mode).toBeNull()
      expect(row.similarity).toBeNull()
    })

    it('should preserve blob SHAs and file modes', () => {
      const row = toFileRow(makeFile({
        oldBlobSha: 'e'.repeat(40),
        newBlobSha: 'f'.repeat(40),
        oldMode: '100644',
        newMode: '100755',
      }), 'a'.repeat(40), 'r', 0)
      expect(row.old_blob_sha).toBe('e'.repeat(40))
      expect(row.new_blob_sha).toBe('f'.repeat(40))
      expect(row.old_mode).toBe('100644')
      expect(row.new_mode).toBe('100755')
    })
  })
})

// =============================================================================
// Repositories Schema
// =============================================================================

describe('Repositories Schema', () => {
  describe('REPOSITORIES_SCHEMA', () => {
    it('should define all expected fields', () => {
      const fieldNames = REPOSITORIES_SCHEMA.fields.map(f => f.name)
      expect(fieldNames).toContain('full_name')
      expect(fieldNames).toContain('source')
      expect(fieldNames).toContain('clone_url')
      expect(fieldNames).toContain('default_branch')
      expect(fieldNames).toContain('visibility')
      expect(fieldNames).toContain('is_fork')
      expect(fieldNames).toContain('owner_name')
      expect(fieldNames).toContain('owner_type')
      expect(fieldNames).toContain('first_synced_at')
      expect(fieldNames).toContain('last_synced_at')
      expect(fieldNames).toContain('sync_status')
      expect(fieldNames).toContain('commit_count')
      expect(fieldNames).toContain('branch_count')
      expect(fieldNames).toContain('tag_count')
      expect(fieldNames).toContain('contributor_count')
      expect(fieldNames).toContain('do_id')
      expect(fieldNames).toContain('namespace')
    })

    it('should have correct field count matching REPOSITORY_FIELDS', () => {
      expect(REPOSITORIES_SCHEMA.fields.length).toBe(REPOSITORY_FIELDS.length)
    })

    it('should use INT64 for commit_count and size fields', () => {
      const commitCount = REPOSITORIES_SCHEMA.fields.find(f => f.name === 'commit_count')
      const sizeBytes = REPOSITORIES_SCHEMA.fields.find(f => f.name === 'size_bytes')
      const packSize = REPOSITORIES_SCHEMA.fields.find(f => f.name === 'pack_size_bytes')
      expect(commitCount?.type).toBe(ParquetFieldType.INT64)
      expect(sizeBytes?.type).toBe(ParquetFieldType.INT64)
      expect(packSize?.type).toBe(ParquetFieldType.INT64)
    })

    it('should use TIMESTAMP_MILLIS for timestamp fields', () => {
      const tsFields = ['created_at', 'first_synced_at', 'last_synced_at', 'last_push_at']
      for (const name of tsFields) {
        const field = REPOSITORIES_SCHEMA.fields.find(f => f.name === name)
        expect(field?.type, `${name} should be TIMESTAMP_MILLIS`).toBe(ParquetFieldType.TIMESTAMP_MILLIS)
      }
    })

    it('should include table metadata', () => {
      expect(REPOSITORIES_SCHEMA.metadata?.table_name).toBe('repositories')
    })
  })

  describe('toRepositoryRow', () => {
    const baseRepo = {
      fullName: 'owner/repo',
      source: 'github' as const,
      cloneUrl: 'https://github.com/owner/repo.git',
      defaultBranch: 'main',
      visibility: 'public' as const,
      ownerName: 'owner',
      ownerType: 'user' as const,
    }
    const baseStats = {
      commitCount: 100,
      branchCount: 5,
      tagCount: 10,
      contributorCount: 3,
    }
    const baseSync = {
      doId: 'do-123',
      namespace: 'github:owner/repo',
      firstSyncedAt: 1700000000000,
      lastSyncedAt: 1700001000000,
      status: 'synced' as const,
    }

    it('should convert basic repository data', () => {
      const row = toRepositoryRow(baseRepo, baseStats, baseSync)
      expect(row.full_name).toBe('owner/repo')
      expect(row.source).toBe('github')
      expect(row.clone_url).toBe('https://github.com/owner/repo.git')
      expect(row.default_branch).toBe('main')
      expect(row.visibility).toBe('public')
      expect(row.owner_name).toBe('owner')
      expect(row.owner_type).toBe('user')
      expect(row.commit_count).toBe(100)
      expect(row.branch_count).toBe(5)
      expect(row.tag_count).toBe(10)
      expect(row.contributor_count).toBe(3)
      expect(row.do_id).toBe('do-123')
      expect(row.namespace).toBe('github:owner/repo')
      expect(row.sync_status).toBe('synced')
    })

    it('should handle optional repository fields', () => {
      const row = toRepositoryRow(
        { ...baseRepo, description: 'A cool repo', isFork: true, parentFullName: 'upstream/repo' },
        baseStats,
        baseSync
      )
      expect(row.description).toBe('A cool repo')
      expect(row.is_fork).toBe(true)
      expect(row.parent_full_name).toBe('upstream/repo')
    })

    it('should handle Date objects for timestamps', () => {
      const row = toRepositoryRow(
        { ...baseRepo, createdAt: new Date('2024-01-01T00:00:00Z') },
        baseStats,
        { ...baseSync, firstSyncedAt: new Date('2024-06-01T00:00:00Z'), lastSyncedAt: new Date('2024-06-15T00:00:00Z') }
      )
      expect(row.created_at).toBe(new Date('2024-01-01T00:00:00Z').getTime())
      expect(row.first_synced_at).toBe(new Date('2024-06-01T00:00:00Z').getTime())
      expect(row.last_synced_at).toBe(new Date('2024-06-15T00:00:00Z').getTime())
    })

    it('should serialize languages to JSON', () => {
      const row = toRepositoryRow(
        baseRepo,
        { ...baseStats, languages: { TypeScript: 50000, JavaScript: 10000 }, primaryLanguage: 'TypeScript' },
        baseSync
      )
      expect(row.primary_language).toBe('TypeScript')
      expect(row.languages_json).toBe(JSON.stringify({ TypeScript: 50000, JavaScript: 10000 }))
    })

    it('should set optional fields to null when absent', () => {
      const row = toRepositoryRow(baseRepo, baseStats, baseSync)
      expect(row.source_id).toBeNull()
      expect(row.html_url).toBeNull()
      expect(row.parent_full_name).toBeNull()
      expect(row.description).toBeNull()
      expect(row.created_at).toBeNull()
      expect(row.last_push_at).toBeNull()
      expect(row.last_error).toBeNull()
      expect(row.webhook_id).toBeNull()
      expect(row.head_sha).toBeNull()
      expect(row.head_ref).toBeNull()
      expect(row.file_count).toBeNull()
      expect(row.size_bytes).toBeNull()
      expect(row.pack_size_bytes).toBeNull()
      expect(row.primary_language).toBeNull()
      expect(row.languages_json).toBeNull()
    })

    it('should handle sync error state', () => {
      const row = toRepositoryRow(baseRepo, baseStats, {
        ...baseSync,
        status: 'failed',
        error: 'Connection timeout',
      })
      expect(row.sync_status).toBe('failed')
      expect(row.last_error).toBe('Connection timeout')
    })

    it('should handle webhook configuration', () => {
      const row = toRepositoryRow(baseRepo, baseStats, {
        ...baseSync,
        webhookActive: true,
        webhookId: 'wh-456',
      })
      expect(row.webhook_active).toBe(true)
      expect(row.webhook_id).toBe('wh-456')
    })
  })

  describe('toNamespace / fromNamespace', () => {
    it('should create namespace from source and name', () => {
      expect(toNamespace('github', 'owner/repo')).toBe('github:owner/repo')
      expect(toNamespace('gitlab', 'group/project')).toBe('gitlab:group/project')
    })

    it('should parse namespace back to source and name', () => {
      const { source, fullName } = fromNamespace('github:owner/repo')
      expect(source).toBe('github')
      expect(fullName).toBe('owner/repo')
    })

    it('should default to github when no colon present', () => {
      const { source, fullName } = fromNamespace('owner/repo')
      expect(source).toBe('github')
      expect(fullName).toBe('owner/repo')
    })

    it('should handle namespace with multiple colons', () => {
      const { source, fullName } = fromNamespace('gitlab:group/sub:project')
      expect(source).toBe('gitlab')
      expect(fullName).toBe('group/sub:project')
    })

    it('should roundtrip correctly', () => {
      const ns = toNamespace('bitbucket', 'team/repo')
      const { source, fullName } = fromNamespace(ns)
      expect(source).toBe('bitbucket')
      expect(fullName).toBe('team/repo')
    })
  })
})
