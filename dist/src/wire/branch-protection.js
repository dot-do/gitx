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
import { ZERO_SHA } from './receive-pack';
import { EXACT_MATCH_SPECIFICITY } from '../constants';
// ============================================================================
// Pattern Matching
// ============================================================================
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
export function matchBranchPattern(refName, pattern) {
    // Escape special regex characters except * and ?
    let regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    // Convert ** to a placeholder, then * to [^/]*, then ** placeholder to .*
    regexPattern = regexPattern
        .replace(/\*\*/g, '\0DOUBLE_STAR\0')
        .replace(/\*/g, '[^/]*')
        .replace(/\0DOUBLE_STAR\0/g, '.*')
        .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(refName);
}
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
export function findMatchingRule(refName, rules) {
    const matches = [];
    for (const rule of rules) {
        if (matchBranchPattern(refName, rule.pattern)) {
            // Calculate specificity: exact matches > fewer wildcards > longer patterns
            let specificity = 0;
            // Exact match gets highest specificity
            if (rule.pattern === refName) {
                specificity = EXACT_MATCH_SPECIFICITY;
            }
            else {
                // Count wildcards (** counts as 2, * counts as 1)
                const doubleStars = (rule.pattern.match(/\*\*/g) || []).length;
                const singleStars = (rule.pattern.match(/(?<!\*)\*(?!\*)/g) || []).length;
                const wildcardPenalty = doubleStars * 100 + singleStars * 10;
                // Longer patterns are more specific
                specificity = rule.pattern.length * 10 - wildcardPenalty;
            }
            matches.push({ rule, specificity });
        }
    }
    if (matches.length === 0) {
        return undefined;
    }
    // Sort by specificity (highest first) and return the most specific
    matches.sort((a, b) => b.specificity - a.specificity);
    const bestMatch = matches[0];
    return bestMatch ? bestMatch.rule : undefined;
}
// ============================================================================
// Protection Rule Evaluation
// ============================================================================
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
export function checkProtectionRule(command, config, context = {}, isNonFastForward = false) {
    // If protection is disabled, allow everything
    if (config.enabled === false) {
        return { allowed: true };
    }
    // Find matching rule
    const rule = findMatchingRule(command.refName, config.rules);
    // If no rule matches, apply default protection if available
    const effectiveRule = rule ?? config.defaultProtection;
    if (!effectiveRule) {
        return { allowed: true };
    }
    // Check bypass conditions first
    if (canBypass(effectiveRule, context)) {
        return { allowed: true };
    }
    // Check lock status
    if (effectiveRule.lockBranch) {
        return createRejection('branch_locked', effectiveRule, command.refName, 'Branch is locked and cannot be modified');
    }
    // Check deletion
    if (command.type === 'delete') {
        if (effectiveRule.blockDeletion) {
            return createRejection('deletion_blocked', effectiveRule, command.refName, 'Branch deletion is not allowed');
        }
        // For deletions, other checks don't apply
        return { allowed: true };
    }
    // Check force push (non-fast-forward)
    if (isNonFastForward && effectiveRule.blockForcePush) {
        return createRejection('force_push_blocked', effectiveRule, command.refName, 'Force push is not allowed on this branch');
    }
    // Check required reviews
    if (effectiveRule.requiredReviews !== undefined && effectiveRule.requiredReviews > 0) {
        const approvedCount = context.approvedReviews ?? 0;
        if (approvedCount < effectiveRule.requiredReviews) {
            return createRejection('reviews_required', effectiveRule, command.refName, `Requires ${effectiveRule.requiredReviews} approving review(s), got ${approvedCount}`, `Get ${effectiveRule.requiredReviews - approvedCount} more approving review(s)`);
        }
    }
    // Check linear history
    if (effectiveRule.requireLinearHistory && context.hasLinearHistory === false) {
        return createRejection('linear_history_required', effectiveRule, command.refName, 'Linear history is required (no merge commits)', 'Rebase your changes instead of merging');
    }
    // Check signed commits
    if (effectiveRule.requireSignedCommits && context.commitsAreSigned === false) {
        return createRejection('signed_commits_required', effectiveRule, command.refName, 'All commits must be signed', 'Sign your commits with a GPG key');
    }
    // Check status checks
    if (effectiveRule.requiredStatusChecks && effectiveRule.requiredStatusChecks.length > 0) {
        const passedChecks = new Set(context.passedStatusChecks ?? []);
        const missingChecks = effectiveRule.requiredStatusChecks.filter((check) => !passedChecks.has(check));
        if (missingChecks.length > 0) {
            return createRejection('status_checks_required', effectiveRule, command.refName, `Required status checks not passed: ${missingChecks.join(', ')}`, `Wait for status checks to pass: ${missingChecks.join(', ')}`);
        }
    }
    // Check up to date requirement
    if (effectiveRule.requireUpToDate && context.isUpToDate === false) {
        return createRejection('up_to_date_required', effectiveRule, command.refName, 'Branch must be up to date before pushing', 'Pull the latest changes and rebase your work');
    }
    // Check conversation resolution
    if (effectiveRule.requireConversationResolution && context.conversationsResolved === false) {
        return createRejection('conversation_resolution_required', effectiveRule, command.refName, 'All conversations must be resolved', 'Resolve all review comments before pushing');
    }
    return { allowed: true };
}
/**
 * Check if the user can bypass protection rules.
 */
function canBypass(rule, context) {
    // Admin bypass
    if (rule.allowAdminBypass && context.isAdmin) {
        return true;
    }
    // User bypass
    if (rule.bypassUsers && context.username && rule.bypassUsers.includes(context.username)) {
        return true;
    }
    // Team bypass
    if (rule.bypassTeams && context.teams) {
        for (const team of context.teams) {
            if (rule.bypassTeams.includes(team)) {
                return true;
            }
        }
    }
    return false;
}
/**
 * Create a rejection result.
 */
function createRejection(_type, rule, _branch, reason, suggestion) {
    const customMessage = rule.customMessage;
    const result = {
        allowed: false,
        reason: customMessage ?? reason,
        violatedRule: rule,
    };
    if (suggestion !== undefined) {
        result.suggestion = suggestion;
    }
    return result;
}
// ============================================================================
// Pre-Receive Hook Integration
// ============================================================================
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
export function createBranchProtectionHook(config, contextProvider) {
    return async (commands, env) => {
        const violations = [];
        for (const command of commands) {
            // Get context for this command
            const context = contextProvider ? await contextProvider(command) : {};
            // Determine if this is a non-fast-forward update
            // In a real implementation, this would check ancestry
            const isNonFastForward = command.type === 'update' && env['GIT_PUSH_OPTION_FORCE'] === 'true';
            // Check protection rules
            const result = checkProtectionRule(command, config, context, isNonFastForward);
            if (!result.allowed && result.violatedRule) {
                violations.push({
                    type: getViolationType(result.reason ?? ''),
                    message: result.reason ?? 'Protection rule violated',
                    branch: command.refName,
                    rule: result.violatedRule,
                    details: { suggestion: result.suggestion },
                });
            }
        }
        if (violations.length > 0) {
            const messages = violations.map((v) => `${v.branch}: ${v.message}`);
            return {
                success: false,
                message: `Branch protection violation(s):\n${messages.join('\n')}`,
            };
        }
        return { success: true };
    };
}
/**
 * Get the violation type from a reason message.
 */
function getViolationType(reason) {
    if (reason.includes('Force push'))
        return 'force_push_blocked';
    if (reason.includes('deletion'))
        return 'deletion_blocked';
    if (reason.includes('locked'))
        return 'branch_locked';
    if (reason.includes('Linear history'))
        return 'linear_history_required';
    if (reason.includes('review'))
        return 'reviews_required';
    if (reason.includes('signed'))
        return 'signed_commits_required';
    if (reason.includes('status check'))
        return 'status_checks_required';
    if (reason.includes('up to date'))
        return 'up_to_date_required';
    if (reason.includes('conversation'))
        return 'conversation_resolution_required';
    return 'force_push_blocked'; // Default
}
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
export function createBranchProtectionUpdateHook(config, isAncestor, contextProvider) {
    return async (refName, oldSha, newSha, _env) => {
        // Determine command type
        let type;
        if (oldSha === ZERO_SHA) {
            type = 'create';
        }
        else if (newSha === ZERO_SHA) {
            type = 'delete';
        }
        else {
            type = 'update';
        }
        const command = { oldSha, newSha, refName, type };
        // Get context
        const context = contextProvider ? await contextProvider(refName, oldSha, newSha) : {};
        // Check if this is a non-fast-forward update
        let isNonFastForward = false;
        if (type === 'update') {
            isNonFastForward = !(await isAncestor(oldSha, newSha));
        }
        // Check protection rules
        const result = checkProtectionRule(command, config, context, isNonFastForward);
        if (!result.allowed) {
            return {
                success: false,
                message: result.reason ?? 'Branch protection rule violated',
            };
        }
        return { success: true };
    };
}
// ============================================================================
// Default Configurations
// ============================================================================
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
export function createStandardProtectionConfig(options) {
    const rules = [];
    const mainBranch = options.mainBranchName ?? 'main';
    if (options.protectMain !== false) {
        const mainRule = {
            pattern: `refs/heads/${mainBranch}`,
            blockForcePush: true,
            blockDeletion: true,
        };
        if (options.requiredReviewsForMain !== undefined) {
            mainRule.requiredReviews = options.requiredReviewsForMain;
        }
        if (options.requireLinearHistoryForMain !== undefined) {
            mainRule.requireLinearHistory = options.requireLinearHistoryForMain;
        }
        if (options.allowAdminBypass !== undefined) {
            mainRule.allowAdminBypass = options.allowAdminBypass;
        }
        rules.push(mainRule);
        // Also protect 'master' if main is specified
        if (mainBranch === 'main') {
            const masterRule = {
                pattern: 'refs/heads/master',
                blockForcePush: true,
                blockDeletion: true,
            };
            if (options.requiredReviewsForMain !== undefined) {
                masterRule.requiredReviews = options.requiredReviewsForMain;
            }
            if (options.requireLinearHistoryForMain !== undefined) {
                masterRule.requireLinearHistory = options.requireLinearHistoryForMain;
            }
            if (options.allowAdminBypass !== undefined) {
                masterRule.allowAdminBypass = options.allowAdminBypass;
            }
            rules.push(masterRule);
        }
    }
    if (options.protectReleases !== false) {
        const releaseRule = {
            pattern: 'refs/heads/release/*',
            blockForcePush: true,
            blockDeletion: true,
        };
        if (options.allowAdminBypass !== undefined) {
            releaseRule.allowAdminBypass = options.allowAdminBypass;
        }
        rules.push(releaseRule);
        const releaseGlobRule = {
            pattern: 'refs/heads/release/**',
            blockForcePush: true,
            blockDeletion: true,
        };
        if (options.allowAdminBypass !== undefined) {
            releaseGlobRule.allowAdminBypass = options.allowAdminBypass;
        }
        rules.push(releaseGlobRule);
    }
    return {
        rules,
        enabled: true,
    };
}
//# sourceMappingURL=branch-protection.js.map