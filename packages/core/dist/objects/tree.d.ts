/**
 * Git Tree Object
 *
 * Represents a Git tree object which stores directory structure.
 * Format: "tree <size>\0<entries>"
 * Entry format: "<mode> <name>\0<20-byte-sha>"
 */
import { type TreeEntry } from './types';
/**
 * Sorts tree entries according to Git's sorting rules.
 * Directories are sorted as if they have a trailing slash.
 */
export declare function sortTreeEntries(entries: TreeEntry[]): TreeEntry[];
/**
 * Parses tree entries from raw content (after header)
 * @param content - The raw tree content (without header)
 */
export declare function parseTreeEntries(content: Uint8Array): TreeEntry[];
/**
 * Serializes tree entries to raw content (without header)
 */
export declare function serializeTreeEntries(entries: TreeEntry[]): Uint8Array;
/**
 * Git tree object - stores directory structure
 */
export declare class GitTree {
    readonly type: "tree";
    readonly entries: readonly TreeEntry[];
    /**
     * Creates a new GitTree with the given entries
     * @param entries - The tree entries (will be sorted)
     * @throws Error if any entry has invalid mode, SHA, or name
     */
    constructor(entries: TreeEntry[]);
    /**
     * Parses a GitTree from serialized Git object format
     * @param data - The serialized data including header
     * @throws Error if the header is invalid or type is not tree
     */
    static parse(data: Uint8Array): GitTree;
    /**
     * Checks if the tree is empty
     */
    isEmpty(): boolean;
    /**
     * Gets an entry by name
     */
    getEntry(name: string): TreeEntry | undefined;
    /**
     * Checks if an entry is a directory
     */
    isDirectory(name: string): boolean;
    /**
     * Checks if an entry is an executable file
     */
    isExecutable(name: string): boolean;
    /**
     * Checks if an entry is a symbolic link
     */
    isSymlink(name: string): boolean;
    /**
     * Checks if an entry is a submodule
     */
    isSubmodule(name: string): boolean;
    /**
     * Serializes the tree to Git object format
     * Format: "tree <size>\0<entries>"
     */
    serialize(): Uint8Array;
    /**
     * Calculates the SHA-1 hash of this tree object
     * @returns Promise resolving to 40-character hex string
     */
    hash(): Promise<string>;
}
export type { TreeEntry };
//# sourceMappingURL=tree.d.ts.map