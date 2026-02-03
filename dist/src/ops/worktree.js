/**
 * @fileoverview Git Worktree Operations
 *
 * Provides worktree management functionality for having multiple working trees
 * sharing the same repository. Worktrees allow checking out different branches
 * simultaneously without needing separate clones.
 *
 * ## Features
 *
 * - Worktree creation from any commit or branch
 * - Worktree listing with status information
 * - Worktree removal with lock checking
 * - Per-worktree ref management (HEAD isolation)
 * - Worktree locking/unlocking to prevent removal
 * - Pruning of stale worktree entries
 *
 * ## Usage Example
 *
 * ```typescript
 * import { addWorktree, listWorktrees, removeWorktree } from './ops/worktree'
 *
 * // Add a new worktree for a feature branch
 * const result = await addWorktree(refStore, {
 *   path: 'worktrees/feature-login',
 *   branch: 'feature/login',
 * })
 *
 * // List all worktrees
 * const trees = await listWorktrees(refStore)
 *
 * // Remove a worktree
 * await removeWorktree(refStore, { path: 'worktrees/feature-login' })
 * ```
 *
 * @module ops/worktree
 */
import { isValidBranchName, normalizeBranchName } from '../utils/branch-validation';
// ============================================================================
// Constants
// ============================================================================
/** Ref prefix for worktree-specific refs */
const WORKTREE_REF_PREFIX = 'refs/worktrees/';
/** Ref prefix for branch refs */
const BRANCH_REF_PREFIX = 'refs/heads/';
// Use WeakMap to associate worktree state with specific RefStore instances
const worktreeStores = new WeakMap();
/**
 * Gets the worktree store for a specific RefStore instance.
 * @internal
 */
function getWorktreeStore(refStore) {
    let store = worktreeStores.get(refStore);
    if (!store) {
        store = new Map();
        worktreeStores.set(refStore, store);
    }
    return store;
}
/**
 * Normalizes a worktree path for use as a consistent key.
 * Removes trailing slashes and normalizes separators.
 * @internal
 */
function normalizePath(path) {
    return path.replace(/\/+$/, '').replace(/\/+/g, '/');
}
/**
 * Gets the worktree ref name for a given path.
 * @internal
 */
function getWorktreeRefName(path) {
    const normalized = normalizePath(path).replace(/\//g, '-');
    return `${WORKTREE_REF_PREFIX}${normalized}/HEAD`;
}
// ============================================================================
// Worktree Operations
// ============================================================================
/**
 * Adds a new worktree.
 *
 * Creates a worktree entry that tracks an independent HEAD for the given path.
 * The worktree can check out a branch or be in detached HEAD state.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Worktree creation options
 * @returns Result of the worktree addition
 *
 * @throws {Error} If the path is empty
 * @throws {Error} If a worktree already exists at the path
 * @throws {Error} If the branch is already checked out in another worktree (unless force)
 * @throws {Error} If the branch name is invalid
 * @throws {Error} If the commit SHA or branch cannot be resolved
 *
 * @example
 * ```typescript
 * // Add worktree with existing branch
 * await addWorktree(refStore, {
 *   path: 'worktrees/feature',
 *   branch: 'feature/login',
 * })
 *
 * // Add worktree with new branch
 * await addWorktree(refStore, {
 *   path: 'worktrees/hotfix',
 *   branch: 'hotfix/urgent',
 *   createBranch: true,
 *   commitSha: 'abc123...',
 * })
 *
 * // Add detached HEAD worktree
 * await addWorktree(refStore, {
 *   path: 'worktrees/bisect',
 *   commitSha: 'abc123...',
 * })
 * ```
 */
export async function addWorktree(refStore, options) {
    const { path, branch, commitSha, createBranch = false, force = false, lock = false, lockReason, } = options;
    if (!path || !path.trim()) {
        throw new Error('Worktree path is required');
    }
    const normalizedPath = normalizePath(path);
    const store = getWorktreeStore(refStore);
    // Check if worktree already exists at this path
    if (store.has(normalizedPath)) {
        throw new Error(`Worktree already exists at '${normalizedPath}'`);
    }
    let resolvedSha;
    let headRef = null;
    if (branch) {
        // Validate branch name
        const branchName = normalizeBranchName(branch);
        if (!isValidBranchName(branchName)) {
            throw new Error(`Invalid branch name: ${branchName}`);
        }
        const fullBranchRef = `${BRANCH_REF_PREFIX}${branchName}`;
        if (createBranch) {
            // Creating a new branch - resolve start point
            if (commitSha) {
                resolvedSha = commitSha;
            }
            else {
                // Use current HEAD
                const headSymRef = await refStore.getSymbolicRef('HEAD');
                if (headSymRef) {
                    const sha = await refStore.getRef(headSymRef);
                    if (!sha) {
                        throw new Error('HEAD does not point to a valid commit');
                    }
                    resolvedSha = sha;
                }
                else {
                    resolvedSha = await refStore.getHead();
                }
            }
            // Check if branch already exists
            const existing = await refStore.getRef(fullBranchRef);
            if (existing) {
                throw new Error(`Branch '${branchName}' already exists`);
            }
            // Create the branch
            await refStore.setRef(fullBranchRef, resolvedSha);
            headRef = fullBranchRef;
        }
        else {
            // Checkout existing branch
            const sha = await refStore.getRef(fullBranchRef);
            if (!sha) {
                throw new Error(`Branch '${branchName}' not found`);
            }
            resolvedSha = sha;
            headRef = fullBranchRef;
            // Check if branch is already checked out in another worktree
            if (!force) {
                for (const [wtPath, entry] of store) {
                    if (entry.headRef === fullBranchRef) {
                        throw new Error(`Branch '${branchName}' is already checked out at '${wtPath}'`);
                    }
                }
                // Also check if main worktree has this branch checked out
                const mainHeadRef = await refStore.getSymbolicRef('HEAD');
                if (mainHeadRef === fullBranchRef) {
                    throw new Error(`Branch '${branchName}' is already checked out in the main worktree`);
                }
            }
        }
    }
    else if (commitSha) {
        // Detached HEAD worktree
        resolvedSha = commitSha;
        headRef = null;
    }
    else {
        // No branch or commit specified - use current HEAD
        const headSymRef = await refStore.getSymbolicRef('HEAD');
        if (headSymRef) {
            const sha = await refStore.getRef(headSymRef);
            if (!sha) {
                throw new Error('HEAD does not point to a valid commit');
            }
            resolvedSha = sha;
        }
        else {
            resolvedSha = await refStore.getHead();
        }
        headRef = null;
    }
    // Store the worktree ref for visibility via listRefs
    const wtRefName = getWorktreeRefName(normalizedPath);
    await refStore.setRef(wtRefName, resolvedSha);
    // Store worktree entry
    const entry = {
        path: normalizedPath,
        headRef,
        headSha: resolvedSha,
        locked: lock,
        prunable: false,
    };
    if (lock && lockReason !== undefined) {
        entry.lockReason = lockReason;
    }
    store.set(normalizedPath, entry);
    return {
        path: normalizedPath,
        branch: headRef ? normalizeBranchName(headRef) : null,
        sha: resolvedSha,
        created: true,
        locked: lock,
    };
}
/**
 * Lists all worktrees.
 *
 * Returns information about all worktrees including the main worktree
 * and any linked worktrees.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Listing options
 * @returns Array of worktree information
 *
 * @example
 * ```typescript
 * const worktrees = await listWorktrees(refStore)
 * for (const wt of worktrees) {
 *   const branch = wt.branch ? `[${wt.branch}]` : '(detached)'
 *   const lock = wt.locked ? ' (locked)' : ''
 *   console.log(`${wt.path} ${wt.sha.slice(0, 8)} ${branch}${lock}`)
 * }
 * ```
 */
export async function listWorktrees(refStore, options = {}) {
    const { includePrunable = true } = options;
    const store = getWorktreeStore(refStore);
    const result = [];
    // Add main worktree first
    const mainHeadRef = await refStore.getSymbolicRef('HEAD');
    let mainSha;
    let mainBranch = null;
    if (mainHeadRef) {
        const sha = await refStore.getRef(mainHeadRef);
        mainSha = sha || '';
        mainBranch = normalizeBranchName(mainHeadRef);
    }
    else {
        mainSha = await refStore.getHead();
    }
    result.push({
        path: '.',
        sha: mainSha,
        branch: mainBranch,
        isMain: true,
        locked: false,
        prunable: false,
    });
    // Add linked worktrees
    for (const [, entry] of store) {
        if (!includePrunable && entry.prunable) {
            continue;
        }
        const info = {
            path: entry.path,
            sha: entry.headSha,
            branch: entry.headRef ? normalizeBranchName(entry.headRef) : null,
            isMain: false,
            locked: entry.locked,
            prunable: entry.prunable,
        };
        if (entry.lockReason !== undefined) {
            info.lockReason = entry.lockReason;
        }
        result.push(info);
    }
    return result;
}
/**
 * Removes a worktree.
 *
 * Removes the worktree entry and its associated refs. Does not remove
 * the branch the worktree was tracking.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Remove options
 * @returns Result of the removal
 *
 * @throws {Error} If the path is empty
 * @throws {Error} If the worktree is not found
 * @throws {Error} If the worktree is locked and force is false
 * @throws {Error} If attempting to remove the main worktree
 *
 * @example
 * ```typescript
 * // Remove a worktree
 * await removeWorktree(refStore, { path: 'worktrees/feature' })
 *
 * // Force remove a locked worktree
 * await removeWorktree(refStore, { path: 'worktrees/locked', force: true })
 * ```
 */
export async function removeWorktree(refStore, options) {
    const { path, force = false } = options;
    if (!path || !path.trim()) {
        throw new Error('Worktree path is required');
    }
    const normalizedPath = normalizePath(path);
    // Cannot remove main worktree
    if (normalizedPath === '.') {
        throw new Error('Cannot remove the main worktree');
    }
    const store = getWorktreeStore(refStore);
    const entry = store.get(normalizedPath);
    if (!entry) {
        throw new Error(`Worktree not found at '${normalizedPath}'`);
    }
    // Check lock
    if (entry.locked && !force) {
        const reason = entry.lockReason ? `: ${entry.lockReason}` : '';
        throw new Error(`Worktree '${normalizedPath}' is locked${reason}`);
    }
    // Remove worktree ref
    const wtRefName = getWorktreeRefName(normalizedPath);
    await refStore.deleteRef(wtRefName);
    // Remove from store
    store.delete(normalizedPath);
    return {
        removed: true,
        path: normalizedPath,
    };
}
/**
 * Locks a worktree to prevent removal.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Lock options
 *
 * @throws {Error} If the worktree is not found
 * @throws {Error} If the worktree is already locked
 *
 * @example
 * ```typescript
 * await lockWorktree(refStore, {
 *   path: 'worktrees/feature',
 *   reason: 'Work in progress, do not remove',
 * })
 * ```
 */
export async function lockWorktree(refStore, options) {
    const { path, reason } = options;
    const normalizedPath = normalizePath(path);
    const store = getWorktreeStore(refStore);
    const entry = store.get(normalizedPath);
    if (!entry) {
        throw new Error(`Worktree not found at '${normalizedPath}'`);
    }
    if (entry.locked) {
        throw new Error(`Worktree '${normalizedPath}' is already locked`);
    }
    entry.locked = true;
    if (reason !== undefined) {
        entry.lockReason = reason;
    }
}
/**
 * Unlocks a worktree.
 *
 * @param refStore - The ref store for accessing refs
 * @param path - The worktree path to unlock
 *
 * @throws {Error} If the worktree is not found
 * @throws {Error} If the worktree is not locked
 *
 * @example
 * ```typescript
 * await unlockWorktree(refStore, 'worktrees/feature')
 * ```
 */
export async function unlockWorktree(refStore, path) {
    const normalizedPath = normalizePath(path);
    const store = getWorktreeStore(refStore);
    const entry = store.get(normalizedPath);
    if (!entry) {
        throw new Error(`Worktree not found at '${normalizedPath}'`);
    }
    if (!entry.locked) {
        throw new Error(`Worktree '${normalizedPath}' is not locked`);
    }
    entry.locked = false;
    delete entry.lockReason;
}
/**
 * Moves a worktree to a new path.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Move options
 * @returns Result of the move
 *
 * @throws {Error} If the source worktree is not found
 * @throws {Error} If the source worktree is locked and force is false
 * @throws {Error} If a worktree already exists at the destination
 *
 * @example
 * ```typescript
 * await moveWorktree(refStore, {
 *   oldPath: 'worktrees/feature',
 *   newPath: 'worktrees/feature-v2',
 * })
 * ```
 */
export async function moveWorktree(refStore, options) {
    const { oldPath, newPath, force = false } = options;
    const normalizedOld = normalizePath(oldPath);
    const normalizedNew = normalizePath(newPath);
    const store = getWorktreeStore(refStore);
    const entry = store.get(normalizedOld);
    if (!entry) {
        throw new Error(`Worktree not found at '${normalizedOld}'`);
    }
    if (entry.locked && !force) {
        throw new Error(`Worktree '${normalizedOld}' is locked`);
    }
    if (store.has(normalizedNew)) {
        throw new Error(`Worktree already exists at '${normalizedNew}'`);
    }
    // Remove old worktree ref
    const oldRefName = getWorktreeRefName(normalizedOld);
    await refStore.deleteRef(oldRefName);
    // Create new worktree ref
    const newRefName = getWorktreeRefName(normalizedNew);
    await refStore.setRef(newRefName, entry.headSha);
    // Update entry
    entry.path = normalizedNew;
    store.delete(normalizedOld);
    store.set(normalizedNew, entry);
    return {
        moved: true,
        oldPath: normalizedOld,
        newPath: normalizedNew,
    };
}
/**
 * Prunes stale worktree entries.
 *
 * Marks or removes worktree entries whose backing data is missing or invalid.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Prune options
 * @returns Result of the prune operation
 *
 * @example
 * ```typescript
 * // Dry run
 * const result = await pruneWorktrees(refStore, { dryRun: true })
 * console.log('Would prune:', result.pruned)
 *
 * // Actually prune
 * const result = await pruneWorktrees(refStore)
 * console.log('Pruned:', result.pruned)
 * ```
 */
export async function pruneWorktrees(refStore, options = {}) {
    const { dryRun = false } = options;
    const store = getWorktreeStore(refStore);
    const pruned = [];
    for (const [path, entry] of store) {
        if (entry.prunable) {
            pruned.push(path);
            if (!dryRun) {
                const wtRefName = getWorktreeRefName(path);
                await refStore.deleteRef(wtRefName);
                store.delete(path);
            }
        }
    }
    return { pruned };
}
/**
 * Gets the HEAD ref for a specific worktree.
 *
 * Returns the branch or detached SHA for the given worktree.
 *
 * @param refStore - The ref store for accessing refs
 * @param path - The worktree path
 * @returns Object with branch and sha, or null if not found
 *
 * @example
 * ```typescript
 * const head = await getWorktreeHead(refStore, 'worktrees/feature')
 * if (head) {
 *   if (head.branch) {
 *     console.log(`On branch ${head.branch} at ${head.sha}`)
 *   } else {
 *     console.log(`Detached at ${head.sha}`)
 *   }
 * }
 * ```
 */
export async function getWorktreeHead(refStore, path) {
    const normalizedPath = normalizePath(path);
    // Main worktree
    if (normalizedPath === '.') {
        const headRef = await refStore.getSymbolicRef('HEAD');
        if (headRef) {
            const sha = await refStore.getRef(headRef);
            return {
                branch: normalizeBranchName(headRef),
                sha: sha || '',
            };
        }
        return {
            branch: null,
            sha: await refStore.getHead(),
        };
    }
    const store = getWorktreeStore(refStore);
    const entry = store.get(normalizedPath);
    if (!entry) {
        return null;
    }
    return {
        branch: entry.headRef ? normalizeBranchName(entry.headRef) : null,
        sha: entry.headSha,
    };
}
/**
 * Updates the HEAD of a worktree to point to a new branch or SHA.
 *
 * @param refStore - The ref store for accessing refs
 * @param path - The worktree path
 * @param target - Branch name or commit SHA
 * @param options - Additional options
 *
 * @throws {Error} If the worktree is not found
 * @throws {Error} If the branch or SHA cannot be resolved
 *
 * @example
 * ```typescript
 * // Switch worktree to a different branch
 * await setWorktreeHead(refStore, 'worktrees/feature', 'develop')
 *
 * // Detach worktree HEAD
 * await setWorktreeHead(refStore, 'worktrees/feature', 'abc123...', { detach: true })
 * ```
 */
export async function setWorktreeHead(refStore, path, target, options = {}) {
    const { detach = false } = options;
    const normalizedPath = normalizePath(path);
    const store = getWorktreeStore(refStore);
    const entry = store.get(normalizedPath);
    if (!entry) {
        throw new Error(`Worktree not found at '${normalizedPath}'`);
    }
    if (detach || /^[a-f0-9]{40}$/i.test(target)) {
        // Detached HEAD
        entry.headRef = null;
        entry.headSha = target;
    }
    else {
        // Branch checkout
        const branchName = normalizeBranchName(target);
        const fullRef = `${BRANCH_REF_PREFIX}${branchName}`;
        const sha = await refStore.getRef(fullRef);
        if (!sha) {
            throw new Error(`Branch '${branchName}' not found`);
        }
        entry.headRef = fullRef;
        entry.headSha = sha;
    }
    // Update the stored ref
    const wtRefName = getWorktreeRefName(normalizedPath);
    await refStore.setRef(wtRefName, entry.headSha);
}
//# sourceMappingURL=worktree.js.map