/**
 * @fileoverview Branch Protection Rules
 *
 * Provides branch protection rules that are checked during ref updates
 * (push operations). Protection rules are stored in SQLite and evaluated
 * against ref update commands before they are applied.
 *
 * @module do/branch-protection
 */
import type { DurableObjectStorage } from '../storage/types';
/** A branch protection rule stored in SQLite. */
export interface BranchProtectionRule {
    /** Unique rule ID (auto-increment). */
    id: number;
    /** Glob-style pattern to match ref names (e.g., 'refs/heads/main', 'refs/heads/release/*'). */
    pattern: string;
    /** Minimum number of required reviews before merge (0 = no requirement). */
    requiredReviews: number;
    /** Whether force pushes (non-fast-forward) are blocked. */
    preventForcePush: boolean;
    /** Whether the branch can be deleted. */
    preventDeletion: boolean;
    /** Whether the rule is currently active. */
    enabled: boolean;
    /** Unix timestamp of creation. */
    createdAt: number;
    /** Unix timestamp of last update. */
    updatedAt: number;
}
/** Input for creating or updating a branch protection rule (without id/timestamps). */
export interface BranchProtectionInput {
    pattern: string;
    requiredReviews?: number;
    preventForcePush?: boolean;
    preventDeletion?: boolean;
    enabled?: boolean;
}
/** Result of a protection check against a ref update. */
export interface ProtectionCheckResult {
    /** Whether the update is allowed. */
    allowed: boolean;
    /** Human-readable reason if denied. */
    reason?: string;
    /** The rule that caused the denial, if any. */
    rule?: BranchProtectionRule;
}
/** A ref update command to check against protection rules. */
export interface RefUpdateForProtection {
    refName: string;
    oldSha: string;
    newSha: string;
    /** Whether this is a force push (non-fast-forward). Caller must determine this. */
    isForcePush?: boolean;
}
/** SQL to create the branch_protection table. */
export declare const BRANCH_PROTECTION_SCHEMA_SQL = "\nCREATE TABLE IF NOT EXISTS branch_protection (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  pattern TEXT NOT NULL UNIQUE,\n  required_reviews INTEGER NOT NULL DEFAULT 0,\n  prevent_force_push INTEGER NOT NULL DEFAULT 1,\n  prevent_deletion INTEGER NOT NULL DEFAULT 1,\n  enabled INTEGER NOT NULL DEFAULT 1,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS idx_branch_protection_pattern ON branch_protection(pattern);\nCREATE INDEX IF NOT EXISTS idx_branch_protection_enabled ON branch_protection(enabled);\n";
/**
 * Match a ref name against a glob-style pattern.
 *
 * Supports:
 * - Exact match: 'refs/heads/main'
 * - Wildcard suffix: 'refs/heads/release/*' matches 'refs/heads/release/v1'
 * - Single '*' matches any ref
 */
export declare function matchesProtectionPattern(refName: string, pattern: string): boolean;
/**
 * Check a ref update against a set of branch protection rules.
 *
 * Returns the first denial found, or an allowed result if no rules block the update.
 */
export declare function checkBranchProtection(update: RefUpdateForProtection, rules: BranchProtectionRule[]): ProtectionCheckResult;
/**
 * Manages branch protection rules in SQLite.
 */
export declare class BranchProtectionManager {
    private storage;
    constructor(storage: DurableObjectStorage);
    /** Ensure the branch_protection table exists. */
    initializeSchema(): void;
    /** Add or update a branch protection rule. Returns the rule ID. */
    upsertRule(input: BranchProtectionInput): number;
    /** Remove a protection rule by pattern. Returns true if deleted. */
    removeRule(pattern: string): boolean;
    /** Get all enabled protection rules. */
    getEnabledRules(): BranchProtectionRule[];
    /** Get all protection rules (including disabled). */
    getAllRules(): BranchProtectionRule[];
    /**
     * Check a ref update against all enabled protection rules.
     * Convenience method that loads rules and runs the check.
     */
    checkUpdate(update: RefUpdateForProtection): ProtectionCheckResult;
}
//# sourceMappingURL=branch-protection.d.ts.map