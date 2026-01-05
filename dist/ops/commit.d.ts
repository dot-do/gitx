/**
 * Commit Creation Operations
 *
 * Provides functionality for creating, formatting, and amending git commits.
 * Supports author/committer info, parent handling, GPG signing, and message formatting.
 */
import { Author, CommitObject } from '../types/objects';
import type { BasicObjectStore as ObjectStore } from '../types/storage';
/**
 * Author/Committer information for creating commits
 */
export interface CommitAuthor {
    /** Author's name */
    name: string;
    /** Author's email address */
    email: string;
    /** Unix timestamp in seconds */
    timestamp?: number;
    /** Timezone offset (e.g., '+0000', '-0500', '+0530') */
    timezone?: string;
}
/**
 * GPG signature options for signed commits
 */
export interface SigningOptions {
    /** Whether to sign the commit */
    sign: boolean;
    /** GPG key ID to use for signing (optional, uses default if not specified) */
    keyId?: string;
    /** Callback to perform the actual signing */
    signer?: (data: Uint8Array) => Promise<string>;
}
/**
 * Options for creating a commit
 */
export interface CommitOptions {
    /** Commit message (required) */
    message: string;
    /** Tree SHA for the commit (required) */
    tree: string;
    /** Parent commit SHA(s) - empty array for initial commit, one for normal, multiple for merge */
    parents?: string[];
    /** Author information */
    author?: CommitAuthor;
    /** Committer information (defaults to author if not specified) */
    committer?: CommitAuthor;
    /** GPG signing options */
    signing?: SigningOptions;
    /** Allow creating empty commits (no changes from parent) */
    allowEmpty?: boolean;
    /** Whether this is an amend of a previous commit */
    amend?: boolean;
}
/**
 * Options for amending a commit
 */
export interface AmendOptions {
    /** New commit message (if not provided, keeps the original) */
    message?: string;
    /** New tree SHA (if not provided, keeps the original) */
    tree?: string;
    /** New author info (if not provided, keeps the original) */
    author?: CommitAuthor;
    /** New committer info (defaults to current user with current time) */
    committer?: CommitAuthor;
    /** Whether to reset author timestamp to current time */
    resetAuthorDate?: boolean;
    /** GPG signing options */
    signing?: SigningOptions;
}
/**
 * Options for formatting commit messages
 */
export interface FormatOptions {
    /** Strip leading/trailing whitespace from lines */
    stripWhitespace?: boolean;
    /** Strip comment lines (starting with #) */
    stripComments?: boolean;
    /** Comment character (defaults to '#') */
    commentChar?: string;
    /** Wrap message body at column (0 = no wrap) */
    wrapColumn?: number;
    /** Clean up mode: 'verbatim' | 'whitespace' | 'strip' | 'scissors' | 'default' */
    cleanup?: 'verbatim' | 'whitespace' | 'strip' | 'scissors' | 'default';
}
/**
 * Result of creating a commit
 */
export interface CommitResult {
    /** SHA of the created commit */
    sha: string;
    /** The commit object */
    commit: CommitObject;
    /** Whether the commit was actually created (false if empty and allowEmpty=false) */
    created: boolean;
}
/**
 * ObjectStore interface for commit operations.
 * Re-exported from storage types for convenience.
 */
export type { ObjectStore };
/**
 * Get the current timezone offset string
 *
 * @returns Timezone offset like '+0000' or '-0500'
 */
export declare function getCurrentTimezone(): string;
/**
 * Format a timestamp and timezone as git author/committer format
 *
 * @param timestamp - Unix timestamp in seconds
 * @param timezone - Timezone offset string (e.g., '+0000', '-0500')
 * @returns Formatted string like "1234567890 +0000"
 */
export declare function formatTimestamp(timestamp: number, timezone: string): string;
/**
 * Parse a git timestamp string
 *
 * @param timestampStr - Timestamp string like "1234567890 +0000"
 * @returns Object with timestamp and timezone
 */
export declare function parseTimestamp(timestampStr: string): {
    timestamp: number;
    timezone: string;
};
/**
 * Create an Author object with current timestamp
 *
 * @param name - Author name
 * @param email - Author email
 * @param timezone - Optional timezone (defaults to local timezone)
 * @returns Author object with current timestamp
 */
export declare function createAuthor(name: string, email: string, timezone?: string): Author;
/**
 * Format a commit message according to git conventions
 *
 * @param message - The raw commit message
 * @param options - Formatting options
 * @returns The formatted commit message
 */
export declare function formatCommitMessage(message: string, options?: FormatOptions): string;
/**
 * Parse a commit message into subject and body
 *
 * @param message - The commit message
 * @returns Object with subject (first line) and body (rest)
 */
export declare function parseCommitMessage(message: string): {
    subject: string;
    body: string;
};
/**
 * Validate a commit message format
 *
 * @param message - The commit message to validate
 * @returns Object with valid flag and any error messages
 */
export declare function validateCommitMessage(message: string): {
    valid: boolean;
    errors: string[];
    warnings: string[];
};
/**
 * Check if a commit is signed
 *
 * @param commit - The commit object
 * @returns true if the commit has a GPG signature
 */
export declare function isCommitSigned(commit: CommitObject): boolean;
/**
 * Extract the GPG signature from a signed commit
 *
 * @param commit - The commit object
 * @returns The signature if present, null otherwise
 */
export declare function extractCommitSignature(commit: CommitObject): string | null;
/**
 * Add a GPG signature to a commit
 *
 * @param commit - The unsigned commit object
 * @param signature - The GPG signature
 * @returns The signed commit object
 */
export declare function addSignatureToCommit(commit: CommitObject, signature: string): CommitObject;
/**
 * Check if a commit would be empty (same tree as parent)
 *
 * @param store - The object store for reading objects
 * @param tree - The tree SHA for the new commit
 * @param parent - The parent commit SHA (or null for initial commit)
 * @returns true if the commit would have no changes
 */
export declare function isEmptyCommit(store: ObjectStore, tree: string, parent: string | null): Promise<boolean>;
/**
 * Create a new commit from raw data without storing
 *
 * @param options - Commit creation options
 * @returns The commit object (not stored)
 */
export declare function buildCommitObject(options: CommitOptions): CommitObject;
/**
 * Create a new commit
 *
 * @param store - The object store for reading/writing objects
 * @param options - Commit creation options
 * @returns The created commit result with SHA and commit object
 * @throws Error if required options are missing or invalid
 */
export declare function createCommit(store: ObjectStore, options: CommitOptions): Promise<CommitResult>;
/**
 * Amend an existing commit
 *
 * @param store - The object store for reading/writing objects
 * @param commitSha - SHA of the commit to amend
 * @param options - Amendment options
 * @returns The new commit result (original commit is not modified)
 * @throws Error if the commit doesn't exist or options are invalid
 */
export declare function amendCommit(store: ObjectStore, commitSha: string, options: AmendOptions): Promise<CommitResult>;
//# sourceMappingURL=commit.d.ts.map