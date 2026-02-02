/**
 * @fileoverview Git Data to Parquet Converter
 *
 * Converts git repository data (commits, refs, file changes) to
 * Parquet format for analytics with LZ4 compression support.
 *
 * @module export/git-parquet
 */
import { createParquetWriter, ParquetCompression, } from '../tiered/parquet-writer';
import { DEFAULT_ROW_GROUP_SIZE } from '../constants';
import { COMMITS_SCHEMA, REFS_SCHEMA, FILES_SCHEMA, toCommitRow, toRefRow, toFileRow, } from './schemas';
/**
 * Converts a strongly-typed row object to the Record<string, unknown> expected by ParquetWriter.
 *
 * Row types (CommitRow, RefRow, FileRow) have fields that are all subtypes of `unknown`
 * (string, number, boolean, null). This function centralizes the single safe cast
 * rather than scattering `as unknown as Record<string, unknown>` double casts.
 */
function toWritableRow(row) {
    // All row properties are string | number | boolean | null | undefined,
    // which are all valid `unknown` values. This cast is safe.
    return row;
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
    repository;
    options;
    constructor(repository, options = {}) {
        this.repository = repository;
        this.options = {
            compression: options.compression ?? ParquetCompression.LZ4,
            rowGroupSize: options.rowGroupSize ?? DEFAULT_ROW_GROUP_SIZE,
            enableStatistics: options.enableStatistics ?? true,
        };
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
    async exportCommits(commits) {
        const writer = this.createWriter(COMMITS_SCHEMA);
        for (const commit of commits) {
            const row = toCommitRow(commit, this.repository);
            await writer.writeRow(toWritableRow(row));
        }
        return this.finalize(writer);
    }
    /**
     * Exports refs (branches and tags) to Parquet format.
     *
     * @param refs - Array of git refs
     * @param options - Additional options (HEAD, default branch)
     * @returns Export result with Parquet buffer
     */
    async exportRefs(refs, options = {}) {
        const writer = this.createWriter(REFS_SCHEMA);
        const snapshotTime = options.snapshotTime ?? Date.now();
        for (const ref of refs) {
            const row = toRefRow(ref, this.repository, {
                isHead: ref.name === options.headRef,
                isDefault: ref.name === options.defaultBranch,
                snapshotTime,
            });
            await writer.writeRow(toWritableRow(row));
        }
        return this.finalize(writer);
    }
    /**
     * Exports file changes to Parquet format.
     *
     * @param commits - Array of commits with their file changes
     * @returns Export result with Parquet buffer
     */
    async exportFiles(commits) {
        const writer = this.createWriter(FILES_SCHEMA);
        for (const commit of commits) {
            for (const file of commit.files) {
                const row = toFileRow(file, commit.sha, this.repository, commit.date);
                await writer.writeRow(toWritableRow(row));
            }
        }
        return this.finalize(writer);
    }
    // ===========================================================================
    // Streaming Export
    // ===========================================================================
    /**
     * Creates a streaming commit exporter.
     *
     * @returns Streaming exporter with add/finish methods
     */
    createCommitStream() {
        return new StreamingExporter(this.createWriter(COMMITS_SCHEMA), (commit) => toCommitRow(commit, this.repository));
    }
    /**
     * Creates a streaming ref exporter.
     *
     * @param options - Options for ref conversion
     * @returns Streaming exporter with add/finish methods
     */
    createRefStream(options = {}) {
        const snapshotTime = options.snapshotTime ?? Date.now();
        return new StreamingExporter(this.createWriter(REFS_SCHEMA), (ref) => toRefRow(ref, this.repository, {
            isHead: ref.name === options.headRef,
            isDefault: ref.name === options.defaultBranch,
            snapshotTime,
        }));
    }
    /**
     * Creates a streaming file exporter.
     *
     * @returns Streaming exporter with addCommit/finish methods
     */
    createFileStream() {
        return new FileStreamingExporter(this.createWriter(FILES_SCHEMA), this.repository);
    }
    // ===========================================================================
    // Private Methods
    // ===========================================================================
    createWriter(schema) {
        return createParquetWriter(schema, {
            compression: this.options.compression,
            rowGroupSize: this.options.rowGroupSize,
            enableStatistics: this.options.enableStatistics,
        });
    }
    async finalize(writer) {
        const buffer = await writer.toBuffer();
        return {
            buffer,
            rowCount: writer.rowCount,
            rowGroupCount: writer.rowGroupCount,
            compression: this.options.compression,
        };
    }
}
// ============================================================================
// Streaming Exporter
// ============================================================================
/**
 * Streaming exporter for incremental Parquet writing.
 */
export class StreamingExporter {
    writer;
    transform;
    constructor(writer, transform) {
        this.writer = writer;
        this.transform = transform;
    }
    /**
     * Adds a single item to the export.
     */
    async add(input) {
        const row = this.transform(input);
        await this.writer.writeRow(toWritableRow(row));
    }
    /**
     * Adds multiple items to the export.
     */
    async addBatch(inputs) {
        for (const input of inputs) {
            await this.add(input);
        }
    }
    /**
     * Current row count.
     */
    get rowCount() {
        return this.writer.rowCount;
    }
    /**
     * Finishes the export and returns the Parquet buffer.
     */
    async finish() {
        const buffer = await this.writer.toBuffer();
        return {
            buffer,
            rowCount: this.writer.rowCount,
            rowGroupCount: this.writer.rowGroupCount,
            compression: this.writer.options.compression,
        };
    }
}
/**
 * Specialized streaming exporter for file changes.
 */
export class FileStreamingExporter {
    writer;
    repository;
    constructor(writer, repository) {
        this.writer = writer;
        this.repository = repository;
    }
    /**
     * Adds file changes for a commit.
     */
    async addCommit(commitSha, commitDate, files) {
        for (const file of files) {
            const row = toFileRow(file, commitSha, this.repository, commitDate);
            await this.writer.writeRow(toWritableRow(row));
        }
    }
    /**
     * Current row count.
     */
    get rowCount() {
        return this.writer.rowCount;
    }
    /**
     * Finishes the export and returns the Parquet buffer.
     */
    async finish() {
        const buffer = await this.writer.toBuffer();
        return {
            buffer,
            rowCount: this.writer.rowCount,
            rowGroupCount: this.writer.rowGroupCount,
            compression: this.writer.options.compression,
        };
    }
}
// ============================================================================
// Convenience Functions
// ============================================================================
/**
 * Quick export of commits to Parquet.
 */
export async function exportCommitsToParquet(repository, commits, options) {
    const exporter = new GitParquetExporter(repository, options);
    const result = await exporter.exportCommits(commits);
    return result.buffer;
}
/**
 * Quick export of refs to Parquet.
 */
export async function exportRefsToParquet(repository, refs, options) {
    const exporter = new GitParquetExporter(repository, options);
    const result = await exporter.exportRefs(refs, options);
    return result.buffer;
}
//# sourceMappingURL=git-parquet.js.map