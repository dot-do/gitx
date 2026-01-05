/**
 * Git Branch Operations
 *
 * Handles branch creation, deletion, renaming, listing, and tracking.
 * Works with the RefStorage system for underlying ref management.
 */
/**
 * Error thrown when a branch operation fails
 */
export class BranchError extends Error {
    code;
    branchName;
    constructor(message, code, branchName) {
        super(message);
        this.code = code;
        this.branchName = branchName;
        this.name = 'BranchError';
    }
}
/**
 * Branch manager for performing branch operations
 */
export class BranchManager {
    constructor(storage) {
        void storage; // Suppress unused variable warning until implementation
        // TODO: Implement in GREEN phase
    }
    /**
     * Create a new branch
     */
    async createBranch(_name, _options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Delete a branch
     */
    async deleteBranch(_name, _options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Rename a branch
     */
    async renameBranch(_oldName, _newName, _options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * List all branches
     */
    async listBranches(_options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Get the current branch
     */
    async getCurrentBranch() {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Get a specific branch by name
     */
    async getBranch(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Check if a branch exists
     */
    async branchExists(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Set upstream branch for tracking
     */
    async setUpstream(_branchName, _options) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Get tracking info for a branch
     */
    async getTrackingInfo(_branchName) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Check if a branch is fully merged into another branch
     */
    async isMerged(_branchName, _into) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
    /**
     * Force delete an unmerged branch
     */
    async forceDeleteBranch(_name) {
        // TODO: Implement in GREEN phase
        throw new Error('Not implemented');
    }
}
/**
 * Validate a branch name according to Git rules
 * See: https://git-scm.com/docs/git-check-ref-format
 */
export function validateBranchName(_name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Check if a string is a valid branch name
 */
export function isValidBranchName(_name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Normalize a branch name (remove refs/heads/ prefix, etc.)
 */
export function normalizeBranchName(_name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Get the full ref name for a branch
 */
export function getBranchRefName(_name) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Create a new branch (convenience function)
 */
export async function createBranch(_storage, _name, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Delete a branch (convenience function)
 */
export async function deleteBranch(_storage, _name, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Rename a branch (convenience function)
 */
export async function renameBranch(_storage, _oldName, _newName, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * List all branches (convenience function)
 */
export async function listBranches(_storage, _options) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
/**
 * Get the current branch (convenience function)
 */
export async function getCurrentBranch(_storage) {
    // TODO: Implement in GREEN phase
    throw new Error('Not implemented');
}
//# sourceMappingURL=branch.js.map