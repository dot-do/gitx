/**
 * @fileoverview Git Blame Command
 *
 * This module implements the `gitx blame` command which shows what revision
 * and author last modified each line of a file. Features include:
 * - Line-by-line attribution to commits and authors
 * - Line range filtering
 * - Rename tracking (-C flag)
 * - Syntax highlighting support via Shiki
 * - Binary file detection
 *
 * @module cli/commands/blame
 *
 * @example
 * // Blame entire file
 * const result = await getBlame(adapter, 'src/index.ts')
 * for (const line of result.lines) {
 *   console.log(formatBlameLine(line))
 * }
 *
 * @example
 * // Blame specific line range
 * const result = await getBlame(adapter, 'src/index.ts', { lineRange: '10,20' })
 */
import type { CommandContext } from '../index';
import type { FSAdapter } from '../fs-adapter';
/**
 * Options for the blame command.
 *
 * @description Configuration options that control blame output and behavior.
 *
 * @property lineRange - Line range to blame (e.g., '10,20' or '10,+5')
 * @property followRenames - Track file across renames (-C flag)
 * @property highlight - Enable syntax highlighting with Shiki
 * @property theme - Shiki theme name for highlighting
 */
export interface BlameOptions {
    /** Line range in format "start,end" or "start,+count" */
    lineRange?: string;
    /** Follow file renames (-C flag) */
    followRenames?: boolean;
    /** Enable syntax highlighting with Shiki */
    highlight?: boolean;
    /** Syntax highlighting theme */
    theme?: string;
}
/**
 * Blame annotation for a single line.
 *
 * @description Contains all attribution information for a single line of code,
 * including the commit that last modified it, author info, and line numbers.
 *
 * @property commitSha - Full 40-character commit SHA
 * @property shortSha - Abbreviated 8-character SHA
 * @property author - Author name
 * @property authorEmail - Author email address
 * @property date - Commit date
 * @property lineNumber - Current line number in file
 * @property originalLineNumber - Line number in the originating commit
 * @property content - Line content
 * @property originalPath - Original file path if file was renamed
 */
export interface BlameLineAnnotation {
    /** Full commit SHA */
    commitSha: string;
    /** Short commit SHA (8 chars) */
    shortSha: string;
    /** Author name */
    author: string;
    /** Author email */
    authorEmail: string;
    /** Commit date */
    date: Date;
    /** Current line number in file */
    lineNumber: number;
    /** Original line number in the commit that introduced this line */
    originalLineNumber: number;
    /** Line content */
    content: string;
    /** Original file path (if different due to rename) */
    originalPath?: string;
}
/**
 * Commit information for binary files.
 *
 * @description For binary files that cannot be blamed line-by-line,
 * this provides file-level commit information.
 */
export interface BlameFileCommit {
    /** Commit SHA */
    sha: string;
    /** Author name */
    author: string;
    /** Commit date */
    date: Date;
}
/**
 * Complete result of a blame operation.
 *
 * @description Contains all blame information for a file, including
 * line annotations, binary file handling, and optional syntax highlighting.
 *
 * @property path - File path that was blamed
 * @property originalPath - Original path if file was renamed
 * @property lines - Array of line annotations
 * @property isBinary - True if file is binary
 * @property message - Message for binary or error cases
 * @property fileCommit - Commit info for binary files
 * @property highlighted - Syntax-highlighted line content
 * @property language - Detected programming language
 * @property theme - Shiki theme used for highlighting
 */
export interface BlameResult {
    /** File path being blamed */
    path: string;
    /** Original file path if renamed */
    originalPath?: string;
    /** Line annotations */
    lines: BlameLineAnnotation[];
    /** Whether file is binary */
    isBinary: boolean;
    /** Message for binary/error cases */
    message?: string;
    /** File-level commit info (for binary files) */
    fileCommit?: BlameFileCommit;
    /** Syntax highlighted lines (if highlight option enabled) */
    highlighted?: string[];
    /** Detected language */
    language?: string;
    /** Theme used for highlighting */
    theme?: string;
}
/**
 * Represents a line range for filtering blame output.
 *
 * @property start - Starting line number (1-indexed)
 * @property end - Ending line number (1-indexed, inclusive)
 */
export interface LineRange {
    /** Starting line number (1-indexed) */
    start: number;
    /** Ending line number (1-indexed, inclusive) */
    end: number;
}
/**
 * Execute the blame command from the CLI.
 *
 * @description Parses command-line arguments and displays blame annotations
 * for the specified file. This is the entry point for the `gitx blame` command.
 *
 * @param ctx - Command context containing cwd, args, options, and output functions
 * @returns Promise that resolves when output is complete
 * @throws {Error} Always throws "Not implemented" - command not yet implemented
 *
 * @example
 * // CLI usage
 * // gitx blame src/index.ts
 * // gitx blame -L 10,20 src/index.ts
 * // gitx blame -C src/renamed-file.ts
 */
export declare function blameCommand(ctx: CommandContext): Promise<void>;
/**
 * Get blame annotations for a file.
 *
 * @description Computes blame annotations for each line of a file by walking
 * the commit history. For each line, identifies the commit and author that
 * last modified it. Supports line range filtering and rename tracking.
 *
 * The algorithm:
 * 1. Gets the current file content at HEAD
 * 2. Initializes all lines as attributed to HEAD
 * 3. Walks backward through commit history
 * 4. Uses LCS (Longest Common Subsequence) to map lines between commits
 * 5. Updates line attribution when a line exists in a parent commit
 *
 * @param adapter - Filesystem adapter for reading git objects
 * @param filePath - Path to the file to blame (relative to repo root)
 * @param options - Blame options for filtering and behavior
 * @returns Promise resolving to blame result with line annotations
 * @throws {Error} If file path contains null character
 * @throws {Error} If HEAD cannot be resolved (empty repository)
 * @throws {Error} If HEAD commit cannot be read
 * @throws {Error} If file does not exist in repository
 * @throws {Error} If line range is invalid (end before start, exceeds file length)
 *
 * @example
 * // Blame entire file
 * const result = await getBlame(adapter, 'src/index.ts')
 * console.log(`File has ${result.lines.length} lines`)
 *
 * @example
 * // Blame specific line range
 * const result = await getBlame(adapter, 'src/index.ts', { lineRange: '10,20' })
 *
 * @example
 * // Blame with rename tracking
 * const result = await getBlame(adapter, 'src/new-name.ts', { followRenames: true })
 * if (result.originalPath) {
 *   console.log(`File was renamed from ${result.originalPath}`)
 * }
 *
 * @example
 * // Handle binary files
 * const result = await getBlame(adapter, 'assets/image.png')
 * if (result.isBinary) {
 *   console.log(result.message) // "binary file - cannot show line-by-line blame"
 *   console.log(`Last modified by: ${result.fileCommit?.author}`)
 * }
 */
export declare function getBlame(adapter: FSAdapter, filePath: string, options?: BlameOptions): Promise<BlameResult>;
/**
 * Format a blame line annotation for display.
 *
 * @description Formats a single blame line in a human-readable format similar
 * to git blame output: `<sha> (<author> <date>) <content>`
 *
 * @param annotation - The blame line annotation to format
 * @param options - Formatting options
 * @param options.showOriginalLineNumber - If true, shows both original and current line numbers
 * @returns Formatted string for display
 *
 * @example
 * const formatted = formatBlameLine(annotation)
 * // Output: "abc12345 (John Doe       2024-01-15) const x = 1"
 *
 * @example
 * // With original line numbers (for renamed files)
 * const formatted = formatBlameLine(annotation, { showOriginalLineNumber: true })
 * // Output: "abc12345 (John Doe       2024-01-15   10   12) const x = 1"
 */
export declare function formatBlameLine(annotation: BlameLineAnnotation, options?: {
    showOriginalLineNumber?: boolean;
}): string;
/**
 * Parse a line range string into start and end values.
 *
 * @description Parses line range specifications used with the -L flag.
 * Supports two formats:
 * - Absolute: "start,end" (e.g., "10,20" for lines 10-20)
 * - Relative: "start,+count" (e.g., "10,+5" for lines 10-15)
 *
 * @param rangeStr - Line range string in "start,end" or "start,+count" format
 * @returns Parsed line range with start and end (1-indexed, inclusive)
 * @throws {Error} If format is invalid (not two comma-separated values)
 * @throws {Error} If start line is not a valid number
 * @throws {Error} If end line or offset is not a valid number
 *
 * @example
 * // Absolute range
 * const range = parseLineRange('10,20')
 * console.log(range) // { start: 10, end: 20 }
 *
 * @example
 * // Relative range
 * const range = parseLineRange('10,+5')
 * console.log(range) // { start: 10, end: 15 }
 */
export declare function parseLineRange(rangeStr: string): LineRange;
//# sourceMappingURL=blame.d.ts.map