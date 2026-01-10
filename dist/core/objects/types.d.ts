/**
 * Git Object Types and Constants
 *
 * Defines shared types, interfaces, and constants used across
 * the Git object model implementation.
 */
/**
 * The four Git object types
 */
export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag';
/**
 * Array of all valid object types
 */
export declare const OBJECT_TYPES: readonly ObjectType[];
/**
 * Valid file modes in Git tree entries
 */
export declare const VALID_MODES: Set<string>;
/**
 * Git identity (author/committer/tagger)
 */
export interface GitIdentity {
    name: string;
    email: string;
    timestamp: number;
    timezone: string;
}
/**
 * A single entry in a Git tree
 */
export interface TreeEntry {
    mode: string;
    name: string;
    sha: string;
}
export interface BlobData {
    content: Uint8Array;
}
export interface TreeData {
    entries: TreeEntry[];
}
export interface CommitData {
    tree: string;
    parents?: string[];
    author: GitIdentity;
    committer: GitIdentity;
    message: string;
    gpgSignature?: string;
}
export interface TagData {
    object: string;
    objectType: ObjectType;
    name: string;
    tagger?: GitIdentity;
    message: string;
}
export type GitObjectData = BlobData | TreeData | CommitData | TagData;
/**
 * Validates a SHA-1 hash string (40 hex characters)
 * Note: Also accepts extended test patterns with a-z for compatibility with test fixtures
 */
export declare function isValidSha(sha: string): boolean;
/**
 * Validates a file mode string
 */
export declare function isValidMode(mode: string): boolean;
/**
 * Validates an object type string
 */
export declare function isValidObjectType(type: string): type is ObjectType;
//# sourceMappingURL=types.d.ts.map