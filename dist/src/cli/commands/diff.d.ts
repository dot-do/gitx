/**
 * @fileoverview gitx diff command with Shiki syntax highlighting
 *
 * This module implements the `gitx diff` command which shows changes between
 * commits, the index and working tree, etc. Features include:
 * - Syntax highlighting via Shiki
 * - Staged vs unstaged diff modes
 * - Word-level diff highlighting
 * - Multiple output formats (unified, raw)
 * - Support for commit and branch comparisons
 *
 * @module cli/commands/diff
 *
 * @example
 * // Show unstaged changes
 * await diffCommand({ cwd: '/repo', options: {}, ... })
 *
 * @example
 * // Show staged changes
 * await diffCommand({ cwd: '/repo', options: { staged: true }, ... })
 *
 * @example
 * // Programmatic usage
 * const result = await getUnstagedDiff('/repo')
 * const output = await formatHighlightedDiff(result)
 */
import type { CommandContext } from '../index';
/**
 * Options for the diff command.
 *
 * @description Configuration options that control diff behavior and output format.
 *
 * @property staged - Show staged changes (index vs HEAD)
 * @property cached - Alias for staged
 * @property noColor - Disable syntax highlighting
 * @property context - Number of context lines around changes (default: 3)
 * @property wordDiff - Enable word-level diff highlighting
 * @property format - Output format: 'unified' (default) or 'raw'
 * @property commit - Specific commit to compare against
 */
export interface DiffOptions {
    /** Show staged changes (index vs HEAD) */
    staged?: boolean;
    /** Alias for staged */
    cached?: boolean;
    /** Disable syntax highlighting */
    noColor?: boolean;
    /** Number of context lines */
    context?: number;
    /** Word-level diff highlighting */
    wordDiff?: boolean;
    /** Output format */
    format?: 'unified' | 'raw';
    /** Commit to compare against */
    commit?: string;
}
/**
 * A single file entry in a diff result.
 *
 * @description Represents the diff for a single file, including metadata
 * about the change type and the actual diff hunks.
 *
 * @property path - File path relative to repository root
 * @property oldPath - Original path for renamed files
 * @property status - Change type: 'added', 'modified', 'deleted', 'renamed', 'copied'
 * @property oldMode - Original file mode (e.g., '100644')
 * @property newMode - New file mode
 * @property binary - Whether the file is binary
 * @property oldSha - Original blob SHA
 * @property newSha - New blob SHA
 * @property hunks - Array of diff hunks for this file
 */
export interface DiffEntry {
    /** File path (relative to repo root) */
    path: string;
    /** Old file path (for renames) */
    oldPath?: string;
    /** Change type */
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
    /** Old file mode (e.g., '100644') */
    oldMode?: string;
    /** New file mode */
    newMode?: string;
    /** Is binary file */
    binary?: boolean;
    /** Old blob SHA */
    oldSha?: string;
    /** New blob SHA */
    newSha?: string;
    /** Diff hunks */
    hunks: DiffHunk[];
}
/**
 * A diff hunk representing a contiguous block of changes.
 *
 * @description Contains lines around a change with context lines before
 * and after. Uses standard unified diff format line numbers.
 *
 * @property oldStart - Starting line number in old file
 * @property oldCount - Number of lines from old file
 * @property newStart - Starting line number in new file
 * @property newCount - Number of lines in new file
 * @property header - Optional hunk header (e.g., function name)
 * @property lines - Array of diff lines in this hunk
 */
export interface DiffHunk {
    /** Old file start line */
    oldStart: number;
    /** Old file line count */
    oldCount: number;
    /** New file start line */
    newStart: number;
    /** New file line count */
    newCount: number;
    /** Hunk header (e.g., function name) */
    header?: string;
    /** Lines in this hunk */
    lines: DiffLine[];
}
/**
 * A single line within a diff hunk.
 *
 * @description Represents one line of diff output with its type
 * (context, addition, or deletion) and optional line numbers.
 *
 * @property type - Line type: 'context', 'addition', or 'deletion'
 * @property content - The actual line content
 * @property oldLineNo - Line number in old file (context/deletion)
 * @property newLineNo - Line number in new file (context/addition)
 * @property wordChanges - Optional word-level changes for inline highlighting
 */
export interface DiffLine {
    /** Line type */
    type: 'context' | 'addition' | 'deletion';
    /** Line content */
    content: string;
    /** Old line number (for context and deletion) */
    oldLineNo?: number;
    /** New line number (for context and addition) */
    newLineNo?: number;
    /** Word-level changes within line */
    wordChanges?: WordChange[];
}
/**
 * A word-level change within a line.
 *
 * @description Used for inline/word diff highlighting to show
 * exactly which parts of a line changed.
 *
 * @property type - Change type: 'unchanged', 'added', or 'removed'
 * @property text - The text content of this segment
 */
export interface WordChange {
    /** Change type */
    type: 'unchanged' | 'added' | 'removed';
    /** Text content */
    text: string;
}
/**
 * Complete result of a diff operation.
 *
 * @description Contains all file entries and summary statistics
 * for a diff operation.
 *
 * @property entries - Array of DiffEntry objects for each changed file
 * @property stats - Summary statistics (files changed, insertions, deletions)
 */
export interface DiffResult {
    /** List of file diffs */
    entries: DiffEntry[];
    /** Stats summary */
    stats: {
        /** Number of files changed */
        filesChanged: number;
        /** Total lines added */
        insertions: number;
        /** Total lines removed */
        deletions: number;
    };
}
/**
 * Result of syntax-highlighted diff output.
 *
 * @description Contains the highlighted output lines and a map of detected
 * programming languages for each file in the diff.
 *
 * @property lines - Array of output lines with ANSI color codes
 * @property languages - Map from file path to detected language
 */
export interface HighlightedDiff {
    /** Syntax-highlighted output lines */
    lines: string[];
    /** Language detected for each file */
    languages: Map<string, string>;
}
/**
 * Execute the diff command.
 *
 * @description Main entry point for the diff command. Shows changes between
 * the working tree and the index (unstaged) or between the index and HEAD
 * (staged). Output is syntax-highlighted unless --no-color is specified.
 *
 * @param ctx - Command context with cwd, options, and I/O functions
 *
 * @example
 * // Show unstaged changes
 * await diffCommand({ cwd: '/repo', options: {}, stdout: console.log, stderr: console.error, args: [], rawArgs: [] })
 *
 * @example
 * // Show staged changes
 * await diffCommand({ cwd: '/repo', options: { staged: true }, stdout: console.log, stderr: console.error, args: [], rawArgs: [] })
 */
export declare function diffCommand(ctx: CommandContext): Promise<void>;
/**
 * Get unstaged changes (working tree vs index).
 *
 * @description Compares the working tree against the index (staging area)
 * to find all unstaged modifications. These are changes that have been
 * made but not yet added with `git add`.
 *
 * @param repoPath - Path to the repository root
 * @returns Promise<DiffResult> with entries for each changed file
 *
 * @example
 * const diff = await getUnstagedDiff('/path/to/repo')
 * console.log(`${diff.stats.filesChanged} files changed`)
 * console.log(`+${diff.stats.insertions} -${diff.stats.deletions}`)
 */
export declare function getUnstagedDiff(repoPath: string): Promise<DiffResult>;
/**
 * Get staged changes (index vs HEAD).
 *
 * @description Compares the index (staging area) against HEAD to find
 * all staged changes. These are changes that have been added with
 * `git add` and are ready to be committed.
 *
 * @param repoPath - Path to the repository root
 * @returns Promise<DiffResult> with entries for each staged file
 *
 * @example
 * const diff = await getStagedDiff('/path/to/repo')
 * if (diff.entries.length === 0) {
 *   console.log('No staged changes')
 * }
 */
export declare function getStagedDiff(repoPath: string): Promise<DiffResult>;
/**
 * Get diff between two commits.
 *
 * @description Compares two commits and returns the differences between them.
 * Useful for seeing what changed between any two points in history.
 *
 * @param repoPath - Path to the repository root
 * @param fromCommit - Starting commit SHA or ref
 * @param toCommit - Ending commit SHA or ref
 * @returns Promise<DiffResult> with entries for each changed file
 *
 * @example
 * const diff = await getCommitDiff('/repo', 'HEAD~1', 'HEAD')
 * console.log(`Last commit changed ${diff.stats.filesChanged} files`)
 */
export declare function getCommitDiff(_repoPath: string, _fromCommit: string, _toCommit: string): Promise<DiffResult>;
/**
 * Get diff between two branches.
 *
 * @description Compares two branches and returns the differences. Useful for
 * reviewing changes between feature branches and main.
 *
 * @param repoPath - Path to the repository root
 * @param fromBranch - Base branch name
 * @param toBranch - Target branch name
 * @returns Promise<DiffResult> with entries for each changed file
 *
 * @example
 * const diff = await getBranchDiff('/repo', 'main', 'feature/new-feature')
 * console.log(`Feature branch has ${diff.stats.insertions} new lines`)
 */
export declare function getBranchDiff(_repoPath: string, _fromBranch: string, _toBranch: string): Promise<DiffResult>;
/**
 * Get diff for a specific file path.
 *
 * @description Retrieves the diff for a single file or glob pattern.
 * Can show either staged or unstaged changes.
 *
 * @param repoPath - Path to the repository root
 * @param filePath - File path (relative to repo) or glob pattern
 * @param options - Optional settings for staged mode or commit comparison
 * @param options.staged - Show staged changes for this file
 * @param options.commit - Compare against specific commit
 * @returns Promise<DiffResult> with diff for the specified file(s)
 *
 * @example
 * const diff = await getFileDiff('/repo', 'src/index.ts')
 *
 * @example
 * // Staged changes only
 * const diff = await getFileDiff('/repo', 'src/index.ts', { staged: true })
 */
export declare function getFileDiff(repoPath: string, filePath: string, _options?: {
    staged?: boolean;
    commit?: string;
}): Promise<DiffResult>;
/**
 * Compute unified diff between two content strings.
 *
 * @description Uses the Myers diff algorithm (via LCS) to compute the
 * minimal edit distance between two content strings and returns the
 * result as unified diff hunks.
 *
 * @param oldContent - Original content string
 * @param newContent - New content string
 * @param options - Diff options
 * @param options.context - Number of context lines (default: 3)
 * @returns Array of DiffHunk objects representing the changes
 *
 * @example
 * const hunks = computeUnifiedDiff(
 *   'line1\nline2\nline3',
 *   'line1\nmodified\nline3'
 * )
 */
export declare function computeUnifiedDiff(oldContent: string, newContent: string, options?: {
    context?: number;
}): DiffHunk[];
/**
 * Compute word-level diff within a line.
 *
 * @description Computes fine-grained differences at the word/token level
 * within a single line. Useful for inline highlighting of small changes.
 *
 * @param oldLine - Original line content
 * @param newLine - New line content
 * @returns Array of WordChange objects showing what changed
 *
 * @example
 * const changes = computeWordDiff('const foo = 1', 'const bar = 1')
 * // Returns: [unchanged: 'const ', removed: 'foo', added: 'bar', unchanged: ' = 1']
 */
export declare function computeWordDiff(oldLine: string, newLine: string): WordChange[];
/**
 * Apply Shiki syntax highlighting to diff output.
 *
 * @description Processes a DiffResult and applies syntax highlighting
 * using Shiki. Each file is highlighted according to its detected language.
 * Returns ANSI-colored output suitable for terminal display.
 *
 * @param diff - The diff result to highlight
 * @param options - Optional highlighting options
 * @param options.theme - Shiki theme name (default: 'github-dark')
 * @returns Promise<HighlightedDiff> with highlighted lines and language map
 *
 * @example
 * const diff = await getUnstagedDiff('/repo')
 * const highlighted = await highlightDiff(diff)
 * highlighted.lines.forEach(line => console.log(line))
 */
export declare function highlightDiff(diff: DiffResult, _options?: {
    theme?: string;
}): Promise<HighlightedDiff>;
/**
 * Get language from file extension for Shiki.
 *
 * @description Maps file extensions to Shiki language identifiers for
 * syntax highlighting. Falls back to 'plaintext' for unknown extensions.
 *
 * @param filePath - File path to detect language for
 * @returns Shiki language identifier (e.g., 'typescript', 'python')
 *
 * @example
 * getLanguageFromPath('src/index.ts') // Returns 'typescript'
 * getLanguageFromPath('script.py')    // Returns 'python'
 * getLanguageFromPath('data.xyz')     // Returns 'plaintext'
 */
export declare function getLanguageFromPath(filePath: string): string;
/**
 * Format diff output with syntax highlighting.
 *
 * @description Main formatting function that applies syntax highlighting
 * to diff output. Respects NO_COLOR environment variable and --no-color
 * option for accessibility.
 *
 * @param diff - The diff result to format
 * @param options - Diff options including noColor flag
 * @returns Promise<string[]> array of formatted output lines
 *
 * @example
 * const diff = await getUnstagedDiff('/repo')
 * const lines = await formatHighlightedDiff(diff)
 * lines.forEach(line => console.log(line))
 *
 * @example
 * // Without colors
 * const lines = await formatHighlightedDiff(diff, { noColor: true })
 */
export declare function formatHighlightedDiff(diff: DiffResult, options?: DiffOptions): Promise<string[]>;
/**
 * Format diff as plain text (no highlighting).
 *
 * @description Formats diff output without any ANSI colors or syntax
 * highlighting. Suitable for piping to files or non-terminal output.
 *
 * @param diff - The diff result to format
 * @returns Array of plain text output lines
 *
 * @example
 * const diff = await getUnstagedDiff('/repo')
 * const lines = formatPlainDiff(diff)
 */
export declare function formatPlainDiff(diff: DiffResult): string[];
/**
 * Format diff header for a file entry.
 *
 * @description Generates the git-style diff header lines for a file,
 * including the diff --git line, mode changes, index line, and +++ / --- lines.
 *
 * @param entry - The DiffEntry to generate header for
 * @returns Array of header lines
 *
 * @example
 * const header = formatDiffHeader(entry)
 * // Returns: ['diff --git a/file.ts b/file.ts', '--- a/file.ts', '+++ b/file.ts']
 */
export declare function formatDiffHeader(entry: DiffEntry): string[];
/**
 * Format hunk header.
 *
 * @description Creates the @@ line that starts each diff hunk, showing
 * the line ranges in both old and new files.
 *
 * @param hunk - The DiffHunk to format
 * @returns Formatted hunk header string (e.g., '@@ -1,5 +1,7 @@ function foo')
 *
 * @example
 * formatHunkHeader({ oldStart: 1, oldCount: 5, newStart: 1, newCount: 7 })
 * // Returns: '@@ -1,5 +1,7 @@'
 */
export declare function formatHunkHeader(hunk: DiffHunk): string;
/**
 * Format file mode change indicator.
 *
 * @description Creates a human-readable string showing a file mode change.
 *
 * @param oldMode - Original file mode (e.g., '100644')
 * @param newMode - New file mode (e.g., '100755')
 * @returns Formatted mode change string
 *
 * @example
 * formatModeChange('100644', '100755') // Returns 'mode change 100644 -> 100755'
 */
export declare function formatModeChange(oldMode: string, newMode: string): string;
/**
 * Format binary file indicator.
 *
 * @description Creates a message indicating that a file is binary
 * and cannot be diffed as text.
 *
 * @param filePath - Path to the binary file
 * @returns Formatted binary indicator string
 *
 * @example
 * formatBinaryIndicator('image.png') // Returns 'Binary files differ: image.png'
 */
export declare function formatBinaryIndicator(filePath: string): string;
//# sourceMappingURL=diff.d.ts.map