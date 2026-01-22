/**
 * @fileoverview Git Blame Algorithm
 *
 * This module provides functionality for attributing each line of a file
 * to the commit that last modified it. It implements a blame algorithm
 * similar to Git's native blame command.
 *
 * ## Features
 *
 * - Line-by-line commit attribution
 * - Rename tracking across commits
 * - Line range filtering
 * - Whitespace-insensitive comparison
 * - Date range filtering
 * - Commit exclusion (ignore revisions)
 * - Binary file detection
 * - Porcelain and human-readable output formats
 *
 * ## Usage Example
 *
 * ```typescript
 * import { blame, formatBlame } from './ops/blame'
 *
 * // Get blame information for a file
 * const result = await blame(storage, 'src/main.ts', 'HEAD', {
 *   followRenames: true,
 *   ignoreWhitespace: true
 * })
 *
 * // Format for display
 * const output = formatBlame(result, { showLineNumbers: true })
 * console.log(output)
 * ```
 *
 * @module ops/blame
 */
import { CommitObject, TreeObject } from '../types/objects';
/**
 * Storage interface for blame operations.
 *
 * Provides the necessary methods for accessing Git objects and
 * tracking file renames during blame traversal.
 *
 * @interface BlameStorage
 */
export interface BlameStorage {
    /**
     * Retrieves a commit object by its SHA.
     * @param sha - The 40-character hexadecimal commit SHA
     * @returns The commit object, or null if not found
     */
    getCommit(sha: string): Promise<CommitObject | null>;
    /**
     * Retrieves a tree object by its SHA.
     * @param sha - The 40-character hexadecimal tree SHA
     * @returns The tree object, or null if not found
     */
    getTree(sha: string): Promise<TreeObject | null>;
    /**
     * Retrieves blob content by its SHA.
     * @param sha - The 40-character hexadecimal blob SHA
     * @returns The blob content as bytes, or null if not found
     */
    getBlob(sha: string): Promise<Uint8Array | null>;
    /**
     * Resolves a reference name to its SHA.
     * @param ref - The reference name (e.g., 'HEAD', 'refs/heads/main')
     * @returns The resolved SHA, or null if ref doesn't exist
     */
    resolveRef(ref: string): Promise<string | null>;
    /**
     * Retrieves file content at a specific commit.
     * @param sha - The tree SHA to search in
     * @param path - The file path relative to the tree root
     * @returns The file content as bytes, or null if not found
     */
    getFileAtCommit(sha: string, path: string): Promise<Uint8Array | null>;
    /**
     * Gets rename mappings for a specific commit.
     * @param sha - The commit SHA to check for renames
     * @returns Map of old paths to new paths for renames in this commit
     */
    getRenamesInCommit(sha: string): Promise<Map<string, string>>;
    /**
     * Gets the first parent of a commit.
     * @param sha - The commit SHA
     * @returns The parent SHA, or null if this is the root commit
     */
    getParentCommit(sha: string): Promise<string | null>;
}
/**
 * Options for controlling blame operation behavior.
 *
 * @interface BlameOptions
 *
 * @example
 * ```typescript
 * const options: BlameOptions = {
 *   followRenames: true,
 *   maxCommits: 1000,
 *   ignoreWhitespace: true,
 *   lineRange: '10,20'
 * }
 * ```
 */
export interface BlameOptions {
    /**
     * Whether to track file renames through history.
     * When true, blame will follow the file even if it was renamed.
     * @default false
     */
    followRenames?: boolean;
    /**
     * Whether to follow symbolic links.
     * @default false
     */
    followSymlinks?: boolean;
    /**
     * Maximum number of commits to traverse.
     * Useful for limiting blame on files with long histories.
     * @default Infinity
     */
    maxCommits?: number;
    /**
     * Reverse blame direction - show which commit introduced removal.
     * @default false
     */
    reverse?: boolean;
    /**
     * Only consider commits after this date.
     */
    since?: Date;
    /**
     * Only consider commits before this date.
     */
    until?: Date;
    /**
     * Ignore whitespace changes when comparing lines.
     * @default false
     */
    ignoreWhitespace?: boolean;
    /**
     * List of commit SHAs to skip during blame traversal.
     * Useful for ignoring bulk formatting commits.
     */
    ignoreRevisions?: string[];
    /**
     * Line range specification (git-style -L option).
     * Formats: "start,end", "start,+offset", or "/pattern1/,/pattern2/"
     *
     * @example
     * - "10,20" - lines 10 through 20
     * - "10,+5" - lines 10 through 15
     * - "/^function/,/^}/" - from pattern match to pattern match
     */
    lineRange?: string;
    /**
     * Whether to use caching for performance.
     * @default true
     */
    useCache?: boolean;
}
/**
 * Information about a single blamed line.
 *
 * Contains all attribution data for a specific line in the file,
 * including the commit that last modified it.
 *
 * @interface BlameLineInfo
 */
export interface BlameLineInfo {
    /** SHA of the commit that last modified this line */
    commitSha: string;
    /** Name of the author who made the change */
    author: string;
    /** Email of the author (optional for compatibility) */
    email?: string;
    /** Unix timestamp of the commit in seconds */
    timestamp: number;
    /** The actual text content of the line */
    content: string;
    /** Current line number in the file (1-indexed) */
    lineNumber: number;
    /** Original line number when the line was introduced (1-indexed) */
    originalLineNumber: number;
    /** Original file path if the file was renamed */
    originalPath?: string;
}
/**
 * Commit information in the context of blame results.
 *
 * Provides summary information about commits that appear in blame output.
 *
 * @interface BlameCommitInfo
 */
export interface BlameCommitInfo {
    /** The commit SHA */
    sha: string;
    /** Author name */
    author: string;
    /** Author email */
    email: string;
    /** Unix timestamp in seconds */
    timestamp: number;
    /** First line of the commit message */
    summary: string;
    /** Whether this commit is a boundary (has no parent) */
    boundary?: boolean;
}
/**
 * A single entry in blame output (simplified format).
 *
 * @interface BlameEntry
 */
export interface BlameEntry {
    /** SHA of the commit */
    commitSha: string;
    /** Author name */
    author: string;
    /** Unix timestamp in seconds */
    timestamp: number;
    /** Current line number (1-indexed) */
    lineNumber: number;
    /** Original line number when introduced (1-indexed) */
    originalLineNumber: number;
    /** Line content */
    content: string;
    /** Original path if file was renamed */
    originalPath?: string;
}
/**
 * Complete result of a blame operation.
 *
 * @interface BlameResult
 *
 * @example
 * ```typescript
 * const result = await blame(storage, 'file.ts', 'HEAD')
 *
 * // Access individual lines
 * for (const line of result.lines) {
 *   console.log(`${line.commitSha.slice(0,8)} ${line.author}: ${line.content}`)
 * }
 *
 * // Look up commit details
 * const commitInfo = result.commits.get(result.lines[0].commitSha)
 * ```
 */
export interface BlameResult {
    /** The file path that was blamed */
    path: string;
    /** Array of blame information for each line */
    lines: BlameLineInfo[];
    /** Map of commit SHA to commit information */
    commits: Map<string, BlameCommitInfo>;
    /** Options used for this blame operation */
    options?: BlameOptions;
}
/**
 * Options for formatting blame output.
 *
 * @interface BlameFormatOptions
 */
export interface BlameFormatOptions {
    /**
     * Output format style.
     * - 'default': Human-readable format
     * - 'porcelain': Machine-parseable format
     * @default 'default'
     */
    format?: 'default' | 'porcelain';
    /**
     * Whether to show line numbers.
     * @default false
     */
    showLineNumbers?: boolean;
    /**
     * Whether to show commit dates.
     * @default false
     */
    showDate?: boolean;
    /**
     * Whether to show email instead of author name.
     * @default false
     */
    showEmail?: boolean;
}
/**
 * Entry tracking file path through rename history.
 *
 * @interface PathHistoryEntry
 */
export interface PathHistoryEntry {
    /** Commit SHA at this point in history */
    commit: string;
    /** File path at this point in history */
    path: string;
}
/**
 * Blame history entry for tracking a single line through history.
 *
 * @interface BlameHistoryEntry
 */
export interface BlameHistoryEntry {
    /** Commit SHA where this version appeared */
    commitSha: string;
    /** Line content at this version */
    content: string;
    /** Line number at this version */
    lineNumber: number;
    /** Author of this version */
    author: string;
    /** Timestamp of this version */
    timestamp: number;
}
/**
 * Computes blame for a file at a specific commit.
 *
 * Traverses commit history to attribute each line of the file to the
 * commit that last modified it. Supports various options for filtering
 * and tracking behavior.
 *
 * @description
 * The blame algorithm works by:
 * 1. Starting at the specified commit and getting the file content
 * 2. Initially attributing all lines to the starting commit
 * 3. Walking backwards through commit history
 * 4. For each parent commit, computing line mappings using LCS
 * 5. Re-attributing lines that exist unchanged in the parent
 * 6. Continuing until all lines are attributed or history is exhausted
 *
 * @param storage - The storage interface for accessing Git objects
 * @param path - The file path to blame
 * @param commit - The commit SHA to start from
 * @param options - Optional blame configuration
 * @returns The blame result with line attributions
 *
 * @throws {Error} If the commit is not found
 * @throws {Error} If the file is not found at the specified commit
 * @throws {Error} If the file is binary
 *
 * @example
 * ```typescript
 * // Basic blame
 * const result = await blame(storage, 'src/main.ts', 'abc123')
 *
 * // Blame with options
 * const result = await blame(storage, 'README.md', 'HEAD', {
 *   followRenames: true,
 *   maxCommits: 500,
 *   ignoreWhitespace: true
 * })
 *
 * // Blame specific line range
 * const result = await blame(storage, 'config.json', 'main', {
 *   lineRange: '10,20'
 * })
 * ```
 */
export declare function blame(storage: BlameStorage, path: string, commit: string, options?: BlameOptions): Promise<BlameResult>;
/**
 * Alias for blame - get full file blame.
 *
 * This function is identical to `blame` and exists for API compatibility.
 *
 * @param storage - The storage interface
 * @param path - The file path to blame
 * @param commit - The commit SHA to start from
 * @param options - Optional blame configuration
 * @returns The blame result
 *
 * @see {@link blame} for full documentation
 */
export declare function blameFile(storage: BlameStorage, path: string, commit: string, options?: BlameOptions): Promise<BlameResult>;
/**
 * Gets blame information for a specific line.
 *
 * Convenience function that performs a full blame and extracts
 * the information for a single line.
 *
 * @param storage - The storage interface
 * @param path - The file path
 * @param lineNumber - The line number (1-indexed)
 * @param commit - The commit SHA
 * @param options - Optional blame configuration
 * @returns Blame information for the specified line
 *
 * @throws {Error} If lineNumber is less than 1
 * @throws {Error} If lineNumber exceeds file length
 *
 * @example
 * ```typescript
 * const lineInfo = await blameLine(storage, 'src/main.ts', 42, 'HEAD')
 * console.log(`Line 42 was last modified by ${lineInfo.author}`)
 * ```
 */
export declare function blameLine(storage: BlameStorage, path: string, lineNumber: number, commit: string, options?: BlameOptions): Promise<BlameLineInfo>;
/**
 * Gets blame for a specific line range.
 *
 * More efficient than using the lineRange option when you know
 * the exact numeric range you want.
 *
 * @param storage - The storage interface
 * @param path - The file path
 * @param startLine - Starting line number (1-indexed, inclusive)
 * @param endLine - Ending line number (1-indexed, inclusive)
 * @param commit - The commit SHA
 * @param options - Optional blame configuration
 * @returns Blame result for the specified range
 *
 * @throws {Error} If startLine is less than 1
 * @throws {Error} If endLine is less than startLine
 * @throws {Error} If endLine exceeds file length
 *
 * @example
 * ```typescript
 * // Get blame for lines 10-20
 * const result = await blameRange(storage, 'file.ts', 10, 20, 'HEAD')
 * ```
 */
export declare function blameRange(storage: BlameStorage, path: string, startLine: number, endLine: number, commit: string, options?: BlameOptions): Promise<BlameResult>;
/**
 * Gets blame at a specific historical commit.
 *
 * Alias for `blame` - provided for semantic clarity when you want
 * to emphasize you're looking at a specific point in history.
 *
 * @param storage - The storage interface
 * @param path - The file path
 * @param commit - The commit SHA
 * @param options - Optional blame configuration
 * @returns The blame result
 *
 * @see {@link blame} for full documentation
 */
export declare function getBlameForCommit(storage: BlameStorage, path: string, commit: string, options?: BlameOptions): Promise<BlameResult>;
/**
 * Tracks file path across renames through history.
 *
 * Walks through commit history and records each path the file
 * had at different points in time.
 *
 * @param storage - The storage interface
 * @param path - Current file path
 * @param commit - Starting commit SHA
 * @param _options - Unused options parameter (reserved for future use)
 * @returns Array of path history entries, newest first
 *
 * @example
 * ```typescript
 * const history = await trackContentAcrossRenames(storage, 'src/new-name.ts', 'HEAD')
 * // history might contain:
 * // [
 * //   { commit: 'abc123', path: 'src/new-name.ts' },
 * //   { commit: 'def456', path: 'src/old-name.ts' }
 * // ]
 * ```
 */
export declare function trackContentAcrossRenames(storage: BlameStorage, path: string, commit: string, _options?: BlameOptions): Promise<PathHistoryEntry[]>;
/**
 * Detects file renames between two commits.
 *
 * Compares two commits to find files that were renamed based on
 * SHA matching (exact renames) and content similarity (renames with modifications).
 *
 * @param storage - The storage interface
 * @param fromCommit - The older commit SHA
 * @param toCommit - The newer commit SHA
 * @param options - Configuration options
 * @param options.threshold - Similarity threshold (0-1) for content-based detection
 * @returns Map of old paths to new paths for detected renames
 *
 * @example
 * ```typescript
 * const renames = await detectRenames(storage, 'abc123', 'def456', {
 *   threshold: 0.5
 * })
 *
 * for (const [oldPath, newPath] of renames) {
 *   console.log(`${oldPath} -> ${newPath}`)
 * }
 * ```
 */
export declare function detectRenames(storage: BlameStorage, fromCommit: string, toCommit: string, options?: {
    threshold?: number;
}): Promise<Map<string, string>>;
/**
 * Builds complete blame history for a specific line.
 *
 * Tracks a single line through history, recording its content
 * at each commit where it existed.
 *
 * @param storage - The storage interface
 * @param path - The file path
 * @param lineNumber - The line number to track (1-indexed)
 * @param commit - Starting commit SHA
 * @param options - Optional blame configuration
 * @returns Array of history entries, newest first
 *
 * @example
 * ```typescript
 * const history = await buildBlameHistory(storage, 'main.ts', 10, 'HEAD')
 *
 * for (const entry of history) {
 *   console.log(`${entry.commitSha}: ${entry.content}`)
 * }
 * ```
 */
export declare function buildBlameHistory(storage: BlameStorage, path: string, lineNumber: number, commit: string, options?: BlameOptions): Promise<BlameHistoryEntry[]>;
/**
 * Formats blame result for display.
 *
 * Converts a BlameResult into a human-readable or machine-parseable string format.
 *
 * @param result - The blame result to format
 * @param options - Formatting options
 * @returns Formatted string output
 *
 * @example
 * ```typescript
 * const result = await blame(storage, 'main.ts', 'HEAD')
 *
 * // Human-readable format
 * const output = formatBlame(result, {
 *   showLineNumbers: true,
 *   showDate: true
 * })
 *
 * // Machine-readable format
 * const porcelain = formatBlame(result, { format: 'porcelain' })
 * ```
 */
export declare function formatBlame(result: BlameResult, options?: BlameFormatOptions): string;
/**
 * Parses porcelain blame output back into a BlameResult.
 *
 * Useful for consuming blame output from external sources or
 * for round-trip serialization.
 *
 * @param output - Porcelain format blame output string
 * @returns Parsed blame result
 *
 * @example
 * ```typescript
 * const porcelainOutput = formatBlame(result, { format: 'porcelain' })
 * const parsed = parseBlameOutput(porcelainOutput)
 * ```
 */
export declare function parseBlameOutput(output: string): BlameResult;
//# sourceMappingURL=blame.d.ts.map