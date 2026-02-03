/**
 * @fileoverview Commit Creation Operations
 *
 * Provides functionality for creating, formatting, and amending git commits.
 * Supports author/committer info, parent handling, GPG signing, and message formatting.
 *
 * ## Features
 *
 * - Create new commits with full metadata
 * - Amend existing commits
 * - GPG signature support
 * - Message formatting and validation
 * - Empty commit detection
 * - Author/committer timestamp handling
 *
 * ## Usage Example
 *
 * ```typescript
 * import { createCommit, formatCommitMessage } from './ops/commit'
 *
 * // Create a commit
 * const result = await createCommit(store, {
 *   message: 'Add new feature',
 *   tree: treeHash,
 *   parents: [parentHash],
 *   author: { name: 'John Doe', email: 'john@example.com.ai' }
 * })
 *
 * console.log('Created commit:', result.sha)
 * ```
 *
 * @module ops/commit
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();
// ============================================================================
// Author/Timestamp Utilities
// ============================================================================
/**
 * Gets the current timezone offset string.
 *
 * Returns the local timezone in Git's format (e.g., '+0000', '-0500').
 *
 * @returns Timezone offset string
 *
 * @example
 * ```typescript
 * const tz = getCurrentTimezone()
 * // Returns something like '-0800' for Pacific time
 * ```
 */
export function getCurrentTimezone() {
    const offset = new Date().getTimezoneOffset();
    const sign = offset <= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    const hours = Math.floor(absOffset / 60);
    const minutes = absOffset % 60;
    return `${sign}${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`;
}
/**
 * Formats a timestamp and timezone as git author/committer format.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param timezone - Timezone offset string (e.g., '+0000', '-0500')
 * @returns Formatted string like "1234567890 +0000"
 *
 * @example
 * ```typescript
 * const formatted = formatTimestamp(1609459200, '+0000')
 * // Returns "1609459200 +0000"
 * ```
 */
export function formatTimestamp(timestamp, timezone) {
    return `${timestamp} ${timezone}`;
}
/**
 * Parses a git timestamp string.
 *
 * @param timestampStr - Timestamp string like "1234567890 +0000"
 * @returns Object with parsed timestamp and timezone
 *
 * @throws {Error} If the timestamp format is invalid (must be "SECONDS TIMEZONE")
 *
 * @example
 * ```typescript
 * const { timestamp, timezone } = parseTimestamp("1609459200 -0500")
 * // timestamp = 1609459200, timezone = "-0500"
 * ```
 */
export function parseTimestamp(timestampStr) {
    const match = timestampStr.match(/^(\d+) ([+-]\d{4})$/);
    if (!match || !match[1] || !match[2]) {
        throw new Error(`Invalid timestamp format: ${timestampStr}`);
    }
    return {
        timestamp: parseInt(match[1], 10),
        timezone: match[2]
    };
}
/**
 * Creates an Author object with current timestamp.
 *
 * Convenience function for creating author information with
 * the current time and local timezone.
 *
 * @param name - Author name
 * @param email - Author email
 * @param timezone - Optional timezone (defaults to local timezone)
 * @returns Author object with current timestamp
 *
 * @example
 * ```typescript
 * const author = createAuthor('John Doe', 'john@example.com.ai')
 * // { name: 'John Doe', email: 'john@example.com.ai', timestamp: <now>, timezone: <local> }
 * ```
 */
export function createAuthor(name, email, timezone) {
    return {
        name,
        email,
        timestamp: Math.floor(Date.now() / 1000),
        timezone: timezone ?? getCurrentTimezone()
    };
}
// ============================================================================
// Message Formatting
// ============================================================================
/**
 * Wraps text at a specified column width.
 * @internal
 */
function wrapText(text, column) {
    if (column <= 0)
        return text;
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        if (currentLine.length === 0) {
            currentLine = word;
        }
        else if (currentLine.length + 1 + word.length <= column) {
            currentLine += ' ' + word;
        }
        else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }
    return lines.join('\n');
}
/**
 * Formats a commit message according to git conventions.
 *
 * Applies various transformations based on the cleanup mode:
 * - Strips comments
 * - Normalizes whitespace
 * - Wraps long lines
 * - Removes scissors markers
 *
 * @param message - The raw commit message
 * @param options - Formatting options
 * @returns The formatted commit message
 *
 * @example
 * ```typescript
 * // Clean up a message
 * const formatted = formatCommitMessage(`
 *   Add feature
 *
 *   # This is a comment
 *   Long description here
 * `, { cleanup: 'strip' })
 * // Returns: "Add feature\n\nLong description here"
 * ```
 */
export function formatCommitMessage(message, options = {}) {
    const { cleanup = 'default', commentChar = '#', wrapColumn = 0 } = options;
    // Verbatim mode: return message as-is
    if (cleanup === 'verbatim') {
        return message;
    }
    let result = message;
    // Scissors mode: remove everything after scissors line
    if (cleanup === 'scissors') {
        const scissorsPattern = new RegExp(`^${commentChar} -+ >8 -+`, 'm');
        const scissorsMatch = result.match(scissorsPattern);
        if (scissorsMatch && scissorsMatch.index !== undefined) {
            result = result.slice(0, scissorsMatch.index);
        }
    }
    // Strip comments if cleanup is 'strip' or 'scissors'
    if (cleanup === 'strip' || cleanup === 'scissors') {
        const lines = result.split('\n');
        result = lines.filter(line => !line.startsWith(commentChar)).join('\n');
    }
    // Strip whitespace (for 'whitespace', 'strip', 'scissors', 'default')
    // Note: verbatim check already handled above, so this always runs
    if (true) {
        // Strip leading/trailing whitespace from each line
        const lines = result.split('\n');
        const trimmedLines = lines.map(line => line.trim());
        // Collapse multiple blank lines into one
        const collapsedLines = [];
        let lastWasBlank = false;
        for (const line of trimmedLines) {
            if (line === '') {
                if (!lastWasBlank) {
                    collapsedLines.push(line);
                }
                lastWasBlank = true;
            }
            else {
                collapsedLines.push(line);
                lastWasBlank = false;
            }
        }
        result = collapsedLines.join('\n');
        // Trim leading/trailing blank lines
        result = result.replace(/^\n+/, '').replace(/\n+$/, '');
    }
    // Wrap body (not subject) if wrapColumn is specified
    if (wrapColumn > 0 && result.length > 0) {
        const lines = result.split('\n');
        if (lines.length > 0) {
            const subject = lines[0];
            const rest = lines.slice(1);
            // Find where body starts (after blank line)
            let bodyStartIndex = 0;
            for (let i = 0; i < rest.length; i++) {
                if (rest[i] === '') {
                    bodyStartIndex = i + 1;
                    break;
                }
            }
            // Wrap body lines
            const wrappedRest = [];
            for (let i = 0; i < rest.length; i++) {
                const restLine = rest[i] ?? '';
                if (i >= bodyStartIndex && restLine !== '') {
                    wrappedRest.push(wrapText(restLine, wrapColumn));
                }
                else {
                    wrappedRest.push(restLine);
                }
            }
            result = [subject, ...wrappedRest].join('\n');
        }
    }
    return result;
}
/**
 * Parses a commit message into subject and body.
 *
 * The subject is the first line. The body starts after the first
 * blank line following the subject.
 *
 * @param message - The commit message
 * @returns Object with subject (first line) and body (rest)
 *
 * @example
 * ```typescript
 * const { subject, body } = parseCommitMessage(
 *   'Add feature\n\nThis adds the new feature'
 * )
 * // subject = 'Add feature'
 * // body = 'This adds the new feature'
 * ```
 */
export function parseCommitMessage(message) {
    if (!message) {
        return { subject: '', body: '' };
    }
    const lines = message.split('\n');
    const subject = lines[0] || '';
    // Find the body - it starts after the first blank line (or second line if no blank)
    let bodyStartIndex = 1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '') {
            bodyStartIndex = i + 1;
            break;
        }
    }
    const body = lines.slice(bodyStartIndex).join('\n');
    return { subject, body };
}
/**
 * Validates a commit message format.
 *
 * Checks for common issues and provides warnings for style violations.
 * Returns errors for critical issues that would prevent commit creation.
 *
 * @param message - The commit message to validate
 * @returns Object with valid flag and any error/warning messages
 *
 * @example
 * ```typescript
 * const result = validateCommitMessage('Fix bug.')
 * // {
 * //   valid: true,
 * //   errors: [],
 * //   warnings: ['Subject line should not end with a period']
 * // }
 * ```
 */
export function validateCommitMessage(message) {
    const errors = [];
    const warnings = [];
    if (!message || message.trim() === '') {
        errors.push('Commit message is empty');
        return { valid: false, errors, warnings };
    }
    const { subject, body: _body } = parseCommitMessage(message);
    // Check subject line length (72 chars is conventional max)
    if (subject.length > 72) {
        warnings.push('Subject line exceeds 72 characters');
    }
    // Check if subject ends with a period
    if (subject.endsWith('.')) {
        warnings.push('Subject line should not end with a period');
    }
    // Check for missing blank line between subject and body
    const lines = message.split('\n');
    if (lines.length > 1 && lines[1] !== '') {
        warnings.push('Missing blank line between subject and body');
    }
    return { valid: errors.length === 0, errors, warnings };
}
// ============================================================================
// GPG Signing
// ============================================================================
/**
 * Checks if a commit is signed.
 *
 * @param commit - The commit object
 * @returns true if the commit has a GPG signature
 *
 * @example
 * ```typescript
 * if (isCommitSigned(commit)) {
 *   const sig = extractCommitSignature(commit)
 *   // Verify signature...
 * }
 * ```
 */
export function isCommitSigned(commit) {
    const signedCommit = commit;
    return signedCommit.gpgsig !== undefined && signedCommit.gpgsig !== null;
}
/**
 * Extracts the GPG signature from a signed commit.
 *
 * @param commit - The commit object
 * @returns The signature string if present, null otherwise
 */
export function extractCommitSignature(commit) {
    const signedCommit = commit;
    return signedCommit.gpgsig ?? null;
}
/**
 * Adds a GPG signature to a commit.
 *
 * Creates a new commit object with the signature attached.
 * Does not modify the original commit object.
 *
 * @param commit - The unsigned commit object
 * @param signature - The GPG signature string
 * @returns The signed commit object
 */
export function addSignatureToCommit(commit, signature) {
    const signedCommit = {
        ...commit,
        gpgsig: signature
    };
    return signedCommit;
}
// ============================================================================
// Empty Commit Detection
// ============================================================================
/**
 * Extracts tree SHA from raw commit data.
 * @internal
 */
function extractTreeFromCommitData(data) {
    const content = decoder.decode(data);
    const match = content.match(/tree ([0-9a-f]{40})/);
    return match?.[1] ?? null;
}
/**
 * Checks if a commit would be empty (same tree as parent).
 *
 * A commit is considered empty if its tree SHA is identical to
 * its parent's tree SHA, meaning no files were changed.
 *
 * @param store - The object store for reading objects
 * @param tree - The tree SHA for the new commit
 * @param parent - The parent commit SHA (or null for initial commit)
 * @returns true if the commit would have no changes
 *
 * @example
 * ```typescript
 * const isEmpty = await isEmptyCommit(store, newTreeSha, parentSha)
 * if (isEmpty && !options.allowEmpty) {
 *   throw new Error('Nothing to commit')
 * }
 * ```
 */
export async function isEmptyCommit(store, tree, parent) {
    // Initial commits are never "empty"
    if (parent === null) {
        return false;
    }
    const parentObj = await store.getObject(parent);
    if (!parentObj) {
        return false;
    }
    // Extract tree from parent commit
    const parentTree = extractTreeFromCommitData(parentObj.data);
    return parentTree === tree;
}
// ============================================================================
// Validation Helpers
// ============================================================================
const SHA_REGEX = /^[0-9a-f]{40}$/;
/**
 * Validates a SHA format.
 * @internal
 */
function isValidSha(sha) {
    return SHA_REGEX.test(sha);
}
/**
 * Validates an email format.
 * @internal
 */
function isValidEmail(email) {
    // Basic email validation - must contain @ and have something before and after
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
/**
 * Validates an author name.
 * @internal
 */
function validateAuthorName(name) {
    if (name.includes('<') || name.includes('>')) {
        throw new Error('Author name cannot contain angle brackets');
    }
    if (name.includes('\n')) {
        throw new Error('Author name cannot contain newlines');
    }
}
/**
 * Validates commit options.
 * @internal
 */
function validateCommitOptions(options) {
    // Validate tree
    if (!options.tree) {
        throw new Error('Tree SHA is required');
    }
    if (!isValidSha(options.tree)) {
        throw new Error('Invalid tree SHA format');
    }
    // Validate author
    if (!options.author) {
        throw new Error('Author is required');
    }
    validateAuthorName(options.author.name);
    if (!isValidEmail(options.author.email)) {
        throw new Error('Invalid author email format');
    }
    // Validate committer if provided
    if (options.committer) {
        validateAuthorName(options.committer.name);
        if (!isValidEmail(options.committer.email)) {
            throw new Error('Invalid committer email format');
        }
    }
    // Validate message
    if (!options.message || options.message.trim() === '') {
        throw new Error('Commit message is required');
    }
    // Validate parents
    if (options.parents) {
        for (const parent of options.parents) {
            if (!isValidSha(parent)) {
                throw new Error('Invalid parent SHA format');
            }
        }
    }
    // Validate timestamp if provided
    if (options.author.timestamp !== undefined && options.author.timestamp < 0) {
        throw new Error('Timestamp cannot be negative');
    }
    if (options.committer?.timestamp !== undefined && options.committer.timestamp < 0) {
        throw new Error('Timestamp cannot be negative');
    }
}
// ============================================================================
// Commit Creation
// ============================================================================
/**
 * Resolves a CommitAuthor to a full Author with timestamp and timezone.
 * @internal
 */
function resolveAuthor(commitAuthor) {
    return {
        name: commitAuthor.name,
        email: commitAuthor.email,
        timestamp: commitAuthor.timestamp ?? Math.floor(Date.now() / 1000),
        timezone: commitAuthor.timezone ?? getCurrentTimezone()
    };
}
/**
 * Serializes commit content to bytes (without the header).
 * @internal
 */
function serializeCommitContent(commit) {
    const lines = [];
    lines.push(`tree ${commit.tree}`);
    for (const parent of commit.parents) {
        lines.push(`parent ${parent}`);
    }
    lines.push(`author ${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.timezone}`);
    lines.push(`committer ${commit.committer.name} <${commit.committer.email}> ${commit.committer.timestamp} ${commit.committer.timezone}`);
    // Add gpgsig if present
    if (commit.gpgsig) {
        const sigLines = commit.gpgsig.split('\n');
        lines.push(`gpgsig ${sigLines[0]}`);
        for (let i = 1; i < sigLines.length; i++) {
            lines.push(` ${sigLines[i]}`);
        }
    }
    lines.push('');
    lines.push(commit.message);
    return encoder.encode(lines.join('\n'));
}
/**
 * Builds a commit object from options without storing it.
 *
 * Useful for creating commit objects for inspection or testing
 * without actually persisting them to the object store.
 *
 * @param options - Commit creation options
 * @returns The commit object (not stored)
 *
 * @example
 * ```typescript
 * const commit = buildCommitObject({
 *   message: 'Test commit',
 *   tree: treeSha,
 *   parents: [parentSha],
 *   author: { name: 'Test', email: 'test@example.com.ai' }
 * })
 *
 * console.log(commit.message) // 'Test commit'
 * ```
 */
export function buildCommitObject(options) {
    const author = resolveAuthor(options.author);
    const committer = options.committer ? resolveAuthor(options.committer) : author;
    const parents = options.parents ?? [];
    const commit = {
        type: 'commit',
        data: new Uint8Array(),
        tree: options.tree,
        parents,
        author,
        committer,
        message: options.message
    };
    // Set the data field
    commit.data = serializeCommitContent({
        tree: commit.tree,
        parents: commit.parents,
        author: commit.author,
        committer: commit.committer,
        message: commit.message
    });
    return commit;
}
/**
 * Creates a new commit.
 *
 * Creates a commit object with the specified options and stores it
 * in the object store. Handles validation, empty commit detection,
 * and optional GPG signing.
 *
 * @param store - The object store for reading/writing objects
 * @param options - Commit creation options
 * @returns The created commit result with SHA and commit object
 *
 * @throws {Error} If tree SHA is missing or has invalid format (must be 40 hex chars)
 * @throws {Error} If author is missing, has invalid name (no angle brackets/newlines), or invalid email
 * @throws {Error} If committer has invalid name or email format
 * @throws {Error} If commit message is empty or whitespace only
 * @throws {Error} If parent SHA has invalid format
 * @throws {Error} If timestamp is negative
 * @throws {Error} If commit would be empty and allowEmpty is false
 *
 * @example
 * ```typescript
 * // Basic commit
 * const result = await createCommit(store, {
 *   message: 'Add new feature',
 *   tree: treeSha,
 *   parents: [headSha],
 *   author: { name: 'John', email: 'john@example.com.ai' }
 * })
 *
 * // Signed commit
 * const signedResult = await createCommit(store, {
 *   message: 'Signed commit',
 *   tree: treeSha,
 *   parents: [headSha],
 *   author: { name: 'John', email: 'john@example.com.ai' },
 *   signing: {
 *     sign: true,
 *     signer: async (data) => myGpgSign(data)
 *   }
 * })
 *
 * // Initial commit (no parents)
 * const initialResult = await createCommit(store, {
 *   message: 'Initial commit',
 *   tree: treeSha,
 *   parents: [],
 *   author: { name: 'John', email: 'john@example.com.ai' }
 * })
 * ```
 */
export async function createCommit(store, options) {
    // Validate options
    validateCommitOptions(options);
    const parents = options.parents ?? [];
    // Check for empty commit
    const firstParent = parents[0];
    if (options.allowEmpty === false && firstParent !== undefined) {
        const isEmpty = await isEmptyCommit(store, options.tree, firstParent);
        if (isEmpty) {
            throw new Error('Nothing to commit (empty commit not allowed)');
        }
    }
    // Build the commit object
    let commit = buildCommitObject(options);
    // Sign if requested
    if (options.signing?.sign && options.signing.signer) {
        const commitData = serializeCommitContent({
            tree: commit.tree,
            parents: commit.parents,
            author: commit.author,
            committer: commit.committer,
            message: commit.message
        });
        const signature = await options.signing.signer(commitData);
        commit = addSignatureToCommit(commit, signature);
        // Update commit data with signature
        const signedCommit = commit;
        const commitContent = {
            tree: commit.tree,
            parents: commit.parents,
            author: commit.author,
            committer: commit.committer,
            message: commit.message
        };
        if (signedCommit.gpgsig) {
            commitContent.gpgsig = signedCommit.gpgsig;
        }
        commit.data = serializeCommitContent(commitContent);
    }
    // Store the commit
    const sha = await store.storeObject('commit', commit.data);
    return {
        sha,
        commit,
        created: true
    };
}
// ============================================================================
// Commit Amendment
// ============================================================================
/**
 * Parses a stored commit object from raw data.
 * Supports both git text format and JSON format (for testing).
 * @internal
 */
function parseStoredCommit(data) {
    const content = decoder.decode(data);
    // Try to parse as JSON first (for test compatibility)
    if (content.startsWith('{')) {
        try {
            const parsed = JSON.parse(content);
            return {
                tree: parsed.tree,
                parents: parsed.parents || [],
                author: parsed.author,
                committer: parsed.committer || parsed.author,
                message: parsed.message
            };
        }
        catch {
            // Not JSON, fall through to git format parsing
        }
    }
    // Parse git text format
    const lines = content.split('\n');
    let tree = '';
    const parents = [];
    let author = null;
    let committer = null;
    let messageStartIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined || line === '') {
            messageStartIndex = i + 1;
            break;
        }
        if (line.startsWith('tree ')) {
            tree = line.slice(5);
        }
        else if (line.startsWith('parent ')) {
            parents.push(line.slice(7));
        }
        else if (line.startsWith('author ')) {
            const match = line.match(/^author (.+) <(.+)> (\d+) ([+-]\d{4})$/);
            if (match && match[1] && match[2] && match[3] && match[4]) {
                author = {
                    name: match[1],
                    email: match[2],
                    timestamp: parseInt(match[3], 10),
                    timezone: match[4]
                };
            }
        }
        else if (line.startsWith('committer ')) {
            const match = line.match(/^committer (.+) <(.+)> (\d+) ([+-]\d{4})$/);
            if (match && match[1] && match[2] && match[3] && match[4]) {
                committer = {
                    name: match[1],
                    email: match[2],
                    timestamp: parseInt(match[3], 10),
                    timezone: match[4]
                };
            }
        }
    }
    const message = lines.slice(messageStartIndex).join('\n');
    if (!author) {
        author = { name: 'Unknown', email: 'unknown@example.com.ai', timestamp: 0, timezone: '+0000' };
    }
    if (!committer) {
        committer = author;
    }
    return { tree, parents, author, committer, message };
}
/**
 * Amends an existing commit.
 *
 * Creates a new commit that replaces the specified commit.
 * The original commit is not modified. Only specified fields
 * in options will be changed from the original.
 *
 * Note: This does not update any refs. The caller is responsible
 * for updating HEAD or branch refs to point to the new commit.
 *
 * @param store - The object store for reading/writing objects
 * @param commitSha - SHA of the commit to amend
 * @param options - Amendment options (only specified fields are changed)
 * @returns The new commit result (original commit is not modified)
 *
 * @throws {Error} If the commit doesn't exist in the object store
 *
 * @example
 * ```typescript
 * // Change just the message
 * const newCommit = await amendCommit(store, headSha, {
 *   message: 'Better commit message'
 * })
 *
 * // Update tree and committer
 * const newCommit = await amendCommit(store, headSha, {
 *   tree: newTreeSha,
 *   committer: { name: 'New Name', email: 'new@example.com.ai' }
 * })
 * ```
 */
export async function amendCommit(store, commitSha, options) {
    // Get the original commit
    const originalObj = await store.getObject(commitSha);
    if (!originalObj) {
        throw new Error(`Commit not found: ${commitSha}`);
    }
    // Parse the original commit
    const original = parseStoredCommit(originalObj.data);
    // Build new author
    let newAuthor = original.author;
    if (options.author) {
        newAuthor = resolveAuthor(options.author);
    }
    else if (options.resetAuthorDate) {
        newAuthor = {
            ...original.author,
            timestamp: Math.floor(Date.now() / 1000)
        };
    }
    // Build new committer (defaults to current time)
    let newCommitter;
    if (options.committer) {
        newCommitter = resolveAuthor(options.committer);
    }
    else {
        newCommitter = {
            ...original.committer,
            timestamp: Math.floor(Date.now() / 1000),
            timezone: getCurrentTimezone()
        };
    }
    // Build new commit
    const newCommitOptions = {
        message: options.message ?? original.message,
        tree: options.tree ?? original.tree,
        parents: original.parents,
        author: newAuthor,
        committer: newCommitter,
        allowEmpty: true
    };
    if (options.signing) {
        newCommitOptions.signing = options.signing;
    }
    return createCommit(store, newCommitOptions);
}
//# sourceMappingURL=commit.js.map