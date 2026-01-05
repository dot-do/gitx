/**
 * Git Smart HTTP Protocol Implementation
 *
 * Implements the Git Smart HTTP protocol for server-side handling of:
 * - Fetch discovery (GET /info/refs?service=git-upload-pack)
 * - Push discovery (GET /info/refs?service=git-receive-pack)
 * - Fetch data transfer (POST /git-upload-pack)
 * - Push data transfer (POST /git-receive-pack)
 *
 * Reference: https://git-scm.com/docs/http-protocol
 */

import { encodePktLine, pktLineStream, FLUSH_PKT } from './pkt-line'

/**
 * Supported Git Smart HTTP services
 */
export type GitService = 'git-upload-pack' | 'git-receive-pack'

/**
 * HTTP methods supported by the Smart HTTP protocol
 */
export type HTTPMethod = 'GET' | 'POST'

/**
 * Represents a Git reference (branch, tag, etc.)
 */
export interface GitRef {
  /** SHA-1 hash of the object this ref points to */
  sha: string
  /** Full ref name (e.g., 'refs/heads/main') */
  name: string
  /** Optional peeled SHA for annotated tags */
  peeled?: string
}

/**
 * Server capabilities advertised during ref discovery
 */
export interface ServerCapabilities {
  /** Server supports multi_ack */
  multiAck?: boolean
  /** Server supports multi_ack_detailed */
  multiAckDetailed?: boolean
  /** Server supports thin-pack */
  thinPack?: boolean
  /** Server supports side-band communication */
  sideBand?: boolean
  /** Server supports side-band-64k communication */
  sideBand64k?: boolean
  /** Server supports ofs-delta */
  ofsDelta?: boolean
  /** Server supports shallow clones */
  shallow?: boolean
  /** Server supports deepen-since */
  deepenSince?: boolean
  /** Server supports deepen-not */
  deepenNot?: boolean
  /** Server supports deepen-relative */
  deepenRelative?: boolean
  /** Server supports no-progress */
  noProgress?: boolean
  /** Server supports include-tag */
  includeTag?: boolean
  /** Server supports report-status */
  reportStatus?: boolean
  /** Server supports report-status-v2 */
  reportStatusV2?: boolean
  /** Server supports delete-refs */
  deleteRefs?: boolean
  /** Server supports quiet mode */
  quiet?: boolean
  /** Server supports atomic pushes */
  atomic?: boolean
  /** Server supports push-options */
  pushOptions?: boolean
  /** Server allows tips with SHA-1 hashes that start with all-zeros */
  allowTipSha1InWant?: boolean
  /** Server allows reachable SHA-1 hashes */
  allowReachableSha1InWant?: boolean
  /** Server's agent string */
  agent?: string
  /** Server supports object-format (sha1/sha256) */
  objectFormat?: string
  /** Server supports filter capability */
  filter?: boolean
}

/**
 * Incoming Smart HTTP request
 */
export interface SmartHTTPRequest {
  /** HTTP method (GET or POST) */
  method: HTTPMethod
  /** Request path (e.g., '/info/refs' or '/git-upload-pack') */
  path: string
  /** Query parameters */
  query: Record<string, string>
  /** HTTP headers */
  headers: Record<string, string>
  /** Request body as Uint8Array (for POST requests) */
  body?: Uint8Array
  /** Repository identifier/name */
  repository: string
}

/**
 * Outgoing Smart HTTP response
 */
export interface SmartHTTPResponse {
  /** HTTP status code */
  status: number
  /** HTTP status text */
  statusText: string
  /** Response headers */
  headers: Record<string, string>
  /** Response body as Uint8Array */
  body: Uint8Array
}

/**
 * Error response with specific HTTP status codes
 */
export interface SmartHTTPError extends Error {
  /** HTTP status code for the error */
  statusCode: number
}

/**
 * Repository interface for Smart HTTP operations
 * This interface defines the methods needed from a repository to support Smart HTTP
 */
export interface RepositoryProvider {
  /** Get all refs in the repository */
  getRefs(): Promise<GitRef[]>
  /** Check if repository exists */
  exists(): Promise<boolean>
  /** Check if client has permission for service */
  hasPermission(service: GitService): Promise<boolean>
  /** Handle upload-pack (fetch) - returns packfile data */
  uploadPack(wants: string[], haves: string[], capabilities: string[]): Promise<Uint8Array>
  /** Handle receive-pack (push) - processes incoming packfile */
  receivePack(packData: Uint8Array, commands: RefUpdateCommand[]): Promise<ReceivePackResult>
}

/**
 * Command to update a reference during push
 */
export interface RefUpdateCommand {
  /** Old SHA (zero hash for create) */
  oldSha: string
  /** New SHA (zero hash for delete) */
  newSha: string
  /** Full ref name */
  refName: string
}

/**
 * Result of receive-pack operation
 */
export interface ReceivePackResult {
  /** Whether the overall operation succeeded */
  success: boolean
  /** Individual ref update results */
  refResults: Array<{
    refName: string
    success: boolean
    error?: string
  }>
}

/**
 * Content-Type for git-upload-pack advertisement
 */
export const CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT =
  'application/x-git-upload-pack-advertisement'

/**
 * Content-Type for git-receive-pack advertisement
 */
export const CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT =
  'application/x-git-receive-pack-advertisement'

/**
 * Content-Type for git-upload-pack request
 */
export const CONTENT_TYPE_UPLOAD_PACK_REQUEST =
  'application/x-git-upload-pack-request'

/**
 * Content-Type for git-upload-pack result
 */
export const CONTENT_TYPE_UPLOAD_PACK_RESULT =
  'application/x-git-upload-pack-result'

/**
 * Content-Type for git-receive-pack request
 */
export const CONTENT_TYPE_RECEIVE_PACK_REQUEST =
  'application/x-git-receive-pack-request'

/**
 * Content-Type for git-receive-pack result
 */
export const CONTENT_TYPE_RECEIVE_PACK_RESULT =
  'application/x-git-receive-pack-result'

/**
 * Zero SHA constant used for ref creation/deletion
 */
export const ZERO_SHA = '0000000000000000000000000000000000000000'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Get HTTP status text from status code
 */
function getStatusText(statusCode: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    415: 'Unsupported Media Type',
    500: 'Internal Server Error',
  }
  return statusTexts[statusCode] || 'Unknown'
}

/**
 * Check if a string is a valid SHA-1 hex string (40 characters)
 */
function isValidSha(sha: string): boolean {
  return /^[0-9a-f]{40}$/i.test(sha)
}

/**
 * Handle GET /info/refs requests for ref discovery.
 *
 * This endpoint is called by git clients to discover refs and capabilities
 * before performing fetch or push operations.
 *
 * @param request - The incoming HTTP request
 * @param repository - Repository provider for fetching refs
 * @param capabilities - Server capabilities to advertise
 * @returns HTTP response with ref advertisement
 * @throws SmartHTTPError for invalid requests or repository errors
 */
export async function handleInfoRefs(
  request: SmartHTTPRequest,
  repository: RepositoryProvider,
  capabilities?: ServerCapabilities
): Promise<SmartHTTPResponse> {
  // Check service parameter
  const service = request.query.service
  if (!service) {
    return createErrorResponse(400, 'Missing service parameter')
  }

  if (service !== 'git-upload-pack' && service !== 'git-receive-pack') {
    return createErrorResponse(400, 'Invalid service parameter')
  }

  // Check if repository exists
  const exists = await repository.exists()
  if (!exists) {
    return createErrorResponse(404, 'Repository not found')
  }

  // Check permission
  const hasPermission = await repository.hasPermission(service as GitService)
  if (!hasPermission) {
    return createErrorResponse(403, 'Permission denied')
  }

  // Get refs
  const refs = await repository.getRefs()

  // Format response
  const body = formatRefAdvertisement(service as GitService, refs, capabilities)

  // Get content type
  const contentType = service === 'git-upload-pack'
    ? CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT
    : CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT

  return {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    body,
  }
}

/**
 * Handle POST /git-upload-pack requests for fetch data transfer.
 *
 * This endpoint receives the client's wants/haves and returns a packfile
 * containing the requested objects.
 *
 * @param request - The incoming HTTP request with wants/haves
 * @param repository - Repository provider for creating packfile
 * @returns HTTP response with packfile data
 * @throws SmartHTTPError for invalid requests or repository errors
 */
export async function handleUploadPack(
  request: SmartHTTPRequest,
  repository: RepositoryProvider
): Promise<SmartHTTPResponse> {
  // Check content type
  const contentType = request.headers['Content-Type']
  if (!validateContentType(contentType, CONTENT_TYPE_UPLOAD_PACK_REQUEST)) {
    return createErrorResponse(415, 'Invalid content type')
  }

  // Check body
  if (!request.body) {
    return createErrorResponse(400, 'Missing request body')
  }

  // Check permission
  const hasPermission = await repository.hasPermission('git-upload-pack')
  if (!hasPermission) {
    return createErrorResponse(403, 'Permission denied')
  }

  // Parse request
  let parsed: { wants: string[]; haves: string[]; capabilities: string[]; done: boolean }
  try {
    parsed = parseUploadPackRequest(request.body)
  } catch (e) {
    return createErrorResponse(400, 'Malformed request')
  }

  // Validate SHA format
  for (const want of parsed.wants) {
    if (!isValidSha(want)) {
      return createErrorResponse(400, 'Invalid SHA format in want')
    }
  }
  for (const have of parsed.haves) {
    if (!isValidSha(have)) {
      return createErrorResponse(400, 'Invalid SHA format in have')
    }
  }

  // Check for side-band capability
  const useSideBand = parsed.capabilities.includes('side-band-64k') || parsed.capabilities.includes('side-band')

  // Get packfile from repository
  const packData = await repository.uploadPack(parsed.wants, parsed.haves, parsed.capabilities)

  // Format response (with ACK if there are haves, NAK otherwise)
  const hasCommonObjects = parsed.haves.length > 0
  const body = formatUploadPackResponse(packData, useSideBand, hasCommonObjects, parsed.haves)

  return {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': CONTENT_TYPE_UPLOAD_PACK_RESULT,
    },
    body,
  }
}

/**
 * Handle POST /git-receive-pack requests for push data transfer.
 *
 * This endpoint receives ref update commands and a packfile from the client,
 * updates refs accordingly, and returns a status report.
 *
 * @param request - The incoming HTTP request with commands and packfile
 * @param repository - Repository provider for processing push
 * @returns HTTP response with status report
 * @throws SmartHTTPError for invalid requests or repository errors
 */
export async function handleReceivePack(
  request: SmartHTTPRequest,
  repository: RepositoryProvider
): Promise<SmartHTTPResponse> {
  // Check content type
  const contentType = request.headers['Content-Type']
  if (!validateContentType(contentType, CONTENT_TYPE_RECEIVE_PACK_REQUEST)) {
    return createErrorResponse(415, 'Invalid content type')
  }

  // Check body
  if (!request.body) {
    return createErrorResponse(400, 'Missing request body')
  }

  // Check permission
  const hasPermission = await repository.hasPermission('git-receive-pack')
  if (!hasPermission) {
    return createErrorResponse(403, 'Permission denied')
  }

  // Parse request
  let parsed: { commands: RefUpdateCommand[]; capabilities: string[]; packfile: Uint8Array }
  try {
    parsed = parseReceivePackRequest(request.body)
  } catch (e) {
    return createErrorResponse(400, 'Malformed request')
  }

  // Validate SHA format in commands
  for (const cmd of parsed.commands) {
    if (!isValidSha(cmd.oldSha) || !isValidSha(cmd.newSha)) {
      return createErrorResponse(400, 'Invalid SHA format in command')
    }
  }

  // Process the push
  const result = await repository.receivePack(parsed.packfile, parsed.commands)

  // Format response
  const body = formatReceivePackResponse(result)

  return {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': CONTENT_TYPE_RECEIVE_PACK_RESULT,
    },
    body,
  }
}

/**
 * Format ref advertisement for info/refs response.
 *
 * Creates pkt-line formatted ref advertisement including:
 * - Service header
 * - Capability advertisement on first ref
 * - All refs with their SHAs
 * - Flush packet
 *
 * @param service - The git service (git-upload-pack or git-receive-pack)
 * @param refs - Array of refs to advertise
 * @param capabilities - Server capabilities to include
 * @returns Formatted ref advertisement as Uint8Array
 */
export function formatRefAdvertisement(
  service: GitService,
  refs: GitRef[],
  capabilities?: ServerCapabilities
): Uint8Array {
  let output = ''

  // Service announcement
  output += encodePktLine(`# service=${service}\n`) as string
  output += FLUSH_PKT

  // Capabilities string
  const capStrings = capabilities ? capabilitiesToStrings(capabilities) : []
  const capLine = capStrings.length > 0 ? capStrings.join(' ') : ''

  if (refs.length === 0) {
    // Empty repo - send capabilities with zero SHA
    if (capLine) {
      output += encodePktLine(`${ZERO_SHA} capabilities^{}\x00${capLine}\n`) as string
    } else {
      output += encodePktLine(`${ZERO_SHA} capabilities^{}\n`) as string
    }
  } else {
    // First ref includes capabilities
    const firstRef = refs[0]
    if (capLine) {
      output += encodePktLine(`${firstRef.sha} ${firstRef.name}\x00${capLine}\n`) as string
    } else {
      output += encodePktLine(`${firstRef.sha} ${firstRef.name}\n`) as string
    }

    // Remaining refs
    for (let i = 1; i < refs.length; i++) {
      const ref = refs[i]
      output += encodePktLine(`${ref.sha} ${ref.name}\n`) as string
    }

    // Add peeled refs for annotated tags
    for (const ref of refs) {
      if (ref.peeled) {
        output += encodePktLine(`${ref.peeled} ${ref.name}^{}\n`) as string
      }
    }
  }

  output += FLUSH_PKT

  return encoder.encode(output)
}

/**
 * Parse upload-pack request body.
 *
 * Extracts wants, haves, and capabilities from the pkt-line formatted
 * request body sent by git fetch.
 *
 * @param body - Request body as Uint8Array
 * @returns Parsed wants, haves, and capabilities
 */
export function parseUploadPackRequest(body: Uint8Array): {
  wants: string[]
  haves: string[]
  capabilities: string[]
  done: boolean
} {
  const text = decoder.decode(body)

  // Check if the input starts with a valid pkt-line format
  // Valid pkt-lines start with 4 hex characters (length) or special packets (0000, 0001)
  if (text.length >= 4) {
    const hexPrefix = text.slice(0, 4)
    const length = parseInt(hexPrefix, 16)
    // If the first 4 chars are not valid hex (NaN) and not a special packet, it's malformed
    if (isNaN(length) && hexPrefix !== '0000' && hexPrefix !== '0001') {
      throw new Error('Malformed pkt-line: invalid length prefix')
    }
  }

  const { packets } = pktLineStream(text)

  const wants: string[] = []
  const haves: string[] = []
  let capabilities: string[] = []
  let done = false
  let firstWant = true

  for (const packet of packets) {
    if (packet.type === 'flush' || packet.type === 'delim') {
      continue
    }
    if (!packet.data) continue

    const line = packet.data.trim()

    if (line === 'done') {
      done = true
      continue
    }

    if (line.startsWith('want ')) {
      const rest = line.slice(5)
      // First want line may contain capabilities after SHA
      const parts = rest.split(' ')
      const sha = parts[0]
      wants.push(sha)

      if (firstWant && parts.length > 1) {
        capabilities = parts.slice(1)
        firstWant = false
      }
    } else if (line.startsWith('have ')) {
      const sha = line.slice(5).trim()
      haves.push(sha)
    } else if (line.startsWith('deepen ') || line.startsWith('deepen-since ') || line.startsWith('filter ')) {
      // Handle shallow/filter commands - just skip them for now
      continue
    }
  }

  return { wants, haves, capabilities, done }
}

/**
 * Parse receive-pack request body.
 *
 * Extracts ref update commands, capabilities, and packfile data from
 * the request body sent by git push.
 *
 * @param body - Request body as Uint8Array
 * @returns Parsed commands, capabilities, and packfile
 */
export function parseReceivePackRequest(body: Uint8Array): {
  commands: RefUpdateCommand[]
  capabilities: string[]
  packfile: Uint8Array
} {
  const text = decoder.decode(body)

  const commands: RefUpdateCommand[] = []
  let capabilities: string[] = []
  let firstCommand = true

  // Parse pkt-lines manually to track byte offset for packfile extraction
  let offset = 0
  let flushOffset = -1

  while (offset < text.length) {
    // Need at least 4 bytes for length prefix
    if (offset + 4 > text.length) {
      throw new Error('Malformed pkt-line: incomplete length prefix')
    }

    const hexLength = text.slice(offset, offset + 4)

    // Check for flush packet
    if (hexLength === FLUSH_PKT) {
      flushOffset = offset + 4
      break
    }

    // Validate hex length
    const length = parseInt(hexLength, 16)
    if (isNaN(length) || length < 4) {
      throw new Error('Malformed pkt-line: invalid length')
    }

    // Check if we have enough data
    if (offset + length > text.length) {
      throw new Error('Malformed pkt-line: incomplete packet')
    }

    // Extract packet data
    let line = text.slice(offset + 4, offset + length)
    offset += length

    // Remove trailing newline
    if (line.endsWith('\n')) {
      line = line.slice(0, -1)
    }

    // First command may have capabilities after NUL byte
    let cmdLine = line
    if (firstCommand && line.includes('\x00')) {
      const nullIndex = line.indexOf('\x00')
      cmdLine = line.slice(0, nullIndex)
      const capPart = line.slice(nullIndex + 1)
      capabilities = capPart.split(' ').filter(c => c.length > 0)
      firstCommand = false
    }

    // Parse command: oldSha newSha refName
    const parts = cmdLine.split(' ')
    if (parts.length >= 3) {
      commands.push({
        oldSha: parts[0],
        newSha: parts[1],
        refName: parts.slice(2).join(' '),
      })
    }
  }

  // Extract packfile data after flush packet
  let packfile = new Uint8Array(0)
  if (flushOffset !== -1 && flushOffset < body.length) {
    packfile = body.slice(flushOffset)
  }

  return { commands, capabilities, packfile }
}

/**
 * Format upload-pack response.
 *
 * Creates the response body for git-upload-pack POST request,
 * including NAK/ACK responses and packfile data with optional sideband.
 *
 * @param packData - The packfile data to send
 * @param useSideBand - Whether to use side-band encoding
 * @param hasCommonObjects - Whether there are common objects (for ACK vs NAK)
 * @param haves - The have SHAs from the client
 * @returns Formatted response as Uint8Array
 */
export function formatUploadPackResponse(
  packData: Uint8Array,
  useSideBand?: boolean,
  hasCommonObjects?: boolean,
  haves?: string[]
): Uint8Array {
  let output = ''

  // Send ACK or NAK
  if (hasCommonObjects && haves && haves.length > 0) {
    // ACK the first have
    output += encodePktLine(`ACK ${haves[0]}\n`) as string
  } else {
    output += encodePktLine('NAK\n') as string
  }

  if (useSideBand) {
    // Side-band format: data on channel 1, progress on channel 2, error on channel 3
    // Each sideband packet: length (4 hex) + channel byte + data
    const channel1 = new Uint8Array(1 + packData.length)
    channel1[0] = 1 // Channel 1 for pack data
    channel1.set(packData, 1)

    // Encode as pkt-line
    const pktLine = encodePktLine(channel1)
    if (typeof pktLine === 'string') {
      output += pktLine
    } else {
      // Binary data - need to handle differently
      const headerBytes = encoder.encode(output)
      const result = new Uint8Array(headerBytes.length + pktLine.length + 4)
      result.set(headerBytes, 0)
      result.set(pktLine, headerBytes.length)
      result.set(encoder.encode(FLUSH_PKT), headerBytes.length + pktLine.length)
      return result
    }
  } else {
    // No side-band - include pack data directly
    // Pack data is binary, so encode it as pkt-line
    const pktLine = encodePktLine(packData)
    if (typeof pktLine === 'string') {
      output += pktLine
    } else {
      const headerBytes = encoder.encode(output)
      const result = new Uint8Array(headerBytes.length + pktLine.length + 4)
      result.set(headerBytes, 0)
      result.set(pktLine, headerBytes.length)
      result.set(encoder.encode(FLUSH_PKT), headerBytes.length + pktLine.length)
      return result
    }
  }

  output += FLUSH_PKT

  return encoder.encode(output)
}

/**
 * Format receive-pack response.
 *
 * Creates the response body for git-receive-pack POST request,
 * including unpack status and ref update results.
 *
 * @param result - Result of the receive-pack operation
 * @returns Formatted response as Uint8Array
 */
export function formatReceivePackResponse(result: ReceivePackResult): Uint8Array {
  let output = ''

  // Unpack status
  if (result.success) {
    output += encodePktLine('unpack ok\n') as string
  } else {
    output += encodePktLine('unpack error\n') as string
  }

  // Ref results
  for (const refResult of result.refResults) {
    if (refResult.success) {
      output += encodePktLine(`ok ${refResult.refName}\n`) as string
    } else {
      const error = refResult.error || 'failed'
      output += encodePktLine(`ng ${refResult.refName} ${error}\n`) as string
    }
  }

  output += FLUSH_PKT

  return encoder.encode(output)
}

/**
 * Convert ServerCapabilities to capability string list.
 *
 * @param capabilities - Server capabilities object
 * @returns Array of capability strings
 */
export function capabilitiesToStrings(capabilities: ServerCapabilities): string[] {
  const result: string[] = []

  if (capabilities.multiAck) result.push('multi_ack')
  if (capabilities.multiAckDetailed) result.push('multi_ack_detailed')
  if (capabilities.thinPack) result.push('thin-pack')
  if (capabilities.sideBand) result.push('side-band')
  if (capabilities.sideBand64k) result.push('side-band-64k')
  if (capabilities.ofsDelta) result.push('ofs-delta')
  if (capabilities.shallow) result.push('shallow')
  if (capabilities.deepenSince) result.push('deepen-since')
  if (capabilities.deepenNot) result.push('deepen-not')
  if (capabilities.deepenRelative) result.push('deepen-relative')
  if (capabilities.noProgress) result.push('no-progress')
  if (capabilities.includeTag) result.push('include-tag')
  if (capabilities.reportStatus) result.push('report-status')
  if (capabilities.reportStatusV2) result.push('report-status-v2')
  if (capabilities.deleteRefs) result.push('delete-refs')
  if (capabilities.quiet) result.push('quiet')
  if (capabilities.atomic) result.push('atomic')
  if (capabilities.pushOptions) result.push('push-options')
  if (capabilities.allowTipSha1InWant) result.push('allow-tip-sha1-in-want')
  if (capabilities.allowReachableSha1InWant) result.push('allow-reachable-sha1-in-want')
  if (capabilities.filter) result.push('filter')
  if (capabilities.agent) result.push(`agent=${capabilities.agent}`)
  if (capabilities.objectFormat) result.push(`object-format=${capabilities.objectFormat}`)

  return result
}

/**
 * Parse capability strings into ServerCapabilities object.
 *
 * @param capStrings - Array of capability strings
 * @returns Parsed capabilities object
 */
export function parseCapabilities(capStrings: string[]): ServerCapabilities {
  const result: ServerCapabilities = {}

  for (const cap of capStrings) {
    if (cap === 'multi_ack') result.multiAck = true
    else if (cap === 'multi_ack_detailed') result.multiAckDetailed = true
    else if (cap === 'thin-pack') result.thinPack = true
    else if (cap === 'side-band') result.sideBand = true
    else if (cap === 'side-band-64k') result.sideBand64k = true
    else if (cap === 'ofs-delta') result.ofsDelta = true
    else if (cap === 'shallow') result.shallow = true
    else if (cap === 'deepen-since') result.deepenSince = true
    else if (cap === 'deepen-not') result.deepenNot = true
    else if (cap === 'deepen-relative') result.deepenRelative = true
    else if (cap === 'no-progress') result.noProgress = true
    else if (cap === 'include-tag') result.includeTag = true
    else if (cap === 'report-status') result.reportStatus = true
    else if (cap === 'report-status-v2') result.reportStatusV2 = true
    else if (cap === 'delete-refs') result.deleteRefs = true
    else if (cap === 'quiet') result.quiet = true
    else if (cap === 'atomic') result.atomic = true
    else if (cap === 'push-options') result.pushOptions = true
    else if (cap === 'allow-tip-sha1-in-want') result.allowTipSha1InWant = true
    else if (cap === 'allow-reachable-sha1-in-want') result.allowReachableSha1InWant = true
    else if (cap === 'filter') result.filter = true
    else if (cap.startsWith('agent=')) result.agent = cap.slice(6)
    else if (cap.startsWith('object-format=')) result.objectFormat = cap.slice(14)
    // Unknown capabilities are ignored
  }

  return result
}

/**
 * Validate Content-Type header for a request.
 *
 * @param contentType - The Content-Type header value
 * @param expectedType - The expected Content-Type
 * @returns true if valid, false otherwise
 */
export function validateContentType(
  contentType: string | undefined,
  expectedType: string
): boolean {
  if (!contentType) {
    return false
  }

  // Normalize: lowercase and strip charset or other parameters
  const normalized = contentType.toLowerCase().split(';')[0].trim()
  const expected = expectedType.toLowerCase()

  return normalized === expected
}

/**
 * Create an error response with appropriate status code and message.
 *
 * @param statusCode - HTTP status code
 * @param message - Error message
 * @returns SmartHTTPResponse with error
 */
export function createErrorResponse(
  statusCode: number,
  message: string
): SmartHTTPResponse {
  return {
    status: statusCode,
    statusText: getStatusText(statusCode),
    headers: {
      'Content-Type': 'text/plain',
    },
    body: encoder.encode(message),
  }
}
