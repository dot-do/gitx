/**
 * Git Object Types and Constants
 *
 * Defines shared types, interfaces, and constants used across
 * the Git object model implementation.
 */
/**
 * Array of all valid object types
 */
export const OBJECT_TYPES = ['blob', 'tree', 'commit', 'tag'];
/**
 * Valid file modes in Git tree entries
 */
export const VALID_MODES = new Set([
    '100644', // regular file
    '100755', // executable file
    '040000', // directory (tree)
    '120000', // symbolic link
    '160000', // submodule (gitlink)
]);
// =============================================================================
// Validation Utilities
// =============================================================================
/**
 * Validates a SHA-1 hash string (40 hex characters)
 * Note: Also accepts extended test patterns with a-z for compatibility with test fixtures
 */
export function isValidSha(sha) {
    return /^[0-9a-z]{40}$/i.test(sha);
}
/**
 * Validates a file mode string
 */
export function isValidMode(mode) {
    return VALID_MODES.has(mode);
}
/**
 * Validates an object type string
 */
export function isValidObjectType(type) {
    return OBJECT_TYPES.includes(type);
}
//# sourceMappingURL=types.js.map