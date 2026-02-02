/**
 * @fileoverview Git Log Command
 *
 * This module implements the `gitx log` command which shows commit logs
 * with various formatting and filtering options. Features include:
 * - One-line and full format output
 * - Custom format strings (similar to git log --format)
 * - ASCII branch visualization graph
 * - Author, date, and path filtering
 * - Commit limiting
 *
 * @module cli/commands/log
 *
 * @example
 * // Show last 10 commits in one-line format
 * await logCommand({ cwd: '/repo', options: { n: 10, oneline: true }, ... })
 *
 * @example
 * // Programmatic usage
 * const result = await getLog(adapter, { n: 5, author: 'john' })
 * for (const entry of result.entries) {
 *   console.log(formatLogEntry(entry))
 * }
 */
import type { CommandContext } from '../index';
import type { FSAdapter } from '../fs-adapter';
/**
 * Options for the log command.
 *
 * @description Configuration options that control log output format,
 * commit limiting, and filtering.
 *
 * @property n - Maximum number of commits to show
 * @property oneline - Show each commit on a single line
 * @property format - Custom format string with placeholders
 * @property graph - Draw ASCII branch visualization
 * @property all - Show commits from all refs (branches, tags)
 * @property author - Filter by author name or email
 * @property since - Show commits after this date
 * @property until - Show commits before this date
 * @property path - Show only commits affecting this path
 */
export interface LogOptions {
    /** Limit number of commits */
    n?: number;
    /** Show each commit on a single line */
    oneline?: boolean;
    /** Custom format string */
    format?: string;
    /** Draw ASCII branch visualization graph */
    graph?: boolean;
    /** Show all refs (branches, tags) */
    all?: boolean;
    /** Filter by author name/email */
    author?: string;
    /** Filter commits since date */
    since?: string;
    /** Filter commits until date */
    until?: string;
    /** Filter by file path */
    path?: string;
}
/**
 * A single log entry representing a commit.
 *
 * @description Contains all information about a commit including
 * author, committer, message, and parent references.
 *
 * @property sha - Full 40-character commit SHA
 * @property shortSha - Abbreviated 7-character SHA
 * @property author - Author information (name, email, date)
 * @property committer - Committer information (name, email, date)
 * @property message - Full commit message
 * @property parents - Array of parent commit SHAs
 * @property isMerge - True if this is a merge commit (has multiple parents)
 */
export interface LogEntry {
    /** Full 40-character commit SHA */
    sha: string;
    /** Abbreviated 7-character SHA */
    shortSha: string;
    /** Author information */
    author: {
        name: string;
        email: string;
        date: Date;
    };
    /** Committer information */
    committer: {
        name: string;
        email: string;
        date: Date;
    };
    /** Full commit message */
    message: string;
    /** Parent commit SHAs */
    parents: string[];
    /** True if merge commit */
    isMerge: boolean;
}
/**
 * Result of a log query.
 *
 * @description Contains the list of commit entries and indicates
 * whether more commits exist beyond the returned results.
 *
 * @property entries - Array of LogEntry objects
 * @property hasMore - True if more commits exist beyond the limit
 */
export interface LogResult {
    /** Array of commit entries */
    entries: LogEntry[];
    /** True if more commits exist */
    hasMore: boolean;
}
/**
 * Execute the log command.
 *
 * @description Main entry point for the log command. Shows commit history
 * with configurable formatting and filtering options.
 *
 * @param ctx - Command context with cwd, options, and I/O functions
 *
 * @example
 * await logCommand({ cwd: '/repo', options: { n: 10 }, ... })
 */
export declare function logCommand(ctx: CommandContext): Promise<void>;
/**
 * Get log entries from repository.
 *
 * @description Retrieves commit history from the repository, walking the
 * commit graph and applying any specified filters. Supports author filtering,
 * date range filtering, path filtering, and commit limiting.
 *
 * @param adapter - FSAdapter instance for the repository
 * @param options - Log options for filtering and limiting
 * @returns Promise<LogResult> with commit entries and hasMore flag
 *
 * @example
 * const result = await getLog(adapter, { n: 10, author: 'john' })
 * console.log(`Found ${result.entries.length} commits`)
 *
 * @example
 * // Filter by date range
 * const result = await getLog(adapter, {
 *   since: '2024-01-01',
 *   until: '2024-12-31'
 * })
 */
export declare function getLog(adapter: FSAdapter, options?: LogOptions): Promise<LogResult>;
/**
 * Format a log entry for display.
 *
 * @description Formats a LogEntry for terminal output. Supports one-line
 * format (short SHA + subject) or full format (full SHA, author, date,
 * message with indentation).
 *
 * @param entry - The log entry to format
 * @param options - Formatting options (oneline, etc.)
 * @returns Formatted string for display
 *
 * @example
 * // Full format
 * console.log(formatLogEntry(entry))
 * // commit abc1234def...
 * // Author: John Doe <john@example.com.ai>
 * // Date:   Mon Jan 15 10:00:00 2024 +0000
 * //
 * //     Initial commit
 *
 * @example
 * // One-line format
 * console.log(formatLogEntry(entry, { oneline: true }))
 * // abc1234 Initial commit
 */
export declare function formatLogEntry(entry: LogEntry, options?: LogOptions): string;
/**
 * Format log entry with custom format string.
 *
 * @description Formats a LogEntry using a custom format string with
 * placeholders, similar to git log --format. Supports common placeholders:
 * - %H - Full commit hash
 * - %h - Abbreviated commit hash
 * - %an - Author name
 * - %ae - Author email
 * - %ad - Author date
 * - %cn - Committer name
 * - %ce - Committer email
 * - %s - Subject (first line of message)
 * - %b - Body (rest of message)
 * - %P - Parent hashes
 *
 * @param entry - The log entry to format
 * @param formatStr - Format string with placeholders
 * @returns Formatted string with placeholders replaced
 *
 * @example
 * formatWithString(entry, '%h - %s (%an)')
 * // Returns: 'abc1234 - Initial commit (John Doe)'
 */
export declare function formatWithString(entry: LogEntry, formatStr: string): string;
/**
 * Generate ASCII graph for commits.
 *
 * @description Creates ASCII art branch visualization for a list of commits,
 * showing the commit graph structure with '*' for commits and '|' for
 * branch lines.
 *
 * @param entries - Array of log entries to visualize
 * @returns Array of graph lines corresponding to each entry
 *
 * @example
 * const graph = generateGraph(entries)
 * entries.forEach((entry, i) => {
 *   console.log(`${graph[i]} ${entry.shortSha} ${entry.message}`)
 * })
 * // * abc1234 Latest commit
 * // | def5678 Previous commit
 */
export declare function generateGraph(entries: LogEntry[]): string[];
/**
 * Parse date string for --since/--until filters.
 *
 * @description Parses various date formats for filtering commits:
 * - ISO format: '2024-01-15' or '2024-01-15T10:00:00'
 * - Relative: 'yesterday', '3 days ago', '2 weeks ago', '1 month ago'
 *
 * @param dateStr - Date string to parse
 * @returns Parsed Date object
 *
 * @example
 * parseDateFilter('2024-01-15')     // Returns Date for Jan 15, 2024
 * parseDateFilter('yesterday')       // Returns Date for yesterday
 * parseDateFilter('3 days ago')      // Returns Date for 3 days ago
 */
export declare function parseDateFilter(dateStr: string): Date;
//# sourceMappingURL=log.d.ts.map