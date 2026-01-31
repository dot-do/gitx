/**
 * @fileoverview Git Data to Parquet Converter
 *
 * Converts git repository data (commits, refs, file changes) to
 * Parquet format for analytics with LZ4 compression support.
 *
 * @module export/git-parquet
 */

import {
  createParquetWriter,
  ParquetCompression,
  type ParquetWriter,
  type ParquetSchema,
} from '../tiered/parquet-writer'
import {
  COMMITS_SCHEMA,
  REFS_SCHEMA,
  FILES_SCHEMA,
  toCommitRow,
  toRefRow,
  toFileRow,
  type CommitRow,
  type RefRow,
  type FileChangeType,
} from './schemas'

// ============================================================================
// Types
// ============================================================================

/**
 * Git commit data input format.
 */
export interface GitCommitData {
  sha: string
  treeSha: string
  parentShas: string[]
  author: {
    name: string
    email: string
    date: Date | number
  }
  committer: {
    name: string
    email: string
    date: Date | number
  }
  message: string
  gpgSignature?: string
}

/**
 * Git ref data input format.
 */
export interface GitRefData {
  name: string
  targetSha: string
  upstream?: string
  ahead?: number
  behind?: number
  tagMessage?: string
  tagger?: {
    name: string
    email: string
    date: Date | number
  }
}

/**
 * Git file change data input format.
 */
export interface GitFileData {
  path: string
  oldPath?: string
  changeType: FileChangeType
  isBinary?: boolean
  linesAdded?: number
  linesRemoved?: number
  oldSize?: number
  newSize?: number
  oldBlobSha?: string
  newBlobSha?: string
  oldMode?: string
  newMode?: string
  similarity?: number
}

/**
 * Export options.
 */
export interface GitParquetExportOptions {
  /** Compression algorithm (default: LZ4) */
  compression?: ParquetCompression
  /** Row group size (default: 10000) */
  rowGroupSize?: number
  /** Include column statistics (default: true) */
  enableStatistics?: boolean
}

/**
 * Export result.
 */
export interface GitParquetExportResult {
  /** Parquet file buffer */
  buffer: Uint8Array
  /** Number of rows written */
  rowCount: number
  /** Number of row groups */
  rowGroupCount: number
  /** Compression used */
  compression: ParquetCompression
}

// ============================================================================
// Git Parquet Exporter
// ============================================================================

/**
 * Git data to Parquet exporter.
 *
 * @description
 * Provides methods to export git repository data to Parquet format
 * with LZ4 compression for efficient storage and analytics.
 *
 * @example
 * ```typescript
 * const exporter = new GitParquetExporter('owner/repo', {
 *   compression: ParquetCompression.LZ4,
 * })
 *
 * // Export commits
 * const result = await exporter.exportCommits(commits)
 * await bucket.put('commits.parquet', result.buffer)
 *
 * // Export refs
 * const refsResult = await exporter.exportRefs(refs)
 *
 * // Export file changes
 * const filesResult = await exporter.exportFiles(commits, filesMap)
 * ```
 */
export class GitParquetExporter {
  private repository: string
  private options: Required<GitParquetExportOptions>

  constructor(repository: string, options: GitParquetExportOptions = {}) {
    this.repository = repository
    this.options = {
      compression: options.compression ?? ParquetCompression.LZ4,
      rowGroupSize: options.rowGroupSize ?? 10000,
      enableStatistics: options.enableStatistics ?? true,
    }
  }

  // ===========================================================================
  // Export Methods
  // ===========================================================================

  /**
   * Exports commits to Parquet format.
   *
   * @param commits - Array of git commits
   * @returns Export result with Parquet buffer
   */
  async exportCommits(commits: GitCommitData[]): Promise<GitParquetExportResult> {
    const writer = this.createWriter(COMMITS_SCHEMA)

    for (const commit of commits) {
      const row = toCommitRow(commit, this.repository)
      await writer.writeRow(row as unknown as Record<string, unknown>)
    }

    return this.finalize(writer)
  }

  /**
   * Exports refs (branches and tags) to Parquet format.
   *
   * @param refs - Array of git refs
   * @param options - Additional options (HEAD, default branch)
   * @returns Export result with Parquet buffer
   */
  async exportRefs(
    refs: GitRefData[],
    options: {
      headRef?: string
      defaultBranch?: string
      snapshotTime?: number
    } = {}
  ): Promise<GitParquetExportResult> {
    const writer = this.createWriter(REFS_SCHEMA)
    const snapshotTime = options.snapshotTime ?? Date.now()

    for (const ref of refs) {
      const row = toRefRow(ref, this.repository, {
        isHead: ref.name === options.headRef,
        isDefault: ref.name === options.defaultBranch,
        snapshotTime,
      })
      await writer.writeRow(row as unknown as Record<string, unknown>)
    }

    return this.finalize(writer)
  }

  /**
   * Exports file changes to Parquet format.
   *
   * @param commits - Array of commits with their file changes
   * @returns Export result with Parquet buffer
   */
  async exportFiles(
    commits: Array<{
      sha: string
      date: Date | number
      files: GitFileData[]
    }>
  ): Promise<GitParquetExportResult> {
    const writer = this.createWriter(FILES_SCHEMA)

    for (const commit of commits) {
      for (const file of commit.files) {
        const row = toFileRow(file, commit.sha, this.repository, commit.date)
        await writer.writeRow(row as unknown as Record<string, unknown>)
      }
    }

    return this.finalize(writer)
  }

  // ===========================================================================
  // Streaming Export
  // ===========================================================================

  /**
   * Creates a streaming commit exporter.
   *
   * @returns Streaming exporter with add/finish methods
   */
  createCommitStream(): StreamingExporter<GitCommitData, CommitRow> {
    return new StreamingExporter(
      this.createWriter(COMMITS_SCHEMA),
      (commit) => toCommitRow(commit, this.repository)
    )
  }

  /**
   * Creates a streaming ref exporter.
   *
   * @param options - Options for ref conversion
   * @returns Streaming exporter with add/finish methods
   */
  createRefStream(
    options: {
      headRef?: string
      defaultBranch?: string
      snapshotTime?: number
    } = {}
  ): StreamingExporter<GitRefData, RefRow> {
    const snapshotTime = options.snapshotTime ?? Date.now()
    return new StreamingExporter(
      this.createWriter(REFS_SCHEMA),
      (ref) =>
        toRefRow(ref, this.repository, {
          isHead: ref.name === options.headRef,
          isDefault: ref.name === options.defaultBranch,
          snapshotTime,
        })
    )
  }

  /**
   * Creates a streaming file exporter.
   *
   * @returns Streaming exporter with addCommit/finish methods
   */
  createFileStream(): FileStreamingExporter {
    return new FileStreamingExporter(
      this.createWriter(FILES_SCHEMA),
      this.repository
    )
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private createWriter(schema: ParquetSchema): ParquetWriter {
    return createParquetWriter(schema, {
      compression: this.options.compression,
      rowGroupSize: this.options.rowGroupSize,
      enableStatistics: this.options.enableStatistics,
    })
  }

  private async finalize(writer: ParquetWriter): Promise<GitParquetExportResult> {
    const buffer = await writer.toBuffer()
    return {
      buffer,
      rowCount: writer.rowCount,
      rowGroupCount: writer.rowGroupCount,
      compression: this.options.compression,
    }
  }
}

// ============================================================================
// Streaming Exporter
// ============================================================================

/**
 * Streaming exporter for incremental Parquet writing.
 */
export class StreamingExporter<TInput, TRow> {
  private writer: ParquetWriter
  private transform: (input: TInput) => TRow

  constructor(writer: ParquetWriter, transform: (input: TInput) => TRow) {
    this.writer = writer
    this.transform = transform
  }

  /**
   * Adds a single item to the export.
   */
  async add(input: TInput): Promise<void> {
    const row = this.transform(input)
    await this.writer.writeRow(row as unknown as Record<string, unknown>)
  }

  /**
   * Adds multiple items to the export.
   */
  async addBatch(inputs: TInput[]): Promise<void> {
    for (const input of inputs) {
      await this.add(input)
    }
  }

  /**
   * Current row count.
   */
  get rowCount(): number {
    return this.writer.rowCount
  }

  /**
   * Finishes the export and returns the Parquet buffer.
   */
  async finish(): Promise<GitParquetExportResult> {
    const buffer = await this.writer.toBuffer()
    return {
      buffer,
      rowCount: this.writer.rowCount,
      rowGroupCount: this.writer.rowGroupCount,
      compression: this.writer.options.compression,
    }
  }
}

/**
 * Specialized streaming exporter for file changes.
 */
export class FileStreamingExporter {
  private writer: ParquetWriter
  private repository: string

  constructor(writer: ParquetWriter, repository: string) {
    this.writer = writer
    this.repository = repository
  }

  /**
   * Adds file changes for a commit.
   */
  async addCommit(
    commitSha: string,
    commitDate: Date | number,
    files: GitFileData[]
  ): Promise<void> {
    for (const file of files) {
      const row = toFileRow(file, commitSha, this.repository, commitDate)
      await this.writer.writeRow(row as unknown as Record<string, unknown>)
    }
  }

  /**
   * Current row count.
   */
  get rowCount(): number {
    return this.writer.rowCount
  }

  /**
   * Finishes the export and returns the Parquet buffer.
   */
  async finish(): Promise<GitParquetExportResult> {
    const buffer = await this.writer.toBuffer()
    return {
      buffer,
      rowCount: this.writer.rowCount,
      rowGroupCount: this.writer.rowGroupCount,
      compression: this.writer.options.compression,
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick export of commits to Parquet.
 */
export async function exportCommitsToParquet(
  repository: string,
  commits: GitCommitData[],
  options?: GitParquetExportOptions
): Promise<Uint8Array> {
  const exporter = new GitParquetExporter(repository, options)
  const result = await exporter.exportCommits(commits)
  return result.buffer
}

/**
 * Quick export of refs to Parquet.
 */
export async function exportRefsToParquet(
  repository: string,
  refs: GitRefData[],
  options?: GitParquetExportOptions & {
    headRef?: string
    defaultBranch?: string
  }
): Promise<Uint8Array> {
  const exporter = new GitParquetExporter(repository, options)
  const result = await exporter.exportRefs(refs, options)
  return result.buffer
}
