/**
 * Git Blame Algorithm
 *
 * This module provides functionality for attributing each line of a file
 * to the commit that last modified it.
 */
import { CommitObject, TreeObject } from '../types/objects';
/**
 * Storage interface for blame operations
 */
export interface BlameStorage {
    getCommit(sha: string): Promise<CommitObject | null>;
    getTree(sha: string): Promise<TreeObject | null>;
    getBlob(sha: string): Promise<Uint8Array | null>;
    resolveRef(ref: string): Promise<string | null>;
    getFileAtCommit(sha: string, path: string): Promise<Uint8Array | null>;
    getRenamesInCommit(sha: string): Promise<Map<string, string>>;
    getParentCommit(sha: string): Promise<string | null>;
}
/**
 * Options for blame operations
 */
export interface BlameOptions {
    followRenames?: boolean;
    followSymlinks?: boolean;
    maxCommits?: number;
    reverse?: boolean;
    since?: Date;
    until?: Date;
    ignoreWhitespace?: boolean;
    ignoreRevisions?: string[];
    lineRange?: string;
    useCache?: boolean;
}
/**
 * Information about a single blame line
 */
export interface BlameLineInfo {
    commitSha: string;
    author: string;
    email?: string;
    timestamp: number;
    content: string;
    lineNumber: number;
    originalLineNumber: number;
    originalPath?: string;
}
/**
 * Information about a commit in blame context
 */
export interface BlameCommitInfo {
    sha: string;
    author: string;
    email: string;
    timestamp: number;
    summary: string;
    boundary?: boolean;
}
/**
 * A single entry in blame output
 */
export interface BlameEntry {
    commitSha: string;
    author: string;
    timestamp: number;
    lineNumber: number;
    originalLineNumber: number;
    content: string;
    originalPath?: string;
}
/**
 * Result of a blame operation
 */
export interface BlameResult {
    path: string;
    lines: BlameLineInfo[];
    commits: Map<string, BlameCommitInfo>;
    options?: BlameOptions;
}
/**
 * Format options for blame output
 */
export interface BlameFormatOptions {
    format?: 'default' | 'porcelain';
    showLineNumbers?: boolean;
    showDate?: boolean;
    showEmail?: boolean;
}
/**
 * History entry for tracking content across renames
 */
export interface PathHistoryEntry {
    commit: string;
    path: string;
}
/**
 * Blame history entry for a single line
 */
export interface BlameHistoryEntry {
    commitSha: string;
    content: string;
    lineNumber: number;
    author: string;
    timestamp: number;
}
/**
 * Compute blame for a file at a specific commit
 */
export declare function blame(storage: BlameStorage, path: string, commit: string, options?: BlameOptions): Promise<BlameResult>;
/**
 * Alias for blame - get full file blame
 */
export declare function blameFile(storage: BlameStorage, path: string, commit: string, options?: BlameOptions): Promise<BlameResult>;
/**
 * Get blame information for a specific line
 */
export declare function blameLine(storage: BlameStorage, path: string, lineNumber: number, commit: string, options?: BlameOptions): Promise<BlameLineInfo>;
/**
 * Get blame for a specific line range
 */
export declare function blameRange(storage: BlameStorage, path: string, startLine: number, endLine: number, commit: string, options?: BlameOptions): Promise<BlameResult>;
/**
 * Get blame at a specific historical commit
 */
export declare function getBlameForCommit(storage: BlameStorage, path: string, commit: string, options?: BlameOptions): Promise<BlameResult>;
/**
 * Track content path across renames through history
 */
export declare function trackContentAcrossRenames(storage: BlameStorage, path: string, commit: string, _options?: BlameOptions): Promise<PathHistoryEntry[]>;
/**
 * Detect file renames between two commits
 */
export declare function detectRenames(storage: BlameStorage, fromCommit: string, toCommit: string, options?: {
    threshold?: number;
}): Promise<Map<string, string>>;
/**
 * Build complete blame history for a specific line
 */
export declare function buildBlameHistory(storage: BlameStorage, path: string, lineNumber: number, commit: string, options?: BlameOptions): Promise<BlameHistoryEntry[]>;
/**
 * Format blame result for display
 */
export declare function formatBlame(result: BlameResult, options?: BlameFormatOptions): string;
/**
 * Parse porcelain blame output
 */
export declare function parseBlameOutput(output: string): BlameResult;
//# sourceMappingURL=blame.d.ts.map