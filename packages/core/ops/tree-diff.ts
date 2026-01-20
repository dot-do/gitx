/**
 * @fileoverview Tree Diff Operations
 *
 * This module provides functionality for comparing Git trees and detecting
 * changes between them, including added, deleted, modified, renamed, and
 * copied files.
 *
 * @module ops/tree-diff
 */

import type { TreeEntry } from '../objects/types'

// =============================================================================
// Types
// =============================================================================

/**
 * Status of a file in a diff.
 */
export enum DiffStatus {
  ADDED = 'A',
  DELETED = 'D',
  MODIFIED = 'M',
  RENAMED = 'R',
  COPIED = 'C',
  TYPE_CHANGED = 'T',
  UNMERGED = 'U'
}

/**
 * File mode constants for Git objects
 */
export enum FileMode {
  REGULAR = '100644',
  EXECUTABLE = '100755',
  SYMLINK = '120000',
  GITLINK = '160000',
  TREE = '040000'
}

/**
 * Represents a single entry in a diff result
 */
export interface DiffEntry {
  path: string
  status: DiffStatus
  oldMode: string | null
  newMode: string | null
  oldSha: string | null
  newSha: string | null
  oldPath?: string
  similarity?: number
  isBinary?: boolean
}

/**
 * Options for tree diff operations
 */
export interface DiffOptions {
  detectRenames?: boolean
  detectCopies?: boolean
  similarityThreshold?: number
  pathspecs?: string[]
  excludePaths?: string[]
  detectBinary?: boolean
  maxRenameSize?: number
  recursive?: boolean
  nameOnly?: boolean
  nameStatus?: boolean
}

/**
 * Result of a tree diff operation
 */
export interface DiffResult {
  entries: DiffEntry[]
  stats: {
    added: number
    deleted: number
    modified: number
    renamed: number
    copied: number
  }
}

/**
 * ObjectStore interface for tree diff operations.
 */
export interface ObjectStore {
  getTree(sha: string): Promise<{ entries: TreeEntry[] } | null>
  getBlob(sha: string): Promise<Uint8Array | null>
}

/**
 * Represents an index entry for diff-to-index operations
 */
export interface IndexEntry {
  path: string
  mode: string
  sha: string
  stage: number
  mtime?: number
  size?: number
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a file appears to be binary based on its content
 */
export function isBinaryContent(content: Uint8Array): boolean {
  const checkLength = Math.min(content.length, 8000)
  for (let i = 0; i < checkLength; i++) {
    if (content[i] === 0x00) {
      return true
    }
  }
  return false
}

/**
 * Calculate similarity between two blobs for rename/copy detection
 */
export async function calculateSimilarity(
  store: ObjectStore,
  oldSha: string,
  newSha: string
): Promise<number> {
  if (oldSha === newSha) {
    return 100
  }

  const [oldBlob, newBlob] = await Promise.all([
    store.getBlob(oldSha),
    store.getBlob(newSha)
  ])

  if (!oldBlob || !newBlob) {
    return 0
  }

  const oldStr = new TextDecoder().decode(oldBlob)
  const newStr = new TextDecoder().decode(newBlob)

  if (oldStr === newStr) {
    return 100
  }

  const maxLen = Math.max(oldStr.length, newStr.length)
  if (maxLen === 0) {
    return 100
  }

  let matches = 0
  const minLen = Math.min(oldStr.length, newStr.length)
  for (let i = 0; i < minLen; i++) {
    if (oldStr[i] === newStr[i]) {
      matches++
    }
  }

  return Math.round((matches / maxLen) * 100)
}

/**
 * Parse a file mode string and determine its type
 */
export function parseMode(
  mode: string
): {
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
  isSubmodule: boolean
  isExecutable: boolean
} {
  return {
    isFile: mode === FileMode.REGULAR || mode === FileMode.EXECUTABLE,
    isDirectory: mode === FileMode.TREE,
    isSymlink: mode === FileMode.SYMLINK,
    isSubmodule: mode === FileMode.GITLINK,
    isExecutable: mode === FileMode.EXECUTABLE
  }
}

/**
 * Check if a mode change represents a significant type change
 */
export function isModeChangeSignificant(
  oldMode: string,
  newMode: string
): boolean {
  if (oldMode === newMode) {
    return false
  }

  const oldParsed = parseMode(oldMode)
  const newParsed = parseMode(newMode)

  if (oldParsed.isFile && newParsed.isSymlink) return true
  if (oldParsed.isFile && newParsed.isSubmodule) return true
  if (oldParsed.isSymlink && newParsed.isFile) return true
  if (oldParsed.isSymlink && newParsed.isSubmodule) return true
  if (oldParsed.isSubmodule && newParsed.isFile) return true
  if (oldParsed.isSubmodule && newParsed.isSymlink) return true

  return false
}

function matchGlob(pattern: string, path: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<DOUBLESTAR>>>/g, '.*')
    .replace(/\?/g, '.')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(path)
}

/**
 * Filter diff entries by pathspecs
 */
export function filterByPathspecs(
  entries: DiffEntry[],
  pathspecs?: string[],
  excludePaths?: string[]
): DiffEntry[] {
  if (!pathspecs && !excludePaths) {
    return entries
  }

  return entries.filter(entry => {
    if (excludePaths) {
      for (const pattern of excludePaths) {
        if (matchGlob(pattern, entry.path)) {
          return false
        }
      }
    }

    if (!pathspecs || pathspecs.length === 0) {
      return true
    }

    for (const pattern of pathspecs) {
      if (matchGlob(pattern, entry.path)) {
        return true
      }
    }

    return false
  })
}

/**
 * Recursively walk a tree and collect all entries with full paths
 */
export async function walkTree(
  store: ObjectStore,
  treeSha: string,
  prefix?: string
): Promise<Array<TreeEntry & { fullPath: string }>> {
  const tree = await store.getTree(treeSha)
  if (!tree) {
    return []
  }

  const results: Array<TreeEntry & { fullPath: string }> = []

  for (const entry of tree.entries) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.mode === FileMode.TREE) {
      const subEntries = await walkTree(store, entry.sha, fullPath)
      results.push(...subEntries)
    } else {
      results.push({ ...entry, fullPath })
    }
  }

  return results
}

function getModeType(mode: string): string {
  if (mode === FileMode.REGULAR || mode === FileMode.EXECUTABLE) {
    return 'file'
  }
  if (mode === FileMode.SYMLINK) {
    return 'symlink'
  }
  if (mode === FileMode.GITLINK) {
    return 'submodule'
  }
  if (mode === FileMode.TREE) {
    return 'tree'
  }
  return 'unknown'
}

// =============================================================================
// Core Diff Functions
// =============================================================================

/**
 * Compare two trees and return the differences
 */
export async function diffTrees(
  store: ObjectStore,
  oldTreeSha: string | null,
  newTreeSha: string | null,
  options: DiffOptions = {}
): Promise<DiffResult> {
  const {
    detectRenames: enableRenames = false,
    detectCopies: enableCopies = false,
    similarityThreshold = 50,
    pathspecs,
    excludePaths,
    detectBinary = false,
    recursive = true
  } = options

  if (oldTreeSha === null && newTreeSha === null) {
    return {
      entries: [],
      stats: { added: 0, deleted: 0, modified: 0, renamed: 0, copied: 0 }
    }
  }

  let oldEntries: Map<string, TreeEntry & { fullPath: string }> = new Map()
  if (oldTreeSha !== null) {
    const oldTree = await store.getTree(oldTreeSha)
    if (!oldTree) {
      throw new Error(`Tree not found: ${oldTreeSha}`)
    }

    if (recursive) {
      const entries = await walkTree(store, oldTreeSha)
      for (const entry of entries) {
        oldEntries.set(entry.fullPath, entry)
      }
    } else {
      for (const entry of oldTree.entries) {
        oldEntries.set(entry.name, { ...entry, fullPath: entry.name })
      }
    }
  }

  let newEntries: Map<string, TreeEntry & { fullPath: string }> = new Map()
  if (newTreeSha !== null) {
    const newTree = await store.getTree(newTreeSha)
    if (!newTree) {
      throw new Error(`Tree not found: ${newTreeSha}`)
    }

    if (recursive) {
      const entries = await walkTree(store, newTreeSha)
      for (const entry of entries) {
        newEntries.set(entry.fullPath, entry)
      }
    } else {
      for (const entry of newTree.entries) {
        newEntries.set(entry.name, { ...entry, fullPath: entry.name })
      }
    }
  }

  const diffEntries: DiffEntry[] = []

  for (const [path, oldEntry] of oldEntries) {
    const newEntry = newEntries.get(path)

    if (!newEntry) {
      diffEntries.push({
        path,
        status: DiffStatus.DELETED,
        oldMode: oldEntry.mode,
        newMode: null,
        oldSha: oldEntry.sha,
        newSha: null
      })
    } else if (oldEntry.sha !== newEntry.sha || oldEntry.mode !== newEntry.mode) {
      const oldType = getModeType(oldEntry.mode)
      const newType = getModeType(newEntry.mode)

      if (oldType !== newType) {
        diffEntries.push({
          path,
          status: DiffStatus.TYPE_CHANGED,
          oldMode: oldEntry.mode,
          newMode: newEntry.mode,
          oldSha: oldEntry.sha,
          newSha: newEntry.sha
        })
      } else {
        diffEntries.push({
          path,
          status: DiffStatus.MODIFIED,
          oldMode: oldEntry.mode,
          newMode: newEntry.mode,
          oldSha: oldEntry.sha,
          newSha: newEntry.sha
        })
      }
    }
  }

  for (const [path, newEntry] of newEntries) {
    if (!oldEntries.has(path)) {
      diffEntries.push({
        path,
        status: DiffStatus.ADDED,
        oldMode: null,
        newMode: newEntry.mode,
        oldSha: null,
        newSha: newEntry.sha
      })
    }
  }

  if (detectBinary) {
    for (const entry of diffEntries) {
      const sha = entry.newSha || entry.oldSha
      if (sha) {
        const blob = await store.getBlob(sha)
        if (blob) {
          entry.isBinary = isBinaryContent(blob)
        }
      }
    }
  }

  let finalEntries = diffEntries
  if (enableRenames) {
    finalEntries = await detectRenames(store, finalEntries, { similarityThreshold })
  }

  if (enableCopies) {
    const existingPaths = new Map<string, string>()
    for (const [path, entry] of oldEntries) {
      existingPaths.set(path, entry.sha)
    }
    finalEntries = await detectCopies(store, finalEntries, existingPaths, { similarityThreshold })
  }

  if (pathspecs || excludePaths) {
    finalEntries = filterByPathspecs(finalEntries, pathspecs, excludePaths)
  }

  const stats = {
    added: 0,
    deleted: 0,
    modified: 0,
    renamed: 0,
    copied: 0
  }

  for (const entry of finalEntries) {
    switch (entry.status) {
      case DiffStatus.ADDED:
        stats.added++
        break
      case DiffStatus.DELETED:
        stats.deleted++
        break
      case DiffStatus.MODIFIED:
      case DiffStatus.TYPE_CHANGED:
        stats.modified++
        break
      case DiffStatus.RENAMED:
        stats.renamed++
        break
      case DiffStatus.COPIED:
        stats.copied++
        break
    }
  }

  return { entries: finalEntries, stats }
}

/**
 * Detect renames in a set of diff entries
 */
export async function detectRenames(
  store: ObjectStore,
  entries: DiffEntry[],
  options: DiffOptions = {}
): Promise<DiffEntry[]> {
  const { similarityThreshold = 50 } = options

  const deleted = entries.filter(e => e.status === DiffStatus.DELETED)
  const added = entries.filter(e => e.status === DiffStatus.ADDED)
  const other = entries.filter(e => e.status !== DiffStatus.DELETED && e.status !== DiffStatus.ADDED)

  const matchedDeleted = new Set<string>()
  const matchedAdded = new Set<string>()
  const renames: DiffEntry[] = []

  for (const del of deleted) {
    if (matchedDeleted.has(del.path)) continue

    let bestMatch: DiffEntry | null = null
    let bestSimilarity = 0

    for (const add of added) {
      if (matchedAdded.has(add.path)) continue

      if (del.oldSha === add.newSha) {
        bestMatch = add
        bestSimilarity = 100
        break
      }

      if (del.oldSha && add.newSha) {
        const similarity = await calculateSimilarity(store, del.oldSha, add.newSha)
        if (similarity >= similarityThreshold && similarity > bestSimilarity) {
          bestMatch = add
          bestSimilarity = similarity
        }
      }
    }

    if (bestMatch && bestSimilarity >= similarityThreshold) {
      matchedDeleted.add(del.path)
      matchedAdded.add(bestMatch.path)
      renames.push({
        path: bestMatch.path,
        oldPath: del.path,
        status: DiffStatus.RENAMED,
        oldMode: del.oldMode,
        newMode: bestMatch.newMode,
        oldSha: del.oldSha,
        newSha: bestMatch.newSha,
        similarity: bestSimilarity
      })
    }
  }

  const result: DiffEntry[] = [...other, ...renames]

  for (const del of deleted) {
    if (!matchedDeleted.has(del.path)) {
      result.push(del)
    }
  }

  for (const add of added) {
    if (!matchedAdded.has(add.path)) {
      result.push(add)
    }
  }

  return result
}

/**
 * Detect copies in a set of diff entries
 */
export async function detectCopies(
  store: ObjectStore,
  entries: DiffEntry[],
  existingPaths: Map<string, string>,
  options: DiffOptions = {}
): Promise<DiffEntry[]> {
  const { similarityThreshold = 50 } = options

  const result: DiffEntry[] = []

  for (const entry of entries) {
    if (entry.status !== DiffStatus.ADDED) {
      result.push(entry)
      continue
    }

    let bestMatch: { path: string; sha: string } | null = null
    let bestSimilarity = 0

    for (const [path, sha] of existingPaths) {
      if (sha === entry.newSha) {
        bestMatch = { path, sha }
        bestSimilarity = 100
        break
      }

      if (entry.newSha) {
        const similarity = await calculateSimilarity(store, sha, entry.newSha)
        if (similarity >= similarityThreshold && similarity > bestSimilarity) {
          bestMatch = { path, sha }
          bestSimilarity = similarity
        }
      }
    }

    if (bestMatch && bestSimilarity >= similarityThreshold) {
      result.push({
        path: entry.path,
        oldPath: bestMatch.path,
        status: DiffStatus.COPIED,
        oldMode: entry.newMode,
        newMode: entry.newMode,
        oldSha: bestMatch.sha,
        newSha: entry.newSha,
        similarity: bestSimilarity
      })
    } else {
      result.push(entry)
    }
  }

  return result
}

/**
 * Compare a tree to the index (staging area)
 */
export async function diffTreeToIndex(
  store: ObjectStore,
  treeSha: string | null,
  index: IndexEntry[],
  options: DiffOptions = {}
): Promise<DiffResult> {
  const treeEntries = new Map<string, { mode: string; sha: string }>()

  if (treeSha !== null) {
    const entries = await walkTree(store, treeSha)
    for (const entry of entries) {
      treeEntries.set(entry.fullPath, { mode: entry.mode, sha: entry.sha })
    }
  }

  const indexEntries = new Map<string, IndexEntry>()
  for (const entry of index) {
    if (entry.stage === 0) {
      indexEntries.set(entry.path, entry)
    }
  }

  const diffEntries: DiffEntry[] = []

  for (const [path, treeEntry] of treeEntries) {
    const indexEntry = indexEntries.get(path)

    if (!indexEntry) {
      diffEntries.push({
        path,
        status: DiffStatus.DELETED,
        oldMode: treeEntry.mode,
        newMode: null,
        oldSha: treeEntry.sha,
        newSha: null
      })
    } else if (treeEntry.sha !== indexEntry.sha || treeEntry.mode !== indexEntry.mode) {
      diffEntries.push({
        path,
        status: DiffStatus.MODIFIED,
        oldMode: treeEntry.mode,
        newMode: indexEntry.mode,
        oldSha: treeEntry.sha,
        newSha: indexEntry.sha
      })
    }
  }

  for (const [path, indexEntry] of indexEntries) {
    if (!treeEntries.has(path)) {
      diffEntries.push({
        path,
        status: DiffStatus.ADDED,
        oldMode: null,
        newMode: indexEntry.mode,
        oldSha: null,
        newSha: indexEntry.sha
      })
    }
  }

  let finalEntries = diffEntries
  if (options.pathspecs || options.excludePaths) {
    finalEntries = filterByPathspecs(finalEntries, options.pathspecs, options.excludePaths)
  }

  const stats = {
    added: 0,
    deleted: 0,
    modified: 0,
    renamed: 0,
    copied: 0
  }

  for (const entry of finalEntries) {
    switch (entry.status) {
      case DiffStatus.ADDED:
        stats.added++
        break
      case DiffStatus.DELETED:
        stats.deleted++
        break
      case DiffStatus.MODIFIED:
        stats.modified++
        break
      case DiffStatus.RENAMED:
        stats.renamed++
        break
      case DiffStatus.COPIED:
        stats.copied++
        break
    }
  }

  return { entries: finalEntries, stats }
}

/**
 * Compare a tree to working directory entries
 */
export async function diffTreeToWorktree(
  store: ObjectStore,
  treeSha: string | null,
  workingEntries: IndexEntry[],
  options: DiffOptions = {}
): Promise<DiffResult> {
  return diffTreeToIndex(store, treeSha, workingEntries, options)
}
