/**
 * Git Commit Object
 *
 * Represents a Git commit object with tree reference, parents,
 * author/committer info, and commit message.
 *
 * Format:
 * tree <sha>
 * parent <sha> (zero or more)
 * author <name> <email> <timestamp> <timezone>
 * committer <name> <email> <timestamp> <timezone>
 * encoding <encoding> (optional)
 * mergetag object <sha>... (optional, for merge commits with signed tags)
 * gpgsig -----BEGIN PGP SIGNATURE-----
 *  <signature lines>
 *  -----END PGP SIGNATURE-----
 *
 * <message>
 *
 * @module core/objects/commit
 */

import { calculateObjectHash, createObjectHeader, parseObjectHeader } from './hash'
import { type GitIdentity, type CommitData, isValidSha } from './types'

// =============================================================================
// Extended Commit Data with Extra Headers
// =============================================================================

/**
 * Extra headers that can appear in a commit object.
 * These are Git-compatible but less commonly used headers.
 */
export interface CommitExtraHeaders {
  /**
   * Text encoding for the commit message (e.g., 'UTF-8', 'ISO-8859-1')
   * Used when the message contains non-UTF-8 characters
   */
  encoding?: string

  /**
   * Merge tag data - contains the full tag object for signed tags in merges
   * Format: "mergetag object <sha>\\ntype <type>\\n..."
   */
  mergetag?: string

  /**
   * Any other unknown headers preserved for round-trip compatibility
   * Maps header name to value(s)
   */
  [key: string]: string | string[] | undefined
}

/**
 * Extended CommitData interface with extra headers support
 */
export interface ExtendedCommitData extends CommitData {
  /**
   * Extra headers beyond the standard tree/parent/author/committer
   */
  extraHeaders?: CommitExtraHeaders
}

// =============================================================================
// Text Encoding Utilities
// =============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// =============================================================================
// Identity Parsing Utilities
// =============================================================================

/**
 * Parses a Git identity line (author/committer/tagger)
 * Format: "prefix Name <email> timestamp timezone"
 */
export function parseIdentity(line: string): GitIdentity {
  // Format: author/committer/tagger Name <email> timestamp timezone
  // Example: "author John Doe <john@example.com.ai> 1704067200 +0530"

  // Find email boundaries
  const emailStart = line.indexOf('<')
  const emailEnd = line.indexOf('>')

  if (emailStart === -1 || emailEnd === -1) {
    throw new Error(`Invalid identity line: ${line}`)
  }

  // Skip prefix (author/committer/tagger)
  const prefixEnd = line.indexOf(' ')
  const name = line.slice(prefixEnd + 1, emailStart).trim()
  const email = line.slice(emailStart + 1, emailEnd)

  // Parse timestamp and timezone
  const afterEmail = line.slice(emailEnd + 1).trim()
  const parts = afterEmail.split(' ')

  if (parts.length < 2) {
    throw new Error(`Invalid identity line: missing timestamp/timezone: ${line}`)
  }

  const timestampStr = parts[0]
  const timezoneStr = parts[1]
  if (timestampStr === undefined || timezoneStr === undefined) {
    throw new Error(`Invalid identity line: missing timestamp/timezone: ${line}`)
  }

  const timestamp = parseInt(timestampStr, 10)
  const timezone = timezoneStr

  return { name, email, timestamp, timezone }
}

/**
 * Formats a Git identity for serialization
 * @param prefix - The line prefix (author, committer, tagger)
 * @param identity - The identity to format
 */
export function formatIdentity(prefix: string, identity: GitIdentity): string {
  return `${prefix} ${identity.name} <${identity.email}> ${identity.timestamp} ${identity.timezone}`
}

// =============================================================================
// GPG Signature Utilities
// =============================================================================

/**
 * Checks if a commit has a GPG signature
 */
export function hasGpgSignature(commit: GitCommit): boolean {
  return commit.gpgSignature !== undefined && commit.gpgSignature !== ''
}

/**
 * Parses GPG signature from a commit
 */
export function parseGpgSignature(commit: GitCommit): string | undefined {
  return commit.gpgSignature
}

// =============================================================================
// Commit Validation
// =============================================================================

/**
 * Result of commit validation
 */
export interface CommitValidationResult {
  /** Whether the commit data is valid */
  isValid: boolean
  /** Error message if validation failed */
  error?: string
  /** Warning messages for non-critical issues */
  warnings?: string[]
}

/**
 * Validates commit data before creation.
 * Returns validation result with error/warning messages.
 *
 * @param data - Commit data to validate
 * @returns Validation result object
 *
 * @example
 * ```typescript
 * const result = validateCommitData({
 *   tree: 'abc123...',
 *   author: { ... },
 *   committer: { ... },
 *   message: 'Commit message'
 * })
 * if (!result.isValid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export function validateCommitData(data: CommitData | ExtendedCommitData): CommitValidationResult {
  const warnings: string[] = []

  // Validate tree SHA
  if (!data.tree) {
    return { isValid: false, error: 'Missing tree SHA' }
  }
  if (!isValidSha(data.tree)) {
    return { isValid: false, error: `Invalid tree SHA: ${data.tree}` }
  }

  // Validate parent SHAs
  if (data.parents) {
    for (let i = 0; i < data.parents.length; i++) {
      const parentSha = data.parents[i]
      if (parentSha === undefined || !isValidSha(parentSha)) {
        return { isValid: false, error: `Invalid parent SHA at index ${i}: ${parentSha}` }
      }
    }
  }

  // Validate author
  const authorResult = validateIdentity(data.author, 'author')
  if (!authorResult.isValid) {
    return authorResult
  }
  if (authorResult.warnings) {
    warnings.push(...authorResult.warnings)
  }

  // Validate committer
  const committerResult = validateIdentity(data.committer, 'committer')
  if (!committerResult.isValid) {
    return committerResult
  }
  if (committerResult.warnings) {
    warnings.push(...committerResult.warnings)
  }

  // Validate message
  if (typeof data.message !== 'string') {
    return { isValid: false, error: 'Commit message must be a string' }
  }

  // Warn about empty message
  if (data.message.trim() === '') {
    warnings.push('Empty commit message')
  }

  // Warn about very long subject lines
  const firstLine = data.message.split('\n')[0] ?? ''
  if (firstLine.length > 72) {
    warnings.push(`Subject line exceeds 72 characters (${firstLine.length} chars)`)
  }

  if (warnings.length > 0) {
    return { isValid: true, warnings }
  }
  return { isValid: true }
}

/**
 * Validates a GitIdentity object
 */
function validateIdentity(identity: GitIdentity, field: string): CommitValidationResult {
  const warnings: string[] = []

  if (!identity) {
    return { isValid: false, error: `Missing ${field}` }
  }

  if (!identity.name || typeof identity.name !== 'string') {
    return { isValid: false, error: `Invalid ${field} name` }
  }

  if (!identity.email || typeof identity.email !== 'string') {
    return { isValid: false, error: `Invalid ${field} email` }
  }

  if (typeof identity.timestamp !== 'number' || !Number.isInteger(identity.timestamp)) {
    return { isValid: false, error: `Invalid ${field} timestamp` }
  }

  if (identity.timestamp < 0) {
    warnings.push(`${field} has negative timestamp`)
  }

  if (!identity.timezone || !/^[+-]\d{4}$/.test(identity.timezone)) {
    return { isValid: false, error: `Invalid ${field} timezone format: expected +/-HHMM` }
  }

  if (warnings.length > 0) {
    return { isValid: true, warnings }
  }
  return { isValid: true }
}

// =============================================================================
// GitCommit Class
// =============================================================================

/**
 * Git commit object with support for GPG signatures and extra headers.
 *
 * Provides methods for serialization, deserialization, and inspection
 * of Git commit objects.
 *
 * @example
 * ```typescript
 * // Create a new commit
 * const commit = new GitCommit({
 *   tree: treeSha,
 *   parents: [parentSha],
 *   author: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   committer: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Initial commit'
 * })
 *
 * // Get the SHA
 * const sha = await commit.hash()
 *
 * // Parse from serialized data
 * const parsed = GitCommit.parse(serializedData)
 * ```
 */
export class GitCommit {
  readonly type = 'commit' as const
  readonly tree: string
  readonly parents: readonly string[]
  readonly author: GitIdentity
  readonly committer: GitIdentity
  readonly message: string
  readonly gpgSignature?: string
  readonly extraHeaders?: CommitExtraHeaders

  /**
   * Creates a new GitCommit
   * @param data - Commit data including tree, parents, author, committer, message
   * @throws Error if tree or any parent SHA is invalid
   */
  constructor(data: CommitData | ExtendedCommitData) {
    // Validate using the validation function
    const validation = validateCommitData(data)
    if (!validation.isValid) {
      throw new Error(validation.error)
    }

    const parents = data.parents ?? []

    this.tree = data.tree
    this.parents = Object.freeze([...parents]) // Immutable copy
    this.author = Object.freeze({ ...data.author })
    this.committer = Object.freeze({ ...data.committer })
    this.message = data.message
    if (data.gpgSignature !== undefined) {
      this.gpgSignature = data.gpgSignature
    }

    // Store extra headers if provided
    if ('extraHeaders' in data && data.extraHeaders) {
      this.extraHeaders = Object.freeze({ ...data.extraHeaders })
    }
  }

  /**
   * Creates a GitCommit from raw commit content (without header)
   */
  static fromContent(content: string): GitCommit {
    return parseCommitContent(content)
  }

  /**
   * Parses a GitCommit from serialized Git object format
   * @param data - The serialized data including header
   * @throws Error if the header is invalid or type is not commit
   */
  static parse(data: Uint8Array): GitCommit {
    const { type, size, headerLength } = parseObjectHeader(data)

    if (type !== 'commit') {
      throw new Error(`Invalid commit header: expected 'commit', got '${type}'`)
    }

    const content = data.slice(headerLength)

    // Validate size matches actual content length
    if (content.length !== size) {
      throw new Error(`Size mismatch: header says ${size} bytes, but content is ${content.length} bytes`)
    }

    const contentStr = decoder.decode(content)
    return parseCommitContent(contentStr)
  }

  /**
   * Checks if this is an initial commit (no parents)
   */
  isInitialCommit(): boolean {
    return this.parents.length === 0
  }

  /**
   * Checks if this is a merge commit (2+ parents)
   */
  isMergeCommit(): boolean {
    return this.parents.length >= 2
  }

  /**
   * Checks if this commit has a GPG signature
   */
  hasSignature(): boolean {
    return hasGpgSignature(this)
  }

  /**
   * Gets the subject line (first line) of the commit message
   */
  getSubject(): string {
    const newlineIdx = this.message.indexOf('\n')
    if (newlineIdx === -1) {
      return this.message
    }
    return this.message.slice(0, newlineIdx)
  }

  /**
   * Gets the body of the commit message (after subject and blank line)
   */
  getBody(): string {
    const newlineIdx = this.message.indexOf('\n\n')
    if (newlineIdx === -1) {
      return ''
    }
    return this.message.slice(newlineIdx + 2)
  }

  /**
   * Serializes the commit to Git object format
   */
  serialize(): Uint8Array {
    const content = this.serializeContent()
    const contentBytes = encoder.encode(content)
    const header = createObjectHeader('commit', contentBytes.length)
    const result = new Uint8Array(header.length + contentBytes.length)
    result.set(header)
    result.set(contentBytes, header.length)
    return result
  }

  /**
   * Gets extra headers (encoding, mergetag, etc.) if present
   */
  getExtraHeaders(): CommitExtraHeaders | undefined {
    return this.extraHeaders
  }

  /**
   * Serializes just the commit content (without header)
   */
  private serializeContent(): string {
    const lines: string[] = []

    // Tree line
    lines.push(`tree ${this.tree}`)

    // Parent lines
    for (const parent of this.parents) {
      lines.push(`parent ${parent}`)
    }

    // Author line
    lines.push(formatIdentity('author', this.author))

    // Committer line
    lines.push(formatIdentity('committer', this.committer))

    // Extra headers (encoding, mergetag, etc.)
    if (this.extraHeaders) {
      // Encoding header
      if (this.extraHeaders.encoding) {
        lines.push(`encoding ${this.extraHeaders.encoding}`)
      }

      // Mergetag header (multi-line)
      if (this.extraHeaders.mergetag) {
        const mergetagLines = this.extraHeaders.mergetag.split('\n')
        lines.push(`mergetag ${mergetagLines[0]}`)
        for (let i = 1; i < mergetagLines.length; i++) {
          lines.push(` ${mergetagLines[i]}`)
        }
      }

      // Other unknown headers (preserved for round-trip compatibility)
      for (const [key, value] of Object.entries(this.extraHeaders)) {
        if (key === 'encoding' || key === 'mergetag') continue
        if (typeof value === 'string') {
          lines.push(`${key} ${value}`)
        } else if (Array.isArray(value)) {
          for (const v of value) {
            lines.push(`${key} ${v}`)
          }
        }
      }
    }

    // GPG signature (if present)
    if (this.gpgSignature) {
      // GPG signatures are multi-line with continuation lines starting with space
      const sigLines = this.gpgSignature.split('\n')
      lines.push(`gpgsig ${sigLines[0]}`)
      for (let i = 1; i < sigLines.length; i++) {
        lines.push(` ${sigLines[i]}`)
      }
    }

    // Blank line before message
    lines.push('')

    // Message
    lines.push(this.message)

    return lines.join('\n')
  }

  /**
   * Calculates the SHA-1 hash of this commit object
   * @returns Promise resolving to 40-character hex string
   */
  async hash(): Promise<string> {
    const content = this.serializeContent()
    const contentBytes = encoder.encode(content)
    return calculateObjectHash('commit', contentBytes)
  }
}

// =============================================================================
// Commit Content Parser (Optimized)
// =============================================================================

/**
 * Multi-line headers that span multiple lines with space continuation
 */
const MULTILINE_HEADERS = new Set(['gpgsig', 'mergetag'])

/**
 * Parses a multi-line header value (like gpgsig or mergetag).
 * These headers continue on subsequent lines that start with a space.
 *
 * For GPG signatures specifically, we need to read until we find
 * the "-----END PGP SIGNATURE-----" marker because the content
 * may include blank lines.
 *
 * @param lines - Array of all lines
 * @param startIdx - Index of the first line
 * @param firstLineValue - The value from the first line (after header name)
 * @param headerName - The name of the header being parsed
 * @returns Tuple of [parsedValue, lastLineIndex]
 */
function parseMultilineHeader(
  lines: string[],
  startIdx: number,
  firstLineValue: string,
  headerName: string = ''
): [string, number] {
  const valueLines: string[] = [firstLineValue]
  let i = startIdx + 1

  // For GPG signatures, read until END marker
  if (headerName === 'gpgsig' || firstLineValue.includes('-----BEGIN PGP SIGNATURE-----')) {
    while (i < lines.length) {
      const line = lines[i]
      if (line === undefined) break
      // Remove leading space from continuation lines
      const content = line.startsWith(' ') ? line.slice(1) : line

      // Check if we've hit the end of headers (empty line at start of message)
      // But only if we've already seen the END marker or this line doesn't look like continuation
      if (line === '' && !valueLines.some(l => l.includes('-----END PGP SIGNATURE-----'))) {
        valueLines.push('')
        i++
        continue
      }

      // If this line doesn't start with space and we've seen END, we're done
      if (!line.startsWith(' ') && line !== '' && valueLines.some(l => l.includes('-----END PGP SIGNATURE-----'))) {
        i-- // Back up so the main loop sees this line
        break
      }

      // Add the content
      valueLines.push(content)

      // If we just added the END marker, we're done
      if (content.includes('-----END PGP SIGNATURE-----')) {
        break
      }

      i++
    }
  } else {
    // Continue reading lines that start with space (continuation)
    while (i < lines.length) {
      const currentLine = lines[i]
      if (currentLine === undefined || !currentLine.startsWith(' ')) break
      // Remove the leading space from continuation lines
      valueLines.push(currentLine.slice(1))
      i++
    }
    i-- // Back up because main loop will increment
  }

  return [valueLines.join('\n'), i]
}

/**
 * Optimized commit content parser.
 *
 * Uses efficient string scanning and avoids unnecessary allocations.
 * Supports all standard Git commit headers plus extra headers.
 *
 * @param content - Raw commit content string (without Git object header)
 * @returns Parsed GitCommit object
 * @throws Error if required fields are missing
 */
function parseCommitContent(content: string): GitCommit {
  const lines = content.split('\n')
  let tree: string | undefined
  const parents: string[] = []
  let author: GitIdentity | undefined
  let committer: GitIdentity | undefined
  let gpgSignature: string | undefined
  const extraHeaders: CommitExtraHeaders = {}
  let messageStartIdx = -1

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) break

    // Empty line marks start of message
    if (line === '') {
      messageStartIdx = i + 1
      break
    }

    // Find the first space to split header name from value
    const spaceIdx = line.indexOf(' ')
    if (spaceIdx === -1) {
      // Line without space - skip (shouldn't happen in valid commits)
      i++
      continue
    }

    const headerName = line.slice(0, spaceIdx)
    const headerValue = line.slice(spaceIdx + 1)

    // Parse known headers
    switch (headerName) {
      case 'tree':
        tree = headerValue
        break

      case 'parent':
        parents.push(headerValue)
        break

      case 'author':
        author = parseIdentity(line)
        break

      case 'committer':
        committer = parseIdentity(line)
        break

      case 'gpgsig': {
        const [value, lastIdx] = parseMultilineHeader(lines, i, headerValue, 'gpgsig')
        gpgSignature = value
        i = lastIdx
        break
      }

      case 'encoding':
        extraHeaders.encoding = headerValue
        break

      case 'mergetag': {
        const [value, lastIdx] = parseMultilineHeader(lines, i, headerValue)
        extraHeaders.mergetag = value
        i = lastIdx
        break
      }

      default:
        // Unknown header - preserve for round-trip compatibility
        if (MULTILINE_HEADERS.has(headerName)) {
          const [value, lastIdx] = parseMultilineHeader(lines, i, headerValue)
          extraHeaders[headerName] = value
          i = lastIdx
        } else {
          // Single-line unknown header - may appear multiple times
          const existing = extraHeaders[headerName]
          if (existing === undefined) {
            extraHeaders[headerName] = headerValue
          } else if (Array.isArray(existing)) {
            existing.push(headerValue)
          } else {
            extraHeaders[headerName] = [existing, headerValue]
          }
        }
        break
    }

    i++
  }

  // Validate required fields
  if (!tree) {
    throw new Error('Invalid commit: missing tree')
  }
  if (!author) {
    throw new Error('Invalid commit: missing author')
  }
  if (!committer) {
    throw new Error('Invalid commit: missing committer')
  }

  // Extract message - use substring for efficiency with large messages
  const message = messageStartIdx >= 0 ? lines.slice(messageStartIdx).join('\n') : ''

  // Only include extraHeaders if there are any
  const hasExtraHeaders = Object.keys(extraHeaders).length > 0

  return new GitCommit({
    tree,
    parents: parents.length > 0 ? parents : undefined,
    author,
    committer,
    message,
    gpgSignature,
    extraHeaders: hasExtraHeaders ? extraHeaders : undefined,
  } as ExtendedCommitData)
}

// Re-export GitIdentity type
export type { GitIdentity }
