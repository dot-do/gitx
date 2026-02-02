/**
 * @fileoverview Git Data to Parquet Converter
 *
 * Converts git repository data (commits, refs, file changes) to
 * Parquet format for analytics with LZ4 compression support.
 *
 * @module export/git-parquet
 */
import { ParquetCompression, type ParquetWriter } from '../tiered/parquet-writer';
import { type CommitRow, type RefRow, type FileRow, type FileChangeType } from './schemas';
/**
 * A row type compatible with the Parquet writer's `writeRow(row: Record<string, unknown>)`.
 *
 * Row types like CommitRow, RefRow, FileRow have strongly-typed fields
 * (string, number, boolean, null) which are all valid `unknown` values.
 * This type documents the contract expected by the Parquet writer.
 */
export type ParquetWritableRow = {
    [key: string]: string | number | boolean | bigint | null | undefined;
};
/**
 * Git commit data input format.
 */
export interface GitCommitData {
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
}
/**
 * Git ref data input format.
 */
export interface GitRefData {
    name: string;
    targetSha: string;
    upstream?: string;
    ahead?: number;
    behind?: number;
    tagMessage?: string;
    tagger?: {
        name: string;
        email: string;
        date: Date | number;
    };
}
/**
 * Git file change data input format.
 */
export interface GitFileData {
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
}
/**
 * Export options.
 */
export interface GitParquetExportOptions {
    /** Compression algorithm (default: LZ4) */
    compression?: ParquetCompression;
    /** Row group size (default: 10000) */
    rowGroupSize?: number;
    /** Include column statistics (default: true) */
    enableStatistics?: boolean;
}
/**
 * Export result.
 */
export interface GitParquetExportResult {
    /** Parquet file buffer */
    buffer: Uint8Array;
    /** Number of rows written */
    rowCount: number;
    /** Number of row groups */
    rowGroupCount: number;
    /** Compression used */
    compression: ParquetCompression;
}
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
export declare class GitParquetExporter {
    private repository;
    private options;
    constructor(repository: string, options?: GitParquetExportOptions);
    /**
     * Exports commits to Parquet format.
     *
     * @param commits - Array of git commits
     * @returns Export result with Parquet buffer
     */
    exportCommits(commits: GitCommitData[]): Promise<GitParquetExportResult>;
    /**
     * Exports refs (branches and tags) to Parquet format.
     *
     * @param refs - Array of git refs
     * @param options - Additional options (HEAD, default branch)
     * @returns Export result with Parquet buffer
     */
    exportRefs(refs: GitRefData[], options?: {
        headRef?: string;
        defaultBranch?: string;
        snapshotTime?: number;
    }): Promise<GitParquetExportResult>;
    /**
     * Exports file changes to Parquet format.
     *
     * @param commits - Array of commits with their file changes
     * @returns Export result with Parquet buffer
     */
    exportFiles(commits: Array<{
        sha: string;
        date: Date | number;
        files: GitFileData[];
    }>): Promise<GitParquetExportResult>;
    /**
     * Creates a streaming commit exporter.
     *
     * @returns Streaming exporter with add/finish methods
     */
    createCommitStream(): StreamingExporter<GitCommitData, CommitRow>;
    /**
     * Creates a streaming ref exporter.
     *
     * @param options - Options for ref conversion
     * @returns Streaming exporter with add/finish methods
     */
    createRefStream(options?: {
        headRef?: string;
        defaultBranch?: string;
        snapshotTime?: number;
    }): StreamingExporter<GitRefData, RefRow>;
    /**
     * Creates a streaming file exporter.
     *
     * @returns Streaming exporter with addCommit/finish methods
     */
    createFileStream(): FileStreamingExporter;
    private createWriter;
    private finalize;
}
/**
 * Streaming exporter for incremental Parquet writing.
 */
export declare class StreamingExporter<TInput, TRow extends CommitRow | RefRow | FileRow> {
    private writer;
    private transform;
    constructor(writer: ParquetWriter, transform: (input: TInput) => TRow);
    /**
     * Adds a single item to the export.
     */
    add(input: TInput): Promise<void>;
    /**
     * Adds multiple items to the export.
     */
    addBatch(inputs: TInput[]): Promise<void>;
    /**
     * Current row count.
     */
    get rowCount(): number;
    /**
     * Finishes the export and returns the Parquet buffer.
     */
    finish(): Promise<GitParquetExportResult>;
}
/**
 * Specialized streaming exporter for file changes.
 */
export declare class FileStreamingExporter {
    private writer;
    private repository;
    constructor(writer: ParquetWriter, repository: string);
    /**
     * Adds file changes for a commit.
     */
    addCommit(commitSha: string, commitDate: Date | number, files: GitFileData[]): Promise<void>;
    /**
     * Current row count.
     */
    get rowCount(): number;
    /**
     * Finishes the export and returns the Parquet buffer.
     */
    finish(): Promise<GitParquetExportResult>;
}
/**
 * Quick export of commits to Parquet.
 */
export declare function exportCommitsToParquet(repository: string, commits: GitCommitData[], options?: GitParquetExportOptions): Promise<Uint8Array>;
/**
 * Quick export of refs to Parquet.
 */
export declare function exportRefsToParquet(repository: string, refs: GitRefData[], options?: GitParquetExportOptions & {
    headRef?: string;
    defaultBranch?: string;
}): Promise<Uint8Array>;
//# sourceMappingURL=git-parquet.d.ts.map