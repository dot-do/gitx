/**
 * @fileoverview Tree Entry Utilities for Git Tree Objects
 *
 * This module provides reusable utilities for working with Git tree entries,
 * including validation, sorting, serialization, and parsing. These utilities
 * are extracted from object-store.ts to promote code reuse and testability.
 *
 * ## Git Tree Format
 *
 * A tree object contains zero or more entries, each formatted as:
 * ```
 * {mode} {name}\0{20-byte-sha}
 * ```
 *
 * Entries must be sorted by name with directories treated as having trailing slashes.
 *
 * ## Valid Modes
 *
 * - `100644`: Regular file (non-executable)
 * - `100755`: Executable file
 * - `040000`: Directory (tree)
 * - `120000`: Symbolic link
 * - `160000`: Git submodule (gitlink)
 *
 * @module utils/tree
 *
 * @example
 * ```typescript
 * import {
 *   validateTreeEntry,
 *   validateTreeEntries,
 *   sortTreeEntries,
 *   serializeTreeEntries,
 *   parseTreeEntries
 * } from './utils/tree'
 *
 * // Validate entries
 * const result = validateTreeEntries(entries)
 * if (!result.valid) {
 *   console.error(result.errors)
 * }
 *
 * // Sort and serialize
 * const sorted = sortTreeEntries(entries)
 * const content = serializeTreeEntries(sorted)
 *
 * // Parse raw tree data
 * const parsed = parseTreeEntries(data)
 * ```
 */
import { TreeEntry } from '../types/objects';
/**
 * File mode constants for Git tree entries.
 */
export declare const TreeMode: {
    /** Regular file (non-executable) */
    readonly REGULAR_FILE: "100644";
    /** Executable file */
    readonly EXECUTABLE_FILE: "100755";
    /** Directory (tree) */
    readonly DIRECTORY: "040000";
    /** Symbolic link */
    readonly SYMLINK: "120000";
    /** Git submodule */
    readonly SUBMODULE: "160000";
};
/**
 * Set of all valid tree entry modes.
 */
export declare const VALID_TREE_MODES: Set<"100644" | "100755" | "040000" | "120000" | "160000">;
/**
 * Result of validating a tree entry.
 */
export interface TreeEntryValidationResult {
    /** Whether the entry is valid */
    valid: boolean;
    /** Error message if invalid */
    error?: string;
}
/**
 * Result of validating multiple tree entries.
 */
export interface TreeEntriesValidationResult {
    /** Whether all entries are valid */
    valid: boolean;
    /** List of validation errors */
    errors: string[];
}
/**
 * Validate a single tree entry.
 *
 * @description
 * Checks that the entry has:
 * - A valid mode (100644, 100755, 040000, 120000, 160000)
 * - A non-empty name without forbidden characters (/, \0, ., ..)
 * - A valid 40-character lowercase hex SHA
 *
 * @param entry - Tree entry to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```typescript
 * const result = validateTreeEntry({ mode: '100644', name: 'file.txt', sha: 'abc...' })
 * if (!result.valid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export declare function validateTreeEntry(entry: TreeEntry): TreeEntryValidationResult;
/**
 * Validate multiple tree entries including duplicate detection.
 *
 * @description
 * Validates each entry individually and also checks for duplicate names.
 * Returns all validation errors found, not just the first one.
 *
 * @param entries - Array of tree entries to validate
 * @returns Validation result with all errors
 *
 * @example
 * ```typescript
 * const result = validateTreeEntries(entries)
 * if (!result.valid) {
 *   for (const error of result.errors) {
 *     console.error(error)
 *   }
 * }
 * ```
 */
export declare function validateTreeEntries(entries: TreeEntry[]): TreeEntriesValidationResult;
/**
 * Validate tree entries and throw on first error.
 *
 * @description
 * A convenience wrapper that validates entries and throws an Error
 * with the first validation error encountered. Use this when you want
 * fail-fast behavior.
 *
 * @param entries - Array of tree entries to validate
 * @throws Error with validation message if any entry is invalid
 *
 * @example
 * ```typescript
 * try {
 *   assertValidTreeEntries(entries)
 *   // entries are valid, proceed
 * } catch (e) {
 *   console.error('Invalid entries:', e.message)
 * }
 * ```
 */
export declare function assertValidTreeEntries(entries: TreeEntry[]): void;
/**
 * Sort tree entries according to Git conventions.
 *
 * @description
 * Git sorts tree entries by name using byte-order comparison, with
 * directories treated as if they have a trailing slash. This is required
 * to produce consistent SHA hashes.
 *
 * Examples:
 * - Files: 'a', 'aa', 'ab', 'b'
 * - With directory 'a/': 'a/' (dir), 'aa', 'ab', 'b'
 *
 * @param entries - Array of tree entries to sort
 * @returns New sorted array (does not modify input)
 *
 * @example
 * ```typescript
 * const entries = [
 *   { mode: '100644', name: 'z.txt', sha: '...' },
 *   { mode: '040000', name: 'a', sha: '...' },
 *   { mode: '100644', name: 'aa.txt', sha: '...' }
 * ]
 * const sorted = sortTreeEntries(entries)
 * // sorted: [{ name: 'a' }, { name: 'aa.txt' }, { name: 'z.txt' }]
 * ```
 */
export declare function sortTreeEntries(entries: TreeEntry[]): TreeEntry[];
/**
 * Check if a tree entry represents a directory.
 *
 * @param entry - Tree entry to check
 * @returns true if the entry is a directory (mode 040000)
 */
export declare function isDirectoryEntry(entry: TreeEntry): boolean;
/**
 * Check if a tree entry represents a regular file.
 *
 * @param entry - Tree entry to check
 * @returns true if the entry is a regular file (mode 100644 or 100755)
 */
export declare function isFileEntry(entry: TreeEntry): boolean;
/**
 * Check if a tree entry represents a symlink.
 *
 * @param entry - Tree entry to check
 * @returns true if the entry is a symlink (mode 120000)
 */
export declare function isSymlinkEntry(entry: TreeEntry): boolean;
/**
 * Check if a tree entry represents a submodule.
 *
 * @param entry - Tree entry to check
 * @returns true if the entry is a submodule (mode 160000)
 */
export declare function isSubmoduleEntry(entry: TreeEntry): boolean;
/**
 * Convert a hex string to bytes.
 *
 * @param hex - Hexadecimal string (must be even length)
 * @returns Binary representation as Uint8Array
 */
export declare function hexToBytes(hex: string): Uint8Array;
/**
 * Convert bytes to a lowercase hex string.
 *
 * @param bytes - Binary data to convert
 * @returns Lowercase hexadecimal string
 */
export declare function bytesToHex(bytes: Uint8Array): string;
/**
 * Serialize a single tree entry to Git format.
 *
 * @description
 * Each tree entry is formatted as:
 * ```
 * {mode} {name}\0{20-byte-sha}
 * ```
 *
 * @param entry - Tree entry to serialize
 * @returns Binary representation of the entry
 *
 * @example
 * ```typescript
 * const entry = { mode: '100644', name: 'file.txt', sha: 'abc...' }
 * const data = serializeTreeEntry(entry)
 * ```
 */
export declare function serializeTreeEntry(entry: TreeEntry): Uint8Array;
/**
 * Serialize multiple tree entries to Git format.
 *
 * @description
 * Serializes each entry and concatenates them. This produces the
 * content portion of a tree object (without the "tree {size}\0" header).
 *
 * **Note**: This does NOT sort entries. Call sortTreeEntries() first
 * if you need sorted output for consistent SHA computation.
 *
 * @param entries - Array of tree entries to serialize
 * @returns Binary content of the tree object
 *
 * @example
 * ```typescript
 * const sorted = sortTreeEntries(entries)
 * const content = serializeTreeEntries(sorted)
 * const sha = await hashObject('tree', content)
 * ```
 */
export declare function serializeTreeEntries(entries: TreeEntry[]): Uint8Array;
/**
 * Result of parsing tree entries.
 */
export interface ParseTreeResult {
    /** Successfully parsed entries */
    entries: TreeEntry[];
    /** Whether parsing completed successfully */
    success: boolean;
    /** Error message if parsing failed */
    error?: string;
}
/**
 * Parse tree entries from raw binary data.
 *
 * @description
 * Parses the content portion of a tree object (without header) into
 * an array of TreeEntry objects. Handles malformed data gracefully
 * by returning success=false with an error message.
 *
 * @param data - Raw tree content (without "tree {size}\0" header)
 * @returns Parse result with entries and success status
 *
 * @example
 * ```typescript
 * const result = parseTreeEntries(data)
 * if (result.success) {
 *   for (const entry of result.entries) {
 *     console.log(entry.name)
 *   }
 * } else {
 *   console.error('Parse error:', result.error)
 * }
 * ```
 */
export declare function parseTreeEntries(data: Uint8Array): ParseTreeResult;
/**
 * Parse tree entries or return empty array on failure.
 *
 * @description
 * A convenience wrapper that returns an empty array if parsing fails,
 * useful when you want to handle parse errors gracefully.
 *
 * @param data - Raw tree content
 * @returns Array of parsed entries (empty on failure)
 */
export declare function parseTreeEntriesOrEmpty(data: Uint8Array): TreeEntry[];
/**
 * Options for batch tree operations.
 */
export interface BatchTreeOptions {
    /** Whether to sort entries before serialization (default: true) */
    sort?: boolean;
    /** Whether to validate entries before processing (default: true) */
    validate?: boolean;
}
/**
 * Prepare tree entries for storage.
 *
 * @description
 * Validates, sorts, and serializes tree entries in one operation.
 * This is the recommended way to prepare entries before storing
 * a tree object.
 *
 * @param entries - Array of tree entries
 * @param options - Processing options
 * @returns Serialized tree content ready for storage
 * @throws Error if validation fails and validate=true (default)
 *
 * @example
 * ```typescript
 * const content = prepareTreeContent(entries)
 * const sha = await store.putObject('tree', content)
 * ```
 */
export declare function prepareTreeContent(entries: TreeEntry[], options?: BatchTreeOptions): Uint8Array;
/**
 * Tree entry with full path information.
 */
export interface TreeEntryWithPath extends TreeEntry {
    /** Full path from repository root */
    fullPath: string;
}
/**
 * Interface for object store tree operations.
 */
export interface TreeObjectStore {
    getTreeObject(sha: string): Promise<{
        entries: TreeEntry[];
    } | null>;
}
/**
 * Recursively walk a tree and collect all entries with full paths.
 *
 * @description
 * Traverses the tree depth-first, collecting all non-directory entries
 * with their full paths from the root. This is useful for operations
 * like `git ls-tree -r` that need a flat list of all files.
 *
 * @param store - Object store for retrieving trees
 * @param treeSha - SHA of the root tree
 * @param prefix - Path prefix (used in recursion, typically empty for root)
 * @returns Promise resolving to flat list of entries with full paths
 *
 * @example
 * ```typescript
 * const entries = await walkTree(store, treeSha)
 * for (const entry of entries) {
 *   console.log(`${entry.mode} ${entry.sha} ${entry.fullPath}`)
 * }
 * ```
 */
export declare function walkTree(store: TreeObjectStore, treeSha: string, prefix?: string): Promise<TreeEntryWithPath[]>;
/**
 * Get a specific entry from a tree by path.
 *
 * @description
 * Resolves a path like "src/utils/tree.ts" by walking through the tree
 * hierarchy. Returns null if the path doesn't exist.
 *
 * @param store - Object store for retrieving trees
 * @param treeSha - SHA of the root tree
 * @param path - Path to resolve (e.g., "src/utils/tree.ts")
 * @returns Promise resolving to the entry or null if not found
 *
 * @example
 * ```typescript
 * const entry = await getTreeEntryByPath(store, treeSha, 'src/index.ts')
 * if (entry) {
 *   console.log(`Found: ${entry.sha}`)
 * }
 * ```
 */
export declare function getTreeEntryByPath(store: TreeObjectStore, treeSha: string, path: string): Promise<TreeEntry | null>;
/**
 * Collect all tree SHAs referenced in a tree hierarchy.
 *
 * @description
 * Recursively collects all tree object SHAs including the root.
 * This is useful for operations like shallow clones or tree-based
 * garbage collection.
 *
 * @param store - Object store for retrieving trees
 * @param treeSha - SHA of the root tree
 * @returns Promise resolving to set of all tree SHAs
 *
 * @example
 * ```typescript
 * const treeShas = await collectTreeShas(store, rootTreeSha)
 * console.log(`Found ${treeShas.size} tree objects`)
 * ```
 */
export declare function collectTreeShas(store: TreeObjectStore, treeSha: string): Promise<Set<string>>;
/**
 * Collect all blob SHAs referenced in a tree hierarchy.
 *
 * @description
 * Recursively collects all blob (file) SHAs from a tree.
 * This is useful for operations like computing repository size
 * or preparing pack files.
 *
 * @param store - Object store for retrieving trees
 * @param treeSha - SHA of the root tree
 * @returns Promise resolving to set of all blob SHAs
 *
 * @example
 * ```typescript
 * const blobShas = await collectBlobShas(store, rootTreeSha)
 * console.log(`Found ${blobShas.size} files`)
 * ```
 */
export declare function collectBlobShas(store: TreeObjectStore, treeSha: string): Promise<Set<string>>;
//# sourceMappingURL=tree.d.ts.map