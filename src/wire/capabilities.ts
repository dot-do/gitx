/**
 * Git wire protocol capability negotiation
 *
 * Capabilities are used during the initial handshake between git client and server
 * to determine what features are supported by both sides.
 *
 * Protocol v1: Capabilities are sent as a space-separated list after the first ref
 * Protocol v2: Capabilities are advertised line by line in the initial handshake
 *
 * Reference: https://git-scm.com/docs/protocol-capabilities
 * Reference: https://git-scm.com/docs/protocol-v2
 */

// ============================================================================
// Types
// ============================================================================

/** Git wire protocol version */
export type ProtocolVersion = 1 | 2

/** Standard protocol v1 capabilities */
export type CapabilityV1 =
  | 'multi_ack'
  | 'multi_ack_detailed'
  | 'thin-pack'
  | 'side-band'
  | 'side-band-64k'
  | 'ofs-delta'
  | 'shallow'
  | 'deepen-since'
  | 'deepen-not'
  | 'deepen-relative'
  | 'no-progress'
  | 'include-tag'
  | 'report-status'
  | 'report-status-v2'
  | 'delete-refs'
  | 'quiet'
  | 'atomic'
  | 'push-options'
  | 'allow-tip-sha1-in-want'
  | 'allow-reachable-sha1-in-want'
  | 'push-cert'
  | 'filter'
  | 'agent'
  | 'symref'
  | 'object-format'

/** Protocol v2 capabilities/commands */
export type CapabilityV2 =
  | 'agent'
  | 'ls-refs'
  | 'fetch'
  | 'server-option'
  | 'object-format'
  | 'session-id'
  | 'wait-for-done'
  | 'object-info'
  | 'bundle-uri'

/** Capability with optional value (e.g., agent=git/2.30.0) */
export interface CapabilityEntry {
  name: string
  value?: string
}

/** Parsed capability set */
export interface CapabilitySet {
  /** Protocol version being used */
  version: ProtocolVersion
  /** Map of capability name to optional value */
  capabilities: Map<string, string | undefined>
}

/** Ref advertisement with capabilities (protocol v1) */
export interface RefAdvertisement {
  /** The SHA-1 of the ref */
  oid: string
  /** The ref name (e.g., refs/heads/main) */
  name: string
  /** Capabilities (only on first ref line) */
  capabilities?: CapabilitySet
}

/** Protocol v2 server capabilities response */
export interface ServerCapabilitiesV2 {
  version: 2
  /** List of supported commands */
  commands: string[]
  /** Agent string */
  agent?: string
  /** Object format (sha1 or sha256) */
  objectFormat?: 'sha1' | 'sha256'
  /** Other capabilities */
  capabilities: Map<string, string | undefined>
}

/** Want line with capabilities for fetch request */
export interface WantRequest {
  /** SHA-1s of objects we want */
  wants: string[]
  /** Capabilities to send */
  capabilities: CapabilityEntry[]
}

/** Have line for negotiation */
export interface HaveRequest {
  /** SHA-1s of objects we have */
  haves: string[]
  /** Whether this is the final batch */
  done?: boolean
}

/** Version negotiation result */
export interface VersionNegotiationResult {
  /** Agreed upon version */
  version: ProtocolVersion
  /** Whether the server supports v2 */
  serverSupportsV2: boolean
  /** Common capabilities */
  commonCapabilities: string[]
}

// ============================================================================
// Constants
// ============================================================================

/** Default client capabilities for fetch (protocol v1) */
export const DEFAULT_FETCH_CAPABILITIES_V1: CapabilityV1[] = [
  'multi_ack_detailed',
  'side-band-64k',
  'thin-pack',
  'ofs-delta',
  'agent',
]

/** Default client capabilities for push (protocol v1) */
export const DEFAULT_PUSH_CAPABILITIES_V1: CapabilityV1[] = [
  'report-status',
  'side-band-64k',
  'agent',
  'quiet',
]

/** Minimum required capabilities for basic fetch */
export const REQUIRED_FETCH_CAPABILITIES: CapabilityV1[] = []

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse a capability string from ref advertisement (protocol v1).
 *
 * Format: "<oid> <refname>\0<cap1> <cap2> cap3=value..."
 *
 * @param line - The ref advertisement line with capabilities
 * @returns Parsed capabilities
 */
export function parseCapabilityString(line: string): CapabilitySet {
  // Find the NUL byte that separates ref info from capabilities
  const nulIndex = line.indexOf('\0')
  if (nulIndex === -1) {
    throw new Error('Invalid capability string: missing NUL byte separator')
  }

  // Extract the capability portion after the NUL byte
  const capString = line.slice(nulIndex + 1)

  // Parse the capabilities
  const entries = parseCapabilities(capString)

  // Build the capability map
  const capabilities = new Map<string, string | undefined>()
  for (const entry of entries) {
    capabilities.set(entry.name, entry.value)
  }

  return {
    version: 1,
    capabilities,
  }
}

/**
 * Parse individual capability entries from a space-separated string.
 *
 * @param capString - Space-separated capability string
 * @returns Array of capability entries
 */
export function parseCapabilities(capString: string): CapabilityEntry[] {
  // Trim and split by whitespace
  const trimmed = capString.trim()
  if (trimmed === '') {
    return []
  }

  // Split by whitespace (handles multiple spaces)
  const parts = trimmed.split(/\s+/)

  return parts.map((part) => {
    const eqIndex = part.indexOf('=')
    if (eqIndex === -1) {
      return { name: part }
    } else {
      return {
        name: part.slice(0, eqIndex),
        value: part.slice(eqIndex + 1),
      }
    }
  })
}

/**
 * Parse a ref advertisement line (protocol v1).
 *
 * First line format: "<oid> <refname>\0<capabilities>"
 * Subsequent lines: "<oid> <refname>"
 *
 * @param line - The pkt-line data (without length prefix)
 * @param isFirst - Whether this is the first line (contains capabilities)
 * @returns Parsed ref advertisement
 */
export function parseRefAdvertisement(line: string, isFirst: boolean): RefAdvertisement {
  // Remove trailing newline if present
  const cleanLine = line.replace(/\n$/, '')

  let oid: string
  let name: string
  let capabilities: CapabilitySet | undefined

  if (isFirst) {
    // First line has capabilities after NUL byte
    const nulIndex = cleanLine.indexOf('\0')
    if (nulIndex === -1) {
      throw new Error('First ref advertisement line must contain NUL byte')
    }

    const refPart = cleanLine.slice(0, nulIndex)
    const spaceIndex = refPart.indexOf(' ')
    if (spaceIndex === -1) {
      throw new Error('Invalid ref advertisement format: missing space between OID and refname')
    }

    oid = refPart.slice(0, spaceIndex)
    name = refPart.slice(spaceIndex + 1)

    // Validate OID length (should be 40 hex chars for SHA-1)
    if (oid.length !== 40) {
      throw new Error('Invalid OID length in ref advertisement')
    }

    capabilities = parseCapabilityString(cleanLine)
  } else {
    // Subsequent lines: just "<oid> <refname>"
    const spaceIndex = cleanLine.indexOf(' ')
    if (spaceIndex === -1) {
      throw new Error('Invalid ref advertisement format: missing space between OID and refname')
    }

    oid = cleanLine.slice(0, spaceIndex)
    name = cleanLine.slice(spaceIndex + 1)

    // Validate OID length
    if (oid.length !== 40) {
      throw new Error('Invalid OID length in ref advertisement')
    }
  }

  return {
    oid,
    name,
    capabilities,
  }
}

/**
 * Parse protocol v2 capability advertisement.
 *
 * Format:
 *   version 2
 *   agent=git/2.30.0
 *   ls-refs
 *   fetch=...
 *   server-option
 *   object-format=sha1
 *
 * @param lines - Array of pkt-line data
 * @returns Parsed server capabilities
 */
export function parseServerCapabilitiesV2(lines: string[]): ServerCapabilitiesV2 {
  if (lines.length === 0 || lines[0] !== 'version 2') {
    throw new Error('Invalid protocol v2 response: must start with "version 2"')
  }

  const commands: string[] = []
  const capabilities = new Map<string, string | undefined>()
  let agent: string | undefined
  let objectFormat: 'sha1' | 'sha256' | undefined

  // Process each line after "version 2"
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const eqIndex = line.indexOf('=')

    if (eqIndex === -1) {
      // This is a command without a value
      commands.push(line)
      capabilities.set(line, undefined)
    } else {
      const name = line.slice(0, eqIndex)
      const value = line.slice(eqIndex + 1)

      if (name === 'agent') {
        agent = value
      } else if (name === 'object-format') {
        objectFormat = value as 'sha1' | 'sha256'
      } else if (name === 'fetch' || name === 'ls-refs' || name === 'server-option') {
        // Commands with sub-capabilities
        commands.push(name)
        capabilities.set(name, value)
      } else {
        capabilities.set(name, value)
      }
    }
  }

  return {
    version: 2,
    commands,
    agent,
    objectFormat,
    capabilities,
  }
}

// ============================================================================
// Building Functions
// ============================================================================

/**
 * Build a capability string for want/have request (protocol v1).
 *
 * @param capabilities - Capabilities to include
 * @returns Space-separated capability string
 */
export function buildCapabilityString(capabilities: CapabilityEntry[]): string {
  return capabilities
    .map((cap) => {
      if (cap.value !== undefined) {
        return `${cap.name}=${cap.value}`
      }
      return cap.name
    })
    .join(' ')
}

/**
 * Build a want line with capabilities (first want only).
 *
 * Format: "want <oid> <capabilities>\n"
 *
 * @param oid - The object ID to want
 * @param capabilities - Capabilities to include
 * @returns Formatted want line
 */
export function buildWantLine(oid: string, capabilities?: CapabilityEntry[]): string {
  if (capabilities && capabilities.length > 0) {
    const capString = buildCapabilityString(capabilities)
    return `want ${oid} ${capString}\n`
  }
  return `want ${oid}\n`
}

/**
 * Build a have line for negotiation.
 *
 * Format: "have <oid>\n"
 *
 * @param oid - The object ID we have
 * @returns Formatted have line
 */
export function buildHaveLine(oid: string): string {
  return `have ${oid.toLowerCase()}\n`
}

/**
 * Build a complete want/have request.
 *
 * @param request - The want request with capabilities
 * @returns Array of pkt-line format strings
 */
export function buildFetchRequest(request: WantRequest): string[] {
  const lines: string[] = []

  for (let i = 0; i < request.wants.length; i++) {
    const oid = request.wants[i]
    if (i === 0) {
      // First want line includes capabilities
      lines.push(buildWantLine(oid, request.capabilities))
    } else {
      // Subsequent want lines don't include capabilities
      lines.push(buildWantLine(oid))
    }
  }

  return lines
}

/**
 * Build protocol v2 command request.
 *
 * Format:
 *   command=<cmd>
 *   capability1
 *   capability2=value
 *   0001 (delimiter)
 *   <command-specific args>
 *   0000 (flush)
 *
 * @param command - The v2 command (e.g., 'fetch', 'ls-refs')
 * @param capabilities - Client capabilities
 * @param args - Command-specific arguments
 * @returns Array of pkt-line format strings
 */
export function buildV2CommandRequest(
  command: string,
  capabilities: CapabilityEntry[],
  args?: string[]
): string[] {
  const lines: string[] = []

  // Add command line
  lines.push(`command=${command}`)

  // Add capabilities
  for (const cap of capabilities) {
    if (cap.value !== undefined) {
      lines.push(`${cap.name}=${cap.value}`)
    } else {
      lines.push(cap.name)
    }
  }

  // Add arguments if present
  if (args && args.length > 0) {
    for (const arg of args) {
      lines.push(arg)
    }
  }

  return lines
}

// ============================================================================
// Negotiation Functions
// ============================================================================

/**
 * Negotiate protocol version with server.
 *
 * @param serverAdvertisement - First line from server
 * @param preferredVersion - Client's preferred version
 * @returns Negotiation result
 */
export function negotiateVersion(
  serverAdvertisement: string,
  preferredVersion: ProtocolVersion = 2
): VersionNegotiationResult {
  const serverSupportsV2 = serverAdvertisement.startsWith('version 2')

  let version: ProtocolVersion
  if (serverSupportsV2 && preferredVersion === 2) {
    version = 2
  } else {
    version = 1
  }

  return {
    version,
    serverSupportsV2,
    commonCapabilities: [],
  }
}

/**
 * Find common capabilities between client and server.
 *
 * @param clientCaps - Client capabilities
 * @param serverCaps - Server capabilities
 * @returns Array of common capability names
 */
export function findCommonCapabilities(
  clientCaps: CapabilityEntry[],
  serverCaps: CapabilitySet
): string[] {
  const common: string[] = []

  for (const clientCap of clientCaps) {
    if (serverCaps.capabilities.has(clientCap.name)) {
      common.push(clientCap.name)
    }
  }

  return common
}

/**
 * Check if a specific capability is supported.
 *
 * @param capSet - The capability set to check
 * @param name - The capability name
 * @returns True if capability is supported
 */
export function hasCapability(capSet: CapabilitySet, name: string): boolean {
  return capSet.capabilities.has(name)
}

/**
 * Get the value of a capability (if it has one).
 *
 * @param capSet - The capability set
 * @param name - The capability name
 * @returns The capability value or undefined
 */
export function getCapabilityValue(capSet: CapabilitySet, name: string): string | undefined {
  return capSet.capabilities.get(name)
}

/**
 * Create a capability set from entries.
 *
 * @param version - Protocol version
 * @param entries - Capability entries
 * @returns CapabilitySet
 */
export function createCapabilitySet(
  version: ProtocolVersion,
  entries: CapabilityEntry[]
): CapabilitySet {
  const capabilities = new Map<string, string | undefined>()

  for (const entry of entries) {
    capabilities.set(entry.name, entry.value)
  }

  return {
    version,
    capabilities,
  }
}

/**
 * Select optimal capabilities for a fetch operation.
 *
 * @param serverCaps - Server advertised capabilities
 * @param clientPrefs - Client preferred capabilities (in priority order)
 * @returns Selected capabilities to use
 */
export function selectFetchCapabilities(
  serverCaps: CapabilitySet,
  clientPrefs: CapabilityEntry[]
): CapabilityEntry[] {
  const selected: CapabilityEntry[] = []

  for (const pref of clientPrefs) {
    if (serverCaps.capabilities.has(pref.name)) {
      // Use the client's value, not the server's
      selected.push(pref)
    }
  }

  return selected
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate that a capability name is well-formed.
 *
 * @param name - The capability name to validate
 * @returns True if valid
 */
export function isValidCapabilityName(name: string): boolean {
  if (name === '') {
    return false
  }

  // Check for invalid characters (spaces, NUL, newlines)
  if (/[\s\0\n]/.test(name)) {
    return false
  }

  return true
}

/**
 * Validate that required capabilities are present.
 *
 * @param capSet - The capability set to check
 * @param required - Required capability names
 * @returns Array of missing capability names
 */
export function validateRequiredCapabilities(
  capSet: CapabilitySet,
  required: string[]
): string[] {
  const missing: string[] = []

  for (const reqCap of required) {
    if (!capSet.capabilities.has(reqCap)) {
      missing.push(reqCap)
    }
  }

  return missing
}
