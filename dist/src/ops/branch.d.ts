/**
 * @fileoverview Git Branch Operations
 *
 * Provides comprehensive branch management functionality including creating,
 * deleting, renaming, listing, and checking out branches. Also handles
 * tracking relationships with remote branches.
 *
 * ## Features
 *
 * - Branch creation from any commit or ref
 * - Branch deletion with merge checking
 * - Branch renaming with HEAD update
 * - Branch listing with filtering and sorting
 * - Checkout with create option
 * - Remote tracking branch support
 * - Default branch detection
 *
 * ## Usage Example
 *
 * ```typescript
 * import { createBranch, checkoutBranch, listBranches } from './ops/branch'
 *
 * // Create a new feature branch
 * const result = await createBranch(refStore, {
 *   name: 'feature/new-feature',
 *   startPoint: 'main',
 *   checkout: true
 * })
 *
 * // List all branches
 * const branches = await listBranches(refStore, { all: true })
 *
 * // Checkout existing branch
 * await checkoutBranch(refStore, { name: 'develop' })
 * ```
 *
 * @module ops/branch
 */
import { isValidBranchName as sharedIsValidBranchName, normalizeBranchName as sharedNormalizeBranchName } from '../utils/branch-validation';
/**
 * Ref store interface for branch operations.
 *
 * Provides methods for reading and writing git refs,
 * including HEAD and symbolic refs.
 *
 * @interface RefStore
 */
export interface RefStore {
    /**
     * Gets the SHA a ref points to.
     * @param ref - The full ref path (e.g., 'refs/heads/main')
     * @returns The SHA, or null if ref doesn't exist
     */
    getRef(ref: string): Promise<string | null>;
    /**
     * Sets a ref to point to a SHA.
     * @param ref - The full ref path
     * @param sha - The target SHA
     */
    setRef(ref: string, sha: string): Promise<void>;
    /**
     * Deletes a ref.
     * @param ref - The full ref path to delete
     */
    deleteRef(ref: string): Promise<void>;
    /**
     * Lists refs matching a prefix.
     * @param prefix - The prefix to match (e.g., 'refs/heads/')
     * @returns Array of matching refs with their SHAs
     */
    listRefs(prefix?: string): Promise<Array<{
        ref: string;
        sha: string;
    }>>;
    /**
     * Gets the current HEAD value (SHA for detached, ref for attached).
     * @returns The HEAD value
     */
    getHead(): Promise<string>;
    /**
     * Sets HEAD to a SHA (creates detached HEAD).
     * @param ref - The SHA to point HEAD to
     */
    setHead(ref: string): Promise<void>;
    /**
     * Gets the target of a symbolic ref.
     * @param ref - The symbolic ref name (e.g., 'HEAD')
     * @returns The target ref path, or null if not symbolic
     */
    getSymbolicRef(ref: string): Promise<string | null>;
    /**
     * Sets a symbolic ref to point to another ref.
     * @param ref - The symbolic ref name
     * @param target - The target ref path
     */
    setSymbolicRef(ref: string, target: string): Promise<void>;
}
/**
 * Options for creating a branch.
 *
 * @interface BranchOptions
 *
 * @example
 * ```typescript
 * const options: BranchOptions = {
 *   name: 'feature/login',
 *   startPoint: 'develop',
 *   force: false,
 *   checkout: true
 * }
 * ```
 */
export interface BranchOptions {
    /** The name for the new branch (without refs/heads/ prefix) */
    name: string;
    /**
     * Starting point for the branch (commit SHA, branch name, or tag).
     * Defaults to current HEAD if not specified.
     */
    startPoint?: string;
    /**
     * If true, allow overwriting an existing branch.
     * @default false
     */
    force?: boolean;
    /**
     * If true, checkout the branch after creating it.
     * @default false
     */
    checkout?: boolean;
}
/**
 * Result of creating a branch.
 *
 * @interface BranchCreateResult
 */
export interface BranchCreateResult {
    /** The branch name (without refs/heads/) */
    name: string;
    /** The full ref path */
    ref: string;
    /** The SHA the branch points to */
    sha: string;
    /**
     * True if the branch was newly created.
     * False if it already existed and force=true was used.
     */
    created: boolean;
}
/**
 * Options for deleting a branch.
 *
 * @interface BranchDeleteOptions
 *
 * @example
 * ```typescript
 * // Delete single branch
 * await deleteBranch(refStore, { name: 'old-feature', force: true })
 *
 * // Delete multiple branches
 * await deleteBranch(refStore, { names: ['branch1', 'branch2'] })
 * ```
 */
export interface BranchDeleteOptions {
    /** Single branch name to delete */
    name?: string;
    /** Multiple branch names to delete */
    names?: string[];
    /**
     * If true, delete even if not fully merged.
     * @default false
     */
    force?: boolean;
    /**
     * If true, check that branch is merged before deleting.
     * @default false
     */
    checkMerged?: boolean;
    /**
     * If true, delete a remote-tracking branch instead of local.
     * @default false
     */
    remote?: boolean;
}
/**
 * Result of deleting a branch.
 *
 * @interface BranchDeleteResult
 */
export interface BranchDeleteResult {
    /** Whether any branches were deleted */
    deleted: boolean;
    /** The name of the first deleted branch */
    name: string;
    /** The SHA of the first deleted branch */
    sha: string;
    /** All branches that were deleted */
    deletedBranches: Array<{
        name: string;
        sha: string;
    }>;
}
/**
 * Options for listing branches.
 *
 * @interface BranchListOptions
 *
 * @example
 * ```typescript
 * // List all branches with verbose info
 * const branches = await listBranches(refStore, {
 *   all: true,
 *   verbose: true,
 *   sort: '-committerdate'
 * })
 * ```
 */
export interface BranchListOptions {
    /**
     * If true, list remote-tracking branches.
     * @default false
     */
    remote?: boolean;
    /**
     * If true, list both local and remote branches.
     * @default false
     */
    all?: boolean;
    /**
     * Glob pattern to filter branch names.
     * Supports * and ? wildcards.
     */
    pattern?: string;
    /** Only list branches that contain this commit SHA */
    contains?: string;
    /** Only list branches merged into this ref */
    merged?: string;
    /** Only list branches NOT merged into this ref */
    noMerged?: string;
    /**
     * Sort field. Prefix with - for descending.
     * Values: 'name', 'committerdate'
     */
    sort?: string;
    /**
     * If true, include tracking info and commit subject.
     * @default false
     */
    verbose?: boolean;
}
/**
 * Information about a branch.
 *
 * @interface BranchInfo
 */
export interface BranchInfo {
    /** Branch name (without refs/heads/ or refs/remotes/) */
    name: string;
    /** Full ref path */
    ref: string;
    /** SHA the branch points to */
    sha: string;
    /** True if this is the current branch */
    current: boolean;
    /** Tracking information (if verbose=true and tracking is set) */
    tracking?: TrackingInfo | null;
    /** First line of head commit message (if verbose=true) */
    commitSubject?: string;
}
/**
 * Tracking information for a branch.
 *
 * @interface TrackingInfo
 */
export interface TrackingInfo {
    /** Full upstream ref (e.g., 'origin/main') */
    upstream: string;
    /** Remote name (e.g., 'origin') */
    remote: string;
    /** Remote branch name (e.g., 'main') */
    remoteBranch: string;
    /** Number of commits ahead of upstream */
    ahead: number;
    /** Number of commits behind upstream */
    behind: number;
}
/**
 * Options for renaming a branch.
 *
 * @interface BranchRenameOptions
 */
export interface BranchRenameOptions {
    /**
     * Branch to rename. If not specified, uses current branch.
     */
    oldName?: string;
    /** New name for the branch */
    newName: string;
    /**
     * If true, allow overwriting an existing branch.
     * @default false
     */
    force?: boolean;
}
/**
 * Result of renaming a branch.
 *
 * @interface BranchRenameResult
 */
export interface BranchRenameResult {
    /** Whether the rename succeeded */
    renamed: boolean;
    /** Original branch name */
    oldName: string;
    /** New branch name */
    newName: string;
    /** SHA the branch points to */
    sha: string;
}
/**
 * Options for checking out a branch.
 *
 * @interface CheckoutOptions
 *
 * @example
 * ```typescript
 * // Checkout existing branch
 * await checkoutBranch(refStore, { name: 'develop' })
 *
 * // Create and checkout new branch
 * await checkoutBranch(refStore, {
 *   name: 'feature/new',
 *   create: true,
 *   startPoint: 'main'
 * })
 *
 * // Detached HEAD checkout
 * await checkoutBranch(refStore, { sha: 'abc123', detach: true })
 * ```
 */
export interface CheckoutOptions {
    /** Branch name to checkout */
    name?: string;
    /** SHA to checkout (for detached HEAD) */
    sha?: string;
    /**
     * If true, create the branch if it doesn't exist.
     * @default false
     */
    create?: boolean;
    /**
     * If true, overwrite existing branch when creating.
     * @default false
     */
    force?: boolean;
    /** Starting point when creating a new branch */
    startPoint?: string;
    /**
     * If true, checkout as detached HEAD.
     * @default false
     */
    detach?: boolean;
    /** Set up tracking for this upstream (e.g., 'origin/main') */
    track?: string;
}
/**
 * Result of checking out a branch.
 *
 * @interface CheckoutResult
 */
export interface CheckoutResult {
    /** Whether checkout succeeded */
    success: boolean;
    /** Branch name (null if detached HEAD) */
    branch: string | null;
    /** SHA that is now checked out */
    sha: string;
    /** True if a new branch was created */
    created?: boolean;
    /** True if now in detached HEAD state */
    detached?: boolean;
    /** Upstream tracking ref if set */
    tracking?: string | undefined;
}
/**
 * Result of setting branch tracking.
 *
 * @interface SetTrackingResult
 */
export interface SetTrackingResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** Local branch name */
    branch: string;
    /** Full upstream ref */
    upstream: string;
    /** Remote name */
    remote: string;
    /** Remote branch name */
    remoteBranch: string;
}
/**
 * Result of removing branch tracking.
 *
 * @interface RemoveTrackingResult
 */
export interface RemoveTrackingResult {
    /** Whether the operation succeeded */
    success: boolean;
}
/**
 * Validates a branch name according to Git naming rules.
 *
 * Git branch names have specific rules to ensure they work correctly
 * across all platforms and don't conflict with Git's special syntax.
 * Delegates to shared validation utilities for consistent behavior.
 *
 * Rules checked:
 * - Not empty
 * - Not longer than 255 characters
 * - Does not start with '-'
 * - Does not end with '.lock', '/', or '.'
 * - Does not contain '..', '//', '@{', or '@'
 * - Is not 'HEAD' and does not start with 'refs/'
 * - Contains no invalid characters (space, ~, ^, :, \, ?, *, [, control chars)
 * - Contains only ASCII characters
 *
 * @param name - The branch name to validate
 * @returns true if the name is valid
 *
 * @example
 * ```typescript
 * isValidBranchName('feature/login')  // true
 * isValidBranchName('my-branch')      // true
 * isValidBranchName('-invalid')       // false (starts with dash)
 * isValidBranchName('refs/heads/x')   // false (starts with refs/)
 * isValidBranchName('has space')      // false (contains space)
 * ```
 */
export declare const isValidBranchName: typeof sharedIsValidBranchName;
/**
 * Normalizes a branch name by removing refs/heads/ prefix.
 * Delegates to shared normalization utilities.
 *
 * @param name - The branch name or ref path
 * @returns The normalized branch name
 *
 * @example
 * ```typescript
 * normalizeBranchName('refs/heads/main')  // 'main'
 * normalizeBranchName('main')             // 'main'
 * ```
 */
export declare const normalizeBranchName: typeof sharedNormalizeBranchName;
/**
 * Creates a new branch.
 *
 * Creates a branch pointing to the specified commit or the current HEAD.
 * Optionally checks out the branch after creation.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Branch creation options
 * @returns Result of the branch creation
 *
 * @throws {Error} If the branch name is invalid
 * @throws {Error} If the branch already exists and force is false
 * @throws {Error} If the start point cannot be resolved
 *
 * @example
 * ```typescript
 * // Create branch from current HEAD
 * const result = await createBranch(refStore, { name: 'feature/new' })
 *
 * // Create branch from specific commit
 * const result = await createBranch(refStore, {
 *   name: 'hotfix/urgent',
 *   startPoint: 'abc123def456...'
 * })
 *
 * // Create and checkout
 * const result = await createBranch(refStore, {
 *   name: 'develop',
 *   startPoint: 'main',
 *   checkout: true
 * })
 * ```
 */
export declare function createBranch(refStore: RefStore, options: BranchOptions): Promise<BranchCreateResult>;
/**
 * Deletes a branch.
 *
 * Removes the specified branch ref. Can delete multiple branches at once.
 * Supports checking if the branch is merged before deleting.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Delete options
 * @returns Result of the delete operation
 *
 * @throws {Error} If no branch name is provided
 * @throws {Error} If the branch doesn't exist
 * @throws {Error} If trying to delete the current branch
 * @throws {Error} If branch is not merged and force is false
 *
 * @example
 * ```typescript
 * // Delete a single branch
 * await deleteBranch(refStore, { name: 'old-feature' })
 *
 * // Force delete unmerged branch
 * await deleteBranch(refStore, { name: 'experimental', force: true })
 *
 * // Delete remote-tracking branch
 * await deleteBranch(refStore, {
 *   name: 'origin/old-feature',
 *   remote: true
 * })
 * ```
 */
export declare function deleteBranch(refStore: RefStore, options: BranchDeleteOptions): Promise<BranchDeleteResult>;
/**
 * Lists branches.
 *
 * Returns a list of branches with optional filtering and sorting.
 * Can list local branches, remote-tracking branches, or both.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Listing options
 * @returns Array of branch information
 *
 * @example
 * ```typescript
 * // List local branches
 * const branches = await listBranches(refStore)
 *
 * // List all branches sorted by name descending
 * const branches = await listBranches(refStore, {
 *   all: true,
 *   sort: '-name'
 * })
 *
 * // List branches matching pattern with verbose info
 * const branches = await listBranches(refStore, {
 *   pattern: 'feature/*',
 *   verbose: true
 * })
 * ```
 */
export declare function listBranches(refStore: RefStore, options?: BranchListOptions): Promise<BranchInfo[]>;
/**
 * Renames a branch.
 *
 * Renames the specified branch, or the current branch if none specified.
 * Updates HEAD if renaming the current branch. Transfers tracking info.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Rename options
 * @returns Result of the rename operation
 *
 * @throws {Error} If no current branch when oldName not specified
 * @throws {Error} If the new name is invalid
 * @throws {Error} If the old branch doesn't exist
 * @throws {Error} If the new name exists and force is false
 *
 * @example
 * ```typescript
 * // Rename current branch
 * await renameBranch(refStore, { newName: 'better-name' })
 *
 * // Rename specific branch
 * await renameBranch(refStore, {
 *   oldName: 'old-feature',
 *   newName: 'feature/improved'
 * })
 *
 * // Force rename (overwrites existing)
 * await renameBranch(refStore, {
 *   oldName: 'temp',
 *   newName: 'main',
 *   force: true
 * })
 * ```
 */
export declare function renameBranch(refStore: RefStore, options: BranchRenameOptions): Promise<BranchRenameResult>;
/**
 * Checks out a branch.
 *
 * Switches HEAD to point to the specified branch or commit.
 * Can create a new branch during checkout and set up tracking.
 *
 * @param refStore - The ref store for accessing refs
 * @param options - Checkout options
 * @returns Result of the checkout operation
 *
 * @throws {Error} If neither name nor sha is provided
 * @throws {Error} If branch doesn't exist and create is false
 * @throws {Error} If branch exists when creating and force is false
 *
 * @example
 * ```typescript
 * // Checkout existing branch
 * await checkoutBranch(refStore, { name: 'develop' })
 *
 * // Create and checkout new branch from main
 * await checkoutBranch(refStore, {
 *   name: 'feature/new',
 *   create: true,
 *   startPoint: 'main'
 * })
 *
 * // Detached HEAD checkout
 * await checkoutBranch(refStore, {
 *   sha: 'abc123def456...',
 *   detach: true
 * })
 *
 * // Create branch with tracking
 * await checkoutBranch(refStore, {
 *   name: 'feature/tracked',
 *   create: true,
 *   track: 'origin/feature/tracked'
 * })
 * ```
 */
export declare function checkoutBranch(refStore: RefStore, options: CheckoutOptions): Promise<CheckoutResult>;
/**
 * Gets the current branch name.
 *
 * Returns the name of the currently checked out branch, or null
 * if in detached HEAD state.
 *
 * @param refStore - The ref store for accessing refs
 * @returns The current branch name, or null if detached
 *
 * @example
 * ```typescript
 * const current = await getCurrentBranch(refStore)
 * if (current) {
 *   console.log(`On branch ${current}`)
 * } else {
 *   console.log('HEAD detached')
 * }
 * ```
 */
export declare function getCurrentBranch(refStore: RefStore): Promise<string | null>;
/**
 * Gets detailed information about a branch.
 *
 * @param refStore - The ref store for accessing refs
 * @param name - The branch name
 * @returns Branch info, or null if branch doesn't exist
 *
 * @example
 * ```typescript
 * const info = await getBranchInfo(refStore, 'feature/login')
 * if (info) {
 *   console.log(`${info.name} -> ${info.sha.slice(0, 8)}`)
 *   if (info.current) {
 *     console.log('  (current branch)')
 *   }
 * }
 * ```
 */
export declare function getBranchInfo(refStore: RefStore, name: string): Promise<BranchInfo | null>;
/**
 * Checks if a branch exists.
 *
 * @param refStore - The ref store for accessing refs
 * @param name - The branch name to check
 * @param options - Options for the check
 * @param options.remote - If true, check remote-tracking branches
 * @returns true if the branch exists
 *
 * @example
 * ```typescript
 * if (await branchExists(refStore, 'feature/login')) {
 *   console.log('Branch exists')
 * }
 *
 * // Check remote branch
 * if (await branchExists(refStore, 'origin/main', { remote: true })) {
 *   console.log('Remote branch exists')
 * }
 * ```
 */
export declare function branchExists(refStore: RefStore, name: string, options?: {
    remote?: boolean;
}): Promise<boolean>;
/**
 * Sets tracking information for a branch.
 *
 * Configures a local branch to track a remote branch, enabling
 * push/pull shortcuts and status information.
 *
 * @param refStore - The ref store for accessing refs
 * @param branch - The local branch name
 * @param upstream - The upstream ref (e.g., 'origin/main')
 * @returns Result of setting tracking
 *
 * @throws {Error} If the local branch doesn't exist
 *
 * @example
 * ```typescript
 * await setBranchTracking(refStore, 'feature/login', 'origin/feature/login')
 * ```
 */
export declare function setBranchTracking(refStore: RefStore, branch: string, upstream: string): Promise<SetTrackingResult>;
/**
 * Gets tracking information for a branch.
 *
 * @param refStore - The ref store for accessing refs
 * @param branch - The branch name
 * @returns Tracking info, or null if not tracking
 *
 * @example
 * ```typescript
 * const tracking = await getBranchTracking(refStore, 'main')
 * if (tracking) {
 *   console.log(`Tracking ${tracking.upstream}`)
 *   console.log(`${tracking.ahead} ahead, ${tracking.behind} behind`)
 * }
 * ```
 */
export declare function getBranchTracking(refStore: RefStore, branch: string): Promise<TrackingInfo | null>;
/**
 * Removes tracking information from a branch.
 *
 * @param refStore - The ref store for accessing refs
 * @param branch - The branch name
 * @returns Result of removing tracking
 *
 * @example
 * ```typescript
 * await removeBranchTracking(refStore, 'feature/old')
 * ```
 */
export declare function removeBranchTracking(refStore: RefStore, branch: string): Promise<RemoveTrackingResult>;
/**
 * Gets the default branch name for a repository.
 *
 * Returns the configured default branch, or attempts to detect it
 * by checking for 'main' or 'master' branches.
 *
 * @param refStore - The ref store for accessing refs
 * @returns The default branch name, or null if none found
 *
 * @example
 * ```typescript
 * const defaultBranch = await getDefaultBranch(refStore)
 * if (defaultBranch) {
 *   console.log(`Default branch: ${defaultBranch}`)
 * }
 * ```
 */
export declare function getDefaultBranch(refStore: RefStore): Promise<string | null>;
/**
 * Sets the default branch for a repository.
 *
 * @param refStore - The ref store for accessing refs
 * @param name - The branch name to set as default
 *
 * @throws {Error} If the branch doesn't exist
 *
 * @example
 * ```typescript
 * await setDefaultBranch(refStore, 'main')
 * ```
 */
export declare function setDefaultBranch(refStore: RefStore, name: string): Promise<void>;
//# sourceMappingURL=branch.d.ts.map