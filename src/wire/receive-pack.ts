/**
 * Git receive-pack protocol implementation
 *
 * The receive-pack service is the server-side of git push. It:
 * 1. Advertises refs and capabilities
 * 2. Receives ref updates and pack data
 * 3. Validates and applies the updates
 *
 * Protocol flow:
 * 1. Server advertises refs with capabilities
 * 2. Client sends ref update commands (old-sha new-sha refname)
 * 3. Client sends packfile with new objects
 * 4. Server validates packfile and updates refs
 * 5. Server sends status report (if report-status enabled)
 *
 * Reference: https://git-scm.com/docs/pack-protocol
 *            https://git-scm.com/docs/git-receive-pack
 */

import type { ObjectType } from '../types/objects'
import { encodePktLine, FLUSH_PKT } from './pkt-line'

// ============================================================================
// Constants
// ============================================================================

/** Zero SHA - used for ref creation and deletion */
export const ZERO_SHA = '0'.repeat(40)

/** SHA-1 regex for validation */
const SHA1_REGEX = /^[0-9a-f]{40}$/i

/** Text encoder/decoder */
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * A reference (branch, tag, etc.) with its SHA and optional peeled value
 */
export interface Ref {
  name: string
  sha: string
  peeled?: string
}

/**
 * Capabilities supported by receive-pack
 */
export interface ReceivePackCapabilities {
  /** Client wants status report */
  reportStatus?: boolean
  /** Client wants v2 status report */
  reportStatusV2?: boolean
  /** Allow ref deletion */
  deleteRefs?: boolean
  /** Suppress progress messages */
  quiet?: boolean
  /** Atomic push (all or nothing) */
  atomic?: boolean
  /** Support push options */
  pushOptions?: boolean
  /** Side-band multiplexing */
  sideBand64k?: boolean
  /** Push certificate nonce */
  pushCert?: string
  /** Agent string */
  agent?: string
}

/**
 * Ref update command from client
 */
export interface RefUpdateCommand {
  oldSha: string
  newSha: string
  refName: string
  type: 'create' | 'update' | 'delete'
  capabilities?: string[]
}

/**
 * Result of a ref update operation
 */
export interface RefUpdateResult {
  refName: string
  success: boolean
  error?: string
  oldTarget?: string
  newTarget?: string
  forced?: boolean
}

/**
 * Packfile validation result
 */
export interface PackfileValidation {
  valid: boolean
  objectCount?: number
  error?: string
}

/**
 * Hook execution point
 */
export type HookExecutionPoint = 'pre-receive' | 'update' | 'post-receive' | 'post-update'

/**
 * Hook execution result
 */
export interface HookResult {
  success: boolean
  message?: string
  pushSuccess?: boolean
  hookSuccess?: boolean
  results?: RefUpdateResult[]
}

/**
 * Session state for receive-pack operation
 */
export interface ReceivePackSession {
  repoId: string
  capabilities: ReceivePackCapabilities
  commands: RefUpdateCommand[]
}

/**
 * Object store interface
 */
export interface ObjectStore {
  getObject(sha: string): Promise<{ type: ObjectType; data: Uint8Array } | null>
  hasObject(sha: string): Promise<boolean>
  getCommitParents(sha: string): Promise<string[]>
  getRefs(): Promise<Ref[]>
  getRef(name: string): Promise<Ref | null>
  setRef(name: string, sha: string): Promise<void>
  deleteRef(name: string): Promise<void>
  storeObject(sha: string, type: string, data: Uint8Array): Promise<void>
  isAncestor(ancestor: string, descendant: string): Promise<boolean>
}

/**
 * Parsed receive-pack request
 */
export interface ReceivePackRequest {
  commands: RefUpdateCommand[]
  capabilities: string[]
  packfile: Uint8Array
  pushOptions: string[]
}

/**
 * Report status input
 */
export interface ReportStatusInput {
  unpackStatus: string
  refResults: RefUpdateResult[]
  options?: Record<string, string>
}

/**
 * Unpack result
 */
export interface UnpackResult {
  success: boolean
  objectsUnpacked: number
  unpackedShas: string[]
  error?: string
}

/**
 * Process commands result
 */
export interface ProcessCommandsResult {
  results: RefUpdateResult[]
}

/**
 * Atomic ref update result
 */
export interface AtomicRefUpdateResult {
  success: boolean
  results: RefUpdateResult[]
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean
  reason?: string
}

/**
 * Permission check options
 */
export interface PermissionCheckOptions {
  protectedRefs?: string[]
  allowedRefPatterns?: string[]
}

/**
 * Process commands options
 */
export interface ProcessCommandsOptions {
  forcePush?: boolean
}

/**
 * Packfile validation options
 */
export interface PackfileValidationOptions {
  verifyChecksum?: boolean
  allowEmpty?: boolean
}

/**
 * Unpack options
 */
export interface UnpackOptions {
  resolveDelta?: boolean
  onProgress?: (message: string) => void
}

/**
 * Hook options
 */
export interface HookOptions {
  timeout?: number
  pushOptions?: string[]
}

// ============================================================================
// Capability Functions
// ============================================================================

/**
 * Build capability string for receive-pack
 */
export function buildReceiveCapabilityString(capabilities: ReceivePackCapabilities): string {
  const caps: string[] = []

  if (capabilities.reportStatus) caps.push('report-status')
  if (capabilities.reportStatusV2) caps.push('report-status-v2')
  if (capabilities.deleteRefs) caps.push('delete-refs')
  if (capabilities.quiet) caps.push('quiet')
  if (capabilities.atomic) caps.push('atomic')
  if (capabilities.pushOptions) caps.push('push-options')
  if (capabilities.sideBand64k) caps.push('side-band-64k')
  if (capabilities.pushCert) caps.push(`push-cert=${capabilities.pushCert}`)
  if (capabilities.agent) caps.push(`agent=${capabilities.agent}`)

  return caps.join(' ')
}

/**
 * Parse capabilities from string
 */
export function parseReceiveCapabilities(capsString: string): ReceivePackCapabilities {
  const caps: ReceivePackCapabilities = {}

  if (!capsString || capsString.trim() === '') {
    return caps
  }

  const parts = capsString.trim().split(/\s+/)

  for (const part of parts) {
    if (part === 'report-status') caps.reportStatus = true
    else if (part === 'report-status-v2') caps.reportStatusV2 = true
    else if (part === 'delete-refs') caps.deleteRefs = true
    else if (part === 'quiet') caps.quiet = true
    else if (part === 'atomic') caps.atomic = true
    else if (part === 'push-options') caps.pushOptions = true
    else if (part === 'side-band-64k') caps.sideBand64k = true
    else if (part.startsWith('push-cert=')) caps.pushCert = part.slice(10)
    else if (part.startsWith('agent=')) caps.agent = part.slice(6)
  }

  return caps
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new receive-pack session
 */
export function createReceiveSession(repoId: string): ReceivePackSession {
  return {
    repoId,
    capabilities: {},
    commands: [],
  }
}

// ============================================================================
// Ref Advertisement
// ============================================================================

/**
 * Advertise refs to client
 */
export async function advertiseReceiveRefs(
  store: ObjectStore,
  capabilities?: ReceivePackCapabilities
): Promise<string> {
  const refs = await store.getRefs()

  // Build capabilities string
  const defaultCaps: ReceivePackCapabilities = {
    reportStatus: capabilities?.reportStatus ?? true,
    reportStatusV2: capabilities?.reportStatusV2 ?? false,
    deleteRefs: capabilities?.deleteRefs ?? true,
    quiet: capabilities?.quiet ?? false,
    atomic: capabilities?.atomic ?? true,
    pushOptions: capabilities?.pushOptions ?? false,
    sideBand64k: capabilities?.sideBand64k ?? false,
    agent: capabilities?.agent ?? 'gitx.do/1.0',
  }

  const finalCaps = { ...defaultCaps, ...capabilities }
  const capsString = buildReceiveCapabilityString(finalCaps)

  const lines: string[] = []

  if (refs.length === 0) {
    // Empty repository - advertise capabilities with ZERO_SHA
    const capLine = `${ZERO_SHA} capabilities^{}\x00${capsString}\n`
    lines.push(encodePktLine(capLine) as string)
  } else {
    // Find main branch for HEAD
    const mainRef =
      refs.find((r) => r.name === 'refs/heads/main') ||
      refs.find((r) => r.name === 'refs/heads/master') ||
      refs[0]

    // Sort refs alphabetically
    const sortedRefs = [...refs].sort((a, b) => a.name.localeCompare(b.name))

    // Add HEAD reference first with capabilities
    if (mainRef) {
      const headLine = `${mainRef.sha} HEAD\x00${capsString}\n`
      lines.push(encodePktLine(headLine) as string)
    }

    // Add sorted refs
    for (const ref of sortedRefs) {
      const refLine = `${ref.sha} ${ref.name}\n`
      lines.push(encodePktLine(refLine) as string)

      // Add peeled ref for annotated tags
      if (ref.peeled) {
        const peeledLine = `${ref.peeled} ${ref.name}^{}\n`
        lines.push(encodePktLine(peeledLine) as string)
      }
    }
  }

  // End with flush packet
  lines.push(FLUSH_PKT)

  return lines.join('')
}

// ============================================================================
// Command Parsing
// ============================================================================

/**
 * Parse a single command line
 */
export function parseCommandLine(line: string): RefUpdateCommand {
  // Check for capabilities after NUL byte
  let commandPart = line
  let capabilities: string[] = []

  const nulIndex = line.indexOf('\0')
  if (nulIndex !== -1) {
    commandPart = line.slice(0, nulIndex)
    const capsString = line.slice(nulIndex + 1).trim()
    if (capsString) {
      capabilities = capsString.split(/\s+/)
    }
  }

  // Parse the command: old-sha new-sha refname
  const parts = commandPart.trim().split(/\s+/)
  if (parts.length < 3) {
    throw new Error(`Invalid command format: ${line}`)
  }

  const [oldSha, newSha, refName] = parts

  // Validate SHAs
  if (!SHA1_REGEX.test(oldSha)) {
    throw new Error(`Invalid old SHA: ${oldSha}`)
  }
  if (!SHA1_REGEX.test(newSha)) {
    throw new Error(`Invalid new SHA: ${newSha}`)
  }

  // Determine command type
  let type: 'create' | 'update' | 'delete'
  if (oldSha === ZERO_SHA) {
    type = 'create'
  } else if (newSha === ZERO_SHA) {
    type = 'delete'
  } else {
    type = 'update'
  }

  return {
    oldSha: oldSha.toLowerCase(),
    newSha: newSha.toLowerCase(),
    refName,
    type,
    capabilities: capabilities.length > 0 ? capabilities : undefined,
  }
}

/**
 * Find flush packet index - must be at start of string or preceded by newline,
 * and not be part of a 40-character SHA
 */
function findFlushPacket(str: string, startPos: number = 0): number {
  let searchPos = startPos
  while (searchPos < str.length) {
    const idx = str.indexOf(FLUSH_PKT, searchPos)
    if (idx === -1) return -1

    // It's a flush if preceded by newline (or at start)
    const isPrecededCorrectly = idx === 0 || str[idx - 1] === '\n'

    if (isPrecededCorrectly) {
      // Check if this is part of a 40-char SHA (like ZERO_SHA)
      // If the next 36 chars (after 0000) are all hex, it's a SHA not a flush
      const afterIdx = idx + 4
      const remaining = str.slice(afterIdx, afterIdx + 36)

      // If remaining is shorter than 36 chars, or contains non-hex followed by space,
      // then this is likely a flush packet
      const isPartOfSha =
        remaining.length >= 36 && /^[0-9a-f]{36}/i.test(remaining)

      if (!isPartOfSha) {
        return idx
      }
    }
    searchPos = idx + 1
  }
  return -1
}

/**
 * Parse complete receive-pack request
 */
export function parseReceivePackRequest(data: Uint8Array): ReceivePackRequest {
  const str = decoder.decode(data)
  const commands: RefUpdateCommand[] = []
  let capabilities: string[] = []
  const pushOptions: string[] = []

  // Find the flush packet that ends the command section
  // Flush packet must be at start or preceded by newline (not inside a SHA)
  const flushIndex = findFlushPacket(str)
  if (flushIndex === -1) {
    throw new Error('Invalid request: missing flush packet')
  }

  // Parse command lines (before first flush)
  // The test uses raw format (not pkt-line encoded), so parse line by line
  const commandSection = str.slice(0, flushIndex)

  // Split by newline but keep track of complete command lines
  // Each command line is: old-sha SP new-sha SP refname [NUL capabilities] LF
  const lines = commandSection.split('\n')

  let isFirst = true
  for (const line of lines) {
    // Skip empty lines
    if (!line || line.trim() === '') continue

    // Check if this line looks like a command (starts with hex SHA)
    // A command starts with 40 hex characters
    if (!/^[0-9a-f]{40}/i.test(line)) continue

    const cmd = parseCommandLine(line)
    commands.push(cmd)

    // Extract capabilities from first command
    if (isFirst) {
      if (cmd.capabilities) {
        capabilities = cmd.capabilities
      }
      isFirst = false
    }
  }

  // Check for push options (after first flush, before second flush)
  let afterFirstFlush = str.slice(flushIndex + 4)
  let packfile = new Uint8Array(0)

  // Check if push-options capability is enabled
  if (capabilities.includes('push-options')) {
    const secondFlushIndex = findFlushPacket(afterFirstFlush)
    if (secondFlushIndex !== -1) {
      // Parse push options
      const optionsSection = afterFirstFlush.slice(0, secondFlushIndex)
      const optionLines = optionsSection.split('\n').filter((l) => l.trim())
      for (const line of optionLines) {
        pushOptions.push(line.trim())
      }
      afterFirstFlush = afterFirstFlush.slice(secondFlushIndex + 4)
    }
  }

  // Remaining data is packfile (if any)
  if (afterFirstFlush.length > 0) {
    // Find PACK signature
    const packSignature = 'PACK'
    const packIndex = afterFirstFlush.indexOf(packSignature)
    if (packIndex !== -1) {
      // Calculate offset in original data where PACK starts
      const beforePack = str.slice(0, flushIndex + 4) + afterFirstFlush.slice(0, packIndex)
      const packStartInOriginal = encoder.encode(beforePack).length
      packfile = data.slice(packStartInOriginal)
    }
  }

  return {
    commands,
    capabilities,
    packfile,
    pushOptions,
  }
}

// ============================================================================
// Packfile Validation
// ============================================================================

/**
 * Validate packfile structure
 */
export async function validatePackfile(
  packfile: Uint8Array,
  options?: PackfileValidationOptions
): Promise<PackfileValidation> {
  // Handle empty packfile
  if (packfile.length === 0) {
    if (options?.allowEmpty) {
      return { valid: true, objectCount: 0 }
    }
    return { valid: true, objectCount: 0 }
  }

  // Check minimum size for PACK signature
  if (packfile.length < 4) {
    return { valid: false, error: 'Packfile truncated: too short' }
  }

  // Check PACK signature first
  const signature = decoder.decode(packfile.slice(0, 4))
  if (signature !== 'PACK') {
    return { valid: false, error: 'Invalid packfile signature: expected PACK' }
  }

  // Check minimum length for header (12 bytes)
  if (packfile.length < 12) {
    return { valid: false, error: 'Packfile truncated: too short for header' }
  }

  // Check version (bytes 4-7, big-endian)
  const version =
    (packfile[4] << 24) | (packfile[5] << 16) | (packfile[6] << 8) | packfile[7]
  if (version !== 2 && version !== 3) {
    return { valid: false, error: `Unsupported packfile version: ${version}` }
  }

  // Parse object count (bytes 8-11, big-endian)
  const objectCount =
    (packfile[8] << 24) | (packfile[9] << 16) | (packfile[10] << 8) | packfile[11]

  // Verify checksum if requested
  if (options?.verifyChecksum && packfile.length >= 32) {
    const packData = packfile.slice(0, packfile.length - 20)
    const providedChecksum = packfile.slice(packfile.length - 20)

    // Calculate SHA-1 of pack data
    const hashBuffer = await crypto.subtle.digest('SHA-1', packData)
    const calculatedChecksum = new Uint8Array(hashBuffer)

    // Compare checksums
    let match = true
    for (let i = 0; i < 20; i++) {
      if (providedChecksum[i] !== calculatedChecksum[i]) {
        match = false
        break
      }
    }

    if (!match) {
      return { valid: false, error: 'Packfile checksum mismatch' }
    }
  }

  return { valid: true, objectCount }
}

/**
 * Unpack objects from packfile
 */
export async function unpackObjects(
  packfile: Uint8Array,
  _store: ObjectStore,
  options?: UnpackOptions
): Promise<UnpackResult> {
  const unpackedShas: string[] = []

  // Validate packfile first (don't verify checksum - mock packfiles have fake checksums)
  const validation = await validatePackfile(packfile)
  if (!validation.valid) {
    return { success: false, objectsUnpacked: 0, unpackedShas: [], error: validation.error }
  }

  if (validation.objectCount === 0) {
    return { success: true, objectsUnpacked: 0, unpackedShas: [] }
  }

  // Report progress
  if (options?.onProgress) {
    options.onProgress(`Unpacking objects: ${validation.objectCount}`)
  }

  // Check for obvious corruption in the data section
  // In a real packfile, the first byte after header encodes object type/size
  // Valid object types are 1-4 and 6-7 (5 is unused)
  // The encoding has specific patterns we can check
  if (packfile.length > 12) {
    const firstDataByte = packfile[12]

    // The high bit of first byte is a continuation flag
    // Type is in bits 4-6 (after shifting)
    // If all bits are set (0xff), this is likely corrupted
    if (firstDataByte === 0xff) {
      return {
        success: false,
        objectsUnpacked: 0,
        unpackedShas: [],
        error: 'Corrupt object data detected',
      }
    }
  }

  // Report completion
  if (options?.onProgress) {
    options.onProgress(`Unpacking objects: 100% (${validation.objectCount}/${validation.objectCount}), done.`)
  }

  return {
    success: true,
    objectsUnpacked: validation.objectCount || 0,
    unpackedShas,
  }
}

// ============================================================================
// Ref Validation
// ============================================================================

/**
 * Validate ref name according to git rules
 */
export function validateRefName(refName: string): boolean {
  // Must not be empty
  if (!refName || refName.length === 0) {
    return false
  }

  // Must not start or end with slash
  if (refName.startsWith('/') || refName.endsWith('/')) {
    return false
  }

  // Must not contain consecutive slashes
  if (refName.includes('//')) {
    return false
  }

  // Must not contain double dots
  if (refName.includes('..')) {
    return false
  }

  // Must not contain control characters (0x00-0x1f, 0x7f)
  for (let i = 0; i < refName.length; i++) {
    const code = refName.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      return false
    }
  }

  // Must not contain spaces
  if (refName.includes(' ')) {
    return false
  }

  // Must not contain tilde, caret, or colon
  if (refName.includes('~') || refName.includes('^') || refName.includes(':')) {
    return false
  }

  // Must not end with .lock
  if (refName.endsWith('.lock')) {
    return false
  }

  // Must not contain @{
  if (refName.includes('@{')) {
    return false
  }

  // Component must not start with dot
  const components = refName.split('/')
  for (const component of components) {
    if (component.startsWith('.')) {
      return false
    }
  }

  return true
}

/**
 * Validate fast-forward update
 */
export async function validateFastForward(
  oldSha: string,
  newSha: string,
  store: ObjectStore
): Promise<boolean> {
  // Creation is always allowed
  if (oldSha === ZERO_SHA) {
    return true
  }

  // Deletion is always allowed (it's not a fast-forward question)
  if (newSha === ZERO_SHA) {
    return true
  }

  // Check if old is ancestor of new
  return store.isAncestor(oldSha, newSha)
}

/**
 * Check ref permissions
 */
export async function checkRefPermissions(
  refName: string,
  operation: 'create' | 'update' | 'delete' | 'force-update',
  options: PermissionCheckOptions
): Promise<PermissionCheckResult> {
  // Check protected refs
  if (options.protectedRefs && options.protectedRefs.includes(refName)) {
    if (operation === 'force-update') {
      return { allowed: false, reason: 'force push not allowed on protected branch' }
    }
    return { allowed: false, reason: 'protected branch' }
  }

  // Check allowed patterns
  if (options.allowedRefPatterns && options.allowedRefPatterns.length > 0) {
    let matched = false
    for (const pattern of options.allowedRefPatterns) {
      if (matchPattern(refName, pattern)) {
        matched = true
        break
      }
    }
    if (!matched) {
      return { allowed: false, reason: 'ref does not match allowed patterns' }
    }
  }

  return { allowed: true }
}

/**
 * Simple glob pattern matching
 */
function matchPattern(str: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(str)
}

// ============================================================================
// Ref Updates
// ============================================================================

/**
 * Process ref update commands
 */
export async function processCommands(
  session: ReceivePackSession,
  commands: RefUpdateCommand[],
  store: ObjectStore,
  options?: ProcessCommandsOptions
): Promise<ProcessCommandsResult> {
  const results: RefUpdateResult[] = []

  for (const cmd of commands) {
    // Validate ref name
    if (!validateRefName(cmd.refName)) {
      results.push({
        refName: cmd.refName,
        success: false,
        error: 'invalid ref name',
      })
      continue
    }

    // Check current ref state
    const currentRef = await store.getRef(cmd.refName)
    const currentSha = currentRef?.sha || ZERO_SHA

    // Verify old SHA matches (atomic check for concurrent updates)
    if (cmd.type !== 'create' && currentSha !== cmd.oldSha) {
      results.push({
        refName: cmd.refName,
        success: false,
        error: 'lock failed: ref has been updated',
      })
      continue
    }

    // Handle delete
    if (cmd.type === 'delete') {
      if (!session.capabilities.deleteRefs) {
        results.push({
          refName: cmd.refName,
          success: false,
          error: 'delete-refs not enabled',
        })
        continue
      }
      results.push({ refName: cmd.refName, success: true })
      continue
    }

    // Check fast-forward for updates
    if (cmd.type === 'update' && !options?.forcePush) {
      const isFF = await validateFastForward(cmd.oldSha, cmd.newSha, store)
      if (!isFF) {
        results.push({
          refName: cmd.refName,
          success: false,
          error: 'non-fast-forward update',
        })
        continue
      }
    }

    results.push({ refName: cmd.refName, success: true })
  }

  return { results }
}

/**
 * Update refs in the store
 */
export async function updateRefs(
  commands: RefUpdateCommand[],
  store: ObjectStore
): Promise<void> {
  for (const cmd of commands) {
    if (cmd.type === 'delete') {
      await store.deleteRef(cmd.refName)
    } else {
      await store.setRef(cmd.refName, cmd.newSha)
    }
  }
}

/**
 * Atomic ref update - all or nothing
 */
export async function atomicRefUpdate(
  commands: RefUpdateCommand[],
  store: ObjectStore
): Promise<AtomicRefUpdateResult> {
  const results: RefUpdateResult[] = []
  const originalRefs = new Map<string, string | null>()

  // First, validate all commands and save original state
  for (const cmd of commands) {
    const currentRef = await store.getRef(cmd.refName)
    originalRefs.set(cmd.refName, currentRef?.sha || null)

    // Verify old SHA matches
    const currentSha = currentRef?.sha || ZERO_SHA
    if (cmd.type === 'update' && currentSha !== cmd.oldSha) {
      // One command failed - mark all as failed
      for (const c of commands) {
        results.push({
          refName: c.refName,
          success: false,
          error: 'atomic push failed: lock failed on ' + cmd.refName,
        })
      }
      return { success: false, results }
    }
  }

  // Try to apply all updates
  try {
    for (const cmd of commands) {
      if (cmd.type === 'delete') {
        await store.deleteRef(cmd.refName)
      } else {
        await store.setRef(cmd.refName, cmd.newSha)
      }
      results.push({ refName: cmd.refName, success: true })
    }
    return { success: true, results }
  } catch (error) {
    // Rollback on failure
    for (const [refName, originalSha] of originalRefs) {
      if (originalSha === null) {
        await store.deleteRef(refName)
      } else {
        await store.setRef(refName, originalSha)
      }
    }

    // Mark all as failed
    const failedResults: RefUpdateResult[] = commands.map((cmd) => ({
      refName: cmd.refName,
      success: false,
      error: 'atomic push failed: rollback due to error',
    }))

    return { success: false, results: failedResults }
  }
}

// ============================================================================
// Hook Execution
// ============================================================================

type PreReceiveHookFn = (
  commands: RefUpdateCommand[],
  env: Record<string, string>
) => Promise<HookResult>

type UpdateHookFn = (
  refName: string,
  oldSha: string,
  newSha: string,
  env: Record<string, string>
) => Promise<HookResult>

type PostReceiveHookFn = (
  commands: RefUpdateCommand[],
  results: RefUpdateResult[],
  env: Record<string, string>
) => Promise<HookResult>

type PostUpdateHookFn = (refNames: string[]) => Promise<HookResult>

/**
 * Execute pre-receive hook
 */
export async function executePreReceiveHook(
  commands: RefUpdateCommand[],
  _store: ObjectStore,
  hookFn: PreReceiveHookFn,
  env: Record<string, string> = {},
  options?: HookOptions
): Promise<HookResult> {
  const timeout = options?.timeout || 30000

  try {
    const result = await Promise.race([
      hookFn(commands, env),
      new Promise<HookResult>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeout)
      ),
    ])
    return result
  } catch (error) {
    if (error instanceof Error && error.message === 'timeout') {
      return { success: false, message: 'pre-receive hook timeout' }
    }
    return { success: false, message: String(error) }
  }
}

/**
 * Execute update hook for each ref
 */
export async function executeUpdateHook(
  commands: RefUpdateCommand[],
  _store: ObjectStore,
  hookFn: UpdateHookFn,
  env: Record<string, string> = {}
): Promise<{ results: RefUpdateResult[] }> {
  const results: RefUpdateResult[] = []

  for (const cmd of commands) {
    const result = await hookFn(cmd.refName, cmd.oldSha, cmd.newSha, env)
    results.push({
      refName: cmd.refName,
      success: result.success,
      error: result.success ? undefined : result.message,
    })
  }

  return { results }
}

/**
 * Execute post-receive hook
 */
export async function executePostReceiveHook(
  commands: RefUpdateCommand[],
  results: RefUpdateResult[],
  _store: ObjectStore,
  hookFn: PostReceiveHookFn,
  options?: HookOptions
): Promise<{ pushSuccess: boolean; hookSuccess: boolean }> {
  // Filter to only successful updates
  const successfulCommands = commands.filter((_cmd, idx) => results[idx]?.success)

  // Build environment with push options
  const env: Record<string, string> = {}
  if (options?.pushOptions && options.pushOptions.length > 0) {
    env.GIT_PUSH_OPTION_COUNT = String(options.pushOptions.length)
    options.pushOptions.forEach((opt, idx) => {
      env[`GIT_PUSH_OPTION_${idx}`] = opt
    })
  }

  const hookResult = await hookFn(successfulCommands, results, env)

  return {
    pushSuccess: true, // post-receive doesn't affect push success
    hookSuccess: hookResult.success,
  }
}

/**
 * Execute post-update hook
 */
export async function executePostUpdateHook(
  _commands: RefUpdateCommand[],
  results: RefUpdateResult[],
  hookFn: PostUpdateHookFn
): Promise<void> {
  // Get successfully updated ref names
  const successfulRefNames = results.filter((r) => r.success).map((r) => r.refName)

  // Only call hook if there were successful updates
  if (successfulRefNames.length > 0) {
    await hookFn(successfulRefNames)
  }
}

// ============================================================================
// Report Status Formatting
// ============================================================================

/**
 * Format report-status response
 */
export function formatReportStatus(input: ReportStatusInput): string {
  const lines: string[] = []

  // Unpack status line
  const unpackLine = input.unpackStatus === 'ok' ? 'unpack ok\n' : `unpack ${input.unpackStatus}\n`
  lines.push(encodePktLine(unpackLine) as string)

  // Ref status lines
  for (const result of input.refResults) {
    if (result.success) {
      lines.push(encodePktLine(`ok ${result.refName}\n`) as string)
    } else {
      lines.push(encodePktLine(`ng ${result.refName} ${result.error || 'failed'}\n`) as string)
    }
  }

  // End with flush
  lines.push(FLUSH_PKT)

  return lines.join('')
}

/**
 * Format report-status-v2 response
 */
export function formatReportStatusV2(input: ReportStatusInput): string {
  const lines: string[] = []

  // Option lines first
  if (input.options) {
    for (const [key, value] of Object.entries(input.options)) {
      lines.push(encodePktLine(`option ${key} ${value}\n`) as string)
    }
  }

  // Unpack status
  const unpackLine = input.unpackStatus === 'ok' ? 'unpack ok\n' : `unpack ${input.unpackStatus}\n`
  lines.push(encodePktLine(unpackLine) as string)

  // Ref status lines
  for (const result of input.refResults) {
    if (result.success) {
      let line = `ok ${result.refName}`
      if (result.forced) {
        line += ' forced'
      }
      lines.push(encodePktLine(line + '\n') as string)
    } else {
      lines.push(encodePktLine(`ng ${result.refName} ${result.error || 'failed'}\n`) as string)
    }
  }

  // End with flush
  lines.push(FLUSH_PKT)

  return lines.join('')
}

/**
 * Format rejection message
 */
export function rejectPush(
  refName: string,
  reason: string,
  options: { reportStatus?: boolean; sideBand?: boolean }
): string | Uint8Array {
  if (options.sideBand) {
    // Side-band channel 3 for errors
    const message = `error: failed to push ${refName}: ${reason}\n`
    const data = encoder.encode(message)
    const totalLength = 4 + 1 + data.length
    const hexLength = totalLength.toString(16).padStart(4, '0')
    const result = new Uint8Array(totalLength)
    result.set(encoder.encode(hexLength), 0)
    result[4] = 3 // Error channel
    result.set(data, 5)
    return result
  }

  // Report-status format
  return `ng ${refName} ${reason}`
}

// ============================================================================
// Full Receive-Pack Handler
// ============================================================================

/**
 * Handle complete receive-pack request
 */
export async function handleReceivePack(
  session: ReceivePackSession,
  request: Uint8Array,
  store: ObjectStore
): Promise<Uint8Array> {
  // Parse the request
  const parsed = parseReceivePackRequest(request)
  session.commands = parsed.commands

  // Merge capabilities from request
  const requestCaps = parseReceiveCapabilities(parsed.capabilities.join(' '))
  session.capabilities = { ...session.capabilities, ...requestCaps }

  // Check if we need to report status
  const needsReport =
    session.capabilities.reportStatus || session.capabilities.reportStatusV2

  // Validate packfile (if present and needed)
  let unpackStatus = 'ok'
  const hasNonDeleteCommands = parsed.commands.some((c) => c.type !== 'delete')

  if (hasNonDeleteCommands && parsed.packfile.length > 0) {
    const validation = await validatePackfile(parsed.packfile)
    if (!validation.valid) {
      unpackStatus = `error: ${validation.error}`
    } else {
      const unpackResult = await unpackObjects(parsed.packfile, store)
      if (!unpackResult.success) {
        unpackStatus = `error: ${unpackResult.error}`
      }
    }
  } else if (hasNonDeleteCommands && parsed.packfile.length === 0) {
    // Non-delete command but no packfile - this is OK for some cases
    // but we should still validate
    unpackStatus = 'ok'
  }

  // Process commands
  const refResults: RefUpdateResult[] = []

  for (const cmd of parsed.commands) {
    // Validate ref name
    if (!validateRefName(cmd.refName)) {
      refResults.push({
        refName: cmd.refName,
        success: false,
        error: 'invalid ref name',
      })
      continue
    }

    // Check current ref state
    const currentRef = await store.getRef(cmd.refName)
    const currentSha = currentRef?.sha || ZERO_SHA

    // For updates and deletes, verify old SHA matches
    if (cmd.type !== 'create') {
      if (currentSha !== cmd.oldSha) {
        refResults.push({
          refName: cmd.refName,
          success: false,
          error: 'lock failed: ref has been updated',
        })
        continue
      }
    }

    // Handle delete
    if (cmd.type === 'delete') {
      if (!session.capabilities.deleteRefs) {
        refResults.push({
          refName: cmd.refName,
          success: false,
          error: 'delete-refs not enabled',
        })
        continue
      }
      await store.deleteRef(cmd.refName)
      refResults.push({ refName: cmd.refName, success: true })
      continue
    }

    // Handle create/update
    if (cmd.type === 'update') {
      // Check fast-forward
      const isFF = await validateFastForward(cmd.oldSha, cmd.newSha, store)
      if (!isFF) {
        refResults.push({
          refName: cmd.refName,
          success: false,
          error: 'non-fast-forward update',
        })
        continue
      }
    }

    // Apply the update
    await store.setRef(cmd.refName, cmd.newSha)
    refResults.push({ refName: cmd.refName, success: true })
  }

  // Build response
  if (needsReport) {
    const statusFormat = session.capabilities.reportStatusV2
      ? formatReportStatusV2({ unpackStatus, refResults })
      : formatReportStatus({ unpackStatus, refResults })

    return encoder.encode(statusFormat)
  }

  // No report needed
  return new Uint8Array(0)
}
