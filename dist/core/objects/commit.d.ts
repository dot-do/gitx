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
 * gpgsig -----BEGIN PGP SIGNATURE-----
 *  <signature lines>
 *  -----END PGP SIGNATURE-----
 *
 * <message>
 */
import { type GitIdentity, type CommitData } from './types';
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
 * Git commit object
 */
export declare class GitCommit {
    readonly type: "commit";
    readonly tree: string;
    readonly parents: readonly string[];
    readonly author: GitIdentity;
    readonly committer: GitIdentity;
    readonly message: string;
    readonly gpgSignature?: string;
    /**
     * Creates a new GitCommit
     * @throws Error if tree or any parent SHA is invalid
     */
    constructor(data: CommitData);
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