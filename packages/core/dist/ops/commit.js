/**
 * @fileoverview Commit Creation Operations
 *
 * Provides functionality for creating, formatting, and amending git commits.
 * Supports author/committer info, parent handling, GPG signing, and message formatting.
 *
 * @module ops/commit
 */
// =============================================================================
// Author/Timestamp Utilities
// =============================================================================
/**
 * Gets the current timezone offset string.
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
 */
export function formatTimestamp(timestamp, timezone) {
    return `${timestamp} ${timezone}`;
}
/**
 * Parses a git timestamp string.
 */
export function parseTimestamp(timestampStr) {
    const match = timestampStr.match(/^(\d+) ([+-]\d{4})$/);
    if (!match) {
        throw new Error(`Invalid timestamp format: ${timestampStr}`);
    }
    return {
        timestamp: parseInt(match[1], 10),
        timezone: match[2]
    };
}
/**
 * Creates an Author object with current timestamp.
 */
export function createAuthor(name, email, timezone) {
    return {
        name,
        email,
        timestamp: Math.floor(Date.now() / 1000),
        timezone: timezone ?? getCurrentTimezone()
    };
}
// =============================================================================
// Message Formatting
// =============================================================================
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
 */
export function formatCommitMessage(message, options = {}) {
    const { cleanup = 'default', commentChar = '#', wrapColumn = 0 } = options;
    if (cleanup === 'verbatim') {
        return message;
    }
    let result = message;
    if (cleanup === 'scissors') {
        const scissorsPattern = new RegExp(`^${commentChar} -+ >8 -+`, 'm');
        const scissorsMatch = result.match(scissorsPattern);
        if (scissorsMatch && scissorsMatch.index !== undefined) {
            result = result.slice(0, scissorsMatch.index);
        }
    }
    if (cleanup === 'strip' || cleanup === 'scissors') {
        const lines = result.split('\n');
        result = lines.filter(line => !line.startsWith(commentChar)).join('\n');
    }
    // Strip whitespace
    const lines = result.split('\n');
    const trimmedLines = lines.map(line => line.trim());
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
    result = result.replace(/^\n+/, '').replace(/\n+$/, '');
    if (wrapColumn > 0 && result.length > 0) {
        const resultLines = result.split('\n');
        if (resultLines.length > 0) {
            const subject = resultLines[0];
            const rest = resultLines.slice(1);
            let bodyStartIndex = 0;
            for (let i = 0; i < rest.length; i++) {
                if (rest[i] === '') {
                    bodyStartIndex = i + 1;
                    break;
                }
            }
            const wrappedRest = [];
            for (let i = 0; i < rest.length; i++) {
                if (i >= bodyStartIndex && rest[i] !== '') {
                    wrappedRest.push(wrapText(rest[i], wrapColumn));
                }
                else {
                    wrappedRest.push(rest[i]);
                }
            }
            result = [subject, ...wrappedRest].join('\n');
        }
    }
    return result;
}
/**
 * Parses a commit message into subject and body.
 */
export function parseCommitMessage(message) {
    if (!message) {
        return { subject: '', body: '' };
    }
    const lines = message.split('\n');
    const subject = lines[0] || '';
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
 */
export function validateCommitMessage(message) {
    const errors = [];
    const warnings = [];
    if (!message || message.trim() === '') {
        errors.push('Commit message is empty');
        return { valid: false, errors, warnings };
    }
    const { subject } = parseCommitMessage(message);
    if (subject.length > 72) {
        warnings.push('Subject line exceeds 72 characters');
    }
    if (subject.endsWith('.')) {
        warnings.push('Subject line should not end with a period');
    }
    const lines = message.split('\n');
    if (lines.length > 1 && lines[1] !== '') {
        warnings.push('Missing blank line between subject and body');
    }
    return { valid: errors.length === 0, errors, warnings };
}
/**
 * Checks if a commit is signed.
 */
export function isCommitSigned(commit) {
    const signedCommit = commit;
    return signedCommit.gpgsig !== undefined && signedCommit.gpgsig !== null;
}
/**
 * Extracts the GPG signature from a signed commit.
 */
export function extractCommitSignature(commit) {
    const signedCommit = commit;
    return signedCommit.gpgsig ?? null;
}
/**
 * Adds a GPG signature to a commit.
 */
export function addSignatureToCommit(commit, signature) {
    const signedCommit = {
        ...commit,
        gpgsig: signature
    };
    return signedCommit;
}
// =============================================================================
// Empty Commit Detection
// =============================================================================
function extractTreeFromCommitData(data) {
    const decoder = new TextDecoder();
    const content = decoder.decode(data);
    const match = content.match(/tree ([0-9a-f]{40})/);
    return match ? match[1] : null;
}
/**
 * Checks if a commit would be empty (same tree as parent).
 */
export async function isEmptyCommit(store, tree, parent) {
    if (parent === null) {
        return false;
    }
    const parentObj = await store.getObject(parent);
    if (!parentObj) {
        return false;
    }
    const parentTree = extractTreeFromCommitData(parentObj.data);
    return parentTree === tree;
}
// =============================================================================
// Validation Helpers
// =============================================================================
const SHA_REGEX = /^[0-9a-f]{40}$/;
function isValidSha(sha) {
    return SHA_REGEX.test(sha);
}
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validateAuthorName(name) {
    if (name.includes('<') || name.includes('>')) {
        throw new Error('Author name cannot contain angle brackets');
    }
    if (name.includes('\n')) {
        throw new Error('Author name cannot contain newlines');
    }
}
function validateCommitOptions(options) {
    if (!options.tree) {
        throw new Error('Tree SHA is required');
    }
    if (!isValidSha(options.tree)) {
        throw new Error('Invalid tree SHA format');
    }
    if (!options.author) {
        throw new Error('Author is required');
    }
    validateAuthorName(options.author.name);
    if (!isValidEmail(options.author.email)) {
        throw new Error('Invalid author email format');
    }
    if (options.committer) {
        validateAuthorName(options.committer.name);
        if (!isValidEmail(options.committer.email)) {
            throw new Error('Invalid committer email format');
        }
    }
    if (!options.message || options.message.trim() === '') {
        throw new Error('Commit message is required');
    }
    if (options.parents) {
        for (const parent of options.parents) {
            if (!isValidSha(parent)) {
                throw new Error('Invalid parent SHA format');
            }
        }
    }
    if (options.author.timestamp !== undefined && options.author.timestamp < 0) {
        throw new Error('Timestamp cannot be negative');
    }
    if (options.committer?.timestamp !== undefined && options.committer.timestamp < 0) {
        throw new Error('Timestamp cannot be negative');
    }
}
// =============================================================================
// Commit Creation
// =============================================================================
function resolveAuthor(commitAuthor) {
    return {
        name: commitAuthor.name,
        email: commitAuthor.email,
        timestamp: commitAuthor.timestamp ?? Math.floor(Date.now() / 1000),
        timezone: commitAuthor.timezone ?? getCurrentTimezone()
    };
}
function serializeCommitContent(commit) {
    const encoder = new TextEncoder();
    const lines = [];
    lines.push(`tree ${commit.tree}`);
    for (const parent of commit.parents) {
        lines.push(`parent ${parent}`);
    }
    lines.push(`author ${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.timezone}`);
    lines.push(`committer ${commit.committer.name} <${commit.committer.email}> ${commit.committer.timestamp} ${commit.committer.timezone}`);
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
 */
export async function createCommit(store, options) {
    validateCommitOptions(options);
    const parents = options.parents ?? [];
    if (options.allowEmpty === false && parents.length > 0) {
        const isEmpty = await isEmptyCommit(store, options.tree, parents[0]);
        if (isEmpty) {
            throw new Error('Nothing to commit (empty commit not allowed)');
        }
    }
    let commit = buildCommitObject(options);
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
        const signedCommit = commit;
        commit.data = serializeCommitContent({
            tree: commit.tree,
            parents: commit.parents,
            author: commit.author,
            committer: commit.committer,
            message: commit.message,
            gpgsig: signedCommit.gpgsig
        });
    }
    const sha = await store.storeObject('commit', commit.data);
    return {
        sha,
        commit,
        created: true
    };
}
// =============================================================================
// Commit Amendment
// =============================================================================
function parseStoredCommit(data) {
    const decoder = new TextDecoder();
    const content = decoder.decode(data);
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
            // Not JSON, fall through
        }
    }
    const lines = content.split('\n');
    let tree = '';
    const parents = [];
    let author = null;
    let committer = null;
    let messageStartIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === '') {
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
            if (match) {
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
            if (match) {
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
        author = { name: 'Unknown', email: 'unknown@example.com', timestamp: 0, timezone: '+0000' };
    }
    if (!committer) {
        committer = author;
    }
    return { tree, parents, author, committer, message };
}
/**
 * Amends an existing commit.
 */
export async function amendCommit(store, commitSha, options) {
    const originalObj = await store.getObject(commitSha);
    if (!originalObj) {
        throw new Error(`Commit not found: ${commitSha}`);
    }
    const original = parseStoredCommit(originalObj.data);
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
    const newCommitOptions = {
        message: options.message ?? original.message,
        tree: options.tree ?? original.tree,
        parents: original.parents,
        author: newAuthor,
        committer: newCommitter,
        signing: options.signing,
        allowEmpty: true
    };
    return createCommit(store, newCommitOptions);
}
//# sourceMappingURL=commit.js.map