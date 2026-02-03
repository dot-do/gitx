/**
 * Git Commit Object
 *
 * Represents a Git commit object with tree reference, parents,
 * author/committer info, and commit message.
 *
 * Format:
 * tree <sha>
 * parent <sha> (zero or more)
 * author <name> <email> <timestamp> <timezone>
 * committer <name> <email> <timestamp> <timezone>
 * encoding <encoding> (optional)
 * mergetag object <sha>... (optional, for merge commits with signed tags)
 * gpgsig -----BEGIN PGP SIGNATURE-----
 *  <signature lines>
 *  -----END PGP SIGNATURE-----
 *
 * <message>
 *
 * @module core/objects/commit
 */
import { type GitIdentity, type CommitData } from './types';
/**
 * Extra headers that can appear in a commit object.
 * These are Git-compatible but less commonly used headers.
 */
export interface CommitExtraHeaders {
    /**
     * Text encoding for the commit message (e.g., 'UTF-8', 'ISO-8859-1')
     * Used when the message contains non-UTF-8 characters
     */
    encoding?: string;
    /**
     * Merge tag data - contains the full tag object for signed tags in merges
     * Format: "mergetag object <sha>\\ntype <type>\\n..."
     */
    mergetag?: string;
    /**
     * Any other unknown headers preserved for round-trip compatibility
     * Maps header name to value(s)
     */
    [key: string]: string | string[] | undefined;
}
/**
 * Extended CommitData interface with extra headers support
 */
export interface ExtendedCommitData extends CommitData {
    /**
     * Extra headers beyond the standard tree/parent/author/committer
     */
    extraHeaders?: CommitExtraHeaders;
}
/**
 * Parses a Git identity line (author/committer/tagger)
 * Format: "prefix Name <email> timestamp timezone"
 */
export declare function parseIdentity(line: string): GitIdentity;
/**
 * Formats a Git identity for serialization
 * @param prefix - The line prefix (author, committer, tagger)
 * @param identity - The identity to format
 */
export declare function formatIdentity(prefix: string, identity: GitIdentity): string;
/**
 * Checks if a commit has a GPG signature
 */
export declare function hasGpgSignature(commit: GitCommit): boolean;
/**
 * Parses GPG signature from a commit
 */
export declare function parseGpgSignature(commit: GitCommit): string | undefined;
/**
 * Result of commit validation
 */
export interface CommitValidationResult {
    /** Whether the commit data is valid */
    isValid: boolean;
    /** Error message if validation failed */
    error?: string;
    /** Warning messages for non-critical issues */
    warnings?: string[];
}
/**
 * Validates commit data before creation.
 * Returns validation result with error/warning messages.
 *
 * @param data - Commit data to validate
 * @returns Validation result object
 *
 * @example
 * ```typescript
 * const result = validateCommitData({
 *   tree: 'abc123...',
 *   author: { ... },
 *   committer: { ... },
 *   message: 'Commit message'
 * })
 * if (!result.isValid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export declare function validateCommitData(data: CommitData | ExtendedCommitData): CommitValidationResult;
/**
 * Git commit object with support for GPG signatures and extra headers.
 *
 * Provides methods for serialization, deserialization, and inspection
 * of Git commit objects.
 *
 * @example
 * ```typescript
 * // Create a new commit
 * const commit = new GitCommit({
 *   tree: treeSha,
 *   parents: [parentSha],
 *   author: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   committer: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Initial commit'
 * })
 *
 * // Get the SHA
 * const sha = await commit.hash()
 *
 * // Parse from serialized data
 * const parsed = GitCommit.parse(serializedData)
 * ```
 */
export declare class GitCommit {
    readonly type: "commit";
    readonly tree: string;
    readonly parents: readonly string[];
    readonly author: GitIdentity;
    readonly committer: GitIdentity;
    readonly message: string;
    readonly gpgSignature?: string;
    readonly extraHeaders?: CommitExtraHeaders;
    /**
     * Creates a new GitCommit
     * @param data - Commit data including tree, parents, author, committer, message
     * @throws Error if tree or any parent SHA is invalid
     */
    constructor(data: CommitData | ExtendedCommitData);
    /**
     * Creates a GitCommit from raw commit content (without header)
     */
    static fromContent(content: string): GitCommit;
    /**
     * Parses a GitCommit from serialized Git object format
     * @param data - The serialized data including header
     * @throws Error if the header is invalid or type is not commit
     */
    static parse(data: Uint8Array): GitCommit;
    /**
     * Checks if this is an initial commit (no parents)
     */
    isInitialCommit(): boolean;
    /**
     * Checks if this is a merge commit (2+ parents)
     */
    isMergeCommit(): boolean;
    /**
     * Checks if this commit has a GPG signature
     */
    hasSignature(): boolean;
    /**
     * Gets the subject line (first line) of the commit message
     */
    getSubject(): string;
    /**
     * Gets the body of the commit message (after subject and blank line)
     */
    getBody(): string;
    /**
     * Serializes the commit to Git object format
     */
    serialize(): Uint8Array;
    /**
     * Gets extra headers (encoding, mergetag, etc.) if present
     */
    getExtraHeaders(): CommitExtraHeaders | undefined;
    /**
     * Serializes just the commit content (without header)
     */
    private serializeContent;
    /**
     * Calculates the SHA-1 hash of this commit object
     * @returns Promise resolving to 40-character hex string
     */
    hash(): Promise<string>;
}
export type { GitIdentity };
//# sourceMappingURL=commit.d.ts.map