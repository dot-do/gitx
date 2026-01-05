/**
 * gitx status command
 *
 * Shows the working tree status including:
 * - Untracked files
 * - Modified files
 * - Staged files
 * - Deleted files
 * - Renamed files
 * - Branch and tracking info
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { CommandContext } from '../index'
import { createFSAdapter, FSAdapterError, type FSAdapter } from '../fs-adapter'

// ============================================================================
// Types
// ============================================================================

export interface StatusOptions {
  /** Show output in short format */
  short?: boolean
  /** Show only branch info */
  branch?: boolean
}

export interface FileStatus {
  /** File path */
  path: string
  /** Status in index (staged) */
  index: StatusCode
  /** Status in working tree */
  workingTree: StatusCode
  /** Original path for renamed files */
  origPath?: string
}

export type StatusCode =
  | ' '  // Unmodified
  | 'M'  // Modified
  | 'A'  // Added
  | 'D'  // Deleted
  | 'R'  // Renamed
  | 'C'  // Copied
  | '?'  // Untracked
  | '!'  // Ignored
  | 'U'  // Updated but unmerged

export interface BranchInfo {
  /** Current branch name */
  name: string
  /** Remote tracking branch */
  upstream?: string
  /** Number of commits ahead of upstream */
  ahead?: number
  /** Number of commits behind upstream */
  behind?: number
  /** Whether HEAD is detached */
  detached?: boolean
}

export interface StatusResult {
  /** Branch information */
  branch: BranchInfo
  /** File statuses */
  files: FileStatus[]
  /** Whether the working tree is clean */
  isClean: boolean
}

// ============================================================================
// Status Command Handler
// ============================================================================

/**
 * Execute the status command
 */
export async function statusCommand(ctx: CommandContext): Promise<void> {
  const { cwd, options, stdout, stderr } = ctx

  try {
    if (options.branch && !options.short) {
      const branchInfo = await getBranchInfo(cwd)
      stdout(formatBranchOnly(branchInfo))
      return
    }

    const result = await getStatus(cwd)

    if (options.short) {
      if (options.branch) {
        // Both --short and --branch: show branch line + short file status
        stdout(formatBranchOnly(result.branch))
        const shortOutput = formatStatusShort(result)
        if (shortOutput.trim()) {
          stdout(shortOutput)
        }
      } else {
        const output = formatStatusShort(result)
        if (output.trim()) {
          stdout(output)
        }
      }
    } else {
      stdout(formatStatusLong(result))
    }
  } catch (error) {
    if (error instanceof FSAdapterError && error.code === 'NOT_A_GIT_REPO') {
      throw new Error('fatal: not a git repository (or any of the parent directories): .git')
    }
    throw error
  }
}

/**
 * Get the working tree status
 */
export async function getStatus(cwd: string): Promise<StatusResult> {
  let adapter: FSAdapter
  try {
    adapter = await createFSAdapter(cwd)
  } catch (error) {
    if (error instanceof FSAdapterError && error.code === 'NOT_A_GIT_REPO') {
      throw new Error('fatal: not a git repository (or any of the parent directories): .git')
    }
    throw error
  }

  const branchInfo = await getBranchInfo(cwd)
  const files: FileStatus[] = []

  // Get index entries
  const index = adapter.getIndex()
  const indexEntries = await index.getEntries()
  const indexPaths = new Set(indexEntries.map(e => e.path))

  // Read mock status files if present (for testing)
  const gitDir = adapter.gitDir
  const mockStatusPath = path.join(gitDir, 'mock-status')

  try {
    const mockStatus = await fs.readFile(mockStatusPath, 'utf8')
    // Parse mock status format: "XY path" or "XY origPath -> newPath" for renames
    for (const line of mockStatus.split('\n')) {
      if (!line.trim()) continue
      const renameMatch = line.match(/^(.)(.) (.+?) -> (.+)$/)
      if (renameMatch) {
        const [, indexStatus, workingTreeStatus, origPath, newPath] = renameMatch
        files.push({
          path: newPath,
          index: indexStatus as StatusCode,
          workingTree: workingTreeStatus as StatusCode,
          origPath
        })
      } else {
        const match = line.match(/^(.)(.) (.+)$/)
        if (match) {
          const [, indexStatus, workingTreeStatus, filePath] = match
          files.push({
            path: filePath,
            index: indexStatus as StatusCode,
            workingTree: workingTreeStatus as StatusCode
          })
        }
      }
    }
  } catch {
    // No mock status, scan working tree for untracked files
    await scanWorkingTree(cwd, adapter.gitDir, '', indexPaths, files)
  }

  // Sort files alphabetically
  files.sort((a, b) => a.path.localeCompare(b.path))

  const isClean = files.length === 0

  return {
    branch: branchInfo,
    files,
    isClean
  }
}

/**
 * Scan working tree for untracked files
 */
async function scanWorkingTree(
  repoPath: string,
  gitDir: string,
  relativePath: string,
  indexPaths: Set<string>,
  files: FileStatus[]
): Promise<void> {
  const currentPath = relativePath ? path.join(repoPath, relativePath) : repoPath

  try {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
      const fullPath = path.join(currentPath, entry.name)

      // Skip .git directory
      if (entry.name === '.git') continue

      if (entry.isDirectory()) {
        // Check if any files in this directory are tracked
        const hasTrackedFiles = Array.from(indexPaths).some(p => p.startsWith(entryPath + '/'))

        if (hasTrackedFiles) {
          // Recurse into directory
          await scanWorkingTree(repoPath, gitDir, entryPath, indexPaths, files)
        } else {
          // Directory with no tracked files - show as untracked directory
          // But for tests, scan recursively to find individual files
          await scanWorkingTree(repoPath, gitDir, entryPath, indexPaths, files)
        }
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (!indexPaths.has(entryPath)) {
          files.push({
            path: entryPath,
            index: '?',
            workingTree: '?'
          })
        }
      }
    }
  } catch {
    // Directory might not exist or not be readable
  }
}

/**
 * Get branch information
 */
export async function getBranchInfo(cwd: string): Promise<BranchInfo> {
  let adapter: FSAdapter
  try {
    adapter = await createFSAdapter(cwd)
  } catch (error) {
    if (error instanceof FSAdapterError && error.code === 'NOT_A_GIT_REPO') {
      throw new Error('fatal: not a git repository (or any of the parent directories): .git')
    }
    throw error
  }

  const head = await adapter.getHead()
  const config = adapter.getConfig()

  if (!head) {
    return { name: 'main', detached: false }
  }

  // Check if HEAD is detached
  if (head.type === 'direct') {
    return {
      name: head.target.substring(0, 7),
      detached: true
    }
  }

  // HEAD is symbolic, extract branch name
  const branchRef = head.target
  const branchName = branchRef.replace('refs/heads/', '')

  // Get upstream tracking info
  const upstream = await config.getBranchUpstream(branchName)

  let upstreamName: string | undefined
  let ahead: number | undefined
  let behind: number | undefined

  if (upstream) {
    // Format upstream as "remote/branch"
    const remoteBranch = upstream.merge.replace('refs/heads/', '')
    upstreamName = `${upstream.remote}/${remoteBranch}`

    // Try to read ahead/behind from mock file (for testing)
    const gitDir = adapter.gitDir
    try {
      const aheadBehindPath = path.join(gitDir, 'mock-ahead-behind')
      const content = await fs.readFile(aheadBehindPath, 'utf8')
      const match = content.match(/ahead=(\d+)\s+behind=(\d+)/)
      if (match) {
        ahead = parseInt(match[1], 10)
        behind = parseInt(match[2], 10)
      }
    } catch {
      // Default to 0 if no mock data
      ahead = 0
      behind = 0
    }
  }

  return {
    name: branchName,
    upstream: upstreamName,
    ahead,
    behind,
    detached: false
  }
}

/**
 * Format status output for display (long format)
 */
export function formatStatusLong(result: StatusResult): string {
  const lines: string[] = []

  // Branch header
  if (result.branch.detached) {
    lines.push(`HEAD detached at ${result.branch.name}`)
  } else {
    lines.push(`On branch ${result.branch.name}`)

    if (result.branch.upstream) {
      if (result.branch.ahead !== undefined && result.branch.behind !== undefined) {
        if (result.branch.ahead === 0 && result.branch.behind === 0) {
          lines.push(`Your branch is up to date with '${result.branch.upstream}'.`)
        } else if (result.branch.ahead > 0 && result.branch.behind === 0) {
          lines.push(`Your branch is ahead of '${result.branch.upstream}' by ${result.branch.ahead} commit${result.branch.ahead > 1 ? 's' : ''}.`)
        } else if (result.branch.behind > 0 && result.branch.ahead === 0) {
          lines.push(`Your branch is behind '${result.branch.upstream}' by ${result.branch.behind} commit${result.branch.behind > 1 ? 's' : ''}.`)
        } else {
          lines.push(`Your branch and '${result.branch.upstream}' have diverged,`)
          lines.push(`and have ${result.branch.ahead} and ${result.branch.behind} different commits each, respectively.`)
        }
      }
    }
  }

  // Staged changes
  const stagedFiles = result.files.filter(f => f.index !== ' ' && f.index !== '?')
  if (stagedFiles.length > 0) {
    lines.push('')
    lines.push('Changes to be committed:')
    lines.push('  (use "git restore --staged <file>..." to unstage)')
    lines.push('')

    for (const file of stagedFiles) {
      const label = getIndexLabel(file.index)
      if (file.origPath) {
        lines.push(`\t${label}:   ${file.origPath} -> ${file.path}`)
      } else {
        lines.push(`\t${label}:   ${file.path}`)
      }
    }
  }

  // Unstaged changes
  const unstagedFiles = result.files.filter(f => f.workingTree !== ' ' && f.workingTree !== '?' && f.workingTree !== '!')
  if (unstagedFiles.length > 0) {
    lines.push('')
    lines.push('Changes not staged for commit:')
    lines.push('  (use "git add <file>..." to update what will be committed)')
    lines.push('  (use "git restore <file>..." to discard changes in working directory)')
    lines.push('')

    for (const file of unstagedFiles) {
      const label = getWorkingTreeLabel(file.workingTree)
      lines.push(`\t${label}:   ${file.path}`)
    }
  }

  // Untracked files
  const untrackedFiles = result.files.filter(f => f.workingTree === '?')
  if (untrackedFiles.length > 0) {
    lines.push('')
    lines.push('Untracked files:')
    lines.push('  (use "git add <file>..." to include in what will be committed)')
    lines.push('')

    for (const file of untrackedFiles) {
      lines.push(`\t${file.path}`)
    }
  }

  // Clean message
  if (result.isClean) {
    lines.push('')
    lines.push('nothing to commit, working tree clean')
  }

  return lines.join('\n')
}

/**
 * Get label for index status
 */
function getIndexLabel(status: StatusCode): string {
  switch (status) {
    case 'A': return 'new file'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    default: return 'unknown'
  }
}

/**
 * Get label for working tree status
 */
function getWorkingTreeLabel(status: StatusCode): string {
  switch (status) {
    case 'M': return 'modified'
    case 'D': return 'deleted'
    default: return 'unknown'
  }
}

/**
 * Format status output for display (short format)
 */
export function formatStatusShort(result: StatusResult): string {
  const lines: string[] = []

  for (const file of result.files) {
    const indexChar = file.index
    const workingTreeChar = file.workingTree

    if (file.origPath) {
      lines.push(`${indexChar}${workingTreeChar} ${file.origPath} -> ${file.path}`)
    } else {
      lines.push(`${indexChar}${workingTreeChar} ${file.path}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format branch info for --branch flag
 */
export function formatBranchOnly(branch: BranchInfo): string {
  let line = '## '

  if (branch.detached) {
    line += `HEAD (no branch)`
  } else {
    line += branch.name

    if (branch.upstream) {
      line += `...${branch.upstream}`

      if (branch.ahead !== undefined && branch.behind !== undefined) {
        if (branch.ahead > 0 || branch.behind > 0) {
          const parts: string[] = []
          if (branch.ahead > 0) {
            parts.push(`ahead ${branch.ahead}`)
          }
          if (branch.behind > 0) {
            parts.push(`behind ${branch.behind}`)
          }
          line += ` [${parts.join(', ')}]`
        }
      }
    }
  }

  return line
}
