/**
 * @fileoverview Commit Creation Operations
 *
 * Provides functionality for creating, formatting, and amending git commits.
 * Supports author/committer info, parent handling, GPG signing, and message formatting.
 *
 * @module ops/commit
 */
import type { GitIdentity } from '../objects/types';
import type { BasicObjectStore } from '../types';
/**
 * Author/Committer information for creating commits.
 * Alias for GitIdentity with optional fields for convenience.
 */
export interface CommitAuthor {
    name: string;
    email: string;
    timestamp?: number;
    timezone?: string;
}
/**
 * Options for GPG signing commits.
 */
export interface SigningOptions {
    sign: boolean;
    keyId?: string;
    signer?: (data: Uint8Array) => Promise<string>;
}
/**
 * Options for creating a new commit.
 */
export interface CommitOptions {
    message: string;
    tree: string;
    parents?: string[];
    author?: CommitAuthor;
    committer?: CommitAuthor;
    signing?: SigningOptions;
    allowEmpty?: boolean;
    amend?: boolean;
}
/**
 * Options for amending an existing commit.
 */
export interface AmendOptions {
    message?: string;
    tree?: string;
    author?: CommitAuthor;
    committer?: CommitAuthor;
    resetAuthorDate?: boolean;
    signing?: SigningOptions;
}
/**
 * Options for formatting commit messages.
 */
export interface FormatOptions {
    stripWhitespace?: boolean;
    stripComments?: boolean;
    commentChar?: string;
    wrapColumn?: number;
    cleanup?: 'verbatim' | 'whitespace' | 'strip' | 'scissors' | 'default';
}
/**
 * Result of creating a commit.
 */
export interface CommitResult {
    sha: string;
    commit: CommitObject;
    created: boolean;
}
/**
 * Commit object structure
 */
export interface CommitObject {
    type: 'commit';
    data: Uint8Array;
    tree: string;
    parents: string[];
    author: GitIdentity;
    committer: GitIdentity;
    message: string;
}
/**
 * ObjectStore interface for commit operations.
 */
export interface ObjectStore extends BasicObjectStore {
    getObject(sha: string): Promise<{
        type: string;
        data: Uint8Array;
    } | null>;
    storeObject(type: string, data: Uint8Array): Promise<string>;
}
/**
 * Gets the current timezone offset string.
 */
export declare function getCurrentTimezone(): string;
/**
 * Formats a timestamp and timezone as git author/committer format.
 */
export declare function formatTimestamp(timestamp: number, timezone: string): string;
/**
 * Parses a git timestamp string.
 */
export declare function parseTimestamp(timestampStr: string): {
    timestamp: number;
    timezone: string;
};
/**
 * Creates an Author object with current timestamp.
 */
export declare function createAuthor(name: string, email: string, timezone?: string): GitIdentity;
/**
 * Formats a commit message according to git conventions.
 */
export declare function formatCommitMessage(message: string, options?: FormatOptions): string;
/**
 * Parses a commit message into subject and body.
 */
export declare function parseCommitMessage(message: string): {
    subject: string;
    body: string;
};
/**
 * Validates a commit message format.
 */
export declare function validateCommitMessage(message: string): {
    valid: boolean;
    errors: string[];
    warnings: string[];
};
/**
 * Checks if a commit is signed.
 */
export declare function isCommitSigned(commit: CommitObject): boolean;
/**
 * Extracts the GPG signature from a signed commit.
 */
export declare function extractCommitSignature(commit: CommitObject): string | null;
/**
 * Adds a GPG signature to a commit.
 */
export declare function addSignatureToCommit(commit: CommitObject, signature: string): CommitObject;
/**
 * Checks if a commit would be empty (same tree as parent).
 */
export declare function isEmptyCommit(store: ObjectStore, tree: string, parent: string | null): Promise<boolean>;
/**
 * Builds a commit object from options without storing it.
 */
export declare function buildCommitObject(options: CommitOptions): CommitObject;
/**
 * Creates a new commit.
 */
export declare function createCommit(store: ObjectStore, options: CommitOptions): Promise<CommitResult>;
/**
 * Amends an existing commit.
 */
export declare function amendCommit(store: ObjectStore, commitSha: string, options: AmendOptions): Promise<CommitResult>;
//# sourceMappingURL=commit.d.ts.map