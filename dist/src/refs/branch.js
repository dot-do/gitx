/**
 * @fileoverview Git Branch Operations
 *
 * This module provides comprehensive branch management functionality including
 * creation, deletion, renaming, listing, and upstream tracking configuration.
 *
 * Branches in Git are simply refs under `refs/heads/` that point to commits.
 * This module provides a higher-level API that handles the ref manipulation
 * and adds branch-specific features like tracking information.
 *
 * **Key Features**:
 * - Branch CRUD operations (create, read, update, delete)
 * - Upstream tracking configuration
 * - Merge status checking
 * - Branch name validation and normalization
 *
 * @module refs/branch
 *
 * @example
 * ```typescript
 * import { BranchManager, createBranch, listBranches } from './refs/branch'
 *
 * // Using the manager
 * const manager = new BranchManager(refStorage)
 * const branch = await manager.createBranch('feature/new-thing', { startPoint: 'main' })
 *
 * // Or using convenience functions
 * const branches = await listBranches(refStorage)
 * ```
 */
import { isValidSha } from './storage';
// Import shared validation utilities
import { validateBranchName as sharedValidateBranchName, isValidBranchName as sharedIsValidBranchName, normalizeBranchName as sharedNormalizeBranchName, getBranchRefName as sharedGetBranchRefName } from '../utils/branch-validation';
import { isValidRefName as _isValidRefName } from './storage';
void _isValidRefName;
// BranchValidationResult is re-exported from shared utilities above
/**
 * Error thrown when a branch operation fails.
 *
 * @description
 * Provides structured error information with error code
 * for programmatic error handling.
 *
 * @example
 * ```typescript
 * try {
 *   await manager.deleteBranch('main')
 * } catch (e) {
 *   if (e instanceof BranchError) {
 *     if (e.code === 'CANNOT_DELETE_CURRENT') {
 *       console.log('Cannot delete the branch you are on')
 *     }
 *   }
 * }
 * ```
 */
export class BranchError extends Error {
    code;
    branchName;
    /**
     * Create a new BranchError.
     *
     * @param message - Human-readable error description
     * @param code - Error code for programmatic handling
     * @param branchName - The branch that caused the error
     */
    constructor(message, code, branchName) {
        super(message);
        this.code = code;
        this.branchName = branchName;
        this.name = 'BranchError';
    }
}
export class BranchManager {
    storage;
    /** Storage for tracking information (simulated config) */
    trackingInfo = new Map();
    /** Optional callback to check if commits exist */
    commitExists;
    /**
     * Create a new BranchManager.
     *
     * @param storage - RefStorage instance for ref operations
     * @param options - Optional configuration
     */
    constructor(storage, options) {
        this.storage = storage;
        this.commitExists = options?.commitExists;
    }
    /**
     * Create a new branch.
     *
     * @description
     * Creates a new branch pointing to the specified start point.
     * By default, the branch starts at HEAD.
     *
     * @param name - Branch name (without refs/heads/ prefix)
     * @param options - Creation options
     * @returns The created branch
     * @throws BranchError with code 'INVALID_NAME' if name is invalid
     * @throws BranchError with code 'ALREADY_EXISTS' if branch exists and not forcing
     * @throws BranchError with code 'INVALID_START_POINT' if start point is invalid
     *
     * @example
     * ```typescript
     * // Create from HEAD
     * const branch = await manager.createBranch('feature')
     *
     * // Create from specific commit
     * const branch = await manager.createBranch('hotfix', { startPoint: 'abc123' })
     *
     * // Force overwrite existing
     * const branch = await manager.createBranch('main', { force: true, startPoint: 'HEAD' })
     * ```
     */
    async createBranch(name, options) {
        // Validate branch name
        const validation = validateBranchName(name);
        if (!validation.valid) {
            throw new BranchError(validation.error, 'INVALID_NAME', name);
        }
        const branchRef = getBranchRefName(name);
        const normalizedName = normalizeBranchName(name);
        // Check if branch already exists
        if (!options?.force) {
            const existing = await this.storage.getRef(branchRef);
            if (existing) {
                throw new BranchError(`Branch '${name}' already exists`, 'ALREADY_EXISTS', name);
            }
        }
        // Resolve start point to SHA
        const startPoint = options?.startPoint ?? 'HEAD';
        // Check for empty start point
        if (startPoint === '') {
            throw new BranchError('Start point cannot be empty', 'INVALID_START_POINT', name);
        }
        let sha;
        // If startPoint is a valid SHA, use it directly
        if (isValidSha(startPoint)) {
            // If we have a commitExists validator, verify the commit exists
            if (this.commitExists) {
                const exists = await this.commitExists(startPoint);
                if (!exists) {
                    throw new BranchError(`Invalid start point: ${startPoint}`, 'INVALID_START_POINT', name);
                }
            }
            sha = startPoint;
        }
        else {
            // Try to resolve as ref
            try {
                // First try as branch name
                let resolved;
                try {
                    resolved = await this.storage.resolveRef(getBranchRefName(startPoint));
                }
                catch {
                    // Try as full ref path
                    try {
                        resolved = await this.storage.resolveRef(startPoint);
                    }
                    catch {
                        throw new BranchError(`Invalid start point: ${startPoint}`, 'INVALID_START_POINT', name);
                    }
                }
                sha = resolved.sha;
            }
            catch (e) {
                if (e instanceof BranchError)
                    throw e;
                throw new BranchError(`Invalid start point: ${startPoint}`, 'INVALID_START_POINT', name);
            }
        }
        // Get current branch to check if new branch is current
        void await this.getCurrentBranch(); // Available for future use
        const isCurrent = false; // New branch is never current
        // Create tracking info if requested
        let tracking;
        if (options?.track) {
            const remoteBranch = typeof options.track === 'string'
                ? options.track
                : (startPoint.startsWith('refs/remotes/') ? startPoint : undefined);
            if (remoteBranch) {
                tracking = {
                    remote: remoteBranch.split('/')[2] || 'origin',
                    remoteBranch,
                    ahead: 0,
                    behind: 0,
                    gone: false
                };
                // Store tracking info
                this.trackingInfo.set(normalizedName, tracking);
            }
        }
        // Build the branch object first (for dryRun)
        const branch = {
            name: normalizedName,
            ref: branchRef,
            sha,
            isCurrent,
            isRemote: false,
            tracking
        };
        // If dryRun, return without actually creating
        if (options?.dryRun) {
            return branch;
        }
        // Create the ref
        await this.storage.updateRef(branchRef, sha, { create: true, force: options?.force });
        return branch;
    }
    /**
     * Delete a branch.
     *
     * @description
     * Removes a branch ref. By default, refuses to delete unmerged branches.
     *
     * @param name - Branch name to delete
     * @param options - Deletion options
     * @throws BranchError with code 'NOT_FOUND' if branch doesn't exist
     * @throws BranchError with code 'CANNOT_DELETE_CURRENT' if branch is checked out
     * @throws BranchError with code 'NOT_FULLY_MERGED' if branch has unmerged commits
     *
     * @example
     * ```typescript
     * // Safe delete (only if merged)
     * await manager.deleteBranch('feature')
     *
     * // Force delete
     * await manager.deleteBranch('experiment', { force: true })
     * ```
     */
    async deleteBranch(name, options) {
        const normalizedName = normalizeBranchName(name);
        // Handle remote branch deletion
        if (options?.remote) {
            const remoteRef = `refs/remotes/${options.remote}/${normalizedName}`;
            const remoteExists = await this.storage.getRef(remoteRef);
            if (remoteExists) {
                if (!options?.dryRun) {
                    await this.storage.deleteRef(remoteRef);
                }
            }
            return;
        }
        const branchRef = getBranchRefName(normalizedName);
        // Check if branch exists
        const existing = await this.storage.getRef(branchRef);
        if (!existing) {
            throw new BranchError(`Branch '${name}' not found`, 'NOT_FOUND', name);
        }
        // Check if this is the current branch
        const currentBranch = await this.getCurrentBranch();
        if (currentBranch && currentBranch.name === normalizedName) {
            throw new BranchError(`Cannot delete the checked out branch '${name}'`, 'CANNOT_DELETE_CURRENT', name);
        }
        // Check if branch is fully merged (unless force is true)
        if (!options?.force) {
            const isMerged = await this.isMerged(normalizedName);
            if (!isMerged) {
                throw new BranchError(`Branch '${name}' is not fully merged. Use force to delete anyway.`, 'NOT_FULLY_MERGED', name);
            }
        }
        // If dryRun, return without actually deleting
        if (options?.dryRun) {
            return;
        }
        // Delete the ref
        await this.storage.deleteRef(branchRef);
        // Remove tracking info
        this.trackingInfo.delete(normalizedName);
    }
    /**
     * Rename a branch.
     *
     * @description
     * Renames a branch, updating the ref name. If the branch is the current
     * branch, HEAD is updated accordingly.
     *
     * @param oldName - Current branch name
     * @param newName - New branch name
     * @param options - Rename options
     * @returns The renamed branch
     * @throws BranchError with code 'NOT_FOUND' if old branch doesn't exist
     * @throws BranchError with code 'ALREADY_EXISTS' if new name exists and not forcing
     * @throws BranchError with code 'INVALID_NAME' if new name is invalid
     *
     * @example
     * ```typescript
     * const branch = await manager.renameBranch('old-name', 'new-name')
     * ```
     */
    async renameBranch(oldName, newName, options) {
        // Validate new branch name
        const validation = validateBranchName(newName);
        if (!validation.valid) {
            throw new BranchError(validation.error, 'INVALID_NAME', newName);
        }
        const oldNormalized = normalizeBranchName(oldName);
        const newNormalized = normalizeBranchName(newName);
        const oldRef = getBranchRefName(oldNormalized);
        const newRef = getBranchRefName(newNormalized);
        // Check if old branch exists
        const oldBranch = await this.storage.getRef(oldRef);
        if (!oldBranch) {
            throw new BranchError(`Branch '${oldName}' not found`, 'NOT_FOUND', oldName);
        }
        // Check if new branch already exists (unless force)
        if (!options?.force) {
            const existingNew = await this.storage.getRef(newRef);
            if (existingNew) {
                throw new BranchError(`Branch '${newName}' already exists`, 'ALREADY_EXISTS', newName);
            }
        }
        // Get the SHA from old branch
        const sha = oldBranch.target;
        // Check if this is the current branch
        const currentBranch = await this.getCurrentBranch();
        const wasCurrent = currentBranch && currentBranch.name === oldNormalized;
        // Get tracking info from old branch
        const oldTracking = this.trackingInfo.get(oldNormalized);
        // Build result branch object
        const branch = {
            name: newNormalized,
            ref: newRef,
            sha,
            isCurrent: wasCurrent ?? false,
            isRemote: false,
            tracking: oldTracking
        };
        // If dryRun, return without actually renaming
        if (options?.dryRun) {
            return branch;
        }
        // Create new ref with the same SHA
        await this.storage.updateRef(newRef, sha, { create: true, force: options?.force });
        // Delete old ref
        await this.storage.deleteRef(oldRef);
        // If this was the current branch, update HEAD to point to new branch
        if (wasCurrent) {
            await this.storage.updateHead(newRef, true);
        }
        // Transfer tracking info
        if (oldTracking) {
            this.trackingInfo.delete(oldNormalized);
            this.trackingInfo.set(newNormalized, oldTracking);
        }
        return branch;
    }
    /**
     * List all branches.
     *
     * @description
     * Returns branches matching the specified criteria.
     * By default, returns only local branches.
     *
     * @param options - Listing options
     * @returns Array of branches matching criteria
     *
     * @example
     * ```typescript
     * // List local branches
     * const local = await manager.listBranches()
     *
     * // List all branches including remotes
     * const all = await manager.listBranches({ includeRemotes: true })
     *
     * // List merged branches
     * const merged = await manager.listBranches({ mergedInto: 'main' })
     * ```
     */
    async listBranches(options) {
        const branches = [];
        // Get current branch for isCurrent flag
        const currentBranch = await this.getCurrentBranch();
        // List local branches
        if (!options?.remotesOnly) {
            const localRefs = await this.storage.listRefs({ pattern: 'refs/heads/*' });
            for (const ref of localRefs) {
                const name = normalizeBranchName(ref.name);
                // Apply pattern filter if specified
                if (options?.pattern) {
                    const regex = new RegExp('^' + options.pattern.replace(/\*/g, '.*') + '$');
                    if (!regex.test(name))
                        continue;
                }
                branches.push({
                    name,
                    ref: ref.name,
                    sha: ref.target,
                    isCurrent: currentBranch?.name === name,
                    isRemote: false,
                    tracking: options?.includeTracking ? this.trackingInfo.get(name) : undefined
                });
            }
        }
        // List remote branches if requested
        if (options?.includeRemotes || options?.remotesOnly) {
            const remoteRefs = await this.storage.listRefs({ pattern: 'refs/remotes/*' });
            for (const ref of remoteRefs) {
                const name = ref.name.replace(/^refs\/remotes\//, '');
                branches.push({
                    name,
                    ref: ref.name,
                    sha: ref.target,
                    isCurrent: false,
                    isRemote: true
                });
            }
        }
        return branches;
    }
    /**
     * Get the current branch.
     *
     * @description
     * Returns the branch that HEAD points to, or null if HEAD is detached.
     *
     * @returns Current branch or null if detached
     *
     * @example
     * ```typescript
     * const current = await manager.getCurrentBranch()
     * if (current) {
     *   console.log(`On branch: ${current.name}`)
     * } else {
     *   console.log('HEAD is detached')
     * }
     * ```
     */
    async getCurrentBranch() {
        const head = await this.storage.getRef('HEAD');
        if (!head)
            return null;
        // If HEAD is direct (detached), there is no current branch
        if (head.type === 'direct') {
            return null;
        }
        // HEAD is symbolic, pointing to a branch
        const branchRef = head.target;
        if (!branchRef.startsWith('refs/heads/')) {
            return null;
        }
        const ref = await this.storage.getRef(branchRef);
        if (!ref)
            return null;
        const name = normalizeBranchName(branchRef);
        return {
            name,
            ref: branchRef,
            sha: ref.target,
            isCurrent: true,
            isRemote: false,
            tracking: this.trackingInfo.get(name)
        };
    }
    /**
     * Get a specific branch by name.
     *
     * @description
     * Retrieves branch information for a specific branch.
     *
     * @param name - Branch name
     * @returns Branch info or null if not found
     *
     * @example
     * ```typescript
     * const branch = await manager.getBranch('main')
     * if (branch) {
     *   console.log(`main is at ${branch.sha}`)
     * }
     * ```
     */
    async getBranch(name) {
        const normalizedName = normalizeBranchName(name);
        const branchRef = getBranchRefName(normalizedName);
        const ref = await this.storage.getRef(branchRef);
        if (!ref)
            return null;
        const currentBranch = await this.getCurrentBranch();
        return {
            name: normalizedName,
            ref: branchRef,
            sha: ref.target,
            isCurrent: currentBranch?.name === normalizedName,
            isRemote: false,
            tracking: this.trackingInfo.get(normalizedName)
        };
    }
    /**
     * Check if a branch exists.
     *
     * @description
     * Quick check for branch existence without fetching full info.
     *
     * @param name - Branch name
     * @returns True if branch exists
     *
     * @example
     * ```typescript
     * if (await manager.branchExists('feature')) {
     *   console.log('Branch already exists')
     * }
     * ```
     */
    async branchExists(name) {
        // Handle remote branch names like 'origin/main'
        if (name.includes('/') && !name.startsWith('refs/')) {
            const parts = name.split('/');
            if (parts.length >= 2) {
                // Check if it's a remote reference
                const remoteRef = `refs/remotes/${name}`;
                const remoteExists = await this.storage.getRef(remoteRef);
                if (remoteExists)
                    return true;
            }
        }
        const normalizedName = normalizeBranchName(name);
        const branchRef = getBranchRefName(normalizedName);
        const ref = await this.storage.getRef(branchRef);
        return ref !== null;
    }
    /**
     * Set upstream branch for tracking.
     *
     * @description
     * Configures or removes upstream tracking for a branch.
     *
     * @param branchName - Local branch to configure
     * @param options - Tracking options
     * @throws BranchError with code 'NOT_FOUND' if branch doesn't exist
     *
     * @example
     * ```typescript
     * // Set upstream
     * await manager.setUpstream('feature', {
     *   remote: 'origin',
     *   remoteBranch: 'feature'
     * })
     *
     * // Remove upstream
     * await manager.setUpstream('feature', { unset: true })
     * ```
     */
    async setUpstream(branchName, options) {
        const normalizedName = normalizeBranchName(branchName);
        const branchRef = getBranchRefName(normalizedName);
        // Check if branch exists
        const existing = await this.storage.getRef(branchRef);
        if (!existing) {
            throw new BranchError(`Branch '${branchName}' not found`, 'NOT_FOUND', branchName);
        }
        // If unset, remove tracking info
        if (options.unset) {
            this.trackingInfo.delete(normalizedName);
            return;
        }
        // Build the remote branch ref
        const remote = options.remote || 'origin';
        const remoteBranchName = options.remoteBranch || normalizedName;
        const remoteBranch = `refs/remotes/${remote}/${remoteBranchName}`;
        const tracking = {
            remote,
            remoteBranch,
            ahead: 0,
            behind: 0,
            gone: false
        };
        this.trackingInfo.set(normalizedName, tracking);
    }
    /**
     * Get tracking info for a branch.
     *
     * @description
     * Returns upstream tracking information including ahead/behind counts.
     *
     * @param branchName - Branch to check
     * @returns Tracking info or null if not tracking
     *
     * @example
     * ```typescript
     * const tracking = await manager.getTrackingInfo('main')
     * if (tracking) {
     *   console.log(`${tracking.ahead} ahead, ${tracking.behind} behind ${tracking.remoteBranch}`)
     * }
     * ```
     */
    async getTrackingInfo(branchName) {
        const normalizedName = normalizeBranchName(branchName);
        return this.trackingInfo.get(normalizedName) ?? null;
    }
    /**
     * Check if a branch is fully merged into another branch.
     *
     * @description
     * Determines if all commits on the branch are reachable from the target.
     *
     * @param branchName - Branch to check
     * @param into - Target branch (defaults to current branch)
     * @returns True if fully merged
     *
     * @example
     * ```typescript
     * if (await manager.isMerged('feature', 'main')) {
     *   console.log('Safe to delete feature branch')
     * }
     * ```
     */
    async isMerged(branchName, into) {
        const normalizedName = normalizeBranchName(branchName);
        const branchRef = getBranchRefName(normalizedName);
        // Get the branch SHA
        const branchSha = await this.storage.getRef(branchRef);
        if (!branchSha) {
            throw new BranchError(`Branch '${branchName}' not found`, 'NOT_FOUND', branchName);
        }
        // Get the target branch SHA
        let targetSha;
        if (into) {
            const targetRef = getBranchRefName(normalizeBranchName(into));
            const resolved = await this.storage.getRef(targetRef);
            if (!resolved) {
                throw new BranchError(`Branch '${into}' not found`, 'NOT_FOUND', into);
            }
            targetSha = resolved.target;
        }
        else {
            // Use current branch
            const current = await this.getCurrentBranch();
            if (!current) {
                throw new BranchError('No current branch', 'DETACHED_HEAD');
            }
            targetSha = current.sha;
        }
        // Simple check: if the branch points to the same SHA as target, it's merged
        // For a more accurate check, we'd need to walk the commit graph
        return branchSha.target === targetSha;
    }
    /**
     * Force delete an unmerged branch.
     *
     * @description
     * Deletes a branch even if it has unmerged commits. Use with caution
     * as this can result in lost commits.
     *
     * @param name - Branch name to delete
     * @throws BranchError with code 'NOT_FOUND' if branch doesn't exist
     * @throws BranchError with code 'CANNOT_DELETE_CURRENT' if branch is checked out
     *
     * @example
     * ```typescript
     * await manager.forceDeleteBranch('abandoned-feature')
     * ```
     */
    async forceDeleteBranch(name) {
        return this.deleteBranch(name, { force: true });
    }
}
// ============================================================================
// Validation Functions (delegating to shared utilities)
// ============================================================================
/**
 * Validate a branch name according to Git rules.
 *
 * @description
 * Checks if a branch name is valid and returns detailed validation results
 * including the normalized form of the name. Delegates to shared validation
 * utilities for consistent behavior across the codebase.
 *
 * @param name - Branch name to validate
 * @returns Validation result with valid flag, error message, and normalized name
 *
 * @see https://git-scm.com/docs/git-check-ref-format
 *
 * @example
 * ```typescript
 * const result = validateBranchName('feature/auth')
 * if (result.valid) {
 *   console.log(`Valid: ${result.normalized}`)
 * } else {
 *   console.log(`Invalid: ${result.error}`)
 * }
 * ```
 */
export const validateBranchName = sharedValidateBranchName;
/**
 * Check if a string is a valid branch name.
 *
 * @description
 * Simple boolean check for branch name validity.
 * Delegates to shared validation utilities.
 *
 * @param name - Branch name to check
 * @returns True if valid
 *
 * @example
 * ```typescript
 * if (isValidBranchName('feature/new')) {
 *   // Create the branch
 * }
 * ```
 */
export const isValidBranchName = sharedIsValidBranchName;
/**
 * Normalize a branch name.
 *
 * @description
 * Removes refs/heads/ prefix if present, cleans up the name.
 * Delegates to shared normalization utilities.
 *
 * @param name - Branch name or ref
 * @returns Normalized short branch name
 *
 * @example
 * ```typescript
 * normalizeBranchName('refs/heads/main')  // 'main'
 * normalizeBranchName('main')              // 'main'
 * ```
 */
export const normalizeBranchName = sharedNormalizeBranchName;
/**
 * Get the full ref name for a branch.
 *
 * @description
 * Adds refs/heads/ prefix if not present.
 * Delegates to shared utilities.
 *
 * @param name - Short branch name
 * @returns Full ref name
 *
 * @example
 * ```typescript
 * getBranchRefName('main')            // 'refs/heads/main'
 * getBranchRefName('refs/heads/main') // 'refs/heads/main'
 * ```
 */
export const getBranchRefName = sharedGetBranchRefName;
// ============================================================================
// Convenience Functions
// ============================================================================
/**
 * Create a new branch.
 *
 * @description
 * Convenience function that creates a BranchManager and calls createBranch.
 *
 * @param storage - RefStorage instance
 * @param name - Branch name
 * @param options - Creation options
 * @returns Created branch
 *
 * @example
 * ```typescript
 * const branch = await createBranch(storage, 'feature', { startPoint: 'main' })
 * ```
 */
export async function createBranch(storage, name, options) {
    const manager = new BranchManager(storage);
    return manager.createBranch(name, options);
}
/**
 * Delete a branch.
 *
 * @description
 * Convenience function that creates a BranchManager and calls deleteBranch.
 *
 * @param storage - RefStorage instance
 * @param name - Branch name to delete
 * @param options - Deletion options
 *
 * @example
 * ```typescript
 * await deleteBranch(storage, 'feature', { force: true })
 * ```
 */
export async function deleteBranch(storage, name, options) {
    const manager = new BranchManager(storage);
    return manager.deleteBranch(name, options);
}
/**
 * Rename a branch.
 *
 * @description
 * Convenience function that creates a BranchManager and calls renameBranch.
 *
 * @param storage - RefStorage instance
 * @param oldName - Current branch name
 * @param newName - New branch name
 * @param options - Rename options
 * @returns Renamed branch
 *
 * @example
 * ```typescript
 * const branch = await renameBranch(storage, 'old', 'new')
 * ```
 */
export async function renameBranch(storage, oldName, newName, options) {
    const manager = new BranchManager(storage);
    return manager.renameBranch(oldName, newName, options);
}
/**
 * List all branches.
 *
 * @description
 * Convenience function that creates a BranchManager and calls listBranches.
 *
 * @param storage - RefStorage instance
 * @param options - Listing options
 * @returns Array of branches
 *
 * @example
 * ```typescript
 * const branches = await listBranches(storage, { includeRemotes: true })
 * ```
 */
export async function listBranches(storage, options) {
    const manager = new BranchManager(storage);
    return manager.listBranches(options);
}
/**
 * Get the current branch.
 *
 * @description
 * Convenience function that creates a BranchManager and calls getCurrentBranch.
 *
 * @param storage - RefStorage instance
 * @returns Current branch or null if detached
 *
 * @example
 * ```typescript
 * const current = await getCurrentBranch(storage)
 * ```
 */
export async function getCurrentBranch(storage) {
    const manager = new BranchManager(storage);
    return manager.getCurrentBranch();
}
//# sourceMappingURL=branch.js.map