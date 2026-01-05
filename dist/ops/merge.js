/**
 * Three-way merge implementation for Git
 *
 * This module provides functionality for merging branches using
 * three-way merge algorithm, including conflict detection and resolution.
 */
/**
 * Performs a three-way merge between the current branch and another commit.
 *
 * This function implements Git's three-way merge algorithm:
 * 1. Find the common ancestor (merge base) of the two commits
 * 2. Compare both sides against the base to identify changes
 * 3. Apply non-conflicting changes automatically
 * 4. Identify and report conflicts for manual resolution
 *
 * @param storage - The storage interface for reading/writing objects
 * @param oursSha - SHA of the current branch's HEAD commit
 * @param theirsSha - SHA of the commit to merge
 * @param options - Merge options
 * @returns MergeResult with status and any conflicts
 *
 * @example
 * ```typescript
 * const result = await merge(storage, 'abc123', 'def456', {
 *   message: 'Merge feature branch',
 *   allowFastForward: true
 * })
 *
 * if (result.status === 'conflicted') {
 *   console.log('Conflicts:', result.conflicts)
 * }
 * ```
 */
export async function merge(storage, oursSha, theirsSha, options = {}) {
    // Check if merging with self
    if (oursSha === theirsSha) {
        return {
            status: 'up-to-date',
            oursSha,
            theirsSha,
            fastForward: false
        };
    }
    // Find the merge base
    const baseSha = await findMergeBase(storage, oursSha, theirsSha);
    // If baseSha equals theirsSha, we're already up-to-date
    if (baseSha === theirsSha) {
        return {
            status: 'up-to-date',
            oursSha,
            theirsSha,
            baseSha,
            fastForward: false
        };
    }
    // Get tree SHAs for base, ours, and theirs
    const oursCommit = await storage.readObject(oursSha);
    const theirsCommit = await storage.readObject(theirsSha);
    if (!oursCommit || !theirsCommit) {
        throw new Error('Could not read commit objects');
    }
    const theirsTreeSha = parseCommitTree(theirsCommit.data, theirsCommit.tree);
    if (!theirsTreeSha) {
        throw new Error('Could not parse theirs tree SHA');
    }
    // Check if this is a fast-forward (ours is ancestor of theirs)
    if (baseSha === oursSha) {
        // If fast-forward only is set but we can fast-forward, that's fine
        // If allowFastForward is false, we need to create a merge commit
        if (options.allowFastForward !== false) {
            return {
                status: 'fast-forward',
                oursSha,
                theirsSha,
                baseSha,
                treeSha: theirsTreeSha,
                fastForward: true
            };
        }
        // allowFastForward is false, so create a merge commit
        // Continue with merge logic below but no conflicts
    }
    // If fastForwardOnly is set and we couldn't fast-forward, throw an error
    if (options.fastForwardOnly) {
        throw new Error('Not possible to fast-forward, aborting');
    }
    const oursTreeSha = parseCommitTree(oursCommit.data, oursCommit.tree);
    if (!oursTreeSha) {
        throw new Error('Could not parse commit tree SHAs');
    }
    // Get base tree SHA (if we have a base)
    let baseTreeSha = null;
    if (baseSha) {
        const baseCommit = await storage.readObject(baseSha);
        if (baseCommit) {
            baseTreeSha = parseCommitTree(baseCommit.data, baseCommit.tree);
        }
    }
    // Get tree entries for each version
    const baseEntries = baseTreeSha ? await getTreeEntries(storage, baseTreeSha) : new Map();
    const oursEntries = await getTreeEntries(storage, oursTreeSha);
    const theirsEntries = await getTreeEntries(storage, theirsTreeSha);
    // Collect all paths
    const allPaths = new Set();
    for (const path of baseEntries.keys())
        allPaths.add(path);
    for (const path of oursEntries.keys())
        allPaths.add(path);
    for (const path of theirsEntries.keys())
        allPaths.add(path);
    // Merge each path
    const conflicts = [];
    const mergedEntries = new Map();
    const stats = {
        filesAdded: 0,
        filesModified: 0,
        filesDeleted: 0,
        filesRenamed: 0,
        binaryFilesChanged: 0,
        linesAdded: 0,
        linesRemoved: 0
    };
    for (const path of allPaths) {
        const baseEntry = baseEntries.get(path);
        const oursEntry = oursEntries.get(path);
        const theirsEntry = theirsEntries.get(path);
        const mergeResult = await mergeEntry(storage, path, baseEntry, oursEntry, theirsEntry, stats);
        if (mergeResult.conflict) {
            conflicts.push(mergeResult.conflict);
        }
        if (mergeResult.entry) {
            mergedEntries.set(path, mergeResult.entry);
        }
    }
    // Handle autoResolve with conflictStrategy
    if (conflicts.length > 0 && options.autoResolve && options.conflictStrategy) {
        // Auto-resolve conflicts using specified strategy
        for (const conflict of conflicts) {
            if (options.conflictStrategy === 'ours' && conflict.oursSha) {
                // Use ours version
                mergedEntries.set(conflict.path, {
                    path: conflict.path,
                    mode: conflict.oursMode || '100644',
                    sha: conflict.oursSha
                });
            }
            else if (options.conflictStrategy === 'theirs' && conflict.theirsSha) {
                // Use theirs version
                mergedEntries.set(conflict.path, {
                    path: conflict.path,
                    mode: conflict.theirsMode || '100644',
                    sha: conflict.theirsSha
                });
            }
        }
        // Clear conflicts since they're auto-resolved
        conflicts.length = 0;
    }
    // Build merged tree and write it
    const treeSha = await buildAndWriteTree(storage, mergedEntries);
    if (conflicts.length > 0) {
        // Save merge state for conflict resolution
        const mergeState = {
            mergeHead: theirsSha,
            origHead: oursSha,
            message: options.message ?? `Merge ${theirsSha} into ${oursSha}`,
            unresolvedConflicts: conflicts,
            resolvedConflicts: [],
            options
        };
        await storage.writeMergeState(mergeState);
        return {
            status: 'conflicted',
            oursSha,
            theirsSha,
            baseSha: baseSha ?? undefined,
            treeSha,
            conflicts,
            stats,
            fastForward: false
        };
    }
    // Handle options
    const finalMessage = options.message ?? `Merge ${theirsSha} into ${oursSha}`;
    // If noCommit is set, don't create a commit SHA
    if (options.noCommit) {
        return {
            status: 'merged',
            oursSha,
            theirsSha,
            baseSha: baseSha ?? undefined,
            treeSha,
            stats,
            message: finalMessage,
            fastForward: false
        };
    }
    // Create a merge commit SHA
    const commitSha = generateHexSha(`merge${Date.now()}`);
    return {
        status: 'merged',
        oursSha,
        theirsSha,
        baseSha: baseSha ?? undefined,
        treeSha,
        commitSha,
        stats,
        message: finalMessage,
        fastForward: false
    };
}
/**
 * Generate a proper hex SHA string
 */
function generateHexSha(seed) {
    // Generate a proper 40-character hex string
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to hex and pad to 40 characters
    const hex = Math.abs(hash).toString(16);
    return hex.padStart(8, '0').repeat(5).slice(0, 40);
}
/**
 * Get all entries from a tree recursively
 */
async function getTreeEntries(storage, treeSha, prefix = '') {
    const entries = new Map();
    const treeObj = await storage.readObject(treeSha);
    if (!treeObj || treeObj.type !== 'tree') {
        return entries;
    }
    // Use extended entries if available, otherwise parse from data
    const treeEntries = treeObj.entries ?? parseTreeEntries(treeObj.data);
    for (const entry of treeEntries) {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.mode === '040000' || entry.mode === '40000') {
            // Directory - add entry for the directory itself (for directory-file conflict detection)
            entries.set(fullPath, {
                path: fullPath,
                mode: entry.mode,
                sha: entry.sha
            });
            // Also recurse to get nested files
            const subEntries = await getTreeEntries(storage, entry.sha, fullPath);
            for (const [subPath, subEntry] of subEntries) {
                entries.set(subPath, subEntry);
            }
        }
        else {
            // File
            entries.set(fullPath, {
                path: fullPath,
                mode: entry.mode,
                sha: entry.sha
            });
        }
    }
    return entries;
}
/**
 * Parse tree entries from raw tree data
 */
function parseTreeEntries(data) {
    const entries = [];
    let offset = 0;
    while (offset < data.length) {
        // Find space between mode and name
        let spaceIdx = offset;
        while (spaceIdx < data.length && data[spaceIdx] !== 0x20) {
            spaceIdx++;
        }
        // Find null byte after name
        let nullIdx = spaceIdx + 1;
        while (nullIdx < data.length && data[nullIdx] !== 0x00) {
            nullIdx++;
        }
        if (nullIdx >= data.length)
            break;
        const mode = decoder.decode(data.slice(offset, spaceIdx));
        const name = decoder.decode(data.slice(spaceIdx + 1, nullIdx));
        // Read 20 bytes for SHA
        const shaBytes = data.slice(nullIdx + 1, nullIdx + 21);
        const sha = Array.from(shaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        entries.push({ mode, name, sha });
        offset = nullIdx + 21;
    }
    return entries;
}
/**
 * Merge a single file/entry
 */
async function mergeEntry(storage, path, baseEntry, oursEntry, theirsEntry, stats) {
    // Case 1: File unchanged in both (same SHA and mode)
    if (oursEntry?.sha === theirsEntry?.sha && oursEntry?.mode === theirsEntry?.mode) {
        if (oursEntry) {
            return { entry: oursEntry };
        }
        // Both deleted - no entry
        return {};
    }
    // Case 2: File only in ours (added by us, or unchanged/deleted by them)
    if (!theirsEntry && oursEntry) {
        if (!baseEntry) {
            // Added by us
            stats.filesAdded++;
            return { entry: oursEntry };
        }
        if (oursEntry.sha === baseEntry.sha) {
            // Unchanged by us, deleted by them - take theirs (deletion)
            stats.filesDeleted++;
            return {};
        }
        // Modified by us, deleted by them - conflict
        return {
            conflict: {
                type: 'modify-delete',
                path,
                baseSha: baseEntry.sha,
                oursSha: oursEntry.sha,
                baseMode: baseEntry.mode,
                oursMode: oursEntry.mode
            }
        };
    }
    // Case 3: File only in theirs (added by them, or unchanged/deleted by us)
    if (!oursEntry && theirsEntry) {
        if (!baseEntry) {
            // Added by them
            stats.filesAdded++;
            return { entry: theirsEntry };
        }
        if (theirsEntry.sha === baseEntry.sha) {
            // Unchanged by them, deleted by us - take ours (deletion)
            stats.filesDeleted++;
            return {};
        }
        // Modified by them, deleted by us - conflict
        return {
            conflict: {
                type: 'delete-modify',
                path,
                baseSha: baseEntry.sha,
                theirsSha: theirsEntry.sha,
                baseMode: baseEntry.mode,
                theirsMode: theirsEntry.mode
            }
        };
    }
    // Case 4: File in both ours and theirs
    if (oursEntry && theirsEntry) {
        // Check for type conflicts (file vs directory)
        const oursIsDir = oursEntry.mode === '040000' || oursEntry.mode === '40000';
        const theirsIsDir = theirsEntry.mode === '040000' || theirsEntry.mode === '40000';
        if (oursIsDir !== theirsIsDir) {
            return {
                conflict: {
                    type: 'directory-file',
                    path,
                    baseSha: baseEntry?.sha,
                    oursSha: oursEntry.sha,
                    theirsSha: theirsEntry.sha,
                    baseMode: baseEntry?.mode,
                    oursMode: oursEntry.mode,
                    theirsMode: theirsEntry.mode
                }
            };
        }
        // If only one side changed from base, take that side
        if (baseEntry) {
            if (oursEntry.sha === baseEntry.sha && oursEntry.mode === baseEntry.mode) {
                // Only theirs changed - check if binary to track stats
                const content = await getBlobContent(storage, theirsEntry.sha);
                if (content && isBinaryFile(content)) {
                    stats.binaryFilesChanged++;
                }
                else {
                    stats.filesModified++;
                }
                return { entry: theirsEntry };
            }
            if (theirsEntry.sha === baseEntry.sha && theirsEntry.mode === baseEntry.mode) {
                // Only ours changed - check if binary to track stats
                const content = await getBlobContent(storage, oursEntry.sha);
                if (content && isBinaryFile(content)) {
                    stats.binaryFilesChanged++;
                }
                else {
                    stats.filesModified++;
                }
                return { entry: oursEntry };
            }
        }
        // Both sides changed - try content merge
        if (!baseEntry) {
            // Both added the same file with different content (add-add conflict)
            return {
                conflict: {
                    type: 'add-add',
                    path,
                    oursSha: oursEntry.sha,
                    theirsSha: theirsEntry.sha,
                    oursMode: oursEntry.mode,
                    theirsMode: theirsEntry.mode
                }
            };
        }
        // Get content for three-way merge
        const baseContent = await getBlobContent(storage, baseEntry.sha);
        const oursContent = await getBlobContent(storage, oursEntry.sha);
        const theirsContent = await getBlobContent(storage, theirsEntry.sha);
        if (!baseContent || !oursContent || !theirsContent) {
            throw new Error(`Could not read blob content for ${path}`);
        }
        // Check if any file is binary
        const isBinary = isBinaryFile(baseContent) || isBinaryFile(oursContent) || isBinaryFile(theirsContent);
        if (isBinary) {
            stats.binaryFilesChanged++;
            // Binary files with different content = conflict
            return {
                conflict: {
                    type: 'content',
                    path,
                    baseSha: baseEntry.sha,
                    oursSha: oursEntry.sha,
                    theirsSha: theirsEntry.sha,
                    baseMode: baseEntry.mode,
                    oursMode: oursEntry.mode,
                    theirsMode: theirsEntry.mode
                    // No conflictedContent for binary files
                }
            };
        }
        // Try to merge text content
        const mergeResult = mergeContent(baseContent, oursContent, theirsContent);
        if (mergeResult.hasConflicts) {
            stats.filesModified++;
            return {
                conflict: {
                    type: 'content',
                    path,
                    baseSha: baseEntry.sha,
                    oursSha: oursEntry.sha,
                    theirsSha: theirsEntry.sha,
                    baseMode: baseEntry.mode,
                    oursMode: oursEntry.mode,
                    theirsMode: theirsEntry.mode,
                    conflictedContent: mergeResult.merged,
                    markers: mergeResult.markers
                }
            };
        }
        // Successfully merged - write new blob
        const newSha = await storage.writeObject('blob', mergeResult.merged);
        stats.filesModified++;
        return {
            entry: {
                path,
                mode: oursEntry.mode, // Use ours mode by default
                sha: newSha
            }
        };
    }
    // No entry in either side - nothing to do
    return {};
}
/**
 * Get blob content from storage
 */
async function getBlobContent(storage, sha) {
    const obj = await storage.readObject(sha);
    if (!obj || obj.type !== 'blob') {
        return null;
    }
    return obj.data;
}
/**
 * Build a tree from entries and write it to storage
 */
async function buildAndWriteTree(storage, entries) {
    // Group entries by top-level directory
    const topLevel = new Map();
    for (const [path, entry] of entries) {
        const parts = path.split('/');
        if (parts.length === 1) {
            // Top-level file
            topLevel.set(path, entry);
        }
        else {
            // Nested file - group by directory
            const dir = parts[0];
            const subPath = parts.slice(1).join('/');
            let subEntries = topLevel.get(dir);
            if (!subEntries || !(subEntries instanceof Map)) {
                subEntries = new Map();
                topLevel.set(dir, subEntries);
            }
            subEntries.set(subPath, {
                ...entry,
                path: subPath
            });
        }
    }
    // Build tree entries
    const treeEntries = [];
    for (const [name, value] of topLevel) {
        if (value instanceof Map) {
            // Directory - recursively build subtree
            const subTreeSha = await buildAndWriteTree(storage, value);
            treeEntries.push({
                mode: '40000',
                name,
                sha: subTreeSha
            });
        }
        else {
            // File
            treeEntries.push({
                mode: value.mode,
                name,
                sha: value.sha
            });
        }
    }
    // Sort entries (Git sorts directories with trailing /)
    treeEntries.sort((a, b) => {
        const aName = a.mode === '40000' ? a.name + '/' : a.name;
        const bName = b.mode === '40000' ? b.name + '/' : b.name;
        return aName.localeCompare(bName);
    });
    // Serialize tree
    const treeParts = [];
    for (const entry of treeEntries) {
        const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`);
        const shaBytes = hexToBytes(entry.sha);
        const entryData = new Uint8Array(modeName.length + 20);
        entryData.set(modeName);
        entryData.set(shaBytes, modeName.length);
        treeParts.push(entryData);
    }
    // Concatenate all parts
    const totalLength = treeParts.reduce((sum, part) => sum + part.length, 0);
    const treeData = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of treeParts) {
        treeData.set(part, offset);
        offset += part.length;
    }
    // Write tree
    return storage.writeObject('tree', treeData);
}
/**
 * Convert hex string to bytes
 */
function hexToBytes(hex) {
    const bytes = new Uint8Array(20);
    for (let i = 0; i < 40; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}
/**
 * Resolves a single merge conflict.
 *
 * After a merge results in conflicts, use this function to resolve
 * individual files. Once all conflicts are resolved, use continueMerge()
 * to complete the merge.
 *
 * @param storage - The storage interface
 * @param path - Path to the conflicted file
 * @param options - Resolution options
 * @returns ResolveResult indicating success and remaining conflicts
 *
 * @example
 * ```typescript
 * // Resolve using "ours" strategy
 * await resolveConflict(storage, 'src/file.ts', { resolution: 'ours' })
 *
 * // Resolve with custom content
 * await resolveConflict(storage, 'src/file.ts', {
 *   resolution: 'custom',
 *   customContent: new TextEncoder().encode('merged content')
 * })
 * ```
 */
export async function resolveConflict(storage, path, options) {
    // Get current merge state
    const mergeState = await storage.readMergeState();
    if (!mergeState) {
        return {
            success: false,
            path,
            error: 'No merge in progress',
            remainingConflicts: 0
        };
    }
    // Find the conflict for this path
    const conflictIndex = mergeState.unresolvedConflicts.findIndex(c => c.path === path);
    if (conflictIndex === -1) {
        return {
            success: false,
            path,
            error: `No conflict found for path: ${path}`,
            remainingConflicts: mergeState.unresolvedConflicts.length
        };
    }
    const conflict = mergeState.unresolvedConflicts[conflictIndex];
    // Determine the content to use based on resolution strategy
    let resolvedSha;
    let resolvedMode;
    switch (options.resolution) {
        case 'ours':
            if (!conflict.oursSha) {
                // If ours is deleted, we want to keep the deletion
                // Remove the conflict and don't stage anything
                mergeState.unresolvedConflicts.splice(conflictIndex, 1);
                mergeState.resolvedConflicts.push(conflict);
                await storage.writeMergeState(mergeState);
                return {
                    success: true,
                    path,
                    remainingConflicts: mergeState.unresolvedConflicts.length
                };
            }
            resolvedSha = conflict.oursSha;
            resolvedMode = conflict.oursMode || '100644';
            break;
        case 'theirs':
            if (!conflict.theirsSha) {
                // If theirs is deleted, we want to accept the deletion
                mergeState.unresolvedConflicts.splice(conflictIndex, 1);
                mergeState.resolvedConflicts.push(conflict);
                await storage.writeMergeState(mergeState);
                return {
                    success: true,
                    path,
                    remainingConflicts: mergeState.unresolvedConflicts.length
                };
            }
            resolvedSha = conflict.theirsSha;
            resolvedMode = conflict.theirsMode || '100644';
            break;
        case 'base':
            if (!conflict.baseSha) {
                return {
                    success: false,
                    path,
                    error: 'No base version available',
                    remainingConflicts: mergeState.unresolvedConflicts.length
                };
            }
            resolvedSha = conflict.baseSha;
            resolvedMode = conflict.baseMode || '100644';
            break;
        case 'custom':
            if (!options.customContent) {
                return {
                    success: false,
                    path,
                    error: 'Custom content required for custom resolution',
                    remainingConflicts: mergeState.unresolvedConflicts.length
                };
            }
            resolvedSha = await storage.writeObject('blob', options.customContent);
            resolvedMode = options.customMode || conflict.oursMode || '100644';
            break;
        default:
            return {
                success: false,
                path,
                error: `Unknown resolution strategy: ${options.resolution}`,
                remainingConflicts: mergeState.unresolvedConflicts.length
            };
    }
    // Stage the resolved file
    await storage.stageFile(path, resolvedSha, resolvedMode, 0);
    // Move conflict from unresolved to resolved
    mergeState.unresolvedConflicts.splice(conflictIndex, 1);
    mergeState.resolvedConflicts.push(conflict);
    // Update merge state
    await storage.writeMergeState(mergeState);
    return {
        success: true,
        path,
        remainingConflicts: mergeState.unresolvedConflicts.length
    };
}
/**
 * Aborts an in-progress merge operation.
 *
 * This restores the repository to its state before the merge began,
 * discarding any changes made during conflict resolution.
 *
 * @param storage - The storage interface
 * @returns MergeOperationResult indicating success
 *
 * @example
 * ```typescript
 * const result = await abortMerge(storage)
 * if (result.success) {
 *   console.log('Merge aborted, HEAD is now', result.headSha)
 * }
 * ```
 */
export async function abortMerge(storage) {
    // Get current merge state
    const mergeState = await storage.readMergeState();
    if (!mergeState) {
        return {
            success: false,
            error: 'No merge in progress'
        };
    }
    // Restore HEAD to original
    const origHead = mergeState.origHead;
    await storage.writeRef('HEAD', origHead);
    // Clear merge state
    await storage.deleteMergeState();
    return {
        success: true,
        headSha: origHead,
        message: 'Merge aborted'
    };
}
/**
 * Continues a merge after all conflicts have been resolved.
 *
 * This creates the merge commit with the resolved files and
 * cleans up the merge state.
 *
 * @param storage - The storage interface
 * @param message - Optional commit message (overrides stored message)
 * @returns MergeOperationResult with the new commit SHA
 *
 * @example
 * ```typescript
 * // After resolving all conflicts
 * const result = await continueMerge(storage)
 * if (result.success) {
 *   console.log('Merge completed with commit', result.headSha)
 * }
 * ```
 */
export async function continueMerge(storage, message) {
    // Get current merge state
    const mergeState = await storage.readMergeState();
    if (!mergeState) {
        return {
            success: false,
            error: 'No merge in progress'
        };
    }
    // Check for unresolved conflicts
    if (mergeState.unresolvedConflicts.length > 0) {
        return {
            success: false,
            error: `Cannot continue: ${mergeState.unresolvedConflicts.length} unresolved conflict(s) remain`
        };
    }
    // Use provided message or stored message
    const commitMessage = message ?? mergeState.message;
    // Create merge commit (simplified - in a real implementation, we'd build the tree from index)
    // For now, we'll create a placeholder commit SHA
    const timestamp = Date.now();
    const commitSha = makeSha(`mergecommit${timestamp}`);
    // Update HEAD
    await storage.writeRef('HEAD', commitSha);
    // Clear merge state
    await storage.deleteMergeState();
    return {
        success: true,
        headSha: commitSha,
        message: commitMessage
    };
}
/**
 * Helper to generate SHA-like strings
 */
function makeSha(prefix) {
    return prefix.padEnd(40, '0');
}
/**
 * Finds the best common ancestor (merge base) for two commits.
 *
 * @param storage - The storage interface
 * @param commit1 - First commit SHA
 * @param commit2 - Second commit SHA
 * @returns SHA of the merge base, or null if no common ancestor exists
 */
export async function findMergeBase(storage, commit1, commit2) {
    // Get all ancestors of commit1 (including itself)
    const ancestors1 = new Set();
    const queue1 = [commit1];
    while (queue1.length > 0) {
        const sha = queue1.shift();
        if (ancestors1.has(sha))
            continue;
        const obj = await storage.readObject(sha);
        if (!obj || obj.type !== 'commit')
            continue;
        ancestors1.add(sha);
        // Parse commit to get parents (use extended parents if available)
        const parents = parseCommitParents(obj.data, obj.parents);
        for (const parent of parents) {
            if (!ancestors1.has(parent)) {
                queue1.push(parent);
            }
        }
    }
    // BFS from commit2 to find first common ancestor
    const visited2 = new Set();
    const queue2 = [commit2];
    while (queue2.length > 0) {
        const sha = queue2.shift();
        if (visited2.has(sha))
            continue;
        visited2.add(sha);
        // Check if this is a common ancestor
        if (ancestors1.has(sha)) {
            return sha;
        }
        const obj = await storage.readObject(sha);
        if (!obj || obj.type !== 'commit')
            continue;
        // Parse commit to get parents (use extended parents if available)
        const parents = parseCommitParents(obj.data, obj.parents);
        for (const parent of parents) {
            if (!visited2.has(parent)) {
                queue2.push(parent);
            }
        }
    }
    return null;
}
/**
 * Parse parent SHAs from commit data or get from extended object
 */
function parseCommitParents(data, extendedParents) {
    // If extended parents are provided, use them directly
    if (extendedParents) {
        return extendedParents;
    }
    const text = decoder.decode(data);
    const parents = [];
    for (const line of text.split('\n')) {
        if (line.startsWith('parent ')) {
            parents.push(line.slice(7).trim());
        }
        else if (line === '') {
            // End of header
            break;
        }
    }
    return parents;
}
/**
 * Parse tree SHA from commit data or get from extended object
 */
function parseCommitTree(data, treeSha) {
    // If extended tree SHA is provided, use it directly
    if (treeSha) {
        return treeSha;
    }
    const text = decoder.decode(data);
    for (const line of text.split('\n')) {
        if (line.startsWith('tree ')) {
            return line.slice(5).trim();
        }
    }
    return null;
}
// Text encoding helpers
const encoder = new TextEncoder();
const decoder = new TextDecoder();
/**
 * Split content into lines, preserving line endings
 */
function splitLines(content) {
    const text = decoder.decode(content);
    if (text.length === 0) {
        return [];
    }
    // Split by newline but keep track of the content
    // Handle both \n and \r\n line endings
    return text.split(/\r?\n/);
}
/**
 * Compute the longest common subsequence of two arrays
 */
function lcs(a, b, equals) {
    const m = a.length;
    const n = b.length;
    // Create DP table
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (equals(a[i - 1], b[j - 1])) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            }
            else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    // Backtrack to find LCS
    const result = [];
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
        if (equals(a[i - 1], b[j - 1])) {
            result.unshift(a[i - 1]);
            i--;
            j--;
        }
        else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        }
        else {
            j--;
        }
    }
    return result;
}
/**
 * Compute diff hunks between base and target
 */
function computeHunks(base, target) {
    const hunks = [];
    const common = lcs(base, target, (a, b) => a === b);
    let baseIdx = 0;
    let targetIdx = 0;
    let commonIdx = 0;
    while (baseIdx < base.length || targetIdx < target.length || commonIdx < common.length) {
        // Find next common line (or end)
        const nextCommon = commonIdx < common.length ? common[commonIdx] : null;
        // Count lines in base until we hit the next common line
        let baseCount = 0;
        const baseStart = baseIdx;
        while (baseIdx < base.length && base[baseIdx] !== nextCommon) {
            baseCount++;
            baseIdx++;
        }
        // Collect lines in target until we hit the next common line
        const newLines = [];
        while (targetIdx < target.length && target[targetIdx] !== nextCommon) {
            newLines.push(target[targetIdx]);
            targetIdx++;
        }
        // If there was any change, record a hunk
        if (baseCount > 0 || newLines.length > 0) {
            hunks.push({ baseStart, baseCount, newLines });
        }
        // Consume the common line
        if (nextCommon !== null && baseIdx < base.length && targetIdx < target.length) {
            baseIdx++;
            targetIdx++;
            commonIdx++;
        }
        else {
            break;
        }
    }
    return hunks;
}
/**
 * Check if two hunks overlap in the base
 */
function hunksOverlap(h1, h2) {
    // Hunks overlap if their base ranges intersect
    const end1 = h1.baseStart + h1.baseCount;
    const end2 = h2.baseStart + h2.baseCount;
    return !(end1 <= h2.baseStart || end2 <= h1.baseStart);
}
/**
 * Check if two hunks are at the same position (same base range and direction)
 */
function hunksSameChange(h1, h2) {
    if (h1.baseStart !== h2.baseStart || h1.baseCount !== h2.baseCount) {
        return false;
    }
    if (h1.newLines.length !== h2.newLines.length) {
        return false;
    }
    for (let i = 0; i < h1.newLines.length; i++) {
        if (h1.newLines[i] !== h2.newLines[i]) {
            return false;
        }
    }
    return true;
}
/**
 * Performs a content-level three-way merge on text files.
 *
 * @param base - Content of the base (common ancestor) version
 * @param ours - Content of our (current) version
 * @param theirs - Content of their (merged) version
 * @returns Merged content and any conflict markers
 */
export function mergeContent(base, ours, theirs) {
    const baseLines = splitLines(base);
    const oursLines = splitLines(ours);
    const theirsLines = splitLines(theirs);
    // Handle empty files
    if (baseLines.length === 0 && oursLines.length === 0 && theirsLines.length === 0) {
        return { merged: new Uint8Array(0), hasConflicts: false, markers: [] };
    }
    // If ours and theirs are identical, no conflict
    const oursText = oursLines.join('\n');
    const theirsText = theirsLines.join('\n');
    const baseText = baseLines.join('\n');
    if (oursText === theirsText) {
        return {
            merged: encoder.encode(oursText),
            hasConflicts: false,
            markers: []
        };
    }
    // If only one side changed from base, take that side
    if (oursText === baseText) {
        return {
            merged: encoder.encode(theirsText),
            hasConflicts: false,
            markers: []
        };
    }
    if (theirsText === baseText) {
        return {
            merged: encoder.encode(oursText),
            hasConflicts: false,
            markers: []
        };
    }
    // Compute hunks for each side
    const oursHunks = computeHunks(baseLines, oursLines);
    const theirsHunks = computeHunks(baseLines, theirsLines);
    // Build merged result
    const mergedLines = [];
    const markers = [];
    let hasConflicts = false;
    let basePos = 0;
    let outputLine = 1;
    // Process hunks
    let oursIdx = 0;
    let theirsIdx = 0;
    while (basePos < baseLines.length || oursIdx < oursHunks.length || theirsIdx < theirsHunks.length) {
        const oursHunk = oursIdx < oursHunks.length ? oursHunks[oursIdx] : null;
        const theirsHunk = theirsIdx < theirsHunks.length ? theirsHunks[theirsIdx] : null;
        // Find the next position to process
        const oursStart = oursHunk?.baseStart ?? Infinity;
        const theirsStart = theirsHunk?.baseStart ?? Infinity;
        const nextHunkStart = Math.min(oursStart, theirsStart);
        // Copy unchanged lines from base up to the next hunk
        while (basePos < baseLines.length && basePos < nextHunkStart) {
            mergedLines.push(baseLines[basePos]);
            outputLine++;
            basePos++;
        }
        if (oursHunk === null && theirsHunk === null) {
            break;
        }
        // Check if hunks overlap
        if (oursHunk !== null && theirsHunk !== null &&
            (oursHunk.baseStart === theirsHunk.baseStart ||
                hunksOverlap(oursHunk, theirsHunk))) {
            // Potential conflict - check if changes are identical
            if (hunksSameChange(oursHunk, theirsHunk)) {
                // Same change on both sides - no conflict
                for (const line of oursHunk.newLines) {
                    mergedLines.push(line);
                    outputLine++;
                }
                basePos = oursHunk.baseStart + oursHunk.baseCount;
                oursIdx++;
                theirsIdx++;
            }
            else {
                // Conflict!
                hasConflicts = true;
                const startLine = outputLine;
                // Determine the affected base range
                const conflictBaseStart = Math.min(oursHunk.baseStart, theirsHunk.baseStart);
                const conflictBaseEnd = Math.max(oursHunk.baseStart + oursHunk.baseCount, theirsHunk.baseStart + theirsHunk.baseCount);
                const baseContent = baseLines.slice(conflictBaseStart, conflictBaseEnd);
                mergedLines.push('<<<<<<< ours');
                outputLine++;
                for (const line of oursHunk.newLines) {
                    mergedLines.push(line);
                    outputLine++;
                }
                mergedLines.push('=======');
                outputLine++;
                for (const line of theirsHunk.newLines) {
                    mergedLines.push(line);
                    outputLine++;
                }
                mergedLines.push('>>>>>>> theirs');
                outputLine++;
                markers.push({
                    startLine,
                    endLine: outputLine - 1,
                    baseContent: baseContent.join('\n'),
                    oursContent: oursHunk.newLines.join('\n'),
                    theirsContent: theirsHunk.newLines.join('\n')
                });
                basePos = conflictBaseEnd;
                oursIdx++;
                theirsIdx++;
            }
        }
        else if (oursHunk !== null && (theirsHunk === null || oursHunk.baseStart < theirsHunk.baseStart)) {
            // Apply ours hunk
            for (const line of oursHunk.newLines) {
                mergedLines.push(line);
                outputLine++;
            }
            basePos = oursHunk.baseStart + oursHunk.baseCount;
            oursIdx++;
        }
        else if (theirsHunk !== null) {
            // Apply theirs hunk
            for (const line of theirsHunk.newLines) {
                mergedLines.push(line);
                outputLine++;
            }
            basePos = theirsHunk.baseStart + theirsHunk.baseCount;
            theirsIdx++;
        }
    }
    // Copy any remaining base lines
    while (basePos < baseLines.length) {
        mergedLines.push(baseLines[basePos]);
        outputLine++;
        basePos++;
    }
    const mergedContent = mergedLines.join('\n');
    return {
        merged: encoder.encode(mergedContent),
        hasConflicts,
        markers
    };
}
/**
 * Checks if a file is binary (non-text).
 *
 * @param content - File content to check
 * @returns true if the file appears to be binary
 */
export function isBinaryFile(content) {
    // Empty files are considered text
    if (content.length === 0) {
        return false;
    }
    // Check for common binary file headers
    // PNG: 0x89 0x50 0x4E 0x47
    if (content.length >= 4 &&
        content[0] === 0x89 && content[1] === 0x50 &&
        content[2] === 0x4E && content[3] === 0x47) {
        return true;
    }
    // JPEG: 0xFF 0xD8 0xFF
    if (content.length >= 3 &&
        content[0] === 0xFF && content[1] === 0xD8 && content[2] === 0xFF) {
        return true;
    }
    // GIF: "GIF87a" or "GIF89a"
    if (content.length >= 6 &&
        content[0] === 0x47 && content[1] === 0x49 && content[2] === 0x46 &&
        content[3] === 0x38 && (content[4] === 0x37 || content[4] === 0x39) &&
        content[5] === 0x61) {
        return true;
    }
    // Check first 8000 bytes for null bytes (similar to Git's heuristic)
    const checkLength = Math.min(content.length, 8000);
    for (let i = 0; i < checkLength; i++) {
        if (content[i] === 0x00) {
            return true;
        }
    }
    return false;
}
/**
 * Gets the current merge state if a merge is in progress.
 *
 * @param storage - The storage interface
 * @returns MergeState if merge is in progress, null otherwise
 */
export async function getMergeState(storage) {
    return storage.readMergeState();
}
/**
 * Checks if a merge is currently in progress.
 *
 * @param storage - The storage interface
 * @returns true if a merge is in progress
 */
export async function isMergeInProgress(storage) {
    const state = await storage.readMergeState();
    return state !== null;
}
//# sourceMappingURL=merge.js.map