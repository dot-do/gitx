/**
 * @fileoverview Commit Creation Operations
 *
 * Provides functionality for creating, formatting, and amending git commits.
 * Supports author/committer info, parent handling, GPG signing, and message formatting.
 *
 * ## Features
 *
 * - Create new commits with full metadata
 * - Amend existing commits
 * - GPG signature support
 * - Message formatting and validation
 * - Empty commit detection
 * - Author/committer timestamp handling
 *
 * ## Usage Example
 *
 * ```typescript
 * import { createCommit, formatCommitMessage } from './ops/commit'
 *
 * // Create a commit
 * const result = await createCommit(store, {
 *   message: 'Add new feature',
 *   tree: treeHash,
 *   parents: [parentHash],
 *   author: { name: 'John Doe', email: 'john@example.com.ai' }
 * })
 *
 * console.log('Created commit:', result.sha)
 * ```
 *
 * @module ops/commit
 */
import { Author, CommitObject } from '../types/objects';
import type { BasicObjectStore as ObjectStore } from '../types/storage';
/**
 * Author/Committer information for creating commits.
 *
 * Represents the identity and timestamp for a commit author or committer.
 * Timestamp and timezone are optional and will be auto-filled if not provided.
 *
 * @interface CommitAuthor
 *
 * @example
 * ```typescript
 * const author: CommitAuthor = {
 *   name: 'Jane Developer',
 *   email: 'jane@example.com.ai',
 *   timestamp: Math.floor(Date.now() / 1000),
 *   timezone: '-0800'
 * }
 * ```
 */
export interface CommitAuthor {
    /** Author's display name */
    name: string;
    /** Author's email address */
    email: string;
    /**
     * Unix timestamp in seconds.
     * If not provided, current time will be used.
     */
    timestamp?: number;
    /**
     * Timezone offset string (e.g., '+0000', '-0500', '+0530').
     * If not provided, local timezone will be used.
     */
    timezone?: string;
}
/**
 * Options for GPG signing commits.
 *
 * @interface SigningOptions
 */
export interface SigningOptions {
    /**
     * Whether to sign the commit.
     * Must be true for signing to occur.
     */
    sign: boolean;
    /**
     * GPG key ID to use for signing.
     * If not specified, the default key will be used.
     */
    keyId?: string;
    /**
     * Callback function that performs the actual signing.
     * Receives the commit data and should return the signature string.
     *
     * @param data - The commit data to sign
     * @returns Promise resolving to the signature string
     */
    signer?: (data: Uint8Array) => Promise<string>;
}
/**
 * Options for creating a new commit.
 *
 * @interface CommitOptions
 *
 * @example
 * ```typescript
 * const options: CommitOptions = {
 *   message: 'Fix critical bug\n\nThis fixes issue #123',
 *   tree: 'abc123...', // 40-char SHA
 *   parents: ['def456...'],
 *   author: {
 *     name: 'Developer',
 *     email: 'dev@example.com.ai'
 *   },
 *   allowEmpty: false
 * }
 * ```
 */
export interface CommitOptions {
    /**
     * The commit message (required).
     * Should follow Git conventions: short subject, blank line, body.
     */
    message: string;
    /**
     * Tree SHA for the commit (required).
     * This is the root tree object representing the repository state.
     */
    tree: string;
    /**
     * Parent commit SHA(s).
     * - Empty array for initial commit
     * - Single SHA for normal commit
     * - Multiple SHAs for merge commit
     */
    parents?: string[];
    /**
     * Author information (required).
     * The person who originally wrote the code.
     */
    author?: CommitAuthor;
    /**
     * Committer information.
     * The person who created the commit. Defaults to author if not specified.
     */
    committer?: CommitAuthor;
    /** GPG signing options */
    signing?: SigningOptions;
    /**
     * Allow creating empty commits (no changes from parent).
     * @default true
     */
    allowEmpty?: boolean;
    /**
     * Whether this is an amend of a previous commit.
     * @internal
     */
    amend?: boolean;
}
/**
 * Options for amending an existing commit.
 *
 * All fields are optional - only specified fields will be changed.
 *
 * @interface AmendOptions
 *
 * @example
 * ```typescript
 * // Change just the message
 * await amendCommit(store, commitSha, {
 *   message: 'Better commit message'
 * })
 *
 * // Change author and reset date
 * await amendCommit(store, commitSha, {
 *   author: { name: 'New Author', email: 'new@example.com.ai' },
 *   resetAuthorDate: true
 * })
 * ```
 */
export interface AmendOptions {
    /**
     * New commit message.
     * If not provided, keeps the original message.
     */
    message?: string;
    /**
     * New tree SHA.
     * If not provided, keeps the original tree.
     */
    tree?: string;
    /**
     * New author information.
     * If not provided, keeps the original author.
     */
    author?: CommitAuthor;
    /**
     * New committer information.
     * Defaults to current user with current time if not provided.
     */
    committer?: CommitAuthor;
    /**
     * Whether to reset the author timestamp to current time.
     * Only applies if author is not explicitly provided.
     */
    resetAuthorDate?: boolean;
    /** GPG signing options */
    signing?: SigningOptions;
}
/**
 * Options for formatting commit messages.
 *
 * @interface FormatOptions
 */
export interface FormatOptions {
    /**
     * Strip leading/trailing whitespace from lines.
     * @default true (for most cleanup modes)
     */
    stripWhitespace?: boolean;
    /**
     * Strip comment lines (starting with comment character).
     * @default true (for 'strip' mode)
     */
    stripComments?: boolean;
    /**
     * Character that starts comment lines.
     * @default '#'
     */
    commentChar?: string;
    /**
     * Wrap message body at this column width.
     * Set to 0 to disable wrapping.
     * @default 0
     */
    wrapColumn?: number;
    /**
     * Message cleanup mode:
     * - 'verbatim': Keep message exactly as-is
     * - 'whitespace': Collapse whitespace, strip trailing lines
     * - 'strip': Also remove comment lines
     * - 'scissors': Remove everything after scissors line
     * - 'default': Same as 'strip' but preserves initial blank lines
     * @default 'default'
     */
    cleanup?: 'verbatim' | 'whitespace' | 'strip' | 'scissors' | 'default';
}
/**
 * Result of creating a commit.
 *
 * @interface CommitResult
 */
export interface CommitResult {
    /** SHA of the created commit */
    sha: string;
    /** The commit object */
    commit: CommitObject;
    /**
     * Whether the commit was actually created.
     * Will be false if empty and allowEmpty=false.
     */
    created: boolean;
}
/**
 * ObjectStore interface for commit operations.
 * Re-exported from storage types for convenience.
 */
export type { ObjectStore };
/**
 * Gets the current timezone offset string.
 *
 * Returns the local timezone in Git's format (e.g., '+0000', '-0500').
 *
 * @returns Timezone offset string
 *
 * @example
 * ```typescript
 * const tz = getCurrentTimezone()
 * // Returns something like '-0800' for Pacific time
 * ```
 */
export declare function getCurrentTimezone(): string;
/**
 * Formats a timestamp and timezone as git author/committer format.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param timezone - Timezone offset string (e.g., '+0000', '-0500')
 * @returns Formatted string like "1234567890 +0000"
 *
 * @example
 * ```typescript
 * const formatted = formatTimestamp(1609459200, '+0000')
 * // Returns "1609459200 +0000"
 * ```
 */
export declare function formatTimestamp(timestamp: number, timezone: string): string;
/**
 * Parses a git timestamp string.
 *
 * @param timestampStr - Timestamp string like "1234567890 +0000"
 * @returns Object with parsed timestamp and timezone
 *
 * @throws {Error} If the timestamp format is invalid (must be "SECONDS TIMEZONE")
 *
 * @example
 * ```typescript
 * const { timestamp, timezone } = parseTimestamp("1609459200 -0500")
 * // timestamp = 1609459200, timezone = "-0500"
 * ```
 */
export declare function parseTimestamp(timestampStr: string): {
    timestamp: number;
    timezone: string;
};
/**
 * Creates an Author object with current timestamp.
 *
 * Convenience function for creating author information with
 * the current time and local timezone.
 *
 * @param name - Author name
 * @param email - Author email
 * @param timezone - Optional timezone (defaults to local timezone)
 * @returns Author object with current timestamp
 *
 * @example
 * ```typescript
 * const author = createAuthor('John Doe', 'john@example.com.ai')
 * // { name: 'John Doe', email: 'john@example.com.ai', timestamp: <now>, timezone: <local> }
 * ```
 */
export declare function createAuthor(name: string, email: string, timezone?: string): Author;
/**
 * Formats a commit message according to git conventions.
 *
 * Applies various transformations based on the cleanup mode:
 * - Strips comments
 * - Normalizes whitespace
 * - Wraps long lines
 * - Removes scissors markers
 *
 * @param message - The raw commit message
 * @param options - Formatting options
 * @returns The formatted commit message
 *
 * @example
 * ```typescript
 * // Clean up a message
 * const formatted = formatCommitMessage(`
 *   Add feature
 *
 *   # This is a comment
 *   Long description here
 * `, { cleanup: 'strip' })
 * // Returns: "Add feature\n\nLong description here"
 * ```
 */
export declare function formatCommitMessage(message: string, options?: FormatOptions): string;
/**
 * Parses a commit message into subject and body.
 *
 * The subject is the first line. The body starts after the first
 * blank line following the subject.
 *
 * @param message - The commit message
 * @returns Object with subject (first line) and body (rest)
 *
 * @example
 * ```typescript
 * const { subject, body } = parseCommitMessage(
 *   'Add feature\n\nThis adds the new feature'
 * )
 * // subject = 'Add feature'
 * // body = 'This adds the new feature'
 * ```
 */
export declare function parseCommitMessage(message: string): {
    subject: string;
    body: string;
};
/**
 * Validates a commit message format.
 *
 * Checks for common issues and provides warnings for style violations.
 * Returns errors for critical issues that would prevent commit creation.
 *
 * @param message - The commit message to validate
 * @returns Object with valid flag and any error/warning messages
 *
 * @example
 * ```typescript
 * const result = validateCommitMessage('Fix bug.')
 * // {
 * //   valid: true,
 * //   errors: [],
 * //   warnings: ['Subject line should not end with a period']
 * // }
 * ```
 */
export declare function validateCommitMessage(message: string): {
    valid: boolean;
    errors: string[];
    warnings: string[];
};
/**
 * Checks if a commit is signed.
 *
 * @param commit - The commit object
 * @returns true if the commit has a GPG signature
 *
 * @example
 * ```typescript
 * if (isCommitSigned(commit)) {
 *   const sig = extractCommitSignature(commit)
 *   // Verify signature...
 * }
 * ```
 */
export declare function isCommitSigned(commit: CommitObject): boolean;
/**
 * Extracts the GPG signature from a signed commit.
 *
 * @param commit - The commit object
 * @returns The signature string if present, null otherwise
 */
export declare function extractCommitSignature(commit: CommitObject): string | null;
/**
 * Adds a GPG signature to a commit.
 *
 * Creates a new commit object with the signature attached.
 * Does not modify the original commit object.
 *
 * @param commit - The unsigned commit object
 * @param signature - The GPG signature string
 * @returns The signed commit object
 */
export declare function addSignatureToCommit(commit: CommitObject, signature: string): CommitObject;
/**
 * Checks if a commit would be empty (same tree as parent).
 *
 * A commit is considered empty if its tree SHA is identical to
 * its parent's tree SHA, meaning no files were changed.
 *
 * @param store - The object store for reading objects
 * @param tree - The tree SHA for the new commit
 * @param parent - The parent commit SHA (or null for initial commit)
 * @returns true if the commit would have no changes
 *
 * @example
 * ```typescript
 * const isEmpty = await isEmptyCommit(store, newTreeSha, parentSha)
 * if (isEmpty && !options.allowEmpty) {
 *   throw new Error('Nothing to commit')
 * }
 * ```
 */
export declare function isEmptyCommit(store: ObjectStore, tree: string, parent: string | null): Promise<boolean>;
/**
 * Builds a commit object from options without storing it.
 *
 * Useful for creating commit objects for inspection or testing
 * without actually persisting them to the object store.
 *
 * @param options - Commit creation options
 * @returns The commit object (not stored)
 *
 * @example
 * ```typescript
 * const commit = buildCommitObject({
 *   message: 'Test commit',
 *   tree: treeSha,
 *   parents: [parentSha],
 *   author: { name: 'Test', email: 'test@example.com.ai' }
 * })
 *
 * console.log(commit.message) // 'Test commit'
 * ```
 */
export declare function buildCommitObject(options: CommitOptions): CommitObject;
/**
 * Creates a new commit.
 *
 * Creates a commit object with the specified options and stores it
 * in the object store. Handles validation, empty commit detection,
 * and optional GPG signing.
 *
 * @param store - The object store for reading/writing objects
 * @param options - Commit creation options
 * @returns The created commit result with SHA and commit object
 *
 * @throws {Error} If tree SHA is missing or has invalid format (must be 40 hex chars)
 * @throws {Error} If author is missing, has invalid name (no angle brackets/newlines), or invalid email
 * @throws {Error} If committer has invalid name or email format
 * @throws {Error} If commit message is empty or whitespace only
 * @throws {Error} If parent SHA has invalid format
 * @throws {Error} If timestamp is negative
 * @throws {Error} If commit would be empty and allowEmpty is false
 *
 * @example
 * ```typescript
 * // Basic commit
 * const result = await createCommit(store, {
 *   message: 'Add new feature',
 *   tree: treeSha,
 *   parents: [headSha],
 *   author: { name: 'John', email: 'john@example.com.ai' }
 * })
 *
 * // Signed commit
 * const signedResult = await createCommit(store, {
 *   message: 'Signed commit',
 *   tree: treeSha,
 *   parents: [headSha],
 *   author: { name: 'John', email: 'john@example.com.ai' },
 *   signing: {
 *     sign: true,
 *     signer: async (data) => myGpgSign(data)
 *   }
 * })
 *
 * // Initial commit (no parents)
 * const initialResult = await createCommit(store, {
 *   message: 'Initial commit',
 *   tree: treeSha,
 *   parents: [],
 *   author: { name: 'John', email: 'john@example.com.ai' }
 * })
 * ```
 */
export declare function createCommit(store: ObjectStore, options: CommitOptions): Promise<CommitResult>;
/**
 * Amends an existing commit.
 *
 * Creates a new commit that replaces the specified commit.
 * The original commit is not modified. Only specified fields
 * in options will be changed from the original.
 *
 * Note: This does not update any refs. The caller is responsible
 * for updating HEAD or branch refs to point to the new commit.
 *
 * @param store - The object store for reading/writing objects
 * @param commitSha - SHA of the commit to amend
 * @param options - Amendment options (only specified fields are changed)
 * @returns The new commit result (original commit is not modified)
 *
 * @throws {Error} If the commit doesn't exist in the object store
 *
 * @example
 * ```typescript
 * // Change just the message
 * const newCommit = await amendCommit(store, headSha, {
 *   message: 'Better commit message'
 * })
 *
 * // Update tree and committer
 * const newCommit = await amendCommit(store, headSha, {
 *   tree: newTreeSha,
 *   committer: { name: 'New Name', email: 'new@example.com.ai' }
 * })
 * ```
 */
export declare function amendCommit(store: ObjectStore, commitSha: string, options: AmendOptions): Promise<CommitResult>;
//# sourceMappingURL=commit.d.ts.map