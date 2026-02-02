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
import { isValidMode, isValidSha } from '../types/objects';
// ============================================================================
// Constants
// ============================================================================
/**
 * File mode constants for Git tree entries.
 */
export const TreeMode = {
    /** Regular file (non-executable) */
    REGULAR_FILE: '100644',
    /** Executable file */
    EXECUTABLE_FILE: '100755',
    /** Directory (tree) */
    DIRECTORY: '040000',
    /** Symbolic link */
    SYMLINK: '120000',
    /** Git submodule */
    SUBMODULE: '160000',
};
/**
 * Set of all valid tree entry modes.
 */
export const VALID_TREE_MODES = new Set(Object.values(TreeMode));
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
export function validateTreeEntry(entry) {
    // Check for invalid names: empty, '.', '..', contains '/' or null byte
    if (!entry.name || entry.name === '.' || entry.name === '..') {
        return {
            valid: false,
            error: `Invalid entry name: "${entry.name}". Entry names cannot be empty, ".", or ".."`
        };
    }
    if (entry.name.includes('/')) {
        return {
            valid: false,
            error: `Invalid entry name: "${entry.name}". Entry names cannot contain path separators`
        };
    }
    if (entry.name.includes('\0')) {
        return {
            valid: false,
            error: `Invalid entry name: "${entry.name}". Entry names cannot contain null bytes`
        };
    }
    // Validate mode
    if (!isValidMode(entry.mode)) {
        return {
            valid: false,
            error: `Invalid mode: "${entry.mode}". Valid modes: 100644, 100755, 040000, 120000, 160000`
        };
    }
    // Validate SHA
    if (!isValidSha(entry.sha)) {
        return {
            valid: false,
            error: `Invalid SHA: "${entry.sha}". Must be 40 lowercase hex characters`
        };
    }
    return { valid: true };
}
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
export function validateTreeEntries(entries) {
    const errors = [];
    const seenNames = new Set();
    for (const entry of entries) {
        // Validate the entry itself
        const result = validateTreeEntry(entry);
        if (!result.valid) {
            errors.push(result.error);
            continue;
        }
        // Check for duplicates
        if (seenNames.has(entry.name)) {
            errors.push(`Duplicate entry name: "${entry.name}". Tree entries must have unique names`);
        }
        else {
            seenNames.add(entry.name);
        }
    }
    return {
        valid: errors.length === 0,
        errors
    };
}
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
export function assertValidTreeEntries(entries) {
    const seenNames = new Set();
    for (const entry of entries) {
        const result = validateTreeEntry(entry);
        if (!result.valid) {
            throw new Error(result.error);
        }
        if (seenNames.has(entry.name)) {
            throw new Error(`Duplicate entry name: "${entry.name}". Tree entries must have unique names`);
        }
        seenNames.add(entry.name);
    }
}
// ============================================================================
// Sorting
// ============================================================================
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
export function sortTreeEntries(entries) {
    return [...entries].sort((a, b) => {
        // Directories sort as if they have trailing slash
        const aName = a.mode === TreeMode.DIRECTORY ? a.name + '/' : a.name;
        const bName = b.mode === TreeMode.DIRECTORY ? b.name + '/' : b.name;
        // Use simple comparison for ASCII byte order
        if (aName < bName)
            return -1;
        if (aName > bName)
            return 1;
        return 0;
    });
}
/**
 * Check if a tree entry represents a directory.
 *
 * @param entry - Tree entry to check
 * @returns true if the entry is a directory (mode 040000)
 */
export function isDirectoryEntry(entry) {
    return entry.mode === TreeMode.DIRECTORY;
}
/**
 * Check if a tree entry represents a regular file.
 *
 * @param entry - Tree entry to check
 * @returns true if the entry is a regular file (mode 100644 or 100755)
 */
export function isFileEntry(entry) {
    return entry.mode === TreeMode.REGULAR_FILE || entry.mode === TreeMode.EXECUTABLE_FILE;
}
/**
 * Check if a tree entry represents a symlink.
 *
 * @param entry - Tree entry to check
 * @returns true if the entry is a symlink (mode 120000)
 */
export function isSymlinkEntry(entry) {
    return entry.mode === TreeMode.SYMLINK;
}
/**
 * Check if a tree entry represents a submodule.
 *
 * @param entry - Tree entry to check
 * @returns true if the entry is a submodule (mode 160000)
 */
export function isSubmoduleEntry(entry) {
    return entry.mode === TreeMode.SUBMODULE;
}
// ============================================================================
// Serialization
// ============================================================================
const encoder = new TextEncoder();
/**
 * Convert a hex string to bytes.
 *
 * @param hex - Hexadecimal string (must be even length)
 * @returns Binary representation as Uint8Array
 */
export function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}
/**
 * Convert bytes to a lowercase hex string.
 *
 * @param bytes - Binary data to convert
 * @returns Lowercase hexadecimal string
 */
export function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
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
export function serializeTreeEntry(entry) {
    const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`);
    const sha20 = hexToBytes(entry.sha);
    const result = new Uint8Array(modeName.length + 20);
    result.set(modeName);
    result.set(sha20, modeName.length);
    return result;
}
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
export function serializeTreeEntries(entries) {
    const parts = [];
    let totalLength = 0;
    for (const entry of entries) {
        const part = serializeTreeEntry(entry);
        parts.push(part);
        totalLength += part.length;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}
// ============================================================================
// Parsing
// ============================================================================
const decoder = new TextDecoder();
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
export function parseTreeEntries(data) {
    const entries = [];
    let offset = 0;
    try {
        while (offset < data.length) {
            // Find the null byte after mode+name
            let nullIndex = offset;
            while (nullIndex < data.length && data[nullIndex] !== 0) {
                nullIndex++;
            }
            // Check if we found a null byte
            if (nullIndex >= data.length) {
                return {
                    entries: [],
                    success: false,
                    error: 'Malformed tree data: missing null byte terminator'
                };
            }
            const modeNameStr = decoder.decode(data.slice(offset, nullIndex));
            const spaceIndex = modeNameStr.indexOf(' ');
            // Check for valid mode+name format
            if (spaceIndex === -1) {
                return {
                    entries: [],
                    success: false,
                    error: 'Malformed tree data: missing space between mode and name'
                };
            }
            const mode = modeNameStr.slice(0, spaceIndex);
            const name = modeNameStr.slice(spaceIndex + 1);
            // Check if we have enough bytes for the 20-byte SHA
            if (nullIndex + 21 > data.length) {
                return {
                    entries: [],
                    success: false,
                    error: 'Malformed tree data: truncated SHA'
                };
            }
            // Read 20-byte SHA
            const sha20 = data.slice(nullIndex + 1, nullIndex + 21);
            const sha = bytesToHex(sha20);
            entries.push({ mode, name, sha });
            offset = nullIndex + 21;
        }
    }
    catch (e) {
        return {
            entries: [],
            success: false,
            error: `Parse error: ${e instanceof Error ? e.message : String(e)}`
        };
    }
    return {
        entries,
        success: true
    };
}
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
export function parseTreeEntriesOrEmpty(data) {
    const result = parseTreeEntries(data);
    return result.success ? result.entries : [];
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
export function prepareTreeContent(entries, options = {}) {
    const { sort = true, validate = true } = options;
    if (validate) {
        assertValidTreeEntries(entries);
    }
    const toSerialize = sort ? sortTreeEntries(entries) : entries;
    return serializeTreeEntries(toSerialize);
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
export async function walkTree(store, treeSha, prefix = '') {
    const tree = await store.getTreeObject(treeSha);
    if (!tree) {
        return [];
    }
    const results = [];
    for (const entry of tree.entries) {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (isDirectoryEntry(entry)) {
            // Recurse into subdirectory
            const subEntries = await walkTree(store, entry.sha, fullPath);
            results.push(...subEntries);
        }
        else {
            results.push({ ...entry, fullPath });
        }
    }
    return results;
}
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
export async function getTreeEntryByPath(store, treeSha, path) {
    const parts = path.split('/').filter(p => p.length > 0);
    if (parts.length === 0) {
        return null;
    }
    let currentTreeSha = treeSha;
    for (let i = 0; i < parts.length; i++) {
        const name = parts[i];
        const isLast = i === parts.length - 1;
        const tree = await store.getTreeObject(currentTreeSha);
        if (!tree) {
            return null;
        }
        const entry = tree.entries.find(e => e.name === name);
        if (!entry) {
            return null;
        }
        if (isLast) {
            return entry;
        }
        // Must be a directory to continue
        if (!isDirectoryEntry(entry)) {
            return null;
        }
        currentTreeSha = entry.sha;
    }
    return null;
}
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
export async function collectTreeShas(store, treeSha) {
    const result = new Set();
    const queue = [treeSha];
    while (queue.length > 0) {
        const sha = queue.pop();
        if (result.has(sha)) {
            continue;
        }
        result.add(sha);
        const tree = await store.getTreeObject(sha);
        if (!tree) {
            continue;
        }
        for (const entry of tree.entries) {
            if (isDirectoryEntry(entry) && !result.has(entry.sha)) {
                queue.push(entry.sha);
            }
        }
    }
    return result;
}
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
export async function collectBlobShas(store, treeSha) {
    const result = new Set();
    const entries = await walkTree(store, treeSha);
    for (const entry of entries) {
        if (!isDirectoryEntry(entry)) {
            result.add(entry.sha);
        }
    }
    return result;
}
//# sourceMappingURL=tree.js.map