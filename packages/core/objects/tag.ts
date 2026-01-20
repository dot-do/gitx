/**
 * Git Tag Object
 *
 * Represents a Git annotated tag object with full support for:
 * - GPG signatures
 * - Extra headers (encoding, etc.)
 * - Validation
 *
 * Format:
 * object <sha>
 * type <object-type>
 * tag <name>
 * tagger <name> <email> <timestamp> <timezone> (optional)
 * gpgsig -----BEGIN PGP SIGNATURE----- (optional, multi-line)
 * encoding <encoding> (optional)
 *
 * <message>
 *
 * @module core/objects/tag
 */

import { calculateObjectHash, createObjectHeader, parseObjectHeader } from './hash'
import { type GitIdentity, type ObjectType, type TagData, isValidSha, isValidObjectType } from './types'
import { parseIdentity, formatIdentity } from './commit'

// =============================================================================
// Extended Tag Data with Extra Headers
// =============================================================================

/**
 * Extra headers that can appear in a tag object.
 * These are Git-compatible but less commonly used headers.
 */
export interface TagExtraHeaders {
  /**
   * Text encoding for the tag message (e.g., 'UTF-8', 'ISO-8859-1')
   * Used when the message contains non-UTF-8 characters
   */
  encoding?: string

  /**
   * Any other unknown headers preserved for round-trip compatibility
   * Maps header name to value(s)
   */
  [key: string]: string | string[] | undefined
}

/**
 * Extended TagData interface with extra headers support
 */
export interface ExtendedTagData extends TagData {
  /**
   * GPG signature for the tag (separate from message)
   */
  gpgSignature?: string

  /**
   * Extra headers beyond the standard object/type/tag/tagger
   */
  extraHeaders?: TagExtraHeaders
}

// =============================================================================
// Text Encoding Utilities
// =============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// =============================================================================
// Tag Validation
// =============================================================================

/**
 * Result of tag validation
 */
export interface TagValidationResult {
  /** Whether the tag data is valid */
  isValid: boolean
  /** Error message if validation failed */
  error?: string
  /** Warning messages for non-critical issues */
  warnings?: string[]
}

/**
 * Validates a GitIdentity object
 */
function validateIdentity(identity: GitIdentity, field: string): TagValidationResult {
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

  return { isValid: true, warnings: warnings.length > 0 ? warnings : undefined }
}

/**
 * Validates tag data before creation.
 * Returns validation result with error/warning messages.
 *
 * @param data - Tag data to validate
 * @returns Validation result object
 *
 * @example
 * ```typescript
 * const result = validateTagData({
 *   object: 'abc123...',
 *   objectType: 'commit',
 *   name: 'v1.0.0',
 *   tagger: { ... },
 *   message: 'Release v1.0.0'
 * })
 * if (!result.isValid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export function validateTagData(data: TagData | ExtendedTagData): TagValidationResult {
  const warnings: string[] = []

  // Validate object SHA
  if (!data.object) {
    return { isValid: false, error: 'Missing object SHA' }
  }
  if (!isValidSha(data.object)) {
    return { isValid: false, error: `Invalid object SHA: ${data.object}` }
  }

  // Validate object type
  if (!data.objectType) {
    return { isValid: false, error: 'Missing object type' }
  }
  if (!isValidObjectType(data.objectType)) {
    return { isValid: false, error: `Invalid object type: ${data.objectType}` }
  }

  // Validate tag name
  if (!data.name || typeof data.name !== 'string') {
    return { isValid: false, error: 'Tag name is required and must be a string' }
  }

  // Validate name doesn't contain invalid characters
  if (data.name.includes('\0') || data.name.includes('\n')) {
    return { isValid: false, error: 'Tag name cannot contain null or newline characters' }
  }

  // Validate tagger (optional)
  if (data.tagger) {
    const taggerResult = validateIdentity(data.tagger, 'tagger')
    if (!taggerResult.isValid) {
      return taggerResult
    }
    if (taggerResult.warnings) {
      warnings.push(...taggerResult.warnings)
    }
  }

  // Validate message
  if (typeof data.message !== 'string') {
    return { isValid: false, error: 'Tag message must be a string' }
  }

  return { isValid: true, warnings: warnings.length > 0 ? warnings : undefined }
}

// =============================================================================
// GitTag Class
// =============================================================================

/**
 * Multi-line headers that span multiple lines with space continuation
 */
const MULTILINE_HEADERS = new Set(['gpgsig'])

/**
 * Git annotated tag object with support for GPG signatures and extra headers.
 *
 * Provides methods for serialization, deserialization, and inspection
 * of Git tag objects.
 *
 * @example
 * ```typescript
 * // Create a new tag
 * const tag = new GitTag({
 *   object: commitSha,
 *   objectType: 'commit',
 *   name: 'v1.0.0',
 *   tagger: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Release v1.0.0'
 * })
 *
 * // Get the SHA
 * const sha = await tag.hash()
 *
 * // Parse from serialized data
 * const parsed = GitTag.parse(serializedData)
 * ```
 */
export class GitTag {
  readonly type = 'tag' as const
  readonly object: string
  readonly objectType: ObjectType
  readonly name: string
  readonly tagger?: GitIdentity
  readonly message: string
  readonly gpgSignature?: string
  readonly extraHeaders?: TagExtraHeaders

  /**
   * Creates a new GitTag
   * @param data - Tag data including object, objectType, name, tagger, message
   * @throws Error if validation fails
   */
  constructor(data: TagData | ExtendedTagData) {
    // Validate using the validation function
    const validation = validateTagData(data)
    if (!validation.isValid) {
      throw new Error(validation.error)
    }

    this.object = data.object
    this.objectType = data.objectType
    this.name = data.name
    this.tagger = data.tagger ? Object.freeze({ ...data.tagger }) : undefined
    this.message = data.message

    // Store GPG signature and extra headers if provided
    if ('gpgSignature' in data && data.gpgSignature) {
      this.gpgSignature = data.gpgSignature
    }
    if ('extraHeaders' in data && data.extraHeaders) {
      this.extraHeaders = Object.freeze({ ...data.extraHeaders })
    }
  }

  /**
   * Creates a GitTag from raw tag content (without header)
   */
  static fromContent(content: string): GitTag {
    return parseTagContent(content)
  }

  /**
   * Parses a GitTag from serialized Git object format
   * @param data - The serialized data including header
   * @throws Error if the header is invalid or type is not tag
   */
  static parse(data: Uint8Array): GitTag {
    const { type, size, headerLength } = parseObjectHeader(data)

    if (type !== 'tag') {
      throw new Error(`Invalid tag header: expected 'tag', got '${type}'`)
    }

    const content = data.slice(headerLength)

    // Validate size matches actual content length
    if (content.length !== size) {
      throw new Error(`Size mismatch: header says ${size} bytes, but content is ${content.length} bytes`)
    }

    const contentStr = decoder.decode(content)
    return parseTagContent(contentStr)
  }

  /**
   * Checks if this tag has a GPG signature.
   * Signatures can be in the gpgsig header or embedded in the message.
   */
  hasSignature(): boolean {
    // Check for gpgsig header first
    if (this.gpgSignature !== undefined && this.gpgSignature !== '') {
      return true
    }
    // Also check message for embedded signatures (legacy format)
    return this.message.includes('-----BEGIN PGP SIGNATURE-----')
  }

  /**
   * Gets the GPG signature if present
   */
  getSignature(): string | undefined {
    return this.gpgSignature
  }

  /**
   * Gets extra headers (encoding, etc.) if present
   */
  getExtraHeaders(): TagExtraHeaders | undefined {
    return this.extraHeaders
  }

  /**
   * Gets the subject line (first line) of the tag message
   */
  getSubject(): string {
    const newlineIdx = this.message.indexOf('\n')
    if (newlineIdx === -1) {
      return this.message
    }
    return this.message.slice(0, newlineIdx)
  }

  /**
   * Gets the body of the tag message (after subject and blank line)
   */
  getBody(): string {
    const newlineIdx = this.message.indexOf('\n\n')
    if (newlineIdx === -1) {
      return ''
    }
    return this.message.slice(newlineIdx + 2)
  }

  /**
   * Serializes the tag to Git object format
   */
  serialize(): Uint8Array {
    const content = this.serializeContent()
    const contentBytes = encoder.encode(content)
    const header = createObjectHeader('tag', contentBytes.length)
    const result = new Uint8Array(header.length + contentBytes.length)
    result.set(header)
    result.set(contentBytes, header.length)
    return result
  }

  /**
   * Serializes just the tag content (without header)
   */
  private serializeContent(): string {
    const lines: string[] = []

    // Object line
    lines.push(`object ${this.object}`)

    // Type line
    lines.push(`type ${this.objectType}`)

    // Tag name line
    lines.push(`tag ${this.name}`)

    // Tagger line (optional)
    if (this.tagger) {
      lines.push(formatIdentity('tagger', this.tagger))
    }

    // Extra headers (encoding, etc.)
    if (this.extraHeaders) {
      // Encoding header
      if (this.extraHeaders.encoding) {
        lines.push(`encoding ${this.extraHeaders.encoding}`)
      }

      // Other unknown headers (preserved for round-trip compatibility)
      for (const [key, value] of Object.entries(this.extraHeaders)) {
        if (key === 'encoding') continue
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
   * Calculates the SHA-1 hash of this tag object
   * @returns Promise resolving to 40-character hex string
   */
  async hash(): Promise<string> {
    const content = this.serializeContent()
    const contentBytes = encoder.encode(content)
    return calculateObjectHash('tag', contentBytes)
  }
}

// =============================================================================
// Tag Content Parser
// =============================================================================

/**
 * Parses a multi-line header value (like gpgsig).
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
      // Remove leading space from continuation lines
      const lineContent = line.startsWith(' ') ? line.slice(1) : line

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
      valueLines.push(lineContent)

      // If we just added the END marker, we're done
      if (lineContent.includes('-----END PGP SIGNATURE-----')) {
        break
      }

      i++
    }
  } else {
    // Continue reading lines that start with space (continuation)
    while (i < lines.length && lines[i].startsWith(' ')) {
      // Remove the leading space from continuation lines
      valueLines.push(lines[i].slice(1))
      i++
    }
    i-- // Back up because main loop will increment
  }

  return [valueLines.join('\n'), i]
}

/**
 * Optimized tag content parser.
 *
 * Uses efficient string scanning and avoids unnecessary allocations.
 * Supports all standard Git tag headers plus extra headers and GPG signatures.
 *
 * @param content - Raw tag content string (without Git object header)
 * @returns Parsed GitTag object
 * @throws Error if required fields are missing
 */
function parseTagContent(content: string): GitTag {
  const lines = content.split('\n')
  let object: string | undefined
  let objectType: ObjectType | undefined
  let name: string | undefined
  let tagger: GitIdentity | undefined
  let gpgSignature: string | undefined
  const extraHeaders: TagExtraHeaders = {}
  let messageStartIdx = -1

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Empty line marks start of message
    if (line === '') {
      messageStartIdx = i + 1
      break
    }

    // Find the first space to split header name from value
    const spaceIdx = line.indexOf(' ')
    if (spaceIdx === -1) {
      // Line without space - skip (shouldn't happen in valid tags)
      i++
      continue
    }

    const headerName = line.slice(0, spaceIdx)
    const headerValue = line.slice(spaceIdx + 1)

    // Parse known headers
    switch (headerName) {
      case 'object':
        object = headerValue
        break

      case 'type': {
        const typeStr = headerValue
        if (isValidObjectType(typeStr)) {
          objectType = typeStr
        }
        break
      }

      case 'tag':
        name = headerValue
        break

      case 'tagger':
        tagger = parseIdentity(line)
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
  if (!object) {
    throw new Error('Invalid tag: missing object')
  }
  if (!objectType) {
    throw new Error('Invalid tag: missing type')
  }
  if (!name) {
    throw new Error('Invalid tag: missing tag name')
  }

  // Extract message
  const message = messageStartIdx >= 0 ? lines.slice(messageStartIdx).join('\n') : ''

  // Only include extraHeaders if there are any
  const hasExtraHeaders = Object.keys(extraHeaders).length > 0

  return new GitTag({
    object,
    objectType,
    name,
    tagger,
    message,
    gpgSignature,
    extraHeaders: hasExtraHeaders ? extraHeaders : undefined,
  } as ExtendedTagData)
}
