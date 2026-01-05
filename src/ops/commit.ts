/**
 * Commit Creation Operations
 *
 * Provides functionality for creating, formatting, and amending git commits.
 * Supports author/committer info, parent handling, GPG signing, and message formatting.
 */

import { Author, CommitObject } from '../types/objects'
import type { BasicObjectStore as ObjectStore } from '../types/storage'

// ============================================================================
// Types
// ============================================================================

/**
 * Author/Committer information for creating commits
 */
export interface CommitAuthor {
  /** Author's name */
  name: string
  /** Author's email address */
  email: string
  /** Unix timestamp in seconds */
  timestamp?: number
  /** Timezone offset (e.g., '+0000', '-0500', '+0530') */
  timezone?: string
}

/**
 * GPG signature options for signed commits
 */
export interface SigningOptions {
  /** Whether to sign the commit */
  sign: boolean
  /** GPG key ID to use for signing (optional, uses default if not specified) */
  keyId?: string
  /** Callback to perform the actual signing */
  signer?: (data: Uint8Array) => Promise<string>
}

/**
 * Options for creating a commit
 */
export interface CommitOptions {
  /** Commit message (required) */
  message: string
  /** Tree SHA for the commit (required) */
  tree: string
  /** Parent commit SHA(s) - empty array for initial commit, one for normal, multiple for merge */
  parents?: string[]
  /** Author information */
  author?: CommitAuthor
  /** Committer information (defaults to author if not specified) */
  committer?: CommitAuthor
  /** GPG signing options */
  signing?: SigningOptions
  /** Allow creating empty commits (no changes from parent) */
  allowEmpty?: boolean
  /** Whether this is an amend of a previous commit */
  amend?: boolean
}

/**
 * Options for amending a commit
 */
export interface AmendOptions {
  /** New commit message (if not provided, keeps the original) */
  message?: string
  /** New tree SHA (if not provided, keeps the original) */
  tree?: string
  /** New author info (if not provided, keeps the original) */
  author?: CommitAuthor
  /** New committer info (defaults to current user with current time) */
  committer?: CommitAuthor
  /** Whether to reset author timestamp to current time */
  resetAuthorDate?: boolean
  /** GPG signing options */
  signing?: SigningOptions
}

/**
 * Options for formatting commit messages
 */
export interface FormatOptions {
  /** Strip leading/trailing whitespace from lines */
  stripWhitespace?: boolean
  /** Strip comment lines (starting with #) */
  stripComments?: boolean
  /** Comment character (defaults to '#') */
  commentChar?: string
  /** Wrap message body at column (0 = no wrap) */
  wrapColumn?: number
  /** Clean up mode: 'verbatim' | 'whitespace' | 'strip' | 'scissors' | 'default' */
  cleanup?: 'verbatim' | 'whitespace' | 'strip' | 'scissors' | 'default'
}

/**
 * Result of creating a commit
 */
export interface CommitResult {
  /** SHA of the created commit */
  sha: string
  /** The commit object */
  commit: CommitObject
  /** Whether the commit was actually created (false if empty and allowEmpty=false) */
  created: boolean
}

/**
 * ObjectStore interface for commit operations.
 * Re-exported from storage types for convenience.
 */
export type { ObjectStore }

// Internal type for signed commit with gpgsig field
interface SignedCommitObject extends CommitObject {
  gpgsig?: string
}

// ============================================================================
// Author/Timestamp Utilities
// ============================================================================

/**
 * Get the current timezone offset string
 *
 * @returns Timezone offset like '+0000' or '-0500'
 */
export function getCurrentTimezone(): string {
  const offset = new Date().getTimezoneOffset()
  const sign = offset <= 0 ? '+' : '-'
  const absOffset = Math.abs(offset)
  const hours = Math.floor(absOffset / 60)
  const minutes = absOffset % 60
  return `${sign}${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`
}

/**
 * Format a timestamp and timezone as git author/committer format
 *
 * @param timestamp - Unix timestamp in seconds
 * @param timezone - Timezone offset string (e.g., '+0000', '-0500')
 * @returns Formatted string like "1234567890 +0000"
 */
export function formatTimestamp(timestamp: number, timezone: string): string {
  return `${timestamp} ${timezone}`
}

/**
 * Parse a git timestamp string
 *
 * @param timestampStr - Timestamp string like "1234567890 +0000"
 * @returns Object with timestamp and timezone
 */
export function parseTimestamp(timestampStr: string): {
  timestamp: number
  timezone: string
} {
  const match = timestampStr.match(/^(\d+) ([+-]\d{4})$/)
  if (!match) {
    throw new Error(`Invalid timestamp format: ${timestampStr}`)
  }
  return {
    timestamp: parseInt(match[1], 10),
    timezone: match[2]
  }
}

/**
 * Create an Author object with current timestamp
 *
 * @param name - Author name
 * @param email - Author email
 * @param timezone - Optional timezone (defaults to local timezone)
 * @returns Author object with current timestamp
 */
export function createAuthor(
  name: string,
  email: string,
  timezone?: string
): Author {
  return {
    name,
    email,
    timestamp: Math.floor(Date.now() / 1000),
    timezone: timezone ?? getCurrentTimezone()
  }
}

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Wrap text at a specified column width
 */
function wrapText(text: string, column: number): string {
  if (column <= 0) return text

  const words = text.split(/\s+/)
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word
    } else if (currentLine.length + 1 + word.length <= column) {
      currentLine += ' ' + word
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  return lines.join('\n')
}

/**
 * Format a commit message according to git conventions
 *
 * @param message - The raw commit message
 * @param options - Formatting options
 * @returns The formatted commit message
 */
export function formatCommitMessage(
  message: string,
  options: FormatOptions = {}
): string {
  const { cleanup = 'default', commentChar = '#', wrapColumn = 0 } = options

  // Verbatim mode: return message as-is
  if (cleanup === 'verbatim') {
    return message
  }

  let result = message

  // Scissors mode: remove everything after scissors line
  if (cleanup === 'scissors') {
    const scissorsPattern = new RegExp(`^${commentChar} -+ >8 -+`, 'm')
    const scissorsMatch = result.match(scissorsPattern)
    if (scissorsMatch && scissorsMatch.index !== undefined) {
      result = result.slice(0, scissorsMatch.index)
    }
  }

  // Strip comments if cleanup is 'strip' or 'scissors'
  if (cleanup === 'strip' || cleanup === 'scissors') {
    const lines = result.split('\n')
    result = lines.filter(line => !line.startsWith(commentChar)).join('\n')
  }

  // Strip whitespace (for 'whitespace', 'strip', 'scissors', 'default')
  // Note: verbatim check already handled above, so this always runs
  if (true) {
    // Strip leading/trailing whitespace from each line
    const lines = result.split('\n')
    const trimmedLines = lines.map(line => line.trim())

    // Collapse multiple blank lines into one
    const collapsedLines: string[] = []
    let lastWasBlank = false
    for (const line of trimmedLines) {
      if (line === '') {
        if (!lastWasBlank) {
          collapsedLines.push(line)
        }
        lastWasBlank = true
      } else {
        collapsedLines.push(line)
        lastWasBlank = false
      }
    }

    result = collapsedLines.join('\n')

    // Trim leading/trailing blank lines
    result = result.replace(/^\n+/, '').replace(/\n+$/, '')
  }

  // Wrap body (not subject) if wrapColumn is specified
  if (wrapColumn > 0 && result.length > 0) {
    const lines = result.split('\n')
    if (lines.length > 0) {
      const subject = lines[0]
      const rest = lines.slice(1)

      // Find where body starts (after blank line)
      let bodyStartIndex = 0
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '') {
          bodyStartIndex = i + 1
          break
        }
      }

      // Wrap body lines
      const wrappedRest: string[] = []
      for (let i = 0; i < rest.length; i++) {
        if (i >= bodyStartIndex && rest[i] !== '') {
          wrappedRest.push(wrapText(rest[i], wrapColumn))
        } else {
          wrappedRest.push(rest[i])
        }
      }

      result = [subject, ...wrappedRest].join('\n')
    }
  }

  return result
}

/**
 * Parse a commit message into subject and body
 *
 * @param message - The commit message
 * @returns Object with subject (first line) and body (rest)
 */
export function parseCommitMessage(message: string): {
  subject: string
  body: string
} {
  if (!message) {
    return { subject: '', body: '' }
  }

  const lines = message.split('\n')
  const subject = lines[0] || ''

  // Find the body - it starts after the first blank line (or second line if no blank)
  let bodyStartIndex = 1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') {
      bodyStartIndex = i + 1
      break
    }
  }

  const body = lines.slice(bodyStartIndex).join('\n')

  return { subject, body }
}

/**
 * Validate a commit message format
 *
 * @param message - The commit message to validate
 * @returns Object with valid flag and any error messages
 */
export function validateCommitMessage(message: string): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (!message || message.trim() === '') {
    errors.push('Commit message is empty')
    return { valid: false, errors, warnings }
  }

  const { subject, body: _body } = parseCommitMessage(message)

  // Check subject line length (72 chars is conventional max)
  if (subject.length > 72) {
    warnings.push('Subject line exceeds 72 characters')
  }

  // Check if subject ends with a period
  if (subject.endsWith('.')) {
    warnings.push('Subject line should not end with a period')
  }

  // Check for missing blank line between subject and body
  const lines = message.split('\n')
  if (lines.length > 1 && lines[1] !== '') {
    warnings.push('Missing blank line between subject and body')
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ============================================================================
// GPG Signing
// ============================================================================

/**
 * Check if a commit is signed
 *
 * @param commit - The commit object
 * @returns true if the commit has a GPG signature
 */
export function isCommitSigned(commit: CommitObject): boolean {
  const signedCommit = commit as SignedCommitObject
  return signedCommit.gpgsig !== undefined && signedCommit.gpgsig !== null
}

/**
 * Extract the GPG signature from a signed commit
 *
 * @param commit - The commit object
 * @returns The signature if present, null otherwise
 */
export function extractCommitSignature(commit: CommitObject): string | null {
  const signedCommit = commit as SignedCommitObject
  return signedCommit.gpgsig ?? null
}

/**
 * Add a GPG signature to a commit
 *
 * @param commit - The unsigned commit object
 * @param signature - The GPG signature
 * @returns The signed commit object
 */
export function addSignatureToCommit(
  commit: CommitObject,
  signature: string
): CommitObject {
  const signedCommit: SignedCommitObject = {
    ...commit,
    gpgsig: signature
  }
  return signedCommit
}

// ============================================================================
// Empty Commit Detection
// ============================================================================

/**
 * Extract tree SHA from commit data
 */
function extractTreeFromCommitData(data: Uint8Array): string | null {
  const decoder = new TextDecoder()
  const content = decoder.decode(data)
  const match = content.match(/tree ([0-9a-f]{40})/)
  return match ? match[1] : null
}

/**
 * Check if a commit would be empty (same tree as parent)
 *
 * @param store - The object store for reading objects
 * @param tree - The tree SHA for the new commit
 * @param parent - The parent commit SHA (or null for initial commit)
 * @returns true if the commit would have no changes
 */
export async function isEmptyCommit(
  store: ObjectStore,
  tree: string,
  parent: string | null
): Promise<boolean> {
  // Initial commits are never "empty"
  if (parent === null) {
    return false
  }

  const parentObj = await store.getObject(parent)
  if (!parentObj) {
    return false
  }

  // Extract tree from parent commit
  const parentTree = extractTreeFromCommitData(parentObj.data)

  return parentTree === tree
}

// ============================================================================
// Validation Helpers
// ============================================================================

const SHA_REGEX = /^[0-9a-f]{40}$/

function isValidSha(sha: string): boolean {
  return SHA_REGEX.test(sha)
}

function isValidEmail(email: string): boolean {
  // Basic email validation - must contain @ and have something before and after
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validateAuthorName(name: string): void {
  if (name.includes('<') || name.includes('>')) {
    throw new Error('Author name cannot contain angle brackets')
  }
  if (name.includes('\n')) {
    throw new Error('Author name cannot contain newlines')
  }
}

function validateCommitOptions(options: CommitOptions): void {
  // Validate tree
  if (!options.tree) {
    throw new Error('Tree SHA is required')
  }
  if (!isValidSha(options.tree)) {
    throw new Error('Invalid tree SHA format')
  }

  // Validate author
  if (!options.author) {
    throw new Error('Author is required')
  }
  validateAuthorName(options.author.name)
  if (!isValidEmail(options.author.email)) {
    throw new Error('Invalid author email format')
  }

  // Validate committer if provided
  if (options.committer) {
    validateAuthorName(options.committer.name)
    if (!isValidEmail(options.committer.email)) {
      throw new Error('Invalid committer email format')
    }
  }

  // Validate message
  if (!options.message || options.message.trim() === '') {
    throw new Error('Commit message is required')
  }

  // Validate parents
  if (options.parents) {
    for (const parent of options.parents) {
      if (!isValidSha(parent)) {
        throw new Error('Invalid parent SHA format')
      }
    }
  }

  // Validate timestamp if provided
  if (options.author.timestamp !== undefined && options.author.timestamp < 0) {
    throw new Error('Timestamp cannot be negative')
  }
  if (options.committer?.timestamp !== undefined && options.committer.timestamp < 0) {
    throw new Error('Timestamp cannot be negative')
  }
}

// ============================================================================
// Commit Creation
// ============================================================================

/**
 * Resolve a CommitAuthor to a full Author with timestamp and timezone
 */
function resolveAuthor(commitAuthor: CommitAuthor): Author {
  return {
    name: commitAuthor.name,
    email: commitAuthor.email,
    timestamp: commitAuthor.timestamp ?? Math.floor(Date.now() / 1000),
    timezone: commitAuthor.timezone ?? getCurrentTimezone()
  }
}

/**
 * Serialize commit content to bytes (without the header)
 */
function serializeCommitContent(commit: {
  tree: string
  parents: string[]
  author: Author
  committer: Author
  message: string
  gpgsig?: string
}): Uint8Array {
  const encoder = new TextEncoder()
  const lines: string[] = []

  lines.push(`tree ${commit.tree}`)
  for (const parent of commit.parents) {
    lines.push(`parent ${parent}`)
  }
  lines.push(`author ${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.timezone}`)
  lines.push(`committer ${commit.committer.name} <${commit.committer.email}> ${commit.committer.timestamp} ${commit.committer.timezone}`)

  // Add gpgsig if present
  if (commit.gpgsig) {
    const sigLines = commit.gpgsig.split('\n')
    lines.push(`gpgsig ${sigLines[0]}`)
    for (let i = 1; i < sigLines.length; i++) {
      lines.push(` ${sigLines[i]}`)
    }
  }

  lines.push('')
  lines.push(commit.message)

  return encoder.encode(lines.join('\n'))
}

/**
 * Create a new commit from raw data without storing
 *
 * @param options - Commit creation options
 * @returns The commit object (not stored)
 */
export function buildCommitObject(options: CommitOptions): CommitObject {
  const author = resolveAuthor(options.author!)
  const committer = options.committer ? resolveAuthor(options.committer) : author
  const parents = options.parents ?? []

  const commit: CommitObject = {
    type: 'commit',
    data: new Uint8Array(),
    tree: options.tree,
    parents,
    author,
    committer,
    message: options.message
  }

  // Set the data field
  commit.data = serializeCommitContent({
    tree: commit.tree,
    parents: commit.parents,
    author: commit.author,
    committer: commit.committer,
    message: commit.message
  })

  return commit
}

/**
 * Create a new commit
 *
 * @param store - The object store for reading/writing objects
 * @param options - Commit creation options
 * @returns The created commit result with SHA and commit object
 * @throws Error if required options are missing or invalid
 */
export async function createCommit(
  store: ObjectStore,
  options: CommitOptions
): Promise<CommitResult> {
  // Validate options
  validateCommitOptions(options)

  const parents = options.parents ?? []

  // Check for empty commit
  if (options.allowEmpty === false && parents.length > 0) {
    const isEmpty = await isEmptyCommit(store, options.tree, parents[0])
    if (isEmpty) {
      throw new Error('Nothing to commit (empty commit not allowed)')
    }
  }

  // Build the commit object
  let commit = buildCommitObject(options)

  // Sign if requested
  if (options.signing?.sign && options.signing.signer) {
    const commitData = serializeCommitContent({
      tree: commit.tree,
      parents: commit.parents,
      author: commit.author,
      committer: commit.committer,
      message: commit.message
    })

    const signature = await options.signing.signer(commitData)
    commit = addSignatureToCommit(commit, signature) as CommitObject

    // Update commit data with signature
    const signedCommit = commit as SignedCommitObject
    commit.data = serializeCommitContent({
      tree: commit.tree,
      parents: commit.parents,
      author: commit.author,
      committer: commit.committer,
      message: commit.message,
      gpgsig: signedCommit.gpgsig
    })
  }

  // Store the commit
  const sha = await store.storeObject('commit', commit.data)

  return {
    sha,
    commit,
    created: true
  }
}

// ============================================================================
// Commit Amendment
// ============================================================================

/**
 * Parse a stored commit object from data
 * Supports both git text format and JSON format (for testing)
 */
function parseStoredCommit(data: Uint8Array): {
  tree: string
  parents: string[]
  author: Author
  committer: Author
  message: string
} {
  const decoder = new TextDecoder()
  const content = decoder.decode(data)

  // Try to parse as JSON first (for test compatibility)
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content)
      return {
        tree: parsed.tree,
        parents: parsed.parents || [],
        author: parsed.author,
        committer: parsed.committer || parsed.author,
        message: parsed.message
      }
    } catch {
      // Not JSON, fall through to git format parsing
    }
  }

  // Parse git text format
  const lines = content.split('\n')

  let tree = ''
  const parents: string[] = []
  let author: Author | null = null
  let committer: Author | null = null
  let messageStartIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      messageStartIndex = i + 1
      break
    }

    if (line.startsWith('tree ')) {
      tree = line.slice(5)
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      const match = line.match(/^author (.+) <(.+)> (\d+) ([+-]\d{4})$/)
      if (match) {
        author = {
          name: match[1],
          email: match[2],
          timestamp: parseInt(match[3], 10),
          timezone: match[4]
        }
      }
    } else if (line.startsWith('committer ')) {
      const match = line.match(/^committer (.+) <(.+)> (\d+) ([+-]\d{4})$/)
      if (match) {
        committer = {
          name: match[1],
          email: match[2],
          timestamp: parseInt(match[3], 10),
          timezone: match[4]
        }
      }
    }
  }

  const message = lines.slice(messageStartIndex).join('\n')

  if (!author) {
    author = { name: 'Unknown', email: 'unknown@example.com', timestamp: 0, timezone: '+0000' }
  }
  if (!committer) {
    committer = author
  }

  return { tree, parents, author, committer, message }
}

/**
 * Amend an existing commit
 *
 * @param store - The object store for reading/writing objects
 * @param commitSha - SHA of the commit to amend
 * @param options - Amendment options
 * @returns The new commit result (original commit is not modified)
 * @throws Error if the commit doesn't exist or options are invalid
 */
export async function amendCommit(
  store: ObjectStore,
  commitSha: string,
  options: AmendOptions
): Promise<CommitResult> {
  // Get the original commit
  const originalObj = await store.getObject(commitSha)
  if (!originalObj) {
    throw new Error(`Commit not found: ${commitSha}`)
  }

  // Parse the original commit
  const original = parseStoredCommit(originalObj.data)

  // Build new author
  let newAuthor = original.author
  if (options.author) {
    newAuthor = resolveAuthor(options.author)
  } else if (options.resetAuthorDate) {
    newAuthor = {
      ...original.author,
      timestamp: Math.floor(Date.now() / 1000)
    }
  }

  // Build new committer (defaults to current time)
  let newCommitter: Author
  if (options.committer) {
    newCommitter = resolveAuthor(options.committer)
  } else {
    newCommitter = {
      ...original.committer,
      timestamp: Math.floor(Date.now() / 1000),
      timezone: getCurrentTimezone()
    }
  }

  // Build new commit
  const newCommitOptions: CommitOptions = {
    message: options.message ?? original.message,
    tree: options.tree ?? original.tree,
    parents: original.parents,
    author: newAuthor,
    committer: newCommitter,
    signing: options.signing,
    allowEmpty: true
  }

  return createCommit(store, newCommitOptions)
}
