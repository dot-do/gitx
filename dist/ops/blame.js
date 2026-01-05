/**
 * Git Blame Algorithm
 *
 * This module provides functionality for attributing each line of a file
 * to the commit that last modified it.
 */
// ============================================================================
// Helper Functions
// ============================================================================
const decoder = new TextDecoder();
/**
 * Check if content is likely binary (contains null bytes or other non-text chars)
 */
function isBinaryContent(data) {
    // Check first 8000 bytes or entire file if smaller
    const checkLength = Math.min(data.length, 8000);
    for (let i = 0; i < checkLength; i++) {
        // Null byte is a strong indicator of binary
        if (data[i] === 0)
            return true;
    }
    return false;
}
/**
 * Split content into lines, handling various line ending styles
 */
function splitLines(content) {
    if (content === '')
        return [];
    // Split by \n but handle \r\n as well
    const lines = content.split('\n');
    // If there's a trailing newline, the split will create an empty final element
    // which we should remove to match expected behavior
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines.map(line => line.replace(/\r$/, ''));
}
/**
 * Normalize line for comparison (optionally ignoring whitespace)
 */
function normalizeLine(line, ignoreWhitespace) {
    if (ignoreWhitespace) {
        return line.trim().replace(/\s+/g, ' ');
    }
    return line;
}
/**
 * Get file at commit, traversing nested paths
 */
async function getFileAtPath(storage, commit, path) {
    // Try the direct storage method first
    const directResult = await storage.getFileAtCommit(commit.tree, path);
    if (directResult)
        return directResult;
    // Handle nested paths manually
    const parts = path.split('/');
    let currentTreeSha = commit.tree;
    for (let i = 0; i < parts.length; i++) {
        const tree = await storage.getTree(currentTreeSha);
        if (!tree)
            return null;
        const entry = tree.entries.find(e => e.name === parts[i]);
        if (!entry)
            return null;
        if (i === parts.length - 1) {
            // Final part - should be a file
            return storage.getBlob(entry.sha);
        }
        else {
            // Intermediate part - should be a directory
            if (entry.mode !== '040000')
                return null;
            currentTreeSha = entry.sha;
        }
    }
    return null;
}
/**
 * Simple LCS-based diff to find unchanged lines between two file versions
 * Returns a mapping of (oldLineIndex -> newLineIndex) for unchanged lines
 */
function computeLineMapping(oldLines, newLines, ignoreWhitespace = false) {
    // Build a map of unchanged line positions
    const mapping = new Map();
    // Normalize lines for comparison if needed
    const normalizedOld = oldLines.map(l => normalizeLine(l, ignoreWhitespace));
    const normalizedNew = newLines.map(l => normalizeLine(l, ignoreWhitespace));
    // Use a simple greedy LCS approach for line matching
    // Build LCS table
    const m = oldLines.length;
    const n = newLines.length;
    if (m === 0 || n === 0)
        return mapping;
    // Create LCS table
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (normalizedOld[i - 1] === normalizedNew[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            }
            else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    // Backtrack to find the matching lines
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (normalizedOld[i - 1] === normalizedNew[j - 1]) {
            mapping.set(i - 1, j - 1); // 0-indexed
            i--;
            j--;
        }
        else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        }
        else {
            j--;
        }
    }
    return mapping;
}
/**
 * Parse line range specification (git-style -L option)
 */
function parseLineRange(lineRange, lines) {
    const totalLines = lines.length;
    // Handle regex patterns like /pattern1/,/pattern2/
    if (lineRange.startsWith('/')) {
        const parts = lineRange.match(/^\/(.+)\/,\/(.+)\/$/);
        if (parts) {
            const startPattern = new RegExp(parts[1]);
            const endPattern = new RegExp(parts[2]);
            let start = -1;
            let end = -1;
            for (let i = 0; i < lines.length; i++) {
                if (start === -1 && startPattern.test(lines[i])) {
                    start = i + 1; // 1-indexed
                }
                if (start !== -1 && endPattern.test(lines[i])) {
                    end = i + 1; // 1-indexed
                    break;
                }
            }
            if (start === -1)
                start = 1;
            if (end === -1)
                end = totalLines;
            return { start, end };
        }
    }
    // Handle numeric ranges like "2,4" or "2,+3"
    const [startStr, endStr] = lineRange.split(',');
    const start = parseInt(startStr, 10);
    let end;
    if (endStr.startsWith('+')) {
        // Relative offset: start + offset lines
        end = start + parseInt(endStr.slice(1), 10);
    }
    else {
        end = parseInt(endStr, 10);
    }
    return { start, end };
}
/**
 * Calculate similarity between two strings (0-1)
 */
function calculateSimilarity(a, b) {
    if (a === b)
        return 1;
    if (a.length === 0 || b.length === 0)
        return 0;
    const aLines = splitLines(a);
    const bLines = splitLines(b);
    if (aLines.length === 0 && bLines.length === 0)
        return 1;
    if (aLines.length === 0 || bLines.length === 0)
        return 0;
    // Count matching lines
    const mapping = computeLineMapping(aLines, bLines, false);
    const matchCount = mapping.size;
    const maxLines = Math.max(aLines.length, bLines.length);
    return matchCount / maxLines;
}
// ============================================================================
// Main Functions
// ============================================================================
/**
 * Compute blame for a file at a specific commit
 */
export async function blame(storage, path, commit, options) {
    const opts = options ?? {};
    // Get the commit object
    const commitObj = await storage.getCommit(commit);
    if (!commitObj) {
        throw new Error(`Commit not found: ${commit}`);
    }
    // Get the file content at this commit
    const fileContent = await getFileAtPath(storage, commitObj, path);
    if (fileContent === null) {
        throw new Error(`File not found: ${path} at commit ${commit}`);
    }
    // Check for binary file
    if (isBinaryContent(fileContent)) {
        throw new Error(`Cannot blame binary file: ${path}`);
    }
    const contentStr = decoder.decode(fileContent);
    let lines = splitLines(contentStr);
    // Handle empty file
    if (lines.length === 0) {
        return {
            path,
            lines: [],
            commits: new Map(),
            options: opts
        };
    }
    // Parse line range if specified
    let startLine = 1;
    let endLine = lines.length;
    if (opts.lineRange) {
        const range = parseLineRange(opts.lineRange, lines);
        startLine = range.start;
        endLine = range.end;
    }
    // Initialize blame info for each line (all attributed to current commit initially)
    const blameInfo = lines.map((content, idx) => ({
        commitSha: commit,
        author: commitObj.author.name,
        email: commitObj.author.email,
        timestamp: commitObj.author.timestamp,
        content,
        lineNumber: idx + 1,
        originalLineNumber: idx + 1,
        originalPath: path
    }));
    // Track which lines still need attribution
    const lineNeedsAttribution = new Array(lines.length).fill(true);
    // Track the current path (for rename following)
    let currentPath = path;
    // Track commits for the result
    const commitsMap = new Map();
    // Add current commit info
    commitsMap.set(commit, {
        sha: commit,
        author: commitObj.author.name,
        email: commitObj.author.email,
        timestamp: commitObj.author.timestamp,
        summary: commitObj.message.split('\n')[0],
        boundary: commitObj.parents.length === 0
    });
    // Walk through commit history
    let currentCommit = commit;
    let currentLines = lines;
    let commitCount = 0;
    const maxCommits = opts.maxCommits ?? Infinity;
    // Handle the followRenames option
    const followRenames = opts.followRenames ?? false;
    // For merge commits, we need to explore both parents
    const commitQueue = [];
    // Initialize with current commit's parents
    const currentCommitObj = await storage.getCommit(currentCommit);
    if (currentCommitObj && currentCommitObj.parents.length > 0) {
        for (const parentSha of currentCommitObj.parents) {
            // Identity mapping for first level
            const identityMapping = new Map();
            for (let i = 0; i < currentLines.length; i++) {
                identityMapping.set(i, i);
            }
            commitQueue.push({
                sha: parentSha,
                lines: currentLines,
                path: currentPath,
                lineMapping: identityMapping,
                childCommitSha: currentCommit
            });
        }
    }
    // Process commit queue (BFS through history)
    while (commitQueue.length > 0 && commitCount < maxCommits) {
        const item = commitQueue.shift();
        const { sha: parentSha, lines: childLines, path: childPath, lineMapping: childToOriginal, childCommitSha } = item;
        // Check if this commit should be ignored
        if (opts.ignoreRevisions?.includes(parentSha)) {
            // Skip this commit but continue to its parents
            const parentCommitObj = await storage.getCommit(parentSha);
            if (parentCommitObj && parentCommitObj.parents.length > 0) {
                for (const grandparentSha of parentCommitObj.parents) {
                    commitQueue.push({
                        sha: grandparentSha,
                        lines: childLines,
                        path: childPath,
                        lineMapping: childToOriginal,
                        childCommitSha: parentSha
                    });
                }
            }
            continue;
        }
        commitCount++;
        // Check date filters
        const parentCommitObj = await storage.getCommit(parentSha);
        if (!parentCommitObj)
            continue;
        if (opts.since && parentCommitObj.author.timestamp * 1000 < opts.since.getTime()) {
            continue;
        }
        if (opts.until && parentCommitObj.author.timestamp * 1000 > opts.until.getTime()) {
            continue;
        }
        // Track path through renames
        // Renames are stored in the child commit (the one that did the rename)
        // So we check the childCommitSha to find what the file was called in the parent
        let pathInParent = childPath;
        if (followRenames) {
            // Check renames in the child commit (where the rename happened)
            const childRenames = await storage.getRenamesInCommit(childCommitSha);
            // Find reverse rename: oldPath -> newPath means in parent it was oldPath
            for (const [oldPath, newPath] of childRenames) {
                if (newPath === childPath) {
                    pathInParent = oldPath;
                    break;
                }
            }
        }
        // Get file content in parent
        const parentContent = await getFileAtPath(storage, parentCommitObj, pathInParent);
        // If file doesn't exist in parent, all remaining lines are from the first commit that has them
        if (!parentContent) {
            continue;
        }
        const parentContentStr = decoder.decode(parentContent);
        const parentLines = splitLines(parentContentStr);
        // Compute line mapping between parent and child
        const mapping = computeLineMapping(parentLines, childLines, opts.ignoreWhitespace ?? false);
        // Add commit info
        if (!commitsMap.has(parentSha)) {
            commitsMap.set(parentSha, {
                sha: parentSha,
                author: parentCommitObj.author.name,
                email: parentCommitObj.author.email,
                timestamp: parentCommitObj.author.timestamp,
                summary: parentCommitObj.message.split('\n')[0],
                boundary: parentCommitObj.parents.length === 0
            });
        }
        // Update blame for lines that came from parent
        // mapping: parentLineIdx -> childLineIdx
        for (const [parentIdx, childIdx] of mapping) {
            // Convert childIdx to original index
            for (const [origIdx, mappedChildIdx] of childToOriginal) {
                if (mappedChildIdx === childIdx && lineNeedsAttribution[origIdx]) {
                    // This line exists in parent - attribute to parent
                    blameInfo[origIdx].commitSha = parentSha;
                    blameInfo[origIdx].author = parentCommitObj.author.name;
                    blameInfo[origIdx].email = parentCommitObj.author.email;
                    blameInfo[origIdx].timestamp = parentCommitObj.author.timestamp;
                    blameInfo[origIdx].originalLineNumber = parentIdx + 1;
                    if (pathInParent !== childPath) {
                        blameInfo[origIdx].originalPath = pathInParent;
                    }
                }
            }
        }
        // Build new mapping from original indices to parent indices
        const newMapping = new Map();
        for (const [origIdx, childIdx] of childToOriginal) {
            // Find if this child line maps to a parent line
            for (const [parentIdx, mappedChildIdx] of mapping) {
                if (mappedChildIdx === childIdx) {
                    newMapping.set(origIdx, parentIdx);
                    break;
                }
            }
        }
        // Add parent's parents to queue if there are still lines to attribute
        if (parentCommitObj.parents.length > 0 && newMapping.size > 0) {
            for (const grandparentSha of parentCommitObj.parents) {
                commitQueue.push({
                    sha: grandparentSha,
                    lines: parentLines,
                    path: pathInParent,
                    lineMapping: newMapping,
                    childCommitSha: parentSha
                });
            }
        }
    }
    // Filter to requested line range
    let resultLines = blameInfo;
    if (opts.lineRange) {
        resultLines = blameInfo.filter(l => l.lineNumber >= startLine && l.lineNumber <= endLine);
    }
    return {
        path,
        lines: resultLines,
        commits: commitsMap,
        options: opts
    };
}
/**
 * Alias for blame - get full file blame
 */
export async function blameFile(storage, path, commit, options) {
    return blame(storage, path, commit, options);
}
/**
 * Get blame information for a specific line
 */
export async function blameLine(storage, path, lineNumber, commit, options) {
    if (lineNumber < 1) {
        throw new Error(`Invalid line number: ${lineNumber}. Line numbers start at 1.`);
    }
    const result = await blame(storage, path, commit, options);
    if (lineNumber > result.lines.length) {
        throw new Error(`Invalid line number: ${lineNumber}. File has ${result.lines.length} lines.`);
    }
    return result.lines[lineNumber - 1];
}
/**
 * Get blame for a specific line range
 */
export async function blameRange(storage, path, startLine, endLine, commit, options) {
    if (startLine < 1) {
        throw new Error(`Invalid start line: ${startLine}. Line numbers start at 1.`);
    }
    if (endLine < startLine) {
        throw new Error(`Invalid range: end (${endLine}) is before start (${startLine}).`);
    }
    const fullResult = await blame(storage, path, commit, options);
    if (endLine > fullResult.lines.length) {
        throw new Error(`Invalid end line: ${endLine}. File has ${fullResult.lines.length} lines.`);
    }
    return {
        path: fullResult.path,
        lines: fullResult.lines.slice(startLine - 1, endLine),
        commits: fullResult.commits,
        options: fullResult.options
    };
}
/**
 * Get blame at a specific historical commit
 */
export async function getBlameForCommit(storage, path, commit, options) {
    return blame(storage, path, commit, options);
}
/**
 * Track content path across renames through history
 */
export async function trackContentAcrossRenames(storage, path, commit, _options) {
    const history = [];
    let currentPath = path;
    let currentCommitSha = commit;
    while (currentCommitSha) {
        history.push({ commit: currentCommitSha, path: currentPath });
        const commitObj = await storage.getCommit(currentCommitSha);
        if (!commitObj || commitObj.parents.length === 0)
            break;
        // Check for renames in this commit
        const renames = await storage.getRenamesInCommit(currentCommitSha);
        // Find if our current path was renamed from something
        for (const [oldPath, newPath] of renames) {
            if (newPath === currentPath) {
                currentPath = oldPath;
                break;
            }
        }
        currentCommitSha = commitObj.parents[0];
    }
    return history;
}
/**
 * Detect file renames between two commits
 */
export async function detectRenames(storage, fromCommit, toCommit, options) {
    const threshold = options?.threshold ?? 0.5;
    const renames = new Map();
    const fromCommitObj = await storage.getCommit(fromCommit);
    const toCommitObj = await storage.getCommit(toCommit);
    if (!fromCommitObj || !toCommitObj)
        return renames;
    const fromTree = await storage.getTree(fromCommitObj.tree);
    const toTree = await storage.getTree(toCommitObj.tree);
    if (!fromTree || !toTree)
        return renames;
    // Find files that were deleted in 'from' and added in 'to'
    const fromFiles = new Map(); // name -> sha
    const toFiles = new Map();
    for (const entry of fromTree.entries) {
        if (entry.mode !== '040000') { // Skip directories
            fromFiles.set(entry.name, entry.sha);
        }
    }
    for (const entry of toTree.entries) {
        if (entry.mode !== '040000') {
            toFiles.set(entry.name, entry.sha);
        }
    }
    // Find deleted files (in from but not in to)
    const deletedFiles = [];
    for (const name of fromFiles.keys()) {
        if (!toFiles.has(name)) {
            deletedFiles.push(name);
        }
    }
    // Find added files (in to but not in from)
    const addedFiles = [];
    for (const name of toFiles.keys()) {
        if (!fromFiles.has(name)) {
            addedFiles.push(name);
        }
    }
    // Check for exact SHA matches (pure renames)
    for (const deleted of deletedFiles) {
        const deletedSha = fromFiles.get(deleted);
        for (const added of addedFiles) {
            const addedSha = toFiles.get(added);
            if (deletedSha === addedSha) {
                renames.set(deleted, added);
                break;
            }
        }
    }
    // Check for content similarity (renames with modifications)
    for (const deleted of deletedFiles) {
        if (renames.has(deleted))
            continue;
        const deletedSha = fromFiles.get(deleted);
        const deletedContent = await storage.getBlob(deletedSha);
        if (!deletedContent || isBinaryContent(deletedContent))
            continue;
        const deletedStr = decoder.decode(deletedContent);
        for (const added of addedFiles) {
            // Check if already matched
            let alreadyMatched = false;
            for (const [, v] of renames) {
                if (v === added) {
                    alreadyMatched = true;
                    break;
                }
            }
            if (alreadyMatched)
                continue;
            const addedSha = toFiles.get(added);
            const addedContent = await storage.getBlob(addedSha);
            if (!addedContent || isBinaryContent(addedContent))
                continue;
            const addedStr = decoder.decode(addedContent);
            const similarity = calculateSimilarity(deletedStr, addedStr);
            if (similarity >= threshold) {
                renames.set(deleted, added);
                break;
            }
        }
    }
    return renames;
}
/**
 * Build complete blame history for a specific line
 */
export async function buildBlameHistory(storage, path, lineNumber, commit, options) {
    const history = [];
    let currentCommitSha = commit;
    let currentPath = path;
    let currentLineNumber = lineNumber;
    while (currentCommitSha) {
        const commitObj = await storage.getCommit(currentCommitSha);
        if (!commitObj)
            break;
        const fileContent = await getFileAtPath(storage, commitObj, currentPath);
        if (!fileContent)
            break;
        const contentStr = decoder.decode(fileContent);
        const lines = splitLines(contentStr);
        if (currentLineNumber > lines.length || currentLineNumber < 1)
            break;
        history.push({
            commitSha: currentCommitSha,
            content: lines[currentLineNumber - 1],
            lineNumber: currentLineNumber,
            author: commitObj.author.name,
            timestamp: commitObj.author.timestamp
        });
        // Move to parent
        if (commitObj.parents.length === 0)
            break;
        const parentSha = commitObj.parents[0];
        const parentCommitObj = await storage.getCommit(parentSha);
        if (!parentCommitObj)
            break;
        // Check for renames
        const renames = await storage.getRenamesInCommit(currentCommitSha);
        for (const [oldPath, newPath] of renames) {
            if (newPath === currentPath) {
                currentPath = oldPath;
                break;
            }
        }
        // Get parent content and find corresponding line
        const parentContent = await getFileAtPath(storage, parentCommitObj, currentPath);
        if (!parentContent)
            break;
        const parentContentStr = decoder.decode(parentContent);
        const parentLines = splitLines(parentContentStr);
        // Find which line in parent corresponds to our current line
        const mapping = computeLineMapping(parentLines, lines, options?.ignoreWhitespace ?? false);
        let foundParentLine = false;
        for (const [parentIdx, childIdx] of mapping) {
            if (childIdx === currentLineNumber - 1) {
                currentLineNumber = parentIdx + 1;
                foundParentLine = true;
                break;
            }
        }
        // If we didn't find a content match but the parent has the line at the same position,
        // assume it's the same line (content was modified). This is important for tracking
        // history of lines that change content in every commit.
        if (!foundParentLine) {
            if (currentLineNumber <= parentLines.length) {
                // Line exists at same position in parent - assume it's the same logical line
                foundParentLine = true;
                // currentLineNumber stays the same
            }
            else {
                break;
            }
        }
        currentCommitSha = parentSha;
    }
    return history;
}
/**
 * Format blame result for display
 */
export function formatBlame(result, options) {
    const opts = options ?? {};
    const lines = [];
    if (opts.format === 'porcelain') {
        // Porcelain format - machine readable
        for (const line of result.lines) {
            const commitInfo = result.commits.get(line.commitSha);
            lines.push(`${line.commitSha} ${line.originalLineNumber} ${line.lineNumber} 1`);
            lines.push(`author ${line.author}`);
            lines.push(`author-mail <${line.email || commitInfo?.email || ''}>`);
            lines.push(`author-time ${line.timestamp}`);
            lines.push(`author-tz +0000`);
            lines.push(`committer ${line.author}`);
            lines.push(`committer-mail <${line.email || commitInfo?.email || ''}>`);
            lines.push(`committer-time ${line.timestamp}`);
            lines.push(`committer-tz +0000`);
            lines.push(`filename ${result.path}`);
            lines.push(`\t${line.content}`);
        }
    }
    else {
        // Default format - human readable
        for (const line of result.lines) {
            const sha = line.commitSha.substring(0, 8);
            const author = line.author.padEnd(15).substring(0, 15);
            let datePart = '';
            if (opts.showDate) {
                const date = new Date(line.timestamp * 1000);
                datePart = ` ${date.toISOString().substring(0, 10)}`;
            }
            let authorPart = author;
            if (opts.showEmail) {
                const email = line.email || result.commits.get(line.commitSha)?.email || '';
                authorPart = email.padEnd(25).substring(0, 25);
            }
            let lineNumPart = '';
            if (opts.showLineNumbers) {
                lineNumPart = `${line.lineNumber}) `;
            }
            lines.push(`${sha} (${authorPart}${datePart} ${lineNumPart}${line.content}`);
        }
    }
    return lines.join('\n');
}
/**
 * Parse porcelain blame output
 */
export function parseBlameOutput(output) {
    const lines = [];
    const commits = new Map();
    const outputLines = output.split('\n');
    let i = 0;
    while (i < outputLines.length) {
        const headerLine = outputLines[i];
        if (!headerLine || headerLine.trim() === '') {
            i++;
            continue;
        }
        // Parse header: <sha> <orig-line> <final-line> <num-lines>
        // Accept any 40-char alphanumeric SHA (to support test fixtures using makeSha)
        const headerMatch = headerLine.match(/^([0-9a-zA-Z]{40}) (\d+) (\d+)/);
        if (!headerMatch) {
            i++;
            continue;
        }
        const commitSha = headerMatch[1];
        const originalLineNumber = parseInt(headerMatch[2], 10);
        const lineNumber = parseInt(headerMatch[3], 10);
        // Parse metadata lines until we hit the content line (starts with tab)
        let author = '';
        let email = '';
        let timestamp = 0;
        let content = '';
        i++;
        while (i < outputLines.length) {
            const metaLine = outputLines[i];
            if (metaLine.startsWith('\t')) {
                content = metaLine.substring(1);
                i++;
                break;
            }
            if (metaLine.startsWith('author ')) {
                author = metaLine.substring(7);
            }
            else if (metaLine.startsWith('author-mail ')) {
                email = metaLine.substring(12).replace(/[<>]/g, '');
            }
            else if (metaLine.startsWith('author-time ')) {
                timestamp = parseInt(metaLine.substring(12), 10);
            }
            i++;
        }
        lines.push({
            commitSha,
            author,
            email,
            timestamp,
            content,
            lineNumber,
            originalLineNumber
        });
        // Add commit info if not already present
        if (!commits.has(commitSha)) {
            commits.set(commitSha, {
                sha: commitSha,
                author,
                email,
                timestamp,
                summary: ''
            });
        }
    }
    return {
        path: '',
        lines,
        commits
    };
}
//# sourceMappingURL=blame.js.map