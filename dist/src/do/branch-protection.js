/**
 * @fileoverview Branch Protection Rules
 *
 * Provides branch protection rules that are checked during ref updates
 * (push operations). Protection rules are stored in SQLite and evaluated
 * against ref update commands before they are applied.
 *
 * @module do/branch-protection
 */
// ============================================================================
// Schema
// ============================================================================
const ZERO_SHA = '0000000000000000000000000000000000000000';
/** SQL to create the branch_protection table. */
export const BRANCH_PROTECTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS branch_protection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  required_reviews INTEGER NOT NULL DEFAULT 0,
  prevent_force_push INTEGER NOT NULL DEFAULT 1,
  prevent_deletion INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branch_protection_pattern ON branch_protection(pattern);
CREATE INDEX IF NOT EXISTS idx_branch_protection_enabled ON branch_protection(enabled);
`;
// ============================================================================
// Pattern Matching
// ============================================================================
/**
 * Match a ref name against a glob-style pattern.
 *
 * Supports:
 * - Exact match: 'refs/heads/main'
 * - Wildcard suffix: 'refs/heads/release/*' matches 'refs/heads/release/v1'
 * - Single '*' matches any ref
 */
export function matchesProtectionPattern(refName, pattern) {
    if (pattern === '*')
        return true;
    if (!pattern.includes('*'))
        return refName === pattern;
    // Convert glob to regex: escape special chars, replace * with [^/]* for single segment
    // or .* for ** (double star)
    const regexStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '{{DOUBLESTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\{\{DOUBLESTAR\}\}/g, '.*');
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(refName);
}
// ============================================================================
// Protection Check
// ============================================================================
/**
 * Check a ref update against a set of branch protection rules.
 *
 * Returns the first denial found, or an allowed result if no rules block the update.
 */
export function checkBranchProtection(update, rules) {
    const isDelete = update.newSha === ZERO_SHA;
    const isCreate = update.oldSha === ZERO_SHA;
    for (const rule of rules) {
        if (!rule.enabled)
            continue;
        if (!matchesProtectionPattern(update.refName, rule.pattern))
            continue;
        // Check deletion protection
        if (isDelete && rule.preventDeletion) {
            return {
                allowed: false,
                reason: `protected branch: deletion of '${update.refName}' is not allowed (rule: ${rule.pattern})`,
                rule,
            };
        }
        // Check force push protection (only relevant for updates, not creates or deletes)
        if (!isDelete && !isCreate && update.isForcePush && rule.preventForcePush) {
            return {
                allowed: false,
                reason: `protected branch: force push to '${update.refName}' is not allowed (rule: ${rule.pattern})`,
                rule,
            };
        }
        // Check required reviews (caller is responsible for providing review count;
        // for now, if requiredReviews > 0, direct pushes are blocked)
        if (!isDelete && rule.requiredReviews > 0) {
            return {
                allowed: false,
                reason: `protected branch: '${update.refName}' requires ${rule.requiredReviews} review(s) before update (rule: ${rule.pattern})`,
                rule,
            };
        }
    }
    return { allowed: true };
}
// ============================================================================
// BranchProtectionManager (SQLite CRUD)
// ============================================================================
/**
 * Manages branch protection rules in SQLite.
 */
export class BranchProtectionManager {
    storage;
    constructor(storage) {
        this.storage = storage;
    }
    /** Ensure the branch_protection table exists. */
    initializeSchema() {
        this.storage.sql.exec(BRANCH_PROTECTION_SCHEMA_SQL);
    }
    /** Add or update a branch protection rule. Returns the rule ID. */
    upsertRule(input) {
        const now = Date.now();
        const rows = this.storage.sql.exec('SELECT id FROM branch_protection WHERE pattern = ?', input.pattern).toArray();
        if (rows.length > 0) {
            const id = rows[0].id;
            this.storage.sql.exec(`UPDATE branch_protection SET
          required_reviews = ?, prevent_force_push = ?, prevent_deletion = ?, enabled = ?, updated_at = ?
        WHERE id = ?`, input.requiredReviews ?? 0, input.preventForcePush !== false ? 1 : 0, input.preventDeletion !== false ? 1 : 0, input.enabled !== false ? 1 : 0, now, id);
            return id;
        }
        this.storage.sql.exec(`INSERT INTO branch_protection (pattern, required_reviews, prevent_force_push, prevent_deletion, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, input.pattern, input.requiredReviews ?? 0, input.preventForcePush !== false ? 1 : 0, input.preventDeletion !== false ? 1 : 0, input.enabled !== false ? 1 : 0, now, now);
        const result = this.storage.sql.exec('SELECT id FROM branch_protection WHERE pattern = ?', input.pattern).toArray();
        return result[0].id;
    }
    /** Remove a protection rule by pattern. Returns true if deleted. */
    removeRule(pattern) {
        const before = this.storage.sql.exec('SELECT COUNT(*) as cnt FROM branch_protection WHERE pattern = ?', pattern).toArray();
        this.storage.sql.exec('DELETE FROM branch_protection WHERE pattern = ?', pattern);
        return (before[0]?.cnt ?? 0) > 0;
    }
    /** Get all enabled protection rules. */
    getEnabledRules() {
        const rows = this.storage.sql.exec('SELECT * FROM branch_protection WHERE enabled = 1 ORDER BY id').toArray();
        return rows.map(row => ({
            id: row.id,
            pattern: row.pattern,
            requiredReviews: row.required_reviews,
            preventForcePush: row.prevent_force_push === 1,
            preventDeletion: row.prevent_deletion === 1,
            enabled: row.enabled === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
    }
    /** Get all protection rules (including disabled). */
    getAllRules() {
        const rows = this.storage.sql.exec('SELECT * FROM branch_protection ORDER BY id').toArray();
        return rows.map(row => ({
            id: row.id,
            pattern: row.pattern,
            requiredReviews: row.required_reviews,
            preventForcePush: row.prevent_force_push === 1,
            preventDeletion: row.prevent_deletion === 1,
            enabled: row.enabled === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
    }
    /**
     * Check a ref update against all enabled protection rules.
     * Convenience method that loads rules and runs the check.
     */
    checkUpdate(update) {
        const rules = this.getEnabledRules();
        return checkBranchProtection(update, rules);
    }
}
//# sourceMappingURL=branch-protection.js.map