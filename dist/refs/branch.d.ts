/**
 * Git Branch Operations
 *
 * Handles branch creation, deletion, renaming, listing, and tracking.
 * Works with the RefStorage system for underlying ref management.
 */
import { RefStorage } from './storage';
/**
 * Branch tracking information
 */
export interface BranchTrackingInfo {
    /** Remote name (e.g., 'origin') */
    remote: string;
    /** Remote branch name (e.g., 'refs/remotes/origin/main') */
    remoteBranch: string;
    /** Number of commits ahead of upstream */
    ahead: number;
    /** Number of commits behind upstream */
    behind: number;
    /** Whether the branch is gone from remote */
    gone: boolean;
}
/**
 * Branch information
 */
export interface Branch {
    /** Short branch name (e.g., 'main', 'feature/foo') */
    name: string;
    /** Full ref name (e.g., 'refs/heads/main') */
    ref: string;
    /** SHA-1 of the commit this branch points to */
    sha: string;
    /** Whether this is the current branch (HEAD points to it) */
    isCurrent: boolean;
    /** Whether this is a remote tracking branch */
    isRemote: boolean;
    /** Tracking information if the branch tracks an upstream */
    tracking?: BranchTrackingInfo;
    /** Last commit message (optional) */
    lastCommitMessage?: string;
    /** Last commit author (optional) */
    lastCommitAuthor?: string;
    /** Last commit date (optional) */
    lastCommitDate?: Date;
}
/**
 * Options for creating a branch
 */
export interface CreateBranchOptions {
    /** Start point (SHA, branch name, or ref) - defaults to HEAD */
    startPoint?: string;
    /** Force creation even if branch exists (overwrite) */
    force?: boolean;
    /** Set up tracking for the new branch */
    track?: boolean | string;
    /** Don't actually create the branch, just validate */
    dryRun?: boolean;
}
/**
 * Options for deleting a branch
 */
export interface DeleteBranchOptions {
    /** Force delete even if not fully merged */
    force?: boolean;
    /** Remote branch to delete (for remote tracking branches) */
    remote?: string;
    /** Don't actually delete, just validate */
    dryRun?: boolean;
}
/**
 * Options for renaming a branch
 */
export interface RenameBranchOptions {
    /** Force rename even if target exists (overwrite) */
    force?: boolean;
    /** Don't actually rename, just validate */
    dryRun?: boolean;
}
/**
 * Options for listing branches
 */
export interface ListBranchesOptions {
    /** Include remote tracking branches */
    includeRemotes?: boolean;
    /** Only list remote tracking branches */
    remotesOnly?: boolean;
    /** Pattern to filter branches (glob-style) */
    pattern?: string;
    /** Sort by (name, committerdate, authordate, etc.) */
    sortBy?: 'name' | 'committerdate' | 'authordate';
    /** Sort order */
    sortOrder?: 'asc' | 'desc';
    /** Include tracking info (slower) */
    includeTracking?: boolean;
    /** Include commit info (slower) */
    includeCommitInfo?: boolean;
    /** Merged into this ref (filter only merged branches) */
    mergedInto?: string;
    /** Not merged into this ref (filter only unmerged branches) */
    notMergedInto?: string;
    /** Only show branches that contain this commit */
    contains?: string;
    /** Only show branches that don't contain this commit */
    noContains?: string;
}
/**
 * Options for setting upstream
 */
export interface SetUpstreamOptions {
    /** Remote name */
    remote?: string;
    /** Remote branch name */
    remoteBranch?: string;
    /** Unset the upstream (remove tracking) */
    unset?: boolean;
}
/**
 * Result of branch validation
 */
export interface BranchValidationResult {
    /** Whether the name is valid */
    valid: boolean;
    /** Error message if invalid */
    error?: string;
    /** Normalized branch name */
    normalized?: string;
}
/**
 * Error thrown when a branch operation fails
 */
export declare class BranchError extends Error {
    readonly code: BranchErrorCode;
    readonly branchName?: string | undefined;
    constructor(message: string, code: BranchErrorCode, branchName?: string | undefined);
}
export type BranchErrorCode = 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INVALID_NAME' | 'NOT_FULLY_MERGED' | 'CANNOT_DELETE_CURRENT' | 'CHECKOUT_CONFLICT' | 'INVALID_START_POINT' | 'NO_UPSTREAM' | 'DETACHED_HEAD';
/**
 * Branch manager for performing branch operations
 */
export declare class BranchManager {
    constructor(storage: RefStorage);
    /**
     * Create a new branch
     */
    createBranch(_name: string, _options?: CreateBranchOptions): Promise<Branch>;
    /**
     * Delete a branch
     */
    deleteBranch(_name: string, _options?: DeleteBranchOptions): Promise<void>;
    /**
     * Rename a branch
     */
    renameBranch(_oldName: string, _newName: string, _options?: RenameBranchOptions): Promise<Branch>;
    /**
     * List all branches
     */
    listBranches(_options?: ListBranchesOptions): Promise<Branch[]>;
    /**
     * Get the current branch
     */
    getCurrentBranch(): Promise<Branch | null>;
    /**
     * Get a specific branch by name
     */
    getBranch(_name: string): Promise<Branch | null>;
    /**
     * Check if a branch exists
     */
    branchExists(_name: string): Promise<boolean>;
    /**
     * Set upstream branch for tracking
     */
    setUpstream(_branchName: string, _options: SetUpstreamOptions): Promise<void>;
    /**
     * Get tracking info for a branch
     */
    getTrackingInfo(_branchName: string): Promise<BranchTrackingInfo | null>;
    /**
     * Check if a branch is fully merged into another branch
     */
    isMerged(_branchName: string, _into?: string): Promise<boolean>;
    /**
     * Force delete an unmerged branch
     */
    forceDeleteBranch(_name: string): Promise<void>;
}
/**
 * Validate a branch name according to Git rules
 * See: https://git-scm.com/docs/git-check-ref-format
 */
export declare function validateBranchName(_name: string): BranchValidationResult;
/**
 * Check if a string is a valid branch name
 */
export declare function isValidBranchName(_name: string): boolean;
/**
 * Normalize a branch name (remove refs/heads/ prefix, etc.)
 */
export declare function normalizeBranchName(_name: string): string;
/**
 * Get the full ref name for a branch
 */
export declare function getBranchRefName(_name: string): string;
/**
 * Create a new branch (convenience function)
 */
export declare function createBranch(_storage: RefStorage, _name: string, _options?: CreateBranchOptions): Promise<Branch>;
/**
 * Delete a branch (convenience function)
 */
export declare function deleteBranch(_storage: RefStorage, _name: string, _options?: DeleteBranchOptions): Promise<void>;
/**
 * Rename a branch (convenience function)
 */
export declare function renameBranch(_storage: RefStorage, _oldName: string, _newName: string, _options?: RenameBranchOptions): Promise<Branch>;
/**
 * List all branches (convenience function)
 */
export declare function listBranches(_storage: RefStorage, _options?: ListBranchesOptions): Promise<Branch[]>;
/**
 * Get the current branch (convenience function)
 */
export declare function getCurrentBranch(_storage: RefStorage): Promise<Branch | null>;
//# sourceMappingURL=branch.d.ts.map