/**
 * @fileoverview Branch Protection Rules
 *
 * Implements branch protection rules for Git repositories:
 * - Protected branch patterns (e.g., main, release/*)
 * - Required reviews
 * - Require linear history
 * - Block force push
 *
 * @module wire/branch-protection
 */
import type { RefUpdateCommand, HookResult } from './receive-pack';
/**
 * Branch protection rule configuration.
 *
 * @description
 * Defines protection rules for branches matching a pattern.
 * Multiple rules can be defined, with more specific patterns
 * taking precedence over general ones.
 *
 * @example
 * ```typescript
 * const mainProtection: BranchProtectionRule = {
 *   pattern: 'refs/heads/main',
 *   requireLinearHistory: true,
 *   blockForcePush: true,
 *   blockDeletion: true,
 *   requiredReviews: 2,
 * }
 *
 * const releaseProtection: BranchProtectionRule = {
 *   pattern: 'refs/heads/release/*',
 *   blockForcePush: true,
 *   blockDeletion: true,
 * }
 * ```
 */
export interface BranchProtectionRule {
    /** Glob pattern to match branch names (e.g., 'refs/heads/main', 'refs/heads/release/*') */
    pattern: string;
    /** Block force pushes (non-fast-forward updates) */
    blockForcePush?: boolean;
    /** Block branch deletion */
    blockDeletion?: boolean;
    /** Require linear history (no merge commits) */
    requireLinearHistory?: boolean;
    /** Minimum number of required approving reviews before push */
    requiredReviews?: number;
    /** Require signed commits */
    requireSignedCommits?: boolean;
    /** Allow administrators to bypass protection rules */
    allowAdminBypass?: boolean;
    /** Allow specific users to bypass protection rules */
    bypassUsers?: string[];
    /** Allow specific teams to bypass protection rules */
    bypassTeams?: string[];
    /** Require status checks to pass before push */
    requiredStatusChecks?: string[];
    /** Require branches to be up to date before push */
    requireUpToDate?: boolean;
    /** Require conversation resolution before push */
    requireConversationResolution?: boolean;
    /** Lock branch (no changes allowed) */
    lockBranch?: boolean;
    /** Custom message to display when protection rule is violated */
    customMessage?: string;
}
/**
 * Branch protection configuration for a repository.
 *
 * @example
 * ```typescript
 * const config: BranchProtectionConfig = {
 *   rules: [
 *     {
 *       pattern: 'refs/heads/main',
 *       blockForcePush: true,
 *       blockDeletion: true,
 *       requiredReviews: 2,
 *     },
 *     {
 *       pattern: 'refs/heads/release/*',
 *       blockForcePush: true,
 *       blockDeletion: true,
 *     },
 *   ],
 *   defaultProtection: {
 *     blockForcePush: false,
 *     blockDeletion: false,
 *   },
 * }
 * ```
 */
export interface BranchProtectionConfig {
    /** List of protection rules (ordered by specificity) */
    rules: BranchProtectionRule[];
    /** Default protection applied to unmatched branches */
    defaultProtection?: Partial<BranchProtectionRule>;
    /** Enable protection checking globally */
    enabled?: boolean;
}
/**
 * Context for protection rule evaluation.
 *
 * @description
 * Contains information about the user and environment
 * needed to evaluate bypass conditions.
 */
export interface ProtectionContext {
    /** Username of the user pushing */
    username?: string;
    /** Teams the user belongs to */
    teams?: string[];
    /** Whether the user is an administrator */
    isAdmin?: boolean;
    /** Number of approving reviews for the PR */
    approvedReviews?: number;
    /** Status checks that have passed */
    passedStatusChecks?: string[];
    /** Whether commits are signed */
    commitsAreSigned?: boolean;
    /** Whether the branch is up to date with base */
    isUpToDate?: boolean;
    /** Whether all conversations are resolved */
    conversationsResolved?: boolean;
    /** Whether the history is linear (no merge commits) */
    hasLinearHistory?: boolean;
}
/**
 * Result of a protection rule check.
 */
export interface ProtectionCheckResult {
    /** Whether the operation is allowed */
    allowed: boolean;
    /** Reason for rejection (if not allowed) */
    reason?: string;
    /** The rule that caused the rejection (if any) */
    violatedRule?: BranchProtectionRule;
    /** Suggested action to resolve the violation */
    suggestion?: string;
}
/**
 * Violation types for protection rules.
 */
export type ProtectionViolationType = 'force_push_blocked' | 'deletion_blocked' | 'branch_locked' | 'linear_history_required' | 'reviews_required' | 'signed_commits_required' | 'status_checks_required' | 'up_to_date_required' | 'conversation_resolution_required';
/**
 * Detailed violation information.
 */
export interface ProtectionViolation {
    /** Type of violation */
    type: ProtectionViolationType;
    /** Human-readable message */
    message: string;
    /** The branch that was protected */
    branch: string;
    /** The rule that was violated */
    rule: BranchProtectionRule;
    /** Additional details */
    details?: Record<string, unknown>;
}
/**
 * Match a ref name against a glob pattern.
 *
 * @description
 * Supports glob patterns with:
 * - `*` - matches any characters except `/`
 * - `**` - matches any characters including `/`
 * - `?` - matches any single character
 *
 * @param refName - Full ref name (e.g., 'refs/heads/main')
 * @param pattern - Glob pattern (e.g., 'refs/heads/*', 'refs/heads/release/**')
 * @returns true if the ref name matches the pattern
 *
 * @example
 * ```typescript
 * matchBranchPattern('refs/heads/main', 'refs/heads/main')        // true
 * matchBranchPattern('refs/heads/main', 'refs/heads/*')           // true
 * matchBranchPattern('refs/heads/feature/test', 'refs/heads/*')   // false
 * matchBranchPattern('refs/heads/feature/test', 'refs/heads/**')  // true
 * matchBranchPattern('refs/heads/release-1.0', 'refs/heads/release-*') // true
 * ```
 */
export declare function matchBranchPattern(refName: string, pattern: string): boolean;
/**
 * Find the most specific matching protection rule for a ref.
 *
 * @description
 * Rules are matched by specificity:
 * 1. Exact matches (no wildcards)
 * 2. Patterns with fewer wildcards
 * 3. Longer patterns
 *
 * @param refName - Full ref name
 * @param rules - Array of protection rules
 * @returns The most specific matching rule, or undefined if no match
 */
export declare function findMatchingRule(refName: string, rules: BranchProtectionRule[]): BranchProtectionRule | undefined;
/**
 * Check if an operation is allowed by protection rules.
 *
 * @description
 * Evaluates the protection rules for a ref update command and
 * returns whether the operation is allowed.
 *
 * @param command - The ref update command
 * @param config - Branch protection configuration
 * @param context - Context for bypass evaluation
 * @param isNonFastForward - Whether this is a non-fast-forward update
 * @returns Protection check result
 *
 * @example
 * ```typescript
 * const result = checkProtectionRule(
 *   { oldSha: 'abc...', newSha: 'def...', refName: 'refs/heads/main', type: 'update' },
 *   config,
 *   { username: 'alice', isAdmin: false },
 *   false
 * )
 *
 * if (!result.allowed) {
 *   console.error(`Blocked: ${result.reason}`)
 * }
 * ```
 */
export declare function checkProtectionRule(command: RefUpdateCommand, config: BranchProtectionConfig, context?: ProtectionContext, isNonFastForward?: boolean): ProtectionCheckResult;
/**
 * Create a pre-receive hook handler for branch protection.
 *
 * @description
 * Creates a hook function that can be registered with the HookRegistry
 * to enforce branch protection rules during push operations.
 *
 * @param config - Branch protection configuration
 * @param contextProvider - Optional function to provide protection context for each command
 * @returns Pre-receive hook handler function
 *
 * @example
 * ```typescript
 * const registry = new HookRegistry()
 *
 * registry.register(createPreReceiveHook({
 *   id: 'branch-protection',
 *   priority: 1, // Run first
 *   handler: createBranchProtectionHook(config),
 * }))
 * ```
 */
export declare function createBranchProtectionHook(config: BranchProtectionConfig, contextProvider?: (command: RefUpdateCommand) => Promise<ProtectionContext>): (commands: RefUpdateCommand[], env: Record<string, string>) => Promise<HookResult>;
/**
 * Create an update hook handler for branch protection.
 *
 * @description
 * Creates an update hook that runs per-ref and can selectively
 * reject individual ref updates based on protection rules.
 *
 * @param config - Branch protection configuration
 * @param isAncestor - Function to check if one commit is an ancestor of another
 * @param contextProvider - Optional function to provide protection context
 * @returns Update hook handler function
 *
 * @example
 * ```typescript
 * registry.register(createUpdateHook({
 *   id: 'branch-protection-update',
 *   priority: 1,
 *   handler: createBranchProtectionUpdateHook(
 *     config,
 *     async (ancestor, descendant) => store.isAncestor(ancestor, descendant)
 *   ),
 * }))
 * ```
 */
export declare function createBranchProtectionUpdateHook(config: BranchProtectionConfig, isAncestor: (ancestor: string, descendant: string) => Promise<boolean>, contextProvider?: (refName: string, oldSha: string, newSha: string) => Promise<ProtectionContext>): (refName: string, oldSha: string, newSha: string, env: Record<string, string>) => Promise<HookResult>;
/**
 * Create a standard branch protection configuration.
 *
 * @description
 * Creates a common protection configuration suitable for most projects:
 * - Main/master branches: Block force push and deletion
 * - Release branches: Block force push and deletion
 * - All other branches: No protection
 *
 * @param options - Configuration options
 * @returns Branch protection configuration
 *
 * @example
 * ```typescript
 * const config = createStandardProtectionConfig({
 *   protectMain: true,
 *   protectReleases: true,
 *   requiredReviewsForMain: 2,
 * })
 * ```
 */
export declare function createStandardProtectionConfig(options: {
    /** Protect main/master branches */
    protectMain?: boolean;
    /** Protect release/* branches */
    protectReleases?: boolean;
    /** Number of required reviews for main branch */
    requiredReviewsForMain?: number;
    /** Require linear history for main branch */
    requireLinearHistoryForMain?: boolean;
    /** Allow admin bypass */
    allowAdminBypass?: boolean;
    /** Custom main branch name (default: 'main') */
    mainBranchName?: string;
}): BranchProtectionConfig;
export { BranchProtectionRule as ProtectionRule, BranchProtectionConfig as ProtectionConfig, };
//# sourceMappingURL=branch-protection.d.ts.map