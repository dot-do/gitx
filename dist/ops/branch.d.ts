/**
 * Git Branch Operations
 *
 * Provides branch creation, deletion, renaming, listing, checkout,
 * and tracking functionality.
 */
/**
 * Ref store interface for branch operations
 */
export interface RefStore {
    getRef(ref: string): Promise<string | null>;
    setRef(ref: string, sha: string): Promise<void>;
    deleteRef(ref: string): Promise<void>;
    listRefs(prefix?: string): Promise<Array<{
        ref: string;
        sha: string;
    }>>;
    getHead(): Promise<string>;
    setHead(ref: string): Promise<void>;
    getSymbolicRef(ref: string): Promise<string | null>;
    setSymbolicRef(ref: string, target: string): Promise<void>;
}
/**
 * Options for creating a branch
 */
export interface BranchOptions {
    name: string;
    startPoint?: string;
    force?: boolean;
    checkout?: boolean;
}
/**
 * Result of creating a branch
 */
export interface BranchCreateResult {
    name: string;
    ref: string;
    sha: string;
    created: boolean;
}
/**
 * Options for deleting a branch
 */
export interface BranchDeleteOptions {
    name?: string;
    names?: string[];
    force?: boolean;
    checkMerged?: boolean;
    remote?: boolean;
}
/**
 * Result of deleting a branch
 */
export interface BranchDeleteResult {
    deleted: boolean;
    name: string;
    sha: string;
    deletedBranches: Array<{
        name: string;
        sha: string;
    }>;
}
/**
 * Options for listing branches
 */
export interface BranchListOptions {
    remote?: boolean;
    all?: boolean;
    pattern?: string;
    contains?: string;
    merged?: string;
    noMerged?: string;
    sort?: string;
    verbose?: boolean;
}
/**
 * Branch information
 */
export interface BranchInfo {
    name: string;
    ref: string;
    sha: string;
    current: boolean;
    tracking?: TrackingInfo | null;
    commitSubject?: string;
}
/**
 * Tracking information
 */
export interface TrackingInfo {
    upstream: string;
    remote: string;
    remoteBranch: string;
    ahead: number;
    behind: number;
}
/**
 * Options for renaming a branch
 */
export interface BranchRenameOptions {
    oldName?: string;
    newName: string;
    force?: boolean;
}
/**
 * Result of renaming a branch
 */
export interface BranchRenameResult {
    renamed: boolean;
    oldName: string;
    newName: string;
    sha: string;
}
/**
 * Options for checking out a branch
 */
export interface CheckoutOptions {
    name?: string;
    sha?: string;
    create?: boolean;
    force?: boolean;
    startPoint?: string;
    detach?: boolean;
    track?: string;
}
/**
 * Result of checking out a branch
 */
export interface CheckoutResult {
    success: boolean;
    branch: string | null;
    sha: string;
    created?: boolean;
    detached?: boolean;
    tracking?: string;
}
/**
 * Result of setting branch tracking
 */
export interface SetTrackingResult {
    success: boolean;
    branch: string;
    upstream: string;
    remote: string;
    remoteBranch: string;
}
/**
 * Result of removing branch tracking
 */
export interface RemoveTrackingResult {
    success: boolean;
}
/**
 * Check if a branch name is valid according to Git rules
 */
export declare function isValidBranchName(name: string): boolean;
/**
 * Normalize a branch name by removing refs/heads/ prefix
 */
export declare function normalizeBranchName(name: string): string;
/**
 * Create a new branch
 */
export declare function createBranch(refStore: RefStore, options: BranchOptions): Promise<BranchCreateResult>;
/**
 * Delete a branch
 */
export declare function deleteBranch(refStore: RefStore, options: BranchDeleteOptions): Promise<BranchDeleteResult>;
/**
 * List branches
 */
export declare function listBranches(refStore: RefStore, options?: BranchListOptions): Promise<BranchInfo[]>;
/**
 * Rename a branch
 */
export declare function renameBranch(refStore: RefStore, options: BranchRenameOptions): Promise<BranchRenameResult>;
/**
 * Checkout a branch
 */
export declare function checkoutBranch(refStore: RefStore, options: CheckoutOptions): Promise<CheckoutResult>;
/**
 * Get the current branch name
 */
export declare function getCurrentBranch(refStore: RefStore): Promise<string | null>;
/**
 * Get branch information
 */
export declare function getBranchInfo(refStore: RefStore, name: string): Promise<BranchInfo | null>;
/**
 * Check if a branch exists
 */
export declare function branchExists(refStore: RefStore, name: string, options?: {
    remote?: boolean;
}): Promise<boolean>;
/**
 * Set branch tracking
 */
export declare function setBranchTracking(refStore: RefStore, branch: string, upstream: string): Promise<SetTrackingResult>;
/**
 * Get branch tracking info
 */
export declare function getBranchTracking(refStore: RefStore, branch: string): Promise<TrackingInfo | null>;
/**
 * Remove branch tracking
 */
export declare function removeBranchTracking(refStore: RefStore, branch: string): Promise<RemoveTrackingResult>;
/**
 * Get the default branch
 */
export declare function getDefaultBranch(refStore: RefStore): Promise<string | null>;
/**
 * Set the default branch
 */
export declare function setDefaultBranch(refStore: RefStore, name: string): Promise<void>;
//# sourceMappingURL=branch.d.ts.map