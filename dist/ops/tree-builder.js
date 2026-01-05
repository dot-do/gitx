/**
 * Tree Builder - builds git tree objects from index entries
 *
 * Supports:
 * - File modes (100644 regular, 100755 executable, 040000 directory, 120000 symlink, 160000 submodule)
 * - Proper tree entry format (mode + space + name + null + sha)
 * - Sorted entries (git requires lexicographic ordering)
 * - Nested tree building for directory hierarchies
 * - Tree SHA computation
 * - Tree deduplication
 */
import { hexToBytes } from '../utils/hash';
// Valid file modes in git
const VALID_MODES = new Set(['100644', '100755', '040000', '120000', '160000']);
// Text encoder/decoder
const encoder = new TextEncoder();
/**
 * Validate an index entry
 */
function validateEntry(entry) {
    // Check mode
    if (!VALID_MODES.has(entry.mode)) {
        throw new Error(`Invalid file mode: ${entry.mode}`);
    }
    // Check SHA format (40 hex characters)
    if (!/^[0-9a-f]{40}$/.test(entry.sha)) {
        throw new Error(`Invalid SHA format: ${entry.sha}`);
    }
    // Check path
    if (!entry.path || entry.path.length === 0) {
        throw new Error('Empty path not allowed');
    }
    if (entry.path.startsWith('/')) {
        throw new Error('Path must not start with /');
    }
    if (entry.path.includes('//')) {
        throw new Error('Path must not contain double slashes');
    }
    // Check for . or .. components
    const parts = entry.path.split('/');
    for (const part of parts) {
        if (part === '.' || part === '..') {
            throw new Error(`Path must not contain . or .. components: ${entry.path}`);
        }
    }
}
/**
 * Build a tree hierarchy from index entries
 */
export function buildTreeHierarchy(entries) {
    const root = {
        name: '',
        path: '',
        isDirectory: true,
        children: new Map()
    };
    for (const entry of entries) {
        const parts = entry.path.split('/');
        let current = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            const currentPath = parts.slice(0, i + 1).join('/');
            if (!current.children.has(part)) {
                const node = {
                    name: part,
                    path: currentPath,
                    isDirectory: !isLast,
                    children: new Map(),
                    entry: isLast ? entry : undefined
                };
                current.children.set(part, node);
            }
            else if (isLast) {
                // Update entry for duplicate paths (last one wins)
                const existing = current.children.get(part);
                existing.entry = entry;
                existing.isDirectory = false;
            }
            current = current.children.get(part);
        }
    }
    return root;
}
/**
 * Sort tree entries according to git conventions
 * Directories are sorted as if they have a trailing slash
 */
export function sortTreeEntries(entries) {
    return [...entries].sort((a, b) => {
        // Directories sort as if they have trailing slash
        const aName = a.mode === '040000' ? a.name + '/' : a.name;
        const bName = b.mode === '040000' ? b.name + '/' : b.name;
        // Use byte-wise comparison (localeCompare with raw mode)
        if (aName < bName)
            return -1;
        if (aName > bName)
            return 1;
        return 0;
    });
}
/**
 * Create tree object data from entries
 */
function createTreeData(entries) {
    // Sort entries
    const sorted = sortTreeEntries(entries);
    // Build entry content
    const entryParts = [];
    for (const entry of sorted) {
        const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`);
        const sha20 = hexToBytes(entry.sha);
        const entryData = new Uint8Array(modeName.length + 20);
        entryData.set(modeName);
        entryData.set(sha20, modeName.length);
        entryParts.push(entryData);
    }
    // Combine all parts
    const totalLength = entryParts.reduce((sum, part) => sum + part.length, 0);
    const content = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of entryParts) {
        content.set(part, offset);
        offset += part.length;
    }
    return content;
}
/**
 * Create a tree object and store it
 */
export async function createTreeObject(store, entries) {
    const data = createTreeData(entries);
    const sha = await store.storeObject('tree', data);
    return { sha, type: 'tree', data };
}
/**
 * Deduplicate trees based on their content hash
 * Returns a map of canonical tree content to path, and mapping of paths to canonical paths
 */
export function deduplicateTrees(trees) {
    const contentToPath = new Map();
    const deduplicated = new Map();
    const mapping = new Map();
    for (const [path, entries] of trees) {
        // Create a content key from sorted entries
        const sorted = sortTreeEntries(entries);
        const key = sorted.map(e => `${e.mode}:${e.name}:${e.sha}`).join('|');
        if (contentToPath.has(key)) {
            // Duplicate - map to existing path
            mapping.set(path, contentToPath.get(key));
        }
        else {
            // New unique tree
            contentToPath.set(key, path);
            deduplicated.set(path, entries);
            mapping.set(path, path);
        }
    }
    return { deduplicated, mapping };
}
/**
 * Build tree from index entries
 * This is the main entry point for tree building
 */
export async function buildTreeFromIndex(store, entries) {
    // Validate all entries first
    for (const entry of entries) {
        validateEntry(entry);
    }
    // Build hierarchy
    const hierarchy = buildTreeHierarchy(entries);
    // Track stats
    let treeCount = 0;
    let uniqueTreeCount = 0;
    const treeContentToSha = new Map();
    /**
     * Recursively build tree for a node
     */
    async function buildNode(node) {
        const treeEntries = [];
        const nodeSubtrees = {};
        // Process children
        const children = Array.from(node.children.values());
        for (const child of children) {
            if (child.isDirectory) {
                // Recursively build subtree
                const subtreeResult = await buildNode(child);
                nodeSubtrees[child.name] = subtreeResult;
                treeEntries.push({
                    mode: '040000',
                    name: child.name,
                    sha: subtreeResult.sha
                });
            }
            else if (child.entry) {
                // File entry
                treeEntries.push({
                    mode: child.entry.mode,
                    name: child.name,
                    sha: child.entry.sha
                });
            }
        }
        // Sort entries
        const sortedEntries = sortTreeEntries(treeEntries);
        treeCount++;
        // Check for deduplication
        const contentKey = sortedEntries.map(e => `${e.mode}:${e.name}:${e.sha}`).join('|');
        let sha;
        if (treeContentToSha.has(contentKey)) {
            // Reuse existing tree SHA
            sha = treeContentToSha.get(contentKey);
        }
        else {
            // Create new tree object
            const treeObj = await createTreeObject(store, sortedEntries);
            sha = treeObj.sha;
            treeContentToSha.set(contentKey, sha);
            uniqueTreeCount++;
        }
        return {
            sha,
            entries: sortedEntries,
            subtrees: nodeSubtrees
        };
    }
    // Build from root
    const result = await buildNode(hierarchy);
    // Convert BuildResult to BuildTreeResult format
    function convertToResult(br) {
        const subtreesConverted = {};
        for (const [name, sub] of Object.entries(br.subtrees)) {
            subtreesConverted[name] = convertToResult(sub);
        }
        return {
            sha: br.sha,
            entries: br.entries,
            treeCount,
            uniqueTreeCount,
            deduplicatedCount: treeCount - uniqueTreeCount,
            subtrees: Object.keys(subtreesConverted).length > 0 ? subtreesConverted : undefined
        };
    }
    return convertToResult(result);
}
//# sourceMappingURL=tree-builder.js.map