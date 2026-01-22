/**
 * @fileoverview Tree Diff Operations
 *
 * This module provides functionality for comparing Git trees and detecting
 * changes between them, including added, deleted, modified, renamed, and
 * copied files.
 *
 * ## Features
 *
 * - Compare two tree objects to detect changes
 * - Detect file additions, deletions, modifications
 * - Rename detection based on content similarity
 * - Copy detection
 * - Binary file detection
 * - Path filtering with glob patterns
 * - Type change detection (file to symlink, etc.)
 *
 * ## Usage Example
 *
 * ```typescript
 * import { diffTrees, DiffStatus } from './ops/tree-diff'
 *
 * // Compare two trees
 * const result = await diffTrees(store, oldTreeSha, newTreeSha, {
 *   detectRenames: true,
 *   similarityThreshold: 50
 * })
 *
 * // Process changes
 * for (const entry of result.entries) {
 *   switch (entry.status) {
 *     case DiffStatus.ADDED:
 *       console.log(`+ ${entry.path}`)
 *       break
 *     case DiffStatus.DELETED:
 *       console.log(`- ${entry.path}`)
 *       break
 *     case DiffStatus.MODIFIED:
 *       console.log(`M ${entry.path}`)
 *       break
 *     case DiffStatus.RENAMED:
 *       console.log(`R ${entry.oldPath} -> ${entry.path}`)
 *       break
 *   }
 * }
 *
 * console.log(`Stats: ${result.stats.added} added, ${result.stats.deleted} deleted`)
 * ```
 *
 * @module ops/tree-diff
 */
/**
 * Status of a file in a diff.
 *
 * These status codes match Git's diff status output.
 *
 * @enum {string}
 */
export var DiffStatus;
(function (DiffStatus) {
    /** File was added */
    DiffStatus["ADDED"] = "A";
    /** File was deleted */
    DiffStatus["DELETED"] = "D";
    /** File was modified */
    DiffStatus["MODIFIED"] = "M";
    /** File was renamed */
    DiffStatus["RENAMED"] = "R";
    /** File was copied */
    DiffStatus["COPIED"] = "C";
    /** File type changed (e.g., file to symlink) */
    DiffStatus["TYPE_CHANGED"] = "T";
    /** Unmerged (conflict) */
    DiffStatus["UNMERGED"] = "U";
})(DiffStatus || (DiffStatus = {}));
/**
 * File mode constants for Git objects
 */
export var FileMode;
(function (FileMode) {
    /** Regular file (not executable) */
    FileMode["REGULAR"] = "100644";
    /** Executable file */
    FileMode["EXECUTABLE"] = "100755";
    /** Symbolic link */
    FileMode["SYMLINK"] = "120000";
    /** Git submodule (gitlink) */
    FileMode["GITLINK"] = "160000";
    /** Directory (tree) */
    FileMode["TREE"] = "040000";
})(FileMode || (FileMode = {}));
/**
 * Check if a file appears to be binary based on its content
 *
 * A file is considered binary if it contains null bytes in the first
 * 8000 bytes (similar to Git's heuristic).
 *
 * @param content - File content to check
 * @returns true if the file appears to be binary
 */
export function isBinaryContent(content) {
    // Check first 8000 bytes for null bytes
    const checkLength = Math.min(content.length, 8000);
    for (let i = 0; i < checkLength; i++) {
        if (content[i] === 0x00) {
            return true;
        }
    }
    return false;
}
/**
 * Calculate similarity between two blobs for rename/copy detection
 *
 * Uses a simple heuristic based on shared content.
 *
 * @param store - Object store for retrieving blob contents
 * @param oldSha - SHA of the old blob
 * @param newSha - SHA of the new blob
 * @returns Promise resolving to similarity percentage (0-100)
 */
export async function calculateSimilarity(store, oldSha, newSha) {
    // If same SHA, 100% similar
    if (oldSha === newSha) {
        return 100;
    }
    const [oldBlob, newBlob] = await Promise.all([
        store.getBlob(oldSha),
        store.getBlob(newSha)
    ]);
    if (!oldBlob || !newBlob) {
        return 0;
    }
    // Use a simple character-by-character comparison for similarity
    // This is a basic approach; a more sophisticated algorithm would use
    // something like xdiff or Myers diff
    const oldStr = new TextDecoder().decode(oldBlob);
    const newStr = new TextDecoder().decode(newBlob);
    if (oldStr === newStr) {
        return 100;
    }
    // Count matching characters at each position
    const maxLen = Math.max(oldStr.length, newStr.length);
    if (maxLen === 0) {
        return 100;
    }
    let matches = 0;
    const minLen = Math.min(oldStr.length, newStr.length);
    for (let i = 0; i < minLen; i++) {
        if (oldStr[i] === newStr[i]) {
            matches++;
        }
    }
    return Math.round((matches / maxLen) * 100);
}
/**
 * Parse a file mode string and determine its type
 *
 * @param mode - File mode string (e.g., '100644', '040000')
 * @returns Object with mode information
 */
export function parseMode(mode) {
    return {
        isFile: mode === FileMode.REGULAR || mode === FileMode.EXECUTABLE,
        isDirectory: mode === FileMode.TREE,
        isSymlink: mode === FileMode.SYMLINK,
        isSubmodule: mode === FileMode.GITLINK,
        isExecutable: mode === FileMode.EXECUTABLE
    };
}
/**
 * Check if a mode change represents a significant type change
 *
 * @param oldMode - Old file mode
 * @param newMode - New file mode
 * @returns true if the mode change is significant (e.g., file to symlink)
 */
export function isModeChangeSignificant(oldMode, newMode) {
    if (oldMode === newMode) {
        return false;
    }
    const oldParsed = parseMode(oldMode);
    const newParsed = parseMode(newMode);
    // Type changes are significant (file to symlink, file to submodule, etc.)
    if (oldParsed.isFile && newParsed.isSymlink)
        return true;
    if (oldParsed.isFile && newParsed.isSubmodule)
        return true;
    if (oldParsed.isSymlink && newParsed.isFile)
        return true;
    if (oldParsed.isSymlink && newParsed.isSubmodule)
        return true;
    if (oldParsed.isSubmodule && newParsed.isFile)
        return true;
    if (oldParsed.isSubmodule && newParsed.isSymlink)
        return true;
    // Regular to executable is not significant
    return false;
}
/**
 * Simple glob pattern matching
 */
function matchGlob(pattern, path) {
    // Convert glob pattern to regex
    const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
        .replace(/\*/g, '[^/]*')
        .replace(/<<<DOUBLESTAR>>>/g, '.*')
        .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
}
/**
 * Filter diff entries by pathspecs
 *
 * @param entries - Diff entries to filter
 * @param pathspecs - Glob patterns to include
 * @param excludePaths - Paths to exclude
 * @returns Filtered entries
 */
export function filterByPathspecs(entries, pathspecs, excludePaths) {
    if (!pathspecs && !excludePaths) {
        return entries;
    }
    return entries.filter(entry => {
        // Check exclude paths first
        if (excludePaths) {
            for (const pattern of excludePaths) {
                if (matchGlob(pattern, entry.path)) {
                    return false;
                }
            }
        }
        // If no include pathspecs, include everything not excluded
        if (!pathspecs || pathspecs.length === 0) {
            return true;
        }
        // Check if path matches any include pattern
        for (const pattern of pathspecs) {
            if (matchGlob(pattern, entry.path)) {
                return true;
            }
        }
        return false;
    });
}
/**
 * Recursively walk a tree and collect all entries with full paths
 *
 * @param store - Object store for retrieving tree contents
 * @param treeSha - SHA of the tree to walk
 * @param prefix - Path prefix for entries
 * @returns Promise resolving to flat list of entries with full paths
 */
export async function walkTree(store, treeSha, prefix) {
    const tree = await store.getTree(treeSha);
    if (!tree) {
        return [];
    }
    const results = [];
    for (const entry of tree.entries) {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.mode === FileMode.TREE) {
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
 * Helper to get type category for mode comparison
 */
function getModeType(mode) {
    if (mode === FileMode.REGULAR || mode === FileMode.EXECUTABLE) {
        return 'file';
    }
    if (mode === FileMode.SYMLINK) {
        return 'symlink';
    }
    if (mode === FileMode.GITLINK) {
        return 'submodule';
    }
    if (mode === FileMode.TREE) {
        return 'tree';
    }
    return 'unknown';
}
/**
 * Compare two trees and return the differences
 *
 * @param store - Object store for retrieving tree contents
 * @param oldTreeSha - SHA of the old tree (null for initial commit comparison)
 * @param newTreeSha - SHA of the new tree (null to compare against empty)
 * @param options - Diff options
 * @returns Promise resolving to diff result
 */
export async function diffTrees(store, oldTreeSha, newTreeSha, options = {}) {
    const { detectRenames: enableRenames = false, detectCopies: enableCopies = false, similarityThreshold = 50, pathspecs, excludePaths, detectBinary = false, recursive = true } = options;
    // Handle null on both sides
    if (oldTreeSha === null && newTreeSha === null) {
        return {
            entries: [],
            stats: { added: 0, deleted: 0, modified: 0, renamed: 0, copied: 0 }
        };
    }
    // Get old tree entries
    let oldEntries = new Map();
    if (oldTreeSha !== null) {
        const oldTree = await store.getTree(oldTreeSha);
        if (!oldTree) {
            throw new Error(`Tree not found: ${oldTreeSha}`);
        }
        if (recursive) {
            const entries = await walkTree(store, oldTreeSha);
            for (const entry of entries) {
                oldEntries.set(entry.fullPath, entry);
            }
        }
        else {
            for (const entry of oldTree.entries) {
                oldEntries.set(entry.name, { ...entry, fullPath: entry.name });
            }
        }
    }
    // Get new tree entries
    let newEntries = new Map();
    if (newTreeSha !== null) {
        const newTree = await store.getTree(newTreeSha);
        if (!newTree) {
            throw new Error(`Tree not found: ${newTreeSha}`);
        }
        if (recursive) {
            const entries = await walkTree(store, newTreeSha);
            for (const entry of entries) {
                newEntries.set(entry.fullPath, entry);
            }
        }
        else {
            for (const entry of newTree.entries) {
                newEntries.set(entry.name, { ...entry, fullPath: entry.name });
            }
        }
    }
    const diffEntries = [];
    // Find deleted and modified files
    for (const [path, oldEntry] of oldEntries) {
        const newEntry = newEntries.get(path);
        if (!newEntry) {
            // File was deleted
            diffEntries.push({
                path,
                status: DiffStatus.DELETED,
                oldMode: oldEntry.mode,
                newMode: null,
                oldSha: oldEntry.sha,
                newSha: null
            });
        }
        else if (oldEntry.sha !== newEntry.sha || oldEntry.mode !== newEntry.mode) {
            // File was modified or type changed
            const oldType = getModeType(oldEntry.mode);
            const newType = getModeType(newEntry.mode);
            if (oldType !== newType) {
                // Type changed (e.g., file to symlink)
                diffEntries.push({
                    path,
                    status: DiffStatus.TYPE_CHANGED,
                    oldMode: oldEntry.mode,
                    newMode: newEntry.mode,
                    oldSha: oldEntry.sha,
                    newSha: newEntry.sha
                });
            }
            else {
                // Content or mode modified
                diffEntries.push({
                    path,
                    status: DiffStatus.MODIFIED,
                    oldMode: oldEntry.mode,
                    newMode: newEntry.mode,
                    oldSha: oldEntry.sha,
                    newSha: newEntry.sha
                });
            }
        }
    }
    // Find added files
    for (const [path, newEntry] of newEntries) {
        if (!oldEntries.has(path)) {
            diffEntries.push({
                path,
                status: DiffStatus.ADDED,
                oldMode: null,
                newMode: newEntry.mode,
                oldSha: null,
                newSha: newEntry.sha
            });
        }
    }
    // Detect binary files if enabled
    if (detectBinary) {
        for (const entry of diffEntries) {
            const sha = entry.newSha || entry.oldSha;
            if (sha) {
                const blob = await store.getBlob(sha);
                if (blob) {
                    entry.isBinary = isBinaryContent(blob);
                }
            }
        }
    }
    // Detect renames if enabled
    let finalEntries = diffEntries;
    if (enableRenames) {
        finalEntries = await detectRenames(store, finalEntries, { similarityThreshold });
    }
    // Detect copies if enabled
    if (enableCopies) {
        // Build map of existing paths from old tree
        const existingPaths = new Map();
        for (const [path, entry] of oldEntries) {
            existingPaths.set(path, entry.sha);
        }
        finalEntries = await detectCopies(store, finalEntries, existingPaths, { similarityThreshold });
    }
    // Apply path filters
    if (pathspecs || excludePaths) {
        finalEntries = filterByPathspecs(finalEntries, pathspecs, excludePaths);
    }
    // Calculate stats
    const stats = {
        added: 0,
        deleted: 0,
        modified: 0,
        renamed: 0,
        copied: 0
    };
    for (const entry of finalEntries) {
        switch (entry.status) {
            case DiffStatus.ADDED:
                stats.added++;
                break;
            case DiffStatus.DELETED:
                stats.deleted++;
                break;
            case DiffStatus.MODIFIED:
            case DiffStatus.TYPE_CHANGED:
                stats.modified++;
                break;
            case DiffStatus.RENAMED:
                stats.renamed++;
                break;
            case DiffStatus.COPIED:
                stats.copied++;
                break;
        }
    }
    return { entries: finalEntries, stats };
}
/**
 * Detect renames in a set of diff entries
 *
 * This function takes a list of added and deleted files and attempts to
 * match them based on content similarity to detect renames.
 *
 * @param store - Object store for retrieving blob contents
 * @param entries - Initial diff entries (before rename detection)
 * @param options - Diff options (particularly similarityThreshold)
 * @returns Promise resolving to entries with renames detected
 */
export async function detectRenames(store, entries, options = {}) {
    const { similarityThreshold = 50 } = options;
    const deleted = entries.filter(e => e.status === DiffStatus.DELETED);
    const added = entries.filter(e => e.status === DiffStatus.ADDED);
    const other = entries.filter(e => e.status !== DiffStatus.DELETED && e.status !== DiffStatus.ADDED);
    const matchedDeleted = new Set();
    const matchedAdded = new Set();
    const renames = [];
    // Try to match deleted files with added files
    for (const del of deleted) {
        if (matchedDeleted.has(del.path))
            continue;
        let bestMatch = null;
        let bestSimilarity = 0;
        for (const add of added) {
            if (matchedAdded.has(add.path))
                continue;
            // Check if same SHA (exact rename)
            if (del.oldSha === add.newSha) {
                bestMatch = add;
                bestSimilarity = 100;
                break;
            }
            // Calculate similarity if both SHAs exist
            if (del.oldSha && add.newSha) {
                const similarity = await calculateSimilarity(store, del.oldSha, add.newSha);
                if (similarity >= similarityThreshold && similarity > bestSimilarity) {
                    bestMatch = add;
                    bestSimilarity = similarity;
                }
            }
        }
        if (bestMatch && bestSimilarity >= similarityThreshold) {
            matchedDeleted.add(del.path);
            matchedAdded.add(bestMatch.path);
            renames.push({
                path: bestMatch.path,
                oldPath: del.path,
                status: DiffStatus.RENAMED,
                oldMode: del.oldMode,
                newMode: bestMatch.newMode,
                oldSha: del.oldSha,
                newSha: bestMatch.newSha,
                similarity: bestSimilarity
            });
        }
    }
    // Collect unmatched deleted and added entries
    const result = [...other, ...renames];
    for (const del of deleted) {
        if (!matchedDeleted.has(del.path)) {
            result.push(del);
        }
    }
    for (const add of added) {
        if (!matchedAdded.has(add.path)) {
            result.push(add);
        }
    }
    return result;
}
/**
 * Detect copies in a set of diff entries
 *
 * This function takes a list of diff entries and attempts to detect
 * if any added files are copies of existing files.
 *
 * @param store - Object store for retrieving blob contents
 * @param entries - Initial diff entries
 * @param existingPaths - Map of existing paths to their SHAs
 * @param options - Diff options
 * @returns Promise resolving to entries with copies detected
 */
export async function detectCopies(store, entries, existingPaths, options = {}) {
    const { similarityThreshold = 50 } = options;
    const result = [];
    for (const entry of entries) {
        if (entry.status !== DiffStatus.ADDED) {
            result.push(entry);
            continue;
        }
        let bestMatch = null;
        let bestSimilarity = 0;
        for (const [path, sha] of existingPaths) {
            // Check for exact match
            if (sha === entry.newSha) {
                bestMatch = { path, sha };
                bestSimilarity = 100;
                break;
            }
            // Calculate similarity
            if (entry.newSha) {
                const similarity = await calculateSimilarity(store, sha, entry.newSha);
                if (similarity >= similarityThreshold && similarity > bestSimilarity) {
                    bestMatch = { path, sha };
                    bestSimilarity = similarity;
                }
            }
        }
        if (bestMatch && bestSimilarity >= similarityThreshold) {
            result.push({
                path: entry.path,
                oldPath: bestMatch.path,
                status: DiffStatus.COPIED,
                oldMode: entry.newMode, // Use same mode for copied source
                newMode: entry.newMode,
                oldSha: bestMatch.sha,
                newSha: entry.newSha,
                similarity: bestSimilarity
            });
        }
        else {
            result.push(entry);
        }
    }
    return result;
}
/**
 * Compare a tree to the index (staging area)
 *
 * @param store - Object store for retrieving tree contents
 * @param treeSha - SHA of the tree to compare (typically HEAD)
 * @param index - Index entries to compare against
 * @param options - Diff options
 * @returns Promise resolving to diff result
 */
export async function diffTreeToIndex(store, treeSha, index, options = {}) {
    // Get tree entries
    const treeEntries = new Map();
    if (treeSha !== null) {
        const entries = await walkTree(store, treeSha);
        for (const entry of entries) {
            treeEntries.set(entry.fullPath, { mode: entry.mode, sha: entry.sha });
        }
    }
    // Build index map
    const indexEntries = new Map();
    for (const entry of index) {
        if (entry.stage === 0) {
            indexEntries.set(entry.path, entry);
        }
    }
    const diffEntries = [];
    // Find deleted and modified files
    for (const [path, treeEntry] of treeEntries) {
        const indexEntry = indexEntries.get(path);
        if (!indexEntry) {
            // File was deleted (in index)
            diffEntries.push({
                path,
                status: DiffStatus.DELETED,
                oldMode: treeEntry.mode,
                newMode: null,
                oldSha: treeEntry.sha,
                newSha: null
            });
        }
        else if (treeEntry.sha !== indexEntry.sha || treeEntry.mode !== indexEntry.mode) {
            // File was modified
            diffEntries.push({
                path,
                status: DiffStatus.MODIFIED,
                oldMode: treeEntry.mode,
                newMode: indexEntry.mode,
                oldSha: treeEntry.sha,
                newSha: indexEntry.sha
            });
        }
    }
    // Find added files
    for (const [path, indexEntry] of indexEntries) {
        if (!treeEntries.has(path)) {
            diffEntries.push({
                path,
                status: DiffStatus.ADDED,
                oldMode: null,
                newMode: indexEntry.mode,
                oldSha: null,
                newSha: indexEntry.sha
            });
        }
    }
    // Apply filters if needed
    let finalEntries = diffEntries;
    if (options.pathspecs || options.excludePaths) {
        finalEntries = filterByPathspecs(finalEntries, options.pathspecs, options.excludePaths);
    }
    // Calculate stats
    const stats = {
        added: 0,
        deleted: 0,
        modified: 0,
        renamed: 0,
        copied: 0
    };
    for (const entry of finalEntries) {
        switch (entry.status) {
            case DiffStatus.ADDED:
                stats.added++;
                break;
            case DiffStatus.DELETED:
                stats.deleted++;
                break;
            case DiffStatus.MODIFIED:
                stats.modified++;
                break;
            case DiffStatus.RENAMED:
                stats.renamed++;
                break;
            case DiffStatus.COPIED:
                stats.copied++;
                break;
        }
    }
    return { entries: finalEntries, stats };
}
/**
 * Compare a tree to working directory entries
 *
 * @param store - Object store for retrieving tree contents
 * @param treeSha - SHA of the tree to compare
 * @param workingEntries - Working directory file entries
 * @param options - Diff options
 * @returns Promise resolving to diff result
 */
export async function diffTreeToWorktree(store, treeSha, workingEntries, options = {}) {
    // This is essentially the same as diffTreeToIndex
    // Working directory entries are represented the same way
    return diffTreeToIndex(store, treeSha, workingEntries, options);
}
//# sourceMappingURL=tree-diff.js.map