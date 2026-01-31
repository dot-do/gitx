/**
 * @fileoverview Tree Builder - builds git tree objects from index entries
 *
 * Provides functionality for creating Git tree objects from a flat list
 * of index entries, handling directory hierarchies, proper sorting,
 * and deduplication.
 *
 * @module ops/tree-builder
 */
import { hexToBytes } from '../objects/hash';
/** Valid file modes in git */
const VALID_MODES = new Set(['100644', '100755', '040000', '120000', '160000']);
/** Text encoder for creating tree data */
const encoder = new TextEncoder();
// =============================================================================
// Validation
// =============================================================================
function validateEntry(entry) {
    if (!VALID_MODES.has(entry.mode)) {
        throw new Error(`Invalid file mode: ${entry.mode}`);
    }
    if (!/^[0-9a-f]{40}$/.test(entry.sha)) {
        throw new Error(`Invalid SHA format: ${entry.sha}`);
    }
    if (!entry.path || entry.path.length === 0) {
        throw new Error('Empty path not allowed');
    }
    if (entry.path.startsWith('/')) {
        throw new Error('Path must not start with /');
    }
    if (entry.path.includes('//')) {
        throw new Error('Path must not contain double slashes');
    }
    const parts = entry.path.split('/');
    for (const part of parts) {
        if (part === '.' || part === '..') {
            throw new Error(`Path must not contain . or .. components: ${entry.path}`);
        }
    }
}
// =============================================================================
// Tree Building
// =============================================================================
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
 */
export function sortTreeEntries(entries) {
    return [...entries].sort((a, b) => {
        const aName = a.mode === '040000' ? a.name + '/' : a.name;
        const bName = b.mode === '040000' ? b.name + '/' : b.name;
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
    const sorted = sortTreeEntries(entries);
    const entryParts = [];
    for (const entry of sorted) {
        const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`);
        const sha20 = hexToBytes(entry.sha);
        const entryData = new Uint8Array(modeName.length + 20);
        entryData.set(modeName);
        entryData.set(sha20, modeName.length);
        entryParts.push(entryData);
    }
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
 */
export function deduplicateTrees(trees) {
    const contentToPath = new Map();
    const deduplicated = new Map();
    const mapping = new Map();
    for (const [path, entries] of trees) {
        const sorted = sortTreeEntries(entries);
        const key = sorted.map(e => `${e.mode}:${e.name}:${e.sha}`).join('|');
        if (contentToPath.has(key)) {
            mapping.set(path, contentToPath.get(key));
        }
        else {
            contentToPath.set(key, path);
            deduplicated.set(path, entries);
            mapping.set(path, path);
        }
    }
    return { deduplicated, mapping };
}
/**
 * Build tree from index entries
 */
export async function buildTreeFromIndex(store, entries) {
    for (const entry of entries) {
        validateEntry(entry);
    }
    const hierarchy = buildTreeHierarchy(entries);
    let treeCount = 0;
    let uniqueTreeCount = 0;
    const treeContentToSha = new Map();
    async function buildNode(node) {
        const treeEntries = [];
        const nodeSubtrees = {};
        const children = Array.from(node.children.values());
        for (const child of children) {
            if (child.isDirectory) {
                const subtreeResult = await buildNode(child);
                nodeSubtrees[child.name] = subtreeResult;
                treeEntries.push({
                    mode: '040000',
                    name: child.name,
                    sha: subtreeResult.sha
                });
            }
            else if (child.entry) {
                treeEntries.push({
                    mode: child.entry.mode,
                    name: child.name,
                    sha: child.entry.sha
                });
            }
        }
        const sortedEntries = sortTreeEntries(treeEntries);
        treeCount++;
        const contentKey = sortedEntries.map(e => `${e.mode}:${e.name}:${e.sha}`).join('|');
        let sha;
        if (treeContentToSha.has(contentKey)) {
            sha = treeContentToSha.get(contentKey);
        }
        else {
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
    const result = await buildNode(hierarchy);
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