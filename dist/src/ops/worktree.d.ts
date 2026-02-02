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
import type { RefStore } from './branch';
/**
 * Options for adding a new worktree.
 *
 * @interface AddWorktreeOptions
 */
export interface AddWorktreeOptions {
    /** The path for the new worktree (used as identifier) */
    path: string;
    /**
     * Branch to checkout in the worktree.
     * If not specified, creates a detached HEAD.
     */
    branch?: string;
    /**
     * Commit SHA to checkout. Used for detached HEAD worktrees.
     * If branch is specified, this is the start point for a new branch.
     */
    commitSha?: string;
    /**
     * If true, create a new branch with the name specified in `branch`.
     * @default false
     */
    createBranch?: boolean;
    /**
     * If true, force creation even if the branch is already checked out elsewhere.
     * @default false
     */
    force?: boolean;
    /**
     * If true, lock the worktree immediately after creation.
     * @default false
     */
    lock?: boolean;
    /** Reason for locking (only used if lock is true) */
    lockReason?: string;
}
/**
 * Result of adding a worktree.
 *
 * @interface AddWorktreeResult
 */
export interface AddWorktreeResult {
    /** The worktree path */
    path: string;
    /** The branch checked out (null if detached) */
    branch: string | null;
    /** The commit SHA the worktree HEAD points to */
    sha: string;
    /** Whether the worktree was newly created */
    created: boolean;
    /** Whether the worktree is locked */
    locked: boolean;
}
/**
 * Information about a worktree.
 *
 * @interface WorktreeInfo
 */
export interface WorktreeInfo {
    /** The worktree path (identifier) */
    path: string;
    /** The commit SHA the worktree HEAD points to */
    sha: string;
    /** The branch checked out (null if detached HEAD) */
    branch: string | null;
    /** Whether this is the main worktree */
    isMain: boolean;
    /** Whether the worktree is locked */
    locked: boolean;
    /** Reason for locking, if any */
    lockReason?: string;
    /** Whether the worktree is prunable (stale) */
    prunable: boolean;
}
/**
 * Options for removing a worktree.
 *
 * @interface RemoveWorktreeOptions
 */
export interface RemoveWorktreeOptions {
    /** The worktree path to remove */
    path: string;
    /**
     * If true, remove even if locked.
     * @default false
     */
    force?: boolean;
}
/**
 * Result of removing a worktree.
 *
 * @interface RemoveWorktreeResult
 */
export interface RemoveWorktreeResult {
    /** Whether the worktree was removed */
    removed: boolean;
    /** The path that was removed */
    path: string;
}
/**
 * Options for listing worktrees.
 *
 * @interface ListWorktreeOptions
 */
export interface ListWorktreeOptions {
    /**
     * If true, include prunable (stale) worktrees.
     * @default true
     */
    includePrunable?: boolean;
}
/**
 * Options for locking a worktree.
 *
 * @interface LockWorktreeOptions
 */
export interface LockWorktreeOptions {
    /** The worktree path to lock */
    path: string;
    /** Optional reason for locking */
    reason?: string;
}
/**
 * Options for pruning worktrees.
 *
 * @interface PruneWorktreeOptions
 */
export interface PruneWorktreeOptions {
    /**
     * If true, only report what would be pruned without actually pruning.
     * @default false
     */
    dryRun?: boolean;
}
/**
 * Result of pruning worktrees.
 *
 * @interface PruneWorktreeResult
 */
export interface PruneWorktreeResult {
    /** Paths that were pruned (or would be pruned if dry run) */
    pruned: string[];
}
/**
 * Options for moving a worktree.
 *
 * @interface MoveWorktreeOptions
 */
export interface MoveWorktreeOptions {
    /** Current worktree path */
    oldPath: string;
    /** New worktree path */
    newPath: string;
    /**
     * If true, move even if locked.
     * @default false
     */
    force?: boolean;
}
/**
 * Result of moving a worktree.
 *
 * @interface MoveWorktreeResult
 */
export interface MoveWorktreeResult {
    /** Whether the move succeeded */
    moved: boolean;
    /** The old path */
    oldPath: string;
    /** The new path */
    newPath: string;
}
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
export declare function addWorktree(refStore: RefStore, options: AddWorktreeOptions): Promise<AddWorktreeResult>;
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
export declare function listWorktrees(refStore: RefStore, options?: ListWorktreeOptions): Promise<WorktreeInfo[]>;
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
export declare function removeWorktree(refStore: RefStore, options: RemoveWorktreeOptions): Promise<RemoveWorktreeResult>;
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
export declare function lockWorktree(refStore: RefStore, options: LockWorktreeOptions): Promise<void>;
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
export declare function unlockWorktree(refStore: RefStore, path: string): Promise<void>;
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
export declare function moveWorktree(refStore: RefStore, options: MoveWorktreeOptions): Promise<MoveWorktreeResult>;
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
export declare function pruneWorktrees(refStore: RefStore, options?: PruneWorktreeOptions): Promise<PruneWorktreeResult>;
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
export declare function getWorktreeHead(refStore: RefStore, path: string): Promise<{
    branch: string | null;
    sha: string;
} | null>;
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
export declare function setWorktreeHead(refStore: RefStore, path: string, target: string, options?: {
    detach?: boolean;
}): Promise<void>;
//# sourceMappingURL=worktree.d.ts.map