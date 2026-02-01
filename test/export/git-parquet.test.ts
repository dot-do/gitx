import { describe, it, expect } from 'vitest'
import {
  GitParquetExporter,
  StreamingExporter,
  FileStreamingExporter,
  exportCommitsToParquet,
  exportRefsToParquet,
  type GitCommitData,
  type GitRefData,
  type GitFileData,
} from '../../src/export/git-parquet'
import { ParquetCompression } from '../../src/tiered/parquet-writer'

// =============================================================================
// Test Data Helpers
// =============================================================================

function makeCommitData(overrides: Partial<GitCommitData> = {}): GitCommitData {
  return {
    sha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    parentShas: ['c'.repeat(40)],
    author: { name: 'Alice', email: 'alice@example.com', date: 1700000000000 },
    committer: { name: 'Bob', email: 'bob@example.com', date: 1700000001000 },
    message: 'feat: add new feature\n\nBody text.',
    ...overrides,
  }
}

function makeRefData(overrides: Partial<GitRefData> = {}): GitRefData {
  return {
    name: 'refs/heads/main',
    targetSha: 'a'.repeat(40),
    ...overrides,
  }
}

function makeFileData(overrides: Partial<GitFileData> = {}): GitFileData {
  return {
    path: 'src/index.ts',
    changeType: 'M',
    linesAdded: 10,
    linesRemoved: 3,
    ...overrides,
  }
}

// =============================================================================
// GitParquetExporter
// =============================================================================

describe('GitParquetExporter', () => {
  describe('constructor', () => {
    it('should create exporter with default options', () => {
      const exporter = new GitParquetExporter('owner/repo')
      expect(exporter).toBeDefined()
    })

    it('should accept custom options', () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
        rowGroupSize: 5000,
        enableStatistics: false,
      })
      expect(exporter).toBeDefined()
    })
  })

  describe('exportCommits', () => {
    it('should export commits to Parquet buffer', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportCommits([makeCommitData()])

      expect(result.buffer).toBeInstanceOf(Uint8Array)
      expect(result.buffer.length).toBeGreaterThan(0)
      expect(result.rowCount).toBe(1)
      expect(result.rowGroupCount).toBe(1)
      expect(result.compression).toBe(ParquetCompression.UNCOMPRESSED)
    })

    it('should export multiple commits', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const commits = Array.from({ length: 5 }, (_, i) =>
        makeCommitData({ sha: `${i}`.padStart(40, '0') })
      )
      const result = await exporter.exportCommits(commits)

      expect(result.rowCount).toBe(5)
    })

    it('should handle empty commit array', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportCommits([])

      expect(result.rowCount).toBe(0)
      expect(result.buffer).toBeInstanceOf(Uint8Array)
    })

    it('should handle merge commits with multiple parents', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportCommits([
        makeCommitData({
          parentShas: ['c'.repeat(40), 'd'.repeat(40)],
          message: 'Merge branch feature into main',
        }),
      ])

      expect(result.rowCount).toBe(1)
    })

    it('should handle root commit with no parents', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportCommits([
        makeCommitData({ parentShas: [] }),
      ])

      expect(result.rowCount).toBe(1)
    })

    it('should produce valid Parquet magic bytes', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportCommits([makeCommitData()])

      // Parquet files start and end with PAR1 magic bytes
      const magic = String.fromCharCode(...result.buffer.slice(0, 4))
      expect(magic).toBe('PAR1')

      const endMagic = String.fromCharCode(...result.buffer.slice(-4))
      expect(endMagic).toBe('PAR1')
    })

    it('should handle Date objects for timestamps', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportCommits([
        makeCommitData({
          author: { name: 'A', email: 'a@a.com', date: new Date('2024-01-15T12:00:00Z') },
          committer: { name: 'B', email: 'b@b.com', date: new Date('2024-01-15T12:00:00Z') },
        }),
      ])

      expect(result.rowCount).toBe(1)
    })
  })

  describe('exportRefs', () => {
    it('should export refs to Parquet buffer', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportRefs([makeRefData()])

      expect(result.buffer).toBeInstanceOf(Uint8Array)
      expect(result.rowCount).toBe(1)
    })

    it('should export mixed branches and tags', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const refs = [
        makeRefData({ name: 'refs/heads/main' }),
        makeRefData({ name: 'refs/heads/develop' }),
        makeRefData({ name: 'refs/tags/v1.0.0', tagMessage: 'Release 1.0' }),
        makeRefData({ name: 'refs/tags/v2.0.0', tagMessage: 'Release 2.0' }),
      ]
      const result = await exporter.exportRefs(refs)

      expect(result.rowCount).toBe(4)
    })

    it('should mark HEAD and default branch', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const refs = [
        makeRefData({ name: 'refs/heads/main' }),
        makeRefData({ name: 'refs/heads/develop' }),
      ]
      const result = await exporter.exportRefs(refs, {
        headRef: 'refs/heads/main',
        defaultBranch: 'refs/heads/main',
      })

      expect(result.rowCount).toBe(2)
    })

    it('should handle empty refs array', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportRefs([])

      expect(result.rowCount).toBe(0)
    })
  })

  describe('exportFiles', () => {
    it('should export file changes to Parquet buffer', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportFiles([
        {
          sha: 'a'.repeat(40),
          date: 1700000000000,
          files: [makeFileData()],
        },
      ])

      expect(result.buffer).toBeInstanceOf(Uint8Array)
      expect(result.rowCount).toBe(1)
    })

    it('should export multiple files per commit', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportFiles([
        {
          sha: 'a'.repeat(40),
          date: 1700000000000,
          files: [
            makeFileData({ path: 'src/a.ts', changeType: 'A' }),
            makeFileData({ path: 'src/b.ts', changeType: 'M' }),
            makeFileData({ path: 'src/c.ts', changeType: 'D' }),
          ],
        },
      ])

      expect(result.rowCount).toBe(3)
    })

    it('should export files across multiple commits', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportFiles([
        {
          sha: 'a'.repeat(40),
          date: 1700000000000,
          files: [makeFileData({ path: 'src/a.ts' })],
        },
        {
          sha: 'b'.repeat(40),
          date: 1700001000000,
          files: [makeFileData({ path: 'src/b.ts' }), makeFileData({ path: 'src/c.ts' })],
        },
      ])

      expect(result.rowCount).toBe(3)
    })

    it('should handle various file change types', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const allTypes: GitFileData[] = [
        makeFileData({ path: 'added.ts', changeType: 'A' }),
        makeFileData({ path: 'modified.ts', changeType: 'M' }),
        makeFileData({ path: 'deleted.ts', changeType: 'D' }),
        makeFileData({ path: 'renamed.ts', changeType: 'R', oldPath: 'old-name.ts', similarity: 90 }),
        makeFileData({ path: 'copied.ts', changeType: 'C', oldPath: 'original.ts' }),
        makeFileData({ path: 'type-changed.ts', changeType: 'T' }),
      ]
      const result = await exporter.exportFiles([
        { sha: 'a'.repeat(40), date: 1700000000000, files: allTypes },
      ])

      expect(result.rowCount).toBe(6)
    })

    it('should handle binary files', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportFiles([
        {
          sha: 'a'.repeat(40),
          date: 1700000000000,
          files: [makeFileData({ path: 'image.png', isBinary: true, changeType: 'A' })],
        },
      ])

      expect(result.rowCount).toBe(1)
    })

    it('should handle empty commits (no file changes)', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportFiles([
        { sha: 'a'.repeat(40), date: 1700000000000, files: [] },
      ])

      expect(result.rowCount).toBe(0)
    })

    it('should handle empty repository (no commits at all)', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const result = await exporter.exportFiles([])

      expect(result.rowCount).toBe(0)
    })
  })

  describe('streaming exports', () => {
    it('should create a commit stream and add items incrementally', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const stream = exporter.createCommitStream()

      await stream.add(makeCommitData({ sha: '1'.padStart(40, '0') }))
      await stream.add(makeCommitData({ sha: '2'.padStart(40, '0') }))

      expect(stream.rowCount).toBe(2)

      const result = await stream.finish()
      expect(result.rowCount).toBe(2)
      expect(result.buffer.length).toBeGreaterThan(0)
    })

    it('should support addBatch on streaming exporter', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const stream = exporter.createCommitStream()

      const commits = Array.from({ length: 10 }, (_, i) =>
        makeCommitData({ sha: `${i}`.padStart(40, '0') })
      )
      await stream.addBatch(commits)

      expect(stream.rowCount).toBe(10)
      const result = await stream.finish()
      expect(result.rowCount).toBe(10)
    })

    it('should create a ref stream', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const stream = exporter.createRefStream({
        headRef: 'refs/heads/main',
        defaultBranch: 'refs/heads/main',
        snapshotTime: 1700000000000,
      })

      await stream.add(makeRefData({ name: 'refs/heads/main' }))
      await stream.add(makeRefData({ name: 'refs/tags/v1.0' }))

      const result = await stream.finish()
      expect(result.rowCount).toBe(2)
    })

    it('should create a file stream and add commits with files', async () => {
      const exporter = new GitParquetExporter('owner/repo', {
        compression: ParquetCompression.UNCOMPRESSED,
      })
      const stream = exporter.createFileStream()

      await stream.addCommit('a'.repeat(40), 1700000000000, [
        makeFileData({ path: 'src/a.ts' }),
        makeFileData({ path: 'src/b.ts' }),
      ])
      await stream.addCommit('b'.repeat(40), 1700001000000, [
        makeFileData({ path: 'src/c.ts' }),
      ])

      expect(stream.rowCount).toBe(3)
      const result = await stream.finish()
      expect(result.rowCount).toBe(3)
    })
  })
})

// =============================================================================
// Convenience Functions
// =============================================================================

describe('Convenience Functions', () => {
  describe('exportCommitsToParquet', () => {
    it('should return a Uint8Array buffer', async () => {
      const buffer = await exportCommitsToParquet(
        'owner/repo',
        [makeCommitData()],
        { compression: ParquetCompression.UNCOMPRESSED }
      )

      expect(buffer).toBeInstanceOf(Uint8Array)
      expect(buffer.length).toBeGreaterThan(0)
    })

    it('should produce valid Parquet format', async () => {
      const buffer = await exportCommitsToParquet(
        'owner/repo',
        [makeCommitData()],
        { compression: ParquetCompression.UNCOMPRESSED }
      )

      const magic = String.fromCharCode(...buffer.slice(0, 4))
      expect(magic).toBe('PAR1')
    })
  })

  describe('exportRefsToParquet', () => {
    it('should return a Uint8Array buffer', async () => {
      const buffer = await exportRefsToParquet(
        'owner/repo',
        [makeRefData()],
        { compression: ParquetCompression.UNCOMPRESSED }
      )

      expect(buffer).toBeInstanceOf(Uint8Array)
      expect(buffer.length).toBeGreaterThan(0)
    })

    it('should accept head and default branch options', async () => {
      const buffer = await exportRefsToParquet(
        'owner/repo',
        [makeRefData({ name: 'refs/heads/main' })],
        {
          compression: ParquetCompression.UNCOMPRESSED,
          headRef: 'refs/heads/main',
          defaultBranch: 'refs/heads/main',
        }
      )

      expect(buffer).toBeInstanceOf(Uint8Array)
    })
  })
})

// =============================================================================
// BigInt Timestamp Handling (commit 9e5c857)
// =============================================================================

describe('BigInt Timestamp Handling', () => {
  it('should handle timestamps as INT64 in Parquet schema', async () => {
    // The TIMESTAMP_MILLIS type maps to INT64 in Parquet, which uses BigInt internally.
    // This verifies the schema defines timestamps correctly for BigInt serialization.
    const schemas = await import('../../src/export/schemas')
    const pqTypes = await import('../../src/tiered/parquet-writer')

    const authorDate = schemas.COMMITS_SCHEMA.fields.find((f: any) => f.name === 'author_date')
    const committerDate = schemas.COMMITS_SCHEMA.fields.find((f: any) => f.name === 'committer_date')

    expect(authorDate?.type).toBe(pqTypes.ParquetFieldType.TIMESTAMP_MILLIS)
    expect(committerDate?.type).toBe(pqTypes.ParquetFieldType.TIMESTAMP_MILLIS)
  })

  it('should correctly serialize recent timestamps to Parquet', async () => {
    const exporter = new GitParquetExporter('owner/repo', {
      compression: ParquetCompression.UNCOMPRESSED,
    })

    // Use a recent timestamp (2024) that requires proper INT64 handling
    const recentTimestamp = 1705312000000 // 2024-01-15
    const result = await exporter.exportCommits([
      makeCommitData({
        author: { name: 'A', email: 'a@a.com', date: recentTimestamp },
        committer: { name: 'B', email: 'b@b.com', date: recentTimestamp },
      }),
    ])

    expect(result.rowCount).toBe(1)
    expect(result.buffer.length).toBeGreaterThan(0)
  })

  it('should handle far-future timestamps without overflow', async () => {
    const exporter = new GitParquetExporter('owner/repo', {
      compression: ParquetCompression.UNCOMPRESSED,
    })

    // Year 2100 timestamp - tests INT64/BigInt handling
    const farFuture = 4102444800000
    const result = await exporter.exportCommits([
      makeCommitData({
        author: { name: 'A', email: 'a@a.com', date: farFuture },
        committer: { name: 'B', email: 'b@b.com', date: farFuture },
      }),
    ])

    expect(result.rowCount).toBe(1)
    expect(result.buffer.length).toBeGreaterThan(0)
  })

  it('should handle epoch zero timestamps', async () => {
    const exporter = new GitParquetExporter('owner/repo', {
      compression: ParquetCompression.UNCOMPRESSED,
    })

    const result = await exporter.exportCommits([
      makeCommitData({
        author: { name: 'A', email: 'a@a.com', date: 0 },
        committer: { name: 'B', email: 'b@b.com', date: 0 },
      }),
    ])

    expect(result.rowCount).toBe(1)
  })

  it('should handle timestamp fields in files schema via commit_date', async () => {
    const exporter = new GitParquetExporter('owner/repo', {
      compression: ParquetCompression.UNCOMPRESSED,
    })

    const result = await exporter.exportFiles([
      {
        sha: 'a'.repeat(40),
        date: 1705312000000,
        files: [makeFileData()],
      },
    ])

    expect(result.rowCount).toBe(1)
  })

  it('should handle timestamp fields in refs schema via snapshot_time and tagger_date', async () => {
    const exporter = new GitParquetExporter('owner/repo', {
      compression: ParquetCompression.UNCOMPRESSED,
    })

    const result = await exporter.exportRefs(
      [
        makeRefData({
          name: 'refs/tags/v1.0',
          tagMessage: 'Release',
          tagger: { name: 'T', email: 't@t.com', date: 1705312000000 },
        }),
      ],
      { snapshotTime: 1705312000000 }
    )

    expect(result.rowCount).toBe(1)
  })
})
