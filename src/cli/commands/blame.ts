/**
 * Git Blame Command
 *
 * Shows what revision and author last modified each line of a file.
 */

import type { CommandContext } from '../index'
import type { FSAdapter, FSObject } from '../fs-adapter'
import { parseCommit, parseTree, type CommitObject, type TreeObject } from '../../types/objects'

// ============================================================================
// Types
// ============================================================================

export interface BlameOptions {
  /** Line range in format "start,end" or "start,+count" */
  lineRange?: string
  /** Follow file renames (-C flag) */
  followRenames?: boolean
  /** Enable syntax highlighting with Shiki */
  highlight?: boolean
  /** Syntax highlighting theme */
  theme?: string
}

export interface BlameLineAnnotation {
  /** Full commit SHA */
  commitSha: string
  /** Short commit SHA (8 chars) */
  shortSha: string
  /** Author name */
  author: string
  /** Author email */
  authorEmail: string
  /** Commit date */
  date: Date
  /** Current line number in file */
  lineNumber: number
  /** Original line number in the commit that introduced this line */
  originalLineNumber: number
  /** Line content */
  content: string
  /** Original file path (if different due to rename) */
  originalPath?: string
}

export interface BlameFileCommit {
  /** Commit SHA */
  sha: string
  /** Author name */
  author: string
  /** Commit date */
  date: Date
}

export interface BlameResult {
  /** File path being blamed */
  path: string
  /** Original file path if renamed */
  originalPath?: string
  /** Line annotations */
  lines: BlameLineAnnotation[]
  /** Whether file is binary */
  isBinary: boolean
  /** Message for binary/error cases */
  message?: string
  /** File-level commit info (for binary files) */
  fileCommit?: BlameFileCommit
  /** Syntax highlighted lines (if highlight option enabled) */
  highlighted?: string[]
  /** Detected language */
  language?: string
  /** Theme used for highlighting */
  theme?: string
}

export interface LineRange {
  start: number
  end: number
}

// ============================================================================
// Helper Functions
// ============================================================================

const decoder = new TextDecoder()

/**
 * Check if content is likely binary (contains null bytes)
 */
function isBinaryContent(data: Uint8Array): boolean {
  const checkLength = Math.min(data.length, 8000)
  for (let i = 0; i < checkLength; i++) {
    if (data[i] === 0) return true
  }
  return false
}

/**
 * Split content into lines
 */
function splitLines(content: string): string[] {
  if (content === '') return []
  const lines = content.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.map(line => line.replace(/\r$/, ''))
}

/**
 * Get file extension from path
 */
function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot === -1) return ''
  return filePath.slice(lastDot + 1).toLowerCase()
}

/**
 * Map file extension to language name
 */
function extensionToLanguage(ext: string): string {
  const mapping: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'jsx': 'javascript',
    'py': 'python',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'sql': 'sql',
    'xml': 'xml'
  }
  return mapping[ext] || 'text'
}

/**
 * Parse a commit object from raw data
 */
function parseCommitObject(obj: FSObject): CommitObject {
  // Build the full git object format: "commit <size>\0<data>"
  const header = new TextEncoder().encode(`commit ${obj.data.length}\0`)
  const fullData = new Uint8Array(header.length + obj.data.length)
  fullData.set(header)
  fullData.set(obj.data, header.length)
  return parseCommit(fullData)
}

/**
 * Parse a tree object from raw data
 */
function parseTreeObject(obj: FSObject): TreeObject {
  const header = new TextEncoder().encode(`tree ${obj.data.length}\0`)
  const fullData = new Uint8Array(header.length + obj.data.length)
  fullData.set(header)
  fullData.set(obj.data, header.length)
  return parseTree(fullData)
}

/**
 * Get file content at a specific commit
 */
async function getFileAtCommit(
  adapter: FSAdapter,
  commitSha: string,
  filePath: string
): Promise<Uint8Array | null> {
  const commitObj = await adapter.getObject(commitSha)
  if (!commitObj || commitObj.type !== 'commit') return null

  const commit = parseCommitObject(commitObj)

  // Navigate through tree to find file
  const pathParts = filePath.split('/')
  let currentTreeSha = commit.tree

  for (let i = 0; i < pathParts.length; i++) {
    const treeObj = await adapter.getObject(currentTreeSha)
    if (!treeObj || treeObj.type !== 'tree') return null

    const tree = parseTreeObject(treeObj)
    const entry = tree.entries.find(e => e.name === pathParts[i])
    if (!entry) return null

    if (i === pathParts.length - 1) {
      // Final part - should be a blob
      const blobObj = await adapter.getObject(entry.sha)
      if (!blobObj || blobObj.type !== 'blob') return null
      return blobObj.data
    } else {
      // Intermediate part - should be a tree
      if (entry.mode !== '040000') return null
      currentTreeSha = entry.sha
    }
  }

  return null
}

/**
 * Get the blob SHA for a file at a specific commit
 */
async function getFileBlobSha(
  adapter: FSAdapter,
  commitSha: string,
  filePath: string
): Promise<string | null> {
  const commitObj = await adapter.getObject(commitSha)
  if (!commitObj || commitObj.type !== 'commit') return null

  const commit = parseCommitObject(commitObj)

  // Navigate through tree to find file
  const pathParts = filePath.split('/')
  let currentTreeSha = commit.tree

  for (let i = 0; i < pathParts.length; i++) {
    const treeObj = await adapter.getObject(currentTreeSha)
    if (!treeObj || treeObj.type !== 'tree') return null

    const tree = parseTreeObject(treeObj)
    const entry = tree.entries.find(e => e.name === pathParts[i])
    if (!entry) return null

    if (i === pathParts.length - 1) {
      return entry.sha
    } else {
      if (entry.mode !== '040000') return null
      currentTreeSha = entry.sha
    }
  }

  return null
}

/**
 * Find a file in a commit tree by its blob SHA (for rename detection)
 */
async function findFileByBlobSha(
  adapter: FSAdapter,
  commitSha: string,
  targetBlobSha: string
): Promise<string | null> {
  const commitObj = await adapter.getObject(commitSha)
  if (!commitObj || commitObj.type !== 'commit') return null

  const commit = parseCommitObject(commitObj)

  // Search tree for a file with the matching blob SHA
  async function searchTree(treeSha: string, prefix: string): Promise<string | null> {
    const treeObj = await adapter.getObject(treeSha)
    if (!treeObj || treeObj.type !== 'tree') return null

    const tree = parseTreeObject(treeObj)

    for (const entry of tree.entries) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name

      if (entry.mode === '040000') {
        // It's a directory - recurse
        const found = await searchTree(entry.sha, entryPath)
        if (found) return found
      } else {
        // It's a file - check SHA
        if (entry.sha === targetBlobSha) {
          return entryPath
        }
      }
    }

    return null
  }

  return searchTree(commit.tree, '')
}

/**
 * Compute line mapping between parent and child versions using LCS
 */
function computeLineMapping(oldLines: string[], newLines: string[]): Map<number, number> {
  const mapping = new Map<number, number>()
  const m = oldLines.length
  const n = newLines.length

  if (m === 0 || n === 0) return mapping

  // Create LCS table
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find matching lines
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      mapping.set(i - 1, j - 1)
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return mapping
}

// ============================================================================
// Blame Command Implementation
// ============================================================================

/**
 * Execute the blame command
 */
export async function blameCommand(ctx: CommandContext): Promise<void> {
  throw new Error('Not implemented')
}

/**
 * Get blame annotations for a file
 */
export async function getBlame(
  adapter: FSAdapter,
  filePath: string,
  options: BlameOptions = {}
): Promise<BlameResult> {
  // Validate file path
  if (filePath.includes('\0')) {
    throw new Error('Invalid file path: contains null character')
  }

  // Resolve HEAD to get current commit
  const headResolved = await adapter.resolveRef('HEAD')
  if (!headResolved) {
    throw new Error('Cannot resolve HEAD: repository may be empty')
  }

  const headCommitSha = headResolved.sha

  // Get the commit object
  const commitObj = await adapter.getObject(headCommitSha)
  if (!commitObj || commitObj.type !== 'commit') {
    throw new Error(`Cannot read HEAD commit: ${headCommitSha}`)
  }

  const headCommit = parseCommitObject(commitObj)

  // Get file content at HEAD
  const fileContent = await getFileAtCommit(adapter, headCommitSha, filePath)
  if (fileContent === null) {
    throw new Error(`File not found: ${filePath} does not exist in repository`)
  }

  // Check for binary file
  if (isBinaryContent(fileContent)) {
    return {
      path: filePath,
      lines: [],
      isBinary: true,
      message: 'binary file - cannot show line-by-line blame',
      fileCommit: {
        sha: headCommitSha,
        author: headCommit.author.name,
        date: new Date(headCommit.author.timestamp * 1000)
      }
    }
  }

  // Parse file content
  const contentStr = decoder.decode(fileContent)
  const lines = splitLines(contentStr)

  // Handle empty file
  if (lines.length === 0) {
    return {
      path: filePath,
      lines: [],
      isBinary: false
    }
  }

  // Parse and validate line range
  let startLine = 1
  let endLine = lines.length

  if (options.lineRange) {
    const range = parseLineRange(options.lineRange)
    if (range.end < range.start) {
      throw new Error(`Invalid line range: end (${range.end}) is before start (${range.start})`)
    }
    if (range.end > lines.length) {
      throw new Error(`Invalid line range: end (${range.end}) exceeds file length (${lines.length})`)
    }
    startLine = range.start
    endLine = range.end
  }

  // Initialize blame info for each line
  const blameInfo: BlameLineAnnotation[] = lines.map((content, idx) => ({
    commitSha: headCommitSha,
    shortSha: headCommitSha.substring(0, 8),
    author: headCommit.author.name,
    authorEmail: headCommit.author.email,
    date: new Date(headCommit.author.timestamp * 1000),
    lineNumber: idx + 1,
    originalLineNumber: idx + 1,
    content
  }))

  // Track rename history
  let currentPath = filePath
  let originalPathFound: string | undefined

  // Walk through commit history to attribute lines
  const commitQueue: Array<{
    sha: string
    lines: string[]
    path: string
    lineMapping: Map<number, number>
    childSha: string
  }> = []

  // Initialize with HEAD's parents
  if (headCommit.parents.length > 0) {
    const identityMapping = new Map<number, number>()
    for (let i = 0; i < lines.length; i++) {
      identityMapping.set(i, i)
    }
    for (const parentSha of headCommit.parents) {
      commitQueue.push({
        sha: parentSha,
        lines: lines,
        path: currentPath,
        lineMapping: identityMapping,
        childSha: headCommitSha
      })
    }
  }

  const visitedCommits = new Set<string>()
  visitedCommits.add(headCommitSha)

  while (commitQueue.length > 0) {
    const item = commitQueue.shift()!
    const { sha: parentSha, lines: childLines, path: childPath, lineMapping: childToOriginal, childSha } = item

    if (visitedCommits.has(parentSha)) continue
    visitedCommits.add(parentSha)

    // Get parent commit
    const parentCommitObj = await adapter.getObject(parentSha)
    if (!parentCommitObj || parentCommitObj.type !== 'commit') continue

    const parentCommit = parseCommitObject(parentCommitObj)

    // Check for renames if followRenames is enabled
    let pathInParent = childPath
    if (options.followRenames) {
      // Check if file exists at current path in parent
      const contentAtPath = await getFileAtCommit(adapter, parentSha, childPath)
      if (contentAtPath === null) {
        // File doesn't exist at this path - try to find it by blob SHA (rename detection)
        const childBlobSha = await getFileBlobSha(adapter, childSha, childPath)
        if (childBlobSha) {
          const renamedPath = await findFileByBlobSha(adapter, parentSha, childBlobSha)
          if (renamedPath) {
            pathInParent = renamedPath
            if (!originalPathFound) originalPathFound = renamedPath
          }
        }
      }
    }

    // Get parent file content
    const parentContent = await getFileAtCommit(adapter, parentSha, pathInParent)
    if (!parentContent) {
      // File doesn't exist in parent - all remaining lines are from child commit
      continue
    }

    if (isBinaryContent(parentContent)) continue

    const parentContentStr = decoder.decode(parentContent)
    const parentLines = splitLines(parentContentStr)

    // Compute line mapping between parent and child
    const mapping = computeLineMapping(parentLines, childLines)

    // Update blame for lines that came from parent
    for (const [parentIdx, childIdx] of mapping) {
      for (const [origIdx, mappedChildIdx] of childToOriginal) {
        if (mappedChildIdx === childIdx) {
          // This line exists in parent - attribute to parent
          blameInfo[origIdx].commitSha = parentSha
          blameInfo[origIdx].shortSha = parentSha.substring(0, 8)
          blameInfo[origIdx].author = parentCommit.author.name
          blameInfo[origIdx].authorEmail = parentCommit.author.email
          blameInfo[origIdx].date = new Date(parentCommit.author.timestamp * 1000)
          blameInfo[origIdx].originalLineNumber = parentIdx + 1

          // Track original path when following renames
          if (pathInParent !== childPath) {
            blameInfo[origIdx].originalPath = pathInParent
          }
        }
      }
    }

    // Build new mapping from original indices to parent indices
    const newMapping = new Map<number, number>()
    for (const [origIdx, childIdx] of childToOriginal) {
      for (const [parentIdx, mappedChildIdx] of mapping) {
        if (mappedChildIdx === childIdx) {
          newMapping.set(origIdx, parentIdx)
          break
        }
      }
    }

    // Add parent's parents to queue
    if (parentCommit.parents.length > 0 && newMapping.size > 0) {
      for (const grandparentSha of parentCommit.parents) {
        commitQueue.push({
          sha: grandparentSha,
          lines: parentLines,
          path: pathInParent,
          lineMapping: newMapping,
          childSha: parentSha
        })
      }
    }
  }

  // Filter to requested line range
  let resultLines = blameInfo
  if (options.lineRange) {
    resultLines = blameInfo.filter(l => l.lineNumber >= startLine && l.lineNumber <= endLine)
  }

  // Build result
  const result: BlameResult = {
    path: filePath,
    lines: resultLines,
    isBinary: false
  }

  // Add original path if found through rename tracking
  if (originalPathFound) {
    result.originalPath = originalPathFound
  }

  // Handle syntax highlighting
  if (options.highlight) {
    const ext = getExtension(filePath)
    const language = extensionToLanguage(ext)
    result.language = language
    result.theme = options.theme || 'github-dark'
    result.highlighted = resultLines.map(l => l.content) // Placeholder - actual highlighting would use Shiki
  }

  return result
}

/**
 * Format a blame line annotation for display
 */
export function formatBlameLine(
  annotation: BlameLineAnnotation,
  options: { showOriginalLineNumber?: boolean } = {}
): string {
  const { shortSha, author, date, lineNumber, originalLineNumber, content } = annotation

  // Format date as YYYY-MM-DD or similar
  const dateStr = date.toISOString().substring(0, 10)

  // Pad author to fixed width
  const authorStr = author.padEnd(15).substring(0, 15)

  let result = `${shortSha} (${authorStr} ${dateStr}`

  if (options.showOriginalLineNumber) {
    result += ` ${originalLineNumber.toString().padStart(4)} ${lineNumber.toString().padStart(4)}`
  }

  result += `) ${content}`

  return result
}

/**
 * Parse a line range string into start and end values
 * Supports formats: "start,end" and "start,+count"
 */
export function parseLineRange(rangeStr: string): LineRange {
  const parts = rangeStr.split(',')
  if (parts.length !== 2) {
    throw new Error(`Invalid line range format: ${rangeStr}`)
  }

  const start = parseInt(parts[0], 10)
  if (isNaN(start)) {
    throw new Error(`Invalid start line: ${parts[0]}`)
  }

  let end: number
  if (parts[1].startsWith('+')) {
    // Relative offset: start + offset
    const offset = parseInt(parts[1].slice(1), 10)
    if (isNaN(offset)) {
      throw new Error(`Invalid line offset: ${parts[1]}`)
    }
    end = start + offset
  } else {
    end = parseInt(parts[1], 10)
    if (isNaN(end)) {
      throw new Error(`Invalid end line: ${parts[1]}`)
    }
  }

  return { start, end }
}
